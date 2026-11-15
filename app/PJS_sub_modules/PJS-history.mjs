// APP/PJS_sub_modules/PJS-history.mjs

/**
 * Esporta il progetto Paper.js come stringa JSON escludendo il layer __ui__
 * (snap marker, construction points). Usare al posto di project.exportJSON()
 * in tutti i pushSnapshot, per evitare che marker transitori vengano baked
 * nello snapshot e riappaiano come elementi permanenti dopo un undo.
 */
export function exportProjectJSON(state) {
  const scope = state?.scope;
  if (!scope?.project) return '[]';

  const ui = scope.project.layers.find(
    l => l.name === '__ui__' || l.data?.isUiLayer === true
  );

  if (!ui) return scope.project.exportJSON({ asString: true });

  // Svuota temporaneamente il layer UI, esporta, ripristina.
  // Operazione sincrona: nessun setTimeout può interporsi.
  const saved = [...(ui.children || [])];
  ui.removeChildren();
  const json = scope.project.exportJSON({ asString: true });
  for (const c of saved) {
    try { if (!c.removed) ui.addChild(c); } catch {}
  }
  return json;
}

export function createHistory({ maxUndo = 30 } = {}) {
  return {
    maxUndo,
    undoStack: [], // { label, snapshot }
    redoStack: [],
    currentSnapshot: null,
  };
}

export function canUndo(h) { return h.undoStack.length > 0; }
export function canRedo(h) { return h.redoStack.length > 0; }

export function pushSnapshot(h, { label, snapshot }) {
  if (h.currentSnapshot !== null) {
    h.undoStack.push({ label, snapshot: h.currentSnapshot });
    if (h.undoStack.length > h.maxUndo) h.undoStack.shift();
  }
  h.currentSnapshot = snapshot;
  h.redoStack.length = 0;
}

export function undo(h) {
  if (!canUndo(h)) return null;
  const last = h.undoStack.pop();
  if (h.currentSnapshot !== null) h.redoStack.push({ label: "redo", snapshot: h.currentSnapshot });
  h.currentSnapshot = last.snapshot;
  return h.currentSnapshot;
}

export function redo(h) {
  if (!canRedo(h)) return null;
  const last = h.redoStack.pop();
  if (h.currentSnapshot !== null) h.undoStack.push({ label: "undo", snapshot: h.currentSnapshot });
  if (h.undoStack.length > h.maxUndo) h.undoStack.shift();
  h.currentSnapshot = last.snapshot;
  return h.currentSnapshot;
}
