package rules

import (
	"strings"
	"testing"
	"time"
)

func TestRenderThenFields(t *testing.T) {
	xml := `<rules><rule name="temp-report">
	  <variables><var name="temp" formula="TAG(&quot;vibration1&quot;, &quot;temperature&quot;)"/></variables>
	  <cond expr="temp &gt; 80" description="Temperature more than 80"/>
	  <actions><publish topic="alerts/temp" payload='="{""temp"":" &amp; temp &amp; "}"'/></actions>
	  <incident source="vibration1" severity="warning" summary="=condition.description &amp; &quot; on vibration1&quot;"/>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	actions, incidents := e.Eval(values(85.5, false, 0, "", 0, 0.0), t0)
	if len(actions) != 1 || len(incidents) != 1 {
		t.Fatalf("actions = %+v, incidents = %+v", actions, incidents)
	}
	if got := string(actions[0].Payload); got != `{"temp":85.5}` {
		t.Errorf("payload = %q", got)
	}
	if got := incidents[0].Summary; got != "Temperature more than 80 on vibration1" {
		t.Errorf("summary = %q", got)
	}
}

func TestRenderTheDescriptionOfTheRowThatFired(t *testing.T) {
	xml := `<rules><rule name="any">
	  <or>
	    <cond expr="TAG(&quot;pump1&quot;, &quot;error_code&quot;) != 0" description="Pump fault"/>
	    <cond expr="TAG(&quot;vibration1&quot;, &quot;temperature&quot;) &gt; 50" description="Housing hot"/>
	  </or>
	  <incident source="pump1" severity="warning" summary="=condition.description"/>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	e.Eval(values(20.0, false, 0, "", 0, 0.0), t0)
	// Only the second row is true, so its description is the context.
	_, incidents := e.Eval(values(60.0, false, 0, "", 0, 0.0), t0.Add(time.Second))
	if len(incidents) != 1 || incidents[0].Summary != "Housing hot" {
		t.Fatalf("incidents = %+v", incidents)
	}
}

func TestRenderCutsALongSummary(t *testing.T) {
	// The schema bounds the source text of a summary at 120 characters, so a
	// long summary can only come from a field. The engine cuts what it
	// renders to the same limit.
	xml := `<rules><rule name="r">
	  <cond expr="TAG(&quot;vibration1&quot;, &quot;temperature&quot;) &gt; 1"/>
	  <incident source="vibration1" severity="info" summary='=TAG("vibration1", "state")'/>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	long := strings.Repeat("x", 200)
	_, incidents := e.Eval(values(50.0, false, 0, long, 0, 0.0), t0)
	if len(incidents) != 1 {
		t.Fatalf("incidents = %+v", incidents)
	}
	if n := len([]rune(incidents[0].Summary)); n != maxSummaryRunes {
		t.Errorf("summary is %d characters, want it cut to %d", n, maxSummaryRunes)
	}
}

func TestRenderTruncatesAtTheBuffer(t *testing.T) {
	// Many long actions exhaust the buffer of the rule. The engine counts the
	// truncation instead of growing.
	long := strings.Repeat("y", 500)
	body := ""
	for i := 0; i < 12; i++ {
		body += `<publish topic="t` + itoa(i) + `" payload='=TAG("vibration1", "state")'/>`
	}
	xml := `<rules><rule name="r">
	  <cond expr="TAG(&quot;vibration1&quot;, &quot;temperature&quot;) &gt; 1"/>
	  <actions>` + body + `</actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	e.Eval(values(50.0, false, 0, long, 0, 0.0), t0)
	if e.Stats().TruncatedRenders == 0 {
		t.Error("a render that does not fit must be counted")
	}
}

func TestRenderDropsAnActionWithoutAUsableTopic(t *testing.T) {
	xml := `<rules><rule name="r">
	  <cond expr="TAG(&quot;vibration1&quot;, &quot;temperature&quot;) &gt; 1"/>
	  <actions><publish topic="=&quot;&quot;"/></actions>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	actions, _ := e.Eval(values(50.0, false, 0, "", 0, 0.0), t0)
	if len(actions) != 0 {
		t.Fatalf("an empty rendered topic must drop the action: %+v", actions)
	}
	if e.Stats().DroppedActions != 1 {
		t.Errorf("dropped actions = %d, want 1", e.Stats().DroppedActions)
	}
}

func TestRenderFormulaSourceKeepsOneKeyPerIncident(t *testing.T) {
	xml := `<rules><rule name="fault">
	  <cond expr="TAG(&quot;pump1&quot;, &quot;error_code&quot;) != 0"/>
	  <incident source="=&quot;pump&quot; &amp; 1" severity="error" summary="fault"/>
	</rule></rules>`
	e := engineFor(t, xml, testCatalog())
	e.Eval(values(0.0, false, 0, "", 0, 0.0), t0)
	_, incidents := e.Eval(values(0.0, false, 0, "", 5, 0.0), t0.Add(time.Second))
	if len(incidents) != 1 || incidents[0].DedupKey != "pump1-fault" {
		t.Fatalf("trigger = %+v", incidents)
	}
	_, incidents = e.Eval(values(0.0, false, 0, "", 0, 0.0), t0.Add(2*time.Second))
	if len(incidents) != 1 || incidents[0].DedupKey != "pump1-fault" {
		t.Fatalf("the resolve must close the key of the trigger: %+v", incidents)
	}
}
