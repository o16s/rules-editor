//go:build js && wasm

package main

import (
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
	"github.com/o16s/rules-editor/rules-engine/rules"
)

// probe draws the timeline: one line per variable and one per condition row.
// The engine beside it decides what the rule fires. Both read the same
// readings at the same moments, and both evaluate with the same formula code,
// so a line and a firing cannot disagree about what a formula means.
type probe struct {
	binder  *rules.SimResolver
	env     formula.Env
	vars    []line
	rows    []line
	match   string
	slots   int
	lastRow []formula.Value
}

// line is one compiled formula and the values it took, step by step.
type line struct {
	name    string
	prog    *formula.Program
	problem string
	values  []any
}

// newProbe compiles every variable and every row against one catalog. A
// formula that does not compile keeps its place in the timeline and carries
// its problem, so the page can draw the rest while an operator is still
// typing.
func newProbe(cat rules.Catalog, req request) (*probe, string) {
	res, problems := rules.NewSimResolver(cat)
	if len(problems) > 0 {
		return nil, problems[0].Message
	}
	p := &probe{binder: res, slots: len(cat.Fields), match: "all"}

	// Variables first: a row may name one, so they compile in order.
	vars := make(map[string]*formula.Node, len(req.Variables))
	for _, v := range req.Variables {
		l := line{name: v.Name, values: make([]any, 0, len(req.Steps))}
		node, err := formula.Parse(v.Text)
		if err != nil {
			l.problem = err.Error()
			p.vars = append(p.vars, l)
			continue
		}
		vars[v.Name] = node
		prog, probs := formula.Compile(node, vars, res, false)
		if len(probs) > 0 {
			l.problem = probs[0]
		} else {
			l.prog = prog
		}
		p.vars = append(p.vars, l)
	}

	for _, r := range req.Rows {
		l := line{name: r.Name, values: make([]any, 0, len(req.Steps))}
		node, err := formula.Parse(r.Text)
		if err != nil {
			l.problem = err.Error()
			p.rows = append(p.rows, l)
			continue
		}
		prog, probs := formula.Compile(node, vars, res, false)
		if len(probs) > 0 {
			l.problem = probs[0]
		} else {
			l.prog = prog
		}
		p.rows = append(p.rows, l)
	}

	p.env = res.Env()
	p.lastRow = make([]formula.Value, len(p.rows))
	return p, ""
}

// step records one moment: it writes the readings, advances the history the
// way the engine does, and evaluates every line.
func (p *probe) step(values []any, now time.Time) {
	p.binder.Advance(&p.env, values, now)
	for i := range p.vars {
		p.vars[i].values = append(p.vars[i].values, p.eval(p.vars[i].prog))
	}
	for i := range p.rows {
		v := p.evalValue(p.rows[i].prog)
		p.lastRow[i] = v
		p.rows[i].values = append(p.rows[i].values, jsValue(v))
	}
}

func (p *probe) eval(prog *formula.Program) any { return jsValue(p.evalValue(prog)) }

func (p *probe) evalValue(prog *formula.Program) formula.Value {
	if prog == nil {
		return formula.Unknown
	}
	p.env.Stack = p.binder.Stack(prog)
	return prog.Eval(&p.env)
}

// result combines the rows the way the rule's group does: every row true, or
// any row true. An unknown row leaves the answer unknown unless another row
// already decided it.
func (p *probe) result() any {
	if len(p.lastRow) == 0 {
		return nil
	}
	sawUnknown := false
	for _, v := range p.lastRow {
		if v.Kind != formula.VBool {
			sawUnknown = true
			continue
		}
		if p.match == "any" && v.B {
			return true
		}
		if p.match == "all" && !v.B {
			return false
		}
	}
	if sawUnknown {
		return nil
	}
	return p.match == "all"
}

// finish copies the lines into the answer.
func (p *probe) finish(res *response) {
	for _, l := range p.vars {
		res.Variables = append(res.Variables, series{Name: l.name, Values: l.values, Problem: l.problem})
	}
	for _, l := range p.rows {
		res.Rows = append(res.Rows, series{Name: l.name, Values: l.values, Problem: l.problem})
	}
}
