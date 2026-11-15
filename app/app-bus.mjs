// app/app-bus.mjs
// Bus di comunicazione inter-APP per ReseArch.
//
// Livelli:
//   1. Bus locale (stesso tab)  → EventTarget singleton  → istantaneo, sincrono
//   2. Bus cross-tab            → BroadcastChannel       → asincrono, stesso origin
//
// Pattern d'uso:
//   import { appBusOn, appBusEmit } from "./app-bus.mjs";
//
//   // Ascolta (cleanup automatico su AbortSignal del pannello):
//   appBusOn("selection:change", ({ payload }) => { ... }, signal);
//
//   // Emetti (solo tab corrente):
//   appBusEmit("selection:change", { objId: 42, value: "Roma" });
//
//   // Emetti anche agli altri tab aperti:
//   appBusEmit("selection:change", { objId: 42 }, { broadcast: true });
//
// ============================================================
// TIPI DI EVENTO STANDARD
// ============================================================
// Ogni APP può definire i propri tipi. Qui i tipi condivisi di sistema:
//
//   "selection:change"   payload: { sourceApp, sourcePanelId, objId, field, value }
//                        → una finestra ha selezionato un'entità / un valore
//
//   "filter:apply"       payload: { sourceApp, sourcePanelId, filters: [{field,op,value}] }
//                        → una finestra pubblica un filtro attivo
//
//   "data:refresh"       payload: { sourceApp, targetApp? }
//                        → richiesta di refresh dati (targetApp = null → tutti)
//
//   "panel:focus"        payload: { panelId }
//                        → una finestra chiede di ricevere il focus
//
// Le APP possono aggiungere tipi propri senza modifica di questo file.
//
// MESSAGGI TRATTENUTI (retain, 2026-10-07)
//   appBusEmit(type, payload, { retain: true }) ricorda l'ULTIMO messaggio di quel tipo
//   (solo nel tab corrente). appBusRetained(type) lo restituisce: lo usa il nodo
//   App Bus Receiver per consegnarlo appena si iscrive, così chi apre il pannello dopo
//   l'emissione riceve comunque il dato. appBusOn() NON lo riconsegna: gli ascoltatori
//   interni dei moduli non cambiano comportamento. Chi trattiene cancella il messaggio
//   quando smette di esistere (appBusClearRetained).

export const APP_EVENT_TYPES = {
    SELECTION_CHANGE: "selection:change",
    FILTER_APPLY:     "filter:apply",
    DATA_REFRESH:     "data:refresh",
    PANEL_FOCUS:      "panel:focus",
};

// ============================================================
// SINGLETON BUS LOCALE
// ============================================================

const _bus = new EventTarget();

// Ultimo messaggio trattenuto per tipo (vedi "MESSAGGI TRATTENUTI" in testa)
const _retained = new Map();

// ============================================================
// BROADCAST CHANNEL (cross-tab)
// ============================================================

const CHANNEL_NAME = "research-app-bus";
let   _channel     = null;

function getChannel() {
    if (_channel) return _channel;
    if (typeof BroadcastChannel === "undefined") return null;

    _channel = new BroadcastChannel(CHANNEL_NAME);

    // Messaggi in arrivo dagli altri tab → ri-emetti sul bus locale
    // (con flag broadcast=false per non ri-trasmettere all'infinito)
    _channel.addEventListener("message", ev => {
        const msg = ev.data;
        if (!msg?.type) return;
        _dispatchLocal(msg.type, msg, false);
    });

    return _channel;
}

// ============================================================
// API PUBBLICA
// ============================================================

/**
 * Ascolta un tipo di evento sul bus locale.
 * La sottoscrizione viene rimossa automaticamente quando il signal viene abortito.
 *
 * @param {string}   type     - tipo di evento (es. "selection:change")
 * @param {function} handler  - callback({ type, payload, sourceApp, sourcePanelId, fromBroadcast })
 * @param {AbortSignal} [signal] - signal del pannello/istanza; se omesso, il listener è permanente
 * @returns {function} unsubscribe manuale
 */
export function appBusOn(type, handler, signal) {
    const listener = ev => handler(ev.detail);
    _bus.addEventListener(type, listener, { signal });
    // Ritorna unsubscribe manuale (utile quando signal non è disponibile)
    return () => _bus.removeEventListener(type, listener);
}

/**
 * Emette un evento sul bus locale e, opzionalmente, su BroadcastChannel.
 *
 * @param {string}  type      - tipo di evento
 * @param {any}     payload   - dati associati all'evento
 * @param {object}  [opts]
 * @param {boolean} [opts.broadcast=false]    - propaga anche agli altri tab
 * @param {string}  [opts.sourceApp]          - codice APP mittente (es. "ECH", "MYS")
 * @param {string}  [opts.sourcePanelId]      - id del pannello mittente
 * @param {boolean} [opts.retain=false]       - ricorda il messaggio come ultimo del suo tipo
 */
export function appBusEmit(type, payload, { broadcast = false, sourceApp = null, sourcePanelId = null, retain = false } = {}) {
    const msg = {
        type,
        payload,
        sourceApp,
        sourcePanelId,
        timestamp:     Date.now(),
        fromBroadcast: false,
    };

    if (retain) _retained.set(type, { ...msg, local: true });
    _dispatchLocal(type, msg, true);

    if (broadcast) {
        try {
            getChannel()?.postMessage({ ...msg, fromBroadcast: true });
        } catch (err) {
            console.warn("[app-bus] BroadcastChannel.postMessage:", err);
        }
    }
}

/**
 * Ultimo messaggio trattenuto di un tipo (stessa forma ricevuta dagli handler di appBusOn),
 * oppure null.
 * @param {string} type
 */
export function appBusRetained(type) {
    return _retained.get(type) ?? null;
}

/**
 * Cancella il messaggio trattenuto di un tipo.
 * @param {string}   type
 * @param {function} [match] - cancella solo se match(msg) è true (es. "è ancora il mio")
 */
export function appBusClearRetained(type, match) {
    const m = _retained.get(type);
    if (m && (!match || match(m))) _retained.delete(type);
}

// ============================================================
// INTERNO
// ============================================================

function _dispatchLocal(type, detail, local) {
    try {
        _bus.dispatchEvent(new CustomEvent(type, { detail: { ...detail, local } }));
    } catch (err) {
        console.error("[app-bus] dispatchEvent:", err);
    }
}
