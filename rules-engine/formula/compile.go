package formula

import "time"

// Resolver binds the names of a formula to the runtime of a service: a field
// to a slot, and a time function to the window and state slots it needs. The
// rules package implements it over a Catalog.
type Resolver interface {
	// Slot resolves a field. device is empty for a service with one implicit
	// source.
	Slot(device, tag string) (index int, typ Type, ok bool)
	// Window reserves the ring of one slot and one duration. Two calls with
	// the same pair give the same index. ok is false when the engine already
	// holds as many windows as it allows.
	Window(slot int, window time.Duration) (index int, ok bool)
	// ChangedState reserves the memory of one CHANGED node.
	ChangedState() (index int, ok bool)
}

// compiler holds the state of one compilation.
type compiler struct {
	prog       *Program
	vars       map[string]*Node
	resolver   Resolver
	allowCtx   bool
	problems   []string
	inlineFrom []string // the variables being inlined, to report a cycle
}

// Compile turns one formula into a program. vars holds the variables of the
// rule, already parsed; they are inlined, so nothing resolves at run time.
// allowContext says whether condition.description may appear, which is true
// in a Then field and false in a condition.
//
// A non-empty problem list means the formula is not usable, and the program
// is nil.
func Compile(n *Node, vars map[string]*Node, r Resolver, allowContext bool) (*Program, []string) {
	if n == nil {
		return nil, []string{"the formula is empty."}
	}
	if r == nil {
		panic("formula: Compile without a resolver")
	}
	c := &compiler{
		prog:     &Program{code: make([]instr, 0, 16), consts: make([]Value, 0, 8)},
		vars:     vars,
		resolver: r,
		allowCtx: allowContext,
		problems: make([]string, 0, 4),
	}
	c.problems = append(c.problems, CheckFunctions(n)...)
	t := c.node(n, 0)
	if len(c.problems) > 0 {
		return nil, c.problems
	}
	c.prog.Type = t
	c.prog.depth = stackDepth(c.prog.code)
	return c.prog, nil
}

// fail records one problem, up to a small cap: after a few, the message list
// stops helping.
func (c *compiler) fail(message string) {
	if len(c.problems) < 16 {
		c.problems = append(c.problems, message)
	}
}

// emit appends one instruction.
func (c *compiler) emit(op opcode, a, b int32) int {
	c.prog.code = append(c.prog.code, instr{op: op, a: a, b: b})
	return len(c.prog.code) - 1
}

// constant appends a constant and emits a push of it.
func (c *compiler) constant(v Value) {
	c.prog.consts = append(c.prog.consts, v)
	c.emit(opConst, int32(len(c.prog.consts)-1), 0)
}

// node compiles one node and returns the static type of its result.
func (c *compiler) node(n *Node, depth int) Type {
	if n == nil || depth > maxDepth {
		c.fail("the formula is too deep.")
		return TypeAny
	}
	if v, t, ok := c.fold(n, depth); ok {
		c.constant(v)
		return t
	}
	switch n.Kind {
	case KindNumber:
		c.constant(NumberValue(n.Num))
		return TypeNumber
	case KindString:
		c.constant(StringValue(n.Str))
		return TypeString
	case KindBool:
		c.constant(BoolValue(n.Bool))
		return TypeBool
	case KindDuration:
		c.constant(Value{Kind: VDuration, F: n.Num, S: n.Raw})
		return TypeDuration
	case KindRef:
		return c.reference(n, depth)
	case KindContext:
		return c.context(n)
	case KindUnary:
		c.node(n.Args[0], depth+1)
		c.emit(opNeg, 0, 0)
		return TypeNumber
	case KindBinary:
		return c.binary(n, depth)
	case KindCall:
		return c.call(n, depth)
	}
	c.fail("the formula is not usable.")
	return TypeAny
}

// reference inlines a variable, and reports a cycle or an unknown name.
func (c *compiler) reference(n *Node, depth int) Type {
	body, ok := c.vars[n.Str]
	if !ok {
		c.fail(`"` + n.Str + `" is not a variable of this rule.`)
		return TypeAny
	}
	for i := 0; i < len(c.inlineFrom); i++ {
		if c.inlineFrom[i] == n.Str {
			c.fail(`"` + n.Str + `" refers to itself through ` + chain(c.inlineFrom, n.Str) + ".")
			return TypeAny
		}
	}
	if len(c.inlineFrom) >= MaxVariables {
		c.fail("the variables of this rule are nested too deeply.")
		return TypeAny
	}
	c.inlineFrom = append(c.inlineFrom, n.Str)
	t := c.node(body, depth+1)
	c.inlineFrom = c.inlineFrom[:len(c.inlineFrom)-1]
	return t
}

