// app/OSD_sub_modules/OSD-flow-runner.mjs
// Runner LiteGraph event-driven per pannelli OSD/Paper.js.
// Parallelo a TJS-flow-runner.mjs ma senza RAF loop.
// Tick: manuale, azionato da eventi OSD/PJS e da trigger bus.

import { getState } from "../PJS_sub_modules/PJS-core.mjs";
import { appBusEmit } from "../app-bus.mjs";
import { registerPJSFlowNodes }   from "../PJS_sub_modules/PJS-flow-nodes.mjs";
import { registerOSDFlowNodes }   from "./OSD-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Carica tutti i flow embedded collegati all'oggetto del pannello.
 * Va chiamato dopo initWindow + attachOverlay.
 *
 * @param {object}   object  — record DB oggetto corrente (per obj_id)
 * @param {object}   pjs     — stato PJS del pannello (da getState)
 * @param {object}   opts    — { cmdUI, bodyEl, signal }
 */
export async function ojsLoadFlows(object, pjs, { cmdUI, bodyEl, signal } = {}) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[OSD-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }

    const objId = object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], object);
    } catch (err) {
        console.warn('[OSD-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted) return;

    registerPJSFlowNodes();
    registerOSDFlowNodes();
    registerAppBusFlowNodes();

    // Contesto condiviso — getter lazy: ogni nodo legge lo stato corrente al trigger
    const appContext = {
        sourceApp:     'OSD',
        sourcePanelId: pjs.winId,
        bodyEl,
        cmdUI,
        signal,
        pjs:     () => getState(bodyEl),
        env:     () => getState(bodyEl)?._env,
        scope:   () => getState(bodyEl)?.scope,
        history: () => getState(bodyEl)?.history,
        tools:   () => getState(bodyEl)?.tools,
        overlay: () => getState(bodyEl)?.overlay,
        viewer:  () => getState(bodyEl)?.viewer,
        emit:    (type, payload, opts) => appBusEmit(type, payload, {
            sourceApp: 'OSD', sourcePanelId: pjs.winId, ...opts
        }),
    };

    pjs.appContext        = appContext;
    pjs.flowGraphs        = pjs.flowGraphs       ?? [];

    // Hook selection → bus + step (installato una sola volta per pannello)
    pjs._onSelectionChange = () => {
        const st    = getState(bodyEl);
        const sel   = Array.from(st?.selection ?? []);
        const items = sel.map(it => ({ kind: it.data?.kind, layerId: it.data?.layerId }));
        appBusEmit('selection:change', {
            sourceApp:     'OSD',
            sourcePanelId: pjs.winId,
            items, count: sel.length,
        });
        st?.localEvents?.dispatchEvent(new CustomEvent('selectionChanged', { detail: { items, count: sel.length } }));
        ojsRunStep(pjs);
    };

    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;

        // Signal per-grafo derivato dal signal del pannello
        const ctrl = new AbortController();
        if (signal?.addEventListener) {
            signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }

        const graph = new LGraph();
        graph._appContext = Object.create(appContext);
        graph._appContext.signal = ctrl.signal;

        try {
            graph.configure(graphData); repairKnownMigrations(graph);   // nodi rinominati/spostati: riparati in silenzio
        } catch (err) {
            console.error('[OSD-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, bodyEl, ctrl.signal);

        // Nessun setInterval: tick solo su eventi
        graph.start();
        clearInterval(graph.execution_timer_id);
        graph.execution_timer_id = null;

        pjs.flowGraphs.push(graph);

        signal?.addEventListener('abort', () => {
            try { graph.stop(); } catch {}
        }, { once: true });

        console.log(`[OSD-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}

/** Trigger manuale di tutti i grafi del pannello. */
export function ojsRunStep(pjs) {
    for (const g of pjs?.flowGraphs ?? []) {
        try { g.runStep(1); } catch {}
    }
}

/**
 * Collega gli eventi nativi OSD al bus e al tick dei grafi.
 * Chiamato una volta dopo ojsLoadFlows.
 */
export function ojsAttachOsdWiring(pjs, { bodyEl, signal } = {}) {
    const viewer = pjs?.viewer;
    if (!viewer) return;

    const onAnimFinish = () => {
        try {
            const vp = viewer.viewport;
            const c  = vp.viewportToImageCoordinates(vp.getCenter());
            appBusEmit('osd:viewport:change', {
                zoom:   vp.getZoom(true),
                cx: c.x, cy: c.y,
                bounds: _vpBoundsToImage(vp),
            }, { sourceApp: 'OSD', sourcePanelId: pjs.winId });
        } catch {}
        ojsRunStep(pjs);
    };

    const onPage = ({ page }) => {
        appBusEmit('osd:page:change', { page },
            { sourceApp: 'OSD', sourcePanelId: pjs.winId });
        ojsRunStep(pjs);
    };

    viewer.addHandler('animation-finish', onAnimFinish);
    viewer.addHandler('page', onPage);

    signal?.addEventListener('abort', () => {
        try { viewer.removeHandler('animation-finish', onAnimFinish); } catch {}
        try { viewer.removeHandler('page', onPage); } catch {}
    }, { once: true });
}

function _vpBoundsToImage(vp) {
    try {
        const b = vp.getBounds(true);
        const r = vp.viewportToImageRectangle(b);
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    } catch { return null; }
}
