// app/shared/panel-flow.mjs
// Legame fra i grafi dei flow e il pannello della dashboard in cui girano (2026-10-13).
//
// Serve ai nodi che agiscono sul PANNELLO e non sull'App, quindi uguali per tutte le App:
//   ReseArch/Menu/Command  → voce cliccabile nel menu sinistro o destro dell'intestazione
//   ReseArch/Menu/Status   → voce di sola lettura nel menu sinistro (etichetta: valore)
//   ReseArch/Panel/Status  → testo di stato nel footer
//   ReseArch/Panel/Hints   → testo dei suggerimenti nel footer
//   ReseArch/Object/Open   → apre un altro oggetto nello stesso pannello (openObjectInPanel)
//
// Chi fa cosa:
//   template_XXX.mjs   registerPanelHost(bodyEl, { cmdUI }) a ogni render, prima di renderBody;
//                      flowMenuItems(bodyEl) quando costruisce i menu (anche all'apertura).
//   *-flow-runner.mjs  attachFlowGraph(graph, bodyEl, signal) dopo graph.configure().
//   model_FLE.mjs      attachFlowGraph(...) in "Testa su panel", verso il pannello scelto.
//   nodi footer        panelCmdUI(this.graph).
//
// Le voci dei menu si leggono dai grafi al momento della costruzione del menu: nessun elenco
// da tenere allineato, e un flow caricato dopo renderBody compare alla prima apertura.

/** bodyEl → { cmdUI, graphs:Set<LGraph> } — un host nuovo a ogni render del pannello. */
const HOSTS = new WeakMap();

/**
 * Registra (o azzera) il pannello: i grafi del render precedente non contano più.
 * @param {HTMLElement} bodyEl
 * @param {{ cmdUI?: object|null }} opts
 */
export function registerPanelHost(bodyEl, { cmdUI = null } = {}) {
    if (!bodyEl) return;
    HOSTS.set(bodyEl, { cmdUI, graphs: new Set() });
}

/**
 * Aggancia un grafo al pannello. Si sgancia da solo all'abort di `signal`.
 * @param {object}       graph   LGraph già configurato
 * @param {HTMLElement}  bodyEl  .panel-body del pannello
 * @param {AbortSignal} [signal]
 * @returns {() => void} detach
 */
export function attachFlowGraph(graph, bodyEl, signal = null) {
    const host = bodyEl ? HOSTS.get(bodyEl) : null;
    if (!graph || !host || signal?.aborted) return () => {};
    host.graphs.add(graph);
    graph._raPanelBody = bodyEl;
    const detach = () => {
        host.graphs.delete(graph);
        if (graph._raPanelBody === bodyEl) graph._raPanelBody = null;
    };
    signal?.addEventListener?.('abort', detach, { once: true });
    return detach;
}

/**
 * cmdUI del pannello a cui è agganciato il grafo; in mancanza quello del contesto dell'App.
 * null per i grafi senza pannello (flow dashboard, editor non agganciato).
 */
export function panelCmdUI(graph) {
    const bodyEl = graph?._raPanelBody;
    return (bodyEl && HOSTS.get(bodyEl)?.cmdUI) || graph?._appContext?.cmdUI || null;
}

/**
 * Ferma un grafo di flow alla chiusura del pannello (2026-10-17). I runner che non chiamano
 * graph.start() (onStart a mano, nessun ciclo) lasciano il grafo in STATUS_STOPPED e
 * graph.stop() lì non fa nulla: i nodi non ricevevano onStop (servizi Ollama/ComfyUI,
 * dispositivi, timer restavano vivi). Qui onStop arriva comunque, una volta sola.
 */
export function stopFlowGraph(graph) {
    if (!graph || graph._raStopped) return;
    graph._raStopped = true;
    if (graph.status === (globalThis.LGraph?.STATUS_RUNNING ?? 2)) {
        try { graph.stop(); } catch (e) { console.error('[panel-flow] stop:', e); }
        return;
    }
    for (const node of graph._nodes ?? []) {
        try { node.onStop?.(); } catch (e) { console.error('[panel-flow] onStop:', e); }
    }
}

