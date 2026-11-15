// app/FLE_sub_modules/FLE-device-nodes.mjs
// Dispositivi nei flow (2026-10-12) — _doc/arch-iot-dispositivi.md (canali seriale, BLE, MQTT)
//
//   ReseArch/Context/Device — apre la connessione a un dispositivo (ESP8266, ESP32, Arduino) e la
//                             registra con un NOME di contesto in graph._fleDevices[name]
//   IoT/Receive             — riceve i messaggi di un topic ("pot", "acc", "sensors/+")
//   IoT/Send                — invia un comando ("led=on"), con conferma facoltativa
//   IoT/Status              — connessione, latenza, identità del dispositivo
//
// Uso da un altro nodo: widget "device" con il nome, poi
//   const dev = await fleUseDevice(this, this.properties.device);
//   dev.listen('pot', msg => …);   dev.send('led', true);
//
// Sicurezza: Context/Device apre un canale verso un dispositivo → NODO CRITICO
// (FV_CRITICAL_TYPES in api/flow_validation.php, property channel). Gli altri nodi no.
//
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

import {
    DEVICE_CHANNELS, SERIAL_BAUDS, serialSupported, findAuthorizedPort, requestSerialPort,
    acquireSerialClient, bleSupported, requestBleDevice, findAuthorizedBleDevice, acquireBleClient,
    mqttBrokers, validDeviceId, acquireMqttClient, createDeviceHandle, parseValue, validTopic,
} from "./FLE-device-client.mjs";

const VALUE_TYPES = ['number', 'array', 'boolean', 'string', 'object'];
const REDRAW_MS   = 100;   // al più un ridisegno del nodo ogni 100 ms (i sensori mandano decine di valori al secondo)

// broker MQTT configurati sul server, per il menu del widget (letti al primo nodo Context Device col canale mqtt)
let _brokerIds = [];
function loadBrokers() {
    return mqttBrokers().then(list => { _brokerIds = list.map(b => b.id); return list; });
}

/**
 * Dispositivo `name` nel grafo del nodo (Promise dell'handle). Rifiuta con un messaggio chiaro se
 * nessun nodo Context/Device del grafo usa quel nome. L'handle esiste anche a dispositivo non
 * ancora connesso: gli ascolti si possono agganciare subito.
 */
export function fleUseDevice(node, name) {
    name = String(name ?? '').trim();
    if (!name) return Promise.reject(new Error('set the device name ("device" widget)'));
    const entry = node?.graph?._fleDevices?.[name];
    if (!entry) {
        return Promise.reject(new Error(`device "${name}" not defined: add to the flow a ReseArch/Context/Device node with name = ${name}`));
    }
    return entry;
}

function drawText(node, ctx2d, text, color) {
    if (!text || node.research_error || node.flags.collapsed) return;
    ctx2d.save();
    ctx2d.font = '9px monospace';
    ctx2d.fillStyle = color || 'rgba(255,255,255,0.45)';
    const max = Math.max(10, Math.floor((node.size[0] - 12) / 5.4));
    ctx2d.fillText(text.length > max ? text.slice(0, max - 1) + '…' : text, 6, node.size[1] - 6);
    ctx2d.restore();
}

/** Ridisegno del nodo limitato nel tempo. */
function redrawSoon(node) {
    if (node._redrawTimer) return;
    node._redrawTimer = setTimeout(() => { node._redrawTimer = null; node.setDirtyCanvas?.(true, false); }, REDRAW_MS);
}

/** Valore ricevuto → tipo richiesto dalla porta, o errore (porte a tipo univoco). */
function coerce(msg, type) {
    const v = msg.value;
    switch (type) {
        case 'string':  return String(msg.raw ?? '').trim();
        case 'number':  if (typeof v === 'number') return v; break;
        case 'boolean': if (typeof v === 'boolean') return v; if (v === 0 || v === 1) return v === 1; break;
        case 'array':   if (Array.isArray(v)) return v; if (typeof v === 'number') return [v]; break;
        case 'object':  if (v && typeof v === 'object' && !Array.isArray(v)) return v; break;
    }
    throw new Error(`"${msg.topic}" = "${msg.raw}" is not of type ${type}`);
}

/** Il grafo ha cambiato il dispositivo registrato con quel nome: chi lo usa si riaggancia. */
function notifyDeviceChanged(graph, name, except) {
    for (const n of graph?._nodes ?? []) {
        if (n !== except) try { n.onDeviceChanged?.(name); } catch (e) { console.error(e); }
    }
}

