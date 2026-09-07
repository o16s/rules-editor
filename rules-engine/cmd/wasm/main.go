//go:build js && wasm

// Command wasm is the rule engine compiled for the browser. The editor's
// Simulator page runs it, so what an operator sees before deploying a file is
// the same code the gateway runs, not a second reading of the same rules.
//
// It exposes one function on the global object:
//
//	octaviewRulesSimulate(requestJSON string) string
//
// The request carries the fields the service decodes, one reading per field
// per step, and the rule as a rules.xml document. The response carries the
// value of every variable and every condition at every step, what the rule
// fired, and any problem the file has.
package main

import (
	"encoding/json"
	"syscall/js"
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
	"github.com/o16s/rules-editor/rules-engine/rules"
)

func main() {
	js.Global().Set("octaviewRulesSimulate", js.FuncOf(simulate))
	js.Global().Set("octaviewRulesEngineReady", js.ValueOf(true))
	select {} // the module stays alive for the page to call into
}

// field is one value the service decodes.
type field struct {
	Device string `json:"device"`
	Tag    string `json:"tag"`
	Type   string `json:"type"`
}

// step is one moment of the run: the time, and one reading per field.
type step struct {
	TMs    int64 `json:"tMs"`
	Values []any `json:"values"`
}

// named is one formula the page draws a line for.
type named struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

type request struct {
	PeriodMs  int64   `json:"periodMs"`
	Fields    []field `json:"fields"`
	Steps     []step  `json:"steps"`
	Variables []named `json:"variables"`
	Rows      []named `json:"rows"`
	// RuleXML is the whole file, with this one rule in it. An empty document
	// means the page only wants the lines, not the firing.
	RuleXML string `json:"ruleXml"`
}

// series is one line of the timeline.
type series struct {
	Name    string `json:"name"`
	Values  []any  `json:"values"`
	Problem string `json:"problem,omitempty"`
}

// firing is one moment where the rule fired, with what it published.
type firing struct {
	Index     int      `json:"index"`
	Actions   []string `json:"actions"`
	Incidents []string `json:"incidents"`
}

type response struct {
	Variables []series      `json:"variables"`
	Rows      []series      `json:"rows"`
	Result    []any         `json:"result"`
	Firings   []firing      `json:"firings"`
	Problems  []probeReport `json:"problems"`
	Error     string        `json:"error,omitempty"`
}

// probeReport is one fault in the file, in the words the service logs.
type probeReport struct {
	Path    string `json:"path"`
	Rule    string `json:"rule"`
	Message string `json:"message"`
}

// simulate is the function the page calls. It never panics into JavaScript: a
// fault comes back as a message in the response.
func simulate(this js.Value, args []js.Value) (out any) {
	defer func() {
		if r := recover(); r != nil {
			out = mustJSON(response{Error: "the engine could not run this rule."})
		}
	}()
	if len(args) != 1 {
		return mustJSON(response{Error: "the engine takes one request."})
	}
	var req request
	if err := json.Unmarshal([]byte(args[0].String()), &req); err != nil {
		return mustJSON(response{Error: "the request is not readable: " + err.Error()})
	}
	return mustJSON(run(req))
}

func mustJSON(v any) string {
	out, err := json.Marshal(v)
	if err != nil {
		return `{"error":"the engine could not write its answer."}`
	}
	return string(out)
}

// catalogOf builds the catalog the way a service builds it at startup.
func catalogOf(req request) rules.Catalog {
	period := time.Duration(req.PeriodMs) * time.Millisecond
	if period <= 0 {
		period = time.Second
	}
	cat := rules.Catalog{TopicPrefix: "sim", Period: period}
	seen := make(map[string]bool, len(req.Fields))
	for _, f := range req.Fields {
		typ, _ := rules.TypeFromJSONSchema(f.Type)
		cat.Fields = append(cat.Fields, rules.Field{Device: f.Device, Tag: f.Tag, Type: typ})
		if f.Device != "" && !seen[f.Device] {
			seen[f.Device] = true
			cat.Sources = append(cat.Sources, f.Device)
		}
	}
	if len(cat.Sources) == 0 {
		cat.Sources = []string{"sim"}
	}
	return cat
}

// run answers one request: the lines of the timeline, and what the rule fired.
func run(req request) response {
	cat := catalogOf(req)
	res := response{
		Variables: make([]series, 0, len(req.Variables)),
		Rows:      make([]series, 0, len(req.Rows)),
		Result:    make([]any, 0, len(req.Steps)),
		Firings:   make([]firing, 0, 8),
		Problems:  make([]probeReport, 0, 4),
	}

	lines, err := newProbe(cat, req)
	if err != "" {
		res.Error = err
		return res
	}
	eng, problems := newEngine(cat, req.RuleXML)
	for _, p := range problems {
		res.Problems = append(res.Problems, probeReport{Path: p.Path, Rule: p.Rule, Message: p.Message})
	}

	values := make([]any, len(cat.Fields))
	base := time.Unix(0, 0).UTC()
	for i := range req.Steps {
		now := base.Add(time.Duration(req.Steps[i].TMs) * time.Millisecond)
		copyReadings(values, req.Steps[i].Values)
		lines.step(values, now)
		res.Result = append(res.Result, lines.result())
		if eng != nil {
			collectFiring(&res, eng, values, now, i)
		}
	}
	lines.finish(&res)
	return res
}

// copyReadings writes one step's readings into the slot array, and unsets a
// slot the step does not carry.
func copyReadings(dst []any, src []any) {
	for i := range dst {
		if i < len(src) {
			dst[i] = src[i]
			continue
		}
		dst[i] = nil
	}
}

// newEngine loads the rule file. A file with a problem gives no engine, and
// the page still draws its lines.
func newEngine(cat rules.Catalog, xml string) (*rules.Engine, []rules.Problem) {
	if xml == "" {
		return nil, nil
	}
	parsed, problems := rules.Load([]byte(xml), cat)
	if len(problems) > 0 || len(parsed) == 0 {
		return nil, problems
	}
	return rules.NewEngine(parsed, cat), nil
}

// collectFiring records what the engine published at one step.
func collectFiring(res *response, eng *rules.Engine, values []any, now time.Time, index int) {
	actions, incidents := eng.Eval(values, now)
	if len(actions) == 0 && len(incidents) == 0 {
		return
	}
	f := firing{Index: index}
	for i := range actions {
		f.Actions = append(f.Actions, actions[i].Topic+" "+string(actions[i].Payload))
	}
	for i := range incidents {
		msg := incidents[i].Message(now)
		if !incidents[i].Trigger {
			f.Incidents = append(f.Incidents, "resolve "+msg.DedupKey)
			continue
		}
		f.Incidents = append(f.Incidents, msg.Severity+" "+msg.Summary)
	}
	res.Firings = append(res.Firings, f)
}

// jsValue renders one engine value for the page. Unknown is null, which is
// what the timeline draws as a gap.
func jsValue(v formula.Value) any {
	switch v.Kind {
	case formula.VBool:
		return v.B
	case formula.VNumber:
		return v.Float()
	case formula.VInt:
		if i, ok := v.Int(); ok {
			return i
		}
		return nil
	case formula.VString:
		return v.S
	}
	return nil
}
