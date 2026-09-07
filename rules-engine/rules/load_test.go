package rules

import (
	"strings"
	"testing"
	"time"
)

// testCatalog is the catalog most tests bind against: two devices with a few
// fields each, and one field without a device for the single-source case.
func testCatalog() Catalog {
	return Catalog{
		Fields: []Field{
			{Device: "vibration1", Tag: "temperature", Type: Number},
			{Device: "vibration1", Tag: "alert_vrms_max", Type: Bool},
			{Device: "vibration1", Tag: "alerts_raw", Type: Integer},
			{Device: "vibration1", Tag: "state", Type: String},
			{Device: "pump1", Tag: "error_code", Type: Integer},
			{Device: "pump1", Tag: "temperature", Type: Number},
		},
		Sources:     []string{"vibration1", "pump1"},
		TopicPrefix: "iolink",
		Period:      time.Second,
	}
}

// plcCatalog is the catalog of a service with one implicit source.
func plcCatalog() Catalog {
	return Catalog{
		Fields: []Field{
			{Tag: "AlarmActive", Type: Bool},
			{Tag: "Temperature", Type: Number},
			{Tag: "AlarmCode", Type: Integer},
			{Tag: "Message", Type: String},
		},
		Sources: []string{"plc1"},
		Period:  time.Second,
	}
}

// load parses a document or fails the test.
func load(t *testing.T, xml string, cat Catalog) []Rule {
	t.Helper()
	rules, problems := Load([]byte(xml), cat)
	if len(problems) != 0 {
		t.Fatalf("Load: %v", problems)
	}
	return rules
}

// loadFails expects a problem whose message contains want.
func loadFails(t *testing.T, xml string, cat Catalog, want string) []Problem {
	t.Helper()
	rules, problems := Load([]byte(xml), cat)
	if len(problems) == 0 {
		t.Fatalf("want a problem containing %q, got none", want)
	}
	if rules != nil {
		t.Error("a file with a problem must load no rule")
	}
	for _, p := range problems {
		if strings.Contains(p.Message, want) {
			return problems
		}
	}
	t.Fatalf("problems = %v, want one containing %q", problems, want)
	return nil
}

const simpleRule = `<rules><rule name="r">
  <cond device="vibration1" tag="temperature" op="gt" value="50.0"/>
  <actions><publish topic="alerts/hot" payload='{"a":1}'/></actions>
</rule></rules>`

func TestLoadSimpleRule(t *testing.T) {
	rules := load(t, simpleRule, testCatalog())
	if len(rules) != 1 {
		t.Fatalf("rules = %d, want 1", len(rules))
	}
	r := rules[0]
	if r.Name != "r" || len(r.actions) != 1 {
		t.Errorf("rule = %+v", r)
	}
	if len(r.FieldRefs()) != 1 || r.FieldRefs()[0] != 0 {
		t.Errorf("field refs = %v, want [0]", r.FieldRefs())
	}
	if r.actions[0].topic.literal != "alerts/hot" {
		t.Errorf("topic = %q", r.actions[0].topic.literal)
	}
}

func TestLoadTheOldAndTheNewFormMeanTheSame(t *testing.T) {
	old := load(t, simpleRule, testCatalog())[0]
	new := load(t, `<rules><rule name="r">
	  <cond expr="TAG(&quot;vibration1&quot;, &quot;temperature&quot;) &gt; 50.0"/>
	  <actions><publish topic="alerts/hot" payload='{"a":1}'/></actions>
	</rule></rules>`, testCatalog())[0]

	for _, values := range [][]any{
		{40.0, false, uint16(0), "", 0, 0.0},
		{60.0, false, uint16(0), "", 0, 0.0},
		{nil, false, uint16(0), "", 0, 0.0},
	} {
		e1 := NewEngine([]Rule{old}, testCatalog())
		e2 := NewEngine([]Rule{new}, testCatalog())
		a1, _ := e1.Eval(values, t0)
		a2, _ := e2.Eval(values, t0)
		if len(a1) != len(a2) {
			t.Errorf("values %v: old fired %d, new fired %d", values, len(a1), len(a2))
		}
	}
}

