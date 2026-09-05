import type { Meta, StoryObj } from '@storybook/html-vite';
import { renderHarness, harnessArgTypes, harnessDefaults, type HarnessArgs } from './harness.js';
import { SAMPLE_XML, MALFORMED_XML, INVALID_MODEL, DEEP_MODEL, manyRules } from './samples.js';

const meta: Meta<HarnessArgs> = {
  title: 'Rules editor',
  render: renderHarness,
  argTypes: harnessArgTypes,
  args: harnessDefaults,
};
export default meta;

type Story = StoryObj<HarnessArgs>;

/** No options at all — what a consumer gets from `initRulesEditor(el)`. */
export const Default: Story = {};

/** Nothing to edit yet: the empty state and its "load the example" affordance. */
export const Empty: Story = {
  args: { initialModel: { rules: [] } },
};

/** A realistic file: nested and/or, two publishes, an incident, cooldown, edge. */
export const FromXml: Story = {
  name: 'From rules.xml',
  args: { initialXml: SAMPLE_XML },
};

/** A broken file must not throw — it opens empty and reports the parse error. */
export const MalformedXml: Story = {
  name: 'Malformed rules.xml',
  args: { initialXml: MALFORMED_XML },
};

/** Every validation message at once, and the field marking that goes with it. */
export const ValidationErrors: Story = {
  args: { initialModel: INVALID_MODEL },
};

/** Nested to `LIMITS.maxDepth` — the deepest indent the layout has to hold. */
export const NestedGroups: Story = {
  args: { initialModel: DEEP_MODEL },
};

/** 50 rules: scrolling, sticky chrome and render cost on a real-sized file. */
export const ManyRules: Story = {
  args: { initialModel: manyRules(50), showOutput: false },
};

/** The layout at the narrowest container the component supports. */
export const NarrowContainer: Story = {
  args: { initialXml: SAMPLE_XML, containerWidth: '320px', showOutput: false },
};

/** Host design tokens are the whole theming surface — swap them and check. */
export const Themed: Story = {
  args: { initialXml: SAMPLE_XML, theme: 'dark', showOutput: false },
};
