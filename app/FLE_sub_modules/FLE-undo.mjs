// app/FLE_sub_modules/FLE-undo.mjs
// Annulla / Ripeti nell'editor dei flow (2026-10-17).
//
// LiteGraph 0.7.18 non ha l'annulla: offre solo graph.beforeChange()/afterChange(), chiamati dal
// canvas per molte modifiche ma non per tutte (valori dei widget, porte rifatte da codice come
// "Update ports", Svuota grafo) e non sempre a coppie. Qui il criterio è più semplice e completo:
// dopo ogni gesto dell'utente (rilascio del mouse, tasto, afterChange) si confronta il grafo
// serializzato con l'ultima copia; se è cambiato, la copia precedente va nella pila "annulla".
// Annulla/Ripeti ricaricano una copia con graph.configure(): i nodi vengono ricreati (onRemoved,
// poi onStart se il grafo gira), le uscite tornano vuote fino alla prossima esecuzione.
// Le modifiche arrivate in ritardo (es. porte rifatte dopo una richiesta al server) finiscono nel
// passo successivo.

const MAX_STEPS = 50;
const SETTLE_MS = 250;     // attesa dopo un gesto: un trascinamento o un clic valgono un passo solo

/** Grafo serializzato senza la vista (extra.view cambia a ogni salvataggio, non è una modifica). */
function snapshot(graph) {
    const s = graph.serialize();
    if (s.extra?.view) { s.extra = { ...s.extra }; delete s.extra.view; }
    return JSON.stringify(s);
}

/**
 * Collega annulla/ripeti a un editor.
 * @param {object} opts
 * @param {object}       opts.graph
 * @param {object}       opts.lgCanvas
 * @param {HTMLElement}  opts.bodyEl     tasti Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z quando il fuoco è qui
 * @param {AbortSignal}  opts.signal
 * @param {() => boolean} [opts.isRunning]  dopo il ripristino il grafo riparte se stava girando
 * @param {(u:{canUndo:boolean,canRedo:boolean}) => void} [opts.onChange]  per i pulsanti
 * @param {(msg:'undo'|'redo'|'none_undo'|'none_redo', left:number) => void} [opts.onApplied]
 */
export function fleAttachUndo({ graph, lgCanvas, bodyEl, signal, isRunning = () => true, onChange = null, onApplied = null }) {
    const undo = [], redo = [];
    let current = snapshot(graph);
    let restoring = false;
    let timer = null;

    const notify = () => { try { onChange?.({ canUndo: undo.length > 0, canRedo: redo.length > 0 }); } catch { /* noop */ } };

    /** Registra un passo se il grafo è cambiato dall'ultima copia. */
    function check() {
        clearTimeout(timer); timer = null;
        if (restoring || signal?.aborted) return;
        let now;
        try { now = snapshot(graph); } catch (e) { console.warn('[FLE undo] serialize:', e); return; }
        if (now === current) return;
        undo.push(current);
        if (undo.length > MAX_STEPS) undo.shift();
        redo.length = 0;
        current = now;
        notify();
    }
    const schedule = () => { if (restoring) return; clearTimeout(timer); timer = setTimeout(check, SETTLE_MS); };

    function restore(snap) {
        restoring = true;
        clearTimeout(timer); timer = null;
        const ds = lgCanvas.ds, scale = ds?.scale, offset = ds?.offset ? [...ds.offset] : null;
        try {
            lgCanvas.deselectAllNodes?.();
            graph.configure(JSON.parse(snap));      // clear(): stop + onRemoved dei nodi vecchi
            if (isRunning()) graph.start();
        } catch (e) {
            console.error('[FLE undo] restore:', e);
        } finally {
            if (ds && offset) { ds.scale = scale; ds.offset[0] = offset[0]; ds.offset[1] = offset[1]; }
            lgCanvas.setDirty(true, true);
            // copia riletta dal grafo ricreato: i costruttori dei nodi possono aggiungere campi
            try { current = snapshot(graph); } catch { current = snap; }
            restoring = false;
        }
    }

    function doUndo() {
        check();                                   // un gesto non ancora registrato conta come passo
        if (!undo.length) { onApplied?.('none_undo', 0); return false; }
        redo.push(current);
        restore(undo.pop());
        notify();
        onApplied?.('undo', undo.length);
        return true;
    }
    function doRedo() {
        check();
        if (!redo.length) { onApplied?.('none_redo', 0); return false; }
        undo.push(current);
        restore(redo.pop());
        notify();
        onApplied?.('redo', redo.length);
        return true;
    }
    /** Dopo un caricamento o un cambio di flow: la storia riparte da qui. */
    function reset() {
        clearTimeout(timer); timer = null;
        undo.length = 0; redo.length = 0;
        try { current = snapshot(graph); } catch { /* resta la copia di prima */ }
        notify();
    }

    // gesti dell'utente: nel documento perché menu a tendina dei widget e finestre di LiteGraph
    // stanno fuori dal pannello (il confronto costa poco e trova "nessuna modifica" negli altri casi)
    const opts = { capture: true, signal };
    document.addEventListener('pointerup', schedule, opts);
    document.addEventListener('keyup', schedule, opts);
    document.addEventListener('change', schedule, opts);

    // hook di LiteGraph (incolla, cancella, collega, fine trascinamento…)
    const prevAfter = graph.onAfterChange;
    graph.onAfterChange = function (...args) {
        try { prevAfter?.apply(this, args); } finally { schedule(); }
    };
    signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        if (graph.onAfterChange !== prevAfter) graph.onAfterChange = prevAfter;
    }, { once: true });

    // tasti, solo con il fuoco in questo editor e non mentre si scrive in un campo
    bodyEl.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const tgt = e.target;
        if (tgt?.isContentEditable || /^(input|textarea|select)$/i.test(tgt?.localName || '')) return;
        const k = e.key?.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); doUndo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); doRedo(); }
    }, { capture: true, signal });

    notify();
    return { undo: doUndo, redo: doRedo, check, reset, get canUndo() { return undo.length > 0; }, get canRedo() { return redo.length > 0; } };
}
