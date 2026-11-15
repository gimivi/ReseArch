// app/OLY_sub_modules/OLY-tools.mjs
// Finestre e strumenti dell'App OLY (F2, _doc/module-oly-openlayers.md §9):
//   finestre della colonna destra (gestore generico, come IFC), Proprietà al clic, Cerca, Colora per valore,
//   misure geodetiche, confronto a tendina, viste salvate, esporta PNG.
// Tutto lavora sullo stato del pannello (st), costruito in model_OLY.mjs.

import { t, te } from "../shared/i18n.mjs";
import { panelLevel } from "../shared/ui_level.mjs";

// ── DOM ─────────────────────────────────────────────────────────────────────

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function iconBtn(icon, label, fn) {
  const b = el("button", "oly-icon-btn");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
  b.addEventListener("click", fn);
  return b;
}

function textBtn(icon, label, fn) {
  const b = el("button", "tjs-rpanel-addbar-btn");
  b.type = "button";
  b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
  b.appendChild(document.createTextNode(" " + label));
  b.addEventListener("click", fn);
  return b;
}

// ── Finestre della colonna destra ───────────────────────────────────────────
// st.windowDefs: { key: { icon, color, title, btn, render } } (ordine = ordine nella colonna)
// st.win[key]: { el, list, visible }

export function ensureWindow(st, key) {
  if (st.win[key]) return st.win[key];
  const def = st.windowDefs[key];
  const item = el("div", "tjs-rpanel-item");
  item.dataset.olyWin = key;
  item.setAttribute("role", "region");
  item.setAttribute("aria-label", t(def.title));
  item.innerHTML = `
    <div class="tjs-rpanel-hdr">
      <span class="tjs-rpanel-hdr-title"><i class="bi ${def.icon}" style="color:${def.color}" aria-hidden="true"></i> ${te(def.title)}</span>
      <div class="tjs-rpanel-hdr-btns">
        <button type="button" class="tjs-rpanel-hdr-btn" data-oly="close" title="${te("common.close")}" aria-label="${te("common.close")}">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div class="tjs-rpanel-list" data-oly="list"></div>`;
  item.querySelector('[data-oly="close"]').addEventListener("click", () => setWindowVisible(st, key, false));
  const order = Object.keys(st.windowDefs);
  const next = [...st.rpanel.children].find(n => order.indexOf(n.dataset.olyWin) > order.indexOf(key));
  st.rpanel.insertBefore(item, next || null);
  const w = { el: item, list: item.querySelector('[data-oly="list"]'), visible: false };
  if (key === "props") w.list.setAttribute("aria-live", "polite");
  st.win[key] = w;
  return w;
}

export function setWindowVisible(st, key, on) {
  const w = on ? ensureWindow(st, key) : st.win[key];
  if (w) { w.visible = !!on; w.el.style.display = on ? "" : "none"; }
  st.rpanel.classList.toggle("is-active", Object.values(st.win).some(x => x?.visible));
  if (on) st.windowDefs[key].render(st);
  else st.windowDefs[key].onClose?.(st);
  syncToolbar(st);
}

export function toggleWindow(st, key) { setWindowVisible(st, key, !st.win[key]?.visible); }

