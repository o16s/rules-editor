// Package formula is the formula language of rules.xml v0.3: the tokenizer,
// the parser, the printer, the static checks, the compiler and the
// evaluator. It is a port of src/formula.ts of the rules editor, function by
// function, so the two can be read side by side.
//
//	TAG("vibration1", "temperature") > 50
//	AND(milk_temp > 3.6, door_changed)
//	BITAND(status_word, HEX2DEC("10")) != 0
//	condition.description & ". The press PLC set its own alarm bit."
//
// ../../schema/formula-cases.json holds the cases both implementations must
// agree on, and ../../schema/formula-functions.json the function registry.
package formula

import "strings"

// tokenKind classifies one token.
type tokenKind uint8

const (
	tkNumber tokenKind = iota
	tkDuration
	tkString
	tkIdent
	tkContext
	tkBool
	tkFunction
	tkOp
	tkLparen
	tkRparen
	tkComma
	tkEOF
)

// token is one lexical unit. start is the byte offset in the tokenized text,
// which is the formula body: the caller adds the offset of a leading "=".
type token struct {
	kind  tokenKind
	text  string
	start int
}

// Error is a formula that does not parse. Column is the 0-based offset in the
// text as the caller passed it, the leading "=" included.
type Error struct {
	Message string
	Column  int
}

func (e *Error) Error() string { return e.Message }

// durationSeconds maps a duration unit to its length in seconds. The set is
// the one the editor accepts, which is not the Go set: min is 60 s here.
var durationUnits = [...]struct {
	name    string
	seconds float64
}{
	{"ms", 0.001}, {"s", 1}, {"min", 60}, {"m", 60}, {"h", 3600},
}

// unitSeconds resolves a duration unit, or reports that it is unknown.
func unitSeconds(unit string) (float64, bool) {
	for i := 0; i < len(durationUnits); i++ {
		if durationUnits[i].name == unit {
			return durationUnits[i].seconds, true
		}
	}
	return 0, false
}

// maxTokens bounds the tokenizer. A formula longer than this is a fault of
// the file, not of the language.
const maxTokens = 4096

func isIdentStart(c byte) bool {
	return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isIdentChar(c byte) bool { return isIdentStart(c) || (c >= '0' && c <= '9') }

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'
}

// tokenize splits text into tokens. It stops at the first fault and returns
// it, because the engine never colours a broken formula: it refuses the file.
func tokenize(text string) ([]token, *Error) {
	out := make([]token, 0, 32)
	i := 0
	for i < len(text) && len(out) < maxTokens {
		c := text[i]
		start := i
		switch {
		case isSpace(c):
			for i < len(text) && isSpace(text[i]) {
				i++
			}
		case c == '"':
			var err *Error
			i, err = scanString(text, i, &out)
			if err != nil {
				return nil, err
			}
		case isDigit(c) || (c == '.' && i+1 < len(text) && isDigit(text[i+1])):
			var err *Error
			i, err = scanNumber(text, i, &out)
			if err != nil {
				return nil, err
			}
		case isIdentStart(c):
			i = scanWord(text, i, &out)
		default:
			var err *Error
			i, err = scanSymbol(text, i, &out)
			if err != nil {
				return nil, err
			}
		}
		if i == start && !isSpace(c) {
			return nil, &Error{Message: `Unexpected character "` + string(c) + `".`, Column: start}
		}
	}
	out = append(out, token{kind: tkEOF, text: "", start: len(text)})
	return out, nil
}

// scanString reads a quoted string. Two quotes inside are one quote.
func scanString(text string, i int, out *[]token) (int, *Error) {
	start := i
	i++
	for i < len(text) {
		if text[i] == '"' {
			if i+1 < len(text) && text[i+1] == '"' {
				i += 2
				continue
			}
			i++
			*out = append(*out, token{kind: tkString, text: text[start:i], start: start})
			return i, nil
		}
		i++
	}
	return 0, &Error{Message: "Missing closing quote.", Column: start}
}

// scanNumber reads a number, or a number with a duration unit.
func scanNumber(text string, i int, out *[]token) (int, *Error) {
	start := i
	for i < len(text) && isDigit(text[i]) {
		i++
	}
	if i < len(text) && text[i] == '.' {
		i++
		for i < len(text) && isDigit(text[i]) {
			i++
		}
	}
	if i < len(text) && isIdentStart(text[i]) {
		unitStart := i
		for i < len(text) && isIdentChar(text[i]) {
			i++
		}
		unit := text[unitStart:i]
		if _, ok := unitSeconds(unit); !ok {
			return 0, &Error{Message: `"` + unit + `" is not a unit of time. Use ms, s, m, min or h.`, Column: unitStart}
		}
		*out = append(*out, token{kind: tkDuration, text: text[start:i], start: start})
		return i, nil
	}
	*out = append(*out, token{kind: tkNumber, text: text[start:i], start: start})
	return i, nil
}

// scanWord reads an identifier, a dotted context name, a boolean literal, or
// a function name. A word followed by "(" is a function.
func scanWord(text string, i int, out *[]token) int {
	start := i
	for i < len(text) && isIdentChar(text[i]) {
		i++
	}
	if i+1 < len(text) && text[i] == '.' && isIdentStart(text[i+1]) {
		i++
		for i < len(text) && isIdentChar(text[i]) {
			i++
		}
		*out = append(*out, token{kind: tkContext, text: text[start:i], start: start})
		return i
	}
	word := text[start:i]
	upper := strings.ToUpper(word)
	j := i
	for j < len(text) && isSpace(text[j]) {
		j++
	}
	kind := tkIdent
	switch {
	case upper == "TRUE" || upper == "FALSE":
		kind = tkBool
	case j < len(text) && text[j] == '(':
		kind = tkFunction
	}
	*out = append(*out, token{kind: kind, text: word, start: start})
	return i
}

// twoCharOps are the operators written with two characters.
var twoCharOps = [...]string{"<=", ">=", "!=", "<>", "=="}

// scanSymbol reads an operator, a parenthesis or a comma.
func scanSymbol(text string, i int, out *[]token) (int, *Error) {
	start := i
	if i+1 < len(text) {
		two := text[i : i+2]
		for k := 0; k < len(twoCharOps); k++ {
			if twoCharOps[k] == two {
				*out = append(*out, token{kind: tkOp, text: two, start: start})
				return i + 2, nil
			}
		}
	}
	c := text[i]
	switch {
	case strings.IndexByte("&=<>+-*/", c) >= 0:
		*out = append(*out, token{kind: tkOp, text: text[i : i+1], start: start})
	case c == '(':
		*out = append(*out, token{kind: tkLparen, text: "(", start: start})
	case c == ')':
		*out = append(*out, token{kind: tkRparen, text: ")", start: start})
	case c == ',':
		*out = append(*out, token{kind: tkComma, text: ",", start: start})
	default:
		return 0, &Error{Message: `Unexpected character "` + string(c) + `".`, Column: start}
	}
	return i + 1, nil
}
