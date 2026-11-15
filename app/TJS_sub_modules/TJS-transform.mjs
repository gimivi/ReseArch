// TJS_sub_modules/TJS-transform.mjs
// TransformControls + finestra laterale (colonna .tjs-rpanel) + keyboard + delta/base/valori assoluti
// Uses:
//  - TJS-selection.mjs (pick + multi-select + highlights)
//  - TJS-pivot.mjs     (multi-object pivot + snap-origin without moving objects)

import { TransformControls } from "three/addons/controls/TransformControls.js";
import { tjsCreateSelectionManager } from "./TJS-selection.mjs";
import { tjsCreatePivotManager } from "./TJS-pivot.mjs";
import { t, te } from "../shared/i18n.mjs";
import { panelLevel } from "../shared/ui_level.mjs";

export function tjsCreateTransformTool({
  THREE,
  scene,
  camera,
  domEl,
  orbitControls,
  selectableRoot,
  additionalPickRoots = [],   // es. [lightsRoot] — passato al selection manager
  cmdUI,                       // solo per escapeHtml: i comandi stanno nella finestra laterale
  containerEl,                 // colonna .tjs-rpanel dove montare la finestra (fallback: genitore del canvas)
  onUiChange,                  // optional: () => void — finestra aperta/chiusa o modalità cambiata (pulsanti toolbar)
  getSelectable,              // optional override for selection resolver
  gridStep = 1,
  rotStepDeg = 15,
  scaleStep = 0.1,
  escapeHtml,                 // injected from host (recommended)
  getObjLabel,                // injected label resolver (optional)
  onSelectionChanged,         // optional: (selection: Object3D[], { active, reason, hit }) => void — hit = intersezione del click o null
  onTransformChange,          // optional: () => void — l'oggetto agganciato si è mosso (gizmo, valori, piani di taglio)
  hitFilter,                  // optional: (hit) => boolean — passato alla selezione (scarta parti tagliate, …)
  keepSelectionOnEmpty,       // optional: () => boolean — clic nel vuoto non deseleziona (modalità piani)
  markDirty,                  // optional: () => void — segnala al RAF che la scena è cambiata
} = {}) {
  if (!THREE) throw new Error("[TJS-transform] THREE missing");
  if (!scene || !camera || !domEl) throw new Error("[TJS-transform] scene/camera/domEl missing");
  if (!selectableRoot) throw new Error("[TJS-transform] selectableRoot missing");

  // fallback (in caso non passi escapeHtml dal modulo ospitante)
  const esc =
    (cmdUI && typeof cmdUI.escapeHtml === "function")
      ? cmdUI.escapeHtml
      : (typeof escapeHtml === "function")
        ? escapeHtml
        : (s) =>
            String(s)
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;")
              .replaceAll("'", "&#039;");


  const labelOf =
    typeof getObjLabel === "function"
      ? getObjLabel
      : (obj, i) =>
          String(
            obj?.userData?.modelRow?.mod_name ||
              obj?.name ||
              obj?.userData?.name ||
              `Obj ${i + 1}`
          );

  // -----------------------------
  // TransformControls
  // -----------------------------
  const tc = new TransformControls(camera, domEl);
  tc.setMode("translate");
  tc.setSpace("world");

  const tcHelper = tc.getHelper ? tc.getHelper() : tc;
  if (!tcHelper || !tcHelper.isObject3D) {
    throw new Error("[TJS-transform] TransformControls helper is not an Object3D (check three version/import path).");
  }
  scene.add(tcHelper);

  // -----------------------------
  // State
  // -----------------------------
  let enabled = true;

  let space = "world";
  let mode = "translate";

  // Snap (Grid)
  let snapEnabled = false; // persistent
  let snapTemp = false;    // Shift pressed
  let snapMove = gridStep; // one decimal
  let snapRot = (rotStepDeg * Math.PI) / 180;
  let snapScale = scaleStep;

  // Gizmo state
  let gizmoEnabled = false;
  let isTransforming = false;

  // Delta relative to baseTRS captured at command activation/reset
  let baseTRS = null; // {pos, quat, scale}
  let lastDelta = { a: 0, b: 0, c: 0 };
  let pendingDelta = null;

  // Snap-to-point armed (consume next click)
  let snapPickArmed = false;

  // Cached temps
  const _tmpV3 = new THREE.Vector3();
  const _tmpQ = new THREE.Quaternion();
  const _tmpEuler = new THREE.Euler(0, 0, 0, "XYZ");
  const _tmpDQ = new THREE.Quaternion();

  // -----------------------------
  // Pivot + Selection managers
  // -----------------------------
  const pivotMgr = tjsCreatePivotManager({ THREE, selectableRoot });

  // Piani di taglio (TJS-cut-core): actor marcati userData.__tjs_helper_kind__ = "clipPlane"
  function isClipPlane(obj) {
    return obj?.userData?.__tjs_helper_kind__ === "clipPlane";
  }

  function attachedIsClipPlane() {
    return isClipPlane(getAttachObject(selMgr.selection, selMgr.active));
  }

  // Sul piano di taglio: Sposta solo lungo la normale (asse Z locale), Ruota libera, niente Scala.
  // Sugli altri oggetti: spazio scelto dall'utente e tutti gli assi.
  function applyGizmoConstraints() {
    const plane = attachedIsClipPlane();
    tc.setSpace(plane ? "local" : space);
    const onlyNormal = plane && mode === "translate";
    tc.showX = !onlyNormal;
    tc.showY = !onlyNormal;
    tc.showZ = true;
  }

  const selMgr = tjsCreateSelectionManager({
    THREE,
    scene,
    camera,
    domEl,
    selectableRoot,
    additionalPickRoots,
    getSelectable,
    isUiTarget,
    hitFilter,
    keepSelectionOnEmpty,
    onSelectionChanged: ({ selection, active, reason, hit }) => {
      // Quando cambia la selection:
      // - se gizmo attivo: rebuild pivot + attach + capture base
      // - piano di taglio selezionato da solo: gizmo subito attivo (Sposta, se era Scala)
      // - aggiorna la finestra laterale
      if (!enabled) return;

      if (!selection.length) {
        enableGizmo(false);
        updatePanel();
        onUiChange?.();
        return;
      }

      const planeOnly = selection.length === 1 && isClipPlane(selection[0]);
      if (planeOnly && mode === "scale") { mode = "translate"; tc.setMode(mode); }

      if (planeOnly && !gizmoEnabled) {
        enableGizmo(true);
      } else if (gizmoEnabled) {
        pivotMgr.rebuildPivotForSelection(selection);
        const att = pivotMgr.getAttachObject(selection, active);
        if (att) tc.attach(att);
        applyGizmoConstraints();
        captureBaseTRS(selection, active);
      }

      updatePanel();
      onUiChange?.();
      // secondo argomento: intersezione del click (punto, normale, faccia, UV), se c'è
      onSelectionChanged?.(selection, { active, reason, hit: hit ?? null });
    },
  });

  // -----------------------------
  // Snap
  // -----------------------------
  function applySnap() {
    const on = snapEnabled || snapTemp;
    if (on) {
      tc.setTranslationSnap(snapMove);
      tc.setRotationSnap(snapRot);
      tc.setScaleSnap(snapScale);
    } else {
      tc.setTranslationSnap(null);
      tc.setRotationSnap(null);
      tc.setScaleSnap(null);
    }
  }

  function setSnap(on) {
    snapEnabled = !!on;
    applySnap();
    updatePanel();
  }

  function setSnapMoveStep(step) {
    const s = Number(step);
    if (!Number.isFinite(s)) return;
    snapMove = Math.max(0, Math.round(s * 10) / 10);
    applySnap();
    updatePanel();
  }

  // -----------------------------
  // Base/Delta
  // -----------------------------
  function getAttachObject(selection, active) {
    return pivotMgr.getAttachObject(selection, active);
  }

  function captureBaseTRS(selection, active) {
    const obj = getAttachObject(selection, active);
    if (!obj) {
      baseTRS = null;
      lastDelta = { a: 0, b: 0, c: 0 };
      pendingDelta = null;
      return;
    }
    baseTRS = {
      pos: obj.position.clone(),
      quat: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    };
    lastDelta = { a: 0, b: 0, c: 0 };
    pendingDelta = null;
  }

  function computeDeltaFromBase(selection, active) {
    const obj = getAttachObject(selection, active);
    if (!obj || !baseTRS) return { a: 0, b: 0, c: 0 };

    if (mode === "translate") {
      _tmpV3.copy(obj.position).sub(baseTRS.pos);
      return { a: _tmpV3.x, b: _tmpV3.y, c: _tmpV3.z };
    }

    if (mode === "scale") {
      return {
        a: baseTRS.scale.x !== 0 ? obj.scale.x / baseTRS.scale.x : obj.scale.x,
        b: baseTRS.scale.y !== 0 ? obj.scale.y / baseTRS.scale.y : obj.scale.y,
        c: baseTRS.scale.z !== 0 ? obj.scale.z / baseTRS.scale.z : obj.scale.z,
      };
    }

    // rotate: deltaQuat = inv(base)*current
    _tmpQ.copy(baseTRS.quat).invert().multiply(obj.quaternion);
    _tmpEuler.setFromQuaternion(_tmpQ, "XYZ");
    return {
      a: THREE.MathUtils.radToDeg(_tmpEuler.x),
      b: THREE.MathUtils.radToDeg(_tmpEuler.y),
      c: THREE.MathUtils.radToDeg(_tmpEuler.z),
    };
  }

  function applyDeltaFromInputs(selection, active, delta) {
    const obj = getAttachObject(selection, active);
    if (!obj || !baseTRS) return;

    const a = Number(delta.a), b = Number(delta.b), c = Number(delta.c);
    const da = Number.isFinite(a) ? a : 0;
    const db = Number.isFinite(b) ? b : 0;
    const dc = Number.isFinite(c) ? c : 0;

    if (mode === "translate") {
      obj.position.copy(baseTRS.pos);
      obj.position.x += da;
      obj.position.y += db;
      obj.position.z += dc;
      obj.updateMatrixWorld?.(true);
      return;
    }

    if (mode === "scale") {
      obj.scale.set(
        baseTRS.scale.x * (Number.isFinite(da) && da !== 0 ? da : 1),
        baseTRS.scale.y * (Number.isFinite(db) && db !== 0 ? db : 1),
        baseTRS.scale.z * (Number.isFinite(dc) && dc !== 0 ? dc : 1)
      );
      obj.updateMatrixWorld?.(true);
      return;
    }

    // rotate deg -> quaternion
    const rx = THREE.MathUtils.degToRad(da);
    const ry = THREE.MathUtils.degToRad(db);
    const rz = THREE.MathUtils.degToRad(dc);
    _tmpDQ.setFromEuler(_tmpEuler.set(rx, ry, rz, "XYZ"));

    if (space === "local") obj.quaternion.copy(baseTRS.quat).multiply(_tmpDQ);
    else obj.quaternion.copy(_tmpDQ).multiply(baseTRS.quat);

    obj.updateMatrixWorld?.(true);
  }

  // -----------------------------
  // Pivot origin snap (hit.point)
  // -----------------------------
  function armSnapPick(on) {
    snapPickArmed = !!on;
    updatePanel();
  }

  function tryConsumeSnapPick(hitObj, hitPointWorldOrNull) {
    const selection = selMgr.selection;
    const active = selMgr.active;

    if (!snapPickArmed || !gizmoEnabled) return false;
    snapPickArmed = false;

    if (selection.length <= 1) return true; // consumed but no-op

    if (hitPointWorldOrNull && hitPointWorldOrNull.isVector3) {
      pivotMgr.setPivotWorldPositionKeepObjects(selection, hitPointWorldOrNull);
    } else if (hitObj?.getWorldPosition) {
      hitObj.getWorldPosition(_tmpV3);
      pivotMgr.setPivotWorldPositionKeepObjects(selection, _tmpV3);
    }

    const att = getAttachObject(selection, active);
    if (att) tc.attach(att);
    captureBaseTRS(selection, active);
    updatePanel();

    return true;
  }

  // Nota: per consumare snapPick devi chiamare questa API dal tuo click handler “alto livello”
  // (oppure in futuro la sposti in selection manager se vuoi).
  function setGizmoOriginFromPick(hitObj, hitPointWorldOrNull) {
    return tryConsumeSnapPick(hitObj, hitPointWorldOrNull);
  }

  // -----------------------------
  // Finestra laterale (colonna .tjs-rpanel, come Oggetti scena / Luci)
  // Aperta finché il gizmo è attivo; la X spegne il gizmo (la selezione resta).
  // -----------------------------
  let panelEl = null;
  let panelVisible = false;
  const refs = {};

  function fmt2(x) { return Number.isFinite(x) ? (Math.round(x * 100) / 100).toFixed(2) : "0.00"; }
  function fmt3(x) { return Number.isFinite(x) ? (Math.round(x * 1000) / 1000).toFixed(3) : "0.000"; }
  function fmt1(x) { return Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : "0.0"; }

  function gizmoOriginWorld(selection, active) {
    const obj = getAttachObject(selection, active);
    if (!obj) return { x: 0, y: 0, z: 0 };
    obj.getWorldPosition(_tmpV3);
    return { x: _tmpV3.x, y: _tmpV3.y, z: _tmpV3.z };
  }

  // Valori assoluti dell'oggetto agganciato al gizmo (con più oggetti: il pivot del gruppo).
  // Sposta = posizione nel mondo; Ruota = angoli dell'oggetto (°, XYZ); Scala = scala dell'oggetto.
  function readAbsolute(obj) {
    if (!obj) return { a: 0, b: 0, c: 0 };
    if (mode === "translate") {
      obj.getWorldPosition(_tmpV3);
      return { a: _tmpV3.x, b: _tmpV3.y, c: _tmpV3.z };
    }
    if (mode === "scale") return { a: obj.scale.x, b: obj.scale.y, c: obj.scale.z };
    return {
      a: THREE.MathUtils.radToDeg(obj.rotation.x),
      b: THREE.MathUtils.radToDeg(obj.rotation.y),
      c: THREE.MathUtils.radToDeg(obj.rotation.z),
    };
  }

  function applyAbsolute(obj, v) {
    if (!obj || !v) return;
    if (mode === "translate") {
      _tmpV3.set(v.a, v.b, v.c);
      obj.parent?.worldToLocal?.(_tmpV3);
      obj.position.copy(_tmpV3);
    } else if (mode === "scale") {
      // 0 schiaccia l'oggetto e rende la matrice non invertibile: si tiene il valore attuale
      obj.scale.set(v.a || obj.scale.x, v.b || obj.scale.y, v.c || obj.scale.z);
    } else {
      obj.rotation.set(
        THREE.MathUtils.degToRad(v.a),
        THREE.MathUtils.degToRad(v.b),
        THREE.MathUtils.degToRad(v.c),
        obj.rotation.order
      );
    }
    obj.updateMatrixWorld?.(true);
  }

  function modeTitle() {
    return mode === "translate" ? t("app.tjs.transform.title_translate")
      : mode === "rotate" ? t("app.tjs.transform.title_rotate")
      : t("app.tjs.transform.title_scale");
  }

  function modeIcon() {
    return mode === "translate" ? "bi-arrows-move" : mode === "rotate" ? "bi-arrow-clockwise" : "bi-aspect-ratio";
  }

  function absLabel() {
    return mode === "translate" ? t("app.tjs.transform.abs_translate")
      : mode === "rotate" ? t("app.tjs.transform.abs_rotate")
      : t("app.tjs.transform.abs_scale");
  }

  function xyzRow(prefix, step) {
    return `
      <div class="tjs-rpanel-xyz">
        ${["a", "b", "c"].map((k, i) => {
          const ax = "XYZ"[i];
          return `
          <label class="tjs-rpanel-xyz-cell">
            <span class="tjs-rpanel-xyz-ax tjs-rpanel-xyz-ax--${ax.toLowerCase()}" aria-hidden="true">${ax}</span>
            <input class="tjs-rpanel-num-input tjs-rpanel-xyz-in" type="number" step="${step}"
                   data-field="${prefix}-${k}" aria-label="${esc(prefix === "d" ? t("app.tjs.transform.delta") : t("app.tjs.transform.absolute"))} ${ax}" />
          </label>`;
        }).join("")}
      </div>`;
  }

  function buildPanel() {
    const el = document.createElement("div");
    el.className = "tjs-rpanel-item";
    el.style.display = "none";

    el.innerHTML = `
      <div class="tjs-rpanel-hdr">
        <span class="tjs-rpanel-hdr-title"><i class="bi" data-ref="icon" aria-hidden="true"></i> <span data-ref="title"></span></span>
        <div class="tjs-rpanel-hdr-btns">
          <button type="button" class="tjs-rpanel-hdr-btn" data-action="help"
                  title="${te("app.tjs.transform.help")}" aria-label="${te("app.tjs.transform.help")}">
            <i class="bi bi-question-circle" aria-hidden="true"></i>
          </button>
          <button type="button" class="tjs-rpanel-hdr-btn" data-action="close"
                  title="${te("common.close")}" aria-label="${te("common.close")}">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="tjs-rpanel-list">
        <div class="tjs-rpanel-section">
          <span style="flex:1">${te("app.tjs.transform.selected")} <span data-ref="count"></span></span>
          <button type="button" class="tjs-rpanel-hdr-btn" data-action="sel-clear"
                  title="${te("app.tjs.transform.clear_selection")}" aria-label="${te("app.tjs.transform.clear_selection")}">
            <i class="bi bi-x-circle" aria-hidden="true"></i>
          </button>
        </div>
        <div data-ref="sel" class="tjs-rpanel-xf-sel" role="listbox" aria-label="${te("app.tjs.transform.selected")}"></div>

        <div class="tjs-rpanel-section">${te("app.tjs.transform.options")}</div>
        <div class="tjs-rpanel-row">
          <button type="button" class="tjs-rpanel-tool-btn" data-action="space-toggle" data-ref="space"></button>
          <button type="button" class="tjs-rpanel-tool-btn" data-action="grid-toggle" data-ref="grid"
                  title="${te("app.tjs.transform.grid_snap")}" aria-label="${te("app.tjs.transform.grid_snap")}">
            <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
          </button>
          <input class="tjs-rpanel-num-input" type="number" min="0" step="0.1" data-field="step"
                 style="width:56px" title="${te("app.tjs.transform.grid_step")}" aria-label="${te("app.tjs.transform.grid_step")}" />
          <button type="button" class="tjs-rpanel-tool-btn" data-action="snap-pick" data-ref="snap"
                  title="${te("app.tjs.transform.snap_pick")}" aria-label="${te("app.tjs.transform.snap_pick")}">
            <i class="bi bi-lightning-fill" aria-hidden="true"></i>
          </button>
        </div>
        <div class="tjs-rpanel-row" title="${te("app.tjs.transform.origin_tip")}">
          <span class="tjs-rpanel-detail-lbl" style="min-width:0">${te("app.tjs.transform.origin")}</span>
          <span data-ref="origin" class="tjs-rpanel-name tjs-rpanel-name--ro"></span>
        </div>

        <div class="tjs-rpanel-section"><span data-ref="dlabel"></span></div>
        ${xyzRow("d", "0.01")}
        <div class="tjs-rpanel-row">
          <button type="button" class="tjs-rpanel-addbar-btn" data-action="delta-apply"
                  title="${te("app.tjs.transform.delta_apply")}">
            <i class="bi bi-check-lg" aria-hidden="true"></i><span>${te("common.apply")}</span>
          </button>
          <button type="button" class="tjs-rpanel-addbar-btn" data-action="delta-reset"
                  title="${te("app.tjs.transform.delta_reset")}">
            <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i><span>${te("app.tjs.transform.delta_reset_short")}</span>
          </button>
        </div>

        <div class="tjs-rpanel-section"><span data-ref="alabel"></span></div>
        ${xyzRow("abs", "0.01")}
        <div class="tjs-rpanel-row">
          <button type="button" class="tjs-rpanel-addbar-btn" data-action="abs-apply">
            <i class="bi bi-check-lg" aria-hidden="true"></i><span>${te("app.tjs.transform.abs_apply")}</span>
          </button>
        </div>
        <div data-ref="pivotnote" class="tjs-rpanel-xf-note">${te("app.tjs.transform.abs_pivot_note")}</div>

        <div class="tjs-rpanel-xf-note">${te("app.tjs.transform.hints")}</div>
      </div>
    `;

    el.querySelectorAll("[data-ref]").forEach((n) => { refs[n.getAttribute("data-ref")] = n; });
    el.querySelectorAll("[data-field]").forEach((n) => { refs["f:" + n.getAttribute("data-field")] = n; });

    el.addEventListener("click", onPanelClick, { signal: _panelSig });
    el.addEventListener("change", onPanelChange, { signal: _panelSig });
    el.addEventListener("input", onPanelChange, { signal: _panelSig });
    el.addEventListener("keydown", onPanelKeyDown, { signal: _panelSig });

    // Senza colonna (es. PSG) la finestra si mette da sola sul lato destro, come la colonna
    if (!containerEl) el.style.cssText += ";position:absolute;right:0;top:0;bottom:0;width:300px;z-index:4";
    (containerEl ?? domEl.parentElement)?.appendChild(el);
    return el;
  }

  function isUiTarget(target) {
    if (!(target instanceof Node)) return false;
    if (panelEl?.contains(target)) return true;
    const footerEl = cmdUI?.el?.();
    return !!(footerEl && footerEl.contains(target));
  }

  function shouldShowPanel() {
    return !!(enabled && gizmoEnabled && getAttachObject(selMgr.selection, selMgr.active));
  }

  // Scrive un valore in un campo solo se l'utente non ci sta scrivendo
  function setField(name, value) {
    const inp = refs["f:" + name];
    if (inp && document.activeElement !== inp) inp.value = value;
  }

  // Valori che cambiano mentre si trascina il gizmo
  function refreshValues() {
    if (!panelEl || !panelVisible) return;
    const selection = selMgr.selection;
    const active = selMgr.active;

    const o = gizmoOriginWorld(selection, active);
    refs.origin.textContent = `${fmt2(o.x)}, ${fmt2(o.y)}, ${fmt2(o.z)}`;

    const d = pendingDelta ?? lastDelta;
    setField("d-a", fmt2(d.a)); setField("d-b", fmt2(d.b)); setField("d-c", fmt2(d.c));

    const abs = readAbsolute(getAttachObject(selection, active));
    const f = mode === "translate" ? fmt3 : fmt2;
    setField("abs-a", f(abs.a)); setField("abs-b", f(abs.b)); setField("abs-c", f(abs.c));
  }

  function renderPanel() {
    if (!panelEl) return;
    const selection = selMgr.selection;
    const active = selMgr.active;

    refs.icon.className = `bi ${modeIcon()}`;
    refs.title.textContent = modeTitle();
    refs.count.textContent = `(${selection.length})`;

    refs.sel.innerHTML = selection.map((obj, i) => {
      const isActive = obj === active;
      return `
        <div class="tjs-rpanel-row tjs-rpanel-xf-selrow${isActive ? " is-active" : ""}" role="option"
             aria-selected="${isActive}" tabindex="0" data-action="sel-set" data-idx="${i}">
          <i class="bi ${isActive ? "bi-check2" : "bi-dot"} tjs-rpanel-type-ico" aria-hidden="true"></i>
          <span class="tjs-rpanel-name">${esc(labelOf(obj, i))}</span>
        </div>`;
    }).join("") || `<div class="tjs-rpanel-empty">${te("app.tjs.transform.no_items")}</div>`;

    const wlTitle = space === "world" ? t("app.tjs.transform.world_tip") : t("app.tjs.transform.local_tip");
    refs.space.textContent = attachedIsClipPlane() ? "L" : (space === "world" ? "W" : "L");
    refs.space.disabled = attachedIsClipPlane();   // sul piano: sempre locale (lungo la normale)
    refs.space.title = wlTitle;
    refs.space.setAttribute("aria-label", wlTitle);

    refs.grid.classList.toggle("active", !!snapEnabled);
    refs.grid.setAttribute("aria-pressed", String(!!snapEnabled));
    setField("step", fmt1(snapMove));

    const multi = selection.length > 1;
    refs.snap.disabled = !multi;
    refs.snap.classList.toggle("active", snapPickArmed);
    refs.snap.setAttribute("aria-pressed", String(snapPickArmed));

    refs.dlabel.textContent = `${t("app.tjs.transform.delta")} ${mode === "translate" ? "ΔT" : mode === "rotate" ? "ΔR°" : "ΔS"}`;
    refs.alabel.textContent = absLabel();
    refs.pivotnote.style.display = multi ? "" : "none";

    refreshValues();
  }

  // Mostra/nasconde la finestra secondo lo stato del gizmo e la aggiorna
  function updatePanel() {
    const show = shouldShowPanel();
    if (show && !panelEl) panelEl = buildPanel();

    if (show !== panelVisible) {
      panelVisible = show;
      if (panelEl) panelEl.style.display = show ? "flex" : "none";
      onUiChange?.();
    }
    if (show) renderPanel();
  }

  function readXYZ(prefix, fallback) {
    const v = ["a", "b", "c"].map((k) => parseFloat(refs[`f:${prefix}-${k}`]?.value ?? ""));
    return {
      a: Number.isFinite(v[0]) ? v[0] : fallback,
      b: Number.isFinite(v[1]) ? v[1] : fallback,
      c: Number.isFinite(v[2]) ? v[2] : fallback,
    };
  }

  function readDeltaInputs() {
    if (!panelEl) return null;
    return readXYZ("d", mode === "scale" ? 1 : 0);
  }

  function doDeltaApply() {
    const d = readDeltaInputs();
    if (!d) return;
    pendingDelta = null;
    applyDeltaFromInputs(selMgr.selection, selMgr.active, d);
    lastDelta = computeDeltaFromBase(selMgr.selection, selMgr.active);
    selMgr.updateHighlights();
    onTransformChange?.();
    markDirty?.();
    updatePanel();
  }

  function doAbsApply() {
    const obj = getAttachObject(selMgr.selection, selMgr.active);
    if (!obj || !panelEl) return;
    const cur = readAbsolute(obj);
    const v = readXYZ("abs", NaN);
    applyAbsolute(obj, {
      a: Number.isFinite(v.a) ? v.a : cur.a,
      b: Number.isFinite(v.b) ? v.b : cur.b,
      c: Number.isFinite(v.c) ? v.c : cur.c,
    });
    pendingDelta = null;
    lastDelta = computeDeltaFromBase(selMgr.selection, selMgr.active);
    selMgr.updateHighlights();
    onTransformChange?.();
    markDirty?.();
    // i campi vanno riscritti anche se hanno il fuoco
    panelEl.querySelectorAll("[data-field^='abs-'],[data-field^='d-']").forEach((n) => n.blur());
    updatePanel();
  }

  function setActiveByIndex(idx) {
    const selection = selMgr.selection;
    if (!Number.isFinite(idx) || idx < 0 || idx >= selection.length) return;
    // riselezionare un elemento già presente lo rende attivo senza cambiare l'elenco
    selMgr.selectObject(selection[idx], { add: true, silent: true, reason: "panel-set-active" });
    if (gizmoEnabled) {
      pivotMgr.rebuildPivotForSelection(selMgr.selection);
      const att = getAttachObject(selMgr.selection, selMgr.active);
      if (att) tc.attach(att);
      applyGizmoConstraints();
      captureBaseTRS(selMgr.selection, selMgr.active);
    }
    updatePanel();
  }

  function onPanelClick(ev) {
    const tgt = ev.target instanceof HTMLElement ? ev.target : null;
    const a = tgt?.closest("[data-action]");
    if (!a || a.disabled) return;
    const action = a.getAttribute("data-action");

    if (action === "close") { enableGizmo(false); return; }
    if (action === "help") { showHelp(); return; }

    if (action === "sel-clear") {
      enableGizmo(false);
      selMgr.clearSelection({ reason: "panel-clear" });
      updatePanel();
      return;
    }
    if (action === "sel-set") { setActiveByIndex(parseInt(a.getAttribute("data-idx") ?? "", 10)); return; }
    if (action === "space-toggle") { toggleSpace(); return; }
    if (action === "grid-toggle") { setSnap(!snapEnabled); return; }
    if (action === "snap-pick") {
      if (selMgr.selection.length <= 1) return;
      armSnapPick(!snapPickArmed);
      return;
    }
    if (action === "delta-reset") {
      captureBaseTRS(selMgr.selection, selMgr.active);
      updatePanel();
      return;
    }
    if (action === "delta-apply") { doDeltaApply(); return; }
    if (action === "abs-apply") { doAbsApply(); return; }
  }

  function onPanelChange(ev) {
    const tgt = ev.target instanceof HTMLElement ? ev.target : null;
    const field = tgt?.getAttribute("data-field");
    if (!field) return;

    if (field === "step") {
      const s = parseFloat(/** @type {HTMLInputElement} */ (tgt).value);
      if (Number.isFinite(s)) setSnapMoveStep(s);
      return;
    }
    if (field.startsWith("d-")) {
      const d = readDeltaInputs();
      if (d) pendingDelta = d;
    }
  }

  // Invio nei campi = Applica / Imposta; Invio o spazio su una riga della selezione = attiva
  function onPanelKeyDown(ev) {
    const tgt = ev.target instanceof HTMLElement ? ev.target : null;
    if (!tgt) return;
    const field = tgt.getAttribute("data-field");
    if (ev.key === "Enter" && field) {
      ev.preventDefault();
      if (field.startsWith("d-")) doDeltaApply();
      else if (field.startsWith("abs-")) doAbsApply();
      return;
    }
    const row = tgt.closest("[data-action='sel-set']");
    if (row && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      setActiveByIndex(parseInt(row.getAttribute("data-idx") ?? "", 10));
    }
  }

  // AbortController unico per i listener della finestra: _panelAC.abort() in dispose()
  const _panelAC = new AbortController();
  const _panelSig = _panelAC.signal;

  // -----------------------------
  // Help + keyboard
  // -----------------------------
  function showHelp() {
    const m = document.getElementById("tjsHelpModal");
    if (m && window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(m).show();
      return;
    }
    alert(t("app.tjs.transform.help_text"));
  }

  function onKeyDown(ev) {
    if (!enabled) return;
    const tag = (ev.target && ev.target.tagName) ? String(ev.target.tagName).toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if (ev.key === "Shift") {
      snapTemp = true;
      applySnap();
      updatePanel();
      return;
    }

    if (ev.key === "Escape") {
      enableGizmo(false);
      selMgr.clearSelection({ reason: "esc" });
      return;
    }

    const k = ev.key.toLowerCase();
    // Sposta/ruota/scala: strumenti in memoria, dal livello 20 come i pulsanti (_doc/arch-permessi.md §11.4)
    if ((k === "t" || k === "r" || k === "s") && panelLevel(domEl) < 20) return;
    if (k === "t") setMode("translate");
    else if (k === "r") setMode("rotate");
    else if (k === "s") setMode("scale");
    else if (k === "h") showHelp();
    else if (k === "q") toggleSpace();
  }

  function onKeyUp(ev) {
    if (ev.key === "Shift") {
      snapTemp = false;
      applySnap();
      updatePanel();
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // -----------------------------
  // TransformControls events
  // -----------------------------
  function onDraggingChanged(ev) {
    const dragging = !!ev.value;
    isTransforming = dragging;
    if (orbitControls) orbitControls.enabled = !dragging;
  }

  function onObjectChange() {
    selMgr.updateHighlights();
    lastDelta = computeDeltaFromBase(selMgr.selection, selMgr.active);
    refreshValues();
    onTransformChange?.();
    markDirty?.();
  }

  tc.addEventListener("dragging-changed", onDraggingChanged);
  tc.addEventListener("objectChange", onObjectChange);

  // -----------------------------
  // Gizmo
  // -----------------------------
  function enableGizmo(on) {
    gizmoEnabled = !!on;

    if (!gizmoEnabled) {
      isTransforming = false;
      pendingDelta = null;
      snapPickArmed = false;

      tc.detach();
      pivotMgr.clearPivot();

      baseTRS = null;
      lastDelta = { a: 0, b: 0, c: 0 };

      updatePanel();
      markDirty?.();
      return;
    }

    const selection = selMgr.selection;
    const active = selMgr.active;

    pivotMgr.rebuildPivotForSelection(selection);
    const obj = getAttachObject(selection, active);
    if (obj) tc.attach(obj);
    applyGizmoConstraints();

    captureBaseTRS(selection, active);

    // Finestra laterale: resta aperta finché il gizmo non viene disabilitato
    updatePanel();
    markDirty?.();
  }

  function setMode(m) {
    if (!m) return;
    // Scala su un piano di taglio cambierebbe solo il riquadro disegnato, non il taglio
    if (m === "scale" && attachedIsClipPlane()) return;

    // toggle off if same mode and already enabled
    if (mode === m && gizmoEnabled) {
      enableGizmo(false);
      return;
    }

    mode = m;
    tc.setMode(m);

    // markDirty e finestra gestiti internamente da enableGizmo
    if (selMgr.selection.length) enableGizmo(true);
    else updatePanel();
    onUiChange?.();
  }

  function setSpace(s) {
    space = s === "local" ? "local" : "world";
    applyGizmoConstraints();
    updatePanel();
  }

  function toggleSpace() {
    setSpace(space === "world" ? "local" : "world");
  }

  function setEnabled(on) {
    enabled = !!on;
    tc.enabled = enabled;
    selMgr.setEnabled(enabled);

    if (!enabled) {
      enableGizmo(false);
      selMgr.clearSelection({ reason: "disabled" });
    }
  }

  applySnap();
  updatePanel();

  // -----------------------------
  // PUBLIC API
  // -----------------------------
  return {
    controls: tc,
    helper: tcHelper,

    setEnabled,
    setMode,
    setSpace,
    toggleSpace,

    setSnap,
    setSnapSteps: ({ move, rotDeg, scale } = {}) => {
      if (Number.isFinite(move)) setSnapMoveStep(move);
      if (Number.isFinite(rotDeg)) snapRot = (Math.max(0, rotDeg) * Math.PI) / 180;
      if (Number.isFinite(scale)) snapScale = Math.max(0, scale);
      applySnap();
      updatePanel();
    },

    // selection passthroughs
    selectObject: (...args) => selMgr.selectObject(...args),
    clearSelection: (...args) => selMgr.clearSelection(...args),
    get selection() { return selMgr.selection; },
    get selected() { return selMgr.active; },
    get active() { return selMgr.active; },

    // gizmo + pivot helpers
    enableGizmo,
    setGizmoOriginFromPick,

    get gizmoEnabled() { return gizmoEnabled; },
    get panelVisible() { return panelVisible; },
    get attachedIsClipPlane() { return attachedIsClipPlane(); },
    refreshValues,   // riscrive i valori della finestra (es. piano spostato dal cursore del Taglio)
    get mode() { return mode; },
    get space() { return space; },
    get snapEnabled() { return snapEnabled; },

    dispose() {
      // listeners
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);

      tc.removeEventListener("dragging-changed", onDraggingChanged);
      tc.removeEventListener("objectChange", onObjectChange);

      // listener della finestra laterale (tutti rimossi via AbortController)
      _panelAC.abort();
      panelEl?.remove();
      panelEl = null;

      enableGizmo(false);

      // managers
      selMgr.dispose();
      pivotMgr.dispose();

      try { scene.remove(tcHelper); } catch {}
      try { tc.dispose?.(); } catch {}
    },
  };
}
