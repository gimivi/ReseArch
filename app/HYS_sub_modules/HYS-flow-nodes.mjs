// app/HYS_sub_modules/HYS-flow-nodes.mjs
// Nodi LiteGraph per i pannelli HySpace (model_HYS.mjs). Leggono/comandano
// l'istanza del pannello solo via graph._appContext (vedi HYS-flow-runner.mjs) —
// mai import diretto di model_HYS.mjs (isolamento per pannello, come MPS/TJS).
//
// Famiglie (colori: tassonomia di _doc/module-fle-architettura.md §10):
//   HYS/Events/*    — sorgenti reattive (onStart → _pending → onExecute)
//   HYS/Settings/*  — configurazione del museo, applicata all'avvio del grafo
//   HYS/Material/*  — modifiche ai materiali dei modelli di stanza (Baked GI), applicate
//                     a ogni stanza caricata (contesto: onRoomModel)
//   HYS/Audio/*     — musica di sottofondo: Playlist / Stream (configurazione,
//                     applicata all'avvio se "autoStart") e Control (azioni)
//
// Percorsi dei file audio: RELATIVI alla cartella del workpackage del flow
// ("Musica/brano.mp3", "Musica/" = tutta la cartella con sottocartelle), oppure
// URL assoluti (https://…, per le radio). Risolti da api/hys_audio_tool.php.

import { THREE } from "../TJS_sub_modules/TJS-loaders.mjs";
import { TJS_createBakedGI, TJS_bakedGIOwner } from "../TJS_sub_modules/TJS-baked-gi.mjs";

