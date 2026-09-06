import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, within } from 'storybook/test';
import { renderHarness, harnessArgTypes, harnessDefaults, type HarnessArgs } from './harness.js';
import {
  EXAMPLE_MODEL,
  SAMPLE_XML,
  SAMPLE_XML_V03,
  MALFORMED_XML,
  INVALID_MODEL,
  NESTED_V02_XML,
  manyRules,
} from './samples.js';

const meta: Meta<HarnessArgs> = {
  title: 'Rules editor',
  render: renderHarness,
  argTypes: harnessArgTypes,
  args: { ...harnessDefaults, initialModel: EXAMPLE_MODEL },
};
export default meta;

type Story = StoryObj<HarnessArgs>;

/** Follows the width of the window. Open this one on a phone: the editor measures its own container and switches layout by itself. */
export const Responsive: Story = {
  args: { containerWidth: 'fluid', showOutput: false },
};

/** The design handoff at desktop width: the rail, and the Variables, When and Then sheets with live values. Fixed at 1180px, so on a phone it scrolls sideways by design. */
export const Desktop: Story = {
  args: { containerWidth: '1180px', showOutput: false },
};

/** Below 900px the rail folds into a select above the sheets. Sheets scroll sideways instead of squeezing. */
export const Tablet: Story = {
  args: { containerWidth: '800px', showOutput: false },
};

/** The phone model: one sheet per tab, sideways scroll with frozen row numbers, tap a cell to edit it in the bottom bar. */
export const Phone: Story = {
  args: { containerWidth: '360px', showOutput: false },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
};

/** The narrowest supported container. */
export const PhoneSmall: Story = {
  name: 'Phone, 320px',
  args: { containerWidth: '320px', showOutput: false },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

/** Tap a formula cell, type in the bar, and the XML follows. */
export const PhoneFormulaBar: Story = {
  args: { containerWidth: '360px', showOutput: false },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cell = canvas.getByLabelText('Formula of variable 3').closest('.re-cell') as HTMLElement;
    await userEvent.click(cell);
    await expect(canvasElement.querySelector('.re-bar')).toHaveClass('is-open');
    await expect(canvasElement.querySelector('.re-bar-address')).toHaveTextContent('temp_rate · Formula');
    const bar = canvas.getByLabelText('Cell content') as HTMLInputElement;
    await userEvent.clear(bar);
    await userEvent.type(bar, 'RATE(temp, 15min)');
    await expect(window.editor!.getXml()).toContain('RATE(temp, 15min)');
    await expect(cell.querySelector('.re-formula-view')).toHaveTextContent('=RATE(temp, 15min)');
  },
};

/** A bad formula marks the cell and shows its message in the bar, where the keyboard cannot hide it. */
export const PhoneInvalidFormula: Story = {
  args: { containerWidth: '360px', showOutput: false },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The tabs appear once the ResizeObserver has measured the container.
    await userEvent.click(await canvas.findByRole('tab', { name: /When/ }));
    const cell = canvas.getByLabelText('Condition 2').closest('.re-cell') as HTMLElement;
    await userEvent.click(cell);
    const bar = canvas.getByLabelText('Cell content') as HTMLInputElement;
    await userEvent.clear(bar);
    await userEvent.type(bar, 'temp >');
    await expect(cell).toHaveClass('is-invalid');
    await expect(canvasElement.querySelector('.re-bar .re-msg')).toHaveTextContent('column 7');
  },
};

/** No host values: the result columns show a dash, Then rows still preview their text. */
export const NoLiveValues: Story = {
  args: { containerWidth: '1180px', showOutput: false, liveValues: false },
};

/** Nothing to edit yet: the empty state and its "Load example" link. */
export const Empty: Story = {
  args: { initialModel: { rules: [] }, liveValues: false },
};

/** A v0.2 file: leaf conditions and nested and/or open as formula rows and save in the v0.3 form. */
export const FromXml: Story = {
  name: 'From a v0.2 rules.xml',
  args: { initialModel: undefined, initialXml: SAMPLE_XML, liveValues: false },
};

/** A v0.3 file with variables, formulas, first step and cause. */
export const FromXmlV03: Story = {
  name: 'From a v0.3 rules.xml',
  args: { initialModel: undefined, initialXml: SAMPLE_XML_V03, liveValues: false },
};

/** A broken file must not throw — it opens empty and reports the parse error. */
export const MalformedXml: Story = {
  name: 'Malformed rules.xml',
  args: { initialModel: undefined, initialXml: MALFORMED_XML, liveValues: false },
};

/** Every kind of validation message at once: cell washes, messages, the rail count, Download gated. */
export const ValidationErrors: Story = {
  args: { initialModel: INVALID_MODEL, liveValues: false },
};

/** A v0.2 file nested to the maximum depth folds into one AND/OR formula row. */
export const NestedGroupsFold: Story = {
  args: { initialModel: undefined, initialXml: NESTED_V02_XML, liveValues: false },
};

/** 50 rules: the rail, the filter, and render cost on a real-sized file. */
export const ManyRules: Story = {
  args: { initialModel: manyRules(50), showOutput: false, liveValues: false },
};

/** Change the publish row's Action to an alarm: the publish goes, and the rule's alarm takes that severity. */
export const ActionToAlarm: Story = {
  args: { containerWidth: '1180px', showOutput: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByLabelText('Action of row 1'), 'error');
    const rule = window.editor!.getModel().rules[0];
    await expect(rule.actions).toHaveLength(0);
    await expect(rule.incident?.severity).toBe('error');
    await expect(window.editor!.getXml()).toContain('<incident source="Cell 3 press" severity="error"');
  },
};

/** The XML panel: the current file, Import from paste or file, Copy, Download. */
export const XmlPanel: Story = {
  args: { containerWidth: '1180px', showOutput: false },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'XML' }));
    await expect(canvasElement.querySelector('.re-xml')).not.toHaveAttribute('hidden');
  },
};

/** Host design tokens are the whole theming surface — swap them and check. */
export const Themed: Story = {
  args: { containerWidth: '1180px', theme: 'dark', showOutput: false },
};
