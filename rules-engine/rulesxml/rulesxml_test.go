package rulesxml

import (
	"os"
	"strings"
	"testing"
)

// probs runs Validate over a string and returns the problems.
func probs(s string) []Problem { return Validate(strings.NewReader(s)) }

// paths joins the problem paths, for compact assertions.
func paths(ps []Problem) string {
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.Path)
	}
	return strings.Join(out, " ")
}

// msgs joins the problem messages.
func msgs(ps []Problem) string {
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.Path+": "+p.Message)
	}
	return strings.Join(out, "\n")
}

const cond = `<cond device="d" tag="t" op="eq" value="1"/>`
const actions = `<actions><publish topic="x"/></actions>`
const incident = `<incident source="d" severity="info" summary="s"/>`

// rule wraps a body in a named rule, and doc wraps rules in a root.
func rule(body string) string { return `<rule name="r">` + body + `</rule>` }
func doc(inner string) string { return `<rules>` + inner + `</rules>` }

func TestValidateAcceptsMinimalAndFullRules(t *testing.T) {
	cases := map[string]string{
		"actions only":          doc(rule(cond + actions)),
		"incident only":         doc(rule(cond + incident)),
		"both":                  doc(rule(cond + actions + incident)),
		"no rules at all":       doc(""),
		"and group":             doc(rule(`<and>` + cond + cond + `</and>` + actions)),
		"or group":              doc(rule(`<or>` + cond + cond + `</or>` + actions)),
		"changed without value": doc(rule(`<cond device="d" tag="t" op="changed"/>` + actions)),
		"cooldown and edge":     doc(`<rule name="r" cooldown="30s" edge="rising">` + cond + actions + `</rule>`),
		"edge none":             doc(`<rule name="r" edge="none">` + cond + actions + `</rule>`),
		"comments and pi":       `<?xml version="1.0"?>` + doc(`<!-- hi -->`+rule(cond+actions)),
		"summary at 120":        doc(rule(cond + `<incident source="d" severity="info" summary="` + strings.Repeat("x", 120) + `"/>`)),
		"16 children":           doc(rule(`<and>` + strings.Repeat(cond, 16) + `</and>` + actions)),
		"depth 4 with leaf":     doc(rule(`<and><or><and>` + cond + `</and></or></and>` + actions)),
		"payload attr":          doc(rule(cond + `<actions><publish topic="x" payload='{"a":1}'/></actions>`)),
		"changed w/ value":      doc(rule(`<cond device="d" tag="t" op="changed" value="1"/>` + actions)),
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			if got := probs(xml); len(got) != 0 {
				t.Errorf("want valid, got problems:\n%s", msgs(got))
			}
		})
	}
}

func TestValidateTheReferenceExamples(t *testing.T) {
	// The reference examples of the documentation, as the editor ships them.
	for _, name := range []string{
		"reference-example-plc.xml",
		"reference-example-io-link.xml",
		"the-13a-rule.xml",
	} {
		f, err := os.Open("../../schema/fixtures/valid/" + name)
		if err != nil {
			t.Fatal(err)
		}
		got := Validate(f)
		f.Close()
		if len(got) != 0 {
			t.Errorf("%s must validate, got:\n%s", name, msgs(got))
		}
	}
}

func TestValidateRootElement(t *testing.T) {
	cases := map[string]string{
		"wrong root": `<ruleset/>`,
		"wrong case": `<Rules/>`,
		"bare rule":  `<rule name="r"/>`,
		"empty":      ``,
		"text only":  `hello`,
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(xml)
			if len(got) == 0 {
				t.Fatal("want a problem naming the root element")
			}
			if !strings.Contains(msgs(got), "rules") {
				t.Errorf("problem should name the expected root: %s", msgs(got))
			}
		})
	}
}

