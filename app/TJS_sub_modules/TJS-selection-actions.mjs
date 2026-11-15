// TJS-selection-actions.mjs
// Azioni sulla selezione: Off, Wireframe, Erase, TargetAt/CameraAt (con animazione)
// Dipendenze: THREE nel tuo state (st.THREE), transformTool con selection/active, orbitControls, camera, scene, renderer, activeControls
// TJS-selection-actions.mjs
import * as THREE from "three";

// ------------------------------
// Helpers base
// ------------------------------
function getState(bodyEl, STATE_KEY) {
  return bodyEl?.[STATE_KEY] ?? null;
}

function getSelectionRoots(st) {
  // transformTool espone get selection() { return selection.slice(); }
  const sel = st?.transformTool?.selection ?? [];
  return Array.isArray(sel) ? sel : [];
}

function computeSelectionPivotWorld(st) {
  // 1) se il transformTool ha un metodo pubblico, usalo (consigliato)
  const tt = st?.transformTool;
  if (tt && typeof tt.getSelectionPivotWorld === "function") {
    const v = tt.getSelectionPivotWorld();
    if (v && v.isVector3) return v.clone();
  }

  

  const roots = getSelectionRoots(st);
  if (!roots.length) return new THREE.Vector3(0, 0, 0);

  const box = new THREE.Box3().makeEmpty();
  const tmp = new THREE.Box3();
  for (const obj of roots) {
    if (!obj) continue;
    tmp.setFromObject(obj);
    box.union(tmp);
  }

  const c = new THREE.Vector3();
  box.getCenter(c);
  if (!Number.isFinite(c.x)) c.set(0, 0, 0);
  return c;
}

function disposeObject3D(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose?.();

    const mat = obj.material;
    if (!mat) return;

    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      if (!m) continue;
      for (const k of [
        "map", "normalMap", "roughnessMap", "metalnessMap",
        "aoMap", "emissiveMap", "alphaMap", "envMap",
      ]) {
        if (m[k]) m[k].dispose?.();
      }
      m.dispose?.();
    }
  });
}

function easeInOutSmoothstep(t) {
  // smoothstep
  return t * t * (3 - 2 * t);
}

// ------------------------------
// Animazioni (senza toccare il tuo loop)
// Usa requestAnimationFrame: il tuo render loop già gira, quindi basta aggiornare camera/target.
// ------------------------------
function cancelAnim(st) {
  const a = st?.__TJS_SEL_ANIM__;
  if (a?.raf) cancelAnimationFrame(a.raf);
  if (st) st.__TJS_SEL_ANIM__ = null;
}

function startAnim(st, { durationMs = 1000, onUpdate, onDone } = {}) {
  cancelAnim(st);

  const anim = {
    t0: performance.now(),
    dur: Math.max(1, durationMs),
    raf: 0,
  };

  st.__TJS_SEL_ANIM__ = anim;

  const tick = (now) => {
    if (!st.__TJS_SEL_ANIM__) return; // cancellata
    const t = Math.min(1, Math.max(0, (now - anim.t0) / anim.dur));
    const e = easeInOutSmoothstep(t);
    try { onUpdate?.(e, t); } catch (err) { console.warn("[TJS-selection-actions] anim update error", err); }

    if (t >= 1) {
      st.__TJS_SEL_ANIM__ = null;
      try { onDone?.(); } catch {}
      return;
    }
    anim.raf = requestAnimationFrame(tick);
  };

  anim.raf = requestAnimationFrame(tick);
}

// ------------------------------
// 1) OFF (toggle hide/show)
// ------------------------------
export function tjsHideSelected(bodyEl, STATE_KEY = "__TJS_RENDER_STATE__") {
  const st = getState(bodyEl, STATE_KEY);
  if (!st) return;

  const roots = getSelectionRoots(st);
  if (!roots.length) return;

  // toggle: se almeno uno è visibile => spegni tutti, altrimenti riaccendi tutti
  const anyVisible = roots.some((o) => o?.visible !== false);
  const next = !anyVisible; // se nessuno visibile => true; se qualcuno visibile => false

  for (const obj of roots) {
    if (!obj) continue;
    obj.visible = next;
  }

  // refresh gizmo/footer se serve
  st.transformTool?.enableGizmo?.(false); // opzionale: off gizmo se nascondi
  // Non forzo clearSelection: spesso vuoi mantenere selezione anche se "off".
  st.markDirty?.();
}

