// Package rulesxml validates the structure of a rules.xml file before the
// rule engine parses it.
//
// internal/rules unmarshals into structs, so it is silently permissive — an
// unknown element, a misspelled attribute or a duplicate rule name is dropped
// without a word — and it stops at the first error it does notice. This
// package walks the document instead and reports every structural fault at
// once, each with a path such as rules/rule[2]/and/cond[1]@value, so an
// operator fixes the whole file in one pass.
//
// It deliberately checks structure only. Whether a cond names a real device
// and whether its value parses as that field's type needs the device set, and
// stays in rules.Parse.
package rulesxml

import (
	"encoding/xml"
	"errors"
	"io"
	"strings"
)

// Problem is one structural fault. Path locates it in the document, in the
// form rules/rule[2]/and/cond[1]@value.
type Problem struct {
	Path    string
	Message string
}

// frame is one open element on the walk stack.
type frame struct {
	kind   uint8
	path   string
	counts [kindCount]int // child occurrences, per kind, for the [n] index
	depth  uint8          // condition nesting level; 0 outside a condition
	phase  uint8          // highest child phase seen, for the order check
	skip   bool           // subtree of an element already reported
}

// validator holds the walk state. It exists so the checks can be split into
// short functions without threading six parameters through each.
type validator struct {
	problems []Problem
	stack    [maxStackDepth]frame
	sp       int
	names    map[string]bool // rule names, unique in the file
	vars     map[string]bool // variable names, unique in the current rule
	rootSeen bool
	full     bool // MaxProblems reached; stop walking
}

// Validate reports every structural problem in a rules.xml document. A nil
// slice means the file is structurally sound. It never returns an error: a
// malformed document is itself a Problem.
func Validate(r io.Reader) []Problem {
	if r == nil {
		return []Problem{{Path: "rules", Message: "no rules document to read"}}
	}
	v := &validator{names: make(map[string]bool, 64), vars: make(map[string]bool, MaxVariables)}
	dec := xml.NewDecoder(io.LimitReader(r, maxInputBytes))
	dec.Strict = true

	for i := 0; i < maxTokens && !v.full; i++ {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			v.add(v.here(), "malformed XML: "+err.Error())
			return v.problems
		}
		v.token(tok)
	}

	if !v.rootSeen {
		v.add("rules", "root element must be <rules>")
	}
	return v.problems
}

// token dispatches one XML token.
func (v *validator) token(tok xml.Token) {
	switch t := tok.(type) {
	case xml.StartElement:
		v.push(t)
	case xml.EndElement:
		v.pop()
	case xml.CharData:
		if v.sp > 0 && strings.TrimSpace(string(t)) != "" {
			v.add(v.here(), "unexpected text")
		}
	}
}

// add records a problem, up to the cap.
func (v *validator) add(path, msg string) {
	if len(v.problems) >= MaxProblems {
		v.full = true
		return
	}
	v.problems = append(v.problems, Problem{Path: path, Message: msg})
}

// here is the path of the innermost open element.
func (v *validator) here() string {
	if v.sp == 0 {
		return "rules"
	}
	return v.stack[v.sp-1].path
}

// push classifies one start element, checks its attributes, and opens a frame.
func (v *validator) push(t xml.StartElement) {
	kind := kindOf(t.Name.Local)

	if v.sp == 0 {
		if kind != kRules || v.rootSeen || t.Name.Space != "" {
			v.add("rules", "root element must be <rules>, got <"+t.Name.Local+">")
			v.full = true
			return
		}
		v.rootSeen = true
		v.open(kind, "rules", 0)
		v.checkAttrs(kind, "rules", t.Attr)
		return
	}

	parent := &v.stack[v.sp-1]
	if parent.skip || v.sp == maxStackDepth {
		v.openSkipped()
		return
	}
	if kind == kNone || t.Name.Space != "" || allowedChildren[parent.kind]&bit(kind) == 0 {
		v.add(parent.path, "unexpected element <"+t.Name.Local+">")
		v.openSkipped()
		return
	}

	parent.counts[kind]++
	path := parent.path + "/" + elementNames[kind]
	if indexedIn[kind]&bit(parent.kind) != 0 {
		path += "[" + itoa(parent.counts[kind]) + "]"
	}

	depth := parent.depth
	if kind == kCond || kind == kAnd || kind == kOr {
		depth++
		if depth > MaxDepth {
			v.add(path, "condition nesting depth exceeds "+itoa(MaxDepth))
		}
	}
	if kind == kRule {
		clear(v.vars)
	}
	if parent.kind == kRule {
		v.checkOrder(parent, kind, path)
	}
	if parent.kind == kRule && (kind == kAnd || kind == kOr) {
		v.checkTopGroup(path, t.Attr)
	}
	v.open(kind, path, depth)
	v.checkAttrs(kind, path, t.Attr)
}

