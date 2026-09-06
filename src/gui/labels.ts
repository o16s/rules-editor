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
export const EDGE_META: Record<Edge, string> = { rising: 'rising edge', none: 'every cycle' };
export const ACTION_OPTIONS: Opt[] = [
  { value: 'publish', label: 'Publish MQTT message' },
  ...SEVERITIES.map((s) => ({ value: s, label: `Raise ${s} alarm` })),
];

// Help, one paragraph per sheet.
export const HELP = {
  variables:
    'One named formula per row. Name: letters, digits and underscores. Formula: TAG("device", "tag") reads a field; RATE(x, 30min), CHANGED(x), BITAND(x, mask), HEX2DEC("FF") and the comparison operators build on it. Formula result: the live value, when the host supplies one. Description: what the value means, for the operator.',
  when:
    'One condition per row, written with the variable names, for example temp > 50 or AND(milk_temp > 3.6, door_changed). "any" fires when one row is true, "all" when every row is true. "becomes true" fires once on the false-to-true change; "is true" fires on every cycle while true. Description: quoted by the alarm as condition.description.',
  then:
    'One row per field of an action. Publish MQTT message: topic and payload. Raise alarm: source (the device the alarm is attributed to), title (at most 120 characters), first step (what the operator does first) and cause (why it fired, and where the boundary of what we read sits). A field that starts with = is a formula and can use condition.description. Cooldown: a Go duration such as 30s, 1m30s or 500ms; blank fires every time.',
};