export function registerDeviceNodes(LG) {
    if (!LG) return;

    // ─────────────────────────────────────────────────────────────────────────
    // ReseArch/Context/Device
    // ─────────────────────────────────────────────────────────────────────────
    function ContextDevice() {
        this.addProperty('name',        'device', 'string');
        this.addProperty('channel',     'serial', 'string');
        this.addProperty('baud',        115200,   'number');
        this.addProperty('usb_vendor',  0,        'number');   // porta scelta l'ultima volta (per riaprirla senza clic)
        this.addProperty('usb_product', 0,        'number');
        this.addProperty('filter',      'RA-',    'string');   // ble: prefisso del nome dei dispositivi da mostrare
        this.addProperty('ble_id',      '',       'string');   // ble: dispositivo scelto l'ultima volta
        this.addProperty('broker',      '',       'string');   // mqtt: id di un broker di cfg/cfg_iot.php
        this.addProperty('device',      '',       'string');   // mqtt: id del dispositivo (quello dello sketch)
        this.addWidget('text',  'name',    'device', v => { this.properties.name = String(v ?? '').trim(); this._register(); }, { property: 'name' });
        this.addWidget('combo', 'channel', 'serial', v => { this.properties.channel = v; this._close(); this._open(false); }, { values: DEVICE_CHANNELS, property: 'channel' });
        this.addWidget('combo', 'baud',    115200,   v => { this.properties.baud = Number(v); this._close(); this._open(false); }, { values: SERIAL_BAUDS, property: 'baud' });
        this.addWidget('text',  'filter',  'RA-',    v => { this.properties.filter = String(v ?? '').trim(); }, { property: 'filter' });
        this.addWidget('combo', 'broker',  '',       v => { this.properties.broker = v; this._close(); this._open(false); }, { values: () => _brokerIds, property: 'broker' });
        this.addWidget('text',  'device',  '',       v => { this.properties.device = String(v ?? '').trim(); this._close(); this._open(false); }, { property: 'device' });
        this.addWidget('button', 'Connect…', null, () => this._open(true));
        this.addInput('trigger',    LG.ACTION);
        this.addInput('disconnect', LG.ACTION);
        this.addOutput('done',      LG.EVENT);
        this.addOutput('connected', 'boolean');
        this.addOutput('info',      'object');
        this._handle = null;
        this._client = null;
        this._registered = null;
        this._status = '';
        this._seq = 0;
        this._offState = null;
        this._onSerialConnect = null;
        this.color   = '#14532d';   // famiglia Creazione astratta (come Context Service)
        this.bgcolor = '#166534';
        this.size    = [280, 224];
    }
    ContextDevice.error_output = true;
    ContextDevice.title = 'Context Device';
    ContextDevice.desc  = 'Opens the connection to a device (ESP8266, ESP32, Arduino) over USB serial, Bluetooth LE (ESP32) or an MQTT broker (remote ESP8266/ESP32 on Wi-Fi) and makes it available to the IoT nodes of the flow under a context name, without links. Serial and BLE: the first time the port or device is chosen with the Connect button (browser rule, Chrome or Edge); afterwards it reopens by itself when the browser allows it. MQTT: any browser, no choice needed. Critical node: requires flow validation';
    ContextDevice.portHelp = {
        inputs: {
            trigger:    'event — connects: reopens the port/device chosen last time; if there is none, asks to choose it (only if the event comes from a click, e.g. a button of an HTM page: the browser opens the chooser only after a user gesture). MQTT: connects to the broker',
            disconnect: 'event — closes the connection (the port/device stays authorized: trigger reopens it without asking, when the browser allows it)',
        },
        outputs: {
            done:      'event — connection open (also after an automatic reconnection: cable plugged in again, Bluetooth device back in range, MQTT device back online)',
            connected: 'boolean — true while the connection is open (MQTT: broker reached and device online)',
            info:      'object — what the device declared with $hello, e.g. { id, fw, in: [topics it sends], out: [topics it accepts] }; null until it introduces itself',
            error:     'event — Web Serial / Web Bluetooth not available, port busy (Arduino IDE serial monitor open?), device without the Nordic UART service, broker unreachable or wrong credentials, MQTT device offline, connection lost, or an error reported by the firmware ($err=…, e.g. unknown command). Port hidden by default: right click → Show error',
        },
        properties: {
            name:        'context name, e.g. esp: the IoT nodes write it in their "device" widget',
            channel:     'serial: USB cable (ESP8266, ESP32, Arduino) · ble: Bluetooth Low Energy, ESP32 only, with a ReseArchBLE sketch (Nordic UART service); about 10 m, reconnects by itself when the device comes back in range · mqtt: remote ESP8266/ESP32 on Wi-Fi with a ReseArchMQTT sketch, through a broker configured on the server; more browsers can use the same device',
            baud:        'serial only: speed, must match Serial.begin() in the firmware (115200 recommended)',
            filter:      'ble only: the chooser shows only devices whose name starts with this text (ReseArchBLE examples use "RA-…"); empty = all devices with the Nordic UART service',
            ble_id:      'ble only: browser identifier of the device chosen last time (set by Connect): used to reconnect without asking where the browser allows it; otherwise press Connect… again',
            broker:      'mqtt only: id of a broker configured on the server (cfg/cfg_iot.php, list from the platform): address and credentials stay on the server, never in the flow',
            device:      'mqtt only: id of the device, the same as in the sketch (ReseArchMQTT begin), e.g. pot1: letters, digits, _ -',
            usb_vendor:  'USB identifier of the port chosen last time (set by Connect; 0 = any): used to find it again without asking',
            usb_product: 'USB identifier of the port chosen last time (set by Connect; 0 = any)',
        },
    };
    ContextDevice.prototype._setOut = function (name, v) {
        const i = this.findOutputSlot(name);
        if (i !== -1) this.setOutputData(i, v);
    };
    /** Registra l'handle col nome (anche prima della connessione: gli ascolti si agganciano subito). */
    ContextDevice.prototype._register = function () {
        const g = this.graph;
        if (!g) return;
        g._fleDevices = g._fleDevices || {};
        if (this._registered && g._fleDevices[this._registered]?._owner === this) {
            delete g._fleDevices[this._registered];
            notifyDeviceChanged(g, this._registered, this);
        }
        this._registered = null;
        const name = this.properties.name;
        if (!name) { this._status = 'set name'; this.setDirtyCanvas(true, false); return; }
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) { this.triggerError?.(new Error('invalid name (letters, digits, _)')); return; }
        if (!this._handle) {
            this._handle = createDeviceHandle(name);
            this._offState = this._handle.onState((s, detail) => this._onState(s, detail));
        }
        this._handle.name = name;
        // errori segnalati dal firmware ($err=testo): sulla porta d'errore di questo nodo
        if (!this._offErr) this._offErr = this._handle.listen('$err', (msg) => this.triggerError?.(new Error('device: ' + String(msg.raw).trim())));
        const entry = Promise.resolve(this._handle);
        entry._owner = this;
        entry._handle = this._handle;
        g._fleDevices[name] = entry;
        this._registered = name;
        notifyDeviceChanged(g, name, this);
    };
    ContextDevice.prototype._onState = function (s, detail) {
        const open = s === 'open';
        this._setOut('connected', open);
        this._setOut('info', this._handle?.info ?? null);
        const id = this._handle?.info?.id;
        const port = this._client?.portInfo;
        const ch = this._client?.channel;
        const where = ch === 'ble' ? `BLE ${port?.name || ''}`.trim()
            : ch === 'mqtt' ? `MQTT ${port?.title || port?.broker || ''}/${port?.device || ''}`
            : port?.usbVendorId ? `USB ${port.usbVendorId.toString(16)}:${(port.usbProductId ?? 0).toString(16)} · ${this.properties.baud}` : `serial · ${this.properties.baud}`;
        if (open) this._status = `connected — ${id ? id + ' · ' : ''}${where}`;
        else if (s === 'connecting') this._status = ch === 'ble' ? 'connecting over Bluetooth…' : ch === 'mqtt' ? 'connecting to the broker…' : 'connecting…';
        else if (s === 'lost') this._status = detail === 'offline' ? `device ${port?.device || ''} offline — waiting for it on the broker`
            : ch === 'ble' ? 'connection lost — retrying (device on and in range?)'
            : ch === 'mqtt' ? 'broker not reachable — retrying'
            : 'connection lost — waiting for the device';
        this.setDirtyCanvas(true, false);
        // aperta adesso, riaperta, o già aperta da un altro grafo della pagina quando ci si aggancia
        if (open && detail !== 'hello') this.triggerSlot(this.findOutputSlot('done'));
        // errore solo alla caduta (senza dettaglio) o quando il dispositivo MQTT risulta spento; i tentativi
        // di riconnessione falliti (dettaglio = l'errore) aggiornano solo lo stato, altrimenti con il BLE
        // fuori portata arriverebbe un errore a ogni tentativo
        if (s === 'lost' && detail === 'offline') this.triggerError?.(new Error(`device "${port?.device}" is offline (not connected to the broker): waiting for it`));
        else if (s === 'lost' && !detail) this.triggerError?.(new Error(ch === 'ble'
            ? 'connection lost (device off or out of range): reconnecting automatically'
            : ch === 'mqtt' ? 'broker connection lost: reconnecting automatically'
            : 'connection lost (cable unplugged or device restarted)'));
    };
    /**
     * Apre la connessione. withGesture: si può chiedere all'utente di scegliere la porta (dentro un
     * clic); senza, si riapre solo una porta già autorizzata.
     */
    ContextDevice.prototype._open = async function (withGesture) {
        if (!this.graph) return;
        if (!this._registered) this._register();
        if (!this._handle) return;
        const seq = ++this._seq;
        this.clearError?.();
        const fail = (msg) => { if (seq === this._seq) { this._status = ''; this.triggerError?.(new Error(msg)); } };
        if (this.properties.channel === 'ble')  { await this._openBle(withGesture, seq, fail); return; }
        if (this.properties.channel === 'mqtt') { await this._openMqtt(withGesture, seq, fail); return; }
        if (this.properties.channel !== 'serial') { fail(`channel "${this.properties.channel}" not available yet`); return; }
        if (!serialSupported()) { fail('Web Serial not available: use Chrome or Edge on a computer (page in https)'); return; }
        const baud = Number(this.properties.baud) || 115200;
        // già aperta con le stesse impostazioni: niente da fare
        if (this._client?.channel === 'serial' && this._client.baud === baud && (this._client.state === 'open' || this._client.state === 'connecting') && !withGesture) return;

        let port = null;
        try {
            if (withGesture) {
                port = await requestSerialPort();
                const i = port.getInfo?.() ?? {};
                this.properties.usb_vendor  = i.usbVendorId  ?? 0;
                this.properties.usb_product = i.usbProductId ?? 0;
            } else {
                port = await findAuthorizedPort(this.properties.usb_vendor, this.properties.usb_product);
            }
        } catch (err) {
            // NotFoundError = finestra chiusa senza scegliere
            if (err?.name === 'NotFoundError') { if (seq === this._seq) { this._status = 'no port chosen'; this.setDirtyCanvas(true, false); } return; }
            if (err?.name === 'SecurityError') { fail('the port chooser opens only after a click (Connect button, or trigger from a page button)'); return; }
            fail(err?.message || String(err));
            return;
        }
        if (seq !== this._seq) return;
        if (!port) { this._status = 'press Connect… to choose the port'; this.setDirtyCanvas(true, false); return; }
        if (this._client?.port === port && this._client.baud === baud && this._client.state !== 'closed') {
            this._client.open().catch(err => fail(err?.message || String(err)));
            return;
        }
        await this._close();
        if (seq !== this._seq) return;
        try {
            this._client = acquireSerialClient(port, baud);
        } catch (err) { fail(err?.message || String(err)); return; }
        this._handle.attach(this._client);
        this._watchReplug();
        try { await this._client.open(); }
        catch (err) { fail(err?.message || String(err)); }
    };
    /** Canale Bluetooth LE: stessa logica della seriale, con il dispositivo al posto della porta. */
    ContextDevice.prototype._openBle = async function (withGesture, seq, fail) {
        if (!bleSupported()) { fail('Web Bluetooth not available: use Chrome or Edge (computer or Android), page in https'); return; }
        if (this._client?.channel === 'ble' && (this._client.state === 'open' || this._client.state === 'connecting') && !withGesture) return;
        let device = null;
        try {
            if (withGesture) {
                device = await requestBleDevice(this.properties.filter);
                this.properties.ble_id = device.id || '';
            } else {
                device = await findAuthorizedBleDevice(this.properties.ble_id, this.properties.filter);
            }
        } catch (err) {
            // NotFoundError = finestra chiusa senza scegliere (o nessun dispositivo trovato)
            if (err?.name === 'NotFoundError') { if (seq === this._seq) { this._status = 'no device chosen'; this.setDirtyCanvas(true, false); } return; }
            if (err?.name === 'SecurityError') { fail('the device chooser opens only after a click (Connect button, or trigger from a page button)'); return; }
            fail(err?.message || String(err));
            return;
        }
        if (seq !== this._seq) return;
        if (!device) { this._status = 'press Connect… to choose the device'; this.setDirtyCanvas(true, false); return; }
        if (this._client?.device === device && this._client.state !== 'closed') {
            this._client.open().catch(err => fail(err?.message || String(err)));
            return;
        }
        await this._close();
        if (seq !== this._seq) return;
        this._client = acquireBleClient(device);
        this._handle.attach(this._client);
        try { await this._client.open(); }
        catch (err) { fail(err?.message || String(err)); }
    };
    /** Canale MQTT: nessuna scelta dell'utente, solo broker (id del server) e id del dispositivo. */
    ContextDevice.prototype._openMqtt = async function (withGesture, seq, fail) {
        const broker = this.properties.broker, device = this.properties.device;
        let list;
        try { list = await loadBrokers(); }
        catch (err) { fail('MQTT brokers: ' + (err?.message || err)); return; }
        if (seq !== this._seq) return;
        this.setDirtyCanvas(true, false);    // menu dei broker aggiornato
        if (!list.length) { fail('no MQTT broker configured on the server (cfg/cfg_iot.php)'); return; }
        if (!broker) { this._status = 'choose the broker'; this.setDirtyCanvas(true, false); return; }
        if (!list.some(b => b.id === broker)) { fail(`broker "${broker}" is not configured on the server (or not available to you)`); return; }
        if (!device) { this._status = 'set the device id'; this.setDirtyCanvas(true, false); return; }
        if (!validDeviceId(device)) { fail(`invalid device id "${device}" (letters, digits, _ -, at most 32)`); return; }
        const same = this._client?.channel === 'mqtt' && this._client.broker === broker && this._client.device === device && this._client.state !== 'closed';
        if (same && (this._client.state === 'open' || this._client.state === 'connecting') && !withGesture) return;
        if (same) { this._client.open().catch(err => fail(err?.message || String(err))); return; }
        await this._close();
        if (seq !== this._seq) return;
        this._client = acquireMqttClient(broker, device);
        this._handle.attach(this._client);
        try { await this._client.open(); }
        catch (err) { fail(err?.message || String(err)); }
    };
    /**
     * Schede con USB nativa (ESP32-S3/C3): al riavvio la porta può tornare come oggetto nuovo.
     * A connessione persa, una porta con gli stessi identificativi che ricompare si riapre.
     */
    ContextDevice.prototype._watchReplug = function () {
        if (this._onSerialConnect || !serialSupported()) return;
        this._onSerialConnect = (e) => {
            const p = e.target;
            if (!this._client || this._client.state !== 'lost' || p === this._client.port) return;
            const i = p?.getInfo?.() ?? {};
            if (this.properties.usb_vendor && i.usbVendorId === this.properties.usb_vendor && i.usbProductId === this.properties.usb_product) {
                this._close().then(() => this._open(false));
            }
        };
        navigator.serial.addEventListener('connect', this._onSerialConnect);
    };
    ContextDevice.prototype._close = async function () {
        if (this._onSerialConnect) { navigator.serial.removeEventListener('connect', this._onSerialConnect); this._onSerialConnect = null; }
        const c = this._client;
        this._client = null;
        this._handle?.detach();
        if (c) await c.release();
        this._setOut('connected', false);
        this._status = 'disconnected';
        this.setDirtyCanvas(true, false);
    };
    ContextDevice.prototype.onAction = function (action) {
        if (action === 'disconnect') { this._seq++; this._close(); return; }
        // un clic recente (pulsante di una pagina) permette di aprire la scelta della porta
        const gesture = !!navigator.userActivation?.isActive;
        this._open(gesture);
    };
    ContextDevice.prototype.onAdded     = function () { this._register(); setTimeout(() => this._open(false), 0); };
    ContextDevice.prototype.onConfigure = function () { this._register(); setTimeout(() => this._open(false), 0); };
    ContextDevice.prototype.onStart     = function () { this._open(false); };
    // grafo fermato: si rilascia la porta (resta aperta se la usa ancora un altro grafo della pagina)
    ContextDevice.prototype.onStop      = function () { this._seq++; this._close(); };
    ContextDevice.prototype.onRemoved   = function () {
        this._seq++;
        this._close();
        this._offState?.();
        this._offState = null;
        this._offErr?.();
        this._offErr = null;
        const g = this.graph;
        if (g?._fleDevices && this._registered && g._fleDevices[this._registered]?._owner === this) {
            delete g._fleDevices[this._registered];
            notifyDeviceChanged(g, this._registered, this);
        }
        this._registered = null;
    };
    ContextDevice.prototype.onDrawForeground = function (ctx2d) {
        drawText(this, ctx2d, this._status, this._status.startsWith('connected') ? 'rgba(120,255,120,0.8)' : null);
    };
    LG.registerNodeType('ReseArch/Context/Device', ContextDevice);


    // ─────────────────────────────────────────────────────────────────────────
    // IoT/Receive
    // ─────────────────────────────────────────────────────────────────────────
    function IoTReceive() {
        this.addProperty('device', 'device', 'string');
        this.addProperty('topic',  '',       'string');
        this.addProperty('type',   'number', 'string');
        this.addProperty('retain', true,     'boolean');
        this.addWidget('text',   'device', 'device', v => { this.properties.device = String(v ?? '').trim(); this._subscribe(); }, { property: 'device' });
        this.addWidget('text',   'topic',  '',       v => { this.properties.topic = String(v ?? '').trim(); this._subscribe(); }, { property: 'topic' });
        this.addWidget('combo',  'type',   'number', v => { this.properties.type = v; this._applyType(); }, { values: VALUE_TYPES, property: 'type' });
        this.addWidget('toggle', 'retain', true,     v => { this.properties.retain = !!v; }, { property: 'retain' });
        this.addOutput('done',  LG.EVENT);
        this.addOutput('value', 'number');
        this.addOutput('topic', 'string');
        this._off = null;
        this._status = '';
        this._seq = 0;
        this._count = 0;
        this.color   = '#062a1a';   // famiglia Eventi
        this.bgcolor = '#0a4a2e';
        this.size    = [240, 150];
    }
    IoTReceive.error_output = true;
    IoTReceive.title = 'IoT Receive';
    IoTReceive.desc  = 'Receives the messages of a device topic (e.g. pot, temp, acc): fires at every message with the value already converted to the chosen type. Works wherever the flow runs (object flow, dashboard, editor) as long as the flow has a Context Device';
    IoTReceive.portHelp = {
        outputs: {
            done:  'event — a message has arrived ("value" and "topic" are already set). Sensors can send tens of messages per second: to slow down use ReseArch/Tools/Debounce or a throttle',
            value: 'the value, of the type chosen in "type": number (pot=512) · array of numbers (acc=0.1,-0.2,9.8) · boolean (button=on/off, also 1/0) · string (the text as received) · object (JSON, gps={"lat":41.9})',
            topic: 'text — the topic of the message, useful when "topic" contains + or #',
            error: 'event — device not defined, or value not of the chosen type (e.g. text on a number port). Port hidden by default: right click → Show error',
        },
        properties: {
            device: 'name of a ReseArch/Context/Device node',
            topic:  'topic to listen to, as written by the firmware before "=": pot, temp, sensors/light. + = any one level (sensors/+), # = everything below (sensors/#, or # alone for all)',
            type:   'type of the "value" output: number, array, boolean, string, object',
            retain: 'on: when the flow starts (or the topic changes) the last value already received is given at once, without waiting for the next message (exact topics only, not + or #)',
        },
    };
    IoTReceive.prototype._applyType = function () {
        const s = this.outputs?.[this.findOutputSlot('value')];
        if (s && s.type !== this.properties.type) { s.type = this.properties.type; this.setDirtyCanvas(true, true); }
    };
    IoTReceive.prototype._unsubscribe = function () { this._off?.(); this._off = null; };
    IoTReceive.prototype._deliver = function (msg) {
        let v;
        try { v = coerce(msg, this.properties.type); }
        catch (err) { this.triggerError?.(err); return; }
        this.clearError?.();
        this._count++;
        this._status = `${msg.topic} = ${String(msg.raw).trim()}`;
        redrawSoon(this);
        // prima i dati, poi l'evento (triggerSlot chiama subito i nodi a valle)
        this.setOutputData(this.findOutputSlot('value'), v);
        this.setOutputData(this.findOutputSlot('topic'), msg.topic);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    IoTReceive.prototype._subscribe = async function () {
        const seq = ++this._seq;
        this._unsubscribe();
        this.clearError?.();
        const { device, topic } = this.properties;
        if (!topic) { this._status = 'set the topic'; this.setDirtyCanvas(true, false); return; }
        if (topic !== '#' && !/^[A-Za-z0-9_\-/+#]{1,64}$/.test(topic)) { this.triggerError?.(new Error(`invalid topic "${topic}"`)); return; }
        let dev;
        try { dev = await fleUseDevice(this, device); }
        catch (err) { if (seq === this._seq) { this._status = ''; this.triggerError?.(err); } return; }
        if (seq !== this._seq) return;
        this._status = `listening: ${topic} (${this.properties.type})`;
        this.setDirtyCanvas(true, false);
        this._off = dev.listen(topic, (msg) => this._deliver(msg));
        // ultimo valore già ricevuto: dopo che il grafo ha finito di avviarsi
        if (this.properties.retain && !/[+#]/.test(topic)) {
            const off = this._off;
            setTimeout(() => {
                if (this._off !== off) return;
                const last = dev.last(topic);
                if (last) this._deliver({ topic, ...last });
            }, 0);
        }
    };
    IoTReceive.prototype.onConfigure = function () { this._applyType(); setTimeout(() => this._subscribe(), 0); };
    IoTReceive.prototype.onAdded     = function () { setTimeout(() => this._subscribe(), 0); };
    IoTReceive.prototype.onStart     = function () { this._subscribe(); };
    IoTReceive.prototype.onDeviceChanged = function (name) { if (name === this.properties.device) this._subscribe(); };
    IoTReceive.prototype.onStop      = function () { this._seq++; this._unsubscribe(); };
    IoTReceive.prototype.onRemoved   = function () { this._seq++; this._unsubscribe(); clearTimeout(this._redrawTimer); };
    IoTReceive.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('IoT/Receive', IoTReceive);


    // ─────────────────────────────────────────────────────────────────────────
    // IoT/Send
    // ─────────────────────────────────────────────────────────────────────────
    function IoTSend() {
        this.addProperty('device',  'device', 'string');
        this.addProperty('topic',   '',       'string');
        this.addProperty('value',   '',       'string');
        this.addProperty('confirm', false,    'boolean');
        this.addProperty('timeout', 1000,     'number');
        this.addWidget('text',   'device',  'device', v => { this.properties.device = String(v ?? '').trim(); }, { property: 'device' });
        this.addWidget('text',   'topic',   '',       v => { this.properties.topic = String(v ?? '').trim(); }, { property: 'topic' });
        this.addWidget('text',   'value',   '',       v => { this.properties.value = String(v ?? ''); }, { property: 'value' });
        this.addWidget('toggle', 'confirm', false,    v => { this.properties.confirm = !!v; }, { property: 'confirm' });
        this.addWidget('number', 'timeout', 1000,     v => { this.properties.timeout = Math.max(50, Math.round(v)); }, { min: 50, max: 30000, step: 100, precision: 0, property: 'timeout' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('value',   0);
        this.addOutput('done',  LG.EVENT);
        this.addOutput('state', 0);
        this._status = '';
        this._seq = 0;
        this._offConfirm = null;
        this._timer = null;
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [240, 170];
    }
    IoTSend.error_output = true;
    IoTSend.title = 'IoT Send';
    IoTSend.desc  = 'On trigger sends a command to the device as a "topic=value" line (e.g. led=on, servo=90). With confirm, waits for the device to answer with the same topic and gives the actual state';
    IoTSend.portHelp = {
        inputs: {
            trigger: 'event — sends the command; a new trigger while waiting for a confirmation replaces the previous one',
            value:   'number, boolean, array of numbers, text or object — the value to send: true/false become on/off, arrays 1,2,3, objects JSON. When connected it overrides the "value" widget (also when it is null: an empty value is sent)',
        },
        outputs: {
            done:  'event — command sent (without confirm) or confirmed by the device (with confirm)',
            state: 'the confirmed value as received from the device (number, boolean, array, text or object); without confirm, the value sent',
            error: 'event — device not defined or not connected, invalid topic, no confirmation within the timeout. Port hidden by default: right click → Show error',
        },
        properties: {
            device:  'name of a ReseArch/Context/Device node',
            topic:   'command topic, as expected by the firmware: led, servo/pan, relay/1 (letters, digits, _ - /)',
            value:   'value to send when the "value" input is not connected: written as in the protocol (on, off, 90, 1,2,3)',
            confirm: 'on: wait for the device to repeat the topic with its actual state (the firmware must do it); off: done right after sending (for continuous control, e.g. a servo following a slider)',
            timeout: 'with confirm: how long to wait for the answer, in milliseconds',
        },
    };
    IoTSend.prototype._stopWaiting = function () {
        this._offConfirm?.(); this._offConfirm = null;
        clearTimeout(this._timer); this._timer = null;
    };
    IoTSend.prototype.onAction = async function () {
        const seq = ++this._seq;
        this._stopWaiting();
        this.clearError?.();
        const fail = (err) => { if (seq !== this._seq) return; this._stopWaiting(); this._status = ''; this.triggerError?.(err); };
        const topic = this.properties.topic;
        if (!validTopic(topic)) { fail(new Error(topic ? `invalid topic "${topic}" (letters, digits, _ - /)` : 'set the topic')); return; }
        // ingresso collegato prevale sul widget
        const vi = this.findInputSlot('value');
        const linked = vi !== -1 && this.inputs[vi].link != null;
        const value = linked ? this.getInputData(vi) : parseValue(this.properties.value);

        let dev;
        try { dev = await fleUseDevice(this, this.properties.device); }
        catch (err) { fail(err); return; }
        if (seq !== this._seq) return;

        const finish = (state) => {
            if (seq !== this._seq) return;
            this._stopWaiting();
            this._status = `${topic} = ${typeof state === 'object' ? JSON.stringify(state) : String(state)}${this.properties.confirm ? ' ✓' : ''}`;
            this.setDirtyCanvas(true, false);
            this.setOutputData(this.findOutputSlot('state'), state);
            this.triggerSlot(this.findOutputSlot('done'));
        };
        if (this.properties.confirm) {
            this._offConfirm = dev.listen(topic, (msg) => finish(msg.value));
            this._timer = setTimeout(() => fail(new Error(`no confirmation of "${topic}" within ${this.properties.timeout} ms`)), Math.max(50, Number(this.properties.timeout) || 1000));
        }
        try { await dev.send(topic, value); }
        catch (err) { fail(err); return; }
        if (!this.properties.confirm) finish(value);
        else if (seq === this._seq) { this._status = `${topic}: waiting for confirmation…`; this.setDirtyCanvas(true, false); }
    };
    IoTSend.prototype.onStop    = function () { this._seq++; this._stopWaiting(); };
    IoTSend.prototype.onRemoved = function () { this._seq++; this._stopWaiting(); };
    IoTSend.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('IoT/Send', IoTSend);


    // ─────────────────────────────────────────────────────────────────────────
    // IoT/Status
    // ─────────────────────────────────────────────────────────────────────────
    function IoTStatus() {
        this.addProperty('device', 'device', 'string');
        this.addWidget('text', 'device', 'device', v => { this.properties.device = String(v ?? '').trim(); this._subscribe(); }, { property: 'device' });
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',      LG.EVENT);
        this.addOutput('change',    LG.EVENT);
        this.addOutput('connected', 'boolean');
        this.addOutput('latency',   'number');
        this.addOutput('info',      'object');
        this.addOutput('idle_s',    'number');
        this._status = '';
        this._seq = 0;
        this._subSeq = 0;
        this._off = null;
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [230, 150];
    }
    IoTStatus.error_output = true;
    IoTStatus.title = 'IoT Status';
    IoTStatus.desc  = 'State of a device: on trigger measures the latency (ping) and reads identity and time since the last message; "change" fires by itself when the device connects or disconnects';
    IoTStatus.portHelp = {
        inputs: {
            trigger: 'event — reads the state and measures the latency (e.g. from Time/Timer every few seconds, to show it in a page)',
        },
        outputs: {
            done:      'event — state read (after the ping reply, or after its timeout: then latency is null)',
            change:    'event — the connection opened or closed, or the device introduced itself ($hello); "connected" and "info" are already set. Fires by itself, without trigger',
            connected: 'boolean — true while the connection is open',
            latency:   'number — round trip time in milliseconds ($ping → $pong); null if not connected or if the firmware does not answer $ping',
            info:      'object — what the device declared with $hello: { id, fw, in, out }; null if it did not introduce itself',
            idle_s:    'number — seconds since the last message received from the device; null if none yet',
            error:     'event — device not defined in the flow. Port hidden by default: right click → Show error',
        },
        properties: { device: 'name of a ReseArch/Context/Device node' },
    };
    IoTStatus.prototype._write = function (dev, latency) {
        const out = (n, v) => { const i = this.findOutputSlot(n); if (i !== -1) this.setOutputData(i, v); };
        const seen = dev.lastSeen;
        out('connected', dev.connected);
        out('info', dev.info);
        out('idle_s', seen ? Math.round((Date.now() - seen) / 100) / 10 : null);
        if (latency !== undefined) out('latency', latency);
        this._status = dev.connected
            ? `connected${dev.info?.id ? ' — ' + dev.info.id : ''}${latency != null ? ` · ${latency} ms` : ''}`
            : `not connected (${dev.state})`;
        this.setDirtyCanvas(true, false);
    };
    IoTStatus.prototype._subscribe = async function () {
        const seq = ++this._subSeq;
        this._off?.(); this._off = null;
        let dev;
        try { dev = await fleUseDevice(this, this.properties.device); }
        catch (err) { if (seq === this._subSeq) { this._status = ''; this.triggerError?.(err); } return; }
        if (seq !== this._subSeq) return;
        this.clearError?.();
        let was = dev.connected, wasInfo = dev.info;
        this._write(dev);
        this._off = dev.onState(() => {
            if (dev.connected === was && dev.info === wasInfo) return;
            was = dev.connected; wasInfo = dev.info;
            this._write(dev, dev.connected ? undefined : null);
            this.triggerSlot(this.findOutputSlot('change'));
        });
    };
    IoTStatus.prototype.onAction = async function () {
        const seq = ++this._seq;
        this.clearError?.();
        let dev;
        try { dev = await fleUseDevice(this, this.properties.device); }
        catch (err) { this._status = ''; this.triggerError?.(err); return; }
        let latency = null;
        if (dev.connected) { try { latency = await dev.ping(); } catch { latency = null; } }
        if (seq !== this._seq) return;
        this._write(dev, latency);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    IoTStatus.prototype.onConfigure = function () { setTimeout(() => this._subscribe(), 0); };
    IoTStatus.prototype.onAdded     = function () { setTimeout(() => this._subscribe(), 0); };
    IoTStatus.prototype.onStart     = function () { this._subscribe(); };
    IoTStatus.prototype.onDeviceChanged = function (name) { if (name === this.properties.device) this._subscribe(); };
    IoTStatus.prototype.onStop      = function () { this._seq++; this._subSeq++; this._off?.(); this._off = null; };
    IoTStatus.prototype.onRemoved   = function () { this.onStop(); };
    IoTStatus.prototype.onDrawForeground = function (ctx2d) {
        drawText(this, ctx2d, this._status, this._status.startsWith('connected') ? 'rgba(120,255,120,0.8)' : null);
    };
    LG.registerNodeType('IoT/Status', IoTStatus);
}