// childPhase orders a rule's children: the variables, the condition, then
// the actions, then the incident. Anything else is not a phase.
func childPhase(kind uint8) uint8 {
	switch kind {
	case kVariables:
		return 1
	case kCond, kAnd, kOr:
		return 2
	case kActions:
		return 3
	case kIncident:
		return 4
	}
	return 0
}

// checkOrder enforces the documented order of a rule's children. The schema
// fixes it and the hub validates uploads against that schema, so a file the
// hub would refuse to save must not be one this service happily runs.
func (v *validator) checkOrder(parent *frame, kind uint8, path string) {
	phase := childPhase(kind)
	if phase == 0 {
		return
	}
	if phase < parent.phase {
		v.add(path, "children of <rule> must appear in the order variables, condition, actions, incident")
		return
	}
	parent.phase = phase
}

// checkTopGroup refuses a description on the rule's top-level group. That
// group is the match mode of the rule, any or all, and it has no row of its
// own to carry the text, so a description there would be lost on the next
// save. A nested group folds into one row and keeps its description.
func (v *validator) checkTopGroup(path string, attrs []xml.Attr) {
	for i := 0; i < len(attrs) && i < maxAttrsPerTag; i++ {
		if attrs[i].Name.Local == "description" {
			v.add(path+"@description", "the top-level group is the match mode and cannot carry a description")
		}
	}
}

// open pushes a frame for a recognised element.
func (v *validator) open(kind uint8, path string, depth uint8) {
	v.stack[v.sp] = frame{kind: kind, path: path, depth: depth}
	v.sp++
}

// openSkipped pushes a placeholder frame so push and pop stay balanced and
// the subtree of an already-reported element is not reported again.
func (v *validator) openSkipped() {
	if v.sp == maxStackDepth {
		return // deeper than the stack: the depth problem is already reported
	}
	v.stack[v.sp] = frame{kind: kNone, path: v.here(), skip: true}
	v.sp++
}

// pop closes the innermost frame and runs the checks that need child counts.
func (v *validator) pop() {
	if v.sp == 0 {
		return
	}
	v.sp--
	f := &v.stack[v.sp]
	if f.skip {
		return
	}
	switch f.kind {
	case kAnd, kOr:
		v.checkGroup(f)
	case kVariables:
		if n := f.counts[kVar]; n > MaxVariables {
			v.add(f.path, "<variables> holds "+itoa(n)+" variables (max "+itoa(MaxVariables)+")")
		}
	case kActions:
		if n := f.counts[kPublish]; n == 0 {
			v.add(f.path, "<actions> needs at least one <publish>")
		} else if n > MaxActions {
			v.add(f.path, "<actions> holds "+itoa(n)+" publish elements (max "+itoa(MaxActions)+")")
		}
	case kRule:
		v.checkRule(f)
	case kRules:
		if n := f.counts[kRule]; n > MaxRules {
			v.add(f.path, "too many rules ("+itoa(n)+" > "+itoa(MaxRules)+")")
		}
	}
}

// checkGroup enforces the child count of one <and>/<or>.
func (v *validator) checkGroup(f *frame) {
	n := f.counts[kCond] + f.counts[kAnd] + f.counts[kOr]
	if n == 0 {
		v.add(f.path, "<"+elementNames[f.kind]+"> has no children")
		return
	}
	if n > MaxChildren {
		v.add(f.path, "<"+elementNames[f.kind]+"> has "+itoa(n)+" children (max "+itoa(MaxChildren)+")")
	}
}

// checkRule enforces one top-level condition and at least one outcome.
func (v *validator) checkRule(f *frame) {
	conds := f.counts[kCond] + f.counts[kAnd] + f.counts[kOr]
	switch {
	case conds == 0:
		v.add(f.path, "rule has no condition element")
	case conds > 1:
		v.add(f.path, "rule must have exactly one top-level condition (got "+itoa(conds)+")")
	}
	if f.counts[kVariables] > 1 {
		v.add(f.path, "rule has more than one <variables> block")
	}
	if f.counts[kActions] > 1 {
		v.add(f.path, "rule has more than one <actions> block")
	}
	if f.counts[kIncident] > 1 {
		v.add(f.path, "rule has more than one <incident>")
	}
	if f.counts[kActions] == 0 && f.counts[kIncident] == 0 {
		v.add(f.path, "rule must have <actions>, <incident>, or both")
	}
}
