// app/IFC_sub_modules/IFC-flow-runner.mjs
// Flow dell'oggetto (Contesto 3) per i pannelli IFC: carica i flow collegati all'oggetto,
// costruisce il contesto dei nodi e li avvia. Stesso schema di PDF-flow-runner.mjs.
//
// Contesto (graph._appContext):
//   ifc          → API del pannello (makeFlowApi in model_IFC.mjs), usata dai nodi IFC/*
//   localEvents  → eventi del pannello per IFC/Events/* (select, deselect, modelsLoaded, cameraSettled)
//   scene, camera, renderer, modelsRoot, models, markDirty
//                → gli stessi nomi del contesto TJS: i nodi TJS che usano solo questi
//                  (Geometry, Material, Texture, Scene, Object, Light/Set*, Model/Load URL…)
//                  funzionano anche nella scena IFC. IFC e TJS usano la stessa istanza di Three.
//                  Niente orbitControls: i nodi TJS/Camera/* non agiscono (si usano IFC/Camera/*).

import { registerIFCFlowNodes }    from "./IFC-flow-nodes.mjs";
import { registerTJSFlowNodes }    from "../TJS_sub_modules/TJS-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Forma di _appContext per un pannello IFC — usata dal caricamento qui sotto e da
 * _injectTestContext in model_FLE.mjs ("Testa su panel"): una sola definizione.
 * Getter: leggono lo stato al momento dell'uso.
 *
 * @param {object} state   — stato IFC del pannello (bodyEl.__IFC_RENDER_STATE__)
 * @param {object} object  — oggetto ReseArch corrente
 */
export function buildIFCAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'IFC',
        sourcePanelId: object?.obj_id ?? null,
        localEvents:   state.localEvents,
        cmdUI:         state.cmdUI,
        get ifc()        { return state.stopped ? null : (state.flowApi ?? null); },
        // per i nodi TJS riusabili
        get scene()      { return state.world?.scene?.three ?? null; },
        get camera()     { return state.world?.camera?.three ?? null; },
        get renderer()   { return state.world?.renderer?.three ?? null; },
        get modelsRoot() { return state.modelsRoot ?? null; },
        models:        state.models ?? [],
        markDirty:     () => {},   // IFC ridisegna a ogni fotogramma (ciclo di Components)
    };
}

/**
 * Carica i flow embedded collegati all'oggetto di un pannello IFC.
 * Chiamato da renderBody() quando state (con localEvents e flowApi) è pronto.
 */
export async function ifcLoadFlows(state, object, signal) {
    const LGraph = window.LGraph;
    if (!window.LiteGraph || !LGraph) {
        console.warn('[IFC-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }
    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[IFC-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted || state.stopped || flows.length === 0) return;

    registerIFCFlowNodes();
    registerTJSFlowNodes();
    registerAppBusFlowNodes();

    const appContext = buildIFCAppContext(state, object);

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
            graph.configure(graphData); repairKnownMigrations(graph);   // nodi rinominati/spostati: riparati in silenzio
        } catch (err) {
            console.error('[IFC-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, ctrl.signal);

        // Niente graph.start(): onStart a mano, fermata con stopFlowGraph (vedi panel-flow.mjs)
        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[IFC-flow-runner] onStart:', e); }
        }
        ctrl.signal.addEventListener('abort', () => stopFlowGraph(graph), { once: true });

        console.log(`[IFC-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}
