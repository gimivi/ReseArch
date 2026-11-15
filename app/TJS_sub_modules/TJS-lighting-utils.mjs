// TJS_sub_modules/TJS-lighting-utils.mjs
// Funzioni comuni per luci e ombre (2026-10-18), usate da TJS-light-manager e TJS-env-manager.
//
//   tjsModelsBox(modelsRoot)              bounding box dei modelli (senza elementi di lavoro)
//   tjsFitShadow(light, box)              area dell'ombra adattata al modello + bias in base al texel
//   tjsEnsureShadowCasters(modelsRoot)    se nessun oggetto proietta ombre, le accende su tutte le mesh
//   tjsPlaceSun(light, box, az, el)       direzionale messa su azimut/elevazione intorno al modello
//   tjsDefaultLightPlacement(type, box)   posizione, bersaglio e intensità per una luce nuova
//   tjsUpdateShadowGround(ground, box)    "pavimento per le ombre" (ShadowMaterial) sotto il modello
//
// Unità: le intensità di Point/Spot sono fisiche (candela, decadimento 2, three ≥ r155):
// per illuminare il centro come una direzionale d'intensità 1 serve intensity ≈ distanza².

import { THREE } from './TJS-loaders.mjs';

const _box  = new THREE.Box3();
const _v    = new THREE.Vector3();
const _v2   = new THREE.Vector3();
const _m    = new THREE.Matrix4();
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());

/** true per gli elementi di lavoro che non fanno parte del modello. */
function _isHelper(o) {
  return o.name === '_helper' || o.name === 'TJS_MULTI_PIVOT' || !!o.userData?.__tjs_helper_kind__;
}

/** Bounding box dei modelli caricati (figli di modelsRoot, senza elementi di lavoro). */
export function tjsModelsBox(modelsRoot, out = new THREE.Box3()) {
  out.makeEmpty();
  for (const child of modelsRoot?.children ?? []) {
    if (!child?.visible || _isHelper(child)) continue;
    _box.setFromObject(child);
    if (!_box.isEmpty()) out.union(_box);
  }
  return out;
}

function _boxCorners(box) {
  let i = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) _corners[i++].set(x, y, z);
  return _corners;
}

/**
 * Adatta la camera dell'ombra al modello e scala bias/normalBias sulla dimensione di un texel.
 * Directional: riquadro ortografico che contiene la box vista dalla luce.
 * Spot/Point: near/far sulle distanze dalla luce alla box.
 * Restituisce true se ha adattato qualcosa.
 */
export function tjsFitShadow(light, box) {
  if (!light?.shadow || !box || box.isEmpty()) return false;
  const sh  = light.shadow;
  const cam = sh.camera;
  light.updateMatrixWorld(true);
  const lightPos = light.getWorldPosition(new THREE.Vector3());
  const mapSize  = Math.max(1, sh.mapSize.width);
  const corners  = _boxCorners(box);

  if (light.isDirectionalLight) {
    light.target.updateMatrixWorld(true);
    const targetPos = light.target.getWorldPosition(_v2);
    // stessa vista della camera d'ombra (DirectionalLightShadow: posizione della luce, lookAt sul bersaglio)
    _m.lookAt(lightPos, targetPos, cam.up);
    _m.setPosition(lightPos);
    _m.invert();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minD = Infinity, maxD = -Infinity;
    for (const c of corners) {
      _v.copy(c).applyMatrix4(_m);
      minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x);
      minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
      minD = Math.min(minD, -_v.z); maxD = Math.max(maxD, -_v.z);
    }
    const pad = 0.02 * Math.max(maxX - minX, maxY - minY, 1e-6);
    cam.left = minX - pad; cam.right = maxX + pad;
    cam.bottom = minY - pad; cam.top = maxY + pad;
    // near può essere negativo (camera ortografica): la luce può stare dentro la box
    cam.near = minD - pad; cam.far = maxD + pad;
    cam.updateProjectionMatrix();
    const texel = Math.max(cam.right - cam.left, cam.top - cam.bottom) / mapSize;
    sh.normalBias = texel * 1.5;
    sh.bias = -0.0002;
  } else if (light.isSpotLight || light.isPointLight) {
    let dMin = box.distanceToPoint(lightPos), dMax = 0;
    for (const c of corners) dMax = Math.max(dMax, c.distanceTo(lightPos));
    cam.near = Math.max(dMax * 0.001, dMin * 0.9, 0.01);
    cam.far  = Math.max(cam.near * 2, dMax * 1.05);
    cam.updateProjectionMatrix();
    const dMid  = (Math.max(dMin, cam.near) + dMax) / 2;
    const half  = light.isSpotLight ? Math.tan(light.angle) : 1;   // cubo dei Point: 90°
    const texel = (2 * dMid * half) / mapSize;
    sh.normalBias = texel * 1.5;
    sh.bias = -0.0002;
  } else {
    return false;
  }
  sh.needsUpdate = true;
  return true;
}

