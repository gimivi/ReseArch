// app/ECH_sub_modules/ECH-flow-runner.mjs
// Carica ed esegue i grafi LiteGraph embedded (flow_type='object' collegati
// all'oggetto corrente, vedi api/flows_tool.php?action=list_for_object) per
// pannelli ECH. Parallelo semplificato a MPS-flow-runner.mjs/
// PDF-flow-runner.mjs: nessun render loop, i nodi Local/* si auto-innescano,
// i nodi azione (ECH/Chart/*) girano solo su trigger EVENT.

import { registerECHFlowNodes }   from "./ECH-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";
import { mapRows } from "./ECH-data-loader.mjs";

/**
 * Costruisce la forma di _appContext per un pannello ECH — usata sia dal
 * caricamento embedded qui sotto (Contesto 3) sia da _injectTestContext in
 * model_FLE.mjs (Contesto 1, test dev-mode): UNA sola definizione, per non
 * andare fuori sincrono fra i due punti (vedi module-fle-architettura.md §4.1).
 *
 * @param {object} state   — stato ECH del pannello (bodyEl[STATE_KEY])
 * @param {object} object  — oggetto ReseArch corrente (per objId)
 */
export function buildECHAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'ECH',
        sourcePanelId: object?.obj_id ?? null,
        localEvents:   state.localEvents,
        cmdUI:         state.cmdUI,
        highlight:     (p)     => state.highlight(p),
        downplay:      ()      => state.downplay(),
        setZoom:       (s, e)  => state.setZoom(s, e),
        setLegend:     (sel)   => state.setLegend(sel),
        getData:       ()      => state.lastDataset,
        mapRows:       (rows)  => mapRows(rows, state.modSpec?.dataSource?.mapping ?? null),   // mapping del mod_spec (SetData, toggle "mapping")
        getSelected:   ()      => state.lastSelection,
        setData:       (rows)  => state.setData(rows),
        refresh:       ()      => state.refresh(),
        exportPNG:     (name)  => state.exportPNG(name),
        toggleTheme:   ()      => state.toggleTheme(),
    };
}

/**
 * Carica tutti i flow embedded collegati all'oggetto di un pannello ECH.
 * Va chiamato da renderBody() dopo che state (con localEvents) è pronto.
 *
 * @param {object}      state   — stato ECH del pannello (bodyEl[STATE_KEY])
 * @param {object}      object  — oggetto ReseArch corrente (per objId)
 * @param {AbortSignal} signal  — signal del pannello, per cleanup automatico
 */
export async function echLoadFlows(state, object, signal) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[ECH-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }

    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[ECH-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted || flows.length === 0) return;

    registerECHFlowNodes();
    registerAppBusFlowNodes();

    const appContext = buildECHAppContext(state, object);

    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;

        const graph = new LGraph();
        graph._appContext = Object.create(appContext);

        const ctrl = new AbortController();
        if (signal?.addEventListener) {
            signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }
        graph._appContext.signal = ctrl.signal;

        try {
            graph.configure(graphData); repairKnownMigrations(graph);   // nodi rinominati/spostati: riparati in silenzio
        } catch (err) {
            console.error('[ECH-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, graph._appContext.signal);

        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[ECH-flow-runner] onStart:', e); }
        }

        ctrl.signal.addEventListener('abort', () => {
            stopFlowGraph(graph);
        }, { once: true });

        console.log(`[ECH-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}
