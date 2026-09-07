package rules

import (
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// SimResolver compiles and evaluates single formulas against a catalog, with
// the history the engine keeps. The editor's Simulator page uses it to draw
// one line per variable and one per condition row, beside an Engine that
// decides what the rule fires.
//
// It exists so the editor runs the engine's own code rather than a second
// reading of it. It adds no behavior: it only makes one formula at a time
// visible, which a rule file cannot ask for.
//
// It is not safe for concurrent use, and it is not part of the path a gateway
// runs.
type SimResolver struct {
	b     *binder
	past  history
	cat   Catalog
	stack []formula.Value
	built bool
}

// NewSimResolver indexes a catalog. It reports the same problems Load reports
// for a catalog that names one field twice.
func NewSimResolver(cat Catalog) (*SimResolver, []Problem) {
	b, problems := newBinder(cat)
	if len(problems) > 0 {
		return nil, problems
	}
	return &SimResolver{b: b, cat: cat}, nil
}

// Slot resolves a field, for formula.Resolver.
func (s *SimResolver) Slot(device, tag string) (int, formula.Type, bool) {
	return s.b.Slot(device, tag)
}

// Window reserves a ring, for formula.Resolver.
func (s *SimResolver) Window(slot int, window time.Duration) (int, bool) {
	return s.b.Window(slot, window)
}

// EWMAState reserves a smoothed value, for formula.Resolver.
func (s *SimResolver) EWMAState(slot int, tau time.Duration) (int, bool) {
	return s.b.EWMAState(slot, tau)
}

// ChangedState reserves one memory, for formula.Resolver.
func (s *SimResolver) ChangedState() (int, bool) { return s.b.ChangedState() }

// Env builds the environment the compiled formulas run in. Call it after
// every formula is compiled, because compiling is what reserves the rings and
// the memories it holds.
func (s *SimResolver) Env() formula.Env {
	s.past.build(s.cat, s.b.windows, s.b.ewmas)
	s.built = true
	return formula.Env{
		LastChange: s.past.lastChange,
		Windows:    s.past.windows,
		Ewmas:      s.past.ewmas,
		States:     make([]formula.Value, s.b.states),
	}
}

// Advance records one evaluation: the readings, the moment, and the history
// they add to. It is the same code the engine runs.
func (s *SimResolver) Advance(env *formula.Env, values []any, now time.Time) {
	if env == nil || !s.built {
		return
	}
	s.past.advance(values, now)
	s.past.keep(values)
	env.Slots = values
	env.Now = now
}

// Stack returns a value stack deep enough for one program, reused between
// calls so a run of a thousand steps allocates once.
func (s *SimResolver) Stack(p *formula.Program) []formula.Value {
	if p == nil {
		return s.stack
	}
	if need := p.StackDepth(); need > len(s.stack) {
		s.stack = make([]formula.Value, need)
	}
	return s.stack
}
