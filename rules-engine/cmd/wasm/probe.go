//go:build js && wasm

package main

import (
	"strings"
	"time"

	"github.com/o16s/rules-editor/rules-engine/rules"
)

// probe draws the timeline: one line per variable and one per condition row,
// step by step. It is rules.Probe, the observer the gateway publishes from
// (edge-hub service package RUL-9), plus the accumulation of each step into a
// series. The engine beside it decides what the rule fires. Both read the
// same readings at the same moments with the same formula code, so a line, a
// firing and the state a service publishes cannot disagree.
type probe struct {
	p    *rules.Probe
	vars []line
	rows []line
	last any
}

// line is one formula's name, the values it took step by step, and the
// problem that stopped it compiling, if one did.
type line struct {
	name    string
	problem string
	values  []any
}

// newProbe compiles every variable and every row against one catalog. A
// formula that does not compile keeps its place in the timeline and carries
// its problem, so the page can draw the rest while an operator is still
// typing.
func newProbe(cat rules.Catalog, req request) (*probe, string) {
	vars := make([]rules.NamedText, 0, len(req.Variables))
	for _, v := range req.Variables {
		vars = append(vars, rules.NamedText{Name: v.Name, Text: v.Text})
	}
	rows := make([]string, 0, len(req.Rows))
	for _, r := range req.Rows {
		rows = append(rows, r.Text)
	}
	inner, problems := rules.NewProbe(cat, vars, rows, req.Match != "any")
	if inner == nil {
		if len(problems) > 0 {
			return nil, problems[0].Message
		}
		return nil, "the engine could not read this catalog."
	}
	p := &probe{p: inner}
	for _, v := range req.Variables {
		p.vars = append(p.vars, line{name: v.Name, values: make([]any, 0, len(req.Steps))})
	}
	for _, r := range req.Rows {
		p.rows = append(p.rows, line{name: r.Name, values: make([]any, 0, len(req.Steps))})
	}
	// A problem names its line by path; keep it on that line.
	for _, pr := range problems {
		switch {
		case strings.HasPrefix(pr.Path, "variables/var["):
			if i := indexIn(pr.Path); i >= 0 && i < len(p.vars) {
				p.vars[i].problem = pr.Message
			}
		case strings.HasPrefix(pr.Path, "rows["):
			if i := indexIn(pr.Path); i >= 0 && i < len(p.rows) {
				p.rows[i].problem = pr.Message
			}
		}
	}
	return p, ""
}

// indexIn reads the 1-based index inside the last [...] of a path, 0-based.
func indexIn(path string) int {
	open := strings.LastIndex(path, "[")
	close := strings.LastIndex(path, "]")
	if open < 0 || close < open {
		return -1
	}
	n := 0
	for _, c := range path[open+1 : close] {
		if c < '0' || c > '9' {
			return -1
		}
		n = n*10 + int(c-'0')
	}
	return n - 1
}

// step records one moment: the readings, the history advanced the way the
// engine advances it, and every line evaluated.
func (p *probe) step(values []any, now time.Time) {
	st := p.p.Step(values, now)
	for i := range p.vars {
		p.vars[i].values = append(p.vars[i].values, st.Variables[p.vars[i].name])
	}
	for i := range p.rows {
		var v any
		if i < len(st.Rows) {
			v = st.Rows[i]
		}
		p.rows[i].values = append(p.rows[i].values, v)
	}
	p.last = st.Result
}

// result is the match of the last step: every row true, or any row true, or
// nil while a row is unknown.
func (p *probe) result() any { return p.last }

// finish copies the lines into the answer.
func (p *probe) finish(res *response) {
	for _, l := range p.vars {
		res.Variables = append(res.Variables, series{Name: l.name, Values: l.values, Problem: l.problem})
	}
	for _, l := range p.rows {
		res.Rows = append(res.Rows, series{Name: l.name, Values: l.values, Problem: l.problem})
	}
}