func TestValidateProblemPathGrammar(t *testing.T) {
	// The second rule, an and group, its first cond, its value attribute.
	xml := doc(rule(cond+actions) +
		`<rule name="r2"><and><cond device="d" tag="t" op="gt"/></and>` + actions + `</rule>`)
	got := probs(xml)
	if len(got) != 1 {
		t.Fatalf("want 1 problem, got %d:\n%s", len(got), msgs(got))
	}
	if want := "rules/rule[2]/and/cond[1]@value"; got[0].Path != want {
		t.Errorf("path = %q, want %q", got[0].Path, want)
	}

	// A publish inside actions is indexed too.
	got = probs(doc(rule(cond + `<actions><publish topic="a"/><publish/></actions>`)))
	if len(got) != 1 || got[0].Path != "rules/rule[1]/actions/publish[2]@topic" {
		t.Fatalf("publish path = %s", msgs(got))
	}
}

func TestValidateUnknownElement(t *testing.T) {
	cases := map[string]string{
		"unknown at root":     doc(`<foo/>`),
		"unknown in rule":     doc(rule(cond + actions + `<foo/>`)),
		"misspelled publish":  doc(rule(cond + `<actions><publsh topic="x"/></actions>`)),
		"cond inside actions": doc(rule(cond + `<actions>` + cond + `</actions>`)),
		"rule inside rule":    doc(rule(cond + actions + rule(cond+actions))),
		"actions in group":    doc(rule(`<and>` + cond + actions + `</and>` + actions)),
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(xml)
			if len(got) == 0 {
				t.Fatal("unknown or misplaced element must be a problem")
			}
			if !strings.Contains(msgs(got), "unexpected element") {
				t.Errorf("problems = %s", msgs(got))
			}
		})
	}
}

func TestValidateUnknownAttribute(t *testing.T) {
	cases := map[string]string{
		"on rules":    `<rules version="1">` + rule(cond+actions) + `</rules>`,
		"on rule":     doc(`<rule name="r" foo="1">` + cond + actions + `</rule>`),
		"on cond":     doc(rule(`<cond device="d" tag="t" op="eq" value="1" x="y"/>` + actions)),
		"on and":      doc(rule(`<and x="1">` + cond + `</and>` + actions)),
		"on publish":  doc(rule(cond + `<actions><publish topic="x" retain="true"/></actions>`)),
		"on incident": doc(rule(cond + `<incident source="d" severity="info" summary="s" x="1"/>`)),
		"on actions":  doc(rule(cond + `<actions x="1"><publish topic="t"/></actions>`)),
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(xml)
			if len(got) != 1 {
				t.Fatalf("want exactly 1 problem, got:\n%s", msgs(got))
			}
			if !strings.Contains(got[0].Message, "unknown attribute") {
				t.Errorf("message = %q", got[0].Message)
			}
			if !strings.Contains(got[0].Path, "@") {
				t.Errorf("path %q must point at the attribute", got[0].Path)
			}
		})
	}
}

func TestValidateRuleName(t *testing.T) {
	cases := map[string]struct{ xml, want string }{
		"missing":   {doc(`<rule>` + cond + actions + `</rule>`), "name"},
		"empty":     {doc(`<rule name="">` + cond + actions + `</rule>`), "name"},
		"duplicate": {doc(rule(cond+actions) + rule(cond+actions)), "duplicate"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(tc.xml)
			if len(got) == 0 || !strings.Contains(msgs(got), tc.want) {
				t.Fatalf("problems = %s, want one mentioning %q", msgs(got), tc.want)
			}
		})
	}
}

func TestValidateCooldown(t *testing.T) {
	// A zero cooldown is what an absent attribute already means. The schema
	// accepts it, so this package accepts it too (ADR-009 keeps the two in
	// step; the engine treats it as no cooldown).
	ok := []string{"30s", "1m", "1m30s", "500ms", "1.5s", "2h", "0", "0s"}
	for _, cd := range ok {
		if got := probs(doc(`<rule name="r" cooldown="` + cd + `">` + cond + actions + `</rule>`)); len(got) != 0 {
			t.Errorf("cooldown %q: %s", cd, msgs(got))
		}
	}
	// A negative cooldown is meaningless, and a bare number has no unit.
	for _, cd := range []string{"-5s", "5", "soon", ""} {
		got := probs(doc(`<rule name="r" cooldown="` + cd + `">` + cond + actions + `</rule>`))
		if len(got) == 0 {
			t.Errorf("cooldown %q must be a problem", cd)
			continue
		}
		if !strings.Contains(got[0].Path, "@cooldown") {
			t.Errorf("cooldown %q: path = %q", cd, got[0].Path)
		}
	}
}