func TestLoadEveryOperatorAndAlias(t *testing.T) {
	for _, op := range []string{"eq", "neq", "lt", "leq", "gt", "geq", "=", "==", "!=", "&lt;", "&lt;=", "&gt;", "&gt;="} {
		xml := `<rules><rule name="r"><cond device="vibration1" tag="temperature" op="` + op + `" value="1"/>` +
			`<actions><publish topic="t"/></actions></rule></rules>`
		if rules := load(t, xml, testCatalog()); len(rules) != 1 {
			t.Errorf("operator %q did not load", op)
		}
	}
	// changed needs no value.
	load(t, `<rules><rule name="r"><cond device="vibration1" tag="temperature" op="changed"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, testCatalog())
}

func TestLoadValueMustFitTheFieldType(t *testing.T) {
	cases := map[string]struct{ tag, value, want string }{
		"bad boolean": {"alert_vrms_max", "yes", "bad boolean value"},
		"bad integer": {"alerts_raw", "1.5", "bad integer value"},
		"bad number":  {"temperature", "warm", "bad number value"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			xml := `<rules><rule name="r"><cond device="vibration1" tag="` + c.tag + `" op="eq" value="` + c.value + `"/>` +
				`<actions><publish topic="t"/></actions></rule></rules>`
			loadFails(t, xml, testCatalog(), c.want)
		})
	}
	// A boolean field takes 1 and 0, as the 0.2 documentation says.
	for _, value := range []string{"true", "false", "1", "0"} {
		xml := `<rules><rule name="r"><cond device="vibration1" tag="alert_vrms_max" op="eq" value="` + value + `"/>` +
			`<actions><publish topic="t"/></actions></rule></rules>`
		load(t, xml, testCatalog())
	}
}

func TestLoadUnknownField(t *testing.T) {
	loadFails(t, `<rules><rule name="r"><cond device="vibration1" tag="nope" op="eq" value="1"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, testCatalog(), `unknown field "nope" of device "vibration1"`)
	loadFails(t, `<rules><rule name="r"><cond expr="TAG(&quot;nope&quot;, &quot;t&quot;)"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, testCatalog(), "unknown tag")
}

func TestLoadDeviceIsRequiredWhenTheServiceHasMoreThanOne(t *testing.T) {
	loadFails(t, `<rules><rule name="r"><cond tag="temperature" op="gt" value="1"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, testCatalog(), "device is required")
	// The same file loads on a service with one implicit source.
	load(t, `<rules><rule name="r"><cond tag="Temperature" op="gt" value="1"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, plcCatalog())
}

func TestLoadReportsEveryProblem(t *testing.T) {
	xml := `<rules>
	  <rule name="a"><cond device="vibration1" tag="nope" op="eq" value="1"/><actions><publish topic="t"/></actions></rule>
	  <rule name="b"><cond device="vibration1" tag="temperature" op="gt" value="warm"/><actions><publish topic="t"/></actions></rule>
	  <rule name="c"><cond expr="NOPE(1)"/><actions><publish topic="t"/></actions></rule>
	</rules>`
	problems := loadFails(t, xml, testCatalog(), "unknown field")
	if len(problems) < 3 {
		t.Fatalf("want a problem per rule, got %v", problems)
	}
	names := map[string]bool{}
	for _, p := range problems {
		names[p.Rule] = true
		if p.Path == "" {
			t.Errorf("problem without a path: %+v", p)
		}
	}
	for _, name := range []string{"a", "b", "c"} {
		if !names[name] {
			t.Errorf("no problem names rule %q: %v", name, problems)
		}
	}
}

func TestLoadStructuralProblemsComeFirst(t *testing.T) {
	problems := loadFails(t, `<rules><rule name="r"><cond device="vibration1" tag="temperature" op="nope" value="1"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, testCatalog(), "unknown operator")
	if problems[0].Path != "rules/rule[1]/cond@op" {
		t.Errorf("path = %q", problems[0].Path)
	}
}

func TestLoadIncidentIdentity(t *testing.T) {
	xml := `<rules><rule name="pump1-fault">
	  <cond device="pump1" tag="error_code" op="neq" value="0"/>
	  <incident source="pump1" severity="error" summary="BADU pump reports a fault"/>
	</rule></rules>`
	r := load(t, xml, testCatalog())[0]
	if r.incident.sourceID != "iolink/pump1" {
		t.Errorf("source ID = %q, want iolink/pump1", r.incident.sourceID)
	}
	if r.incident.dedupKey != "iolink/pump1-pump1-fault" {
		t.Errorf("dedup key = %q", r.incident.dedupKey)
	}
}

func TestLoadIncidentIdentityWithoutATopicPrefix(t *testing.T) {
	// A service with one source keeps the identity it already publishes: the
	// source alone, and {source}-{rule} as the key (ADR-021).
	cat := plcCatalog()
	xml := `<rules><rule name="alarm-camera">
	  <cond tag="AlarmActive" op="eq" value="true"/>
	  <incident source="plc1" severity="critical" summary="Machine alarm active"/>
	</rule></rules>`
	r := load(t, xml, cat)[0]
	if r.incident.sourceID != "plc1" || r.incident.dedupKey != "plc1-alarm-camera" {
		t.Errorf("identity = %q / %q", r.incident.sourceID, r.incident.dedupKey)
	}
}

