package formula

import "math"

// The window statistics. Every one of them reads the same ring that RATE and
// AVG read, and none of them keeps a sample: the bucket carries the count, the
// sum, the sum of squares, the first, the last, the smallest and the largest,
// which is enough for all of them.
//
// A window with no reading answers Unknown, never zero. Zero is a number an
// operator can compare against, and a service that has just started knows
// nothing rather than nothing-happened.

// Count is how many readings the window holds.
func (w *Window) Count() Value {
	var n int32
	for i := 0; i < w.n; i++ {
		n += w.b[i].count
	}
	return NumberValue(float64(n))
}

// Min is the smallest reading in the window.
func (w *Window) Min() Value {
	out := math.Inf(1)
	found := false
	for i := 0; i < w.n; i++ {
		if w.b[i].count == 0 {
			continue
		}
		found = true
		if w.b[i].min < out {
			out = w.b[i].min
		}
	}
	if !found {
		return Unknown
	}
	return NumberValue(out)
}

// Max is the largest reading in the window.
func (w *Window) Max() Value {
	out := math.Inf(-1)
	found := false
	for i := 0; i < w.n; i++ {
		if w.b[i].count == 0 {
			continue
		}
		found = true
		if w.b[i].max > out {
			out = w.b[i].max
		}
	}
	if !found {
		return Unknown
	}
	return NumberValue(out)
}

// Delta is the newest reading minus the oldest one. It is the change over the
// window, where Rate is that change divided by the window.
func (w *Window) Delta() Value {
	newest := &w.b[w.head]
	oldest := w.oldest()
	if oldest == nil {
		if newest.count < 2 {
			return Unknown
		}
		return NumberValue(newest.last - newest.first)
	}
	if newest.count == 0 {
		return Unknown
	}
	return NumberValue(newest.last - oldest.first)
}

// totals sums the readings of the window: how many, their sum, and the sum of
// their squares.
func (w *Window) totals() (int32, float64, float64) {
	var n int32
	var sum, sumSq float64
	for i := 0; i < w.n; i++ {
		n += w.b[i].count
		sum += w.b[i].sum
		sumSq += w.b[i].sumSq
	}
	return n, sum, sumSq
}

// StdDev is the standard deviation of the readings, over the whole window and
// not a sample of it. Fewer than two readings give Unknown, because a spread
// needs two points.
func (w *Window) StdDev() Value {
	n, sum, sumSq := w.totals()
	if n < 2 {
		return Unknown
	}
	mean := sum / float64(n)
	variance := sumSq/float64(n) - mean*mean
	if variance <= 0 {
		// A value that never moved, or the rounding of a very small spread.
		return NumberValue(0)
	}
	return NumberValue(math.Sqrt(variance))
}

// ZScore says how far the current value sits from the mean of the window, in
// standard deviations. A window whose readings are all the same has no spread,
// so the answer is Unknown rather than an infinity.
func (w *Window) ZScore(current Value) Value {
	if !current.IsNumeric() {
		return Unknown
	}
	n, sum, sumSq := w.totals()
	if n < 2 {
		return Unknown
	}
	mean := sum / float64(n)
	variance := sumSq/float64(n) - mean*mean
	if variance <= 0 {
		return Unknown
	}
	return NumberValue((current.Float() - mean) / math.Sqrt(variance))
}

// Slope is the least-squares trend of the window, per hour. It fits a line
// through one point per bucket, at the middle of the bucket, weighted by how
// many readings that bucket holds. That is steadier than the two end points
// Rate uses, which is what a rule about a machine heating up needs.
//
// The loop is bounded by the 64 buckets of the ring.
func (w *Window) Slope() Value {
	var sw, swx, swy, swxx, swxy float64
	filled := 0
	for i := 0; i < w.n; i++ {
		b := &w.b[i]
		if b.count == 0 || b.start.IsZero() {
			continue
		}
		filled++
		// Hours from the start of the ring's oldest possible bucket. Only
		// differences matter, so any fixed origin does.
		x := b.start.Add(w.width / 2).Sub(w.b[w.head].start).Hours()
		y := b.sum / float64(b.count)
		wt := float64(b.count)
		sw += wt
		swx += wt * x
		swy += wt * y
		swxx += wt * x * x
		swxy += wt * x * y
	}
	if filled < 2 {
		return Unknown
	}
	den := sw*swxx - swx*swx
	if den == 0 {
		return Unknown
	}
	return NumberValue((sw*swxy - swx*swy) / den)
}

// Forecast extends the trend of the window by a horizon, in hours, and
// returns where the value lands. It is the current reading plus the slope
// times the horizon, so a rule can ask whether a limit is reached before the
// end of the shift.
func (w *Window) Forecast(current Value, horizonHours float64) Value {
	slope := w.Slope()
	if slope.Kind != VNumber {
		return Unknown
	}
	if !current.IsNumeric() {
		return Unknown
	}
	return NumberValue(current.Float() + slope.Float()*horizonHours)
}
