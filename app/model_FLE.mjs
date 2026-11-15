// model_FLE.mjs
// Flow Editor — pannello LiteGraph per grafi nodali ReseArch (app code: FLE).
// Sostituisce model_LGJ.mjs con nomenclatura unificata.
//
// Funzionalità:
// - Monta un LGraphCanvas in bodyEl
// - Carica il grafo di un flow della tabella flows (object.__embeddedTarget)
// - Registra i nodi custom di progetto, compresi i nodi App Bus Emitter/Receiver
//   (che si collegano al bus da soli, app/AppBus-flow-nodes.mjs)
// - Toolbar: run/stop, fit, zoom 1:1, save, clear
// - Cleanup robusto su AbortSignal (per istanza/pannello)
//
// Prerequisito: LiteGraph.js caricato globalmente in dashboard.php

import { fleRegisterCustomNodes }        from "./FLE_sub_modules/FLE-nodes-custom.mjs";
import { registerFlowNodes }             from "./FLE_sub_modules/FLE-nodes.mjs";
import {
    repairKnownMigrations, markUnresolvedNodes, formatMigrationReport,
    addReportNote, installErrorNodeMenu,
} from "./FLE_sub_modules/FLE-node-repair.mjs";
import { fleCreateForObject, fleCreateForDashboard, fleUnlinkFromDashboard,
         fleUpdate, fleUpdateMeta, fleLoad, fleLoadShared, extractGraphData } from "./FLE_sub_modules/FLE-api.mjs";
import { ensureLibraryNodes } from "./FLE_sub_modules/FLE-library-nodes.mjs";
import { getOpenPanelsForFlow }          from "./FLE_sub_modules/FLE-panels.mjs";
import { fleCreateHelpPanel }            from "./FLE_sub_modules/FLE-help-panel.mjs";
import { fleAttachUndo }                 from "./FLE_sub_modules/FLE-undo.mjs";
import { t, te }                         from "./shared/i18n.mjs";
import { attachFlowGraph }               from "./shared/panel-flow.mjs";

// ============================================================
// CONFIG / STATE
// ============================================================

const STATE_KEY = "__FLE_STATE__";

const _LINK_MODES = [
    { val: 2, labelKey: 'app.fle.link_mode.spline',   icon: 'bi-bezier2'        },
    { val: 0, labelKey: 'app.fle.link_mode.straight', icon: 'bi-arrow-up-right' },
    { val: 1, labelKey: 'app.fle.link_mode.linear',   icon: 'bi-node-plus-fill' },
];

// ============================================================
// HELPERS — LiteGraph globals
// ============================================================

function getLGGlobals() {
    const LG = window.LiteGraph;
    return {
        LiteGraph:    LG,
        LGraph:       window.LGraph       ?? LG?.LGraph,
        LGraphCanvas: window.LGraphCanvas ?? LG?.LGraphCanvas,
    };
}

// ============================================================
// HELPERS — Canvas
// ============================================================

/**
 * Editor in sola lettura (livello del pannello sotto 30, _doc/arch-permessi.md §11.4 e §11.7):
 * il grafo si guarda, si sposta la vista, si selezionano i nodi (pannello Help), si esegue;
 * non si modifica. read_only di LiteGraph blocca spostamenti e collegamenti ma non tutto:
 * qui si spengono anche cancellazione, incolla, ricerca nodi, menu contestuale, widget e
 * pannello proprietà, solo su questa istanza (la libreria non cambia).
 */
function fleMakeReadOnly(lgCanvas) {
    lgCanvas.read_only = true;
    lgCanvas.allow_dragnodes = false;
    lgCanvas.allow_reconnect_links = false;
    lgCanvas.allow_searchbox = false;
    const noop = () => null;
    lgCanvas.deleteSelectedNodes = noop;
    lgCanvas.pasteFromClipboard = noop;
    lgCanvas.showSearchBox = noop;
    lgCanvas.processContextMenu = noop;
    lgCanvas.processNodeWidgets = noop;
    lgCanvas.showShowNodePanel = noop;
}

function createCanvas(bodyEl) {
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left     = "0";
    canvas.style.top      = "0";
    canvas.style.width    = "100%";
    canvas.style.height   = "100%";
    canvas.style.display  = "block";
    canvas.width  = bodyEl.clientWidth  || 800;
    canvas.height = bodyEl.clientHeight || 600;
    bodyEl.appendChild(canvas);
    return canvas;
}

// Pattern anti-loop (identico a model_TJS.mjs / model_FLE.mjs)
function attachResizeObserver(bodyEl, lgCanvas, state) {
    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
        if (state.resizeRAF) return;
        state.resizeRAF = requestAnimationFrame(() => {
            state.resizeRAF = 0;
            if (state.stopped) return;
            const w = bodyEl.clientWidth  || 1;
            const h = bodyEl.clientHeight || 1;
            if (w === lastW && h === lastH) return;
            lastW = w; lastH = h;
            lgCanvas.resize(w, h);
        });
    });
    ro.observe(bodyEl);
    return ro;
}

/**
 * Flow aperto in questo pannello: lo comunica al runtime della dashboard, che
 * non esegue un flow mentre è aperto nell'editor e lo riavvia, riletto dal
 * database, alla chiusura (_doc/arch-flow-dashboard.md §3.4). Va chiamata a ogni
 * cambio di currentFlowId (apertura, primo salvataggio, cambio/rimozione target)
 * e con null alla chiusura del pannello.
 */
function _setEditingFlow(st, flowId) {
    const prev = st.editingFlowId ?? null;
    const next = Number(flowId) || null;
    if (prev === next) return;
    if (prev) window.dispatchEvent(new CustomEvent('fle:editor:close', { detail: { flowId: prev } }));
    st.editingFlowId = next;
    if (next) window.dispatchEvent(new CustomEvent('fle:editor:open', { detail: { flowId: next } }));

    // Descrittore della finestra salvato nelle Dashboard Config (template_XXX.mjs):
    // segue il flow aperto, così una Config salvata dopo il primo salvataggio
    // riapre il flow giusto (prima restava il flowId dell'apertura, anche null).
    const leaf = st.panelEl?._wmLeaf;
    if (leaf?.savedState && st.embeddedDesc) {
        leaf.savedState.embeddedFlow = next ? { ...st.embeddedDesc, flowId: next } : null;
    }
}

/**
 * Salvataggio di un flow DASHBOARD (_doc/arch-flow-dashboard.md §3.4, §8.1).
 * Aggiorna il flow aperto, oppure ne crea uno nuovo collegato alla Config del
 * pannello (st.dashTarget). La copia — chi non è autore salva, o "Salva con
 * nome" su un flow esistente — PRENDE IL POSTO dell'originale nella Config:
 * l'originale viene scollegato, altrimenti girerebbero entrambi. Creare e
 * collegare richiedono gli stessi ruoli (W, P, X), quindi chi salva può farlo.
 */
async function saveGraphAsDashboardFlow(st, graphData, forceNew = false) {
    const cmdUI = st?.cmdUI;
    const dshpId = st.dashTarget?.dshpId;
    const cfgName = st.dashTarget?.name || `#${dshpId}`;
    if (!dshpId) { cmdUI?.update({ status: t('app.fle.save.no_dash_config') }); return false; }
    const fle = { graph: graphData };

    if (st.currentFlowId && !forceNew && st.currentFlowCanEdit === false) {
        const ok = window.confirm(t('app.fle.save.confirm_copy_dashboard.@', {
            id: st.currentFlowId, author: st.currentFlowAuthor || t('app.fle.other_author'), cfg: cfgName,
        }));
        if (!ok) { cmdUI?.update({ status: t('app.fle.save.cancelled_other_author') }); return false; }
        forceNew = true;
    }
    cmdUI?.update({ status: t('app.fle.save.saving_dashboard') });
    try {
        if (st.currentFlowId && !forceNew) {
            const res = await fleUpdate(st.currentFlowId, undefined, fle);
            if (!res.ok) throw new Error(res.error);
            cmdUI?.update({ status: t('app.fle.save.updated_dashboard', { id: st.currentFlowId }) + reviewNote(res.data?.flow_review) });
            return true;
        }

        const original = st.currentFlowId || null;
        if (original && !window.confirm(t('app.fle.save.confirm_copy_original', { id: original, cfg: cfgName })))
        { cmdUI?.update({ status: t('app.fle.save.cancelled') }); return false; }

        const baseName = t('app.fle.save.default_dashboard_name');
        const defName = original ? t('app.fle.save.copy_name', { name: st.currentFlowName || baseName }) : baseName;
        const name = (window.prompt(t('app.fle.save.prompt_dashboard_name'), defName) ?? '').trim() || defName;
        const res  = await fleCreateForDashboard(dshpId, name, fle);
        if (!res.ok) throw new Error(res.error);
        // Prima di cambiare il flow aperto: alla 'fle:editor:close' dell'originale
        // il runtime controlla se è ancora collegato — scollegato, non riparte.
        if (original) await fleUnlinkFromDashboard(dshpId, original);

        st.currentFlowId      = res.data.flow_id;
        st.currentFlowName    = name;
        st.currentFlowCanEdit = true;     // la copia è dell'utente
        st.currentFlowAuthor  = '';
        _setEditingFlow(st, st.currentFlowId);
        cmdUI?.update({ status: (original
            ? t('app.fle.save.created_dashboard_replacing', { id: st.currentFlowId, cfg: cfgName, orig: original })
            : t('app.fle.save.created_dashboard', { id: st.currentFlowId, cfg: cfgName })) + reviewNote(res.data?.flow_review) });
        return true;
    } catch (err) {
        cmdUI?.update({ status: t('app.fle.save.error', { error: err.message }) });
        console.error('[FLE] saveGraphAsDashboardFlow:', err);
        return false;
    }
}

