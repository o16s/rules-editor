package rules

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const fixturesRoot = "../../schema/fixtures"

// wideCatalog holds every field the fixtures name, so a fixture that the
// editor accepts loads here too.
func wideCatalog() Catalog {
	tags := []struct {
		device, tag string
		typ         Type
	}{
		{"", "a", Unknown}, {"", "b", Number}, {"", "c", Bool},
		{"", "AlarmActive", Bool}, {"", "AlarmCode", Integer}, {"", "Temperature", Number},
		{"", "StatusWord", Integer}, {"", "AlarmFlags", Integer},
		{"vibration1", "temperature", Number}, {"vibration1", "alert_vrms_max", Bool},
		{"vibration1", "alert_acc_peak", Bool},
		{"plc1", "AlarmActive", Bool}, {"plc1", "StatusWord", Integer}, {"plc1", "AlarmFlags", Integer},
		{"bulk1", "milk_temperature", Number}, {"bulk1", "door_state", Integer},
	}
	cat := Catalog{
		Sources:     []string{"plc1", "s", "vibration1", "Cell 3 press"},
		TopicPrefix: "test",
		Period:      time.Second,
	}
	for _, f := range tags {
		cat.Fields = append(cat.Fields, Field{Device: f.device, Tag: f.tag, Type: f.typ})
	}
	return cat
}

// fixtureFiles lists the fixtures of one class.
func fixtureFiles(t *testing.T, class string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(fixturesRoot, class))
	if err != nil {
		t.Fatalf("read %s: %v", class, err)
	}
	var out []string
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".xml" {
			out = append(out, e.Name())
		}
	}
	if len(out) == 0 {
		t.Fatalf("no fixture in %s", class)
	}
	return out
}

// theseNeedAnotherCatalog are valid fixtures whose fields no single catalog
// can hold: they name a thousand rules, or a field on purpose absent.
var theseNeedAnotherCatalog = map[string]string{
	"empty-document-serialize-of-no-rules.xml": "it holds no rule",
}

func TestLoadAcceptsEveryValidFixture(t *testing.T) {
	cat := wideCatalog()
	for _, name := range fixtureFiles(t, "valid") {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(fixturesRoot, "valid", name))
			if err != nil {
				t.Fatal(err)
			}
			rules, problems := Load(data, cat)
			if len(problems) != 0 {
				t.Fatalf("a fixture the editor accepts must load:\n%v", problems)
			}
			if _, skip := theseNeedAnotherCatalog[name]; !skip && len(rules) == 0 {
				t.Error("no rule was built")
			}
		})
	}
}

func TestLoadRejectsEveryInvalidFixture(t *testing.T) {
	cat := wideCatalog()
	for _, class := range []string{"invalid", "app-level", "xsd-stricter"} {
		for _, name := range fixtureFiles(t, class) {
			t.Run(class+"/"+name, func(t *testing.T) {
				data, err := os.ReadFile(filepath.Join(fixturesRoot, class, name))
				if err != nil {
					t.Fatal(err)
				}
				if strings.HasPrefix(name, "description-on-a-folded") {
					t.Skip("both the schema and the editor accept this one; it is listed for its lossy round trip")
				}
				rules, problems := Load(data, cat)
				if len(problems) == 0 {
					t.Fatalf("this fixture must not load, but it built %d rules", len(rules))
				}
			})
		}
	}
}

func TestLoadTheReferenceExamples(t *testing.T) {
	cat := wideCatalog()
	for _, name := range []string{"reference-example-plc.xml", "the-13a-rule.xml"} {
		data, err := os.ReadFile(filepath.Join(fixturesRoot, "valid", name))
		if err != nil {
			t.Fatal(err)
		}
		rules, problems := Load(data, cat)
		if len(problems) != 0 {
			t.Fatalf("%s: %v", name, problems)
		}
		eng := NewEngine(rules, cat)
		if eng.RuleCount() != len(rules) {
			t.Errorf("%s: the engine holds %d of %d rules", name, eng.RuleCount(), len(rules))
		}
	}
}
