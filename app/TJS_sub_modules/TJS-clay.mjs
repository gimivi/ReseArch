// TJS-clay.mjs
// Materiale "clay" del pannello TJS (2026-10-21): un solo MeshPhysicalMaterial per pannello,
// helper di base come la griglia o il gizmo (state.clay in model_TJS).
//
// – Oggetti senza materiale: i loader (TJS-loaders.mjs) segnano con userData.__tjs_noMaterial__
//   le mesh a cui il file non dà un materiale (glTF senza "material" nella primitiva, OBJ senza
//   .mtl, VRML senza Appearance, PLY/DRC senza colori). Quando entrano sotto TJS_MODELS_ROOT
//   (modelli dell'oggetto e TJS/Model/Load URL) ricevono il materiale clay, sempre.
// – Vista clay (finestra Ambiente): tutte le mesh dei modelli prendono il materiale clay; gli
//   originali restano conservati e tornano spegnendola. Restano fuori le sfere panoramiche, i
//   ricevitori d'ombra (ShadowMaterial), punti e linee; i trasparenti solo con "includeTransparent".
// – Salvataggio: mod_spec.environment.clay = toSpec() (TJS-env-manager.mjs).

import { tjsIsPanorama } from './TJS-pano-depth.mjs';

export const TJS_CLAY_DEFAULTS = Object.freeze({
  enabled:            false,
  includeTransparent: false,
  color:              '#d8d4cc',
  roughness:          0.6,
  clearcoat:          0.25,
  clearcoatRoughness: 0.3,
  envIntensity:       0.8,
});

/** Segna una mesh come "senza materiale dal file" (la usano i loader). */
export function tjsMarkNoMaterial(mesh) {
  if (mesh?.isMesh) mesh.userData.__tjs_noMaterial__ = true;
}

export function tjsCreateClay({ THREE, modelsRoot, markDirty = () => {}, signal }) {
  const params = { ...TJS_CLAY_DEFAULTS };

  const material = new THREE.MeshPhysicalMaterial({ metalness: 0 });
  material.name = 'TJS_CLAY';

  const originals = new Map();   // mesh → materiale originale (solo vista clay)

  function _applyParams() {
    material.color.set(params.color);
    material.roughness          = params.roughness;
    material.clearcoat          = params.clearcoat;
    material.clearcoatRoughness = params.clearcoatRoughness;
    material.envMapIntensity    = params.envIntensity;
    material.needsUpdate        = true;
  }
  _applyParams();

  function _isTransparent(mat) {
    return [].concat(mat ?? []).some(m => m && (m.transparent || m.opacity < 1 || m.transmission > 0));
  }

  // Mesh che la vista clay può cambiare
  function _eligible(o) {
    if (!o.isMesh || o.material === material) return false;
    if (tjsIsPanorama(o)) return false;
    if ([].concat(o.material ?? []).some(m => m?.isShadowMaterial)) return false;
    if (!params.includeTransparent && _isTransparent(o.material)) return false;
    return true;
  }

  function _assignDefaults(root) {
    root.traverse((o) => {
      if (o.isMesh && o.userData.__tjs_noMaterial__ && o.material !== material && !originals.has(o)) {
        o.material = material;
      }
    });
  }

  function _clayOn(root) {
    root.traverse((o) => {
      if (!_eligible(o)) return;
      originals.set(o, o.material);
      o.material = material;
    });
  }

  function _restore(filter = () => true) {
    for (const [mesh, mat] of originals) {
      if (!filter(mat)) continue;
      if (mesh.material === material) mesh.material = mat;
      originals.delete(mesh);
    }
  }

  function setEnabled(on) {
    on = !!on;
    if (on === params.enabled) return;
    params.enabled = on;
    if (on) _clayOn(modelsRoot);
    else    _restore();
    markDirty();
  }

  function setIncludeTransparent(on) {
    params.includeTransparent = !!on;
    if (params.enabled) {
      if (params.includeTransparent) _clayOn(modelsRoot);
      else _restore(_isTransparent);
    }
    markDirty();
  }

  function setParams(p = {}) {
    if (typeof p.color === 'string' && p.color) params.color = p.color;
    for (const k of ['roughness', 'clearcoat', 'clearcoatRoughness']) {
      if (Number.isFinite(p[k])) params[k] = Math.min(1, Math.max(0, p[k]));
    }
    if (Number.isFinite(p.envIntensity)) params.envIntensity = Math.max(0, p.envIntensity);
    _applyParams();
    markDirty();
  }

  /** Impostazioni lette da mod_spec.environment.clay */
  function fromSpec(spec) {
    if (!spec || typeof spec !== 'object') return;
    setParams(spec);
    if (typeof spec.includeTransparent === 'boolean') params.includeTransparent = spec.includeTransparent;
    if (typeof spec.enabled === 'boolean') setEnabled(spec.enabled);
  }

  function toSpec() {
    const { enabled, includeTransparent, color, roughness, clearcoat, clearcoatRoughness, envIntensity } = params;
    return { enabled, includeTransparent, color, roughness, clearcoat, clearcoatRoughness, envIntensity };
  }

  // Modelli aggiunti dopo (Load URL, flow): materiale agli oggetti senza materiale e vista clay se attiva
  const _onAdded = (e) => {
    if (!e.child) return;
    _assignDefaults(e.child);
    if (params.enabled) _clayOn(e.child);
  };
  const _onRemoved = (e) => {
    e.child?.traverse?.((o) => { originals.delete(o); });
  };
  modelsRoot.addEventListener('childadded', _onAdded);
  modelsRoot.addEventListener('childremoved', _onRemoved);
  _assignDefaults(modelsRoot);

  function dispose() {
    modelsRoot.removeEventListener('childadded', _onAdded);
    modelsRoot.removeEventListener('childremoved', _onRemoved);
    originals.clear();
    material.dispose();
  }
  if (signal) signal.addEventListener('abort', dispose, { once: true });

  return {
    material,
    isEnabled: () => params.enabled,
    getParams: () => ({ ...params }),
    setEnabled, setIncludeTransparent, setParams, fromSpec, toSpec, dispose,
  };
}