function destroyBodyInstance(bodyEl) {
    const st = bodyEl?.[STATE_KEY];
    if (!st) return;
    st.stopped = true;
    try { _setEditingFlow(st, null); }                            catch { /* noop */ }
    try { if (st.resizeRAF) cancelAnimationFrame(st.resizeRAF); } catch { /* noop */ }
    try { st.resizeObserver?.disconnect(); }                      catch { /* noop */ }
    try { st.graph?.stop(); }                                     catch { /* noop */ }
    try {
        bodyEl.style.position = st.prevBodyStyle?.position ?? "";
        bodyEl.style.overflow = st.prevBodyStyle?.overflow ?? "";
    } catch { /* noop */ }
    try { delete bodyEl[STATE_KEY]; } catch { /* noop */ }
}

// ============================================================
// HELPERS — Zoom
// ============================================================

// FIX (2026-09-21, segnalato dall'utente — "zoom extents non inquadra bene",
// "zoom 1:1 non centra sulla vista corrente"): sia fitAllNodes che
// zoomOneToOne usavano una relazione screen/offset/scale SBAGLIATA. La vera
// relazione di LiteGraph.DragAndScale (verificata sul metodo nativo
// ds.convertCanvasToOffset, che fa `local = canvasPx/scale - offset`) è:
//   canvasPx = (local + offset) * scale   →   offset = canvasPx/scale - local
// Il codice precedente calcolava offset come `canvasPx - local*scale` (senza
// dividere canvasPx per scale) — coincide con la formula corretta SOLO a
// scale=1, quindi l'errore cresceva con lo zoom, spiegando perché il
// framing/centraggio sembrava impreciso soprattutto su grafi zoomati.
function fitAllNodes(lgCanvas, graph, canvas) {
    const nodes = graph._nodes;
    if (!nodes?.length) {
        lgCanvas.ds.scale = 1; lgCanvas.ds.offset[0] = 0; lgCanvas.ds.offset[1] = 0;
        lgCanvas.setDirty(true, true); return;
    }
    // La title bar si disegna SOPRA n.pos[1] (verso l'alto, altezza
    // NODE_TITLE_HEIGHT) — non inclusa nel bounding box, i nodi più in alto
    // risultavano con la barra del titolo tagliata fuori dall'inquadratura.
    const TH = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
        minX = Math.min(minX, n.pos[0]);
        minY = Math.min(minY, n.pos[1] - TH);
        maxX = Math.max(maxX, n.pos[0] + (n.size?.[0] ?? 200));
        maxY = Math.max(maxY, n.pos[1] + (n.size?.[1] ?? 100));
    }
    const PAD = 60, W = canvas.width, H = canvas.height;
    const scale = Math.min(W / (maxX - minX + PAD * 2), H / (maxY - minY + PAD * 2), 2);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    lgCanvas.ds.scale     = scale;
    lgCanvas.ds.offset[0] = (W / 2) / scale - cx;
    lgCanvas.ds.offset[1] = (H / 2) / scale - cy;
    lgCanvas.setDirty(true, true);
}

function zoomOneToOne(lgCanvas, canvas) {
    const W = canvas.width, H = canvas.height;
    // Punto (coordinate locali/grafo) attualmente al centro della vista —
    // usa il metodo nativo invece di ricalcolare la formula a mano, per non
    // ripetere l'errore corretto sopra.
    const [cx, cy] = lgCanvas.ds.convertCanvasToOffset([W / 2, H / 2]);
    lgCanvas.ds.scale     = 1;
    lgCanvas.ds.offset[0] = W / 2 - cx;
    lgCanvas.ds.offset[1] = H / 2 - cy;
    lgCanvas.setDirty(true, true);
}

// Override di processMouseWheel per zoom centrato sul cursore.
//
// Perché non usiamo adjustMouseEvent(e):
//   adjustMouseEvent fa `e.deltaY = clientY - top` ma su WheelEvent `deltaY` è
//   read-only → l'assegnazione fallisce silenziosamente → e.canvasY viene calcolata
//   con il delta di scroll invece della Y del cursore → coordinate locali sbagliate.
//
// FIX (2026-09-21): ds.changeScale(scale, center) vuole 'center' in
// coordinate CANVAS (pixel schermo) — è lui stesso a convertirlo in locale
// internamente, prima e dopo il cambio di scala, per calcolare di quanto
// compensare l'offset. La versione precedente passava un centro già
// "convertito" a mano in locale (con in più la stessa formula sbagliata
// corretta sopra in fitAllNodes/zoomOneToOne) — doppio errore che faceva
// derivare lo zoom-sotto-il-cursore dal cursore vero via via che ci si
// allontanava da scale=1.
function _patchCursorZoom(lgCanvas) {
    lgCanvas.processMouseWheel = function(e) {
        if (!this.graph || !this.allow_dragcanvas) return;
        // (2026-10-04) La rotella sopra un nodo che la gestisce (onMouseWheel → true: es.
        // Debug/Text View, Debug/Inspect) scorre il suo contenuto invece di zoomare il canvas.
        // LiteGraph 0.7.18 non passa mai la rotella ai nodi: senza questo onMouseWheel non
        // veniva mai chiamato.
        const gpos = this.convertEventToCanvasOffset(e);
        const hit  = this.graph.getNodeOnPos(gpos[0], gpos[1], this.visible_nodes);
        if (hit?.onMouseWheel && !hit.flags?.collapsed &&
            hit.onMouseWheel(e, [gpos[0] - hit.pos[0], gpos[1] - hit.pos[1]], this)) {
            hit.setDirtyCanvas?.(true, false);
            e.preventDefault();
            return false;
        }
        const delta = e.wheelDeltaY != null ? e.wheelDeltaY
                    : e.deltaY       != null ? -e.deltaY
                    : e.detail * -60;
        if (!delta) return;
        // Canvas-internal pixel (considera DPR se canvas.width != rect.width)
        const rect    = this.canvas.getBoundingClientRect();
        const canvasX = (e.clientX - rect.left)  * (this.canvas.width  / rect.width);
        const canvasY = (e.clientY - rect.top)   * (this.canvas.height / rect.height);
        const scale   = this.ds.scale * (delta > 0 ? 1.1 : 1 / 1.1);
        this.ds.changeScale(scale, [canvasX, canvasY]);
        this.graph.change();
        e.preventDefault();
        return false;
    };
}

// Cattura scala/offset correnti della vista dentro graph.extra.view, per
// farli sopravvivere a serialize()/configure() (LiteGraph copia 'extra' così
// com'è in entrambe le direzioni — nessun'altra API dedicata alla vista).
// Va chiamata SUBITO PRIMA di ogni st.graph.serialize() usato per un
// salvataggio reale (non per "Info grafo", quello è solo diagnostico).
function _captureViewIntoGraph(st) {
    if (!st?.graph || !st?.lgCanvas) return;
    st.graph.extra = {
        ...(st.graph.extra || {}),
        view: { scale: st.lgCanvas.ds.scale, offset: [...st.lgCanvas.ds.offset] },
    };
}

// Applica graph.extra.view (se presente, cioè se il grafo era già stato
// salvato con questo fix) dopo un graph.configure() — altrimenti la vista
// resta quella di default (scale 1, offset 0,0) invariata da prima.
function _restoreViewFromGraph(st) {
    const view = st?.graph?.extra?.view;
    if (!view || !st?.lgCanvas) return false;
    st.lgCanvas.ds.scale     = view.scale ?? 1;
    st.lgCanvas.ds.offset[0] = view.offset?.[0] ?? 0;
    st.lgCanvas.ds.offset[1] = view.offset?.[1] ?? 0;
    st.lgCanvas.setDirty(true, true);
    return true;
}

// ============================================================
// HELPERS — Cleanup & save
// ============================================================

function attachAbortCleanup(signal, bodyEl) {
    if (!signal?.addEventListener) return;
    signal.addEventListener("abort", () => destroyBodyInstance(bodyEl), { once: true });
}

function getObjectDisplayName(object) {
    if (!object) return t('app.fle.graph_default');
    return object.obj_name || object.obj_title || object.name || object.title ||
           (object.obj_id != null ? t('app.fle.graph_n', { id: object.obj_id }) : t('app.fle.graph_default'));
}

// ============================================================
// HELPERS — Salvataggio flow embedded su un oggetto (Scenario 3)
// ============================================================

/**
 * Salva il grafo serializzato come flow embedded (flow_type='object') collegato
 * a un oggetto. Primo salvataggio → crea un nuovo flow (create_for_object);
 * salvataggi successivi nella stessa sessione di editing → aggiorna lo stesso
 * flow_id (update), invece di crearne uno nuovo ad ogni salvataggio.
 *
 * @param {object} st       — state del panel FLE (bodyEl[STATE_KEY])
 * @param {number} objId    — oggetto target
 * @param {object} graphData — st.graph.serialize()
 * @param {boolean} [forceNew] — true per "Salva con nome": crea sempre un
 *   nuovo record (chiede il nome anche se st.currentFlowId è già impostato)
 *   invece di aggiornare il flow corrente. st.currentFlowId viene ripuntato
 *   sul nuovo id, così i salvataggi successivi (Salva normale) aggiornano
 *   la NUOVA copia, non l'originale.
 * @returns {boolean} esito
 */