func TestValidateEdge(t *testing.T) {
	for _, e := range []string{"none", "rising"} {
		if got := probs(doc(`<rule name="r" edge="` + e + `">` + cond + actions + `</rule>`)); len(got) != 0 {
			t.Errorf("edge %q: %s", e, msgs(got))
		}
	}
	for _, e := range []string{"falling", "Rising", "", "both"} {
		if got := probs(doc(`<rule name="r" edge="` + e + `">` + cond + actions + `</rule>`)); len(got) == 0 {
			t.Errorf("edge %q must be a problem", e)
		}
	}
}

func TestValidateTopLevelCondition(t *testing.T) {
	cases := map[string]string{
		"none":         doc(rule(actions)),
		"two conds":    doc(rule(cond + cond + actions)),
		"cond and and": doc(rule(cond + `<and>` + cond + `</and>` + actions)),
		"and and or":   doc(rule(`<and>` + cond + `</and><or>` + cond + `</or>` + actions)),
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(xml)
			if len(got) == 0 || !strings.Contains(msgs(got), "condition") {
				t.Fatalf("problems = %s, want a top-level condition problem", msgs(got))
			}
		})
	}
}

func TestValidateLogicChildren(t *testing.T) {
	for _, kind := range []string{"and", "or"} {
		if got := probs(doc(rule(`<` + kind + `/>` + actions))); len(got) == 0 {
			t.Errorf("<%s> with no children must be a problem", kind)
		}
		many := `<` + kind + `>` + strings.Repeat(cond, 17) + `</` + kind + `>`
		got := probs(doc(rule(many + actions)))
		if len(got) == 0 || !strings.Contains(msgs(got), "16") {
			t.Errorf("<%s> with 17 children: %s", kind, msgs(got))
		}
	}
}

func TestValidateDepth(t *testing.T) {
	// The leaf counts as a level: three groups above a cond is the maximum.
	deep := cond
	for i := 0; i < 3; i++ {
		deep = `<and>` + deep + `</and>`
	}
	if got := probs(doc(rule(deep + actions))); len(got) != 0 {
		t.Errorf("depth 4 must be valid: %s", msgs(got))
	}
	deep = `<and>` + deep + `</and>`
	got := probs(doc(rule(deep + actions)))
	if len(got) == 0 || !strings.Contains(msgs(got), "depth") {
		t.Errorf("depth 5 must be a problem: %s", msgs(got))
	}
}

func TestValidateCondAttributes(t *testing.T) {
	for _, op := range []string{"eq", "neq", "lt", "leq", "gt", "geq", "=", "==", "!=", "&lt;", "&lt;=", "&gt;", "&gt;="} {
		xml := doc(rule(`<cond device="d" tag="t" op="` + op + `" value="1"/>` + actions))
		if got := probs(xml); len(got) != 0 {
			t.Errorf("op %q: %s", op, msgs(got))
		}
	}
	cases := map[string]struct{ xml, wantPath string }{
		"no tag":        {doc(rule(`<cond device="d" op="eq" value="1"/>` + actions)), "@tag"},
		"no op":         {doc(rule(`<cond device="d" tag="t" value="1"/>` + actions)), "@op"},
		"bad op":        {doc(rule(`<cond device="d" tag="t" op="between" value="1"/>` + actions)), "@op"},
		"spaced op":     {doc(rule(`<cond device="d" tag="t" op=" eq " value="1"/>` + actions)), "@op"},
		"no value":      {doc(rule(`<cond device="d" tag="t" op="gt"/>` + actions)), "@value"},
		"empty value":   {doc(rule(`<cond device="d" tag="t" op="gt" value=""/>` + actions)), "@value"},
		"child in cond": {doc(rule(`<cond device="d" tag="t" op="eq" value="1"><foo/></cond>` + actions)), "cond"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(tc.xml)
			if len(got) == 0 {
				t.Fatal("want a problem")
			}
			if !strings.Contains(paths(got), tc.wantPath) {
				t.Errorf("paths = %q, want one containing %q (%s)", paths(got), tc.wantPath, msgs(got))
			}
		})
	}
}

