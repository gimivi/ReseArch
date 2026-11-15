// TJS_sub_modules/TJS-bus.mjs
// App Bus integration per Three.js: SOLO pubblicazione.
//   - tjsBusEmit → emette selection:change verso il bus (selezione/pick nella scena)
//
// (2026-10-07) Tolte le reazioni automatiche ai messaggi del bus (tjsAttachBusReceivers):
// selection:change da QUALUNQUE pannello evidenziava gli oggetti col nome in "field"
// (es. un clic sul grafo ECH illuminava tutti gli oggetti omonimi, con il vecchio difetto
// del colore salvato per mesh), filter:apply mostrava/nascondeva oggetti per nome,
// data:refresh scriveva solo in console. Come per MPS: pubblicare è innocuo, APPLICARE un
// messaggio di un altro pannello si costruisce con un flow (App Bus Receiver →
// TJS/Scene/GetObjectByUuid → TJS/Object/Highlight, Set Visibility…).

import { appBusEmit } from "../app-bus.mjs";

// ─── Emitter ─────────────────────────────────────────────────────────────────

/**
 * Risale la catena dei parent finché trova il figlio diretto di modelsRoot.
 * Ritorna quel Group (il wrapper del modello DB) oppure null.
 */
export function tjsFindModelWrapper(obj3d, modelsRoot) {
    if (!obj3d || !modelsRoot) return null;
    let node = obj3d;
    while (node) {
        if (node.parent === modelsRoot) return node;
        node = node.parent;
    }
    return null;
}

/**
 * Emette un evento selection:change sul Bus con payload a 3 livelli.
 *
 * Struttura payload:
 *   appObject   — record DB del pannello  {objId, objApp, objName}
 *   model       — record DB del modello   {modId, modName, position}
 *                 position = posizione world del wrapper Group (già trasformato)
 *   sceneObject — oggetto Three.js        {name, type, uuid, position, hitPoint, normal, face, materialIndex, uv, uv1}
 *                 position = posizione locale relativa al padre
 *                 hitPoint = punto di intersezione world (raycast)
 *                 normal   = normale locale alla faccia nel punto colpito
 *                 face     = indice del triangolo colpito (hit.faceIndex; fino al
 *                            2026-10-03 era per errore il materialIndex)
 *                 materialIndex = indice del materiale della faccia colpita
 *                 uv / uv1 = coordinate di mappa {u,v} (canale principale / secondo),
 *                            null se la geometria non ha UV
 *
 * @param {object}           object     — record DB oggetto corrente (contiene obj_id)
 * @param {THREE.Object3D|null} obj3d   — oggetto 3D selezionato (null = deselect)
 * @param {THREE.Group|null} modelsRoot — root dei modelli caricati
 * @param {object}           opts       — dati raycast pre-calcolati dal call site
 *   @param {{x,y,z}|null}  opts.hitPoint     — punto world dell'intersezione
 *   @param {{x,y,z}|null}  opts.normal       — normale locale alla faccia
 *   @param {number|null}   opts.face         — indice del triangolo (faceIndex)
 *   @param {number|null}   opts.materialIndex — indice del materiale
 *   @param {{u,v}|null}    opts.uv / opts.uv1 — coordinate di mappa
 *   @param {{x,y,z}|null}  opts.modelWorldPos — posizione world del wrapper Group
 */
export function tjsBusEmit(object, obj3d = null, modelsRoot = null,
                           { hitPoint = null, normal = null, face = null, materialIndex = null,
                             uv = null, uv1 = null, modelWorldPos = null } = {}) {
    const modelWrapper = tjsFindModelWrapper(obj3d, modelsRoot);
    const modelRow     = modelWrapper?.userData?.modelRow ?? null;
    const scenePos     = obj3d?.position
        ? { x: obj3d.position.x, y: obj3d.position.y, z: obj3d.position.z }
        : null;

    appBusEmit('selection:change', {
        // objId a livello root: convenzione generale del payload (arch-app-bus.md §4),
        // usata da tutti i consumatori generici del bus (FLE editor/runtime) per capire
        // da quale pannello arriva l'evento. Duplica appObject.objId qui sotto.
        objId: object?.obj_id ?? null,
        appObject: {
            objId:   object?.obj_id   ?? null,
            objApp:  object?.obj_app  ?? null,
            objName: object?.obj_name ?? null,
        },
        model: modelRow ? {
            modId:    modelRow.mod_id   ?? null,
            modName:  modelRow.mod_name ?? null,
            position: modelWorldPos,
        } : null,
        sceneObject: obj3d ? {
            name:     obj3d.name ?? null,
            type:     obj3d.type ?? null,
            uuid:     obj3d.uuid ?? null,
            position: scenePos,
            hitPoint,
            normal,
            face,
            materialIndex,
            uv,
            uv1,
        } : null,
    });
}
