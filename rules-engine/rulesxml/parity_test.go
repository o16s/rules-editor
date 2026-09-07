package rulesxml

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The schema in ../../schema/rules.xsd is the published source of truth for
// rules.xml: the editor validates against it in the browser and edge-hub
// validates every uploaded file against it on the server. If this package and
// that schema disagree, the fleet gets one of two bad days — a file the hub
// saves happily and a service refuses to start on, or a file the hub rejects
// that a service would have run.
//
// So every fixture is validated twice, once by Validate and once by xmllint
// against the schema, and the two verdicts must match. Where they must not
// match, the reason is written down below and the test asserts the mismatch
// rather than allowing it.
//
// The fixtures are the ones src/xsd.test.ts uses, as files. Both suites read
// them, so neither side can drift alone.

const (
	schemaFile   = "../../schema/rules.xsd"
	fixturesRoot = "../../schema/fixtures"
)

// knownDivergence lists the fixtures where Validate and the schema disagree
// on purpose. Everything absent from this map must agree.
//
// validateRejects says which side is stricter: true means Validate rejects
// what the schema accepts.
var knownDivergence = map[string]struct {
	validateRejects bool
	reason          string
}{
	"app-level/comparison-operator-without-value.xml": {
		validateRejects: true,
		reason: "value is required for every operator except changed. XSD 1.0 cannot make " +
			"one attribute depend on another, so the schema cannot express this and the " +
			"editor checks it in code too.",
	},
	"app-level/comparison-operator-with-empty-value.xml": {
		validateRejects: true,
		reason:          "same rule as above: the value constraint depends on op.",
	},
	"app-level/cond-without-tag-or-expr.xml": {
		validateRejects: true,
		reason: "a cond carries either expr, or tag and op. XSD 1.0 cannot require one " +
			"attribute or another.",
	},
	"app-level/cond-with-tag-but-no-op.xml": {
		validateRejects: true,
		reason:          "same rule as above: op is required only in the 0.2 form.",
	},
	"app-level/cond-with-both-expr-and-tag.xml": {
		validateRejects: true,
		reason: "the two condition forms are exclusive. XSD 1.0 cannot forbid a " +
			"combination of attributes.",
	},
}

// schemaAcceptsAnyway lists fixtures that live in xsd-stricter although the
// schema accepts them. The upstream suite keeps them there because the
// round trip through the editor is lossy, not because the schema refuses.
var schemaAcceptsAnyway = map[string]bool{
	"xsd-stricter/description-on-a-folded-nested-leaf.xml": true,
}

// xmllintPath finds xmllint. In CI a missing xmllint is a failure, because a
// skipped test is not a green parity check.
func xmllintPath(t *testing.T) string {
	t.Helper()
	path, err := exec.LookPath("xmllint")
	if err == nil {
		return path
	}
	if os.Getenv("CI") != "" {
		t.Fatal("xmllint is missing in CI; install libxml2-utils")
	}
	t.Skip("xmllint not installed; install libxml2-utils to check schema parity")
	return ""
}

// schemaAccepts reports the schema's verdict on one file.
func schemaAccepts(t *testing.T, xmllint, file string) bool {
	t.Helper()
	cmd := exec.Command(xmllint, "--noout", "--schema", schemaFile, file)
	err := cmd.Run()
	if err == nil {
		return true
	}
	var exit *exec.ExitError
	if !asExitError(err, &exit) {
		t.Fatalf("running xmllint on %s: %v", file, err)
	}
	return false
}

// asExitError is errors.As for *exec.ExitError without importing errors into
// every call site.
func asExitError(err error, target **exec.ExitError) bool {
	e, ok := err.(*exec.ExitError)
	if ok {
		*target = e
	}
	return ok
}

// validateAccepts reports this package's verdict on one file.
func validateAccepts(t *testing.T, file string) (bool, []Problem) {
	t.Helper()
	f, err := os.Open(file)
	if err != nil {
		t.Fatalf("open %s: %v", file, err)
	}
	defer f.Close()
	problems := Validate(f)
	return len(problems) == 0, problems
}

// fixtures lists every fixture as a path relative to the fixtures root, for
// example "valid/incident-only.xml".
func fixtures(t *testing.T) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(fixturesRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || filepath.Ext(path) != ".xml" {
			return nil
		}
		rel, relErr := filepath.Rel(fixturesRoot, path)
		if relErr != nil {
			return relErr
		}
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatalf("walking fixtures: %v", err)
	}
	if len(out) < 90 {
		t.Fatalf("found %d fixtures, want the whole set; is schema/fixtures populated?", len(out))
	}
	return out
}

func TestValidateAgreesWithThePublishedSchema(t *testing.T) {
	xmllint := xmllintPath(t)

	for _, rel := range fixtures(t) {
		t.Run(rel, func(t *testing.T) {
			file := filepath.Join(fixturesRoot, rel)
			bySchema := schemaAccepts(t, xmllint, file)
			byUs, problems := validateAccepts(t, file)

			if known, ok := knownDivergence[rel]; ok {
				if bySchema == byUs {
					t.Fatalf("this fixture is listed as a known divergence but both now say accept=%v.\n"+
						"Reason on record: %s\nRemove the entry if the divergence is gone.", bySchema, known.reason)
				}
				if known.validateRejects && byUs {
					t.Errorf("expected Validate to be the stricter side here, but it accepted.\nReason on record: %s", known.reason)
				}
				return
			}

			if bySchema != byUs {
				t.Errorf("verdicts differ: schema accept=%v, Validate accept=%v.\n"+
					"Either fix Validate, or add %q to knownDivergence with the reason.\nValidate said:\n%s",
					bySchema, byUs, rel, formatProblems(problems))
			}
		})
	}
}

// The class of a fixture is itself an assertion about the schema. Checking it
// here catches a schema change that makes a fixture mean something else.
func TestFixturesMatchTheirDirectory(t *testing.T) {
	xmllint := xmllintPath(t)

	wantAccept := map[string]bool{
		"valid":        true,
		"invalid":      false,
		"app-level":    true, // the schema cannot express the rule, so it accepts
		"xsd-stricter": false,
	}
	for _, rel := range fixtures(t) {
		if schemaAcceptsAnyway[rel] {
			continue
		}
		class := strings.SplitN(rel, "/", 2)[0]
		want, ok := wantAccept[class]
		if !ok {
			t.Errorf("fixture %s is in an unknown class %q", rel, class)
			continue
		}
		if got := schemaAccepts(t, xmllint, filepath.Join(fixturesRoot, rel)); got != want {
			t.Errorf("%s: schema accept=%v, but its directory says %v", rel, got, want)
		}
	}
}

// The schema this package agrees with is the one the editor ships. A version
// bump must be a deliberate, visible change here.
func TestSchemaVersion(t *testing.T) {
	raw, err := os.ReadFile(schemaFile)
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	if !strings.Contains(string(raw), `version="0.3.`) {
		t.Error("the schema is not a 0.3.x version; update this test and the module tag together")
	}
}

// formatProblems renders a problem list for a failure message.
func formatProblems(ps []Problem) string {
	if len(ps) == 0 {
		return "  (nothing)"
	}
	var b strings.Builder
	for i := 0; i < len(ps) && i < 10; i++ {
		b.WriteString("  " + ps[i].Path + ": " + ps[i].Message + "\n")
	}
	return b.String()
}
