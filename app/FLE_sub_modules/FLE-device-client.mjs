// app/FLE_sub_modules/FLE-device-client.mjs
// Dispositivi (ESP8266, ESP32, Arduino) nei flow (2026-10-12) — _doc/arch-iot-dispositivi.md
//
// Canali: SERIALE (Web Serial, passo 1) e BLUETOOTH LE (Web Bluetooth con il servizio seriale
// Nordic UART, passo 4, solo ESP32), solo in Chrome/Edge (Web Bluetooth anche Android); MQTT
// (broker su WebSocket sicuro, passo 5a, ogni browser): dispositivi remoti in Wi-Fi.
//
// Due livelli:
//   client  — una connessione (porta seriale o dispositivo BLE), CONDIVISA nella pagina (si apre
//             una sola volta: il flow nel runner e lo stesso flow nell'editor usano lo stesso
//             client), con conteggio dei riferimenti; legge e scrive il protocollo a righe (§5)
//   handle  — ciò che i nodi usano (fleUseDevice): uno per nodo Context/Device, stabile per tutta
//             la vita del nodo; gli ascolti restano agganciati anche quando il client cambia
//             (porta scelta di nuovo, riconnessione)
//
// Protocollo (§5): una riga per messaggio, "topic=valore\n". Righe che iniziano con "#" = log del
// firmware; righe non conformi (es. i messaggi di avvio dell'ESP8266 a 74880 baud) ignorate.
// Messaggi di sistema: $hello, $who, $ping/$pong, $err, $hb (battito del browser, ogni secondo:
// il firmware capisce che il flow è ancora collegato — watchdog degli attuatori, passo 3).
// Su MQTT le stesse righe viaggiano come messaggi (§5.4): "topic=valore" ↔ <base>/in|out/<topic>.

import { fleLoadLibrary } from "./FLE-context-nodes.mjs";

const TOPIC_RE      = /^[A-Za-z0-9_\-/]{1,64}$/;
const LINE_RE       = /^(\$?[A-Za-z0-9_\-/]{1,64})=(.*)$/;
const NUMBER_RE     = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const MAX_LINE      = 1024;      // oltre, la riga si scarta (dati senza a capo)
const HELLO_WAIT_MS = 1500;      // dopo l'apertura: se il dispositivo non si presenta, gli si chiede ($who)
const PING_TIMEOUT  = 2000;
const HEARTBEAT_MS  = 1000;      // $hb=1 verso il dispositivo finché la connessione è aperta

export const DEVICE_CHANNELS = ['serial', 'ble', 'mqtt'];
export const SERIAL_BAUDS    = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

export function serialSupported() {
    return typeof navigator !== 'undefined' && !!navigator.serial;
}

// ── Valori ──────────────────────────────────────────────────────────────────

/** Testo ricevuto → valore (§5.1): numero, array di numeri, boolean, JSON, altrimenti testo. */
export function parseValue(raw) {
    const s = String(raw ?? '').trim();
    if (s === '') return '';
    if (/^(on|true)$/i.test(s))   return true;
    if (/^(off|false)$/i.test(s)) return false;
    if (NUMBER_RE.test(s)) return Number(s);
    if (s[0] === '{' || s[0] === '[') {
        try { return JSON.parse(s); } catch { return s; }
    }
    if (s.includes(',')) {
        const parts = s.split(',').map(p => p.trim());
        if (parts.every(p => NUMBER_RE.test(p))) return parts.map(Number);
    }
    return s;
}

/** Valore da inviare → testo di una riga (§5.1). */
export function formatValue(v) {
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) throw new Error('the value is not a finite number');
        return String(v);
    }
    if (Array.isArray(v) && v.every(x => typeof x === 'number' && Number.isFinite(x))) return v.join(',');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v).replace(/[\r\n]+/g, ' ');
}

