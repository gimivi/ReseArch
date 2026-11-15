// TJS_sub_modules/TJS-ext-zones.mjs
//
// Estensione "zones": zone a scatola nel modello; avvisa quando il visitatore entra o
// esce. Installata dal nodo TJS/Events/Zone Enter (una zona per nodo).
//
// Il punto controllato sono i piedi del walkthrough se la prima persona è attiva,
// altrimenti la posizione della camera. Il controllo è per frame dentro il ciclo di TJS,
// ma costa pochissimo (un contenimento punto-scatola per zona) e non chiede ridisegni.

export default async function createZones(api) {
  const { THREE } = api;
  const zones = new Set();
  const p = new THREE.Vector3();
  const tmpBox = new THREE.Box3();

  function point() {
    const walk = api.get("walkthrough");
    if (walk?.active && walk.feet) {
      // piedi + mezzo metro: una zona "a pavimento" alta pochi cm funziona comunque
      return p.copy(walk.feet).setY(walk.feet.y + 0.5);
    }
    return api.camera.getWorldPosition(p);
  }

  /** Scatola della zona: da un oggetto per nome (+ margine) o da centro/dimensioni. */
  function boxOf(z) {
    if (z.objectName) {
      const obj = api.modelsRoot?.getObjectByName(z.objectName) ?? api.scene.getObjectByName(z.objectName);
      if (!obj) return null;
      tmpBox.setFromObject(obj);
      if (tmpBox.isEmpty()) return null;
      return z.box.copy(tmpBox).expandByScalar(z.margin ?? 0);
    }
    return z.box;
  }

  api.onFrame(() => {
    if (!zones.size) return false;
    const pt = point();
    for (const z of zones) {
      if (z.dynamic || !z.ready) { z.ready = !!boxOf(z); if (!z.ready) continue; }
      const inside = z.box.containsPoint(pt);
      if (inside === z.inside) continue;
      z.inside = inside;
      try { (inside ? z.onEnter : z.onExit)?.({ name: z.name, point: pt.toArray() }); }
      catch (e) { console.error("[TJS zones]", e); }
    }
    return false;
  });

  return {
    /**
     * Aggiunge una zona e ritorna la funzione per toglierla.
     * @param {object} def { name, objectName?, margin?, center?[x,y,z], size?[x,y,z],
     *                       dynamic? (ricalcola la scatola dell'oggetto a ogni frame),
     *                       onEnter(info), onExit(info) }
     */
    add(def) {
      const z = {
        name: def.name ?? "",
        objectName: def.objectName || null,
        margin: Number(def.margin) || 0,
        dynamic: !!def.dynamic,
        box: new THREE.Box3(),
        inside: false,
        ready: false,
        onEnter: def.onEnter, onExit: def.onExit,
      };
      if (!z.objectName) {
        const c = def.center ?? [0, 0, 0], s = def.size ?? [2, 3, 2];
        z.box.setFromCenterAndSize(new THREE.Vector3(...c), new THREE.Vector3(...s));
      }
      zones.add(z);
      return () => zones.delete(z);
    },
    get count() { return zones.size; },
    dispose() { zones.clear(); },
  };
}
