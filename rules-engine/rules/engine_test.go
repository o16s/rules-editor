package rules

import (
	"encoding/json"
	"testing"
	"time"
)

var t0 = time.Unix(1_700_000_000, 0).UTC()

// engineFor loads a document and builds an engine for it.
func engineFor(t *testing.T, xml string, cat Catalog) *Engine {
	t.Helper()
	return NewEngine(load(t, xml, cat), cat)
}

// values builds a slot array for testCatalog: temperature, alert, raw,
// state, error_code, pump temperature.
func values(temp any, alert any, raw any, state any, code any, pumpTemp any) []any {
	return []any{temp, alert, raw, state, code, pumpTemp}
}

const hotRule = `<rules><rule name="hot">
  <cond device="vibration1" tag="temperature" op="gt" value="50.0"/>
  <actions><publish topic="alerts/hot" payload='{"a":1}'/></actions>
</rule></rules>`

func TestEngineFiresWhenTheConditionBecomesTrue(t *testing.T) {
	e := engineFor(t, hotRule, testCatalog())
	actions, _ := e.Eval(values(40.0, false, 0, "", 0, 0.0), t0)
	if len(actions) != 0 {
		t.Fatalf("a false condition fired %d actions", len(actions))
	}
	actions, _ = e.Eval(values(60.0, false, 0, "", 0, 0.0), t0.Add(time.Second))
	if len(actions) != 1 {
		t.Fatalf("actions = %d, want 1", len(actions))
	}
	if actions[0].Topic != "alerts/hot" || string(actions[0].Payload) != `{"a":1}` || actions[0].Rule != "hot" {
		t.Errorf("action = %+v", actions[0])
	}
}

func TestEngineSkipsARuleWhoseInputsDidNotChange(t *testing.T) {
	e := engineFor(t, hotRule, testCatalog())
	e.Eval(values(60.0, false, 0, "", 0, 0.0), t0)
	before := e.Stats().RuleEvals
	// The same values: nothing changed, so the rule is not evaluated again.
	e.Eval(values(60.0, false, 0, "", 0, 0.0), t0.Add(time.Second))
	if e.Stats().RuleEvals != before {
		t.Errorf("the rule was evaluated again without a change")
	}
}

func TestEngineEdgeRisingFiresOnceUntilTheConditionClears(t *testing.T) {
	xml := `<rules><rule name="hot" edge="rising">
	  <cond device="vibration1" tag="temperature" op="gt" value="50.0"/>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	if a, _ := e.Eval(values(60.0, false, 0, "", 0, 0.0), t0); len(a) != 1 {
		t.Fatalf("first: actions = %d, want 1", len(a))
	}
	if a, _ := e.Eval(values(61.0, false, 0, "", 0, 0.0), t0.Add(time.Second)); len(a) != 0 {
		t.Errorf("still true: actions = %d, want 0", len(a))
	}
	if a, _ := e.Eval(values(40.0, false, 0, "", 0, 0.0), t0.Add(2*time.Second)); len(a) != 0 {
		t.Errorf("falling: actions = %d, want 0", len(a))
	}
	if a, _ := e.Eval(values(60.0, false, 0, "", 0, 0.0), t0.Add(3*time.Second)); len(a) != 1 {
		t.Errorf("rising again: actions = %d, want 1", len(a))
	}
}

func TestEngineEdgeNoneFiresOnEveryEvaluation(t *testing.T) {
	e := engineFor(t, hotRule, testCatalog())
	for i := 0; i < 3; i++ {
		v := values(60.0+float64(i), false, 0, "", 0, 0.0)
		if a, _ := e.Eval(v, t0.Add(time.Duration(i)*time.Second)); len(a) != 1 {
			t.Fatalf("evaluation %d: actions = %d, want 1", i, len(a))
		}
	}
}

func TestEngineCooldownThrottles(t *testing.T) {
	xml := `<rules><rule name="hot" cooldown="10s">
	  <cond device="vibration1" tag="temperature" op="gt" value="50.0"/>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	if a, _ := e.Eval(values(60.0, false, 0, "", 0, 0.0), t0); len(a) != 1 {
		t.Fatal("the first firing is not throttled")
	}
	if a, _ := e.Eval(values(61.0, false, 0, "", 0, 0.0), t0.Add(5*time.Second)); len(a) != 0 {
		t.Error("the cooldown must block the second firing")
	}
	if a, _ := e.Eval(values(62.0, false, 0, "", 0, 0.0), t0.Add(10*time.Second)); len(a) != 1 {
		t.Error("the cooldown expires after its duration")
	}
}

