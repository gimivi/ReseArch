// app/HYS_sub_modules/HYS-flow-runner.mjs
// Carica ed esegue i flow collegati all'oggetto HySpace (flow_type='object',
// api/flows_tool.php?action=list_for_object) — Contesto 3, sullo stampo di
// MPS-flow-runner.mjs: nessun tick periodico, i nodi HYS/Events/* e Local/* si
// auto-innescano (onStart → listener → graph.runStep(1)); i nodi di configurazione
// (HYS/Settings/*, HYS/Audio/Playlist|Stream) agiscono in onStart.
//
// Più flow collegati allo stesso oggetto → più grafi indipendenti che condividono
// lo stesso contesto (la stessa istanza del pannello): le capacità si sommano.

import { registerHYSFlowNodes }   from "./HYS-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Forma di _appContext per un pannello HySpace — usata dal caricamento embedded
 * qui sotto e da _injectTestContext in model_FLE.mjs (test "Testa su panel"): una
 * sola definizione. Solo funzioni (niente getter): model_FLE copia il contesto con
 * lo spread, che congelerebbe il valore di un getter.
 *
 * @param {object} api     — interfaccia esposta dall'istanza HySpace (hsFlowApi)
 * @param {object} object  — oggetto ReseArch corrente
 * @param {number|null} flowId — flow a cui appartiene il grafo (per i percorsi relativi)
 */
export function buildHYSAppContext(api, object, flowId = null) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'HYS',
        sourcePanelId: object?.obj_id ?? null,
        flowId,
        localEvents:   api.localEvents,
        audio:         api.audio,
        getNode:       () => api.getNode(),
        setStartEseId: (id) => api.setStartEseId(id),
        notice:        (text) => api.notice(text),
        // percorsi relativi alla cartella del WP del flow (o dell'oggetto, senza flow)
        resolveMedia:  (paths) => api.resolveMedia(paths, { flowId, objId: object?.obj_id ?? null }),
        // fn(root) su ogni modello di stanza, presente e futuro → funzione per staccarsi
        onRoomModel:   (fn) => api.onRoomModel(fn),
        // navigazione touch: { mode: "stick"|"tap", lookScale } (nodo HYS/Settings/Touch)
        setTouch:      (opts) => api.setTouch(opts),
        // musei generati: m = null (curato) | mus_id | { mus_id, start_id_ese, … }
        setMuseum:     (m) => api.setMuseum(m),
        goTo:          (id) => api.goTo(id),
        getMuseum:     () => api.getMuseum(),
    };
}

/**
 * Carica tutti i flow collegati all'oggetto di un pannello HySpace.
 * Va chiamato da renderBody() PRIMA di entrare nella prima stanza: così
 * HYS/Settings/Start e HYS/Events/Room Enter sono già attivi.
 */
export async function hysLoadFlows(api, object, signal, bodyEl = null) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[HYS-flow-runner] LiteGraph non disponibile — flow ignorati');
        return 0;
    }

    const objId = object?.obj_id ?? null;
    if (!objId) return 0;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[HYS-flow-runner] fleListForObject:', err);
        return 0;
    }
    if (signal?.aborted || flows.length === 0) return 0;

    registerHYSFlowNodes();
    registerAppBusFlowNodes();

    let loaded = 0;
    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;

        const graph = new LGraph();
        graph._appContext = buildHYSAppContext(api, object, flow.flow_id ?? null);

        const ctrl = new AbortController();
        if (signal?.addEventListener) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        graph._appContext.signal = ctrl.signal;

        try {
            graph.configure(graphData); repairKnownMigrations(graph);   // nodi rinominati/spostati: riparati in silenzio
        } catch (err) {
            console.error('[HYS-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, bodyEl, graph._appContext.signal);

        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[HYS-flow-runner] onStart:', e); }
        }

        ctrl.signal.addEventListener('abort', () => { stopFlowGraph(graph); }, { once: true });
        loaded++;
        console.log(`[HYS-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'}): ` +
                    [...new Set((graph._nodes ?? []).map((n) => n.type))].join(", "));
    }
    return loaded;
}
