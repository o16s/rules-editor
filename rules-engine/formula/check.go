package formula

import "strings"

// Type is the static type of a formula or of a field.
type Type uint8

const (
	TypeAny Type = iota
	TypeBool
	TypeNumber
	TypeString
	TypeDuration
)

// String names a type as the editor names it, for a message.
func (t Type) String() string {
	switch t {
	case TypeBool:
		return "bool"
	case TypeNumber:
		return "number"
	case TypeString:
		return "string"
	case TypeDuration:
		return "duration"
	default:
		return "any"
	}
}

// Spec is one entry of the function registry. Doc and Example are the help
// the editor shows beside the name, so one text describes one function.
type Spec struct {
	Name      string `json:"name"`
	MinArgs   int    `json:"minArgs"`
	MaxArgs   int    `json:"maxArgs"`
	Returns   string `json:"returns"`
	Signature string `json:"signature"`
	Doc       string `json:"doc"`
	Example   string `json:"example"`
}

// Functions is every function the language knows. It must stay identical to
// FUNCTIONS in src/formula.ts; ../../schema/formula-functions.json is the
// shared copy and check_test.go holds the two together.
//
// A window function reads the ring of readings the engine keeps for one field
// and one duration. The engine records one reading per evaluation, so a mean
// is the mean of what the service read.
var Functions = [...]Spec{
	{"TAG", 1, 2, "any", `TAG("tag") or TAG("device", "tag")`,
		"The current value of a field the service decodes.",
		`TAG("pump1", "temperature")`},
	{"AND", 2, 16, "bool", "AND(a, b, …)",
		"True when every argument is true.",
		"AND(running, temperature > 60)"},
	{"OR", 2, 16, "bool", "OR(a, b, …)",
		"True when at least one argument is true.",
		"OR(alarm_high, alarm_low)"},
	{"NOT", 1, 1, "bool", "NOT(a)",
		"The opposite of a true or false value.",
		"NOT(running)"},
	{"CHANGED", 1, 1, "bool", "CHANGED(x)",
		"True in the evaluation where the value became different from the last one known. The first reading is not a change.",
		"CHANGED(error_code)"},
	{"STALE", 1, 2, "bool", "STALE(x, 4h)",
		"True when the value did not change for the whole duration. A value the service cannot read is stale at once.",
		"STALE(temperature, 15min)"},
	{"PREV", 1, 1, "any", "PREV(x)",
		"The value the field held before its last change.",
		"AND(CHANGED(state), PREV(state) = 0)"},
	{"SINCE", 1, 1, "number", "SINCE(x)",
		"How many seconds passed since the field last changed.",
		"SINCE(heartbeat) > 300"},
	{"RATE", 2, 2, "number", "RATE(x, 30min)",
		"How fast the value changes, per hour, across the window.",
		"RATE(temperature, 30min) > 4"},
	{"AVG", 2, 2, "number", "AVG(x, 10min)",
		"The mean of the readings in the window.",
		"AVG(temperature, 10min) > 70"},
	{"MIN", 2, 2, "number", "MIN(x, 10min)",
		"The smallest reading in the window.",
		"MIN(pressure, 1h) < 2"},
	{"MAX", 2, 2, "number", "MAX(x, 10min)",
		"The largest reading in the window. It keeps a peak that one poll on its own would miss.",
		"MAX(vibration, 10min) > 8"},
	{"COUNT", 2, 2, "number", "COUNT(x, 1h)",
		"How many readings the window holds.",
		"COUNT(temperature, 1h) < 10"},
	{"DELTA", 2, 2, "number", "DELTA(x, 15min)",
		"The newest reading minus the oldest one in the window.",
		"DELTA(level, 1h) < -20"},
	{"STDDEV", 2, 2, "number", "STDDEV(x, 30min)",
		"How much the readings in the window spread around their mean.",
		"STDDEV(current, 30min) > 1.5"},
	{"ZSCORE", 2, 2, "number", "ZSCORE(x, 2h)",
		"How unusual the current reading is against the window. Three or more sits far outside the usual range.",
		"ZSCORE(vibration, 2h) > 3"},
	{"SLOPE", 2, 2, "number", "SLOPE(x, 1h)",
		"The trend of the window, per hour. It fits a line through every reading, so noise moves it less than RATE.",
		"SLOPE(temperature, 1h) > 2"},
	{"FORECAST", 3, 3, "number", "FORECAST(x, 1h, 8h)",
		"Where the value lands after the horizon, if the trend of the window holds.",
		"FORECAST(temperature, 1h, 8h) > 90"},
	{"EWMA", 2, 2, "number", "EWMA(x, 5min)",
		"A smoothed value that follows the field. Recent readings weigh more, and the time constant says how fast older ones stop counting.",
		"EWMA(temperature, 5min) > 70"},
	{"BITAND", 2, 2, "number", "BITAND(x, mask)",
		"The bits that are set in both numbers.",
		"BITAND(status_word, 4) <> 0"},
	{"BITOR", 2, 2, "number", "BITOR(x, mask)",
		"The bits that are set in either number.",
		"BITOR(flags, 1)"},
	{"BITXOR", 2, 2, "number", "BITXOR(x, mask)",
		"The bits that are set in one number but not the other.",
		"BITXOR(flags, last_flags) <> 0"},
	{"HEX2DEC", 1, 1, "number", `HEX2DEC("FF")`,
		"The number a hexadecimal text stands for.",
		`BITAND(status_word, HEX2DEC("10")) <> 0`},
}

// FunctionSpec resolves a function name, case-insensitively.
func FunctionSpec(name string) (Spec, bool) {
	upper := strings.ToUpper(name)
	for i := 0; i < len(Functions); i++ {
		if Functions[i].Name == upper {
			return Functions[i], true
		}
	}
	return Spec{}, false
}

