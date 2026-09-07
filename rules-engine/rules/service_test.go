package rules

import (
	"os"
	"testing"
	"time"
)

// The rule files the three services ship, against the catalog each service
// builds at startup. This is the end-to-end check of the module: a file an
// operator deployed must load, and must fire what the service's documentation
// says it fires.

// ioLinkCatalog is what iolinkmaster2mqtt builds from driver.DiscoverFieldTypes
// for three SICK MPB10 sensors.
func ioLinkCatalog() Catalog {
	cat := Catalog{TopicPrefix: "iolink", Period: 100 * time.Millisecond}
	for _, device := range []string{"vibration1", "vibration2", "vibration3"} {
		cat.Sources = append(cat.Sources, device)
		for _, tag := range []string{"alert_vrms_max", "alert_vrms_prewarn", "alert_acc_peak", "alert_temp"} {
			cat.Fields = append(cat.Fields, Field{Device: device, Tag: tag, Type: Bool})
		}
		cat.Fields = append(cat.Fields,
			Field{Device: device, Tag: "alerts_raw", Type: Integer},
			Field{Device: device, Tag: "temperature", Type: Number},
			Field{Device: device, Tag: "vrms_x", Type: Number},
			Field{Device: device, Tag: "vrms_y", Type: Number},
			Field{Device: device, Tag: "vrms_z", Type: Number},
		)
	}
	return cat
}

// modbusCatalog is what modbus2mqtt builds for a NeoPool controller and a
// BADU pump.
func modbusCatalog() Catalog {
	return Catalog{
		TopicPrefix: "modbus",
		Period:      time.Second,
		Sources:     []string{"pool1", "pump1"},
		Fields: []Field{
			{Device: "pool1", Tag: "flow_signal", Type: Integer},
			{Device: "pool1", Tag: "ph", Type: Number},
			{Device: "pool1", Tag: "ph_valid", Type: Bool},
			{Device: "pool1", Tag: "heating_on", Type: Bool},
			{Device: "pool1", Tag: "temperature_c", Type: Number},
			{Device: "pump1", Tag: "error_code", Type: Integer},
			{Device: "pump1", Tag: "running", Type: Bool},
		},
	}
}

// plcExampleCatalog is what tsend2mqtt builds from the .udt layout: one
// implicit source, and the topic prefix as the only incident source.
func plcExampleCatalog() Catalog {
	return Catalog{
		// The source ID is the source itself. ADR-021 replaces this with
		// Catalog.SourceIDs in v0.4.0, when tsend2mqtt adopts the module.
		TopicPrefix: "",
		Period:      time.Second,
		Sources:     []string{"plc1"},
		Fields: []Field{
			{Tag: "Bool137", Type: Bool},
			{Tag: "Int93", Type: Integer},
			{Tag: "Real70", Type: Number},
		},
	}
}

