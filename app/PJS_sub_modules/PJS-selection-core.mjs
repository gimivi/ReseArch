// APP/PJS_sub_modules/PJS-selection-core.mjs

/**
 * Selection core
 * - solo stato e mutazioni selection
 * - nessun disegno UI
 * - nessun hitTest / picking
 */

export function ensureSelectionState(state) {
  if (!state) throw new Error("PJS-selection-core: missing state");

  if (!(state.selection instanceof Set)) {
    state.selection = new Set();
  }

  if (!state._selectionUI || typeof state._selectionUI !== "object") {
    state._selectionUI = {
      bboxItem: null,
      dragRectItem: null
    };
  }

  if (!state._selectionSession || typeof state._selectionSession !== "object") {
    state._selectionSession = {
      dragActive: false,
      dragStartView: null,
      dragHadHit: false
    };
  }

  // QUI niente syncSelectionMeta(state)
  if (typeof state.selectionCount !== "number") {
    state.selectionCount = state.selection.size;
  }
  if (typeof state.hasSelection !== "boolean") {
    state.hasSelection = state.selection.size > 0;
  }

  return state.selection;
}

export function selectionArray(state) {
  ensureSelectionState(state);
  return Array.from(state.selection);
}

export function selectionCount(state) {
  ensureSelectionState(state);
  return state.selection.size;
}

export function hasSelection(state) {
  return selectionCount(state) > 0;
}

export function syncSelectionMeta(state) {
  ensureSelectionState(state);

  state.selectionCount = state.selection.size;
  state.hasSelection = state.selection.size > 0;

  // Hook per il flow runner OSD: bus emit + graph step
  try { state._onSelectionChange?.(); } catch {}

  return {
    count: state.selectionCount,
    hasSelection: state.hasSelection
  };
}

export function clearSelection(state) {
  ensureSelectionState(state);
  state.selection.clear();
  return syncSelectionMeta(state);
}

export function replaceSelection(state, items) {
  ensureSelectionState(state);
  state.selection.clear();

  for (const it of normalizeItems(items)) {
    if (it) state.selection.add(it);
  }

  return syncSelectionMeta(state);
}

export function addSelection(state, items) {
  ensureSelectionState(state);

  for (const it of normalizeItems(items)) {
    if (it) state.selection.add(it);
  }

  return syncSelectionMeta(state);
}

export function removeSelection(state, items) {
  ensureSelectionState(state);

  for (const it of normalizeItems(items)) {
    if (it) state.selection.delete(it);
  }

  return syncSelectionMeta(state);
}

export function applySelectionMode(state, items, { shift = false, ctrl = false } = {}) {
  ensureSelectionState(state);

  const filtered = normalizeItems(items);

  // Regola attuale coerente col tool esistente:
  // - nessun modificatore => replace
  // - shift => add
  // - ctrl => remove
  if (!shift && !ctrl) {
    return replaceSelection(state, filtered);
  }
  if (ctrl) {
    return removeSelection(state, filtered);
  }
  return addSelection(state, filtered);
}

export function resetSelectionSession(state) {
  ensureSelectionState(state);
  state._selectionSession.dragActive = false;
  state._selectionSession.dragStartView = null;
  state._selectionSession.dragHadHit = false;
}

export function beginSelectionSession(state, { dragStartView = null, dragHadHit = false } = {}) {
  ensureSelectionState(state);
  state._selectionSession.dragActive = true;
  state._selectionSession.dragStartView = dragStartView || null;
  state._selectionSession.dragHadHit = !!dragHadHit;
}

export function endSelectionSession(state) {
  resetSelectionSession(state);
}

function normalizeItems(items) {
  if (!items) return [];
  if (items instanceof Set) return Array.from(items);
  if (Array.isArray(items)) return items.filter(Boolean);
  return [items].filter(Boolean);
}