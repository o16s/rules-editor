import type { Meta } from '@storybook/html-vite';
import { initRulesEditor, type RulesEditorHandle, type RulesEditorOptions } from '../src/gui.js';
import { CATALOG, liveValues } from './samples.js';

/**
 * Host design-token sets. The editor reads these from its container with
 * fallbacks, so they are the whole theming surface a consumer has.
 */
export const THEMES: Record<string, Record<string, string>> = {
  'octaview (default)': {},
  'blue / serif': {
    '--accent': '#2f6fed',
    '--accent-hover': '#1d4fb8',
    '--ink': '#101828',
    '--bg': '#f4f6fb',
    '--surface': '#ffffff',
    '--font-body': 'Georgia, "Times New Roman", serif',
  },
  'dark': {
    '--accent': '#FF7A2F',
    '--accent-hover': '#FF9C5E',
    '--ink': '#F2F2F0',
    '--bg': '#16161A',
    '--surface': '#1F1F24',
    '--gray-200': '#33333A',
    '--gray-300': '#3F3F47',
    '--gray-500': '#8A8A93',
    '--gray-700': '#C9C9D1',
    '--grid': '#2C2C33',
    '--sheet-head': '#26262C',
    '--sheet-result': '#232329',
    '--selected': '#2E2E36',
    '--reading': '#8FB4D9',
    '--warning': '#E0B25A',
    '--incident': '#FF6B6B',
  },
};

/** Container widths. 560 and below is the phone model; 900 and below folds the rail. */
export const WIDTHS = ['fluid', '320px', '360px', '560px', '800px', '1180px'] as const;
export type Width = (typeof WIDTHS)[number];

export interface HarnessArgs extends Omit<RulesEditorOptions, 'monitor' | 'catalog'> {
  /** Width of the element the editor is mounted into — not the browser width. */
  containerWidth: Width;
  theme: keyof typeof THEMES | string;
  /** Show the live rules.xml / validation output next to the editor. */
  showOutput: boolean;
  /** Feed the result columns from a fixed set of live values. */
  liveValues: boolean;
  /** Supply the device and tag catalog, so TAG("…") offers a menu. */
  catalog: boolean;
}

export const harnessArgTypes: Meta<HarnessArgs>['argTypes'] = {
  containerWidth: { control: 'select', options: WIDTHS, table: { category: 'Harness' } },
  theme: { control: 'select', options: Object.keys(THEMES), table: { category: 'Harness' } },
  showOutput: { control: 'boolean', table: { category: 'Harness' } },
  liveValues: { control: 'boolean', table: { category: 'Harness' } },
  catalog: { control: 'boolean', table: { category: 'Harness' } },
  initialXml: { control: 'text', table: { category: 'Editor' } },
  initialModel: { control: 'object', table: { category: 'Editor' } },
  onChange: { table: { disable: true } },
};

export const harnessDefaults = {
  containerWidth: 'fluid' as Width,
  theme: 'octaview (default)',
  showOutput: true,
  liveValues: true,
  catalog: true,
};

/** The editor of the story currently on screen — poke at it from the console. */
declare global {
  interface Window { editor?: RulesEditorHandle }
}

function pane(title: string): { wrap: HTMLElement; body: HTMLElement } {
  const wrap = document.createElement('section');
  wrap.style.cssText = 'min-width:0;display:flex;flex-direction:column;gap:.35rem';
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText =
    'margin:0;font:600 11px/1 system-ui,sans-serif;letter-spacing:.08em;' +
    'text-transform:uppercase;color:#6b7280';
  const body = document.createElement('div');
  wrap.append(h, body);
  return { wrap, body };
}

export function renderHarness(args: HarnessArgs): HTMLElement {
  const { containerWidth, theme, showOutput, liveValues: live, catalog, ...editorOpts } = args;

  const page = document.createElement('div');
  page.style.cssText =
    'display:grid;gap:1rem;padding:1rem;align-items:start;font:14px system-ui,sans-serif;background:#e9eaec;min-height:100vh;box-sizing:border-box;' +
    (showOutput ? 'grid-template-columns:minmax(0,1fr) minmax(0,24rem)' : '');

  // The editor's host. Its own width drives the responsive layout, so every
  // story can be checked at a phone width without resizing the browser.
  const host = document.createElement('div');
  host.style.cssText = 'min-width:0';
  if (containerWidth !== 'fluid') host.style.width = containerWidth;
  for (const [k, v] of Object.entries(THEMES[theme] ?? {})) host.style.setProperty(k, v);

  const errors = document.createElement('div');
  errors.style.cssText = 'white-space:pre-wrap;color:#b3261e;min-height:1.2em;font-size:12px';
  const xml = document.createElement('pre');
  xml.style.cssText =
    'margin:0;padding:.6rem;background:#0e0e16;color:#e8e8ec;border-radius:6px;' +
    'font-size:11px;line-height:1.5;overflow:auto;max-height:60vh';

  const handle = initRulesEditor(host, {
    ...editorOpts,
    monitor: live ? liveValues : undefined,
    catalog: catalog ? CATALOG : undefined,
    onChange: (state) => {
      if (showOutput) {
        xml.textContent = state.xml;
        errors.textContent = state.errors.length ? state.errors.join('\n') : '✓ valid';
        errors.style.color = state.errors.length ? '#b3261e' : '#2e7d32';
      }
      editorOpts.onChange?.(state);
    },
  });
  window.editor = handle;

  page.append(host);
  if (showOutput) {
    const side = document.createElement('div');
    side.style.cssText = 'display:flex;flex-direction:column;gap:1rem;min-width:0';
    const e = pane('validation');
    e.body.append(errors);
    const x = pane('rules.xml');
    x.body.append(xml);
    side.append(e.wrap, x.wrap);
    page.append(side);
  }
  return page;
}
