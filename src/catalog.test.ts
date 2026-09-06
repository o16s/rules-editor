import { describe, it, expect } from 'vitest';
import { applyTagChoice, tagChoices, tagContext, type TagCatalog } from './catalog.js';

const CATALOG: TagCatalog = {
  devices: [
    { tags: [{ tag: 'AlarmActive' }, { tag: 'StatusWord', unit: '' }] },
    { device: 'vibration1', description: 'Press motor sensor', tags: [{ tag: 'temperature', unit: '°C', value: '48.2' }, { tag: 'alert_vrms_max' }] },
    { device: 'bulk1', tags: [{ tag: 'milk_temperature', unit: '°C', value: '3.4', stale: true }, { tag: 'door_state' }] },
  ],
};

/** `|` marks the caret. */
const at = (s: string) => {
  const caret = s.indexOf('|');
  return tagContext(s.replace('|', ''), caret);
};

describe('tagContext', () => {
  it('finds the first argument as it is typed', () => {
    expect(at('TAG("|')).toEqual({ arg: 0, prefix: '', start: 4, end: 5 });
    expect(at('TAG("vib|')).toEqual({ arg: 0, prefix: 'vib', start: 4, end: 8 });
    expect(at('tag("vib|')).toMatchObject({ arg: 0, prefix: 'vib' });
    expect(at('TAG ("vib|')).toMatchObject({ arg: 0, prefix: 'vib' });
  });

  it('finds the second argument and the device before it', () => {
    expect(at('TAG("vibration1", "|')).toEqual({ arg: 1, prefix: '', device: 'vibration1', start: 18, end: 19 });
    expect(at('TAG("vibration1","te|')).toMatchObject({ arg: 1, prefix: 'te', device: 'vibration1' });
    expect(at('TAG("a""b", "|')).toMatchObject({ arg: 1, device: 'a"b' });
  });

  it('takes the rest of the literal up to its closing quote as the range', () => {
    expect(at('TAG("vib|ration1", "temperature")')).toMatchObject({ arg: 0, prefix: 'vib', start: 4, end: 16 });
    expect(at('TAG("vibration1", "temp|erature")')).toMatchObject({ arg: 1, prefix: 'temp', start: 18, end: 31 });
  });

  it('works inside a larger formula and nested calls', () => {
    expect(at('RATE(TAG("vib|')).toMatchObject({ arg: 0, prefix: 'vib' });
    expect(at('AND(x > 1, CHANGED(TAG("bulk1", "do|')).toMatchObject({ arg: 1, device: 'bulk1', prefix: 'do' });
    expect(at('TAG("vibration1", "temperature") > 50 + TAG("|')).toMatchObject({ arg: 0, prefix: '' });
  });

  it('is null outside a TAG string argument', () => {
    expect(at('temp > 5|0')).toBeNull();
    expect(at('TAG(|')).toBeNull();
    expect(at('TAG("vibration1"|')).toBeNull();
    expect(at('TAG("a", "b", "|')).toBeNull();
    expect(at('RATE("|')).toBeNull();
    expect(at('TAG("vibration1", "temperature")|')).toBeNull();
    expect(at('"TAG(|"')).toBeNull();
    expect(at('TAG(temp, "|')).toBeNull(); // first argument is not a literal
  });
});

describe('tagChoices', () => {
  it('offers devices and the implicit device\'s tags for the first argument, best first', () => {
    const ctx = tagContext('TAG("', 5)!;
    expect(tagChoices(CATALOG, ctx).map((c) => (c.kind === 'device' ? c.device : c.entry.tag))).toEqual([
      'AlarmActive', 'StatusWord', 'vibration1', 'bulk1',
    ]);
    const a = tagContext('TAG("a', 6)!;
    // starts-with first, then contains, each in catalog order
    expect(tagChoices(CATALOG, a).map((c) => (c.kind === 'device' ? c.device : c.entry.tag))).toEqual(['AlarmActive', 'StatusWord', 'vibration1']);
  });

  it('offers the chosen device\'s tags for the second argument', () => {
    const ctx = tagContext('TAG("vibration1", "te', 21)!;
    expect(tagChoices(CATALOG, ctx)).toEqual([{ kind: 'tag', device: 'vibration1', entry: { tag: 'temperature', unit: '°C', value: '48.2' } }]);
    const all = tagContext('TAG("vibration1", "', 19)!;
    expect(tagChoices(CATALOG, all).map((c) => c.entry.tag)).toEqual(['temperature', 'alert_vrms_max']);
    expect(tagChoices(CATALOG, tagContext('TAG("nope", "', 13)!)).toEqual([]);
  });
});

describe('applyTagChoice', () => {
  const text = 'RATE(TAG("vib';
  const ctx = tagContext(text, text.length)!;
  it('a device opens the second argument', () => {
    const r = applyTagChoice(text, ctx, { kind: 'device', device: 'vibration1', entry: CATALOG.devices[1] });
    expect(r.text).toBe('RATE(TAG("vibration1", "');
    expect(r.caret).toBe(r.text.length);
    expect(r.more).toBe(true);
  });

  it('a tag closes the call when nothing does', () => {
    const t2 = 'RATE(TAG("vibration1", "te';
    const r = applyTagChoice(t2, tagContext(t2, t2.length)!, { kind: 'tag', device: 'vibration1', entry: { tag: 'temperature' } });
    expect(r.text).toBe('RATE(TAG("vibration1", "temperature")');
    expect(r.caret).toBe(r.text.length);
    expect(r.more).toBe(false);
  });

  it('keeps what already follows: an existing closing paren, or a second argument', () => {
    const t3 = 'TAG("vibration1", "te") > 5';
    const r = applyTagChoice(t3, tagContext(t3, 21)!, { kind: 'tag', device: 'vibration1', entry: { tag: 'temperature' } });
    expect(r.text).toBe('TAG("vibration1", "temperature") > 5');
    expect(r.text.slice(0, r.caret)).toBe('TAG("vibration1", "temperature")');
    const t4 = 'TAG("vib", "temperature")';
    const r2 = applyTagChoice(t4, tagContext(t4, 8)!, { kind: 'device', device: 'vibration1', entry: CATALOG.devices[1] });
    expect(r2.text).toBe('TAG("vibration1", "temperature")');
    expect(r2.text.slice(0, r2.caret)).toBe('TAG("vibration1", "');
    expect(r2.more).toBe(true);
  });

  it('an implicit-device tag closes at once and quotes a quote', () => {
    const t5 = 'TAG("Al';
    const r = applyTagChoice(t5, tagContext(t5, 7)!, { kind: 'tag', entry: { tag: 'Al"arm' } });
    expect(r.text).toBe('TAG("Al""arm")');
  });
});
