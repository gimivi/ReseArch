// app/OLY_sub_modules/OLY-flow-runner.mjs
// Flow dell'oggetto (Contesto 3) per i pannelli OLY: carica i flow collegati all'oggetto, costruisce
// il contesto dei nodi e li avvia. Stesso schema di IFC-flow-runner.mjs / PDF-flow-runner.mjs.
//
// Contesto (graph._appContext):
//   oly          → API del pannello (makeFlowApi in model_OLY.mjs), usata dai nodi OLY/*
//   localEvents  → eventi del pannello: select, deselect, click, moveEnd, layersLoaded

import { registerOLYFlowNodes }    from "./OLY-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/** Contesto dei nodi OLY: una sola definizione, usata anche da "Testa su panel" (model_FLE.mjs). */
export function buildOLYAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'OLY',
        sourcePanelId: object?.obj_id ?? null,
        localEvents:   state.localEvents,
        cmdUI:         state.cmdUI,
        get oly() { return state.stopped ? null : (state.flowApi ?? null); },
    };
}

export async function olyLoadFlows(state, object, signal) {
    const LGraph = window.LGraph;
    if (!window.LiteGraph || !LGraph) {
        console.warn('[OLY-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }
    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[OLY-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted || state.stopped || flows.length === 0) return;

    registerOLYFlowNodes();
    registerAppBusFlowNodes();

    const appContext = buildOLYAppContext(state, object);

    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;

        const graph = new LGraph();
        graph._appContext = Object.create(appContext);
        graph._flowId = flow.flow_id ?? null;

        const ctrl = new AbortController();
        signal?.addEventListener?.('abort', () => ctrl.abort(), { once: true });
        graph._appContext.signal = ctrl.signal;

        try {
            graph.configure(graphData); repairKnownMigrations(graph);
        } catch (err) {
            console.error('[OLY-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, ctrl.signal);

        // Niente graph.start(): onStart a mano, fermata con stopFlowGraph (vedi panel-flow.mjs)
        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[OLY-flow-runner] onStart:', e); }
        }
        ctrl.signal.addEventListener('abort', () => stopFlowGraph(graph), { once: true });

        console.log(`[OLY-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}
