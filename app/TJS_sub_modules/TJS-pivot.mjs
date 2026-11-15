// TJS_sub_modules/TJS-pivot.mjs
// Pivot engine for multi-object transforms.
// - create/clear pivot
// - reparent selection under pivot preserving world transform (attach if available)
// - move pivot without moving children (detach -> move -> reattach)
// - compute bounds center

export function tjsCreatePivotManager({
  THREE,
  selectableRoot,
} = {}) {
  if (!THREE) throw new Error("[TJS-pivot] THREE missing");
  if (!selectableRoot) throw new Error("[TJS-pivot] selectableRoot missing");

  /** @type {THREE.Object3D|null} */
  let pivot = null;

  /** @type {Map<THREE.Object3D, THREE.Object3D|null>} */
  const originalParents = new Map();

  const _tmpBox = new THREE.Box3();
  const _tmpBox2 = new THREE.Box3();
  const _tmpCenter = new THREE.Vector3();
  const _tmpLocal = new THREE.Vector3();

  function restorePivotChildren() {
    for (const [obj, parent] of originalParents.entries()) {
      if (!obj) continue;
      if (parent) {
        if (parent.attach) parent.attach(obj);
        else parent.add(obj);
      } else {
        if (selectableRoot.attach) selectableRoot.attach(obj);
        else selectableRoot.add(obj);
      }
    }
    originalParents.clear();
  }

  function clearPivot() {
    if (!pivot) return;
    restorePivotChildren();
    try { pivot.parent?.remove(pivot); } catch {}
    pivot = null;
  }

  function computeSelectionBoundsCenter(selection) {
    const sel = Array.isArray(selection) ? selection : [];
    if (!sel.length) return _tmpCenter.set(0, 0, 0);

    _tmpBox.makeEmpty();
    for (const obj of sel) {
      _tmpBox2.setFromObject(obj);
      _tmpBox.union(_tmpBox2);
    }
    _tmpBox.getCenter(_tmpCenter);
    if (!Number.isFinite(_tmpCenter.x)) _tmpCenter.set(0, 0, 0);
    return _tmpCenter.clone();
  }

  function rebuildPivotForSelection(selection) {
    const sel = Array.isArray(selection) ? selection.filter(Boolean) : [];

    if (sel.length <= 1) {
      clearPivot();
      return null;
    }

    if (!pivot) {
      pivot = new THREE.Object3D();
      pivot.name = "TJS_MULTI_PIVOT";
      selectableRoot.add(pivot);
    }

    // Restore before reapplying
    restorePivotChildren();

    // Place pivot at bbox center
    const center = computeSelectionBoundsCenter(sel);
    pivot.position.copy(center);
    pivot.updateMatrixWorld(true);

    // Reparent selection under pivot preserving world
    for (const obj of sel) {
      if (!obj || obj === pivot) continue;
      originalParents.set(obj, obj.parent ?? null);
      if (pivot.attach) pivot.attach(obj);
      else pivot.add(obj);
    }

    return pivot;
  }

  function getAttachObject(selection, active) {
    const sel = Array.isArray(selection) ? selection : [];
    if (sel.length > 1) return pivot;
    return active ?? null;
  }

  // Move gizmo origin WITHOUT moving selected objects:
  // detach children, move pivot, reattach preserving world.
  function setPivotWorldPositionKeepObjects(selection, worldPos) {
    const sel = Array.isArray(selection) ? selection.filter(Boolean) : [];
    if (!pivot || sel.length <= 1) return false;
    if (!worldPos || !worldPos.isVector3) return false;

    // detach back to original parents
    restorePivotChildren();

    // set pivot to new position (convert to pivot.parent local)
    _tmpLocal.copy(worldPos);
    pivot.parent?.worldToLocal?.(_tmpLocal);

    pivot.position.copy(_tmpLocal);
    pivot.updateMatrixWorld(true);

    // reattach selection under pivot preserving world
    for (const obj of sel) {
      if (!obj || obj === pivot) continue;
      originalParents.set(obj, obj.parent ?? null);
      if (pivot.attach) pivot.attach(obj);
      else pivot.add(obj);
    }

    return true;
  }

  function getPivot() {
    return pivot;
  }

  function dispose() {
    clearPivot();
  }

  return {
    rebuildPivotForSelection,
    clearPivot,
    restorePivotChildren,

    computeSelectionBoundsCenter,
    setPivotWorldPositionKeepObjects,

    getAttachObject,
    getPivot,

    dispose,
  };
}