func TestEngineChangedFiresOnEveryChange(t *testing.T) {
	// The regression the two polling services carry: a CHANGED rule with a
	// rising edge must fire on every change, not only on the first.
	xml := `<rules><rule name="code" edge="rising">
	  <cond device="vibration1" tag="alerts_raw" op="changed"/>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	e.Eval(values(0.0, false, uint16(0), "", 0, 0.0), t0) // the first value is not a change
	for i := 1; i <= 3; i++ {
		v := values(0.0, false, uint16(i), "", 0, 0.0)
		a, _ := e.Eval(v, t0.Add(time.Duration(i)*time.Second))
		if len(a) != 1 {
			t.Errorf("change %d: actions = %d, want 1", i, len(a))
		}
	}
}

func TestEngineChangedWithACooldown(t *testing.T) {
	xml := `<rules><rule name="code" edge="rising" cooldown="1h">
	  <cond device="vibration1" tag="alerts_raw" op="changed"/>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	e.Eval(values(0.0, false, uint16(0), "", 0, 0.0), t0)
	if a, _ := e.Eval(values(0.0, false, uint16(1), "", 0, 0.0), t0.Add(time.Second)); len(a) != 1 {
		t.Fatal("the first change fires")
	}
	if a, _ := e.Eval(values(0.0, false, uint16(2), "", 0, 0.0), t0.Add(2*time.Second)); len(a) != 0 {
		t.Error("the cooldown blocks the next change")
	}
}

func TestEngineCompoundConditions(t *testing.T) {
	xml := `<rules><rule name="both">
	  <and>
	    <cond device="vibration1" tag="alert_vrms_max" op="eq" value="true"/>
	    <cond device="vibration1" tag="temperature" op="geq" value="40.0"/>
	  </and>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	if a, _ := e.Eval(values(50.0, false, 0, "", 0, 0.0), t0); len(a) != 0 {
		t.Error("one side false must not fire")
	}
	if a, _ := e.Eval(values(50.0, true, 0, "", 0, 0.0), t0.Add(time.Second)); len(a) != 1 {
		t.Error("both sides true must fire")
	}
}

func TestEngineCrossDeviceCondition(t *testing.T) {
	xml := `<rules><rule name="both-hot" edge="rising">
	  <and>
	    <cond device="vibration1" tag="temperature" op="gt" value="50.0"/>
	    <cond device="pump1" tag="temperature" op="gt" value="50.0"/>
	  </and>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	if a, _ := e.Eval(values(55.0, false, 0, "", 0, 45.0), t0); len(a) != 0 {
		t.Error("one device hot is not enough")
	}
	if a, _ := e.Eval(values(55.0, false, 0, "", 0, 56.0), t0.Add(2*time.Second)); len(a) != 1 {
		t.Error("the second device closes the condition")
	}
}

func TestEngineFiresRulesInDocumentOrder(t *testing.T) {
	// Two rules read the same slot. Their actions must follow the file, not
	// the order the slots happen to have (ADR-016).
	xml := `<rules>
	  <rule name="second"><cond device="vibration1" tag="temperature" op="gt" value="1"/>
	    <actions><publish topic="two"/></actions></rule>
	  <rule name="first"><cond device="vibration1" tag="temperature" op="gt" value="2"/>
	    <actions><publish topic="one"/></actions></rule>
	</rules>`
	e := engineFor(t, xml, testCatalog())
	actions, _ := e.Eval(values(50.0, false, 0, "", 0, 0.0), t0)
	if len(actions) != 2 || actions[0].Topic != "two" || actions[1].Topic != "one" {
		t.Errorf("actions = %+v, want the order of the file", actions)
	}
}

