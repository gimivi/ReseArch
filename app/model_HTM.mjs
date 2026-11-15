// model_HTM.mjs
// Viewer HTML per ReseArch — due modalità: iframe, flow.
//
// 2026-09-28 (step 9 di _doc/arch-abilitazioni.md §7): la modalità "inject"
// (markup con <script> riattivati, senza sandbox) è stata RIMOSSA: il codice
// deve stare in un flow (nodo HTM/Script), dove passa dalla validazione dei
// flow. mode:"inject" e lo srcdoc auto-rilevato ora si comportano come "flow"
// (scheletro statico + flow collegati). Lo scheletro HTML viene inoltre
// RIPULITO prima dell'inserimento (sanitizeHTML, HTM-sanitize.mjs): via <script>, attributi
// on*=, URL javascript: — innerHTML non esegue <script> ma esegue gli
// attributi evento (es. <img onerror>).
//
// ── Modalità ─────────────────────────────────────────────────────────────────
//   "iframe"  — Carica il documento in un <iframe> sandboxed.
//               Adatto per pagine HTML complete, URL remoti (Google Forms, ecc.).
//               Il contenuto è isolato dal DOM della piattaforma.
//               Dal 2026-10-21 carica anche i flow collegati: il nodo HTM/Frame/Navigate
//               cambia la pagina (ctx.navigate → state.navigate). Senza indirizzo nel
//               modello mostra "nessuna pagina" finché il flow non ne carica una.
//
//   "flow"    — Markup HTML statico (ripulito) in un <div> del panel, SENZA script:
//               tutta l'esecuzione/logica è delegata ai flow LiteGraph
//               embedded collegati all'oggetto (flow_type='object'), che
//               possono leggere/costruire il DOM del documento tramite i
//               nodi HTM/DOM/* (HTM_sub_modules/HTM-flow-nodes.mjs) via
//               graph._appContext.container — vedi HTM-flow-runner.mjs e
//               _doc/module-htm-html.md. Lo scheletro HTML statico (srcdoc)
//               è comunque riservato all'amministratore (stesso motivo di
//               "inject": onclick/onerror/href="javascript:" restano vettori
//               non filtrati anche senza <script>) — un documento SENZA
//               srcdoc è ammesso: il flow costruisce tutto da zero via nodi.
//
// ── Auto-rilevamento modalità (se mod_spec.mode non è impostato) ─────────────
//   srcdoc presente                → "flow" (prima: "inject")
//   URL (mod_abs_url o spec.src)   → "iframe"
//   "flow" non viene mai auto-rilevato: va sempre dichiarato esplicitamente
//   (altrimenti un documento senza srcdoc/URL, pensato per un flow puro,
//   cadrebbe nel ramo "nessun contenuto" — vedi _hasContent()).
//
// ── Sorgente del contenuto (per precedenza) ───────────────────────────────────
//   1. mod_spec.srcdoc   — HTML inline
//   2. mod_abs_url       — URL generato dal backend (può essere file HTML o URL remoto)
//   3. mod_spec.src      — URL alternativo esplicito
//
// ── mod_spec ─────────────────────────────────────────────────────────────────
//   {
//     mode    : "iframe" | "flow",      // forza la modalità ("inject" = "flow"); default auto-rilevato
//     srcdoc  : "<p>Ciao</p>",          // HTML inline (stringa)
//     src     : "https://…/page.html", // URL alternativo
//     sandbox : "allow-scripts …",     // override sandbox (solo modalità iframe)
//     title   : "Titolo documento"     // attributo title (<iframe>) o aria-label (<div>)
//   }
//
// ── Sicurezza iframe ──────────────────────────────────────────────────────────
//   Same-origin  → "allow-scripts allow-same-origin allow-forms allow-popups"
//   Cross-origin → "allow-scripts allow-forms allow-popups"  (no allow-same-origin)
//   Override admin: mod_spec.sandbox sovrascrive entrambi.
//   allow-top-navigation è sempre escluso.

import { t, te, lang } from './shared/i18n.mjs';
import { sanitizeHTML } from './HTM_sub_modules/HTM-sanitize.mjs';

const STATE_KEY = '__HTM_STATE__';

const SANDBOX_SAME  = 'allow-scripts allow-same-origin allow-forms allow-popups';
const SANDBOX_CROSS = 'allow-scripts allow-forms allow-popups';

