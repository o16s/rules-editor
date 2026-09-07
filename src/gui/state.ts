// The editor's shared state and the small types every part of it uses. One
// mutable object, owned by initRulesEditor and passed to each part (rail,
// sheets, bar, menu), so a part reads `state.model` and `state.selected`
// instead of holding its own copy that could go stale.

import type { RulesModel } from '../model.js';
import type { ValidationIssue } from '../parse.js';
import type { TagCatalog } from '../catalog.js';

/** What a `monitor` callback is asked for: one result cell. */
export type MonitorRef = { rule: number } & ({ kind: 'variable'; name: string } | { kind: 'condition'; index: number });

export type Monitor = (ref: MonitorRef) => string | undefined;

export type SheetName = 'vars' | 'when' | 'then';

/** What the formula bar needs to know about a tapped cell. */
export interface CellInfo {
  /** Reads like a name box for the cell's own content: "temp_rate · Formula". */
  address: string;
  /** The in-cell input the bar mirrors; absent for a read-only cell. */
  input?: HTMLInputElement;
  /** True for a formula cell: the TAG("…") menu applies. */
  formula?: boolean;
  /** Removes the cell's row. */
  remove?: () => void;
  /** What the bar's delete button says. Default "Delete row"; a Then row removes the whole action. */
  removeLabel?: string;
}

/**
 * Address of one input, shared by the renderer (as `data-loc`) and by the
 * marking pass (from a ValidationIssue), so an issue finds its field.
 */
export type Loc = Pick<ValidationIssue, 'rule' | 'field' | 'variable' | 'condition' | 'action'>;
export const locKey = (l: Loc): string =>
  `${l.rule ?? ''}|${l.field ?? ''}|${l.variable ?? ''}|${l.condition ?? ''}|${l.action ?? ''}`;

export interface EditorState {
  model: RulesModel;
  /** A malformed initialXml or import, reported through `errors`, never thrown. */
  parseError: string | null;
  /** Index of the rule shown in the pane. */
  selected: number;
  /** The rail's filter text. */
  filter: string;
  /** data-loc of the input to focus (or, when narrow, the cell to select) after the next render. */
  focusNext: string | null;
  /** True when the editor is at most 560px wide: the Google Sheets phone model. */
  narrow: boolean;
  /** The sheet shown in narrow mode. */
  activeSheet: SheetName;
  /** True while a structural change is in progress: commits then skip their own refresh. */
  batching: boolean;
  monitor: Monitor | undefined;
  catalog: TagCatalog | (() => TagCatalog) | undefined;
}

export const resolveCatalog = (state: EditorState): TagCatalog | null =>
  typeof state.catalog === 'function' ? state.catalog() : state.catalog ?? null;
