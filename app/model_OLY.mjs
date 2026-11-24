// model_OLY.mjs
// App OLY: cartografia con OpenLayers 10 — progetto e fasi in _doc/module-oly-openlayers.md
// Contratto piattaforma: export default { renderBody, getToolbar, getLeftMenu, getRightMenu, destroy }
//
// F0 (fondamenta): mappa, vista iniziale dalla spec del primo modello, coordinate del puntatore
// nel sistema scelto (proj4: sistemi italiani), scala, attribuzioni, più pannelli, tastiera.
// F1 (layer): fondo dal catalogo lib/map-services.json (spec.base), un layer per modello
// (OLY_sub_modules/OLY-layers.mjs), finestra Layer, Inquadra tutto.
// F2 (strumenti, OLY_sub_modules/OLY-tools.mjs): Proprietà al clic, Cerca, Colora per valore, misure
// geodetiche, confronto a tendina, viste salvate, esporta PNG.
// F3 (flow): eventi locali (select, deselect, click, moveEnd, layersLoaded), API per i nodi OLY/*
// (makeFlowApi → state.flowApi), runner OLY_sub_modules/OLY-flow-runner.mjs. Niente App Bus nell'App.
// F4 (disegno): finestra Disegno (OLY_sub_modules/OLY-draw.mjs), salvataggio GeoJSON con l'upload.
//
// Librerie caricate qui, al primo pannello (le usa solo OLY): niente dashboard.php né importmap.

import { t, te } from "./shared/i18n.mjs";
import { loadCatalog, buildServiceLayer, buildModelLayer, makeStyle } from "./OLY_sub_modules/OLY-layers.mjs";
import { olyLoadFlows } from "./OLY_sub_modules/OLY-flow-runner.mjs";
import { renderDraw, setDrawMode, cancelDrawing, drawBlocksClick, installDrawClick } from "./OLY_sub_modules/OLY-draw.mjs";
import {
  el, iconBtn, toggleWindow, syncToolbar,
  installSelection, renderProps, renderSearch, renderColorBy, renderViews, loadViews,
  setMeasure, cancelMeasureDrawing, clearMeasures, MEASURE_KINDS, setSwipe, exportPng,
  featureInfo, findFeatures, selectFeature, clearSelection, colorByValue, resetAllStyles, goToView,
} from "./OLY_sub_modules/OLY-tools.mjs";

// ── Costanti ────────────────────────────────────────────────────────────────

const STATE_KEY = "__OLY_STATE__";
const ACTIVE_BODIES = new Set();

const OL_VERSION    = "10.11.0";
const PROJ4_VERSION = "2.22.0";
const OL_JS   = `https://cdn.jsdelivr.net/npm/ol@${OL_VERSION}/dist/ol.js`;
const OL_CSS  = `https://cdn.jsdelivr.net/npm/ol@${OL_VERSION}/ol.css`;
const PROJ4_JS = `https://cdn.jsdelivr.net/npm/proj4@${PROJ4_VERSION}/dist/proj4.js`;

// Vista se la spec non ne ha una: l'Italia intera
const DEFAULT_VIEW = { center: [12.5, 42.0], zoom: 6, rotation: 0 };

// Sistemi di riferimento per le coordinate del footer (e, da F1, per i dati).
// Definizioni proj4 da epsg.io; Monte Mario con i parametri di trasformazione nazionali.
const CRS_DEFS = {
  "EPSG:4258":  "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs",   // ETRS89 geografico (WMS del catasto)
  "EPSG:6706":  "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs",   // RDN2008 geografico
  "EPSG:3003":  "+proj=tmerc +lat_0=0 +lon_0=9 +k=0.9996 +x_0=1500000 +y_0=0 +ellps=intl +towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68 +units=m +no_defs",
  "EPSG:3004":  "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=2520000 +y_0=0 +ellps=intl +towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68 +units=m +no_defs",
  "EPSG:6707":  "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:6708":  "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:25833": "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:32632": "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs",
  "EPSG:32633": "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
};
// Ordine e nomi nel menu "Coordinate"
const CRS_LIST = [
  ["EPSG:4326",  "WGS84 (lat, lon)"],
  ["EPSG:3857",  "Web Mercator"],
  ["EPSG:3003",  "Monte Mario / Gauss-Boaga fuso Ovest"],
  ["EPSG:3004",  "Monte Mario / Gauss-Boaga fuso Est"],
  ["EPSG:6707",  "RDN2008 / UTM 32N"],
  ["EPSG:6708",  "RDN2008 / UTM 33N"],
  ["EPSG:25832", "ETRS89 / UTM 32N"],
  ["EPSG:25833", "ETRS89 / UTM 33N"],
  ["EPSG:32632", "WGS84 / UTM 32N"],
  ["EPSG:32633", "WGS84 / UTM 33N"],
];

