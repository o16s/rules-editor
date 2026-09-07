import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FormulaError,
  FUNCTIONS,
  RESERVED_NAMES,
  formulaRefs,
  formulaTokens,
  inferType,
  isFormula,
  formulaBody,
  legacyCondToFormula,
  parseFormula,
  printFormula,
  quoteString,
} from './formula.js';

const roundTrip = (text: string): string => printFormula(parseFormula(text));

describe('parseFormula', () => {
  it('parses every literal form', () => {
    expect(parseFormula('50')).toEqual({ kind: 'number', value: 50, raw: '50' });
    expect(parseFormula('3.6')).toEqual({ kind: 'number', value: 3.6, raw: '3.6' });
    expect(parseFormula('"a"')).toEqual({ kind: 'string', value: 'a' });
    expect(parseFormula('TRUE')).toEqual({ kind: 'bool', value: true });
    expect(parseFormula('false')).toEqual({ kind: 'bool', value: false });
    expect(parseFormula('30min')).toEqual({ kind: 'duration', raw: '30min', seconds: 1800 });
    expect(parseFormula('500ms')).toMatchObject({ kind: 'duration', seconds: 0.5 });
    expect(parseFormula('2h')).toMatchObject({ kind: 'duration', seconds: 7200 });
  });

  it('accepts and drops a leading =', () => {
    expect(parseFormula('=temp')).toEqual({ kind: 'ref', name: 'temp' });
  });

  it('reads a doubled quote as one quote inside a string', () => {
    expect(parseFormula('"say ""hi"""')).toEqual({ kind: 'string', value: 'say "hi"' });
    expect(roundTrip('"say ""hi"""')).toBe('"say ""hi"""');
  });

  it('parses a dotted context name', () => {
    expect(parseFormula('condition.description')).toEqual({ kind: 'context', name: 'condition.description' });
  });

  it('parses calls, case-insensitively, and prints them upper-case', () => {
    expect(parseFormula('tag("plc1", "AlarmActive")')).toEqual({
      kind: 'call',
      name: 'TAG',
      args: [{ kind: 'string', value: 'plc1' }, { kind: 'string', value: 'AlarmActive' }],
    });
    expect(roundTrip('and(a,b)')).toBe('AND(a, b)');
  });

  it('applies precedence: & below comparison below + - below * /', () => {
    expect(roundTrip('a + b * c')).toBe('a + b * c');
    expect(roundTrip('(a + b) * c')).toBe('(a + b) * c');
    expect(roundTrip('a > b + 1')).toBe('a > b + 1');
    expect(roundTrip('(a > b) + 1')).toBe('(a > b) + 1');
    expect(parseFormula('x & y = z')).toMatchObject({ op: '&', right: { op: '=' } });
    expect(roundTrip('x & (y = z)')).toBe('x & y = z');
    expect(roundTrip('(x & y) = z')).toBe('(x & y) = z');
    expect(parseFormula('a - b - c')).toMatchObject({ op: '-', left: { op: '-' } });
    expect(roundTrip('a - (b - c)')).toBe('a - (b - c)');
  });

  it('treats <> and == as aliases of != and =', () => {
    expect(parseFormula('a <> 0')).toMatchObject({ kind: 'binary', op: '!=' });
    expect(parseFormula('a == 0')).toMatchObject({ kind: 'binary', op: '=' });
    expect(roundTrip('BITAND(status_word, 4) <> 0')).toBe('BITAND(status_word, 4) != 0');
  });

  it('parses unary minus', () => {
    expect(roundTrip('-5')).toBe('-5');
    expect(roundTrip('-(a + b)')).toBe('-(a + b)');
    expect(roundTrip('a * -b')).toBe('a * -b');
  });

  it('keeps the number text as typed', () => {
    expect(roundTrip('temp > 50.0')).toBe('temp > 50.0');
  });

  it('is stable under print then parse for the 13a formulas', () => {
    for (const f of [
      'TAG("plc1", "AlarmActive")',
      'RATE(temp, 30min)',
      'CHANGED(TAG("bulk1", "door_state"))',
      'BITAND(status_word, 4) != 0',
      'BITAND(status_word, HEX2DEC("10")) != 0',
      'BITAND(alarm_byte, HEX2DEC("FF")) != 0',
      'temp > 50',
      'AND(milk_temp > 3.6, door_changed)',
      'condition.description & ". The press PLC set its own alarm bit."',
    ]) {
      expect(roundTrip(f)).toBe(f);
      expect(roundTrip(roundTrip(f))).toBe(roundTrip(f));
    }
  });

  it('reports the column of a syntax error', () => {
    const at = (text: string): number => {
      try {
        parseFormula(text);
      } catch (e) {
        expect(e).toBeInstanceOf(FormulaError);
        return (e as FormulaError).column;
      }
      throw new Error('did not throw');
    };
    expect(at('temp >')).toBe(6);
    expect(at('=temp >')).toBe(7);
    expect(at('AND(a, b')).toBe(8);
    expect(at('a $ b')).toBe(2);
    expect(at('"open')).toBe(0);
    expect(at('30days')).toBe(2);
    expect(at('a b')).toBe(2);
  });

  it('does not check function names or arity while parsing', () => {
    expect(parseFormula('NOPE(1, 2, 3)')).toMatchObject({ kind: 'call', name: 'NOPE' });
  });
});