// The shared format leaves device optional: a single-source service has one
// device and nothing to name. modbus2mqtt does require it, but that check
// belongs where the configured devices are known, so Validate must not
// reject a file the published schema accepts.
func TestValidateLeavesDeviceToTheBindingStep(t *testing.T) {
	if got := probs(doc(rule(`<cond tag="t" op="eq" value="1"/>` + actions))); len(got) != 0 {
		t.Errorf("device is optional in the shared format: %s", msgs(got))
	}
}

// The schema fixes the order of a rule's children. The editor's serializer
// always emits it, and the hub validates uploads against that schema, so a
// file the hub would refuse must not start here either.
func TestValidateChildOrder(t *testing.T) {
	ordered := doc(rule(cond + actions + incident))
	if got := probs(ordered); len(got) != 0 {
		t.Fatalf("the documented order must be valid: %s", msgs(got))
	}
	cases := map[string]string{
		"incident before actions": doc(rule(cond + incident + actions)),
		"actions before cond":     doc(rule(actions + cond)),
		"incident first":          doc(rule(incident + actions + cond)),
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(xml)
			if len(got) == 0 || !strings.Contains(msgs(got), "order") {
				t.Errorf("problems = %s, want an ordering problem", msgs(got))
			}
		})
	}
}

func TestValidateActions(t *testing.T) {
	cases := map[string]string{
		"empty actions":     doc(rule(cond + `<actions/>` + incident)),
		"publish no topic":  doc(rule(cond + `<actions><publish/></actions>`)),
		"publish empty":     doc(rule(cond + `<actions><publish topic=""/></actions>`)),
		"two action blocks": doc(rule(cond + actions + actions)),
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			if got := probs(xml); len(got) == 0 {
				t.Fatal("want a problem")
			}
		})
	}
}

func TestValidateIncident(t *testing.T) {
	long := strings.Repeat("x", 121)
	// want is matched against "path: message", so a case can pin either the
	// attribute the problem points at or the wording of the rule it broke.
	cases := map[string]struct{ xml, want string }{
		"no source":      {doc(rule(cond + `<incident severity="info" summary="s"/>`)), "@source"},
		"no severity":    {doc(rule(cond + `<incident source="d" summary="s"/>`)), "@severity"},
		"bad severity":   {doc(rule(cond + `<incident source="d" severity="fatal" summary="s"/>`)), "@severity"},
		"no summary":     {doc(rule(cond + `<incident source="d" severity="info"/>`)), "@summary"},
		"empty summary":  {doc(rule(cond + `<incident source="d" severity="info" summary=""/>`)), "@summary"},
		"summary at 121": {doc(rule(cond + `<incident source="d" severity="info" summary="` + long + `"/>`)), "@summary"},
		"two incidents":  {doc(rule(cond + incident + incident)), "more than one <incident>"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(tc.xml)
			if len(got) == 0 {
				t.Fatal("want a problem")
			}
			if !strings.Contains(msgs(got), tc.want) {
				t.Errorf("problems = %s, want one matching %q", msgs(got), tc.want)
			}
		})
	}
	for _, sev := range []string{"critical", "error", "warning", "info"} {
		xml := doc(rule(cond + `<incident source="d" severity="` + sev + `" summary="s"/>`))
		if got := probs(xml); len(got) != 0 {
			t.Errorf("severity %q: %s", sev, msgs(got))
		}
	}
}

func TestValidateRuleNeedsActionsOrIncident(t *testing.T) {
	got := probs(doc(rule(cond)))
	if len(got) == 0 || !strings.Contains(msgs(got), "actions") {
		t.Fatalf("a rule with neither actions nor incident must be a problem: %s", msgs(got))
	}
}

