package formula

import (
	"testing"
	"time"
)

// testResolver is a catalog for the tests: named fields with a type, plus the
// window and state allocation the compiler asks for.
type testResolver struct {
	fields  []TagRef
	types   []Type
	windows []WindowSpec
	states  int
	maxWin  int
	maxStat int
}

func newResolver(pairs ...any) *testResolver {
	r := &testResolver{maxWin: 8, maxStat: 8}
	for i := 0; i+1 < len(pairs); i += 2 {
		name := pairs[i].(string)
		device := ""
		tag := name
		for j := 0; j < len(name); j++ {
			if name[j] == '.' {
				device, tag = name[:j], name[j+1:]
				break
			}
		}
		r.fields = append(r.fields, TagRef{Device: device, Tag: tag})
		r.types = append(r.types, pairs[i+1].(Type))
	}
	return r
}

func (r *testResolver) Slot(device, tag string) (int, Type, bool) {
	for i := 0; i < len(r.fields); i++ {
		if r.fields[i].Device == device && r.fields[i].Tag == tag {
			return i, r.types[i], true
		}
	}
	return 0, TypeAny, false
}

func (r *testResolver) Window(slot int, window time.Duration) (int, bool) {
	for i := 0; i < len(r.windows); i++ {
		if r.windows[i].Slot == slot && r.windows[i].Window == window {
			return i, true
		}
	}
	if len(r.windows) >= r.maxWin {
		return 0, false
	}
	r.windows = append(r.windows, WindowSpec{Slot: slot, Window: window})
	return len(r.windows) - 1, true
}

func (r *testResolver) ChangedState() (int, bool) {
	if r.states >= r.maxStat {
		return 0, false
	}
	r.states++
	return r.states - 1, true
}

// env builds a runtime for a program over the given slot values.
func env(t *testing.T, p *Program, r *testResolver, slots ...any) *Env {
	t.Helper()
	e := &Env{
		Slots:      slots,
		Now:        time.Unix(1_700_000_000, 0),
		LastChange: make([]time.Time, len(slots)),
		States:     make([]Value, r.states),
		Stack:      make([]Value, p.StackDepth()),
	}
	for i := range e.LastChange {
		e.LastChange[i] = e.Now
	}
	for i := 0; i < len(r.windows); i++ {
		e.Windows = append(e.Windows, NewWindow(r.windows[i].Slot, r.windows[i].Window, time.Second))
	}
	return e
}

// compile builds a program or fails the test.
func compile(t *testing.T, text string, r *testResolver) *Program {
	t.Helper()
	p, problems := Compile(MustParse(text), nil, r, false)
	if len(problems) != 0 {
		t.Fatalf("Compile(%q): %v", text, problems)
	}
	return p
}

