// app/OLY_sub_modules/OLY-layers.mjs
// Catalogo dei servizi (lib/map-services.json) e costruzione dei layer di OLY (_doc/module-oly-openlayers.md §8).
//
// Un modello = un layer, riconosciuto dall'estensione del file e dalla spec:
//   .geojson / .json      → vettoriale GeoJSON      (spec: style, dataProjection)
//   .kml / .gpx           → vettoriale KML / GPX     (spec: style — per KML, senza style restano gli stili del file)
//   .tif / .tiff          → GeoTIFF (meglio COG)    (spec: projection se il file non la dichiara)
//   .jpg .jpeg .png .webp → immagine georiferita    (spec: extent [minX,minY,maxX,maxY] + projection)
//   qualsiasi / nessuno   → servizio del catalogo   (spec: service = id)
// Comuni: title, visible, opacity.

const CATALOG_URL = "lib/map-services.json";
let _catalogPromise = null;

// geotiff.js: il pacchetto ol.js la usa come globale (GeoTIFF) ma non la contiene.
// Caricata solo quando serve (primo layer .tif). Versione compatibile con OpenLayers 10.11.
const GEOTIFF_JS = "https://cdn.jsdelivr.net/npm/geotiff@3.0.5/dist-browser/geotiff.js";
let _geotiffPromise = null;

function ensureGeoTIFF() {
  if (globalThis.GeoTIFF?.fromUrl) return Promise.resolve(globalThis.GeoTIFF);
  if (!_geotiffPromise) {
    _geotiffPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GEOTIFF_JS;
      s.onload = () => globalThis.GeoTIFF?.fromUrl ? resolve(globalThis.GeoTIFF) : reject(new Error("geotiff.js not available"));
      s.onerror = () => { _geotiffPromise = null; reject(new Error(`file not loaded: ${GEOTIFF_JS}`)); };
      document.head.appendChild(s);
    });
  }
  return _geotiffPromise;
}

