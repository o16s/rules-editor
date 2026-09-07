package rules

import (
	"strconv"
	"strings"
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// rule binds one <rule> element.
func (l *loader) rule(n *node, path string) Rule {
	name, _ := n.attr("name")
	l.ruleName = name
	r := Rule{Name: name}

	vars := l.variables(n, path)
	l.conditions(&r, n, path, vars)
	l.actions(&r, n, path, vars)
	l.incident(&r, n, path, vars)

	r.Edge = l.edge(n, path)
	r.Cooldown = l.cooldown(n, path)
	l.collect(&r)
	if r.hasTime && l.cat.Period <= 0 {
		l.fail(path, "this rule uses a time function, so the catalog needs a period: "+
			"the service must say how often it calls Eval")
	}
	l.ruleName = ""
	return r
}

// variables parses the named formulas of a rule. A formula that does not
// parse is reported here; the compiler reports what it means.
func (l *loader) variables(n *node, path string) map[string]*formula.Node {
	vars := make(map[string]*formula.Node, 8)
	for i := 0; i < len(n.Children); i++ {
		if n.Children[i].XMLName.Local != "variables" {
			continue
		}
		block := &n.Children[i]
		for j := 0; j < len(block.Children); j++ {
			v := &block.Children[j]
			at := path + "/variables/var[" + itoa(j+1) + "]"
			name, _ := v.attr("name")
			text, _ := v.attr("formula")
			if formula.IsReserved(name) {
				l.fail(at+"@name", `"`+name+`" is a reserved word`)
				continue
			}
			parsed, err := formula.Parse(text)
			if err != nil {
				l.fail(at+"@formula", formulaFault(err))
				continue
			}
			vars[name] = parsed
		}
	}
	return vars
}

// formulaFault renders a parse fault with its column, as the editor does.
func formulaFault(err error) string {
	var fe *formula.Error
	if errorsAs(err, &fe) {
		return fe.Message + " (column " + itoa(fe.Column+1) + ")"
	}
	return err.Error()
}

// errorsAs is errors.As for *formula.Error without the import in every call.
func errorsAs(err error, target **formula.Error) bool {
	e, ok := err.(*formula.Error)
	if ok {
		*target = e
	}
	return ok
}

// conditions binds the rule's condition rows and its match mode.
func (l *loader) conditions(r *Rule, n *node, path string, vars map[string]*formula.Node) {
	for i := 0; i < len(n.Children); i++ {
		child := &n.Children[i]
		switch child.XMLName.Local {
		case "cond":
			r.rows = append(r.rows, l.row(child, path+"/cond", vars))
		case "and", "or":
			r.matchAll = child.XMLName.Local == "and"
			l.group(r, child, path+"/"+child.XMLName.Local, vars)
		}
	}
	if len(r.rows) == 0 {
		l.fail(path, "the rule has no condition the engine can evaluate")
	}
}

// group binds the children of the rule's top-level group. A nested group
// folds into one row, the way the editor reads it.
func (l *loader) group(r *Rule, n *node, path string, vars map[string]*formula.Node) {
	counts := make(map[string]int, 3)
	for i := 0; i < len(n.Children); i++ {
		child := &n.Children[i]
		kind := child.XMLName.Local
		counts[kind]++
		at := path + "/" + kind + "[" + itoa(counts[kind]) + "]"
		if kind == "cond" {
			r.rows = append(r.rows, l.row(child, at, vars))
			continue
		}
		text, ok := l.fold(child, at, 2)
		if !ok {
			continue
		}
		row := l.compileRow(text, at, vars)
		if description, has := child.attr("description"); has {
			row.description = description
		}
		r.rows = append(r.rows, row)
	}
}

// fold renders a nested group as one formula, so a 0.2 file with groups
// inside groups reads as the rows the editor shows.
func (l *loader) fold(n *node, path string, depth int) (string, bool) {
	kind := strings.ToUpper(n.XMLName.Local)
	parts := make([]string, 0, len(n.Children))
	counts := make(map[string]int, 3)
	for i := 0; i < len(n.Children); i++ {
		child := &n.Children[i]
		counts[child.XMLName.Local]++
		at := path + "/" + child.XMLName.Local + "[" + itoa(counts[child.XMLName.Local]) + "]"
		if child.XMLName.Local == "cond" {
			text, ok := l.condText(child, at)
			if !ok {
				return "", false
			}
			parts = append(parts, text)
			continue
		}
		text, ok := l.fold(child, at, depth+1)
		if !ok {
			return "", false
		}
		parts = append(parts, text)
	}
	if len(parts) == 1 {
		return parts[0], true
	}
	return kind + "(" + strings.Join(parts, ", ") + ")", true
}

// row binds one <cond> element.
func (l *loader) row(n *node, path string, vars map[string]*formula.Node) row {
	text, ok := l.condText(n, path)
	if !ok {
		return row{}
	}
	out := l.compileRow(text, path, vars)
	if description, has := n.attr("description"); has {
		out.description = description
	}
	return out
}

// compileRow compiles one condition row and checks that it is a boolean.
func (l *loader) compileRow(text, path string, vars map[string]*formula.Node) row {
	parsed, err := formula.Parse(text)
	if err != nil {
		l.fail(path+"@expr", formulaFault(err))
		return row{}
	}
	prog, problems := formula.Compile(parsed, vars, l.bind, false)
	if len(problems) > 0 {
		l.failAll(path+"@expr", problems)
		return row{}
	}
	switch prog.Type {
	case formula.TypeNumber, formula.TypeString, formula.TypeDuration:
		l.fail(path+"@expr", "a condition must be true or false, but this is a "+
			prog.Type.String()+`. Compare it, for example "`+text+` > 0".`)
		return row{}
	}
	return row{prog: prog}
}

// condText gives the formula of one <cond>: its expr, or the 0.2 form
// rewritten as the formula the editor would write for it.
func (l *loader) condText(n *node, path string) (string, bool) {
	if expr, ok := n.attr("expr"); ok {
		return expr, true
	}
	device, _ := n.attr("device")
	tag, _ := n.attr("tag")
	op, _ := n.attr("op")
	value, _ := n.attr("value")

	if device == "" && !l.bind.hasImplicitSource() {
		l.fail(path+"@device", "device is required: this service publishes more than one device")
		return "", false
	}
	slot, _, ok := l.bind.Slot(device, tag)
	if !ok {
		l.fail(path+"@tag", "unknown field "+fieldWords(device, tag))
		return "", false
	}
	call := tagCall(device, tag)
	if canonicalOp(op) == "changed" {
		return "CHANGED(" + call + ")", true
	}
	literal, ok := l.literal(l.bind.types[slot], value, path)
	if !ok {
		return "", false
	}
	return call + " " + opSymbol(op) + " " + literal, true
}

// tagCall renders the TAG call of one field.
func tagCall(device, tag string) string {
	if device == "" {
		return "TAG(" + formula.QuoteString(tag) + ")"
	}
	return "TAG(" + formula.QuoteString(device) + ", " + formula.QuoteString(tag) + ")"
}

// canonicalOp folds an operator alias onto its canonical name.
func canonicalOp(op string) string {
	switch op {
	case "=", "==", "eq":
		return "eq"
	case "!=", "neq":
		return "neq"
	case "<", "lt":
		return "lt"
	case "<=", "leq":
		return "leq"
	case ">", "gt":
		return "gt"
	case ">=", "geq":
		return "geq"
	}
	return op
}

// opSymbol renders an operator as the formula language writes it.
func opSymbol(op string) string {
	switch canonicalOp(op) {
	case "eq":
		return "="
	case "neq":
		return "!="
	case "lt":
		return "<"
	case "leq":
		return "<="
	case "gt":
		return ">"
	case "geq":
		return ">="
	}
	return "="
}

// literal renders a 0.2 value attribute as a formula literal of the field's
// type, so the rewritten formula means what the 0.2 file meant.
func (l *loader) literal(t Type, value, path string) (string, bool) {
	switch t {
	case Bool:
		b, err := strconv.ParseBool(value)
		if err != nil {
			l.fail(path+"@value", "bad boolean value "+strconv.Quote(value))
			return "", false
		}
		if b {
			return "true", true
		}
		return "false", true
	case Integer:
		if _, err := strconv.ParseInt(value, 10, 64); err != nil {
			l.fail(path+"@value", "bad integer value "+strconv.Quote(value))
			return "", false
		}
		return value, true
	case Number:
		if _, err := strconv.ParseFloat(value, 64); err != nil {
			l.fail(path+"@value", "bad number value "+strconv.Quote(value))
			return "", false
		}
		return value, true
	case String:
		return formula.QuoteString(value), true
	}
	// A field of unknown type takes the value as the editor writes it.
	if _, err := strconv.ParseFloat(value, 64); err == nil {
		return value, true
	}
	if lower := strings.ToLower(value); lower == "true" || lower == "false" {
		return lower, true
	}
	return formula.QuoteString(value), true
}

// edge reads the edge attribute.
func (l *loader) edge(n *node, path string) EdgeType {
	value, ok := n.attr("edge")
	if !ok || value == "none" {
		return EdgeNone
	}
	if value == "rising" {
		return EdgeRising
	}
	l.fail(path+"@edge", "edge must be none or rising")
	return EdgeNone
}

// cooldown reads the cooldown attribute. A zero cooldown is no cooldown.
func (l *loader) cooldown(n *node, path string) time.Duration {
	value, ok := n.attr("cooldown")
	if !ok {
		return 0
	}
	d, err := time.ParseDuration(value)
	if err != nil {
		l.fail(path+"@cooldown", "cooldown "+strconv.Quote(value)+" is not a duration such as 30s")
		return 0
	}
	if d < 0 {
		l.fail(path+"@cooldown", "cooldown must not be negative")
		return 0
	}
	return d
}

// collect gathers what the engine indexes a rule by.
func (l *loader) collect(r *Rule) {
	for i := 0; i < len(r.rows); i++ {
		l.addProgram(r, r.rows[i].prog)
	}
	for i := 0; i < len(r.actions); i++ {
		l.addThen(r, r.actions[i].topic)
		l.addThen(r, r.actions[i].payload)
	}
	if r.incident != nil {
		l.addThen(r, r.incident.source)
		l.addThen(r, r.incident.summary)
		l.addThen(r, r.incident.firstStep)
		l.addThen(r, r.incident.cause)
	}
}

// addProgram takes the slots, the windows and the flags of one condition
// program. Only a condition makes a rule due: a Then field is rendered when
// the rule fires, not before.
func (l *loader) addProgram(r *Rule, p *formula.Program) {
	if p == nil {
		return
	}
	for _, slot := range p.Slots() {
		r.fieldRefs = appendUniqueInt(r.fieldRefs, slot)
	}
	for _, w := range p.Windows() {
		r.windows = appendUniqueInt(r.windows, w)
	}
	r.hasChanged = r.hasChanged || p.HasChanged
	r.hasTime = r.hasTime || p.HasTime
}

// addThen takes the windows of a Then field, and notes that the rule renders
// into a buffer.
func (l *loader) addThen(r *Rule, f thenField) {
	if f.prog == nil {
		return
	}
	r.needsBuffer = true
	for _, w := range f.prog.Windows() {
		r.windows = appendUniqueInt(r.windows, w)
	}
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

// itoa renders a small int.
func itoa(n int) string { return strconv.Itoa(n) }