func TestEvalOperators(t *testing.T) {
	r := newResolver("n", TypeNumber, "i", TypeNumber, "s", TypeString, "b", TypeBool, "u", TypeNumber)
	cases := []struct {
		text string
		want Value
	}{
		// arithmetic
		{"1 + 2", NumberValue(3)}, {"5 - 2", NumberValue(3)}, {"3 * 4", NumberValue(12)},
		{"9 / 2", NumberValue(4.5)}, {"1 / 0", Unknown}, {"-3", NumberValue(-3)},
		{`TAG("n") + 1`, NumberValue(3.5)},
		// comparison
		{`TAG("n") > 2`, BoolValue(true)}, {`TAG("n") < 2`, BoolValue(false)},
		{`TAG("n") >= 2.5`, BoolValue(true)}, {`TAG("n") <= 2`, BoolValue(false)},
		{`TAG("n") = 2.5`, BoolValue(true)}, {`TAG("n") != 2.5`, BoolValue(false)},
		// strings
		{`TAG("s") = "open"`, BoolValue(true)}, {`TAG("s") != "shut"`, BoolValue(true)},
		{`TAG("s") < "z"`, BoolValue(true)},
		{`"a" & "b"`, StringValue("ab")},
		{`TAG("s") & "!"`, StringValue("open!")},
		{`"n=" & TAG("n")`, StringValue("n=2.5")},
		// booleans
		{`TAG("b") = true`, BoolValue(true)}, {`NOT(TAG("b"))`, BoolValue(false)},
		{`AND(TAG("b"), TAG("n") > 1)`, BoolValue(true)},
		{`AND(TAG("b"), TAG("n") > 9)`, BoolValue(false)},
		{`OR(TAG("n") > 9, TAG("b"))`, BoolValue(true)},
		{`OR(TAG("n") > 9, TAG("n") > 8)`, BoolValue(false)},
		// the coercion of ADR-015: a boolean compared with 1 or 0
		{`TAG("b") = 1`, BoolValue(true)}, {`TAG("b") = 0`, BoolValue(false)},
		{`TAG("b") != 0`, BoolValue(true)},
		// A boolean is not the number 2, which is an answer, not a missing one.
		{`TAG("b") = 2`, BoolValue(false)}, {`TAG("b") != 2`, BoolValue(true)},
		// a string compared with a number reads the text
		{`TAG("s") = 1`, BoolValue(false)},
		// bitwise
		{`BITAND(TAG("i"), 4)`, IntValue(4)}, {`BITOR(TAG("i"), 1)`, IntValue(13)},
		{`BITXOR(TAG("i"), 12)`, IntValue(0)}, {`BITAND(TAG("i"), 4) != 0`, BoolValue(true)},
		{`HEX2DEC("FF")`, IntValue(255)}, {`HEX2DEC("10")`, IntValue(16)},
		{`BITAND(TAG("i"), HEX2DEC("FF"))`, IntValue(12)},
		{`HEX2DEC("zz")`, Unknown}, {`BITAND(TAG("n"), 1)`, Unknown},
		// unknown values
		{`TAG("u") > 1`, Unknown}, {`TAG("u") = 1`, Unknown},
		{`NOT(TAG("u") > 1)`, Unknown},
		{`AND(TAG("u") > 1, TAG("n") > 9)`, BoolValue(false)},
		{`AND(TAG("u") > 1, TAG("n") > 1)`, Unknown},
		{`OR(TAG("u") > 1, TAG("n") > 1)`, BoolValue(true)},
		{`OR(TAG("u") > 1, TAG("n") > 9)`, Unknown},
		{`"x" & TAG("u")`, StringValue("x")},
	}
	for _, c := range cases {
		t.Run(c.text, func(t *testing.T) {
			p := compile(t, c.text, r)
			got := p.Eval(env(t, p, r, 2.5, uint16(12), "open", true, nil))
			if !got.Equal(c.want) {
				t.Errorf("= %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestEvalShortCircuitsAndSkipsSideEffects(t *testing.T) {
	r := newResolver("a", TypeBool, "b", TypeNumber)
	p := compile(t, `AND(TAG("a"), CHANGED(TAG("b")))`, r)
	e := env(t, p, r, false, 1.0)
	if got := p.Eval(e); !got.Equal(BoolValue(false)) {
		t.Fatalf("= %+v, want false", got)
	}
	// The first argument was false, so CHANGED never ran and kept no value.
	if e.States[0].Kind != VUnknown {
		t.Errorf("CHANGED ran although the AND was already false: %+v", e.States[0])
	}
}

func TestEvalChangedUsesTheLastKnownValue(t *testing.T) {
	r := newResolver("x", TypeNumber)
	p := compile(t, `CHANGED(TAG("x"))`, r)
	e := env(t, p, r, 1.0)

	// The first known value is not a change (ADR-018).
	if got := p.Eval(e); got.Truth() {
		t.Error("the first value must not be a change")
	}
	if got := p.Eval(e); got.Truth() {
		t.Error("the same value is not a change")
	}
	e.Slots[0] = 2.0
	if got := p.Eval(e); !got.Truth() {
		t.Error("a new value is a change")
	}
	// Going unknown is not a change, and it does not forget the last value.
	e.Slots[0] = nil
	if got := p.Eval(e); got.Truth() {
		t.Error("an unknown value must not be a change")
	}
	e.Slots[0] = 2.0
	if got := p.Eval(e); got.Truth() {
		t.Error("the same value after an outage is not a change")
	}
	e.Slots[0] = 3.0
	if got := p.Eval(e); !got.Truth() {
		t.Error("a different value after an outage is a change")
	}
}

func TestEvalStale(t *testing.T) {
	r := newResolver("x", TypeNumber)
	p := compile(t, `STALE(TAG("x"), 10min)`, r)
	e := env(t, p, r, 1.0)
	if got := p.Eval(e); got.Truth() {
		t.Error("a value that just changed is not stale")
	}
	e.Now = e.Now.Add(9 * time.Minute)
	if got := p.Eval(e); got.Truth() {
		t.Error("9 minutes is not yet stale")
	}
	e.Now = e.Now.Add(time.Minute)
	if got := p.Eval(e); !got.Truth() {
		t.Error("10 minutes is stale")
	}
	// An unknown value is stale at once.
	e.Slots[0] = nil
	e.Now = e.Now.Add(-10 * time.Minute)
	e.LastChange[0] = e.Now
	if got := p.Eval(e); !got.Truth() {
		t.Error("an unknown value is stale")
	}
}

func TestEvalConstantFolding(t *testing.T) {
	r := newResolver("x", TypeNumber)
	// Everything below is constant, so the program is one push.
	for _, text := range []string{`HEX2DEC("FF")`, "BITAND(12, 4)", "1 + 2 * 3", "NOT(false)", "AND(true, true)"} {
		p := compile(t, text, r)
		if p.Len() != 1 {
			t.Errorf("%s compiles to %d instructions, want 1 (folded)", text, p.Len())
		}
	}
	// A field is never constant.
	if p := compile(t, `BITAND(TAG("x"), 4)`, r); p.Len() < 3 {
		t.Errorf("a field must not fold: %d instructions", p.Len())
	}
}

func TestEvalAllocatesNothing(t *testing.T) {
	r := newResolver("a", TypeBool, "t", TypeNumber, "c", TypeNumber)
	p := compile(t, `OR(TAG("a"), AND(TAG("t") > 50, CHANGED(TAG("c"))), BITAND(TAG("c"), 4) != 0)`, r)
	e := env(t, p, r, false, 60.0, uint16(5))
	if n := testing.AllocsPerRun(100, func() { p.Eval(e) }); n != 0 {
		t.Errorf("Eval allocates %v times per run, want 0", n)
	}
}

func TestEvalStaleWithoutADurationUsesTheDefault(t *testing.T) {
	// STALE(x) names no duration, so it uses the one its signature shows.
	// A zero window would make it true at once, on every field.
	r := newResolver("x", TypeNumber)
	p := compile(t, `STALE(TAG("x"))`, r)
	e := env(t, p, r, 1.0)
	if got := p.Eval(e); got.Truth() {
		t.Error("a value that just changed is not stale")
	}
	e.Now = e.Now.Add(DefaultStaleWindow - time.Minute)
	if got := p.Eval(e); got.Truth() {
		t.Error("just inside the default window is not stale")
	}
	e.Now = e.Now.Add(time.Minute)
	if got := p.Eval(e); !got.Truth() {
		t.Errorf("the default window is %v, and it has passed", DefaultStaleWindow)
	}
}

func TestEvalRateWithoutHistoryIsUnknown(t *testing.T) {
	r := newResolver("x", TypeNumber)
	p := compile(t, `RATE(TAG("x"), 30min)`, r)
	e := env(t, p, r, 1.0)
	if got := p.Eval(e); got.Kind != VUnknown {
		t.Errorf("= %+v, want unknown before the window holds two samples", got)
	}
	// And a condition over it is false, not true.
	cond := compile(t, `RATE(TAG("x"), 30min) < 5`, r)
	ec := env(t, cond, r, 1.0)
	if got := cond.Eval(ec); got.Truth() {
		t.Error("a threshold must not fire on a window that knows nothing")
	}
}