/** Il topic corrisponde al filtro? "+" = un livello, "#" = tutto il resto (come MQTT). */
export function topicMatches(filter, topic) {
    if (filter === topic) return true;
    if (topic.startsWith('$') !== filter.startsWith('$')) return false;   // i messaggi di sistema solo per nome
    const f = filter.split('/'), t = topic.split('/');
    for (let i = 0; i < f.length; i++) {
        if (f[i] === '#') return true;
        if (i >= t.length) return false;
        if (f[i] !== '+' && f[i] !== t[i]) return false;
    }
    return f.length === t.length;
}

export function validTopic(t) { return TOPIC_RE.test(String(t ?? '')); }

// ── Client: protocollo a righe sopra un trasporto ───────────────────────────
//
// Il client (stato, $hello/$who, $ping, $hb, ascolti, ultimi valori, scritture in fila,
// riferimenti) è lo stesso per tutti i canali; cambia solo il TRASPORTO:
//   { open(feed): Promise   — apre; feed(Uint8Array) a ogni dato ricevuto
//     close(): Promise      — chiude (anche se già persa)
//     write(bytes): Promise — scrive una riga già codificata
//     dispose()             — toglie gli ascolti globali (rilascio definitivo) }
// Il trasporto chiama client._lost() quando la connessione cade da sola. I trasporti a messaggi
// (MQTT) ricevono anche line(text): una riga già intera, senza passare dai byte; e chiamano
// client._presence(online) quando il broker dice che il dispositivo c'è o non c'è ($status).

const _clients = new Map();   // chiave del trasporto (SerialPort, BluetoothDevice) → client
const _closing = new Map();   // chiave → Promise della chiusura in corso (riaprire solo dopo)
// prefisso dei numeri di $ping: su MQTT i $pong arrivano a tutti i browser collegati al dispositivo
const PING_TAG = Math.random().toString(36).slice(2, 6);

