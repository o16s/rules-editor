package rules

import (
	"testing"
	"time"
)

func TestEngineEvaluatesATimeRuleWithoutNewData(t *testing.T) {
	xml := `<rules><rule name="ph-stale">
	  <cond expr="STALE(TAG(&quot;pump1&quot;, &quot;error_code&quot;), 10min)"/>
	  <incident source="pump1" severity="warning" summary="No data from the pump"/>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	e.Eval(values(0.0, false, 0, "", 1, 0.0), t0)

	// Nothing changes, but the clock does. The rule must still be evaluated.
	var incidents []Incident
	for i := 1; i <= 12; i++ {
		_, incidents = e.Eval(values(0.0, false, 0, "", 1, 0.0), t0.Add(time.Duration(i)*time.Minute))
		if i < 10 && len(incidents) != 0 {
			t.Fatalf("minute %d: %+v", i, incidents)
		}
		if i == 10 {
			if len(incidents) != 1 || !incidents[0].Trigger {
				t.Fatalf("minute 10: incidents = %+v, want one trigger", incidents)
			}
		}
	}
	// New data resolves it.
	_, incidents = e.Eval(values(0.0, false, 0, "", 2, 0.0), t0.Add(13*time.Minute))
	if len(incidents) != 1 || incidents[0].Trigger {
		t.Errorf("new data resolves the incident: %+v", incidents)
	}
}

func TestEngineRateOverAWindow(t *testing.T) {
	xml := `<rules><rule name="climb" edge="rising">
	  <cond expr="RATE(TAG(&quot;vibration1&quot;, &quot;temperature&quot;), 30min) &gt; 20"/>
	  <actions><publish topic="t"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	fired := 0
	// A climb of 12 degrees over 30 minutes is 24 per hour.
	for i := 0; i <= 180; i++ {
		v := values(40+12*float64(i)/180, false, 0, "", 0, 0.0)
		actions, _ := e.Eval(v, t0.Add(time.Duration(i)*10*time.Second))
		fired += len(actions)
	}
	if fired == 0 {
		t.Error("a climb faster than the limit must fire")
	}
	// A flat line does not fire again: the rule re-arms only after the rate
	// falls, which needs a window without a climb.
	for i := 1; i <= 200; i++ {
		e.Eval(values(52.0, false, 0, "", 0, 0.0), t0.Add(30*time.Minute+time.Duration(i)*10*time.Second))
	}
	before := fired
	actions, _ := e.Eval(values(52.0, false, 0, "", 0, 0.0), t0.Add(2*time.Hour))
	fired += len(actions)
	if fired != before {
		t.Error("a flat line must not fire")
	}
}

func TestEngineSharesOneWindowBetweenRules(t *testing.T) {
	xml := `<rules>
	  <rule name="a"><cond expr="RATE(TAG(&quot;vibration1&quot;, &quot;temperature&quot;), 30min) &gt; 20"/>
	    <actions><publish topic="a"/></actions></rule>
	  <rule name="b"><cond expr="AVG(TAG(&quot;vibration1&quot;, &quot;temperature&quot;), 30min) &gt; 20"/>
	    <actions><publish topic="b"/></actions></rule>
	</rules>`
	e := engineFor(t, xml, testCatalog())
	if len(e.past.windows) != 1 {
		t.Errorf("windows = %d, want one shared ring", len(e.past.windows))
	}
}

