// app/JSX_sub_modules/JSX-flow-runner.mjs
// Carica ed esegue i flow embedded collegati a un oggetto JSX (step 9 di
// _doc/arch-abilitazioni.md §7). Stesso schema di HTM-flow-runner.mjs: niente
// render loop — onStart a mano, poi un primo step (in cui JSX/Script disegna).
// model_JSX.mjs lo chiama dopo aver creato il board del documento attivo, con
// un signal per-documento: cambiando grafico i flow del precedente si fermano.

import { registerJSXFlowNodes }   from "./JSX-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/**
 * _appContext di un pannello JSX: getter lazy sul board del documento attivo
 * (ricreato a ogni cambio di grafico). Usato anche da model_FLE.mjs
 * (_injectTestContext, "Testa su panel").
 */
export function buildJSXAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'JSX',
        sourcePanelId: object?.obj_id ?? null,
        get board()  { return state.board; },
        get JXG()    { return state.JXG; },
        get params() { return state.params ?? {}; },
    };
}

export async function jsxLoadFlows(state, object, signal) {
    const LG = window.LiteGraph, LGraph = window.LGraph;
    if (!LG || !LGraph) { console.warn('[JSX-flow-runner] LiteGraph non disponibile — flow ignorati'); return 0; }
    const objId = object?.obj_id ?? null;
    if (!objId) return 0;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[JSX-flow-runner] fleListForObject:', err);
        return 0;
    }
    if (signal?.aborted || !flows.length) return 0;

    registerJSXFlowNodes();
    registerAppBusFlowNodes();
    const appContext = buildJSXAppContext(state, object);

    let loaded = 0;
    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;
        const graph = new LGraph();
        graph._appContext = Object.create(appContext);
        const ctrl = new AbortController();
        signal?.addEventListener?.('abort', () => ctrl.abort(), { once: true });
        graph._appContext.signal = ctrl.signal;

        try { graph.configure(graphData); repairKnownMigrations(graph); }   // nodi rinominati/spostati: riparati in silenzio
        catch (err) { console.error('[JSX-flow-runner] graph.configure:', err, flow); continue; }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, graph._appContext.signal);

        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[JSX-flow-runner] onStart:', e); }
        }
        try { graph.runStep(1); } catch (e) { console.error('[JSX-flow-runner] runStep iniziale:', e); }
        ctrl.signal.addEventListener('abort', () => { stopFlowGraph(graph); }, { once: true });
        loaded++;
    }
    return loaded;
}