// returnType maps the registry's text to a Type.
func returnType(returns string) Type {
	switch returns {
	case "bool":
		return TypeBool
	case "number":
		return TypeNumber
	case "string":
		return TypeString
	case "duration":
		return TypeDuration
	default:
		return TypeAny
	}
}

// literalNames are the names a variable must not take, next to the function
// names: the boolean literals and the context object.
var literalNames = [...]string{"TRUE", "FALSE", "CONDITION"}

// IsReserved reports whether a variable name collides with a function name,
// a boolean literal or the context object. The comparison ignores case.
func IsReserved(name string) bool {
	upper := strings.ToUpper(name)
	for i := 0; i < len(literalNames); i++ {
		if literalNames[i] == upper {
			return true
		}
	}
	_, ok := FunctionSpec(upper)
	return ok
}

// ContextNames are the names a Then field can read from the firing condition.
var ContextNames = [...]string{"condition.description"}

// IsContextName reports whether a dotted name is one the engine provides.
func IsContextName(name string) bool {
	for i := 0; i < len(ContextNames); i++ {
		if ContextNames[i] == name {
			return true
		}
	}
	return false
}

// TagRef is one TAG(...) call with literal arguments.
type TagRef struct {
	Device string
	Tag    string
}

// Refs is everything a formula reads: the variables by name, the literal TAG
// calls, and the context names. Each list is free of duplicates, in the order
// of first use.
type Refs struct {
	Variables []string
	Tags      []TagRef
	Context   []string
}

// maxRefs bounds each list of Refs.
const maxRefs = 256

// Collect walks the AST and reports everything it reads.
func Collect(n *Node) Refs {
	var refs Refs
	walk(n, 0, func(node *Node) {
		switch node.Kind {
		case KindRef:
			refs.Variables = appendUnique(refs.Variables, node.Str)
		case KindContext:
			refs.Context = appendUnique(refs.Context, node.Str)
		case KindCall:
			if ref, ok := literalTag(node); ok && len(refs.Tags) < maxRefs {
				if !hasTag(refs.Tags, ref) {
					refs.Tags = append(refs.Tags, ref)
				}
			}
		}
	})
	return refs
}

// literalTag reads a TAG call whose arguments are all string literals.
func literalTag(n *Node) (TagRef, bool) {
	if n.Kind != KindCall || n.Str != "TAG" || len(n.Args) < 1 || len(n.Args) > 2 {
		return TagRef{}, false
	}
	for i := 0; i < len(n.Args); i++ {
		if n.Args[i].Kind != KindString {
			return TagRef{}, false
		}
	}
	if len(n.Args) == 2 {
		return TagRef{Device: n.Args[0].Str, Tag: n.Args[1].Str}, true
	}
	return TagRef{Tag: n.Args[0].Str}, true
}

func hasTag(list []TagRef, ref TagRef) bool {
	for i := 0; i < len(list); i++ {
		if list[i] == ref {
			return true
		}
	}
	return false
}

func appendUnique(list []string, v string) []string {
	for i := 0; i < len(list); i++ {
		if list[i] == v {
			return list
		}
	}
	if len(list) >= maxRefs {
		return list
	}
	return append(list, v)
}

// walk visits every node once, depth first. The depth is bounded by the
// parser, which refuses a deeper formula.
func walk(n *Node, depth int, visit func(*Node)) {
	if n == nil || depth > maxPrintDepth {
		return
	}
	visit(n)
	for i := 0; i < len(n.Args); i++ {
		walk(n.Args[i], depth+1, visit)
	}
}

// CheckFunctions reports unknown functions and wrong argument counts, in the
// words the editor uses.
func CheckFunctions(n *Node) []string {
	out := make([]string, 0, 4)
	walk(n, 0, func(node *Node) {
		if node.Kind != KindCall {
			return
		}
		spec, ok := FunctionSpec(node.Str)
		if !ok {
			out = append(out, "Unknown function "+node.Str+"().")
			return
		}
		if len(node.Args) < spec.MinArgs || len(node.Args) > spec.MaxArgs {
			out = append(out, spec.Name+"() takes "+wantArgs(spec)+", got "+
				itoa(len(node.Args))+": "+spec.Signature+".")
		}
	})
	return out
}

// wantArgs renders the accepted argument count of a function.
func wantArgs(spec Spec) string {
	count := itoa(spec.MinArgs)
	if spec.MinArgs != spec.MaxArgs {
		count += " to " + itoa(spec.MaxArgs)
	}
	if spec.MaxArgs == 1 {
		return count + " argument"
	}
	return count + " arguments"
}

// InferType gives a formula its static type. lookup gives a variable its
// type, or TypeAny when it is unknown.
func InferType(n *Node, lookup func(string) Type) Type {
	if n == nil {
		return TypeAny
	}
	switch n.Kind {
	case KindNumber:
		return TypeNumber
	case KindDuration:
		return TypeDuration
	case KindString, KindContext:
		return TypeString
	case KindBool:
		return TypeBool
	case KindRef:
		if lookup == nil {
			return TypeAny
		}
		return lookup(n.Str)
	case KindCall:
		spec, ok := FunctionSpec(n.Str)
		if !ok {
			return TypeAny
		}
		return returnType(spec.Returns)
	case KindUnary:
		return TypeNumber
	case KindBinary:
		return binaryType(n.Str)
	}
	return TypeAny
}

// binaryType types one operator: & joins strings, arithmetic gives a number,
// and everything else is a comparison.
func binaryType(op string) Type {
	switch op {
	case "&":
		return TypeString
	case "+", "-", "*", "/":
		return TypeNumber
	}
	return TypeBool
}

// itoa renders a small int without pulling strconv into these paths.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [12]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 && i > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg && i > 0 {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