// ------------------------------
// 2) Wireframe toggle (clona materiali per non impattare oggetti non selezionati)
// ------------------------------
function setWireframeOnMesh(mesh, on) {
  if (!mesh?.isMesh) return;

  if (on) {
    if (mesh.userData?.__tjsWireframeOn) return;

    const orig = mesh.material;
    if (!orig) return;

    // salva originale
    mesh.userData.__tjsOrigMaterial = orig;
    mesh.userData.__tjsWireframeOn = true;

    // clona e abilita wireframe
    if (Array.isArray(orig)) {
      const cloned = orig.map((m) => {
        const c = m?.clone ? m.clone() : m;
        if (c) c.wireframe = true;
        return c;
      });
      mesh.material = cloned;
    } else {
      const c = orig.clone ? orig.clone() : orig;
      if (c) c.wireframe = true;
      mesh.material = c;
    }
  } else {
    if (!mesh.userData?.__tjsWireframeOn) return;

    // ripristina materiale originale
    const orig = mesh.userData.__tjsOrigMaterial;
    if (orig) mesh.material = orig;

    delete mesh.userData.__tjsOrigMaterial;
    delete mesh.userData.__tjsWireframeOn;
  }
}

export function tjsToggleWireframeSelected(bodyEl, STATE_KEY = "__TJS_RENDER_STATE__") {
  const st = getState(bodyEl, STATE_KEY);
  if (!st) return;

  const roots = getSelectionRoots(st);
  if (!roots.length) return;

  // decide toggle: se almeno un mesh selezionato è wireframeOn => spegni, altrimenti accendi
  let anyOn = false;
  for (const r of roots) {
    r?.traverse?.((o) => {
      if (o?.isMesh && o.userData?.__tjsWireframeOn) anyOn = true;
    });
    if (anyOn) break;
  }

  const nextOn = !anyOn;

  for (const r of roots) {
    r?.traverse?.((o) => {
      if (o?.isMesh) setWireframeOnMesh(o, nextOn);
    });
  }
  st.markDirty?.();
}

// ------------------------------
// 3) Erase (remove + dispose) + clear selection/gizmo
// ------------------------------
export function tjsEraseSelected(bodyEl, STATE_KEY = "__TJS_RENDER_STATE__") {
  const st = getState(bodyEl, STATE_KEY);
  if (!st) return;

  const roots = getSelectionRoots(st);
  if (!roots.length) return;

  // Spegni gizmo e clear selection prima di rimuovere (evita riferimenti pendenti)
  st.transformTool?.enableGizmo?.(false);
  st.transformTool?.clearSelection?.();

  for (const obj of roots) {
    if (!obj) continue;
    try { obj.parent?.remove(obj); } catch {}
    try { disposeObject3D(obj); } catch (err) { console.warn("[Erase] dispose error", err); }
  }
  st.markDirty?.();
}

// ------------------------------
// 4) TargetAt (Orbit) e CameraAt (Eye) con animazione 1s
// ------------------------------
export function tjsTargetAtSelection(bodyEl, STATE_KEY = "__TJS_RENDER_STATE__", opts = {}) {
  const st = getState(bodyEl, STATE_KEY);
  if (!st?.orbitControls || !st?.camera) return;



  const to = computeSelectionPivotWorld(st);
  const orbit = st.orbitControls;

  const from = orbit.target.clone();

  startAnim(st, {
    durationMs: opts.durationMs ?? 1000,
    onUpdate: (e) => {
      orbit.target.lerpVectors(from, to, e);
      orbit.update?.();
    },
    onDone: () => {
      orbit.target.copy(to);
      orbit.update?.();
    },
  });
}

export function tjsCameraAtSelection(bodyEl, STATE_KEY = "__TJS_RENDER_STATE__", opts = {}) {
  const st = getState(bodyEl, STATE_KEY);
  if (!st?.camera) return;



  const cam = st.camera;
  const to = computeSelectionPivotWorld(st);
  const from = cam.position.clone();

  // per coerenza futura: trasliamo anche orbit.target della stessa delta (senza cambiare vista),
  // così quando torni in orbit non senti salti strani nei riferimenti.
  const hasOrbit = !!st.orbitControls;
  const orbitFrom = hasOrbit ? st.orbitControls.target.clone() : null;
  const delta = new THREE.Vector3().subVectors(to, from);

  startAnim(st, {
    durationMs: opts.durationMs ?? 1000,
    onUpdate: (e) => {
      cam.position.lerpVectors(from, to, e);

      if (hasOrbit && orbitFrom) {
        // target traslato insieme alla camera (stessa impostazione “relativa”)
        st.orbitControls.target.copy(orbitFrom).addScaledVector(delta, e);
        st.orbitControls.update?.();
      }
      // EyeLock mantiene yaw/pitch/FOV: non tocchiamo null’altro.
    },
    onDone: () => {
      cam.position.copy(to);

      if (hasOrbit && orbitFrom) {
        st.orbitControls.target.copy(orbitFrom).add(delta);
        st.orbitControls.update?.();
      }
    },
  });
}
