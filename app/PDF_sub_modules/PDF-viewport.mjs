// PDF-viewport.mjs
// Area di visualizzazione PDF: canvas scrollabile, lazy rendering per pagina,
// zoom (scala), pan con drag del mouse, Ctrl+scroll per zoom rapido.
//
// API pubblica (ritornata da pdfCreateViewport):
//   setDoc(doc)              → carica un PDFDocumentProxy, crea i placeholder delle pagine
//   getDoc()                 → PDFDocumentProxy corrente
//   setScale(s)              → imposta scala assoluta e ri-renderizza le pagine visibili
//   getScale()               → scala corrente (number)
//   fitWidth()               → scala per riempire la larghezza del contenitore
//   fitPage()                → scala per mostrare la pagina intera nel contenitore
//   goToPage(n)              → scrolla alla pagina n (1-based)
//   getCurrentPage()         → numero pagina più visibile (1-based)
//   getScrollState()         → { scrollTop, scrollLeft, scale }
//   setScrollState(s)        → ripristina { scrollTop, scrollLeft }
//   setTextLayer(enabled)    → abilita/disabilita il text layer (selezione testo)
//   setRotation(deg)         → imposta rotazione: 0, 90, 180, 270
//   getRotation()            → rotazione corrente (number)
//   rotateStep(delta)        → ruota di ±90° rispetto alla rotazione corrente
//   setSpread(enabled)       → abilita/disabilita vista due pagine affiancate
//   isSpreadEnabled()        → boolean
//   dispose()                → rimuove observer, event listener, DOM

import { pdfGetPageDims, pdfRenderPage, pdfRenderTextLayer, pdfCancelTask } from './PDF-core.mjs';

// Livelli di zoom disponibili (scala CSS)
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0];

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   containerEl: HTMLElement,
 *   onPageChange?:  (current: number, total: number) => void,
 *   onScaleChange?: (scale: number) => void,
 *   textLayer?:     boolean,
 *   signal?:        AbortSignal
 * }} opts
 */