export function syncToolbar(st) {
  const root = st.toolbarRoot;
  if (!root?.querySelector) return;
  const set = (id, on) => {
    const b = root.querySelector(`#${id}`);
    if (!b) return;
    b.classList.toggle("active", !!on);
    b.setAttribute("aria-pressed", String(!!on));
  };
  for (const [key, def] of Object.entries(st.windowDefs)) set(def.btn, st.win[key]?.visible);
  // menu Misure: icona dello strumento acceso, voce segnata
  const mb = root.querySelector("#btnOlyMeasures");
  if (mb) {
    const kind = st.measure?.kind ? MEASURE_KINDS[st.measure.kind] : null;
    mb.classList.toggle("active", !!kind);
    const ic = mb.querySelector("i");
    if (ic) ic.className = `bi ${kind ? kind.icon : "bi-rulers"}`;
    mb.title = kind ? t("app.oly.tb.measures_active", { tool: t(kind.label) }) : t("app.oly.tb.measures");
    mb.setAttribute("aria-label", mb.title);
    mb.parentElement?.querySelectorAll(".dropdown-item").forEach(a => {
      const on = !!kind && a.title === t(kind.title);
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  }
}

// ── Elementi vettoriali: utilità ────────────────────────────────────────────

const NAME_KEYS = ["name", "Name", "NAME", "nome", "Nome", "title", "titolo", "denominazione", "label"];

export function featureName(f, i = 0) {
  for (const k of NAME_KEYS) { const v = f.get(k); if (v !== undefined && v !== null && v !== "") return String(v); }
  return `#${i + 1}`;
}

function featureProps(f) {
  const p = { ...f.getProperties() };
  delete p[f.getGeometryName()];
  for (const k of Object.keys(p)) if (k.startsWith("__oly") || (p[k] && typeof p[k] === "object" && p[k].getType)) delete p[k];
  return p;
}

export const vectorLayers = st => st.layers.filter(L => L.kind === "vector" && L.layer);
export const featuresOf = L => L.layer.getSource().getFeatures();

// { layer, name, properties, position {lon, lat} } — per gli eventi e i nodi dei flow
export function featureInfo(st, f, L, i = 0) {
  const g = f.getGeometry();
  let position = null;
  if (g) {
    const c = g.getType() === "Point" ? g.getCoordinates() : st.ol.extent.getCenter(g.getExtent());
    const [lon, lat] = st.ol.proj.toLonLat(c);
    position = { lon: +lon.toFixed(7), lat: +lat.toFixed(7) };
  }
  return { layer: L.title, name: featureName(f, i), properties: featureProps(f), position };
}

function attributeKeys(L, max = 300) {
  const keys = new Set();
  featuresOf(L).slice(0, max).forEach(f => Object.keys(featureProps(f)).forEach(k => keys.add(k)));
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function fmtValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? t("common.yes") : t("common.no");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  return String(v);
}

// Lunghezze e aree sulla superficie terrestre (geometrie in EPSG:3857)
export function fmtLength(m) { return m >= 1000 ? `${(m / 1000).toFixed(3)} km` : `${m.toFixed(2)} m`; }
export function fmtArea(m2) { return m2 >= 1e6 ? `${(m2 / 1e6).toFixed(4)} km²` : m2 >= 1e4 ? `${(m2 / 1e4).toFixed(4)} ha (${Math.round(m2)} m²)` : `${m2.toFixed(2)} m²`; }

// ── Stili sovrapposti agli elementi (Colora per valore, Cerca → mostra solo) ──
// Ogni elemento ricorda il suo stile originale (WeakMap); color/hidden decidono quello mostrato.

function ensureOverrideState(st) {
  if (!st.featState) st.featState = { orig: new WeakMap(), touched: new Set(), color: new WeakMap(), hidden: new WeakSet() };
  return st.featState;
}

function colorStyle(st, hex) {
  const { ol } = st;
  const fill = hexA(hex, 0.45);
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: hex, width: 3 }),
    fill: new ol.style.Fill({ color: fill }),
    image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: hex }), stroke: new ol.style.Stroke({ color: "#ffffff", width: 1.5 }) }),
  });
}

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function applyFeatureStyle(st, f) {
  const fs = ensureOverrideState(st);
  if (!fs.orig.has(f)) fs.orig.set(f, f.getStyle() ?? null);
  fs.touched.add(f);
  if (fs.hidden.has(f)) { f.setStyle(st.emptyStyle); return; }
  const c = fs.color.get(f);
  f.setStyle(c ?? fs.orig.get(f));
}

function resetFeatureStyles(st, { colors = true, hidden = true } = {}) {
  const fs = ensureOverrideState(st);
  for (const f of fs.touched) {
    if (colors) fs.color.delete(f);
    if (hidden) fs.hidden.delete(f);
    applyFeatureStyle(st, f);
  }
}

function showOnly(st, keep) {
  const fs = ensureOverrideState(st);
  for (const L of vectorLayers(st)) for (const f of featuresOf(L)) {
    if (keep.has(f)) fs.hidden.delete(f); else fs.hidden.add(f);
    applyFeatureStyle(st, f);
  }
}

export function showAllFeatures(st) { resetFeatureStyles(st, { colors: false, hidden: true }); }

// ── Selezione e finestra Proprietà ──────────────────────────────────────────

export function installSelection(st) {
  const { ol, map } = st;
  st.emptyStyle = new ol.style.Style({});
  st.selLayer = new ol.layer.Vector({
    source: new ol.source.Vector(),
    zIndex: 1000,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#fbbf24", width: 4 }),
      fill: new ol.style.Fill({ color: "rgba(251, 191, 36, 0.25)" }),
      image: new ol.style.Circle({ radius: 8, fill: new ol.style.Fill({ color: "#fbbf24" }), stroke: new ol.style.Stroke({ color: "#111827", width: 2 }) }),
    }),
  });
  map.addLayer(st.selLayer);
  map.on("singleclick", ev => {
    if (st.measure?.kind || st.stopped || st.blockSelect?.()) return;
    // evento per i nodi OLY/Events/OnClick: coordinate del punto (anche nel vuoto)
    const [lon, lat] = ol.proj.toLonLat(ev.coordinate);
    const xy = st.crs === "EPSG:3857" ? ev.coordinate : ol.proj.transform(ev.coordinate, "EPSG:3857", st.crs);
    st.dispatch?.("click", {
      lonlat: { lon: +lon.toFixed(7), lat: +lat.toFixed(7) },
      xy: st.crs === "EPSG:4326" ? { x: +xy[0].toFixed(7), y: +xy[1].toFixed(7) } : { x: +xy[0].toFixed(3), y: +xy[1].toFixed(3) },
      crs: st.crs,
    });
    let hit = null;
    map.forEachFeatureAtPixel(ev.pixel, (f, layer) => {
      if (!layer || layer === st.selLayer || layer === st.measureLayer) return undefined;
      const L = st.layers.find(x => x.layer === layer);
      if (!L) return undefined;
      hit = { f, L };
      return true;
    }, { hitTolerance: 5 });
    if (hit) {
      st.serviceInfo = null;
      selectFeature(st, hit.f, hit.L);
      if (!st.win.props?.visible) setWindowVisible(st, "props", true);
    } else {
      clearSelection(st);
      queryServiceInfo(st, ev.coordinate);
    }
  });
}

