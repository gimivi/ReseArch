// TJS_sub_modules/TJS-cut-core.mjs
//
// Clipping tool (basic / stencil) with:
// - multi-target support (clipping on 1 or N selected Object3D)
// - helper hierarchy under selectableRoot:  selectableRoot/_helper/clippingPlanes
// - plane actors are persistent (created once, then shown/hidden)
// - NO "shortcut attach": planes are transformed only via normal selection + TransformTool
//
// Contract (public API returned):
//   - setTarget(object3D, {resetDefaults})
//   - setTargets([object3D,...], {resetDefaults})
//   - enable(), disable()
//   - showUI()
//   - setMode("basic"|"stencil")
//   - setPlaneEnabledForCut("XY"|"XZ"|"YZ", bool)
//   - setPlaneVisible("XY"|"XZ"|"YZ", bool)
//   - beforeRender()  (call per-frame if stencil is used)
//   - dispose()
//
// Notes:
// - BBox is computed as union of Box3.setFromObject(...) over all targetRoots.
// - Initial plane placement is automatic ONLY when resetDefaults=true (new target selection).
// - Each plane keeps the side chosen by its `flip` flag. The default is set ONCE when planes are
//   placed (bbox center kept); it is no longer re-evaluated every frame, so dragging a plane past
//   the center does not swap the kept/removed halves (2026-10-18). flipPlane(id) switches side.
// - Clipping applies to Mesh, Points and Line of the targets; stencil caps only to (closed) Mesh.
//

import { createBasicStrategy } from "./TJS-cut-basic.mjs";
import { createStencilStrategy } from "./TJS-cut-stencil.mjs";
import { t, te } from "../shared/i18n.mjs";

