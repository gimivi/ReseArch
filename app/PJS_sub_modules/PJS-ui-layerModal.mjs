// APP/PJS_sub_modules/PJS-ui-layerModal.mjs
import { getState, setDirty } from "./PJS-core.mjs";
import { setActiveTool } from "./PJS-tools.mjs";
import { t, te } from "../shared/i18n.mjs";

/**
 * Layer Modal (table-only)
 * - live preview on envelope + Paper
 * - Cancel => rollback snapshot
 * - OK => commit label "Layer: aggiornamento" (best-effort) + dirty=true
 */

const STATE_KEY = "_APP_STATE_";

const LINE_PATTERNS = [
  { id: "continuous", get label() { return t("app.pjs.layers.lt.continuous"); }, dashArray: [] },
  { id: "dashed",     get label() { return t("app.pjs.layers.lt.dashed"); }, dashArray: [8, 6] },
  { id: "dotted",     get label() { return t("app.pjs.layers.lt.dotted"); }, dashArray: [2, 6] },
  { id: "dashdot",    get label() { return t("app.pjs.layers.lt.dashdot"); }, dashArray: [8, 4, 2, 4] },
  { id: "longdash",   get label() { return t("app.pjs.layers.lt.longdash"); }, dashArray: [14, 6] },
  { id: "shortdash",  get label() { return t("app.pjs.layers.lt.shortdash"); }, dashArray: [5, 4] },
  { id: "denseDot",   get label() { return t("app.pjs.layers.lt.densedot"); }, dashArray: [1, 3] },
  { id: "sparseDot",  get label() { return t("app.pjs.layers.lt.sparsedot"); }, dashArray: [2, 10] },
  { id: "rail",       get label() { return t("app.pjs.layers.lt.rail"); }, dashArray: [12, 4, 12, 10] },
  { id: "center",     get label() { return t("app.pjs.layers.lt.center"); }, dashArray: [18, 6, 3, 6] },
];

const POINT_TYPES = [
  { id: "cross",  get label() { return t("app.pjs.layers.pt.cross"); } },
  { id: "x",      label: "X" },
  { id: "dot",    get label() { return t("app.pjs.layers.pt.dot"); } },
  { id: "circle", get label() { return t("app.pjs.tool.circle"); } },
  { id: "square", get label() { return t("app.pjs.layers.pt.square"); } },
];

function clampInt(x, lo, hi, fallback) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  const v = n | 0;
  return Math.max(lo, Math.min(hi, v));
}

function ensureDashBase(style) {
  // Backward compat: if dashBase missing, initialize from current dashArray (assumed "base")
  if (!Array.isArray(style.dashBase)) style.dashBase = Array.isArray(style.dashArray) ? deepClone(style.dashArray) : [];
}

function recomputeDashArray(style) {
  ensureDashBase(style);
  const sLT = clampInt(style.sLT ?? style.scaleLT ?? style.lineTypeScale ?? 1, 1, 99, 1);
  style.sLT = sLT;
  style.dashArray = (style.dashBase || []).map(v => Number(v) * sLT);
}


function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Accepts: "transparent" | "#RRGGBB" | "#RRGGBBAA" and returns "#RRGGBBAA" */
function normalizeHexA(s, fallback = "#000000ff") {
  if (!s) return fallback;
  const v = String(s).trim().toLowerCase();
  if (v === "transparent") return "#00000000";

  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length === 8 && /^[0-9a-f]{8}$/.test(hex)) return "#" + hex;
    if (hex.length === 6 && /^[0-9a-f]{6}$/.test(hex)) return "#" + hex + "ff";
  }
  return fallback;
}

function hexA_to_rgba(hexA) {
  const h = normalizeHexA(hexA);
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const a = parseInt(h.slice(7, 9), 16);
  return { r, g, b, a };
}

