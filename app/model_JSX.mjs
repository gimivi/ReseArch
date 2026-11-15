// model_JSX.mjs
// Viewer JSXGraph per ReseArch.
//
// Carica JSXGraph dal CDN (lazy, singleton), crea il board con le opzioni del
// mod_spec del modello, poi esegue i FLOW EMBEDDED collegati all'oggetto
// (JSX_sub_modules/JSX-flow-runner.mjs): è il nodo JSX/Script a disegnare.
//
// Cambiato il 2026-09-28 (step 9 di _doc/arch-abilitazioni.md §7): prima lo
// script di disegno era un file .mjs caricato come modello (mod_abs_url) ed
// eseguito con import() per chiunque aprisse l'oggetto, senza alcun controllo.
// Ora il codice sta in un flow e passa dalla validazione dei flow. Il file del
// modello NON viene più eseguito (può restare come allegato/documentazione).
// Migrazione: copiare il corpo del vecchio `setup(board, JXG, params)` in un
// nodo JSX/Script di un flow collegato all'oggetto.
//
// ── mod_spec (solo dati) ─────────────────────────────────────────────────────
//
//   {
//     "boundingbox"    : [-6, 6, 6, -6],   // [x_min, y_max, x_max, y_min]
//     "axis"           : true,              // assi cartesiani
//     "grid"           : false,             // griglia
//     "keepaspectratio": false,             // rapporto 1:1 tra assi
//     "showNavigation" : true,              // pulsantini zoom/pan JSXGraph
//     "boardOptions"   : {},               // qualsiasi opzione JSXGraph (override)
//     "params"         : {}                // passato al codice come `params`
//   }

import { jsxLoadFlows } from './JSX_sub_modules/JSX-flow-runner.mjs';
import { t, te } from './shared/i18n.mjs';

const STATE_KEY = '__JSX_STATE__';

// CDN JSXGraph 1.9.2 — aggiornare qui in caso di upgrade
const JSX_JS_CDN  = 'https://cdn.jsdelivr.net/npm/jsxgraph@1.9.2/distrib/jsxgraphcore.min.js';
const JSX_CSS_CDN = 'https://cdn.jsdelivr.net/npm/jsxgraph@1.9.2/distrib/jsxgraph.css';

// Contatore per ID board univoci (evita collisioni se più panel sono aperti)
let _boardSerial = 0;

// Singleton: carica JSXGraph una volta sola per l'intera sessione
let _jxgPromise = null;

function _ensureJXG() {
  if (window.JXG?.JSXGraph) return Promise.resolve(window.JXG);
  if (_jxgPromise) return _jxgPromise;

  // CSS JSXGraph (navigation buttons, cursori, ecc.)
  if (!document.querySelector('[data-jsx-css]')) {
    const link = document.createElement('link');
    link.rel          = 'stylesheet';
    link.href         = JSX_CSS_CDN;
    link.dataset.jsxCss = '1';
    document.head.appendChild(link);
  }

  // Script UMD → window.JXG
  _jxgPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src     = JSX_JS_CDN;
    s.onload  = () => window.JXG?.JSXGraph
      ? resolve(window.JXG)
      : reject(new Error('[JSX] ' + t('app.jsx.err.not_available')));
    s.onerror = () => reject(new Error('[JSX] ' + t('app.jsx.err.cdn')));
    document.head.appendChild(s);
  });

  return _jxgPromise;
}

// ─────────────────────────────────────────────────────────────────────────────