// ── Caricamento lazy (una volta per pagina) ─────────────────────────────────

let _libsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(t("app.oly.err.load_failed", { file: src })));
    document.head.appendChild(s);
  });
}

function ensureLibs() {
  if (window.ol?.Map && window.proj4) return Promise.resolve(window.ol);
  if (_libsPromise) return _libsPromise;
  if (!document.querySelector("link[data-oly-css]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = OL_CSS;
    link.dataset.olyCss = "1";
    document.head.appendChild(link);
  }
  _libsPromise = Promise.all([
    window.ol?.Map ? null : loadScript(OL_JS),
    window.proj4 ? null : loadScript(PROJ4_JS),
  ]).then(() => {
    const ol = window.ol, proj4 = window.proj4;
    if (!ol?.Map || !proj4) throw new Error(t("app.oly.err.lib_unavailable"));
    for (const [code, def] of Object.entries(CRS_DEFS)) proj4.defs(code, def);
    ol.proj.proj4.register(proj4);
    return ol;
  }).catch(e => { _libsPromise = null; throw e; });
  return _libsPromise;
}

// ── Utilità ─────────────────────────────────────────────────────────────────

function parseSpec(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function readView(spec) {
  const v = spec?.view || {};
  const c = Array.isArray(v.center) && v.center.length >= 2 && v.center.slice(0, 2).every(Number.isFinite)
    ? [v.center[0], v.center[1]] : DEFAULT_VIEW.center;
  const zoom = Number.isFinite(v.zoom) ? Math.min(Math.max(v.zoom, 0), 22) : DEFAULT_VIEW.zoom;
  const rotation = Number.isFinite(v.rotation) ? v.rotation : 0;
  return { center: c, zoom, rotation };
}

const knownCrs = code => CRS_LIST.some(([c]) => c === code);

// Coordinate per il footer, nel sistema scelto
function formatCoord(ol, coord3857, crs) {
  if (crs === "EPSG:4326") {
    const [lon, lat] = ol.proj.toLonLat(coord3857);
    const ns = lat >= 0 ? "N" : "S", ew = lon >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
  }
  const [x, y] = crs === "EPSG:3857" ? coord3857 : ol.proj.transform(coord3857, "EPSG:3857", crs);
  const n = v => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `E ${n(x)} m · N ${n(y)} m`;
}

// ── Ciclo di vita ───────────────────────────────────────────────────────────

function destroyBodyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st || st.stopped) return;
  st.stopped = true;
  try { st.listeners?.abort(); } catch {}
  try { st.resizeObserver?.disconnect(); } catch {}
  try { cancelAnimationFrame(st.coordRaf); } catch {}
  try { st.map?.setTarget(null); st.map?.dispose?.(); } catch {}
  try { st.host?.remove(); } catch {}
  try { st.rpanel?.remove(); } catch {}
  try {
    bodyEl.style.position = st.prevStyle.position;
    bodyEl.style.overflow = st.prevStyle.overflow;
  } catch {}
  try { delete bodyEl[STATE_KEY]; } catch {}
  ACTIVE_BODIES.delete(bodyEl);
}

function goHome(st, animate = true) {
  const { ol, map } = st;
  const v = readView(st.spec);
  const view = map.getView();
  const target = { center: ol.proj.fromLonLat(v.center), zoom: v.zoom, rotation: v.rotation * Math.PI / 180 };
  if (animate) view.animate({ ...target, duration: 400 });
  else { view.setCenter(target.center); view.setZoom(target.zoom); view.setRotation(target.rotation); }
}

