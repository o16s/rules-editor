// The words on the sheets: choice options and the help paragraphs, grounded
// in the documented rules.xml schema.

import { SEVERITIES, type Edge } from '../model.js';
import type { Opt } from './dom.js';

export const MATCH_OPTIONS: Opt[] = [
  { value: 'any', label: 'any' },
  { value: 'all', label: 'all' },
];
export const EDGE_OPTIONS: Opt[] = [
  { value: 'rising', label: 'becomes true' },
  { value: 'none', label: 'is true' },
];
/** Under a rail row: the same words as the Trigger choice, so one setting has one name. */
export const EDGE_META: Record<Edge, string> = { rising: 'when it becomes true', none: 'while it is true' };
export const ACTION_OPTIONS: Opt[] = [
  { value: 'publish', label: 'Publish MQTT message' },
  ...SEVERITIES.map((s) => ({ value: s, label: `Raise ${s} alarm` })),
];

// Help, one paragraph per sheet.
export const HELP = {
  variables:
    'One named formula per row. The name takes letters, digits and underscores. The formula reads a field with TAG("device", "tag"). RATE(x, 30min), CHANGED(x), BITAND(x, mask), HEX2DEC("FF") and the comparison operators build on it. Formula result is the live value from the gateway, when it is connected. The description says what the value means, for the operator.',
  when:
    'One condition per row, written with the variable names, for example temp > 50 or AND(milk_temp > 3.6, door_changed). "any" fires when one row is true, and "all" fires when every row is true. "becomes true" fires once, when the rows turn from false to true. "is true" fires again on every cycle while they stay true. The alarm can quote a description as condition.description.',
  then:
    'One row per field of an action. A publish has a topic and a payload. An alarm has a source (the device the alarm belongs to), a title (at most 120 characters), a first step (what the operator does first) and a cause (why it fired, and how far what we read goes). A field that starts with = is a formula, and it can use condition.description. The cooldown is a time such as 30s, 1m30s or 500ms. Leave it blank to fire every time.',
};
