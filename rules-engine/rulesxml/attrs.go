package rulesxml

import (
	"encoding/xml"
	"time"
	"unicode/utf8"
)

// checkAttrs validates the attributes of one element: none unknown, none
// repeated, and each value well-formed for its element.
func (v *validator) checkAttrs(kind uint8, path string, attrs []xml.Attr) {
	seen := make([]string, 0, maxAttrsPerTag)
	for i := 0; i < len(attrs) && i < maxAttrsPerTag; i++ {
		name := attrs[i].Name.Local
		at := path + "@" + name
		if attrs[i].Name.Space != "" && attrs[i].Name.Space != "xmlns" {
			v.add(at, "unknown attribute "+name)
			continue
		}
		if !inSet(name, allowedAttrs[kind]) {
			v.add(at, "unknown attribute "+name+" on <"+elementNames[kind]+">")
			continue
		}
		if inSet(name, seen) {
			v.add(at, "repeated attribute "+name)
			continue
		}
		seen = append(seen, name)
		v.checkAttrValue(kind, at, name, attrs[i].Value)
	}
	v.checkRequired(kind, path, seen)
	if kind == kCond {
		v.checkCondForm(path, attrs)
	}
}

// requiredAttrs lists the attributes each element must carry.
//
// A <cond> has none: it carries either expr, or tag and op, and checkCondForm
// reports the combination. A <cond device> is not required either. The shared
// format leaves it optional, because a single-source service publishes one
// device's tags and has nothing to name. A service that needs it says so in
// rules.Load, where the configured device set is available.
var requiredAttrs = [kindCount][]string{
	kRule:     {"name"},
	kVar:      {"name", "formula"},
	kPublish:  {"topic"},
	kIncident: {"source", "severity", "summary"},
}

// checkRequired reports the required attributes that never appeared.
func (v *validator) checkRequired(kind uint8, path string, seen []string) {
	req := requiredAttrs[kind]
	for i := 0; i < len(req); i++ {
		if !inSet(req[i], seen) {
			v.add(path+"@"+req[i], "missing required attribute "+req[i])
		}
	}
}

// checkAttrValue validates one attribute value.
func (v *validator) checkAttrValue(kind uint8, at, name, val string) {
	if inSet(name, textAttrs[:]) {
		v.checkTextLen(at, name, val)
		return
	}
	switch kind {
	case kRule:
		v.checkRuleAttr(at, name, val)
	case kVar:
		v.checkVarAttr(at, name, val)
	case kCond:
		v.checkCondAttr(at, name, val)
	case kPublish:
		if name == "topic" && val == "" {
			v.add(at, "topic must not be empty")
		}
	case kIncident:
		v.checkIncidentAttr(at, name, val)
	}
}

// checkTextLen bounds an operator-facing text attribute.
func (v *validator) checkTextLen(at, name, val string) {
	if n := utf8.RuneCountInString(val); n > MaxTextLen {
		v.add(at, name+" is "+itoa(n)+" characters (max "+itoa(MaxTextLen)+")")
	}
}

// checkRuleAttr validates name, cooldown and edge on a <rule>.
func (v *validator) checkRuleAttr(at, name, val string) {
	switch name {
	case "name":
		if val == "" {
			v.add(at, "name must not be empty")
			return
		}
		if v.names[val] {
			v.add(at, "duplicate rule name "+val)
			return
		}
		v.names[val] = true
	case "cooldown":
		d, err := time.ParseDuration(val)
		if err != nil {
			v.add(at, "cooldown "+quote(val)+" is not a duration such as 30s or 1m30s")
			return
		}
		if d < 0 {
			v.add(at, "cooldown must not be negative")
		}
	case "edge":
		if !inSet(val, edges[:]) {
			v.add(at, "edge must be none or rising")
		}
	}
}

