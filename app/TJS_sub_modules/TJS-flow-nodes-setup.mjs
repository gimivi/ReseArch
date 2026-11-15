// TJS_sub_modules/TJS-flow-nodes-setup.mjs
//
// Nodi FLE "di capacità" per i pannelli TJS: attivano una specializzazione installando
// un'estensione dall'elenco chiuso (TJS-ext-registry.mjs) nel pannello del grafo
// (appContext.ext, vedi TJS-extensions.mjs). Il grafo configura e reagisce; il lavoro
// per frame lo fa l'estensione, dentro il ciclo di TJS.
//
//   TJS/Setup/Walkthrough   visita in prima persona (camminata, collisioni, gamepad)
//   TJS/Setup/Audio         musica di sottofondo: playlist dal workpackage o radio
//   TJS/Audio/Control       play / pausa / successivo / volume
//   TJS/Events/Zone Enter   entrata/uscita del visitatore da una zona del modello
//
// Ogni nodo installa all'avvio del grafo (onStart) e rilascia all'arresto (onStop):
// l'estensione resta finché qualche grafo la usa (conteggio d'uso dell'host).
// Registrati da registerTJSFlowNodes() (TJS-flow-nodes.mjs).

import { TJS_useExtension, TJS_releaseExtension } from "./TJS-ext-registry.mjs";