export function registerHYSFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[HYS-flow-nodes] LiteGraph not available'); return; }
    if (window._HYS_FLOW_NODES_REGISTERED) return;
    window._HYS_FLOW_NODES_REGISTERED = true;

    // Tassonomia colori (§10): Eventi / Set
    const EVCOLOR  = '#062a1a', EVBGCOLOR  = '#0a4a2e';
    const SETCOLOR = '#2a1a4a', SETBGCOLOR = '#4a1d96';

    const ctxOf = (node) => node.graph?._appContext ?? null;

    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Events/Room Enter
    // ─────────────────────────────────────────────────────────────────────────
    function HYSEventsRoomEnter() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('id_ese',  'number');
        this.addOutput('title',   'string');
        this.addOutput('author',  'string');
        this.addOutput('from',    'string');
        this.addOutput('room',    'object');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 150];
    }
    HYSEventsRoomEnter.title = 'Events Room Enter';
    HYSEventsRoomEnter.desc  = 'Fires on every entry into a museum room (start, doors, stairs, reset, reload)';
    HYSEventsRoomEnter.portHelp = {
        outputs: {
            trigger: 'Trigger (EVENT): fired once on every entry into a room.',
            id_ese:  'Id of the exercise shown in the room just entered.',
            title:   'Exercise title.',
            author:  'Author (first name and surname).',
            from:    'Direction of entry: "F", "L", "B", "R" (doors), "U", "D" (stairs); empty at start/reset/reload.',
            room:    'Full object: { objId, id_ese, idu, title, author, from, neighbors: { F, L, B, R, U, D } } — same payload as the app-bus event "hys:room:enter".',
        },
    };
    HYSEventsRoomEnter.prototype.onStart = function () {
        this._cleanup?.();
        this._cleanup = null;
        const ctx = ctxOf(this);
        const bus = ctx?.localEvents;
        if (!bus || !ctx?.signal) return;
        this._pending = null;
        const g = this.graph, self = this;
        const handler = (ev) => { self._pending = ev.detail; try { g.runStep(1); } catch {} };
        bus.addEventListener('roomEnter', handler);
        this._cleanup = () => bus.removeEventListener('roomEnter', handler);
        ctx.signal.addEventListener('abort', () => this._cleanup?.(), { once: true });
    };
    HYSEventsRoomEnter.prototype.onStop = function () { this._cleanup?.(); this._cleanup = null; };
    HYSEventsRoomEnter.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(this.findOutputSlot('id_ese'), p.id_ese ?? null);
        this.setOutputData(this.findOutputSlot('title'), p.title ?? '');
        this.setOutputData(this.findOutputSlot('author'), p.author ?? '');
        this.setOutputData(this.findOutputSlot('from'), p.from ?? '');
        this.setOutputData(this.findOutputSlot('room'), p);
        this.triggerSlot(this.findOutputSlot('trigger'));
    };
    LG.registerNodeType('HYS/Events/Room Enter', HYSEventsRoomEnter);


    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Settings/Start
    // ─────────────────────────────────────────────────────────────────────────
    function HYSSettingsStart() {
        this.addProperty('id_ese', 1);
        this.addWidget('number', 'id_ese', 1, v => { this.properties.id_ese = Math.max(1, Math.round(v)); },
                       { property: 'id_ese', min: 1, step: 10, precision: 0 });
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [210, 56];
    }
    HYSSettingsStart.title = 'Settings Start';
    HYSSettingsStart.desc  = 'Entrance exercise of the museum (instead of id_ese = 1): applied when the graph starts';
    HYSSettingsStart.portHelp = {
        properties: {
            id_ese: 'Id of the exercise where the visit starts and where "Torna all\'ingresso" (back to the entrance) leads.',
        },
    };
    HYSSettingsStart.prototype.onStart = function () {
        const id = Number(this.properties.id_ese);
        if (id > 0) ctxOf(this)?.setStartEseId?.(id);
    };
    LG.registerNodeType('HYS/Settings/Start', HYSSettingsStart);


    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Settings/Touch
    // ─────────────────────────────────────────────────────────────────────────
    const TOUCH_MODES = ['stick', 'tap to go'];

    function HYSSettingsTouch() {
        this.addProperty('mode', 'stick');
        this.addProperty('sensitivity', 1);
        this.addWidget('combo',  'mode',        'stick', v => { this.properties.mode = v; },   { values: TOUCH_MODES, property: 'mode' });
        this.addWidget('number', 'sensitivity', 1,       v => { this.properties.sensitivity = Math.max(0.2, Math.min(4, v)); }, { property: 'sensitivity', min: 0.2, max: 4, step: 1, precision: 2 });
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [240, 80];
    }
    HYSSettingsTouch.title = 'Settings Touch';
    HYSSettingsTouch.desc  = 'Tablet/phone navigation: default mode of the object and look sensitivity (the visitor can still change mode from the menu)';
    HYSSettingsTouch.portHelp = {
        properties: {
            mode: 'stick = thumb on the left to walk (virtual stick), drag on the right to look. tap to go = tap the floor to walk there, drag anywhere to look. In both: tap on an open door = walks through it, tap on a button = uses it, long press = information.',
            sensitivity: 'Rotation multiplier when dragging to look: 1 = the point under the finger follows it (like Street View).',
        },
    };
    HYSSettingsTouch.prototype._apply = function () {
        ctxOf(this)?.setTouch?.({
            mode: this.properties.mode === 'tap to go' ? 'tap' : 'stick',
            lookScale: Number(this.properties.sensitivity) || 1,
        });
    };
    HYSSettingsTouch.prototype.onStart = function () { this._apply(); };
    HYSSettingsTouch.prototype.onPropertyChanged = function () { setTimeout(() => this._apply(), 0); };
    LG.registerNodeType('HYS/Settings/Touch', HYSSettingsTouch);


    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Settings/Museum — museo generato da una ricerca (api/hys_museum_tool.php)
    // ─────────────────────────────────────────────────────────────────────────
    function HYSSettingsMuseum() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('museum',  'number,object');
        this.addOutput('done',   LG.EVENT);
        this.addProperty('mus_id', 0);
        this.addWidget('number', 'mus_id at start', 0, v => { this.properties.mus_id = Math.max(0, Math.round(v)); }, { property: 'mus_id', min: 0, step: 10, precision: 0 });
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [230, 80];
    }
    HYSSettingsMuseum.title = 'Settings Museum';
    HYSSettingsMuseum.desc  = 'Takes HySpace into a museum generated from a search (or back to the curated museum), entering its entrance room';
    HYSSettingsMuseum.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): applies the museum of the "museum" input.',
            museum: 'The museum: object { mus_id, start_id_ese, … } — for example the payload of App Bus Receiver on the event published by the HTM/HYS/Ricerca Musei (Museum Search) node — or a numeric mus_id. 0 / empty = curated museum.',
        },
        outputs: { done: 'Trigger (EVENT): museum applied (its entrance room has been entered).' },
        properties: {
            mus_id: 'Generated museum to open when the panel starts (0 = curated museum). Useful for a HySpace object dedicated to a thematic museum: give the museum a name in "I miei musei" (so it does not expire) and write its number here.',
        },
    };
    HYSSettingsMuseum.prototype.onStart = function () {
        const id = Number(this.properties.mus_id);
        if (id > 0) ctxOf(this)?.setMuseum?.(id);
    };
    HYSSettingsMuseum.prototype.onAction = async function () {
        const ctx = ctxOf(this);
        if (!ctx?.setMuseum) return;
        const v = this.getInputData(this.findInputSlot('museum'));
        console.info('[HYS/Settings/Museum] request received:', v);
        await ctx.setMuseum(v && typeof v === 'object' ? (v.museo ?? (v.mus_id ? v : v.value)) : v);   // { value } = numero via App Bus Emitter
        this.triggerSlot(this.findOutputSlot('done'));
    };
    LG.registerNodeType('HYS/Settings/Museum', HYSSettingsMuseum);


    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Navigate/Go To — vai a un'esercitazione
    // ─────────────────────────────────────────────────────────────────────────
    function HYSNavigateGoTo() {
        this.addInput('trigger',       LG.ACTION);
        this.addInput('exercise', 'number,object');
        this.addOutput('done', LG.EVENT);
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [220, 56];
    }
    HYSNavigateGoTo.title = 'Navigate Go To';
    HYSNavigateGoTo.desc  = 'Takes the visitor into the room of an exercise (in the current museum)';
    HYSNavigateGoTo.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): goes to the exercise.',
            exercise: 'id_ese (number) or an object with id_ese — for example the payload of the "Vai" button of the HTM/HYS/Ricerca Musei (Museum Search) node received via the bus.',
        },
        outputs: { done: 'Trigger (EVENT): arrived in the room.' },
    };
    HYSNavigateGoTo.prototype.onAction = async function () {
        const ctx = ctxOf(this);
        if (!ctx?.goTo) return;
        const target = this.getInputData(this.findInputSlot('exercise'));
        console.info('[HYS/Navigate/Go To] request received:', target);
        await ctx.goTo(target);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    LG.registerNodeType('HYS/Navigate/Go To', HYSNavigateGoTo);


    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Audio/Playlist
    // ─────────────────────────────────────────────────────────────────────────
    function HYSAudioPlaylist() {
        this.addInput('trigger',  LG.ACTION);
        this.addInput('paths',    'string,array');
        this.addOutput('done',    LG.EVENT);
        this.addOutput('tracks',  'number');
        this.addOutput('list',    'array');
        this.addProperty('paths', 'Musica/');
        this.addProperty('shuffle', true);
        this.addProperty('volume', 0.35);
        this.addProperty('fade', 3);
        this.addProperty('autoStart', true);
        this.addWidget('text',   'paths',        'Musica/', v => { this.properties.paths = v; }, { property: 'paths' });
        this.addWidget('toggle', 'shuffle',      true,      v => { this.properties.shuffle = v; }, { property: 'shuffle' });
        this.addWidget('slider', 'volume',       0.35,      v => { this.properties.volume = v; },  { property: 'volume', min: 0, max: 1, step: 0.05 });
        this.addWidget('number', 'fade s',       3,         v => { this.properties.fade = Math.max(0, v); }, { property: 'fade', min: 0, max: 20, step: 5, precision: 1 });
        this.addWidget('toggle', 'auto start',   true,      v => { this.properties.autoStart = v; }, { property: 'autoStart' });
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [250, 190];
    }
    HYSAudioPlaylist.title = 'Audio Playlist';
    HYSAudioPlaylist.desc  = 'Background music from audio files (mp3) in the folders of the flow\'s work package';
    HYSAudioPlaylist.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): loads the paths and starts the music.',
            paths:   'Optional: replaces the "paths" property (text or array).',
        },
        outputs: {
            done:   'Trigger (EVENT): playlist loaded.',
            tracks: 'Number of tracks found.',
            list:   'Array of the track URLs.',
        },
        properties: {
            paths: 'One or more paths separated by comma, semicolon or newline, RELATIVE to the folder of the flow\'s work package: a file ("Musica/track1.mp3") or a folder ("Musica/" = all the mp3 files it contains, subfolders included). Absolute URLs (https://…) are accepted too.',
            shuffle: 'Random order of the tracks (new order at every full round).',
            volume: 'Music volume, 0…1 (background: 0.2–0.4).',
            fade: 'Seconds of fade in and fade out of each track.',
            autoStart: 'If on, the playlist loads and starts when the graph starts (the browser plays it at the first click/VR entry).',
        },
    };
    HYSAudioPlaylist.prototype._apply = async function () {
        const ctx = ctxOf(this);
        if (!ctx?.audio || !ctx.resolveMedia) return;
        const paths = this.getInputData(this.findInputSlot('paths')) ?? this.properties.paths;
        const urls = await ctx.resolveMedia(paths);
        if (ctx.signal?.aborted) return;
        ctx.audio.setPlaylist(urls, {
            shuffle: !!this.properties.shuffle,
            volume: Number(this.properties.volume),
            fadeIn: Number(this.properties.fade),
            fadeOut: Number(this.properties.fade),
        });
        this.setOutputData(this.findOutputSlot('tracks'), urls.length);
        this.setOutputData(this.findOutputSlot('list'), urls);
        if (!urls.length) { ctx.notice?.('Audio Playlist: no audio files found in "' + String(paths) + '".'); return; }
        ctx.audio.play();
        this.triggerSlot(this.findOutputSlot('done'));
    };
    HYSAudioPlaylist.prototype.onStart  = function () { if (this.properties.autoStart) this._apply(); };
    HYSAudioPlaylist.prototype.onAction = function () { this._apply(); };
    LG.registerNodeType('HYS/Audio/Playlist', HYSAudioPlaylist);


    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Audio/Stream
    // ─────────────────────────────────────────────────────────────────────────
    function HYSAudioStream() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('url',     'string');
        this.addOutput('done',   LG.EVENT);
        this.addProperty('url', 'https://ice1.somafm.com/dronezone-128-mp3');
        this.addProperty('volume', 0.35);
        this.addProperty('fade', 3);
        this.addProperty('autoStart', true);
        this.addWidget('text',   'url',            this.properties.url, v => { this.properties.url = v; }, { property: 'url' });
        this.addWidget('slider', 'volume',         0.35, v => { this.properties.volume = v; }, { property: 'volume', min: 0, max: 1, step: 0.05 });
        this.addWidget('number', 'fade s',         3,    v => { this.properties.fade = Math.max(0, v); }, { property: 'fade', min: 0, max: 20, step: 5, precision: 1 });
        this.addWidget('toggle', 'auto start',     true, v => { this.properties.autoStart = v; }, { property: 'autoStart' });
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [280, 150];
    }
    HYSAudioStream.title = 'Audio Stream';
    HYSAudioStream.desc  = 'Background music from a streaming radio (alternative to the playlist)';
    HYSAudioStream.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): connects to the radio and starts the music.',
            url:     'Optional: replaces the "url" property.',
        },
        outputs: { done: 'Trigger (EVENT): radio set.' },
        properties: {
            url: 'Address of the audio stream (mp3/aac), e.g. SomaFM Drone Zone "https://ice1.somafm.com/dronezone-128-mp3". Check the radio\'s terms of use for a public site. It can also be a path relative to a file in the work package folder.',
            volume: 'Volume, 0…1.',
            fade: 'Seconds of fade in/out.',
            autoStart: 'If on, it starts when the graph starts (audible after the first click/VR entry).',
        },
    };
    HYSAudioStream.prototype._apply = async function () {
        const ctx = ctxOf(this);
        if (!ctx?.audio) return;
        const raw = this.getInputData(this.findInputSlot('url')) ?? this.properties.url;
        const [url] = await (ctx.resolveMedia?.(raw) ?? Promise.resolve([raw]));
        if (ctx.signal?.aborted || !url) return;
        ctx.audio.setStream(url, {
            volume: Number(this.properties.volume),
            fadeIn: Number(this.properties.fade),
            fadeOut: Number(this.properties.fade),
        });
        ctx.audio.play();
        this.triggerSlot(this.findOutputSlot('done'));
    };
    HYSAudioStream.prototype.onStart  = function () { if (this.properties.autoStart) this._apply(); };
    HYSAudioStream.prototype.onAction = function () { this._apply(); };
    LG.registerNodeType('HYS/Audio/Stream', HYSAudioStream);


    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Audio/Control
    // ─────────────────────────────────────────────────────────────────────────
    const ACTIONS = ['play', 'pause', 'play/pause', 'next track', 'volume'];

    function HYSAudioControl() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('volume',  'number');
        this.addOutput('done',   LG.EVENT);
        this.addProperty('action', 'play/pause');
        this.addProperty('volume', 0.35);
        this.addProperty('seconds', 1);
        this.addWidget('combo',  'action',  'play/pause', v => { this.properties.action = v; }, { values: ACTIONS, property: 'action' });
        this.addWidget('slider', 'volume',  0.35, v => { this.properties.volume = v; }, { property: 'volume', min: 0, max: 1, step: 0.05 });
        this.addWidget('number', 'seconds', 1,    v => { this.properties.seconds = Math.max(0, v); }, { property: 'seconds', min: 0, max: 20, step: 5, precision: 1 });
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [230, 120];
    }
    HYSAudioControl.title = 'Audio Control';
    HYSAudioControl.desc  = 'Controls the background music: play, pause, next track, volume (with ramp)';
    HYSAudioControl.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): runs the chosen action.',
            volume:  'Optional ("volume" action): replaces the "volume" property, 0…1.',
        },
        outputs: { done: 'Trigger (EVENT): action done.' },
        properties: {
            action: 'play | pause (with fade) | play/pause | next track | volume.',
            volume: 'Target volume for the "volume" action, 0…1.',
            seconds: 'Duration of the volume ramp in seconds.',
        },
    };
    HYSAudioControl.prototype.onAction = function () {
        const a = ctxOf(this)?.audio;
        if (!a) return;
        switch (this.properties.action) {
            case 'play':       a.play(); break;
            case 'pause':      a.pause(); break;
            case 'play/pause': a.toggle(); break;
            case 'next track': a.next(); break;
            case 'volume': {
                const v = this.getInputData(this.findInputSlot('volume'));
                a.setVolume(Number.isFinite(v) ? v : this.properties.volume, this.properties.seconds);
                break;
            }
            default: return;
        }
        this.triggerSlot(this.findOutputSlot('done'));
    };
    LG.registerNodeType('HYS/Audio/Control', HYSAudioControl);


    // ─────────────────────────────────────────────────────────────────────────
    // HYS/Material/Baked GI
    // ─────────────────────────────────────────────────────────────────────────
    // Illuminazione cotta da una texture impacchettata su uv1 (R = AO, G e B = due luci
    // cotte, "light G" e "light B", con un nome facoltativo): shader in TJS-baked-gi.mjs. Applicata a ogni
    // modello di stanza, anche a quelli caricati dopo (ctx.onRoomModel). Colori e
    // intensità cambiano al volo (uniform condivise), senza ricompilare.

    // colore da numero 0xRRGGBB, "#rrggbb", nome CSS o {r,g,b} (0…1)
    const toColor = (v) => {
        if (v == null || v === '') return null;
        if (typeof v === 'object' && 'r' in v) return new THREE.Color(Number(v.r), Number(v.g), Number(v.b));
        if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v.trim())) return parseInt(v.trim(), 16);
        return v;
    };
    const finite = (v) => (v === '' || v == null || !Number.isFinite(Number(v))) ? null : Number(v);

    // Pin (nome interno fisso) — l'etichetta di "light G"/"light B" mostra anche il nome dato
    // alla luce nelle proprietà (es. "light G (floor) · color"), vedi _updateLabels.
    const GI_IN = { trigger: 0, materials: 1, map: 2, ao: 3, gColor: 4, gInt: 5, bColor: 6, bInt: 7 };

    function HYSMaterialBakedGI() {
        this.addInput('trigger',            LG.ACTION);
        this.addInput('materials',           'string,array');
        this.addInput('occlusionMap',        'texture,string');
        this.addInput('AO (R) · intensity',  'number');
        this.addInput('light G · color',     'string,number,object');
        this.addInput('light G · intensity', 'number');
        this.addInput('light B · color',     'string,number,object');
        this.addInput('light B · intensity', 'number');
        this.addOutput('done',      LG.EVENT);
        this.addOutput('materials', 'number');
        const P = {
            materials: '', map: '', aoIntensity: 1,
            lightGName: '', lightGColor: '#ffffff', lightGIntensity: 1,
            lightBName: '', lightBColor: '#ffffff', lightBIntensity: 1,
        };
        for (const [k, v] of Object.entries(P)) this.addProperty(k, v);
        const W = (type, name, prop, opts = {}, after = null) =>
            this.addWidget(type, name, P[prop], v => { this.properties[prop] = v; after?.(); }, { property: prop, ...opts });
        const relabel = () => this._updateLabels();
        W('text',   'materials',           'materials');
        W('text',   'occlusion map (URL)', 'map');
        W('number', 'AO (R) · intensity',  'aoIntensity',     { min: 0, max: 1,  step: 1, precision: 2 });
        W('text',   'light G name',        'lightGName', {}, relabel);
        W('text',   'light G · color',     'lightGColor');
        W('number', 'light G · intensity', 'lightGIntensity', { min: 0, max: 20, step: 1, precision: 2 });
        W('text',   'light B name',        'lightBName', {}, relabel);
        W('text',   'light B · color',     'lightBColor');
        W('number', 'light B · intensity', 'lightBIntensity', { min: 0, max: 20, step: 1, precision: 2 });
        this._gi = null;
        this._off = null;
        this._map = null;        // texture caricata da questo nodo (da liberare)
        this._key = null;        // quali materiali + quale mappa sono applicati ora
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [320, 370];
    }
    HYSMaterialBakedGI.title = 'Material Baked GI';
    HYSMaterialBakedGI.desc  = 'Baked lighting of room materials from a map packed on UV2 (the GLB "occlusion"): R = ambient occlusion, G and B = two baked lights, each with color and intensity adjustable on the fly';
    HYSMaterialBakedGI.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): applies the values of the connected inputs. If "materials" or "occlusionMap" changed it reapplies from scratch, otherwise it only updates colors and intensities (on the fly, without recompiling).',
            materials: 'Optional: replaces the "materials" property — text "a, b*, c" or array of names.',
            occlusionMap: 'Optional: texture (e.g. from the output of TJS/Texture/Load, also connecting its "done" to the trigger) or URL. Replaces the "map" property. The same for all the materials of the node.',
            'AO (R) · intensity': 'Optional: strength of the R channel occlusion, 0…1.',
            'light G · color': 'Optional: color of the light baked in the G channel — 0xRRGGBB, "#rrggbb", CSS name or {r,g,b} 0…1.',
            'light G · intensity': 'Optional: multiplier of light G (0 = off).',
            'light B · color': 'Optional: color of the light baked in the B channel (same forms).',
            'light B · intensity': 'Optional: multiplier of light B.',
        },
        outputs: {
            done: 'Trigger (EVENT): values applied.',
            materials: 'Number of materials modified by this node so far (grows as rooms are loaded).',
        },
        properties: {
            materials: 'Names (or parts of names) of the materials, comma separated, case insensitive: "floor, walls" matches "Floor_Room", "Walls.001"… With the wildcards * and ? the pattern applies to the whole name: "Mat*" = names starting with Mat, "*_GI" = names ending with _GI. Empty = all the materials of the rooms that have the map. A material belongs to one Baked GI node only (the first that takes it).',
            map: 'Empty (recommended) = the occlusion map already in the GLB, one per material: in Blender connect it as "Occlusion" of the glTF Material Output, on the second UV (TEXCOORD_1), with the three channels packed. Or the absolute URL of an image (https://… or /RA_Data/…): the same for all the materials of the node. Do not use an image shared with Metallic/Roughness (there G and B are roughness and metalness).',
            aoIntensity: 'Strength of the ambient occlusion of the R channel (0 = none, 1 = full). Replaces the "strength" of the GLB occlusion.',
            lightGName: 'Optional: what the light baked in the G channel represents (e.g. "floor"). It appears in the labels of pins and fields: "light G (floor) · color".',
            lightGColor: 'Color of light G, e.g. "#ffe8c0".',
            lightGIntensity: 'Multiplier of light G (0 = off).',
            lightBName: 'Optional: what the light baked in the B channel represents (e.g. "ceiling").',
            lightBColor: 'Color of light B.',
            lightBIntensity: 'Multiplier of light B (0 = off).',
        },
    };
    /** Etichette di pin e campi con i nomi dati alle luci: "light G (floor) · color". */
    HYSMaterialBakedGI.prototype._updateLabels = function () {
        const names = { G: String(this.properties.lightGName ?? '').trim(), B: String(this.properties.lightBName ?? '').trim() };
        const lab = (text) => {
            const m = /^light ([GB])(.*)$/.exec(text);
            if (!m || !names[m[1]] || m[2] === ' name') return null;   // il campo del nome resta com'è
            return `light ${m[1]} (${names[m[1]]})${m[2]}`;
        };
        for (const inp of this.inputs ?? []) inp.label = lab(inp.name) ?? undefined;
        for (const w of this.widgets ?? []) w.label = lab(w.name) ?? undefined;
        this.setDirtyCanvas?.(true, true);
    };
    HYSMaterialBakedGI.prototype.onConfigure = function () { this._updateLabels(); };
    HYSMaterialBakedGI.prototype._values = function () {
        const p = this.properties;
        const inp = (k) => this.getInputData(GI_IN[k]);
        return {
            aoIntensity: finite(inp('ao'))   ?? finite(p.aoIntensity) ?? 1,
            gColor:      toColor(inp('gColor')) ?? toColor(p.lightGColor) ?? 0xffffff,
            gIntensity:  finite(inp('gInt')) ?? finite(p.lightGIntensity) ?? 1,
            bColor:      toColor(inp('bColor')) ?? toColor(p.lightBColor) ?? 0xffffff,
            bIntensity:  finite(inp('bInt')) ?? finite(p.lightBIntensity) ?? 1,
        };
    };
    /** Filtri sui nomi: ingresso (testo o array) o proprietà. */
    HYSMaterialBakedGI.prototype._filters = function () {
        const src = this.getInputData(GI_IN.materials) ?? this.properties.materials;
        const list = Array.isArray(src) ? src : String(src ?? '').split(/[,;\n]+/);
        return list.map(t => String(t).trim().toLowerCase()).filter(Boolean);
    };
    /** Mappa: texture o URL dall'ingresso, altrimenti URL della proprietà, altrimenti null (= GLB). */
    HYSMaterialBakedGI.prototype._mapSource = function () {
        const inp = this.getInputData(GI_IN.map);
        if (inp?.isTexture) return inp;
        const url = String(inp ?? this.properties.map ?? '').trim();
        return url || null;
    };
    HYSMaterialBakedGI.prototype._keyOf = function (filters, src) {
        return filters.join('|') + '§' + (src?.isTexture ? 'tex:' + src.uuid : String(src ?? ''));
    };
    /** Applica da capo: stacca il gruppo precedente, prepara la mappa, prende i materiali. */
    HYSMaterialBakedGI.prototype._applyAll = async function () {
        this.onStop();
        const ctx = ctxOf(this);
        if (!ctx?.onRoomModel) return;
        const filters = this._filters();
        const src = this._mapSource();
        const gi = TJS_createBakedGI(this._values());
        this._gi = gi;
        this._key = this._keyOf(filters, src);

        let map = null;
        if (src?.isTexture) map = src;                          // texture di un altro nodo: non è nostra
        else if (src) {
            try { map = await new THREE.TextureLoader().loadAsync(src); this._map = map; }
            catch (e) { ctx.notice?.(`Baked GI: map "${src}" not loaded (${e?.message ?? e}).`); }
            if (this._gi !== gi) { map?.dispose(); return; }    // fermato nel frattempo
        }

        // con * o ? = modello sull'intero nome (Mat* = inizia con Mat), senza = pezzo di nome
        const tests = filters.map((f) => {
            if (!/[*?]/.test(f)) return (n) => n.toLowerCase().includes(f);
            const body = f.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
            const re = new RegExp('^' + body + '$', 'i');
            return (n) => re.test(n);
        });
        const wanted = (m) => !tests.length || tests.some((t) => t(String(m?.name ?? '')));
        const skipped = { noMap: 0, other: 0 };
        this._off = ctx.onRoomModel((root) => {
            root.traverse((o) => {
                if (!o.isMesh) return;
                for (const m of [].concat(o.material)) {
                    if (!wanted(m) || gi.apply(m, map)) continue;
                    const owner = TJS_bakedGIOwner(m);
                    if (owner && owner !== gi) skipped.other++; else skipped.noMap++;
                }
            });
            this.setOutputData(this.findOutputSlot('materials'), gi.count);
        });
        this.setOutputData(this.findOutputSlot('materials'), gi.count);
        if (skipped.other) {
            ctx.notice?.(`Baked GI: ${skipped.other} materials already belong to another Baked GI node (the first one wins): make the "materials" filters of the nodes different from each other.`);
        } else if (!gi.count) {
            ctx.notice?.('Baked GI: no material modified' + (skipped.noMap ? ` (${skipped.noMap} without map or without lights)` : '') +
                         '. The packed map goes in the GLB as "Occlusion" on the second UV, or is set in "map".');
        }
        this.triggerSlot(this.findOutputSlot('done'));
    };
    HYSMaterialBakedGI.prototype.onStart = function () { this._applyAll(); };
    HYSMaterialBakedGI.prototype.onStop = function () {
        this._off?.();
        this._off = null;
        this._gi?.remove();
        this._gi = null;
        this._map?.dispose();
        this._map = null;
        this._key = null;
    };
    HYSMaterialBakedGI.prototype.onAction = function () {
        const key = this._keyOf(this._filters(), this._mapSource());
        if (!this._gi || key !== this._key) { this._applyAll(); return; }   // altri materiali o altra mappa
        this._gi.set(this._values());                                        // solo valori: al volo
        this.triggerSlot(this.findOutputSlot('done'));
    };
    HYSMaterialBakedGI.prototype.onPropertyChanged = function (name) {
        if (name === 'lightGName' || name === 'lightBName') { setTimeout(() => this._updateLabels(), 0); return; }
        if (!this._gi) return;
        if (name === 'materials' || name === 'map') setTimeout(() => this._applyAll(), 0);
        else setTimeout(() => this._gi?.set(this._values()), 0);
    };
    LG.registerNodeType('HYS/Material/Baked GI', HYSMaterialBakedGI);
}
