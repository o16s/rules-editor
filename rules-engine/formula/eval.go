package formula

import (
	"strconv"
	"strings"
	"time"
)

// Env is everything a program reads while it runs. The engine owns it and
// reuses it across evaluations: nothing here is allocated per run.
type Env struct {
	Slots      []any       // the current value of every catalog field
	Now        time.Time   // the time of this evaluation
	LastChange []time.Time // when each slot last changed, for STALE
	Windows    []*Window   // the time windows, indexed as the compiler bound them
	States     []Value     // the last known value of each CHANGED node
	Context    string      // the description of the firing condition
	Stack      []Value     // the value stack, at least Program.StackDepth() long
}

// slot reads one slot as a value.
func (e *Env) slot(i int32) Value {
	if i < 0 || int(i) >= len(e.Slots) {
		return Unknown
	}
	return FromAny(e.Slots[i])
}

// Eval runs the program and returns its value. It allocates nothing, except
// when the program joins strings with &.
func (p *Program) Eval(env *Env) Value {
	if p == nil || env == nil {
		return Unknown
	}
	if len(env.Stack) < p.depth {
		return Unknown
	}
	sp := 0
	for pc := 0; pc < len(p.code); pc++ {
		in := p.code[pc]
		switch in.op {
		case opConst:
			env.Stack[sp] = p.consts[in.a]
			sp++
		case opSlot:
			env.Stack[sp] = env.slot(in.a)
			sp++
		case opContext:
			env.Stack[sp] = StringValue(env.Context)
			sp++
		case opChanged:
			env.Stack[sp-1] = changed(env, in.a, env.Stack[sp-1])
		case opStale:
			env.Stack[sp] = stale(env, in.a, p.consts[in.b])
			sp++
		case opRate:
			env.Stack[sp] = windowValue(env, in.a, true)
			sp++
		case opAvg:
			env.Stack[sp] = windowValue(env, in.a, false)
			sp++
		case opNot:
			env.Stack[sp-1] = notValue(env.Stack[sp-1])
		case opNeg:
			env.Stack[sp-1] = negValue(env.Stack[sp-1])
		case opBin:
			sp--
			env.Stack[sp-1] = binValue(binop(in.a), env.Stack[sp-1], env.Stack[sp])
		case opBitwise:
			sp--
			env.Stack[sp-1] = bitwiseValue(bitop(in.a), env.Stack[sp-1], env.Stack[sp])
		case opHex2Dec:
			env.Stack[sp-1] = hex2dec(env.Stack[sp-1])
		case opAndAcc:
			pc, sp = fold(env, in, pc, sp, false)
		case opOrAcc:
			pc, sp = fold(env, in, pc, sp, true)
		}
	}
	if sp != 1 {
		return Unknown
	}
	return env.Stack[0]
}

// fold combines one argument of AND or OR with the accumulator below it. It
// jumps to the end of the call when the argument decides the result, which is
// what makes the logic short-circuit.
func fold(env *Env, in instr, pc, sp int, want bool) (int, int) {
	v := env.Stack[sp-1]
	sp--
	acc := env.Stack[sp-1]
	if v.Kind == VBool && v.B == want {
		env.Stack[sp-1] = BoolValue(want)
		return int(in.a) - 1, sp // the loop adds one
	}
	if v.Kind != VBool {
		env.Stack[sp-1] = Unknown
		return pc, sp
	}
	env.Stack[sp-1] = acc
	return pc, sp
}

// changed reports whether a value differs from the last known value of its
// node. An unknown value is never a change, and the first known value is not
// one either: a service restart must not fire a rule (ADR-018).
func changed(env *Env, state int32, v Value) Value {
	if state < 0 || int(state) >= len(env.States) {
		return Unknown
	}
	last := env.States[state]
	if v.Kind == VUnknown {
		return BoolValue(false)
	}
	if last.Kind == VUnknown {
		env.States[state] = v
		return BoolValue(false)
	}
	same := last.Equal(v)
	env.States[state] = v
	return BoolValue(!same)
}

// stale reports whether a slot is unknown, or did not change within the
// duration.
func stale(env *Env, slot int32, window Value) Value {
	if slot < 0 || int(slot) >= len(env.Slots) {
		return Unknown
	}
	if env.Slots[slot] == nil {
		return BoolValue(true)
	}
	d, ok := window.Duration()
	if !ok || slot >= int32(len(env.LastChange)) {
		return Unknown
	}
	last := env.LastChange[slot]
	if last.IsZero() {
		return BoolValue(true)
	}
	return BoolValue(env.Now.Sub(last) >= d)
}

// windowValue reads a rate or a mean from one window.
func windowValue(env *Env, index int32, rate bool) Value {
	if index < 0 || int(index) >= len(env.Windows) {
		return Unknown
	}
	w := env.Windows[index]
	if w == nil {
		return Unknown
	}
	if rate {
		return w.Rate()
	}
	return w.Avg()
}

