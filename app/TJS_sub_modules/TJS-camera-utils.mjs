// TJS-camera-utils.mjs
import * as THREE from "three";

/** Clamp numerico */
export function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

/** Ricava yaw/pitch dalla direzione attuale della camera (world). */
export function yawPitchFromCamera(camera, out = { yaw: 0, pitch: 0 }) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir); // dir normalized

  // Convenzione: forward = (sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch))
  out.yaw = Math.atan2(dir.x, dir.z);
  out.pitch = Math.asin(clamp(dir.y, -1, 1));
  return out;
}

/**
 * Applica yaw/pitch alla camera tramite lookAt verso un target su sfera centrata sulla camera.
 * camera ferma, cambia solo orientamento.
 */
export function applyYawPitchLookAt(camera, yaw, pitch, radius = 10, tmp = {}) {
  const dir = tmp.dir || (tmp.dir = new THREE.Vector3());
  const target = tmp.target || (tmp.target = new THREE.Vector3());

  const cp = Math.cos(pitch);
  dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();

  target.copy(camera.position).addScaledVector(dir, radius);
  camera.lookAt(target);
  return { dir, target };
}

/**
 * Zoom ottico: cambia fov senza muovere la camera.
 * wheelDeltaY: tipico evento wheel.deltaY
 */
export function applyFovZoom(camera, wheelDeltaY, {
  zoomSpeed = 0.05,
  minFov = 20,
  maxFov = 90,
  fineFactor = 0.25,
  fineMode = false,
} = {}) {
  const k = fineMode ? fineFactor : 1;
  // deltaY positivo spesso = scroll down -> fov aumenta (zoom out). Inverti se preferisci.
  const dfov = wheelDeltaY * zoomSpeed * k;
  const newFov = clamp(camera.fov + dfov, minFov, maxFov);

  if (newFov !== camera.fov) {
    camera.fov = newFov;
    camera.updateProjectionMatrix();
    return true;
  }
  return false;
}

/** World origin/pivot dell'oggetto (posizione in world del suo Object3D). */
export function getObjectWorldOrigin(obj, out = new THREE.Vector3()) {
  if (!obj) return out.set(0, 0, 0);
  return obj.getWorldPosition(out);
}

/**
 * Teleport puro: camera.position = origine oggetto (pivot in world)
 * Attenzione: può finire "dentro" la mesh, volutamente.
 */
export function teleportCameraToObjectOrigin(camera, obj, { keepOrientation = true } = {}) {
  const p = new THREE.Vector3();
  getObjectWorldOrigin(obj, p);
  camera.position.copy(p);
  if (!keepOrientation) camera.lookAt(p); // qui è un no-op (lookAt su stessa posizione), ma lasciato per coerenza
  return true;
}

/**
 * Ruota la vista verso una posizione world senza spostare la camera.
 * Orbit mode:  sposta orbit.target sul punto.
 * EyeLock mode: calcola yaw/pitch e li applica all'EyeLockControls.
 *
 * @param {{ x:number, y:number, z:number } | THREE.Vector3} pos — posizione world target
 * @param {{ activeControls:string, orbitControls:*, eyeLockControls:*, camera:* }} st
 */
export function tjsLookAtPoint(pos, st) {
  if (st.activeControls === 'orbit') {
    const orbit = st.orbitControls;
    if (!orbit) return;
    orbit.target.set(pos.x, pos.y, pos.z);
    orbit.update();
  } else if (st.activeControls === 'eyelock') {
    const eye = st.eyeLockControls;
    const cam = st.camera;
    if (!eye || !cam) return;
    const dir = new THREE.Vector3(
      pos.x - cam.position.x,
      pos.y - cam.position.y,
      pos.z - cam.position.z,
    ).normalize();
    const pitch = Math.asin(clamp(dir.y, -1, 1));
    const yaw   = Math.atan2(dir.x, dir.z);
    eye.yaw   = yaw;
    eye.pitch = clamp(pitch, eye.minPitch ?? -Math.PI / 2, eye.maxPitch ?? Math.PI / 2);
    eye._lookVelYaw   = 0;
    eye._lookVelPitch = 0;
  }
}

/**
 * Teleport "safe": camera vicino al pivot, con offset lungo direzione di vista o una direzione fissa.
 */
export function teleportCameraNearObjectOrigin(camera, obj, {
  distance = 1.0,
  keepViewDir = true,
  fallbackDir = new THREE.Vector3(0, 0, 1),
  minDistance = 0.05,
} = {}) {
  const p = new THREE.Vector3();
  getObjectWorldOrigin(obj, p);

  const d = Math.max(minDistance, distance);

  const dir = new THREE.Vector3();
  if (keepViewDir) {
    camera.getWorldDirection(dir); // forward
    dir.normalize().multiplyScalar(-d); // sposta indietro (così guarda verso avanti)
    camera.position.copy(p).add(dir);
    // Mantieni orientamento così com'è (nessun lookAt)
  } else {
    // Posiziona la camera "dietro" una direzione fissa e poi guarda l'oggetto
    dir.copy(fallbackDir).normalize().multiplyScalar(d);
    camera.position.copy(p).add(dir);
    camera.lookAt(p);
  }
  return true;
}
