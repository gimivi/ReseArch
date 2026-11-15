// app/shared/model-css.mjs
// Fogli di stile di un modello (mod_spec.css) — regola di piattaforma, primo uso: TML.
// Progetto: _doc/module-tml-timeline.md §11, regola generale in _doc/arch-css.md.
//
// Tre forme di voce, applicate nell'ordine dell'array (deciso 2026-10-20):
//   - "nome.css"            → file nella cartella del modello (baseUrl, vedi modelFolderUrl);
//   - { name, url }         → file indicato dal backend (mod_abs_url di un modello il cui file
//                             è un .css: il percorso sta nel campo nome file del modello);
//   - { name, text }        → CSS scritto nel mod_spec (mod_spec.cssText).
// I file si scrivono e modificano fuori dalla piattaforma.
//
// Ogni voce viene:
//   1. letta da new URL(nome, baseUrl) — solo un file della stessa cartella — o da url, o da text;
//   2. ripulito: via @import/@charset/@namespace, expression(), behavior, -moz-binding,
//      image-set(); url(...) ammesso solo relativo (dentro la cartella del CSS, riscritto
//      assoluto) o data:image/font — niente indirizzi esterni;
//   3. confinato al pannello: il testo va dentro `[data-css-scope="N"] { … }` (CSS annidato
//      nativo); `.<rootClass>` e `:root` diventano `&` (la radice stessa), così un CSS può
//      ridefinire le variabili scrivendo `.tml-root { --tml-bg: … }` o `:root { … }`.
//      @font-face, @keyframes, @property, @counter-style restano fuori dall'annidamento
//      (non vi sono ammessi).
// Un <style> per file, rimosso alla chiusura del pannello (signal).

let _scopeSerial = 0;

const HOISTED_AT_RULES = new Set(['font-face', 'keyframes', '-webkit-keyframes', 'property', 'counter-style', 'font-feature-values']);
const DROPPED_AT_RULES = new Set(['import', 'charset', 'namespace']);