// ── Informazioni dai servizi (GetFeatureInfo via api/map_proxy.php) ──────────
// Solo servizi del catalogo con "info": true e "proxy": true, accesi: il server legge la risposta
// (anche HTML, come quella del Catasto) e la restituisce come JSON { layers: [ { name, features } ] }.
const infoServices = st => st.layers.filter(L => L.kind === "service" && L.service?.info && L.service?.proxy && L.layer?.getVisible());

export async function queryServiceInfo(st, coordinate) {
  const Ls = infoServices(st);
  const seq = st.infoSeq = (st.infoSeq || 0) + 1;
  if (!Ls.length) { if (st.serviceInfo) { st.serviceInfo = null; renderProps(st); } return; }
  const res = st.map.getView().getResolution();
  st.serviceInfo = { loading: true, results: [] };
  if (!st.win.props?.visible) setWindowVisible(st, "props", true); else renderProps(st);
  const [lon, lat] = st.ol.proj.toLonLat(coordinate);
  const results = await Promise.all(Ls.map(async L => {
    const svc = L.service;
    const url = L.layer.getSource().getFeatureInfoUrl(coordinate, res, "EPSG:3857", {
      INFO_FORMAT: svc.info_format || "text/plain", QUERY_LAYERS: svc.query_layers || svc.layers, FEATURE_COUNT: 5,
    });
    try {
      const r = await fetch(url, { credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      return { title: L.title, service: svc.id, layers: j.data?.layers ?? [] };
    } catch (e) {
      return { title: L.title, service: svc.id, layers: [], error: e.message };
    }
  }));
  if (seq !== st.infoSeq || st.stopped) return;
  st.serviceInfo = { loading: false, results };
  renderProps(st);
  for (const r of results) {
    if (r.error) continue;
    st.dispatch?.("serviceInfo", {
      service: r.service, title: r.title, lonlat: { lon: +lon.toFixed(7), lat: +lat.toFixed(7) },
      features: r.layers.flatMap(l => l.features.map(f => ({ layer: l.name, properties: f }))),
    });
  }
}

function renderServiceInfo(st, list) {
  const info = st.serviceInfo;
  if (info.loading) { list.appendChild(el("div", "oly-empty", t("app.oly.props.service_loading"))); return; }
  for (const r of info.results) {
    addSection(list, t("app.oly.props.service_info", { name: r.title }));
    if (r.error) { list.appendChild(el("div", "oly-empty", t("app.oly.props.service_error", { msg: r.error }))); continue; }
    const feats = r.layers.flatMap(l => l.features.map(f => ({ name: l.name, f })));
    if (!feats.length) { list.appendChild(el("div", "oly-empty", t("app.oly.props.service_none"))); continue; }
    feats.forEach(({ name, f }) => {
      if (name) list.appendChild(el("div", "oly-prop-sub", name));
      for (const [k, v] of Object.entries(f)) addRow(list, k, v);
    });
  }
}

export function selectFeature(st, f, L, { fit = false, source = "user" } = {}) {
  const { ol } = st;
  st.selection = { f, L };
  st.selLayer.getSource().clear();
  const g = f.getGeometry();
  if (g) st.selLayer.getSource().addFeature(new ol.Feature(g));
  if (fit && g) st.map.getView().fit(g.getExtent(), { padding: [60, 60, 60, 60], maxZoom: 19, duration: 400 });
  renderProps(st);
  st.onSelectionChange?.();
  st.dispatch?.("select", { ...featureInfo(st, f, L), source });
}

export function clearSelection(st, { source = "user" } = {}) {
  const had = !!st.selection;
  st.selection = null;
  st.selLayer?.getSource().clear();
  renderProps(st);
  st.onSelectionChange?.();
  if (had) st.dispatch?.("deselect", { source });
}

function addRow(list, k, v) {
  const row = el("div", "oly-prop-row");
  row.append(el("span", "oly-prop-k", k));
  const val = el("span", "oly-prop-v", fmtValue(v));
  val.title = fmtValue(v);
  row.append(val);
  list.appendChild(row);
}

function addSection(list, title) {
  const s = el("div", "tjs-rpanel-section", title);
  s.setAttribute("role", "heading");
  s.setAttribute("aria-level", "3");
  list.appendChild(s);
}

export function renderProps(st) {
  const w = st.win.props;
  if (!w?.visible) return;
  const list = w.list;
  list.replaceChildren();
  const sel = st.selection;
  if (!sel && st.serviceInfo) { renderServiceInfo(st, list); return; }
  if (!sel) { list.appendChild(el("div", "oly-empty", t("app.oly.props.empty"))); return; }
  const { ol } = st;
  const g = sel.f.getGeometry();
  addSection(list, t("app.oly.props.feature"));
  addRow(list, t("app.oly.props.layer"), sel.L.title);
  addRow(list, t("app.oly.props.geometry"), g?.getType?.() ?? "—");
  if (g) {
    const type = g.getType();
    if (/LineString/.test(type)) addRow(list, t("app.oly.props.length"), fmtLength(ol.sphere.getLength(g)));
    if (/Polygon/.test(type)) {
      addRow(list, t("app.oly.props.area"), fmtArea(ol.sphere.getArea(g)));
      addRow(list, t("app.oly.props.perimeter"), fmtLength(ol.sphere.getLength(g)));
    }
    if (type === "Point") addRow(list, `${t("app.oly.props.coords")} (${st.crs})`, st.formatCoord(g.getCoordinates()));
  }
  const props = featureProps(sel.f);
  const keys = Object.keys(props);
  if (keys.length) {
    addSection(list, t("app.oly.props.attributes"));
    for (const k of keys) addRow(list, k, props[k]);
  }
}

// ── Cerca ───────────────────────────────────────────────────────────────────

const SEARCH_LIMIT = 300;

function matchValue(actual, wanted, mode) {
  if (actual === null || actual === undefined || actual === "") return false;
  if (wanted === "") return true;
  const a = String(actual).toLowerCase(), w = String(wanted).toLowerCase();
  if (mode === "contains") return a.includes(w);
  const na = Number(actual), nw = Number(wanted);
  if (Number.isFinite(na) && Number.isFinite(nw)) return na === nw;
  return a === w;
}

function layerSelect(st, id, withAll) {
  const sel = el("select");
  sel.id = id;
  if (withAll) { const o = el("option", "", t("app.oly.search.all_layers")); o.value = ""; sel.appendChild(o); }
  for (const L of vectorLayers(st)) { const o = el("option", "", L.title); o.value = L.key; sel.appendChild(o); }
  return sel;
}

// Ricerca riusabile (finestra Cerca e nodi OLY/Feature/*): layer = chiave o nome ("" = tutti)
export function findFeatures(st, { layer = "", attribute = "", value = "", match = "equals" } = {}) {
  const want = String(layer).trim().toLowerCase();
  const Ls = want ? vectorLayers(st).filter(L => L.key === layer || L.title.toLowerCase() === want) : vectorLayers(st);
  const found = [];
  for (const L of Ls) featuresOf(L).forEach((f, i) => {
    const props = featureProps(f);
    const ok = attribute ? matchValue(props[attribute], String(value).trim(), match)
      : Object.values(props).some(v => matchValue(v, String(value).trim(), match));
    if (ok) found.push({ f, L, i });
  });
  return found;
}

export function resetAllStyles(st) { resetFeatureStyles(st, { colors: true, hidden: true }); }

export function renderSearch(st) {
  const w = st.win.search;
  if (!w?.visible) return;
  if (w.built) return;
  w.built = true;
  const uid = `olyS_${st.uid}`;
  if (!vectorLayers(st).length) { w.list.replaceChildren(el("div", "oly-empty", t("app.oly.search.no_vector"))); w.built = false; return; }
  const form = el("form", "oly-form");
  form.setAttribute("role", "search");
  const lblL = el("label", "", t("app.oly.search.layer")); lblL.htmlFor = `${uid}_l`;
  const selL = layerSelect(st, `${uid}_l`, true);
  const lblA = el("label", "", t("app.oly.search.attribute")); lblA.htmlFor = `${uid}_a`;
  const selA = el("select"); selA.id = `${uid}_a`;
  const fillKeys = () => {
    const Ls = selL.value ? vectorLayers(st).filter(L => L.key === selL.value) : vectorLayers(st);
    const keys = new Set(); Ls.forEach(L => attributeKeys(L).forEach(k => keys.add(k)));
    selA.replaceChildren();
    const any = el("option", "", t("app.oly.search.any_attribute")); any.value = ""; selA.appendChild(any);
    [...keys].sort().forEach(k => { const o = el("option", "", k); o.value = k; selA.appendChild(o); });
  };
  selL.addEventListener("change", fillKeys);
  fillKeys();
  const lblV = el("label", "", t("app.oly.search.value")); lblV.htmlFor = `${uid}_v`;
  const row = el("div", "oly-form-row");
  const selM = el("select");
  selM.setAttribute("aria-label", t("app.oly.search.match"));
  [["contains", t("app.oly.search.contains")], ["equals", t("app.oly.search.equals")]].forEach(([v, x]) => { const o = el("option", "", x); o.value = v; selM.appendChild(o); });
  const inV = el("input"); inV.type = "text"; inV.id = `${uid}_v`; inV.autocomplete = "off";
  row.append(selM, inV);
  const go = el("button", "tjs-rpanel-addbar-btn");
  go.type = "submit";
  go.innerHTML = `<i class="bi bi-search" aria-hidden="true"></i>&nbsp;${te("app.oly.search.run")}`;
  form.append(lblL, selL, lblA, selA, lblV, row, go);
  const status = el("div", "oly-empty"); status.setAttribute("aria-live", "polite");
  const actions = el("div", "oly-actions");
  const results = el("ul", "oly-results"); results.setAttribute("aria-label", t("app.oly.search.results"));
  w.list.replaceChildren(form, status, actions, results);

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const found = findFeatures(st, { layer: selL.value, attribute: selA.value, value: inV.value, match: selM.value });
    status.textContent = t("app.oly.search.count", { n: found.length });
    results.replaceChildren(); actions.replaceChildren();
    if (!found.length) return;
    const keep = new Set(found.map(x => x.f));
    actions.append(
      textBtn("bi-bullseye", t("app.oly.search.only"), () => showOnly(st, keep)),
      textBtn("bi-eye", t("app.oly.search.show_all"), () => showAllFeatures(st)),
      textBtn("bi-arrows-fullscreen", t("app.oly.search.fit"), () => {
        const { ol } = st; const ext = ol.extent.createEmpty();
        found.forEach(x => { const g = x.f.getGeometry(); if (g) ol.extent.extend(ext, g.getExtent()); });
        if (!ol.extent.isEmpty(ext)) st.map.getView().fit(ext, { padding: [50, 50, 50, 50], maxZoom: 19, duration: 400 });
      }),
    );
    found.slice(0, SEARCH_LIMIT).forEach(x => {
      const li = el("li");
      const b = el("button", "oly-result");
      b.type = "button";
      b.append(el("span", "oly-result-name", featureName(x.f, x.i)), el("span", "oly-result-layer", x.L.title));
      b.addEventListener("click", () => selectFeature(st, x.f, x.L, { fit: true }));
      li.appendChild(b);
      results.appendChild(li);
    });
    if (found.length > SEARCH_LIMIT) results.appendChild(el("li", "oly-empty", t("app.oly.search.more", { n: found.length - SEARCH_LIMIT })));
  });
}

