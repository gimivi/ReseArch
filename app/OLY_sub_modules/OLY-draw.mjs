// app/OLY_sub_modules/OLY-draw.mjs
// Disegno (F4, _doc/module-oly-openlayers.md §11): punti, linee, poligoni; modifica dei vertici;
// eliminazione; attributi; salvataggio come GeoJSON con l'upload esistente (ui/modal_uploads_tools.php).
//
// Livello di disegno: "Nuovo disegno" (layer in memoria, salvato come NUOVO file .geojson nella cartella
// del primo modello) oppure un layer GeoJSON dell'oggetto (il suo file viene riscritto).
// Strumenti a uno per volta (st.draw.mode): point | line | polygon | modify | delete | null.
// Con point/line/polygon/delete il clic non seleziona; con modify sì (per gli attributi).

import { t, te } from "../shared/i18n.mjs";
import { panelLevel } from "../shared/ui_level.mjs";
import { el, setWindowVisible, selectFeature, clearSelection, featureName } from "./OLY-tools.mjs";
import { makeStyle } from "./OLY-layers.mjs";

const UPLOAD_API = "ui/modal_uploads_tools.php";
const SKETCH_KEY = "__sketch";
const MODES = {
  point:   { type: "Point",      icon: "bi-geo-alt",    label: "app.oly.draw.point" },
  line:    { type: "LineString", icon: "bi-bezier2",    label: "app.oly.draw.line" },
  polygon: { type: "Polygon",    icon: "bi-pentagon",   label: "app.oly.draw.polygon" },
  modify:  {                     icon: "bi-vector-pen", label: "app.oly.draw.modify" },
  delete:  {                     icon: "bi-trash3",     label: "app.oly.draw.delete" },
};

export const drawBlocksClick = st => ["point", "line", "polygon", "delete"].includes(st.draw?.mode);

function ensureDrawState(st) {
  if (!st.draw) st.draw = { mode: null, targetKey: SKETCH_KEY, interactions: [], dirty: new Set(), added: [] };
  return st.draw;
}

// Layer "Nuovo disegno": creato al primo uso, come layer del pannello (finestra Layer, ricerca, colori)
function ensureSketch(st) {
  let L = st.layers.find(x => x.key === SKETCH_KEY);
  if (L) return L;
  const { ol, map } = st;
  const source = new ol.source.Vector();
  const styleSpec = { stroke: "#0d9488", fill: "rgba(13, 148, 136, 0.2)", width: 2, label: "name" };
  const layer = new ol.layer.Vector({ source, style: makeStyle(ol, styleSpec) });
  L = {
    key: SKETCH_KEY, layer, kind: "vector", title: t("app.oly.draw.sketch"), sketch: true, editable: true,
    dataProjection: "EPSG:4326", styleSpec: { stroke: styleSpec.stroke, fill: styleSpec.fill }, count: 0,
    extent: () => (source.getFeatures().length ? source.getExtent() : null),
  };
  st.layers.push(L);
  map.addLayer(layer);
  st.layers.forEach((x, i) => x.layer?.setZIndex(10 + i));
  st.renderLayers?.();
  return L;
}

function targetLayer(st) {
  const d = ensureDrawState(st);
  if (d.targetKey === SKETCH_KEY) return ensureSketch(st);
  return st.layers.find(x => x.key === d.targetKey && x.editable) ?? ensureSketch(st);
}

function markDirty(st, L) {
  ensureDrawState(st).dirty.add(L.key);
  L.count = L.layer.getSource().getFeatures().length;
  renderDraw(st);
}

export function setDrawMode(st, mode) {
  const { ol, map } = st;
  const d = ensureDrawState(st);
  d.interactions.forEach(i => map.removeInteraction(i));
  d.interactions = [];
  const next = d.mode === mode ? null : mode;
  d.mode = next;
  if (next) {
    if (st.measure?.kind) st.setMeasure?.(st.measure.kind);   // spegne la misura accesa
    const L = targetLayer(st);
    if (!L.layer.getVisible()) L.layer.setVisible(true);
    const source = L.layer.getSource();
    if (MODES[next].type) {
      const draw = new ol.interaction.Draw({ source, type: MODES[next].type });
      draw.on("drawend", e => {
        d.added.push({ L, f: e.feature });
        setTimeout(() => { markDirty(st, L); selectFeature(st, e.feature, L); }, 0);
      });
      d.interactions.push(draw);
    } else if (next === "modify") {
      const modify = new ol.interaction.Modify({ source });
      modify.on("modifyend", () => markDirty(st, L));
      d.interactions.push(modify);
    }
    if (next !== "delete") d.interactions.push(new ol.interaction.Snap({ source }));
    d.interactions.forEach(i => map.addInteraction(i));
    if (next !== "modify" && st.selection) clearSelection(st);
  }
  st.cmdUI?.update?.({ status: t(next ? `app.oly.draw.status_${next}` : "app.oly.draw.status_off") });
  renderDraw(st);
}