describe('formulaTokens', () => {
  it('classifies tokens for display and never throws', () => {
    const kinds = formulaTokens('=TAG("plc1", x) > 50').map((t) => t.kind);
    expect(kinds).toEqual(['function', 'lparen', 'string', 'comma', 'space', 'ident', 'rparen', 'space', 'op', 'space', 'number']);
    const broken = formulaTokens('temp > "open');
    expect(broken[broken.length - 1]).toMatchObject({ kind: 'error', text: '"open' });
    expect(formulaTokens('condition.description & "x"')[0].kind).toBe('context');
    expect(formulaTokens('true')[0].kind).toBe('bool');
  });
});

describe('formulaRefs', () => {
  it('collects variables, literal tags, and context names once each', () => {
    const refs = formulaRefs(parseFormula('AND(milk_temp > 3.6, door_changed, milk_temp < 9, TAG("plc1", "A") = TAG("B"), TAG("plc1", "A"))'));
    expect(refs.variables).toEqual(['milk_temp', 'door_changed']);
    expect(refs.tags).toEqual([{ device: 'plc1', tag: 'A' }, { tag: 'B' }]);
    expect(refs.context).toEqual([]);
    expect(formulaRefs(parseFormula('condition.description & "."')).context).toEqual(['condition.description']);
    // an empty TAG() is an arity error, not a tag reference
    expect(formulaRefs(parseFormula('TAG() > 1')).tags).toEqual([]);
    expect(formulaRefs(parseFormula('TAG(x) > 1')).tags).toEqual([]);
  });
});

describe('inferType', () => {
  const t = (text: string, lookup?: (n: string) => 'bool' | 'number' | 'string' | 'duration' | 'any') =>
    inferType(parseFormula(text), lookup);
  it('types the 13a formulas', () => {
    expect(t('BITAND(status_word, 4) != 0')).toBe('bool');
    expect(t('temp > 50')).toBe('bool');
    expect(t('AND(a, b)')).toBe('bool');
    expect(t('CHANGED(x)')).toBe('bool');
    expect(t('RATE(temp, 30min)')).toBe('number');
    expect(t('temp + 1')).toBe('number');
    expect(t('-temp')).toBe('number');
    expect(t('condition.description & "."')).toBe('string');
    expect(t('TAG("a")')).toBe('any');
    expect(t('30min')).toBe('duration');
    expect(t('alarm_active', () => 'bool')).toBe('bool');
    expect(t('unknown_ref')).toBe('any');
  });
});

