package formula

import (
	"testing"
	"time"
)

// The value functions run through the whole pipeline: parse, compile,
// evaluate. They carry state between evaluations, so each test drives a
// sequence rather than one call.

// runner holds one program and the environment it runs in, so a test can step
// a sequence of readings through it.
type runner struct {
	p   *Program
	env *Env
	now time.Time
}

func newRunner(t *testing.T, text string, r *testResolver, slots int) *runner {
	t.Helper()
	p := compile(t, text, r)
	now := time.Unix(1_700_000_000, 0)
	env := &Env{
		Slots:      make([]any, slots),
		Now:        now,
		LastChange: make([]time.Time, slots),
		States:     make([]Value, r.states),
		Stack:      make([]Value, p.StackDepth()),
	}
	for i := 0; i < len(r.windows); i++ {
		env.Windows = append(env.Windows, NewWindow(r.windows[i].Slot, r.windows[i].Window, time.Second))
	}
	for i := 0; i < len(r.ewmas); i++ {
		env.Ewmas = append(env.Ewmas, NewEwma(r.ewmas[i].Slot, r.ewmas[i].Tau))
	}
	return &runner{p: p, env: env, now: now}
}

// step advances the clock by one second, writes the slots, feeds the windows
// and the smoothed values the way the engine does, and evaluates.
func (rn *runner) step(values ...any) Value {
	rn.now = rn.now.Add(time.Second)
	rn.env.Now = rn.now
	for i := 0; i < len(values) && i < len(rn.env.Slots); i++ {
		changed := !EqualAny(values[i], rn.env.Slots[i])
		rn.env.Slots[i] = values[i]
		if changed {
			rn.env.LastChange[i] = rn.now
		}
		v := FromAny(values[i])
		if !v.IsNumeric() {
			continue
		}
		for _, w := range rn.env.Windows {
			if w.Slot() == i {
				w.Advance(rn.now)
				w.Add(rn.now, v.Float())
			}
		}
		for _, e := range rn.env.Ewmas {
			if e.Slot() == i {
				e.Add(rn.now, v.Float())
			}
		}
	}
	return rn.p.Eval(rn.env)
}

func TestPrevReadsTheValueBeforeTheLastChange(t *testing.T) {
	r := newResolver("code", TypeNumber)
	rn := newRunner(t, `PREV(TAG("code"))`, r, 1)

	// Nothing has changed yet, so there is no earlier value.
	if got := rn.step(1.0); got.Kind != VUnknown {
		t.Errorf("the first reading has no predecessor: %v", got)
	}
	// A change makes the old value readable, and it holds while nothing moves.
	if got := rn.step(2.0); got.Kind != VNumber || got.Float() != 1 {
		t.Errorf("after 1 to 2, PREV = %v, want 1", got)
	}
	if got := rn.step(2.0); got.Kind != VNumber || got.Float() != 1 {
		t.Errorf("PREV must hold while the value does not move: %v", got)
	}
	if got := rn.step(5.0); got.Kind != VNumber || got.Float() != 2 {
		t.Errorf("after 2 to 5, PREV = %v, want 2", got)
	}
	// A value the service cannot read is not a change, so PREV keeps its answer.
	if got := rn.step(nil); got.Kind != VNumber || got.Float() != 2 {
		t.Errorf("an unknown reading must not move PREV: %v", got)
	}
}

// The pairing PREV was added for: which value a field came from.
func TestPrevPairsWithChanged(t *testing.T) {
	r := newResolver("state", TypeNumber)
	rn := newRunner(t, `AND(CHANGED(TAG("state")), PREV(TAG("state")) = 0)`, r, 1)

	rn.step(0.0)
	if got := rn.step(3.0); got.Kind != VBool || !got.B {
		t.Errorf("0 to 3 must match: %v", got)
	}
	if got := rn.step(4.0); got.Kind != VBool || got.B {
		t.Errorf("3 to 4 must not match: %v", got)
	}
}

