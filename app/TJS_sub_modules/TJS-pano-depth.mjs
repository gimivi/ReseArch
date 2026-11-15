// TJS_sub_modules/TJS-pano-depth.mjs
// Misura sulle panoramiche sferiche con la mappa delle distanze di MoGe / DA2 (2026-10-19).
//
// La mappa arriva da ComfyUI come EXR a un canale (research_bridge: ReseArch Depth Output): distanza
// dal punto di ripresa per pixel, 0 = non valido. Il punto 3D di un pixel della panoramica è
//
//     punto = centro della sfera + direzione(uv) × distanza(uv) × scala
//
// senza mesh: la direzione viene dalla geometria della sfera (loadPSH: SphereGeometry con
// scale(-1, 1, 1)) e dalla sua trasformazione nella scena, la distanza dal pixel (u, 1 − v)
// dell'EXR. La scala converte le unità della mappa in metri della scena. Le panoramiche di MoGe e di
// DA2 danno distanze RELATIVE (MoGePanoramaInference fonde 12 viste con apply_metric_scale=False):
// si calibra con tjsDepthScaleFromPair (distanza nota fra due punti). 1 solo per mappe già in metri.
//
// Sfera panoramica = marcata esplicitamente (userData.__tjs_panorama__): da loadPSH o, per le sfere
// costruite nei flow, dal nodo TJS/Panorama/Mark (2026-10-19, scelta dell'utente: nessun riconoscimento
// automatico dalle forme o dalle texture). Solo le sfere marcate ricevono una mappa e perdono
// l'aggancio ai vertici di Collima/Misura.
//
// Associazione sfera ↔ mappa: sphere.userData.__tjs_panoDepth__ = { url, scale, map|null, units, source }
// (TJS/Panorama/Set Depth, oppure mod_spec.panoDepth = { url, scale } del modello panoramico).
// Collima e Misura, colpendo una sfera associata, usano il punto 3D (tjsApplyPanoramaDepth).

import * as THREE from 'three';   // non da TJS-loaders: quel modulo importa questo (loadPSH)
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

const _cache = new Map();   // url → Promise<depth map>

/**
 * Carica (una volta per URL) una mappa delle distanze EXR.
 * → { width, height, data: Float32Array (righe dal basso, come EXRLoader), units, source, url }
 */
export function tjsLoadDepthMap(url) {
  if (!url) return Promise.reject(new Error('depth map: URL missing'));
  if (!_cache.has(url)) {
    const loader = new EXRLoader();
    loader.setDataType(THREE.FloatType);
    if (loader.setOutputFormat) loader.setOutputFormat(THREE.RedFormat);
    else loader.outputFormat = THREE.RedFormat;
    // parse() sui byte invece di loadAsync(): solo così arriva anche l'intestazione (unità, sorgente)
    const file = new THREE.FileLoader();
    file.setResponseType('arraybuffer');
    const p = file.loadAsync(url).then((buffer) => {
      const r = loader.parse(buffer);
      const ch = r?.data && r.width && r.height ? r.data.length / (r.width * r.height) : 0;
      if (!ch) throw new Error('depth map: no data in the EXR');
      // un solo canale (RedFormat); se il loader desse più canali si tiene il primo
      let data = r.data;
      if (ch !== 1) {
        data = new Float32Array(r.width * r.height);
        for (let i = 0; i < data.length; i++) data[i] = r.data[i * ch];
      }
      const header = r.header ?? {};
      return { width: r.width, height: r.height, data, url,
               units: header.researchUnits ?? 'relative', source: header.researchSource ?? '' };
    }).catch((e) => { _cache.delete(url); throw e; });
    _cache.set(url, p);
  }
  return _cache.get(url);
}

/** Valore della mappa al pixel (colonna x, riga y dall'alto); 0 = non valido. */
function _px(map, x, y) {
  const { width: W, height: H, data } = map;
  const xx = ((x % W) + W) % W;                      // giro completo in orizzontale (cucitura)
  const yy = Math.min(H - 1, Math.max(0, y));
  return data[(H - 1 - yy) * W + xx];                // EXRLoader: righe dal basso
}