function rgba_to_hexA({ r, g, b, a }) {
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x | 0));
  const to2 = (n) => clamp(n, 0, 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}${to2(a)}`;
}

function ensureLayerStyleNormalized(layer) {
  layer.style = layer.style || {};
  layer.style.strokeColor = normalizeHexA(layer.style.strokeColor, "#000000ff");
  layer.style.fillColor   = normalizeHexA(layer.style.fillColor, "#00000000");

  const sw = Number(layer.style.strokeWidth);
  layer.style.strokeWidth = Number.isFinite(sw) ? sw : 1;

  // Line type + dash scaling
  layer.style.lineType = layer.style.lineType || "continuous";
  layer.style.dashArray = Array.isArray(layer.style.dashArray) ? layer.style.dashArray : [];
  ensureDashBase(layer.style);
  // Ensure sLT exists and refresh effective dashArray
  recomputeDashArray(layer.style);

  // Point type + scale
  layer.style.pointType = layer.style.pointType || "cross";
  layer.style.sP = clampInt(layer.style.sP ?? layer.style.scaleP ?? layer.style.pointScale ?? 1, 1, 99, 1);
}

function getEnv(bodyEl) {
  const st = getState(bodyEl);
  return st?._env || null;
}

/** Apply env layer props to Paper layer + items (no __ui__) */
function applyLayerToPaper(bodyEl, layerId) {
  const st = getState(bodyEl);
  const env = st?._env;
  if (!st?.scope || !env) return;

  // Correzione BUg
  st.scope.activate();

  const scope = st.scope;
  const L = env.layers?.find(x => x.id === layerId);
  if (!L) return;

  ensureLayerStyleNormalized(L);

  // find paper layer by id stored in data.layerId; fallback by name
  const uiLayer = scope.project.layers.find(l => l.name === "__ui__");
  let paperLayer = scope.project.layers.find(l => l.data?.layerId === L.id);
  if (!paperLayer) {
    paperLayer = scope.project.layers.find(l => l.name === L.name && l.name !== "__ui__");
  }
  if (!paperLayer) {
    paperLayer = new scope.Layer();
    paperLayer.data = paperLayer.data || {};
    paperLayer.data.layerId = L.id;
  }

  paperLayer.name = L.name;
  paperLayer.visible = (L.visible !== false);
  paperLayer.locked = (L.locked === true);

  // style apply to items in this layer (best-effort, recursive)
  const style = L.style || {};
  const strokeColor = style.strokeColor;
  const fillColor = style.fillColor;
  const strokeWidth = Number(style.strokeWidth || 1);
  const dashArray = Array.isArray(style.dashArray) ? style.dashArray : [];

  const applyItem = (it) => {
    if (!it || it.layer?.name === "__ui__") return;

    // groups: recurse
    if (it.children && it.children.length) {
      for (const ch of it.children) applyItem(ch);
    }

    // many Paper items support these:
    if ("strokeColor" in it) it.strokeColor = strokeColor;
    if ("strokeWidth" in it) it.strokeWidth = strokeWidth;
    if ("dashArray" in it) it.dashArray = dashArray;

    // fill only where it makes sense (closed paths / shapes / compound paths)
    const isPath = (it.className === "Path" || it.className === "CompoundPath");
    const isShape = (it.className === "Shape");
    const fillable = isShape || (isPath && (it.closed === true || it.className === "CompoundPath"));
    if (fillable && ("fillColor" in it)) it.fillColor = fillColor;
  };

  for (const ch of paperLayer.children || []) applyItem(ch);

  // keep __ui__ on top
  try { uiLayer?.bringToFront?.(); } catch {}

  scope.view.update?.();
}

function syncAllLayersToPaper(bodyEl) {
  const st = getState(bodyEl);
  const env = st?._env;
  if (!st?.scope || !env?.layers) return;

  // ensure normalization
  for (const L of env.layers) ensureLayerStyleNormalized(L);

  // apply each
  for (const L of env.layers) applyLayerToPaper(bodyEl, L.id);

  // set active
  const activeId = env.workspace?.defaults?.activeLayerId;
  if (activeId) setActivePaperLayer(bodyEl, activeId);
}

function setActivePaperLayer(bodyEl, layerId) {
  const st = getState(bodyEl);
  const env = st?._env;
  if (!st?.scope || !env) return;

  // ✅ IMPORTANTISSIMO in multi-window/multi-scope
  st.scope.activate();

  env.workspace = env.workspace || {};
  env.workspace.defaults = env.workspace.defaults || {};
  env.workspace.defaults.activeLayerId = layerId;

  const scope = st.scope;

 
  // DEBUG: se vuoi capire che succede realmente
  // console.log("setActivePaperLayer", { layerId, found: !!paperLayer, layers: scope.project.layers.map(x=>({name:x.name, id:x.data?.layerId, cls:x.className})) });

// dentro setActivePaperLayer(...)
const paperLayer = scope.project.layers.find(
  l => l?.className === "Layer" && l.data?.layerId === layerId
);

// ✅ NON bloccare mai qui
try {
  if (paperLayer && paperLayer.className === "Layer") {
    // Verifica appartenenza allo stesso project (molto importante in multi-scope)
    const sameProject = (paperLayer.project === scope.project);
    if (sameProject) {
      
      //Questa pare non abbia senso
      //scope.project.activeLayer = paperLayer;
      //e mi suggerisca CGPT di scrivere questo anche se la precedente è semrpe sua
      paperLayer.activate();

    } else {
      console.warn("LayerModal: paperLayer non appartiene a questo project, skip activeLayer", {
        layerId,
        paperLayerProject: paperLayer.project,
        project: scope.project
      });
    }
  }
} catch (err) {
  console.error("LayerModal: errore impostando activeLayer (skip)", err);
}

  // ui always on top
  const uiLayer = scope.project.layers.find(l => l.name === "__ui__");
  try { uiLayer?.bringToFront?.(); } catch {}

  scope.view.update?.();
}

function layerHasObjects(bodyEl, layerId) {
  const st = getState(bodyEl);
  if (!st?.scope) return false;
  const scope = st.scope;
  const paperLayer = scope.project.layers.find(l => l.data?.layerId === layerId);
  if (!paperLayer) return false;

  // simple: any child count > 0
  // (excluding items that might be UI markers; those should never be in non-__ui__ layers anyway)
  return (paperLayer.children?.length || 0) > 0;
}

/** best-effort history commit: adapt if your history API differs */
function commitHistory(st, label) {
  const h = st?.history;
  if (!h) return;

  // try common shapes
  try {
    if (typeof h.commit === "function") { h.commit(label); return; }
    if (typeof h.push === "function")   { h.push({ label }); return; }
    if (typeof h.pushSnapshot === "function") { h.pushSnapshot({ label }); return; }
  } catch {}
}

function makeModalShell(title, id) {
  const wrap = document.createElement("div");
  wrap.className = "modal fade";
  wrap.id = id;
  wrap.tabIndex = -1;
  wrap.setAttribute("aria-labelledby", `${id}_title`);
  wrap.innerHTML = `
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-centered">
    <div class="modal-content bg-body text-body">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="${id}_title">${title}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${te("common.close")}"></button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer py-2"></div>
    </div>
  </div>`;
  return wrap;
}

function iconBtn(html, title) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn-sm btn-outline-secondary";
  b.title = title || "";
  if (title) b.setAttribute("aria-label", title);
  b.innerHTML = html.replace("<i ", "<i aria-hidden=\"true\" ");
  return b;
}

function colorCellEl(strokeHexA, fillHexA) {
  const el = document.createElement("div");
  el.style.width = "18px";
  el.style.height = "18px";
  el.style.borderRadius = "2px";
  el.style.border = `2px solid ${normalizeHexA(strokeHexA).slice(0,7)}`; // border uses RGB
  // background uses RGBA via CSS (hexA ok in modern browsers, but safer: rgba())
  const f = hexA_to_rgba(fillHexA);
  el.style.background = `rgba(${f.r},${f.g},${f.b},${(f.a/255).toFixed(3)})`;
  el.style.cursor = "pointer";
  return el;
}

function linePreviewEl(strokeHexA, strokeWidth, dashArray, opts = {}) {
  const w = Math.max(40, Number(opts.w ?? 60));
  const h = Math.max(12, Number(opts.h ?? 16));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.style.cursor = "pointer";
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "2");
  line.setAttribute("y1", String(Math.round(h / 2)));
  line.setAttribute("x2", String(Math.max(4, w - 2)));
  line.setAttribute("y2", String(Math.round(h / 2)));
  line.setAttribute("stroke", normalizeHexA(strokeHexA).slice(0,7));
  line.setAttribute("stroke-width", String(Math.max(1, Math.min(6, strokeWidth || 1))));
  if (dashArray && dashArray.length) line.setAttribute("stroke-dasharray", dashArray.join(","));
  svg.appendChild(line);
  return svg;
}

function pointPreviewEl(pointType, scale = 1, opts = {}) {
  const w = Math.max(40, Number(opts.w ?? 80));
  const h = Math.max(40, Number(opts.h ?? 80));
  const s = clampInt(scale, 1, 99, 1);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  const cx = w / 2;
  const cy = h / 2;
  const base = 10; // base size ("10x10" concettuale)
  const sz = base * s;
  const half = sz / 2;

  const mkLine = (x1, y1, x2, y2) => {
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
    ln.setAttribute("x1", String(x1));
    ln.setAttribute("y1", String(y1));
    ln.setAttribute("x2", String(x2));
    ln.setAttribute("y2", String(y2));
    ln.setAttribute("stroke", "#000");
    ln.setAttribute("stroke-width", "2");
    ln.setAttribute("stroke-linecap", "square");
    return ln;
  };

  const mkCircle = (r, fill = "none") => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(r));
    c.setAttribute("stroke", "#000");
    c.setAttribute("stroke-width", "2");
    c.setAttribute("fill", fill);
    return c;
  };

  const mkRect = (r, fill = "none") => {
    const rc = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rc.setAttribute("x", String(cx - r));
    rc.setAttribute("y", String(cy - r));
    rc.setAttribute("width", String(r * 2));
    rc.setAttribute("height", String(r * 2));
    rc.setAttribute("stroke", "#000");
    rc.setAttribute("stroke-width", "2");
    rc.setAttribute("fill", fill);
    return rc;
  };

  switch (String(pointType || "cross")) {
    case "x":
      svg.appendChild(mkLine(cx - half, cy - half, cx + half, cy + half));
      svg.appendChild(mkLine(cx - half, cy + half, cx + half, cy - half));
      break;
    case "dot":
      svg.appendChild(mkCircle(Math.max(2, sz * 0.12), "#000"));
      break;
    case "circle":
      svg.appendChild(mkCircle(Math.max(4, sz * 0.25), "none"));
      break;
    case "square":
      svg.appendChild(mkRect(Math.max(4, sz * 0.25), "none"));
      break;
    case "cross":
    default:
      svg.appendChild(mkLine(cx - half, cy, cx + half, cy));
      svg.appendChild(mkLine(cx, cy - half, cx, cy + half));
      break;
  }

  return svg;
}

function openBootstrapModal(el) {
  document.body.appendChild(el);
  const m = new bootstrap.Modal(el, { backdrop: "static", keyboard: false });
  m.show();
  return m;
}

export async function openLayerModal({ panel, headerEl, bodyEl } = {}) {
  const st = getState(bodyEl);
  if (!st?._env) throw new Error("LayerModal: env non caricato (nessun disegno aperto?)");

  const cmdUI = bodyEl?.[STATE_KEY]?.cmdUI || null;

  // stop tool (gestionale)
  try { setActiveTool(bodyEl, "navigate", { cmdUI }); } catch {}

  // snapshot for rollback
  const env = st._env;
  const snap0 = {
    layers: deepClone(env.layers || []),
    activeLayerId: env.workspace?.defaults?.activeLayerId || null,
  };

  // normalize existing on open (compat)
  env.layers = env.layers || [];
  for (const L of env.layers) ensureLayerStyleNormalized(L);
  if (snap0.activeLayerId && !env.layers.find(l => l.id === snap0.activeLayerId)) {
    env.workspace = env.workspace || {};
    env.workspace.defaults = env.workspace.defaults || {};
    env.workspace.defaults.activeLayerId = env.layers[0]?.id || null;
  }
  syncAllLayersToPaper(bodyEl);

  const modalId = `layerModal_${st.winId || crypto.randomUUID()}`;
  const modalEl = makeModalShell(te("app.pjs.layers.manage"), modalId);
  const body = modalEl.querySelector(".modal-body");
  const foot = modalEl.querySelector(".modal-footer");

  // table
  const table = document.createElement("table");
  table.className = "table table-sm align-middle mb-0";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:40px"><span aria-hidden="true">●</span><span class="visually-hidden">${te("app.pjs.layers.col_active")}</span></th>
        <th style="width:50px" title="${te("app.pjs.layers.visible")}">${te("app.pjs.layers.col_on")}</th>
        <th style="width:60px" title="${te("app.pjs.layers.locked")}">${te("app.pjs.layers.col_lock")}</th>
        <th>${te("common.name")}</th>
        <th style="width:70px" title="${te("app.pjs.layers.col_fb_title")}">FB</th>
        <th style="width:225px" title="${te("app.pjs.layers.col_lt_title")}">LT</th>
        <th style="width:70px" title="${te("app.pjs.layers.col_pt_title")}">PT</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  body.appendChild(table);

  // footer buttons
  const left = document.createElement("div");
  left.className = "me-auto d-flex gap-2";

  const bNew = iconBtn(`<i class="bi bi-plus-lg"></i>`, t("common.new"));
  const bDup = iconBtn(`<i class="bi bi-files"></i>`, t("common.duplicate"));
  const bDel = iconBtn(`<i class="bi bi-trash"></i>`, t("common.delete"));
  const bUp  = iconBtn(`<i class="bi bi-arrow-up"></i>`, t("app.pjs.layers.up"));
  const bDn  = iconBtn(`<i class="bi bi-arrow-down"></i>`, t("app.pjs.layers.down"));

  left.append(bNew, bDup, bDel, bUp, bDn);

  const bCancel = document.createElement("button");
  bCancel.type = "button";
  bCancel.className = "btn btn-sm btn-outline-secondary";
  bCancel.textContent = t("common.cancel");

  const bOk = document.createElement("button");
  bOk.type = "button";
  bOk.className = "btn btn-sm btn-primary";
  bOk.textContent = t("common.ok");

  foot.append(left, bCancel, bOk);

  let selectedId = env.workspace?.defaults?.activeLayerId || env.layers[0]?.id || null;

  function render() {
    tbody.innerHTML = "";
    const activeId = env.workspace?.defaults?.activeLayerId;

    for (const L of env.layers) {
      ensureLayerStyleNormalized(L);

      const tr = document.createElement("tr");
      tr.dataset.layerId = L.id;
      if (L.id === selectedId) tr.classList.add("table-active");

      // active
      const tdA = document.createElement("td");
      tdA.style.cursor = "pointer";
      tdA.innerHTML = (L.id === activeId) ? `<span class="fw-bold">●</span>` : `<span class="text-muted">○</span>`;
      tdA.title = t("app.pjs.layers.set_active");

      // visible
      const tdV = document.createElement("td");
      tdV.style.cursor = "pointer";
      const vis = (L.visible !== false);
      tdV.innerHTML = vis ? `<i class="bi bi-eye"></i>` : `<i class="bi bi-eye-slash text-muted"></i>`;
      tdV.title = t("app.pjs.layers.visible");

      // locked
      const tdL = document.createElement("td");
      tdL.style.cursor = "pointer";
      const lk = (L.locked === true);
      tdL.innerHTML = lk ? `<i class="bi bi-lock-fill"></i>` : `<i class="bi bi-unlock text-muted"></i>`;
      tdL.title = t("app.pjs.layers.locked");

      // name
      const tdN = document.createElement("td");
      tdN.textContent = L.name || L.id;
      tdN.title = t("app.pjs.layers.dblclick_rename");
      tdN.style.cursor = "text";

      // FB (Foreground/Background)
      const tdFB = document.createElement("td");
      const sw = colorCellEl(L.style.strokeColor, L.style.fillColor);
      sw.title = t("app.pjs.layers.click_colors");
      tdFB.appendChild(sw);

      // LT (line type)
      const tdLT = document.createElement("td");
      // LT preview più ampia (≈ 2.5x), per rimpiazzare lo spazio di LT/W/s.LT
      const pv = linePreviewEl(L.style.strokeColor, L.style.strokeWidth, L.style.dashArray, { w: 210, h: 16 });
      pv.title = t("app.pjs.layers.click_lt");
      tdLT.appendChild(pv);

      // PT (point type) + preview (non scalata)
      const tdPT = document.createElement("td");
      tdPT.style.cursor = "pointer";
      tdPT.title = t("app.pjs.layers.click_pt");

      const ptId = String(L.style.pointType || "cross");
      const ptLbl = (POINT_TYPES.find(x => x.id === ptId)?.label) || ptId;

      const pvPT = pointPreviewEl(ptId, 1, { w: 52, h: 28 });
      pvPT.style.width = "52px";
      pvPT.style.height = "28px";
      pvPT.style.cursor = "pointer";

      const lblPT = document.createElement("div");
      lblPT.textContent = ptLbl;
      lblPT.style.fontSize = "0.85rem";

      const wrapPT = document.createElement("div");
      wrapPT.className = "d-flex align-items-center gap-2";
      wrapPT.append(pvPT, lblPT);

      tdPT.appendChild(wrapPT);

      tr.append(tdA, tdV, tdL, tdN, tdFB, tdLT, tdPT);
      tbody.appendChild(tr);

   
// events
tdA.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  selectedId = L.id;
  setActivePaperLayer(bodyEl, L.id);
  render();
});

tdV.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  L.visible = !(L.visible !== false);
  applyLayerToPaper(bodyEl, L.id);
  render();
});

tdL.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  L.locked = !(L.locked === true);
  applyLayerToPaper(bodyEl, L.id);
  render();
});

tr.addEventListener("click", (e) => {
  // qui NON fermiamo la propagazione: è il click "generale" per selezionare riga
  selectedId = L.id;
  render();
});

tdN.addEventListener("dblclick", (e) => {
  e.preventDefault();
  e.stopPropagation();
  startInlineRename(tdN, L);
});


sw.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  openColorModalFor(L, render, bodyEl);
});

pv.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  openLineTypeModalFor(L, render, bodyEl);
});

tdPT.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  openPointTypeModalFor(L, render, bodyEl);
});
    }

    // enable/disable move buttons
    const idx = env.layers.findIndex(x => x.id === selectedId);
    bUp.disabled = idx <= 0;
    bDn.disabled = idx < 0 || idx >= env.layers.length - 1;
    bDel.disabled = env.layers.length <= 1;
  }

  function startInlineRename(td, layer) {
    const old = layer.name || "";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.setAttribute("aria-label", t("common.name"));
    inp.className = "form-control form-control-sm";
    inp.value = old;
    td.innerHTML = "";
    td.appendChild(inp);
inp.addEventListener("click", (e) => e.stopPropagation());

    inp.focus();
    inp.select();

    const done = (commit) => {
      const v = inp.value.trim();
      td.innerHTML = "";
      if (commit && v) layer.name = v;
      td.textContent = layer.name || layer.id;
      applyLayerToPaper(bodyEl, layer.id);
      render();
    };

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      if (e.key === "Escape") { e.preventDefault(); done(false); }
    });
    inp.addEventListener("blur", () => done(true));
  }

  function startInlineWidth(td, layer) {
    const old = Number(layer.style.strokeWidth || 1) | 0;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "1";
    inp.max = "99";
    inp.step = "1";
    inp.className = "form-control form-control-sm";
    inp.value = String(Math.max(1, Math.min(99, old)));
    td.innerHTML = "";
    td.appendChild(inp);
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.focus();
    inp.select();

    const done = (commit) => {
      let v = old;
      if (commit) {
        const n = Number(inp.value);
        v = Number.isFinite(n) ? Math.max(1, Math.min(99, n | 0)) : old;
        layer.style.strokeWidth = v;
      }
      td.innerHTML = "";
      td.textContent = String(layer.style.strokeWidth | 0).padStart(2, "0");
      applyLayerToPaper(bodyEl, layer.id);
      render();
    };

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      if (e.key === "Escape") { e.preventDefault(); done(false); }
    });
    inp.addEventListener("blur", () => done(true));
  }

  function startInlineScaleLT(td, layer) {
    const old = clampInt(layer.style.sLT, 1, 99, 1);
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "1";
    inp.max = "99";
    inp.step = "1";
    inp.className = "form-control form-control-sm";
    inp.value = String(old);
    td.innerHTML = "";
    td.appendChild(inp);
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.focus();
    inp.select();

    const done = (commit) => {
      let v = old;
      if (commit) {
        v = clampInt(inp.value, 1, 99, old);
        layer.style.sLT = v;
        recomputeDashArray(layer.style);
      }
      td.innerHTML = "";
      td.textContent = String(clampInt(layer.style.sLT, 1, 99, 1)).padStart(2, "0");
      applyLayerToPaper(bodyEl, layer.id);
      render();
    };

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      if (e.key === "Escape") { e.preventDefault(); done(false); }
    });
    inp.addEventListener("blur", () => done(true));
  }

  function startInlineScaleP(td, layer) {
    const old = clampInt(layer.style.sP, 1, 99, 1);
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "1";
    inp.max = "99";
    inp.step = "1";
    inp.className = "form-control form-control-sm";
    inp.value = String(old);
    td.innerHTML = "";
    td.appendChild(inp);
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.focus();
    inp.select();

    const done = (commit) => {
      let v = old;
      if (commit) {
        v = clampInt(inp.value, 1, 99, old);
        layer.style.sP = v;
      }
      td.innerHTML = "";
      td.textContent = String(clampInt(layer.style.sP, 1, 99, 1)).padStart(2, "0");
      applyLayerToPaper(bodyEl, layer.id);
      render();
    };

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      if (e.key === "Escape") { e.preventDefault(); done(false); }
    });
    inp.addEventListener("blur", () => done(true));
  }

  // footer button logic
  bNew.addEventListener("click", () => {
    const id = `L${Date.now().toString(36)}`;
    const nl = {
      id,
      name: `Layer ${String(env.layers.length + 1).padStart(2, "0")}`,
      visible: true,
      locked: false,
      style: {
        strokeColor: "#000000ff",
        fillColor: "#00000000",
        strokeWidth: 1,
        lineType: "continuous",
        dashBase: [],
        sLT: 1,
        dashArray: [],
        pointType: "cross",
        sP: 1,
      }
    };
    env.layers.push(nl);
    selectedId = nl.id;
    applyLayerToPaper(bodyEl, nl.id);
    setActivePaperLayer(bodyEl, nl.id);
    render();
  });

  bDup.addEventListener("click", () => {
    const src = env.layers.find(x => x.id === selectedId);
    if (!src) return;
    const id = `L${Date.now().toString(36)}`;
    const cp = deepClone(src);
    cp.id = id;
    cp.name = `${src.name || src.id} (copy)`;
    env.layers.push(cp);
    selectedId = id;
    applyLayerToPaper(bodyEl, id);
    render();
  });

  bDel.addEventListener("click", () => {
    const idx = env.layers.findIndex(x => x.id === selectedId);
    if (idx < 0) return;
    if (env.layers.length <= 1) return;

    // confirm if has objects (simple check)
    const hasObj = layerHasObjects(bodyEl, selectedId);
    if (hasObj) {
      const ok = window.confirm(t("app.pjs.layers.confirm_delete_nonempty"));
      if (!ok) return;
    }

    const wasActive = env.workspace?.defaults?.activeLayerId === selectedId;
    env.layers.splice(idx, 1);

    // choose new selected
    selectedId = env.layers[Math.max(0, idx - 1)]?.id || env.layers[0]?.id || null;
    if (wasActive && selectedId) setActivePaperLayer(bodyEl, selectedId);

    // note: paper layer cleanup (optional). We'll just hide it for now if exists.
    try {
      const pl = st.scope.project.layers.find(l => l.data?.layerId === snap0.activeLayerId);
      // no-op; real cleanup requires knowing if items moved; we keep it simple here
    } catch {}

    syncAllLayersToPaper(bodyEl);
    render();
  });

  bUp.addEventListener("click", () => {
    const idx = env.layers.findIndex(x => x.id === selectedId);
    if (idx <= 0) return;
    const tmp = env.layers[idx - 1];
    env.layers[idx - 1] = env.layers[idx];
    env.layers[idx] = tmp;
    // reorder Paper layers could be added later; for now just re-apply
    syncAllLayersToPaper(bodyEl);
    render();
  });

  bDn.addEventListener("click", () => {
    const idx = env.layers.findIndex(x => x.id === selectedId);
    if (idx < 0 || idx >= env.layers.length - 1) return;
    const tmp = env.layers[idx + 1];
    env.layers[idx + 1] = env.layers[idx];
    env.layers[idx] = tmp;
    syncAllLayersToPaper(bodyEl);
    render();
  });

  const m = openBootstrapModal(modalEl);

  bCancel.addEventListener("click", () => {
    // rollback snapshot
    env.layers = deepClone(snap0.layers);
    env.workspace = env.workspace || {};
    env.workspace.defaults = env.workspace.defaults || {};
    env.workspace.defaults.activeLayerId = snap0.activeLayerId;

    // normalize + sync
    for (const L of env.layers) ensureLayerStyleNormalized(L);
    syncAllLayersToPaper(bodyEl);

    m.hide();
  });

  bOk.addEventListener("click", () => {
    // normalize final + apply
    for (const L of env.layers) ensureLayerStyleNormalized(L);
    syncAllLayersToPaper(bodyEl);

    setDirty(bodyEl, true);
    commitHistory(st, "Layer: aggiornamento");
    m.hide();
  });

  modalEl.addEventListener("hidden.bs.modal", () => {
    try { modalEl.remove(); } catch {}
  });

  // initial render
  render();

  // footer hint (optional)
  cmdUI?.update?.({ status: t("app.pjs.layers.manage"), hints: t("app.pjs.layers.hint") });
}

/* --------------------- Sub-modals --------------------- */

function openColorModalFor(layer, refresh, bodyEl) {
  const st = getState(bodyEl);
  const modalId = `colorModal_${layer.id}_${Date.now()}`;
  const modalEl = makeModalShell(te("app.pjs.layers.colors"), modalId);
  const body = modalEl.querySelector(".modal-body");
  const foot = modalEl.querySelector(".modal-footer");

  const snap = {
    strokeColor: layer.style.strokeColor,
    fillColor: layer.style.fillColor,
  };

  const sec = document.createElement("div");
  sec.className = "d-flex gap-3";

  function mkColorBlock(title, getHex, setHex) {
    const wrap = document.createElement("div");
    wrap.className = "flex-fill border rounded p-2";

    const h = document.createElement("div");
    h.className = "fw-semibold mb-2";
    h.textContent = title;

    const preview = document.createElement("div");
    preview.style.width = "100%";
    preview.style.height = "36px";
    preview.style.borderRadius = "4px";
    preview.style.border = "1px solid rgba(0,0,0,.2)";
    preview.className = "mb-2";

    const hexInp = document.createElement("input");
    hexInp.type = "text";
    hexInp.className = "form-control form-control-sm mb-2";
    hexInp.placeholder = "#00000000 … #ffffffff";
    hexInp.setAttribute("aria-label", t("app.pjs.layers.hex"));

    const { rS, gS, bS, aS, rI, gI, bI, aI } = mkRGBAControls();

    function syncUI(fromHex = null) {
      const hx = normalizeHexA(fromHex ?? getHex());
      const rgba = hexA_to_rgba(hx);
      hexInp.value = hx;

      rS.value = rgba.r; gS.value = rgba.g; bS.value = rgba.b; aS.value = rgba.a;
      rI.value = rgba.r; gI.value = rgba.g; bI.value = rgba.b; aI.value = rgba.a;

      preview.style.background = `rgba(${rgba.r},${rgba.g},${rgba.b},${(rgba.a/255).toFixed(3)})`;
    }

    function applyFromRGBA() {
      const rgba = {
        r: Number(rS.value), g: Number(gS.value), b: Number(bS.value), a: Number(aS.value)
      };
      const hx = rgba_to_hexA(rgba);
      setHex(hx);
      syncUI(hx);
      applyLayerToPaper(bodyEl, layer.id);
      refresh();
    }

    function applyFromHEX() {
      const hx = normalizeHexA(hexInp.value, getHex());
      setHex(hx);
      syncUI(hx);
      applyLayerToPaper(bodyEl, layer.id);
      refresh();
    }

    hexInp.addEventListener("input", applyFromHEX);

    for (const el of [rS, gS, bS, aS, rI, gI, bI, aI]) {
      el.addEventListener("input", () => {
        // mirror slider<->input
        rS.value = rI.value = String(Number(rS.value || rI.value));
        gS.value = gI.value = String(Number(gS.value || gI.value));
        bS.value = bI.value = String(Number(bS.value || bI.value));
        aS.value = aI.value = String(Number(aS.value || aI.value));
        applyFromRGBA();
      });
    }

    wrap.append(h, preview, hexInp, rS, rI, gS, gI, bS, bI, aS, aI);
    syncUI();
    return wrap;
  }

  sec.append(
    mkColorBlock(t("app.pjs.layers.fg"), () => layer.style.strokeColor, (v) => layer.style.strokeColor = v),
    mkColorBlock(t("app.pjs.layers.bg"), () => layer.style.fillColor,   (v) => layer.style.fillColor = v),
  );

  body.appendChild(sec);

  const bCancel = document.createElement("button");
  bCancel.className = "btn btn-sm btn-outline-secondary";
  bCancel.textContent = t("common.cancel");

  const bOk = document.createElement("button");
  bOk.className = "btn btn-sm btn-primary";
  bOk.textContent = t("common.ok");

  foot.append(bCancel, bOk);

  const m = openBootstrapModal(modalEl);

  bCancel.addEventListener("click", () => {
    layer.style.strokeColor = snap.strokeColor;
    layer.style.fillColor = snap.fillColor;
    applyLayerToPaper(bodyEl, layer.id);
    refresh();
    m.hide();
  });
  bOk.addEventListener("click", () => m.hide());

  modalEl.addEventListener("hidden.bs.modal", () => {
    try { modalEl.remove(); } catch {}
  });
}

function mkRGBAControls() {
  const mkS = (label) => {
    const s = document.createElement("input");
    s.type = "range";
    s.min = "0"; s.max = "255"; s.step = "1";
    s.className = "form-range my-1";
    s.title = label;
    s.setAttribute("aria-label", label);
    return s;
  };
  const mkI = (label) => {
    const i = document.createElement("input");
    i.type = "number";
    i.min = "0"; i.max = "255"; i.step = "1";
    i.className = "form-control form-control-sm mb-1";
    i.title = label;
    i.setAttribute("aria-label", label);
    return i;
  };
  return {
    rS: mkS("R"), rI: mkI("R"),
    gS: mkS("G"), gI: mkI("G"),
    bS: mkS("B"), bI: mkI("B"),
    aS: mkS("A"), aI: mkI("A"),
  };
}

function openLineTypeModalFor(layer, refresh, bodyEl) {
  const snap = deepClone({
    dashBase: layer.style.dashBase,
    dashArray: layer.style.dashArray,
    lineType: layer.style.lineType,
    sLT: layer.style.sLT,
    strokeWidth: layer.style.strokeWidth,
  });

  const modalId = `lineModal_${layer.id}_${Date.now()}`;
  const modalEl = makeModalShell(te("app.pjs.layers.line_type"), modalId);
  const body = modalEl.querySelector(".modal-body");
  const foot = modalEl.querySelector(".modal-footer");

  // Controls sopra la lista: Width + LineTypeScale + preview ampia
  const controls = document.createElement("div");
  controls.className = "d-flex flex-column gap-2 mb-3";

  const row = document.createElement("div");
  row.className = "d-flex align-items-end gap-3 flex-wrap";

  const wWrap = document.createElement("div");
  wWrap.className = "d-flex flex-column";
  const wLbl = document.createElement("div");
  wLbl.className = "small text-muted";
  wLbl.textContent = t("app.pjs.layers.width");
  const wIn = document.createElement("input");
  wIn.type = "number";
  wIn.min = "1";
  wIn.max = "99";
  wIn.step = "1";
  wIn.className = "form-control form-control-sm";
  wIn.style.width = "90px";
  wIn.value = String(clampInt(layer.style.strokeWidth, 1, 99, 1));
  wWrap.append(wLbl, wIn);

  const sWrap = document.createElement("div");
  sWrap.className = "d-flex flex-column";
  const sLbl = document.createElement("div");
  sLbl.className = "small text-muted";
  sLbl.textContent = t("app.pjs.layers.lt_scale");
  const sIn = document.createElement("input");
  sIn.type = "number";
  sIn.min = "1";
  sIn.max = "99";
  sIn.step = "1";
  sIn.className = "form-control form-control-sm";
  sIn.style.width = "140px";
  sIn.value = String(clampInt(layer.style.sLT, 1, 99, 1));
  sWrap.append(sLbl, sIn);

  row.append(wWrap, sWrap);

  const bigPvWrap = document.createElement("div");
  bigPvWrap.className = "w-100";
  let bigPvEl = linePreviewEl(layer.style.strokeColor, layer.style.strokeWidth, layer.style.dashArray, { w: 520, h: 22 });
  bigPvEl.style.width = "100%";
  bigPvEl.style.height = "22px";
  bigPvEl.style.cursor = "default";
  bigPvWrap.appendChild(bigPvEl);

  controls.append(row, bigPvWrap);

  const list = document.createElement("div");
  list.className = "list-group";

  let selected = null;

  const rowPreviews = [];

  function refreshPreviews() {
    // recompute effective dash and refresh all previews
    recomputeDashArray(layer.style);
    applyLayerToPaper(bodyEl, layer.id);
    refresh();

    // big preview
    try {
      const fresh = linePreviewEl(layer.style.strokeColor, layer.style.strokeWidth, layer.style.dashArray, { w: 520, h: 22 });
      fresh.style.width = "100%";
      fresh.style.height = "22px";
      fresh.style.cursor = "default";
      bigPvEl.replaceWith(fresh);
      bigPvEl = fresh;
    } catch {}

    // list previews (each shows that pattern * current sLT)
    const sLT = clampInt(layer.style.sLT, 1, 99, 1);
    const sw = clampInt(layer.style.strokeWidth, 1, 99, 1);
    for (const { el, pat } of rowPreviews) {
      const scaled = (pat.dashArray || []).map(v => Number(v) * sLT);
      const fresh = linePreviewEl(layer.style.strokeColor, sw, scaled, { w: 320, h: 18 });
      fresh.style.width = "100%";
      fresh.style.height = "18px";
      el.replaceWith(fresh);
      // update stored element reference
      rowPreviews[rowPreviews.findIndex(x => x.pat.id === pat.id)].el = fresh;
    }
  }

  // live change: width / scale
  wIn.addEventListener("input", () => {
    layer.style.strokeWidth = clampInt(wIn.value, 1, 99, 1);
    refreshPreviews();
  });
  sIn.addEventListener("input", () => {
    layer.style.sLT = clampInt(sIn.value, 1, 99, 1);
    refreshPreviews();
  });

  for (const p of LINE_PATTERNS) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "list-group-item list-group-item-action d-flex align-items-center gap-3";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "dashPattern";
    radio.className = "form-check-input";
    const same = JSON.stringify(layer.style.dashBase || []) === JSON.stringify(p.dashArray || []);
    radio.checked = same;
    if (same) selected = p;

    const lbl = document.createElement("div");
    lbl.textContent = p.label;
    lbl.style.minWidth = "140px";

    const sLT = clampInt(layer.style.sLT, 1, 99, 1);
    const scaled = (p.dashArray || []).map(v => Number(v) * sLT);
    const pv = linePreviewEl(layer.style.strokeColor, layer.style.strokeWidth, scaled, { w: 320, h: 18 });
    pv.style.width = "100%";
    pv.style.height = "18px";

    // ordine: Radio, Nome, Preview
    a.append(radio, lbl, pv);

    rowPreviews.push({ el: pv, pat: p });

    a.addEventListener("click", (e) => {
      e.preventDefault();
      selected = p;
      // apply live
      layer.style.lineType = p.id;
      layer.style.dashBase = deepClone(p.dashArray);
      refreshPreviews();

      // update radios
      for (const r of list.querySelectorAll("input[type=radio]")) r.checked = false;
      radio.checked = true;
    });

    list.appendChild(a);
  }

  body.appendChild(controls);
  body.appendChild(list);

  const bCancel = document.createElement("button");
  bCancel.className = "btn btn-sm btn-outline-secondary";
  bCancel.textContent = t("common.cancel");

  const bOk = document.createElement("button");
  bOk.className = "btn btn-sm btn-primary";
  bOk.textContent = t("common.ok");

  foot.append(bCancel, bOk);

  const m = openBootstrapModal(modalEl);

  bCancel.addEventListener("click", () => {
    layer.style.dashBase = deepClone(snap.dashBase);
    layer.style.sLT = snap.sLT;
    layer.style.strokeWidth = snap.strokeWidth;
    recomputeDashArray(layer.style);
    layer.style.lineType = snap.lineType;
    applyLayerToPaper(bodyEl, layer.id);
    refresh();
    m.hide();
  });
  bOk.addEventListener("click", () => m.hide());

  modalEl.addEventListener("hidden.bs.modal", () => {
    try { modalEl.remove(); } catch {}
  });
}

function openPointTypeModalFor(layer, refresh, bodyEl) {
  const snap = deepClone({ pointType: layer.style.pointType, sP: layer.style.sP });

  const modalId = `ptModal_${layer.id}_${Date.now()}`;
  const modalEl = makeModalShell(te("app.pjs.layers.point_type"), modalId);
  const body = modalEl.querySelector(".modal-body");
  const foot = modalEl.querySelector(".modal-footer");

  // Controls: scala + preview significativa
  const controls = document.createElement("div");
  controls.className = "d-flex flex-column gap-2 mb-3";

  const row = document.createElement("div");
  row.className = "d-flex align-items-end gap-3 flex-wrap";

  const sWrap = document.createElement("div");
  sWrap.className = "d-flex flex-column";
  const sLbl = document.createElement("div");
  sLbl.className = "small text-muted";
  sLbl.textContent = t("app.pjs.layers.pt_scale");
  const sIn = document.createElement("input");
  sIn.type = "number";
  sIn.min = "1";
  sIn.max = "99";
  sIn.step = "1";
  sIn.className = "form-control form-control-sm";
  sIn.style.width = "140px";
  sIn.value = String(clampInt(layer.style.sP, 1, 99, 1));
  sWrap.append(sLbl, sIn);

  row.appendChild(sWrap);

  const bigPvWrap = document.createElement("div");
  bigPvWrap.className = "w-100";
  let bigPvEl = pointPreviewEl(layer.style.pointType || "cross", clampInt(layer.style.sP, 1, 99, 1), { w: 180, h: 120 });
  bigPvEl.style.width = "100%";
  bigPvEl.style.height = "120px";
  bigPvEl.style.cursor = "default";
  bigPvWrap.appendChild(bigPvEl);

  controls.append(row, bigPvWrap);

  const list = document.createElement("div");
  list.className = "list-group";

  const rowPreviews = [];

  function refreshPointPreview() {
    const sP = clampInt(layer.style.sP, 1, 99, 1);
    const fresh = pointPreviewEl(layer.style.pointType || "cross", sP, { w: 180, h: 120 });
    fresh.style.width = "100%";
    fresh.style.height = "120px";
    fresh.style.cursor = "default";
    bigPvEl.replaceWith(fresh);
    bigPvEl = fresh;

    // list previews (non scalate)
    for (const rp of rowPreviews) {
      const freshRow = pointPreviewEl(rp.id, 1, { w: 70, h: 28 });
      freshRow.style.width = "70px";
      freshRow.style.height = "28px";
      rp.el.replaceWith(freshRow);
      rp.el = freshRow;
    }
  }

  sIn.addEventListener("input", () => {
    layer.style.sP = clampInt(sIn.value, 1, 99, 1);
    applyLayerToPaper(bodyEl, layer.id);
    refresh();
    refreshPointPreview();
  });

  for (const p of POINT_TYPES) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "list-group-item list-group-item-action d-flex align-items-center gap-3";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "pointType";
    radio.className = "form-check-input";
    const same = String(layer.style.pointType || "cross") === p.id;
    radio.checked = same;

    const lbl = document.createElement("div");
    lbl.textContent = p.label;
    lbl.style.minWidth = "140px";

    const pv = pointPreviewEl(p.id, 1, { w: 70, h: 28 });
    pv.style.width = "70px";
    pv.style.height = "28px";

    // ordine: Radio, Nome, Preview
    a.append(radio, lbl, pv);
    rowPreviews.push({ id: p.id, el: pv });

    a.addEventListener("click", (e) => {
      e.preventDefault();
      layer.style.pointType = p.id;
      applyLayerToPaper(bodyEl, layer.id);
      refresh();

      refreshPointPreview();

      for (const r of list.querySelectorAll("input[type=radio]")) r.checked = false;
      radio.checked = true;
    });

    list.appendChild(a);
  }

  body.appendChild(controls);
  body.appendChild(list);

  const bCancel = document.createElement("button");
  bCancel.className = "btn btn-sm btn-outline-secondary";
  bCancel.textContent = t("common.cancel");

  const bOk = document.createElement("button");
  bOk.className = "btn btn-sm btn-primary";
  bOk.textContent = t("common.ok");

  foot.append(bCancel, bOk);

  const m = openBootstrapModal(modalEl);

  bCancel.addEventListener("click", () => {
    layer.style.pointType = snap.pointType;
    layer.style.sP = snap.sP;
    applyLayerToPaper(bodyEl, layer.id);
    refresh();
    m.hide();
  });
  bOk.addEventListener("click", () => m.hide());

  modalEl.addEventListener("hidden.bs.modal", () => {
    try { modalEl.remove(); } catch {}
  });
}
