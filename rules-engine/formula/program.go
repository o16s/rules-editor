package formula

import "time"

// opcode is one instruction of a compiled formula. A program is a post-order
// array of these: Eval walks it once with a value stack whose depth is known
// at compile time, so nothing recurses and nothing allocates.
type opcode uint8

const (
	opConst    opcode = iota // push consts[a]
	opSlot                   // push the value of slot a
	opContext                // push the description of the firing condition
	opChanged                // pop v; push whether v differs from state a
	opStale                  // push whether slot a did not change for consts[b]
	opRate                   // push the rate of window a
	opAvg                    // push the mean of window a
	opMin                    // push the smallest reading of window a
	opMax                    // push the largest reading of window a
	opCount                  // push how many readings window a holds
	opDelta                  // push the change across window a
	opStdDev                 // push the standard deviation of window a
	opZScore                 // push how far the value sits from the mean of window a
	opSlope                  // push the least-squares trend of window a, per hour
	opForecast               // push where window a lands after consts[b]
	opSince                  // push the seconds since slot a last changed
	opPrev                   // push the value slot a held before its last change, kept in states a
	opEwma                   // push the smoothed value of ewma a
	opNot                    // pop v; push its opposite
	opNeg                    // pop v; push its negation
	opBin                    // pop right, pop left; push the result of binop a
	opBitwise                // pop right, pop left; push the bitwise result of a
	opHex2Dec                // pop v; push the integer of its hex text
	opAndAcc                 // fold one AND argument; jump to a when false
	opOrAcc                  // fold one OR argument; jump to a when true
)

// binop is the operator of opBin.
type binop uint8

const (
	bAdd binop = iota
	bSub
	bMul
	bDiv
	bConcat
	bEq
	bNe
	bLt
	bLe
	bGt
	bGe
)

// bitop is the operator of opBitwise.
type bitop uint8

const (
	bitAnd bitop = iota
	bitOr
	bitXor
)

// instr is one instruction. The meaning of a and b depends on the opcode.
type instr struct {
	op opcode
	a  int32
	b  int32
}

// WindowSpec names one time window a program reads: a slot and a duration.
type WindowSpec struct {
	Slot   int
	Window time.Duration
}

// EwmaSpec names one smoothed value a program reads: a slot and a time
// constant. An EWMA keeps one number, not a ring, so it is cheaper than any
// window function and it is not one of them.
type EwmaSpec struct {
	Slot int
	Tau  time.Duration
}

// Program is a compiled formula, ready to evaluate.
type Program struct {
	code   []instr
	consts []Value
	depth  int // the value stack a run needs

	slots       []int        // slots the program reads, without duplicates
	states      []int        // indexes of the CHANGED states it owns
	windows     []int        // indexes of the windows it reads
	windowSpecs []WindowSpec // what each of those windows follows
	ewmas       []int        // indexes of the smoothed values it reads
	ewmaSpecs   []EwmaSpec   // what each of those follows
	HasChanged  bool         // the program contains CHANGED
	HasTime     bool         // the program contains STALE, RATE or AVG
	HasConcat   bool         // the program contains &, which allocates when it runs
	Type        Type         // the static type of the result
}

// Slots is the set of slots the program reads. The engine indexes its rules
// by them, so a rule evaluates only when one of its inputs changed.
func (p *Program) Slots() []int { return p.slots }

// Windows is the set of windows the program reads, by the index the resolver
// gave them.
func (p *Program) Windows() []int { return p.windows }

// WindowSpecs describes those windows, in the same order as Windows. The
// engine sizes its rings from them.
func (p *Program) WindowSpecs() []WindowSpec { return p.windowSpecs }

// Ewmas is the set of smoothed values the program reads, by the index the
// resolver gave them.
func (p *Program) Ewmas() []int { return p.ewmas }

// EwmaSpecs describes those, in the same order as Ewmas.
func (p *Program) EwmaSpecs() []EwmaSpec { return p.ewmaSpecs }

// States is the set of CHANGED nodes the program owns, by the index the
// resolver gave them.
func (p *Program) States() []int { return p.states }

// StackDepth is the value stack one run needs.
func (p *Program) StackDepth() int { return p.depth }

// Len is the number of instructions, for a test or a benchmark.
func (p *Program) Len() int { return len(p.code) }