/**
 * Distanza interpolata in (u, v) della panoramica (v = coordinata UV della sfera, 1 in alto).
 * I pixel non validi (0) non entrano nella media; null se nessuno dei quattro è valido.
 */
export function tjsSampleDepth(map, u, v) {
  if (!map || !Number.isFinite(u) || !Number.isFinite(v)) return null;
  const fx = u * map.width - 0.5;                    // centri dei pixel in (i + 0,5) / W, come DA2/MoGe
  const fy = (1 - v) * map.height - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  let sum = 0, wsum = 0;
  for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const d = _px(map, x0 + dx, y0 + dy);
    if (d > 0 && Number.isFinite(d)) { sum += d * w; wsum += w; }
  }
  return wsum > 1e-6 ? sum / wsum : null;
}

/** true se obj è marcato come sfera panoramica (loadPSH o TJS/Panorama/Mark). */
export function tjsIsPanorama(obj) {
  return !!obj?.userData?.__tjs_panorama__;
}

function _isSphereGeo(o) {
  return !!(o?.isMesh && o.geometry?.type === 'SphereGeometry' && o.geometry.attributes?.uv);
}

/**
 * Marca (on = true) o smarca una sfera come panorama: obj deve essere una mesh con SphereGeometry,
 * oppure contenerne una (si prende la prima). Restituisce la sfera, o null se non ce n'è.
 */
export function tjsMarkPanorama(obj, on = true) {
  let sphere = _isSphereGeo(obj) ? obj : null;
  if (!sphere) obj?.traverse?.((o) => { if (!sphere && _isSphereGeo(o)) sphere = o; });
  if (!sphere) return null;
  if (on) sphere.userData.__tjs_panorama__ = true;
  else delete sphere.userData.__tjs_panorama__;
  return sphere;
}

/**
 * Sfera panoramica MARCATA a partire da un oggetto indicato (la sfera, un antenato o un discendente)
 * o, senza oggetto, la prima marcata della scena. null se non ce n'è.
 */
export function tjsFindPanorama(obj, scene = null) {
  if (tjsIsPanorama(obj)) return obj;
  let found = null;
  (obj ?? scene)?.traverse?.((o) => { if (!found && tjsIsPanorama(o)) found = o; });
  if (!found && obj) {                               // obj figlio della sfera
    for (let o = obj.parent; o; o = o.parent) if (tjsIsPanorama(o)) { found = o; break; }
  }
  return found;
}

/**
 * Parametri di SphereGeometry e verso dello specchio in X, letti dalla geometria (in cache):
 * s = −1 senza specchio (formula di three: x = −cos φ · sin θ), +1 con la geometria specchiata
 * come in loadPSH (scale(-1,1,1)). Lo specchio sull'oggetto (SetScale −1) resta nella matrice.
 */
function _sphereFrame(geo) {
  if (geo.userData.__tjs_sphereFrame__) return geo.userData.__tjs_sphereFrame__;
  const p = geo.parameters ?? {};
  const f = {
    phiStart: p.phiStart ?? 0, phiLength: p.phiLength ?? Math.PI * 2,
    thetaStart: p.thetaStart ?? 0, thetaLength: p.thetaLength ?? Math.PI, s: -1,
  };
  // un vertice vero, all'equatore: quale delle due formule lo ritrova?
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const ws = p.widthSegments ?? 32, hs = p.heightSegments ?? 16;
  const i = Math.round(hs / 2) * (ws + 1) + Math.max(1, Math.round(ws / 8));
  if (pos && uv && i < pos.count) {
    const actual = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
    const a = _localDir(f, uv.getX(i), uv.getY(i), -1, new THREE.Vector3());
    const b = _localDir(f, uv.getX(i), uv.getY(i), +1, new THREE.Vector3());
    f.s = actual.distanceToSquared(b) < actual.distanceToSquared(a) ? +1 : -1;
  }
  geo.userData.__tjs_sphereFrame__ = f;
  return f;
}

