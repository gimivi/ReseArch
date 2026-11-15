// PJS-snap.mjs
// Snap Engine v2 – endpoint, midpoint, intersection, center(fallback)
// Geometrie in IMAGE SPACE
// Marker UI in SCREEN SPACE on root layer __ui__
import { t } from "../shared/i18n.mjs";

const STATE_KEY = "_APP_STATE_";
const SNAP_VERSION = "2026-03-07-snap-rewrite-A";

function logVersionOnce(st) {
  if (st._snapVersionLogged === SNAP_VERSION) return;
  st._snapVersionLogged = SNAP_VERSION;
  console.log("PJS-snap VERSION", SNAP_VERSION);
}

export function ensureSnapSystem(bodyEl) {
  const st = bodyEl[STATE_KEY].pjs;
  logVersionOnce(st);

  const env = st._env;
  env.workspace = env.workspace || {};
  const s = env.workspace.snap || {};
  const ui = s.ui || {};

  env.workspace.snap = {
    enabled: (typeof s.enabled === "boolean") ? s.enabled : true,
    tolerancePx: Number.isFinite(s.tolerancePx) ? s.tolerancePx : 12,
    types: {
      endpoint: (typeof s.types?.endpoint === "boolean") ? s.types.endpoint : true,
      midpoint: (typeof s.types?.midpoint === "boolean") ? s.types.midpoint : false,
      center: (typeof s.types?.center === "boolean") ? s.types.center : false,
      intersection: (typeof s.types?.intersection === "boolean") ? s.types.intersection : false
    },
    ui: {
      color: (typeof ui.color === "string") ? ui.color : "#00ffff",
      sizePx: Number.isFinite(ui.sizePx) ? ui.sizePx : 28,
      strokePx: Number.isFinite(ui.strokePx) ? ui.strokePx : 3,
      fontPx: Number.isFinite(ui.fontPx) ? ui.fontPx : 18,
      labelOffsetPx: Array.isArray(ui.labelOffsetPx) && ui.labelOffsetPx.length === 2 ? ui.labelOffsetPx : [16, -16],
      pickPointRadiusPx: Number.isFinite(ui.pickPointRadiusPx) ? ui.pickPointRadiusPx : 6,
      pickPointStrokePx: Number.isFinite(ui.pickPointStrokePx) ? ui.pickPointStrokePx : 2,
      pickPointTTLms: Number.isFinite(ui.pickPointTTLms) ? ui.pickPointTTLms : 1500
    }
  };
}

function getUISnapLayer(bodyEl) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;
  const ui = scope.project.layers.find(l => l && l.name === "__ui__");
  if (ui && !ui.removed) {
    st._uiLayer = ui;
    ui.visible = true;
    ui.locked = false;
    ui.opacity = 1;
    ui.bringToFront?.();
    return ui;
  }

  try {
    alert(t("app.pjs.snap.ui_layer_missing"));
  } catch {}
  console.error("Snap: __ui__ root layer missing in project.layers");
  return null;
}

function safeColor(scope, value, fallbackRgb = [0, 1, 1]) {
  try {
    return new scope.Color(value);
  } catch {
    return new scope.Color(fallbackRgb[0], fallbackRgb[1], fallbackRgb[2]);
  }
}

function projectToUiView(scope, imgPoint) {
  return scope.view.projectToView(imgPoint);
}



function ensureMarkerGroup(bodyEl) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;
  const ui = getUISnapLayer(bodyEl);
  if (!ui) return null;




  let g = st._snapMarker;
  if (!g || g.removed || g.parent !== ui) {
    try { g?.remove?.(); } catch {}
    g = new scope.Group({ parent: ui });
    g.data = g.data || {};
    g.data.__snapMarker = true;
    st._snapMarker = g;
    st._snapMarkerKey = null;
  }
  ui.bringToFront?.();
  return g;
}

function drawContrastedPickCircle(scope, parent, pView, rPx, strokePx) {
  const c = new scope.Path.Circle({ center: pView, radius: rPx, parent });
  c.data = c.data || {};
  c.data.__snapMarker = true;
  c.fillColor = new scope.Color(1, 1, 1);
  c.strokeColor = new scope.Color(0, 0, 0);
  c.strokeWidth = strokePx;
  return c;
}

