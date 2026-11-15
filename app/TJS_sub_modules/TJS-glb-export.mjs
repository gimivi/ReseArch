// TJS_sub_modules/TJS-glb-export.mjs
//
// Esportazione in GLB di un oggetto della scena così com'è (con le modifiche fatte nel
// pannello: trasformazioni, materiali, parti nascoste…). Usata dal nodo
// TJS/Model/Save Esercitazione; la scena NON viene toccata: si esporta una copia.
//
//   const { glb, stats } = await TJS_exportGlb(obj);   // glb = ArrayBuffer
//
// Preparazione della copia (serve soprattutto ai modelli caricati da VRML):
//  - via lo sfondo VRML (Background → sfere cielo/terra: nel GLB sarebbero geometria) e gli helper;
//  - normali mancanti calcolate (senza, ombre a NaN in three.js);
//  - materiali Phong/Lambert → MeshStandardMaterial (metalness 0, roughness dalla shininess):
//    GLTFExporter li esporterebbe come metallo al 50%;
//  - texture non caricate (file introvabile) tolte dalla copia: farebbero fallire l'esportatore.
// Le parti nascoste non vengono esportate (onlyVisible).

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { TJS_fixMissingNormals } from './TJS-model-check.mjs';
import { t } from '../shared/i18n.mjs';

/** Materiale Phong/Lambert (VRML, OBJ…) → MeshStandardMaterial equivalente; gli altri restano. */
export function TJS_toStandardMaterial(m) {
  if (!m || !(m.isMeshPhongMaterial || m.isMeshLambertMaterial)) return m;
  // shininess: VRMLLoader lascia il valore VRML 0…1; altri loader usano l'esponente Phong (0…~100)
  const raw = m.isMeshPhongMaterial ? (m.shininess ?? 0) : 0;
  const shin = raw <= 1 ? raw : Math.min(1, raw / 100);
  const s = new THREE.MeshStandardMaterial({
    name: m.name,
    color: m.color.clone(),
    emissive: m.emissive?.clone() ?? new THREE.Color(0),
    emissiveIntensity: m.emissiveIntensity ?? 1,
    map: m.map ?? null,
    emissiveMap: m.emissiveMap ?? null,
    normalMap: m.normalMap ?? null,
    alphaMap: m.alphaMap ?? null,
    aoMap: m.aoMap ?? null,
    opacity: m.opacity,
    transparent: m.transparent,
    alphaTest: m.alphaTest,
    side: m.side,
    vertexColors: m.vertexColors,
    flatShading: m.flatShading,
    metalness: 0,
    roughness: 1 - 0.8 * Math.sqrt(THREE.MathUtils.clamp(shin, 0, 1)),
  });
  s.userData = { ...m.userData };
  return s;
}

const TEX_KEYS = ['map', 'emissiveMap', 'normalMap', 'alphaMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'displacementMap', 'lightMap'];

function textureReady(tex) {
  const img = tex?.image;
  if (!img) return false;
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return img.complete && img.naturalWidth > 0;
  return true;
}

/**
 * Copia pronta per l'esportazione. La scena resta com'è: geometrie condivise (le normali
 * mancanti si calcolano comunque, anche nel viewer), materiali convertiti su copie.
 */
export function TJS_prepareForGlb(source) {
  const root = source.clone(true);
  root.updateMatrixWorld(true);
  const stats = { meshes: 0, lines: 0, points: 0, removed: 0, normalsFixed: 0, materialsConverted: 0, textures: 0, texturesMissing: 0 };

  // sfondo VRML (gruppo con renderOrder -Infinity) e helper (griglie, gizmo, box…)
  const drop = [];
  root.traverse((o) => {
    if (o === root) return;
    if (o.renderOrder === -Infinity || o.isTransformControls || o.userData?.noExport || /Helper$/.test(o.type)) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  stats.removed = drop.length;

  stats.normalsFixed = TJS_fixMissingNormals(root).count;

  const converted = new Map();   // materiale originale → copia (le condivisioni restano)
  const seenTex = new Set(), missingTex = new Set();
  const prep = (m) => {
    if (!m) return m;
    if (converted.has(m)) return converted.get(m);
    let out = TJS_toStandardMaterial(m);
    if (out !== m) stats.materialsConverted++;
    for (const k of TEX_KEYS) {
      const tex = out[k];
      if (!tex?.isTexture) continue;
      seenTex.add(tex);
      if (!textureReady(tex)) {
        missingTex.add(tex);
        if (out === m) out = m.clone();
        out[k] = null;
      }
    }
    converted.set(m, out);
    return out;
  };
  root.traverse((o) => {
    if (o.isMesh) stats.meshes++; else if (o.isLineSegments || o.isLine) stats.lines++; else if (o.isPoints) stats.points++;
    if (o.material) o.material = Array.isArray(o.material) ? o.material.map(prep) : prep(o.material);
  });
  stats.textures = seenTex.size;
  stats.texturesMissing = missingTex.size;
  return { root, stats };
}

/**
 * @param {THREE.Object3D} source  cosa esportare (con i discendenti; la sua trasformazione è inclusa)
 * @param {object} [o]  { maxTextureSize = 4096 }
 * @returns {Promise<{ glb: ArrayBuffer, stats: object }>}
 */
export async function TJS_exportGlb(source, { maxTextureSize = 4096 } = {}) {
  if (!source?.isObject3D) throw new Error(t('app.tjs.glb.no_source'));
  const { root, stats } = TJS_prepareForGlb(source);
  if (!stats.meshes && !stats.lines && !stats.points) throw new Error(t('app.tjs.glb.no_geometry'));
  const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, maxTextureSize });
  stats.bytes = glb.byteLength;
  return { glb, stats };
}