function createLineClient(channel, key, makeTransport, extra = {}) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const listeners = new Set();     // ({topic, value, raw, ts}) per ogni messaggio valido
    const stateListeners = new Set();
    const lastValues = new Map();    // topic → {value, raw, ts}
    let state = 'idle';              // idle | connecting | open | lost | closed
    let info = null;                 // dal messaggio $hello
    let lastSeen = 0;
    let buf = '';
    let opening = null;
    let writeChain = Promise.resolve();
    let wanted = false;              // la connessione deve restare aperta (riapertura automatica)
    let heartbeat = null, helloTimer = null, retryTimer = null, retryDelay = 1000;
    let pingSeq = 0;
    let transportOpen = false;       // il trasporto è aperto (su MQTT: broker raggiunto)
    let offline = false;             // MQTT: broker raggiunto ma dispositivo assente ($status=offline)
    const pings = new Map();         // n → {resolve, t0, timer}

    const setState = (s, detail) => {
        if (state === s) return;
        state = s;
        for (const cb of stateListeners) { try { cb(s, detail); } catch (e) { console.error('[Device] state listener:', e); } }
    };

    const handleLine = (line) => {
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line) return;
        if (line[0] === '#') { console.debug('[Device]', line.slice(1).trim()); return; }
        const m = LINE_RE.exec(line);
        if (!m) return;                       // rumore (avvio dell'ESP, baud sbagliati)
        const topic = m[1], raw = m[2];
        const ts = Date.now();
        lastSeen = ts;
        if (topic === '$hello') {
            const v = parseValue(raw);
            info = (v && typeof v === 'object' && !Array.isArray(v)) ? v : { id: String(raw).trim() };
            for (const cb of stateListeners) { try { cb(state, 'hello'); } catch (e) { console.error(e); } }
            return;
        }
        if (topic === '$pong') {
            const p = pings.get(raw.trim());
            if (p) { clearTimeout(p.timer); pings.delete(raw.trim()); p.resolve(Date.now() - p.t0); }
            return;
        }
        const value = parseValue(raw);
        if (!topic.startsWith('$')) lastValues.set(topic, { value, raw, ts });
        for (const cb of listeners) { try { cb({ topic, value, raw, ts }); } catch (e) { console.error('[Device] listener:', e); } }
    };
    const feed = (bytes) => {
        buf += decoder.decode(bytes, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
            handleLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
        }
        if (buf.length > MAX_LINE) buf = '';
    };

    const stopTimers = () => {
        clearInterval(heartbeat); heartbeat = null;
        clearTimeout(helloTimer); helloTimer = null;
    };
    /** Connessione utilizzabile: battito e, se il dispositivo non si presenta, $who. */
    const startSession = () => {
        stopTimers();
        heartbeat = setInterval(() => { if (state === 'open') sendRaw('$hb', '1').catch(() => {}); }, HEARTBEAT_MS);
        helloTimer = setTimeout(() => { if (state === 'open' && !info) sendRaw('$who', '1').catch(() => {}); }, HELLO_WAIT_MS);
    };

    const sendRaw = (topic, text) => {
        if (state !== 'open') return Promise.reject(new Error('device not connected'));
        const line = encoder.encode(`${topic}=${text}\n`);
        // in fila: una scrittura alla volta (BLE rifiuta operazioni sovrapposte); un errore non blocca le successive
        const p = writeChain.catch(() => {}).then(() => {
            if (state !== 'open') throw new Error('device not connected');
            return transport.write(line);
        });
        writeChain = p;
        return p.catch(err => { throw new Error(`${channel} write: ` + (err?.message || err)); });
    };

    const scheduleRetry = () => {
        if (!extra.retry || !wanted || retryTimer) return;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            if (wanted && state === 'lost') open().catch(() => {});
        }, retryDelay);
        retryDelay = Math.min(30000, retryDelay * 2);
    };

    const open = () => {
        wanted = true;
        if (state === 'open') return Promise.resolve();
        if (opening) return opening;
        setState('connecting');
        opening = (async () => {
            try {
                await _closing.get(key);
                buf = '';
                info = null;
                offline = false;
                await transport.open(feed, handleLine);
            } catch (err) {
                setState('lost', err);
                scheduleRetry();
                throw err;
            }
            transportOpen = true;
            retryDelay = 1000;
            // MQTT: lo stato "offline" conservato dal broker può essere arrivato durante l'apertura
            if (offline) { setState('lost', 'offline'); return; }
            setState('open');
            startSession();
        })().finally(() => { opening = null; });
        return opening;
    };

    const client = {
        channel,
        _refs: 1,
        ...extra.props,
        get state() { return state; },
        get info() { return info; },
        get lastSeen() { return lastSeen; },
        get portInfo() { return extra.portInfo?.() ?? {}; },
        open,
        /** Chiamata dal trasporto quando la connessione cade da sola. */
        _lost() {
            if (state === 'closed') return;
            transportOpen = false;
            stopTimers();
            transport.close().catch(() => {}).finally(() => {
                setState(wanted ? 'lost' : 'closed');
                scheduleRetry();
            });
        },
        /** Chiamata dal trasporto quando il dispositivo ricompare (cavo riattaccato). */
        _reappeared() { if (wanted && state !== 'open') open().catch(err => console.warn('[Device] reopen:', err?.message || err)); },
        /** MQTT: il dispositivo è collegato al broker (true) o no (false, testamento $status=offline). */
        _presence(online) {
            if (state === 'closed') return;
            offline = !online;
            if (!transportOpen) return;              // in apertura: ci pensa open()
            if (!online && state === 'open') { stopTimers(); setState('lost', 'offline'); }
            else if (online && state === 'lost') { setState('open'); startSession(); }
        },
        send(topic, value) {
            if (!validTopic(topic)) return Promise.reject(new Error(`invalid topic "${topic}" (letters, digits, _ - /, at most 64)`));
            return sendRaw(topic, formatValue(value));
        },
        ping() {
            const n = PING_TAG + (++pingSeq);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => { pings.delete(n); reject(new Error('no reply to $ping (firmware without $pong?)')); }, PING_TIMEOUT);
                pings.set(n, { resolve, t0: Date.now(), timer });
                sendRaw('$ping', n).catch(err => { clearTimeout(timer); pings.delete(n); reject(err); });
            });
        },
        last(topic) { return lastValues.get(topic) ?? null; },
        onMessage(cb) { listeners.add(cb); return () => listeners.delete(cb); },
        onState(cb) { stateListeners.add(cb); return () => stateListeners.delete(cb); },
        /** Toglie un riferimento; all'ultimo chiude la connessione. */
        async release() {
            if (--client._refs > 0) return;
            wanted = false;
            transportOpen = false;
            clearTimeout(retryTimer); retryTimer = null;
            stopTimers();
            _clients.delete(key);
            transport.dispose?.();
            for (const p of pings.values()) clearTimeout(p.timer);
            pings.clear();
            const closed = transport.close().catch(() => {});
            _closing.set(key, closed);
            await closed;
            if (_closing.get(key) === closed) _closing.delete(key);
            setState('closed');
            listeners.clear();
            stateListeners.clear();
        },
    };
    const transport = makeTransport(client);
    return client;
}

