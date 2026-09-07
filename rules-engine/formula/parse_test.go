package formula

import (
	"encoding/json"
	"os"
	"testing"
)

// casesFile is read by this suite and by src/formula.test.ts. Neither side
// can change the language alone: a case that one implementation does not
// satisfy fails on the same commit.
const casesFile = "../../schema/formula-cases.json"

type formulaCase struct {
	Text  string `json:"text"`
	Print string `json:"print"`
	Error *struct {
		Column  int    `json:"column"`
		Message string `json:"message"`
	} `json:"error"`
}

// loadCases reads the shared case file.
func loadCases(t *testing.T) []formulaCase {
	t.Helper()
	raw, err := os.ReadFile(casesFile)
	if err != nil {
		t.Fatalf("read %s: %v", casesFile, err)
	}
	var cases []formulaCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("parse %s: %v", casesFile, err)
	}
	if len(cases) < 50 {
		t.Fatalf("found %d cases, want the whole set", len(cases))
	}
	return cases
}

func TestParseAgreesWithTheEditor(t *testing.T) {
	bad := 0
	for _, c := range loadCases(t) {
		t.Run(c.Text, func(t *testing.T) {
			node, err := Parse(c.Text)
			if c.Error != nil {
				if err == nil {
					t.Fatalf("want a fault at column %d, got %q", c.Error.Column, Print(node))
				}
				fe, ok := err.(*Error)
				if !ok {
					t.Fatalf("error type = %T, want *Error", err)
				}
				if fe.Column != c.Error.Column {
					t.Errorf("column = %d, want %d (%s)", fe.Column, c.Error.Column, fe.Message)
				}
				if fe.Message != c.Error.Message {
					t.Errorf("message = %q, want %q", fe.Message, c.Error.Message)
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse: %v", err)
			}
			got := Print(node)
			if got != c.Print {
				t.Fatalf("Print = %q, want %q", got, c.Print)
			}
			// The canonical text must parse back to itself.
			again, err := Parse(got)
			if err != nil {
				t.Fatalf("reparse %q: %v", got, err)
			}
			if second := Print(again); second != got {
				t.Errorf("second print = %q, want %q", second, got)
			}
		})
		if c.Error != nil {
			bad++
		}
	}
	if bad == 0 {
		t.Error("the case file holds no failing formula")
	}
}

func TestParseShapes(t *testing.T) {
	n := MustParse(`TAG("plc1", "AlarmActive")`)
	if n.Kind != KindCall || n.Str != "TAG" || len(n.Args) != 2 {
		t.Fatalf("shape = %+v", n)
	}
	if n.Args[0].Kind != KindString || n.Args[0].Str != "plc1" {
		t.Errorf("first argument = %+v", n.Args[0])
	}
	if d := MustParse("30min"); d.Kind != KindDuration || d.Num != 1800 || d.Raw != "30min" {
		t.Errorf("duration = %+v", d)
	}
	if b := MustParse("TRUE"); b.Kind != KindBool || !b.Bool {
		t.Errorf("bool = %+v", b)
	}
	if s := MustParse(`"say ""hi"""`); s.Kind != KindString || s.Str != `say "hi"` {
		t.Errorf("string = %+v", s)
	}
	if c := MustParse("condition.description"); c.Kind != KindContext || c.Str != "condition.description" {
		t.Errorf("context = %+v", c)
	}
	// Precedence: & binds loosest, then comparison, then + -, then * /.
	if e := MustParse("x & y = z"); e.Str != "&" || e.Args[1].Str != "=" {
		t.Errorf("precedence = %s", Print(e))
	}
	// The parser does not know the registry.
	if u := MustParse("NOPE(1, 2, 3)"); u.Kind != KindCall || u.Str != "NOPE" {
		t.Errorf("unknown function = %+v", u)
	}
}

func TestParseRejectsADeepFormula(t *testing.T) {
	deep := ""
	for i := 0; i < maxDepth+2; i++ {
		deep += "("
	}
	deep += "1"
	if _, err := Parse(deep); err == nil {
		t.Fatal("want a fault on a formula deeper than the limit")
	}
}