export function snapAddConstructionPoint(bodyEl, imgPoint, { delayMs = 0 } = {}) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;

  ensureSnapSystem(bodyEl);
  const ui = getUISnapLayer(bodyEl);
  if (!ui) return null;

  st._snapConstruction = st._snapConstruction || [];

  const rPx = Number(st._env?.workspace?.snap?.ui?.pickPointRadiusPx ?? 6);
  const strokePx = Number(st._env?.workspace?.snap?.ui?.pickPointStrokePx ?? 2);

  const pView = projectToUiView(scope, imgPoint);
  const c = drawContrastedPickCircle(scope, ui, pView, rPx, strokePx);
  c.data.__constructionMark = true;
  c.data.__imgPoint = imgPoint.clone();

  ui.bringToFront?.();
  st._snapConstruction.push(c);
  scope.view.update?.();

if (delayMs > 0) {
  setTimeout(() => {
    try { c.remove(); } catch {}
    try {
      st._snapConstruction = (st._snapConstruction || []).filter(x => x !== c);
    } catch {}
    scope.view.update?.();
  }, delayMs);
}

  return c;
}

export function snapRemoveLastConstructionPoint(bodyEl) {
  const st = bodyEl[STATE_KEY]?.pjs;
  if (!st) return null;

  const scope = st.scope;
  st._snapConstruction = st._snapConstruction || [];

  if (st._snapConstruction.length === 0) return null;

  const last = st._snapConstruction.pop();

  try { last?.remove?.(); } catch {}
  scope?.view?.update?.();

  return last || null;
}



export function snapClearConstructionPoints(bodyEl, { delayMs = 0 } = {}) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;
  const arr = st._snapConstruction || [];

  const removeOne = (it) => {
    try { it?.remove?.(); } catch {}
  };

  if (delayMs > 0) {
    for (const it of arr) {
      setTimeout(() => {
        removeOne(it);
        try {
          st._snapConstruction = (st._snapConstruction || []).filter(x => x !== it);
        } catch {}
        scope.view.update?.();
      }, delayMs);
    }
    return;
  }

  st._snapConstruction = [];
  for (const it of arr) removeOne(it);
  scope.view.update?.();
}

export function snapClearMarker(bodyEl) {
  const st = bodyEl[STATE_KEY].pjs;
  if (!st._snapMarker) return;
  try { st._snapMarker.remove(); } catch {}
  st._snapMarker = null;
  st._snapMarkerKey = null;
}

export function snapAddPickPoint(bodyEl, imgPoint) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;

  ensureSnapSystem(bodyEl);
  const uiCfg = st._env.workspace.snap.ui;
  const ui = getUISnapLayer(bodyEl);
  if (!ui) return;

  const pView = projectToUiView(scope, imgPoint);

  st._snapPickGroup = st._snapPickGroup || new scope.Group({ parent: ui });
  st._snapPickGroup.data = st._snapPickGroup.data || {};
  st._snapPickGroup.data.__snapMarker = true;
  st._snapPickGroup.data.__pickGroup = true;

  const rPx = Number(uiCfg.pickPointRadiusPx || 6);
  const strokePx = Number(uiCfg.pickPointStrokePx || 2);
  const c = drawContrastedPickCircle(scope, st._snapPickGroup, pView, rPx, strokePx);
  c.data.__pickPoint = true;

  st._snapPickPoints = st._snapPickPoints || [];
  st._snapPickPoints.push(c);

  ui.bringToFront?.();
  scope.view.update?.();
}

export function snapClearPickPoints(bodyEl, { delayMs = null } = {}) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;

  ensureSnapSystem(bodyEl);
  const uiCfg = st._env.workspace.snap.ui;
  const ttl = Number.isFinite(delayMs) ? delayMs : Number(uiCfg.pickPointTTLms || 0);

  const doClear = () => {
    try {
      if (st._snapPickPoints?.length) {
        for (const it of st._snapPickPoints) {
          try { it?.remove?.(); } catch {}
        }
      }
      st._snapPickPoints = [];
      try { st._snapPickGroup?.remove?.(); } catch {}
      st._snapPickGroup = null;
    } catch {}
    scope.view.update?.();
  };

  if (ttl > 0) {
    if (st._snapPickClearTimer) {
      try { clearTimeout(st._snapPickClearTimer); } catch {}
    }
    st._snapPickClearTimer = setTimeout(() => {
      st._snapPickClearTimer = null;
      doClear();
    }, ttl);
  } else {
    doClear();
  }
}