// ─────────────────────────────────────────────────────────────────────────────

export default {

  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
    _destroyInstance(bodyEl);

    const arr = Array.isArray(models) ? models.filter(_hasContent) : [];

    const state = {
      panel, headerEl, bodyEl, object,
      models: arr,
      activeIndex: -1,
      mode: null,   // 'iframe' | 'inject' | 'flow' — impostato al caricamento
      node: null,   // <iframe> oppure <div class="htm-inject">
      flowAbort: null, // AbortController dei flow embedded del documento corrente (mode:"flow")
      cmdUI,
      signal,
    };
    bodyEl[STATE_KEY] = state;

    signal?.addEventListener('abort', () => _destroyInstance(bodyEl), { once: true });

    if (!arr.length) {
      _showMessage(bodyEl, t('app.htm.no_document'));
      return;
    }

    await _loadDoc(_langIndex(arr), state);
  },

  // ── Toolbar ──────────────────────────────────────────────────────────────

  getToolbar({ bodyEl }) {
    const st = () => bodyEl?.[STATE_KEY];
    return {
      items: [
        {
          type: 'button', id: 'btnHtmReload',
          iconClass: 'bi bi-arrow-clockwise',
          className: 'icon-only',
          title: t('app.htm.toolbar.reload'),
          onClick: () => {
            const s = st();
            if (s && s.activeIndex >= 0) _loadDoc(s.activeIndex, s);
          },
        },
        {
          type: 'button', id: 'btnHtmPopout',
          iconClass: 'bi bi-box-arrow-up-right',
          className: 'icon-only',
          title: t('app.htm.toolbar.popout'),
          onClick: () => {
            const s = st();
            if (!s || s.activeIndex < 0) return;
            const url = s.frameUrl || _resolveUrl(s.models[s.activeIndex]);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          },
        },
      ],
    };
  },

  // ── Menu sinistro: lista documenti (se >1 modello) ───────────────────────

  getLeftMenu({ bodyEl, object, models }) {
    const st  = bodyEl?.[STATE_KEY];
    const arr = st?.models ?? (Array.isArray(models) ? models.filter(_hasContent) : []);

    const docItems = arr.length > 1
      ? arr.map((m, i) => ({
          id:      `htm-doc-${i}`,
          label:   _modelLabel(m, i),
          onClick: () => st && _loadDoc(i, st),
        }))
      : [];

    return {
      title: _objectName(object),
      items: docItems,
    };
  },

  getRightMenu() { return { title: '☰', items: [] }; },

  destroy() {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Caricamento documento — dispatch per modalità
// ─────────────────────────────────────────────────────────────────────────────

async function _loadDoc(index, state) {
  const { models, bodyEl, cmdUI, signal } = state;
  if (signal?.aborted) return;
  if (index < 0 || index >= models.length) return;

  const m    = models[index];
  const spec = _parseSpec(m);
  state.activeIndex = index;
  _syncMenuActive(state);

  // Rimuovi nodo precedente e svuota il body — ferma anche gli eventuali
  // flow embedded del documento precedente (mode:"flow"), altrimenti
  // resterebbero attivi (listener DOM su elementi ormai rimossi, nodi
  // App Bus Receiver ancora agganciati all'App Bus) dopo il cambio documento.
  if (state.flowAbort) {
    try { state.flowAbort.abort(); } catch {}
    state.flowAbort = null;
  }
  if (state.node) {
    try { state.node.remove(); } catch {}
    state.node = null;
  }
  state.frameUrl = null;
  state.navigate = null;
  bodyEl.innerHTML = '';

  const mode = _resolveMode(m, spec);
  state.mode = mode;

  const label = _modelLabel(m, index);
  cmdUI?.show?.({ status: te('app.htm.status.loading', { label }) });

  if (mode === 'flow') {
    // Avviso "nessun flow" solo se la modalità flow è dichiarata: un documento
    // statico (ex inject o srcdoc auto-rilevato) senza flow è normale.
    await _loadFlowDoc(m, spec, label, state, { quietIfNone: spec.mode !== 'flow' });
  } else {
    _loadIframe(m, spec, label, state);
    // flow collegati anche in modalità iframe (HTM/Frame/Navigate); nessun flow è normale
    await _startFlows(state, { quietIfNone: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pulizia dello scheletro HTML statico (niente codice eseguibile)
// ─────────────────────────────────────────────────────────────────────────────

// La pulizia (tag eseguibili, on*, javascript:) sta in HTM_sub_modules/HTM-sanitize.mjs,
// condivisa con il nodo HTM/DOM/Set HTML.
function _setSafeHTML(div, html) {
  const { fragment, removed } = sanitizeHTML(html);
  div.replaceChildren(fragment);
  if (removed) console.warn(`[model_HTM] scheletro HTML: rimossi ${removed} elementi/attributi eseguibili (script, on*, javascript:). Il codice va messo in un flow (nodo HTM/Script).`);
}

/**
 * Se l'HTML è un documento completo (<html>/<body>), estrae il contenuto
 * del <body>. Altrimenti restituisce l'HTML intatto (frammento).
 */
function _extractBody(html) {
  if (/<body[\s>]/i.test(html)) {
    const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (m) return m[1];
  }
  return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modalità flow — scheletro statico (opzionale) + logica delegata a flow
// embedded (Contesto 3, vedi HTM_sub_modules/HTM-flow-runner.mjs)
// ─────────────────────────────────────────────────────────────────────────────

async function _loadFlowDoc(m, spec, label, state, opts = {}) {
  const { bodyEl, cmdUI, signal } = state;

  const div = document.createElement('div');
  div.className = 'htm-inject';
  if (spec.title || label) div.setAttribute('aria-label', spec.title || label);

  state.node = div;
  bodyEl.appendChild(div);

  // Scheletro statico opzionale (srcdoc o URL), sempre ripulito da ogni
  // codice eseguibile: l'esecuzione passa solo dai flow embedded.
  const srcdoc = typeof spec.srcdoc === 'string' ? spec.srcdoc.trim() : '';
  if (srcdoc) {
    _setSafeHTML(div, srcdoc);
  } else {
    const url = _resolveUrl(m);
    if (url) {
      try {
        const resp = await fetch(url, { signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        if (signal?.aborted) return;
        _setSafeHTML(div, _extractBody(html));
      } catch (err) {
        if (signal?.aborted) return;
        cmdUI?.show?.({ status: te('app.htm.status.load_error', { error: err.message }) });
        return;
      }
    }
    // Né srcdoc né URL: documento vuoto, va bene — il flow costruisce
    // tutto da zero via nodi HTM/DOM/*.
  }

  cmdUI?.hide?.();
  _updatePopoutBtn(state, false); // niente URL statico apribile in questa modalità

  await _startFlows(state, opts);
}

/** Flow embedded del documento (modalità flow e iframe). */
async function _startFlows(state, opts = {}) {
  const { signal } = state;
  // AbortController per-documento, chiuso sia al cambio documento (_loadDoc
  // sopra) sia alla chiusura del pannello (signal).
  const flowAbort = new AbortController();
  state.flowAbort = flowAbort;
  signal?.addEventListener('abort', () => flowAbort.abort(), { once: true });

  try {
    const { htmLoadFlows } = await import('./HTM_sub_modules/HTM-flow-runner.mjs');
    if (signal?.aborted || flowAbort.signal.aborted) return;
    await htmLoadFlows(state, state.object, flowAbort.signal, opts);
  } catch (err) {
    console.error('[model_HTM] htmLoadFlows:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modalità iframe — documento isolato in sandbox
// ─────────────────────────────────────────────────────────────────────────────

function _loadIframe(m, spec, label, state) {
  const { bodyEl, cmdUI } = state;

  const frame = document.createElement('iframe');
  frame.className = 'htm-frame';
  frame.setAttribute('title', spec.title || label);

  state.node = frame;
  bodyEl.appendChild(frame);

  // Sorgente inline (srcdoc) in modalità iframe esplicita
  const srcdoc = typeof spec.srcdoc === 'string' ? spec.srcdoc.trim() : '';
  if (srcdoc) {
    frame.setAttribute('sandbox', _resolveSandbox(spec, null));
    frame.srcdoc = srcdoc;
    _onFrameEvents(frame, label, state, false);
    return;
  }

  // "Nessuna pagina": visibile finché il modello o il flow (HTM/Frame/Navigate) non ne carica una
  const empty = document.createElement('div');
  empty.className = 'htm-frame-empty text-muted p-3';
  empty.setAttribute('role', 'status');
  empty.textContent = t('app.htm.frame_empty');
  bodyEl.appendChild(empty);
  state.frameEmpty = empty;
  state.navigate = (url, opts) => _navigateFrame(state, spec, label, url, opts);

  const url = _resolveUrl(m);
  if (url) _navigateFrame(state, spec, label, url, { hint: false });
  else { _navigateFrame(state, spec, label, '', {}); cmdUI?.hide?.(); }
}

/**
 * Cambia la pagina dell'iframe (modello o nodo HTM/Frame/Navigate). Indirizzo vuoto = "nessuna
 * pagina". Solo http(s) o percorsi della piattaforma; sandbox ricalcolato per l'origine.
 * mobileWiki: xx.wikipedia.org → xx.m.wikipedia.org (si adatta ai pannelli stretti).
 * hint: per i siti esterni il footer ricorda che un riquadro vuoto = sito che rifiuta l'iframe.
 * @returns {{ ok: true, url: string|null } | { error: string }}
 */
function _navigateFrame(state, spec, label, raw, { mobileWiki = false, hint = true } = {}) {
  const frame = state.node;
  if (!(frame instanceof HTMLIFrameElement)) return { error: 'the document of this panel is not in iframe mode' };
  const s = String(raw ?? '').trim();
  if (!s) {
    frame.hidden = true;
    frame.removeAttribute('src');
    if (state.frameEmpty) state.frameEmpty.hidden = false;
    state.frameUrl = null;
    _updatePopoutBtn(state, false);
    return { ok: true, url: null };
  }
  let u;
  try { u = new URL(s, window.location.href); } catch { return { error: 'invalid address' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'only http(s) addresses' };
  if (mobileWiki) {
    const w = /^([a-z-]+)\.wikipedia\.org$/i.exec(u.hostname);
    if (w) u.hostname = `${w[1]}.m.wikipedia.org`;
  }
  frame.setAttribute('sandbox', _resolveSandbox(spec, u.href));   // vale dalla navigazione successiva
  frame.hidden = false;
  if (state.frameEmpty) state.frameEmpty.hidden = true;
  state.frameUrl = u.href;
  frame.src = u.href;
  _onFrameEvents(frame, label, state, true, hint && u.origin !== window.location.origin);
  return { ok: true, url: u.href };
}

function _onFrameEvents(frame, label, state, hasUrl, hint = false) {
  const { cmdUI, signal } = state;

  frame.addEventListener('load', () => {
    if (signal?.aborted) return;
    if (hint) cmdUI?.show?.({ status: t('app.htm.frame_hint') });
    else cmdUI?.hide?.();
    _updatePopoutBtn(state, hasUrl);
  }, { once: true });

  frame.addEventListener('error', () => {
    if (signal?.aborted) return;
    cmdUI?.show?.({ status: te('app.htm.status.load_failed', { label }) });
  }, { once: true });
}

/**
 * Determina il valore del sandbox per l'iframe.
 * Se mod_spec.sandbox è esplicitamente impostato lo usa (override admin).
 * Altrimenti sceglie in base all'origine: same-origin → sandbox pieno,
 * cross-origin → sandbox ristretto (no allow-same-origin).
 * srcdoc (url null) è trattato come same-origin.
 */
function _resolveSandbox(spec, url) {
  if (typeof spec.sandbox === 'string' && spec.sandbox.trim())
    return spec.sandbox.trim();

  if (!url) return SANDBOX_SAME;   // srcdoc = same-origin per definizione

  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin ? SANDBOX_SAME : SANDBOX_CROSS;
  } catch {
    return SANDBOX_SAME;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sincronizzazione UI
// ─────────────────────────────────────────────────────────────────────────────

function _syncMenuActive(state) {
  const root = state.headerEl ?? state.panel;
  if (!root) return;
  root.querySelectorAll('[data-menu="left"] .dropdown-item').forEach((el, i) => {
    el.classList.toggle('active', i === state.activeIndex);
  });
}

/**
 * Abilita/disabilita il bottone pop-out.
 * Disabilitato in modalità inject senza URL, o quando il contenuto è solo srcdoc.
 */
function _updatePopoutBtn(state, hasUrl) {
  const root = state.headerEl ?? state.panel;
  const btn  = root?.querySelector('#btnHtmPopout');
  if (!btn) return;
  btn.disabled = !hasUrl;
  btn.setAttribute('aria-disabled', String(!hasUrl));
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function _destroyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;
  try { st.flowAbort?.abort();     } catch {}
  try { st.node?.remove?.();       } catch {}
  try { st.cmdUI?.hide?.();        } catch {}
  try { delete bodyEl[STATE_KEY];  } catch {}
}

function _showMessage(bodyEl, msg) {
  const d = document.createElement('div');
  d.className    = 'text-muted p-3';
  d.style.cssText = 'font-size:0.85rem;';
  d.setAttribute('role', 'status');
  d.textContent  = msg;
  bodyEl.innerHTML = '';
  bodyEl.appendChild(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-rilevamento modalità.
 * Se mod_spec.mode è esplicitamente 'iframe', 'inject' o 'flow', lo usa
 * ('flow' non viene mai dedotto automaticamente, va sempre dichiarato).
 * Altrimenti: srcdoc → inject, URL → iframe.
 */
function _resolveMode(m, spec) {
  if (spec.mode === 'iframe' || spec.mode === 'flow') return spec.mode;
  if (spec.mode === 'inject') return 'flow';   // "inject" rimossa (2026-09-28): stesso rendering, senza script
  const srcdoc = typeof spec.srcdoc === 'string' ? spec.srcdoc.trim() : '';
  if (srcdoc) return 'flow';
  return 'iframe';
}

function _hasContent(m) {
  if (!m) return false;
  const spec = _parseSpec(m);
  // mode:"flow" è valido anche senza alcuna sorgente HTML/URL (documento
  // vuoto costruito interamente dai nodi HTM/DOM/* del flow) — va sempre
  // dichiarato esplicitamente (mai auto-rilevato, vedi _resolveMode), quindi
  // la sua sola presenza basta a considerare il modello "con contenuto".
  if (spec.mode === 'flow') return true;
  // mode:"iframe" senza indirizzo: la pagina la carica il flow (HTM/Frame/Navigate), 2026-10-21
  if (spec.mode === 'iframe') return true;
  return (typeof spec.srcdoc === 'string'   && spec.srcdoc.trim().length > 0) ||
         (typeof m.mod_abs_url === 'string' && m.mod_abs_url.trim().length > 0) ||
         (typeof spec.src === 'string'      && spec.src.trim().length > 0);
}

function _resolveUrl(m) {
  if (typeof m?.mod_abs_url === 'string' && m.mod_abs_url.trim())
    return m.mod_abs_url.trim();
  const spec = _parseSpec(m);
  if (typeof spec.src === 'string' && spec.src.trim())
    return spec.src.trim();
  return null;
}

function _parseSpec(m) {
  if (!m?.mod_spec) return {};
  try {
    return typeof m.mod_spec === 'string' ? JSON.parse(m.mod_spec) : (m.mod_spec ?? {});
  } catch { return {}; }
}

/**
 * Documento da aprire per primo quando l'oggetto ha più modelli (2026-10-17): le versioni
 * di una stessa pagina in più lingue si distinguono dal suffisso del file,
 * pagina.en.html, pagina.pt-BR.html; il file senza suffisso è la lingua base.
 * Ordine: lingua dell'interfaccia → file senza suffisso → primo modello.
 * Gli altri restano nel menu a sinistra.
 */
function _langIndex(models) {
  if (models.length < 2) return 0;
  const want = String(lang() || '').toLowerCase();
  const suffix = (m) => {
    const name = String(m?.mod_filename ?? '').split('/').pop().replace(/\.[^.]+$/, '');
    const hit  = name.match(/\.([a-z]{2}(?:-[A-Za-z]{2})?)$/);
    return hit ? hit[1].toLowerCase() : '';
  };
  const sfx = models.map(suffix);
  let i = sfx.indexOf(want);
  if (i < 0 && want.includes('-')) i = sfx.indexOf(want.split('-')[0]);
  if (i < 0) i = sfx.indexOf('');
  return i < 0 ? 0 : i;
}

function _modelLabel(m, i) {
  return m?.mod_name || m?.mod_title || m?.name || m?.title || `HTML ${i + 1}`;
}

function _objectName(object) {
  if (!object) return t('app.htm.document_fallback');
  return object.obj_name || object.obj_title || object.name || object.title
      || (object.obj_id != null ? t('app.htm.object_fallback_id.@', { id: object.obj_id }) : t('app.htm.object_fallback.@'));
}