/** Nome di file ammesso: niente percorsi, niente URL, estensione .css. */
export function isSafeCssName(name) {
    const n = String(name ?? '');
    return /^[^/\\:?#]+\.css$/i.test(n) && !n.includes('..');
}

/**
 * Cartella di un modello come URL con "/" finale, base per i nomi di mod_spec.css.
 * Modello con file: la cartella del file; modello senza file: mod_abs_url è già la cartella
 * (il backend non aggiunge la "/", senza la quale new URL(nome, …) salirebbe di un livello).
 */
export function modelFolderUrl(model) {
    const abs = String(model?.mod_abs_url ?? '');
    if (!abs) return null;
    if (String(model?.mod_filename ?? '').trim()) return abs;
    return abs.endsWith('/') ? abs : `${abs}/`;
}

function _resolveUrl(raw, cssUrl) {
    const v = String(raw ?? '').trim();
    if (!v) return null;
    if (/^data:(image\/|font\/|application\/(x-)?font)/i.test(v)) {
        return /^data:image\/svg/i.test(v) ? null : v;   // SVG inline: può contenere riferimenti esterni
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.startsWith('/') || v.startsWith('\\')) return null;
    if (!cssUrl) return null;   // CSS del mod_spec senza cartella: nessun url relativo
    let abs;
    try { abs = new URL(v, cssUrl); } catch { return null; }
    const base = new URL('.', cssUrl);
    if (abs.origin !== base.origin || !abs.pathname.startsWith(base.pathname)) return null;
    return abs.href;
}

/** Divide il CSS in istruzioni di primo livello (rispettando stringhe e graffe). */
function _splitTopLevel(css) {
    const out = [];
    let depth = 0, start = 0, quote = null;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (quote) {
            if (c === '\\') { i++; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
            depth = Math.max(0, depth - 1);
            if (depth === 0) { out.push(css.slice(start, i + 1)); start = i + 1; }
        } else if (c === ';' && depth === 0) {
            out.push(css.slice(start, i + 1)); start = i + 1;
        }
    }
    const rest = css.slice(start).trim();
    if (rest) out.push(rest);
    return out.map(s => s.trim()).filter(Boolean);
}

/**
 * Ripulisce e confina un CSS.
 * @param {string} text       testo del file
 * @param {string} cssUrl     URL assoluto del file (per risolvere gli url relativi)
 * @param {string} scopeSel   selettore della radice (es. '[data-css-scope="3"]')
 * @param {string} rootClass  classe della radice nel CSS dell'autore (es. 'tml-root')
 * @returns {{ css: string, dropped: number }}
 */
export function sanitizeScopedCss(text, cssUrl, scopeSel, rootClass) {
    let dropped = 0;
    let css = String(text ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    css = css.replace(/expression\s*\(|(?<![\w-])behavior\s*:|-moz-binding\s*:|javascript\s*:/gi, () => { dropped++; return 'invalid-'; });
    css = css.replace(/(-webkit-)?image-set\s*\(/gi, () => { dropped++; return 'invalid-image-set('; });
    css = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q, u) => {
        const abs = _resolveUrl(u, cssUrl);
        if (!abs) { dropped++; return 'none'; }
        return `url("${abs.replace(/["\\\n\r]/g, c => '\\' + c.charCodeAt(0).toString(16) + ' ')}")`;
    });

    const outside = [], inside = [];
    for (const stmt of _splitTopLevel(css)) {
        const at = /^@([-\w]+)/.exec(stmt);
        if (at) {
            const name = at[1].toLowerCase();
            if (DROPPED_AT_RULES.has(name) || !stmt.endsWith('}')) { dropped++; continue; }
            if (HOISTED_AT_RULES.has(name)) { outside.push(stmt); continue; }
        }
        inside.push(stmt);
    }

    const rootRe = new RegExp(`\\.${rootClass.replace(/[-]/g, '\\-')}(?![\\w-])|:root(?![\\w-])`, 'g');
    const body = inside.join('\n').replace(rootRe, '&');
    return { css: `${outside.join('\n')}\n${scopeSel} {\n${body}\n}\n`, dropped };
}

/**
 * Applica i CSS di un modello a una radice DOM.
 *
 * @param {object}      o
 * @param {HTMLElement} o.root       elemento radice (riceve data-css-scope)
 * @param {string}      o.rootClass  classe della radice, es. 'tml-root'
 * @param {string}      o.baseUrl    cartella dei nomi di file (modelFolderUrl)
 * @param {Array<string|{name:string,url?:string,text?:string}>} o.files  voci (vedi in testa)
 * @param {AbortSignal} o.signal     signal del pannello
 * @returns {{ ready: Promise<{ loaded: number, errors: string[] }>,
 *             list: () => Array<{ name, active, ok, error }>,
 *             setActive: (name: string, on: boolean) => boolean,
 *             reload: () => Promise<{ loaded: number, errors: string[] }> }}
 */
export function applyModelCss({ root, rootClass, baseUrl, files, signal }) {
    const scopeId = String(++_scopeSerial);
    root.dataset.cssScope = scopeId;
    // classe + attributo: più specifico di `.tml-root …` dello strato base (css/TML.css), che
    // può arrivare nella pagina DOPO questi <style> e a parità di specificità vincerebbe
    const scopeSel = `.${rootClass}[data-css-scope="${scopeId}"]`;

    const entries = (Array.isArray(files) ? files : []).map(f => ({
        name: String((f && typeof f === 'object' ? f.name : f) ?? ''),
        url:  f && typeof f === 'object' && f.url ? String(f.url) : null,
        text: f && typeof f === 'object' && f.text != null ? String(f.text) : null,
        active: true,
        ok: false,
        error: null,
        styleEl: null,
    }));

    let base = null;
    try { base = baseUrl ? new URL(baseUrl, location.href) : null; } catch { base = null; }

    async function loadOne(e) {
        e.ok = false; e.error = null;
        let url, text;
        if (e.text != null) {
            url = base?.href ?? null;   // url relativi del testo: dentro la cartella del modello
            text = e.text;
        } else {
            if (e.url) {
                try { url = new URL(e.url, location.href).href; } catch { e.error = `${e.name}: indirizzo non valido`; return; }
            } else {
                if (!isSafeCssName(e.name)) { e.error = `nome non ammesso: "${e.name}" (solo un file .css della cartella del modello)`; return; }
                if (!base) { e.error = `${e.name}: nessuna cartella in cui cercarlo (serve un modello di configurazione)`; return; }
                url = new URL(e.name, base).href;
            }
            try {
                const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin', signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                text = await res.text();
            } catch (err) {
                if (signal?.aborted) return;
                e.error = `${e.name}: ${err.message}`;
                return;
            }
        }
        const { css, dropped } = sanitizeScopedCss(text, url, scopeSel, rootClass);
        if (!e.styleEl) {
            e.styleEl = document.createElement('style');
            e.styleEl.dataset.modelCss = e.name;
            e.styleEl.dataset.cssScope = scopeId;
        }
        e.styleEl.textContent = css;
        e.ok = true;
        if (dropped) e.error = `${e.name}: ${dropped} parti tolte (import, indirizzi esterni o codice)`;
    }

    async function loadAll() {
        await Promise.all(entries.map(loadOne));
        if (signal?.aborted) return { loaded: 0, errors: [] };
        // inserisce i <style> nell'ordine dell'array, in coda a <head>
        for (const e of entries) {
            if (!e.styleEl) continue;
            document.head.appendChild(e.styleEl);
            e.styleEl.disabled = !e.active;
        }
        return {
            loaded: entries.filter(e => e.ok).length,
            errors: entries.map(e => e.error).filter(Boolean),
        };
    }

    signal?.addEventListener('abort', () => {
        for (const e of entries) { try { e.styleEl?.remove(); } catch { /* noop */ } }
    }, { once: true });

    return {
        ready: loadAll(),
        list: () => entries.map(({ name, active, ok, error }) => ({ name, active, ok, error })),
        setActive(name, on) {
            const e = entries.find(x => x.name === name);
            if (!e) return false;
            e.active = !!on;
            if (e.styleEl) e.styleEl.disabled = !e.active;
            return true;
        },
        reload: loadAll,
    };
}