export function cancelDrawing(st) {
  for (const i of st.draw?.interactions ?? []) { try { i.abortDrawing?.(); } catch {} }
}

// Clic in modalità "elimina": toglie l'elemento del layer di disegno sotto il cursore
export function installDrawClick(st) {
  st.map.on("singleclick", ev => {
    if (st.draw?.mode !== "delete" || st.stopped) return;
    const L = targetLayer(st);
    let hit = null;
    st.map.forEachFeatureAtPixel(ev.pixel, (f, layer) => { if (layer === L.layer) { hit = f; return true; } return undefined; }, { hitTolerance: 5 });
    if (!hit) return;
    if (st.selection?.f === hit) clearSelection(st);
    L.layer.getSource().removeFeature(hit);
    markDirty(st, L);
  });
}

export function undoLast(st) {
  const d = ensureDrawState(st);
  const last = d.added.pop();
  if (!last) return;
  const src = last.L.layer.getSource();
  if (src.hasFeature?.(last.f) ?? src.getFeatures().includes(last.f)) {
    if (st.selection?.f === last.f) clearSelection(st);
    src.removeFeature(last.f);
    markDirty(st, last.L);
  }
}

// ── Salvataggio ─────────────────────────────────────────────────────────────

function folderRow(st) {
  return st.models.find(r => r?.mod_folder_id) ?? null;
}

function slug(s) {
  return String(s || "disegno").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "disegno";
}

async function upload(file, folderId, relativePath) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder_id", String(folderId));
  fd.append("relativePath", relativePath);
  const r = await fetch(UPLOAD_API, { method: "POST", body: fd, credentials: "same-origin" });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.data;
}

export async function saveDrawing(st, sketchName) {
  const { ol } = st;
  const L = targetLayer(st);
  const features = L.layer.getSource().getFeatures();
  const proj = L.dataProjection || "EPSG:4326";
  const geo = proj === "EPSG:4326" || proj === "EPSG:4258" || proj === "EPSG:6706";
  const obj = new ol.format.GeoJSON().writeFeaturesObject(features, {
    dataProjection: proj, featureProjection: "EPSG:3857", decimals: geo ? 7 : 3,
  });
  // sistema diverso da WGS84: lo si dichiara nel file (come il file originale)
  if (!geo || proj !== "EPSG:4326") obj.crs = { type: "name", properties: { name: proj } };
  const text = JSON.stringify(obj, null, 1);

  let row, relativePath;
  if (L.sketch) {
    row = folderRow(st);
    if (!row) throw new Error(t("app.oly.draw.no_folder"));
    const dir = String(row.mod_filename || "").replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    relativePath = (dir ? dir + "/" : "") + slug(sketchName) + ".geojson";
  } else {
    row = L.row;
    relativePath = String(row?.mod_filename || "").replace(/\\/g, "/");
    if (!row?.mod_folder_id || !relativePath) throw new Error(t("app.oly.draw.no_folder"));
  }
  if (!window.confirm(t(L.sketch ? "app.oly.draw.confirm_new" : "app.oly.draw.confirm_overwrite", { path: relativePath, n: features.length }))) return null;
  const file = new File([text], relativePath.split("/").pop(), { type: "application/geo+json" });
  await upload(file, row.mod_folder_id, relativePath);
  ensureDrawState(st).dirty.delete(L.key);
  renderDraw(st);
  return { path: relativePath, count: features.length, sketch: !!L.sketch };
}

// ── Finestra Disegno ────────────────────────────────────────────────────────

function toolButton(st, mode) {
  const m = MODES[mode];
  const b = el("button", "oly-draw-tool");
  b.type = "button";
  const on = st.draw?.mode === mode;
  b.setAttribute("aria-pressed", String(on));
  if (on) b.classList.add("active");
  b.innerHTML = `<i class="bi ${m.icon}" aria-hidden="true"></i>`;
  b.appendChild(el("span", "", t(m.label)));
  b.addEventListener("click", () => setDrawMode(st, mode));
  return b;
}