// readTestdata reads one of the copied service files.
func readTestdata(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestServiceFileIOLink(t *testing.T) {
	cat := ioLinkCatalog()
	parsed, problems := Load(readTestdata(t, "iolinkmaster2mqtt.xml"), cat)
	if len(problems) != 0 {
		t.Fatalf("the iolinkmaster2mqtt example must load:\n%v", problems)
	}
	if len(parsed) != 3 {
		t.Fatalf("rules = %d, want 3", len(parsed))
	}
	e := NewEngine(parsed, cat)
	values := make([]any, len(cat.Fields))
	for i := range values {
		values[i] = false
	}
	for i, f := range cat.Fields {
		if f.Type != Bool {
			values[i] = 0.0
		}
	}
	// Every incident rule starts active, so the first quiet evaluation closes
	// what a restart may have left open.
	_, incidents := e.Eval(values, t0)
	if len(incidents) != 3 {
		t.Fatalf("startup: incidents = %d, want one resolve per incident rule", len(incidents))
	}

	// vibration1 raises its max alarm: five actions and one trigger.
	values[slotOf(t, cat, "vibration1", "alert_vrms_max")] = true
	actions, incidents := e.Eval(values, t0.Add(time.Second))
	if len(actions) != 5 {
		t.Errorf("actions = %d, want the four cameras and the reset", len(actions))
	}
	if len(incidents) != 1 || !incidents[0].Trigger {
		t.Fatalf("incidents = %+v", incidents)
	}
	if incidents[0].DedupKey != "iolink/vibration1-vibration1-alarm" {
		t.Errorf("dedup key = %q", incidents[0].DedupKey)
	}
	if actions[4].Topic != "iolink/vibration1/param/reset_alerts" {
		t.Errorf("the last action must be the reset, got %q", actions[4].Topic)
	}

	// The cooldown of 30 s holds the rule while the alarm stays.
	values[slotOf(t, cat, "vibration1", "alert_acc_peak")] = true
	actions, _ = e.Eval(values, t0.Add(2*time.Second))
	if len(actions) != 0 {
		t.Errorf("the cooldown must hold: %d actions", len(actions))
	}

	// The alarm clears: the incident resolves, and the cooldown does not delay it.
	values[slotOf(t, cat, "vibration1", "alert_vrms_max")] = false
	values[slotOf(t, cat, "vibration1", "alert_acc_peak")] = false
	_, incidents = e.Eval(values, t0.Add(3*time.Second))
	if len(incidents) != 1 || incidents[0].Trigger {
		t.Fatalf("resolve: incidents = %+v", incidents)
	}
}

func TestServiceFileModbus(t *testing.T) {
	cat := modbusCatalog()
	parsed, problems := Load(readTestdata(t, "modbus2mqtt.xml"), cat)
	if len(problems) != 0 {
		t.Fatalf("the modbus2mqtt example must load:\n%v", problems)
	}
	if len(parsed) != 4 {
		t.Fatalf("rules = %d, want 4", len(parsed))
	}
	e := NewEngine(parsed, cat)
	values := []any{0, 7.2, true, false, 25.0, 0, true}
	e.Eval(values, t0)

	// The flow-detection bypass is the safety rule of that file.
	values[0] = 1
	_, incidents := e.Eval(values, t0.Add(time.Second))
	if len(incidents) != 1 || !incidents[0].Trigger || incidents[0].Severity != "critical" {
		t.Fatalf("the bypass must raise a critical incident: %+v", incidents)
	}
	if incidents[0].DedupKey != "modbus/pool1-pool1-flow-bypass" {
		t.Errorf("dedup key = %q", incidents[0].DedupKey)
	}

	// A pump fault stops the pump and raises an incident.
	values[5] = 3
	actions, incidents := e.Eval(values, t0.Add(2*time.Second))
	if len(actions) != 1 || actions[0].Topic != "modbus/pump1/param/set_running" {
		t.Fatalf("actions = %+v", actions)
	}
	if string(actions[0].Payload) != `{"value": false}` {
		t.Errorf("payload = %q", actions[0].Payload)
	}
	if len(incidents) != 1 || incidents[0].Rule != "pump1-fault" {
		t.Errorf("incidents = %+v", incidents)
	}
}

func TestServiceFilePLCNeedsAnIncidentSource(t *testing.T) {
	// The tsend2mqtt example predates the schema: its incidents carry no
	// source, which the schema requires. The file must be corrected before
	// the service adopts the module (finding 7 of PLAN.md).
	_, problems := Load(readTestdata(t, "tsend2mqtt.xml"), plcExampleCatalog())
	if len(problems) == 0 {
		t.Fatal("the file has incidents without a source; it must not load")
	}
	found := false
	for _, p := range problems {
		if p.Path != "" && contains(p.Message, "source") {
			found = true
		}
	}
	if !found {
		t.Errorf("problems = %v, want one about the missing source", problems)
	}
}

func TestServiceFilePLCWithSources(t *testing.T) {
	// The same file with source="plc1" on each incident, which is what the
	// service ships after the migration.
	data := addSource(readTestdata(t, "tsend2mqtt.xml"))
	cat := plcExampleCatalog()
	parsed, problems := Load(data, cat)
	if len(problems) != 0 {
		t.Fatalf("the corrected example must load:\n%v", problems)
	}
	e := NewEngine(parsed, cat)
	values := []any{false, 0, 0.0}
	e.Eval(values, t0)

	// The alarm bit fires the camera rule and raises its incident, with the
	// key the service publishes today.
	values[0] = true
	actions, incidents := e.Eval(values, t0.Add(time.Second))
	if len(actions) == 0 {
		t.Fatal("the alarm must fire the camera")
	}
	if len(incidents) == 0 {
		t.Fatal("the alarm must raise an incident")
	}
	for _, inc := range incidents {
		if inc.Trigger && inc.Rule == "alarm-camera" && inc.DedupKey != "plc1-alarm-camera" {
			t.Errorf("dedup key = %q, want plc1-alarm-camera", inc.DedupKey)
		}
	}
}

// addSource puts source="plc1" on every incident of a document.
func addSource(data []byte) []byte {
	out := make([]byte, 0, len(data)+64)
	needle := []byte("<incident ")
	for i := 0; i < len(data); i++ {
		if i+len(needle) <= len(data) && string(data[i:i+len(needle)]) == string(needle) {
			out = append(out, needle...)
			out = append(out, []byte(`source="plc1" `)...)
			i += len(needle) - 1
			continue
		}
		out = append(out, data[i])
	}
	return out
}

// slotOf finds the slot of one field, or fails the test.
func slotOf(t *testing.T, cat Catalog, device, tag string) int {
	t.Helper()
	for i := 0; i < len(cat.Fields); i++ {
		if cat.Fields[i].Device == device && cat.Fields[i].Tag == tag {
			return i
		}
	}
	t.Fatalf("the catalog has no field %s.%s", device, tag)
	return 0
}

// contains reports whether s holds sub.
func contains(s, sub string) bool { return indexOf(s, sub) >= 0 }