export function snapUpdateMarker(bodyEl, snapOrPoint, mouseImgPoint = null) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;

  ensureSnapSystem(bodyEl);
  const snapCfg = st._env.workspace.snap;

  const snap = (snapOrPoint && snapOrPoint.imgPoint)
    ? snapOrPoint
    : { imgPoint: snapOrPoint, kind: "endpoint" };

  const g = ensureMarkerGroup(bodyEl);
  if (!g) return;


  const kind = snap.kind || "endpoint";
  const pView = projectToUiView(scope, snap.imgPoint);

g.data = g.data || {};
g.data.__imgPoint = snap.imgPoint.clone();
g.data.__snapKind = kind;




  // Chiave stabile: SOLO tipo + posizione snap in pixel quantizzati
  const qx = Math.round(pView.x);
  const qy = Math.round(pView.y);
  const key = `${kind}:${qx}:${qy}`;

  if (st._snapMarkerKey === key) {
    g.visible = true;
    return;
  }
  st._snapMarkerKey = key;

  g.removeChildren();
  g.visible = true;

  const colorObj = safeColor(scope, snapCfg.ui.color, [0, 1, 1]);
  const sizePx = Number(snapCfg.ui.sizePx || 28);
  const strokePx = Number(snapCfg.ui.strokePx || 3);
  const fontPx = Number(snapCfg.ui.fontPx || 18);
  const off = Array.isArray(snapCfg.ui.labelOffsetPx) ? snapCfg.ui.labelOffsetPx : [16, -16];
  const half = sizePx / 2;

  let shape = null;

  if (kind === "endpoint") {
    shape = new scope.Path.Rectangle({
      rectangle: new scope.Rectangle(pView.subtract([half, half]), [sizePx, sizePx]),
      parent: g
    });
  } else if (kind === "midpoint") {
    shape = new scope.Path({
      segments: [
        pView.add([0, -half]),
        pView.add([half, half]),
        pView.add([-half, half])
      ],
      closed: true,
      parent: g
    });
  } else if (kind === "center") {
    shape = new scope.Path.Circle({
      center: pView,
      radius: half,
      parent: g
    });
  } else if (kind === "intersection") {
    new scope.Path({
      segments: [pView.add([-half, 0]), pView.add([half, 0])],
      strokeColor: colorObj,
      strokeWidth: strokePx,
      parent: g
    });
    new scope.Path({
      segments: [pView.add([0, -half]), pView.add([0, half])],
      strokeColor: colorObj,
      strokeWidth: strokePx,
      parent: g
    });
  } else {
    shape = new scope.Path.Circle({
      center: pView,
      radius: half,
      parent: g
    });
  }

  if (shape) {
    shape.data = shape.data || {};
    shape.data.__snapMarker = true;
    shape.strokeColor = colorObj;
    shape.strokeWidth = strokePx;
    shape.fillColor = null;
  }

  const labelMap = {
    endpoint: "end",
    midpoint: "mid",
    intersection: "int",
    center: "cent"
  };

  const tag = labelMap[kind];
  if (tag) {
    const labelPos = pView.add([Number(off[0] || 16), Number(off[1] || -16)]);
    new scope.PointText({
      point: labelPos,
      content: `[${tag}]`,
      fontFamily: "monospace",
      fontSize: fontPx,
      fillColor: colorObj,
      parent: g
    });
  }

  g.bringToFront?.();
  scope.view.update?.();
}