// A window holds one reading per evaluation, not one per change (ADR-022).
// The two differ whenever a value sits still: a mean over the readings is
// what an operator asks for, and a mean over the distinct values is not.
func TestAWindowHoldsEveryReading(t *testing.T) {
	// The catalog polls once a second, and the window is ten seconds, so each
	// second is its own bucket and the arithmetic is exact.
	xml := `<rules><rule name="mean">
	  <variables><var name="m" formula="AVG(TAG(&quot;vibration1&quot;, &quot;temperature&quot;), 10s)"/></variables>
	  <cond expr="m &gt; 50" description="Mean above 50"/>
	  <actions><publish topic="t" payload="{}"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())

	// Nine readings of 10, then one of 100. The mean of the readings is 19.
	// The mean of the two values that appeared is 55.
	for i := 0; i < 9; i++ {
		e.Eval(values(10.0, false, 0, "", 0, 0.0), t0.Add(time.Duration(i)*time.Second))
	}
	actions, _ := e.Eval(values(100.0, false, 0, "", 0, 0.0), t0.Add(9*time.Second))
	if len(actions) != 0 {
		t.Errorf("the rule fired, so the mean read above 50: %+v", actions)
	}

	// Raise it far enough that the mean of the readings crosses 50 too, so
	// the test cannot pass by never firing.
	for i := 10; i < 19; i++ {
		e.Eval(values(100.0, false, 0, "", 0, 0.0), t0.Add(time.Duration(i)*time.Second))
	}
	actions, _ = e.Eval(values(100.0, false, 0, "", 0, 0.0), t0.Add(19*time.Second))
	if len(actions) != 1 {
		t.Errorf("a window of ten readings of 100 must have a mean above 50: %+v", actions)
	}
}

// EdgeNone means "every evaluation where the condition is true, subject to the
// cooldown". A rule was only evaluated when one of its inputs moved, so a
// steady input made such a rule fire once and then go quiet, whatever its
// cooldown said.
func TestARuleWithoutARisingEdgeKeepsFiring(t *testing.T) {
	xml := `<rules><rule name="loud" cooldown="10s">
	  <cond expr="TAG(&quot;pump1&quot;, &quot;error_code&quot;) &lt;&gt; 0" description="A fault"/>
	  <actions><publish topic="alerts/loud" payload="{}"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())

	// The code goes non-zero once and never moves again.
	fired := 0
	for i := 0; i <= 60; i++ {
		actions, _ := e.Eval(values(0.0, false, 0, "", 3, 0.0), t0.Add(time.Duration(i)*time.Second))
		fired += len(actions)
	}
	// Sixty seconds, a ten second cooldown: the first evaluation and then one
	// every ten seconds.
	if fired < 6 {
		t.Errorf("fired %d times in a minute, want one every ten seconds", fired)
	}
}

// A rule re-arms its rising edge when the row that made it true is a pulse,
// because a pulse is never seen as false and would otherwise fire once and
// stay silent. It must not re-arm for a row that is a level: a rule with a
// pulse row somewhere else used to re-fire once per cooldown, for ever.
func TestARisingRuleWithAPulseRowElsewhereFiresOnce(t *testing.T) {
	xml := `<rules><rule name="mixed" edge="rising" cooldown="45s">
	  <or>
	    <cond expr="TAG(&quot;vibration1&quot;, &quot;temperature&quot;) &gt; 50" description="The level"/>
	    <cond expr="CHANGED(TAG(&quot;vibration1&quot;, &quot;state&quot;))" description="The pulse"/>
	  </or>
	  <actions><publish topic="t" payload="{}"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())

	// The temperature climbs every second, so the rule is evaluated every
	// second. It crosses 50 once and stays above it. Nothing pulses.
	fired := 0
	for i := 0; i <= 300; i++ {
		temp := 40.0 + float64(i)/10
		actions, _ := e.Eval(values(temp, false, 0, "s", 0, 0.0), t0.Add(time.Duration(i)*time.Second))
		fired += len(actions)
	}
	if fired != 1 {
		t.Errorf("fired %d times, want once: the level rose once", fired)
	}
}

// The pulse row still re-arms, which is what the re-arm is for.
func TestAPulseRowStillFiresOnEveryPulse(t *testing.T) {
	xml := `<rules><rule name="pulse" edge="rising">
	  <cond expr="CHANGED(TAG(&quot;vibration1&quot;, &quot;state&quot;))" description="The pulse"/>
	  <actions><publish topic="t" payload="{}"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	fired := 0
	for i := 0; i <= 10; i++ {
		state := "a"
		if i%2 == 1 {
			state = "b"
		}
		actions, _ := e.Eval(values(0.0, false, 0, state, 0, 0.0), t0.Add(time.Duration(i)*time.Second))
		fired += len(actions)
	}
	if fired < 5 {
		t.Errorf("fired %d times, want one per change", fired)
	}
}