/**
 * Se nessuna mesh dei modelli proietta ombre, le accende (proietta + riceve) su tutte.
 * Le nuvole di punti e le linee restano escluse (three non le usa per le ombre).
 * Restituisce il numero di mesh accese (0 se qualcuna proiettava già).
 */
export function tjsEnsureShadowCasters(modelsRoot) {
  const meshes = [];
  let anyCast = false;
  for (const child of modelsRoot?.children ?? []) {
    if (_isHelper(child)) continue;
    child.traverse((o) => {
      if (!o.isMesh || _isHelper(o)) return;
      if (o.castShadow) anyCast = true;
      meshes.push(o);
    });
  }
  if (anyCast) return 0;
  for (const o of meshes) { o.castShadow = true; o.receiveShadow = true; }
  return meshes.length;
}

/** Posiziona una direzionale su azimut/elevazione (gradi) intorno al centro della box, bersaglio al centro. */
export function tjsPlaceSun(light, box, azimuthDeg, elevationDeg) {
  const center = new THREE.Vector3(), size = new THREE.Vector3();
  if (box && !box.isEmpty()) { box.getCenter(center); box.getSize(size); }
  const r   = Math.max(1, size.length());   // fuori dalla box, il riquadro d'ombra si adatta comunque
  const az  = THREE.MathUtils.degToRad(azimuthDeg);
  const el  = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(elevationDeg, -89.9, 89.9));
  light.position.set(
    center.x + r * Math.cos(el) * Math.sin(az),
    center.y + r * Math.sin(el),
    center.z + r * Math.cos(el) * Math.cos(az),
  );
  light.target.position.copy(center);
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
}

/**
 * Posizione, bersaglio e intensità sensati per una luce nuova, sulla box dei modelli.
 * { position, target, intensity } — intensity solo per Point/Spot (null = valore di three).
 */
export function tjsDefaultLightPlacement(type, box) {
  const center = new THREE.Vector3(0, 0, 0), size = new THREE.Vector3(10, 10, 10);
  if (box && !box.isEmpty()) { box.getCenter(center); box.getSize(size); }
  const span = Math.max(size.x, size.y, size.z, 1e-3);
  // sopra un angolo della box, un po' fuori: luce di tre quarti
  const position = new THREE.Vector3(
    center.x + size.x * 0.5 + span * 0.25,
    center.y + size.y * 0.5 + span * 0.6,
    center.z + size.z * 0.5 + span * 0.25,
  );
  const d = position.distanceTo(center);
  const intensity = (type === 'Point' || type === 'Spot') ? Math.max(1, d * d) : null;
  return { position, target: center, intensity };
}

/** Crea il pavimento per le ombre: piano invisibile che mostra solo le ombre ricevute. */
export function tjsCreateShadowGround() {
  const mat  = new THREE.ShadowMaterial({ opacity: 0.35, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.name = 'TJS_SHADOW_GROUND';
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.userData.__tjs_no_select__ = true;
  mesh.userData.__tjs_helper_kind__ = 'shadowGround';
  mesh.renderOrder = -1;
  return mesh;
}

/** Porta il pavimento sotto la box (appena sotto la base, tre volte più grande). */
export function tjsUpdateShadowGround(ground, box) {
  if (!ground || !box || box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const side = Math.max(s.x, s.z, 1e-3) * 3;
  ground.position.set(c.x, box.min.y - Math.max(s.y, 1e-3) * 0.001, c.z);
  ground.scale.set(side, side, 1);
  ground.updateMatrixWorld(true);
}
