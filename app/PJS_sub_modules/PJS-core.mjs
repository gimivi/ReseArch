// APP/PJS_sub_modules/PJS-core.mjs
import { createHistory } from "./PJS-history.mjs";

/**
 * NOTE:
 * - STATE_KEY è sempre "_APP_STATE_";
 * sempre associtato alla container della APP 
 * e sarà usato per poratere a spasso per le funzioni della APP tutte el infomrazioi utili
 * non è pratico dichiararlo GLOBALMENTE, per le complessità necessarie ad non entare in conflitto con le info delle altre finestre.
 * vieni quindi riassegnato nello scope delle procedure ove serve
 */


const STATE_KEY = "_APP_STATE_";

export function getState(bodyEl) {
  return bodyEl?.[STATE_KEY]?.pjs || null;
}

export function initWindow(bodyEl, { winId, mod_id }) {
  if (!bodyEl?.[STATE_KEY]) bodyEl[STATE_KEY] = {};

  // Se già inizializzato, ritorna
  if (bodyEl[STATE_KEY].pjs) return bodyEl[STATE_KEY].pjs;

  const scope = new paper.PaperScope(); // PaperScope per finestra

  const state = bodyEl[STATE_KEY]; // state container (finestra)
  state.pjs = {
    winId,
    mod_id,
    scope,
    viewer: null,
    overlay: null, // { canvas, sync, viewPointToImagePoint, imagePointToViewPoint, detach }
    history: createHistory({ maxUndo: 30 }),
    mode: "select", // select | edit-vertices (futuro)
    dirty: false,
    dwg: null,  // { dwg_id, dwg_name, dwg_version, dwg_author_id, dwg_show, dwg_share, isOwner }
    _env: null, // envelope v1 attualmente caricato (per exportEnvelope)
    // EventTarget locale, indipendente dall'App Bus — sorgente per i nodi
    // flow PJS/Events/* (vedi PJS-flow-nodes.mjs), stesso principio di
    // model_PDF.mjs/model_MPS.mjs.
    localEvents: new EventTarget(),
  };

  return state.pjs;
}

export function destroyWindow(bodyEl) {
  const state = bodyEl?.[STATE_KEY];
  if (!state?.pjs) return;

  try { state.pjs.overlay?.detach?.(); } catch {}
  try {
    state.pjs.scope?.activate?.();
    state.pjs.scope?.project?.clear?.();
  } catch {}
  try { state.pjs.scope = null; } catch {}

  delete state.pjs;

  // Se vuoi lasciare intatto lo state generale (cmdUI, viewer, ecc.) non cancelliamo state.
  // Se invece vuoi pulire tutto:
  // delete bodyEl[STATE_KEY];
}

export function activateWindow(bodyEl) {
  const state = getState(bodyEl);
  if (!state?.overlay?.canvas) return;
  state.overlay.canvas.style.pointerEvents = "auto";
}

export function deactivateWindow(bodyEl) {
  const state = getState(bodyEl);
  if (!state?.overlay?.canvas) return;
  state.overlay.canvas.style.pointerEvents = "none";
}

export function setDirty(bodyEl, v) {
  const state = getState(bodyEl);
  if (!state) return;
  state.dirty = !!v;
}
export function setPaperInput(bodyEl, enabled) {
  const state = getState(bodyEl);
  if (!state?.overlay?.canvas) return;
  state.overlay.canvas.style.pointerEvents = enabled ? "auto" : "none";
}
