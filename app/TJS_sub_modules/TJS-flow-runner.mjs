// TJS_sub_modules/TJS-flow-runner.mjs
// Carica ed esegue i grafi LiteGraph embedded (flow_type='object' collegati
// all'oggetto corrente, vedi api/flows_tool.php?action=list_for_object) per
// pannelli TJS.
//
// Per ogni flow collegato all'oggetto:
//   1. Crea un LGraph indipendente
//   2. Inietta _appContext → riferimento agli oggetti live dello state TJS
//   3. Registra i nodi TJS context-aware (idempotente)
//   4. Carica il grafo (graph.configure)
//   5. Aggancia il grafo al pannello (app/shared/panel-flow.mjs): voci dei nodi
//      ReseArch/Menu/* nei menu e footer per i nodi ReseArch/Panel/*
//   6. Avvia il loop del grafo
//
// Più flow collegati allo stesso oggetto → più grafi → tutti condividono lo
// stesso _appContext (puntano agli stessi oggetti live) → le capacità si
// sommano additivamente.

import { registerTJSFlowNodes }   from "./TJS-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { fleListForObject, extractGraphData, filterSelectedFlows } from "../FLE_sub_modules/FLE-api.mjs";
import { repairKnownMigrations } from "../FLE_sub_modules/FLE-node-repair.mjs";
import { attachFlowGraph } from "../shared/panel-flow.mjs";

/**
 * Carica tutti i flow embedded collegati all'oggetto del pannello.
 * Va chiamato dopo la creazione dello state e dopo il caricamento dei modelli.
 *
 * @param {object}   state   — stato TJS del pannello (scene, camera, object, etc.)
 * @param {AbortSignal} signal
 */
export async function tjsLoadFlows(state, signal) {
    const LG     = window.LiteGraph;
    const LGraph = window.LGraph;
    if (!LG || !LGraph) {
        console.warn('[TJS-flow-runner] LiteGraph non disponibile — flow ignorati');
        return;
    }

    const objId = state.object?.obj_id ?? null;
    if (!objId) return;

    let flows = [];
    try {
        const res = await fleListForObject(objId);
        if (res.ok) flows = filterSelectedFlows(res.data ?? [], state.object);
    } catch (err) {
        console.warn('[TJS-flow-runner] fleListForObject:', err);
        return;
    }
    if (signal?.aborted) return;   // il pannello potrebbe essersi chiuso durante il fetch

    // Registra i nodi TJS e Local (idempotente)
    registerTJSFlowNodes();
    registerAppBusFlowNodes();

    // Contesto condiviso da tutti i grafi di questo pannello.
    // Punta agli oggetti live dello state → nessuna copia, zero disallineamento.
    const appContext = {
        objId:            state.object?.obj_id ?? null,
        scene:            state.scene,
        // Radice dei modelli del pannello (pick, albero oggetti, sezioni la usano):
        // TJS/Model/Load URL ci aggiunge i modelli caricati a runtime.
        modelsRoot:       state.modelsRoot ?? null,
        camera:           state.camera,
        renderer:         state.renderer,
        orbitControls:    state.orbitControls,
        signal,
        localEvents:      state.localEvents,
        lastHit:          null,   // aggiornato da onPick in model_TJS.mjs
        // Righe DB modelli dell'oggetto corrente (già caricate da renderBody,
        // state.models — vedi model_TJS.mjs) — usato da ReseArch/Object/Model
        // List (FLE-nodes.mjs) per elencare i mod_id disponibili, es. da
        // passare a TJS/Light/Save. Riferimento diretto, non un getter: la
        // lista è fissata al caricamento del pannello, un cambiamento reale
        // richiede comunque un "Ricarica oggetto" (nuovo render() completo).
        models:           state.models ?? [],
        // Punti collimati: riferimento live allo stesso array di state
        // → mutazioni in-place (push/splice) sono subito visibili ai nodi TJS/Pick/*
        collimatedPoints: state.collimatedPoints ?? [],
        // Callback lazy (state.pickManager sarà definito dopo tjsLoadFlows)
        clearPoints:      () => state.pickManager?.clear(),
        // Chiamata da _ctxDirty() (TJS-flow-nodes.mjs) ad ogni modifica visiva
        // dei nodi, e direttamente da AlongCurve (RAF proprio) — unico segnale
        // "ridisegna" verso il render loop reale del pannello, vedi model_TJS.mjs.
        markDirty:        () => state.markDirty?.(),
        // Getter live (non una property statica): model_TJS.mjs crea
        // state.lightManager DOPO aver chiamato tjsLoadFlows (che costruisce
        // questo appContext), quindi al momento della creazione sarebbe
        // ancora null — un getter legge il valore corrente al momento
        // dell'uso da parte dei nodi TJS/Light/Save (stesso pattern già
        // usato per state.appContext.lastHit in model_TJS.mjs).
        get lightManager() { return state.lightManager ?? null; },
        // Collima (TJS/Panorama/Depth Scale riscala i punti misurati su una panoramica)
        get pickManager()  { return state.pickManager ?? null; },
        // Materiale clay del pannello (TJS-clay.mjs): i nodi di salvataggio GLB chiedono conferma se è attivo
        get clay()         { return state.clay ?? null; },
        // Host delle estensioni del pannello (TJS-extensions.mjs): i nodi di capacità
        // (TJS/Setup/*) installano qui i moduli walkthrough, audio, zone…
        get ext() { return state.ext ?? null; },
    };

    // Esponiamo il contesto nello state così onPick può aggiornare lastHit
    state.appContext = appContext;

    for (const flow of flows) {
        const graphData = extractGraphData(flow?.flow_fle);
        if (!graphData) continue;

        const graph = new LGraph();
        graph._appContext = appContext;
        graph._flowId = flow.flow_id ?? null;   // file relativi alla cartella del WP del flow (TJS/Setup/Audio)

        try {
            graph.configure(graphData); repairKnownMigrations(graph);   // nodi rinominati/spostati: riparati in silenzio
        } catch (err) {
            console.error('[TJS-flow-runner] graph.configure error:', err, flow);
            continue;
        }

        // Nodi ReseArch/Menu/* e ReseArch/Panel/*: il grafo appartiene a questo pannello
        attachFlowGraph(graph, state.bodyEl, signal);

        // Avvia il grafo (imposta STATUS_RUNNING, invia "start" ai nodi)
        // poi cancella subito il setInterval interno: il tick viene fatto
        // manualmente dal render loop RAF di model_TJS.mjs tramite g.runStep(1).
        // Questo sincronizza grafo e render nello stesso frame, eliminando il
        // disallineamento setInterval vs requestAnimationFrame.
        graph.start();
        clearInterval(graph.execution_timer_id);
        graph.execution_timer_id = null;

        // Salva per cleanup
        state.flowGraphs.push(graph);

        // Cleanup su AbortSignal: graph.stop() è no-op se il timer è già null
        if (signal?.addEventListener) {
            signal.addEventListener('abort', () => {
                try { graph.stop(); } catch { /* noop */ }
            }, { once: true });
        }

        console.log(`[TJS-flow-runner] Grafo caricato (flow_id=${flow.flow_id ?? '?'})`);
    }
}
