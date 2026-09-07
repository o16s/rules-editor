package formula

import (
	"math"
	"testing"
	"time"
)

// feed builds a window of one second per bucket and pushes the readings into
// it, one per second, so the arithmetic in these tests is exact.
func feed(t *testing.T, window time.Duration, readings ...float64) (*Window, time.Time) {
	t.Helper()
	w := NewWindow(0, window, time.Second)
	start := time.Unix(1_700_000_000, 0)
	now := start
	for i, v := range readings {
		now = start.Add(time.Duration(i) * time.Second)
		w.Advance(now)
		w.Add(now, v)
	}
	return w, now
}

func number(t *testing.T, v Value, want float64, what string) {
	t.Helper()
	if v.Kind != VNumber {
		t.Fatalf("%s = %v, want a number", what, v)
	}
	if math.Abs(v.Float()-want) > 1e-9 {
		t.Errorf("%s = %v, want %v", what, v.Float(), want)
	}
}

func TestWindowCountMinMaxDelta(t *testing.T) {
	w, _ := feed(t, 10*time.Second, 5, 9, 2, 7)
	number(t, w.Count(), 4, "Count")
	number(t, w.Min(), 2, "Min")
	number(t, w.Max(), 9, "Max")
	number(t, w.Delta(), 2, "Delta") // 7 - 5
}

func TestAnEmptyWindowIsUnknownNotZero(t *testing.T) {
	w := NewWindow(0, 10*time.Second, time.Second)
	for name, got := range map[string]Value{
		"Min": w.Min(), "Max": w.Max(), "Delta": w.Delta(),
		"StdDev": w.StdDev(), "Slope": w.Slope(), "Avg": w.Avg(), "Rate": w.Rate(),
	} {
		if got.Kind != VUnknown {
			t.Errorf("%s of an empty window = %v, want unknown", name, got)
		}
	}
	// Count is the exception: no readings is a number an operator can use.
	number(t, w.Count(), 0, "Count")
}

func TestWindowStdDev(t *testing.T) {
	// Readings 2, 4, 4, 4, 5, 5, 7, 9: mean 5, population deviation 2.
	w, _ := feed(t, 20*time.Second, 2, 4, 4, 4, 5, 5, 7, 9)
	number(t, w.StdDev(), 2, "StdDev")

	// A value that never moved has no spread.
	flat, _ := feed(t, 10*time.Second, 3, 3, 3)
	number(t, flat.StdDev(), 0, "StdDev of a flat series")

	// One reading cannot have a spread.
	one, _ := feed(t, 10*time.Second, 3)
	if one.StdDev().Kind != VUnknown {
		t.Errorf("StdDev of one reading = %v, want unknown", one.StdDev())
	}
}

func TestWindowZScore(t *testing.T) {
	w, _ := feed(t, 20*time.Second, 2, 4, 4, 4, 5, 5, 7, 9)
	number(t, w.ZScore(NumberValue(9)), 2, "ZScore(9)") // (9-5)/2
	number(t, w.ZScore(NumberValue(5)), 0, "ZScore(5)")

	// A flat window has no spread, so how unusual a reading is has no answer.
	flat, _ := feed(t, 10*time.Second, 3, 3, 3)
	if flat.ZScore(NumberValue(4)).Kind != VUnknown {
		t.Error("ZScore against a flat window must be unknown, not an infinity")
	}
	if w.ZScore(Unknown).Kind != VUnknown {
		t.Error("ZScore of an unknown reading must be unknown")
	}
}

func TestWindowSlopeAndForecast(t *testing.T) {
	// A ramp of one unit per second is 3600 units per hour.
	w, _ := feed(t, 10*time.Second, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9)
	number(t, w.Slope(), 3600, "Slope")

	// Two hours at that trend, from the current reading of 9.
	number(t, w.Forecast(NumberValue(9), 2), 9+7200, "Forecast")

	// A flat series has no trend, and the forecast is the value itself.
	flat, _ := feed(t, 10*time.Second, 4, 4, 4, 4)
	number(t, flat.Slope(), 0, "Slope of a flat series")
	number(t, flat.Forecast(NumberValue(4), 5), 4, "Forecast of a flat series")

	// One bucket cannot carry a trend.
	one, _ := feed(t, 10*time.Second, 4)
	if one.Slope().Kind != VUnknown {
		t.Errorf("Slope of one bucket = %v, want unknown", one.Slope())
	}
	if one.Forecast(NumberValue(4), 1).Kind != VUnknown {
		t.Error("Forecast without a trend must be unknown")
	}
}

