// app/FLE_sub_modules/FLE-runtime.mjs
// Bus Runtime — esegue in background, senza canvas, i flow dashboard collegati
// alla Dashboard Config caricata (_doc/arch-flow-dashboard.md §3.3, 2026-10-04).
//
// Responsabilità:
//   - Su 'dcfg:loaded' (app/dashboard_cfg.mjs): ferma tutto e avvia un LGraph
//     headless per ogni flow collegato alla Config (null = nessun flow)
//   - Fornisce ai grafi il contesto minimo ({ signal }) e chiama onStart dei nodi:
//     i nodi App Bus Receiver/Emitter (app/AppBus-flow-nodes.mjs) si collegano al
//     bus da soli (fino al 2026-10-04 il runtime cercava gli App Emitter/Receiver
//     con _fleRole e li collegava dall'esterno)
//   - Sospende i flow aperti nell'editor in pannello ('fle:editor:open') e li
//     riavvia, riletti dal database, alla chiusura dell'ultimo pannello
//     ('fle:editor:close'): un flow non gira mai due volte nello stesso browser
//
// Prima del 2026-10-04 eseguiva UN solo flow, quello con flows.is_active del WP.
//
// Esporta:
//   initFlowRuntime()     — chiamare una volta, PRIMA di loadDefaultConfig()
//   getRuntimeState()     — { dshpId, running:[{flowId,flowName}], suspended:[{flowId,flowName}] }
//   isRuntimeRunning()    — almeno un flow in esecuzione
//   stopRuntime()         — ferma tutto fino al prossimo 'dcfg:loaded'
//
// Ascolta su window:
//   'dcfg:loaded'      { dshpId, dshpName }  → esegue i flow della Config (null = nessuno)
//   'fle:editor:open'  { flowId }            → sospende quel flow
//   'fle:editor:close' { flowId }            → lo riavvia (se resta collegato alla Config)
//   'fle:stop'                               → ferma tutto
// ('fle:run' { flowId }, l'avvio a mano dalla vecchia modale dei flow dashboard,
//  è stato rimosso con lei il 2026-10-04)
//
// Dispatcha su window:
//   'fle:runtime:started' { flowId, flowName }  — per ogni flow avviato
//   'fle:runtime:stopped' { flowId }            — per ogni flow fermato
//   'fle:runtime:changed' getRuntimeState()     — a ogni cambio (indicatore nel footer)
//
// Messaggi sul bus: gestiti dai nodi App Bus (etichetta _fromFlow per ignorare solo
// i messaggi del proprio grafo, limite di profondità contro i cicli fra flow).

import { fleListForDashboard, extractGraphData } from "./FLE-api.mjs";
import { registerFlowNodes } from "./FLE-nodes.mjs";
import { repairKnownMigrations } from "./FLE-node-repair.mjs";   // nodi rinominati/spostati: riparati in silenzio

// ============================================================
// Stato
// ============================================================

const _runs      = new Map();  // flowId → { graph, ctrl, flowName, tag }
const _editing   = new Map();  // flowId → numero di pannelli editor aperti su quel flow
const _suspended = new Map();  // flowId → flowName: flow della Config non eseguiti perché aperti nell'editor
let   _dshpId    = null;       // Config caricata (null = nessuna)
let   _loadSeq   = 0;          // scarta risposte di caricamenti superati da un cambio di Config

// ============================================================
// INIT  (una sola chiamata)
// ============================================================

export function initFlowRuntime() {
    registerFlowNodes();

    window.addEventListener('dcfg:loaded',      ev => _loadConfig(ev.detail?.dshpId ?? null));
    window.addEventListener('fle:editor:open',  ev => _onEditorOpen(ev.detail?.flowId));
    window.addEventListener('fle:editor:close', ev => _onEditorClose(ev.detail?.flowId));
    window.addEventListener('fle:stop',         () => { _stopAll(); _changed(); });
}

// ============================================================
// CONFIG CARICATA → flow da eseguire
// ============================================================

async function _loadConfig(dshpId) {
    const seq = ++_loadSeq;
    _stopAll();
    _suspended.clear();
    _dshpId = dshpId ? Number(dshpId) : null;
    if (!_dshpId) { _changed(); return; }

    try {
        const res = await fleListForDashboard(_dshpId);
        if (seq !== _loadSeq) return;   // nel frattempo è stata caricata un'altra Config
        if (!res.ok) throw new Error(res.error);
        for (const flow of res.data ?? []) _startFlow(flow);
    } catch (err) {
        console.error('[fle:runtime] flow della Config:', err);
    }
    _changed();
}

