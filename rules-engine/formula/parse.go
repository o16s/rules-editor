package formula

import (
	"strconv"
	"strings"
)

// Kind is the kind of an AST node.
type Kind uint8

const (
	KindNumber Kind = iota
	KindString
	KindBool
	KindDuration
	KindRef
	KindContext
	KindCall
	KindUnary
	KindBinary
)

// Node is one AST node. The fields a kind uses:
//
//	KindNumber   Num, Raw
//	KindDuration Num (seconds), Raw
//	KindString   Str (the value, unescaped)
//	KindBool     Bool
//	KindRef      Str (the variable name)
//	KindContext  Str (the dotted name)
//	KindCall     Str (the upper-case name), Args
//	KindUnary    Str ("-"), Args[0]
//	KindBinary   Str (the operator), Args[0] and Args[1]
type Node struct {
	Kind Kind
	Num  float64
	Raw  string
	Str  string
	Bool bool
	Args []*Node
}

// binaryPrecedence orders the binary operators, lowest first.
var binaryPrecedence = map[string]int{
	"&": 1,
	"=": 2, "!=": 2, "<": 2, "<=": 2, ">": 2, ">=": 2,
	"+": 3, "-": 3,
	"*": 4, "/": 4,
}

const unaryPrecedence = 5

// maxDepth bounds the parser's recursion. Parsing happens at load time only,
// and no real formula comes close to this depth.
const maxDepth = 64

// normalizeOp folds the two operator aliases onto their canonical form.
func normalizeOp(op string) string {
	switch op {
	case "==":
		return "="
	case "<>":
		return "!="
	}
	return op
}

// parser holds the parse state. It exists so the steps stay short functions
// without threading five parameters through each.
type parser struct {
	tokens []token
	pos    int
	offset int // 1 when a leading "=" was dropped, so columns match the input
	depth  int
	err    *Error
}

// Parse reads a formula and returns its AST. A leading "=" is accepted and
// dropped. The error is always of type *Error.
func Parse(text string) (*Node, error) {
	offset := 0
	body := text
	if strings.HasPrefix(text, "=") {
		offset = 1
		body = text[1:]
	}
	tokens, err := tokenize(body)
	if err != nil {
		err.Column += offset
		return nil, err
	}
	p := &parser{tokens: tokens, offset: offset}
	node := p.expression(0)
	if p.err != nil {
		return nil, p.err
	}
	if rest := p.peek(); rest.kind != tkEOF {
		return nil, p.fail(`Unexpected "`+rest.text+`".`, rest)
	}
	return node, nil
}

// MustParse is Parse for a formula the caller knows is good, such as one it
// built itself. It panics on a fault, which is a programming error.
func MustParse(text string) *Node {
	n, err := Parse(text)
	if err != nil {
		panic("formula: MustParse(" + text + "): " + err.Error())
	}
	return n
}

func (p *parser) peek() token { return p.tokens[p.pos] }

func (p *parser) next() token {
	t := p.tokens[p.pos]
	if p.pos < len(p.tokens)-1 {
		p.pos++
	}
	return t
}

// fail records the first fault and returns nil, so the callers unwind
// without a second error.
func (p *parser) fail(message string, at token) *Error {
	if p.err == nil {
		p.err = &Error{Message: message, Column: at.start + p.offset}
	}
	return p.err
}

// expect consumes one token of the given kind, or records a fault.
func (p *parser) expect(kind tokenKind, what string) token {
	t := p.next()
	if t.kind != kind {
		if t.kind == tkEOF {
			p.fail("Expected "+what+" at the end.", t)
		} else {
			p.fail("Expected "+what+`, got "`+t.text+`".`, t)
		}
	}
	return t
}

// expression parses with precedence climbing.
func (p *parser) expression(minPrecedence int) *Node {
	if p.err != nil {
		return nil
	}
	p.depth++
	defer func() { p.depth-- }()
	if p.depth > maxDepth {
		p.fail("The formula is too deep.", p.peek())
		return nil
	}
	left := p.primary()
	for i := 0; i < maxTokens && p.err == nil; i++ {
		t := p.peek()
		if t.kind != tkOp {
			break
		}
		prec, ok := binaryPrecedence[normalizeOp(t.text)]
		if !ok || prec < minPrecedence {
			break
		}
		p.next()
		right := p.expression(prec + 1)
		left = &Node{Kind: KindBinary, Str: normalizeOp(t.text), Args: []*Node{left, right}}
	}
	return left
}

// primary parses a literal, a name, a call, a group or a unary minus.
func (p *parser) primary() *Node {
	if p.err != nil {
		return nil
	}
	t := p.next()
	switch t.kind {
	case tkNumber:
		value, err := strconv.ParseFloat(t.text, 64)
		if err != nil {
			p.fail(`Bad number "`+t.text+`".`, t)
			return nil
		}
		return &Node{Kind: KindNumber, Num: value, Raw: t.text}
	case tkDuration:
		return durationNode(t)
	case tkString:
		return &Node{Kind: KindString, Str: unquote(t.text)}
	case tkBool:
		return &Node{Kind: KindBool, Bool: strings.EqualFold(t.text, "true")}
	case tkContext:
		return &Node{Kind: KindContext, Str: t.text}
	case tkIdent:
		return &Node{Kind: KindRef, Str: t.text}
	case tkFunction:
		return p.call(t)
	case tkLparen:
		inner := p.expression(0)
		p.expect(tkRparen, `")"`)
		return inner
	case tkOp:
		if t.text == "-" {
			return &Node{Kind: KindUnary, Str: "-", Args: []*Node{p.expression(unaryPrecedence)}}
		}
		p.fail(`Unexpected "`+t.text+`".`, t)
		return nil
	case tkEOF:
		p.fail("The formula is incomplete.", t)
		return nil
	default:
		p.fail(`Unexpected "`+t.text+`".`, t)
		return nil
	}
}

// call parses the argument list of a function.
func (p *parser) call(name token) *Node {
	p.expect(tkLparen, `"("`)
	args := make([]*Node, 0, 4)
	if p.peek().kind != tkRparen {
		for i := 0; i < maxArgs && p.err == nil; i++ {
			args = append(args, p.expression(0))
			if p.peek().kind != tkComma {
				break
			}
			p.next()
		}
	}
	p.expect(tkRparen, `")"`)
	return &Node{Kind: KindCall, Str: strings.ToUpper(name.text), Args: args}
}

// maxArgs bounds an argument list. The registry allows at most 16.
const maxArgs = 32

// durationNode splits a duration token into its number and its unit.
func durationNode(t token) *Node {
	i := 0
	for i < len(t.text) && (isDigit(t.text[i]) || t.text[i] == '.') {
		i++
	}
	value, err := strconv.ParseFloat(t.text[:i], 64)
	if err != nil {
		return &Node{Kind: KindDuration, Num: 0, Raw: t.text}
	}
	seconds, _ := unitSeconds(t.text[i:])
	return &Node{Kind: KindDuration, Num: value * seconds, Raw: t.text}
}

// unquote turns the source text of a string literal into its value.
func unquote(raw string) string {
	if len(raw) < 2 {
		return ""
	}
	return strings.ReplaceAll(raw[1:len(raw)-1], `""`, `"`)
}
