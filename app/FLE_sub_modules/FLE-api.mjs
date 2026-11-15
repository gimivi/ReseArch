// app/FLE_sub_modules/FLE-api.mjs
// Wrapper fetch per api/flows_tool.php (sostituisce api/wp_flows_tool.php e
// la lettura/scrittura diretta di models.mod_fle — vedi sql/migration_flows.sql
// e _doc/module-fle-architettura.md §9).

import { ensureLibraryNodes } from './FLE-library-nodes.mjs';

const EP = 'api/flows_tool.php';

// Errori: il messaggio del server (es. 403 "solo l'autore o l'amministratore…") arriva
// al chiamante invece di un generico "HTTP 403"; err.response = corpo JSON (per
// esempio { confirm: true, links } sull'eliminazione di un flow collegato).
async function _json(res) {
    const j = await res.json().catch(() => null);
    if (!res.ok) {
        const err = new Error(j?.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.response = j;
        throw err;
    }
    return j;
}

async function _get(params) {
    // Prima di consegnare un grafo da configurare, i nodi di libreria devono
    // essere registrati (arch-abilitazioni.md §6): altrimenti risulterebbero orfani.
    if (params.action === 'load' || params.action === 'list_for_object' || params.action === 'list_for_dashboard' || params.action === 'load_shared') {
        await ensureLibraryNodes();
    }
    const res = await fetch(`${EP}?${new URLSearchParams(params)}`, { credentials: 'same-origin' });
    return _json(res);
}

async function _post(body) {
    const res = await fetch(EP, {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(body),
    });
    return _json(res);
}

// ── Singolo flow (oggetto o dashboard) ─────────────────────────────────────
// Elenco, creazione da catalogo, duplicazione, eliminazione e autore passano da
// ui/modal_flows.js (azioni list/batch/duplicate); i collegamenti dalla modale
// Link. La vecchia modale dei flow dashboard (flow_list.mjs/flow_editor.mjs) e le
// sue funzioni qui (fleList, fleCreate, fleDuplicate, fleDelete,
// fleDeleteConfirmed, fleSetActive, fleSetInactive, fleListAuthors, fleSetAuthor)
// sono state rimosse il 2026-10-04 (_doc/arch-flow-dashboard.md).
// forEdit=true: apertura nell'editor — il server rifiuta se l'autore non consente
// di aprire il sorgente (flow_edit=0). Senza: caricamento per l'esecuzione (runtime).
export const fleLoad        = (id, forEdit = false)          => _get(forEdit ? { action: 'load', flow_id: id, for: 'edit' } : { action: 'load', flow_id: id });
export const fleUpdate      = (id, name, fle)                => _post({ action: 'update',    flow_id: id, flow_name: name, flow_fle: fle });
export const fleUpdateMeta  = (id, fields)                   => _post({ action: 'update',    flow_id: id, ...fields });

/**
 * Estrae il grafo LiteGraph (adatto a graph.configure()) da un valore flow_fle:
 * { graph: {...} } (la vecchia modale dei flow dashboard aggiungeva anche
 * topics_snapshot, solo informativo e ignorato).
 * Il formato "grezzo" { nodes, links, … } dei flow migrati da models.mod_fle non
 * è più accettato (2026-10-04): quei flow sono stati convertiti nel database.
 * Ritorna null se flowFle non contiene un grafo utilizzabile.
 */
export function extractGraphData(flowFle) {
    if (!flowFle || typeof flowFle !== 'object') return null;
    if (flowFle.graph && typeof flowFle.graph === 'object') return flowFle.graph;
    return null;
}

/**
 * Filtra l'elenco flow (da fleListForObject) secondo la selezione fatta
 * nel dialogo di caricamento oggetto (ui/modal_tree_obj.js — checkbox "Flow
 * embedded collegati"). La selezione viaggia su object.__loadFlowIds (array
 * di flow_id) invece che come parametro dedicato, per non toccare la
 * convenzione "FINAL" (container, object, models) di model_renderers.js.
 * Se assente (pannello aperto per altra via, es. test dev-mode), nessun
 * filtro — comportamento di default: carica tutti i flow collegati.
 *
 * Flow di configurazione (flow_role='config'): sempre caricati e per primi —
 * configurano l'oggetto (es. TJS/Setup/Walkthrough) prima che quelli di
 * comportamento reagiscano. Solo i flow di comportamento sono escludibili.
 * Vale per tutte le app: ogni flow-runner passa di qui.
 */
export function filterSelectedFlows(flows, object) {
    const isConfig = (f) => f?.flow_role === 'config';
    const ordered = [...flows.filter(isConfig), ...flows.filter(f => !isConfig(f))];
    const ids = object?.__loadFlowIds;
    if (!Array.isArray(ids)) return ordered;
    const set = new Set(ids);
    return ordered.filter(f => isConfig(f) || set.has(f.flow_id));
}

// ── Flow embedded (flow_type='object', Contesto 3) ──────────────────────────
/** Elenco flow embedded collegati a un oggetto (con flow_fle completo) — usata dai flow-runner TJS/OSD/MPS. */
export const fleListForObject   = (objId)         => _get({ action: 'list_for_object', obj_id: objId });
/** Flow dashboard collegati a una Dashboard Config (con flow_fle; null se non eseguibile per l'utente) — runtime e selettore editor. */
export const fleListForDashboard = (dshpId)       => _get({ action: 'list_for_dashboard', dshp_id: dshpId });
/** Crea un nuovo flow embedded collegato a un oggetto — usata da model_FLE.mjs al primo salvataggio. */
export const fleCreateForObject = (objId, name, fle) => _post({ action: 'create_for_object', obj_id: objId, flow_name: name, flow_fle: fle });
/**
 * Carica flow_fle di un flow embedded APPARTENENTE A UN ALTRO OGGETTO/WP,
 * ammesso in base alla soglia flow_share (non al WP di sessione come fleLoad).
 * Usata da model_FLE.mjs per pre-popolare un flow NUOVO copiandone il
 * contenuto — vedi ui/modal_flow_embedded.js, opzione "nuovo da esistente
 * condiviso" (embeddedTarget.seedFlowId/seedScope).
 */
export const fleLoadShared = (flowId, scope = 'wp', flowType = 'object') => _get({ action: 'load_shared', flow_id: flowId, scope, flow_type: flowType });
/**
 * Crea un flow dashboard con contenuto e lo collega a una Dashboard Config
 * (_doc/arch-flow-dashboard.md §3.4) — usata da model_FLE.mjs al primo salvataggio.
 */
export const fleCreateForDashboard = (dshpId, name, fle) => _post({ action: 'create', flow_type: 'dashboard', dshp_id: dshpId, flow_name: name, flow_fle: fle });
/** Scollega un flow da una Dashboard Config (la copia salvata dall'editor prende il suo posto, §8.1). */
export async function fleUnlinkFromDashboard(dshpId, flowId) {
    const res = await fetch('ui/modal_objmod_links_tools.php', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ action: 'save_dashboard_flow_links', dshp_id: dshpId, added: [], removed: [flowId] }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return j;
}