func TestLoadUnknownIncidentSource(t *testing.T) {
	loadFails(t, `<rules><rule name="r"><cond device="pump1" tag="error_code" op="neq" value="0"/>`+
		`<incident source="nope" severity="info" summary="s"/></rule></rules>`, testCatalog(), "unknown source")
}

func TestLoadRefusesAnUnusableTopic(t *testing.T) {
	for _, topic := range []string{"a/+/b", "a/#"} {
		loadFails(t, `<rules><rule name="r"><cond device="pump1" tag="error_code" op="neq" value="0"/>`+
			`<actions><publish topic="`+topic+`"/></actions></rule></rules>`, testCatalog(), "wildcards")
	}
}

func TestLoadRefusesATimeRuleWithoutAPeriod(t *testing.T) {
	cat := testCatalog()
	cat.Period = 0
	loadFails(t, `<rules><rule name="r"><cond expr="STALE(TAG(&quot;pump1&quot;, &quot;error_code&quot;), 10min)"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, cat, "period")
}

func TestLoadRefusesADuplicateField(t *testing.T) {
	cat := testCatalog()
	cat.Fields = append(cat.Fields, Field{Device: "pump1", Tag: "error_code", Type: Integer})
	loadFails(t, simpleRule, cat, "appears twice in the catalog")
}

func TestLoadFoldsANestedGroup(t *testing.T) {
	xml := `<rules><rule name="r">
	  <or>
	    <and>
	      <cond device="vibration1" tag="alert_vrms_max" op="eq" value="true"/>
	      <cond device="vibration1" tag="temperature" op="gt" value="40.0"/>
	    </and>
	    <cond device="pump1" tag="error_code" op="neq" value="0"/>
	  </or>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	r := load(t, xml, testCatalog())[0]
	if len(r.rows) != 2 {
		t.Fatalf("rows = %d, want 2: a nested group folds into one row", len(r.rows))
	}
	if r.matchAll {
		t.Error("the top-level group is an or")
	}
	if len(r.FieldRefs()) != 3 {
		t.Errorf("field refs = %v, want three slots", r.FieldRefs())
	}
}

func TestLoadKeepsTheDescriptionOfARow(t *testing.T) {
	xml := `<rules><rule name="r">
	  <or>
	    <cond expr="TAG(&quot;pump1&quot;, &quot;error_code&quot;) != 0" description="Pump fault"/>
	    <cond expr="TAG(&quot;vibration1&quot;, &quot;temperature&quot;) &gt; 50" description="Housing hot"/>
	  </or>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	r := load(t, xml, testCatalog())[0]
	if r.rows[0].description != "Pump fault" || r.rows[1].description != "Housing hot" {
		t.Errorf("descriptions = %q / %q", r.rows[0].description, r.rows[1].description)
	}
}

func TestLoadVariables(t *testing.T) {
	xml := `<rules><rule name="r">
	  <variables>
	    <var name="temp" formula="TAG(&quot;vibration1&quot;, &quot;temperature&quot;)" description="Housing"/>
	    <var name="hot" formula="temp &gt; 50"/>
	  </variables>
	  <cond expr="hot"/>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	r := load(t, xml, testCatalog())[0]
	if len(r.rows) != 1 || len(r.FieldRefs()) != 1 {
		t.Errorf("rows = %d, refs = %v", len(r.rows), r.FieldRefs())
	}
}

func TestLoadRefusesAConditionThatIsNotBoolean(t *testing.T) {
	loadFails(t, `<rules><rule name="r"><cond expr="TAG(&quot;vibration1&quot;, &quot;temperature&quot;)"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, testCatalog(), "must be true or false")
	// A field of unknown type is allowed: the engine decides at run time.
	cat := testCatalog()
	cat.Fields = append(cat.Fields, Field{Device: "pump1", Tag: "any", Type: Unknown})
	load(t, `<rules><rule name="r"><cond expr="TAG(&quot;pump1&quot;, &quot;any&quot;)"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, cat)
}

func TestLoadRefusesAReservedVariableName(t *testing.T) {
	loadFails(t, `<rules><rule name="r"><variables><var name="TAG" formula="1"/></variables>`+
		`<cond expr="TAG(&quot;pump1&quot;, &quot;error_code&quot;) != 0"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`, testCatalog(), "reserved word")
}

func TestParseReturnsOneErrorPerLine(t *testing.T) {
	_, err := Parse(strings.NewReader(`<rules><rule name="r">`+
		`<cond device="vibration1" tag="nope" op="eq" value="1"/>`+
		`<actions><publish topic="t"/></actions></rule></rules>`), testCatalog())
	if err == nil {
		t.Fatal("want an error")
	}
	if !strings.Contains(err.Error(), "unknown field") {
		t.Errorf("error = %v", err)
	}
	if _, err := Parse(nil, testCatalog()); err == nil {
		t.Error("a nil reader is an error")
	}
}