// MaxVariables is the number of variables one rule may declare. It bounds the
// inlining depth too.
const MaxVariables = 64

// DefaultStaleWindow is the duration STALE uses when the formula names none,
// as the signature STALE(x, 4h) shows and the editor's simulator assumes. A
// zero window would make every STALE true at once, on every field.
const DefaultStaleWindow = 4 * time.Hour

// chain renders a reference cycle for a message.
func chain(from []string, name string) string {
	out := ""
	started := false
	for i := 0; i < len(from); i++ {
		if !started && from[i] != name {
			continue
		}
		started = true
		out += from[i] + " → "
	}
	return out + name
}

// context compiles condition.description.
func (c *compiler) context(n *Node) Type {
	if !IsContextName(n.Str) {
		c.fail(`"` + n.Str + `" is not a known name. Did you mean ` + ContextNames[0] + "?")
		return TypeAny
	}
	if !c.allowCtx {
		c.fail(n.Str + " can only be used in a Then field.")
		return TypeAny
	}
	c.emit(opContext, 0, 0)
	return TypeString
}

// binaryOps maps an operator to its instruction argument.
var binaryOps = map[string]binop{
	"+": bAdd, "-": bSub, "*": bMul, "/": bDiv, "&": bConcat,
	"=": bEq, "!=": bNe, "<": bLt, "<=": bLe, ">": bGt, ">=": bGe,
}

// binary compiles an operator and its two operands.
func (c *compiler) binary(n *Node, depth int) Type {
	if len(n.Args) != 2 {
		c.fail("an operator needs two operands.")
		return TypeAny
	}
	op, ok := binaryOps[n.Str]
	if !ok {
		c.fail(`unknown operator "` + n.Str + `".`)
		return TypeAny
	}
	c.node(n.Args[0], depth+1)
	c.node(n.Args[1], depth+1)
	c.emit(opBin, int32(op), 0)
	if op == bConcat {
		c.prog.HasConcat = true
	}
	return binaryType(n.Str)
}

// call compiles one function call.
func (c *compiler) call(n *Node, depth int) Type {
	switch n.Str {
	case "TAG":
		return c.tag(n)
	case "AND":
		return c.logic(n, depth, false)
	case "OR":
		return c.logic(n, depth, true)
	case "NOT":
		c.node(n.Args[0], depth+1)
		c.emit(opNot, 0, 0)
		return TypeBool
	case "CHANGED":
		return c.changed(n, depth)
	case "STALE":
		return c.stale(n, depth)
	case "RATE", "AVG":
		return c.windowCall(n, depth)
	case "BITAND", "BITOR", "BITXOR":
		return c.bitwise(n, depth)
	case "HEX2DEC":
		c.node(n.Args[0], depth+1)
		c.emit(opHex2Dec, 0, 0)
		return TypeNumber
	}
	// CheckFunctions already reported an unknown name.
	return TypeAny
}

// tag binds a field to its slot.
func (c *compiler) tag(n *Node) Type {
	ref, ok := literalTag(n)
	if !ok {
		c.fail("TAG() needs the names of a device and a tag as text, not an expression.")
		return TypeAny
	}
	slot, typ, found := c.resolver.Slot(ref.Device, ref.Tag)
	if !found {
		c.fail("unknown " + tagWords(ref) + ".")
		return TypeAny
	}
	c.emit(opSlot, int32(slot), 0)
	c.prog.slots = appendUniqueInt(c.prog.slots, slot)
	return typ
}

// tagWords names a field for a message.
func tagWords(ref TagRef) string {
	if ref.Device == "" {
		return `tag "` + ref.Tag + `"`
	}
	return `tag "` + ref.Tag + `" of device "` + ref.Device + `"`
}

// logic compiles AND or OR with short-circuit jumps. The accumulator below
// the arguments carries whether an unknown argument was seen.
func (c *compiler) logic(n *Node, depth int, isOr bool) Type {
	op := opAndAcc
	if isOr {
		op = opOrAcc
	}
	// The accumulator starts at the value that does not decide the result:
	// true for AND, false for OR. A fold that meets the deciding value jumps
	// out; one that meets an unknown argument turns it into Unknown.
	c.constant(BoolValue(!isOr))
	folds := make([]int, 0, len(n.Args))
	for i := 0; i < len(n.Args) && i < maxArgs; i++ {
		c.node(n.Args[i], depth+1)
		folds = append(folds, c.emit(op, 0, 0))
	}
	end := int32(len(c.prog.code))
	for i := 0; i < len(folds); i++ {
		c.prog.code[folds[i]].a = end
	}
	return TypeBool
}