/** Avvia un flow da una riga di list_for_dashboard, salvo se è aperto nell'editor. */
function _startFlow(flow) {
    const flowId   = Number(flow?.flow_id);
    const flowName = flow?.flow_name ?? '';
    if (!flowId) return;
    if (_editing.get(flowId) > 0) { _suspended.set(flowId, flowName); return; }
    if (!flow.flow_fle) {
        // in attesa di validazione o validazione revocata: non eseguibile per questo utente
        console.warn(`[fle:runtime] flow #${flowId} "${flowName}" non eseguibile: ${flow.flow_unavailable_reason || 'nessuna versione disponibile'}`);
        return;
    }
    const graphData = extractGraphData(flow.flow_fle);
    if (!graphData) {
        console.warn(`[fle:runtime] flow #${flowId} "${flowName}": grafo assente — niente da eseguire.`);
        return;
    }
    _stopOne(flowId);

    const graph = new window.LGraph();
    graph.catch_errors = true;   // nodi con errori non crashano il loop
    try { graph.configure(graphData); repairKnownMigrations(graph); } catch (e) { console.warn(`[fle:runtime] configure #${flowId}:`, e); }

    const ctrl = new AbortController();
    // _appContext con signal PRIMA di onStart: i nodi App Bus Receiver/OSD/Events*
    // registrano i loro listener in onStart() e richiedono ctx.signal.
    graph._appContext = { signal: ctrl.signal };
    graph._fleBusTag  = `runtime:${flowId}`;   // etichetta dei messaggi di questo grafo (nodi App Bus)
    // In modalità headless graph.start() non viene invocato: onStart a mano.
    for (const node of graph._nodes ?? []) {
        try { node.onStart?.(); } catch {}
    }

    const run = { graph, ctrl, flowName };
    _runs.set(flowId, run);

    console.info(`[fle:runtime] avviato — flow #${flowId} "${flowName}"`);
    window.dispatchEvent(new CustomEvent('fle:runtime:started', { detail: { flowId, flowName } }));
}

// ============================================================
// EDITOR IN PANNELLO — sospensione
// ============================================================

function _onEditorOpen(flowId) {
    flowId = Number(flowId);
    if (!flowId) return;
    _editing.set(flowId, (_editing.get(flowId) ?? 0) + 1);
    const run = _runs.get(flowId);
    if (run) {
        _suspended.set(flowId, run.flowName);
        _stopOne(flowId);
        console.info(`[fle:runtime] flow #${flowId} sospeso: aperto nell'editor in pannello.`);
        _changed();
    }
}

async function _onEditorClose(flowId) {
    flowId = Number(flowId);
    if (!flowId || !_editing.has(flowId)) return;
    const n = (_editing.get(flowId) ?? 1) - 1;
    if (n > 0) { _editing.set(flowId, n); return; }
    _editing.delete(flowId);
    if (!_suspended.has(flowId)) return;   // non era un flow della Config caricata
    _suspended.delete(flowId);

    // Riletto dal database (modifiche salvate) e solo se è ancora collegato alla Config
    if (!_dshpId) { _changed(); return; }
    const seq = _loadSeq;
    try {
        const res = await fleListForDashboard(_dshpId);
        if (seq !== _loadSeq) return;
        if (!res.ok) throw new Error(res.error);
        const flow = (res.data ?? []).find(f => Number(f.flow_id) === flowId);
        if (flow) _startFlow(flow);
    } catch (err) {
        console.error(`[fle:runtime] riavvio flow #${flowId}:`, err);
    }
    _changed();
}

// ============================================================
// STOP
// ============================================================

function _stopOne(flowId) {
    const run = _runs.get(flowId);
    if (!run) return;
    _runs.delete(flowId);
    run.ctrl.abort();
    for (const node of run.graph._nodes ?? []) {
        try { node.onStop?.(); } catch {}
    }
    window.dispatchEvent(new CustomEvent('fle:runtime:stopped', { detail: { flowId } }));
    console.info(`[fle:runtime] fermato — flow #${flowId} "${run.flowName}"`);
}

function _stopAll() {
    for (const flowId of [..._runs.keys()]) _stopOne(flowId);
}

// ============================================================
// API pubblica
// ============================================================

export function getRuntimeState() {
    return {
        dshpId:    _dshpId,
        running:   [..._runs].map(([flowId, r]) => ({ flowId, flowName: r.flowName })),
        suspended: [..._suspended].map(([flowId, flowName]) => ({ flowId, flowName })),
    };
}
export function isRuntimeRunning() { return _runs.size > 0; }
export function stopRuntime()      { _stopAll(); _changed(); }

function _changed() {
    window.dispatchEvent(new CustomEvent('fle:runtime:changed', { detail: getRuntimeState() }));
}
