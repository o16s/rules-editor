import { describe, it, expect } from 'vitest';
import { initSimulator, parseSeconds, type RulesModel, type Rule, type TagCatalog } from './gui.js';

const rule = (r: Partial<Rule> = {}): Rule => ({
  name: 'alarm-camera',
  cooldown: '45s',
  edge: 'rising',
  variables: [
    { name: 'alarm_active', formula: 'TAG("plc1", "AlarmActive")' },
    { name: 'temp', formula: 'TAG("vibration1", "temperature")' },
    { name: 'temp_rate', formula: 'RATE(temp, 30min)' },
    { name: 'door_changed', formula: 'CHANGED(TAG("bulk1", "door_state"))' },
  ],
  match: 'any',
  conditions: [
    { expr: 'alarm_active', description: 'Cell 3 PLC raised its own alarm' },
    { expr: 'temp > 50' },
    { expr: 'AND(temp_rate > 4, door_changed)' },
  ],
  actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
  incident: { source: 'Cell 3 press', severity: 'critical', summary: 'Press guard alarm on cell 3' },
  ...r,
});
const model: RulesModel = { rules: [rule()] };
void model;

const CATALOG: TagCatalog = {
  devices: [
    { device: 'plc1', tags: [{ tag: 'AlarmActive', value: 'false' }] },
    { device: 'vibration1', tags: [{ tag: 'temperature', unit: '°C', value: '48.2' }] },
    { device: 'bulk1', tags: [{ tag: 'door_state', value: 'closed' }] },
  ],
};
const SIGNALS = {
  'plc1/AlarmActive': 'STEP(false, true, 180s)',
  'vibration1/temperature': 'RAMP(42, 56, 600s)',
  'bulk1/door_state': 'PULSE("closed", "open", 150s, 30s)',
};

function setup(opts: Partial<Parameters<typeof initSimulator>[1]> = {}, width = 1180) {
  const root = document.createElement('div');
  Object.defineProperty(root, 'clientWidth', { value: width, configurable: true });
  document.body.append(root);
  const api = initSimulator(root, { rule: rule(), catalog: CATALOG, signals: SIGNALS, stop: 600, step: 1, cursor: 250, ...opts });
  return { root, api };
}
const text = (el: Element | null | undefined): string => el?.textContent?.trim() ?? '';
const lanes = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.rs-lane'));
const labelOf = (lane: HTMLElement) => text(lane.querySelector('.rs-label')).replace(/^[▾▸]\s*/, '');

