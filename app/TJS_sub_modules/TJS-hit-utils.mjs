// TJS-hit-utils.mjs
// Funzioni condivise per la risoluzione del punto colpito (hit) via raycast.
// Usate da TJS-pick-manager.mjs e TJS-measure-tool.mjs per garantire
// un comportamento identico in entrambe le modalità Collima e Misura.

import { THREE } from './TJS-loaders.mjs';
import { tjsIsPanorama } from './TJS-pano-depth.mjs';

// ── Snap al vertice del triangolo più vicino (Mesh) ───────────────────────────
// Dato un hit su una Mesh, trova tra i 3 vertici del triangolo colpito (face.a/b/c)
// quello in world-space più vicino al punto di intersezione.
// Restituisce un hit modificato con il punto corretto.
export function snapToNearestMeshVertex(hit) {
    if (!hit) return hit;
    // Sfera panoramica: i vertici sono pochi (60 × 40) e l'aggancio sposterebbe il punto di gradi,
    // lasciando la uv del clic (serve intatta per la mappa delle distanze, TJS-pano-depth.mjs)
    if (tjsIsPanorama(hit.object)) return hit;
    const face = hit.face;
    const geo  = hit.object?.geometry;
    if (!face || !geo?.attributes?.position) return hit;   // fallback: hit non modificato

    const pos = geo.attributes.position;
    const mw  = hit.object.matrixWorld;
    const hp  = hit.point;

    const a = new THREE.Vector3().fromBufferAttribute(pos, face.a).applyMatrix4(mw);
    const b = new THREE.Vector3().fromBufferAttribute(pos, face.b).applyMatrix4(mw);
    const c = new THREE.Vector3().fromBufferAttribute(pos, face.c).applyMatrix4(mw);

    const dA = hp.distanceToSquared(a);
    const dB = hp.distanceToSquared(b);
    const dC = hp.distanceToSquared(c);

    let nearest;
    if (dA <= dB && dA <= dC)      nearest = a;
    else if (dB <= dC)             nearest = b;
    else                           nearest = c;

    return { ...hit, point: nearest };
}

// ── Corregge il punto per THREE.Points ────────────────────────────────────────
// In Three.js, per oggetti Points, intersectObjects() restituisce
// hits[0].point = proiezione del vertice sulla retta del raggio (non il vertice!).
// Usiamo hits[0].index per leggere la posizione reale dalla BufferGeometry.
export function correctPointHit(hit) {
    if (!hit?.object?.isPoints) return hit;  // Mesh/Line: .point è già corretto

    const idx = hit.index;
    if (idx == null) return hit;

    const positions = hit.object.geometry?.attributes?.position;
    if (!positions) return hit;

    const worldPos = new THREE.Vector3()
        .fromBufferAttribute(positions, idx)
        .applyMatrix4(hit.object.matrixWorld);

    return {
        point:    worldPos,
        object:   hit.object,
        index:    idx,
        distance: hit.distance,
        face:     null,   // Points non ha face
    };
}

// ── Vertice più vicino alla retta (fallback point cloud) ──────────────────────
// Usato quando il threshold del Raycaster non trova hits.
// Scansiona tutti i THREE.Points nei target e restituisce il vertice
// con distanza minima dalla retta (non dal punto di origine).
// Complessità O(n vertici) — accettabile per uso interattivo (un click).
// hitFilter (opzionale): ({ point, object }) => boolean — false scarta il vertice (es. parte tagliata)
export function pickClosestPointCloud(ray, targets, hitFilter = null) {
    let bestDistSq = Infinity;
    let bestPt     = null;
    let bestObj    = null;
    let bestIdx    = -1;

    const tmp = new THREE.Vector3();

    function scan(obj) {
        if (!obj.isPoints) {
            for (const child of obj.children ?? []) scan(child);
            return;
        }
        const positions = obj.geometry?.attributes?.position;
        if (!positions) return;

        for (let i = 0; i < positions.count; i++) {
            tmp.fromBufferAttribute(positions, i).applyMatrix4(obj.matrixWorld);
            const dSq = ray.distanceSqToPoint(tmp);
            if (dSq < bestDistSq && (!hitFilter || hitFilter({ point: tmp, object: obj }))) {
                bestDistSq = dSq;
                bestPt     = tmp.clone();
                bestObj    = obj;
                bestIdx    = i;
            }
        }
    }

    for (const t of targets) scan(t);

    if (!bestObj) return null;

    return {
        point:    bestPt,
        object:   bestObj,
        index:    bestIdx,
        distance: ray.origin.distanceTo(bestPt),
        face:     null,
    };
}

// ── Risoluzione completa di un hit da Raycaster ───────────────────────────────
// Esegue intersectObjects sui target e applica la logica di snap:
//   snap ON:  mesh → vertice triangolo più vicino
//             points → closest-point-cloud (o hit standard se mesh non colpita)
//   snap OFF: hit standard (Three.js default)
// Restituisce il hit risolto (con .point corretto) oppure null.
// hitFilter (opzionale): (hit) => boolean — false scarta l'intersezione (es. parte tagliata, piani)
export function resolveHit(rc, targets, snapEnabled, hitFilter = null) {
    const keep = (h) => !hitFilter || hitFilter(h);
    if (snapEnabled) {
        const hits    = rc.intersectObjects(targets, true).filter(keep);
        const meshHit = hits.find(h => h.object && !h.object.isPoints);
        if (meshHit) {
            return snapToNearestMeshVertex(meshHit);
        }
        // Nessun mesh: cerca il vertice di point cloud più vicino alla retta
        return pickClosestPointCloud(rc.ray, targets, hitFilter);
    } else {
        // Snap OFF: comportamento Three.js standard
        // Points: threshold allargato per compensare la bassa densità
        rc.params.Points = rc.params.Points ?? {};
        rc.params.Points.threshold = 0.5;
        const hits = rc.intersectObjects(targets, true).filter(keep);
        if (!hits.length) return null;
        const hit = hits[0];
        return hit.object?.isPoints ? correctPointHit(hit) : hit;
    }
}

// ── Risoluzione di un hit già acquisito (EyeLock path) ───────────────────────
// Applicata quando l'hit arriva già formato da ControlsManager (es. EyeLock).
// Per Points: correctPointHit viene chiamata SEMPRE indipendentemente da snap,
// perché Three.js restituisce la proiezione del vertice sulla retta (non il vertice)
// e questa correzione è necessaria in qualsiasi modalità.
export function resolveExistingHit(hit, snapEnabled) {
    if (!hit) return null;

    if (hit.object?.isPoints) {
        return correctPointHit(hit);   // sempre: fix proiezione retta → vertice reale
    }
    if (!snapEnabled) return hit;
    return snapToNearestMeshVertex(hit);
}