// ── Canale seriale (Web Serial) ─────────────────────────────────────────────

/** Porta già autorizzata in questa pagina che corrisponde a vendor/product (0 = qualunque), o null. */
export async function findAuthorizedPort(usbVendorId, usbProductId) {
    if (!serialSupported()) return null;
    const ports = await navigator.serial.getPorts();
    const fits = (p) => {
        const i = p.getInfo?.() ?? {};
        return (!usbVendorId || i.usbVendorId === usbVendorId) && (!usbProductId || i.usbProductId === usbProductId);
    };
    // quando non si sa quale porta, solo se è l'unica (altrimenti si sceglie col pulsante)
    const found = ports.filter(fits);
    if (!usbVendorId && !usbProductId) return found.length === 1 ? found[0] : null;
    return found[0] ?? null;
}

/** Chiede all'utente di scegliere una porta. Va chiamata durante un clic (regola del browser). */
export async function requestSerialPort() {
    return navigator.serial.requestPort();
}

/**
 * Client della porta, condiviso nella pagina: ogni chiamata aggiunge un riferimento, da
 * restituire con client.release(). La porta si apre al primo open() e si chiude quando l'ultimo
 * la rilascia.
 */
export function acquireSerialClient(port, baud) {
    let client = _clients.get(port);
    if (client) {
        if (client.baud !== baud) throw new Error(`the port is already open at ${client.baud} baud in this page`);
        client._refs++;
        return client;
    }
    client = createLineClient('serial', port, (c) => serialTransport(c, port, baud), {
        props: { baud, port },
        portInfo: () => port.getInfo?.() ?? {},
    });
    _clients.set(port, client);
    return client;
}

