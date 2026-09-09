package rules

import (
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// NamedText is a formula with the name a rule gave it.
type NamedText struct {
	Name string
	Text string
}

// State is what a rule sees at one moment: the value of every variable, the
// verdict of every row, and the match. A value the probe cannot answer is nil,
// so a reader shows nothing rather than a number the rule never had.
//
// A service publishes this, retained, at {topic_prefix}/rules/{rule} on every
// evaluation, so the editor shows what the running engine computed for the
// saved file and never what a second evaluation in the page thinks it would
// (edge-hub service package RUL-9).
type State struct {
	Rule      string
	Variables map[string]any
	Rows      []any
	Result    any
}

// Probe reads a rule's variables and rows beside the engine, on the same slot
// values at the same moments, with the same formula code. It is the timeline
// of the simulator, lifted here so the page and the gateway keep one
// evaluation and cannot disagree about what a formula means.
//
// Its windows and its CHANGED memories are its own, reserved on its own
// resolver. Stepping a probe never moves the engine, and the engine never
// moves a probe: a probe is an observer, and the engine decides what fires.
type Probe struct {
	rule     string
	binder   *SimResolver
	env      formula.Env
	vars     []probeLine
	rows     []probeLine
	matchAll bool
	last     []formula.Value
}

// probeLine is one compiled formula, or the problem that stopped it.
type probeLine struct {
	name    string
	prog    *formula.Program
	problem string
}

// NewProbe compiles every variable and every row against one catalog. A
// formula that does not compile keeps its place and carries its problem, so
// the rest still reads while an operator is still typing; each problem is
// returned as well, at "variables/var[i]" or "rows[i]".
func NewProbe(cat Catalog, vars []NamedText, rows []string, matchAll bool) (*Probe, []Problem) {
	res, problems := NewSimResolver(cat)
	if len(problems) > 0 {
		return nil, problems
	}
	p := &Probe{binder: res, matchAll: matchAll}
	var out []Problem
	nodes := make(map[string]*formula.Node, len(vars))
	for i, v := range vars {
		l := probeLine{name: v.Name}
		at := "variables/var[" + itoa(i+1) + "]"
		node, err := formula.Parse(v.Text)
		if err != nil {
			l.problem = err.Error()
			out = append(out, Problem{Path: at, Message: l.problem})
			p.vars = append(p.vars, l)
			continue
		}
		nodes[v.Name] = node
		prog, probs := formula.Compile(node, nodes, res, false)
		if len(probs) > 0 {
			l.problem = probs[0]
			out = append(out, Problem{Path: at, Message: l.problem})
		} else {
			l.prog = prog
		}
		p.vars = append(p.vars, l)
	}
	for i, text := range rows {
		l := probeLine{name: "row" + itoa(i+1)}
		at := "rows[" + itoa(i+1) + "]"
		node, err := formula.Parse(text)
		if err != nil {
			l.problem = err.Error()
			out = append(out, Problem{Path: at, Message: l.problem})
			p.rows = append(p.rows, l)
			continue
		}
		prog, probs := formula.Compile(node, nodes, res, false)
		switch {
		case len(probs) > 0:
			l.problem = probs[0]
			out = append(out, Problem{Path: at, Message: l.problem})
		case !IsCondition(prog.Type):
			l.problem = "a condition must be true or false, but this is a " + prog.Type.String() + "."
			out = append(out, Problem{Path: at, Message: l.problem})
		default:
			l.prog = prog
		}
		p.rows = append(p.rows, l)
	}
	p.env = res.Env()
	p.last = make([]formula.Value, len(p.rows))
	return p, out
}

// NewRuleProbe is NewProbe for a rule the loader bound: the same variables,
// the same row texts, the same match.
func NewRuleProbe(cat Catalog, r *Rule) (*Probe, []Problem) {
	p, problems := NewProbe(cat, r.Variables(), r.RowTexts(), r.MatchAll())
	if p != nil {
		p.rule = r.Name
	}
	return p, problems
}

// IsCondition says whether a compiled formula can answer true or false.
func IsCondition(t formula.Type) bool {
	switch t {
	case formula.TypeNumber, formula.TypeString, formula.TypeDuration:
		return false
	}
	return true
}

// Step records one moment: it writes the readings, advances the history the
// way the engine does, evaluates every line, and returns what the rule sees.
// Call it once per engine evaluation, with the same values and the same now.
func (p *Probe) Step(values []any, now time.Time) State {
	p.binder.Advance(&p.env, values, now)
	st := State{Rule: p.rule, Variables: make(map[string]any, len(p.vars)), Rows: make([]any, len(p.rows))}
	for i := range p.vars {
		st.Variables[p.vars[i].name] = PlainValue(p.eval(p.vars[i].prog))
	}
	for i := range p.rows {
		v := p.eval(p.rows[i].prog)
		p.last[i] = v
		st.Rows[i] = PlainValue(v)
	}
	st.Result = p.result()
	return st
}

func (p *Probe) eval(prog *formula.Program) formula.Value {
	if prog == nil {
		return formula.Unknown
	}
	p.env.Stack = p.binder.Stack(prog)
	return prog.Eval(&p.env)
}

// result combines the rows the way the rule's group does: every row true, or
// any row true. An unknown row leaves the answer unknown unless another row
// already decided it.
func (p *Probe) result() any {
	if len(p.last) == 0 {
		return nil
	}
	sawUnknown := false
	for _, v := range p.last {
		if v.Kind != formula.VBool {
			sawUnknown = true
			continue
		}
		if !p.matchAll && v.B {
			return true
		}
		if p.matchAll && !v.B {
			return false
		}
	}
	if sawUnknown {
		return nil
	}
	return p.matchAll
}

// PlainValue is a formula value as a plain Go value that marshals to JSON:
// bool, float64, int64 or string, and nil for unknown or a duration, which
// no reader of a state needs.
func PlainValue(v formula.Value) any {
	switch v.Kind {
	case formula.VBool:
		return v.B
	case formula.VNumber:
		return v.Float()
	case formula.VInt:
		if i, ok := v.Int(); ok {
			return i
		}
		return nil
	case formula.VString:
		return v.S
	}
	return nil
}
