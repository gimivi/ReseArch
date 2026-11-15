// APP/PJS_sub_modules/PJS-tool-polygon.mjs
// CAD - regular polygon: center + radius
// Uniformato ai criteri consolidati:
// - Geometry in image space
// - Snap via PJS-snap
// - Cursor crosshair during tool
// - White construction markers on picked points
// - RMB closes command
// - Esc cancels command
// - Enter allowed but not advertised
// - Markers fade after 1500ms on finish

import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import {
  ensureSnapSystem,
  snapPick,
  snapUpdateMarker,
  snapClearMarker,
  snapAddConstructionPoint,
  snapClearConstructionPoints
} from "./PJS-snap.mjs";

export function createPolygonTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  // Cursor: pointer -> crosshair while tool active
  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor || "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

  let center = null;
  let preview = null;
  let rubber = null; // additive rubber P1-P2
  let radius = null;

  let sides = 6;
  let rotateDeg = 0;
  let inscribed = true; // true: radius to vertex; false: radius to side
  let rotateFromPointer = true;

  let committed = false;
  let cancelled = false;

  let inpSides, inpRot, chkInscribed, inpR;

  // Idle-hover snap marker before first point
  let _hoverT = null;
  let _hoverEvt = null;

  function getActiveLayerStyleAndId() {
    const env = state._env;
    const activeId = env.workspace?.defaults?.activeLayerId;
    const L = env.layers.find(x => x.id === activeId);
    return { layerId: activeId, style: (L?.style || {}) };
  }

  function applyStyle(p, style) {
    p.strokeColor = style.strokeColor || "#000000";
    p.strokeWidth = Number(style.strokeWidth || 1);
    p.dashArray = Array.isArray(style.dashArray) ? style.dashArray : [];
    p.fillColor = null;
  }

  function applyRubberStyle(p, style) {
    const sw = Number(style.strokeWidth || 1);
    const half = Math.max(0.5, sw / 2);
    p.strokeColor = style.strokeColor || "#000000";
    p.strokeWidth = half;
    const dash = Math.max(2, half * 4);
    p.dashArray = [dash, dash];
    p.fillColor = null;
  }

  function clearRubber() {
    try { rubber?.remove(); } catch {}
    rubber = null;
  }

  function updateRubber(a, b) {
    if (!a || !b) return;
    clearRubber();
    const { layerId, style } = getActiveLayerStyleAndId();
    rubber = new state.scope.Path([a, b]);
    rubber.data = { kind: "rubber", layerId, __preview: true, __rubber: true };
    applyRubberStyle(rubber, style);
  }

  function getActiveDrawingLayer() {
    const env = state._env;
    const ui = state._uiLayer;
    const activeId = env.workspace?.defaults?.activeLayerId;

    for (const L of state.scope.project.layers) {
      if (L === ui) continue;
      if (L.data?.layerId === activeId) return L;
    }

    const L = new state.scope.Layer();
    L.name = activeId || "Layer";
    L.data = L.data || {};
    L.data.layerId = activeId || "L1";
    return L;
  }

  function pickSnap(p, exclude = []) {
    if (ctx.isAltDown?.()) return null;
    return snapPick(ctx.bodyEl, p, { excludeItems: exclude });
  }

  function scheduleSnapHover(evt, excludeItems = []) {
    if (ctx.isAltDown?.()) {
      snapClearMarker(ctx.bodyEl);
      return;
    }

    _hoverEvt = evt;
    if (_hoverT) clearTimeout(_hoverT);

    _hoverT = setTimeout(() => {
      _hoverT = null;
      const e = _hoverEvt;
      _hoverEvt = null;
      if (!e) return;

      let p = e.point.clone();
      const s = pickSnap(p, excludeItems);
      if (s) snapUpdateMarker(ctx.bodyEl, s, e.point);
      else snapClearMarker(ctx.bodyEl);
    }, 70);
  }

function buildRegularPolygonPoints(c, r, n, rotRad, useCircumRadius) {
  const pts = [];
  const rr = Math.max(0.001, r);
  let R = rr;

  // Se r è il raggio al lato (apotema), ricaviamo il circumradius
  if (!useCircumRadius) {
    const cosv = Math.cos(Math.PI / n);
    if (cosv > 1e-6) R = rr / cosv;
  }

  const step = 2 * Math.PI / n;

  // Semantica corretta:
  // - useCircumRadius=true  => rotRad punta a un vertice
  // - useCircumRadius=false => rotRad punta al midpoint di un lato
  //   quindi i vertici devono essere ruotati di mezzo passo
  const base = rotRad + (useCircumRadius ? 0 : step / 2);

  for (let i = 0; i < n; i++) {
    const a = base + i * step;
    pts.push(c.add([Math.cos(a) * R, Math.sin(a) * R]));
  }

  return pts;
}


