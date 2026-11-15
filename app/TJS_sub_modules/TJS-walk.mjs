// TJS_sub_modules/TJS-walk.mjs
//
// Camminata in prima persona (nata in HySpace, ora generica): movimento sul piano con
// inerzia, collisione coi muri, appoggio a terra con gradini e gravità, rete di
// sicurezza contro le cadute nel vuoto, raccolta dei collider per nome.
//
// Le funzioni lavorano su un oggetto di stato "walker" passato dal chiamante (in HySpace
// è direttamente lo stato del pannello). Campi usati:
//
//   keys:Set<string>  padMove:{x,y}|null  velocity:Vector3  speed  damping      (movimento)
//   colliders:Mesh[]  playerRadius  playerHeight  stepHeight  groundSnap  gravity
//   vY  onGround                                                                (fisica)
//
// Convenzione: `obj` è il corpo del giocatore e obj.position.y è la quota dei PIEDI.
// TJS_WALK_DEFAULTS dà i valori di partenza dei parametri.

import { THREE } from "./TJS-loaders.mjs";

export const TJS_WALK_DEFAULTS = {
  speed: 3.0,          // m/s circa a regime
  damping: 10.0,       // smorzamento della velocità (1/s)
  playerHeight: 1.65,  // m, occhi
  playerRadius: 0.35,  // m
  stepHeight: 0.35,    // gradino superabile senza saltare
  groundSnap: 0.15,    // distanza entro cui si resta incollati al suolo
  gravity: 14.0,       // m/s²
};

/** Crea uno stato walker completo (per chi non ne ha già uno proprio). */
export function TJS_createWalkState(opts = {}) {
  return {
    ...TJS_WALK_DEFAULTS,
    keys: new Set(), padMove: null, velocity: new THREE.Vector3(),
    colliders: [], vY: 0, onGround: false,
    ...opts,
  };
}

// temporanei privati del modulo (nessuna allocazione per frame)
const _rc = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _down = new THREE.Vector3(0, -1, 0);
const _wallDirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  .map(([x, z]) => new THREE.Vector3(x, 0, z).normalize());


// ─── Movimento sul piano ────────────────────────────────────────────────────

/**
 * Aggiorna la velocità (tastiera WASD/frecce + levetta in st.padMove, −1…1, y positivo =
 * indietro) e ritorna in `outMove` lo spostamento del frame sul piano XZ, nella direzione
 * di `look` (qualunque cosa abbia .quaternion in coordinate mondo). Niente collisioni qui:
 * il chiamante applica lo spostamento, poi chiama TJS_walkResolveWalls e TJS_walkGrounding.
 */
export function TJS_walkPlanarMove(st, look, dt, outMove) {
  const k = st.keys;
  const forward = (k.has("KeyW") ? 1 : 0) + (k.has("ArrowUp") ? 1 : 0);
  const back    = (k.has("KeyS") ? 1 : 0) + (k.has("ArrowDown") ? 1 : 0);
  const left    = (k.has("KeyA") ? 1 : 0) + (k.has("ArrowLeft") ? 1 : 0);
  const right   = (k.has("KeyD") ? 1 : 0) + (k.has("ArrowRight") ? 1 : 0);

  const clamp1 = (v) => Math.max(-1, Math.min(1, v));
  const zIn = clamp1(forward - back - (st.padMove?.y ?? 0));
  const xIn = clamp1(right - left + (st.padMove?.x ?? 0));

  const v = st.velocity;
  v.x -= v.x * Math.min(st.damping * dt, 1);
  v.z -= v.z * Math.min(st.damping * dt, 1);

  const accel = st.speed * 12.0;
  v.z -= zIn * accel * dt;
  v.x -= xIn * accel * dt;

  _right.set(1, 0, 0).applyQuaternion(look.quaternion);
  _fwd.set(0, 0, -1).applyQuaternion(look.quaternion);
  _right.y = 0; _right.normalize();
  _fwd.y = 0; _fwd.normalize();

  outMove.set(0, 0, 0);
  outMove.addScaledVector(_right, -v.x * dt);
  outMove.addScaledVector(_fwd, -v.z * dt);
  return outMove;
}


// ─── Collisione coi muri ────────────────────────────────────────────────────

/**
 * Dopo lo spostamento, spinge fuori il corpo se è entrato nei collider: 8 raggi
 * orizzontali ad altezza torace (piedi + 60% dell'altezza), lunghi playerRadius, fino a
 * due passate.
 */
