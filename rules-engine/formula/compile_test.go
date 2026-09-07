package formula

import (
	"strings"
	"testing"
	"time"
)

// compileWith compiles a formula with variables and returns its problems.
func compileWith(t *testing.T, text string, vars map[string]string, r *testResolver, allowContext bool) (*Program, []string) {
	t.Helper()
	parsed := make(map[string]*Node, len(vars))
	for name, formula := range vars {
		parsed[name] = MustParse(formula)
	}
	return Compile(MustParse(text), parsed, r, allowContext)
}

func TestCompileReportsWhatTheEditorReports(t *testing.T) {
	r := newResolver("temp", TypeNumber, "vibration1.temperature", TypeNumber, "b", TypeBool)
	cases := []struct {
		name string
		text string
		vars map[string]string
		want string
	}{
		{"unknown function", "NOPE(1)", nil, "Unknown function NOPE()."},
		{"wrong arity", "NOT(1, 2)", nil, "NOT() takes 1 argument, got 2"},
		{"unknown variable", "hot", nil, `"hot" is not a variable of this rule.`},
		{"unknown tag", `TAG("nope")`, nil, `unknown tag "nope"`},
		{"unknown device", `TAG("nope", "temperature")`, nil, `unknown tag "temperature" of device "nope"`},
		{"tag from an expression", `TAG(x)`, map[string]string{"x": `"temp"`}, "TAG() needs the names of a device and a tag as text"},
		{"context in a condition", "condition.description", nil, "condition.description can only be used in a Then field."},
		{"unknown context name", "condition.nope", nil, `"condition.nope" is not a known name`},
		{"self reference", "a", map[string]string{"a": "a"}, `"a" refers to itself through a → a.`},
		{"reference cycle", "a", map[string]string{"a": "b", "b": "a"}, "refers to itself through"},
		{"rate of an expression", `RATE(TAG("temp") + 1, 30min)`, nil, "RATE() needs a field, not an expression"},
		{"rate without a duration", `RATE(TAG("temp"), 30)`, nil, "RATE() needs a duration such as 30min or 4h."},
		{"stale of an expression", `STALE(1 + 1, 4h)`, nil, "STALE() needs a field, not an expression"},
		{"zero window", `AVG(TAG("temp"), 0s)`, nil, "AVG() needs a duration greater than zero."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, problems := compileWith(t, c.text, c.vars, r, false)
			if p != nil {
				t.Fatal("a formula with a problem must not compile")
			}
			if len(problems) == 0 {
				t.Fatal("want a problem, got none")
			}
			found := false
			for _, m := range problems {
				if strings.Contains(m, c.want) {
					found = true
				}
			}
			if !found {
				t.Errorf("problems = %v, want one containing %q", problems, c.want)
			}
		})
	}
}

func TestCompileInlinesVariables(t *testing.T) {
	r := newResolver("vibration1.temperature", TypeNumber)
	vars := map[string]string{
		"temp": `TAG("vibration1", "temperature")`,
		"hot":  "temp > 50",
	}
	p, problems := compileWith(t, "hot", vars, r, false)
	if len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	if p.Type != TypeBool {
		t.Errorf("type = %v, want bool", p.Type)
	}
	if len(p.Slots()) != 1 || p.Slots()[0] != 0 {
		t.Errorf("slots = %v, want [0]", p.Slots())
	}
	// A variable used twice reads the same slot once.
	p2, _ := compileWith(t, "AND(hot, temp > 10)", vars, r, false)
	if len(p2.Slots()) != 1 {
		t.Errorf("slots = %v, want one entry", p2.Slots())
	}
}

func TestCompileTypesTheResult(t *testing.T) {
	r := newResolver("n", TypeNumber, "s", TypeString, "b", TypeBool, "any", TypeAny)
	cases := map[string]Type{
		`TAG("n") > 5`:       TypeBool,
		`TAG("b")`:           TypeBool,
		`TAG("n")`:           TypeNumber,
		`TAG("s")`:           TypeString,
		`TAG("any")`:         TypeAny,
		`TAG("n") + 1`:       TypeNumber,
		`TAG("s") & "x"`:     TypeString,
		`CHANGED(TAG("n"))`:  TypeBool,
		`RATE(TAG("n"), 1h)`: TypeNumber,
	}
	for text, want := range cases {
		p, problems := compileWith(t, text, nil, r, false)
		if len(problems) != 0 {
			t.Fatalf("%s: %v", text, problems)
		}
		if p.Type != want {
			t.Errorf("%s: type = %v, want %v", text, p.Type, want)
		}
	}
}

func TestCompileMarksWhatARuleNeeds(t *testing.T) {
	r := newResolver("n", TypeNumber)
	p, _ := compileWith(t, `CHANGED(TAG("n"))`, nil, r, false)
	if !p.HasChanged || p.HasTime {
		t.Errorf("CHANGED: HasChanged=%v HasTime=%v", p.HasChanged, p.HasTime)
	}
	p, _ = compileWith(t, `RATE(TAG("n"), 30min) > 4`, nil, r, false)
	if p.HasChanged || !p.HasTime {
		t.Errorf("RATE: HasChanged=%v HasTime=%v", p.HasChanged, p.HasTime)
	}
	if len(p.Windows()) != 1 {
		t.Errorf("windows = %v, want one", p.Windows())
	}
	p, _ = compileWith(t, `TAG("n") & "x"`, nil, r, true)
	if !p.HasConcat {
		t.Error("a formula with & must say so, because it allocates")
	}
}

func TestCompileSharesOneWindowPerSlotAndDuration(t *testing.T) {
	r := newResolver("n", TypeNumber)
	p, problems := compileWith(t, `RATE(TAG("n"), 30min) + AVG(TAG("n"), 30min) + RATE(TAG("n"), 1h)`, nil, r, false)
	if len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	if len(r.windows) != 2 {
		t.Errorf("the resolver holds %d windows, want 2", len(r.windows))
	}
	if len(p.Windows()) != 2 {
		t.Errorf("the program reads %v, want two windows", p.Windows())
	}
}

func TestCompileRefusesMoreWindowsThanTheEngineHolds(t *testing.T) {
	r := newResolver("a", TypeNumber, "b", TypeNumber)
	r.maxWin = 1
	_, problems := compileWith(t, `RATE(TAG("a"), 1h) + RATE(TAG("b"), 1h)`, nil, r, false)
	if len(problems) == 0 {
		t.Fatal("want a problem when the window cap is reached")
	}
}

func TestCompileAcceptsContextInAThenField(t *testing.T) {
	r := newResolver("n", TypeNumber)
	p, problems := compileWith(t, `condition.description & " on plc1"`, nil, r, true)
	if len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	e := env(t, p, r, 1.0)
	e.Context = "Housing is hot"
	if got := p.Eval(e); got.S != "Housing is hot on plc1" {
		t.Errorf("= %q", got.S)
	}
}

func TestCompileWindowThroughAVariable(t *testing.T) {
	r := newResolver("vibration1.temperature", TypeNumber)
	vars := map[string]string{"temp": `TAG("vibration1", "temperature")`, "w": "30min"}
	p, problems := compileWith(t, "RATE(temp, w) > 4", vars, r, false)
	if len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	if len(r.windows) != 1 || r.windows[0].Window != 30*time.Minute {
		t.Errorf("windows = %+v", r.windows)
	}
	if p.Type != TypeBool {
		t.Errorf("type = %v", p.Type)
	}
}