// changed compiles CHANGED and reserves the memory of its last known value.
func (c *compiler) changed(n *Node, depth int) Type {
	c.node(n.Args[0], depth+1)
	state, ok := c.resolver.ChangedState()
	if !ok {
		c.fail("this file uses more CHANGED() than the engine allows.")
		return TypeBool
	}
	c.emit(opChanged, int32(state), 0)
	c.prog.states = appendUniqueInt(c.prog.states, state)
	c.prog.HasChanged = true
	return TypeBool
}

// stale compiles STALE. Its first argument must name a field, because the
// engine follows the field, not the expression.
func (c *compiler) stale(n *Node, depth int) Type {
	slot, ok := c.fieldOf(n.Args[0], "STALE")
	if !ok {
		return TypeBool
	}
	window := DefaultStaleWindow
	if len(n.Args) == 2 {
		d, ok := c.duration(n.Args[1], "STALE")
		if !ok {
			return TypeBool
		}
		window = d
	}
	c.prog.consts = append(c.prog.consts, Value{Kind: VDuration, F: window.Seconds()})
	c.emit(opStale, int32(slot), int32(len(c.prog.consts)-1))
	c.prog.slots = appendUniqueInt(c.prog.slots, slot)
	c.prog.HasTime = true
	_ = depth
	return TypeBool
}

// windowCall compiles RATE or AVG and reserves their ring.
func (c *compiler) windowCall(n *Node, depth int) Type {
	slot, ok := c.fieldOf(n.Args[0], n.Str)
	if !ok {
		return TypeNumber
	}
	window, ok := c.duration(n.Args[1], n.Str)
	if !ok {
		return TypeNumber
	}
	index, ok := c.resolver.Window(slot, window)
	if !ok {
		c.fail("this file uses more time windows than the engine allows.")
		return TypeNumber
	}
	op := opRate
	if n.Str == "AVG" {
		op = opAvg
	}
	c.emit(op, int32(index), 0)
	c.prog.slots = appendUniqueInt(c.prog.slots, slot)
	before := len(c.prog.windows)
	c.prog.windows = appendUniqueInt(c.prog.windows, index)
	if len(c.prog.windows) > before {
		c.prog.windowSpecs = append(c.prog.windowSpecs, WindowSpec{Slot: slot, Window: window})
	}
	c.prog.HasTime = true
	_ = depth
	return TypeNumber
}

// fieldOf resolves the field argument of a time function, through a variable
// when the operator named one.
func (c *compiler) fieldOf(n *Node, fn string) (int, bool) {
	node := n
	for i := 0; i < MaxVariables && node != nil && node.Kind == KindRef; i++ {
		node = c.vars[node.Str]
	}
	if node == nil || node.Kind != KindCall || node.Str != "TAG" {
		c.fail(fn + "() needs a field, not an expression: " + fn + "(TAG(\"tag\"), 30min).")
		return 0, false
	}
	ref, ok := literalTag(node)
	if !ok {
		c.fail("TAG() needs the names of a device and a tag as text, not an expression.")
		return 0, false
	}
	slot, _, found := c.resolver.Slot(ref.Device, ref.Tag)
	if !found {
		c.fail("unknown " + tagWords(ref) + ".")
		return 0, false
	}
	return slot, true
}

// duration reads a literal duration argument.
func (c *compiler) duration(n *Node, fn string) (time.Duration, bool) {
	node := n
	for i := 0; i < MaxVariables && node != nil && node.Kind == KindRef; i++ {
		node = c.vars[node.Str]
	}
	if node == nil || node.Kind != KindDuration {
		c.fail(fn + "() needs a duration such as 30min or 4h.")
		return 0, false
	}
	d := time.Duration(node.Num * float64(time.Second))
	if d <= 0 {
		c.fail(fn + "() needs a duration greater than zero.")
		return 0, false
	}
	return d, true
}

// bitwise compiles BITAND, BITOR or BITXOR.
func (c *compiler) bitwise(n *Node, depth int) Type {
	ops := map[string]bitop{"BITAND": bitAnd, "BITOR": bitOr, "BITXOR": bitXor}
	c.node(n.Args[0], depth+1)
	c.node(n.Args[1], depth+1)
	c.emit(opBitwise, int32(ops[n.Str]), 0)
	return TypeNumber
}

// appendUniqueInt adds an index once.
func appendUniqueInt(list []int, v int) []int {
	for i := 0; i < len(list); i++ {
		if list[i] == v {
			return list
		}
	}
	return append(list, v)
}

// stackDepth simulates the program to size its value stack.
func stackDepth(code []instr) int {
	sp, max := 0, 1
	for i := 0; i < len(code); i++ {
		switch code[i].op {
		case opConst, opSlot, opContext, opStale, opRate, opAvg:
			sp++
		case opBin, opBitwise, opAndAcc, opOrAcc:
			sp--
		}
		if sp > max {
			max = sp
		}
	}
	return max + 1
}