function _localDir(f, u, v, s, out) {
  const phi = f.phiStart + u * f.phiLength;
  const theta = f.thetaStart + (1 - v) * f.thetaLength;
  return out.set(s * Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

/**
 * Direzione nel mondo del punto (u, v) della sfera panoramica: formula di SphereGeometry
 * (φ = φ0 + u·Δφ, θ = θ0 + (1 − v)·Δθ) con lo specchio letto dalla geometria, poi la
 * trasformazione della sfera (rotazione, specchio sull'oggetto).
 */
export function tjsPanoramaDirection(sphere, u, v, out = new THREE.Vector3()) {
  const f = _sphereFrame(sphere.geometry);
  _localDir(f, u, v, f.s, out);
  sphere.updateWorldMatrix(true, false);
  return out.transformDirection(sphere.matrixWorld);
}

/**
 * Punto 3D del pixel (u, v): { point, direction, distance (scena), raw (unità della mappa) } o null.
 */
export function tjsDepthPoint(sphere, map, u, v, scale = 1) {
  const raw = tjsSampleDepth(map, u, v);
  if (raw == null || !sphere) return null;
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const center = sphere.getWorldPosition(new THREE.Vector3());
  const direction = tjsPanoramaDirection(sphere, u, v);
  const distance = raw * s;
  return { point: center.clone().addScaledVector(direction, distance), direction, distance, raw };
}

/**
 * Calibrazione: scala che rende `knownDistance` (metri) la distanza fra i punti (uA) e (uB).
 * → { scale, rawLength } o null se uno dei due pixel non è valido.
 */
export function tjsDepthScaleFromPair(sphere, map, uvA, uvB, knownDistance) {
  const a = tjsDepthPoint(sphere, map, uvA?.u, uvA?.v, 1);
  const b = tjsDepthPoint(sphere, map, uvB?.u, uvB?.v, 1);
  const k = Number(knownDistance);
  if (!a || !b || !(k > 0)) return null;
  const rawLength = a.point.distanceTo(b.point);
  if (!(rawLength > 1e-9)) return null;
  return { scale: k / rawLength, rawLength };
}

// ── Associazione sfera ↔ mappa ────────────────────────────────────────────────

/** Associa una mappa alla sfera e la carica. → Promise<info> (info.map pronto). */
export function tjsSetPanoramaDepth(sphere, { url, scale } = {}) {
  if (!sphere || !url) return Promise.reject(new Error('panorama depth: sphere or URL missing'));
  if (!tjsIsPanorama(sphere)) {
    return Promise.reject(new Error('the sphere is not marked as panorama: add TJS/Panorama/Mark after it'));
  }
  const prev = sphere.userData.__tjs_panoDepth__;
  const info = { url, scale: Number(scale) > 0 ? Number(scale) : (prev?.url === url ? prev.scale : 1),
                 map: prev?.url === url ? prev.map : null, units: prev?.units ?? null, source: prev?.source ?? '' };
  sphere.userData.__tjs_panoDepth__ = info;
  return tjsLoadDepthMap(url).then((map) => {
    if (sphere.userData.__tjs_panoDepth__ !== info) return info;   // sostituita nel frattempo
    info.map = map; info.units = map.units; info.source = map.source;
    return info;
  });
}

/** Informazioni della mappa associata (anche se ancora in caricamento), o null. */
export function tjsGetPanoramaDepth(sphere) {
  return sphere?.userData?.__tjs_panoDepth__ ?? null;
}

/**
 * Per Collima / Misura: se l'hit è su una sfera panoramica con mappa associata e caricata,
 * restituisce un hit con il punto 3D al posto di quello sulla sfera (e panoDepth con i dettagli);
 * { pending: true } se la mappa è ancora in caricamento; null se non c'entra.
 */
export function tjsApplyPanoramaDepth(hit) {
  const sphere = hit?.object;
  if (!tjsIsPanorama(sphere) || !hit.uv) return null;
  const info = tjsGetPanoramaDepth(sphere);
  if (!info) return null;
  if (!info.map) return { pending: true };
  const r = tjsDepthPoint(sphere, info.map, hit.uv.x ?? hit.uv.u, hit.uv.y ?? hit.uv.v, info.scale);
  if (!r) return { invalid: true };
  return {
    ...hit,
    point: r.point,
    distance: r.distance,
    panoDepth: { distance: r.distance, raw: r.raw, scale: info.scale, units: info.units,
                 sphere: sphere.uuid, spherePoint: hit.point.clone() },
  };
}