func TestValidateMalformedXML(t *testing.T) {
	cases := map[string]string{
		"unclosed":     `<rules><rule name="r">`,
		"mismatched":   `<rules><rule name="r"></rules>`,
		"stray amp":    doc(rule(`<cond device="d" tag="t" op="eq" value="a & b"/>` + actions)),
		"unquoted":     `<rules><rule name=r></rule></rules>`,
		"two roots":    doc(rule(cond+actions)) + doc(rule(cond+actions)),
		"bad encoding": "\xff\xfe<rules/>",
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(xml) // must not panic
			if len(got) == 0 {
				t.Fatal("malformed XML must be a problem")
			}
		})
	}
}

// One fault should produce one problem. An unknown operator already tells the
// operator what is wrong; a second line about the value it did not supply for
// that operator only makes the list harder to read.
func TestValidateDoesNotPileOnAfterABadOperator(t *testing.T) {
	got := probs(doc(rule(`<cond device="d" tag="t" op="nope"/>` + actions)))
	if len(got) != 1 {
		t.Fatalf("want exactly 1 problem, got:\n%s", msgs(got))
	}
	if !strings.Contains(got[0].Message, "operator") {
		t.Errorf("problem = %s", msgs(got))
	}
}

func TestValidateReportsEveryProblem(t *testing.T) {
	// Five distinct faults, in document order.
	xml := `<rules>
  <rule name="a" edge="falling"><cond device="d" tag="t" op="eq" value="1"/><actions><publish topic="x"/></actions></rule>
  <rule name="a"><cond device="d" tag="t" op="nope" value="1"/><actions><publish/></actions></rule>
  <rule name="c"><cond device="d" tag="t" op="eq" value="1"/></rule>
</rules>`
	got := probs(xml)
	if len(got) != 5 {
		t.Fatalf("want 5 problems, got %d:\n%s", len(got), msgs(got))
	}
	// Document order: edge, duplicate name, op, publish topic, no actions.
	wantOrder := []string{"@edge", "rule[2]", "@op", "@topic", "rule[3]"}
	for i, want := range wantOrder {
		if !strings.Contains(got[i].Path, want) {
			t.Errorf("problem %d path = %q, want it to contain %q", i, got[i].Path, want)
		}
	}
}

func TestValidateCharData(t *testing.T) {
	if got := probs(doc(rule(`<and>text` + cond + `</and>` + actions))); len(got) == 0 {
		t.Error("stray text in a group must be a problem")
	}
	if got := probs(doc("\n  " + rule(cond+actions) + "\n")); len(got) != 0 {
		t.Errorf("whitespace must be ignored: %s", msgs(got))
	}
}

func TestValidateBoundsAndNilReader(t *testing.T) {
	if got := Validate(nil); len(got) != 1 {
		t.Fatalf("a nil reader must be one problem, got %v", got)
	}
	// More rules than the engine accepts.
	many := doc(strings.Repeat(rule(cond+actions), 1001))
	if got := probs(many); len(got) == 0 {
		t.Error("1001 rules must be a problem")
	}
	// Many faults truncate at MaxProblems rather than growing without bound.
	var b strings.Builder
	b.WriteString("<rules>")
	for i := 0; i < MaxProblems+50; i++ {
		b.WriteString(`<rule name="r` + string(rune('a'+i%26)) + string(rune('a'+i/26)) + `" edge="bad">` + cond + actions + `</rule>`)
	}
	b.WriteString("</rules>")
	got := probs(b.String())
	if len(got) > MaxProblems {
		t.Errorf("got %d problems, want at most %d", len(got), MaxProblems)
	}
	if len(got) != MaxProblems {
		t.Errorf("got %d problems, want the cap %d", len(got), MaxProblems)
	}
}

// ---- the 0.3 vocabulary --------------------------------------------------

const expr = `<cond expr="TAG(&quot;d&quot;, &quot;t&quot;) &gt; 50"/>`

