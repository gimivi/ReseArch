// app/shared/i18n.mjs — accesso alle lingue dell'interfaccia per i moduli ES
// (_doc/arch-i18n-a11y.md §2). L'implementazione è una sola, in js/i18n.js (script classico
// caricato nel <head>): qui si riesportano gli stessi nomi.
//
//   import { t, te } from "./shared/i18n.mjs";
//   el.textContent = t('app.tjs.menu.lights');
//   html += `<button aria-label="${te('common.close')}">`;
//
// Se js/i18n.js non è stato caricato (pagina non ancora convertita) t() restituisce la chiave.

const _t  = (key, params) => (typeof window.t  === 'function' ? window.t(key, params)  : key);
const _te = (key, params) => (typeof window.te === 'function' ? window.te(key, params) : key);

export const t  = _t;
export const te = _te;

/** Lingua dell'interfaccia (es. 'it'). */
export const lang    = () => window.raI18n?.lang ?? 'it';
/** Profilo del vocabolario (es. 'research'). */
export const profile = () => window.raI18n?.profile ?? 'research';

export const formatDate   = (d, opts) => window.raI18n ? window.raI18n.formatDate(d, opts)   : String(d);
export const formatNumber = (n, opts) => window.raI18n ? window.raI18n.formatNumber(n, opts) : String(n);