function setCrs(st, crs) {
  if (!knownCrs(crs)) return;
  st.crs = crs;
  st.cmdUI?.update?.({ status: t("app.oly.status.crs", { crs: CRS_LIST.find(([c]) => c === crs)[1], code: crs }) });
  showCoord(st);
}

function showCoord(st) {
  if (st.stopped) return;
  const c = st.lastPointer ?? st.map.getView().getCenter();
  const where = st.lastPointer ? t("app.oly.coord.pointer") : t("app.oly.coord.center");
  st.cmdUI?.update?.({ hints: `${where}: ${formatCoord(st.ol, c, st.crs)} · ${st.crs}` });
}

// Finestre della colonna destra, in quest'ordine (gestore in OLY-tools.mjs)
const WINDOW_DEFS = {
  layers:  { icon: "bi-stack",          color: "#38bdf8", title: "app.oly.layers.title",  btn: "btnOlyLayers",  render: st => renderLayers(st) },
  props:   { icon: "bi-info-square",    color: "#fbbf24", title: "app.oly.props.title",   btn: "btnOlyProps",   render: st => renderProps(st) },
  search:  { icon: "bi-search",         color: "#f472b6", title: "app.oly.search.title",  btn: "btnOlySearch",  render: st => renderSearch(st) },
  colorby: { icon: "bi-palette2",       color: "#fb923c", title: "app.oly.colorby.title", btn: "btnOlyColorBy", render: st => renderColorBy(st) },
  views:   { icon: "bi-bookmark-star",  color: "#a78bfa", title: "app.oly.views.title",   btn: "btnOlyViews",   render: st => renderViews(st) },
  draw:    { icon: "bi-pencil-square",  color: "#2dd4bf", title: "app.oly.draw.title",    btn: "btnOlyDraw",    render: st => renderDraw(st),
             onClose: st => { if (st.draw?.mode) setDrawMode(st, st.draw.mode); } },
};

// ── Layer ───────────────────────────────────────────────────────────────────
// st.layers: [{ key, layer, kind, title, styleSpec?, service?, extent?, count?, error? }]
// ordine = ordine dei modelli; il primo sta in basso. zIndex: fondo 0, modelli 10, 11, …

function applyOrder(st) {
  st.layers.forEach((L, i) => L.layer?.setZIndex(10 + i));
}

async function setBase(st, id) {
  const { ol, map } = st;
  if (st.baseLayer) { map.removeLayer(st.baseLayer); st.baseLayer = null; }
  st.baseId = id || "none";
  if (st.baseId === "none") return;
  try {
    const svc = st.catalog?.get(st.baseId);
    const layer = buildServiceLayer(ol, svc);
    layer.setZIndex(0);
    layer.set("olyBase", true);
    map.addLayer(layer);
    st.baseLayer = layer;
  } catch (e) {
    st.cmdUI?.update?.({ status: t("app.oly.err.base", { id: st.baseId, msg: e.message }) });
    st.baseId = "none";
  }
}

async function loadLayers(st, signal) {
  const { ol, map } = st;
  let ok = 0, failed = 0;
  for (const [i, row] of st.models.entries()) {
    const spec = parseSpec(row?.mod_spec);
    try {
      const L = await buildModelLayer(ol, row, spec, st.catalog, signal);
      if (!L || st.stopped) continue;
      L.key = `m${row?.mod_id ?? i}`;
      st.layers.push(L);
      map.addLayer(L.layer);
      ok++;
    } catch (e) {
      if (st.stopped || signal?.aborted) return;
      failed++;
      st.layers.push({ key: `m${row?.mod_id ?? i}`, title: String(spec.title || row?.mod_name || "?"), error: e.message });
      console.warn("[OLY] layer:", row?.mod_abs_url, e);
    }
  }
  applyOrder(st);
  st.cmdUI?.update?.({ status: failed ? t("app.oly.status.layers_err", { n: ok, f: failed }) : t("app.oly.status.layers", { n: ok }) });
  renderLayers(st);
}

async function fitAll(st) {
  const { ol, map } = st;
  let ext = ol.extent.createEmpty();
  for (const L of st.layers) {
    if (!L.extent || !L.layer?.getVisible()) continue;
    try {
      const e = await L.extent();
      if (e && !ol.extent.isEmpty(e)) ol.extent.extend(ext, e);
    } catch {}
  }
  if (ol.extent.isEmpty(ext)) { goHome(st); return; }
  map.getView().fit(ext, { padding: [40, 40, 40, 40], maxZoom: 19, duration: 400 });
}