// ── Colora per valore ───────────────────────────────────────────────────────

const VALUE_PALETTE = ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00",
                       "#cc79a7", "#bcbd22", "#17becf", "#8c564b", "#e377c2", "#9467bd"];
const VALUE_MAX = 24, OTHER_COLOR = "#9ca3af";

function valueKey(v) {
  const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  return Number.isFinite(n) ? { key: `n:${+n.toFixed(3)}`, value: +n.toFixed(3) } : { key: `s:${String(v)}`, value: v };
}

export function colorByValue(st, layerKey, attr) {
  const want = String(layerKey).toLowerCase();
  const L = vectorLayers(st).find(x => x.key === layerKey || x.title.toLowerCase() === want);
  if (!L) throw new Error("layer not found");
  const groups = new Map();
  featuresOf(L).forEach(f => {
    const v = featureProps(f)[attr];
    if (v === null || v === undefined || v === "") return;
    const { key, value } = valueKey(v);
    if (!groups.has(key)) groups.set(key, { value, features: [] });
    groups.get(key).features.push(f);
  });
  const all = [...groups.values()];
  const numeric = all.length > 0 && all.every(g => Number.isFinite(Number(g.value)));
  all.sort((a, b) => numeric ? Number(a.value) - Number(b.value) : String(a.value).localeCompare(String(b.value)));
  const legend = all.slice(0, VALUE_MAX).map((g, i) => ({ value: g.value, color: VALUE_PALETTE[i % VALUE_PALETTE.length], features: g.features }));
  if (all.length > VALUE_MAX) legend.push({ value: null, other: all.length - VALUE_MAX, color: OTHER_COLOR, features: all.slice(VALUE_MAX).flatMap(g => g.features) });
  resetFeatureStyles(st, { colors: true, hidden: true });
  const fs = ensureOverrideState(st);
  for (const g of legend) {
    const style = colorStyle(st, g.color);
    for (const f of g.features) { fs.color.set(f, style); applyFeatureStyle(st, f); }
  }
  return legend;
}