describe('legacyCondToFormula', () => {
  it('renders the v0.2 leaf forms', () => {
    expect(legacyCondToFormula({ tag: 'AlarmActive', op: 'eq', value: 'true' })).toBe('TAG("AlarmActive") = true');
    expect(legacyCondToFormula({ device: 'vibration1', tag: 'temperature', op: 'gt', value: '50.0' })).toBe(
      'TAG("vibration1", "temperature") > 50.0'
    );
    expect(legacyCondToFormula({ tag: 'AlarmCode', op: 'changed' })).toBe('CHANGED(TAG("AlarmCode"))');
    expect(legacyCondToFormula({ tag: 'state', op: 'neq', value: 'open door' })).toBe('TAG("state") != "open door"');
    expect(legacyCondToFormula({ tag: 'n', op: 'leq', value: '-3' })).toBe('TAG("n") <= -3');
  });

  it('produces text that parses back', () => {
    const f = legacyCondToFormula({ device: 'v', tag: 't', op: 'geq', value: 'x "q"' });
    expect(roundTrip(f)).toBe(f);
  });
});

describe('helpers', () => {
  it('quotes strings and detects Then-field formulas', () => {
    expect(quoteString('a"b')).toBe('"a""b"');
    expect(isFormula('=x')).toBe(true);
    expect(isFormula('x')).toBe(false);
    expect(isFormula(undefined)).toBe(false);
    expect(formulaBody('=x')).toBe('x');
    expect(formulaBody('x')).toBe('x');
  });

  it('reserves every function name and the literals', () => {
    for (const f of FUNCTIONS) expect(RESERVED_NAMES).toContain(f.name);
    expect(RESERVED_NAMES).toContain('TRUE');
    expect(RESERVED_NAMES).toContain('CONDITION');
  });
});

// ---- parity with the engine ----------------------------------------------
//
// schema/formula-cases.json and schema/formula-functions.json are read by
// this suite and by rules-engine/formula in Go. A change to the language
// that only one side implements fails on the other side, on the same commit.

const SCHEMA_DIR = resolve(fileURLToPath(import.meta.url), '..', '..', 'schema');

interface Case {
  text: string;
  print?: string;
  error?: { column: number; message: string };
}

describe('schema/formula-cases.json', () => {
  const cases = JSON.parse(readFileSync(resolve(SCHEMA_DIR, 'formula-cases.json'), 'utf8')) as Case[];

  it('holds both good and bad formulas', () => {
    expect(cases.length).toBeGreaterThan(50);
    expect(cases.some((c) => c.error)).toBe(true);
  });

  for (const c of cases) {
    it(`${c.error ? 'rejects' : 'prints'} ${JSON.stringify(c.text)}`, () => {
      if (c.error) {
        try {
          parseFormula(c.text);
          throw new Error('expected a FormulaError');
        } catch (e) {
          expect(e).toBeInstanceOf(FormulaError);
          expect((e as FormulaError).column).toBe(c.error.column);
          expect((e as FormulaError).message).toBe(c.error.message);
        }
        return;
      }
      const printed = printFormula(parseFormula(c.text));
      expect(printed).toBe(c.print);
      expect(printFormula(parseFormula(printed))).toBe(c.print);
    });
  }
});

describe('schema/formula-functions.json', () => {
  it('is the registry of formula.ts, so the Go engine reads the same list', () => {
    const onDisk = JSON.parse(readFileSync(resolve(SCHEMA_DIR, 'formula-functions.json'), 'utf8'));
    const inCode = FUNCTIONS.map((f) => ({
      name: f.name,
      minArgs: f.minArgs,
      maxArgs: f.maxArgs,
      returns: f.returns,
      signature: f.signature,
    }));
    expect(onDisk).toEqual(inCode);
  });
});
