package formula

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

const registryFile = "../../schema/formula-functions.json"

// The registry is the contract between the editor and the engine. A function
// added to formula.ts without an implementation here fails on this commit.
func TestRegistryMatchesTheEditor(t *testing.T) {
	raw, err := os.ReadFile(registryFile)
	if err != nil {
		t.Fatalf("read %s: %v", registryFile, err)
	}
	var onDisk []Spec
	if err := json.Unmarshal(raw, &onDisk); err != nil {
		t.Fatalf("parse %s: %v", registryFile, err)
	}
	if !reflect.DeepEqual(onDisk, Functions[:]) {
		t.Errorf("the registry differs from the editor's.\non disk: %+v\nin code: %+v", onDisk, Functions)
	}
}

func TestFunctionSpecIsCaseInsensitive(t *testing.T) {
	for _, name := range []string{"tag", "TAG", "Tag"} {
		if spec, ok := FunctionSpec(name); !ok || spec.Name != "TAG" {
			t.Errorf("FunctionSpec(%q) = %+v, %v", name, spec, ok)
		}
	}
	if _, ok := FunctionSpec("NOPE"); ok {
		t.Error("NOPE must be unknown")
	}
}

func TestIsReserved(t *testing.T) {
	for _, name := range []string{"TAG", "tag", "AND", "HEX2DEC", "TRUE", "false", "condition"} {
		if !IsReserved(name) {
			t.Errorf("%q must be reserved", name)
		}
	}
	for _, name := range []string{"temp", "milk_temp", "tag1", "andy"} {
		if IsReserved(name) {
			t.Errorf("%q must be free", name)
		}
	}
}

func TestCollect(t *testing.T) {
	refs := Collect(MustParse(`AND(milk_temp > 3.6, door_changed, milk_temp < 9, TAG("plc1", "A") = TAG("B"), TAG("plc1", "A"))`))
	if want := []string{"milk_temp", "door_changed"}; !reflect.DeepEqual(refs.Variables, want) {
		t.Errorf("variables = %v, want %v", refs.Variables, want)
	}
	want := []TagRef{{Device: "plc1", Tag: "A"}, {Tag: "B"}}
	if !reflect.DeepEqual(refs.Tags, want) {
		t.Errorf("tags = %v, want %v", refs.Tags, want)
	}
	if len(refs.Context) != 0 {
		t.Errorf("context = %v, want none", refs.Context)
	}
	if c := Collect(MustParse(`condition.description & "."`)).Context; len(c) != 1 || c[0] != "condition.description" {
		t.Errorf("context = %v", c)
	}
	// A TAG with a non-literal argument is not a tag reference; it is an
	// error the compiler reports.
	if tags := Collect(MustParse("TAG(x) > 1")).Tags; len(tags) != 0 {
		t.Errorf("tags = %v, want none", tags)
	}
}

func TestCheckFunctions(t *testing.T) {
	cases := map[string]string{
		"NOPE(1)":       "Unknown function NOPE().",
		"NOT(1, 2)":     "NOT() takes 1 argument, got 2: NOT(a).",
		"AND(1)":        "AND() takes 2 to 16 arguments, got 1: AND(a, b, …).",
		"TAG()":         "TAG() takes 1 to 2 arguments, got 0: TAG(\"tag\") or TAG(\"device\", \"tag\").",
		"RATE(a, b, c)": "RATE() takes 2 arguments, got 3: RATE(x, 30min).",
	}
	for text, want := range cases {
		got := CheckFunctions(MustParse(text))
		if len(got) != 1 || got[0] != want {
			t.Errorf("CheckFunctions(%q) = %v, want [%q]", text, got, want)
		}
	}
	for _, text := range []string{`TAG("a")`, `TAG("d", "t")`, "AND(a, b)", "HEX2DEC(\"FF\")"} {
		if got := CheckFunctions(MustParse(text)); len(got) != 0 {
			t.Errorf("CheckFunctions(%q) = %v, want none", text, got)
		}
	}
}

func TestInferType(t *testing.T) {
	cases := map[string]Type{
		"BITAND(status_word, 4) != 0": TypeBool,
		"temp > 50":                   TypeBool,
		"AND(a, b)":                   TypeBool,
		"CHANGED(x)":                  TypeBool,
		"RATE(temp, 30min)":           TypeNumber,
		"temp + 1":                    TypeNumber,
		"-temp":                       TypeNumber,
		`condition.description & "."`: TypeString,
		`TAG("a")`:                    TypeAny,
		"30min":                       TypeDuration,
		"unknown_ref":                 TypeAny,
		`"open"`:                      TypeString,
		"true":                        TypeBool,
		"1":                           TypeNumber,
	}
	for text, want := range cases {
		if got := InferType(MustParse(text), nil); got != want {
			t.Errorf("InferType(%q) = %v, want %v", text, got, want)
		}
	}
	lookup := func(name string) Type {
		if name == "alarm_active" {
			return TypeBool
		}
		return TypeAny
	}
	if got := InferType(MustParse("alarm_active"), lookup); got != TypeBool {
		t.Errorf("a variable takes the type of its formula, got %v", got)
	}
}
