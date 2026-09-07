package rulesxml

// The rules.xml vocabulary as flat tables. Keeping the schema in fixed-size
// arrays rather than maps means the walk in rulesxml.go allocates nothing per
// element and every lookup is a bounded scan.

// Element kinds. The values index the tables below.
const (
	kRules uint8 = iota
	kRule
	kVariables
	kVar
	kCond
	kAnd
	kOr
	kActions
	kPublish
	kIncident
	kindCount
	kNone = 255 // not a rules.xml element
)

// elementNames maps a kind to its element name.
var elementNames = [kindCount]string{
	kRules: "rules", kRule: "rule", kVariables: "variables", kVar: "var",
	kCond: "cond", kAnd: "and", kOr: "or",
	kActions: "actions", kPublish: "publish", kIncident: "incident",
}

// mask is a set of kinds. It is 16 bits because there are 10 kinds.
type mask uint16

// bit returns the child-mask bit for a kind.
func bit(kind uint8) mask { return 1 << kind }

// allowedChildren is the mask of kinds each element may contain. An element
// with mask 0 is a leaf: any child is a problem.
var allowedChildren = [kindCount]mask{
	kRules:     bit(kRule),
	kRule:      bit(kVariables) | bit(kCond) | bit(kAnd) | bit(kOr) | bit(kActions) | bit(kIncident),
	kVariables: bit(kVar),
	kVar:       0,
	kCond:      0,
	kAnd:       bit(kCond) | bit(kAnd) | bit(kOr),
	kOr:        bit(kCond) | bit(kAnd) | bit(kOr),
	kActions:   bit(kPublish),
	kPublish:   0,
	kIncident:  0,
}

// allowedAttrs lists the attributes each element may carry. Anything else is
// a problem: a misspelled attribute is otherwise silently dropped, which is
// how a rule ends up publishing an empty payload nobody asked for.
var allowedAttrs = [kindCount][]string{
	kRules:     {},
	kRule:      {"name", "cooldown", "edge"},
	kVariables: {},
	kVar:       {"name", "formula", "description"},
	kCond:      {"expr", "description", "device", "tag", "op", "value"},
	kAnd:       {"description"},
	kOr:        {"description"},
	kActions:   {},
	kPublish:   {"topic", "payload"},
	kIncident:  {"source", "severity", "summary", "first_step", "cause"},
}

// indexedIn says, per child kind, which parent kinds give the child an
// occurrence index in its path. A cond inside a group is cond[1]; a cond
// directly under a rule is just cond, because a rule holds exactly one.
var indexedIn = [kindCount]mask{
	kRule:    bit(kRules),
	kVar:     bit(kVariables),
	kCond:    bit(kAnd) | bit(kOr),
	kAnd:     bit(kAnd) | bit(kOr),
	kOr:      bit(kAnd) | bit(kOr),
	kPublish: bit(kActions),
}

// operators is the documented comparison set: the canonical names and the
// symbol aliases. Matched exactly — a stray space is a problem, matching the
// published schema rather than the runtime parser's tolerance.
var operators = [...]string{
	"eq", "neq", "lt", "leq", "gt", "geq", "changed",
	"=", "==", "!=", "<", "<=", ">", ">=",
}

// severities is the incident severity set.
var severities = [...]string{"critical", "error", "warning", "info"}

// edges is the edge-detection set.
var edges = [...]string{"none", "rising"}

// textAttrs are the attributes bounded by MaxText characters.
var textAttrs = [...]string{"description", "first_step", "cause"}

// Limits shared with the rule engine, the editor's model.ts and the published
// XSD. src/xsd.test.ts holds the schema to the same numbers.
const (
	MaxRules       = 1000 // rules per file
	MaxChildren    = 16   // children of one <and>/<or>
	MaxDepth       = 4    // condition levels, counting the leaf <cond>
	MaxVariables   = 64   // <var> elements in one rule
	MaxActions     = 64   // <publish> elements in one rule
	MaxSummaryLen  = 120  // characters in an incident summary
	MaxTextLen     = 240  // characters in description, first_step and cause
	MaxProblems    = 200  // reported problems before the walk gives up
	maxStackDepth  = 9    // rules + rule + 4 condition levels + slack
	maxTokens      = 1 << 18
	maxAttrsPerTag = 32
	maxInputBytes  = 1 << 20
)

// kindOf resolves an element name to its kind, or kNone.
func kindOf(name string) uint8 {
	for k := uint8(0); k < kindCount; k++ {
		if elementNames[k] == name {
			return k
		}
	}
	return kNone
}

// inSet reports whether v is one of the listed values (exact match).
func inSet(v string, set []string) bool {
	for i := 0; i < len(set); i++ {
		if set[i] == v {
			return true
		}
	}
	return false
}

// isIdentifier reports whether s matches the identifier pattern of the
// schema: a letter or underscore, then letters, digits or underscores.
func isIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		alpha := c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
		if alpha {
			continue
		}
		if i > 0 && c >= '0' && c <= '9' {
			continue
		}
		return false
	}
	return true
}