func TestEngineMultipleActionsKeepTheirOrder(t *testing.T) {
	xml := `<rules><rule name="cams">
	  <cond device="vibration1" tag="alert_vrms_max" op="eq" value="true"/>
	  <actions>
	    <publish topic="cam/1" payload='{"n":1}'/>
	    <publish topic="cam/2"/>
	    <publish topic="cam/3"/>
	  </actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	actions, _ := e.Eval(values(0.0, true, 0, "", 0, 0.0), t0)
	if len(actions) != 3 {
		t.Fatalf("actions = %d, want 3", len(actions))
	}
	for i, want := range []string{"cam/1", "cam/2", "cam/3"} {
		if actions[i].Topic != want {
			t.Errorf("action %d = %q, want %q", i, actions[i].Topic, want)
		}
	}
	// A missing payload publishes an empty object.
	if string(actions[1].Payload) != "{}" {
		t.Errorf("payload = %q, want {}", actions[1].Payload)
	}
}

func TestEngineEmptyValues(t *testing.T) {
	e := engineFor(t, hotRule, testCatalog())
	actions, incidents := e.Eval(nil, t0)
	if actions != nil || incidents != nil {
		t.Error("an empty slot array evaluates nothing")
	}
}

func TestEngineRuleCount(t *testing.T) {
	e := engineFor(t, hotRule, testCatalog())
	if e.RuleCount() != 1 {
		t.Errorf("RuleCount = %d", e.RuleCount())
	}
}

// ---- incidents -----------------------------------------------------------

const incidentRule = `<rules><rule name="fault" cooldown="COOLDOWN">
  <cond device="pump1" tag="error_code" op="neq" value="0"/>
  <incident source="pump1" severity="error" summary="BADU pump reports a fault"/>
</rule></rules>`

func incidentEngine(t *testing.T, cooldown string) *Engine {
	t.Helper()
	xml := incidentRule
	if cooldown == "" {
		xml = `<rules><rule name="fault">
		  <cond device="pump1" tag="error_code" op="neq" value="0"/>
		  <incident source="pump1" severity="error" summary="BADU pump reports a fault"/>
		</rule></rules>`
	} else {
		xml = replace(xml, "COOLDOWN", cooldown)
	}
	return engineFor(t, xml, testCatalog())
}

func replace(s, old, new string) string {
	out := ""
	for {
		i := indexOf(s, old)
		if i < 0 {
			return out + s
		}
		out += s[:i] + new
		s = s[i+len(old):]
	}
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestEngineIncidentTriggersAndResolves(t *testing.T) {
	e := incidentEngine(t, "")
	// The first evaluation with a false condition resolves whatever was open
	// before the restart (SYSREQ-015).
	_, incidents := e.Eval(values(0.0, false, 0, "", 0, 0.0), t0)
	if len(incidents) != 1 || incidents[0].Trigger {
		t.Fatalf("startup: incidents = %+v, want one resolve", incidents)
	}
	_, incidents = e.Eval(values(0.0, false, 0, "", 5, 0.0), t0.Add(time.Second))
	if len(incidents) != 1 || !incidents[0].Trigger {
		t.Fatalf("trigger: incidents = %+v", incidents)
	}
	inc := incidents[0]
	if inc.Source != "iolink/pump1" || inc.DedupKey != "iolink/pump1-fault" {
		t.Errorf("identity = %q / %q", inc.Source, inc.DedupKey)
	}
	if inc.Severity != "error" || inc.Summary != "BADU pump reports a fault" {
		t.Errorf("trigger = %+v", inc)
	}
	// Still true: nothing new.
	_, incidents = e.Eval(values(0.0, false, 0, "", 7, 0.0), t0.Add(2*time.Second))
	if len(incidents) != 0 {
		t.Errorf("still true: incidents = %+v", incidents)
	}
	// Cleared: one resolve, without the text.
	_, incidents = e.Eval(values(0.0, false, 0, "", 0, 0.0), t0.Add(3*time.Second))
	if len(incidents) != 1 || incidents[0].Trigger {
		t.Fatalf("resolve: incidents = %+v", incidents)
	}
	if incidents[0].Severity != "" || incidents[0].Summary != "" {
		t.Errorf("a resolve carries no text: %+v", incidents[0])
	}
	if incidents[0].DedupKey != inc.DedupKey {
		t.Errorf("the resolve must close the same key")
	}
}

func TestEngineStartupWithATrueConditionTriggers(t *testing.T) {
	e := incidentEngine(t, "")
	_, incidents := e.Eval(values(0.0, false, 0, "", 5, 0.0), t0)
	if len(incidents) != 1 || !incidents[0].Trigger {
		t.Fatalf("startup with a true condition: incidents = %+v, want one trigger", incidents)
	}
}

func TestEngineCooldownSuppressesATriggerAndItsResolve(t *testing.T) {
	e := incidentEngine(t, "1h")
	e.Eval(values(0.0, false, 0, "", 5, 0.0), t0) // trigger
	e.Eval(values(0.0, false, 0, "", 0, 0.0), t0.Add(time.Second))
	// Inside the cooldown the trigger is suppressed, so no incident is open.
	_, incidents := e.Eval(values(0.0, false, 0, "", 9, 0.0), t0.Add(2*time.Second))
	if len(incidents) != 0 {
		t.Fatalf("the cooldown must suppress the trigger: %+v", incidents)
	}
	// And the condition clearing must not send an orphan resolve.
	_, incidents = e.Eval(values(0.0, false, 0, "", 0, 0.0), t0.Add(3*time.Second))
	if len(incidents) != 0 {
		t.Errorf("no trigger was sent, so no resolve: %+v", incidents)
	}
}

func TestEngineResolveIsNeverSuppressedByTheCooldown(t *testing.T) {
	e := incidentEngine(t, "1h")
	e.Eval(values(0.0, false, 0, "", 5, 0.0), t0)
	_, incidents := e.Eval(values(0.0, false, 0, "", 0, 0.0), t0.Add(time.Second))
	if len(incidents) != 1 || incidents[0].Trigger {
		t.Fatalf("a resolve is never throttled: %+v", incidents)
	}
}

func TestEngineIncidentDoesNotDependOnTheEdge(t *testing.T) {
	// tsend2mqtt refused edge="none" on an incident rule. The shared engine
	// runs the lifecycle whatever the edge says.
	xml := `<rules><rule name="fault" edge="none">
	  <cond device="pump1" tag="error_code" op="neq" value="0"/>
	  <actions><publish topic="t"/></actions>
	  <incident source="pump1" severity="error" summary="fault"/>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	e.Eval(values(0.0, false, 0, "", 0, 0.0), t0)
	actions, incidents := e.Eval(values(0.0, false, 0, "", 5, 0.0), t0.Add(time.Second))
	if len(actions) != 1 || len(incidents) != 1 || !incidents[0].Trigger {
		t.Fatalf("actions = %d, incidents = %+v", len(actions), incidents)
	}
	// Still true with edge none: the action fires again, the incident does not.
	actions, incidents = e.Eval(values(0.0, false, 0, "", 6, 0.0), t0.Add(2*time.Second))
	if len(actions) != 1 || len(incidents) != 0 {
		t.Errorf("actions = %d, incidents = %+v", len(actions), incidents)
	}
}