export function registerTJSSetupNodes() {
    const LG = window.LiteGraph;
    if (!LG) return;
    if (window._TJS_SETUP_NODES_REGISTERED) return;
    window._TJS_SETUP_NODES_REGISTERED = true;

    const ACTION = LG.ACTION ?? -1;
    const EVENT  = LG.EVENT  ?? -1;

    // Tassonomia colori (_doc/module-fle-architettura.md §10): Set / Eventi
    const SETCOLOR = '#2a1a4a', SETBGCOLOR = '#4a1d96';
    const EVCOLOR  = '#062a1a', EVBGCOLOR  = '#0a4a2e';

    const ctxOf = (node) => node.graph?._appContext ?? null;
    const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    // Punto → [x,y,z] (stesso formato di _readPoint3 in TJS-flow-nodes.mjs, _doc/module-tjs-threejs.md §7.0):
    // anche i punti collimati e gli Object3D, di cui si usa .position (2026-10-19)
    const vec3 = (v) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && v.position && typeof v.position === 'object') v = v.position;
        if (Array.isArray(v)) return v.length >= 3 ? v.slice(0, 3).map(Number) : null;
        if (v && typeof v === 'object' && 'x' in v) return [Number(v.x), Number(v.y ?? 0), Number(v.z ?? 0)];
        const n = String(v ?? '').trim().split(/[\s,;]+/).filter(Boolean).map(Number);
        return n.length >= 3 && n.slice(0, 3).every(Number.isFinite) ? n.slice(0, 3) : null;
    };


    // ─────────────────────────────────────────────────────────────────────────
    // TJS/Setup/Walkthrough
    // ─────────────────────────────────────────────────────────────────────────
    function TJSSetupWalkthrough() {
        this.addInput('enter',         ACTION);
        this.addInput('exit',          ACTION);
        this.addInput('startPosition', 'array,string,object');
        this.addOutput('ready',    EVENT);
        this.addOutput('active',   'boolean');
        this.addOutput('position', 'array');
        const P = {
            height: 1.65, speed: 1.8, gravity: true, collisions: true, collider: '',
            startPosition: '', direction: '', fov: 0, autoStart: true, headset: true, snap: 30,
            touch: 'stick', touchSensitivity: 1,
        };
        for (const [k, v] of Object.entries(P)) this.addProperty(k, v);
        this.addWidget('number', 'eye height m',    P.height, v => { this.properties.height = v; }, { property: 'height', min: 0.3, max: 3, step: 0.5, precision: 2 });
        this.addWidget('number', 'speed m/s',       P.speed,  v => { this.properties.speed = v; },  { property: 'speed', min: 0.2, max: 20, step: 1, precision: 1 });
        this.addWidget('toggle', 'gravity',         P.gravity,    v => { this.properties.gravity = v; },    { property: 'gravity' });
        this.addWidget('toggle', 'collisions',      P.collisions, v => { this.properties.collisions = v; }, { property: 'collisions' });
        this.addWidget('text',   'collider',        P.collider,   v => { this.properties.collider = v; },   { property: 'collider' });
        this.addWidget('text',   'start x,y,z',     P.startPosition, v => { this.properties.startPosition = v; }, { property: 'startPosition' });
        this.addWidget('text',   'direction °',     P.direction,  v => { this.properties.direction = v; },  { property: 'direction' });
        this.addWidget('number', 'fov °',           P.fov,        v => { this.properties.fov = Math.max(0, v); }, { property: 'fov', min: 0, max: 120, step: 50, precision: 0 });
        this.addWidget('toggle', 'auto start',      P.autoStart, v => { this.properties.autoStart = v; }, { property: 'autoStart' });
        this.addWidget('toggle', 'headset (WebXR)', P.headset, v => { this.properties.headset = v; }, { property: 'headset' });
        this.addWidget('number', 'VR snap °',       P.snap, v => { this.properties.snap = Math.max(5, Math.min(90, v)); }, { property: 'snap', min: 5, max: 90, step: 50, precision: 0 });
        this.addWidget('combo',  'touch',           P.touch,  v => { this.properties.touch = v; }, { values: ['stick', 'tap to go'], property: 'touch' });
        this.addWidget('number', 'touch sensitivity', P.touchSensitivity, v => { this.properties.touchSensitivity = Math.max(0.2, Math.min(4, v)); }, { property: 'touchSensitivity', min: 0.2, max: 4, step: 1, precision: 2 });
        this._ext = null;
        this._inst = null;
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [270, 390];
    }
    TJSSetupWalkthrough.title = 'Setup Walkthrough';
    TJSSetupWalkthrough.desc  = 'First-person tour of the model: walking with collisions and steps, mouse look, keyboard, gamepad, pick at the center';
    TJSSetupWalkthrough.portHelp = {
        inputs: {
            enter:         'Trigger (ACTION): enters first person (if "startPosition" is connected, moves there).',
            exit:          'Trigger (ACTION): back to the orbit view.',
            startPosition: 'Optional: feet position [x, y, z] (array, "x,y,z" or {x,y,z}) used by "enter".',
        },
        outputs: {
            ready:    'Trigger (EVENT): extension loaded and configured.',
            active:   'true while in first person.',
            position: 'Feet position [x, y, z], updated at every graph step.',
        },
        properties: {
            height: 'Eye height above the floor, in meters.',
            speed: 'Walking speed at full pace, m/s (normal pace ≈ 1.4–1.8).',
            gravity: 'On: you walk on the floors (steps up to 35 cm, falls bring you back to the last support). Off: you stay at the starting height.',
            collisions: 'On: colliders stop the visitor (walls).',
            collider: 'Names of the model nodes acting as walls/floors, comma-separated (e.g. "Walls, Floors, Stairs"). Empty = all visible meshes of the models (simpler, slower on heavy models).',
            startPosition: 'Feet position "x,y,z" on entering. Empty = below the current camera.',
            direction: 'View direction on entering, in degrees around the vertical axis (0 = towards −Z, 90 = towards −X). Empty = the current one.',
            fov: 'Vertical field of view in first person, in degrees (0 = the camera\'s).',
            autoStart: 'On: when the object opens you start in first person. Off: you enter from the object menu, the toolbar button or the "enter" trigger.',
            headset: 'On: if the browser offers a headset (Meta Quest Browser, WebXR emulator) the object menu shows the VR entry. In VR: left stick walks, right stick snap-turns, trigger = pick along the ray, B/Y held 1.5 s = exit. Requires the perspective view.',
            snap: 'Snap-turn angle in VR (right stick), in degrees.',
            touch: 'Tablet/phone, in first person: stick = left thumb to walk, drag on the right to look, tap = pick at the point; tap to go = tap the floor and walk there (same physics, stops if blocked), drag anywhere to look, tap elsewhere = pick. Long press = pick in both modes. The visitor can change mode from the object menu.',
            touchSensitivity: 'Rotation multiplier when dragging to look: 1 = the point under the finger follows it (like Street View).',
        },
    };
    TJSSetupWalkthrough.prototype._options = function () {
        const p = this.properties;
        const dir = String(p.direction ?? '').trim();
        return {
            height: num(p.height, 1.65), speed: num(p.speed, 1.8),
            gravity: !!p.gravity, collisions: !!p.collisions, colliders: String(p.collider ?? ''),
            start: vec3(p.startPosition), yawDeg: dir === '' ? null : num(dir, null),
            fovDeg: num(p.fov, 0), autoStart: !!p.autoStart,
            vr: p.headset !== false, snapDeg: num(p.snap, 30),
            touchMode: p.touch === 'tap to go' ? 'tap' : 'stick', touchLook: num(p.touchSensitivity, 1),
        };
    };
    TJSSetupWalkthrough.prototype.onStart = function () {
        const ext = ctxOf(this)?.ext;
        if (!ext) return;
        this._ext = ext;
        TJS_useExtension(ext, 'walkthrough', this._options()).then((inst) => {
            if (this._ext !== ext) return;   // fermato nel frattempo
            this._inst = inst;
            if (inst) this.triggerSlot(0);
        });
    };
    TJSSetupWalkthrough.prototype.onStop = function () {
        if (this._ext) TJS_releaseExtension(this._ext, 'walkthrough');
        this._ext = null;
        this._inst = null;
    };
    TJSSetupWalkthrough.prototype.onPropertyChanged = function () {
        // modifiche dall'editor mentre il grafo gira ("Testa su panel"): subito applicate
        if (this._inst) setTimeout(() => this._inst?.configure(this._options()), 0);
    };
    TJSSetupWalkthrough.prototype.onAction = function (action) {
        const inst = this._inst;
        if (!inst) return;
        if (action === 'exit') { inst.exit(); return; }
        const at = vec3(this.getInputData(2));
        inst.enter();
        if (at) inst.teleport(at);
    };
    TJSSetupWalkthrough.prototype.onExecute = function () {
        const inst = this._inst;
        this.setOutputData(1, !!inst?.active);
        this.setOutputData(2, inst ? inst.position : null);
    };
    LG.registerNodeType('TJS/Setup/Walkthrough', TJSSetupWalkthrough);


    // ─────────────────────────────────────────────────────────────────────────
    // TJS/Setup/Audio
    // ─────────────────────────────────────────────────────────────────────────
    const SOURCES = ['playlist', 'stream'];

    function TJSSetupAudio() {
        this.addInput('trigger',  ACTION);
        this.addInput('source',   'string,array');
        this.addOutput('done',    EVENT);
        this.addOutput('tracks',  'number');
        const P = { type: 'playlist', paths: 'Musica/', url: 'https://ice1.somafm.com/dronezone-128-mp3',
                    shuffle: true, volume: 0.35, fade: 3, autoStart: true };
        for (const [k, v] of Object.entries(P)) this.addProperty(k, v);
        this.addWidget('combo',  'type',          P.type,     v => { this.properties.type = v; },     { values: SOURCES, property: 'type' });
        this.addWidget('text',   'paths',         P.paths,    v => { this.properties.paths = v; },    { property: 'paths' });
        this.addWidget('text',   'radio url',     P.url,      v => { this.properties.url = v; },      { property: 'url' });
        this.addWidget('toggle', 'shuffle',       P.shuffle,  v => { this.properties.shuffle = v; },  { property: 'shuffle' });
        this.addWidget('slider', 'volume',        P.volume,   v => { this.properties.volume = v; },   { property: 'volume', min: 0, max: 1, step: 0.05 });
        this.addWidget('number', 'fade s',        P.fade, v => { this.properties.fade = Math.max(0, v); }, { property: 'fade', min: 0, max: 20, step: 5, precision: 1 });
        this.addWidget('toggle', 'auto start',    P.autoStart, v => { this.properties.autoStart = v; }, { property: 'autoStart' });
        this._ext = null;
        this._ready = null;
        this.color   = SETCOLOR;
        this.bgcolor = SETBGCOLOR;
        this.size    = [280, 240];
    }
    TJSSetupAudio.title = 'Setup Audio';
    TJSSetupAudio.desc  = 'Background music of the panel: audio files of the work package (playlist) or streaming radio';
    TJSSetupAudio.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): (re)loads the source and starts the music.',
            source:  'Optional: replaces "paths" (playlist) or "radio url" (stream).',
        },
        outputs: {
            done:   'Trigger (EVENT): music set.',
            tracks: 'Number of tracks in the playlist (1 for the stream).',
        },
        properties: {
            type: 'playlist = audio files; stream = internet radio.',
            paths: 'Playlist: one or more paths separated by comma, semicolon or new line, RELATIVE to the work package folder of the flow: a file ("Musica/track1.mp3") or a folder ("Musica/" = all audio files inside, subfolders included). Absolute URLs are accepted too.',
            url: 'Stream: address of the audio stream (mp3/aac). Check the radio\'s terms of use for a public site.',
            shuffle: 'Playlist in random order (new order at every round).',
            volume: 'Volume, 0…1 (background: 0.2–0.4).',
            fade: 'Seconds of fade in and fade out.',
            autoStart: 'On: starts when the object opens (the browser plays it from the first click or key in the panel). ☰ menu: music on/off.',
        },
    };
    TJSSetupAudio.prototype._apply = async function () {
        const ext = this._ext;
        const inst = await this._ready;
        if (!inst || this._ext !== ext) return;
        const p = this.properties;
        const src = this.getInputData(1);
        const opts = { volume: num(p.volume, 0.35), fadeIn: num(p.fade, 3), fadeOut: num(p.fade, 3) };
        const flowId = this.graph?._flowId ?? null;
        if (p.type === 'stream') {
            const [url] = await inst.resolveMedia(src ?? p.url, { flowId });
            if (!url || this._ext !== ext) return;
            inst.audio.setStream(url, opts);
            this.setOutputData(1, 1);
        } else {
            const urls = await inst.resolveMedia(src ?? p.paths, { flowId });
            if (this._ext !== ext) return;
            this.setOutputData(1, urls.length);
            if (!urls.length) { inst.notice(`no audio file found in "${String(src ?? p.paths)}".`); return; }
            inst.audio.setPlaylist(urls, { ...opts, shuffle: !!p.shuffle });
        }
        inst.audio.play();
        this.triggerSlot(0);
    };
    TJSSetupAudio.prototype.onStart = function () {
        const ext = ctxOf(this)?.ext;
        if (!ext) return;
        this._ext = ext;
        this._ready = TJS_useExtension(ext, 'audio');
        if (this.properties.autoStart) this._apply();
    };
    TJSSetupAudio.prototype.onStop = function () {
        if (this._ext) TJS_releaseExtension(this._ext, 'audio');
        this._ext = null;
        this._ready = null;
    };
    TJSSetupAudio.prototype.onAction = function () { if (this._ext) this._apply(); };
    LG.registerNodeType('TJS/Setup/Audio', TJSSetupAudio);


    // ─────────────────────────────────────────────────────────────────────────
    // TJS/Audio/Control
    // ─────────────────────────────────────────────────────────────────────────
    const ACTIONS = ['play', 'pause', 'play/pause', 'next track', 'volume'];

    function TJSAudioControl() {
        this.addInput('trigger', ACTION);
        this.addInput('volume',  'number');
        this.addOutput('done',   EVENT);
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
    TJSAudioControl.title = 'Audio Control';
    TJSAudioControl.desc  = 'Controls the music set by TJS/Setup/Audio: play, pause, next track, volume (with ramp)';
    TJSAudioControl.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): runs the chosen action.',
            volume:  'Optional ("volume" action): replaces the "volume" property, 0…1.',
        },
        outputs: { done: 'Trigger (EVENT): action executed.' },
        properties: {
            action: 'play | pause (with fade) | play/pause | next track | volume.',
            volume: 'Target volume for the "volume" action, 0…1.',
            seconds: 'Duration of the volume ramp in seconds.',
        },
    };
    TJSAudioControl.prototype.onAction = function () {
        const a = ctxOf(this)?.ext?.get('audio')?.audio;
        if (!a) return;
        switch (this.properties.action) {
            case 'play':             a.play(); break;
            case 'pause':            a.pause(); break;
            case 'play/pause':       a.toggle(); break;
            case 'next track':       a.next(); break;
            case 'volume': {
                const v = this.getInputData(1);
                a.setVolume(Number.isFinite(v) ? v : this.properties.volume, this.properties.seconds);
                break;
            }
            default: return;
        }
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Audio/Control', TJSAudioControl);


    // ─────────────────────────────────────────────────────────────────────────
    // TJS/Events/Zone Enter
    // ─────────────────────────────────────────────────────────────────────────
    function TJSEventsZoneEnter() {
        this.addOutput('enter',  EVENT);
        this.addOutput('exit',   EVENT);
        this.addOutput('inside', 'boolean');
        this.addOutput('zone',   'string');
        const P = { name: 'Zone', object: '', margin: 0, center: '0,1,0', size: '2,3,2', dynamic: false };
        for (const [k, v] of Object.entries(P)) this.addProperty(k, v);
        this.addWidget('text',   'name',         P.name,    v => { this.properties.name = v; },    { property: 'name' });
        this.addWidget('text',   'object',       P.object,  v => { this.properties.object = v; },  { property: 'object' });
        this.addWidget('number', 'margin m',     P.margin,  v => { this.properties.margin = v; },  { property: 'margin', min: -5, max: 20, step: 1, precision: 2 });
        this.addWidget('text',   'center x,y,z', P.center,  v => { this.properties.center = v; },  { property: 'center' });
        this.addWidget('text',   'size',         P.size,    v => { this.properties.size = v; },    { property: 'size' });
        this.addWidget('toggle', 'moving object', P.dynamic, v => { this.properties.dynamic = v; }, { property: 'dynamic' });
        this._ext = null;
        this._remove = null;
        this._events = [];
        this._inside = false;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [260, 200];
    }
    TJSEventsZoneEnter.title = 'Events Zone Enter';
    TJSEventsZoneEnter.desc  = 'Fires when the visitor enters or leaves a zone of the model (feet in first person, otherwise the camera)';
    TJSEventsZoneEnter.portHelp = {
        outputs: {
            enter:  'Trigger (EVENT): the visitor entered the zone.',
            exit:   'Trigger (EVENT): the visitor left the zone.',
            inside: 'true while the visitor is in the zone.',
            zone:   'Name of the zone ("name" property).',
        },
        properties: {
            name: 'Name of the zone, written to the "zone" output.',
            object: 'Name of an object of the model: the zone is its bounding box enlarged by "margin". Empty = zone defined by center and size.',
            margin: 'Meters added on every side of the object\'s bounding box (negative = shrinks).',
            center: 'Center of the zone "x,y,z" (if "object" is empty).',
            size: 'Size of the zone "x,y,z" in meters (if "object" is empty). For the walkthrough the feet + 50 cm are checked: a zone on the ground at least 1 m high works.',
            dynamic: 'On if the object moves (animations): the bounding box is recomputed at every frame.',
        },
    };
    TJSEventsZoneEnter.prototype.onStart = function () {
        const ext = ctxOf(this)?.ext;
        if (!ext) return;
        this._ext = ext;
        this._events = [];
        this._inside = false;
        const p = this.properties;
        TJS_useExtension(ext, 'zones').then((zones) => {
            if (!zones || this._ext !== ext) return;
            this._remove = zones.add({
                name: String(p.name ?? ''),
                objectName: String(p.object ?? '').trim() || null,
                margin: num(p.margin, 0),
                center: vec3(p.center) ?? [0, 1, 0],
                size: vec3(p.size) ?? [2, 3, 2],
                dynamic: !!p.dynamic,
                onEnter: () => { this._inside = true;  this._events.push(0); },
                onExit:  () => { this._inside = false; this._events.push(1); },
            });
        });
    };
    TJSEventsZoneEnter.prototype.onStop = function () {
        this._remove?.();
        this._remove = null;
        if (this._ext) TJS_releaseExtension(this._ext, 'zones');
        this._ext = null;
    };
    TJSEventsZoneEnter.prototype.onExecute = function () {
        this.setOutputData(2, this._inside);
        this.setOutputData(3, String(this.properties.name ?? ''));
        while (this._events.length) this.triggerSlot(this._events.shift());
    };
    LG.registerNodeType('TJS/Events/Zone Enter', TJSEventsZoneEnter);
}
