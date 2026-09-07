package rules

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"strings"

	"github.com/o16s/rules-editor/rules-engine/rulesxml"
)

// maxFileBytes bounds the document Load reads.
const maxFileBytes = 1 << 20

// node is one element of the document, with its attributes and its children
// in document order. encoding/xml drops the order when it unmarshals into
// named fields, and the order of the actions is part of the contract.
type node struct {
	XMLName  xml.Name
	Attrs    []xml.Attr `xml:",any,attr"`
	Children []node     `xml:",any"`
}

// attr reads one attribute, and says whether it was there.
func (n *node) attr(name string) (string, bool) {
	for i := 0; i < len(n.Attrs); i++ {
		if n.Attrs[i].Name.Local == name {
			return n.Attrs[i].Value, true
		}
	}
	return "", false
}

// Load reads a rules file and binds it to the catalog of a service.
//
// It validates the structure first, then resolves every name and compiles
// every formula, and reports every problem it finds. A non-empty problem list
// means no rule was built: a file is loaded whole or not at all.
func Load(data []byte, cat Catalog) ([]Rule, []Problem) {
	if len(data) > maxFileBytes {
		return nil, []Problem{{Path: "rules", Message: "the rules file is larger than " + itoa(maxFileBytes) + " bytes"}}
	}
	if problems := structure(data); len(problems) > 0 {
		return nil, problems
	}
	bind, problems := newBinder(cat)
	if len(problems) > 0 {
		return nil, problems
	}
	var root node
	dec := xml.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(&root); err != nil {
		return nil, []Problem{{Path: "rules", Message: "malformed XML: " + err.Error()}}
	}
	l := &loader{cat: cat, bind: bind}
	rules := make([]Rule, 0, len(root.Children))
	for i := 0; i < len(root.Children); i++ {
		child := &root.Children[i]
		if child.XMLName.Local != "rule" {
			continue
		}
		rule := l.rule(child, "rules/rule["+itoa(i+1)+"]")
		rules = append(rules, rule)
	}
	if len(l.problems) > 0 {
		return nil, l.problems
	}
	return rules, nil
}

// structure runs the shared structural validation and maps its problems.
func structure(data []byte) []Problem {
	found := rulesxml.Validate(bytes.NewReader(data))
	if len(found) == 0 {
		return nil
	}
	out := make([]Problem, 0, len(found))
	for i := 0; i < len(found); i++ {
		out = append(out, Problem{Path: found[i].Path, Message: found[i].Message})
	}
	return out
}

// Parse is Load for a caller that wants one error, such as a test. Every
// problem is on its own line.
func Parse(r io.Reader, cat Catalog) ([]Rule, error) {
	if r == nil {
		return nil, errors.New("rules: nil reader")
	}
	data, err := io.ReadAll(io.LimitReader(r, maxFileBytes+1))
	if err != nil {
		return nil, err
	}
	rules, problems := Load(data, cat)
	if len(problems) == 0 {
		return rules, nil
	}
	var b strings.Builder
	for i := 0; i < len(problems); i++ {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(problems[i].String())
	}
	return nil, errors.New(b.String())
}

// loader carries the state of one Load.
type loader struct {
	cat      Catalog
	bind     *binder
	problems []Problem
	ruleName string // the rule being bound, for the problem list
}

// fail records one problem.
func (l *loader) fail(path, message string) {
	if len(l.problems) < rulesxml.MaxProblems {
		l.problems = append(l.problems, Problem{Path: path, Rule: l.ruleName, Message: message})
	}
}

// failAll records the problems of one formula.
func (l *loader) failAll(path string, messages []string) {
	for i := 0; i < len(messages); i++ {
		l.fail(path, messages[i])
	}
}
