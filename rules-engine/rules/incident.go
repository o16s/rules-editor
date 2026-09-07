package rules

import "time"

// IncidentTopic is the MQTT topic every incident is published to.
const IncidentTopic = "incidents/"

// incidentTimeFormat is ISO 8601 UTC with millisecond precision.
const incidentTimeFormat = "2006-01-02T15:04:05.000Z07:00"

// EdgeType controls when a rule fires relative to its condition result.
type EdgeType uint8

const (
	// EdgeNone fires on every evaluation where the condition is true, subject
	// to the cooldown.
	EdgeNone EdgeType = iota
	// EdgeRising fires on the change from false to true.
	EdgeRising
)

// Action is one MQTT publish a rule asks for. Rule names the rule that owns
// it, so a published action traces back without a second lookup.
//
// Topic and Payload may point into a buffer the engine reuses. They are valid
// until the next Eval or Reset call.
type Action struct {
	Rule    string
	Topic   string
	Payload []byte
}

// Incident is one lifecycle event of a rule with an <incident>. Trigger says
// which end of the lifecycle it is; a resolve carries no severity and no
// text.
type Incident struct {
	Rule      string
	Trigger   bool
	Source    string
	DedupKey  string
	Severity  string
	Summary   string
	FirstStep string
	Cause     string
}

// IncidentMsg is the wire form of an incident, as the forwarder reads it.
type IncidentMsg struct {
	Action    string         `json:"action"`
	DedupKey  string         `json:"dedup_key"`
	Source    string         `json:"source"`
	Severity  string         `json:"severity,omitempty"`
	Summary   string         `json:"summary,omitempty"`
	FirstStep string         `json:"first_step,omitempty"`
	Cause     string         `json:"cause,omitempty"`
	Time      string         `json:"time"`
	Data      map[string]any `json:"data"`
}

// Message builds the wire form. It allocates, so the engine never calls it:
// the service does, once per incident it publishes.
func (i Incident) Message(now time.Time) IncidentMsg {
	msg := IncidentMsg{
		Action:   "resolve",
		DedupKey: i.DedupKey,
		Source:   i.Source,
		Time:     now.UTC().Format(incidentTimeFormat),
		Data:     map[string]any{"rule": i.Rule},
	}
	if i.Trigger {
		msg.Action = "trigger"
		msg.Severity = i.Severity
		msg.Summary = i.Summary
		msg.FirstStep = i.FirstStep
		msg.Cause = i.Cause
	}
	return msg
}

// Stats are the counters of one engine since NewEngine. A library must not
// log, so everything worth a log line is counted here and the service reports
// it.
type Stats struct {
	Evals            uint64 // calls to Eval
	RuleEvals        uint64 // rules evaluated
	Firings          uint64 // rules that fired their actions
	Triggers         uint64 // incidents raised
	Resolves         uint64 // incidents closed
	TruncatedRenders uint64 // Then fields that did not fit their buffer
	DroppedActions   uint64 // actions with an unusable rendered topic
	UnknownSlotTypes uint64 // slot values of a type the engine cannot read
	ClockStepsBack   uint64 // evaluations whose time was before the previous one
}