func TestValidateAcceptsFormulaRules(t *testing.T) {
	cases := map[string]string{
		"formula condition":     doc(rule(expr + actions)),
		"expr with description": doc(rule(`<cond expr="a" description="Housing is hot"/>` + actions)),
		"empty variables block": doc(rule(`<variables/>` + expr + actions)),
		"one variable": doc(rule(
			`<variables><var name="temp" formula="TAG(&quot;t&quot;)" description="Housing"/></variables>` + expr + actions)),
		"64 variables":                     doc(rule(`<variables>` + strings.Repeat(`<var name="v" formula="1"/>`, 1) + vars(63) + `</variables>` + expr + actions)),
		"nested group keeps a description": doc(rule(`<and><or description="either">` + expr + expr + `</or>` + expr + `</and>` + actions)),
		"incident with first_step and cause": doc(rule(expr +
			`<incident source="d" severity="info" summary="s" first_step="Look." cause="Because."/>`)),
		"formula Then fields":                   doc(rule(expr + `<actions><publish topic="=&quot;a/&quot; &amp; &quot;b&quot;" payload="=condition.description"/></actions>`)),
		"mixed 0.2 and 0.3 rows":                doc(rule(`<and>` + cond + expr + `</and>` + actions)),
		"64 publish elements":                   doc(rule(expr + `<actions>` + strings.Repeat(`<publish topic="x"/>`, 64) + `</actions>`)),
		"text at 240 characters":                doc(rule(`<cond expr="a" description="` + strings.Repeat("x", 240) + `"/>` + actions)),
		"unparsable formula is a binding check": doc(rule(`<cond expr="temp &gt;"/>` + actions)),
		"unknown function is a binding check":   doc(rule(`<cond expr="NOPE(1)"/>` + actions)),
	}
	for name, xml := range cases {
		t.Run(name, func(t *testing.T) {
			if got := probs(xml); len(got) != 0 {
				t.Errorf("want valid, got problems:\n%s", msgs(got))
			}
		})
	}
}

// vars renders n variables with distinct names.
func vars(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteString(`<var name="v` + itoa(i) + `" formula="1"/>`)
	}
	return b.String()
}

func TestValidateCondForm(t *testing.T) {
	cases := map[string]struct{ xml, path string }{
		"no form at all":      {doc(rule(`<cond value="1"/>` + actions)), "rules/rule[1]/cond@expr"},
		"tag without op":      {doc(rule(`<cond tag="t" value="1"/>` + actions)), "rules/rule[1]/cond@op"},
		"op without tag":      {doc(rule(`<cond op="eq" value="1"/>` + actions)), "rules/rule[1]/cond@tag"},
		"both forms at once":  {doc(rule(`<cond expr="a" tag="t" op="eq" value="1"/>` + actions)), "rules/rule[1]/cond"},
		"empty expr":          {doc(rule(`<cond expr=""/>` + actions)), "rules/rule[1]/cond@expr"},
		"gt without value":    {doc(rule(`<cond tag="t" op="gt"/>` + actions)), "rules/rule[1]/cond@value"},
		"gt with empty value": {doc(rule(`<cond tag="t" op="gt" value=""/>` + actions)), "rules/rule[1]/cond@value"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(c.xml)
			if len(got) == 0 {
				t.Fatal("want a problem, got none")
			}
			if got[0].Path != c.path {
				t.Errorf("path = %q, want %q (%s)", got[0].Path, c.path, got[0].Message)
			}
		})
	}
	// changed needs no value, in either order of the attributes.
	for _, xml := range []string{
		doc(rule(`<cond tag="t" op="changed"/>` + actions)),
		doc(rule(`<cond op="changed" tag="t"/>` + actions)),
	} {
		if got := probs(xml); len(got) != 0 {
			t.Errorf("changed must need no value: %s", msgs(got))
		}
	}
}

