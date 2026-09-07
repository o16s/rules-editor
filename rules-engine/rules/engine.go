package rules

import (
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// maxPerEval bounds what one evaluation returns. A file that fires more than
// this in one cycle has a fault the operator must see, not a burst the broker
// should carry.
const maxPerEval = 100

// Engine evaluates a set of rules against the slot array of a service. It is
// not safe for concurrent use: one goroutine owns the slots and calls Eval.
type Engine struct {
	rules        []Rule
	rulesByField [][]int
	timeRules    []int

	dueSet []bool
	due    []int

	past    history
	env     formula.Env
	lastNow time.Time

	actions   []Action
	incidents []Incident
	stats     Stats
}

// NewEngine preallocates everything the evaluation needs. It panics on a
// programming fault of the caller: a nil rule set, or a rule that reads a
// slot the catalog does not have.
func NewEngine(rules []Rule, cat Catalog) *Engine {
	if rules == nil {
		panic("rules: NewEngine with a nil rule set")
	}
	slots := len(cat.Fields)
	e := &Engine{
		rules:        rules,
		rulesByField: make([][]int, slots),
		dueSet:       make([]bool, len(rules)),
		due:          make([]int, 0, len(rules)),
	}
	e.index(slots)
	e.past.build(cat, windowSpecs(rules), ewmaSpecs(rules))
	e.env = formula.Env{
		LastChange: e.past.lastChange,
		Windows:    e.past.windows,
		Ewmas:      e.past.ewmas,
		States:     make([]formula.Value, countStates(rules)),
		Stack:      make([]formula.Value, stackDepth(rules)),
	}
	e.actions = make([]Action, 0, countActions(rules))
	e.incidents = make([]Incident, 0, countIncidents(rules))
	e.seed()
	return e
}

// index builds the map from a slot to the rules that read it, and the list of
// rules that depend on time alone.
func (e *Engine) index(slots int) {
	for ri := 0; ri < len(e.rules); ri++ {
		r := &e.rules[ri]
		for _, slot := range r.fieldRefs {
			if slot < 0 || slot >= slots {
				panic("rules: NewEngine with a rule that reads a slot outside the catalog")
			}
			e.rulesByField[slot] = append(e.rulesByField[slot], ri)
		}
		// A rule with a rising edge only fires when its inputs move, so the
		// index above is enough for it. Anything else has to be evaluated
		// every time: a rule that reads a clock, and a rule without a rising
		// edge, which fires on every evaluation where its condition is true.
		if r.hasTime || r.Edge == EdgeNone {
			e.timeRules = append(e.timeRules, ri)
		}
	}
}

// seed marks every incident rule as active, so the first evaluation closes an
// incident whose cause disappeared while the service was down, and re-raises
// one whose cause is still there (SYSREQ-015, ADR-014).
func (e *Engine) seed() {
	for i := 0; i < len(e.rules); i++ {
		r := &e.rules[i]
		r.active = r.incident != nil
		r.prev = false
		r.seen = false
		if r.needsBuffer {
			r.buf = make([]byte, bufferSize)
		}
	}
}

// RuleCount is the number of rules the engine holds.
func (e *Engine) RuleCount() int { return len(e.rules) }

// Stats are the counters since NewEngine. The service logs them; the engine
// never does.
func (e *Engine) Stats() Stats { return e.stats }

// Eval reads the slots, evaluates every rule whose inputs changed and every
// rule that depends on time, and returns what fired. The returned slices and
// the strings inside them are valid until the next Eval or Reset call.
func (e *Engine) Eval(values []any, now time.Time) ([]Action, []Incident) {
	if len(values) == 0 {
		return nil, nil
	}
	e.actions = e.actions[:0]
	e.incidents = e.incidents[:0]
	e.due = e.due[:0]
	e.stats.Evals++
	if !e.lastNow.IsZero() && now.Before(e.lastNow) {
		e.stats.ClockStepsBack++
	}
	e.lastNow = now

	e.detect(values, now)
	e.markTimeRules()
	e.env.Slots = values
	e.env.Now = now
	for i := 0; i < len(e.due); i++ {
		e.evalRule(&e.rules[e.due[i]], now)
	}
	e.finish(values)
	return e.actions, e.incidents
}

// detect advances the history and marks the rules whose inputs moved.
func (e *Engine) detect(values []any, now time.Time) {
	before := e.past.unsupported
	e.past.advance(values, now)
	e.stats.UnknownSlotTypes += e.past.unsupported - before
	for i := 0; i < len(e.past.changed); i++ {
		if e.past.changed[i] {
			e.markRulesOf(i)
		}
	}
}

// markRulesOf marks the rules that read one slot as due.
func (e *Engine) markRulesOf(slot int) {
	if slot < 0 || slot >= len(e.rulesByField) {
		return
	}
	list := e.rulesByField[slot]
	for i := 0; i < len(list); i++ {
		e.mark(list[i])
	}
}

// markTimeRules marks every rule that reads a clock, because it can change
// without any new data.
func (e *Engine) markTimeRules() {
	for i := 0; i < len(e.timeRules); i++ {
		e.mark(e.timeRules[i])
	}
}

// mark adds one rule to the due list, once per evaluation. The list stays in
// rule order, which is the order of the file (ADR-016).
func (e *Engine) mark(ri int) {
	if e.dueSet[ri] {
		return
	}
	e.dueSet[ri] = true
	e.due = insertOrdered(e.due, ri)
}

// insertOrdered keeps the due list sorted by rule index. The list is short:
// the rules that share one slot, plus the rules that watch the clock.
func insertOrdered(list []int, v int) []int {
	list = append(list, v)
	for i := len(list) - 1; i > 0 && list[i-1] > list[i]; i-- {
		list[i-1], list[i] = list[i], list[i-1]
	}
	return list
}

// finish records the values of this evaluation and clears the due marks.
func (e *Engine) finish(values []any) {
	e.past.keep(values)
	for i := 0; i < len(e.due); i++ {
		e.dueSet[e.due[i]] = false
	}
}

// Reset clears the edge state of every rule and resolves the incidents that
// are open, so a reconnect does not leave a stale alarm. It keeps the
// cooldown timers, and it forgets the history of the time windows, because
// the engine cannot know what happened while it was not reading.
func (e *Engine) Reset(now time.Time) []Incident {
	e.incidents = e.incidents[:0]
	for i := 0; i < len(e.rules); i++ {
		r := &e.rules[i]
		if r.incident != nil && r.active {
			e.emitIncident(r, false)
		}
		r.active = false
		r.prev = false
		r.seen = false
	}
	e.past.reset()
	for i := 0; i < len(e.env.States); i++ {
		e.env.States[i] = formula.Unknown
	}
	e.lastNow = now
	return e.incidents
}

// countStates, countActions, countIncidents and stackDepth size the buffers
// once, at startup.
func countStates(rules []Rule) int {
	total := 0
	for i := 0; i < len(rules); i++ {
		for _, row := range rules[i].rows {
			if row.prog != nil {
				total += len(row.prog.States())
			}
		}
	}
	return total
}

func countActions(rules []Rule) int {
	total := 0
	for i := 0; i < len(rules); i++ {
		total += len(rules[i].actions)
	}
	if total > maxPerEval {
		total = maxPerEval
	}
	return total
}

func countIncidents(rules []Rule) int {
	total := 0
	for i := 0; i < len(rules); i++ {
		if rules[i].incident != nil {
			total++
		}
	}
	return total
}

func stackDepth(rules []Rule) int {
	max := 1
	for i := 0; i < len(rules); i++ {
		for _, row := range rules[i].rows {
			if row.prog != nil && row.prog.StackDepth() > max {
				max = row.prog.StackDepth()
			}
		}
		for _, a := range rules[i].actions {
			max = maxOf(max, thenDepth(a.topic), thenDepth(a.payload))
		}
		if inc := rules[i].incident; inc != nil {
			max = maxOf(max, thenDepth(inc.source), thenDepth(inc.summary))
			max = maxOf(max, thenDepth(inc.firstStep), thenDepth(inc.cause))
		}
	}
	return max
}

func thenDepth(f thenField) int {
	if f.prog == nil {
		return 0
	}
	return f.prog.StackDepth()
}

func maxOf(values ...int) int {
	max := 0
	for i := 0; i < len(values); i++ {
		if values[i] > max {
			max = values[i]
		}
	}
	return max
}

// windowSpecs collects the windows of every program, by the index the loader
// gave them. Two rules that ask for the same slot and the same duration share
// one index and one ring.
func windowSpecs(rules []Rule) []formula.WindowSpec {
	var specs []formula.WindowSpec
	eachProgram(rules, func(p *formula.Program) { specs = mergeSpecs(specs, p) })
	return specs
}

// ewmaSpecs collects the smoothed values every rule reads, at their indexes.
func ewmaSpecs(rules []Rule) []formula.EwmaSpec {
	var specs []formula.EwmaSpec
	eachProgram(rules, func(p *formula.Program) {
		if p == nil {
			return
		}
		indexes := p.Ewmas()
		described := p.EwmaSpecs()
		for i := 0; i < len(indexes) && i < len(described); i++ {
			for len(specs) <= indexes[i] {
				specs = append(specs, formula.EwmaSpec{})
			}
			specs[indexes[i]] = described[i]
		}
	})
	return specs
}

// eachProgram visits every compiled formula of every rule.
func eachProgram(rules []Rule, visit func(*formula.Program)) {
	for i := 0; i < len(rules); i++ {
		for _, row := range rules[i].rows {
			visit(row.prog)
		}
		for _, a := range rules[i].actions {
			visit(a.topic.prog)
			visit(a.payload.prog)
		}
		if inc := rules[i].incident; inc != nil {
			visit(inc.source.prog)
			visit(inc.summary.prog)
			visit(inc.firstStep.prog)
			visit(inc.cause.prog)
		}
	}
}

// mergeSpecs places the windows of one program at their own indexes.
func mergeSpecs(specs []formula.WindowSpec, p *formula.Program) []formula.WindowSpec {
	if p == nil {
		return specs
	}
	indexes := p.Windows()
	described := p.WindowSpecs()
	for i := 0; i < len(indexes) && i < len(described); i++ {
		for len(specs) <= indexes[i] {
			specs = append(specs, formula.WindowSpec{})
		}
		specs[indexes[i]] = described[i]
	}
	return specs
}