function serialTransport(client, port, baud) {
    let reader = null, writer = null, readLoop = null, closing = false;
    const close = async () => {
        closing = true;
        try { await reader?.cancel(); } catch { /* già chiuso */ }
        try { await readLoop; } catch { /* finito */ }
        readLoop = null;
        try { writer?.releaseLock(); } catch { /* già rilasciato */ }
        writer = null;
        try { await port.close(); } catch { /* già chiusa o persa */ }
    };
    const onDisconnect = (e) => { if (e.target === port || e.port === port) client._lost(); };
    const onConnect    = (e) => { if (e.target === port || e.port === port) client._reappeared(); };
    navigator.serial.addEventListener('disconnect', onDisconnect);
    navigator.serial.addEventListener('connect', onConnect);
    return {
        async open(feed) {
            try {
                await port.open({ baudRate: baud, bufferSize: 4096 });
            } catch (err) {
                // "already open": aperta da un'altra scheda o da un altro programma (es. Monitor seriale di Arduino IDE)
                throw new Error(/already open|busy|access/i.test(err?.message || '')
                    ? 'the port is busy: close the Arduino IDE serial monitor or other tabs that use it'
                    : 'cannot open the serial port: ' + (err?.message || err));
            }
            // ESP8266/ESP32 con circuito di reset automatico: DTR e RTS a riposo, la scheda resta in
            // esecuzione (aprire la porta può comunque riavviarla una volta: il firmware si ripresenta con $hello)
            try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch { /* non supportato */ }
            writer = port.writable.getWriter();
            closing = false;
            readLoop = (async () => {
                // errori non fatali (rumore sulla linea: BreakError, FramingError, ParityError,
                // BufferOverrunError) chiudono solo il lettore: se ne prende un altro
                while (port.readable && !closing) {
                    reader = port.readable.getReader();
                    try {
                        for (;;) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            feed(value);
                        }
                    } catch (err) {
                        if (!closing) console.warn('[Device] serial read:', err?.message || err);
                    } finally {
                        try { reader.releaseLock(); } catch { /* già rilasciato */ }
                        reader = null;
                    }
                }
                // porta sparita (cavo staccato, scheda riavviata con USB nativa): connessione persa
                if (!closing) setTimeout(() => client._lost(), 0);
            })();
        },
        close,
        write(bytes) {
            if (!writer) return Promise.reject(new Error('device not connected'));
            return writer.write(bytes);
        },
        dispose() {
            navigator.serial.removeEventListener('disconnect', onDisconnect);
            navigator.serial.removeEventListener('connect', onConnect);
        },
    };
}

// ── Canale Bluetooth LE (Web Bluetooth, Nordic UART Service) ────────────────

const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';   // il browser scrive (comandi)
const NUS_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';   // il dispositivo notifica (misure)
const BLE_CHUNK   = 20;     // byte per scrittura: va bene con qualunque MTU

export function bleSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

/**
 * Chiede all'utente di scegliere un dispositivo BLE con il servizio seriale NUS. Va chiamata
 * durante un clic. namePrefix (es. "RA-") limita l'elenco ai dispositivi con quel nome.
 */
export async function requestBleDevice(namePrefix) {
    const filters = namePrefix ? [{ namePrefix }] : [{ services: [NUS_SERVICE] }];
    return navigator.bluetooth.requestDevice({ filters, optionalServices: [NUS_SERVICE] });
}

/**
 * Dispositivo già autorizzato (getDevices, dove il browser lo offre) con quell'id, o null.
 * Senza id: solo se ce n'è uno solo con il prefisso del nome.
 */
export async function findAuthorizedBleDevice(id, namePrefix) {
    if (!bleSupported() || typeof navigator.bluetooth.getDevices !== 'function') return null;
    let devices = [];
    try { devices = await navigator.bluetooth.getDevices(); } catch { return null; }
    if (id) return devices.find(d => d.id === id) ?? null;
    const found = devices.filter(d => !namePrefix || (d.name || '').startsWith(namePrefix));
    return found.length === 1 ? found[0] : null;
}

/** Client del dispositivo BLE, condiviso nella pagina (come acquireSerialClient). */
export function acquireBleClient(device) {
    let client = _clients.get(device);
    if (client) { client._refs++; return client; }
    client = createLineClient('ble', device, (c) => bleTransport(c, device), {
        props: { device },
        portInfo: () => ({ name: device.name || '', id: device.id }),
        retry: true,          // BLE: riconnessione con attesa crescente (1, 2, 4… 30 s)
    });
    _clients.set(device, client);
    return client;
}

