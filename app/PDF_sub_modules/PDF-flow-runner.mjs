// app/PDF_sub_modules/PDF-flow-runner.mjs
// Carica ed esegue i grafi LiteGraph embedded (flow_type='object' collegati
// all'oggetto corrente, vedi api/flows_tool.php?action=list_for_object) per
// pannelli PDF. Parallelo semplificato a MPS-flow-runner.mjs/
// MYS-flow-runner.mjs: nessun render loop, i nodi Local/* si auto-innescano,
// i nodi azione (PDF/Nav/*, PDF/View/*, PDF/Document/*, PDF/Highlight/*,
// PDF/Search/*) girano solo su trigger EVENT.

import { registerPDFFlowNodes }   from "./PDF-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Costruisce la forma di _appContext per un pannello PDF — usata sia dal
 * caricamento embedded qui sotto (Contesto 3) sia da _injectTestContext in
 * model_FLE.mjs (Contesto 1, test dev-mode): UNA sola definizione, per non
 * andare fuori sincrono fra i due punti (vedi module-fle-architettura.md §4.1).
 *
 * @param {object} state   — stato PDF del pannello (bodyEl[STATE_KEY])
 * @param {object} object  — oggetto ReseArch corrente (per objId)
 */
export function buildPDFAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'PDF',
        sourcePanelId: object?.obj_id ?? null,
        localEvents:   state.localEvents,
        cmdUI:         state.cmdUI,
        get currentPage() { return state.viewport?.getCurrentPage() ?? null; },
        get totalPages()  { return state.viewport?.numPages ?? null; },
        goToPage:          (n)   => state.viewport?.goToPage(n),
        nextPage:          ()    => state.viewport?.goToPage((state.viewport?.getCurrentPage() ?? 1) + 1),
        prevPage:          ()    => state.viewport?.goToPage((state.viewport?.getCurrentPage() ?? 1) - 1),
        setZoom:           (s)   => state.viewport?.setScale(s),
        zoomStep:          (d)   => state.viewport?.zoomStep(d),
        fitWidth:          ()    => state.viewport?.fitWidth(),
        fitPage:           ()    => state.viewport?.fitPage(),
        setRotation:       (deg) => state.viewport?.setRotation(deg),
        setSpread:         (en)  => state.viewport?.setSpread(en),
        setTextLayer:      (en)  => state.viewport?.setTextLayer(en),
        openDocument:      (idx) => state.openDocument(idx),
        openUrl:           (url, o) => state.openUrl(url, o),
        getHighlights:     ()    => state.highlights ?? [],
        goToHighlight:     (id)  => state.goToHighlight(id),
        showAllHighlights: ()    => state.hlLayer?.showAll(),
        showPageHighlights:(n)   => state.hlLayer?.showPage(n),
        hideHighlights:    ()    => state.hlLayer?.hideAll(),
        deleteHighlight:   (id)  => state.deleteHighlight(id),
        searchText:        (q, o)=> state.searchText(q, o),
        goToSearchMatch:   (i)   => state.goToSearchMatch(i),
        nextSearchMatch:   ()    => state.nextSearchMatch(),
        prevSearchMatch:   ()    => state.prevSearchMatch(),
    };
}

/**
 * Carica tutti i flow embedded collegati all'oggetto di un pannello PDF.
 * Va chiamato da renderBody() dopo che state (con localEvents) è pronto.
 *
 * @param {object}      state   — stato PDF del pannello (bodyEl[STATE_KEY])
 * @param {object}      object  — oggetto ReseArch corrente (per objId)
 * @param {AbortSignal} signal  — signal del pannello, per cleanup automatico
 */
export async function pdfLoadFlows(state, object, signal) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[PDF-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }

    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[PDF-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted || flows.length === 0) return;

    registerPDFFlowNodes();
    registerAppBusFlowNodes();

    const appContext = buildPDFAppContext(state, object);

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
            console.error('[PDF-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, graph._appContext.signal);

        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[PDF-flow-runner] onStart:', e); }
        }

        ctrl.signal.addEventListener('abort', () => {
            stopFlowGraph(graph);
        }, { once: true });

        console.log(`[PDF-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}
