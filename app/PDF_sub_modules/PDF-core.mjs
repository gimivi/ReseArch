// PDF-core.mjs
// Wrapper minimale attorno a window.pdfjsLib (caricato come script globale in dashboard.php).
//
// Funzioni esportate:
//   pdfEnsureWorker()                          → imposta workerSrc se non già fatto
//   pdfLoad(url, { signal })                   → Promise<PDFDocumentProxy>
//   pdfGetPageDims(doc, pageNum)               → Promise<{width, height}> in CSS pt (scale=1)
//   pdfRenderPage(doc, pageNum, canvas, scale) → Promise<void> — renderizza sul canvas
//   pdfCancelTask(task)                        → annulla un RenderTask in sicurezza
//   pdfSearchText(doc, query, opts)            → Promise<{page,index,snippet}[]> — ricerca full-text

// Versione del worker allineata alla lib caricata in dashboard.php
const WORKER_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assicura che il workerSrc sia impostato prima di qualsiasi caricamento.
 * Chiamare una sola volta, prima di pdfLoad.
 */
export function pdfEnsureWorker() {
  const lib = _lib();
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  }
}

/**
 * Carica un documento PDF dall'URL.
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<PDFDocumentProxy>}
 */
export async function pdfLoad(url, { signal } = {}) {
  pdfEnsureWorker();
  const lib = _lib();
  const task = lib.getDocument({ url, withCredentials: false });
  if (signal) {
    signal.addEventListener('abort', () => { try { task.destroy(); } catch {} }, { once: true });
  }
  return task.promise;
}

/**
 * Restituisce le dimensioni in CSS-point (scale=1, 72 dpi) della pagina indicata.
 * @param {PDFDocumentProxy} doc
 * @param {number} pageNum 1-based
 * @returns {Promise<{width: number, height: number}>}
 */
export async function pdfGetPageDims(doc, pageNum) {
  const page = await doc.getPage(pageNum);
  const vp   = page.getViewport({ scale: 1 });
  page.cleanup();
  return { width: vp.width, height: vp.height };
}

/**
 * Renderizza la pagina indicata sul canvas fornito alla scala CSS data.
 * Gestisce HiDPI: il canvas fisico è scale * dpr, il CSS width/height è scale.
 * @param {PDFDocumentProxy} doc
 * @param {number}           pageNum 1-based
 * @param {HTMLCanvasElement} canvas
 * @param {number}           scale CSS-pixel scale (es: 1.5 = 150%)
 * @returns {RenderTask} — task.promise è una Promise; task.cancel() per annullare
 */
export function pdfRenderPage(doc, pageNum, canvas, scale, rotation = 0) {
  // Restituisce la RenderTask immediatamente (non la promise),
  // così il chiamante può annullarla se cambia scala prima che finisca.
  let task = null;

  const run = async () => {
    const page  = await doc.getPage(pageNum);
    const vp    = page.getViewport({ scale, rotation });
    const dpr   = Math.min(window.devicePixelRatio || 1, 2);

    // Canvas fisico in pixel reali (HiDPI)
    canvas.width  = Math.round(vp.width  * dpr);
    canvas.height = Math.round(vp.height * dpr);
    // Canvas CSS in pixel logici
    canvas.style.width  = Math.round(vp.width)  + 'px';
    canvas.style.height = Math.round(vp.height) + 'px';

    const ctx      = canvas.getContext('2d');
    const renderVp = page.getViewport({ scale: scale * dpr, rotation });

    task = page.render({ canvasContext: ctx, viewport: renderVp });
    await task.promise;
    page.cleanup();
  };

  // Wrapper con .cancel() verso il RenderTask interno
  const wrapper = {
    promise: run(),
    cancel() { try { task?.cancel(); } catch {} },
  };
  return wrapper;
}

/**
 * Annulla un task (da pdfRenderPage) ignorando l'eccezione RenderingCancelledException.
 */
export function pdfCancelTask(task) {
  try { task?.cancel(); } catch {}
}

