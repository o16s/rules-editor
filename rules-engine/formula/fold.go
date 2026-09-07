package formula

// fold evaluates a subtree whose leaves are all literals, so a formula such
// as BITAND(x, HEX2DEC("10")) costs one constant at run time instead of a
// call. It returns the value, its type, and whether the fold succeeded.
//
// Nothing that reads the world folds: a field, a context name, a variable,
// CHANGED, STALE, RATE and AVG all say no.
func (c *compiler) fold(n *Node, depth int) (Value, Type, bool) {
	if n == nil || depth > maxDepth {
		return Unknown, TypeAny, false
	}
	switch n.Kind {
	case KindNumber:
		return NumberValue(n.Num), TypeNumber, true
	case KindString:
		return StringValue(n.Str), TypeString, true
	case KindBool:
		return BoolValue(n.Bool), TypeBool, true
	case KindDuration:
		return Value{Kind: VDuration, F: n.Num, S: n.Raw}, TypeDuration, true
	case KindUnary:
		return c.foldUnary(n, depth)
	case KindBinary:
		return c.foldBinary(n, depth)
	case KindCall:
		return c.foldCall(n, depth)
	}
	return Unknown, TypeAny, false
}

// foldUnary folds a negation of a constant.
func (c *compiler) foldUnary(n *Node, depth int) (Value, Type, bool) {
	if len(n.Args) != 1 {
		return Unknown, TypeAny, false
	}
	v, _, ok := c.fold(n.Args[0], depth+1)
	if !ok {
		return Unknown, TypeAny, false
	}
	return negValue(v), TypeNumber, true
}

// foldBinary folds an operator whose two operands are constants.
func (c *compiler) foldBinary(n *Node, depth int) (Value, Type, bool) {
	if len(n.Args) != 2 {
		return Unknown, TypeAny, false
	}
	op, known := binaryOps[n.Str]
	if !known {
		return Unknown, TypeAny, false
	}
	l, _, lok := c.fold(n.Args[0], depth+1)
	r, _, rok := c.fold(n.Args[1], depth+1)
	if !lok || !rok {
		return Unknown, TypeAny, false
	}
	return binValue(op, l, r), binaryType(n.Str), true
}

// foldableCalls are the functions that depend on their arguments alone.
var foldableCalls = [...]string{"HEX2DEC", "BITAND", "BITOR", "BITXOR", "NOT", "AND", "OR"}

// foldCall folds a call whose arguments are all constants.
func (c *compiler) foldCall(n *Node, depth int) (Value, Type, bool) {
	if !inList(n.Str, foldableCalls[:]) {
		return Unknown, TypeAny, false
	}
	spec, ok := FunctionSpec(n.Str)
	if !ok || len(n.Args) < spec.MinArgs || len(n.Args) > spec.MaxArgs {
		return Unknown, TypeAny, false
	}
	var args [16]Value
	for i := 0; i < len(n.Args) && i < len(args); i++ {
		v, _, ok := c.fold(n.Args[i], depth+1)
		if !ok {
			return Unknown, TypeAny, false
		}
		args[i] = v
	}
	return foldFunction(n.Str, args[:len(n.Args)])
}

// foldFunction applies one foldable function to constant arguments.
func foldFunction(name string, args []Value) (Value, Type, bool) {
	switch name {
	case "HEX2DEC":
		return hex2dec(args[0]), TypeNumber, true
	case "BITAND":
		return bitwiseValue(bitAnd, args[0], args[1]), TypeNumber, true
	case "BITOR":
		return bitwiseValue(bitOr, args[0], args[1]), TypeNumber, true
	case "BITXOR":
		return bitwiseValue(bitXor, args[0], args[1]), TypeNumber, true
	case "NOT":
		return notValue(args[0]), TypeBool, true
	case "AND":
		return foldLogic(args, false), TypeBool, true
	case "OR":
		return foldLogic(args, true), TypeBool, true
	}
	return Unknown, TypeAny, false
}

// foldLogic folds AND or OR over constants, with the same unknown rules the
// evaluator applies.
func foldLogic(args []Value, isOr bool) Value {
	acc := BoolValue(!isOr)
	for i := 0; i < len(args); i++ {
		v := args[i]
		if v.Kind == VBool && v.B == isOr {
			return BoolValue(isOr)
		}
		if v.Kind != VBool {
			acc = Unknown
		}
	}
	return acc
}

// inList reports whether v is one of the listed names.
func inList(v string, list []string) bool {
	for i := 0; i < len(list); i++ {
		if list[i] == v {
			return true
		}
	}
	return false
}