/**
 * Messaggio sullo stato di validazione dopo un salvataggio (arch-abilitazioni.md §5):
 * 'pending' = contiene nodi critici non ancora validati → gira solo per l'autore.
 */
function reviewNote(review) {
    if (review === 'pending') return ' ' + t('app.fle.review.pending');
    if (review === 'approved') return ' ' + t('app.fle.review.approved');
    return '';
}

async function saveGraphAsObjectFlow(st, objId, graphData, forceNew = false) {
    const cmdUI = st?.cmdUI;
    cmdUI?.update({ status: t('app.fle.save.saving_object') });
    const fle = { graph: graphData };
    // Regola unica (arch-permessi.md §8ter): aggiornare il flow corrente solo se
    // autore o admin; altrimenti la copia ("Salva con nome") è l'unica via.
    if (st.currentFlowId && !forceNew && st.currentFlowCanEdit === false) {
        const ok = window.confirm(t('app.fle.save.confirm_copy_object.@', {
            id: st.currentFlowId, author: st.currentFlowAuthor || t('app.fle.other_author'),
        }));
        if (!ok) { cmdUI?.update({ status: t('app.fle.save.cancelled_other_author') }); return false; }
        forceNew = true;
    }
    try {
        if (st.currentFlowId && !forceNew) {
            const res = await fleUpdate(st.currentFlowId, undefined, fle);
            if (!res.ok) throw new Error(res.error);
            cmdUI?.update({ status: t('app.fle.save.updated_object', { id: st.currentFlowId }) + reviewNote(res.data?.flow_review) });
        } else {
            const name = window.prompt(t('app.fle.save.prompt_object_name'), `Flow — obj_id ${objId}`) ?? `Flow — obj_id ${objId}`;
            const res  = await fleCreateForObject(objId, name, fle);
            if (!res.ok) throw new Error(res.error);
            st.currentFlowId   = res.data.flow_id;
            _setEditingFlow(st, st.currentFlowId);
            st.currentFlowName = name;
            st.currentFlowCanEdit = true;     // la copia è dell'utente
            st.currentFlowAuthor  = '';
            cmdUI?.update({ status: t('app.fle.save.created_object', { id: st.currentFlowId, obj: objId }) + reviewNote(res.data?.flow_review) });
        }
        return true;
    } catch (err) {
        cmdUI?.update({ status: t('app.fle.save.error', { error: err.message }) });
        console.error('[FLE] saveGraphAsObjectFlow:', err);
        return false;
    }
}

// ============================================================
// HELPERS — Test su panel (Scenario 3)
// ============================================================

/**
 * Restituisce tutti i panel aperti nella dashboard (escluso FLE)
 * con bodyEl + app + nome + objId. Wrapper locale su FLE-panels.mjs, per non
 * toccare le chiamate esistenti in questo file.
 */
function _getOpenPanelsForTest() {
    return getOpenPanelsForFlow();
}

/**
 * Inietta l'_appContext del panel selezionato nel grafo FLE corrente.
 * Registra anche i nodi context-aware specifici per l'app target.
 * @returns {{ ok: boolean, modId: number|null }}
 */
