package rules

import (
	"time"

	"github.com/o16s/rules-editor/rules-engine/formula"
)

// history is everything the engine remembers between two evaluations: when
// each slot last changed, the time windows, and the smoothed values. The
// engine owns one, and so does the resolver the editor's simulator uses, so
// both advance the past the same way and a rule cannot mean one thing on the
// plant and another in the editor.
type history struct {
	lastChange []time.Time
	prevValues []any

	windows       []*formula.Window
	windowsBySlot [][]int
	ewmas         []*formula.Ewma
	ewmasBySlot   [][]int

	// changed marks the slots that moved in the last advance.
	changed []bool
	// unsupported counts readings of a type the engine cannot read.
	unsupported uint64
}

// build allocates the history of one catalog from the windows and the
// smoothed values a set of rules reserved.
func (h *history) build(cat Catalog, windows []formula.WindowSpec, ewmas []formula.EwmaSpec) {
	slots := len(cat.Fields)
	h.lastChange = make([]time.Time, slots)
	h.prevValues = make([]any, slots)
	h.changed = make([]bool, slots)

	h.windows = make([]*formula.Window, len(windows))
	h.windowsBySlot = make([][]int, slots)
	for i := 0; i < len(windows); i++ {
		if windows[i].Window <= 0 {
			// An index no program claimed; a nil ring reads as unknown.
			continue
		}
		h.windows[i] = formula.NewWindow(windows[i].Slot, windows[i].Window, cat.Period)
		if s := windows[i].Slot; s >= 0 && s < slots {
			h.windowsBySlot[s] = append(h.windowsBySlot[s], i)
		}
	}

	h.ewmas = make([]*formula.Ewma, len(ewmas))
	h.ewmasBySlot = make([][]int, slots)
	for i := 0; i < len(ewmas); i++ {
		if ewmas[i].Tau <= 0 {
			continue
		}
		h.ewmas[i] = formula.NewEwma(ewmas[i].Slot, ewmas[i].Tau)
		if s := ewmas[i].Slot; s >= 0 && s < slots {
			h.ewmasBySlot[s] = append(h.ewmasBySlot[s], i)
		}
	}
}

// advance records one evaluation. It moves every window to now, records one
// reading per slot, and marks the slots that moved.
//
// Every evaluation is a reading, so a window holds what the service saw and
// not only what moved. A mean over ten minutes is then the mean of the
// readings, which is how an operator reads it (ADR-022).
func (h *history) advance(values []any, now time.Time) {
	for i := 0; i < len(h.windows); i++ {
		if h.windows[i] != nil {
			h.windows[i].Advance(now)
		}
	}
	n := len(values)
	if n > len(h.prevValues) {
		n = len(h.prevValues)
	}
	for i := 0; i < len(h.changed); i++ {
		h.changed[i] = false
	}
	for i := 0; i < n; i++ {
		if !formula.IsSupported(values[i]) {
			h.unsupported++
			continue
		}
		h.sample(i, values[i], now)
		h.smooth(i, values[i], now)
		if formula.EqualAny(values[i], h.prevValues[i]) {
			continue
		}
		h.lastChange[i] = now
		h.changed[i] = true
	}
}

// keep copies the readings this evaluation saw, so the next one can tell what
// moved. The engine calls it after the rules have run.
func (h *history) keep(values []any) {
	n := len(values)
	if n > len(h.prevValues) {
		n = len(h.prevValues)
	}
	for i := 0; i < n; i++ {
		h.prevValues[i] = values[i]
	}
}

// sample records one reading in every window that follows the slot. Most
// slots carry no window, so the common case is one length check.
func (h *history) sample(slot int, value any, now time.Time) {
	if slot < 0 || slot >= len(h.windowsBySlot) {
		return
	}
	list := h.windowsBySlot[slot]
	if len(list) == 0 {
		return
	}
	v := formula.FromAny(value)
	if !v.IsNumeric() {
		return
	}
	f := v.Float()
	for i := 0; i < len(list); i++ {
		h.windows[list[i]].Add(now, f)
	}
}

// smooth folds one reading into every smoothed value that follows the slot.
func (h *history) smooth(slot int, value any, now time.Time) {
	if slot < 0 || slot >= len(h.ewmasBySlot) {
		return
	}
	list := h.ewmasBySlot[slot]
	if len(list) == 0 {
		return
	}
	v := formula.FromAny(value)
	if !v.IsNumeric() {
		return
	}
	f := v.Float()
	for i := 0; i < len(list); i++ {
		h.ewmas[list[i]].Add(now, f)
	}
}

// reset forgets everything a reconnect cannot vouch for.
func (h *history) reset() {
	for i := 0; i < len(h.windows); i++ {
		if h.windows[i] != nil {
			h.windows[i].Reset()
		}
	}
	for i := 0; i < len(h.ewmas); i++ {
		if h.ewmas[i] != nil {
			h.ewmas[i].Reset()
		}
	}
	for i := 0; i < len(h.prevValues); i++ {
		h.prevValues[i] = nil
		h.lastChange[i] = time.Time{}
	}
}