export function renderColorBy(st) {
  const w = st.win.colorby;
  if (!w?.visible || w.built) return;
  if (!vectorLayers(st).length) { w.list.replaceChildren(el("div", "oly-empty", t("app.oly.search.no_vector"))); return; }
  w.built = true;
  const uid = `olyC_${st.uid}`;
  const form = el("form", "oly-form");
  const lblL = el("label", "", t("app.oly.search.layer")); lblL.htmlFor = `${uid}_l`;
  const selL = layerSelect(st, `${uid}_l`, false);
  const lblA = el("label", "", t("app.oly.search.attribute")); lblA.htmlFor = `${uid}_a`;
  const selA = el("select"); selA.id = `${uid}_a`;
  const fillKeys = () => {
    const L = vectorLayers(st).find(x => x.key === selL.value);
    selA.replaceChildren(...(L ? attributeKeys(L) : []).map(k => { const o = el("option", "", k); o.value = k; return o; }));
  };
  selL.addEventListener("change", fillKeys);
  fillKeys();
  const row = el("div", "oly-form-row");
  const go = el("button", "tjs-rpanel-addbar-btn"); go.type = "submit";
  go.innerHTML = `<i class="bi bi-palette2" aria-hidden="true"></i>&nbsp;${te("app.oly.colorby.run")}`;
  const reset = textBtn("bi-arrow-counterclockwise", t("app.oly.colorby.reset"), () => {
    legendEl.replaceChildren(); status.textContent = ""; isolated = null;
    resetFeatureStyles(st, { colors: true, hidden: true });
  });
  row.append(go, reset);
  form.append(lblL, selL, lblA, selA, row);
  const status = el("div", "oly-empty"); status.setAttribute("aria-live", "polite");
  const legendEl = el("ul", "oly-legend-list"); legendEl.setAttribute("aria-label", t("app.oly.colorby.legend"));
  w.list.replaceChildren(form, status, legendEl);

  let legend = [], isolated = null;
  const renderLegend = () => {
    legendEl.replaceChildren();
    legend.forEach((g, i) => {
      const li = el("li");
      const b = el("button", "oly-result");
      b.type = "button";
      b.setAttribute("aria-pressed", String(isolated === i));
      if (isolated === i) b.classList.add("is-selected");
      const sw = el("span", "oly-swatch-dot"); sw.style.background = g.color; sw.setAttribute("aria-hidden", "true");
      const label = g.value === null ? t("app.oly.colorby.others", { n: g.other }) : fmtValue(g.value);
      b.append(sw, el("span", "oly-result-name", label), el("span", "oly-result-layer", String(g.features.length)));
      b.title = t("app.oly.colorby.isolate_hint");
      b.addEventListener("click", () => {
        if (isolated === i) { isolated = null; showAllFeatures(st); }
        else { isolated = i; showOnly(st, new Set(g.features)); }
        renderLegend();
      });
      li.appendChild(b);
      legendEl.appendChild(li);
    });
  };
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    try { legend = colorByValue(st, selL.value, selA.value); }
    catch (e) { status.textContent = t("app.oly.err.generic", { msg: e.message }); return; }
    isolated = null;
    const total = legend.reduce((a, g) => a + g.features.length, 0);
    status.textContent = legend.length ? t("app.oly.colorby.done", { n: legend.length, total }) : t("app.oly.colorby.none");
    renderLegend();
  });
}