function bleTransport(client, device) {
    let rx = null, tx = null, closing = false, feedFn = null;
    const onValue = (e) => {
        const dv = e.target.value;
        feedFn?.(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
    };
    const onGone = () => { if (!closing) client._lost(); };
    device.addEventListener('gattserverdisconnected', onGone);
    return {
        async open(feed) {
            closing = false;
            feedFn = feed;
            try {
                const server = await device.gatt.connect();
                const svc = await server.getPrimaryService(NUS_SERVICE);
                rx = await svc.getCharacteristic(NUS_RX);
                tx = await svc.getCharacteristic(NUS_TX);
                tx.addEventListener('characteristicvaluechanged', onValue);
                await tx.startNotifications();
            } catch (err) {
                try { device.gatt.disconnect(); } catch { /* non collegato */ }
                throw new Error(/NotFound|service/i.test(`${err?.name} ${err?.message}`)
                    ? 'the device has no Nordic UART service: is it running a ReseArchBLE sketch?'
                    : 'cannot connect over Bluetooth (device off, out of range, or connected to another tab): ' + (err?.message || err));
            }
        },
        async close() {
            closing = true;
            try { tx?.removeEventListener('characteristicvaluechanged', onValue); } catch { /* noop */ }
            try { if (device.gatt.connected) await tx?.stopNotifications(); } catch { /* già scollegato */ }
            try { device.gatt.disconnect(); } catch { /* già scollegato */ }
            rx = tx = null;
        },
        async write(bytes) {
            if (!rx) throw new Error('device not connected');
            const noResp = rx.properties?.writeWithoutResponse;
            for (let i = 0; i < bytes.length; i += BLE_CHUNK) {
                const part = bytes.subarray(i, i + BLE_CHUNK);
                if (noResp && rx.writeValueWithoutResponse) await rx.writeValueWithoutResponse(part);
                else if (rx.writeValueWithResponse) await rx.writeValueWithResponse(part);
                else await rx.writeValue(part);
            }
        },
        dispose() { device.removeEventListener('gattserverdisconnected', onGone); },
    };
}

// ── Canale MQTT (broker su WebSocket sicuro, passo 5a) ──────────────────────
//
// Il flow conosce solo l'ID di un broker configurato sul server (cfg/cfg_iot.php): indirizzo,
// credenziali del browser e radice dei topic arrivano da api/iot_tool.php, mai dal flow (§9).
// Una connessione per broker e pagina, condivisa da tutti i dispositivi di quel broker.
// Topic (§5.4), con base = <radice>/<dispositivo>:
//   <base>/in/<topic>    dispositivo → flow      riga "topic=valore"
//   <base>/out/<topic>   flow → dispositivo      (comandi, $hb, $who, $ping, $rate)
//   <base>/$hello        presentazione (retained)
//   <base>/$status       online / offline (retained, testamento del dispositivo)

const IOT_API      = 'api/iot_tool.php';
const MQTT_LIB     = 'lib/mqtt/mqtt.min.js';     // mqtt.js 5.15.2; NON nel catalogo lib/libraries.json: un flow non deve poterla usare verso broker qualsiasi (§9)
const MQTT_WAIT_MS = 12000;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function absUrl(url) {
    try { return new URL(url, document.baseURI).href; } catch { return url; }
}
async function iotApi(params) {
    const r = await fetch(absUrl(IOT_API + '?' + new URLSearchParams(params)), { credentials: 'same-origin', cache: 'no-store' });
    let j = null;
    try { j = await r.json(); } catch { /* risposta non JSON */ }
    if (!r.ok || !j?.success) throw new Error(j?.error || `${IOT_API}: HTTP ${r.status}`);
    return j.data;
}

let _brokerList = null;
/** Broker configurati sul server: Promise di [{id, title, prefix}] (letta una volta per pagina). */
export function mqttBrokers() {
    if (!_brokerList) {
        _brokerList = iotApi({ action: 'brokers' })
            .then(list => Array.isArray(list) ? list : [])
            .catch(err => { _brokerList = null; throw err; });
    }
    return _brokerList;
}

export function validDeviceId(id) { return DEVICE_ID_RE.test(String(id ?? '')); }

const _brokers = new Map();   // id broker → Promise della connessione condivisa

async function connectBroker(id) {
    const [cfg, mqtt] = await Promise.all([
        iotApi({ action: 'connect', broker: id }),
        fleLoadLibrary(MQTT_LIB, 'script', 'mqtt'),
    ]);
    const mc = mqtt.connect(cfg.url, {
        username: cfg.username || undefined,
        password: cfg.password || undefined,
        clientId: 'ra-web-' + Math.random().toString(36).slice(2, 10),
        clean: true,
        keepalive: 30,
        connectTimeout: MQTT_WAIT_MS - 2000,
        reconnectPeriod: 0,      // la riconnessione la fa il client di ogni dispositivo (attesa crescente)
    });
    const conn = {
        id, title: cfg.title || id, prefix: cfg.prefix, mc, refs: 0, dead: false,
        handlers: new Set(),     // (topic, payload) per ogni messaggio
        closers: new Set(),      // chiamate quando la connessione cade
    };
    mc.on('message', (topic, payload) => {
        for (const h of conn.handlers) { try { h(topic, payload); } catch (e) { console.error('[Device] mqtt:', e); } }
    });
    let lastError = null;
    mc.on('error', (err) => { lastError = err; console.warn('[Device] mqtt', id + ':', err?.message || err); });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { mc.end(true); reject(new Error(`broker "${id}" does not answer (address, port or network?)`)); }, MQTT_WAIT_MS);
        mc.once('connect', () => { clearTimeout(timer); resolve(); });
        mc.once('close', () => {
            clearTimeout(timer);
            const why = lastError?.message || 'connection refused or blocked (wss address, certificate, firewall?)';
            reject(new Error(`broker "${id}": ` + (/not authori[sz]ed|bad user/i.test(why) ? 'wrong username or password in cfg/cfg_iot.php' : why)));
        });
    });
    mc.on('close', () => {
        if (conn.dead) return;
        conn.dead = true;
        if (_brokers.get(id)?._conn === conn) _brokers.delete(id);
        mc.end(true);
        for (const cb of [...conn.closers]) { try { cb(); } catch (e) { console.error(e); } }
    });
    return conn;
}

