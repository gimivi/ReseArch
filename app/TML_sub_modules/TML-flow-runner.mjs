// app/TML_sub_modules/TML-flow-runner.mjs
// Carica ed esegue i flow embedded (flow_type='object') collegati a un oggetto TML.
// Stesso schema di MPS-flow-runner.mjs / ECH-flow-runner.mjs: nessun render loop; i nodi
// TML/Events/* si agganciano in onStart a state.localEvents e fanno girare il grafo
// (runStep) a ogni evento, i nodi azione lavorano su trigger.

import { registerTMLFlowNodes }   from "./TML-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Forma di _appContext per un pannello TML — usata dal caricamento embedded qui sotto e da
 * _injectTestContext in model_FLE.mjs ("Testa su panel"): una sola definizione.
 * Tutti i metodi lanciano un Error con un messaggio leggibile se i dati non vanno bene
 * (i nodi lo mostrano con triggerError).
 *
 * @param {object} state   stato TML del pannello (bodyEl.__TML_STATE__)
 * @param {object} object  oggetto ReseArch
 */
export function buildTMLAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'TML',
        sourcePanelId: object?.obj_id ?? null,
        localEvents:   state.localEvents,
        get ready()    { return !!state.timeline && !state.stopped; },
        addItem:         (item)            => state.addItem(item),
        updateItem:      (id, fields)      => state.updateItem(id, fields),
        removeItem:      (id)              => state.removeItem(id),
        getItem:         (id)              => state.getItem(id),
        listItems:       (group)           => state.listItems(group),
        selectItems:     (ids, emit)       => state.selectItems(ids, emit),
        setItemClass:    (id, cls, op)     => state.setItemClass(id, cls, op),
        setWindow:       (s, e, animate)   => state.setWindow(s, e, animate),
        getWindow:       ()                => state.getWindow(),
        fit:             (ids)             => state.fit(ids),
        focusItem:       (id)              => state.focusItem(id),
        listGroups:      ()                => state.listGroups(),
        setGroupVisible: (id, visible)     => state.setGroupVisible(id, visible),
        applyFilter:     (filter)          => state.applyFilter(filter),
        clearFilter:     ()                => state.clearFilter(),
        setCursor:       (ms, opts)        => state.setCursor(ms, opts),
        getCursor:       ()                => state.getCursor(),
        loadData:        (data)            => state.loadData(data),
        listThemes:      ()                => state.listThemes(),
        setThemeActive:  (name, on)        => state.setThemeActive(name, on),
        listLayers:      ()                => state.listLayers(),
        setLayerVisible: (id, visible)     => state.setLayerVisible(id, visible),
    };
}

/**
 * Carica i flow embedded collegati all'oggetto di un pannello TML.
 * Va chiamato da renderBody() quando la timeline è pronta.
 */
export async function tmlLoadFlows(state, object, signal) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[TML-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }

    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[TML-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted || flows.length === 0) return;

    registerTMLFlowNodes();
    registerAppBusFlowNodes();

    const appContext = buildTMLAppContext(state, object);

    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;

        const graph = new LGraph();
        graph._appContext = Object.create(appContext);

        const ctrl = new AbortController();
        signal?.addEventListener?.('abort', () => ctrl.abort(), { once: true });
        graph._appContext.signal = ctrl.signal;

        try {
            graph.configure(graphData); repairKnownMigrations(graph);
        } catch (err) {
            console.error('[TML-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, graph._appContext.signal);

        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[TML-flow-runner] onStart:', e); }
        }

        ctrl.signal.addEventListener('abort', () => {
            for (const node of graph._nodes ?? []) { try { node.onStop?.(); } catch { /* noop */ } }
            stopFlowGraph(graph);
        }, { once: true });

        console.log(`[TML-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}