// ── Misure geodetiche ───────────────────────────────────────────────────────

export const MEASURE_KINDS = {
  length: { type: "LineString", icon: "bi-rulers",       label: "app.oly.menu.length", title: "app.oly.tb.length" },
  area:   { type: "Polygon",    icon: "bi-bounding-box", label: "app.oly.menu.area",   title: "app.oly.tb.area" },
};

function ensureMeasureLayer(st) {
  if (st.measureLayer) return;
  const { ol } = st;
  st.measureLayer = new ol.layer.Vector({
    source: new ol.source.Vector(),
    zIndex: 1001,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#f97316", width: 3, lineDash: [8, 6] }),
      fill: new ol.style.Fill({ color: "rgba(249, 115, 22, 0.15)" }),
      image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({ color: "#f97316" }) }),
    }),
  });
  st.map.addLayer(st.measureLayer);
  st.measureOverlays = [];
}

function measureText(st, geom) {
  return geom.getType() === "Polygon" ? fmtArea(st.ol.sphere.getArea(geom)) : fmtLength(st.ol.sphere.getLength(geom));
}

export function setMeasure(st, kind) {
  const { ol, map } = st;
  const next = st.measure?.kind === kind ? null : kind;   // stessa voce = spegne
  if (st.measure?.draw) { map.removeInteraction(st.measure.draw); }
  st.measure?.tip?.setPosition(undefined);
  st.measure = null;
  if (next) {
    if (st.draw?.mode) st.setDrawMode?.(st.draw.mode);   // spegne il disegno acceso
    ensureMeasureLayer(st);
    const draw = new ol.interaction.Draw({ source: st.measureLayer.getSource(), type: MEASURE_KINDS[next].type });
    const tipEl = el("div", "oly-measure-label oly-measure-live");
    const tip = new ol.Overlay({ element: tipEl, offset: [0, -14], positioning: "bottom-center", stopEvent: false });
    map.addOverlay(tip);
    let listener = null;
    draw.on("drawstart", e => {
      const g = e.feature.getGeometry();
      listener = g.on("change", () => {
        tipEl.textContent = measureText(st, g);
        tip.setPosition(g.getType() === "Polygon" ? g.getInteriorPoint().getCoordinates() : g.getLastCoordinate());
      });
    });
    draw.on("drawend", e => {
      if (listener) ol.Observable.unByKey(listener);
      tip.setPosition(undefined);
      const g = e.feature.getGeometry();
      const labelEl = el("div", "oly-measure-label", measureText(st, g));
      const ov = new ol.Overlay({ element: labelEl, offset: [0, -10], positioning: "bottom-center", stopEvent: false,
        position: g.getType() === "Polygon" ? g.getInteriorPoint().getCoordinates() : g.getLastCoordinate() });
      map.addOverlay(ov);
      st.measureOverlays.push(ov);
      st.cmdUI?.update?.({ status: t("app.oly.status.measured", { value: labelEl.textContent }) });
    });
    map.addInteraction(draw);
    st.measure = { kind: next, draw, tip };
    if (st.selection) clearSelection(st);
  }
  st.cmdUI?.update?.({ status: t(next ? `app.oly.status.tool_${next}` : "app.oly.status.tool_off") });
  syncToolbar(st);
}

export function cancelMeasureDrawing(st) {
  try { st.measure?.draw?.abortDrawing(); } catch {}
  st.measure?.tip?.setPosition(undefined);
}

export function clearMeasures(st) {
  cancelMeasureDrawing(st);
  st.measureLayer?.getSource().clear();
  (st.measureOverlays || []).forEach(o => st.map.removeOverlay(o));
  st.measureOverlays = [];
  st.cmdUI?.update?.({ status: t("app.oly.status.measures_cleared") });
}

// ── Confronto a tendina (swipe) ─────────────────────────────────────────────
// Il layer scelto si vede solo a sinistra della linea; sotto, il resto della mappa.

