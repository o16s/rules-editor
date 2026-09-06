import { initRulesEditor, type RulesEditorHandle, type RulesEditorOptions } from '../src/gui.js';

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
    '--font-heading': 'Georgia, "Times New Roman", serif',
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
  },
};

export const WIDTHS = ['fluid', '320px', '390px', '480px', '768px', '1024px'] as const;
export type Width = (typeof WIDTHS)[number];

export interface HarnessArgs extends RulesEditorOptions {
  /** Width of the element the editor is mounted into — not the browser width. */
  containerWidth: Width;
  theme: keyof typeof THEMES | string;
  /** Show the live rules.xml / validation output next to the editor. */
  showOutput: boolean;
}

export const harnessArgTypes = {
  containerWidth: { control: 'select', options: WIDTHS, table: { category: 'Harness' } },
  theme: { control: 'select', options: Object.keys(THEMES), table: { category: 'Harness' } },
  showOutput: { control: 'boolean', table: { category: 'Harness' } },
  initialXml: { control: 'text', table: { category: 'Editor' } },
  initialModel: { control: 'object', table: { category: 'Editor' } },
  onChange: { table: { disable: true } },
};

export const harnessDefaults = {
  containerWidth: 'fluid' as Width,
  theme: 'octaview (default)',
  showOutput: true,
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
  const { containerWidth, theme, showOutput, ...editorOpts } = args;

  const page = document.createElement('div');
  page.style.cssText =
    'display:grid;gap:1rem;padding:1rem;align-items:start;font:14px system-ui,sans-serif;' +
    (showOutput ? 'grid-template-columns:minmax(0,1fr) minmax(0,24rem)' : '');

  // The editor's host. Its own width drives the responsive layout, so every
  // story can be checked at a phone width without resizing the browser.
  const host = document.createElement('div');
  host.style.cssText =
    'min-width:0;border:1px solid #e4e6eb;border-radius:8px;padding:1rem;background:var(--surface,#fff)';
  if (containerWidth !== 'fluid') host.style.maxWidth = containerWidth;
  for (const [k, v] of Object.entries(THEMES[theme] ?? {})) host.style.setProperty(k, v);

  const errors = document.createElement('div');
  errors.style.cssText = 'white-space:pre-wrap;color:#b3261e;min-height:1.2em;font-size:12px';
  const xml = document.createElement('pre');
  xml.style.cssText =
    'margin:0;padding:.6rem;background:#0e0e16;color:#e8e8ec;border-radius:6px;' +
    'font-size:11px;line-height:1.5;overflow:auto;max-height:60vh';

  const handle = initRulesEditor(host, {
    ...editorOpts,
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
