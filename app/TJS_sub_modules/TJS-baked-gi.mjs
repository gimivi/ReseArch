// TJS_sub_modules/TJS-baked-gi.mjs
//
// Illuminazione "cotta" (baked) da una texture impacchettata sul secondo set di UV (uv1):
//   R = occlusione ambientale (AO) → aoMap standard di three.js
//   G = una prima luce cotta ("luce G") → sommata all'irradianza, × colore/intensità G
//   B = una seconda luce cotta ("luce B") → sommata all'irradianza, × colore/intensità B
// Il significato di G e B lo decide chi prepara la mappa (es. luce dal pavimento e dal
// soffitto nelle stanze di HySpace).
// Colori e intensità sono uniform CONDIVISE fra tutti i materiali del gruppo: cambiarli
// (anche a ogni frame, es. un ciclo di colore) non ricompila gli shader.
//
// Materiali supportati: quelli con luci (Standard, Physical, Lambert, Phong, Toon: hanno
// RE_IndirectDiffuse e <lights_fragment_maps>). MeshBasicMaterial non ha luci → ignorato.
// Nota: la luce aggiunta passa poi per l'AO (canale R) e per il colore del materiale, come
// ogni luce indiretta di three.js.
//
// La mappa: se non se ne passa una, si usa l'aoMap già presente nel materiale (es. la
// "occlusion texture" del GLB esportato da Blender, già con channel = TEXCOORD e flipY
// corretti). Nata per HySpace (nodo HYS/Material/Baked GI), generica.

import { THREE } from "./TJS-loaders.mjs";

export const TJS_BAKED_GI_DEFAULTS = {
  gColor: 0xffffff,
  gIntensity: 1.0,
  bColor: 0xffffff,
  bIntensity: 1.0,
  aoIntensity: 1.0,
};

const CACHE_KEY = "tjs-baked-gi-v1";

// Un materiale può appartenere a UN solo gruppo Baked GI: due iniezioni dello stesso
// codice dichiarerebbero due volte le stesse uniform e lo shader non compilerebbe.
const OWNER = new WeakMap();   // material → gruppo che lo ha modificato

/** Gruppo Baked GI che ha già modificato il materiale (o null). */
export function TJS_bakedGIOwner(material) { return OWNER.get(material) ?? null; }

/**
 * @param {object} [values]  gColor, bColor (numero 0xRRGGBB, "#rrggbb", nome CSS, THREE.Color),
 *                           gIntensity, bIntensity, aoIntensity
 * apply() ritorna false anche se il materiale è già di un altro gruppo (TJS_bakedGIOwner).
 * @returns {{ apply(material, packedMap?): boolean, set(values): void, remove(): void,
 *             readonly count: number, uniforms: object }}
 */
export function TJS_createBakedGI(values = {}) {
  const v = { ...TJS_BAKED_GI_DEFAULTS, ...values };
  const uniforms = {
    tjsGiGColor:     { value: new THREE.Color(v.gColor) },
    tjsGiGIntensity: { value: Number(v.gIntensity) },
    tjsGiBColor:     { value: new THREE.Color(v.bColor) },
    tjsGiBIntensity: { value: Number(v.bIntensity) },
  };
  let aoIntensity = Number(v.aoIntensity);
  const patched = new Map();   // material → stato precedente (per remove)
  let self = null;             // l'oggetto restituito (proprietario in OWNER)

  function supportsLights(m) {
    return !!(m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial));
  }

  /** Applica al materiale; false se non ha una mappa o non ha luci. Idempotente. */
  function apply(material, packedMap = null) {
    if (!supportsLights(material) || patched.has(material)) return patched.has(material);
    if (OWNER.has(material)) return false;          // già di un altro gruppo
    const map = packedMap ?? material.aoMap;
    if (!map) return false;

    if (packedMap) {                     // mappa passata a parte: impostazioni del codice originale
      packedMap.flipY = false;
      packedMap.channel = 1;             // uv1
      packedMap.colorSpace = THREE.NoColorSpace;
      packedMap.needsUpdate = true;
    }

    const prev = {
      aoMap: material.aoMap,
      aoMapIntensity: material.aoMapIntensity,
      onBeforeCompile: material.onBeforeCompile,
      customProgramCacheKey: material.customProgramCacheKey,
    };
    patched.set(material, prev);
    OWNER.set(material, self);

    material.aoMap = map;
    material.aoMapIntensity = aoIntensity;

    material.onBeforeCompile = function (shader, renderer) {
      prev.onBeforeCompile?.call(this, shader, renderer);   // non cancella altre modifiche
      shader.uniforms.tjsGiMap = { value: map };
      Object.assign(shader.uniforms, uniforms);             // stesse istanze: aggiornamento al volo

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D tjsGiMap;
        uniform vec3 tjsGiGColor;
        uniform float tjsGiGIntensity;
        uniform vec3 tjsGiBColor;
        uniform float tjsGiBIntensity;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_maps>",
        `#include <lights_fragment_maps>
        #if defined( RE_IndirectDiffuse ) && defined( USE_AOMAP )
          vec4 tjsGiTexel = texture2D( tjsGiMap, vAoMapUv );
          irradiance += tjsGiTexel.g * tjsGiGColor * tjsGiGIntensity
                      + tjsGiTexel.b * tjsGiBColor * tjsGiBIntensity;
        #endif`
      );
    };
    const prevKey = prev.customProgramCacheKey;
    material.customProgramCacheKey = function () {
      return (prevKey ? prevKey.call(this) + "|" : "") + CACHE_KEY;
    };
    material.needsUpdate = true;
    return true;
  }

  /** Nuovi colori/intensità (solo i campi passati). */
  function set(nv = {}) {
    const num = (x) => x !== "" && x != null && Number.isFinite(Number(x));
    if (nv.gColor != null) uniforms.tjsGiGColor.value.set(nv.gColor);
    if (nv.bColor != null) uniforms.tjsGiBColor.value.set(nv.bColor);
    if (num(nv.gIntensity)) uniforms.tjsGiGIntensity.value = Number(nv.gIntensity);
    if (num(nv.bIntensity)) uniforms.tjsGiBIntensity.value = Number(nv.bIntensity);
    if (num(nv.aoIntensity)) {
      aoIntensity = Number(nv.aoIntensity);
      for (const m of patched.keys()) m.aoMapIntensity = aoIntensity;
    }
  }

  /** Riporta tutti i materiali com'erano (ricompilati al prossimo disegno). */
  function remove() {
    for (const [m, prev] of patched) {
      m.aoMap = prev.aoMap;
      m.aoMapIntensity = prev.aoMapIntensity;
      m.onBeforeCompile = prev.onBeforeCompile;
      m.customProgramCacheKey = prev.customProgramCacheKey;
      m.needsUpdate = true;
      OWNER.delete(m);
    }
    patched.clear();
  }

  self = { apply, set, remove, uniforms, get count() { return patched.size; } };
  return self;
}