export function renderDraw(st) {
  const w = st.win.draw;
  if (!w?.visible) return;
  const d = ensureDrawState(st);
  const uid = `olyD_${st.uid}`;
  const nodes = [];

  // livello di disegno
  const form = el("div", "oly-form");
  const lbl = el("label", "", t("app.oly.draw.target")); lbl.htmlFor = `${uid}_t`;
  const sel = el("select"); sel.id = `${uid}_t`;
  const opt = (v, text) => { const o = el("option", "", text); o.value = v; if (v === d.targetKey) o.selected = true; sel.appendChild(o); };
  opt(SKETCH_KEY, t("app.oly.draw.sketch"));
  st.layers.filter(L => L.editable && !L.sketch && L.layer).forEach(L => opt(L.key, L.title));
  sel.addEventListener("change", () => {
    const mode = d.mode;
    if (mode) setDrawMode(st, mode);   // spegne sul vecchio livello
    d.targetKey = sel.value;
    if (mode) setDrawMode(st, mode);   // riaccende sul nuovo
    renderDraw(st);
  });
  form.append(lbl, sel);
  nodes.push(form);

  // strumenti
  const tools = el("div", "oly-draw-tools");
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", t("app.oly.draw.tools"));
  Object.keys(MODES).forEach(m => tools.appendChild(toolButton(st, m)));
  nodes.push(tools);
  nodes.push(el("p", "oly-hint oly-draw-hint", t(d.mode ? `app.oly.draw.hint_${d.mode}` : "app.oly.draw.hint_none")));

  // attributi dell'elemento selezionato, se appartiene al livello di disegno
  const L = st.layers.find(x => x.key === d.targetKey) ?? null;
  const selF = st.selection && L && st.selection.L === L ? st.selection.f : null;
  if (selF) {
    const box = el("div", "oly-form oly-attr-edit");
    box.appendChild(el("div", "tjs-rpanel-section", t("app.oly.draw.attributes", { name: featureName(selF) })));
    const props = { ...selF.getProperties() };
    delete props[selF.getGeometryName()];
    Object.keys(props).filter(k => !k.startsWith("__oly")).forEach((k, i) => {
      const row = el("div", "oly-form-row");
      const id = `${uid}_a${i}`;
      const kl = el("label", "oly-attr-k", k); kl.htmlFor = id;
      const inp = el("input"); inp.type = "text"; inp.id = id; inp.value = props[k] == null ? "" : String(props[k]);
      inp.addEventListener("change", () => {
        const v = inp.value, n = Number(v);
        selF.set(k, v !== "" && Number.isFinite(n) && typeof props[k] === "number" ? n : v);
        markDirty(st, L);
        selectFeature(st, selF, L);
      });
      row.append(kl, inp);
      box.appendChild(row);
    });
    const addRow = el("div", "oly-form-row");
    const kIn = el("input"); kIn.type = "text"; kIn.placeholder = t("app.oly.draw.new_key"); kIn.setAttribute("aria-label", t("app.oly.draw.new_key"));
    const vIn = el("input"); vIn.type = "text"; vIn.placeholder = t("app.oly.draw.new_value"); vIn.setAttribute("aria-label", t("app.oly.draw.new_value"));
    const addB = el("button", "tjs-rpanel-addbar-btn"); addB.type = "button";
    addB.innerHTML = `<i class="bi bi-plus-lg" aria-hidden="true"></i>`;
    addB.title = t("app.oly.draw.add_attr"); addB.setAttribute("aria-label", addB.title);
    addB.addEventListener("click", () => {
      const k = kIn.value.trim();
      if (!k || k === selF.getGeometryName()) return;
      selF.set(k, vIn.value);
      markDirty(st, L);
      selectFeature(st, selF, L);
      renderDraw(st);
    });
    addRow.append(kIn, vIn, addB);
    box.appendChild(addRow);
    nodes.push(box);
  } else {
    nodes.push(el("p", "oly-hint oly-draw-hint", t("app.oly.draw.select_hint")));
  }

  // azioni
  const act = el("div", "oly-actions");
  const undo = el("button", "tjs-rpanel-addbar-btn"); undo.type = "button";
  undo.innerHTML = `<i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>&nbsp;${te("app.oly.draw.undo")}`;
  undo.disabled = !d.added.length;
  undo.addEventListener("click", () => undoLast(st));
  act.appendChild(undo);
  const dirty = L && d.dirty.has(L.key);
  if (panelLevel(st.bodyEl) >= 30) {
    const nameIn = el("input"); nameIn.type = "text";
    const isSketch = !L || L.sketch;
    if (isSketch) {
      nameIn.id = `${uid}_n`; nameIn.value = d.sketchName || slug(st.object?.obj_name) + "_disegno";
      nameIn.setAttribute("aria-label", t("app.oly.draw.file_name"));
      nameIn.addEventListener("input", () => { d.sketchName = nameIn.value; });
      act.appendChild(nameIn);
    }
    const save = el("button", "tjs-rpanel-addbar-btn"); save.type = "button";
    save.innerHTML = `<i class="bi bi-cloud-upload" aria-hidden="true"></i>&nbsp;${te(isSketch ? "app.oly.draw.save_new" : "app.oly.draw.save")}`;
    save.disabled = !L || !L.layer.getSource().getFeatures().length && isSketch;
    save.addEventListener("click", async () => {
      try {
        const r = await saveDrawing(st, nameIn.value);
        if (r) st.cmdUI?.update?.({ status: t(r.sketch ? "app.oly.draw.saved_new" : "app.oly.draw.saved", { path: r.path, n: r.count }) });
      } catch (e) {
        st.cmdUI?.update?.({ status: t("app.oly.draw.save_error", { msg: e.message }) });
      }
    });
    act.appendChild(save);
  }
  if (dirty) act.appendChild(el("span", "oly-hint", t("app.oly.draw.unsaved")));
  nodes.push(act);
  w.list.replaceChildren(...nodes);
}

export function openDraw(st) { setWindowVisible(st, "draw", !st.win.draw?.visible); }
