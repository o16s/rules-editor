package rules

import "unsafe"

// render gives the text of one Then field. A literal costs nothing. A formula
// is evaluated and written into the buffer of the rule, so the hot path
// allocates nothing.
//
// The returned string is valid until the next Eval or Reset call.
func (e *Engine) render(r *Rule, f thenField) (string, bool) {
	if f.prog == nil {
		return f.literal, true
	}
	if r.buf == nil {
		return "", false
	}
	value := f.prog.Eval(&e.env)
	text := value.Text()
	if len(text) == 0 {
		return "", true
	}
	start := r.bufLen
	room := len(r.buf) - start
	if room <= 0 {
		e.stats.TruncatedRenders++
		return "", false
	}
	n := copy(r.buf[start:], text)
	r.bufLen += n
	if n < len(text) {
		e.stats.TruncatedRenders++
	}
	return unsafeString(r.buf[start : start+n]), true
}

// unsafeString reads a byte slice as a string without copying it. The engine
// owns the buffer and documents that the result lives until the next
// evaluation, which is the same contract as the returned slices.
func unsafeString(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	return unsafe.String(&b[0], len(b))
}

// unsafeBytes reads a string as bytes without copying it. The bytes are never
// written to.
func unsafeBytes(s string) []byte {
	return unsafe.Slice(unsafe.StringData(s), len(s))
}
