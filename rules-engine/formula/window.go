package formula

import "time"

// buckets is the resolution of one time window. The memory of a window is
// fixed at startup: 64 buckets, whatever the poll rate.
const buckets = 64

// bucket holds the samples of one slice of a window. It keeps enough to
// answer every window function without storing the samples themselves, so
// the memory of a window does not depend on the poll rate.
type bucket struct {
	start time.Time
	first float64
	last  float64
	sum   float64
	sumSq float64 // for the variance
	min   float64
	max   float64
	count int32
}

// Window is the sample history of one slot over one duration. RATE and AVG
// read it; the engine advances it once per evaluation.
//
// A window keeps at most 64 buckets. The width of a bucket is the window
// divided by 64, and never less than the period of the service: a service
// that polls every second gets no more resolution than one second.
type Window struct {
	slot   int
	window time.Duration
	width  time.Duration
	n      int
	head   int
	b      [buckets]bucket
}

// NewWindow builds the ring of one slot and one window. The period is the
// expected time between evaluations; it must not be negative.
func NewWindow(slot int, window, period time.Duration) *Window {
	if slot < 0 {
		panic("formula: NewWindow with a negative slot")
	}
	if window <= 0 {
		panic("formula: NewWindow with a window that is not positive")
	}
	width := window / buckets
	if width < period {
		width = period
	}
	if width <= 0 {
		width = time.Nanosecond
	}
	n := int(window / width)
	if n > buckets {
		n = buckets
	}
	if n < 1 {
		n = 1
	}
	return &Window{slot: slot, window: window, width: width, n: n}
}

// Slot is the value the window follows.
func (w *Window) Slot() int { return w.slot }

// Reset forgets every sample. A reconnect starts from unknown history.
func (w *Window) Reset() {
	for i := 0; i < buckets; i++ {
		w.b[i] = bucket{}
	}
	w.head = 0
}

// Advance moves the ring to now and clears the buckets that left the window.
func (w *Window) Advance(now time.Time) {
	head := &w.b[w.head]
	if head.count == 0 && head.start.IsZero() {
		head.start = w.truncate(now)
		return
	}
	steps := int(now.Sub(head.start) / w.width)
	if steps <= 0 {
		if now.Before(head.start) {
			w.Reset() // the clock moved backwards
			w.b[w.head].start = w.truncate(now)
		}
		return
	}
	if steps > w.n {
		steps = w.n
	}
	start := head.start
	for i := 0; i < steps; i++ {
		w.head = (w.head + 1) % w.n
		start = start.Add(w.width)
		w.b[w.head] = bucket{start: start}
	}
}

// truncate aligns a time to the bucket grid, so the first bucket has a width.
func (w *Window) truncate(t time.Time) time.Time { return t.Truncate(w.width) }

// Add records one reading in the current bucket. The engine calls it once per
// evaluation for every slot a window follows, whether the value moved or not,
// so the window holds what the service read (ADR-022).
func (w *Window) Add(now time.Time, v float64) {
	b := &w.b[w.head]
	if b.start.IsZero() {
		b.start = w.truncate(now)
	}
	if b.count == 0 {
		b.first = v
		b.min = v
		b.max = v
	}
	if v < b.min {
		b.min = v
	}
	if v > b.max {
		b.max = v
	}
	b.last = v
	b.sum += v
	b.sumSq += v * v
	b.count++
}

// oldest returns the oldest bucket in the window that holds a sample, not
// counting the head. The scan stops before it wraps back onto the head, so a
// window whose samples all sit in the head bucket reports none: Rate handles
// that case on its own.
func (w *Window) oldest() *bucket {
	for i := 1; i < w.n; i++ {
		b := &w.b[(w.head+i)%w.n]
		if b.count > 0 {
			return b
		}
	}
	return nil
}

// Rate is the change of the value per hour over the window. Fewer than two
// samples give Unknown, not zero: a zero would satisfy a threshold such as
// "less than 5" on a service that has just started and knows nothing.
func (w *Window) Rate() Value {
	newest := &w.b[w.head]
	oldest := w.oldest()
	if oldest == nil {
		if newest.count < 2 {
			return Unknown
		}
		return NumberValue((newest.last - newest.first) / w.window.Hours())
	}
	if newest.count == 0 {
		return Unknown
	}
	return NumberValue((newest.last - oldest.first) / w.window.Hours())
}

// Avg is the mean of the samples in the window, or Unknown when it holds
// none.
func (w *Window) Avg() Value {
	var sum float64
	var count int32
	for i := 0; i < w.n; i++ {
		sum += w.b[i].sum
		count += w.b[i].count
	}
	if count == 0 {
		return Unknown
	}
	return NumberValue(sum / float64(count))
}