export function TJS_walkResolveWalls(st, obj) {
  const colliders = st.colliders || [];
  if (!colliders.length) return;

  const radius = st.playerRadius;
  _origin.copy(obj.position);
  _origin.y += st.playerHeight * 0.6;

  for (let iter = 0; iter < 2; iter++) {
    let pushed = false;

    for (const dir of _wallDirs) {
      _rc.set(_origin, dir);
      _rc.far = radius + 0.05;

      const h = _rc.intersectObjects(colliders, false)[0];
      if (h?.distance == null) continue;

      const pen = radius - h.distance;
      if (pen <= 0) continue;

      obj.position.addScaledVector(dir, -(pen + 0.01));
      _origin.copy(obj.position);
      _origin.y += st.playerHeight * 0.6;
      pushed = true;
    }

    if (!pushed) break;
  }
}


// ─── Appoggio a terra ───────────────────────────────────────────────────────

/** Componente Y della normale (in coordinate mondo) della faccia colpita. */
export function TJS_hitWorldNormalY(hit) {
  if (!hit?.face?.normal || !hit?.object) return 1;
  _nm.getNormalMatrix(hit.object.matrixWorld);
  return _n.copy(hit.face.normal).applyMatrix3(_nm).normalize().y;
}

/**
 * Quota dei piedi: un raggio verso il basso da piedi + stepHeight + 0,5 m; fra i punti
 * colpiti vale il più alto che sia camminabile (normale Y ≥ 0,55) e non più alto di un
 * gradino. Vicino al suolo o su un gradino si aggancia, altrimenti gravità senza
 * attraversare il suolo.
 *
 * Ottimizzazione: da fermi e già appoggiati (stessa posizione del frame precedente, stessi
 * collider) il raggio non si rilancia. Chi cambia i collider deve assegnare un NUOVO array
 * a st.colliders (non modificarlo in place) perché il controllo se ne accorga.
 */
export function TJS_walkGrounding(st, obj, dt) {
  const colliders = st.colliders || [];
  if (!colliders.length) {
    obj.position.y = 0;
    st.onGround = true;
    st.vY = 0;
    return;
  }

  const p = obj.position;
  const last = st._walkRest;
  if (st.onGround && st.vY === 0 && last && last.colliders === colliders &&
      last.x === p.x && last.y === p.y && last.z === p.z) return;

  _land(st, obj, dt, colliders);

  if (st.onGround && st.vY === 0) {
    const r = (st._walkRest ??= { x: 0, y: 0, z: 0, colliders: null });
    r.x = p.x; r.y = p.y; r.z = p.z; r.colliders = colliders;
  } else if (last) {
    last.colliders = null;
  }
}

function _fall(st, obj, dt) {
  st.onGround = false;
  st.vY -= st.gravity * dt;
  obj.position.y += st.vY * dt;
}

function _land(st, obj, dt, colliders) {
  const feetY = obj.position.y;
  _origin.set(obj.position.x, feetY + st.stepHeight + 0.5, obj.position.z);
  _rc.set(_origin, _down);
  _rc.far = st.stepHeight + 0.5 + 3.0;

  const hits = _rc.intersectObjects(colliders, false);
  if (!hits.length) return _fall(st, obj, dt);

  const maxStepY = feetY + st.stepHeight + 0.05;
  let bestY = -Infinity;
  for (const h of hits) {
    const py = h.point?.y;
    if (py == null || py > maxStepY || py <= bestY) continue;
    if (TJS_hitWorldNormalY(h) < 0.55) continue;
    bestY = py;
  }
  if (bestY === -Infinity) return _fall(st, obj, dt);

  const dy = bestY - feetY;
  // vicino al suolo, o gradino in salita entro stepHeight → aggancio
  if (Math.abs(dy) <= st.groundSnap || (dy > 0 && dy <= st.stepHeight + 0.05)) {
    obj.position.y = bestY;
    st.onGround = true;
    st.vY = 0;
    return;
  }

  _fall(st, obj, dt);
  if (obj.position.y < bestY) {
    obj.position.y = bestY;
    st.onGround = true;
    st.vY = 0;
  }
}


// ─── Rete di sicurezza ──────────────────────────────────────────────────────

export const TJS_FALL_DEFAULTS = { maxTime: 4, minY: -8, lift: 0.3 };

/**
 * Una falla nel modello non deve far precipitare all'infinito: si ricorda l'ultimo punto
 * d'appoggio; se si cade per più di maxTime secondi o si scende sotto minY, il corpo torna
 * lì (sollevato di `lift`), oppure a `fallback` [x,y,z] se non c'è un punto valido.
 * Ritorna true quando ha riportato indietro il corpo (il chiamante può avvisare l'utente).
 */
