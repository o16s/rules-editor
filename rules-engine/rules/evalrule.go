package rules

import (
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// evalRule evaluates one rule and appends what it fires.
func (e *Engine) evalRule(r *Rule, now time.Time) {
	e.stats.RuleEvals++
	result, description := e.condition(r)

	first := !r.seen
	r.seen = true
	rising := result && (!r.prev || first)
	falling := !result && (r.prev || first)
	r.prev = result

	// A pulse is true only in the cycle where its input moved, and it is
	// never observed as false. Re-arming after it fired keeps the next pulse
	// a rising edge (ADR-018 and the fix of tsend2mqtt).
	if r.hasChanged && result {
		r.prev = false
	}

	cooled := r.Cooldown == 0 || r.lastFired.IsZero() || now.Sub(r.lastFired) >= r.Cooldown
	r.bufLen = 0
	e.env.Context = description

	if e.fires(r, result, rising, cooled) {
		r.lastFired = now
		e.stats.Firings++
		e.publish(r)
	}
	e.lifecycle(r, rising, falling, cooled, now)
}

// fires says whether the actions of a rule run in this evaluation.
func (e *Engine) fires(r *Rule, result, rising, cooled bool) bool {
	if len(r.actions) == 0 || !cooled {
		return false
	}
	if r.Edge == EdgeRising {
		return rising
	}
	return result
}

// condition evaluates the rows of a rule and returns the result together with
// the description of the first true row that has one. The rows short-circuit:
// an "all" rule stops at the first false row, an "any" rule at the first true
// one.
func (e *Engine) condition(r *Rule) (bool, string) {
	description := ""
	if len(r.rows) == 0 {
		return false, ""
	}
	for i := 0; i < len(r.rows); i++ {
		row := &r.rows[i]
		if row.prog == nil {
			return false, ""
		}
		value := row.prog.Eval(&e.env)
		if value.Truth() {
			if description == "" {
				description = row.description
			}
			if !r.matchAll {
				return true, description
			}
			continue
		}
		if r.matchAll {
			return false, ""
		}
	}
	// Every row of an "all" rule was true; no row of an "any" rule was.
	return r.matchAll, description
}

// publish appends the actions of a rule, in document order.
func (e *Engine) publish(r *Rule) {
	for i := 0; i < len(r.actions) && i < maxPerEval; i++ {
		if len(e.actions) >= maxPerEval {
			e.stats.DroppedActions++
			return
		}
		topic, ok := e.render(r, r.actions[i].topic)
		if !ok || !usableTopic(topic) {
			e.stats.DroppedActions++
			continue
		}
		payload, ok := e.render(r, r.actions[i].payload)
		if !ok {
			e.stats.DroppedActions++
			continue
		}
		e.actions = append(e.actions, Action{
			Rule:    r.Name,
			Topic:   topic,
			Payload: stringBytes(payload),
		})
	}
}

// usableTopic refuses a rendered topic MQTT cannot publish to. A literal
// topic was already checked at load time.
func usableTopic(topic string) bool {
	if topic == "" || len(topic) > maxTopicBytes {
		return false
	}
	for i := 0; i < len(topic); i++ {
		if topic[i] == '+' || topic[i] == '#' {
			return false
		}
	}
	return true
}

// lifecycle runs the incident machine of a rule. An incident triggers on a
// rising edge outside the cooldown and resolves on a falling edge, only while
// it is open. It does not depend on the edge attribute, which governs the
// actions alone.
func (e *Engine) lifecycle(r *Rule, rising, falling, cooled bool, now time.Time) {
	if r.incident == nil {
		return
	}
	if rising && cooled {
		r.lastFired = now
		r.active = true
		e.emitIncident(r, true)
		return
	}
	if falling && r.active {
		r.active = false
		e.emitIncident(r, false)
	}
}

// emitIncident appends one trigger or resolve.
func (e *Engine) emitIncident(r *Rule, trigger bool) {
	if len(e.incidents) >= maxPerEval {
		return
	}
	cfg := r.incident
	inc := Incident{Rule: r.Name, Trigger: trigger, Source: cfg.sourceID, DedupKey: cfg.dedupKey}
	if cfg.isFormula {
		inc.Source, inc.DedupKey = e.incidentIdentity(r, trigger)
	}
	if trigger {
		inc.Severity = cfg.severity
		inc.Summary = cutRunes(e.mustRender(r, cfg.summary), maxSummaryRunes)
		inc.FirstStep = e.mustRender(r, cfg.firstStep)
		inc.Cause = e.mustRender(r, cfg.cause)
		e.stats.Triggers++
	} else {
		e.stats.Resolves++
	}
	e.incidents = append(e.incidents, inc)
}

// incidentIdentity renders the source of a rule whose source is a formula.
// The key of the trigger is kept, so the resolve closes the same incident.
func (e *Engine) incidentIdentity(r *Rule, trigger bool) (string, string) {
	if !trigger {
		return sourceOfKey(r.dedupKey, r.Name), r.dedupKey
	}
	source, ok := e.render(r, r.incident.source)
	if !ok {
		source = ""
	}
	r.dedupKey = source + "-" + r.Name
	return source, r.dedupKey
}

// sourceOfKey reads the source back out of a dedup key.
func sourceOfKey(key, ruleName string) string {
	suffix := "-" + ruleName
	if len(key) > len(suffix) && key[len(key)-len(suffix):] == suffix {
		return key[:len(key)-len(suffix)]
	}
	return key
}

// mustRender renders a Then field and reads a fault as empty text.
func (e *Engine) mustRender(r *Rule, f thenField) string {
	out, ok := e.render(r, f)
	if !ok {
		return ""
	}
	return out
}

// stringBytes gives the bytes of a string without copying it. The string is
// either a literal of the loaded file or a slice of the rule's buffer, and
// the contract says a caller must not keep it past the next Eval.
func stringBytes(s string) []byte {
	if s == "" {
		return nil
	}
	return unsafeBytes(s)
}

// cutRunes shortens text to at most n characters, counted as code points.
func cutRunes(s string, n int) string {
	count := 0
	for i := range s {
		if count == n {
			return s[:i]
		}
		count++
	}
	return s
}

// unknownValue is the value of a Then field that has no program and no text.
var unknownValue = formula.Unknown