export function setSwipe(st, L) {
  const { ol, map } = st;
  if (st.swipe) {
    st.swipe.keys.forEach(k => ol.Observable.unByKey(k));
    st.swipe.ui.remove();
    const prev = st.swipe.L;
    st.swipe = null;
    map.render();
    if (prev === L) { st.cmdUI?.update?.({ status: t("app.oly.status.swipe_off") }); return; }
  }
  if (!L?.layer) return;
  const ui = el("div", "oly-swipe");
  const line = el("div", "oly-swipe-line");
  const range = el("input");
  range.type = "range"; range.min = "0"; range.max = "100"; range.value = "50";
  range.className = "oly-swipe-range";
  range.setAttribute("aria-label", t("app.oly.swipe.slider", { name: L.title }));
  ui.append(line, range);
  st.host.appendChild(ui);
  const frac = () => Number(range.value) / 100;
  const place = () => { line.style.left = `${range.value}%`; };
  place();
  range.addEventListener("input", () => { place(); map.render(); });
  const pre = L.layer.on("prerender", e => {
    const size = map.getSize();
    const width = Math.round(size[0] * frac());
    const ctx = e.context;
    if (ctx instanceof CanvasRenderingContext2D) {
      const tl = ol.render.getRenderPixel(e, [0, 0]);
      const tr = ol.render.getRenderPixel(e, [width, 0]);
      const bl = ol.render.getRenderPixel(e, [0, size[1]]);
      const br = ol.render.getRenderPixel(e, [width, size[1]]);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tl[0], tl[1]); ctx.lineTo(tr[0], tr[1]); ctx.lineTo(br[0], br[1]); ctx.lineTo(bl[0], bl[1]);
      ctx.closePath();
      ctx.clip();
    } else if (ctx) {   // WebGL (GeoTIFF in EPSG:3857)
      const bl = ol.render.getRenderPixel(e, [0, size[1]]);
      const tr = ol.render.getRenderPixel(e, [width, 0]);
      ctx.enable(ctx.SCISSOR_TEST);
      ctx.scissor(bl[0], bl[1], Math.max(0, tr[0] - bl[0]), Math.max(0, tr[1] - bl[1]));
    }
  });
  const post = L.layer.on("postrender", e => {
    const ctx = e.context;
    if (ctx instanceof CanvasRenderingContext2D) ctx.restore();
    else if (ctx) ctx.disable(ctx.SCISSOR_TEST);
  });
  st.swipe = { L, keys: [pre, post], ui };
  if (!L.layer.getVisible()) L.layer.setVisible(true);
  map.render();
  st.cmdUI?.update?.({ status: t("app.oly.status.swipe_on", { name: L.title }) });
}

// ── Viste salvate (mod_spec.views del primo modello) ────────────────────────
// { name, center:[lon,lat], zoom, rotation (gradi), base, layers:{ key: visibile } }

function parseSpec(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

export function loadViews(st) {
  const v = parseSpec(st.models[0]?.mod_spec).views;
  return (Array.isArray(v) ? v : []).filter(x => x && typeof x.name === "string" && Array.isArray(x.center));
}

function currentView(st, name) {
  const view = st.map.getView();
  const [lon, lat] = st.ol.proj.toLonLat(view.getCenter());
  const layers = {};
  st.layers.forEach(L => { if (L.layer) layers[L.key] = L.layer.getVisible(); });
  return { name, center: [+lon.toFixed(7), +lat.toFixed(7)], zoom: +view.getZoom().toFixed(2),
    rotation: +(view.getRotation() * 180 / Math.PI).toFixed(2), base: st.baseId, layers };
}

export async function goToView(st, v) {
  if (v.base && v.base !== st.baseId) await st.setBase(v.base);
  if (v.layers && typeof v.layers === "object") {
    st.layers.forEach(L => { if (L.layer && L.key in v.layers) L.layer.setVisible(!!v.layers[L.key]); });
  }
  st.renderLayers?.();
  st.cmdUI?.update?.({ status: t("app.oly.views.went", { name: v.name }) });
  // risolve quando la mappa è arrivata (i nodi emettono done dopo)
  await new Promise(res => st.map.getView().animate({ center: st.ol.proj.fromLonLat(v.center), zoom: Number(v.zoom) || 16,
    rotation: (Number(v.rotation) || 0) * Math.PI / 180, duration: 500 }, () => res()));
}

async function saveViews(st) {
  const row = st.models[0];
  if (!row?.mod_id) { st.cmdUI?.update?.({ status: t("app.oly.views.no_model") }); return; }
  const spec = { ...parseSpec(row.mod_spec), views: st.views.map(v => ({ ...v })) };
  st.cmdUI?.update?.({ status: t("app.oly.views.saving") });
  try {
    const res = await fetch("api/mod_spec_tool.php", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action: "save", mod_id: row.mod_id, mod_spec: spec }),
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) {
      row.mod_spec = spec;
      st.viewsDirty = false;
      st.cmdUI?.update?.({ status: t("app.oly.views.saved", { n: st.views.length }) });
    } else {
      st.cmdUI?.update?.({ status: t("app.oly.views.error", { msg: data?.error || `HTTP ${res.status}` }) });
    }
  } catch {
    st.cmdUI?.update?.({ status: t("errors.network") });
  }
  renderViews(st);
}

