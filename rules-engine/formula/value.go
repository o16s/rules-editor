package formula

import (
	"strconv"
	"time"
)

// ValueKind is the runtime kind of a value. Unknown is the value of a field
// the service has not set, and of every operation that has no answer, such as
// a comparison between a number and a boolean. It never leaves a program: a
// condition reads Unknown as false.
type ValueKind uint8

const (
	VUnknown ValueKind = iota
	VBool
	VInt
	VNumber
	VString
	VDuration
)

// Value is one runtime value. Raw carries the source text of a duration, so
// the & operator renders 30min as it was written.
type Value struct {
	Kind ValueKind
	B    bool
	I    int64
	F    float64
	S    string
}

// Unknown is the value of anything the engine cannot answer.
var Unknown = Value{Kind: VUnknown}

// BoolValue, IntValue, NumberValue and StringValue build a typed value.
func BoolValue(b bool) Value      { return Value{Kind: VBool, B: b} }
func IntValue(i int64) Value      { return Value{Kind: VInt, I: i} }
func NumberValue(f float64) Value { return Value{Kind: VNumber, F: f} }
func StringValue(s string) Value  { return Value{Kind: VString, S: s} }

// Truth reads a value as a condition result. Only a true boolean is true.
func (v Value) Truth() bool { return v.Kind == VBool && v.B }

// IsNumeric reports whether a value takes part in arithmetic.
func (v Value) IsNumeric() bool {
	return v.Kind == VInt || v.Kind == VNumber || v.Kind == VDuration
}

// Float reads a numeric value as a float64.
func (v Value) Float() float64 {
	switch v.Kind {
	case VInt:
		return float64(v.I)
	case VNumber, VDuration:
		return v.F
	}
	return 0
}

// Int reads a value as an int64. A number with a fraction has no integer
// value, which the bitwise operators report as Unknown.
func (v Value) Int() (int64, bool) {
	switch v.Kind {
	case VInt:
		return v.I, true
	case VNumber, VDuration:
		if v.F != float64(int64(v.F)) {
			return 0, false
		}
		return int64(v.F), true
	}
	return 0, false
}

// Duration reads a duration value.
func (v Value) Duration() (time.Duration, bool) {
	if v.Kind != VDuration {
		return 0, false
	}
	return time.Duration(v.F * float64(time.Second)), true
}

// Text renders a value the way the & operator joins it. Unknown renders as
// the empty string, so a Then field with a missing value still publishes.
func (v Value) Text() string {
	switch v.Kind {
	case VBool:
		if v.B {
			return "true"
		}
		return "false"
	case VInt:
		return strconv.FormatInt(v.I, 10)
	case VNumber:
		return strconv.FormatFloat(v.F, 'g', -1, 64)
	case VString, VDuration:
		return v.S
	}
	return ""
}

// Equal reports whether two values are the same value of the same kind. It is
// the comparison behind CHANGED and behind change detection.
func (v Value) Equal(o Value) bool {
	if v.Kind != o.Kind {
		return false
	}
	switch v.Kind {
	case VUnknown:
		return true
	case VBool:
		return v.B == o.B
	case VInt:
		return v.I == o.I
	case VNumber, VDuration:
		return v.F == o.F
	case VString:
		return v.S == o.S
	}
	return false
}

// FromAny boxes a slot value. The kinds a service may store are nil, bool,
// every Go integer type, float32, float64 and string. Any other dynamic type
// is unknown, and the caller counts it: a panic in the aggregator would stop
// the service.
func FromAny(a any) Value {
	switch v := a.(type) {
	case nil:
		return Unknown
	case bool:
		return BoolValue(v)
	case string:
		return StringValue(v)
	case float32:
		return NumberValue(float64(v))
	case float64:
		return NumberValue(v)
	case int:
		return IntValue(int64(v))
	case int8:
		return IntValue(int64(v))
	case int16:
		return IntValue(int64(v))
	case int32:
		return IntValue(int64(v))
	case int64:
		return IntValue(v)
	case uint:
		return IntValue(int64(v))
	case uint8:
		return IntValue(int64(v))
	case uint16:
		return IntValue(int64(v))
	case uint32:
		return IntValue(int64(v))
	case uint64:
		return IntValue(int64(v))
	}
	return Unknown
}

// IsSupported reports whether a slot value has one of the kinds the engine
// reads. A false answer is a fault of the service, not of the rules.
func IsSupported(a any) bool {
	if a == nil {
		return true
	}
	switch a.(type) {
	case bool, string, float32, float64,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64:
		return true
	}
	return false
}

// EqualAny compares two slot values without ever panicking. Comparing two
// interface values with == panics when the dynamic type is not comparable,
// and one such value in a slot would stop the service.
func EqualAny(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if !IsSupported(a) || !IsSupported(b) {
		return false
	}
	return FromAny(a).Equal(FromAny(b))
}