export function pdfCreateViewport({ containerEl, onPageChange, onScaleChange, textLayer = false, signal } = {}) {

  // ── DOM ────────────────────────────────────────────────────────────────────

  const viewportEl = document.createElement('div');
  viewportEl.className = 'pdf-viewport';
  containerEl.appendChild(viewportEl);

  const pagesEl = document.createElement('div');
  pagesEl.className = 'pdf-pages';
  viewportEl.appendChild(pagesEl);

  // ── Stato interno ──────────────────────────────────────────────────────────

  let doc          = null;
  let numPages     = 0;
  let scale        = 1.0;
  let rotation     = 0;        // 0 | 90 | 180 | 270
  let spreadEnabled = false;   // due pagine affiancate
  let baseDims     = { width: 595, height: 842 };  // A4 di default (rotation=0), aggiornato al caricamento
  let currentPage  = 1;

  // Map<pageNum, RenderTask>  — task canvas attivi in corso
  const activeTasks     = new Map();
  // Map<pageNum, task>       — task text layer attivi in corso
  const activeTextTasks = new Map();
  // Set<pageNum>             — pagine attualmente visibili nella viewport
  const visiblePages    = new Set();

  // Text layer: abilitato/disabilitato
  let textLayerEnabled = textLayer;

  // ── IntersectionObserver ──────────────────────────────────────────────────

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        if (entry.isIntersecting) {
          visiblePages.add(pageNum);
          _maybeRender(entry.target, pageNum);
          // Aggiorna pagina corrente
          _updateCurrentPage();
        } else {
          visiblePages.delete(pageNum);
        }
      }
    },
    { root: viewportEl, rootMargin: '200px 0px' }
  );

  // ── Scroll → pagina corrente ───────────────────────────────────────────────

  let scrollRAF = 0;
  viewportEl.addEventListener('scroll', () => {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      scrollRAF = 0;
      _updateCurrentPage();
    });
  }, { passive: true });

  // ── Drag-to-pan ───────────────────────────────────────────────────────────

  let drag = null;

  viewportEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Non intercettare click su bottoni, input o link annidati (es. text layer futuro)
    if (e.target.closest('button, input, a, select, textarea')) return;
    if (textLayerEnabled && e.target.closest('.textLayer')) return;
    drag = {
      startX:      e.clientX,
      startY:      e.clientY,
      scrollLeft:  viewportEl.scrollLeft,
      scrollTop:   viewportEl.scrollTop,
    };
    viewportEl.classList.add('is-dragging');
    e.preventDefault();
  });

  const onMouseMove = (e) => {
    if (!drag) return;
    viewportEl.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
    viewportEl.scrollTop  = drag.scrollTop  - (e.clientY - drag.startY);
  };

  const onMouseUp = () => {
    if (!drag) return;
    drag = null;
    viewportEl.classList.remove('is-dragging');
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // ── Ctrl+Scroll per zoom ──────────────────────────────────────────────────

  viewportEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    _zoomStep(e.deltaY < 0 ? 1 : -1, e);
  }, { passive: false });

  // ── Abort cleanup ─────────────────────────────────────────────────────────

  if (signal) {
    signal.addEventListener('abort', dispose, { once: true });
  }

  // ── API pubblica ──────────────────────────────────────────────────────────

  async function setDoc(newDoc) {
    // Annulla tutti i render in corso
    for (const [, task] of activeTasks) pdfCancelTask(task);
    activeTasks.clear();
    for (const [, task] of activeTextTasks) task.cancel();
    activeTextTasks.clear();
    visiblePages.clear();

    // Sgancia l'observer dalle vecchie pagine
    for (const el of pagesEl.querySelectorAll('.pdf-page')) {
      observer.unobserve(el);
    }
    pagesEl.innerHTML = '';

    doc      = newDoc;
    numPages = doc.numPages;

    // Legge dims della prima pagina (rotation=0, base non ruotata)
    baseDims = await pdfGetPageDims(doc, 1);

    _buildPages();

    currentPage = 1;
    onPageChange?.(currentPage, numPages);
  }

  function getDoc() { return doc; }

  function setScale(newScale, opts = {}) {
    const clamped = Math.max(0.1, Math.min(10, newScale));
    if (Math.abs(clamped - scale) < 0.001 && !opts.force) return;

    // Centro visivo prima del cambio scala (per mantenere il punto di riferimento)
    const centerX = viewportEl.scrollLeft + viewportEl.clientWidth  / 2;
    const centerY = viewportEl.scrollTop  + viewportEl.clientHeight / 2;

    const oldScale = scale;
    scale = clamped;

    // Cancella task text layer pendenti (scala cambiata, da rifare)
    for (const [, task] of activeTextTasks) task.cancel();
    activeTextTasks.clear();

    // Ridimensiona tutti i placeholder
    for (const pageDiv of pagesEl.querySelectorAll('.pdf-page')) {
      _applyPlaceholderSize(pageDiv);
      // Marca come da ri-renderizzare
      delete pageDiv.dataset.renderedScale;
    }

    // Ricalcola scroll per mantenere il punto visivo
    viewportEl.scrollLeft = (centerX / oldScale) * scale - viewportEl.clientWidth  / 2;
    viewportEl.scrollTop  = (centerY / oldScale) * scale - viewportEl.clientHeight / 2;

    // Ri-renderizza le pagine visibili
    for (const pageNum of visiblePages) {
      const pageDiv = pagesEl.querySelector(`.pdf-page[data-page="${pageNum}"]`);
      if (pageDiv) _maybeRender(pageDiv, pageNum);
    }

    onScaleChange?.(scale);
  }

  function getScale() { return scale; }

  async function fitWidth() {
    if (!doc) return;
    await _ensureBaseDims();
    // Aspetta il layout se necessario (prima paint può avere clientWidth=0)
    let containerW = viewportEl.clientWidth - 32;
    if (containerW <= 0) {
      await new Promise(r => requestAnimationFrame(r));
      containerW = viewportEl.clientWidth - 32;
    }
    if (containerW <= 0) return;
    setScale(containerW / _rotatedDims().width);
  }

  async function fitPage() {
    if (!doc) return;
    await _ensureBaseDims();
    let containerW = viewportEl.clientWidth  - 32;
    let containerH = viewportEl.clientHeight - 32;
    if (containerW <= 0 || containerH <= 0) {
      await new Promise(r => requestAnimationFrame(r));
      containerW = viewportEl.clientWidth  - 32;
      containerH = viewportEl.clientHeight - 32;
    }
    if (containerW <= 0 || containerH <= 0) return;
    const rd = _rotatedDims();
    setScale(Math.min(containerW / rd.width, containerH / rd.height));
  }

  function goToPage(n, { smooth = true } = {}) {
    const target = Math.max(1, Math.min(numPages, n));
    const pageDiv = pagesEl.querySelector(`.pdf-page[data-page="${target}"]`);
    if (!pageDiv) return;
    if (smooth) {
      pageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      viewportEl.scrollTop  = pageDiv.offsetTop;
      viewportEl.scrollLeft = 0;
    }
  }

  function getCurrentPage() { return currentPage; }

  function getScrollState() {
    return {
      scrollTop:  viewportEl.scrollTop,
      scrollLeft: viewportEl.scrollLeft,
      scale,
    };
  }

  function setScrollState({ scrollTop = 0, scrollLeft = 0 } = {}) {
    viewportEl.scrollTop  = scrollTop;
    viewportEl.scrollLeft = scrollLeft;
  }

  function zoomStep(direction) {
    _zoomStep(direction);
  }

  function setTextLayer(enabled) {
    textLayerEnabled = !!enabled;
    if (!textLayerEnabled) {
      // Rimuovi text layer e cancella task pendenti
      for (const [, task] of activeTextTasks) task.cancel();
      activeTextTasks.clear();
      for (const pageDiv of pagesEl.querySelectorAll('.pdf-page')) {
        pageDiv.querySelector('.textLayer')?.remove();
      }
    } else {
      // Renderizza text layer per le pagine già renderizzate e visibili
      for (const pageNum of visiblePages) {
        const pageDiv = pagesEl.querySelector(`.pdf-page[data-page="${pageNum}"]`);
        if (pageDiv && pageDiv.dataset.renderedRotation && !pageDiv.querySelector('.textLayer')) {
          _renderTextLayer(pageDiv, pageNum);
        }
      }
    }
  }

  function isTextLayerEnabled() { return textLayerEnabled; }

  // ── Rotazione ─────────────────────────────────────────────────────────────

  function setRotation(deg) {
    const norm = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
    if (norm === rotation) return;

    const prevPage = currentPage;
    rotation = norm;

    // Cancella tutti i task in corso
    for (const [, t] of activeTasks)     pdfCancelTask(t);
    activeTasks.clear();
    for (const [, t] of activeTextTasks) t.cancel();
    activeTextTasks.clear();

    // Ridimensiona i placeholder con le nuove dims ruotate.
    // NON cancelliamo renderedScale/renderedRotation su tutte le pagine:
    // _maybeRender le ri-renderizza pigramente quando tornano visibili
    // (il check renderedRot !== rotation rileva il mismatch).
    for (const pageDiv of pagesEl.querySelectorAll('.pdf-page')) {
      _applyPlaceholderSize(pageDiv);
      pageDiv.querySelector('.textLayer')?.remove();
    }

    // Torna alla pagina corrente con scroll istantaneo
    // (smooth causerebbe animazione attraverso tutte le pagine ridimensionate)
    requestAnimationFrame(() => {
      const pageDiv = pagesEl.querySelector(`.pdf-page[data-page="${prevPage}"]`);
      if (pageDiv) {
        viewportEl.scrollTop  = pageDiv.offsetTop;
        viewportEl.scrollLeft = 0;
      }
    });

    // Ri-renderizza le pagine visibili
    for (const pageNum of visiblePages) {
      const pageDiv = pagesEl.querySelector(`.pdf-page[data-page="${pageNum}"]`);
      if (pageDiv) _maybeRender(pageDiv, pageNum);
    }
  }

  function getRotation() { return rotation; }

  function rotateStep(delta) {
    setRotation(rotation + delta);
  }

  // ── Spread (due pagine affiancate) ────────────────────────────────────────

  function setSpread(enabled) {
    if (!!enabled === spreadEnabled) return;
    const prevPage = currentPage;
    spreadEnabled  = !!enabled;
    _buildPages();
    // Scroll istantaneo (rebuild layout → dimensioni cambiate, smooth farebbe scrollare tutto)
    requestAnimationFrame(() => {
      const pageDiv = pagesEl.querySelector(`.pdf-page[data-page="${prevPage}"]`);
      if (pageDiv) {
        viewportEl.scrollTop  = pageDiv.offsetTop;
        viewportEl.scrollLeft = 0;
      }
    });
  }

  function isSpreadEnabled() { return spreadEnabled; }

  function dispose() {
    observer.disconnect();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    for (const [, task] of activeTasks) pdfCancelTask(task);
    activeTasks.clear();
    for (const [, task] of activeTextTasks) task.cancel();
    activeTextTasks.clear();
    viewportEl.remove();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Restituisce baseDims tenendo conto della rotazione corrente (90°/270° → swap w/h). */
  function _rotatedDims() {
    return (rotation % 180 === 0)
      ? baseDims
      : { width: baseDims.height, height: baseDims.width };
  }

  /**
   * (Re)costruisce i div pagina dentro pagesEl.
   * In modalità spread: wrapper .pdf-spread con 2 pagine per riga.
   * Chiamata da setDoc, setSpread.
   */
  function _buildPages() {
    for (const el of pagesEl.querySelectorAll('.pdf-page')) observer.unobserve(el);
    pagesEl.innerHTML = '';
    if (!numPages) return;

    if (!spreadEnabled) {
      for (let i = 1; i <= numPages; i++) {
        const pd = _makePageDiv(i);
        pagesEl.appendChild(pd);
        observer.observe(pd);
      }
    } else {
      // Coppie: (1,2), (3,4), …  — prima pagina eventualmente sola se count dispari
      for (let i = 1; i <= numPages; i += 2) {
        const spreadDiv = document.createElement('div');
        spreadDiv.className = 'pdf-spread';
        const pd1 = _makePageDiv(i);
        spreadDiv.appendChild(pd1);
        observer.observe(pd1);
        if (i + 1 <= numPages) {
          const pd2 = _makePageDiv(i + 1);
          spreadDiv.appendChild(pd2);
          observer.observe(pd2);
        }
        pagesEl.appendChild(spreadDiv);
      }
    }
  }

  function _makePageDiv(pageNum) {
    const div = document.createElement('div');
    div.className   = 'pdf-page pdf-page--loading';
    div.dataset.page = String(pageNum);
    _applyPlaceholderSize(div);
    return div;
  }

  function _applyPlaceholderSize(div) {
    const rd = _rotatedDims();
    div.style.width  = Math.round(rd.width  * scale) + 'px';
    div.style.height = Math.round(rd.height * scale) + 'px';
  }

  async function _maybeRender(pageDiv, pageNum) {
    const renderedAt  = parseFloat(pageDiv.dataset.renderedScale || '0');
    const renderedRot = parseInt(pageDiv.dataset.renderedRotation ?? '-1', 10);
    if (Math.abs(renderedAt - scale) < 0.001 && renderedRot === rotation) return;

    // Annulla eventuale render in corso per questa pagina
    const old = activeTasks.get(pageNum);
    if (old) { pdfCancelTask(old); activeTasks.delete(pageNum); }

    // Annulla eventuale text task in corso per questa pagina
    const oldTl = activeTextTasks.get(pageNum);
    if (oldTl) { oldTl.cancel(); activeTextTasks.delete(pageNum); }

    if (!doc) return;

    let canvas = pageDiv.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      pageDiv.innerHTML = '';
      pageDiv.appendChild(canvas);
    }
    // Rimuove il text layer precedente (scala cambiata o primo render)
    pageDiv.querySelector('.textLayer')?.remove();

    const task = pdfRenderPage(doc, pageNum, canvas, scale, rotation);
    activeTasks.set(pageNum, task);

    try {
      await task.promise;
      pageDiv.dataset.renderedScale    = String(scale);
      pageDiv.dataset.renderedRotation = String(rotation);
      pageDiv.classList.remove('pdf-page--loading');
      activeTasks.delete(pageNum);
      // Renderizza il text layer se abilitato
      if (textLayerEnabled) _renderTextLayer(pageDiv, pageNum);
    } catch (e) {
      activeTasks.delete(pageNum);
      if (e?.name === 'RenderingCancelledException') return;
      console.warn('[PDF-viewport] renderPage error:', e);
    }
  }

  function _renderTextLayer(pageDiv, pageNum) {
    const old = activeTextTasks.get(pageNum);
    if (old) { old.cancel(); activeTextTasks.delete(pageNum); }

    let tlDiv = pageDiv.querySelector('.textLayer');
    if (!tlDiv) {
      tlDiv = document.createElement('div');
      tlDiv.className = 'textLayer';
      pageDiv.appendChild(tlDiv);
    }

    const task = pdfRenderTextLayer(doc, pageNum, tlDiv, scale, rotation);
    activeTextTasks.set(pageNum, task);

    task.promise
      .then(() => { activeTextTasks.delete(pageNum); })
      .catch((e) => {
        activeTextTasks.delete(pageNum);
        if (e?.name === 'RenderingCancelledException') return;
        // Text layer non critico: errore silenzioso
      });
  }

  function _updateCurrentPage() {
    if (!numPages) return;
    const vpTop    = viewportEl.scrollTop;
    const vpBottom = vpTop + viewportEl.clientHeight;
    let best = currentPage;
    let bestOverlap = -1;

    for (const pageDiv of pagesEl.querySelectorAll('.pdf-page')) {
      const top    = pageDiv.offsetTop;
      const bottom = top + pageDiv.offsetHeight;
      const overlap = Math.min(vpBottom, bottom) - Math.max(vpTop, top);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = parseInt(pageDiv.dataset.page, 10);
      }
    }

    if (best !== currentPage) {
      currentPage = best;
      onPageChange?.(currentPage, numPages);
    }
  }

  function _zoomStep(direction, wheelEvent) {
    const currentIdx = _closestZoomIdx(scale);
    const nextIdx    = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, currentIdx + direction));
    setScale(ZOOM_LEVELS[nextIdx]);
  }

  function _closestZoomIdx(s) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < ZOOM_LEVELS.length; i++) {
      const d = Math.abs(ZOOM_LEVELS[i] - s);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  async function _ensureBaseDims() {
    if (!doc) return;
    // baseDims viene già impostato in setDoc — qui solo safety
    if (baseDims.width > 0) return;
    baseDims = await pdfGetPageDims(doc, 1);
  }

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    el: viewportEl,
    setDoc,
    getDoc,
    setScale,
    getScale,
    fitWidth,
    fitPage,
    goToPage,
    getCurrentPage,
    getScrollState,
    setScrollState,
    zoomStep,
    setTextLayer,
    isTextLayerEnabled,
    setRotation,
    getRotation,
    rotateStep,
    setSpread,
    isSpreadEnabled,
    dispose,
    get numPages() { return numPages; },
  };
}
