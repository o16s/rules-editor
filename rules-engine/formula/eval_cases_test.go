package formula

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// evalCasesFile is read by this suite and by src/simulate.test.ts. The editor
// simulates a rule in TypeScript and the gateway runs it in Go, so an
// operator sees two answers unless both implementations satisfy every case
// here.
const evalCasesFile = "../../schema/eval-cases.json"

type evalStep struct {
	Values map[string]any `json:"values"`
	Want   any            `json:"want"`
}

type evalCase struct {
	Name        string            `json:"name"`
	Formula     string            `json:"formula"`
	Types       map[string]string `json:"types"`
	StepSeconds float64           `json:"step_seconds"`
	Steps       []evalStep        `json:"steps"`
}

// caseResolver binds the tags of one case, in the order the case names them.
type caseResolver struct {
	tags    []string
	types   []Type
	windows []WindowSpec
	states  int
}

func (r *caseResolver) Slot(device, tag string) (int, Type, bool) {
	if device != "" {
		return 0, TypeAny, false
	}
	for i := 0; i < len(r.tags); i++ {
		if r.tags[i] == tag {
			return i, r.types[i], true
		}
	}
	return 0, TypeAny, false
}

func (r *caseResolver) Window(slot int, window time.Duration) (int, bool) {
	for i := 0; i < len(r.windows); i++ {
		if r.windows[i].Slot == slot && r.windows[i].Window == window {
			return i, true
		}
	}
	r.windows = append(r.windows, WindowSpec{Slot: slot, Window: window})
	return len(r.windows) - 1, true
}

func (r *caseResolver) ChangedState() (int, bool) {
	r.states++
	return r.states - 1, true
}

// typeOf maps the type name of a case to a Type.
func typeOf(name string) Type {
	switch name {
	case "boolean":
		return TypeBool
	case "integer", "number":
		return TypeNumber
	case "string":
		return TypeString
	}
	return TypeAny
}

// resolverFor builds the resolver of one case, with the tags in a stable
// order so a slot index means the same thing on every step.
func resolverFor(c evalCase) (*caseResolver, []string) {
	names := make([]string, 0, len(c.Types))
	for name := range c.Types {
		names = append(names, name)
	}
	// A stable order: the tests must not depend on map iteration.
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && names[j] < names[j-1]; j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
	r := &caseResolver{}
	for _, name := range names {
		r.tags = append(r.tags, name)
		r.types = append(r.types, typeOf(c.Types[name]))
	}
	return r, names
}

// asValue reads one expected result from the case file.
func asValue(want any) Value {
	switch v := want.(type) {
	case nil:
		return Unknown
	case bool:
		return BoolValue(v)
	case float64:
		return NumberValue(v)
	case string:
		return StringValue(v)
	}
	return Unknown
}

// sameResult compares a result with the expectation. A number matches an
// integer of the same value, because the case file has one number type.
func sameResult(got Value, want any) bool {
	w := asValue(want)
	if got.Kind == VInt && w.Kind == VNumber {
		return float64(got.I) == w.F
	}
	if got.Kind == VUnknown && w.Kind == VUnknown {
		return true
	}
	return got.Equal(w)
}

func TestEvalAgreesWithTheSimulator(t *testing.T) {
	raw, err := os.ReadFile(evalCasesFile)
	if err != nil {
		t.Fatalf("read %s: %v", evalCasesFile, err)
	}
	var cases []evalCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("parse %s: %v", evalCasesFile, err)
	}
	if len(cases) < 30 {
		t.Fatalf("found %d cases, want the whole set", len(cases))
	}

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			runEvalCase(t, c)
		})
	}
}

// runEvalCase compiles one case and walks its steps on a clock.
func runEvalCase(t *testing.T, c evalCase) {
	t.Helper()
	r, names := resolverFor(c)
	prog, problems := Compile(MustParse(c.Formula), nil, r, false)
	if len(problems) != 0 {
		t.Fatalf("Compile(%q): %v", c.Formula, problems)
	}

	step := time.Duration(c.StepSeconds * float64(time.Second))
	if step <= 0 {
		step = time.Second
	}
	e := &Env{
		Slots:      make([]any, len(names)),
		Now:        time.Unix(1_700_000_000, 0),
		LastChange: make([]time.Time, len(names)),
		States:     make([]Value, r.states),
		Stack:      make([]Value, prog.StackDepth()),
	}
	for i := 0; i < len(r.windows); i++ {
		e.Windows = append(e.Windows, NewWindow(r.windows[i].Slot, r.windows[i].Window, step))
	}
	previous := make([]any, len(names))

	for si := 0; si < len(c.Steps); si++ {
		applyStep(e, previous, names, c.Steps[si].Values)
		got := prog.Eval(e)
		if !sameResult(got, c.Steps[si].Want) {
			t.Errorf("step %d: = %+v, want %v", si+1, got, c.Steps[si].Want)
		}
		e.Now = e.Now.Add(step)
	}
}

// applyStep writes the values of one step, records what changed, and feeds
// the windows, which is what the engine does before it evaluates.
func applyStep(e *Env, previous []any, names []string, values map[string]any) {
	for i := 0; i < len(e.Windows); i++ {
		e.Windows[i].Advance(e.Now)
	}
	for i := 0; i < len(names); i++ {
		value, given := values[names[i]]
		if !given {
			continue
		}
		e.Slots[i] = value
		if EqualAny(value, previous[i]) {
			continue
		}
		previous[i] = value
		e.LastChange[i] = e.Now
		v := FromAny(value)
		if !v.IsNumeric() {
			continue
		}
		for w := 0; w < len(e.Windows); w++ {
			if e.Windows[w].Slot() == i {
				e.Windows[w].Add(e.Now, v.Float())
			}
		}
	}
}
