// The XML panel: view the file as text, copy it, download it, paste or open
// a file and import it.
import { parse, RulesParseError } from '../parse.js';
import { el, identifierAttrs } from './dom.js';
export function createXmlPanel(deps) {
    const panel = el('div', { class: 're-xml', hidden: true });
    let textarea = null;
    /** What the panel last wrote into the textarea; a different value is the user's paste. */
    let synced = '';
    const copyBtn = el('button', { class: 're-link', type: 'button', onclick: () => copy() }, ['Copy XML']);
    const exportBtn = el('button', { class: 're-link', type: 'button', onclick: () => download() }, ['Download rules.xml']);
    function open() {
        const ta = identifierAttrs(el('textarea', { rows: 14, 'aria-label': 'rules.xml', spellcheck: false }));
        ta.value = deps.xml();
        synced = ta.value;
        textarea = ta;
        const msg = el('div', { class: 're-xml-msg' });
        const file = el('input', { type: 'file', accept: '.xml,text/xml,application/xml', 'aria-label': 'Open a rules.xml file' });
        file.addEventListener('change', async () => {
            const f = file.files?.[0];
            if (f)
                ta.value = await f.text();
        });
        const doImport = () => {
            try {
                const model = parse(ta.value);
                msg.className = 're-xml-msg';
                msg.textContent = `Imported ${model.rules.length} rule${model.rules.length === 1 ? '' : 's'}.`;
                panel.hidden = true;
                deps.onImport(model);
            }
            catch (err) {
                msg.className = 're-xml-msg is-error';
                msg.textContent = err instanceof RulesParseError ? err.message : 'Could not parse XML.';
            }
        };
        panel.replaceChildren(el('div', { class: 're-xml-head' }, [
            el('span', {}, ['rules.xml']),
            el('button', { class: 're-link', type: 'button', onclick: () => (panel.hidden = true) }, ['Close']),
        ]), ta, el('div', { class: 're-xml-actions' }, [
            el('button', { class: 're-btn-primary', type: 'button', onclick: doImport }, ['Import']),
            file,
            copyBtn,
            exportBtn,
        ]), msg);
        panel.hidden = false;
    }
    function download() {
        const blob = new Blob([deps.xml()], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'rules.xml' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function copy() {
        const old = copyBtn.textContent;
        const say = (text) => { copyBtn.textContent = text; setTimeout(() => (copyBtn.textContent = old), 1600); };
        try {
            await navigator.clipboard.writeText(deps.xml());
            say('Copied');
        }
        catch {
            // No clipboard permission (plain http on a gateway, or a locked-down
            // iframe): hand the text over selected, so one keystroke copies it.
            if (textarea) {
                textarea.focus();
                textarea.select();
            }
            say('Selected, press copy');
        }
    }
    return {
        element: panel,
        copyBtn,
        exportBtn,
        toggle: () => { if (panel.hidden)
            open();
        else
            panel.hidden = true; },
        sync: (xml) => {
            if (!textarea || panel.hidden || document.activeElement === textarea || textarea.value !== synced)
                return;
            textarea.value = xml;
            synced = xml;
        },
        gate: (issues) => {
            for (const btn of [copyBtn, exportBtn]) {
                btn.disabled = issues > 0;
                if (issues)
                    btn.title = `Fix ${issues} issue${issues === 1 ? '' : 's'} first.`;
                else
                    btn.removeAttribute('title');
            }
        },
    };
}
//# sourceMappingURL=xml-panel.js.map