export function renderViews(st) {
  const w = st.win.views;
  if (!w?.visible) return;
  const uid = `olyV_${st.uid}`;
  const form = el("form", "oly-form");
  const lbl = el("label", "", t("app.oly.views.name")); lbl.htmlFor = `${uid}_n`;
  const row = el("div", "oly-form-row");
  const inp = el("input"); inp.type = "text"; inp.id = `${uid}_n`; inp.required = true; inp.autocomplete = "off";
  const add = el("button", "tjs-rpanel-addbar-btn"); add.type = "submit";
  add.innerHTML = `<i class="bi bi-plus-lg" aria-hidden="true"></i>&nbsp;${te("app.oly.views.add")}`;
  row.append(inp, add);
  form.append(lbl, row);
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const name = inp.value.trim();
    if (!name) return;
    const v = currentView(st, name);
    const i = st.views.findIndex(x => x.name === name);
    if (i >= 0) st.views[i] = v; else st.views.push(v);
    st.viewsDirty = true;
    renderViews(st);
  });
  const list = el("ul", "oly-results");
  list.setAttribute("aria-label", t("app.oly.views.title"));
  if (!st.views.length) list.appendChild(el("li", "oly-empty", t("app.oly.views.empty")));
  st.views.forEach((v, i) => {
    const li = el("li", "oly-view-row");
    const go = el("button", "oly-result");
    go.type = "button";
    go.append(el("span", "oly-result-name", v.name));
    go.addEventListener("click", () => goToView(st, v));
    li.append(go, iconBtn("bi-x-lg", t("app.oly.views.remove", { name: v.name }), () => {
      st.views.splice(i, 1); st.viewsDirty = true; renderViews(st);
    }));
    list.appendChild(li);
  });
  const nodes = [form, list];
  if (panelLevel(st.bodyEl) >= 30) {
    const bar = el("div", "oly-actions");
    bar.appendChild(textBtn("bi-cloud-upload", t("app.oly.views.save"), () => saveViews(st)));
    if (st.viewsDirty) bar.appendChild(el("span", "oly-hint", t("app.oly.views.unsaved")));
    nodes.push(bar);
  } else if (st.viewsDirty) {
    nodes.push(el("p", "oly-hint", t("app.oly.views.memory_only")));
  }
  w.list.replaceChildren(...nodes);
}

// ── Esporta PNG ─────────────────────────────────────────────────────────────
// Unisce i canvas dei layer (esempio "export-map" di OpenLayers) e scrive le attribuzioni in basso.
// Un servizio senza CORS (es. catasto AdE) "sporca" il canvas: si dice quale layer spegnere.

export function exportPng(st) {
  const { map } = st;
  map.once("rendercomplete", () => {
    try {
      const size = map.getSize();
      const out = document.createElement("canvas");
      out.width = size[0]; out.height = size[1];
      const ctx = out.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      map.getViewport().querySelectorAll(".ol-layer canvas, canvas.ol-layer").forEach(canvas => {
        if (!canvas.width) return;
        const opacity = canvas.parentNode.style.opacity || canvas.style.opacity;
        ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
        const tr = canvas.style.transform;
        const m = tr && tr.match(/^matrix\(([^(]*)\)$/);
        const matrix = m ? m[1].split(",").map(Number)
          : [parseFloat(canvas.style.width) / canvas.width, 0, 0, parseFloat(canvas.style.height) / canvas.height, 0, 0];
        ctx.setTransform(...matrix);
        ctx.drawImage(canvas, 0, 0);
      });
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // attribuzioni (obbligatorie per OSM, Esri, AdE…)
      const attr = [...map.getViewport().querySelectorAll(".ol-attribution li")].map(li => li.textContent.trim()).filter(Boolean).join(" · ");
      if (attr) {
        ctx.font = "11px system-ui, sans-serif";
        const w = Math.min(out.width - 8, ctx.measureText(attr).width + 10);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(out.width - w - 4, out.height - 20, w, 16);
        ctx.fillStyle = "#111827";
        ctx.fillText(attr, out.width - w + 1, out.height - 8, w - 8);
      }
      out.toBlob(blob => {
        if (!blob) { st.cmdUI?.update?.({ status: t("app.oly.export.error", { msg: "toBlob" }) }); return; }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${String(st.object?.obj_name || "mappa").replace(/[^\w\-]+/g, "_")}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        st.lastExport = { width: out.width, height: out.height, size: blob.size };
        st.cmdUI?.update?.({ status: t("app.oly.export.done") });
      }, "image/png");
    } catch (e) {
      const blocking = st.layers.filter(L => L.layer?.getVisible() && L.kind === "service" && !L.service?.cors && !L.service?.proxy).map(L => L.title);
      if (st.baseLayer && st.catalog?.get(st.baseId)?.cors === false) blocking.push(st.catalog.get(st.baseId).title);
      st.cmdUI?.update?.({ status: blocking.length ? t("app.oly.export.blocked", { names: blocking.join(", ") }) : t("app.oly.export.error", { msg: e.message }) });
      st.lastExport = { error: e.message, blocking };
    }
  });
  map.renderSync();
}
