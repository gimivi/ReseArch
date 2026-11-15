/* js/i18n.js — lingue dell'interfaccia lato client (_doc/arch-i18n-a11y.md §2).
 *
 * Legge window.RA_I18N = { lang, profile, langs, dict }, scritto dal PHP (api/i18n.php,
 * ra_i18n_head) nel <head> subito prima di questo file. Il dizionario è già unito per lingua e
 * profilo dal server: qui si cerca solo la chiave.
 *
 * Espone (script classico, disponibile per ui/*.js e per i moduli):
 *   window.t(key, params)   testo semplice, da usare con textContent
 *   window.te(key, params)  testo protetto per HTML, da usare dentro innerHTML / template
 *   window.raI18n           { lang, profile, langs, setLang(code), formatDate, formatNumber }
 * I moduli ES importano gli stessi nomi da app/shared/i18n.mjs.
 */
(function () {
  'use strict';

  const data  = window.RA_I18N || {};
  const dict  = data.dict || {};
  const lang  = data.lang || 'it';
  let plural  = null;
  try { plural = new Intl.PluralRules(lang); } catch { /* lingua non riconosciuta da Intl */ }

  function lookup(key, params) {
    let text = dict[key];
    if (text === undefined && params && typeof params.n === 'number') {
      const form = plural ? plural.select(params.n) : (params.n === 1 ? 'one' : 'other');
      text = dict[key + '.' + form] ?? dict[key + '.other'];
    }
    return text;
  }

  function t(key, params) {
    let text = lookup(key, params);
    if (text === undefined) return key;          // chiave mancante: si vede subito
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
    }
    return text;
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function te(key, params) {
    return t(key, params).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  /** Salva la lingua scelta (profilo utente e/o cookie) e ricarica la pagina. */
  async function setLang(code) {
    const body = new URLSearchParams({ lang: code });
    const base = document.querySelector('script[src$="js/i18n.js"]')?.getAttribute('src')
      ?.replace(/js\/i18n\.js$/, '') ?? '';
    try {
      const res = await fetch(base + 'api/set_lang.php', { method: 'POST', body, credentials: 'same-origin' });
      const out = await res.json();
      if (!out.success) throw new Error(out.message || 'set_lang');
      location.reload();
    } catch (err) {
      console.warn('[i18n] cambio lingua non riuscito:', err.message);
    }
  }

  const formatDate   = (d, opts) => new Intl.DateTimeFormat(lang, opts).format(d instanceof Date ? d : new Date(d));
  const formatNumber = (n, opts) => new Intl.NumberFormat(lang, opts).format(n);

  window.t  = t;
  window.te = te;
  window.raI18n = { lang, profile: data.profile || 'research', langs: data.langs || {}, setLang, formatDate, formatNumber };
})();