async function _injectTestContext(graph, targetBodyEl, targetApp) {
    // Mappa app → STATE_KEY del modulo
    const APP_STATE_KEYS = {
        TJS: '__TJS_RENDER_STATE__',
        ECH: '__ECH_STATE__',
        MPS: '__MPS_STATE__',
        DBJ: '__DBJ_STATE__',
        GSH: '__GSH_STATE__',
        MYS: '__MYS_STATE__',
        PDF: '__PDF_RENDER_STATE__',
        HTM: '__HTM_STATE__',
        HYS: '__HYS_STATE__',
        JSX: '__JSX_STATE__',
        TML: '__TML_STATE__',
        IFC: '__IFC_RENDER_STATE__',
        OLY: '__OLY_STATE__',
    };
    const key = APP_STATE_KEYS[targetApp];
    if (!key) {
        console.warn(`[FLE] _injectTestContext: app "${targetApp}" non supportata per context injection.`);
        return { ok: false, modId: null };
    }

    const st = targetBodyEl?.[key];
    if (!st) {
        console.warn(`[FLE] _injectTestContext: STATE_KEY "${key}" non trovato nel panel target.`);
        return { ok: false, modId: null };
    }

    // Preserva signal: è il signal del panel FLE, impostato prima di graph.start()
    // e necessario ai nodi OSD/Events* / MPS/Events* / App Bus Emitter-Receiver già avviati.
    const baseSignal = graph._appContext?.signal ?? null;

    let modId = null;

    if (targetApp === 'HYS') {
        // L'istanza HySpace espone flowApi(): stessa forma di contesto del caricamento
        // reale (HYS-flow-runner.mjs::buildHYSAppContext). Senza flow salvato, i percorsi
        // audio relativi usano la cartella del WP dell'oggetto.
        const { buildHYSAppContext } = await import('./HYS_sub_modules/HYS-flow-runner.mjs');
        graph._appContext = { ...buildHYSAppContext(st.flowApi(), st.object, null), signal: baseSignal };
        try {
            const { registerHYSFlowNodes } = await import('./HYS_sub_modules/HYS-flow-nodes.mjs');
            registerHYSFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi HYS:', e);
        }
    } else if (targetApp === 'MPS') {
        // Stessa forma di _appContext usata dal caricamento embedded reale
        // (MPS-flow-runner.mjs): UNA sola definizione condivisa, per non
        // andare fuori sincrono come accaduto qui prima di questo fix (vedi
        // module-fle-architettura.md §4 — la divergenza rendeva i nodi
        // MPS/Camera/* silenziosamente inattivi nel test dev-mode, pur
        // funzionando nel flow embedded reale).
        const { buildMPSAppContext } = await import('./MPS_sub_modules/MPS-flow-runner.mjs');
        graph._appContext = { ...buildMPSAppContext(st, st.object), signal: baseSignal };
        modId = st.mod_id ?? null;

        try {
            const { registerMPSFlowNodes } = await import('./MPS_sub_modules/MPS-flow-nodes.mjs');
            registerMPSFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi MPS:', e);
        }
    } else if (targetApp === 'DBJ') {
        // Stessa forma di _appContext usata dal caricamento embedded reale
        // (DBJ-flow-runner.mjs) — vedi nota sul branch MPS sopra.
        const { buildDBJAppContext } = await import('./DBJ_sub_modules/DBJ-flow-runner.mjs');
        graph._appContext = { ...buildDBJAppContext(st, st.object), signal: baseSignal };
        modId = st.mod_id ?? null;

        try {
            const { registerDBJFlowNodes } = await import('./DBJ_sub_modules/DBJ-flow-nodes.mjs');
            registerDBJFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi DBJ:', e);
        }
    } else if (targetApp === 'GSH') {
        const { buildGSHAppContext } = await import('./GSH_sub_modules/GSH-flow-runner.mjs');
        graph._appContext = { ...buildGSHAppContext(st, st.object), signal: baseSignal };
        modId = st.mod_id ?? null;

        try {
            const { registerGSHFlowNodes } = await import('./GSH_sub_modules/GSH-flow-nodes.mjs');
            registerGSHFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi GSH:', e);
        }
    } else if (targetApp === 'MYS') {
        const { buildMYSAppContext } = await import('./MYS_sub_modules/MYS-flow-runner.mjs');
        graph._appContext = { ...buildMYSAppContext(st, st.object), signal: baseSignal };
        modId = st.mod_id ?? null;

        try {
            const { registerMYSFlowNodes } = await import('./MYS_sub_modules/MYS-flow-nodes.mjs');
            registerMYSFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi MYS:', e);
        }
    } else if (targetApp === 'PDF') {
        const { buildPDFAppContext } = await import('./PDF_sub_modules/PDF-flow-runner.mjs');
        graph._appContext = { ...buildPDFAppContext(st, st.object), signal: baseSignal };
        // PDF usa "modId" (camelCase), non "mod_id" come le altre app DBS —
        // vedi model_PDF.mjs::state.
        modId = st.modId ?? null;

        try {
            const { registerPDFFlowNodes } = await import('./PDF_sub_modules/PDF-flow-nodes.mjs');
            registerPDFFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi PDF:', e);
        }
    } else if (targetApp === 'ECH') {
        const { buildECHAppContext } = await import('./ECH_sub_modules/ECH-flow-runner.mjs');
        graph._appContext = { ...buildECHAppContext(st, st.object), signal: baseSignal };
        // ECH usa "modId" (camelCase), come PDF — non "mod_id".
        modId = st.modId ?? null;

        try {
            const { registerECHFlowNodes } = await import('./ECH_sub_modules/ECH-flow-nodes.mjs');
            registerECHFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi ECH:', e);
        }
    } else if (targetApp === 'JSX') {
        // Stessa forma di _appContext del caricamento reale (JSX-flow-runner.mjs):
        // getter lazy sul board del grafico attivo nel pannello.
        const { buildJSXAppContext } = await import('./JSX_sub_modules/JSX-flow-runner.mjs');
        // Object.create invece dello spread: lo spread copierebbe il VALORE dei
        // getter (board del momento), perdendo il riferimento al board ricreato
        // quando si cambia grafico nel pannello.
        graph._appContext = Object.assign(Object.create(buildJSXAppContext(st, st.object)), { signal: baseSignal });
        modId = st.models?.[st.activeIndex]?.mod_id ?? null;
        try {
            const { registerJSXFlowNodes } = await import('./JSX_sub_modules/JSX-flow-nodes.mjs');
            registerJSXFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi JSX:', e);
        }
    } else if (targetApp === 'IFC') {
        // Stessa forma di _appContext del caricamento reale (IFC-flow-runner.mjs).
        // Object.create invece dello spread: i getter (ifc, scene, camera…) restano vivi.
        const { buildIFCAppContext } = await import('./IFC_sub_modules/IFC-flow-runner.mjs');
        graph._appContext = Object.assign(Object.create(buildIFCAppContext(st, st.object)), { signal: baseSignal });
        modId = st.models?.[0]?.mod_id ?? null;
        try {
            const { registerIFCFlowNodes } = await import('./IFC_sub_modules/IFC-flow-nodes.mjs');
            registerIFCFlowNodes();
            // i nodi TJS che usano solo scena/camera/renderer funzionano anche su IFC
            const { registerTJSFlowNodes } = await import('./TJS_sub_modules/TJS-flow-nodes.mjs');
            registerTJSFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi IFC:', e);
        }
    } else if (targetApp === 'OLY') {
        // Stessa forma di _appContext del caricamento reale (OLY-flow-runner.mjs); getter vivi.
        const { buildOLYAppContext } = await import('./OLY_sub_modules/OLY-flow-runner.mjs');
        graph._appContext = Object.assign(Object.create(buildOLYAppContext(st, st.object)), { signal: baseSignal });
        modId = st.models?.[0]?.mod_id ?? null;
        try {
            const { registerOLYFlowNodes } = await import('./OLY_sub_modules/OLY-flow-nodes.mjs');
            registerOLYFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi OLY:', e);
        }
    } else if (targetApp === 'TML') {
        // Stessa forma di _appContext del caricamento reale (TML-flow-runner.mjs).
        // Object.create invece dello spread, come JSX: lo spread copierebbe il
        // VALORE del getter "ready" invece di rileggerlo a ogni nodo.
        const { buildTMLAppContext } = await import('./TML_sub_modules/TML-flow-runner.mjs');
        graph._appContext = Object.assign(Object.create(buildTMLAppContext(st, st.object)), { signal: baseSignal });
        modId = st.mod_id ?? null;
        try {
            const { registerTMLFlowNodes } = await import('./TML_sub_modules/TML-flow-nodes.mjs');
            registerTMLFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi TML:', e);
        }
    } else if (targetApp === 'HTM') {
        // Stessa forma di _appContext usata dal caricamento embedded reale
        // (HTM-flow-runner.mjs) — vedi nota sul branch MPS sopra. container
        // è un getter lazy su st.node: riflette il documento correntemente
        // attivo nel panel, anche se l'utente cambia documento dopo l'inject.
        const { buildHTMAppContext } = await import('./HTM_sub_modules/HTM-flow-runner.mjs');
        graph._appContext = Object.assign(Object.create(buildHTMAppContext(st, st.object)), { signal: baseSignal });
        modId = st.models?.[st.activeIndex]?.mod_id ?? null;

        try {
            const { registerHTMFlowNodes } = await import('./HTM_sub_modules/HTM-flow-nodes.mjs');
            registerHTMFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi HTM:', e);
        }
    } else {
        // TJS. ECH aveva un branch condiviso con TJS qui (solo un campo
        // `chart` mai consumato da nessun nodo, dato che ECH non aveva
        // ancora nodi propri) — separato nel branch dedicato sopra il
        // 2026-08-27 (vedi ECH-flow-runner.mjs).
        //
        // FIX (2026-09-19): mancavano `markDirty` e `localEvents`, presenti
        // invece nell'_appContext reale costruito da TJS-flow-runner.mjs per
        // il flow embedded. Conseguenza silenziosa: qualsiasi nodo TJS che
        // muta la scena (es. Object/SetPosition, Animate/ApplyTransform…)
        // chiama `_ctxDirty(this)`, che invoca `ctx.markDirty()` — assente
        // qui, quindi il vero render loop del pannello TJS non veniva mai
        // avvisato: i dati cambiavano davvero (posizione/rotazione erano
        // corrette in memoria) ma il canvas non si ridisegnava mai finché
        // qualcos'altro (es. muovere la camera) non forzava un frame per un
        // altro motivo. Stesso motivo per cui TJS/Events/OnPick e
        // OnSelectionChanged restavano inerti in "Testa su panel": il loro
        // onStart richiede `ctx.localEvents`, assente qui.
        graph._appContext = {
            signal:           baseSignal,
            objId:            st.object?.obj_id ?? null,
            scene:            st.scene          ?? null,
            camera:           st.camera         ?? null,
            renderer:         st.renderer       ?? null,
            orbitControls:    st.orbitControls  ?? null,
            localEvents:      st.localEvents    ?? null,
            // FIX (2026-09-21): prima era un oggetto statico placeholder
            // { position, normal, objName } — forma diversa da quella vera
            // ({ appObject, model, sceneObject }, scritta da onPick/
            // onSelectionChanged in model_TJS.mjs dentro st.appContext.lastHit)
            // e mai aggiornata da nessun click/selezione nel panel: TJS/
            // Selection/Get (e OnPick/OnSelectionChanged) risultavano sempre
            // vuoti/inerti in "Testa su panel" — due _appContext scollegati
            // per lo stesso panel. Getter che rilegge sempre il vero
            // st.appContext.lastHit corrente: stessa forma, sempre live,
            // nessuna copia da tenere sincronizzata.
            get lastHit() { return st.appContext?.lastHit ?? null; },
            // Righe DB modelli del panel target — vedi la stessa nota in
            // TJS-flow-runner.mjs (ReseArch/Object/Model List).
            models: st.models ?? [],
            // Punti collimati: riferimento live all'array del panel target
            // → nodi TJS/Pick/* leggono dati aggiornati in tempo reale
            collimatedPoints: st.collimatedPoints ?? [],
            clearPoints:      () => st.pickManager?.clear(),
            markDirty:        () => st.markDirty?.(),
            // Stesso getter live usato da TJS-flow-runner.mjs — TJS/Light/Save
            // (2026-09-22) funziona anche in "Testa su panel".
            get lightManager() { return st.lightManager ?? null; },
            // Host delle estensioni (TJS-extensions.mjs): i nodi TJS/Setup/* installano
            // i moduli nel pannello vero anche da "Testa su panel".
            get ext() { return st.ext ?? null; },
        };

        try {
            const { registerTJSFlowNodes } = await import('./TJS_sub_modules/TJS-flow-nodes.mjs');
            registerTJSFlowNodes();
        } catch (e) {
            console.warn('[FLE] Registrazione nodi TJS:', e);
        }

        // Ricava il primo mod_id disponibile nel panel target
        modId = st.modId ?? null;
        if (!modId && st.modelsRoot?.children?.length) {
            modId = st.modelsRoot.children[0]?.userData?.modelRow?.mod_id ?? null;
        }
    }

    // App Bus Emitter/Receiver sono app-agnostici — utili qualunque sia l'app
    // di destinazione, registrati sempre.
    try {
        const { registerAppBusFlowNodes } = await import('./AppBus-flow-nodes.mjs');
        registerAppBusFlowNodes();
    } catch (e) {
        console.warn('[FLE] Registrazione nodi Local:', e);
    }

    return { ok: true, modId };
}

/**
 * Richiama onStop()+onStart() su tutti i nodi del grafo — necessario dopo
 * aver sostituito graph._appContext a grafo già avviato (picker "Testa su
 * panel", "Rimuovi contesto"): LGraph.start() (litegraph.js) chiama
 * sendEventToAllNodes("onStart") una volta sola e ignora chiamate successive
 * se lo status è già RUNNING, quindi i nodi context-aware con onStart
 * (MPS/Events/*, OSD/Events/*, App Bus Receiver) restano agganciati al
 * contesto (assente o di un altro panel) che c'era al primo graph.start() —
 * non serve invece nel percorso "Flow embedded" (object.__embeddedTarget in
 * renderBody), dove il contesto viene iniettato PRIMA del primo
 * graph.start(), quindi i nodi lo vedono già corretto al loro unico onStart.
 * onStop() è idempotente-safe per la reinvocazione: i nodi coinvolti
 * (App Bus Receiver, MPSEventsOnMarkerClick/OnViewSettled, OSDEventsOn*)
 * rimuovono la propria sottoscrizione precedente prima di ricrearla, così
 * un secondo giro con lo stesso contesto (o nessuno) non duplica listener.
 */
function _reinitGraphNodes(graph) {
    for (const node of graph._nodes ?? []) {
        try { node.onStop?.(); } catch (e) { console.error('[FLE] onStop:', e); }
    }
    for (const node of graph._nodes ?? []) {
        try { node.onStart?.(); } catch (e) { console.error('[FLE] onStart:', e); }
    }
}

/**
 * Mostra un modal Bootstrap con la lista dei panel aperti.
 * Al click: inietta il contesto del panel selezionato e aggiorna state.
 */
