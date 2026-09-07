// Package rules is the rule engine of the octaview Edge Hub. A service builds
// a Catalog of the fields it decodes, loads a rules.xml file with Load, and
// evaluates the rules with an Engine against a flat array of slot values.
//
//	cat := rules.Catalog{Fields: fields, Sources: names, TopicPrefix: "modbus", Period: time.Second}
//	parsed, problems := rules.Load(data, cat)
//	eng := rules.NewEngine(parsed, cat)
//	actions, incidents := eng.Eval(values, time.Now())
//
// The engine is not safe for concurrent use: one goroutine owns the slot
// array and calls Eval. It never logs; everything worth a log line is a
// counter in Stats.
package rules

import (
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// Type is the value type of a field, named as JSON Schema names it.
type Type uint8

const (
	// Unknown is a field whose type the service could not name. A condition
	// on it still loads, and every comparison decides at run time.
	Unknown Type = iota
	Bool
	Integer
	Number
	String
)

// String names a type as the configuration and the discovery message name it.
func (t Type) String() string {
	switch t {
	case Bool:
		return "boolean"
	case Integer:
		return "integer"
	case Number:
		return "number"
	case String:
		return "string"
	}
	return "unknown"
}

// TypeFromJSONSchema maps a JSON Schema type name to a Type. The driver
// discovery of every service produces these names.
func TypeFromJSONSchema(name string) (Type, bool) {
	switch name {
	case "boolean":
		return Bool, true
	case "integer":
		return Integer, true
	case "number":
		return Number, true
	case "string":
		return String, true
	}
	return Unknown, false
}

// formulaType maps a field type to the type the formula checks against.
func (t Type) formulaType() formula.Type {
	switch t {
	case Bool:
		return formula.TypeBool
	case Integer, Number:
		return formula.TypeNumber
	case String:
		return formula.TypeString
	}
	return formula.TypeAny
}

// Field is one value a service exposes to rules. Device is empty for a
// service with one implicit source, such as a single PLC.
type Field struct {
	Device string
	Tag    string
	Type   Type
}

// Catalog is what the service knows at startup. Slot i of the value array
// passed to Eval holds the value of Fields[i].
type Catalog struct {
	// Fields are the readable values, in slot order.
	Fields []Field
	// Sources are the names an <incident source> may use, usually the device
	// names of the configuration.
	Sources []string
	// SourceIDs is optional. SourceIDs[i] is the identity of Sources[i], the
	// name the service already publishes for that device in its discovery
	// message and its status topic. A service that lets a device override its
	// topic passes them here, so an alert and the device carry one name
	// (ADR-021). When the field is empty the engine builds the identity from
	// TopicPrefix instead.
	SourceIDs []string
	// TopicPrefix builds the incident source ID as TopicPrefix + "/" + source.
	// An empty prefix makes the source ID the source itself, which keeps the
	// identity a single-source service already publishes. SourceIDs overrides
	// it.
	TopicPrefix string
	// Period is the expected time between two Eval calls. It sizes the time
	// windows, and a rule that uses a time function needs it.
	Period time.Duration
}

// Problem is one fault in a rules file, structural or bound to this service.
// Path locates it in the document, in the form
// rules/rule[2]/and/cond[1]@expr.
type Problem struct {
	Path    string
	Rule    string
	Message string
}

// String renders a problem for a log line or a test.
func (p Problem) String() string {
	if p.Rule == "" {
		return p.Path + ": " + p.Message
	}
	return p.Path + " (rule " + p.Rule + "): " + p.Message
}

// maxWindows and maxChangedStates bound the memory one file can ask for.
const (
	maxWindows       = 256
	maxEwmas         = 256
	maxChangedStates = 4096
)

// binder resolves the names of a formula against a catalog, and reserves the
// windows and the CHANGED states the file needs. It implements
// formula.Resolver.
type binder struct {
	index   map[fieldKey]int
	types   []Type
	windows []formula.WindowSpec
	ewmas   []formula.EwmaSpec
	states  int
}

// fieldKey addresses one field of the catalog.
type fieldKey struct {
	device string
	tag    string
}

// newBinder indexes a catalog, and reports a field that appears twice.
func newBinder(cat Catalog) (*binder, []Problem) {
	b := &binder{index: make(map[fieldKey]int, len(cat.Fields)), types: make([]Type, len(cat.Fields))}
	var problems []Problem
	for i := 0; i < len(cat.Fields); i++ {
		f := cat.Fields[i]
		key := fieldKey{device: f.Device, tag: f.Tag}
		if _, seen := b.index[key]; seen {
			problems = append(problems, Problem{
				Path:    "catalog",
				Message: "the field " + fieldWords(f.Device, f.Tag) + " appears twice in the catalog",
			})
			continue
		}
		b.index[key] = i
		b.types[i] = f.Type
	}
	problems = append(problems, checkSourceIDs(cat)...)
	return b, problems
}

// checkSourceIDs holds the optional identities to one per source. A wrong
// length is a programming fault in the service, and an empty identity would
// make an incident nameless, so both stop the load.
func checkSourceIDs(cat Catalog) []Problem {
	if len(cat.SourceIDs) == 0 {
		return nil
	}
	if len(cat.SourceIDs) != len(cat.Sources) {
		return []Problem{{
			Path: "catalog",
			Message: "the catalog carries " + itoa(len(cat.SourceIDs)) +
				" source identities for " + itoa(len(cat.Sources)) +
				" sources: pass one identity per source, or none at all",
		}}
	}
	var problems []Problem
	for i := 0; i < len(cat.SourceIDs); i++ {
		if cat.SourceIDs[i] == "" {
			problems = append(problems, Problem{
				Path:    "catalog",
				Message: "the identity of source " + quote(cat.Sources[i]) + " is empty",
			})
		}
	}
	return problems
}

// fieldWords names a field for a message.
func fieldWords(device, tag string) string {
	if device == "" {
		return `"` + tag + `"`
	}
	return `"` + tag + `" of device "` + device + `"`
}

// Slot resolves a field to its slot.
func (b *binder) Slot(device, tag string) (int, formula.Type, bool) {
	i, ok := b.index[fieldKey{device: device, tag: tag}]
	if !ok {
		return 0, formula.TypeAny, false
	}
	return i, b.types[i].formulaType(), true
}

// Window reserves the ring of one slot and one duration, once per pair.
func (b *binder) Window(slot int, window time.Duration) (int, bool) {
	for i := 0; i < len(b.windows); i++ {
		if b.windows[i].Slot == slot && b.windows[i].Window == window {
			return i, true
		}
	}
	if len(b.windows) >= maxWindows {
		return 0, false
	}
	b.windows = append(b.windows, formula.WindowSpec{Slot: slot, Window: window})
	return len(b.windows) - 1, true
}

// EWMAState reserves the one number of a smoothed value, once per pair of a
// slot and a time constant.
func (b *binder) EWMAState(slot int, tau time.Duration) (int, bool) {
	for i := 0; i < len(b.ewmas); i++ {
		if b.ewmas[i].Slot == slot && b.ewmas[i].Tau == tau {
			return i, true
		}
	}
	if len(b.ewmas) >= maxEwmas {
		return 0, false
	}
	b.ewmas = append(b.ewmas, formula.EwmaSpec{Slot: slot, Tau: tau})
	return len(b.ewmas) - 1, true
}

// ChangedState reserves the memory of one CHANGED node.
func (b *binder) ChangedState() (int, bool) {
	if b.states >= maxChangedStates {
		return 0, false
	}
	b.states++
	return b.states - 1, true
}

// hasImplicitSource reports whether the catalog holds a field with no device,
// which is what a bare TAG("x") or a <cond> without a device needs.
func (b *binder) hasImplicitSource() bool {
	for key := range b.index {
		if key.device == "" {
			return true
		}
	}
	return false
}
