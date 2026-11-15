// model_PDF.mjs
// Renderer PDF per l'applicazione ReseArch.
//
// Layout integrato nel sistema del panel:
//   panel-header toolbar → zoom | fit | rotate | spread | text | annotazioni | salva-vista
//   panel-body           → viewport PDF + highlight layer + popup + pannello annotazioni
//   panel-footer pf-controls → [◀] [input] / [totale] [▶]
//   panel left-menu      → lista documenti (quando >1)

import { pdfEnsureWorker, pdfLoad, pdfGetPageDims, pdfSearchText } from "./PDF_sub_modules/PDF-core.mjs";
import { pdfCreateViewport }                           from "./PDF_sub_modules/PDF-viewport.mjs";
import { pdfCreateHighlightLayer }                     from "./PDF_sub_modules/PDF-highlight-layer.mjs";
import { pdfCreateHighlightPopup }                     from "./PDF_sub_modules/PDF-highlight-popup.mjs";
import { pdfCreateHighlightPanel }                     from "./PDF_sub_modules/PDF-highlight-panel.mjs";
import { pdfLoadFlows }                                from "./PDF_sub_modules/PDF-flow-runner.mjs";
import { t }                                           from "./shared/i18n.mjs";

// ─────────────────────────────────────────────────────────────────────────────

const STATE_KEY  = '__PDF_RENDER_STATE__';
const HL_API_URL = 'api/pdf_highlights_tool.php';

// Livelli zoom preimpostati per il dropdown
const ZOOM_PRESETS = [
  { label: '25%',   scale: 0.25 },
  { label: '33%',   scale: 0.33 },
  { label: '50%',   scale: 0.50 },
  { label: '75%',   scale: 0.75 },
  { label: '100%',  scale: 1.00 },
  { label: '150%',  scale: 1.50 },
  { label: '200%',  scale: 2.00 },
  { label: '300%',  scale: 3.00 },
  { label: '400%',  scale: 4.00 },
  { label: '500%',  scale: 5.00 },
  { label: '700%',  scale: 7.00 },
  { label: '1000%', scale: 10.0 },
];

// ─────────────────────────────────────────────────────────────────────────────