func TestSinceCountsTheSecondsSinceTheLastChange(t *testing.T) {
	r := newResolver("beat", TypeNumber)
	rn := newRunner(t, `SINCE(TAG("beat"))`, r, 1)

	if got := rn.step(1.0); got.Kind != VNumber || got.Float() != 0 {
		t.Errorf("a value that just changed is 0 seconds old: %v", got)
	}
	rn.step(1.0)
	rn.step(1.0)
	if got := rn.step(1.0); got.Kind != VNumber || got.Float() != 3 {
		t.Errorf("three quiet seconds: %v, want 3", got)
	}
	if got := rn.step(2.0); got.Kind != VNumber || got.Float() != 0 {
		t.Errorf("a new value resets it: %v", got)
	}
}

func TestSinceIsUnknownBeforeAnyReading(t *testing.T) {
	r := newResolver("beat", TypeNumber)
	p := compile(t, `SINCE(TAG("beat"))`, r)
	env := &Env{
		Slots:      []any{nil},
		Now:        time.Unix(1_700_000_000, 0),
		LastChange: make([]time.Time, 1),
		States:     make([]Value, r.states),
		Stack:      make([]Value, p.StackDepth()),
	}
	if got := p.Eval(env); got.Kind != VUnknown {
		t.Errorf("with no moment to measure from, SINCE = %v, want unknown", got)
	}
}

func TestEwmaThroughTheProgram(t *testing.T) {
	r := newResolver("t", TypeNumber)
	rn := newRunner(t, `EWMA(TAG("t"), 10s)`, r, 1)

	if got := rn.step(100.0); got.Kind != VNumber || got.Float() != 100 {
		t.Errorf("the first reading is the average: %v", got)
	}
	// One time constant covers about 63 percent of a step, so three cover
	// about 95 percent and six cover more than 99.
	for i := 0; i < 29; i++ {
		rn.step(0.0)
	}
	if got := rn.step(0.0); got.Kind != VNumber || got.Float() < 4 || got.Float() > 6 {
		t.Errorf("after three time constants the average is %v, want about 5", got)
	}
	for i := 0; i < 30; i++ {
		rn.step(0.0)
	}
	if got := rn.step(0.0); got.Kind != VNumber || got.Float() > 0.5 {
		t.Errorf("after six time constants the average is %v, want close to zero", got)
	}
}

func TestWindowFunctionsThroughTheProgram(t *testing.T) {
	r := newResolver("t", TypeNumber)
	for _, tc := range []struct {
		text string
		want float64
	}{
		{`MIN(TAG("t"), 10s)`, 1},
		{`MAX(TAG("t"), 10s)`, 5},
		{`COUNT(TAG("t"), 10s)`, 5},
		{`DELTA(TAG("t"), 10s)`, 2},
		{`AVG(TAG("t"), 10s)`, 3.6},
	} {
		rn := newRunner(t, tc.text, r, 1)
		var out Value
		for _, v := range []float64{3, 1, 5, 4, 5} {
			out = rn.step(v)
		}
		if out.Kind != VNumber || out.Float() != tc.want {
			t.Errorf("%s = %v, want %v", tc.text, out, tc.want)
		}
	}
}

// A window function on a field that carries no number answers unknown, and a
// condition over it is false rather than a guess.
func TestWindowFunctionsOnAnEmptyFieldAreUnknown(t *testing.T) {
	r := newResolver("t", TypeNumber)
	for _, text := range []string{
		`MIN(TAG("t"), 10s)`, `MAX(TAG("t"), 10s)`, `DELTA(TAG("t"), 10s)`,
		`STDDEV(TAG("t"), 10s)`, `ZSCORE(TAG("t"), 10s)`, `SLOPE(TAG("t"), 10s)`,
		`FORECAST(TAG("t"), 10s, 1h)`,
	} {
		rn := newRunner(t, text, r, 1)
		if got := rn.step(nil); got.Kind != VUnknown {
			t.Errorf("%s with no reading = %v, want unknown", text, got)
		}
	}
}