/** Connessione al broker, condivisa nella pagina: da restituire con releaseBroker(). */
async function acquireBroker(id) {
    let entry = _brokers.get(id);
    if (!entry) {
        entry = connectBroker(id);
        entry.then(c => { entry._conn = c; }, () => { if (_brokers.get(id) === entry) _brokers.delete(id); });
        _brokers.set(id, entry);
    }
    const conn = await entry;
    if (conn.dead) { if (_brokers.get(id) === entry) _brokers.delete(id); return acquireBroker(id); }
    conn.refs++;
    return conn;
}
function releaseBroker(conn) {
    if (--conn.refs > 0 || conn.dead) return;
    conn.dead = true;
    if (_brokers.get(conn.id)?._conn === conn) _brokers.delete(conn.id);
    conn.mc.end();
}

/** Client del dispositivo `device` sul broker `brokerId`, condiviso nella pagina (come acquireSerialClient). */
export function acquireMqttClient(brokerId, device) {
    if (!validDeviceId(device)) throw new Error(`invalid device id "${device}" (letters, digits, _ -, at most 32)`);
    const key = `mqtt|${brokerId}|${device}`;
    let client = _clients.get(key);
    if (client) { client._refs++; return client; }
    let title = brokerId;
    client = createLineClient('mqtt', key, (c) => mqttTransport(c, brokerId, device, t => { title = t; }), {
        props: { broker: brokerId, device },
        portInfo: () => ({ broker: brokerId, title, device }),
        retry: true,          // broker irraggiungibile o caduto: attesa crescente (1, 2, 4… 30 s)
    });
    _clients.set(key, client);
    return client;
}