export function TJS_walkFallGuard(st, obj, dt, { maxTime, minY, lift, fallback = null } = TJS_FALL_DEFAULTS) {
  maxTime ??= TJS_FALL_DEFAULTS.maxTime;
  minY ??= TJS_FALL_DEFAULTS.minY;
  lift ??= TJS_FALL_DEFAULTS.lift;

  if (st.onGround) {
    st._fallT = 0;
    (st._lastSafe ??= new THREE.Vector3()).copy(obj.position);
    st._lastSafeValid = true;
    return false;
  }
  st._fallT = (st._fallT ?? 0) + dt;
  if (st._fallT < maxTime && obj.position.y > minY) return false;

  st._fallT = 0;
  st.vY = 0;
  if (st.velocity) st.velocity.x = st.velocity.z = 0;
  if (st._lastSafeValid) { obj.position.copy(st._lastSafe); obj.position.y += lift; }
  else if (fallback) obj.position.set(fallback[0], fallback[1] + 0.5, fallback[2]);
  return true;
}

/** Il punto sicuro vale solo nello spazio in cui è stato preso: da chiamare quando cambia. */
export function TJS_walkInvalidateSafePoint(st) { st._lastSafeValid = false; }


// ─── Cammino automatico ("tocca per andare") ─────────────────────────────────

/**
 * Cammino automatico lungo una serie di tappe, pilotato come una levetta: a ogni frame
 * step() dice quale padMove dare (−1…1 rispetto allo sguardo; y positivo = indietro), così
 * il movimento passa per la stessa fisica della camminata (muri, gradini, cadute).
 * Arrivo a ogni tappa entro arriveDist; se in stuckWindow secondi avanza meno di stuckMin
 * metri si ferma ("stuck"). Le tappe sono esposte (points) per chi deve spostarle insieme
 * al mondo (HySpace al cambio stanza).
 */
export function TJS_createAutoWalk({ arriveDist = 0.3, stuckWindow = 0.8, stuckMin = 0.15, slowDist = 0.8 } = {}) {
  let pts = null, i = 0, win = null;
  const out = { x: 0, y: 0 };
  return {
    start(list) { pts = list.map((p) => p.clone()); i = 0; win = null; },
    stop() { pts = null; },
    get active() { return !!pts; },
    get points() { return pts ?? []; },
    /**
     * @param {number} dt
     * @param {THREE.Vector3} pos  posizione del corpo (piedi)
     * @param {number} yaw         rotazione dello sguardo attorno alla verticale (rad)
     * @returns {{ move: {x,y}|null, status: "walking"|"arrived"|"stuck"|"idle" }}
     */
    step(dt, pos, yaw) {
      if (!pts) return { move: null, status: "idle" };
      const t = pts[i];
      const dx = t.x - pos.x, dz = t.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < arriveDist) {
        i++; win = null;
        if (i >= pts.length) { pts = null; return { move: null, status: "arrived" }; }
        return { move: null, status: "walking" };
      }
      win ??= { t: 0, d: dist };
      win.t += dt;
      if (win.t > stuckWindow) {
        if (win.d - dist < stuckMin) { pts = null; return { move: null, status: "stuck" }; }
        win = { t: 0, d: dist };
      }
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // avanti
      const rx = Math.cos(yaw),  rz = -Math.sin(yaw);   // destra
      const nx = dx / dist, nz = dz / dist;
      const k = Math.min(1, Math.max(0.35, dist / slowDist));   // rallenta in arrivo
      out.x = (nx * rx + nz * rz) * k;
      out.y = -(nx * fx + nz * fz) * k;
      return { move: out, status: "walking" };
    },
  };
}


// ─── Raccolta dei collider ──────────────────────────────────────────────────

/** True se o e tutti i suoi genitori fino a stopAt (compreso) sono visibili. */
export function TJS_isActuallyVisible(o, stopAt) {
  for (let cur = o; cur; cur = cur.parent) {
    if (cur.visible === false) return false;
    if (cur === stopAt) break;
  }
  return true;
}

/**
 * Aggiunge a `out` le mesh realmente visibili contenute nei nodi di `root` che si chiamano
 * come uno dei `names` (il nodo stesso compreso, se è una mesh). Senza doppioni.
 */
export function TJS_collectVisibleMeshesByName(root, names, out = []) {
  if (!root) return out;
  const wanted = new Set(names);
  const seen = new Set(out.map((m) => m.uuid));
  root.traverse((o) => {
    if (!wanted.has(o?.name)) return;
    o.traverse((c) => {
      if (!c?.isMesh || seen.has(c.uuid) || !TJS_isActuallyVisible(c, root)) return;
      seen.add(c.uuid);
      out.push(c);
    });
  });
  return out;
}
