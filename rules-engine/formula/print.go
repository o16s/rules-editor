package formula

import "strings"

// QuoteString renders a string literal the way the tokenizer reads it back.
func QuoteString(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

// precedenceOf gives a node its binding strength, for the parentheses of
// Print. A leaf binds tighter than any operator.
func precedenceOf(n *Node) int {
	switch n.Kind {
	case KindBinary:
		return binaryPrecedence[n.Str]
	case KindUnary:
		return unaryPrecedence
	default:
		return 10
	}
}

// Print renders an AST as canonical text: one space around an operator,
// upper-case function names, and the fewest parentheses that keep the shape.
func Print(n *Node) string {
	if n == nil {
		return ""
	}
	var b strings.Builder
	printTo(&b, n, 0)
	return b.String()
}

// maxPrintDepth bounds the printer, which walks the tree the parser built.
const maxPrintDepth = maxDepth + 2

// printTo writes one node.
func printTo(b *strings.Builder, n *Node, depth int) {
	if n == nil || depth > maxPrintDepth {
		return
	}
	switch n.Kind {
	case KindNumber, KindDuration:
		b.WriteString(n.Raw)
	case KindString:
		b.WriteString(QuoteString(n.Str))
	case KindBool:
		if n.Bool {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case KindRef, KindContext:
		b.WriteString(n.Str)
	case KindCall:
		b.WriteString(n.Str)
		b.WriteByte('(')
		for i := 0; i < len(n.Args); i++ {
			if i > 0 {
				b.WriteString(", ")
			}
			printTo(b, n.Args[i], depth+1)
		}
		b.WriteByte(')')
	case KindUnary:
		printUnary(b, n, depth)
	case KindBinary:
		printBinary(b, n, depth)
	}
}

// printUnary writes a unary minus, with parentheses when its argument binds
// more loosely than it does.
func printUnary(b *strings.Builder, n *Node, depth int) {
	if len(n.Args) != 1 {
		return
	}
	b.WriteByte('-')
	if precedenceOf(n.Args[0]) < unaryPrecedence {
		b.WriteByte('(')
		printTo(b, n.Args[0], depth+1)
		b.WriteByte(')')
		return
	}
	printTo(b, n.Args[0], depth+1)
}

// printBinary writes a binary operator. The right side is parenthesized at
// equal precedence too, so a - (b - c) keeps its shape.
func printBinary(b *strings.Builder, n *Node, depth int) {
	if len(n.Args) != 2 {
		return
	}
	prec := binaryPrecedence[n.Str]
	printSide(b, n.Args[0], prec, false, depth)
	b.WriteByte(' ')
	b.WriteString(n.Str)
	b.WriteByte(' ')
	printSide(b, n.Args[1], prec, true, depth)
}

// printSide writes one operand, in parentheses when it needs them.
func printSide(b *strings.Builder, side *Node, prec int, strict bool, depth int) {
	p := precedenceOf(side)
	if p < prec || (strict && p == prec) {
		b.WriteByte('(')
		printTo(b, side, depth+1)
		b.WriteByte(')')
		return
	}
	printTo(b, side, depth+1)
}