function mqttTransport(client, brokerId, device, setTitle) {
    const decoder = new TextDecoder();
    let conn = null, base = '', handler = null, closer = null;
    const detach = () => {
        if (!conn) return null;
        const c = conn;
        conn = null;
        c.handlers.delete(handler);
        c.closers.delete(closer);
        return c;
    };
    return {
        async open(feed, line) {
            const c = await acquireBroker(brokerId);
            conn = c;
            setTitle(c.title);
            base = `${c.prefix}/${device}`;
            const inPfx = base + '/in/';
            handler = (topic, payload) => {
                if (!topic.startsWith(base + '/')) return;
                const text = decoder.decode(payload).replace(/[\r\n]+/g, ' ');
                if (topic === base + '/$status') { if (text.trim()) client._presence(text.trim() !== 'offline'); return; }
                if (topic === base + '/$hello') { if (text.trim()) line('$hello=' + text); return; }
                if (topic.startsWith(inPfx)) line(topic.slice(inPfx.length) + '=' + text);
            };
            closer = () => { detach(); client._lost(); };
            c.handlers.add(handler);
            c.closers.add(closer);
            let granted;
            try {
                granted = await c.mc.subscribeAsync([inPfx + '#', base + '/$hello', base + '/$status'], { qos: 0 });
            } catch (err) {
                detach(); releaseBroker(c);
                throw new Error('mqtt subscribe: ' + (err?.message || err));
            }
            if (granted?.some(g => g.qos === 128)) {
                detach(); releaseBroker(c);
                throw new Error(`the broker refused the topics ${base}/… (permissions of the account in cfg/cfg_iot.php)`);
            }
        },
        async close() {
            const c = detach();
            if (!c) return;
            if (!c.dead) { try { await c.mc.unsubscribeAsync([base + '/in/#', base + '/$hello', base + '/$status']); } catch { /* già chiusa */ } }
            releaseBroker(c);
        },
        async write(bytes) {
            if (!conn || conn.dead) throw new Error('broker not connected');
            const text = decoder.decode(bytes).replace(/\n$/, '');
            const eq = text.indexOf('=');
            const topic = text.slice(0, eq);
            // comandi con conferma di consegna al broker (QoS 1); messaggi di sistema "al più una volta"
            await conn.mc.publishAsync(`${base}/out/${topic}`, text.slice(eq + 1), { qos: topic.startsWith('$') ? 0 : 1, retain: false });
        },
    };
}

// ── Handle (ciò che usano i nodi) ───────────────────────────────────────────

/**
 * Riferimento stabile a un dispositivo, uno per nodo Context/Device. attach(client) lo collega a
 * una connessione, detach() lo scollega; gli ascolti dei nodi restano validi nel frattempo.
 */
export function createDeviceHandle(name) {
    let client = null;
    let offMsg = null, offState = null;
    const listeners = new Set();        // {filter, cb}
    const stateListeners = new Set();

    const emitState = (s, detail) => {
        for (const cb of stateListeners) { try { cb(s, detail); } catch (e) { console.error('[Device] state listener:', e); } }
    };

    return {
        name,
        get channel()  { return client?.channel ?? null; },
        get state()    { return client?.state ?? 'idle'; },
        get info()     { return client?.info ?? null; },
        get lastSeen() { return client?.lastSeen ?? 0; },
        get connected(){ return client?.state === 'open'; },
        attach(c) {
            this.detach();
            client = c;
            offMsg = c.onMessage((msg) => {
                for (const l of listeners) if (topicMatches(l.filter, msg.topic)) {
                    try { l.cb(msg); } catch (e) { console.error('[Device] listener:', e); }
                }
            });
            offState = c.onState(emitState);
            emitState(c.state, 'attach');
        },
        detach() {
            offMsg?.(); offState?.();
            offMsg = offState = null;
            if (client) { client = null; emitState('idle', 'detach'); }
        },
        send(topic, value) {
            if (!client) return Promise.reject(new Error(`device "${name}" not connected`));
            return client.send(topic, value);
        },
        ping() {
            if (!client) return Promise.reject(new Error(`device "${name}" not connected`));
            return client.ping();
        },
        last(topic) { return client?.last(topic) ?? null; },
        /** Ascolta i messaggi il cui topic corrisponde al filtro; restituisce la funzione per smettere. */
        listen(filter, cb) {
            const l = { filter, cb };
            listeners.add(l);
            return () => listeners.delete(l);
        },
        onState(cb) { stateListeners.add(cb); return () => stateListeners.delete(cb); },
    };
}
