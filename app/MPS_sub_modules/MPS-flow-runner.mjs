// app/MPS_sub_modules/MPS-flow-runner.mjs
// Carica ed esegue i grafi LiteGraph embedded (flow_type='object' collegati
// all'oggetto corrente, vedi api/flows_tool.php?action=list_for_object) per
// pannelli MPS. Parallelo semplificato a TJS-flow-runner.mjs / OSD-flow-runner.mjs:
// MPS non ha un render loop (nessun RAF) quindi non serve un tick periodico —
// i nodi Local/* si auto-innescano (onStart → appBusOn → graph.runStep(1)),
// i nodi azione (MPS/Camera/*, MPS/Marker/*, MPS/Style/*, MPS/Geo/*)
// girano solo su trigger EVENT in arrivo dal grafo (es. da MPS/Events/* o da
// un App Bus Receiver).
//
// Più flow collegati allo stesso oggetto → più grafi indipendenti, tutti
// condividono lo stesso _appContext (stessa mappa/state del pannello) → le
// capacità si sommano.

import { registerMPSFlowNodes }   from "./MPS-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Costruisce la forma di _appContext per un pannello MPS — usata sia dal
 * caricamento embedded qui sotto (Contesto 3) sia da _injectTestContext in
 * model_FLE.mjs (Contesto 1, test dev-mode): UNA sola definizione, per non
 * andare fuori sincrono come accaduto fra questo file e model_FLE.mjs prima
 * di questo refactor (vedi module-fle-architettura.md §4).
 *
 * @param {object} state   — stato MPS del pannello (bodyEl[STATE_KEY])
 * @param {object} object  — oggetto ReseArch corrente (per objId)
 */
export function buildMPSAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'MPS',
        sourcePanelId: object?.obj_id ?? null,
        get map()      { return state.map; },
        get mod_spec() { return state.mod_spec; },
        localEvents:    state.localEvents,
        readView:       () => state.readView(),
        applyView:      (view, opts) => state.applyView(view, opts),
        listMarkers:    () => state.listMarkers(),
        goToMarker:     (id_mrk) => state.goToMarker(id_mrk),
        viewToMarker:   (id_mrk) => state.viewToMarker(id_mrk),
        setMarkerStyle: (id_mrk, colore) => state.setMarkerStyle(id_mrk, colore),
        // segnaposto creati dai flow (MPS/Marker/Add, AddList, Update, Remove, Fit), 2D e 3D
        addFlowMarker:     (data, opts) => state.addFlowMarker(data, opts),
        updateFlowMarker:  (id, style, data) => state.updateFlowMarker(id, style, data),
        removeFlowMarkers: (sel) => state.removeFlowMarkers(sel),
        listFlowMarkers:   (group) => state.listFlowMarkers(group),
        fitFlowMarkers:    (group, opts) => state.fitFlowMarkers(group, opts),
    };
}

/**
 * Carica tutti i flow embedded collegati all'oggetto di un pannello MPS.
 * Va chiamato da renderBody() dopo che state.map è stato creato.
 *
 * @param {object}      state   — stato MPS del pannello (bodyEl[STATE_KEY])
 * @param {object}      object  — oggetto ReseArch corrente (per objId)
 * @param {AbortSignal} signal  — signal del pannello, per cleanup automatico
 */
export async function mpsLoadFlows(state, object, signal) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[MPS-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }

    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[MPS-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted || flows.length === 0) return;

    registerMPSFlowNodes();
    registerAppBusFlowNodes();

    // Contesto condiviso da tutti i grafi di questo pannello — getter lazy:
    // lo stato (state.map, state.mod_spec) può cambiare dopo il caricamento
    // (switch modello, reload), i nodi devono sempre leggere la versione attuale.
    const appContext = buildMPSAppContext(state, object);

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
            console.error('[MPS-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, graph._appContext.signal);

        // Nessun graph.start()/RAF: chiamiamo onStart a mano (come FLE-runtime.mjs)
        // così i nodi Local/*, MPS/Events/* registrano i loro listener senza
        // timer interni.
        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[MPS-flow-runner] onStart:', e); }
        }

        ctrl.signal.addEventListener('abort', () => {
            stopFlowGraph(graph);
        }, { once: true });

        console.log(`[MPS-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}