function _showTestPanelPicker(state) {
    const panels = _getOpenPanelsForTest();

    if (panels.length === 0) {
        state.cmdUI?.update({ status: t('app.fle.test.no_panels') });
        return;
    }

    // Rimuove eventuale modal precedente
    document.getElementById('fle-test-panel-modal')?.remove();

    const COLORS = { TJS: 'primary', ECH: 'success', MPS: 'warning', PSG: 'info', DBJ: 'secondary', GSH: 'secondary', MYS: 'secondary', PDF: 'danger' };
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // (2026-10-06) pannello già collegato: evidenziato nell'elenco e indicato per nome e numero
    // dell'oggetto in "Attivo" (prima solo [APP] e mod_id: con una scena senza modelli caricati non
    // compariva altro e il collegamento sembrava non riuscito). Il mod_id non si mostra (2026-10-07):
    // un oggetto può avere più modelli, conta l'oggetto.
    const isActive = (p) => !!state.testPanelBodyEl && p.bodyEl === state.testPanelBodyEl;

    const modalEl = document.createElement('div');
    modalEl.id        = 'fle-test-panel-modal';
    modalEl.className = 'modal fade';
    modalEl.tabIndex  = -1;
    modalEl.setAttribute('aria-labelledby', 'fle-test-panel-modal-title');
    modalEl.innerHTML = `
        <div class="modal-dialog modal-fullscreen-md-down modal-sm">
            <div class="modal-content bg-body text-body">
                <div class="modal-header py-2">
                    <h6 class="modal-title mb-0" id="fle-test-panel-modal-title">
                        <i class="bi bi-play-circle me-1" aria-hidden="true"></i>${te('app.fle.test.title')}
                    </h6>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${te('common.close')}"></button>
                </div>
                <div class="modal-body py-2">
                    <p class="small text-muted mb-2">
                        ${te('app.fle.test.intro')}<br>
                        ${te('app.fle.test.intro_nodes', { nodes: '\u0000' }).replace('\u0000', '<code>TJS/Camera/FlyTo</code>, <code>TJS/Object/Highlight</code>')}
                    </p>
                    <div class="list-group list-group-flush">
                        ${panels.map((p, i) => `
                            <button class="list-group-item list-group-item-action py-2 px-2 small fle-panel-pick${isActive(p) ? ' list-group-item-primary fw-semibold' : ''}"
                                    data-idx="${i}"${isActive(p) ? ` aria-current="true" title="${te('app.fle.test.linked_panel')}"` : ''}>
                                <span class="badge bg-${COLORS[p.app] ?? 'secondary'} me-2">${esc(p.app)}</span>
                                ${esc(p.name)}
                                ${p.objId ? `<span class="text-muted ms-1">#${p.objId}</span>` : ''}
                                ${isActive(p) ? '<i class="bi bi-check-circle-fill text-success float-end mt-1" aria-hidden="true"></i>' : ''}
                            </button>
                        `).join('')}
                    </div>
                    ${state.testPanelApp ? `
                        <div class="mt-2 small text-muted">
                            <i class="bi bi-check-circle-fill text-success me-1" aria-hidden="true"></i>
                            ${te('app.fle.test.active_label')} <strong>[${esc(state.testPanelApp)}]</strong>
                            ${esc(state.testPanelName || '')}
                            ${state.testPanelObjId ? `<span class="text-muted">#${state.testPanelObjId}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
                <div class="modal-footer py-1">
                    ${state.testPanelApp ? `
                        <button type="button" class="btn btn-sm btn-outline-danger" id="fle-test-clear">
                            <i class="bi bi-x-circle me-1" aria-hidden="true"></i>${te('app.fle.test.clear')}
                        </button>
                    ` : ''}
                    <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">${te('common.close')}</button>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modalEl);

    // Bootstrap modal
    const bsModal = new window.bootstrap.Modal(modalEl);
    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());

    // Click su panel → inietta contesto
    modalEl.querySelectorAll('.fle-panel-pick').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx      = parseInt(btn.dataset.idx, 10);
            const selected = panels[idx];

            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>${te('app.fle.test.injecting')}`;

            const { ok, modId } = await _injectTestContext(state.graph, selected.bodyEl, selected.app);

            if (ok) {
                // Nodi ReseArch/Menu/* e ReseArch/Panel/*: voci e footer nel pannello di prova
                state.testPanelDetach?.();
                state.testPanelDetach = attachFlowGraph(state.graph, selected.bodyEl, state.signal);
                state.testPanelBodyEl = selected.bodyEl;
                state.testPanelApp    = selected.app;
                state.testPanelModId  = modId;
                // Cambio target → un salvataggio successivo deve creare un
                // nuovo flow, non aggiornare quello (eventualmente) legato al
                // target precedente.
                if (state.testPanelObjId !== (selected.objId || null)) {
                    state.currentFlowId = null;
                    state.currentFlowCanEdit = true;   // il prossimo salvataggio crea un flow nuovo (proprio)
                    _setEditingFlow(state, null);
                }
                state.testPanelObjId  = selected.objId || null;
                state.testPanelName   = selected.name || '';
                // Il grafo è già in esecuzione (graph.start() chiamato all'apertura
                // del panel FLE, prima che l'utente scegliesse un target): i nodi
                // con onStart (MPS/Events/*, OSD/Events/*, App Bus Receiver) vanno
                // riavviati esplicitamente per agganciarsi al contesto appena
                // iniettato — LGraph.start() non richiama onStart una seconda
                // volta da solo (vedi nota su _reinitGraphNodes).
                _reinitGraphNodes(state.graph);
                state.cmdUI?.update({
                    status: state.testPanelObjId
                        ? t('app.fle.test.active_obj', { app: selected.app, name: selected.name, obj: state.testPanelObjId })
                        : t('app.fle.test.active', { app: selected.app, name: selected.name }),
                });
                state.lgCanvas?.setDirty(true, true);
            } else {
                state.cmdUI?.update({ status: t('app.fle.test.incompatible', { app: selected.app }) });
            }

            bsModal.hide();
        });
    });

    // "Rimuovi contesto"
    modalEl.querySelector('#fle-test-clear')?.addEventListener('click', () => {
        // onStop PRIMA di azzerare _appContext: i nodi con onStart (MPS/Events/*,
        // OSD/Events/*, App Bus Receiver) devono staccare i listener sul panel
        // target — altrimenti restano agganciati a un panel che il grafo non
        // dovrebbe più poter influenzare. Il contesto torna a { signal }, non
        // null: stesso stato "vuoto ma valido" dell'apertura iniziale del
        // panel FLE, così un nodo aggiunto dopo (con onStart proprio) non
        // trova un _appContext undefined.
        for (const node of state.graph._nodes ?? []) {
            try { node.onStop?.(); } catch (e) { console.error('[FLE] onStop:', e); }
        }
        state.graph._appContext   = { signal: state.signal };
        state.testPanelDetach?.();
        state.testPanelDetach     = null;
        state.testPanelBodyEl     = null;
        state.testPanelApp        = null;
        state.testPanelModId      = null;
        state.testPanelObjId      = null;
        state.testPanelName       = '';
        state.currentFlowId       = null;
        state.currentFlowCanEdit  = true;
        _setEditingFlow(state, null);
        state.cmdUI?.update({ status: t('app.fle.test.cleared') });
        bsModal.hide();
    });

    bsModal.show();
}

// (APP BUS: il collegamento esterno dei vecchi App Emitter/Receiver — _wireBusToGraph,
//  _rewireBus — è stato rimosso il 2026-10-04: i nodi App Bus Emitter/Receiver
//  (app/AppBus-flow-nodes.mjs) si collegano al bus da soli.)


// ============================================================
// SPECIALIZATION EXPORT (plugin)
// ============================================================