function getRubberReferencePoint(c, r, rotRad) {
  const rr = Math.max(0.001, r || 0);
  return c.add([Math.cos(rotRad) * rr, Math.sin(rotRad) * rr]);
}


function updatePreview() {
  if (!center || !radius || radius < 0.5) return;

  try { preview?.remove(); } catch {}
  preview = null;

  const n = Math.max(3, Math.min(64, Math.floor(Number(sides) || 3)));
  const rotRad = (Number(rotateDeg) || 0) * Math.PI / 180;
  const pts = buildRegularPolygonPoints(center, radius, n, rotRad, inscribed);

  const { layerId, style } = getActiveLayerStyleAndId();
  preview = new state.scope.Path(pts);
  preview.closed = true;
  preview.data = { kind: "polygon", layerId, __preview: true, snapCenter: true };
  applyStyle(preview, style);

  // Rubber coerente con la quantità misurata:
  // - vertex mode: verso il vertice
  // - side mode:   verso il midpoint del lato
  const refPt = getRubberReferencePoint(center, radius, rotRad);
  updateRubber(center, refPt);

  state.scope.view.update();
}

  function resetStateOnly() {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

    try { preview?.remove(); } catch {}
    preview = null;

    clearRubber();

    center = null;
    radius = null;
  }

  function footerStatus(status, { controls = undefined, ensureVisible = false } = {}) {
    const payload = { status, hints: undefined, controls };

    if (ensureVisible) {
      const footerEl = cmdUI.el?.();
      const visible = !!footerEl?.classList?.contains("is-visible");
      if (visible) cmdUI.update(payload);
      else cmdUI.show(payload);
      return;
    }

    cmdUI.update(payload);
  }

  function footerUpdate(extra = "") {
    if (!center) {
      footerStatus(t("app.pjs.prompt.polygon.center"));
      return;
    }

    const r = radius ?? 0;
    const msg = t("app.pjs.prompt.polygon.measure", { n: Number(sides) || 0, r: r.toFixed(1), rot: Number(rotateDeg) || 0 }) + (extra ? " • " + extra : "");
    footerStatus(msg);

    if (inpR) inpR.placeholder = inscribed ? t("app.pjs.ctrl.r_vertex") : t("app.pjs.ctrl.r_side");
    if (inpR && r > 0) inpR.value = r.toFixed(1);
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    inpSides = document.createElement("input");
    inpSides.type = "number";
    inpSides.step = "1";
    inpSides.min = "3";
    inpSides.max = "64";
    inpSides.value = String(sides);
    inpSides.style.width = "70px";
    inpSides.setAttribute("aria-label", t("app.pjs.ctrl.sides"));
    inpSides.onchange = () => {
      sides = Number(inpSides.value);
      updatePreview();
      footerUpdate();
    };

    inpRot = document.createElement("input");
    inpRot.type = "number";
    inpRot.step = "1";
    inpRot.value = String(rotateDeg);
    inpRot.style.width = "80px";
    inpRot.setAttribute("aria-label", t("app.pjs.ctrl.rotation_deg"));
    inpRot.onchange = () => {
      rotateDeg = Number(inpRot.value);
      rotateFromPointer = false;
      updatePreview();
      footerUpdate();
    };

    chkInscribed = document.createElement("input");
    chkInscribed.type = "checkbox";
    chkInscribed.checked = inscribed;
    chkInscribed.onchange = () => {
      inscribed = chkInscribed.checked;
      updatePreview();
      footerUpdate();
    };

    const lblIns = document.createElement("label");
    lblIns.style.marginLeft = "10px";
    lblIns.appendChild(chkInscribed);
    lblIns.appendChild(document.createTextNode(" " + t("app.pjs.ctrl.radius_to_vertex")));

    inpR = document.createElement("input");
    inpR.type = "number";
    inpR.step = "1";
    inpR.placeholder = "R";
    inpR.style.width = "80px";
    inpR.setAttribute("aria-label", t("app.pjs.ctrl.radius"));
    inpR.onchange = () => { applyR(); };

    const btnApplyR = document.createElement("button");
    btnApplyR.type = "button";
    btnApplyR.textContent = t("app.pjs.ctrl.apply_r");
    btnApplyR.className = "btn btn-sm";
    btnApplyR.onclick = () => applyR();

    wrap.appendChild(document.createTextNode("N: "));
    wrap.appendChild(inpSides);
    wrap.appendChild(document.createTextNode(" Rot°: "));
    wrap.appendChild(inpRot);
    wrap.appendChild(lblIns);
    wrap.appendChild(document.createTextNode("  R: "));
    wrap.appendChild(inpR);
    wrap.appendChild(btnApplyR);

    return wrap;
  }

  function applyR() {
    if (!center) return;
    const v = Number(inpR?.value);
    if (!isFinite(v) || v <= 0) return;

    radius = v;
    updatePreview();
    footerUpdate();
  }

  function cancelCommand() {
    cancelled = true;

    snapClearMarker(ctx.bodyEl);
    try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}

    resetStateOnly();

    footerClear();
    state.scope.view.update();
  }

  function commit() {
    if (!center || !radius || radius < 0.5) return;

    try { preview?.remove(); } catch {}
    preview = null;
    clearRubber();

    const n = Math.max(3, Math.min(64, Math.floor(Number(sides) || 3)));
    const rotRad = (Number(rotateDeg) || 0) * Math.PI / 180;
    const pts = buildRegularPolygonPoints(center, radius, n, rotRad, inscribed);

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = new state.scope.Path(pts);
    final.closed = true;
    final.data = { kind: "polygon", layerId, snapCenter: true };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Poligono", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per polygon center+radius, se il preview esiste si fa commit.
    if (!center || !radius || radius < 0.5) {
      footerClear();
      ctx.exitTool?.();
      return;
    }
    commit();
  }

  // CAD hooks
  ctx.setRmbClose?.(closeCommand);
  ctx.setEscCancel?.(cancelCommand);

  paperTool.onKeyDown = (event) => {
    if (event.key === "escape") {
      cancelCommand();
      return ctx.exitTool();
    }
    if (event.key === "enter") commit(); // allowed, but not advertised
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    ensureSnapSystem(ctx.bodyEl);
    state.scope.activate();
    getActiveDrawingLayer().activate();

    if (!center) {
      let p0 = event.point.clone();
      const s0 = pickSnap(p0);
      if (s0) {
        p0 = s0.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s0, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      center = p0;
      snapAddConstructionPoint(ctx.bodyEl, center);

      footerStatus(t("app.pjs.prompt.polygon.radius"), {
        controls: buildControls(),
        ensureVisible: true
      });
      footerUpdate();
      state.scope.view.update();
      return;
    }

    // second point defines radius (and, by default, rotation)
    let p1 = event.point.clone();
    const exclude = [
      ...(preview ? [preview] : []),
      ...(rubber ? [rubber] : [])
    ];
    const s1 = pickSnap(p1, exclude);
    if (s1) {
      p1 = s1.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s1, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    radius = center.getDistance(p1);

    if (rotateFromPointer) {
      rotateDeg = Math.atan2(p1.y - center.y, p1.x - center.x) * 180 / Math.PI;
      if (inpRot) inpRot.value = String(Math.round(rotateDeg));
    }

    snapAddConstructionPoint(ctx.bodyEl, p1);
    commit();
  };

  paperTool.onMouseMove = (event) => {
    if (!center) {
      scheduleSnapHover(event);
      return;
    }

    let p1 = event.point.clone();
    const exclude = [
      ...(preview ? [preview] : []),
      ...(rubber ? [rubber] : [])
    ];
    const s1 = pickSnap(p1, exclude);
    if (s1) {
      p1 = s1.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s1, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    radius = center.getDistance(p1);

    if (rotateFromPointer) {
      rotateDeg = Math.atan2(p1.y - center.y, p1.x - center.x) * 180 / Math.PI;
      if (inpRot) inpRot.value = String(Math.round(rotateDeg));
    }

    updatePreview();
    footerUpdate();
  };

  // Re-apply after manager footer init so controls are visible immediately
  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.polygon.center"), {
      controls: buildControls(),
      ensureVisible: true
    });
  }, 0);

  return () => {
    if (_cursorEl) _cursorEl.style.cursor = _prevCursor;

    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

    snapClearMarker(ctx.bodyEl);
    clearRubber();

    // Se il tool esce dopo finish corretto, NON toccare i construction points:
    // devono sparire col delay già programmato.
    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    footerClear();
  };
}