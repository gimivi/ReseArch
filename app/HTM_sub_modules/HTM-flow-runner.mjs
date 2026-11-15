// app/HTM_sub_modules/HTM-flow-runner.mjs
// Carica ed esegue i grafi LiteGraph embedded (flow_type='object' collegati
// all'oggetto corrente, vedi api/flows_tool.php?action=list_for_object) per
// pannelli HTM in mode:"flow". Parallelo semplificato a MPS-flow-runner.mjs:
// HTM non ha un render loop (nessun RAF), quindi non serve un tick periodico
// — i nodi HTM/DOM/* creano il proprio elemento al primo onExecute e restano
// inerti finché non arriva un nuovo step (click, input, o un trigger da un
// altro nodo del grafo).
//
// A differenza di TJS/OSD/MPS (un solo "spazio" per pannello, la scena/mappa),
// HTM può avere PIÙ documenti nello stesso pannello (menu sinistro, vedi
// model_HTM.mjs) — ogni documento ha il proprio contenitore DOM e quindi il
// proprio set di grafi imutabile all'atto del caricamento: quando l'utente
// cambia documento, model_HTM.mjs aborta il signal per-documento passato qui,
// fermando tutti i grafi caricati per il documento precedente.

import { registerHTMFlowNodes }   from "./HTM-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { t } from "../shared/i18n.mjs";
import { attachFlowGraph, stopFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Costruisce la forma di _appContext per un documento HTM — usata sia dal
 * caricamento embedded qui sotto (Contesto 3) sia da _injectTestContext in
 * model_FLE.mjs (Contesto 1, test dev-mode): UNA sola definizione, per non
 * andare fuori sincrono come già accaduto fra MPS-flow-runner.mjs e
 * model_FLE.mjs prima del fix (vedi module-fle-architettura.md §4.1).
 *
 * container è un getter lazy: il div del documento viene ricreato ogni volta
 * che model_HTM.mjs cambia documento o ricarica — i nodi devono sempre
 * leggere il contenitore vivo, mai una copia presa all'avvio del grafo.
 *
 * @param {object} state  — stato HTM del pannello (bodyEl['__HTM_STATE__'])
 * @param {object} object — oggetto ReseArch corrente (per objId)
 */
export function buildHTMAppContext(state, object) {
    return {
        objId:         object?.obj_id ?? null,
        sourceApp:     'HTM',
        sourcePanelId: object?.obj_id ?? null,
        get container() { return state.node; },
        // modalità iframe: HTM/Frame/Navigate (model_HTM.mjs::_navigateFrame), altrimenti null
        navigate:       (url, opts) => state.navigate?.(url, opts) ?? { error: 'the document of this panel is not in iframe mode' },
    };
}

/**
 * Carica tutti i flow embedded collegati all'oggetto di un pannello HTM, nel
 * contenitore del documento correntemente visualizzato.
 * Va chiamato da model_HTM.mjs DOPO aver creato state.node (il div del
 * documento) per il documento attivo, con un signal per-documento (non il
 * signal dell'intero pannello) così un cambio documento ferma solo i grafi
 * di quel documento.
 *
 * @param {object}      state   — stato HTM del pannello (bodyEl['__HTM_STATE__'])
 * @param {object}      object  — oggetto ReseArch corrente (per objId)
 * @param {AbortSignal} signal  — signal per-documento, per cleanup automatico
 */
/**
 * Avviso visibile DENTRO il documento (in modalità flow un documento senza flow, o con
 * nodi che il browser non conosce, resterebbe bianco senza alcuna spiegazione).
 */
function htmFlowNotice(state, text) {
    const box = state?.node;
    if (!box) return;
    // modalità iframe: dentro l'iframe non si vede, va nel footer
    if (box instanceof HTMLIFrameElement) { state.cmdUI?.show?.({ status: text }); return; }
    const n = document.createElement('div');
    n.className = 'htm-flow-notice';
    n.setAttribute('role', 'status');
    n.style.cssText = 'margin:.5rem 0;padding:.5rem .75rem;border:1px dashed #c9a227;border-radius:4px;' +
                      'background:#fffbea;color:#6b5500;font:13px/1.4 system-ui,sans-serif;';
    n.textContent = text;
    box.appendChild(n);
}

export async function htmLoadFlows(state, object, signal, opts = {}) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[HTM-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }

    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[HTM-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted) return;
    if (flows.length === 0) {
        console.info(`[HTM-flow-runner] obj_id=${objId}: nessun flow da eseguire (nessuno collegato all'oggetto, o deselezionati all'apertura)`);
        // opts.quietIfNone: documento statico (ex "inject"/srcdoc) — nessun flow è normale
        if (!opts.quietIfNone) {
            htmFlowNotice(state, t('app.htm.flow.none.@'));
        }
        return;
    }

    registerHTMFlowNodes();
    registerAppBusFlowNodes();

    // Contesto condiviso da tutti i grafi di questo documento — getter lazy
    // su state.node (vedi buildHTMAppContext).
    const appContext = buildHTMAppContext(state, object);

    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;

        const graph = new LGraph();
        graph._appContext = Object.create(appContext);

        // AbortController per-grafo derivato dal signal per-documento.
        const ctrl = new AbortController();
        if (signal?.addEventListener) {
            signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }
        graph._appContext.signal = ctrl.signal;

        // nodi che questo browser non conosce (file in cache di una versione precedente):
        // LiteGraph li ricrea vuoti e SENZA avvisi → li segnalo io
        const unknown = [...new Set((graphData.nodes ?? []).map((n) => n.type)
                                    .filter((type) => type && !LG.registered_node_types?.[type]))];
        if (unknown.length) {
            console.warn(`[HTM-flow-runner] flow_id=${flow.flow_id ?? '?'}: tipi di nodo non registrati`, unknown);
            htmFlowNotice(state, t('app.htm.flow.unknown_nodes', { types: unknown.join(', ') }));
        }

        try {
            graph.configure(graphData); repairKnownMigrations(graph);   // nodi rinominati/spostati: riparati in silenzio
        } catch (err) {
            console.error('[HTM-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, graph._appContext.signal);

        // Nessun graph.start()/RAF: chiamiamo onStart a mano (come
        // FLE-runtime.mjs / MPS-flow-runner.mjs) così i nodi Local/*
        // registrano i loro listener senza timer interni.
        for (const node of graph._nodes ?? []) {
            try { node.onStart?.(); } catch (e) { console.error('[HTM-flow-runner] onStart:', e); }
        }
        // Primo step esplicito: i nodi HTM/DOM/* creano il proprio elemento
        // al primo onExecute, non aspettano un trigger esterno.
        try { graph.runStep(1); } catch (e) { console.error('[HTM-flow-runner] runStep iniziale:', e); }

        ctrl.signal.addEventListener('abort', () => {
            stopFlowGraph(graph);
        }, { once: true });

        console.log(`[HTM-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'}): ` +
                    [...new Set((graph._nodes ?? []).map((n) => n.type))].join(', '));
    }
}