describe('simulator page (jsdom)', () => {
  it('renders the header, one tag row per tag, the tree fully open, and the log', () => {
    const { root } = setup();
    expect(text(root.querySelector('.rs-title'))).toBe('Simulator');
    expect((root.querySelector('.rs-back') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('[aria-label="Stop time"]') as HTMLInputElement).value).toBe('600 s');
    expect((root.querySelector('[aria-label="Max step"]') as HTMLInputElement).value).toBe('1 s');
    expect(text(root.querySelector('.rs-readout'))).toBe('250 s');
    // tags in first-seen order, tag formula coloured, signal in an input
    const rows = Array.from(root.querySelectorAll('.rs-tags .rs-row'));
    expect(rows.map((r) => text(r.querySelector('.rs-cell-formula')))).toEqual(['=TAG("plc1", "AlarmActive")', '=TAG("vibration1", "temperature")', '=TAG("bulk1", "door_state")']);
    expect((rows[0].querySelector('input') as HTMLInputElement).value).toBe('STEP(false, true, 180s)');
    // the tree: condition › variable › tag, every level open
    expect(lanes(root).map(labelOf)).toEqual([
      '=alarm_active', 'alarm_active', '=TAG("plc1", "AlarmActive")',
      '=temp > 50', 'temp', '=TAG("vibration1", "temperature")',
      '=AND(temp_rate > 4, door_changed)', 'temp_rate', 'temp', '=TAG("vibration1", "temperature")', 'door_changed', '=TAG("bulk1", "door_state")',
    ]);
    expect(lanes(root).map((l) => l.classList.contains('is-condition'))).toEqual([true, false, false, true, false, false, true, false, false, false, false, false]);
    // the log has the fire
    const fired = root.querySelector('.rs-log .is-fired');
    expect(text(fired?.querySelector('.rs-time'))).toBe('180 s');
    expect(text(fired?.querySelector('.rs-event'))).toMatch(/^Fired\. Condition 1 became true\. Publish MQTT camera\/record/);
    expect(root.querySelectorAll('.rs-fire')).toHaveLength(1);
  });

  it('shows the value at the cursor with units, y labels on analog lanes, and bands on discrete ones', () => {
    const { root, api } = setup();
    const values = () => lanes(root).map((l) => text(l.querySelector('.rs-value')));
    expect(values().slice(0, 6)).toEqual(['true', 'true', 'true', 'false', '47.8 °C', '47.8 °C']);
    // temp_rate has no history in a 600 s run
    expect(values()[7]).toBe('—');
    // analog lane: axis max over min, threshold from the condition, a trace
    const temp = lanes(root)[4];
    expect(Array.from(temp.querySelectorAll('.rs-axis span')).map(text)).toEqual(['56 °C', '42 °C']);
    expect(temp.querySelectorAll('.rs-threshold')).toHaveLength(1);
    expect(temp.querySelector('.rs-trace')?.getAttribute('d')).toMatch(/^M0\.0 /);
    // discrete lane: bands labelled false then true, the true one tinted
    const cond = lanes(root)[0];
    const bandText = Array.from(cond.querySelectorAll('.rs-band')).map(text);
    expect(bandText).toEqual(['false', 'true']);
    expect(cond.querySelectorAll('.rs-band.is-on')).toHaveLength(1);
    expect((cond.querySelector('.rs-band') as HTMLElement).style.width).toBe('30%');
    // the door: closed / open bands, unit-less text
    const door = lanes(root)[11];
    expect(Array.from(door.querySelectorAll('.rs-band')).map(text).slice(0, 3)).toEqual(['closed', 'open', 'closed']);
    // moving the cursor re-reads the column without a re-render
    api.setCursor(100);
    expect(text(root.querySelector('.rs-readout'))).toBe('100 s');
    expect(text(root.querySelector('.rs-at'))).toBe('At 100 s');
    expect(values().slice(0, 5)).toEqual(['false', 'false', 'false', 'false', '44.3 °C']);
    expect(root.style.getPropertyValue('--rs-frac')).toBe('');
    expect((root.querySelector('.rs-timeline') as HTMLElement).style.getPropertyValue('--rs-frac')).toBe(String(100 / 600));
  });

  it('folds and opens a tree node', () => {
    const { root } = setup();
    expect(lanes(root)).toHaveLength(12);
    (lanes(root)[0].querySelector('.rs-label') as HTMLButtonElement).click();
    expect(lanes(root)).toHaveLength(10);
    expect(text(lanes(root)[0].querySelector('.rs-caret'))).toBe('▸');
    (lanes(root)[0].querySelector('.rs-label') as HTMLButtonElement).click();
    expect(lanes(root)).toHaveLength(12);
    // a leaf has no caret and its label is not a control
    expect((lanes(root)[2].querySelector('.rs-label') as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-runs when a signal, the stop time or the step is committed', () => {
    let changes = 0;
    const { root, api } = setup({ onChange: () => changes++ });
    const before = changes;
    const input = root.querySelector('[aria-label="Signal of plc1/AlarmActive"]') as HTMLInputElement;
    input.value = 'STEP(false, true, 400s)';
    input.dispatchEvent(new Event('input'));
    expect(changes).toBe(before); // a draft
    input.dispatchEvent(new Event('change'));
    expect(changes).toBe(before + 1);
    // the alarm now steps at 400 s, so the ramp crossing 50 °C at 343 s fires first
    expect(api.getSimulation().fires).toEqual([343]);
    expect(api.getState().signals['plc1/AlarmActive']).toBe('STEP(false, true, 400s)');
    // a typed leading = is stripped
    const again = root.querySelector('[aria-label="Signal of plc1/AlarmActive"]') as HTMLInputElement;
    again.value = '=STEP(false, true, 300s)';
    again.dispatchEvent(new Event('change'));
    expect(api.getState().signals['plc1/AlarmActive']).toBe('STEP(false, true, 300s)');
    // stop time: "10m" is a Go duration; the axis follows
    const stop = root.querySelector('[aria-label="Stop time"]') as HTMLInputElement;
    stop.value = '20m';
    stop.dispatchEvent(new Event('change'));
    expect(api.getState().stop).toBe(1200);
    expect(stop.value).toBe('1200 s');
    expect(Array.from(root.querySelectorAll('.rs-tick')).map(text)).toEqual(['0 s', '240 s', '480 s', '720 s', '960 s', '1200 s']);
    // an invalid stop time is ignored and the field restored
    stop.value = 'soon';
    stop.dispatchEvent(new Event('change'));
    expect(api.getState().stop).toBe(1200);
    expect(stop.value).toBe('1200 s');
    const step = root.querySelector('[aria-label="Max step"]') as HTMLInputElement;
    step.value = '10';
    step.dispatchEvent(new Event('change'));
    expect(api.getSimulation().times).toHaveLength(121);
  });

  it('marks a signal that does not parse and gives its tag no value', () => {
    const { root } = setup({ signals: { ...SIGNALS, 'vibration1/temperature': 'RAMP(1)' } });
    const cell = root.querySelector('.rs-cell-signal.is-invalid');
    expect(text(cell?.querySelector('.rs-msg'))).toMatch(/takes 3 arguments/);
    expect(text(lanes(root)[4].querySelector('.rs-value'))).toBe('—');
  });

  it('holds the catalog value for a tag with no signal', () => {
    const { root, api } = setup({ signals: {} });
    expect(api.getState().signals).toEqual({ 'plc1/AlarmActive': 'HOLD(false)', 'vibration1/temperature': 'HOLD(48.2)', 'bulk1/door_state': 'HOLD("closed")' });
    expect(text(root.querySelector('.rs-log .rs-event'))).toBe('Nothing happened in this run.');
    expect(root.querySelectorAll('.rs-fire')).toHaveLength(0);
  });

  it('shows the back link when asked, and setRule swaps the rule and drops stale signals', () => {
    let back = 0;
    const { root, api } = setup({ onBack: () => back++ });
    const btn = root.querySelector('.rs-back') as HTMLButtonElement;
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('← alarm-camera');
    btn.click();
    expect(back).toBe(1);
    api.setRule(rule({ name: 'pump', variables: [{ name: 'temp', formula: 'TAG("vibration1", "temperature")' }], conditions: [{ expr: 'temp > 45' }] }));
    expect(btn.textContent).toBe('← pump');
    expect(Object.keys(api.getState().signals)).toEqual(['vibration1/temperature']);
    expect(lanes(root).map(labelOf)).toEqual(['=temp > 45', 'temp', '=TAG("vibration1", "temperature")']);
  });

  it('sets width classes from its container and cleans up on destroy', () => {
    const wide = setup();
    expect(wide.root.classList.contains('is-medium')).toBe(false);
    const medium = setup({}, 800);
    expect(medium.root.classList.contains('is-medium')).toBe(true);
    expect(medium.root.classList.contains('is-narrow')).toBe(false);
    const phone = setup({}, 360);
    expect(phone.root.classList.contains('is-narrow')).toBe(true);
    phone.api.destroy();
    expect(phone.root.className).toBe('');
    expect(phone.root.children).toHaveLength(0);
    expect(document.getElementById('octaview-rules-simulator-styles')).toBeTruthy();
  });

  it('reads seconds in the forms the header accepts', () => {
    expect(parseSeconds('600 s')).toBe(600);
    expect(parseSeconds('600')).toBe(600);
    expect(parseSeconds('2.5')).toBe(2.5);
    expect(parseSeconds('10m')).toBe(600);
    expect(parseSeconds('1m30s')).toBe(90);
    expect(parseSeconds('soon')).toBeNull();
    expect(parseSeconds('')).toBeNull();
  });
});
