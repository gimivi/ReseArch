// TJS_sub_modules/TJS-selection.mjs
// Selection engine: raycast pick + multi-select + BoxHelper highlights
// - agnostic of TransformControls and footer UI
// - exposes selection[], active, selectObject(), clearSelection()
// - provides highlightGroup + updateHighlights()
// - pointer events are managed here (click vs drag threshold)
// - can ignore UI targets (footer/header etc.) via isUiTarget()

export function tjsCreateSelectionManager({
  THREE,
  scene,
  camera,
  domEl,
  selectableRoot,
  additionalPickRoots = [],   // extra roots inclusi nel raycast (es. TJS_LIGHTS_ROOT)
  getSelectable = defaultGetSelectable,
  isUiTarget = null, // (HTMLElement target) => boolean
  onSelectionChanged = null, // ({ selection, active, reason, hit }) => void — hit = intersezione del click (o null)
  hitFilter = null,          // (hit) => boolean — false scarta l'intersezione (es. parte tagliata; solo piani)
  keepSelectionOnEmpty = null, // () => boolean — true: il clic nel vuoto non deseleziona
  highlightColor = 0xffff00,
  clickMoveThresholdPx = 4,
} = {}) {
  if (!THREE) throw new Error("[TJS-selection] THREE missing");
  if (!scene || !camera || !domEl) throw new Error("[TJS-selection] scene/camera/domEl missing");
  if (!selectableRoot) throw new Error("[TJS-selection] selectableRoot missing");

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let enabled = true;

  /** @type {THREE.Object3D[]} */
  let selection = [];
  /** @type {THREE.Object3D|null} */
  let active = null;

  // one BoxHelper per selected root
  const highlightGroup = new THREE.Group();
  highlightGroup.name = "TJS_SELECTION_HIGHLIGHTS";
  scene.add(highlightGroup);

  // -----------------------------
  // HIGHLIGHTS
  // -----------------------------
  function rebuildHighlights() {
    // slice() perché remove() modifica children durante l'iterazione
    for (const c of highlightGroup.children.slice()) {
      highlightGroup.remove(c);      // imposta c.parent = null e rimuove dall'array
      c.geometry?.dispose();         // BufferGeometry interna di BoxHelper (LineSegments)
      c.material?.dispose?.();       // LineBasicMaterial
    }
    for (const obj of selection) {
      const h = new THREE.BoxHelper(obj, highlightColor);
      h.name = "TJS_SELECTION_BOX";
      highlightGroup.add(h);
    }
  }

  function updateHighlights() {
    for (const h of highlightGroup.children) h.update?.();
  }

  // -----------------------------
  // SELECTION API
  // -----------------------------
  function clearSelection({ silent = false, reason = "clear" } = {}) {
    selection = [];
    active = null;
    rebuildHighlights();
    if (!silent) onSelectionChanged?.({ selection: selection.slice(), active, reason });
  }

  // hit: intersezione del raycast che ha prodotto la selezione (solo dal click,
  // pickOnClick) — passata a chi ascolta per punto/normale/faccia/UV colpiti.
  function selectObject(obj, { add = false, remove = false, silent = false, reason = "select", hit = null } = {}) {
    if (!obj) return;

    const idx = selection.indexOf(obj);

    if (remove) {
      if (idx >= 0) selection.splice(idx, 1);
      if (active === obj) active = selection.length ? selection[selection.length - 1] : null;

      rebuildHighlights();
      if (!silent) onSelectionChanged?.({ selection: selection.slice(), active, reason, hit });
      return;
    }

    if (add) {
      if (idx < 0) selection.push(obj);
      active = obj;

      rebuildHighlights();
      if (!silent) onSelectionChanged?.({ selection: selection.slice(), active, reason, hit });
      return;
    }

    // replace
    selection = [obj];
    active = obj;

    rebuildHighlights();
    if (!silent) onSelectionChanged?.({ selection: selection.slice(), active, reason, hit });
  }

  // -----------------------------
  // PICK (click vs drag)
  // -----------------------------
  let _pdActive = false;
  let _pdMoved = false;
  let _pdX = 0;
  let _pdY = 0;
  let _pdPointerId = null;

  function onPointerDown(ev) {
    if (!enabled) return;
    if (ev.button !== 0) return;

    if (isUiTarget && isUiTarget(ev.target)) return;

    _pdActive = true;
    _pdMoved = false;
    _pdX = ev.clientX;
    _pdY = ev.clientY;
    _pdPointerId = ev.pointerId;

    try { domEl.setPointerCapture?.(ev.pointerId); } catch {}
  }

  function onPointerMove(ev) {
    if (!_pdActive) return;
    if (_pdPointerId !== ev.pointerId) return;

    const dx = Math.abs(ev.clientX - _pdX);
    const dy = Math.abs(ev.clientY - _pdY);
    if (dx > clickMoveThresholdPx || dy > clickMoveThresholdPx) _pdMoved = true;
  }

  function onPointerUp(ev) {
    if (!_pdActive) return;
    if (_pdPointerId !== ev.pointerId) return;

    if (isUiTarget && isUiTarget(ev.target)) {
      // treat as UI interaction, do not pick
      _pdActive = false;
      _pdMoved = false;
      _pdPointerId = null;
      return;
    }

    try { domEl.releasePointerCapture?.(ev.pointerId); } catch {}

    const wasMoved = _pdMoved;
    _pdActive = false;
    _pdMoved = false;
    _pdPointerId = null;

    // click only if not dragged
    if (wasMoved) return;
    if (ev.button !== 0) return;

    pickOnClick(ev);
  }

  function pickOnClick(ev) {
    if (!enabled) return;

    const rect = domEl.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, camera);

    // intersectObject con recursive:true traversa in un'unica passata ottimizzata
    // e colpisce solo Mesh/Line/Points (le altre classi non implementano raycast()).
    const hits = raycaster.intersectObject(selectableRoot, true);
    // Aggiunge hit da roots extra (es. TJS_LIGHTS_ROOT), poi riordina per distanza
    for (const root of additionalPickRoots) {
      if (root) hits.push(...raycaster.intersectObject(root, true));
    }
    if (additionalPickRoots.length) hits.sort((a, b) => a.distance - b.distance);

    // intersezioni non valide (parti tolte dal taglio, oggetti esclusi dalla modalità piani)
    if (hitFilter) {
      for (let i = hits.length - 1; i >= 0; i--) if (!hitFilter(hits[i])) hits.splice(i, 1);
    }

    // click empty => clear selection
    if (!hits.length) {
      if (keepSelectionOnEmpty?.()) return;
      clearSelection({ reason: "empty-click" });
      return;
    }

    const hit = hits[0].object;

    // Alt+click: drill-down → seleziona il mesh/oggetto hit direttamente,
    // senza risalire la gerarchia verso il gruppo root.
    // Alt+Shift: aggiunge il mesh drillato alla selezione corrente.
    // Click normale: usa il resolver (di default → root del gruppo figlio di selectableRoot).
    let sel;
    if (ev.altKey) {
      sel = hit;
    } else {
      sel = (getSelectable === defaultGetSelectable)
        ? defaultGetSelectable(hit, selectableRoot)
        : getSelectable(hit, selectableRoot);
    }

    if (!sel) return;

    // Per-object lock: skip se l'oggetto è marcato come non selezionabile
    if (sel?.userData?.__tjs_no_select__) return;

    // Filtro per tipo (impostato da env-manager in scene.userData.__tjs_selFilter__)
    const selFilter = scene.userData?.__tjs_selFilter__;
    if (selFilter?.blocked?.size) {
      const t = sel.isGroup ? 'Group'
        : sel.isMesh   ? 'Mesh'
        : sel.isLine   ? 'Line'
        : sel.isPoints ? 'Points'
        : 'Other';
      if (selFilter.blocked.has(t)) return;
    }

    const remove = !!(ev.ctrlKey || ev.metaKey);
    const add = !!ev.shiftKey && !remove;

    selectObject(sel, { add, remove, reason: ev.altKey ? "pick-drill" : "pick", hit: hits[0] });
  }

  // -----------------------------
  // LIFECYCLE
  // -----------------------------
  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) clearSelection({ reason: "disabled" });
  }

  domEl.addEventListener("pointerdown", onPointerDown);
  domEl.addEventListener("pointermove", onPointerMove);
  domEl.addEventListener("pointerup", onPointerUp);
  domEl.addEventListener("pointercancel", onPointerUp);

  function dispose() {
    domEl.removeEventListener("pointerdown", onPointerDown);
    domEl.removeEventListener("pointermove", onPointerMove);
    domEl.removeEventListener("pointerup", onPointerUp);
    domEl.removeEventListener("pointercancel", onPointerUp);

    try { scene.remove(highlightGroup); } catch {}
    clearSelection({ silent: true });
  }

  return {
    setEnabled,
    pickOnClick,

    selectObject,
    clearSelection,

    rebuildHighlights,
    updateHighlights,

    get selection() { return selection.slice(); },
    get active() { return active; },
    get highlightGroup() { return highlightGroup; },

    dispose,
  };
}

// default selectable resolver:
// returns first ancestor whose parent is selectableRoot
function defaultGetSelectable(hitObject, selectableRoot) {
  let cur = hitObject;

  while (cur) {
    // 🔴 PRIORITÀ: se trovo un nodo marcato come selezionabile, mi fermo
    if (cur.userData?.__tjs_selectable__ === true) {
      return cur;
    }

    // Se sono arrivato al selectableRoot, mi fermo
    if (cur === selectableRoot) break;

    cur = cur.parent;
  }

  // fallback: primo figlio diretto sotto selectableRoot
  cur = hitObject;
  while (cur && cur.parent !== selectableRoot) {
    cur = cur.parent;
  }

  return cur || null;
}
