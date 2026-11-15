// PDF-highlight-layer.mjs
// Gestisce il layer visivo degli highlights (rects colorati + marker icona per viste)
// all'interno delle pagine PDF.
//
// Un div .pdf-hl-layer viene aggiunto a ogni .pdf-page.
// I rects e i marker usano posizionamento % → scale-independent.
//
// Quando la pagina è ruotata, i rects (salvati a una certa rotazione) vengono
// trasformati geometricamente in modo da coincidere con il contenuto visibile.
//
// API pubblica:
//   setHighlights(arr)   → aggiorna l'elenco highlight (include join con tipo)
//   setRotation(deg)     → aggiorna la rotazione corrente (per trasformazione rects)
//   showAll()            → mostra su tutte le pagine
//   showPage(n)          → mostra solo sulla pagina n
//   hideAll()            → rimuove tutti i layer
//   getMode()            → 'all' | 'page' | 'hidden'
//   flashItem(hl)        → evidenzia brevemente un singolo item (da click sul pannello)
//   refresh()            → ricostruisce i layer (dopo setDoc / setSpread / setRotation)
//   dispose()

// ─────────────────────────────────────────────────────────────────────────────

import { t } from "../shared/i18n.mjs";

export function pdfCreateHighlightLayer({ pagesEl }) {

  let highlights       = [];
  let mode             = 'hidden';   // 'all' | 'page' | 'hidden'
  let pageFilter       = null;       // page number se mode === 'page'
  let currentRotation  = 0;         // rotazione corrente del viewer (0|90|180|270)

  // ── API pubblica ──────────────────────────────────────────────────────────

  function setHighlights(arr) {
    highlights = Array.isArray(arr) ? arr : [];
    if (mode !== 'hidden') _refresh();
  }

  function setRotation(deg) {
    const norm = ((Math.round((deg ?? 0) / 90) * 90) % 360 + 360) % 360;
    if (norm === currentRotation) return;
    currentRotation = norm;
    if (mode !== 'hidden') _refresh();
  }

  function showAll() {
    mode       = 'all';
    pageFilter = null;
    _refresh();
  }

  function showPage(n) {
    mode       = 'page';
    pageFilter = n;
    _refresh();
  }

  function hideAll() {
    mode       = 'hidden';
    pageFilter = null;
    _clearAll();
  }

  function getMode() {
    return mode === 'page' ? `page:${pageFilter}` : mode;
  }

  /**
   * Evidenzia brevemente un singolo item (flash giallo 1.5s).
   * Utile quando l'utente clicca una voce nel pannello.
   */
  function flashItem(hl) {
    const pageDiv = pagesEl.querySelector(`.pdf-page[data-page="${hl.hl_page}"]`);
    if (!pageDiv) return;

    // Assicura che il layer di quella pagina sia visibile
    if (mode === 'hidden') {
      _renderPageLayer(pageDiv, highlights.filter(h => h.hl_page === hl.hl_page));
    }

    // Trova i rect/marker di questo hl e applica il flash
    const layer = pageDiv.querySelector('.pdf-hl-layer');
    if (!layer) return;
    const items = layer.querySelectorAll(`[data-hl-id="${hl.hl_id}"]`);
    items.forEach(el => {
      el.classList.add('pdf-hl-flash');
      setTimeout(() => el.classList.remove('pdf-hl-flash'), 1600);
    });
  }

  /**
   * Ricostruisce tutti i layer (chiamare dopo setDoc, setSpread, setRotation).
   */
  function refresh() {
    if (mode !== 'hidden') _refresh();
  }

  function dispose() {
    _clearAll();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  function _refresh() {
    for (const pageDiv of pagesEl.querySelectorAll('.pdf-page')) {
      const pageNum = parseInt(pageDiv.dataset.page, 10);
      if (mode === 'page' && pageNum !== pageFilter) {
        pageDiv.querySelector('.pdf-hl-layer')?.remove();
        continue;
      }
      const pageHls = highlights.filter(h => h.hl_page === pageNum);
      _renderPageLayer(pageDiv, pageHls);
    }
  }

  function _clearAll() {
    for (const el of pagesEl.querySelectorAll('.pdf-hl-layer')) el.remove();
  }

  function _renderPageLayer(pageDiv, pageHls) {
    pageDiv.querySelector('.pdf-hl-layer')?.remove();
    if (!pageHls.length) return;

    const layer = document.createElement('div');
    layer.className = 'pdf-hl-layer';

    for (const hl of pageHls) {
      if (hl.hl_rects?.length) {
        // Testo evidenziato: uno o più rettangoli (trasformati per la rotazione corrente)
        const savedRot = hl.hl_rotation ?? 0;
        const rects    = _transformRects(hl.hl_rects, savedRot, currentRotation);
        for (const r of rects) {
          const rect = document.createElement('div');
          rect.className = 'pdf-hl-rect';
          rect.dataset.hlId = String(hl.hl_id);
          rect.style.left      = (r.x * 100) + '%';
          rect.style.top       = (r.y * 100) + '%';
          rect.style.width     = (r.w * 100) + '%';
          rect.style.height    = (r.h * 100) + '%';
          rect.style.background = hl.hlt_color ?? '#ffff0066';
          rect.title = hl.hl_label || (hl.hl_text ?? '').substring(0, 80);
          layer.appendChild(rect);
        }
      } else if (hl.hl_marker_x != null && hl.hl_marker_y != null) {
        // Vista: marker icona (posizione trasformata per la rotazione corrente)
        const savedRot  = hl.hl_rotation ?? 0;
        const [mx, my]  = _transformPoint(hl.hl_marker_x, hl.hl_marker_y, savedRot, currentRotation);
        const marker = document.createElement('i');
        marker.className = 'bi bi-chat-square-text pdf-hl-marker';
        marker.dataset.hlId = String(hl.hl_id);
        marker.style.left  = (mx * 100) + '%';
        marker.style.top   = (my * 100) + '%';
        marker.style.color = hl.hlt_color ?? '#4488ff';
        marker.title = hl.hl_label || t('app.pdf.hl.view');
        layer.appendChild(marker);
      }
    }

    pageDiv.appendChild(layer);
  }

  // ── Trasformazioni coordinate ─────────────────────────────────────────────
  //
  // I rects e marker sono salvati nel sistema di coordinate CSS della pagina
  // alla rotazione hl_rotation.  Quando la vista corrente usa una rotazione
  // diversa, applichiamo la trasformazione del delta angolare.
  //
  // Formule per rect (x,y,w,h) normalizzati [0-1]:
  //   +90° CW  →  (1−y−h,  x,      h, w)
  //   180°     →  (1−x−w,  1−y−h,  w, h)
  //   +270° CW →  (y,      1−x−w,  h, w)

  function _transformRects(rects, fromRot, toRot) {
    const delta = _rotDelta(fromRot, toRot);
    if (delta === 0) return rects;
    return rects.map(r => _rotateRect(r, delta));
  }

  function _transformPoint(x, y, fromRot, toRot) {
    const delta = _rotDelta(fromRot, toRot);
    if (delta === 0) return [x, y];
    return _rotatePoint(x, y, delta);
  }

  function _rotDelta(from, to) {
    return ((((to ?? 0) - (from ?? 0)) % 360) + 360) % 360;
  }

  function _rotateRect({ x, y, w, h }, delta) {
    switch (delta) {
      case  90: return { x: 1-y-h, y: x,     w: h, h: w };
      case 180: return { x: 1-x-w, y: 1-y-h, w,    h    };
      case 270: return { x: y,     y: 1-x-w, w: h, h: w };
      default:  return { x, y, w, h };
    }
  }

  function _rotatePoint(x, y, delta) {
    switch (delta) {
      case  90: return [1-y,   x  ];
      case 180: return [1-x,   1-y];
      case 270: return [y,     1-x];
      default:  return [x,     y  ];
    }
  }

  // ── Return ────────────────────────────────────────────────────────────────

  return { setHighlights, setRotation, showAll, showPage, hideAll, getMode, flashItem, refresh, dispose };
}