// checkVarAttr validates the name and the formula of a <var>.
func (v *validator) checkVarAttr(at, name, val string) {
	switch name {
	case "name":
		if !isIdentifier(val) {
			v.add(at, "a variable name is letters, digits and underscores, and does not start with a digit")
			return
		}
		if v.vars[val] {
			v.add(at, "duplicate variable name "+val)
			return
		}
		v.vars[val] = true
	case "formula":
		if val == "" {
			v.add(at, "formula must not be empty")
		}
	}
}

// checkCondAttr validates the attributes of a leaf <cond>. Whether a formula
// parses, and whether a device and tag exist, is a binding check in
// rules.Load: neither needs the document alone.
func (v *validator) checkCondAttr(at, name, val string) {
	switch name {
	case "expr", "device", "tag":
		if val == "" {
			v.add(at, name+" must not be empty")
		}
	case "op":
		if !inSet(val, operators[:]) {
			v.add(at, "unknown operator "+quote(val))
		}
	}
}

// checkIncidentAttr validates source, severity and summary.
func (v *validator) checkIncidentAttr(at, name, val string) {
	switch name {
	case "source":
		if val == "" {
			v.add(at, "source must not be empty")
		}
	case "severity":
		if !inSet(val, severities[:]) {
			v.add(at, "severity must be critical, error, warning or info")
		}
	case "summary":
		if val == "" {
			v.add(at, "summary must not be empty")
			return
		}
		if n := utf8.RuneCountInString(val); n > MaxSummaryLen {
			v.add(at, "summary is "+itoa(n)+" characters (max "+itoa(MaxSummaryLen)+")")
		}
	}
}

// condAttrs is the attribute set of one <cond>, as the form check reads it.
type condAttrs struct {
	expr, op, value string
	hasExpr, hasTag bool
	hasOp, hasValue bool
}

// readCondAttrs collects the attributes the form check needs.
func readCondAttrs(attrs []xml.Attr) condAttrs {
	var c condAttrs
	for i := 0; i < len(attrs) && i < maxAttrsPerTag; i++ {
		switch attrs[i].Name.Local {
		case "expr":
			c.expr, c.hasExpr = attrs[i].Value, true
		case "tag":
			c.hasTag = true
		case "op":
			c.op, c.hasOp = attrs[i].Value, true
		case "value":
			c.value, c.hasValue = attrs[i].Value, true
		}
	}
	return c
}

// checkCondForm enforces that a <cond> carries either a formula in expr, or
// the 0.2 form with tag and op, and that every 0.2 operator except changed
// carries a non-empty value. XSD 1.0 cannot express either rule, so the
// editor checks both in code and so does this package.
func (v *validator) checkCondForm(path string, attrs []xml.Attr) {
	c := readCondAttrs(attrs)

	if c.hasExpr {
		if c.hasTag || c.hasOp {
			v.add(path, "a condition carries either expr, or tag and op, not both")
		}
		return
	}
	if !c.hasTag && !c.hasOp {
		v.add(path+"@expr", "a condition needs expr, or tag and op")
		return
	}
	if !c.hasTag {
		v.add(path+"@tag", "missing required attribute tag")
	}
	if !c.hasOp {
		v.add(path+"@op", "missing required attribute op")
		return
	}
	v.checkCondValue(path, c)
}

// checkCondValue enforces the value rule of the 0.2 form.
func (v *validator) checkCondValue(path string, c condAttrs) {
	if c.op == "changed" || !inSet(c.op, operators[:]) {
		// An unrecognised op is already reported; adding "value is required
		// for operator nope" on top of it is noise.
		return
	}
	if !c.hasValue {
		v.add(path+"@value", "value is required for operator "+quote(c.op))
		return
	}
	if c.value == "" {
		v.add(path+"@value", "value must not be empty")
	}
}

// quote wraps a value in double quotes for a message.
func quote(s string) string { return `"` + s + `"` }

// itoa renders a small non-negative int without importing strconv into the
// hot path of the walk.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [12]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 && i > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg && i > 0 {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
