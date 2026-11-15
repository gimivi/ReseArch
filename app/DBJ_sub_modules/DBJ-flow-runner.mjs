// app/DBJ_sub_modules/DBJ-flow-runner.mjs
// Carica ed esegue i grafi LiteGraph embedded (flow_type='object' collegati
// all'oggetto corrente, vedi api/flows_tool.php?action=list_for_object) per
// pannelli DBJ. Parallelo semplificato a MPS-flow-runner.mjs: DBJ non ha un
// render loop (nessun RAF) quindi non serve un tick periodico — i nodi
// Local/* si auto-innescano (onStart → appBusOn → graph.runStep(1)), i nodi
// azione (DBS/DBJ/Data/*) girano solo su trigger EVENT in arrivo dal grafo
// (es. da DBS/DBJ/Events/OnRowSelected o da un App Bus Receiver).
//
// Più flow collegati allo stesso oggetto → più grafi indipendenti, tutti
// condividono lo stesso _appContext (stesso state del pannello) → le
// capacità si sommano.

import { registerDBJFlowNodes }   from "./DBJ-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Costruisce la forma di _appContext per un pannello DBJ — usata sia dal
 * caricamento embedded qui sotto (Contesto 3) sia da _injectTestContext in
 * model_FLE.mjs (Contesto 1, test dev-mode): UNA sola definizione, per non
 * andare fuori sincrono fra i due punti (vedi module-fle-architettura.md §4.1
 * — stesso rischio già corretto per MPS).
 *
 * @param {object} state   — stato DBJ del pannello (bodyEl[STATE_KEY])
 * @param {object} object  — oggetto ReseArch corrente (per objId)
 */
export function buildDBJAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'DBJ',
        sourcePanelId: object?.obj_id ?? null,
        get spec()        { return state.spec; },
        get selectedRow() { return state.selectedRow; },
        localEvents:   state.localEvents,
        cmdUI:         state.cmdUI,
        getRecords:    () => state.getRecords(),
        refresh:       () => state.refresh(),
    };
}

/**
 * Carica tutti i flow embedded collegati all'oggetto di un pannello DBJ.
 * Va chiamato da renderBody() dopo che state (con localEvents) è pronto.
 *
 * @param {object}      state   — stato DBJ del pannello (bodyEl[STATE_KEY])
 * @param {object}      object  — oggetto ReseArch corrente (per objId)
 * @param {AbortSignal} signal  — signal del pannello, per cleanup automatico
 */
export async function dbjLoadFlows(state, object, signal) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[DBJ-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }

    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[DBJ-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted || flows.length === 0) return;

    registerDBJFlowNodes();
    registerAppBusFlowNodes();

    // Contesto condiviso da tutti i grafi di questo pannello — getter lazy:
    // lo stato (state.spec, state.selectedRow) può cambiare dopo il
    // caricamento (nuova riga selezionata, reload), i nodi devono sempre
    // leggere la versione attuale.
    const appContext = buildDBJAppContext(state, object);

    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;

        const graph = new LGraph();
        graph._appContext = Object.create(appContext);

        // AbortController per-grafo derivato dal signal del pannello.
        const ctrl = new AbortController();
        if (signal?.addEventListener) {
            signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }
        graph._appContext.signal = ctrl.signal;

        try {
            graph.configure(graphData); repairKnownMigrations(graph);   // nodi rinominati/spostati: riparati in silenzio
        } catch (err) {
            console.error('[DBJ-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, graph._appContext.signal);

        // Nessun graph.start()/RAF: chiamiamo onStart a mano (come
        // FLE-runtime.mjs) così i nodi Local/*, DBS/DBJ/Events/* registrano
        // i loro listener senza timer interni.
        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[DBJ-flow-runner] onStart:', e); }
        }

        ctrl.signal.addEventListener('abort', () => {
            stopFlowGraph(graph);
        }, { once: true });

        console.log(`[DBJ-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}