export default {

  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
    _destroyInstance(bodyEl);

    // Ogni modello = un grafico (configurazione del board nel mod_spec)
    const arr = Array.isArray(models) ? models.filter(Boolean) : [];

    const state = {
      panel, headerEl, bodyEl,
      object,
      models: arr,
      params: {},
      docCtrl: null,   // AbortController dei flow del grafico attivo
      activeIndex: -1,
      board:  null,
      JXG:    null,
      resizeObserver: null,
      cmdUI,
      signal,
    };
    bodyEl[STATE_KEY] = state;

    signal?.addEventListener('abort', () => _destroyInstance(bodyEl), { once: true });

    if (!arr.length) {
      _showMessage(bodyEl, t('app.jsx.no_models.@'));
      return;
    }

    // Carica JSXGraph (lazy, singleton) — mostro stato nel footer
    cmdUI?.show?.({ status: te('app.jsx.status.loading') });
    try {
      state.JXG = await _ensureJXG();
    } catch (e) {
      if (signal?.aborted) return;
      _showMessage(bodyEl, t('app.jsx.err.load', { msg: e.message }));
      cmdUI?.hide?.();
      return;
    }

    if (signal?.aborted) return;
    await _loadDoc(0, state);
  },

  // ── Toolbar ────────────────────────────────────────────────────────────────

  getToolbar({ bodyEl }) {
    const st = () => bodyEl?.[STATE_KEY];
    return {
      items: [
        // Ripristina vista iniziale (bounding box da mod_spec)
        {
          type: 'button', id: 'btnJsxReset',
          iconClass: 'bi bi-arrow-counterclockwise',
          className: 'icon-only',
          title: t('app.jsx.tb.reset'),
          attrs: { 'aria-label': t('app.jsx.tb.reset') },
          onClick: () => {
            const s = st(); if (!s?.board) return;
            const bb = _boundingbox(_parseSpec(s.models[s.activeIndex]));
            s.board.setBoundingBox(bb, true);
          },
        },

        { type: 'divider' },

        // Toggle assi
        {
          type: 'button', id: 'btnJsxAxis',
          iconClass: 'bi bi-arrows',
          className: 'icon-only',
          title: t('app.jsx.tb.axes'),
          attrs: { 'aria-label': t('app.jsx.tb.axes') },
          onClick: () => { const s = st(); if (s) _toggleAxes(s); },
        },

        // Toggle griglia
        {
          type: 'button', id: 'btnJsxGrid',
          iconClass: 'bi bi-grid-3x3',
          className: 'icon-only',
          title: t('app.jsx.tb.grid'),
          attrs: { 'aria-label': t('app.jsx.tb.grid') },
          onClick: () => { const s = st(); if (s) _toggleGrid(s); },
        },

        { type: 'divider' },

        // Esporta SVG
        {
          type: 'button', id: 'btnJsxExport',
          iconClass: 'bi bi-download',
          className: 'icon-only',
          title: t('app.jsx.tb.export_svg'),
          attrs: { 'aria-label': t('app.jsx.tb.export_svg') },
          onClick: () => { const s = st(); if (s) _exportSVG(s); },
        },
      ],
    };
  },

  // ── Menu sinistro: lista grafici se >1 modello ────────────────────────────

  getLeftMenu({ bodyEl, object, models }) {
    const st  = bodyEl?.[STATE_KEY];
    const arr = st?.models
      ?? (Array.isArray(models) ? models.filter(Boolean) : []);

    const docItems = arr.length > 1
      ? arr.map((m, i) => ({
          id:      `jsx-doc-${i}`,
          label:   _modelLabel(m, i),
          onClick: () => st && _loadDoc(i, st),
        }))
      : [];

    return { title: _objectName(object), items: docItems };
  },

  getRightMenu() { return { title: '☰', items: [] }; },

  destroy() {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Caricamento grafico (board + script utente)
// ─────────────────────────────────────────────────────────────────────────────

async function _loadDoc(index, state) {
  const { models, bodyEl, JXG, cmdUI, signal } = state;
  if (!JXG || signal?.aborted) return;
  if (index < 0 || index >= models.length) return;

  const m     = models[index];
  const spec  = _parseSpec(m);
  const label = _modelLabel(m, index);

  // ── Pulizia istanza precedente ────────────────────────────────────────────
  _freeBoard(state);
  bodyEl.innerHTML = '';

  state.activeIndex = index;
  _syncMenuActive(state);

  // ── Costruzione DOM del contenitore ──────────────────────────────────────
  const root    = document.createElement('div');
  root.className = 'jsx-root';

  const boardEl = document.createElement('div');
  boardEl.className = 'jsx-board';
  boardEl.id        = `jsx-board-${++_boardSerial}`;

  // Imposto dimensioni esplicite prima di passare l'elemento a JSXGraph:
  // initBoard legge offsetWidth/Height per calibrare il canvas interno.
  const w = bodyEl.clientWidth  || 400;
  const h = bodyEl.clientHeight || 300;
  boardEl.style.width  = `${w}px`;
  boardEl.style.height = `${h}px`;

  root.appendChild(boardEl);
  bodyEl.appendChild(root);

  // ── Opzioni board ─────────────────────────────────────────────────────────
  const options = {
    boundingbox:     _boundingbox(spec),
    axis:            spec.axis            ?? true,
    grid:            spec.grid            ?? false,
    keepaspectratio: spec.keepaspectratio ?? false,
    showNavigation:  spec.showNavigation  ?? true,
    showCopyright:   false,
    pan:  { enabled: true,  needShift: false },
    zoom: { enabled: true,  wheel: true, needCtrl: false, min: 0.01, max: 100 },
    // Override libero da mod_spec.boardOptions
    ...(spec.boardOptions ?? {}),
  };

  // ── Creazione board ───────────────────────────────────────────────────────
  let board;
  try {
    board = JXG.JSXGraph.initBoard(boardEl.id, options);
  } catch (e) {
    if (signal?.aborted) return;
    cmdUI?.show?.({ status: te('app.jsx.err.board', { msg: e.message }) });
    console.error('[JSX] initBoard error:', e);
    return;
  }
  state.board = board;

  // ── ResizeObserver: aggiorna board al ridimensionamento del panel ─────────
  const ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width > 0 && height > 0 && state.board) {
      try {
        boardEl.style.width  = `${width}px`;
        boardEl.style.height = `${height}px`;
        state.board.resizeContainer(width, height, false, true);
      } catch {}
    }
  });
  ro.observe(bodyEl);
  state.resizeObserver = ro;
  signal?.addEventListener('abort', () => ro.disconnect(), { once: true });

  // ── Disegno: flow embedded collegati all'oggetto (JSX/Script) ────────────
  if (signal?.aborted) return;
  state.params = spec.params ?? {};
  state.docCtrl?.abort();
  const docCtrl = new AbortController();
  state.docCtrl = docCtrl;
  signal?.addEventListener('abort', () => docCtrl.abort(), { once: true });

  cmdUI?.show?.({ status: te('app.jsx.status.running', { label }) });
  const n = await jsxLoadFlows(state, state.object, docCtrl.signal);
  if (signal?.aborted || docCtrl.signal.aborted) return;
  if (!n) {
    cmdUI?.show?.({ status: te('app.jsx.status.no_flows.@') });
    _syncToolbarBtns(state);
    return;
  }

  cmdUI?.hide?.();
  _syncToolbarBtns(state);
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar actions
// ─────────────────────────────────────────────────────────────────────────────