func TestValidateVariables(t *testing.T) {
	cases := map[string]struct{ xml, path string }{
		"var without name":         {doc(rule(`<variables><var formula="1"/></variables>` + expr + actions)), "rules/rule[1]/variables/var[1]@name"},
		"var without formula":      {doc(rule(`<variables><var name="x"/></variables>` + expr + actions)), "rules/rule[1]/variables/var[1]@formula"},
		"empty formula":            {doc(rule(`<variables><var name="x" formula=""/></variables>` + expr + actions)), "rules/rule[1]/variables/var[1]@formula"},
		"name starts with a digit": {doc(rule(`<variables><var name="1x" formula="1"/></variables>` + expr + actions)), "rules/rule[1]/variables/var[1]@name"},
		"name with a space":        {doc(rule(`<variables><var name="milk temp" formula="1"/></variables>` + expr + actions)), "rules/rule[1]/variables/var[1]@name"},
		"duplicate names":          {doc(rule(`<variables><var name="x" formula="1"/><var name="x" formula="2"/></variables>` + expr + actions)), "rules/rule[1]/variables/var[2]@name"},
		"65 variables":             {doc(rule(`<variables>` + vars(65) + `</variables>` + expr + actions)), "rules/rule[1]/variables"},
		"not a var":                {doc(rule(`<variables><foo/></variables>` + expr + actions)), "rules/rule[1]/variables"},
		"two variables blocks":     {doc(rule(`<variables/><variables/>` + expr + actions)), "rules/rule[1]"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(c.xml)
			if len(got) == 0 {
				t.Fatal("want a problem, got none")
			}
			if got[0].Path != c.path {
				t.Errorf("path = %q, want %q (%s)", got[0].Path, c.path, got[0].Message)
			}
		})
	}
	// A name may repeat in another rule.
	twice := doc(rule(`<variables><var name="x" formula="1"/></variables>`+expr+actions) +
		`<rule name="r2"><variables><var name="x" formula="1"/></variables>` + expr + actions + `</rule>`)
	if got := probs(twice); len(got) != 0 {
		t.Errorf("a variable name is unique per rule, not per file: %s", msgs(got))
	}
}

func TestValidateTextLimits(t *testing.T) {
	long := strings.Repeat("x", 241)
	cases := map[string]struct{ xml, path string }{
		"description":       {doc(rule(`<cond expr="a" description="` + long + `"/>` + actions)), "rules/rule[1]/cond@description"},
		"var description":   {doc(rule(`<variables><var name="x" formula="1" description="` + long + `"/></variables>` + expr + actions)), "rules/rule[1]/variables/var[1]@description"},
		"first_step":        {doc(rule(expr + `<incident source="d" severity="info" summary="s" first_step="` + long + `"/>`)), "rules/rule[1]/incident@first_step"},
		"cause":             {doc(rule(expr + `<incident source="d" severity="info" summary="s" cause="` + long + `"/>`)), "rules/rule[1]/incident@cause"},
		"group description": {doc(rule(`<and><or description="` + long + `">` + expr + expr + `</or>` + expr + `</and>` + actions)), "rules/rule[1]/and/or[1]@description"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			got := probs(c.xml)
			if len(got) == 0 {
				t.Fatal("want a problem, got none")
			}
			if got[0].Path != c.path {
				t.Errorf("path = %q, want %q (%s)", got[0].Path, c.path, got[0].Message)
			}
		})
	}
}

func TestValidateTopLevelGroupHasNoDescription(t *testing.T) {
	got := probs(doc(rule(`<or description="either">` + expr + expr + `</or>` + actions)))
	if len(got) != 1 || got[0].Path != "rules/rule[1]/or@description" {
		t.Fatalf("want one problem on the top-level group, got:\n%s", msgs(got))
	}
	// The same description one level down is fine: that group folds into a row.
	if p := probs(doc(rule(`<and><or description="either">` + expr + expr + `</or>` + expr + `</and>` + actions))); len(p) != 0 {
		t.Errorf("a nested group keeps its description: %s", msgs(p))
	}
}

func TestValidateActionCap(t *testing.T) {
	got := probs(doc(rule(expr + `<actions>` + strings.Repeat(`<publish topic="x"/>`, 65) + `</actions>`)))
	if len(got) != 1 || got[0].Path != "rules/rule[1]/actions" {
		t.Fatalf("want one problem on <actions>, got:\n%s", msgs(got))
	}
}

func TestValidateChildOrderWithVariables(t *testing.T) {
	got := probs(doc(rule(expr + `<variables/>` + actions)))
	if len(got) != 1 || got[0].Path != "rules/rule[1]/variables" {
		t.Fatalf("variables must come first, got:\n%s", msgs(got))
	}
}