export function snapPick(bodyEl, imgPoint, { excludeItems = [] } = {}) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;

  ensureSnapSystem(bodyEl);
  const snap = st._env.workspace.snap;
  if (!snap?.enabled) return null;

  const tolPx = Number(snap.tolerancePx || 12);
  const mouseView = scope.view.projectToView(imgPoint);

  // Converti tolleranza pixel -> project units
  const p0 = scope.view.viewToProject(mouseView);
  const p1 = scope.view.viewToProject(mouseView.add([tolPx, 0]));
  const tolProj = p0.getDistance(p1);

  function isExcluded(item) {
    if (!item) return true;
    if (excludeItems.includes(item)) return true;
    if (item.layer?.name === "__ui__") return true;
    if (item.data?.__snapMarker) return true;
    return false;
  }

  function viewDist(ptImg) {
    const v = scope.view.projectToView(ptImg);
    return Math.hypot(v.x - mouseView.x, v.y - mouseView.y);
  }

  function consider(ptImg, kind, sourceItem) {
    if (!ptImg) return null;
    const d = viewDist(ptImg);
    if (d > tolPx) return null;
    return { imgPoint: ptImg.clone(), kind, sourceItem, _d: d };
  }

  function betterOf(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (a._d <= b._d) ? a : b;
  }

  function hitAll(point, opts) {
    if (typeof scope.project.hitTestAll === "function") {
      return scope.project.hitTestAll(point, opts) || [];
    }
    const one = scope.project.hitTest(point, opts);
    return one ? [one] : [];
  }

  // =========================================================
  // 1) ENDPOINT
  // =========================================================
  if (snap.types?.endpoint) {
    let best = null;

    const hits = hitAll(imgPoint, {
      segments: true,
      stroke: false,
      fill: false,
      tolerance: tolProj
    });

    for (const h of hits) {
      if (!h?.segment) continue;
      if (isExcluded(h.item)) continue;

      const cand = consider(h.segment.point, "endpoint", h.item);
      best = betterOf(best, cand);
    }

    if (best) {
      delete best._d;
      return best;
    }
  }

  // =========================================================
  // 2) MIDPOINT
  // =========================================================
  if (snap.types?.midpoint) {
    let best = null;

    const hits = hitAll(imgPoint, {
      stroke: true,
      segments: false,
      fill: false,
      tolerance: tolProj
    });

    for (const h of hits) {
      if (!h?.location) continue;
      if (isExcluded(h.item)) continue;

      const curve = h.location.curve;
      if (!curve || typeof curve.getPointAtTime !== "function") continue;

      const mid = curve.getPointAtTime(0.5);
      const cand = consider(mid, "midpoint", h.item);
      best = betterOf(best, cand);
    }

    if (best) {
      delete best._d;
      return best;
    }
  }

  // =========================================================
  // 3) INTERSECTION
  // =========================================================
  if (snap.types?.intersection) {
    let best = null;

    const hits = hitAll(imgPoint, {
      stroke: true,
      segments: false,
      fill: false,
      tolerance: tolProj
    });

    // Considera tutte le coppie di item hittati
    const items = [];
    for (const h of hits) {
      const it = h?.item;
      if (!it) continue;
      if (isExcluded(it)) continue;
      if (typeof it.getIntersections !== "function") continue;
      if (!items.includes(it)) items.push(it);
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];

        let inters = [];
        try {
          inters = a.getIntersections(b) || [];
        } catch {
          inters = [];
        }

        for (const it of inters) {
          const pt = it?.point;
          const cand = consider(pt, "intersection", a);
          best = betterOf(best, cand);
        }
      }
    }

    if (best) {
      delete best._d;
      return best;
    }
  }

  // =========================================================
  // 4) CENTER (solo fallback finale)
  // =========================================================
  if (snap.types?.center) {
    let best = null;

    const hits = hitAll(imgPoint, {
      stroke: true,
      fill: true,
      segments: false,
      tolerance: tolProj
    });

    for (const h of hits) {
      const item = h?.item;
      if (!item) continue;
      if (isExcluded(item)) continue;

      const isShape = item.className === "Shape";
      const isTagged = !!item.data?.snapCenter;
      if (!isShape && !isTagged) continue;

      const c = item.position || item.bounds?.center;
      if (!c) continue;

      // center valido solo se il mouse è vicino alla figura
      const ref = h?.point || h?.location?.point || imgPoint;
      const d = viewDist(ref);
      if (d > tolPx) continue;

      const cand = { imgPoint: c.clone(), kind: "center", sourceItem: item, _d: d };
      best = betterOf(best, cand);
    }

    if (best) {
      delete best._d;
      return best;
    }
  }

  return null;
}
export function snapReprojectUi(bodyEl) {
  const st = bodyEl[STATE_KEY].pjs;
  const scope = st.scope;
  const ui = getUISnapLayer(bodyEl);
  if (!ui) return;

  // 1) construction points
  for (const it of (st._snapConstruction || [])) {
    const img = it?.data?.__imgPoint;
    if (!img || it.removed) continue;
    const pView = projectToUiView(scope, img);
    try { it.position = pView; } catch {}
  }

  // 2) pick points
  for (const it of (st._snapPickPoints || [])) {
    const img = it?.data?.__imgPoint;
    if (!img || it.removed) continue;
    const pView = projectToUiView(scope, img);
    try { it.position = pView; } catch {}
  }

  // 3) snap marker hover
  const g = st._snapMarker;
  if (g && !g.removed && g.data?.__imgPoint && g.data?.__snapKind) {
    // forza ridisegno al nuovo pView
    st._snapMarkerKey = null;
    snapUpdateMarker(bodyEl, {
      imgPoint: g.data.__imgPoint.clone(),
      kind: g.data.__snapKind
    });
  }

  scope.view.update?.();
}