function _toggleAxes(state) {
  const { board } = state;
  if (!board) return;

  // Preferenza: usa board.defaultAxes (creati da option axis:true)
  const axes = board.defaultAxes
    ? [board.defaultAxes.x, board.defaultAxes.y].filter(Boolean)
    : Object.values(board.objects).filter(el => el.elType === 'axis');

  if (!axes.length) return;

  const willBeVisible = !axes[0].visProp.visible;
  axes.forEach(ax => ax.setAttribute({ visible: willBeVisible }));
  board.update();
  _syncToolbarBtns(state);
}

function _toggleGrid(state) {
  const { board, JXG } = state;
  if (!board) return;

  let grids = Object.values(board.objects).filter(el => el.elType === 'grid');

  if (grids.length === 0) {
    // La griglia non esisteva: la creiamo al primo click
    board.create('grid', []);
    grids = Object.values(board.objects).filter(el => el.elType === 'grid');
  } else {
    const willBeVisible = !grids[0].visProp.visible;
    grids.forEach(g => g.setAttribute({ visible: willBeVisible }));
    board.update();
  }

  _syncToolbarBtns(state);
}

function _exportSVG(state) {
  const { board } = state;
  if (!board) return;

  try {
    // JSXGraph renderer SVG espone svgRoot
    const svgEl = board.renderer?.svgRoot;
    if (!svgEl) {
      console.warn('[JSX] SVG renderer non disponibile per l\'export');
      return;
    }

    // Clona l'SVG per non modificare il live DOM
    const clone = svgEl.cloneNode(true);
    // Aggiungi gli attributi di dimensione espliciti per la standalone view
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width',  board.canvasWidth  + 'px');
    clone.setAttribute('height', board.canvasHeight + 'px');

    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob   = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url    = URL.createObjectURL(blob);

    const a      = document.createElement('a');
    a.href       = url;
    a.download   = 'jsxgraph.svg';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

  } catch (e) {
    console.warn('[JSX] Export SVG error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sincronizzazione toolbar (stato attivo pulsanti)
// ─────────────────────────────────────────────────────────────────────────────

function _syncToolbarBtns(state) {
  const root = state.headerEl ?? state.panel;
  const { board } = state;
  if (!root || !board) return;

  // Pulsante assi
  const btnAxis = root.querySelector('#btnJsxAxis');
  if (btnAxis) {
    const axes = board.defaultAxes
      ? [board.defaultAxes.x, board.defaultAxes.y].filter(Boolean)
      : Object.values(board.objects).filter(el => el.elType === 'axis');
    const axisVisible = axes.length > 0 && axes[0].visProp.visible;
    btnAxis.classList.toggle('active', axisVisible);
    btnAxis.title = axisVisible ? t('app.jsx.hide_axes') : t('app.jsx.show_axes');
    btnAxis.setAttribute('aria-label', btnAxis.title);
  }

  // Pulsante griglia
  const btnGrid = root.querySelector('#btnJsxGrid');
  if (btnGrid) {
    const grids = Object.values(board.objects).filter(el => el.elType === 'grid');
    const gridVisible = grids.length > 0 && grids[0].visProp.visible;
    btnGrid.classList.toggle('active', gridVisible);
    btnGrid.title = gridVisible ? t('app.jsx.hide_grid') : t('app.jsx.show_grid');
    btnGrid.setAttribute('aria-label', btnGrid.title);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sincronizzazione menu sinistro
// ─────────────────────────────────────────────────────────────────────────────

function _syncMenuActive(state) {
  const root = state.headerEl ?? state.panel;
  if (!root) return;
  root.querySelectorAll('[data-menu="left"] .dropdown-item').forEach((el, i) => {
    el.classList.toggle('active', i === state.activeIndex);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function _freeBoard(state) {
  if (state.resizeObserver) {
    try { state.resizeObserver.disconnect(); } catch {}
    state.resizeObserver = null;
  }
  if (state.board && state.JXG) {
    try { state.JXG.JSXGraph.freeBoard(state.board); } catch {}
    state.board = null;
  }
}

function _destroyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;
  try { st.docCtrl?.abort(); } catch {}
  _freeBoard(st);
  try { st.cmdUI?.hide?.();       } catch {}
  try { delete bodyEl[STATE_KEY]; } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function _boundingbox(spec) {
  const bb = spec?.boundingbox;
  return (Array.isArray(bb) && bb.length === 4) ? bb : [-6, 6, 6, -6];
}

function _parseSpec(m) {
  if (!m?.mod_spec) return {};
  try {
    return typeof m.mod_spec === 'string' ? JSON.parse(m.mod_spec) : (m.mod_spec ?? {});
  } catch { return {}; }
}

function _showMessage(bodyEl, msg) {
  const d = document.createElement('div');
  d.className     = 'text-muted p-3';
  d.style.cssText = 'font-size:0.85rem;';
  d.textContent   = msg;
  bodyEl.innerHTML = '';
  bodyEl.appendChild(d);
}

function _modelLabel(m, i) {
  return m?.mod_name || m?.mod_title || m?.name || m?.title || t('app.jsx.chart_n', { n: i + 1 });
}

function _objectName(object) {
  if (!object) return t('app.jsx.chart');
  return object.obj_name || object.obj_title || object.name || object.title
      || t('app.jsx.object_n.@', { id: object.obj_id ?? '' }).trim();
}