/** Pannello (.wm-panel) a cui è agganciato il grafo, o null. */
export function panelOfGraph(graph) {
    return graph?._raPanelBody?.closest?.('.panel') ?? null;
}

const _opening = new WeakMap();   // pannello → obj_id in apertura (evita richieste doppie)

/**
 * Apre l'oggetto $objId nel pannello, come "Ricarica oggetto" e il ripristino di una
 * configurazione: legge oggetto e modelli dal server (che applica la visibilità) e chiama
 * il renderer dell'App. render() chiude l'App precedente e ferma i suoi flow: chi chiama
 * da un flow non deve aspettarsi di proseguire dopo (nodo ReseArch/Object/Open).
 * Non fa nulla se l'oggetto, con gli stessi modelli, è già aperto: così un messaggio
 * ripetuto (retain dell'App Bus) non riapre all'infinito.
 * @param {HTMLElement} panel   .panel della dashboard
 * @param {number}      objId
 * @param {number[]|null} modIds  modelli da caricare; null o vuoto = tutti i collegati
 * @returns {Promise<boolean>} true se ha aperto
 */
export async function openObjectInPanel(panel, objId, modIds = null) {
    objId = Number(objId);
    if (!panel || !(objId > 0)) return false;
    const ids = Array.isArray(modIds) ? modIds.map(Number).filter(n => n > 0) : [];

    const saved = panel._wmLeaf?.savedState;
    if (Number(saved?.objectId) === objId) {
        const cur = Array.isArray(saved?.selectedModelIds) ? saved.selectedModelIds.map(Number) : [];
        const same = !ids.length || (ids.length === cur.length && ids.every(id => cur.includes(id)));
        if (same) return false;
    }
    if (_opening.get(panel) === objId) return false;
    _opening.set(panel, objId);
    try {
        const res  = await fetch(`ui/modal_tree_obj_tools.php?action=models_by_obj&obj_id=${encodeURIComponent(objId)}`,
                                 { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.success || !data.data?.object) throw new Error(data.error || `object ${objId} not found`);
        const obj    = data.data.object;
        const all    = data.data.models ?? [];
        const models = ids.length ? all.filter(m => ids.includes(Number(m.mod_id))) : all;
        const render = window.ModelRenderers?.[obj.obj_app];
        if (typeof render !== 'function') throw new Error(`no renderer for app "${obj.obj_app}"`);
        await render(panel, obj, models);
        return true;
    } catch (e) {
        console.warn('[panel-flow] openObjectInPanel:', e.message);
        return false;
    } finally {
        if (_opening.get(panel) === objId) _opening.delete(panel);
    }
}

/**
 * Voci dei nodi Menu di tutti i grafi agganciati al pannello, nel formato dei menu di
 * template_XXX.mjs. Lo stato è letto adesso: chiamare all'apertura del menu.
 * @returns {{ left: object[], right: object[], status: object[] }}
 */
export function flowMenuItems(bodyEl) {
    const out = { left: [], right: [], status: [] };
    const host = bodyEl ? HOSTS.get(bodyEl) : null;
    if (!host) return out;
    for (const graph of host.graphs) {
        for (const node of graph._nodes ?? []) {
            if (node.type === 'ReseArch/Menu/Command') {
                const side = node.properties?.side === 'right' ? 'right' : 'left';
                out[side].push({
                    label:   node.properties?.label || 'Action',
                    onClick: () => {
                        try { node.fire(); } catch (e) { console.error('[panel-flow] Menu Command:', e); }
                    },
                });
            } else if (node.type === 'ReseArch/Menu/Status') {
                const label = node.properties?.label || 'Status';
                const value = typeof node.getValue === 'function' ? node.getValue() : null;
                out.status.push({
                    label:    value != null ? `${label}: ${value}` : label,
                    disabled: true,
                });
            }
        }
    }
    return out;
}