export function tjsCreateCutTool({
  THREE,
  scene,
  renderer,
  camera,
  domEl,
  cmdUI,
  transformTool,
  markDirty = null,

  // helper placement for persistent plane actors
  selectableRoot = null,
  helperGroupName = "_helper",
  helperClipGroupName = "clippingPlanes",

  initialMode = "basic",
} = {}) {
  if (!THREE || !scene || !renderer || !camera || !domEl) {
    throw new Error("[TJS-cut-core] missing THREE/scene/renderer/camera/domEl");
  }

  renderer.localClippingEnabled = true;

  // temps (allocati una volta sola — mai ricreare in funzioni chiamate spesso)
  const _box = new THREE.Box3();
  const _boxTmp = new THREE.Box3();
  const _size = new THREE.Vector3();
  const _center = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _normal = new THREE.Vector3();

  // cache per getStrategyCtx: max 3 piani, evita new Vector3/Quaternion ad ogni chiamata
  const _ctxPos  = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const _ctxQuat = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];

  const esc =
    cmdUI && typeof cmdUI.escapeHtml === "function" ? cmdUI.escapeHtml : (s) => String(s);

  // ---------- state ----------
  let enabled = false;
  let mode = initialMode === "stencil" ? "stencil" : "basic";
  let _planesHidden = false;  // override globale: nasconde i piani senza toccare enabledForCut

  // Colore e opacità del cap stencil — sincronizzati con la strategy
  const _CAP_DEFAULT_COLOR   = 0x822433;
  let _capColor   = _CAP_DEFAULT_COLOR;
  let _capOpacity = 1.0;
  let _capSolid   = false;   // "Sezione opaca": pieno anche sui materiali trasparenti

  // Converte numero hex → stringa "#rrggbb" per input[type=color]
  function _hexToInput(h) { return '#' + h.toString(16).padStart(6, '0'); }

  // Multi-target
  /** @type {THREE.Object3D[]} */
  let targetRoots = [];
  /** @type {THREE.Mesh[]} */
  let targetMeshes = [];          // solo Mesh: usate dallo stencil (riempimento sezione)
  /** @type {THREE.Object3D[]} */
  let targetClipObjs = [];        // Mesh + Points + Line: ricevono i piani di taglio
  let targetClipSet = new Set();  // per isHitClipped (lookup veloce)

  // Material cloning to avoid cross-object shared-material side effects
  const originalMaterials = new Map(); // mesh -> original material(s)
  const clonedMaterials = new Set(); // clones created by us (dispose on restore)

  // Plane actors (persistent) + mathematical planes (used for clipping)
  const planes = [
    { id: "XY", enabledForCut: true, visible: true, flip: false, actor: null, plane: new THREE.Plane(), color: 0x00ffff },
    { id: "XZ", enabledForCut: true, visible: true, flip: false, actor: null, plane: new THREE.Plane(), color: 0xff00ff },
    { id: "YZ", enabledForCut: true, visible: true, flip: false, actor: null, plane: new THREE.Plane(), color: 0xffff00 },
  ];

  const planeGroup = new THREE.Group();
  planeGroup.name = "TJS_CUT_PLANE_ACTORS";

  // Strategies
  const basicStrategy = createBasicStrategy();
  const stencilStrategy = createStencilStrategy({ capColor: 0x822433 }); // crimson (rosso porpora)
  let strategy = mode === "stencil" ? stencilStrategy : basicStrategy;

  // Footer binding
  let footerBound = false;
  let footerShownOnce = false;

  // ---------- helper tree ----------
  function ensureChildGroup(parent, name) {
    let g = parent.getObjectByName(name);
    if (!g) {
      g = new THREE.Group();
      g.name = name;
      parent.add(g);
    }
    return g;
  }

  function ensureHelperClipGroup() {
    if (!selectableRoot) return null;
    const helper = ensureChildGroup(selectableRoot, helperGroupName);
    const clip = ensureChildGroup(helper, helperClipGroupName);
    return clip;
  }

  // ---------- footer UI ----------
  function footerRoot() {
    return cmdUI?.el?.() ?? null;
  }

  function ensureFooterBound() {
    if (footerBound) return;
    const root = footerRoot();
    if (!root) return;

    // avoid footer interactions interfering with canvas picking
    const stop = (e) => e.stopPropagation();
    root.addEventListener("pointerdown", stop, true);
    root.addEventListener("pointerup", stop, true);
    root.addEventListener("pointermove", stop, true);
    root.addEventListener("wheel", stop, true);

    root.addEventListener("click", onFooterClick);
    root.addEventListener("change", onFooterChange);
    root.addEventListener("input", onFooterChange);

    footerBound = true;
  }

  function footerStatusHtml() {
    const n = targetRoots.length;
    const tgtTxt = n ? `Sel:${n}` : "—";
    return `<span><b>CLIP</b> | ${te("app.tjs.cut.footer_status", { target: tgtTxt, mode: mode.toUpperCase() })}</span>`;
  }

  function footerHintsText() {
    return mode === "stencil" ? t("app.tjs.cut.hints_stencil") : t("app.tjs.cut.hints");
  }

  function footerControlsHtml() {
    const hasTarget = targetRoots.length > 0;
    const dis       = !hasTarget ? "disabled" : "";

    const onOffTitle = enabled ? t("app.tjs.cut.clipping_on") : t("app.tjs.cut.clipping_off");
    const onOffTip   = enabled ? t("app.tjs.cut.click_off") : t("app.tjs.cut.click_on");

    const modeTitle  = mode === "basic" ? "Basic" : "Stencil";
    const modeTip    = mode === "basic" ? t("app.tjs.cut.click_stencil") : t("app.tjs.cut.click_basic");

    const hideTip    = _planesHidden ? t("app.tjs.cut.show_planes_tip") : t("app.tjs.cut.hide_planes_tip");
    const hideIcon   = _planesHidden ? "bi bi-eye-slash" : "bi bi-eye";
    const hideActive = _planesHidden ? " active" : "";

    const chk = (v) => (v ? "checked" : "");

    // Controlli colore/opacità cap — visibili solo in modalità Stencil
    const stencilExtras = mode === "stencil" ? `
      <span style="width:1px;height:1.1em;background:currentColor;opacity:.3;display:inline-block"></span>
      <label class="d-inline-flex align-items-center gap-1 m-0"
             style="font-size:11px;color:#ccc;user-select:none"
             title="${te("app.tjs.cut.cap_color")}">
        <i class="bi bi-palette" aria-hidden="true"></i>
        <input type="color" class="tjs-cut-cap-color" aria-label="${te("app.tjs.cut.cap_color")}"
               value="${_hexToInput(_capColor)}"
               style="width:26px;height:20px;padding:0 2px;border:1px solid #555;
                      border-radius:3px;cursor:pointer;background:transparent"
               ${dis}>
      </label>
      <label class="d-inline-flex align-items-center gap-1 m-0"
             style="font-size:11px;color:#ccc;user-select:none"
             title="${te("app.tjs.cut.cap_opacity")}">
        <i class="bi bi-circle-half" aria-hidden="true"></i>
        <input type="range" class="tjs-cut-cap-opacity" aria-label="${te("app.tjs.cut.cap_opacity")}"
               min="0" max="1" step="0.05" value="${_capOpacity}"
               style="width:55px;cursor:pointer" ${dis}>
      </label>` : "";

    return `
      <div class="d-inline-flex align-items-center gap-2 flex-wrap">
        <button type="button"
                class="btn btn-sm btn-outline-light tjs-cut-toggle"
                title="${esc(onOffTip)}" ${!hasTarget && !enabled ? "disabled" : ""}>
          ${esc(onOffTitle)}
        </button>

        <button type="button"
                class="btn btn-sm btn-outline-light tjs-cut-mode-toggle"
                title="${esc(modeTip)}" ${dis}>
          ${esc(modeTitle)}
        </button>

        <button type="button"
                class="btn btn-sm btn-outline-light tjs-cut-hide-planes${hideActive}"
                title="${esc(hideTip)}" aria-label="${esc(hideTip)}" ${dis}>
          <i class="${hideIcon}" aria-hidden="true"></i>
        </button>

        <div class="d-inline-flex align-items-center gap-2">
          ${planes.map((p) => `
            <label class="d-inline-flex align-items-center gap-1 m-0" style="user-select:none;">
              <input class="form-check-input m-0 tjs-cut-plane"
                     type="checkbox" data-plane="${p.id}"
                     ${chk(p.enabledForCut && p.visible)} ${dis}/>
              <span>${p.id}</span>
            </label>`).join("")}
        </div>

        ${stencilExtras}
      </div>
    `;
  }

  function showFooter(forceShow = false) {
    if (!cmdUI) return;

    if (!enabled && !forceShow) {
      cmdUI.hide({ clear: true });
      footerShownOnce = false;
      return;
    }

    ensureFooterBound();

    const payload = {
      status: footerStatusHtml(),
      hints: footerHintsText(),
      controls: footerControlsHtml(),
    };

    if (!footerShownOnce) {
      cmdUI.show({ ...payload, keepAlive: true });   // keepAlive: footer resta visibile finché il clipping è attivo
      footerShownOnce = true;
    } else {
      cmdUI.update(payload);
    }
  }

  function updateFooter() {
    if (!cmdUI || !enabled) return;
    cmdUI.update({
      status: footerStatusHtml(),
      hints: footerHintsText(),
      controls: footerControlsHtml(),
    });
  }

  function onFooterClick(ev) {
    const tgt = ev.target;
    if (!(tgt instanceof HTMLElement)) return;

    const btn = tgt.closest("button");
    if (!(btn instanceof HTMLElement)) return;

    if (btn.classList.contains("tjs-cut-toggle")) {
      if (enabled) disable();
      else enable();
      return;
    }

    if (btn.classList.contains("tjs-cut-mode-toggle")) {
      setMode(mode === "basic" ? "stencil" : "basic");
      return;
    }

    if (btn.classList.contains("tjs-cut-hide-planes")) {
      _planesHidden = !_planesHidden;
      updatePlaneActorsVisibility();
      updateFooter();
      markDirty?.();
      return;
    }
  }

  function onFooterChange(ev) {
    const tgt = ev.target;
    if (!(tgt instanceof HTMLElement)) return;

    // Checkbox piano: abilita/disabilita taglio + visibilità individuale
    if (tgt.classList.contains("tjs-cut-plane")) {
      const id = /** @type {HTMLInputElement} */ (tgt).getAttribute("data-plane");
      const on = /** @type {HTMLInputElement} */ (tgt).checked;
      setPlaneEnabledForCut(id, on);
      setPlaneVisible(id, on);
      refreshCutRendering();
      updateFooter();
      markDirty?.();
      return;
    }

    // Color picker: colore del riempimento stencil
    if (tgt.classList.contains("tjs-cut-cap-color")) {
      _capColor = parseInt(/** @type {HTMLInputElement} */ (tgt).value.slice(1), 16);
      stencilStrategy.setCapColor(_capColor);
      markDirty?.();
      return;
    }

    // Range opacità: 0–1 del riempimento stencil
    if (tgt.classList.contains("tjs-cut-cap-opacity")) {
      _capOpacity = parseFloat(/** @type {HTMLInputElement} */ (tgt).value);
      stencilStrategy.setCapOpacity(_capOpacity);
      markDirty?.();
      return;
    }
  }

  // ---------- target helpers ----------
  // Mesh, nuvole di punti e linee: tutte ricevono i piani di taglio (prima solo Mesh)
  function collectTargetsClipObjs(roots) {
    const out = [];
    for (const root of roots) {
      if (!root) continue;
      root.traverse((o) => {
        if (o && (o.isMesh || o.isPoints || o.isLine) && o.geometry) out.push(o);
      });
    }
    return out;
  }

  function cloneMaterialsForTarget(meshes) {
    originalMaterials.clear();
    clonedMaterials.clear();

    for (const mesh of meshes) {
      originalMaterials.set(mesh, mesh.material);

      if (Array.isArray(mesh.material)) {
        const clones = mesh.material.map((mat) => {
          const c = mat?.clone?.() ?? mat;
          if (c && c !== mat) {
            clonedMaterials.add(c);
            c.side = THREE.DoubleSide;
            c.needsUpdate = true;
          }
          return c;
        });
        mesh.material = clones;
      } else {
        const mat = mesh.material;
        const c = mat?.clone?.() ?? mat;
        if (c && c !== mat) {
          clonedMaterials.add(c);
          c.side = THREE.DoubleSide;
          c.needsUpdate = true;
        }
        mesh.material = c;
      }
    }
  }

  function restoreMaterials() {
    for (const [mesh, orig] of originalMaterials.entries()) {
      mesh.material = orig;
    }
    originalMaterials.clear();

    for (const m of clonedMaterials) {
      try { m?.dispose?.(); } catch {}
    }
    clonedMaterials.clear();
  }

  function applyClippingPlanesToTargetMaterials(activePlanes) {
    for (const mesh of targetClipObjs) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.clippingPlanes = activePlanes;
        mat.clipShadows = true;
        mat.needsUpdate = true;
      }
    }
  }

  function computeTargetsBox(outBox) {
    outBox.makeEmpty();
    for (const r of targetRoots) {
      if (!r) continue;
      _boxTmp.setFromObject(r);
      outBox.union(_boxTmp);
    }
    return outBox;
  }

  function computeTargetsCenterWorld(out) {
    if (!targetRoots.length) return out.set(0, 0, 0);
    computeTargetsBox(_box);
    _box.getCenter(out);
    if (!Number.isFinite(out.x)) out.set(0, 0, 0);
    return out;
  }

  // ---------- plane actors ----------
  function createPlaneActor(id, colorHex) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `TJS_CLIP_PLANE_${id}`;
    mesh.renderOrder = 1000;

    // selection policy: stop getSelectable climb at this node
    mesh.userData.__tjs_selectable__ = true;
    mesh.userData.__tjs_helper_kind__ = "clipPlane";

    return mesh;
  }

  function orientActorToNormal(actor, normalVec3) {
    actor.quaternion.setFromUnitVectors(_zAxis, normalVec3.clone().normalize());
  }

  function initPlaneActorsOnce() {
    // already created
    if (planes[0].actor && planes[1].actor && planes[2].actor) return;

    // ensure helper placement
    const clipGroup = ensureHelperClipGroup();
    if (clipGroup) {
      if (planeGroup.parent !== clipGroup) clipGroup.add(planeGroup);
    } else {
      if (planeGroup.parent !== scene) scene.add(planeGroup);
    }

    planeGroup.clear();

    planes[0].actor = createPlaneActor("XY", planes[0].color);
    planes[1].actor = createPlaneActor("XZ", planes[1].color);
    planes[2].actor = createPlaneActor("YZ", planes[2].color);

    // robust orientation (no fragile Euler rotations)
    orientActorToNormal(planes[0].actor, new THREE.Vector3(0, 0, 1)); // XY
    orientActorToNormal(planes[1].actor, new THREE.Vector3(0, 1, 0)); // XZ (normal +Y)
    orientActorToNormal(planes[2].actor, new THREE.Vector3(1, 0, 0)); // YZ (normal +X)

    for (const p of planes) {
      if (p.actor) planeGroup.add(p.actor);
    }

    // start hidden
    for (const p of planes) {
      p.visible = false;
      if (p.actor) p.actor.visible = false;
    }
  }

  function updatePlaneActorsVisibility() {
    for (const p of planes) {
      if (p.actor) p.actor.visible = !_planesHidden && !!p.visible;
    }
  }

  // Piano matematico dall'actor: normale = asse Z dell'actor, verso scelto da p.flip.
  // Nessun calcolo del bbox qui: è chiamata a ogni frame.
  function updatePlanesFromActors() {
    for (const p of planes) {
      if (!p.actor) continue;

      p.actor.getWorldPosition(_p);
      p.actor.getWorldQuaternion(_q);

      _normal.copy(_zAxis).applyQuaternion(_q).normalize();
      p.plane.setFromNormalAndCoplanarPoint(_normal, _p);
      if (p.flip) p.plane.negate();
    }
  }

  // Verso iniziale: si tiene la metà che contiene il centro dei target (calcolato una volta sola)
  function resetFlipsToKeepCenter() {
    const center = computeTargetsCenterWorld(_center);
    for (const p of planes) p.flip = false;
    updatePlanesFromActors();
    for (const p of planes) {
      if (p.actor && p.plane.distanceToPoint(center) < 0) p.flip = true;
    }
    updatePlanesFromActors();
  }

  function fitPlanesToTargetsBBoxResetDefaults() {
    if (!targetRoots.length) return;

    computeTargetsBox(_box);
    _box.getSize(_size);
    _box.getCenter(_center);

    const margin = 0.02 * Math.max(_size.x, _size.y, _size.z);

    // Ensure actors exist
    initPlaneActorsOnce();

    // Reset plane flags (defaults)
    for (const p of planes) {
      p.enabledForCut = true;
      p.visible = true;
    }

    // Place 3 planes on the "max" faces (slightly outside)
    // XY plane (normal Z)
    if (planes[0].actor) {
      planes[0].actor.scale.set(_size.x + margin, _size.y + margin, 1);
      planes[0].actor.position.set(_center.x, _center.y, _box.max.z + margin);
      orientActorToNormal(planes[0].actor, new THREE.Vector3(0, 0, 1));
    }

    // XZ plane (normal Y)
    if (planes[1].actor) {
      planes[1].actor.scale.set(_size.x + margin, _size.z + margin, 1);
      planes[1].actor.position.set(_center.x, _box.max.y + margin, _center.z);
      orientActorToNormal(planes[1].actor, new THREE.Vector3(0, 1, 0));
    }

    // YZ plane (normal X)  (your "ZY")
    if (planes[2].actor) {
      planes[2].actor.scale.set(_size.z + margin, _size.y + margin, 1);
      planes[2].actor.position.set(_box.max.x + margin, _center.y, _center.z);
      orientActorToNormal(planes[2].actor, new THREE.Vector3(1, 0, 0));
    }

    updatePlaneActorsVisibility();
    resetFlipsToKeepCenter();
  }

  function getActivePlanes() {
    return planes.filter((p) => p.enabledForCut).map((p) => p.plane);
  }

  // ---------- strategy wiring ----------
  function getStrategyCtx() {
    // Only enabledForCut planes participate in stencil caps.
    // Riusiamo _ctxPos/_ctxQuat (pre-allocati) invece di creare new Vector3/Quaternion.
    const planeWorldPos = [];
    const planeWorldQuat = [];

    let i = 0;
    for (const p of planes) {
      if (!p.enabledForCut || !p.actor) continue;
      p.actor.getWorldPosition(_ctxPos[i]);
      p.actor.getWorldQuaternion(_ctxQuat[i]);
      planeWorldPos.push(_ctxPos[i]);
      planeWorldQuat.push(_ctxQuat[i]);
      i++;
    }

    return {
      THREE,
      scene,
      renderer,
      camera,
      targetRoots,
      targetMeshes,
      activePlanes: getActivePlanes(),
      planeWorldPos,
      planeWorldQuat,
    };
  }

  function refreshCutRendering() {
    if (!enabled || !targetRoots.length) return;

    updatePlanesFromActors();

    const active = getActivePlanes();
    applyClippingPlanesToTargetMaterials(active);

    // rebuild strategy visualization (stencil caps etc.)
    strategy.clear(getStrategyCtx());
    strategy.apply(getStrategyCtx());
  }

  function setMode(next) {
    const m = next === "stencil" ? "stencil" : "basic";
    if (mode === m) return;

    try { strategy.clear(getStrategyCtx()); } catch {}

    mode = m;
    strategy = mode === "stencil" ? stencilStrategy : basicStrategy;

    if (enabled && targetRoots.length) strategy.apply(getStrategyCtx());
    updateFooter();
    markDirty?.();
  }

  function setPlaneEnabledForCut(id, on) {
    const p = planes.find((pp) => pp.id === id);
    if (!p) return;
    p.enabledForCut = !!on;
  }

  function setPlaneVisible(id, on) {
    const p = planes.find((pp) => pp.id === id);
    if (!p) return;
    p.visible = !!on;
    updatePlaneActorsVisibility();
  }

  // ---------- enable / disable / targets ----------
  function enable() {
    if (enabled) return;

    if (!targetRoots.length) {
      // no target => show UI prompt but do not enable
      showFooter(true);
      return;
    }

    enabled = true;

    initPlaneActorsOnce();
    // If user previously hid planes, keep their state; otherwise ensure visible defaults were set on reset.
    updatePlaneActorsVisibility();

    showFooter(true);
    refreshCutRendering();
    markDirty?.();
  }

  function disable() {
    // Turn off clipping effect but keep persistent plane actors (hidden)
    enabled = false;
    _planesHidden = false;  // reset: al prossimo enable i piani tornano visibili

    try { strategy.clear(getStrategyCtx()); } catch {}
    restoreMaterials();

    // hide planes (persistent)
    for (const p of planes) {
      p.visible = false;
      if (p.actor) p.actor.visible = false;
    }

    targetRoots = [];
    targetMeshes = [];
    targetClipObjs = [];
    targetClipSet = new Set();

    showFooter(false);
    markDirty?.();
  }

  function setTargets(roots, { resetDefaults = true } = {}) {
    const arr = Array.isArray(roots) ? roots.filter(Boolean) : [];
    if (!arr.length) return;

    // cleanup previous targets (if any)
    if (enabled && targetRoots.length) {
      try { strategy.clear(getStrategyCtx()); } catch {}
      restoreMaterials();
    }

    // Consume selection so the model doesn't remain selected while clipping edits occur
    try { transformTool?.enableGizmo?.(false); } catch {}
    try { transformTool?.clearSelection?.(); } catch {}

    targetRoots = arr;
    targetClipObjs = collectTargetsClipObjs(targetRoots);
    targetClipSet  = new Set(targetClipObjs);
    targetMeshes   = targetClipObjs.filter((o) => o.isMesh);
    cloneMaterialsForTarget(targetClipObjs);

    initPlaneActorsOnce();

    if (resetDefaults) {
      // reset mode to initialMode for each new target-set (as requested)
      mode = initialMode === "stencil" ? "stencil" : "basic";
      strategy = mode === "stencil" ? stencilStrategy : basicStrategy;

      fitPlanesToTargetsBBoxResetDefaults();

      // heuristic stencil cap plane size
      computeTargetsBox(_box);
      _box.getSize(_size);
      const diag = _size.length();
      try { stencilStrategy.setPlaneSize(Math.max(10, diag * 3)); } catch {}
    }

    enable();
    updateFooter();
  }

  function setTarget(root, opts) {
    if (!root || !root.isObject3D) return;
    setTargets([root], opts);
  }

  function showUI() {
    showFooter(true);
  }

  // ---------- public API ----------
  return {
    get enabled() { return enabled; },
    get mode() { return mode; },
    get targetRoots() { return targetRoots; },

    setTarget,
    setTargets,

    enable,
    disable,
    showUI,

    setMode,
    setPlaneEnabledForCut,
    setPlaneVisible,

    // Colore (0xrrggbb) e opacità (0–1) del riempimento sezione in modalità Stencil.
    setCapColor(hex) {
      _capColor = hex;
      stencilStrategy.setCapColor(hex);
      markDirty?.();
    },
    setCapOpacity(v) {
      _capOpacity = Math.max(0, Math.min(1, Number(v) || 0));
      stencilStrategy.setCapOpacity(_capOpacity);
      markDirty?.();
    },
    setCapSolid(on) {
      _capSolid = !!on;
      stencilStrategy.setCapSolid(_capSolid);
      markDirty?.();
    },

    // Toggle globale visibilità piani (senza toccare enabledForCut).
    togglePlanesHidden() {
      _planesHidden = !_planesHidden;
      updatePlaneActorsVisibility();
      updateFooter();
      markDirty?.();
    },

    // Espone refreshCutRendering al pannello esterno (es. dopo cambio enabledForCut).
    refreshCut() {
      if (enabled && targetRoots.length) refreshCutRendering();
    },

    // Stato corrente leggibile dal CutManager (senza riferimenti interni).
    getState() {
      return {
        enabled,
        mode,
        planesHidden: _planesHidden,
        capColor:  _capColor,
        capOpacity: _capOpacity,
        capSolid:  _capSolid,
        planes: planes.map(p => ({
          id:           p.id,
          enabledForCut: p.enabledForCut,
          visible:      p.visible,
          flip:         p.flip,
        })),
      };
    },

    // Posizioni e orientamenti degli actor (per salvare una configurazione).
    getPlaneTransforms() {
      const vp = new THREE.Vector3();
      const qp = new THREE.Quaternion();
      return planes.map(p => {
        const result = {
          id:           p.id,
          enabledForCut: p.enabledForCut,
          visible:      p.visible,
          flip:         p.flip,
          pos:   null,
          quat:  null,
          scale: null,
        };
        if (p.actor) {
          p.actor.getWorldPosition(vp);
          p.actor.getWorldQuaternion(qp);
          result.pos   = { x: vp.x, y: vp.y, z: vp.z };
          result.quat  = { x: qp.x, y: qp.y, z: qp.z, w: qp.w };
          result.scale = { x: p.actor.scale.x, y: p.actor.scale.y, z: p.actor.scale.z };
        }
        return result;
      });
    },

    // Ripristina mode, colore, opacità e posizioni piani da una configurazione salvata.
    applyConfig(cfg) {
      if (!cfg) return;
      if (cfg.mode) setMode(cfg.mode);
      if (typeof cfg.capColor   === 'number') {
        _capColor = cfg.capColor;
        stencilStrategy.setCapColor(_capColor);
      }
      if (typeof cfg.capOpacity === 'number') {
        _capOpacity = cfg.capOpacity;
        stencilStrategy.setCapOpacity(_capOpacity);
      }
      _capSolid = cfg.capSolid === true;
      stencilStrategy.setCapSolid(_capSolid);
      let missingFlip = false;
      for (const ps of (cfg.planes ?? [])) {
        const p = planes.find(pp => pp.id === ps.id);
        if (!p) continue;
        if (typeof ps.enabledForCut === 'boolean') p.enabledForCut = ps.enabledForCut;
        if (typeof ps.visible       === 'boolean') p.visible       = ps.visible;
        if (typeof ps.flip          === 'boolean') p.flip          = ps.flip;
        else missingFlip = true;
        if (p.actor && ps.pos && ps.quat) {
          p.actor.position.set(ps.pos.x, ps.pos.y, ps.pos.z);
          p.actor.quaternion.set(ps.quat.x, ps.quat.y, ps.quat.z, ps.quat.w);
          if (ps.scale) p.actor.scale.set(ps.scale.x, ps.scale.y, ps.scale.z);
        }
      }
      // configurazione senza verso salvato: verso iniziale (si tiene il centro)
      if (missingFlip) resetFlipsToKeepCenter();
      updatePlaneActorsVisibility();
      if (enabled && targetRoots.length) refreshCutRendering();
      markDirty?.();
    },

    // Debug helper: 0=normal, 1=log, 2=cap-always, 3=show-write-groups, 4=cap-depth-only
    // After calling setStencilDebug(N), call setMode("stencil") to rebuild with new mode.
    setStencilDebug(step) {
      const ctx = getStrategyCtx();
      stencilStrategy.setDebug?.(step, ctx);
      if (mode === "stencil" && enabled && targetRoots.length) {
        strategy.clear(ctx);
        strategy.apply(ctx);
      }
    },

    // ---------- piani: selezione, cursore, verso, punti tagliati (2026-10-18) ----------

    /** Piani matematici attivi (taglio acceso con target), o null: usati anche dal pass GTAO. */
    get activeClipPlanes() {
      return enabled && targetRoots.length ? getActivePlanes() : null;
    },

    /** Actor (Mesh) del piano "XY" | "XZ" | "YZ", o null. */
    getPlaneActor(id) {
      return planes.find((p) => p.id === id)?.actor ?? null;
    },

    /** true se obj è (o sta dentro) un actor dei piani di taglio. */
    isPlaneActor(obj) {
      for (let o = obj; o; o = o.parent) {
        if (o.userData?.__tjs_helper_kind__ === "clipPlane") return true;
      }
      return false;
    },

    /** id del piano ("XY"…) se obj è un actor, altrimenti null. */
    planeIdOf(obj) {
      return planes.find((p) => p.actor && p.actor === obj)?.id ?? null;
    },

    /**
     * Posizione del piano lungo la propria normale e intervallo che copre i target:
     * { min, max, value } in unità di scena (null senza target o actor).
     */
    getPlaneRange(id) {
      const p = planes.find((pp) => pp.id === id);
      if (!p?.actor || !targetRoots.length) return null;
      p.actor.getWorldPosition(_p);
      p.actor.getWorldQuaternion(_q);
      _normal.copy(_zAxis).applyQuaternion(_q).normalize();

      computeTargetsBox(_box);
      if (_box.isEmpty()) return null;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 8; i++) {
        _center.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z);
        const d = _normal.dot(_center);
        if (d < min) min = d;
        if (d > max) max = d;
      }
      const pad = 0.02 * Math.max(1e-6, max - min);
      return { min: min - pad, max: max + pad, value: _normal.dot(_p) };
    },

    /** Sposta il piano lungo la propria normale fino al valore dato (vedi getPlaneRange). */
    setPlaneOffset(id, value) {
      const p = planes.find((pp) => pp.id === id);
      const v = Number(value);
      if (!p?.actor || !Number.isFinite(v)) return;
      p.actor.getWorldPosition(_p);
      p.actor.getWorldQuaternion(_q);
      _normal.copy(_zAxis).applyQuaternion(_q).normalize();
      _p.addScaledVector(_normal, v - _normal.dot(_p));
      p.actor.parent?.worldToLocal?.(_p);
      p.actor.position.copy(_p);
      p.actor.updateMatrixWorld(true);
      updatePlanesFromActors();
      markDirty?.();
    },

    /**
     * Dati per guardare la sezione di fronte: { center, radius, dir } — center = centro dei target
     * proiettato sul piano, dir = verso la parte tolta (la camera sta lì e guarda la sezione).
     */
    getPlaneView(id) {
      const p = planes.find((pp) => pp.id === id);
      if (!p?.actor || !targetRoots.length) return null;
      updatePlanesFromActors();
      computeTargetsBox(_box);
      if (_box.isEmpty()) return null;
      const sphere = _box.getBoundingSphere(new THREE.Sphere());
      const center = new THREE.Vector3();
      p.plane.projectPoint(sphere.center, center);
      return { center, radius: sphere.radius, dir: p.plane.normal.clone().negate() };
    },

    /** Cambia il lato tenuto dal piano. */
    flipPlane(id) {
      const p = planes.find((pp) => pp.id === id);
      if (!p) return;
      p.flip = !p.flip;
      updatePlanesFromActors();
      markDirty?.();
    },

    /**
     * true se il punto colpito sta nella parte tolta dal taglio. Il raycast di three.js non
     * conosce il clipping: selezione, Collima e Misura scartano questi hit.
     * hit = { point, object } (intersezione three.js o equivalente).
     */
    isHitClipped(hit) {
      if (!enabled || !targetRoots.length || !hit?.point || !hit.object) return false;
      if (!targetClipSet.has(hit.object)) return false;
      for (const p of planes) {
        if (p.enabledForCut && p.actor && p.plane.distanceToPoint(hit.point) < -1e-6) return true;
      }
      return false;
    },

    beforeRender() {
      // Aggiorna i piani matematici dalla posizione corrente degli actor ogni frame,
      // così il clipping segue in tempo reale lo spostamento via TransformControls.
      //
      // NON chiamiamo applyClippingPlanesToTargetMaterials() qui: quella funzione
      // imposta needsUpdate=true che forza la ricompilazione dello shader ogni frame.
      // Non serve: i THREE.Plane sono oggetti mutati in place da updatePlanesFromActors(),
      // e i materiali già li referenziano tramite mat.clippingPlanes — Three.js li
      // legge direttamente a ogni render senza bisogno di needsUpdate.
      // applyClippingPlanesToTargetMaterials() viene chiamata solo quando cambia
      // quale sottoinsieme di piani è attivo (enable, setMode, toggle checkbox).
      if (enabled && targetRoots.length) {
        updatePlanesFromActors();
        // Riempimento stencil: segue posizione/orientamento dei piani mentre si trascinano
        if (mode === "stencil") {
          const ctx = getStrategyCtx();
          strategy.syncCaps?.(ctx.planeWorldPos, ctx.planeWorldQuat);
        }
      }
      strategy.beforeRender?.(renderer);
    },

    dispose() {
      // footer events
      const root = footerRoot();
      if (root) {
        root.removeEventListener("click", onFooterClick);
        root.removeEventListener("change", onFooterChange);
        root.removeEventListener("input", onFooterChange);
      }

      // cleanup rendering state
      try { strategy.clear(getStrategyCtx()); } catch {}
      restoreMaterials();

      // Rimuovi e disponi i plane actors (geometria + materiale + parent link)
      for (const p of planes) {
        if (!p.actor) continue;
        p.actor.geometry?.dispose();
        const mat = p.actor.material;
        if (Array.isArray(mat)) mat.forEach((m) => m?.dispose());
        else mat?.dispose();
        p.actor = null;
      }
      planeGroup.clear();
      try { planeGroup.parent?.remove(planeGroup); } catch {}

      enabled = false;
      targetRoots = [];
      targetMeshes = [];
      targetClipObjs = [];
      targetClipSet = new Set();
      showFooter(false);
    },
  };
}