export default {

  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal, level }) {
    if (!bodyEl) throw new Error('PDF.renderBody: bodyEl mancante');

    _destroyInstance(bodyEl);

    bodyEl.style.position = bodyEl.style.position || 'relative';
    bodyEl.style.overflow = 'hidden';

    try { pdfEnsureWorker(); } catch (e) {
      bodyEl.textContent = e.message;
      return;
    }

    const arr = Array.isArray(models) ? models : [];
    if (!arr.length) {
      bodyEl.textContent = t('app.pdf.no_document');
      return;
    }

    // ── Radice ────────────────────────────────────────────────────────────────

    const root = document.createElement('div');
    root.className = 'pdf-root';
    bodyEl.appendChild(root);

    // ── Viewport ──────────────────────────────────────────────────────────────

    const viewport = pdfCreateViewport({
      containerEl:   root,
      onPageChange:  (cur, tot) => _onPageChange(cur, tot, state),
      onScaleChange: (s)        => _onScaleChange(s, state),
      signal,
    });

    // ── Highlight layer (rects + marker visivi sulle pagine) ──────────────────

    const pagesEl  = viewport.el.querySelector('.pdf-pages');
    const hlLayer  = pdfCreateHighlightLayer({ pagesEl });

    // ── Highlight popup (popover salvataggio) ─────────────────────────────────

    const hlPopup  = pdfCreateHighlightPopup({ containerEl: root, signal });

    // ── Highlight panel (sidebar annotazioni) ─────────────────────────────────

    const hlPanel  = pdfCreateHighlightPanel({ containerEl: root, signal });

    // ── Footer nav ────────────────────────────────────────────────────────────

    const { navEl, navUpdate } = _buildFooterNav();

    // ── Stato ─────────────────────────────────────────────────────────────────

    const state = {
      panel, headerEl, bodyEl, root, object,
      models: arr,
      docs:   new Array(arr.length).fill(null),
      activeIndex: -1,
      viewport, hlLayer, hlPopup, hlPanel,
      types:      [],   // pdf_highlights_type[] caricati dall'API
      highlights: [],   // pdf_highlights[] del documento corrente
      modId:      null,
      navEl, navUpdate, cmdUI, signal,
      // EventTarget locale, indipendente dall'App Bus (che questo modulo non
      // usa) — sorgente per i nodi flow PDF/Events/* (vedi PDF-flow-nodes.mjs).
      localEvents: new EventTarget(),
      // Risultati dell'ultima ricerca full-text (PDF/Search/*) — pageNum/index/snippet.
      searchResults: [],
      searchIndex:   -1,
      // Wrapper sottili su funzioni module-level già usate dalla UI — nessuna
      // logica duplicata, stesso principio di model_MPS.mjs/model_MYS.mjs.
      openDocument:    (index)        => _loadDoc(index, state),
      openUrl:         (url, opts)    => _loadUrl(url, state, opts),
      goToHighlight:   (hl_id)        => {
        const hl = state.highlights.find(h => h.hl_id === hl_id);
        if (!hl) return false;
        _goToHighlight(state, hl);
        return true;
      },
      deleteHighlight: (hl_id, mod_id) => _deleteHighlight(state, hl_id, mod_id ?? state.modId),
      searchText:      (query, opts)   => _searchText(state, query, opts),
      goToSearchMatch: (index)         => _goToSearchMatch(state, index),
      nextSearchMatch: ()              => _stepSearchMatch(state, +1),
      prevSearchMatch: ()              => _stepSearchMatch(state, -1),
    };
    bodyEl[STATE_KEY] = state;

    // Flow embedded (Contesto 3): unico canale per costruire logica reattiva
    // a pagina/zoom/selezione/annotazioni di questo pannello — stesso
    // principio di MPS/DBJ/GSH/MYS.
    await pdfLoadFlows(state, object, signal);

    signal?.addEventListener('abort', () => _destroyInstance(bodyEl), { once: true });

    // ── Wire footer nav ───────────────────────────────────────────────────────

    navEl.querySelector('.pdf-fn-prev').addEventListener('click', () =>
      viewport.goToPage(viewport.getCurrentPage() - 1));
    navEl.querySelector('.pdf-fn-next').addEventListener('click', () =>
      viewport.goToPage(viewport.getCurrentPage() + 1));

    const pageInput  = navEl.querySelector('.pdf-fn-page-input');
    const _jumpInput = () => {
      const n = parseInt(pageInput.value, 10);
      if (Number.isFinite(n) && n >= 1) viewport.goToPage(n);
    };
    pageInput.addEventListener('change',  _jumpInput);
    pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') _jumpInput(); });

    // ── Wire highlight popup ──────────────────────────────────────────────────

    // Modalità posizionamento marker: l'utente clicca sulla pagina per scegliere
    // la posizione del segnalibro vista.
    hlPopup.onRequestPlacement = (callback) => {
      const vpEl   = viewport.el;
      vpEl.style.cursor = 'crosshair';

      function cleanup() {
        vpEl.style.cursor = '';
        vpEl.removeEventListener('click',    onPlaceClick, { capture: true });
        document.removeEventListener('keydown', onEsc);
      }

      function onPlaceClick(e) {
        cleanup();
        // Hit-test geometrico: cerca la pagina le cui coordinate
        // contengono il punto del clic (più robusto di e.target.closest,
        // che può fallire su canvas, span text-layer, gap tra pagine, ecc.)
        const allPages = pagesEl.querySelectorAll('.pdf-page');
        let pageDiv = null;
        for (const pd of allPages) {
          const r = pd.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right &&
              e.clientY >= r.top  && e.clientY <= r.bottom) {
            pageDiv = pd;
            break;
          }
        }
        if (!pageDiv) { callback(0.5, 0.04); return; }
        const pb = pageDiv.getBoundingClientRect();
        const x  = Math.max(0, Math.min(1, (e.clientX - pb.left) / pb.width));
        const y  = Math.max(0, Math.min(1, (e.clientY - pb.top)  / pb.height));
        callback(x, y);
      }

      // Annulla con Escape
      function onEsc(e) {
        if (e.key !== 'Escape') return;
        cleanup();
      }

      vpEl.addEventListener('click',    onPlaceClick, { once: true, capture: true });
      document.addEventListener('keydown', onEsc);
    };

    hlPopup.onSave = async (payload) => {
      if (!state.modId) return;
      const isUpdate = payload.action === 'update';
      try {
        const body = isUpdate
          ? payload                                               // update: usa payload così com'è
          : { action: 'save', mod_id: state.modId, ...payload }; // save: aggiungi mod_id
        const resp = await fetch(HL_API_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
          signal,
        });
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error);
        if (isUpdate) {
          // Sostituisce il record aggiornato nell'array locale
          const idx = state.highlights.findIndex(h => h.hl_id === data.data.hl_id);
          if (idx >= 0) state.highlights[idx] = data.data;
        } else {
          state.highlights.push(data.data);
          hlLayer.showAll();
        }
        hlLayer.setHighlights(state.highlights);
        hlPanel.setHighlights(state.highlights, state.types);
        _updateHlPanelBtn(state);
        // Sorgente per PDF/Events/OnAnnotationSaved (flow embedded).
        state.localEvents?.dispatchEvent(new CustomEvent('annotationSaved', { detail: data.data }));
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') return;
        console.error('[PDF] save/update highlight error:', e);
      }
    };

    // ── Wire edit popup ───────────────────────────────────────────────────────

    hlPanel.onEdit = (hl) => {
      hlPopup.showForEdit(hl, state.types);
    };

    // ── Wire highlight panel ──────────────────────────────────────────────────

    // Estratte in _goToHighlight/_deleteHighlight (module-level) — riusate
    // sia da qui (click reale nel pannello) sia dai nodi flow embedded
    // PDF/Highlight/GoTo e PDF/Highlight/Delete (state.goToHighlight/
    // deleteHighlight), stesso principio di _emitMarkerSelection in
    // model_MPS.mjs: una sola definizione, il flow ottiene esattamente lo
    // stesso comportamento del click.
    hlPanel.onSelect = (hl) => _goToHighlight(state, hl);

    hlPanel.onShowAll  = () => { hlLayer.showAll();  _updateHlLayerBtns(state); };
    hlPanel.onShowPage = (n) => { hlLayer.showPage(n); _updateHlLayerBtns(state); };
    hlPanel.onHide     = () => { hlLayer.hideAll();  _updateHlLayerBtns(state); };

    hlPanel.onDelete = (hl_id, mod_id) => _deleteHighlight(state, hl_id, mod_id);

    hlPanel.onVisibilityChange = () => _updateHlPanelBtn(state);

    // ── Selezione testo → popup highlight ─────────────────────────────────────

    viewport.el.addEventListener('mouseup', () => {
      if (!viewport.isTextLayerEnabled()) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

      const range = sel.getRangeAt(0);
      const tlDiv = range.commonAncestorContainer.closest?.('.textLayer')
                 ?? range.commonAncestorContainer.parentElement?.closest('.textLayer');
      if (!tlDiv) return;

      const pageDiv = tlDiv.closest('.pdf-page');
      if (!pageDiv) return;

      const pageNum = parseInt(pageDiv.dataset.page, 10);
      const pb      = pageDiv.getBoundingClientRect();
      const vs      = viewport.getScrollState();

      const rects = Array.from(range.getClientRects())
        .filter(r => r.width > 1 && r.height > 1)
        .map(r => ({
          x: (r.left - pb.left) / pb.width,
          y: (r.top  - pb.top)  / pb.height,
          w: r.width  / pb.width,
          h: r.height / pb.height,
        }));

      if (!rects.length) return;

      // Sorgente per PDF/Events/OnTextSelected (flow embedded) — notifica
      // sempre la selezione testo, indipendentemente dai tipi highlight
      // configurati: il popup di salvataggio sotto li richiede, la notifica
      // di selezione no (stesso criterio "sempre, indipendentemente da X"
      // già usato per DBS/DBJ|GSH|MYS/Events/OnRowSelected vs busKey).
      state.localEvents?.dispatchEvent(new CustomEvent('textSelected', {
        detail: { text: sel.toString(), pageNum, rects },
      }));

      if (!state.types.length) return;
      // Livello di interazione (_doc/arch-i18n-a11y.md §5): il popup salva un'evidenziazione → serve l'autore (30)
      if ((level ?? window.RA_CTX?.level ?? 50) < 30) return;

      hlPopup.showForText({
        text:       sel.toString(),
        pageNum,
        rects,
        anchorEl:   pageDiv,
        scale:      vs.scale,
        rotation:   viewport.getRotation(),
        spread:     viewport.isSpreadEnabled(),
        scrollTop:  vs.scrollTop,
        scrollLeft: vs.scrollLeft,
      }, state.types);
    });

    // ── Footer sempre visibile ────────────────────────────────────────────────

    cmdUI.show({ controls: navEl });

    // ── Carica tipi highlight, contesto utente, poi primo documento ──────────

    await _loadTypes(state, signal);
    await _loadContext(state, signal);
    await _loadDoc(0, state);
  },

  // ── Toolbar ───────────────────────────────────────────────────────────────

  getToolbar({ panel, headerEl, bodyEl }) {
    const root = headerEl ?? panel;
    const vp   = () => bodyEl?.[STATE_KEY]?.viewport;
    const st   = () => bodyEl?.[STATE_KEY];

    return {
      items: [
        // Zoom out
        {
          type: 'button', id: 'btnPdfZoomOut', iconClass: 'bi bi-dash-lg',
          className: 'icon-only', title: t('app.pdf.zoom_out'),
          onClick: () => vp()?.zoomStep(-1),
        },

        // Zoom display + preset dropdown
        {
          type: 'dropdown', id: 'btnPdfZoom', label: '100%',
          className: 'pdf-zoom-dd', title: t('app.pdf.zoom_level'),
          items: [
            ...ZOOM_PRESETS.map(p => ({
              id: `pdfz-${p.scale}`, label: p.label,
              onClick: () => vp()?.setScale(p.scale),
            })),
            { type: 'divider' },
            { id: 'pdfz-fw', label: t('app.pdf.fit_width'), onClick: () => vp()?.fitWidth() },
            { id: 'pdfz-fp', label: t('app.pdf.fit_page'),    onClick: () => vp()?.fitPage()  },
          ],
        },

        // Zoom in
        {
          type: 'button', id: 'btnPdfZoomIn', iconClass: 'bi bi-plus-lg',
          className: 'icon-only', title: t('app.pdf.zoom_in'),
          onClick: () => vp()?.zoomStep(+1),
        },

        { type: 'divider' },

        // Adatta pagina
        {
          type: 'button', id: 'btnPdfFitPage', iconClass: 'bi bi-fullscreen',
          className: 'icon-only', title: t('app.pdf.fit_whole_page'),
          onClick: () => vp()?.fitPage(),
        },

        // Adatta larghezza
        {
          type: 'button', id: 'btnPdfFitWidth', iconClass: 'bi bi-arrow-left-right',
          className: 'icon-only', title: t('app.pdf.fit_width'),
          onClick: () => vp()?.fitWidth(),
        },

        { type: 'divider' },

        // Ruota −90°
        {
          type: 'button', id: 'btnPdfRotLeft', iconClass: 'bi bi-arrow-counterclockwise',
          className: 'icon-only', title: t('app.pdf.rotate_left'),
          onClick: () => {
            const s = st(); if (!s) return;
            s.viewport.rotateStep(-90);
            s.hlLayer.setRotation(s.viewport.getRotation());
            s.hlLayer.refresh();
            _updateRotationDisplay(s);
          },
        },

        // Ruota +90°
        {
          type: 'button', id: 'btnPdfRotRight', iconClass: 'bi bi-arrow-clockwise',
          className: 'icon-only', title: t('app.pdf.rotate_right'),
          onClick: () => {
            const s = st(); if (!s) return;
            s.viewport.rotateStep(+90);
            s.hlLayer.setRotation(s.viewport.getRotation());
            s.hlLayer.refresh();
            _updateRotationDisplay(s);
          },
        },

        { type: 'divider' },

        // Pagine affiancate
        {
          type: 'button', id: 'btnPdfSpread', iconClass: 'bi bi-layout-split',
          className: 'icon-only', title: t('app.pdf.spread'),
          onClick: () => {
            const s = st(); if (!s) return;
            s.viewport.setSpread(!s.viewport.isSpreadEnabled());
            s.hlLayer.refresh();
            _updateSpreadBtn(s);
          },
        },

        { type: 'divider' },

        // Text layer
        {
          type: 'button', id: 'btnPdfTextLayer', iconClass: 'bi bi-file-text',
          className: 'icon-only', title: t('app.pdf.text_on'),
          onClick: () => {
            const s = st(); if (!s) return;
            s.viewport.setTextLayer(!s.viewport.isTextLayerEnabled());
            _updateTextLayerBtn(s);
          },
        },

        { type: 'divider' },

        // Pannello annotazioni
        {
          type: 'button', id: 'btnPdfAnnotations', iconClass: 'bi bi-bookmarks',
          className: 'icon-only', title: t('app.pdf.annotations'),
          onClick: () => {
            const s = st(); if (!s?.hlPanel) return;
            s.hlPanel.toggle();
            _updateHlPanelBtn(s);
          },
        },

        // Salva vista corrente
        {
          type: 'button', id: 'btnPdfSaveView', iconClass: 'bi bi-bookmark-plus',
          className: 'icon-only', title: t('app.pdf.save_view'),
          minLevel: 30,
          onClick: () => {
            const s = st();
            if (!s?.viewport || !s.types?.length) return;
            const vs      = s.viewport.getScrollState();
            const vpEl    = s.viewport.el;
            const pgEl    = vpEl.querySelector('.pdf-pages');
            const curPage = s.viewport.getCurrentPage();
            const pd      = pgEl?.querySelector(`.pdf-page[data-page="${curPage}"]`);
            // Posizione default: centro dell'area visibile del documento sulla pagina corrente
            let markerX = 0.5, markerY = 0.5;
            if (pd) {
              const cx = vpEl.scrollLeft + vpEl.clientWidth  / 2;
              const cy = vpEl.scrollTop  + vpEl.clientHeight / 2;
              markerX  = Math.max(0.05, Math.min(0.95, (cx - pd.offsetLeft) / pd.offsetWidth));
              markerY  = Math.max(0.05, Math.min(0.95, (cy - pd.offsetTop)  / pd.offsetHeight));
            }
            s.hlPopup.showForView({
              page:        curPage,
              scale:       vs.scale,
              rotation:    s.viewport.getRotation(),
              spread:      s.viewport.isSpreadEnabled(),
              scrollTop:   vs.scrollTop,
              scrollLeft:  vs.scrollLeft,
              markerX,
              markerY,
            }, s.types);
          },
        },
      ],
    };
  },

  // ── Menu sinistro: lista documenti (se >1) ─────────────────────────────────

  getLeftMenu({ bodyEl, object, models }) {
    const st  = bodyEl?.[STATE_KEY];
    const arr = st?.models ?? (Array.isArray(models) ? models : []);

    const docItems = arr.length > 1
      ? arr.map((m, i) => ({
          id:      `pdf-doc-${i}`,
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
// Caricamento documento
// ─────────────────────────────────────────────────────────────────────────────

async function _loadDoc(index, state) {
  const { models, docs, viewport, hlLayer, hlPanel, cmdUI, signal } = state;
  const m = models[index];

  if (!m?.mod_abs_url) {
    cmdUI?.show?.({ status: t('app.pdf.model_no_url.@', { n: index + 1 }), controls: state.navEl });
    return;
  }

  state.activeIndex = index;
  state.modId       = m.mod_id ?? null;
  _syncDocMenuActive(state);

  cmdUI?.show?.({ status: t('app.pdf.loading_doc', { name: _modelLabel(m, index) }), controls: state.navEl });

  try {
    if (!docs[index]) {
      docs[index] = await pdfLoad(m.mod_abs_url, { signal });
    }
    const doc = docs[index];

    await viewport.setDoc(doc);
    hlLayer.refresh();   // layout aggiornato, ridisegna highlights

    // Auto-fit
    const dims = await pdfGetPageDims(doc, 1);
    if (dims.width > dims.height) await viewport.fitPage();
    else                          await viewport.fitWidth();

    // Impostazioni da mod_spec
    const spec = _parseModSpec(m);
    viewport.setSpread(!!(spec.spread));
    viewport.setRotation(spec.rotation ?? 0);
    viewport.setTextLayer(!!spec.textLayer);
    hlLayer.setRotation(spec.rotation ?? 0);
    _updateTextLayerBtn(state);
    _updateSpreadBtn(state);
    _updateRotationDisplay(state);

    // Carica highlights per questo documento
    if (state.modId) {
      _loadHighlights(state, signal).catch(() => {});
    }

    cmdUI?.show?.({ status: '', controls: state.navEl });

  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return;
    console.error('[PDF] loadDoc error:', e);
    cmdUI?.show?.({ status: t('app.pdf.error', { msg: e.message }), controls: state.navEl });
  }
}

/**
 * Apre un PDF da indirizzo (nodo PDF/Document/OpenUrl, 2026-10-21), fuori dai modelli collegati:
 * niente annotazioni (sono legate a un modello). via: auto = prima diretto, se il sito non lo
 * permette (CORS) passa dal server della piattaforma (api/remote_file.php) · direct · server.
 * @returns {Promise<{ url: string, pages: number, via: 'direct'|'server' }>}
 */
async function _loadUrl(raw, state, { via = 'auto' } = {}) {
  const { viewport, hlLayer, hlPanel, cmdUI, signal } = state;
  let u;
  try { u = new URL(String(raw ?? '').trim(), window.location.href); } catch { throw new Error('invalid address'); }
  if (!String(raw ?? '').trim() || (u.protocol !== 'http:' && u.protocol !== 'https:')) throw new Error('only http(s) addresses');
  const token = (state._urlToken = (state._urlToken ?? 0) + 1);
  let name = u.hostname;
  try { name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname); } catch { /* resta l'host */ }
  cmdUI?.show?.({ status: t('app.pdf.loading_doc', { name }), controls: state.navEl });

  const proxied = `api/remote_file.php?url=${encodeURIComponent(u.href)}`;
  const sameSite = u.origin === window.location.origin;
  let doc, used = 'direct';
  try {
    if (via === 'server' && !sameSite) { doc = await pdfLoad(proxied, { signal }); used = 'server'; }
    else {
      try { doc = await pdfLoad(u.href, { signal }); }
      catch (e) {
        if (via === 'direct' || sameSite || signal?.aborted) throw e;
        doc = await pdfLoad(proxied, { signal }); used = 'server';
      }
    }
  } catch (e) {
    if (token === state._urlToken && !signal?.aborted) cmdUI?.show?.({ status: t('app.pdf.error', { msg: e.message }), controls: state.navEl });
    throw e;
  }
  if (token !== state._urlToken || signal?.aborted) { try { doc.destroy(); } catch {} throw new Error('superseded'); }

  const prev = state.urlDoc;
  state.urlDoc = doc;
  state.activeIndex = -1;
  state.modId = null;
  _syncDocMenuActive(state);
  await viewport.setDoc(doc);
  try { prev?.destroy?.(); } catch {}
  state.highlights = [];
  hlLayer.setHighlights([]);
  hlPanel.setHighlights([], state.types);
  hlLayer.refresh();
  const dims = await pdfGetPageDims(doc, 1);
  if (dims.width > dims.height) await viewport.fitPage();
  else                          await viewport.fitWidth();
  viewport.setSpread(false);
  viewport.setRotation(0);
  hlLayer.setRotation(0);
  _updateTextLayerBtn(state);
  _updateSpreadBtn(state);
  _updateRotationDisplay(state);
  cmdUI?.show?.({ status: '', controls: state.navEl });
  return { url: u.href, pages: doc.numPages, via: used };
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────


async function _loadTypes(state, signal) {
  try {
    const resp = await fetch(`${HL_API_URL}?action=types`, { signal });
    const data = await resp.json();
    if (data.ok) state.types = data.data ?? [];
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return;
    console.warn('[PDF] _loadTypes error:', e);
  }
}

async function _loadContext(state, signal) {
  try {
    const resp = await fetch(`${HL_API_URL}?action=context`, { signal });
    const data = await resp.json();
    if (data.ok) {
      state.hlPanel.setCurrentUser(data.data.user_id, data.data.can_edit_all);
    }
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return;
    console.warn('[PDF] _loadContext error:', e);
  }
}

async function _loadHighlights(state, signal) {
  try {
    const resp = await fetch(`${HL_API_URL}?action=load&mod_id=${state.modId}`, { signal });
    const data = await resp.json();
    if (!data.ok) return;
    state.highlights = data.data ?? [];
    state.hlLayer.setHighlights(state.highlights);
    state.hlPanel.setHighlights(state.highlights, state.types);
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return;
    console.warn('[PDF] _loadHighlights error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Highlight: naviga/elimina — riusate da UI (hlPanel.onSelect/onDelete) e
// dai nodi flow embedded (state.goToHighlight/deleteHighlight), stesso
// principio di _emitMarkerSelection in model_MPS.mjs.
// ─────────────────────────────────────────────────────────────────────────────

function _goToHighlight(state, hl) {
  const { viewport, hlLayer } = state;
  if (hl.hlt_is_view) {
    viewport.setSpread(!!(hl.hl_spread));
    viewport.setRotation(hl.hl_rotation ?? 0);
    hlLayer.setRotation(hl.hl_rotation ?? 0);
    viewport.setScale(hl.hl_scale ?? 1);
    viewport.goToPage(hl.hl_page, { smooth: false });
    requestAnimationFrame(() => {
      viewport.setScrollState({
        scrollTop:  hl.hl_scroll_top  ?? 0,
        scrollLeft: hl.hl_scroll_left ?? 0,
      });
      hlLayer.refresh();
    });
    _updateSpreadBtn(state);
    _updateRotationDisplay(state);
  } else {
    // Navigazione istantanea: smooth scrollerebbe attraverso tutte le pagine
    viewport.goToPage(hl.hl_page, { smooth: false });
  }
  // Mostra layer se nascosto, poi flash
  if (hlLayer.getMode() === 'hidden') hlLayer.showAll();
  requestAnimationFrame(() => hlLayer.flashItem(hl));

  // Sorgente per PDF/Events/OnHighlightSelected (flow embedded).
  state.localEvents?.dispatchEvent(new CustomEvent('highlightSelected', { detail: hl }));
}

async function _deleteHighlight(state, hl_id, mod_id) {
  const { hlLayer, hlPanel, signal } = state;
  try {
    const resp = await fetch(HL_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'delete', hl_id, mod_id }),
      signal,
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error);
    state.highlights = state.highlights.filter(h => h.hl_id !== hl_id);
    hlLayer.setHighlights(state.highlights);
    hlPanel.setHighlights(state.highlights, state.types);
    // Sorgente per PDF/Events/OnAnnotationDeleted (flow embedded).
    state.localEvents?.dispatchEvent(new CustomEvent('annotationDeleted', { detail: { hl_id } }));
    return true;
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return false;
    console.error('[PDF] delete highlight error:', e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ricerca full-text — solo per i nodi flow embedded PDF/Search/* (nessuna UI
// nativa nel modulo oggi). Naviga alla pagina del match; non evidenzia il
// testo trovato (vedi nota in pdfSearchText, PDF-core.mjs).
// ─────────────────────────────────────────────────────────────────────────────

async function _searchText(state, query, opts) {
  const doc = state.viewport?.getDoc?.();
  if (!doc || !query) {
    state.searchResults = [];
    state.searchIndex   = -1;
    return [];
  }
  const results = await pdfSearchText(doc, query, opts);
  state.searchResults = results;
  state.searchIndex   = results.length ? 0 : -1;
  if (results.length) state.viewport.goToPage(results[0].page, { smooth: false });
  return results;
}

function _goToSearchMatch(state, index) {
  const results = state.searchResults ?? [];
  if (index < 0 || index >= results.length) return false;
  state.searchIndex = index;
  state.viewport.goToPage(results[index].page, { smooth: false });
  return true;
}

function _stepSearchMatch(state, delta) {
  const results = state.searchResults ?? [];
  if (!results.length) return false;
  const next = ((state.searchIndex ?? 0) + delta + results.length) % results.length;
  return _goToSearchMatch(state, next);
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback viewport
// ─────────────────────────────────────────────────────────────────────────────

function _onPageChange(cur, tot, state) {
  state.navUpdate(cur, tot);
  state.hlPanel?.setCurrentPage(cur);
  // Sorgente per PDF/Events/OnPageChange (flow embedded).
  state.localEvents?.dispatchEvent(new CustomEvent('pageChange', { detail: { page: cur, total: tot } }));
}

function _onScaleChange(s, state) {
  // Sorgente per PDF/Events/OnScaleChange (flow embedded) — dispatchato
  // sempre, indipendentemente dal DOM del toolbar (che sotto è opzionale).
  state.localEvents?.dispatchEvent(new CustomEvent('scaleChange', { detail: { scale: s } }));

  const root = state.headerEl ?? state.panel;
  if (!root) return;
  const ddBtn = root.querySelector('#btnPdfZoom');
  if (!ddBtn) return;
  const labelSpan = ddBtn.querySelector('.dropdown-toggle .d-inline-flex > span');
  if (labelSpan) labelSpan.textContent = Math.round(s * 100) + '%';
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer nav
// ─────────────────────────────────────────────────────────────────────────────

function _buildFooterNav() {
  const navEl   = document.createElement('div');
  navEl.className = 'pdf-fn-wrap';

  const btnPrev   = _mkIconBtn('bi bi-chevron-left',  t('app.pdf.prev_page'), 'pdf-fn-btn pdf-fn-prev');
  const btnNext   = _mkIconBtn('bi bi-chevron-right', t('app.pdf.next_page'), 'pdf-fn-btn pdf-fn-next');
  const pageInput = document.createElement('input');
  pageInput.type      = 'number';
  pageInput.className = 'pdf-fn-page-input';
  pageInput.value     = '1';
  pageInput.min       = '1';
  pageInput.max       = '1';
  pageInput.title     = t('app.pdf.current_page');
  pageInput.setAttribute('aria-label', t('app.pdf.current_page'));

  const sep     = _el('span', { class: 'pdf-fn-sep' }, '/');
  const totalEl = _el('span', { class: 'pdf-fn-total' }, '1');
  navEl.append(btnPrev, pageInput, sep, totalEl, btnNext);

  function navUpdate(current, total) {
    pageInput.value     = String(current);
    pageInput.max       = String(total);
    totalEl.textContent = String(total);
    btnPrev.disabled    = current <= 1;
    btnNext.disabled    = current >= total;
  }
  navUpdate(1, 1);
  return { navEl, navUpdate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync menu sinistro
// ─────────────────────────────────────────────────────────────────────────────

function _syncDocMenuActive(state) {
  const root = state.headerEl ?? state.panel;
  if (!root) return;
  const leftDropEl = root.querySelector('[data-menu="left"]');
  if (!leftDropEl) return;
  leftDropEl.querySelectorAll('.dropdown-item').forEach((el, i) => {
    el.classList.toggle('active', i === state.activeIndex);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar button sync
// ─────────────────────────────────────────────────────────────────────────────

function _updateSpreadBtn(state) {
  if (!state) return;
  const root = state.headerEl ?? state.panel;
  const btn  = root?.querySelector('#btnPdfSpread');
  if (!btn) return;
  const enabled = state.viewport?.isSpreadEnabled?.() ?? false;
  btn.classList.toggle('active', enabled);
  btn.title = enabled ? t('app.pdf.single_page') : t('app.pdf.spread');
  btn.setAttribute('aria-label', btn.title);
}

function _updateRotationDisplay(state) {
  if (!state) return;
  const root = state.headerEl ?? state.panel;
  const rot  = state.viewport?.getRotation?.() ?? 0;
  const btnL = root?.querySelector('#btnPdfRotLeft');
  const btnR = root?.querySelector('#btnPdfRotRight');
  if (btnL) { btnL.title = t('app.pdf.rotate_left_cur', { rot }); btnL.setAttribute('aria-label', btnL.title); }
  if (btnR) { btnR.title = t('app.pdf.rotate_right_cur', { rot }); btnR.setAttribute('aria-label', btnR.title); }
}

function _updateTextLayerBtn(state) {
  const root = state.headerEl ?? state.panel;
  const btn  = root?.querySelector('#btnPdfTextLayer');
  if (!btn) return;
  const enabled = state.viewport?.isTextLayerEnabled?.() ?? false;
  const ico = btn.querySelector('i');
  if (ico) ico.className = enabled ? 'bi bi-file-text-fill' : 'bi bi-file-text';
  btn.classList.toggle('active', enabled);
  btn.title = enabled ? t('app.pdf.text_off') : t('app.pdf.text_on');
  btn.setAttribute('aria-label', btn.title);
}

function _updateHlPanelBtn(state) {
  if (!state) return;
  const root = state.headerEl ?? state.panel;
  const btn  = root?.querySelector('#btnPdfAnnotations');
  if (!btn) return;
  const active = state.hlPanel?.isVisible() ?? false;
  const ico = btn.querySelector('i');
  if (ico) ico.className = active ? 'bi bi-bookmarks-fill' : 'bi bi-bookmarks';
  btn.classList.toggle('active', active);
  btn.title = active ? t('app.pdf.annotations_close') : t('app.pdf.annotations');
  btn.setAttribute('aria-label', btn.title);
}

function _updateHlLayerBtns(state) {
  // Futura estensione: sincronizzare stato visivo dei btn del pannello
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function _destroyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;

  try { st.viewport?.dispose?.(); } catch {}
  try { st.hlLayer?.dispose?.();  } catch {}
  try { st.hlPopup?.dispose?.();  } catch {}
  try { st.hlPanel?.dispose?.();  } catch {}
  try { st.root?.remove?.();      } catch {}
  try { st.cmdUI?.hide?.();       } catch {}

  for (const doc of st.docs ?? []) { try { doc?.destroy?.(); } catch {} }
  try { st.urlDoc?.destroy?.(); } catch {}
  try { delete bodyEl[STATE_KEY]; } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities DOM
// ─────────────────────────────────────────────────────────────────────────────

function _parseModSpec(m) {
  if (!m?.mod_spec) return {};
  try {
    return typeof m.mod_spec === 'string' ? JSON.parse(m.mod_spec) : m.mod_spec;
  } catch { return {}; }
}

function _el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function _mkIconBtn(iconClass, title, className) {
  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = className;
  btn.title     = title;
  btn.setAttribute('aria-label', title);
  const ico = document.createElement('i');
  ico.className = iconClass;
  btn.appendChild(ico);
  return btn;
}

function _modelLabel(m, i) {
  return m?.mod_name || m?.mod_title || m?.name || m?.title || `PDF ${i + 1}`;
}

function _objectName(object) {
  if (!object) return t('app.pdf.document');
  return object.obj_name || object.obj_title || object.name || object.title
    || t('app.osd.object_n.@', { id: object.obj_id ?? '' }).trim();
}