/** Map id → servizio. Il catalogo si legge una volta per pagina. */
export function loadCatalog() {
  if (!_catalogPromise) {
    _catalogPromise = fetch(CATALOG_URL, { cache: "no-cache", credentials: "same-origin" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(j => new Map((Array.isArray(j?.services) ? j.services : []).filter(s => s?.id).map(s => [String(s.id), s])))
      .catch(e => { _catalogPromise = null; throw e; });
  }
  return _catalogPromise;
}

export function urlExt(url) {
  const clean = String(url || "").split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

const VECTOR_EXT = new Set(["geojson", "json", "kml", "gpx"]);
const IMAGE_EXT  = new Set(["jpg", "jpeg", "png", "webp"]);
const TIFF_EXT   = new Set(["tif", "tiff"]);

// ── Stili dei vettoriali ────────────────────────────────────────────────────

export const DEFAULT_STYLE = {
  stroke: "#e11d48", width: 2, fill: "rgba(225, 29, 72, 0.18)",
  radius: 5, pointColor: null, label: null, labelColor: "#111827",
};

export function makeStyle(ol, styleSpec) {
  const s = { ...DEFAULT_STYLE, ...(styleSpec || {}) };
  const stroke = new ol.style.Stroke({ color: s.stroke, width: Number(s.width) || 2 });
  const fill = new ol.style.Fill({ color: s.fill });
  const image = new ol.style.Circle({
    radius: Number(s.radius) || 5,
    fill: new ol.style.Fill({ color: s.pointColor || s.stroke }),
    stroke: new ol.style.Stroke({ color: "#ffffff", width: 1.5 }),
  });
  if (!s.label) return new ol.style.Style({ stroke, fill, image });
  const base = { stroke, fill, image };
  return feature => new ol.style.Style({
    ...base,
    text: new ol.style.Text({
      text: String(feature.get(s.label) ?? ""),
      font: "12px system-ui, sans-serif",
      fill: new ol.style.Fill({ color: s.labelColor }),
      stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
      offsetY: -12,
      overflow: true,
    }),
  });
}

// ── Servizi del catalogo ────────────────────────────────────────────────────

/** Layer di un servizio del catalogo. Errore se manca, è spento o il tipo è sconosciuto. */
const PROXY_API = "api/map_proxy.php";

export function buildServiceLayer(ol, svc) {
  if (!svc) throw new Error("service not in the catalog");
  if (svc.enabled === false) throw new Error(svc.notes || "service disabled in the catalog");
  const attributions = svc.attributions ? [svc.attributions] : undefined;
  // cors:true nel catalogo = il servizio permette di leggere le immagini (richieste anonime):
  // serve a esportare la mappa in PNG. Senza, le immagini si vedono ma "sporcano" il canvas.
  const crossOrigin = svc.cors ? "anonymous" : undefined;
  if (svc.type === "osm") {
    return new ol.layer.Tile({ source: new ol.source.OSM({ maxZoom: svc.maxZoom ?? 19, crossOrigin: crossOrigin ?? null }) });
  }
  if (svc.type === "xyz") {
    return new ol.layer.Tile({ source: new ol.source.XYZ({ url: svc.url, attributions, maxZoom: svc.maxZoom ?? 19, crossOrigin }) });
  }
  if (svc.type === "wms") {
    // proxy:true = richieste dal server (api/map_proxy.php): servizi solo http o senza CORS.
    // Stessa origine della pagina: niente crossOrigin, la mappa si esporta e GetFeatureInfo si legge.
    return new ol.layer.Image({
      source: new ol.source.ImageWMS({
        url: svc.proxy ? `${PROXY_API}?svc=${encodeURIComponent(svc.id)}` : svc.url,
        params: {
          LAYERS: svc.layers, VERSION: svc.version || "1.3.0",
          FORMAT: svc.format || "image/png", TRANSPARENT: svc.transparent !== false,
        },
        projection: svc.projection || undefined,
        ratio: 1,
        attributions,
        crossOrigin: svc.proxy ? undefined : crossOrigin,
      }),
    });
  }
  throw new Error(`unknown service type "${svc.type}"`);
}

// ── Layer da un modello ─────────────────────────────────────────────────────

/**
 * → { layer, kind, title, styleSpec?, service?, extent?() } oppure null se il modello non è un layer.
 * Lancia un errore se il modello è un layer ma non si può costruire (file illeggibile, servizio spento…).
 */
export async function buildModelLayer(ol, row, spec, catalog, signal) {
  const url = row?.mod_abs_url || "";
  const ext = urlExt(url);
  const title = String(spec.title || row?.mod_name || url.split("/").pop() || "layer");
  const common = layer => {
    if (Number.isFinite(spec.opacity)) layer.setOpacity(Math.min(Math.max(spec.opacity, 0), 1));
    layer.setVisible(spec.visible !== false);
    return layer;
  };

  if (spec.service) {
    const svc = catalog.get(String(spec.service));
    const layer = common(buildServiceLayer(ol, svc));
    // il nome del modello prevale sul titolo del catalogo
    return { layer, kind: "service", title: String(spec.title || row?.mod_name || svc.title), service: svc };
  }

  if (VECTOR_EXT.has(ext)) {
    const res = await fetch(url, { credentials: "same-origin", signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let format, readOpts = { featureProjection: "EPSG:3857" };
    if (ext === "kml") {
      format = new ol.format.KML({ extractStyles: !spec.style });
    } else if (ext === "gpx") {
      format = new ol.format.GPX();
    } else {
      format = new ol.format.GeoJSON();
      let declared = null;
      try { declared = format.readProjection(text)?.getCode?.(); } catch {}
      readOpts.dataProjection = spec.dataProjection || declared || "EPSG:4326";
      if (!ol.proj.get(readOpts.dataProjection)) throw new Error(`unknown projection ${readOpts.dataProjection}`);
    }
    const features = format.readFeatures(text, readOpts);
    const source = new ol.source.Vector({ features });
    const layer = new ol.layer.Vector({ source });
    if (ext !== "kml" || spec.style) layer.setStyle(makeStyle(ol, spec.style));
    common(layer);
    return {
      layer, kind: "vector", title, styleSpec: { ...DEFAULT_STYLE, ...(spec.style || {}) },
      count: features.length,
      // disegno (F4): solo i GeoJSON si riscrivono, nel loro sistema di coordinate
      editable: ext === "geojson" || ext === "json",
      dataProjection: readOpts.dataProjection || "EPSG:4326",
      row,
      extent: () => (source.getFeatures().length ? source.getExtent() : null),
    };
  }

  if (TIFF_EXT.has(ext)) {
    if (spec.projection && !ol.proj.get(spec.projection)) throw new Error(`unknown projection ${spec.projection}`);
    const GT = await ensureGeoTIFF();
    // sistema del file: dalla spec, altrimenti dalle chiavi GeoTIFF
    const tiff = await GT.fromUrl(url);
    const image = await tiff.getImage();
    const keys = image.getGeoKeys?.() || {};
    const code = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey;
    const projection = spec.projection || (code ? `EPSG:${code}` : null);
    if (!projection) throw new Error("the GeoTIFF does not declare its projection: write it in the spec (projection)");
    if (!ol.proj.get(projection)) throw new Error(`unknown projection ${projection}`);
    const bbox = image.getBoundingBox();

    // In EPSG:3857 (come la mappa): layer WebGL che legge il file a pezzi (adatto ai COG grandi).
    // In altri sistemi il layer WebGL di OpenLayers 10.11 non riproietta: si legge l'immagine
    // (al più 4096 px di lato) e la si mostra come immagine georiferita, che OpenLayers riproietta.
    if (ol.proj.equivalent(ol.proj.get(projection), ol.proj.get("EPSG:3857"))) {
      const source = new ol.source.GeoTIFF({ sources: [{ url }], convertToRGB: "auto", projection });
      const layer = common(new ol.layer.WebGLTile({ source }));
      return { layer, kind: "raster", title, extent: () => bbox.slice() };
    }
    const w = image.getWidth(), h = image.getHeight();
    const k = Math.min(1, 4096 / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    const rgb = await image.readRGB({ width: W, height: H, interleave: true, enableAlpha: true });
    const channels = rgb.length / (W * H);
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0, j = 0; i < W * H; i++, j += channels) {
      rgba[i * 4] = rgb[j]; rgba[i * 4 + 1] = rgb[j + 1]; rgba[i * 4 + 2] = rgb[j + 2];
      rgba[i * 4 + 3] = channels >= 4 ? rgb[j + 3] : 255;
    }
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    canvas.getContext("2d").putImageData(new ImageData(rgba, W, H), 0, 0);
    const layer = common(new ol.layer.Image({
      source: new ol.source.ImageStatic({ url: canvas.toDataURL("image/png"), imageExtent: bbox, projection }),
    }));
    return { layer, kind: "raster", title, extent: () => ol.proj.transformExtent(bbox, projection, "EPSG:3857") };
  }

  if (IMAGE_EXT.has(ext) && Array.isArray(spec.extent)) {
    const ex = spec.extent.map(Number);
    if (ex.length !== 4 || !ex.every(Number.isFinite)) throw new Error("extent must be [minX, minY, maxX, maxY]");
    const projection = spec.projection || "EPSG:4326";
    if (!ol.proj.get(projection)) throw new Error(`unknown projection ${projection}`);
    const layer = common(new ol.layer.Image({
      source: new ol.source.ImageStatic({ url, imageExtent: ex, projection }),
    }));
    return { layer, kind: "image", title, extent: () => ol.proj.transformExtent(ex, projection, "EPSG:3857") };
  }

  return null;   // modello che non è un layer (es. un'immagine senza extent)
}
