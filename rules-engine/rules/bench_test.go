package rules

import (
	"strconv"
	"testing"
	"time"
)

// benchCatalog builds a catalog of n fields across ten devices, the shape of
// a large gateway.
func benchCatalog(n int) Catalog {
	cat := Catalog{TopicPrefix: "bench", Period: time.Second}
	for i := 0; i < n; i++ {
		device := "dev" + strconv.Itoa(i%10)
		cat.Fields = append(cat.Fields, Field{Device: device, Tag: "t" + strconv.Itoa(i), Type: Number})
	}
	for i := 0; i < 10; i++ {
		cat.Sources = append(cat.Sources, "dev"+strconv.Itoa(i))
	}
	return cat
}

// benchRules writes a file of n rules over the catalog, one condition each,
// every tenth rule with an incident.
func benchRules(n, fields int) string {
	out := "<rules>"
	for i := 0; i < n; i++ {
		device := "dev" + strconv.Itoa(i%10)
		tag := "t" + strconv.Itoa(i%fields)
		out += `<rule name="r` + strconv.Itoa(i) + `" edge="rising">` +
			`<cond device="` + device + `" tag="` + tag + `" op="gt" value="50"/>` +
			`<actions><publish topic="a/` + strconv.Itoa(i) + `" payload='{"i":` + strconv.Itoa(i) + `}'/></actions>`
		if i%10 == 0 {
			out += `<incident source="` + device + `" severity="warning" summary="rule ` + strconv.Itoa(i) + `"/>`
		}
		out += `</rule>`
	}
	return out + "</rules>"
}

// benchEngine builds the engine of the benchmarks.
func benchEngine(b *testing.B, rules, fields int) (*Engine, []any) {
	b.Helper()
	cat := benchCatalog(fields)
	parsed, problems := Load([]byte(benchRules(rules, fields)), cat)
	if len(problems) != 0 {
		b.Fatalf("Load: %v", problems)
	}
	values := make([]any, fields)
	for i := range values {
		values[i] = float64(i % 40)
	}
	return NewEngine(parsed, cat), values
}

// BenchmarkEval is the budget of SYSREQ-008: one evaluation of a large file
// with ten changed slots must allocate nothing and stay well inside the
// period of the fastest service.
func BenchmarkEval(b *testing.B) {
	e, values := benchEngine(b, 1000, 300)
	now := t0
	e.Eval(values, now)
	boxed := make([][]any, 4)
	for k := range boxed {
		boxed[k] = make([]any, 10)
		for j := range boxed[k] {
			boxed[k][j] = float64(10*k + j)
		}
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		now = now.Add(time.Millisecond)
		copy(values, boxed[i%len(boxed)])
		e.Eval(values, now)
	}
}

// BenchmarkEvalNoChange is the common case: nothing moved, so no rule runs.
func BenchmarkEvalNoChange(b *testing.B) {
	e, values := benchEngine(b, 1000, 300)
	now := t0
	e.Eval(values, now)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		now = now.Add(time.Millisecond)
		e.Eval(values, now)
	}
}

func TestEvalAllocatesNothing(t *testing.T) {
	cat := benchCatalog(300)
	parsed, problems := Load([]byte(benchRules(1000, 300)), cat)
	if len(problems) != 0 {
		t.Fatalf("Load: %v", problems)
	}
	e := NewEngine(parsed, cat)
	values := make([]any, 300)
	for i := range values {
		values[i] = float64(i % 40)
	}
	now := t0
	e.Eval(values, now)

	// Box the values up front: storing a float64 in an interface allocates,
	// and that is the caller's cost, not the engine's.
	boxed := make([][]any, 4)
	for b := range boxed {
		boxed[b] = make([]any, 10)
		for j := range boxed[b] {
			boxed[b][j] = float64(10*b + j)
		}
	}
	i := 0
	allocs := testing.AllocsPerRun(50, func() {
		i++
		now = now.Add(time.Millisecond)
		copy(values, boxed[i%len(boxed)])
		e.Eval(values, now)
	})
	if allocs != 0 {
		t.Errorf("Eval allocates %v times per call, want 0", allocs)
	}
}

func TestEvalStaysInsideItsTimeBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}
	cat := benchCatalog(300)
	parsed, _ := Load([]byte(benchRules(1000, 300)), cat)
	e := NewEngine(parsed, cat)
	values := make([]any, 300)
	for i := range values {
		values[i] = float64(i % 40)
	}
	now := t0
	e.Eval(values, now)

	const runs = 200
	start := time.Now()
	for i := 0; i < runs; i++ {
		now = now.Add(time.Millisecond)
		for j := 0; j < 10; j++ {
			values[j] = float64((i + j) % 90)
		}
		e.Eval(values, now)
	}
	per := time.Since(start) / runs
	// The budget on the gateway is 2 ms. A development machine is roughly ten
	// times faster than a Cortex-A53, so 0.5 ms here is the proxy limit.
	if per > 500*time.Microsecond {
		t.Errorf("one evaluation takes %v, want less than 500µs on this machine", per)
	}
	t.Logf("1000 rules, 300 slots, 10 changed: %v per evaluation", per)
}
