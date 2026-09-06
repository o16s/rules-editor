// Small DOM helpers with no editor state: an element builder, inline icons,
// and the two kinds of choice control.

export type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
export type Opt = { value: string; label: string };

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') node.className = String(v);
    else if (v === false) continue;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

/** An inline icon from a static path list (never from user input). */
export function icon(paths: string): HTMLElement {
  const span = el('span', { class: 're-icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 14 14">${paths}</svg>`;
  return span;
}
export const ICON_TRASH = '<path d="M2.5 4h9M5.5 4V2.5h3V4M4 4v7.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" fill="none" stroke="currentColor" stroke-width="1.2"/>';
export const ICON_COPY = '<rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="4.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/>';

/**
 * Identifiers must survive a phone keyboard: iOS otherwise capitalises the
 * first letter and autocorrects, so `alert_temp` is stored as `Alert_temp`
 * and no longer matches the field it names. Prose fields keep the defaults.
 */
export const identifierAttrs = <T extends HTMLElement>(input: T): T => {
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  return input;
};

export function selectInput(value: string, options: Opt[], onChange: (v: string) => void, label: string): HTMLSelectElement {
  const sel = el('select', { 'aria-label': label, onchange: (e) => onChange((e.target as HTMLSelectElement).value) });
  for (const opt of options) {
    const o = el('option', { value: opt.value }, [opt.label]);
    if (opt.value === value) o.setAttribute('selected', 'selected');
    sel.append(o);
  }
  return sel;
}

/**
 * A choice shown as text with a caret, styled like the text around it. The
 * native select sits on top, transparent and 16px, so a tap opens the
 * picker without iOS zooming and without the visible text changing size.
 */
export function pickInput(value: string, options: Opt[], onChange: (v: string) => void, label: string): HTMLElement {
  const labelOf = (v: string): string => options.find((o) => o.value === v)?.label ?? v;
  const text = el('span', { class: 're-pick-label' }, [labelOf(value)]);
  const sel = selectInput(value, options, (v) => { text.textContent = labelOf(v); onChange(v); }, label);
  return el('span', { class: 're-pick' }, [text, el('span', { class: 're-pick-caret', 'aria-hidden': 'true' }, ['▾']), sel]);
}
