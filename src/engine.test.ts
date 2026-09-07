import { describe, it, expect } from 'vitest';
import { runEngine } from './engine.js';

// The engine the gateway runs, loaded into the page. These tests prove the
// module starts, answers, and gives the answers the Go suite gives.

describe('the rule engine in the browser', () => {
  it('draws the lines and reports what the rule fired', async () => {
    const out = await runEngine({
      periodMs: 1000,
      fields: [{ device: '', tag: 'temp', type: 'number' }],
      steps: Array.from({ length: 6 }, (_, i) => ({ tMs: i * 1000, values: [10 + i * 10] })),
      variables: [{ name: 'avg', text: 'AVG(TAG("temp"), 5s)' }],
      rows: [{ name: 'hot', text: 'TAG("temp") > 25' }],
      sources: [],
      match: 'all',
      ruleXml: `<rules><rule name="hot" edge="rising">
          <cond expr='TAG("temp") &gt; 25' description="Above 25"/>
          <actions><publish topic="alerts/hot" payload='{"a":1}'/></actions>
        </rule></rules>`,
    });

    expect(out.error).toBeUndefined();
    expect(out.problems).toEqual([]);
    // The window holds five readings, so the first falls out at the last step.
    expect(out.variables[0].values).toEqual([10, 15, 20, 25, 30, 40]);
    expect(out.rows[0].values).toEqual([false, false, true, true, true, true]);
    expect(out.result).toEqual([false, false, true, true, true, true]);
    // A rising edge fires once, and the payload comes from the engine's own
    // renderer, not from the page.
    expect(out.firings).toEqual([
      { index: 2, actions: [{ topic: 'alerts/hot', payload: '{"a":1}' }], incidents: [] },
    ]);
  });

  it('names the fault in a rule file instead of failing silently', async () => {
    const out = await runEngine({
      periodMs: 1000,
      fields: [{ device: '', tag: 'temp', type: 'number' }],
      steps: [{ tMs: 0, values: [1] }],
      variables: [],
      rows: [],
      sources: [],
      match: 'all',
      ruleXml: `<rules><rule name="x"><cond expr='TAG("nope") &gt; 1'/>
        <actions><publish topic="t"/></actions></rule></rules>`,
    });
    expect(out.problems.length).toBeGreaterThan(0);
    expect(out.problems[0].message).toMatch(/nope/);
    expect(out.problems[0].rule).toBe('x');
  });

  it('keeps drawing the lines that do compile while one does not', async () => {
    const out = await runEngine({
      periodMs: 1000,
      fields: [{ device: '', tag: 'temp', type: 'number' }],
      steps: [{ tMs: 0, values: [30] }],
      variables: [],
      rows: [
        { name: 'good', text: 'TAG("temp") > 25' },
        { name: 'half typed', text: 'TAG("temp") >' },
      ],
      sources: [],
      match: 'all',
      ruleXml: '',
    });
    expect(out.rows[0].values).toEqual([true]);
    expect(out.rows[0].problem).toBeUndefined();
    expect(out.rows[1].values).toEqual([null]);
    expect(out.rows[1].problem).toBeTruthy();
  });

  it('answers unknown, not zero, for a window with nothing in it', async () => {
    const out = await runEngine({
      periodMs: 1000,
      fields: [{ device: '', tag: 'temp', type: 'number' }],
      steps: [{ tMs: 0, values: [null] }],
      variables: [
        { name: 'rate', text: 'RATE(TAG("temp"), 10s)' },
        { name: 'spread', text: 'STDDEV(TAG("temp"), 10s)' },
        { name: 'count', text: 'COUNT(TAG("temp"), 10s)' },
      ],
      rows: [],
      sources: [],
      match: 'all',
      ruleXml: '',
    });
    expect(out.variables[0].values).toEqual([null]);
    expect(out.variables[1].values).toEqual([null]);
    // Counting nothing is a number an operator can compare against.
    expect(out.variables[2].values).toEqual([0]);
  });

  it('runs the new functions the way the Go suite runs them', async () => {
    const readings = [10, 20, 30, 40, 50];
    const out = await runEngine({
      periodMs: 1000,
      fields: [{ device: '', tag: 't', type: 'number' }],
      steps: readings.map((v, i) => ({ tMs: i * 1000, values: [v] })),
      variables: [
        { name: 'min', text: 'MIN(TAG("t"), 10s)' },
        { name: 'max', text: 'MAX(TAG("t"), 10s)' },
        { name: 'delta', text: 'DELTA(TAG("t"), 10s)' },
        { name: 'slope', text: 'SLOPE(TAG("t"), 10s)' },
        { name: 'prev', text: 'PREV(TAG("t"))' },
        { name: 'since', text: 'SINCE(TAG("t"))' },
      ],
      rows: [],
      sources: [],
      match: 'all',
      ruleXml: '',
    });
    const last = (n: string): unknown => {
      const s = out.variables.find((v) => v.name === n);
      return s?.values[s.values.length - 1];
    };
    expect(last('min')).toBe(10);
    expect(last('max')).toBe(50);
    expect(last('delta')).toBe(40);
    // Ten units a second is 36000 an hour.
    expect(last('slope')).toBeCloseTo(36000, 6);
    expect(last('prev')).toBe(40);
    expect(last('since')).toBe(0);
  });
});
