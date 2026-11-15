// FLE_sub_modules/FLE-nodes-custom.mjs
// Caricamento e registrazione centralizzato dei nodi LiteGraph custom specifici di progetto.
//
// Convenzione: ogni file FLE-node-*.mjs esporta una funzione
//   registerXxx(LiteGraph) { LiteGraph.registerNodeType(...) }
//
// Per aggiungere un nuovo nodo custom:
//   1. Creare app/FLE_sub_modules/FLE-node-NomeNodo.mjs
//   2. Importare la funzione qui sotto
//   3. Aggiungerla all'array CUSTOM_NODE_REGISTRARS

import { registerPoint3DSum } from "./FLE-node-Point3DSum.mjs";

// Elenco di tutte le funzioni di registrazione.
// Aggiungere qui le nuove voci man mano che si creano nuovi nodi.
const CUSTOM_NODE_REGISTRARS = [
    registerPoint3DSum,
    // registerAltroNodo,
];

let _registered = false;

/**
 * Registra tutti i nodi custom di progetto in LiteGraph.
 * Idempotente: la seconda chiamata è no-op.
 *
 * Richiede che window.LiteGraph sia già disponibile
 * (caricato in dashboard.php prima dei moduli ES).
 */
export async function fleRegisterCustomNodes() {
    if (_registered) return;

    const LiteGraph = window.LiteGraph;
    if (typeof LiteGraph === "undefined") {
        console.warn("[FLE] fleRegisterCustomNodes: window.LiteGraph non disponibile. Nodi custom non registrati.");
        return;
    }

    for (const register of CUSTOM_NODE_REGISTRARS) {
        try {
            register(LiteGraph);
        } catch (err) {
            console.error("[FLE] Errore registrazione nodo:", register?.name, err);
        }
    }

    _registered = true;
    console.log(`[FLE] ${CUSTOM_NODE_REGISTRARS.length} nodo/i custom registrato/i.`);
}
