package rules

import (
	"strings"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// actions binds the publish actions of a rule, in document order.
func (l *loader) actions(r *Rule, n *node, path string, vars map[string]*formula.Node) {
	for i := 0; i < len(n.Children); i++ {
		if n.Children[i].XMLName.Local != "actions" {
			continue
		}
		block := &n.Children[i]
		for j := 0; j < len(block.Children); j++ {
			p := &block.Children[j]
			at := path + "/actions/publish[" + itoa(j+1) + "]"
			topic, _ := p.attr("topic")
			payload, hasPayload := p.attr("payload")
			if !hasPayload || payload == "" {
				payload = "{}"
			}
			act := action{
				topic:   l.thenField(topic, at+"@topic", vars),
				payload: l.thenField(payload, at+"@payload", vars),
			}
			if act.topic.prog == nil {
				l.checkTopic(act.topic.literal, at+"@topic")
			}
			r.actions = append(r.actions, act)
		}
	}
}

// incident binds the <incident> of a rule.
func (l *loader) incident(r *Rule, n *node, path string, vars map[string]*formula.Node) {
	for i := 0; i < len(n.Children); i++ {
		if n.Children[i].XMLName.Local != "incident" {
			continue
		}
		e := &n.Children[i]
		at := path + "/incident"
		source, _ := e.attr("source")
		severity, _ := e.attr("severity")
		summary, _ := e.attr("summary")
		firstStep, _ := e.attr("first_step")
		cause, _ := e.attr("cause")

		cfg := &incidentConfig{
			source:    l.thenField(source, at+"@source", vars),
			severity:  severity,
			summary:   l.thenField(summary, at+"@summary", vars),
			firstStep: l.thenField(firstStep, at+"@first_step", vars),
			cause:     l.thenField(cause, at+"@cause", vars),
		}
		cfg.isFormula = cfg.source.prog != nil
		if !cfg.isFormula {
			if !l.knownSource(cfg.source.literal) {
				l.fail(at+"@source", "unknown source "+quote(cfg.source.literal)+
					": it must name a device this service publishes")
				continue
			}
			cfg.sourceID = l.sourceID(cfg.source.literal)
			cfg.dedupKey = cfg.sourceID + "-" + r.Name
		}
		r.incident = cfg
	}
	if r.incident == nil && len(r.actions) == 0 {
		l.fail(path, "the rule has neither an action nor an incident the engine can run")
	}
}

// knownSource reports whether a source names a device of this service.
func (l *loader) knownSource(source string) bool {
	for i := 0; i < len(l.cat.Sources); i++ {
		if l.cat.Sources[i] == source {
			return true
		}
	}
	return false
}

// sourceID builds the identity of an incident source. An empty topic prefix
// means the source is the identity, which keeps the key a single-source
// service already publishes (ADR-006).
func (l *loader) sourceID(source string) string {
	if l.cat.TopicPrefix == "" {
		return source
	}
	return l.cat.TopicPrefix + "/" + source
}

// thenField reads one Then attribute: a formula when it starts with "=", and
// literal text otherwise.
func (l *loader) thenField(text, path string, vars map[string]*formula.Node) thenField {
	if !strings.HasPrefix(text, "=") {
		return thenField{literal: text}
	}
	parsed, err := formula.Parse(text)
	if err != nil {
		l.fail(path, formulaFault(err))
		return thenField{}
	}
	prog, problems := formula.Compile(parsed, vars, l.bind, true)
	if len(problems) > 0 {
		l.failAll(path, problems)
		return thenField{}
	}
	return thenField{prog: prog}
}

// checkTopic refuses a topic MQTT cannot publish to.
func (l *loader) checkTopic(topic, path string) {
	if topic == "" {
		l.fail(path, "topic must not be empty")
		return
	}
	if strings.ContainsAny(topic, "+#") {
		l.fail(path, "a publish topic must not contain + or #, which are subscription wildcards")
		return
	}
	if len(topic) > maxTopicBytes {
		l.fail(path, "the topic is longer than "+itoa(maxTopicBytes)+" bytes")
	}
}

// maxTopicBytes is the length of an MQTT topic name.
const maxTopicBytes = 65535

// quote wraps a value in double quotes for a message.
func quote(s string) string { return `"` + s + `"` }