func TestEngineOfflineDeviceResolves(t *testing.T) {
	e := incidentEngine(t, "")
	e.Eval(values(0.0, false, 0, "", 5, 0.0), t0)
	// The service clears the slots of a device that went offline.
	_, incidents := e.Eval(values(0.0, false, 0, "", nil, nil), t0.Add(time.Second))
	if len(incidents) != 1 || incidents[0].Trigger {
		t.Fatalf("an offline device resolves its incident: %+v", incidents)
	}
}

func TestEngineReset(t *testing.T) {
	xml := `<rules>
	  <rule name="fault"><cond device="pump1" tag="error_code" op="neq" value="0"/>
	    <incident source="pump1" severity="error" summary="fault"/></rule>
	  <rule name="hot" cooldown="1h"><cond device="vibration1" tag="temperature" op="gt" value="50.0"/>
	    <actions><publish topic="t"/></actions></rule>
	</rules>`
	e := engineFor(t, xml, testCatalog())
	e.Eval(values(60.0, false, 0, "", 5, 0.0), t0) // trigger and fire

	resolves := e.Reset(t0.Add(time.Second))
	if len(resolves) != 1 || resolves[0].Trigger || resolves[0].Rule != "fault" {
		t.Fatalf("Reset = %+v, want one resolve of the incident rule", resolves)
	}
	// The cooldown survives the reset, and the incident can trigger again.
	actions, incidents := e.Eval(values(60.0, false, 0, "", 5, 0.0), t0.Add(2*time.Second))
	if len(actions) != 0 {
		t.Error("the cooldown must survive a reset")
	}
	if len(incidents) != 1 || !incidents[0].Trigger {
		t.Errorf("the incident must trigger again: %+v", incidents)
	}
	// A reset with nothing open resolves nothing.
	e2 := engineFor(t, xml, testCatalog())
	e2.Eval(values(0.0, false, 0, "", 0, 0.0), t0) // startup resolve
	if got := e2.Reset(t0.Add(time.Second)); len(got) != 0 {
		t.Errorf("Reset with nothing open = %+v", got)
	}
}

func TestIncidentMessage(t *testing.T) {
	inc := Incident{
		Rule: "fault", Trigger: true, Source: "iolink/pump1", DedupKey: "iolink/pump1-fault",
		Severity: "error", Summary: "BADU pump reports a fault",
		FirstStep: "Look at the pump.", Cause: "The pump reports a code.",
	}
	raw, err := json.Marshal(inc.Message(t0))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"action":"trigger","dedup_key":"iolink/pump1-fault","source":"iolink/pump1",` +
		`"severity":"error","summary":"BADU pump reports a fault","first_step":"Look at the pump.",` +
		`"cause":"The pump reports a code.","time":"2023-11-14T22:13:20.000Z","data":{"rule":"fault"}}`
	if string(raw) != want {
		t.Errorf("trigger =\n%s\nwant\n%s", raw, want)
	}
	inc.Trigger = false
	raw, _ = json.Marshal(inc.Message(t0))
	want = `{"action":"resolve","dedup_key":"iolink/pump1-fault","source":"iolink/pump1",` +
		`"time":"2023-11-14T22:13:20.000Z","data":{"rule":"fault"}}`
	if string(raw) != want {
		t.Errorf("resolve =\n%s\nwant\n%s", raw, want)
	}
}
