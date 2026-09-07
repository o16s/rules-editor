package formula

import (
	"math"
	"testing"
	"time"
)

var t0 = time.Unix(1_700_000_000, 0)

func TestWindowRateOverARamp(t *testing.T) {
	// 40 °C climbing to 52 °C over 30 minutes is 24 °C per hour. The rate
	// divides by the nominal window, and the oldest bucket holds the oldest
	// sample it saw, so the answer is short by up to one bucket of ramp: one
	// part in 64, which is 1.6 percent.
	const steps = 180
	w := NewWindow(0, 30*time.Minute, time.Second)
	now := t0
	for i := 0; i <= steps; i++ {
		w.Advance(now)
		w.Add(now, 40+12*float64(i)/steps)
		now = now.Add(10 * time.Second)
	}
	got := w.Rate().Float()
	if math.Abs(got-24) > 24.0/buckets {
		t.Errorf("rate = %v, want 24 within one bucket of the window", got)
	}
}

func TestWindowRateNeedsTwoSamples(t *testing.T) {
	w := NewWindow(0, time.Hour, time.Second)
	if got := w.Rate().Float(); got != 0 {
		t.Errorf("an empty window has no rate, got %v", got)
	}
	w.Advance(t0)
	w.Add(t0, 5)
	if got := w.Rate().Float(); got != 0 {
		t.Errorf("one sample has no rate, got %v", got)
	}
}

func TestWindowAvg(t *testing.T) {
	w := NewWindow(0, time.Hour, time.Second)
	if w.Avg().Kind != VUnknown {
		t.Error("an empty window has no mean")
	}
	now := t0
	for i := 0; i < 10; i++ {
		w.Advance(now)
		w.Add(now, 7)
		now = now.Add(time.Minute)
	}
	if got := w.Avg().Float(); got != 7 {
		t.Errorf("the mean of a constant is the constant, got %v", got)
	}
	// A square wave between 0 and 10 has the mean 5.
	w2 := NewWindow(0, time.Hour, time.Second)
	now = t0
	for i := 0; i < 20; i++ {
		w2.Advance(now)
		w2.Add(now, float64((i%2)*10))
		now = now.Add(time.Minute)
	}
	if got := w2.Avg().Float(); math.Abs(got-5) > 0.5 {
		t.Errorf("mean = %v, want 5", got)
	}
}

func TestWindowForgetsWhatLeftTheWindow(t *testing.T) {
	w := NewWindow(0, time.Hour, time.Minute)
	w.Advance(t0)
	w.Add(t0, 100)
	// Two hours later the old sample is gone.
	later := t0.Add(2 * time.Hour)
	w.Advance(later)
	w.Add(later, 10)
	if got := w.Avg().Float(); got != 10 {
		t.Errorf("mean = %v, want only the new sample", got)
	}
}

func TestWindowResolutionFollowsThePeriod(t *testing.T) {
	// A one-minute window with a one-second period gets 60 buckets, not 64.
	w := NewWindow(0, time.Minute, time.Second)
	if w.width != time.Second || w.n != 60 {
		t.Errorf("width = %v, buckets = %d", w.width, w.n)
	}
	// A one-hour window with a one-second period gets the full 64.
	w2 := NewWindow(0, time.Hour, time.Second)
	if w2.n != buckets {
		t.Errorf("buckets = %d, want %d", w2.n, buckets)
	}
	// A window shorter than the period still has one bucket.
	w3 := NewWindow(0, time.Second, time.Minute)
	if w3.n != 1 {
		t.Errorf("buckets = %d, want 1", w3.n)
	}
}

func TestWindowSurvivesAClockThatMovesBackwards(t *testing.T) {
	w := NewWindow(0, time.Hour, time.Minute)
	w.Advance(t0)
	w.Add(t0, 5)
	w.Advance(t0.Add(-time.Hour))
	if w.Avg().Kind != VUnknown {
		t.Error("a clock step backwards clears the window")
	}
}

func TestWindowUsesFixedMemory(t *testing.T) {
	w := NewWindow(0, time.Hour, time.Second)
	now := t0
	// A day of samples at one per second must not grow anything.
	if n := testing.AllocsPerRun(1000, func() {
		now = now.Add(time.Second)
		w.Advance(now)
		w.Add(now, 1)
	}); n != 0 {
		t.Errorf("the window allocates %v times per sample, want 0", n)
	}
}