async function fitLayer(st, L) {
  try {
    const e = await L.extent?.();
    if (e && !st.ol.extent.isEmpty(e)) st.map.getView().fit(e, { padding: [40, 40, 40, 40], maxZoom: 19, duration: 400 });
  } catch {}
}

// ── API per i nodi dei flow (state.flowApi → ctx.oly in OLY-flow-runner.mjs) ─

function findLayer(st, name) {
  const want = String(name ?? "").trim().toLowerCase();
  if (!want) return null;
  return st.layers.find(L => L.key === name || L.title.toLowerCase() === want) ?? null;
}

function hexA(hex, a) {
  const h = String(hex || "#2563eb").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16) || 0x2563eb;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function makeFlowApi(st) {
  const { ol, map } = st;
  return {
    get layersLoaded() { return !!st.layersLoaded; },
    listLayers: () => st.layers.map(L => ({
      title: L.title, kind: L.flow ? "flow" : (L.kind ?? null),
      visible: L.layer ? L.layer.getVisible() : false,
      opacity: L.layer ? +L.layer.getOpacity().toFixed(3) : null, error: L.error ?? null,
    })),

    getView() {
      const v = map.getView();
      const [lon, lat] = ol.proj.toLonLat(v.getCenter());
      const ext = ol.proj.transformExtent(v.calculateExtent(map.getSize()), "EPSG:3857", "EPSG:4326");
      return { center: { lon: +lon.toFixed(7), lat: +lat.toFixed(7) }, zoom: +v.getZoom().toFixed(2),
        rotation: +(v.getRotation() * 180 / Math.PI).toFixed(2), extent: ext.map(x => +x.toFixed(7)) };
    },
    setView(center, zoom, animate = true) {
      const v = map.getView();
      return new Promise(res => v.animate({
        center: ol.proj.fromLonLat([center.lon, center.lat]),
        zoom: Number.isFinite(zoom) ? Math.min(Math.max(zoom, 0), 22) : v.getZoom(),
        duration: animate ? 500 : 0,
      }, () => res()));
    },
    fitAll: () => fitAll(st),
    async fitLayer(name) {
      const L = findLayer(st, name);
      if (!L?.extent) return false;
      await fitLayer(st, L);
      return true;
    },
    async goToView(name) {
      const want = String(name ?? "").trim().toLowerCase();
      const v = st.views.find(x => x.name.toLowerCase() === want);
      if (!v) return false;
      await goToView(st, v);
      return true;
    },

    setLayerVisible(name, visible) {
      const L = findLayer(st, name);
      if (!L?.layer) return false;
      L.layer.setVisible(!!visible);
      renderLayers(st);
      return true;
    },
    setLayerOpacity(name, opacity) {
      const L = findLayer(st, name);
      if (!L?.layer) return false;
      L.layer.setOpacity(Math.min(Math.max(Number(opacity), 0), 1));
      renderLayers(st);
      return true;
    },
    async setBase(id) { await setBase(st, String(id || "none")); renderLayers(st); },

    // Layer dal flow: GeoJSON in WGS84; stesso nome = sostituisce gli elementi (e lo stile).
    // colorField: attributo con il colore del singolo elemento (es. punti P1, P2… colorati come
    // le serie di un grafico); radius: raggio dei punti in pixel.
    addGeoJSON(name, geojson, { color = "#2563eb", label = "", colorField = "", radius = 5 } = {}) {
      const features = new ol.format.GeoJSON().readFeatures(geojson, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
      const specFor = c => ({ stroke: c, fill: hexA(c, 0.2), width: 2, radius, label: label || null });
      const styleOf = spec => { const s = makeStyle(ol, spec); return typeof s === "function" ? s : () => s; };
      let style = makeStyle(ol, specFor(color));
      if (colorField) {
        const cache = new Map();
        style = (feature, res) => {
          const c = String(feature.get(colorField) || color);
          if (!cache.has(c)) cache.set(c, styleOf(specFor(c)));
          return cache.get(c)(feature, res);
        };
      }
      const existing = st.layers.find(L => L.flow && L.title === name);
      if (existing) {
        const src = existing.layer.getSource();
        src.clear();
        src.addFeatures(features);
        existing.layer.setStyle(style);
        existing.styleSpec = { stroke: color, fill: hexA(color, 0.2) };
        existing.count = features.length;
      } else {
        const styleSpec = specFor(color);
        const source = new ol.source.Vector({ features });
        const layer = new ol.layer.Vector({ source, style });
        const L = {
          key: `f_${name.replace(/[^\w-]+/g, "_")}`, layer, kind: "vector", flow: true, title: name,
          styleSpec: { stroke: color, fill: styleSpec.fill }, count: features.length,
          extent: () => (source.getFeatures().length ? source.getExtent() : null),
        };
        st.layers.push(L);
        map.addLayer(layer);
        applyOrder(st);
      }
      renderLayers(st);
      return features.length;
    },
    removeFlowLayer(name) {
      const i = st.layers.findIndex(L => L.flow && L.title === name);
      if (i < 0) return false;
      const [L] = st.layers.splice(i, 1);
      if (st.selection?.L === L) clearSelection(st, { source: "flow" });
      map.removeLayer(L.layer);
      applyOrder(st);
      renderLayers(st);
      return true;
    },

    findFeatures: params => findFeatures(st, params).map(x => featureInfo(st, x.f, x.L, x.i)),
    selectFeature(params, fit = true) {
      const [hit] = findFeatures(st, params);
      if (!hit) return false;
      selectFeature(st, hit.f, hit.L, { fit, source: "flow" });
      return true;
    },
    getSelection: () => st.selection ? featureInfo(st, st.selection.f, st.selection.L) : null,
    clearSelection: () => clearSelection(st, { source: "flow" }),
    colorByValue: (layer, attribute) => colorByValue(st, layer, attribute)
      .map(g => ({ value: g.value, color: g.color, count: g.features.length })),
    resetStyles: () => resetAllStyles(st),

    getMeasures() {
      const lengths = [], areas = [];
      for (const f of st.measureLayer?.getSource().getFeatures() ?? []) {
        const g = f.getGeometry();
        if (g?.getType() === "Polygon") areas.push(+ol.sphere.getArea(g).toFixed(2));
        else if (g) lengths.push(+ol.sphere.getLength(g).toFixed(2));
      }
      return { lengths, areas };
    },
  };
}

// ── Finestra Layer ──────────────────────────────────────────────────────────

function renderLayers(st) {
  const w = st.win.layers;
  if (!w?.visible) return;
  const list = w.list;
  list.replaceChildren();
  const uid = `oly_${st.uid}`;

  // fondo
  const baseRow = el("div", "oly-base-row");
  const lbl = el("label", "", t("app.oly.layers.base"));
  lbl.htmlFor = `${uid}_base`;
  const sel = el("select");
  sel.id = `${uid}_base`;
  const opt = (v, text) => { const o = el("option", "", text); o.value = v; if (v === st.baseId) o.selected = true; sel.appendChild(o); };
  opt("none", t("app.oly.layers.no_base"));
  for (const svc of st.catalog?.values() ?? []) if (svc.kind === "base" && svc.enabled !== false) opt(svc.id, svc.title);
  sel.addEventListener("change", () => setBase(st, sel.value));
  baseRow.append(lbl, sel);
  list.appendChild(baseRow);

  if (!st.layers.length) { list.appendChild(el("div", "oly-empty", t("app.oly.layers.empty"))); return; }

  // dal più alto al più basso, come si vedono sulla mappa
  const ul = el("ul", "oly-layers");
  ul.setAttribute("aria-label", t("app.oly.layers.title"));
  [...st.layers].reverse().forEach(L => {
    const idx = st.layers.indexOf(L);
    const li = el("li", "oly-layer");
    const top = el("div", "oly-layer-top");
    if (L.error) {
      top.append(el("i", "bi bi-exclamation-triangle oly-warn"), el("span", "oly-layer-name", L.title));
      li.append(top, el("div", "oly-layer-err", L.error));
      ul.appendChild(li);
      return;
    }
    const cb = el("input");
    cb.type = "checkbox";
    cb.id = `${uid}_${L.key}`;
    cb.checked = L.layer.getVisible();
    cb.addEventListener("change", () => L.layer.setVisible(cb.checked));
    const name = el("label", "oly-layer-name", L.title);
    name.htmlFor = cb.id;
    name.title = L.title;
    top.append(cb, name);
    if (L.extent) top.appendChild(iconBtn("bi-arrows-fullscreen", t("app.oly.layers.zoom", { name: L.title }), () => fitLayer(st, L)));
    const up = iconBtn("bi-arrow-up", t("app.oly.layers.up", { name: L.title }), () => moveLayer(st, idx, +1));
    const down = iconBtn("bi-arrow-down", t("app.oly.layers.down", { name: L.title }), () => moveLayer(st, idx, -1));
    up.disabled = idx === st.layers.length - 1;
    down.disabled = idx === 0;
    const sw = iconBtn("bi-layout-split", t("app.oly.layers.swipe", { name: L.title }), () => { setSwipe(st, L); renderLayers(st); });
    sw.setAttribute("aria-pressed", String(st.swipe?.L === L));
    if (st.swipe?.L === L) sw.classList.add("active");
    top.append(up, down, sw);
    li.appendChild(top);

    const op = el("div", "oly-layer-opacity");
    const range = el("input");
    range.type = "range"; range.min = "0"; range.max = "100";
    range.value = String(Math.round(L.layer.getOpacity() * 100));
    range.setAttribute("aria-label", t("app.oly.layers.opacity", { name: L.title }));
    const out = el("span", "oly-layer-op-val", `${range.value}%`);
    range.addEventListener("input", () => { L.layer.setOpacity(Number(range.value) / 100); out.textContent = `${range.value}%`; });
    op.append(el("i", "bi bi-circle-half"), range, out);
    li.appendChild(op);

    // legenda
    if (L.kind === "vector") {
      const lg = el("div", "oly-legend");
      const sw = el("span", "oly-swatch");
      sw.style.background = L.styleSpec.fill;
      sw.style.borderColor = L.styleSpec.stroke;
      sw.setAttribute("aria-hidden", "true");
      lg.append(sw, el("span", "", t("app.oly.layers.features", { n: L.count ?? 0 })));
      li.appendChild(lg);
    } else if (L.kind === "service" && L.service?.legend && L.layer.getSource()?.getLegendUrl) {
      // un'immagine per layer del servizio (GetLegendGraphic accetta un layer per volta);
      // quelle che non arrivano o sono vuote si tolgono
      const res = st.map.getView().getResolution();
      for (const name of String(L.service.layers || "").split(",").map(x => x.trim()).filter(Boolean)) {
        const url = L.layer.getSource().getLegendUrl(res, { LAYER: name });
        if (!url) continue;
        const img = el("img", "oly-legend-img");
        img.alt = t("app.oly.layers.legend", { name: `${L.title} — ${name}` });
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove());
        img.addEventListener("load", () => { if (img.naturalWidth <= 8 || img.naturalHeight <= 8) img.remove(); });   // vuote o quasi
        img.src = url;
        li.appendChild(img);
      }
    }
    if (L.service?.notes) li.appendChild(el("div", "oly-layer-note", L.service.notes));
    ul.appendChild(li);
  });
  list.appendChild(ul);
}

