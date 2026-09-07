import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, within } from 'storybook/test';
import { initRulesEditor, initSimulator, type RulesModel, type SimulatorHandle } from '../src/gui.js';
import { THEMES, WIDTHS, type Width } from './harness.js';
import { CATALOG, DESIGN_SIGNALS, EXAMPLE_MODEL, liveValues } from './samples.js';

interface SimArgs {
  /** Width of the element the page is mounted into. */
  containerWidth: Width;
  theme: keyof typeof THEMES | string;
  /** Which rule of the example file to simulate. */
  rule: number;
  stop: number;
  step: number;
  cursor: number;
  /** Start from the signals of the design handoff (rule 1 only); otherwise every tag holds its catalog value. */
  designSignals: boolean;
  model: RulesModel;
}

declare global {
  interface Window { simulator?: SimulatorHandle }
}

let mounted: { destroy(): void } | null = null;

function host(args: SimArgs): HTMLElement {
  const page = document.createElement('div');
  page.style.cssText = 'padding:1rem;font:14px system-ui,sans-serif;background:#e9eaec;min-height:100vh;box-sizing:border-box';
  const box = document.createElement('div');
  box.style.cssText = 'min-width:0';
  if (args.containerWidth !== 'fluid') box.style.width = args.containerWidth;
  for (const [k, v] of Object.entries(THEMES[args.theme] ?? {})) box.style.setProperty(k, v);
  page.append(box);
  return box;
}

/** The Simulator page on its own, as in design 14a. */
function renderSimulator(args: SimArgs): HTMLElement {
  mounted?.destroy();
  const box = host(args);
  const rule = args.model.rules[args.rule] ?? args.model.rules[0];
  const handle = initSimulator(box, {
    rule,
    catalog: CATALOG,
    signals: args.designSignals && args.rule === 0 ? DESIGN_SIGNALS : undefined,
    stop: args.stop,
    step: args.step,
    cursor: args.cursor,
    onBack: () => undefined,
  });
  window.simulator = handle;
  mounted = handle;
  return box.parentElement as HTMLElement;
}

/** The editor with its Simulator button; the button swaps in the page, and "← rule" swaps back. */
function renderFlow(args: SimArgs): HTMLElement {
  mounted?.destroy();
  const box = host(args);
  let current: { destroy(): void } | null = null;
  const editorBox = document.createElement('div');
  const simBox = document.createElement('div');
  box.append(editorBox, simBox);
  simBox.hidden = true;
  const editor = initRulesEditor(editorBox, {
    initialModel: args.model,
    catalog: CATALOG,
    monitor: liveValues,
    onSimulate: (index) => {
      const rule = editor.getModel().rules[index];
      current?.destroy();
      current = initSimulator(simBox, {
        rule,
        catalog: CATALOG,
        signals: index === 0 ? DESIGN_SIGNALS : undefined,
        stop: args.stop,
        step: args.step,
        onBack: () => { simBox.hidden = true; editorBox.hidden = false; },
      });
      window.simulator = current as SimulatorHandle;
      editorBox.hidden = true;
      simBox.hidden = false;
    },
  });
  mounted = { destroy: () => { editor.destroy(); current?.destroy(); } };
  return box.parentElement as HTMLElement;
}

const meta: Meta<SimArgs> = {
  title: 'Simulator',
  render: renderSimulator,
  argTypes: {
    containerWidth: { control: 'select', options: WIDTHS, table: { category: 'Harness' } },
    theme: { control: 'select', options: Object.keys(THEMES), table: { category: 'Harness' } },
    rule: { control: { type: 'number', min: 0, max: EXAMPLE_MODEL.rules.length - 1 }, table: { category: 'Simulator' } },
    stop: { control: 'number', table: { category: 'Simulator' } },
    step: { control: 'number', table: { category: 'Simulator' } },
    cursor: { control: 'number', table: { category: 'Simulator' } },
    designSignals: { control: 'boolean', table: { category: 'Simulator' } },
    model: { control: 'object', table: { category: 'Simulator' } },
  },
  args: {
    containerWidth: '1180px',
    theme: 'octaview (default)',
    rule: 0,
    stop: 600,
    step: 1,
    cursor: 250,
    designSignals: true,
    model: EXAMPLE_MODEL,
  },
};
export default meta;

type Story = StoryObj<SimArgs>;

/** Design 14a: the alarm-camera rule against the handoff's signals, cursor at 250 s, one fire at 180 s. */
export const Page: Story = {};

/** Follows the width of the window. Below 900px the log moves under the timeline; below 560px the tag formula sits above its signal. */
export const Responsive: Story = {
  args: { containerWidth: 'fluid' },
};

/** The page at a phone width. */
export const Phone: Story = {
  args: { containerWidth: '360px', cursor: 180 },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
};

/** Another rule of the example file, with every tag holding its catalog value: nothing fires until a signal is changed. */
export const PumpOvertemp: Story = {
  args: { rule: 1, designSignals: false },
};

/** From the editor: the Simulator button opens the page for the selected rule, and "← rule" returns. */
export const FromEditor: Story = {
  render: renderFlow,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Simulator' }));
    await expect(canvasElement.querySelector('.rs-root')).toBeTruthy();
    await expect(canvas.getByRole('button', { name: '← alarm-camera' })).toBeVisible();
    await expect(canvasElement.querySelectorAll('.rs-lane').length).toBeGreaterThan(5);
    await expect(canvasElement.querySelector('.rs-log .is-fired')?.textContent).toMatch(/Fired\./);
  },
};

/** Signals are edited in place: the run repeats and the log follows. The housing stays cool and the door stays shut, so only the delayed alarm bit fires. */
export const EditSignal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const set = async (label: string, value: string): Promise<void> => {
      const input = canvas.getByLabelText(label) as HTMLInputElement;
      await userEvent.clear(input);
      await userEvent.type(input, `${value}{enter}`);
    };
    await set('Signal for vibration1 temperature', 'HOLD(45)');
    await set('Signal for bulk1 door_state', 'HOLD("closed")');
    const alarm = canvas.getByLabelText('Signal for plc1 AlarmActive') as HTMLInputElement;
    await userEvent.clear(alarm);
    await userEvent.type(alarm, 'STEP(false, true, 400s){enter}');
    await expect(canvasElement.querySelector('.rs-log .is-fired .rs-time')?.textContent).toBe('400 s');
  },
};

/** A signal that is not one: the row is marked and its tag reads nothing. */
export const InvalidSignal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Signal for plc1 StatusWord') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'RAMP(1){enter}');
    await expect(canvasElement.querySelector('.rs-cell-signal.is-invalid .rs-msg')?.textContent).toMatch(/takes 3 arguments/);
  },
};
