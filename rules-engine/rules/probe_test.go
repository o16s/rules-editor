package rules

import (
	"testing"
	"time"
)

// A probe reads a rule's variables and rows beside the engine, on the same
// slot values, so a service can publish what the rule is seeing right now
// (edge-hub service package RUL-9). It is the timeline of the simulator,
// lifted into the package, so the page and the gateway keep one evaluation.

func probeCatalog() Catalog {
	return Catalog{
		Fields: []Field{
			{Device: "plc1", Tag: "Real70", Type: Number},
			{Device: "plc1", Tag: "Bool137", Type: Bool},
		},
		Sources: []string{"plc1"},
		Period:  time.Second,
	}
}

func TestProbeReportsEveryVariableAndRow(t *testing.T) {
	rs := load(t, `<rules><rule name="hot">
	  <variables><var name="mean" formula='AVG(TAG("plc1", "Real70"), 3s)'/></variables>
	  <and>
	    <cond expr='TAG("plc1", "Real70") &gt; 25'/>
	    <cond expr='TAG("plc1", "Bool137")'/>
	  </and>
	  <incident source="plc1" severity="warning" summary="hot"/>
	</rule></rules>`, probeCatalog())
	p, problems := NewRuleProbe(probeCatalog(), &rs[0])
	if len(problems) != 0 {
		t.Fatalf("probe: %v", problems)
	}
	base := time.Unix(0, 0)
	// Before any reading, everything is unknown and the cells say so.
	st := p.Step([]any{nil, nil}, base)
	if st.Rule != "hot" || st.Variables["mean"] != nil || st.Rows[0] != nil || st.Result != nil {
		t.Fatalf("before data: %+v", st)
	}
	for i, v := range []float64{10, 20, 30, 40, 50} {
		st = p.Step([]any{v, v > 25}, base.Add(time.Duration(i)*time.Second))
	}
	// AVG over 3 s at the last step: 30, 40, 50.
	if st.Variables["mean"] != 40.0 {
		t.Errorf("mean = %v, want 40", st.Variables["mean"])
	}
	if st.Rows[0] != true || st.Rows[1] != true || st.Result != true {
		t.Errorf("rows = %v result = %v, want both true", st.Rows, st.Result)
	}
	// An "all" rule with one false row is false, and the row says which.
	st = p.Step([]any{60.0, false}, base.Add(5*time.Second))
	if st.Rows[0] != true || st.Rows[1] != false || st.Result != false {
		t.Errorf("rows = %v result = %v, want [true false] false", st.Rows, st.Result)
	}
}

func TestProbeAnyRuleIsTrueOnOneRow(t *testing.T) {
	rs := load(t, `<rules><rule name="either">
	  <or><cond expr='TAG("plc1", "Real70") &gt; 100'/><cond expr='TAG("plc1", "Bool137")'/></or>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`, probeCatalog())
	p, _ := NewRuleProbe(probeCatalog(), &rs[0])
	st := p.Step([]any{1.0, true}, time.Unix(0, 0))
	if st.Rows[0] != false || st.Rows[1] != true || st.Result != true {
		t.Errorf("any: rows = %v result = %v", st.Rows, st.Result)
	}
}

func TestProbeIsOwnedByTheCallerAndNeverTouchesTheEngine(t *testing.T) {
	// The probe's windows and CHANGED memories are its own. Stepping it must
	// not move the engine's: an engine evaluated once after five probe steps
	// still sees its own first sample.
	cat := probeCatalog()
	rs := load(t, `<rules><rule name="moved">
	  <cond expr='CHANGED(TAG("plc1", "Real70"))'/>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`, cat)
	p, _ := NewRuleProbe(cat, &rs[0])
	eng := NewEngine(rs, cat)
	base := time.Unix(0, 0)
	for i := 0; i < 5; i++ {
		p.Step([]any{float64(i), false}, base.Add(time.Duration(i)*time.Second))
	}
	acts, _ := eng.Eval([]any{7.0, false}, base.Add(6*time.Second))
	acts2, _ := eng.Eval([]any{8.0, false}, base.Add(7*time.Second))
	if len(acts) != 0 || len(acts2) != 1 {
		t.Errorf("the engine's CHANGED must be its own: first eval %d actions, second %d", len(acts), len(acts2))
	}
}

func TestRuleKeepsItsTextsForAProbe(t *testing.T) {
	rs := load(t, `<rules><rule name="hot">
	  <variables><var name="mean" formula='AVG(TAG("plc1", "Real70"), 3s)'/></variables>
	  <and><cond expr='mean &gt; 25'/><cond device="plc1" tag="Bool137" op="eq" value="true"/></and>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`, probeCatalog())
	r := rs[0]
	if v := r.Variables(); len(v) != 1 || v[0].Name != "mean" || v[0].Text != `AVG(TAG("plc1", "Real70"), 3s)` {
		t.Errorf("Variables() = %+v", v)
	}
	// The 0.2 leaf is kept as the formula the loader made of it, so the
	// probe evaluates exactly what the engine evaluates.
	if rows := r.RowTexts(); len(rows) != 2 || rows[0] != "mean > 25" || rows[1] == "" {
		t.Errorf("RowTexts() = %q", rows)
	}
	if !r.MatchAll() {
		t.Error("an <and> rule matches all")
	}
}