function moveLayer(st, idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= st.layers.length) return;
  [st.layers[idx], st.layers[j]] = [st.layers[j], st.layers[idx]];
  applyOrder(st);
  renderLayers(st);
}

// ── Plugin export ───────────────────────────────────────────────────────────

export default {

  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
    destroyBodyInstance(bodyEl);

    const prevStyle = { position: bodyEl.style.position, overflow: bodyEl.style.overflow };
    bodyEl.style.position = bodyEl.style.position || "relative";
    bodyEl.style.overflow = "hidden";

    const host = document.createElement("div");
    host.className = "oly-host";
    host.tabIndex = 0;   // tastiera: frecce = sposta, + / - = zoom (interazioni di OpenLayers)
    host.setAttribute("role", "application");
    host.setAttribute("aria-label", t("app.oly.map_label", { name: object?.obj_name ?? "" }));
    bodyEl.appendChild(host);

    cmdUI?.show?.({ status: te("app.oly.status.loading"), hints: "" });

    let ol;
    try {
      ol = await ensureLibs();
    } catch (e) {
      cmdUI?.update?.({ status: te("app.oly.err.load", { msg: e.message }) });
      host.remove();
      return;
    }
    if (signal?.aborted) { host.remove(); return; }

    const rows = Array.isArray(models) ? models : [];
    const spec = parseSpec(rows[0]?.mod_spec);
    const v = readView(spec);

    const map = new ol.Map({
      target: host,
      layers: [],
      view: new ol.View({
        center: ol.proj.fromLonLat(v.center),
        zoom: v.zoom,
        rotation: v.rotation * Math.PI / 180,
        maxZoom: 22,
      }),
      controls: ol.control.defaults.defaults({ attributionOptions: { collapsible: true } })
        .extend([new ol.control.ScaleLine({ units: "metric" })]),
      keyboardEventTarget: host,
    });

    const state = {
      stopped: false,
      ol, map, host, spec, object, cmdUI, bodyEl, prevStyle,
      models: rows,
      crs: knownCrs(spec.crs) ? spec.crs : "EPSG:4326",
      lastPointer: null,
      coordRaf: 0,
      listeners: new AbortController(),
      resizeObserver: null,
      toolbarRoot: headerEl ?? panel,
      uid: Math.random().toString(36).slice(2, 8),
      catalog: new Map(),
      baseLayer: null,
      baseId: "none",
      layers: [],
      rpanel: null,
      windowDefs: WINDOW_DEFS,
      win: {},
      selection: null,
      measure: null,
      swipe: null,
      views: [],
      viewsDirty: false,
    };
    // funzioni del pannello usate dagli strumenti (OLY-tools.mjs)
    state.formatCoord = c => formatCoord(ol, c, state.crs);
    state.setBase = id => setBase(state, id).then(() => renderLayers(state));
    state.renderLayers = () => renderLayers(state);
    state.setMeasure = kind => setMeasure(state, kind);
    state.setDrawMode = mode => setDrawMode(state, mode);
    state.blockSelect = () => drawBlocksClick(state);
    state.onSelectionChange = () => renderDraw(state);
    state.views = loadViews(state);
    // eventi per i nodi OLY/Events/* e API dei nodi
    state.localEvents = new EventTarget();
    state.dispatch = (name, detail) => {
      try { state.localEvents.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { console.warn("[OLY] event:", e); }
    };
    state.flowApi = makeFlowApi(state);
    bodyEl[STATE_KEY] = state;
    ACTIVE_BODIES.add(bodyEl);
    signal?.addEventListener("abort", () => destroyBodyInstance(bodyEl), { once: true });

    // coordinate del puntatore nel footer (una volta per fotogramma)
    map.on("pointermove", ev => {
      if (ev.dragging) return;
      state.lastPointer = ev.coordinate;
      if (state.coordRaf) return;
      state.coordRaf = requestAnimationFrame(() => { state.coordRaf = 0; showCoord(state); });
    });
    host.addEventListener("pointerleave", () => { state.lastPointer = null; showCoord(state); }, { signal: state.listeners.signal });
    map.on("moveend", () => {
      if (!state.lastPointer) showCoord(state);
      const v = state.flowApi.getView();
      state.dispatch("moveEnd", { center: v.center, zoom: v.zoom, extent: v.extent });
    });

    // ridimensionamento del pannello
    state.resizeObserver = new ResizeObserver(() => { if (!state.stopped) map.updateSize(); });
    state.resizeObserver.observe(host);

    // colonna delle finestre (stile condiviso con TJS/IFC, css/ReseArch.css §16)
    state.rpanel = document.createElement("div");
    state.rpanel.className = "tjs-rpanel";
    bodyEl.appendChild(state.rpanel);

    // catalogo dei servizi, fondo, layer dei modelli
    try { state.catalog = await loadCatalog(); }
    catch (e) { cmdUI?.update?.({ status: te("app.oly.err.catalog", { msg: e.message }) }); }
    if (state.stopped) return;
    await setBase(state, typeof spec.base === "string" ? spec.base : "osm");
    showCoord(state);
    syncToolbar(state);
    await loadLayers(state, signal);
    if (state.stopped) return;
    installSelection(state);
    installDrawClick(state);
    state.layersLoaded = true;
    state.dispatch("layersLoaded", {
      count: state.layers.filter(L => !L.error).length,
      layers: state.layers.filter(L => !L.error).map(L => L.title),
    });
    // flow dell'oggetto (senza await: la mappa non aspetta la lettura dei flow dal server)
    olyLoadFlows(state, object, signal).catch(e => console.warn("[OLY] flow:", e));
    // Esc: annulla la misura o il disegno in corso
    host.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      cancelMeasureDrawing(state);
      cancelDrawing(state);
    }, { signal: state.listeners.signal });

  },

  getLeftMenu({ object }) {
    return { title: object?.obj_name ?? "OLY", items: [] };
  },

  getRightMenu() {
    return { title: "☰", items: [] };
  },

  getToolbar({ bodyEl }) {
    const st = () => bodyEl?.[STATE_KEY];
    const run = fn => () => { const s = st(); if (s && !s.stopped) fn(s); };
    const winBtn = (id, icon, key, win) => ({
      type: "button", id, iconClass: icon, className: "icon-only",
      title: t(key), attrs: { "aria-label": t(key), "aria-pressed": "false" }, onClick: run(s => toggleWindow(s, win)),
    });
    return {
      items: [
        {
          type: "button", id: "btnOlyFit", iconClass: "bi bi-arrows-fullscreen", className: "icon-only",
          title: t("app.oly.tb.fit"), attrs: { "aria-label": t("app.oly.tb.fit") }, onClick: run(s => fitAll(s)),
        },
        {
          type: "button", id: "btnOlyHome", iconClass: "bi bi-house", className: "icon-only",
          title: t("app.oly.tb.home"), attrs: { "aria-label": t("app.oly.tb.home") }, onClick: run(s => goHome(s)),
        },
        {
          type: "button", id: "btnOlyLayers", iconClass: "bi bi-stack", className: "icon-only",
          title: t("app.oly.tb.layers"), attrs: { "aria-label": t("app.oly.tb.layers"), "aria-pressed": "false" },
          onClick: run(s => toggleWindow(s, "layers")),
        },
        winBtn("btnOlyProps",   "bi bi-info-square",   "app.oly.tb.props",   "props"),
        winBtn("btnOlySearch",  "bi bi-search",        "app.oly.tb.search",  "search"),
        winBtn("btnOlyColorBy", "bi bi-palette2",      "app.oly.tb.colorby", "colorby"),
        winBtn("btnOlyViews",   "bi bi-bookmark-star", "app.oly.tb.views",   "views"),
        { ...winBtn("btnOlyDraw", "bi bi-pencil-square", "app.oly.tb.draw", "draw"), minLevel: 20 },
        { type: "divider" },
        {
          type: "dropdown", id: "btnOlyMeasures", iconClass: "bi bi-rulers", className: "icon-only",
          title: t("app.oly.tb.measures"), minLevel: 20,
          items: [
            ...Object.entries(MEASURE_KINDS).map(([kind, k]) => ({
              iconClass: `bi ${k.icon}`, label: t(k.label), title: t(k.title), onClick: run(s => setMeasure(s, kind)),
            })),
            { type: "divider" },
            { iconClass: "bi bi-eraser", label: t("app.oly.menu.measures_clear"), title: t("app.oly.tb.measures_clear"), onClick: run(s => clearMeasures(s)) },
          ],
        },
        {
          type: "button", id: "btnOlyExport", iconClass: "bi bi-image", className: "icon-only",
          title: t("app.oly.tb.export"), attrs: { "aria-label": t("app.oly.tb.export") }, onClick: run(s => exportPng(s)),
        },
        { type: "divider" },
        {
          type: "dropdown", id: "btnOlyCrs", iconClass: "bi bi-geo-alt", className: "icon-only",
          title: t("app.oly.tb.crs"),
          items: CRS_LIST.map(([code, name]) => ({
            label: `${name} — ${code}`, title: t("app.oly.tb.crs_pick", { code }), onClick: run(s => setCrs(s, code)),
          })),
        },
      ],
    };
  },

  destroy() {
    for (const bodyEl of Array.from(ACTIVE_BODIES)) destroyBodyInstance(bodyEl);
  },
};