// notValue inverts a boolean. Unknown stays unknown.
func notValue(v Value) Value {
	if v.Kind != VBool {
		return Unknown
	}
	return BoolValue(!v.B)
}

// negValue negates a number.
func negValue(v Value) Value {
	if !v.IsNumeric() {
		return Unknown
	}
	if v.Kind == VInt {
		return IntValue(-v.I)
	}
	return NumberValue(-v.Float())
}

// binValue applies one binary operator.
func binValue(op binop, l, r Value) Value {
	switch op {
	case bConcat:
		return StringValue(l.Text() + r.Text())
	case bAdd, bSub, bMul, bDiv:
		return arithmetic(op, l, r)
	}
	return compare(op, l, r)
}

// arithmetic adds, subtracts, multiplies or divides. Two integers stay
// integers, so a bit mask keeps its exact value.
func arithmetic(op binop, l, r Value) Value {
	if !l.IsNumeric() || !r.IsNumeric() {
		return Unknown
	}
	if l.Kind == VInt && r.Kind == VInt && op != bDiv {
		switch op {
		case bAdd:
			return IntValue(l.I + r.I)
		case bSub:
			return IntValue(l.I - r.I)
		case bMul:
			return IntValue(l.I * r.I)
		}
	}
	a, b := l.Float(), r.Float()
	switch op {
	case bAdd:
		return NumberValue(a + b)
	case bSub:
		return NumberValue(a - b)
	case bMul:
		return NumberValue(a * b)
	case bDiv:
		if b == 0 {
			return Unknown
		}
		return NumberValue(a / b)
	}
	return Unknown
}

// compare applies one comparison. Mixed kinds follow ADR-015: a boolean
// compared with 1 or 0 is a boolean, and a string compared with anything else
// compares with its rendered text.
func compare(op binop, l, r Value) Value {
	if l.Kind == VUnknown || r.Kind == VUnknown {
		return Unknown
	}
	switch {
	case l.IsNumeric() && r.IsNumeric():
		return order(op, l.Float(), r.Float())
	case l.Kind == VString && r.Kind == VString:
		return orderString(op, l.S, r.S)
	case l.Kind == VBool && r.Kind == VBool:
		return equality(op, l.B == r.B)
	case l.Kind == VBool && r.IsNumeric():
		return boolNumber(op, l.B, r)
	case l.IsNumeric() && r.Kind == VBool:
		return boolNumber(op, r.B, l)
	case l.Kind == VString:
		return orderString(op, l.S, r.Text())
	case r.Kind == VString:
		return orderString(op, l.Text(), r.S)
	}
	return Unknown
}

// boolNumber compares a boolean with a number: 1 is true and 0 is false, so
// a v0.2 rule keeps its meaning after the editor rewrites it as a formula.
// Any other number is simply not that boolean, which is an answer, not a
// missing one.
func boolNumber(op binop, b bool, n Value) Value {
	f := n.Float()
	if f != 0 && f != 1 {
		return equality(op, false)
	}
	return equality(op, b == (f == 1))
}

// equality answers = and !=, and refuses to order two values that have no
// order.
func equality(op binop, same bool) Value {
	switch op {
	case bEq:
		return BoolValue(same)
	case bNe:
		return BoolValue(!same)
	}
	return Unknown
}

// order compares two numbers.
func order(op binop, a, b float64) Value {
	switch op {
	case bEq:
		return BoolValue(a == b)
	case bNe:
		return BoolValue(a != b)
	case bLt:
		return BoolValue(a < b)
	case bLe:
		return BoolValue(a <= b)
	case bGt:
		return BoolValue(a > b)
	case bGe:
		return BoolValue(a >= b)
	}
	return Unknown
}

// orderString compares two strings, in code point order.
func orderString(op binop, a, b string) Value {
	c := strings.Compare(a, b)
	switch op {
	case bEq:
		return BoolValue(c == 0)
	case bNe:
		return BoolValue(c != 0)
	case bLt:
		return BoolValue(c < 0)
	case bLe:
		return BoolValue(c <= 0)
	case bGt:
		return BoolValue(c > 0)
	case bGe:
		return BoolValue(c >= 0)
	}
	return Unknown
}

// bitwiseValue applies one bitwise operator. An operand that is not a whole
// number has no bits, which is Unknown.
func bitwiseValue(op bitop, l, r Value) Value {
	a, aok := l.Int()
	b, bok := r.Int()
	if !aok || !bok {
		return Unknown
	}
	switch op {
	case bitAnd:
		return IntValue(a & b)
	case bitOr:
		return IntValue(a | b)
	case bitXor:
		return IntValue(a ^ b)
	}
	return Unknown
}

// hex2dec reads the integer value of a hexadecimal string.
func hex2dec(v Value) Value {
	if v.Kind != VString {
		return Unknown
	}
	text := strings.TrimSpace(v.S)
	if text == "" {
		return Unknown
	}
	n, err := strconv.ParseInt(text, 16, 64)
	if err != nil {
		return Unknown
	}
	return IntValue(n)
}