export default {

    async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal, level }) {
        if (!bodyEl) throw new Error("FLE.renderBody: bodyEl mancante");

        const { LiteGraph, LGraph, LGraphCanvas } = getLGGlobals();
        if (!LiteGraph || !LGraph || !LGraphCanvas) {
            bodyEl.innerHTML = `<div class="p-3 text-danger fw-bold" role="alert">
                ${te('app.fle.err.litegraph_missing')}<br>
                ${te('app.fle.err.litegraph_hint')}
            </div>`;
            return;
        }

        destroyBodyInstance(bodyEl);

        // Sotto i 992px l'editor non si apre (_doc/arch-i18n-a11y.md §7): troppo piccolo per
        // lavorare sui nodi. I flow collegati agli oggetti e alla dashboard girano comunque.
        if (window.matchMedia?.("(max-width: 991.98px)").matches) {
            bodyEl.innerHTML = `<div class="p-3 text-light small" role="status">${te('app.fle.desktop_only')}</div>`;
            return;
        }

        const prevBodyStyle = { position: bodyEl.style.position, overflow: bodyEl.style.overflow };
        bodyEl.style.position = bodyEl.style.position || "relative";
        bodyEl.style.overflow = "hidden";

        // Registra nodi: custom di progetto, compresi i nodi App Bus Emitter/Receiver
        await fleRegisterCustomNodes();
        registerFlowNodes();
        installErrorNodeMenu();
        // Nodi di libreria (catalogo dal server): disponibili nel menu anche su un grafo nuovo
        await ensureLibraryNodes();

        // Registra nodi context-aware delle app (TJS, ECH, MPS…)
        // Devono essere chiamati DOPO registerFlowNodes() che fa clearRegisteredTypes().
        try {
            const { registerTJSFlowNodes } = await import('./TJS_sub_modules/TJS-flow-nodes.mjs');
            registerTJSFlowNodes();
        } catch (e) { console.warn('[FLE] TJS-flow-nodes:', e); }

        const canvas   = createCanvas(bodyEl);
        const graph    = new LGraph();
        // Etichetta dei messaggi che questo grafo emette sul bus: ignora solo i
        // propri, non quelli del runtime o di altri editor (vedi FLE-runtime.mjs).
        graph._fleBusTag = `editor:${Math.random().toString(36).slice(2, 10)}`;
        const lgCanvas = new LGraphCanvas(canvas, graph);
        if (Number(level ?? 50) < 30) fleMakeReadOnly(lgCanvas);

        // Pannello laterale "Help nodo" (overlay assoluto, stesso stile/classi
        // dei pannelli destri di model_TJS.mjs — css/ReseArch.css è globale,
        // non specifico di TJS). Toggle da toolbar (btnFLEHelp), contenuto
        // aggiornato solo al cambio di selezione nel canvas — vedi
        // FLE-help-panel.mjs per il perché di questa scelta.
        const rightContainer = document.createElement('div');
        rightContainer.className = 'tjs-rpanel';
        bodyEl.appendChild(rightContainer);
        const helpPanel = fleCreateHelpPanel({ containerEl: rightContainer, signal });
        lgCanvas.onNodeSelected   = (node) => helpPanel.setSelection(node);
        lgCanvas.onNodeDeselected = ()     => helpPanel.setSelection(null);

        lgCanvas.background_image          = null;   // griglia punteggiata di default OFF — vedi btnFLEGrid
        lgCanvas.render_canvas_border       = false; // bordo cosmetico del <canvas> (rendering nativo LiteGraph) — sostituito dal toggle griglia
        lgCanvas.render_shadows            = false;
        lgCanvas.render_connections_border = true;
        lgCanvas.show_info                 = false;
        lgCanvas.links_render_mode         = 2;   // SPLINE_LINK default

        _patchCursorZoom(lgCanvas);

        // Carica dati salvati.
        // Scenario "Flow embedded" (voce panel, vedi dashboard_windows.mjs +
        // dashboard.php + modal_flow_embedded.js): object è sintetico
        // (object.__embeddedTarget). Il grafo va preso dal flow_id indicato
        // (flow embedded esistente) oppure resta vuoto (nuovo flow, creato al
        // primo "Salva flow embedded").
        // (2026-10-04) Rimossa la lettura del grafo da models[0].mod_spec per
        // gli oggetti con obj_app='FLE': i grafi stanno solo nella tabella flows.
        const embeddedTarget = object?.__embeddedTarget ?? null;
        // Flow DASHBOARD (2026-10-04, _doc/arch-flow-dashboard.md §3.4): bersaglio
        // = Dashboard Config (dshpId), non un oggetto — niente "Testa su panel" né
        // obj_id; i nodi App Bus Emitter/Receiver si collegano al bus da soli.
        const isDashFlow = embeddedTarget?.kind === 'dashboard';

        let savedSpec = null;
        let flowName  = null;   // nome del flow corrente, per il prompt di "Rinomina"
        let flowCanEdit = true; // false = flow di un altro autore (sola lettura, "Salva con nome")
        let flowAuthor  = '';
        let flowNotice  = '';   // flow di un altro autore non ancora validato (arch-abilitazioni.md §5)

        if (embeddedTarget) {
            if (embeddedTarget.flowId) {
                try {
                    const res = await fleLoad(embeddedTarget.flowId, true);
                    if (!res.ok) flowNotice = res.error || '';
                    if (res.ok) {
                        savedSpec = extractGraphData(res.data?.flow_fle);
                        flowName  = res.data?.flow_name ?? null;
                        flowCanEdit = res.data?.can_edit !== false;
                        flowAuthor  = res.data?.author_name ?? '';
                        flowNotice  = res.data?.flow_unavailable_reason ?? '';
                    }
                } catch (err) {
                    console.warn("[FLE] fleLoad (embedded target):", err);
                }
            } else if (embeddedTarget.seedFlowId) {
                // "Nuovo, copiato da un flow condiviso esistente" (vedi
                // ui/modal_flow_embedded.js). Il grafo copiato pre-popola
                // l'editor ma NON è un flow_id da aggiornare: currentFlowId
                // resta null (sotto), così il primo salvataggio CREA un
                // nuovo record invece di sovrascrivere la sorgente.
                try {
                    const res = await fleLoadShared(embeddedTarget.seedFlowId, embeddedTarget.seedScope,
                                                    isDashFlow ? 'dashboard' : 'object');
                    if (res.ok) savedSpec = extractGraphData(res.data?.flow_fle);
                    else cmdUI?.show({ status: t('app.fle.load.seed_error', { error: res.error }), hints: "" });
                } catch (err) {
                    console.warn("[FLE] fleLoadShared (embedded target):", err);
                }
            }
        }

        if (savedSpec && typeof savedSpec === "object" && Array.isArray(savedSpec.nodes)) {
            try {
                graph.configure(savedSpec);

                // Ripara nodi orfani da riorganizzazioni del menu (vedi
                // FLE-node-repair.mjs): i migrati vengono sostituiti in
                // silenzio con un alert + una Note nel grafo per il
                // riepilogo; i non risolti restano visibili come nodi in
                // errore, ma con un titolo che invita all'azione invece di
                // "undefined" (menu tasto destro → "Aggiorna nodo…").
                const { migrated, unresolved } = repairKnownMigrations(graph);
                markUnresolvedNodes(unresolved);
                if (migrated.length > 0) {
                    const targetLabel = embeddedTarget ? `[${embeddedTarget.app}] ${embeddedTarget.name}` : (object?.obj_name ?? '');
                    const report = formatMigrationReport(migrated, targetLabel);
                    window.alert(report);
                    addReportNote(graph, report);
                }

                // Ripristina l'ultima vista salvata (graph.extra.view, scritta
                // da _captureViewIntoGraph prima del salvataggio) — se il
                // grafo è stato salvato prima di questo fix, extra.view non
                // c'è: resta la vista di default (scale 1, offset 0,0).
                _restoreViewFromGraph({ graph, lgCanvas });

                cmdUI?.show({
                    status: t('app.fle.load.loaded', { n: savedSpec.nodes.length }),
                    hints:  t('app.fle.hints'),
                });
            } catch (err) {
                console.warn("[FLE] Errore nel configurare il grafo:", err);
                cmdUI?.show({ status: t('app.fle.load.error'), hints: "" });
            }
        } else {
            cmdUI?.show({
                status: flowNotice
                    ? flowNotice
                    : isDashFlow
                    ? t('app.fle.load.new_dashboard', { name: embeddedTarget.name ?? '' })
                    : embeddedTarget
                    ? t('app.fle.load.empty_object', { app: embeddedTarget.app, name: embeddedTarget.name })
                    : t('app.fle.load.empty'),
                hints:  t('app.fle.hints'),
            });
        }

        // State impostato PRIMA di graph.start() — se start() lancia,
        // i pulsanti toolbar funzionano comunque.
        const state = {
            graph,
            lgCanvas,
            canvas,
            helpPanel,
            cmdUI,
            signal,
            prevBodyStyle,
            resizeObserver:  null,
            resizeRAF:       0,
            isRunning:       true,
            stopped:         false,
            linkModeIdx:     0,
            gridOn:          false,  // stato toggle griglia canvas (btnFLEGrid) — vedi lgCanvas.background_image
            // Test Scenario 3
            testPanelBodyEl: null,
            testPanelApp:    null,
            testPanelModId:  null,
            testPanelObjId:  null,
            // Salvataggio come flow embedded: null finché non si salva la
            // prima volta in questa sessione di editing, poi memorizza il
            // flow_id creato così i salvataggi successivi lo aggiornano
            // invece di crearne uno nuovo ogni volta (vedi saveGraphAsObjectFlow).
            // Se il panel è stato aperto dal picker "Flow embedded" su un flow
            // già esistente, parte già valorizzato (vedi embeddedTarget sopra).
            currentFlowId:    embeddedTarget?.flowId ?? null,
            // Nome del flow corrente (se già salvato/caricato) — usato come
            // default nel prompt di "Rinomina" (btnFLERenameFle).
            currentFlowName:  flowName,
            // Autore/diritto di modifica del flow corrente (arch-permessi.md §8ter):
            // se false, "Salva" e "Rinomina" non aggiornano il flow ma propongono una copia.
            currentFlowCanEdit: flowCanEdit,
            currentFlowAuthor:  flowAuthor,
            // 'object' | 'dashboard' — decide salvataggio e "Testa su panel"
            flowKind:   isDashFlow ? 'dashboard' : 'object',
            dashTarget: isDashFlow ? { dshpId: Number(embeddedTarget.dshpId) || null, name: embeddedTarget.name ?? '' } : null,
            // Finestra e descrittore salvato nelle Dashboard Config (vedi _setEditingFlow)
            panelEl:      panel ?? null,
            embeddedDesc: embeddedTarget ? {
                kind:   isDashFlow ? 'dashboard' : 'object',
                objId:  embeddedTarget.objId ?? null,
                dshpId: isDashFlow ? (Number(embeddedTarget.dshpId) || null) : null,
                app:    embeddedTarget.app ?? null,
                name:   embeddedTarget.name ?? null,
            } : null,
        };
        bodyEl[STATE_KEY] = state;
        _setEditingFlow(state, state.currentFlowId);   // il runtime sospende questo flow finché il pannello è aperto

        state.resizeObserver = attachResizeObserver(bodyEl, lgCanvas, state);
        attachAbortCleanup(signal, bodyEl);

        // catch_errors = true: LiteGraph cattura gli errori nei singoli nodi
        // senza far crashare il loop (utile per nodi built-in con dipendenze mancanti)
        graph.catch_errors = true;

        // Imposta signal nel contesto PRIMA di start(): i nodi OSD/Events/*,
        // MPS/Events/* e App Bus Receiver registrano il loro listener in
        // onStart() e richiedono ctx.signal (e, per OSD/MPS Events, anche
        // ctx.viewer()/ctx.map — vedi blocco embeddedTarget subito sotto).
        if (!graph._appContext) graph._appContext = {};
        graph._appContext.signal = signal;

        // Scenario "Flow embedded": inietta SUBITO il contesto del panel
        // target, PRIMA di graph.start() — non dopo (bug 2026-08-26: i nodi
        // MPS/Events/*/OSD/Events/* leggono ctx.map/ctx.viewer() dentro
        // onStart(), chiamato UNA SOLA VOLTA da LGraph.start() (litegraph.js
        // ignora una seconda start() se lo status è già RUNNING — non c'è
        // un secondo giro). Se il contesto reale arriva dopo start(), quei
        // nodi trovano ctx.map/ctx.viewer() ancora undefined, falliscono in
        // silenzio (return anticipato) e non si agganciano mai al listener
        // vero — sintomo: "i nodi MPS/Events non funzionano" nel panel
        // aperto dal picker "Flow embedded"). Stesso meccanismo di
        // _showTestPanelPicker, ma automatico — l'utente ha già scelto
        // l'oggetto/contesto nel picker prima di aprire questo panel FLE,
        // non serve un secondo passaggio manuale "Testa su panel".
        // FIX (2026-09-21): objId/app del target vengono ora impostati SEMPRE
        // che siano noti, scorporati dal successo dell'iniezione contesto —
        // prima stavano dentro `if (ok)`, quindi un pannello ripristinato da
        // una configurazione dashboard salvata (nessun bodyEl live, vedi
        // dashboard_cfg.mjs) perdeva anche l'obj_id target, costringendo
        // "Salva flow embedded" a richiederlo di nuovo manualmente.
        if (isDashFlow) {
            cmdUI?.update({
                status: t('app.fle.status.dashboard_running', { name: embeddedTarget.name ?? '' }),
            });
        } else if (embeddedTarget?.app) {
            state.testPanelApp   = embeddedTarget.app;
            state.testPanelObjId = embeddedTarget.objId ?? null;
            state.testPanelName  = embeddedTarget.name ?? '';
        }
        if (isDashFlow) {
            // niente contesto di un pannello da iniettare
        } else if (embeddedTarget?.bodyEl && embeddedTarget?.app) {
            const { ok, modId: injectedModId } = await _injectTestContext(graph, embeddedTarget.bodyEl, embeddedTarget.app);
            if (ok) {
                state.testPanelBodyEl = embeddedTarget.bodyEl;
                state.testPanelModId  = injectedModId;
                cmdUI?.update({
                    status: state.testPanelObjId
                        ? t('app.fle.status.target_obj', { app: embeddedTarget.app, name: embeddedTarget.name, obj: state.testPanelObjId })
                        : t('app.fle.status.target', { app: embeddedTarget.app, name: embeddedTarget.name }),
                });
            } else {
                cmdUI?.update({
                    status: t('app.fle.status.context_failed', { app: embeddedTarget.app, name: embeddedTarget.name }),
                });
            }
        } else if (embeddedTarget) {
            // Ripristinato da una configurazione dashboard: nessun bodyEl
            // live (limite noto, _doc/arch-dashboard-windows.md §10) —
            // grafo/target noti, ma serve rifare "Testa su panel" a mano
            // per riattivare i nodi che leggono la scena.
            cmdUI?.update({
                status: state.testPanelObjId
                    ? t('app.fle.status.target_obj_restored', { app: embeddedTarget.app, name: embeddedTarget.name, obj: state.testPanelObjId })
                    : t('app.fle.status.target_restored', { app: embeddedTarget.app, name: embeddedTarget.name }),
            });
        }

        try {
            graph.start();
        } catch (err) {
            console.warn("[FLE] graph.start():", err);
            state.isRunning = false;
        }
        lgCanvas.setDirty(true, true);

        // Annulla / Ripeti (2026-10-17, FLE-undo.mjs): la storia parte dal grafo appena caricato.
        // In sola lettura (livello < 30) niente: il grafo non si modifica.
        if (!lgCanvas.read_only) {
            const setBtn = (id, on) => {
                const btn = (state.panelEl ?? bodyEl.closest('.panel'))?.querySelector(`#${id}`);
                if (btn) btn.disabled = !on;
            };
            state.undo = fleAttachUndo({
                graph, lgCanvas, bodyEl, signal,
                isRunning: () => state.isRunning && !state.stopped,
                onChange: ({ canUndo, canRedo }) => { setBtn('btnFLEUndo', canUndo); setBtn('btnFLERedo', canRedo); },
                onApplied: (what, left) => {
                    state.helpPanel?.setSelection(null);
                    cmdUI?.update({ status: t(`app.fle.undo.${what}`, { n: left }) });
                },
            });
        }


        // Ascolta gli eventi del runtime in background per aggiornare lo status footer
        // (il controllo start/stop del runtime resta sull'indicatore globale
        // in FLE-toolbar.mjs — qui solo un riflesso testuale nello status del panel)
        window.addEventListener('fle:runtime:started', ev => {
            if (state.stopped) return;
            const name = ev.detail?.flowName ?? '';
            cmdUI?.update({ status: name ? t('app.fle.runtime.started_named', { name }) : t('app.fle.runtime.started') });
        }, { signal });

        window.addEventListener('fle:runtime:stopped', () => {
            if (state.stopped) return;
            cmdUI?.update({ status: t('app.fle.runtime.stopped') });
        }, { signal });
    },

    // ---- Menu sinistra ----
    getLeftMenu({ object, bodyEl }) {
        return {
            title: getObjectDisplayName(object),
            items: [
                {
                    id: "graph-info",
                    label: t('app.fle.menu.graph_info'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.graph) return;
                        const s = st.graph.serialize();
                        console.info("[FLE] Graph info:", s);
                        st.cmdUI?.update({
                            status: t('app.fle.menu.graph_info_status', { nodes: s.nodes?.length ?? 0, links: s.links?.length ?? 0 }),
                        });
                    },
                },
            ],
        };
    },

    // ---- Menu destra ----
    getRightMenu({ bodyEl }) {
        return {
            title: "☰",
            items: [
                {
                    id: "snap-grid",
                    label: t('app.fle.menu.snap_grid'),
                    onClick: () => {
                        // FIX (2026-09-19): la proprietà scritta era "snap_to_grid",
                        // che non esiste da nessuna parte in litegraph.js — creava
                        // solo un campo custom mai letto da nessuno, nessun effetto.
                        // La proprietà REALE (verificata nel sorgente: LGraphCanvas
                        // la controlla al rilascio del drag di un nodo, "if
                        // (this.graph.config.align_to_grid || this.align_to_grid)
                        // this.node_dragged.alignToGrid()") è `align_to_grid`.
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.lgCanvas) return;
                        st.lgCanvas.align_to_grid = !(st.lgCanvas.align_to_grid ?? false);
                        st.cmdUI?.update({ status: st.lgCanvas.align_to_grid ? t('app.fle.menu.snap_on') : t('app.fle.menu.snap_off') });
                    },
                },
                {
                    id: "show-info",
                    label: t('app.fle.menu.show_info'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.lgCanvas) return;
                        st.lgCanvas.show_info = !st.lgCanvas.show_info;
                        st.lgCanvas.setDirty(true, true);
                    },
                },
                { type: "divider" },
                {
                    id: "fit-view",
                    label: t('app.fle.menu.fit_view'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.lgCanvas) return;
                        fitAllNodes(st.lgCanvas, st.graph, st.canvas);
                    },
                },
                {
                    id: "zoom-one-to-one",
                    label: t('app.fle.zoom_one'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.lgCanvas) return;
                        zoomOneToOne(st.lgCanvas, st.canvas);
                    },
                },
            ],
        };
    },

    // ---- Toolbar ----
    // 3 gruppi: (1) Zoom/stile, (2) Contenuto grafo, (3) Test/esecuzione.
    // btnFLESave/btnFLEBackground/btnFLEStopRuntime rimossi (deprecati —
    // superati da flows/object_flows_connections + menù "Links", vedi
    // _doc/module-fle-architettura.md).
    getToolbar({ panel, headerEl, bodyEl }) {
        return {
            items: [

                // ── Gruppo 1: Zoom / stile ──────────────────────────────────
                {
                    type:      "button",
                    id:        "btnFLEFit",
                    iconClass: "bi bi-fullscreen",
                    className: "icon-only",
                    title:     t('app.fle.tb.fit'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.lgCanvas) return;
                        fitAllNodes(st.lgCanvas, st.graph, st.canvas);
                    },
                },

                {
                    type:      "button",
                    id:        "btnFLEOneToOne",
                    iconClass: "bi bi-fullscreen-exit",
                    className: "icon-only",
                    title:     t('app.fle.zoom_one'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.lgCanvas) return;
                        zoomOneToOne(st.lgCanvas, st.canvas);
                    },
                },

                // Stile fili — cicla tra Spline / Diretto / Lineare
                {
                    type:      "button",
                    id:        "btnFLELinkMode",
                    iconClass: "bi bi-bezier2",
                    className: "icon-only",
                    title:     t('app.fle.tb.link_mode', { mode: t(_LINK_MODES[bodyEl?.[STATE_KEY]?.linkModeIdx ?? 0].labelKey) }),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.lgCanvas) return;
                        st.linkModeIdx = (st.linkModeIdx + 1) % _LINK_MODES.length;
                        const m = _LINK_MODES[st.linkModeIdx];
                        st.lgCanvas.links_render_mode = m.val;
                        st.lgCanvas.setDirty(true, true);
                        const btn = (headerEl ?? panel)?.querySelector('#btnFLELinkMode');
                        if (btn) {
                            btn.title = t('app.fle.tb.link_mode', { mode: t(m.labelKey) });
                            btn.setAttribute('aria-label', btn.title);
                            const ico = btn.querySelector('i');
                            if (ico) ico.className = `bi ${m.icon}`;
                        }
                    },
                },

                // Griglia canvas — on/off (sostituisce il bordo cosmetico
                // di default di LiteGraph, disattivato in _initCanvas)
                {
                    type:      "button",
                    id:        "btnFLEGrid",
                    iconClass: "bi bi-grid-3x3",
                    className: "icon-only",
                    title:     (bodyEl?.[STATE_KEY]?.gridOn) ? t('app.fle.tb.grid_on') : t('app.fle.tb.grid_off'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.lgCanvas) return;
                        st.gridOn = !st.gridOn;
                        st.lgCanvas.background_image = st.gridOn
                            ? (window.LGraphCanvas?.DEFAULT_BACKGROUND_IMAGE ?? null)
                            : null;
                        st.lgCanvas.setDirty(true, true);
                        const btn = (headerEl ?? panel)?.querySelector('#btnFLEGrid');
                        if (btn) {
                            btn.classList.toggle('active', st.gridOn);
                            btn.title = st.gridOn ? t('app.fle.tb.grid_on') : t('app.fle.tb.grid_off');
                            btn.setAttribute('aria-label', btn.title);
                        }
                    },
                },

                { type: "divider" },

                // ── Gruppo 2: Contenuto grafo ───────────────────────────────
                // Annulla / Ripeti (FLE-undo.mjs) — anche Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z
                {
                    type:      "button",
                    id:        "btnFLEUndo",
                    iconClass: "bi bi-arrow-counterclockwise",
                    className: "icon-only",
                    title:     t('app.fle.tb.undo'),
                    minLevel:  30,
                    disabled:  !bodyEl?.[STATE_KEY]?.undo?.canUndo,
                    onClick: () => { bodyEl?.[STATE_KEY]?.undo?.undo(); },
                },
                {
                    type:      "button",
                    id:        "btnFLERedo",
                    iconClass: "bi bi-arrow-clockwise",
                    className: "icon-only",
                    title:     t('app.fle.tb.redo'),
                    minLevel:  30,
                    disabled:  !bodyEl?.[STATE_KEY]?.undo?.canRedo,
                    onClick: () => { bodyEl?.[STATE_KEY]?.undo?.redo(); },
                },

                // Salva come flow embedded
                {
                    type:      "button",
                    id:        "btnFLESaveFle",
                    iconClass: "bi bi-floppy",
                    className: "icon-only",
                    title:     t('app.fle.tb.save.@'),
                    minLevel:  30,
                    onClick: async () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.graph) return;

                        if (st.flowKind === 'dashboard') {
                            _captureViewIntoGraph(st);
                            await saveGraphAsDashboardFlow(st, st.graph.serialize());
                            return;
                        }

                        let targetObjId = st.testPanelObjId;

                        if (!targetObjId) {
                            // Nessun panel di test selezionato → chiede l'obj_id manualmente
                            const input = window.prompt(t('app.fle.tb.prompt_obj_id.@'));
                            if (!input) return;
                            targetObjId = parseInt(input, 10);
                            if (isNaN(targetObjId) || targetObjId <= 0) {
                                st.cmdUI?.update({ status: t('app.fle.tb.invalid_obj_id') });
                                return;
                            }
                        }

                        const ok = window.confirm(st.currentFlowId
                            ? t('app.fle.tb.confirm_update', { id: st.currentFlowId, obj: targetObjId })
                            : t('app.fle.tb.confirm_create', { obj: targetObjId }));
                        if (!ok) return;

                        _captureViewIntoGraph(st);
                        await saveGraphAsObjectFlow(st, targetObjId, st.graph.serialize());
                    },
                },

                // Salva con nome — crea sempre un NUOVO flow embedded (mai
                // un update del flow corrente), anche se uno è già caricato.
                {
                    type:      "button",
                    id:        "btnFLESaveAsFle",
                    iconClass: "bi bi-floppy-fill",
                    className: "icon-only",
                    title:     t('app.fle.tb.save_as'),
                    minLevel:  30,
                    onClick: async () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.graph) return;

                        if (st.flowKind === 'dashboard') {
                            _captureViewIntoGraph(st);
                            await saveGraphAsDashboardFlow(st, st.graph.serialize(), true);
                            return;
                        }

                        let targetObjId = st.testPanelObjId;

                        if (!targetObjId) {
                            const input = window.prompt(t('app.fle.tb.prompt_obj_id.@'));
                            if (!input) return;
                            targetObjId = parseInt(input, 10);
                            if (isNaN(targetObjId) || targetObjId <= 0) {
                                st.cmdUI?.update({ status: t('app.fle.tb.invalid_obj_id') });
                                return;
                            }
                        }

                        _captureViewIntoGraph(st);
                        await saveGraphAsObjectFlow(st, targetObjId, st.graph.serialize(), true);
                    },
                },

                // Rinomina — modifica flow_name del flow corrente IN PLACE
                // (a differenza di "Salva con nome", non crea un nuovo record).
                {
                    type:      "button",
                    id:        "btnFLERenameFle",
                    iconClass: "bi bi-pencil-square",
                    className: "icon-only",
                    title:     t('app.fle.tb.rename'),
                    minLevel:  30,
                    onClick: async () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.graph) return;

                        if (!st.currentFlowId) {
                            st.cmdUI?.update({ status: t('app.fle.rename.none') });
                            return;
                        }

                        if (st.currentFlowCanEdit === false) {
                            st.cmdUI?.update({ status: t('app.fle.rename.not_author.@', { id: st.currentFlowId, author: st.currentFlowAuthor || t('app.fle.other_author') }) });
                            return;
                        }

                        const newName = window.prompt(t('app.fle.rename.prompt'), st.currentFlowName ?? '');
                        if (!newName || !newName.trim()) return;

                        st.cmdUI?.update({ status: t('app.fle.rename.running') });
                        try {
                            const res = await fleUpdateMeta(st.currentFlowId, { flow_name: newName.trim() });
                            if (!res.ok) throw new Error(res.error);
                            st.currentFlowName = newName.trim();
                            st.cmdUI?.update({ status: t('app.fle.rename.done', { id: st.currentFlowId, name: st.currentFlowName }) });
                        } catch (err) {
                            st.cmdUI?.update({ status: t('app.fle.rename.error', { error: err.message }) });
                            console.error('[FLE] Rinomina flow:', err);
                        }
                    },
                },

                // Clear
                {
                    type:      "button",
                    id:        "btnFLEClear",
                    iconClass: "bi bi-trash",
                    className: "icon-only",
                    title:     t('app.fle.tb.clear'),
                    minLevel:  30,   // sotto 30 l'editor è in sola lettura (fleMakeReadOnly)
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.graph) return;
                        if (!window.confirm(t('app.fle.clear.confirm'))) return;
                        st.graph.clear();
                        st.lgCanvas.setDirty(true, true);
                        st.undo?.check();     // Svuota si può annullare
                        st.cmdUI?.update({ status: t('app.fle.clear.done') });
                    },
                },

                { type: "divider" },

                // ── Gruppo 3: Test / esecuzione ─────────────────────────────
                {
                    type:      "button",
                    id:        "btnFLETestPanel",
                    iconClass: "bi bi-play-circle",
                    className: "icon-only",
                    title:     t('app.fle.tb.test'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.graph) return;
                        if (st.flowKind === 'dashboard') {
                            st.cmdUI?.update({ status: t('app.fle.test.not_for_dashboard') });
                            return;
                        }
                        _showTestPanelPicker(st);
                    },
                },

                // Run / Stop loop grafo
                // FIX (2026-09-19): l'icona era sempre statica "bi-play-fill"
                // a costruzione toolbar, indipendentemente da state.isRunning
                // (true di default — il grafo parte già avviato in
                // renderBody). Risultato: al carico l'icona mostrava ▶ come
                // se fosse fermo, e il primo click FERMAVA davvero un grafo
                // già in esecuzione invece di avviarlo — l'icona restava ▶
                // (ora correttamente, ma senza variazione visibile), dando
                // l'impressione che il click non avesse effetto. Letta ora
                // da state.isRunning al momento della costruzione, così
                // riflette lo stato vero fin dal primo render.
                {
                    type:      "button",
                    id:        "btnFLERun",
                    iconClass: (bodyEl?.[STATE_KEY]?.isRunning ?? true) ? "bi bi-pause-fill" : "bi bi-play-fill",
                    className: "icon-only",
                    title:     t('app.fle.tb.run'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.graph) return;
                        if (st.isRunning) {
                            st.graph.stop();
                            st.isRunning = false;
                            st.cmdUI?.update({ status: t('app.fle.run.stopped') });
                        } else {
                            st.graph.start();
                            st.isRunning = true;
                            st.cmdUI?.update({ status: t('app.fle.run.running') });
                        }
                        const btn = (headerEl ?? panel)?.querySelector("#btnFLERun i");
                        if (btn) btn.className = st.isRunning ? "bi bi-pause-fill" : "bi bi-play-fill";
                    },
                },

                { type: "divider" },

                // Help nodo selezionato — pannello laterale, vedi FLE-help-panel.mjs
                {
                    type:      "button",
                    id:        "btnFLEHelp",
                    iconClass: "bi bi-question-circle",
                    className: "icon-only",
                    title:     t('app.fle.tb.help'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        st?.helpPanel?.toggle();
                    },
                },

            ],
        };
    },

    destroy() { /* noop – destroyBodyInstance è già collegato al signal */ },
};
