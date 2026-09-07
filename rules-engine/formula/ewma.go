package formula

import (
	"math"
	"time"
)

// Ewma is an exponentially weighted moving average of one slot. It keeps one
// number and one time, not a ring, so it costs a fraction of a window and it
// answers on the first reading.
//
// The weight of a reading falls off with the time since the one before it, so
// a service that polls irregularly still gets the smoothing its tau asks for:
//
//	alpha = 1 - exp(-dt / tau)
//
// tau is the time the average needs to cover about two thirds of a step.
type Ewma struct {
	slot  int
	tau   time.Duration
	value float64
	last  time.Time
	set   bool
}

// NewEwma builds the state of one slot and one time constant.
func NewEwma(slot int, tau time.Duration) *Ewma {
	if slot < 0 {
		panic("formula: NewEwma with a negative slot")
	}
	if tau <= 0 {
		panic("formula: NewEwma with a time constant that is not positive")
	}
	return &Ewma{slot: slot, tau: tau}
}

// Slot is the value it follows.
func (e *Ewma) Slot() int { return e.slot }

// Reset forgets the average. A reconnect starts from the next reading.
func (e *Ewma) Reset() {
	e.value = 0
	e.last = time.Time{}
	e.set = false
}

// Add folds one reading in. The first reading becomes the average itself,
// because an average of one number is that number.
func (e *Ewma) Add(now time.Time, v float64) {
	if !e.set {
		e.value = v
		e.last = now
		e.set = true
		return
	}
	dt := now.Sub(e.last)
	if dt <= 0 {
		// Two readings at one instant, or a clock that stepped back. Keep the
		// newer reading and the older time, so the next step still has a span.
		e.value = v
		return
	}
	e.last = now
	alpha := 1 - math.Exp(-float64(dt)/float64(e.tau))
	if alpha > 1 {
		alpha = 1
	}
	e.value += alpha * (v - e.value)
}

// Value is the average so far, or Unknown before the first reading.
func (e *Ewma) Value() Value {
	if !e.set {
		return Unknown
	}
	return NumberValue(e.value)
}