/**
 * Renderizza il text layer trasparente sopra il canvas di una pagina.
 * Richiede che pdfjsLib.renderTextLayer sia disponibile (PDF.js 3.x+).
 *
 * @param {PDFDocumentProxy} doc
 * @param {number}           pageNum 1-based
 * @param {HTMLElement}      tlDiv   div contenitore (class="textLayer")
 * @param {number}           scale   stessa scala CSS usata per il canvas
 * @returns {{ promise: Promise, cancel: () => void }}
 */
export function pdfRenderTextLayer(doc, pageNum, tlDiv, scale, rotation = 0) {
  const lib = _lib();

  if (typeof lib.renderTextLayer !== 'function') {
    console.warn('[PDF-core] renderTextLayer non disponibile in questa versione di PDF.js');
    return { promise: Promise.resolve(), cancel() {} };
  }

  let task = null;

  const run = async () => {
    const page = await doc.getPage(pageNum);
    // Il viewport per il text layer usa la scala CSS (NON moltiplicata per DPR):
    // le posizioni degli span devono corrispondere ai px CSS del canvas.
    const vp   = page.getViewport({ scale, rotation });

    // Dimensiona il div esattamente come il canvas CSS
    tlDiv.style.width  = Math.round(vp.width)  + 'px';
    tlDiv.style.height = Math.round(vp.height) + 'px';
    // PDF.js 3.x richiede --scale-factor sul container del text layer
    tlDiv.style.setProperty('--scale-factor', String(scale));
    tlDiv.innerHTML    = '';

    const textContent = await page.getTextContent();

    task = lib.renderTextLayer({
      textContentSource: textContent,
      container:         tlDiv,
      viewport:          vp,
      textDivs:          [],
    });

    await task.promise;
    page.cleanup();
  };

  return {
    promise: run(),
    cancel() { try { task?.cancel(); } catch {} },
  };
}

/**
 * Cerca una stringa nel testo del documento, pagina per pagina (usa
 * page.getTextContent(), la stessa API già usata per il text layer — qui
 * però per leggere il testo, non per disegnarlo). Non esisteva alcuna
 * ricerca full-text prima di questa funzione (2026-08-27) — introdotta per
 * PDF/Search/* (flow embedded, vedi PDF-flow-nodes.mjs).
 *
 * Non calcola i rettangoli di posizione del match sulla pagina (servirebbe
 * mappare l'offset di stringa sugli item del text layer, uno per uno) — la
 * navigazione risultante porta alla pagina del match, non ne evidenzia
 * visivamente il testo esatto. Sufficiente per "vai al prossimo risultato";
 * un evidenziatore preciso è lavoro futuro, se servirà.
 *
 * @param {PDFDocumentProxy} doc
 * @param {string} query
 * @param {{ caseSensitive?: boolean, maxResults?: number }} [opts]
 * @returns {Promise<{page:number, index:number, snippet:string}[]>}
 */
export async function pdfSearchText(doc, query, { caseSensitive = false, maxResults = 500 } = {}) {
  const q = caseSensitive ? query : (query ?? '').toLowerCase();
  if (!q) return [];

  const results = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    if (results.length >= maxResults) break;

    const page        = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText     = textContent.items.map(it => it.str).join(' ');
    const haystack      = caseSensitive ? pageText : pageText.toLowerCase();

    let fromIdx = 0;
    while (results.length < maxResults) {
      const idx = haystack.indexOf(q, fromIdx);
      if (idx === -1) break;
      const start = Math.max(0, idx - 30);
      const end   = Math.min(pageText.length, idx + q.length + 30);
      results.push({
        page:    pageNum,
        index:   idx,
        snippet: pageText.slice(start, end).trim(),
      });
      fromIdx = idx + q.length;
    }
    page.cleanup();
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────

function _lib() {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('[PDF-core] pdfjsLib non trovata — aggiungere il <script> in dashboard.php');
  return lib;
}