// SLOPE fits every reading, so one wild sample moves it less than it moves
// RATE, which reads only the two ends. That is why the function exists.
func TestSlopeIsSteadierThanRate(t *testing.T) {
	// A flat series whose last reading is a spike.
	w, _ := feed(t, 10*time.Second, 10, 10, 10, 10, 10, 10, 10, 10, 10, 40)
	slope := w.Slope()
	rate := w.Rate()
	if slope.Kind != VNumber || rate.Kind != VNumber {
		t.Fatalf("slope = %v, rate = %v", slope, rate)
	}
	if math.Abs(slope.Float()) >= math.Abs(rate.Float()) {
		t.Errorf("slope %v must be nearer zero than rate %v", slope.Float(), rate.Float())
	}
}

func TestEwmaFollowsTheValue(t *testing.T) {
	e := NewEwma(0, 10*time.Second)
	if e.Value().Kind != VUnknown {
		t.Error("a smoothed value with no reading must be unknown")
	}
	now := time.Unix(1_700_000_000, 0)

	// The first reading is the average itself.
	e.Add(now, 100)
	number(t, e.Value(), 100, "the first reading")

	// One time constant later, a step to zero has covered about 63 percent.
	e.Add(now.Add(10*time.Second), 0)
	got := e.Value().Float()
	if got < 36 || got > 38 {
		t.Errorf("after one time constant the average is %v, want about 36.8", got)
	}

	// It keeps approaching, and never overshoots.
	for i := 2; i <= 10; i++ {
		e.Add(now.Add(time.Duration(i)*10*time.Second), 0)
	}
	if v := e.Value().Float(); v < 0 || v > 1 {
		t.Errorf("after ten time constants the average is %v, want close to zero", v)
	}

	e.Reset()
	if e.Value().Kind != VUnknown {
		t.Error("Reset must forget the average")
	}
}

// The weight of a reading follows the time since the one before it, so an
// irregular poll still smooths over the time constant it was given.
func TestEwmaUsesTheTimeBetweenReadings(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	fast := NewEwma(0, time.Minute)
	fast.Add(now, 100)
	fast.Add(now.Add(time.Second), 0) // one second of a one-minute constant

	slow := NewEwma(0, time.Minute)
	slow.Add(now, 100)
	slow.Add(now.Add(time.Minute), 0) // a whole time constant

	if fast.Value().Float() <= slow.Value().Float() {
		t.Errorf("a short step must move the average less: fast %v, slow %v",
			fast.Value().Float(), slow.Value().Float())
	}
}

// RATE divides by the time between the two readings it used, not by the width
// of the window. A window that is not yet full then reports the rate of what
// it holds, instead of a fraction of it.
//
// A thirty minute window used to need thirty minutes before it told the truth.
// It now needs two buckets, and a bucket is a sixty-fourth of the window, so
// it tells the truth after about a minute.
func TestRateMeasuresTheSpanItHas(t *testing.T) {
	for _, window := range []time.Duration{10 * time.Second, time.Minute, 30 * time.Minute} {
		w := NewWindow(0, window, time.Second)
		start := time.Unix(1_700_000_000, 0)
		// Five readings, spaced so they land in five buckets, rising one unit
		// a second. That is 3600 an hour whatever the window is.
		spacing := window / buckets
		if spacing < time.Second {
			spacing = time.Second
		}
		for i := 0; i < 5; i++ {
			now := start.Add(time.Duration(i) * spacing)
			w.Advance(now)
			w.Add(now, now.Sub(start).Seconds())
		}
		got := w.Rate()
		if got.Kind != VNumber {
			t.Fatalf("window %v: Rate = %v, want a number", window, got)
		}
		if math.Abs(got.Float()-3600) > 1 {
			t.Errorf("window %v: Rate = %v, want 3600 an hour", window, got.Float())
		}
	}
}

// Readings that all sit in one bucket give no span to divide by.
func TestRateNeedsTwoMomentsNotTwoReadings(t *testing.T) {
	w := NewWindow(0, time.Hour, time.Minute)
	now := time.Unix(1_700_000_000, 0)
	w.Advance(now)
	w.Add(now, 1)
	w.Add(now, 5)
	if got := w.Rate(); got.Kind != VUnknown {
		t.Errorf("Rate from one moment = %v, want unknown", got)
	}
}
