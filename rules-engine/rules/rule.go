package rules

import (
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// row is one condition row of a rule: a compiled formula and the description
// an operator gave it. A Then field can quote that description.
type row struct {
	prog        *formula.Program
	description string
	// pulse is true when the row reads CHANGED. Such a row is true only in
	// the evaluation where its input moved, and is never seen as false, so a
	// rule that fires on it has to re-arm its edge.
	pulse bool
}

// thenField is a topic, a payload or an incident text. It is literal text, or
// a formula the engine renders when the rule fires.
type thenField struct {
	literal string
	prog    *formula.Program
}

// action is one publish of a rule.
type action struct {
	topic   thenField
	payload thenField
}

// incidentConfig is the <incident> of a rule, bound to the service.
type incidentConfig struct {
	source    thenField
	sourceID  string // the resolved source ID, when source is literal text
	dedupKey  string // sourceID + "-" + rule name, when source is literal text
	severity  string
	summary   thenField
	firstStep thenField
	cause     thenField
	isFormula bool // source is a formula, so the key is rendered per trigger
}

// Rule is one rule of a file, bound to a catalog and ready to evaluate.
type Rule struct {
	Name     string
	Edge     EdgeType
	Cooldown time.Duration

	rows     []row
	matchAll bool // the rows are combined with and, not or
	actions  []action
	incident *incidentConfig

	fieldRefs   []int // slots the conditions read
	windows     []int // windows the rule reads
	hasTime     bool  // a condition contains STALE, RATE or AVG
	needsBuffer bool  // a Then field is a formula and renders into the buffer

	// State, owned by the engine.
	prev      bool
	seen      bool
	active    bool
	lastFired time.Time
	dedupKey  string // the key of the open incident, when source is a formula
	buf       []byte
	bufLen    int
}

// HasActions reports whether the rule publishes anything.
func (r *Rule) HasActions() bool { return len(r.actions) > 0 }

// HasIncident reports whether the rule raises an incident.
func (r *Rule) HasIncident() bool { return r.incident != nil }

// FieldRefs are the slots the rule's conditions read.
func (r *Rule) FieldRefs() []int { return r.fieldRefs }

// bufferSize is the room one rule has for its rendered Then fields.
const bufferSize = 4096

// maxSummaryRunes is the length of an incident summary, as the schema fixes
// it. A rendered summary is cut to it.
const maxSummaryRunes = 120
