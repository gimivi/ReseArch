// TJS_sub_modules/TJS-flow-nodes.mjs
// Nodi LiteGraph context-aware per Three.js.
//
// Ogni nodo legge this.graph._appContext per accedere agli oggetti live
// della scena (scene, camera, renderer, orbitControls, lastHit, localEvents,
// signal…). L'_appContext viene iniettato dal TJS-flow-runner al momento
// della creazione del grafo → ogni pannello ha il suo LGraph con il suo
// contesto isolato.
//
// TJS/Events/* — nodi reattivi (onPick, onSelectionChanged, onCameraSettled)
//
// Registrazione idempotente tramite flag window._TJS_FLOW_NODES_REGISTERED.

import { THREE, loadAnyModel } from './TJS-loaders.mjs';
import { TJS_checkModel } from './TJS-model-check.mjs';
import { TJS_exportGlb } from './TJS-glb-export.mjs';
import { registerTJSSetupNodes } from './TJS-flow-nodes-setup.mjs';
import { registerTJSPanoramaNodes } from './TJS-flow-nodes-panorama.mjs';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export function registerTJSFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[TJS-flow-nodes] LiteGraph not available'); return; }
    if (window._TJS_FLOW_NODES_REGISTERED) return;
    window._TJS_FLOW_NODES_REGISTERED = true;

    // Nodi di capacità (TJS/Setup/*, Audio/Control, Events/Zone Enter): file a parte
    registerTJSSetupNodes();
    // Misura sulle panoramiche con la mappa delle distanze (TJS/Panorama/*): file a parte
    registerTJSPanoramaNodes();

    const ACTION = LG.ACTION ?? -1;
    const EVENT  = LG.EVENT  ?? -1;

    const EVCOLOR   = '#062a1a';
    const EVBGCOLOR = '#0a4a2e';

    // Segna un cambiamento visivo sul contesto condiviso del grafo, chiamando
    // markDirty() direttamente sul render loop del pannello target.
    //
    // Storia (2026-09-19): prima impostava solo `ctx._visualChanged = true`,
    // letto poi dal render loop di model_TJS.mjs iterando `state.flowGraphs`.
    // Funzionava nel flow embedded reale (quei grafi SONO in `state.flowGraphs`)
    // ma restava inerte quando il grafo gira altrove — es. dentro model_FLE.mjs
    // per "Testa su panel"/editing a due pannelli, un LGraph separato mai
    // inserito in quell'array: i dati cambiavano, il canvas no. Chiamare
    // `ctx.markDirty()` qui elimina la dipendenza da QUALE array contiene il
    // grafo — funziona identico in ogni scenario, perché ogni _appContext
    // valido (reale o iniettato) espone sempre `markDirty`. `_visualChanged`
    // è stato quindi rimosso ovunque (era ridondante con questo, non
    // un meccanismo alternativo necessario) — vedi TJS-flow-runner.mjs,
    // model_FLE.mjs, model_TJS.mjs.
    function _ctxDirty(node) {
        node.graph?._appContext?.markDirty?.();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Events — nodi reattivi (pattern onStart → _pending → onExecute),
    // stesso schema di MPS/Events/* (MPS-flow-nodes.mjs). OnPick e
    // OnSelectionChanged si agganciano a state.localEvents (dispatch aggiunto
    // in model_TJS.mjs, stessi punti che già alimentano tjsBusEmit — nessuna
    // logica duplicata). OnCameraSettled ascolta invece direttamente l'evento
    // nativo 'change' di OrbitControls (Three.js), con un debounce locale.
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── Uscite opzionali (menu "Outputs" del nodo) ─────────────────────────
    // (2026-10-03) Nei nodi che riportano i dati di un'intersezione (pick,
    // selezione, punti collimati) solo le uscite principali sono presenti di
    // default; le altre si aggiungono con tasto destro sul nodo → Outputs e si
    // tolgono con tasto destro sulla porta → Remove Slot.
    // Meccanica LiteGraph 0.7.18 (verificata sul bundle reale): la voce
    // "Outputs" del menu si abilita solo se il nodo ha onGetOutputs(); le uscite
    // aggiunte da lì vanno IN CODA, quindi l'ordine delle porte varia da nodo a
    // nodo → questi nodi scrivono le uscite PER NOME (_out), mai per indice.
    // I flow salvati prima mantengono le porte che avevano (LiteGraph le
    // ripristina dal JSON): _markRemovable le rende rimovibili come le nuove.
    const HIT_OPTIONAL_OUTPUTS = [
        ['appObject', 'object'],
        ['model',     'object'],
        ['normal',    'object'],
        ['face',      'number'],
        ['uv',        'object'],
        ['uv1',       'object'],
    ];
    // Punti collimati (TJS/Pick/*): non portano appObject/model
    const PICK_OPTIONAL_OUTPUTS = HIT_OPTIONAL_OUTPUTS.filter(([n]) => n !== 'appObject' && n !== 'model');

    /** Voci per il menu "Outputs": solo quelle non ancora presenti sul nodo. */
    function _optionalOutputs(node, list) {
        return list
            .filter(([name]) => node.findOutputSlot(name) === -1)
            .map(([name, type]) => [name, type, { removable: true }]);
    }
    /** Rende rimovibili le uscite opzionali già presenti (flow salvati prima). */
    function _markRemovable(node, list) {
        for (const o of node.outputs ?? []) {
            if (list.some(([name]) => name === o.name)) o.removable = true;
        }
    }
    /** Scrive un'uscita per nome; no-op se il nodo non ce l'ha. */
    function _out(node, name, value) {
        const i = node.findOutputSlot(name);
        if (i !== -1) node.setOutputData(i, value);
    }
    /** Emette un evento su un'uscita per nome; no-op se il nodo non ce l'ha. */
    function _fire(node, name, param) {
        const i = node.findOutputSlot(name);
        if (i !== -1) node.triggerSlot(i, param);
    }
    /** Testo comune per l'Help delle uscite opzionali. */
    const OPT = ' (optional: right-click the node → Outputs)';

    function _emitFromHit(node, hit) {
        const so = hit?.sceneObject ?? null;
        _out(node, 'appObject',   hit?.appObject ?? null);
        _out(node, 'model',       hit?.model     ?? null);
        _out(node, 'sceneObject', so);
        _out(node, 'hitPoint',    so?.hitPoint ?? null);
        _out(node, 'normal',      so?.normal   ?? null);
        _out(node, 'face',        so?.face     ?? null);
        _out(node, 'uv',          so?.uv       ?? null);
        _out(node, 'uv1',         so?.uv1      ?? null);
        // 'oggetto' (solo sui nodi che ce l'hanno): THREE.Object3D vivo cercato
        // per uuid, come TJS/Selection/Get — sceneObject è solo un'istantanea dati
        const scene = node.graph?._appContext?.scene;
        _out(node, 'object', so?.uuid && scene ? (scene.getObjectByProperty('uuid', so.uuid) ?? null) : null);
        const t = node.findOutputSlot('trigger');
        if (t !== -1) node.triggerSlot(t);
    }

    const HIT_PORT_HELP = {
        appObject:   '{objId, objApp, objName} — the ReseArch object' + OPT,
        model:       '{modId, modName, position} — the model (mod_id) that was hit' + OPT,
        sceneObject: '{name, type, uuid, position, hitPoint, normal, face, materialIndex, uv, uv1} — the three.js object that was hit, with all the point data',
        hitPoint:    '{x,y,z} — hit point, world coordinates (shortcut for sceneObject.hitPoint)',
        normal:      '{x,y,z} — face normal at the hit point, in the object\'s local space' + OPT,
        face:        'number — index of the triangle hit; the material index is in sceneObject.materialIndex' + OPT,
        uv:          '{u,v} — map coordinates of the hit point (main UV channel). null if the geometry has no UV (point clouds, lines, unmapped meshes). Pixel on the image: x = u × width, y = (1 − v) × height, unless the texture has repeat/offset' + OPT,
        uv1:         '{u,v} — like uv, on the second UV channel (separate lightmap/AO); null if missing' + OPT,
    };

    // ─── TJS/Events/OnPick ──────────────────────────────────────────────────
    function TJSEventsOnPick() {
        this.addOutput('trigger',     EVENT);
        this.addOutput('sceneObject', 'object');
        this.addOutput('hitPoint',    'object');
        this._pending = null;
        this._bus     = null;
        this._handler = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    TJSEventsOnPick.title = 'Events On Pick';
    TJSEventsOnPick.desc  = 'Fires on a pick with the crosshair (EyeLock, Shift+click with the crosshair on) or from the walkthrough. ' +
        'For a normal click in Orbit use Events On Selection Changed. Other outputs (appObject, model, normal, face, uv, uv1): right-click the node → Outputs.';
    TJSEventsOnPick.portHelp = {
        outputs: { trigger: 'event — fired at every successful pick', ...HIT_PORT_HELP },
    };
    TJSEventsOnPick.prototype.onGetOutputs = function () { return _optionalOutputs(this, HIT_OPTIONAL_OUTPUTS); };
    TJSEventsOnPick.prototype.onConfigure  = function () { _markRemovable(this, HIT_OPTIONAL_OUTPUTS); };
    TJSEventsOnPick.prototype.onStart = function () {
        this._cleanup();
        const ctx = this.graph?._appContext;
        const bus = ctx?.localEvents;
        if (!bus || !ctx?.signal) return;
        this._pending = null;
        const g = this.graph, self = this;
        this._handler = ev => { self._pending = ev.detail; try { g.runStep(1); } catch {} };
        bus.addEventListener('pick', this._handler);
        this._bus = bus;
        ctx.signal.addEventListener('abort', () => this._cleanup(), { once: true });
    };
    TJSEventsOnPick.prototype._cleanup = function () {
        if (this._bus && this._handler) this._bus.removeEventListener('pick', this._handler);
        this._bus = null;
        this._handler = null;
    };
    TJSEventsOnPick.prototype.onStop = function () { this._cleanup(); };
    TJSEventsOnPick.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        _emitFromHit(this, p);
    };
    LG.registerNodeType('TJS/Events/OnPick', TJSEventsOnPick);


    // ─── TJS/Events/OnSelectionChanged ────────────────────────────────────────
    function TJSEventsOnSelectionChanged() {
        this.addOutput('trigger',     EVENT);
        this.addOutput('sceneObject', 'object');
        this.addOutput('hitPoint',    'object');
        this.addOutput('object',      0);          // THREE.Object3D, riferimento diretto (lookup per uuid) — 2026-10-04
        this._pending = null;
        this._bus     = null;
        this._handler = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [220, 100];
    }
    TJSEventsOnSelectionChanged.title = 'Events On Selection Changed';
    TJSEventsOnSelectionChanged.desc  = 'Fires when the selection changes (click in Orbit, Transform tool). ' +
        'Point data (hitPoint, normal, face, uv) is present only if the selection comes from a click. Other outputs: right-click the node → Outputs.';
    TJSEventsOnSelectionChanged.portHelp = {
        outputs: {
            trigger: 'event — fired at every selection change',
            ...HIT_PORT_HELP,
            object:  'THREE.Object3D — direct reference to the selected object (looked up by uuid), null if no longer in the scene — connect it to Set Transform/Set Material/Anim Apply Transform/etc.',
        },
    };
    TJSEventsOnSelectionChanged.prototype.onGetOutputs = function () { return _optionalOutputs(this, HIT_OPTIONAL_OUTPUTS); };
    TJSEventsOnSelectionChanged.prototype.onConfigure  = function () {
        _markRemovable(this, HIT_OPTIONAL_OUTPUTS);
        // Flow salvati prima del 2026-10-04: l'uscita 'object' manca, la si aggiunge
        // (in coda: le porte salvate restano dove sono, la scrittura è per nome)
        if (this.findOutputSlot('object') === -1) this.addOutput('object', 0);
    };
    TJSEventsOnSelectionChanged.prototype.onStart = function () {
        this._cleanup();
        const ctx = this.graph?._appContext;
        const bus = ctx?.localEvents;
        if (!bus || !ctx?.signal) return;
        this._pending = null;
        const g = this.graph, self = this;
        this._handler = ev => { self._pending = ev.detail; try { g.runStep(1); } catch {} };
        bus.addEventListener('selectionChanged', this._handler);
        this._bus = bus;
        ctx.signal.addEventListener('abort', () => this._cleanup(), { once: true });
    };
    TJSEventsOnSelectionChanged.prototype._cleanup = function () {
        if (this._bus && this._handler) this._bus.removeEventListener('selectionChanged', this._handler);
        this._bus = null;
        this._handler = null;
    };
    TJSEventsOnSelectionChanged.prototype.onStop = function () { this._cleanup(); };
    TJSEventsOnSelectionChanged.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        _emitFromHit(this, p);
    };
    LG.registerNodeType('TJS/Events/OnSelectionChanged', TJSEventsOnSelectionChanged);


    // ─── TJS/Events/OnCameraSettled ───────────────────────────────────────────
    // Ascolta l'evento nativo 'change' di OrbitControls (fires continuamente
    // durante drag/damping) e segnala solo dopo un breve idle — stesso concetto
    // di MPS/Events/OnViewSettled ma via debounce locale (OrbitControls non ha
    // un evento 'end' nativo).
    function TJSEventsOnCameraSettled() {
        this.addProperty('debounce_ms', 250, 'number');
        this.addWidget('number', 'debounce ms', 250, v => { this.properties.debounce_ms = v; }, { property: 'debounce_ms' });
        this.addOutput('trigger',  EVENT);
        this.addOutput('position', 'object');
        this.addOutput('target',   'object');
        this._pending = null;
        this._timer   = null;
        this._ctrl    = null;
        this._handler = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [220, 110];
    }
    TJSEventsOnCameraSettled.title = 'Events On Camera Settled';
    TJSEventsOnCameraSettled.desc  = 'Fires when the camera stops moving (orbit/zoom/pan)';
    const SETTLED_OPTIONAL_OUTPUTS = [['source', 'string']];
    TJSEventsOnCameraSettled.portHelp = {
        outputs: {
            trigger:  'event — fired when the camera stops',
            position: '{x,y,z} — camera position when it stopped',
            target:   '{x,y,z} — OrbitControls target when it stopped',
            source:   'text — who moved the camera: "user" (mouse, touch, keyboard, also if nodes moved it at the same time) or "code" (only flow nodes: Camera FlyTo, Camera Orbit Set, Animate Along Curve on the camera). To react only to the user, e.g. Logic/String/Compare with "user"' + OPT,
        },
        properties: {
            debounce_ms: 'milliseconds without movement before the event fires (default 250)',
        },
    };
    TJSEventsOnCameraSettled.prototype.onStart = function () {
        this._cleanup();
        const ctx = this.graph?._appContext;
        const oc  = ctx?.orbitControls;
        if (!oc || !ctx?.signal) return;
        this._pending = null;
        const g = this.graph, self = this;
        const debounce = Math.max(0, this.properties.debounce_ms ?? 250);
        let byUser = false;   // nel movimento in corso c'è stato almeno un passo dell'utente
        this._handler = () => {
            if (!_isCodeCameraMove(oc)) byUser = true;
            clearTimeout(self._timer);
            self._timer = setTimeout(() => {
                const p = ctx.camera?.position;
                const t = oc.target;
                self._pending = {
                    position: p ? { x: p.x, y: p.y, z: p.z } : null,
                    target:   t ? { x: t.x, y: t.y, z: t.z } : null,
                    source:   byUser ? 'user' : 'code',
                };
                byUser = false;
                try { g.runStep(1); } catch {}
            }, debounce);
        };
        oc.addEventListener('change', this._handler);
        this._ctrl = oc;
        ctx.signal.addEventListener('abort', () => this._cleanup(), { once: true });
    };
    TJSEventsOnCameraSettled.prototype._cleanup = function () {
        clearTimeout(this._timer);
        this._timer = null;
        if (this._ctrl && this._handler) this._ctrl.removeEventListener('change', this._handler);
        this._ctrl = null;
        this._handler = null;
    };
    TJSEventsOnCameraSettled.prototype.onStop = function () { this._cleanup(); };
    TJSEventsOnCameraSettled.prototype.onGetOutputs = function () { return _optionalOutputs(this, SETTLED_OPTIONAL_OUTPUTS); };
    TJSEventsOnCameraSettled.prototype.onConfigure  = function () { _markRemovable(this, SETTLED_OPTIONAL_OUTPUTS); };
    TJSEventsOnCameraSettled.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        _out(this, 'position', p.position);
        _out(this, 'target',   p.target);
        _out(this, 'source',   p.source);
        _fire(this, 'trigger');
    };
    LG.registerNodeType('TJS/Events/OnCameraSettled', TJSEventsOnCameraSettled);


    // ─── TJS/Selection/Get ────────────────────────────────────────────────────
    // Output a 3 livelli: pannello applicativo, modello DB, oggetto Three.js.
    // Shortcuts (hitPoint, normal, face) replicano i campi più usati di sceneObject
    // per collegamento diretto senza nodo intermedio.
    //
    // FIX (2026-09-21): 'sceneObject' è sempre stato solo un'istantanea dati
    // {name,type,uuid,position,...} — MAI il vero riferimento THREE.Object3D,
    // perché model_TJS.mjs (onPick/onSelectionChanged) scrive ctx.lastHit
    // serializzando l'oggetto three.js selezionato, senza conservarne il
    // puntatore. Risultato: il nodo non poteva essere collegato a
    // SetTransform/SetMaterial/GetTransform/ecc. — sembrava "non funzionare"
    // per chi si aspettava di poter agire sull'oggetto selezionato. Aggiunto
    // l'output 'oggetto': ricostruisce il riferimento vivo cercando nella
    // scena l'uuid già presente in sceneObject (THREE.Object3D.
    // getObjectByProperty — lookup nativo, nessuna traverse manuale). Se
    // l'oggetto è stato rimosso/sostituito dopo la selezione, torna null.
    function TJSSelectionGet() {
        this.addInput('trigger', ACTION);
        this.addOutput('sceneObject', 'object');   // {name, type, uuid, position, hitPoint, normal, face, materialIndex, uv, uv1}
        this.addOutput('hitPoint',    'object');   // scorciatoia → sceneObject.hitPoint
        this.addOutput('object',      0);          // THREE.Object3D, riferimento diretto (lookup per uuid)
        // appObject, model, normal, face, uv, uv1: opzionali (menu Outputs, 2026-10-03)
        this.color   = '#1a2a4a';
        this.bgcolor = '#1e3a5f';
        this.size    = [210, 90];
    }
    TJSSelectionGet.title = 'Selection Get';
    TJSSelectionGet.desc  = 'Returns the data of the last selected point/object (3 levels) plus the direct reference. ' +
        'Other outputs (appObject, model, normal, face, uv, uv1): right-click the node → Outputs.';
    TJSSelectionGet.portHelp = {
        inputs: {
            trigger: 'event — reads the current selection when triggered',
        },
        outputs: {
            ...HIT_PORT_HELP,
            sceneObject: '{name, type, uuid, position, hitPoint, normal, face, materialIndex, uv, uv1} — data snapshot of the selected three.js object',
            object:      'THREE.Object3D — direct reference to the selected object (looked up by uuid), null if no longer in the scene — connect it to Set Transform/Set Material/Object Get Transform/etc.',
        },
    };
    TJSSelectionGet.prototype.onGetOutputs = function () { return _optionalOutputs(this, HIT_OPTIONAL_OUTPUTS); };
    TJSSelectionGet.prototype.onConfigure  = function () { _markRemovable(this, HIT_OPTIONAL_OUTPUTS); };
    TJSSelectionGet.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx) return;
        const hit = ctx.lastHit ?? {};
        const so  = hit.sceneObject ?? null;
        _out(this, 'appObject',   hit.appObject ?? null);
        _out(this, 'model',       hit.model     ?? null);
        _out(this, 'sceneObject', so);
        _out(this, 'hitPoint',    so?.hitPoint  ?? null);
        _out(this, 'normal',      so?.normal    ?? null);
        _out(this, 'face',        so?.face      ?? null);
        _out(this, 'uv',          so?.uv        ?? null);
        _out(this, 'uv1',         so?.uv1       ?? null);
        const objRef = so?.uuid && ctx.scene ? (ctx.scene.getObjectByProperty('uuid', so.uuid) ?? null) : null;
        _out(this, 'object', objRef);
    };
    LG.registerNodeType('TJS/Selection/Get', TJSSelectionGet);


    // ─── TJS/Object/SetVisibility ─────────────────────────────────────────────
    // Mostra o nasconde un oggetto per riferimento diretto (priorità) o nome.
    function TJSSetVisibility() {
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'object name', '', v => { this.properties.name = v; }, { property: 'name' });
        this.addInput('trigger',  ACTION);
        this.addInput('object',   0);          // THREE.Object3D — riferimento diretto, ha priorità su 'name' se collegato
        this.addInput('name',     'string');
        this.addInput('visible',  'boolean');
        this.addOutput('done',     EVENT);
        this.addOutput('→object',  0);         // passthrough — solo se agito per riferimento (per nome può applicarsi a più oggetti, nessuno "il" risultato)
        this.color   = '#2a1a4a';
        this.bgcolor = '#4a1d96';
        this.size    = [220, 130];
    }
    TJSSetVisibility.title = 'Set Visibility';
    TJSSetVisibility.desc  = 'Shows or hides a Three.js object by direct reference or by name';
    TJSSetVisibility.portHelp = {
        inputs: {
            trigger: 'event — applies the current visibility',
            object:  'THREE.Object3D — direct reference, optional, takes priority over "name" if connected',
            name:    'text — name of the object in the scene, used only if "object" is not connected, overrides the widget',
            visible: 'boolean — true = visible (default true if not connected)',
        },
        outputs: {
            done:      'event — fired once applied',
            '→object': 'THREE.Object3D — the modified object (passthrough), present only when acting by direct reference — by name it may apply to several objects at once, so it stays empty',
        },
    };
    TJSSetVisibility.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const refObj  = this.getInputData(1);
        const visible = this.getInputData(3) ?? true;
        if (refObj?.isObject3D) {
            refObj.visible = Boolean(visible);
            this.setOutputData(1, refObj);
        } else {
            const name = this.getInputData(2) ?? this.properties.name;
            ctx.scene.traverse(obj => {
                if (obj.name === name) obj.visible = Boolean(visible);
            });
        }
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/SetVisibility', TJSSetVisibility);


    // ─── TJS/Object/Highlight ────────────────────────────────────────────────
    // Evidenzia temporaneamente un oggetto con un colore emissive — per
    // riferimento diretto (priorità) o per nome.
    // (2026-10-08) Solo le mesh scelte si accendono, anche se condividono il materiale con
    // altre: per la durata ogni mesh riceve una COPIA del proprio materiale con l'emissive
    // acceso, poi riprende il materiale originale (la copia viene liberata). Prima si
    // cambiava il colore nel materiale stesso e si accendevano tutte le mesh che lo usano
    // (es. tutti i muri). Contatore per mesh: con evidenziazioni sovrapposte la mesh torna
    // al materiale originale alla fine dell'ultima. Materiali multipli gestiti; materiali
    // senza emissive (MeshBasicMaterial) restano come sono.
    // Widget "scope": oggetto e contenuto (la mesh, o tutte le mesh di un gruppo, a
    // qualunque livello) oppure solo oggetto (solo le mesh indicate direttamente).
    const HL_SCOPES = ['object and contents', 'object only'];
    function _hlMaterialCopy(m, colorHex) {
        if (!m?.emissive?.isColor) return m;   // senza emissive: invariato
        const c = m.clone();
        c.emissive.setHex(colorHex);
        return c;
    }
    /** Accende una mesh con una copia dei materiali (o aggiorna il colore se è già accesa). */
    function _hlOn(mesh, colorHex) {
        const ud = mesh.userData;
        if (!ud._tjsHlCount) {
            ud._tjsHlOrigMat = mesh.material;
            mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map(m => _hlMaterialCopy(m, colorHex))
                : _hlMaterialCopy(mesh.material, colorHex);
        } else {
            // già accesa: i materiali con emissive sono le copie, si aggiorna solo il colore
            for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
                if (m?.emissive?.isColor) m.emissive.setHex(colorHex);
            }
        }
        ud._tjsHlCount = (ud._tjsHlCount || 0) + 1;
    }
    /** Spegne una mesh: all'ultima evidenziazione rimette il materiale originale. */
    function _hlOff(mesh) {
        const ud = mesh.userData;
        if (!ud._tjsHlCount) return;
        ud._tjsHlCount -= 1;
        if (ud._tjsHlCount > 0) return;
        const orig = ud._tjsHlOrigMat;
        const cur  = mesh.material;
        const origList = Array.isArray(orig) ? orig : [orig];
        for (const m of (Array.isArray(cur) ? cur : [cur])) {
            if (m && !origList.includes(m)) { try { m.dispose(); } catch { /* noop */ } }
        }
        if (orig) mesh.material = orig;
        delete ud._tjsHlOrigMat;
        delete ud._tjsHlCount;
    }
    function TJSHighlight() {
        this.addProperty('name',        '',      'string');
        this.addProperty('color',       'ffaa00','string');
        this.addProperty('duration_ms', 1500,    'number');
        this.addProperty('scope',       HL_SCOPES[0], 'string');
        this.addWidget('text',   'object name',  '',      v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',    'ffaa00',v => { this.properties.color = v; }, { property: 'color' });
        this.addWidget('number', 'duration ms',  1500,    v => { this.properties.duration_ms = v; }, { property: 'duration_ms' });
        // ultimo widget: i flow salvati ripristinano i valori dei widget per posizione
        this.addWidget('combo',  'scope', HL_SCOPES[0], v => { this.properties.scope = v; }, { values: HL_SCOPES, property: 'scope' });
        this.addInput('trigger',   ACTION);
        this.addInput('object',    0);          // THREE.Object3D — riferimento diretto, ha priorità su 'name' se collegato
        this.addInput('name',      'string');
        this.addInput('durationMs', 'number');  // sovrascrive il widget/property duration_ms
        this.addOutput('done',     EVENT);      // emesso allo SCADERE della durata (quando torna al colore originale), non all'accensione
        this.addOutput('→object',  0);          // passthrough — solo se agito per riferimento
        this.color   = '#2a1a4a';
        this.bgcolor = '#4a1d96';
        this.size    = [230, 212];
        this._batches = new Map();   // timer → mesh accese da quel trigger (per spegnerle anche in onRemoved)
    }
    TJSHighlight.title = 'Highlight';
    TJSHighlight.desc  = 'Temporarily highlights an object with an emissive color — by direct reference or by name. Only the chosen meshes light up, even if they share the material with others';
    TJSHighlight.portHelp = {
        inputs: {
            trigger:       'event — starts the highlight',
            object:        'THREE.Object3D — direct reference, optional, takes priority over "name" if connected. With scope "object and contents": a Mesh is highlighted itself, a Group/Object3D highlights all the Meshes it contains, at any level. With "object only": only if it is a Mesh',
            name:          'text — object name, used only if "object" is not connected, overrides the widget: highlights every object with that name (and, with "object and contents", all the Meshes it contains)',
            durationMs:    'number — highlight duration in milliseconds, optional, overrides the widget/property',
        },
        outputs: {
            done:      'event — fired when the highlight ENDS (original materials restored), NOT when it starts. Once per trigger',
            '→object': 'THREE.Object3D — the input object (passthrough), present only when acting by direct reference — by name it may involve several meshes at once, so it stays empty',
        },
        properties: {
            scope: 'object and contents = the given mesh, or all the meshes of a group at any level; object only = only the given mesh (a group does not light up: it has no material of its own)',
        },
    };
    TJSHighlight.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const refObj   = this.getInputData(1);
        const colorHex = parseInt(this.properties.color || 'ffaa00', 16);
        const dur      = Math.max(0, this.getInputData(3) ?? this.properties.duration_ms ?? 1500);
        const whole    = this.properties.scope !== 'object only';

        const targets = new Set();
        const collect = root => {
            if (whole) root.traverse(o => { if (o.isMesh) targets.add(o); });
            else if (root.isMesh) targets.add(root);
        };
        if (refObj?.isObject3D) {
            collect(refObj);
        } else {
            const name = this.getInputData(2) ?? this.properties.name;
            if (name == null || name === '') return;
            ctx.scene.traverse(obj => { if (obj.name === name) collect(obj); });
        }
        if (!targets.size) return;

        for (const mesh of targets) { try { _hlOn(mesh, colorHex); } catch { /* noop */ } }
        const tid = setTimeout(() => {
            this._batches.delete(tid);
            for (const mesh of targets) { try { _hlOff(mesh); } catch { /* noop */ } }
            // Restore avviene fuori da runStep: markDirty diretto via appContext
            ctx.markDirty?.();
            if (refObj?.isObject3D) this.setOutputData(1, refObj);
            this.triggerSlot(0);
        }, dur);
        this._batches.set(tid, targets);
        _ctxDirty(this);   // segnala la prima variazione visiva (il set immediato)
    };
    TJSHighlight.prototype.onRemoved = function () {
        // nodo tolto a evidenziazione in corso: rimette subito i materiali originali
        for (const [tid, targets] of this._batches ?? []) {
            clearTimeout(tid);
            for (const mesh of targets) { try { _hlOff(mesh); } catch { /* noop */ } }
        }
        this._batches?.clear();
        this.graph?._appContext?.markDirty?.();
    };
    LG.registerNodeType('TJS/Object/Highlight', TJSHighlight);


    // ─── TJS/Camera/GetPosition ──────────────────────────────────────────────
    // Ritorna posizione camera e target orbit correnti.
    function TJSCameraGetPosition() {
        this.addInput('trigger', ACTION);
        this.addOutput('position', 'object');
        this.addOutput('target',   'object');
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [210, 80];
    }
    TJSCameraGetPosition.title = 'Camera Get Position';
    TJSCameraGetPosition.desc  = 'Returns the current position of the camera and of the orbit target';
    TJSCameraGetPosition.portHelp = {
        inputs:  { trigger: 'event — reads the current position' },
        outputs: {
            position: '{x,y,z} — world position of the active camera',
            target:   '{x,y,z} — point looked at by OrbitControls (null if not active)',
        },
    };
    TJSCameraGetPosition.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.camera) return;
        const p = ctx.camera.position;
        this.setOutputData(0, { x: p.x, y: p.y, z: p.z });
        const t = ctx.orbitControls?.target;
        this.setOutputData(1, t ? { x: t.x, y: t.y, z: t.z } : null);
    };
    LG.registerNodeType('TJS/Camera/GetPosition', TJSCameraGetPosition);


    // ─── TJS/Camera/FlyTo ────────────────────────────────────────────────────
    // Anima la camera verso una posizione/target in modo fluido.
    function TJSCameraFlyTo() {
        this.addProperty('duration_ms', 1200, 'number');
        this.addWidget('number', 'duration ms', 1200, v => { this.properties.duration_ms = v; }, { property: 'duration_ms' });
        this.addInput('trigger',  ACTION);
        this.addInput('position', 0);   // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addInput('target',   0);   // {x,y,z} | [x,y,z] | vec3
        this.color   = '#3a1a5a';   // famiglia Animazione
        this.bgcolor = '#6d28d9';
        this.size    = [210, 110];
    }
    TJSCameraFlyTo.title = 'Camera FlyTo';
    TJSCameraFlyTo.desc  = 'Animates the camera towards a position';
    TJSCameraFlyTo.portHelp = {
        inputs: {
            trigger:  'event — starts the flight towards the given position',
            position: '{x,y,z} or [x,y,z]/vec3 (e.g. from Vector/Pack/XYZtoVec3 or Params/Object/Maker) — camera destination, required. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            target:   '{x,y,z} or [x,y,z]/vec3 — new point looked at by OrbitControls (optional, unchanged if not connected) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
        },
    };
    TJSCameraFlyTo.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.camera) return;
        const posIn = this.getInputData(1), tgtIn = this.getInputData(2);
        const pos = _readPoint3(posIn), tgt = _readPoint3(tgtIn);
        if (!pos) { _pointWarn(this, 'position', posIn); return; }
        if (tgtIn != null && !tgt) _pointWarn(this, 'target', tgtIn);
        _animateCameraTo(ctx.camera, ctx.orbitControls, pos, tgt, this.properties.duration_ms ?? 1200);
    };
    LG.registerNodeType('TJS/Camera/FlyTo', TJSCameraFlyTo);


    // ─── TJS/Camera/Orbit Set ────────────────────────────────────────────────
    // (2026-10-12) Imposta SUBITO la camera attorno al target degli OrbitControls, in
    // coordinate di orbita: per il controllo continuo (potenziometro, accelerometro, slider)
    // che manda decine di valori al secondo — FlyTo e AlongCurve ripartirebbero da capo a
    // ogni valore. Gli ingressi non collegati (o null) lasciano la grandezza com'è.
    // Movimento segnato "da codice" per OnCameraSettled (source). _doc/arch-iot-dispositivi.md §7.
    const ORBIT_OPTIONAL_INPUTS = [['target', 0]];
    const ORBIT_OPTIONAL_OUTPUTS = [['azimuth', 'number'], ['elevation', 'number'], ['distance', 'number']];
    const _orbitUp = new THREE.Vector3(0, 1, 0);
    function TJSCameraOrbitSet() {
        this.addProperty('relative', false, 'boolean');
        this.addWidget('toggle', 'relative', false, v => { this.properties.relative = !!v; }, { property: 'relative' });
        this.addInput('trigger',   ACTION);
        this.addInput('azimuth',   'number');
        this.addInput('elevation', 'number');
        this.addInput('distance',  'number');
        this.addOutput('done', EVENT);
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [220, 130];
    }
    TJSCameraOrbitSet.title = 'Camera Orbit Set';
    TJSCameraOrbitSet.desc  = 'Moves the camera at once around the orbit target (no animation): rotation around the vertical axis, height angle, distance. For continuous control from a device or a slider, many times per second. Works in the object flow and in the editor attached to a TJS panel';
    TJSCameraOrbitSet.portHelp = {
        inputs: {
            trigger:   'event — applies the values (connect it to the done of the node that produces them, e.g. IoT Receive or IoT Map Range)',
            azimuth:   'number, in degrees — rotation around the vertical axis through the target: 0 = camera on the +Z side, 90 = on the +X side. Any value (360 = 0). Not connected or null: unchanged',
            elevation: 'number, in degrees — height angle above the horizon: 0 = level with the target, 90 = from above, negative = from below (limited to ±89.9 and to the polar limits of the panel controls). Not connected or null: unchanged',
            distance:  'number, in meters — distance from the target (greater than 0; limited to the zoom limits of the panel controls). Not connected or null: unchanged',
            target:    '{x,y,z} or [x,y,z] — new orbit center, applied before the angles (optional: right-click the node → Inputs). Not connected or null: unchanged. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
        },
        outputs: {
            done:      'event — camera moved',
            azimuth:   'number, degrees — azimuth after the move (optional: right-click the node → Outputs)',
            elevation: 'number, degrees — elevation after the move (optional)',
            distance:  'number, meters — distance after the move (optional)',
        },
        properties: {
            relative: 'off: the inputs are the new values · on: the inputs are added to the current values (e.g. an endless knob or encoder that sends steps)',
        },
    };
    TJSCameraOrbitSet.prototype.onGetInputs  = function () {
        return ORBIT_OPTIONAL_INPUTS.filter(([n]) => this.findInputSlot(n) === -1).map(([n, t]) => [n, t, { removable: true }]);
    };
    TJSCameraOrbitSet.prototype.onGetOutputs = function () { return _optionalOutputs(this, ORBIT_OPTIONAL_OUTPUTS); };
    TJSCameraOrbitSet.prototype.onConfigure  = function () {
        for (const s of this.inputs ?? []) if (ORBIT_OPTIONAL_INPUTS.some(([n]) => n === s.name)) s.removable = true;
        _markRemovable(this, ORBIT_OPTIONAL_OUTPUTS);
    };
    TJSCameraOrbitSet.prototype._in = function (name) {
        const i = this.findInputSlot(name);
        return i === -1 ? null : this.getInputData(i);
    };
    TJSCameraOrbitSet.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const cam = ctx?.camera, oc = ctx?.orbitControls;
        if (!cam || !oc) return;
        const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        const az = num(this._in('azimuth')), el = num(this._in('elevation')), di = num(this._in('distance'));
        const tg = this._in('target');
        const rel = !!this.properties.relative;

        const tp = tg != null ? _readPoint3(tg) : null;
        if (tg != null && !tp) _pointWarn(this, 'target', tg);
        if (tp) {
            const { x, y, z } = tp;
            const move = new THREE.Vector3(x, y, z).sub(oc.target);
            oc.target.add(move);
            cam.position.add(move);
        }
        // offset camera-target nello spazio "Y in alto" degli OrbitControls (camera.up può essere diverso)
        const quat = new THREE.Quaternion().setFromUnitVectors(cam.up, _orbitUp);
        const offset = cam.position.clone().sub(oc.target).applyQuaternion(quat);
        const sph = new THREE.Spherical().setFromVector3(offset);
        const D2R = Math.PI / 180;
        if (az != null) sph.theta = (rel ? sph.theta : 0) + az * D2R;
        if (el != null) {
            const curEl = 90 - sph.phi / D2R;
            const newEl = Math.max(-89.9, Math.min(89.9, (rel ? curEl : 0) + el));
            sph.phi = Math.max(oc.minPolarAngle ?? 0, Math.min(oc.maxPolarAngle ?? Math.PI, (90 - newEl) * D2R));
        }
        if (di != null) {
            const r = (rel ? sph.radius : 0) + di;
            sph.radius = Math.max(oc.minDistance ?? 0, Math.min(oc.maxDistance ?? Infinity, Math.max(1e-6, r)));
        }
        sph.makeSafe();
        offset.setFromSpherical(sph).applyQuaternion(quat.invert());
        cam.position.copy(oc.target).add(offset);
        cam.lookAt(oc.target);
        _markCodeCameraMove(oc);
        try { oc.update(); } catch { /* noop */ }
        _ctxDirty(this);

        if (this.outputs.length > 1) {
            _out(this, 'azimuth',   Math.round(oc.getAzimuthalAngle() / D2R * 100) / 100);
            _out(this, 'elevation', Math.round((90 - oc.getPolarAngle() / D2R) * 100) / 100);
            const d = oc.getDistance?.() ?? cam.position.distanceTo(oc.target);
            _out(this, 'distance',  Math.round(d * 1000) / 1000);
        }
        _fire(this, 'done');
    };
    LG.registerNodeType('TJS/Camera/Orbit Set', TJSCameraOrbitSet);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Scene — accesso e navigazione della scena
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Scene/NameFilter ──────────────────────────────────────────────────
    // Descrive un filtro di pattern nome/percorso — nodo puro (nessun trigger,
    // valore ricalcolato ogni frame in onExecute come le costanti). Va
    // collegato a 'includi'/'escludi' di GetObjectNames (e in futuro di altri
    // nodi Scene). Una riga del widget testo = un pattern:
    //  - senza '\'  → match sul solo nome (leaf), a qualunque profondità
    //  - con '\'    → match sul percorso completo da 'base' (TJS_MODELS_ROOT
    //                 o scena), un segmento per livello, profondità esatta
    //  - wildcard per segmento: '*' (sequenza qualunque), '?' (un carattere)
    // Più pattern nella lista si combinano con l'operatore scelto (default OR).
    function TJSSceneNameFilter() {
        this.addProperty('patterns', '', 'string');
        this.addProperty('operator', 'OR', 'string');
        this.addWidget('text', 'patterns (one per line)', '', v => {
            this.properties.patterns = String(v ?? '');
        }, { property: 'patterns', multiline: true });
        this.addWidget('combo', 'operator', 'OR', v => { this.properties.operator = v; },
                       { values: ['OR', 'AND'], property: 'operator' });
        this.addOutput('filter', 'namefilter');
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [230, 120];
    }
    TJSSceneNameFilter.title = 'Scene Name Filter';
    TJSSceneNameFilter.desc  = 'List of name/path patterns (wildcards * and ?) to connect to include/exclude';
    TJSSceneNameFilter.portHelp = {
        outputs: {
            filter: 'filter descriptor — connect it to "include"/"exclude" of Scene Get Object Names. Pattern without \'\\\' = match on the name at any depth; pattern with \'\\\' (e.g. "Building\\mesh*") = match on the full path from TJS_MODELS_ROOT/scene, one segment per level. Wildcards: \'*\' any sequence, \'?\' one character. Several lines = OR (or AND) between them.',
        },
    };
    TJSSceneNameFilter.prototype.onExecute = function () {
        const patterns = String(this.properties.patterns || '')
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);
        this.setOutputData(0, { patterns, operator: this.properties.operator === 'AND' ? 'AND' : 'OR' });
    };
    LG.registerNodeType('TJS/Scene/NameFilter', TJSSceneNameFilter);


    // ─── TJS/Scene/GetObjectNames ─────────────────────────────────────────────
    // Elenca i nomi di Mesh/Points/Line/Group/Object3D nella scena (esclusi
    // helper interni) — Object3D incluso perché è il contenitore/pivot
    // generico che loader come GLTF/OBJ/IFC inseriscono come wrapper
    // intermedio: senza, quei livelli restavano invisibili nell'elenco pur
    // essendo comunque contati nel percorso usato dai filtri a percorso
    // (vedi _pathFromBase), col risultato che i pattern con '\' sembravano
    // "saltare" un livello della gerarchia (segnalato 2026-09-20).
    // 'includi'/'escludi' (opzionali) accettano un filtro da TJS/Scene/NameFilter.
    function TJSSceneGetObjectNames() {
        this.addInput('trigger', ACTION);
        this.addInput('include', 'namefilter');
        this.addInput('exclude', 'namefilter');
        this.addOutput('done',     EVENT);     // emesso a elenco ricalcolato (sempre, anche se vuoto)
        this.addOutput('names',    'array');
        this.addOutput('count',    'number');
        this.addOutput('paths',    'array');   // string, segmenti separati da '\' — pronti per NameFilter
        this.addOutput('objects',  'array');   // THREE.Object3D — riferimenti diretti, stesso indice di names/paths
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [220, 140];
    }
    TJSSceneGetObjectNames.title = 'Scene Get Object Names';
    TJSSceneGetObjectNames.desc  = 'Lists the names of all the objects in the scene, with optional include/exclude filters';
    TJSSceneGetObjectNames.portHelp = {
        inputs:  {
            trigger: 'event — recomputes the list',
            include: 'filter (from Scene Name Filter), optional — if connected, only the objects matching the filter are kept',
            exclude: 'filter (from Scene Name Filter), optional — if connected, the objects matching the filter are removed',
        },
        outputs: {
            done:    'event — fired every time the list has been recomputed (even if it is empty)',
            names:   'array of text — names of Mesh/Points/Line/Group/Object3D in the scene (internal TJS_* helpers excluded), after the filters',
            count:   'number — how many items in "names"/"paths"/"objects" (same index in the three arrays)',
            paths:   'array of text — full path from TJS_MODELS_ROOT/scene, segments separated by \'\\\' (same format as the Scene Name Filter patterns)',
            objects: 'array of THREE.Object3D — direct reference of each object, same index as "names"/"paths" — connect it to Set Transform/Set Material/etc. without searching by name again',
        },
    };
    TJSSceneGetObjectNames.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        // Cerca prima TJS_MODELS_ROOT; se non trovato cade sulla scena completa
        let root = null;
        ctx.scene.traverse(o => { if (!root && o.name === 'TJS_MODELS_ROOT') root = o; });
        const base = root ?? ctx.scene;
        const includeFilter = this.getInputData(1);
        const excludeFilter = this.getInputData(2);
        const names = [];
        const paths = [];
        const objs  = [];
        base.traverse(obj => {
            if (!obj.name) return;
            if (obj.name.startsWith('TJS_')) return;   // escludi helper interni
            if (!(obj.isMesh || obj.isPoints || obj.isLine || obj.type === 'Group' || obj.type === 'Object3D')) return;
            const path = _pathFromBase(obj, base);
            if (includeFilter && !_matchesNameFilter(includeFilter, obj.name, path)) return;
            if (excludeFilter &&  _matchesNameFilter(excludeFilter, obj.name, path)) return;
            names.push(obj.name);
            paths.push(path.join('\\'));
            objs.push(obj);
        });
        this.setOutputData(1, names);
        this.setOutputData(2, names.length);
        this.setOutputData(3, paths);
        this.setOutputData(4, objs);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Scene/GetObjectNames', TJSSceneGetObjectNames);


    // ─── TJS/Scene/GetObjectByName ────────────────────────────────────────────
    // Cerca un oggetto per nome e ritorna le sue proprietà di trasformazione.
    // Si ferma al primo match nell'ordine di traverse() — 'includi'/'escludi'
    // (opzionali, stesso filtro di GetObjectNames) permettono di disambiguare
    // nomi duplicati con un pattern a percorso invece che sperare nell'ordine
    // di traversal. Base allineata a GetObjectNames (TJS_MODELS_ROOT se
    // presente, altrimenti scena intera) così i percorsi copiati da lì
    // (output 'percorsi') restano validi anche qui (fix 2026-09-20 — prima
    // cercava sempre nella scena intera, coordinate di percorso incoerenti).
    function TJSSceneGetObjectByName() {
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'name', '', v => { this.properties.name = v; }, { property: 'name' });
        this.addInput('trigger',   ACTION);
        this.addInput('name',      'string');
        this.addInput('include',   'namefilter');
        this.addInput('exclude',   'namefilter');
        this.addOutput('done',     EVENT);      // emesso solo se trovato (stessa convenzione dei nodi Set/Remove)
        this.addOutput('name',     'string');   // nome dell'oggetto trovato (== il nome cercato)
        this.addOutput('path',     'string');   // percorso da TJS_MODELS_ROOT/scena, stesso formato di GetObjectNames.paths
        this.addOutput('object',   0);          // THREE.Object3D — riferimento diretto
        this.addOutput('position', 'object');   // {x,y,z} world
        this.addOutput('rotation', 'object');   // {x,y,z} euler gradi
        this.addOutput('scale',    'object');   // {x,y,z}
        this.addOutput('visible',  'boolean');
        this.addOutput('found',    'boolean');
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [220, 220];
    }
    TJSSceneGetObjectByName.title = 'Scene Get Object By Name';
    TJSSceneGetObjectByName.desc  = 'Returns reference, transform and visibility of an object by name (first match after the filters)';
    TJSSceneGetObjectByName.portHelp = {
        inputs: {
            trigger: 'event — reads the current properties of the object',
            name:    'text — exact name of the object in the scene, overrides the widget',
            include: 'filter (from Scene Name Filter), optional — considers only the candidates matching the filter',
            exclude: 'filter (from Scene Name Filter), optional — discards the candidates matching the filter',
        },
        outputs: {
            done:     'event — fired only if an object was found (no event if "found" is false)',
            name:     'text — name of the object found (same as the name searched)',
            path:     'text — full path from TJS_MODELS_ROOT/scene, segments separated by \'\\\' (same format as Scene Name Filter and GetObjectNames.paths)',
            object:   'THREE.Object3D — direct reference, connect it to Set Transform/Set Material/Object Get Transform/etc. without searching again',
            position: '{x,y,z} — world position',
            rotation: '{x,y,z} — euler rotation in degrees',
            scale:    '{x,y,z}',
            visible:  'boolean',
            found:    'boolean — false if no object matches name+filters (in that case the other outputs are not updated)',
        },
    };
    TJSSceneGetObjectByName.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name = this.getInputData(1) ?? this.properties.name;
        const includeFilter = this.getInputData(2);
        const excludeFilter = this.getInputData(3);
        let root = null;
        ctx.scene.traverse(o => { if (!root && o.name === 'TJS_MODELS_ROOT') root = o; });
        const base = root ?? ctx.scene;
        let found = null;
        base.traverse(obj => {
            if (found || obj.name !== name) return;
            if (includeFilter || excludeFilter) {
                const path = _pathFromBase(obj, base);
                if (includeFilter && !_matchesNameFilter(includeFilter, obj.name, path)) return;
                if (excludeFilter &&  _matchesNameFilter(excludeFilter, obj.name, path)) return;
            }
            found = obj;
        });
        if (!found) {
            this.setOutputData(8, false);
            return;
        }
        const path = _pathFromBase(found, base);
        const wp   = _getWorldPosition(found);
        const R    = 180 / Math.PI;
        this.setOutputData(1, found.name);
        this.setOutputData(2, path.join('\\'));
        this.setOutputData(3, found);
        this.setOutputData(4, wp);
        this.setOutputData(5, { x: found.rotation.x * R, y: found.rotation.y * R, z: found.rotation.z * R });
        this.setOutputData(6, { x: found.scale.x, y: found.scale.y, z: found.scale.z });
        this.setOutputData(7, found.visible);
        this.setOutputData(8, true);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Scene/GetObjectByName', TJSSceneGetObjectByName);


    // ─── TJS/Scene/GetTree (2026-10-07) ──────────────────────────────────────
    // Struttura della scena come albero di soli dati JSON { name, uuid, type, children }:
    // niente riferimenti Three.js, quindi passa sull'App Bus (anche fra schede) e si
    // converte in grafo/albero ECharts con ECH/Graph/FromTree. Nomi originali, nessun
    // oggetto escluso per nome (per togliere nodi: Params/Data/Tree Filter a valle).
    // Radice: "Scene Root" (tutta la scena) o "Model Root" (TJS_MODELS_ROOT), oppure un
    // elenco di rami (widget "branches" o ingresso opzionale): radice = scena, figli = i
    // rami elencati (es. TJS_LIGHTS_ROOT, TJS_CAMERA_ROOT, il nome di un modello).
    // Tipi: elenco separato da virgole (widget o ingresso opzionale "types"). Un oggetto
    // di tipo non elencato non compare, ma i suoi figli salgono al primo antenato rimasto
    // (con "Mesh" si ottengono le mesh appese alla radice, non un albero vuoto).
    // userData (2026-10-08): campi di obj.userData da copiare nel nodo (es. la categoria
    // scritta nel modello: in GLTF gli "extras" finiscono in userData), solo valori
    // semplici (testo, numero, vero/falso) per restare JSON.
    const TREE_TYPES_DEFAULT = 'Mesh, Points, Line, Group, Object3D';
    function _treeUserData(obj, keys) {
        if (!keys) return null;
        const ud = obj.userData ?? {};
        const out = {};
        for (const k of (keys === '*' ? Object.keys(ud) : keys)) {
            const v = ud[k];
            if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
        }
        return Object.keys(out).length ? out : null;
    }
    const TREE_ROOTS = ['Model Root', 'Scene Root'];
    function _treeTypeSet(text) {
        const list = String(text ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        return list.length ? new Set(list) : null;   // null = tutti i tipi
    }
    function _treeBranchNames(text) {
        return [...new Set(String(text ?? '').split('\n').map(t => t.trim()).filter(Boolean))];
    }
    const TREE_OPTIONAL_INPUTS = [['types', 'string'], ['branches', 'string']];
    function TJSSceneGetTree() {
        this.addProperty('root',     TREE_ROOTS[0],      'string');
        this.addProperty('branches', '',                 'string');
        this.addProperty('types',    TREE_TYPES_DEFAULT, 'string');
        this.addProperty('depth',    0,                  'number');
        this.addWidget('combo',  'root', TREE_ROOTS[0], v => { this.properties.root = v; }, { values: TREE_ROOTS, property: 'root' });
        this.addWidget('text',   'branches (one per line)', '', v => { this.properties.branches = String(v ?? ''); }, { property: 'branches', multiline: true });
        this.addWidget('text',   'types', TREE_TYPES_DEFAULT, v => { this.properties.types = String(v ?? ''); }, { property: 'types' });
        this.addWidget('number', 'depth', 0, v => { this.properties.depth = Math.max(0, Math.round(Number(v) || 0)); }, { min: 0, max: 50, step: 10, precision: 0, property: 'depth' });
        // ultimo widget: i flow salvati ripristinano i valori dei widget per posizione
        this.addProperty('userData', '', 'string');
        this.addWidget('text',   'userData', '', v => { this.properties.userData = String(v ?? ''); }, { property: 'userData' });
        this.addInput('trigger', ACTION);
        // 'types' e 'branches' (string) opzionali: tasto destro → Inputs
        this.addOutput('done',  EVENT);
        this.addOutput('tree',  'object');
        this.addOutput('count', 'number');
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [260, 168];
    }
    TJSSceneGetTree.title = 'Scene Get Tree';
    TJSSceneGetTree.desc  = 'Returns the structure of the scene (parent → children) as JSON data: to publish with an App Bus Emitter or to convert with ECH/Graph/FromTree. Works in the TJS object flow or with "Test on panel"';
    TJSSceneGetTree.error_output = true;
    TJSSceneGetTree.portHelp = {
        inputs: {
            trigger:  'event — reads the current structure of the scene',
            types:    'text — types to detect, comma-separated, like the "types" widget; if connected it overrides the widget (optional: right-click the node → Inputs)',
            branches: 'text — names of the branches to read, one per line, like the "branches" widget; if connected it overrides the widget (optional: right-click the node → Inputs)',
        },
        outputs: {
            done:  'event — structure ready',
            tree:  'object { name, uuid, type, children: [ { name, uuid, type, userData?, children }, ... ] } — name is the object name as it is (empty if it has none), uuid identifies it uniquely (see Scene Get Object By Uuid), type is the Three.js type (Mesh, Group, PointLight…), userData the fields chosen in the "userData" widget (only if present)',
            count: 'number — objects in the tree, root excluded',
            error: 'event — scene not available, or a name in "branches" does not exist in the scene (the message lists them). Port hidden by default: right-click → Show error',
        },
        properties: {
            root:     'Model Root = the loaded models (root TJS_MODELS_ROOT); Scene Root = the whole scene, as it is: lights, cameras, grid and internal TJS_* helpers included. Ignored if "branches" contains names',
            branches: 'names of scene objects, one per line (exact name), e.g. TJS_LIGHTS_ROOT, TJS_CAMERA_ROOT or the name of a model: the root is the scene and its children are the listed branches, with their contents. A name appearing several times brings all the objects with that name. Empty = "root" is used',
            types:    'Three.js types to detect, comma-separated (case-insensitive), e.g. "Mesh, Group" or "Mesh, PointLight, DirectionalLight"; empty = all. An object of an unlisted type does not appear, but its children remain, attached to the first detected ancestor. The "branches" always appear',
            depth:    'maximum levels below the root (counted on the scene, also through undetected objects; the "branches" are level 1); 0 = all',
            userData: 'userData fields of the object to copy into the node, comma-separated (e.g. "category, phase"), or * for all; only text, numbers and true/false. In GLTF models the custom fields (extras) are in userData. Empty = none. With ECH/Graph/FromTree, category = field and field = userData.category color the graph by that value',
        },
    };
    TJSSceneGetTree.prototype.onGetInputs = function () {
        return TREE_OPTIONAL_INPUTS
            .filter(([n]) => this.findInputSlot(n) === -1)
            .map(([n, t]) => [n, t, { removable: true }]);
    };
    TJSSceneGetTree.prototype.onConfigure = function () {
        for (const i of this.inputs ?? []) {
            if (TREE_OPTIONAL_INPUTS.some(([n]) => n === i.name)) i.removable = true;
        }
    };
    /** Ingresso collegato → prevale sulla proprietà (widget). */
    TJSSceneGetTree.prototype._val = function (name) {
        const i = this.findInputSlot(name);
        return (i !== -1 && this.inputs[i].link != null) ? this.getInputData(i) : this.properties[name];
    };
    TJSSceneGetTree.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        this.clearError?.();
        const scene = ctx.scene;
        const types = _treeTypeSet(this._val('types'));
        const udText = String(this.properties.userData ?? '').trim();
        const udKeys = udText === '*' ? '*' : (udText ? udText.split(',').map(k => k.trim()).filter(Boolean) : null);
        const maxDepth = Number(this.properties.depth) > 0 ? Number(this.properties.depth) : Infinity;
        let count = 0;
        const nodeOf = obj => {
            const node = { name: obj.name || '', uuid: obj.uuid, type: obj.type };
            const ud = _treeUserData(obj, udKeys);
            if (ud) node.userData = ud;
            node.children = [];
            return node;
        };
        // visita i figli di obj e appende a "into" quelli rilevati; i non rilevati
        // vengono attraversati e i loro figli salgono in "into"
        const visit = (obj, into, depth) => {
            if (depth >= maxDepth) return;
            for (const child of obj.children) {
                if (!types || types.has(String(child.type).toLowerCase())) {
                    count++;
                    const node = nodeOf(child);
                    into.push(node);
                    visit(child, node.children, depth + 1);
                } else {
                    visit(child, into, depth + 1);
                }
            }
        };

        let tree;
        const branchNames = _treeBranchNames(this._val('branches'));
        if (branchNames.length) {
            // rami elencati: radice = scena, figli = ogni oggetto con quei nomi (sempre presenti)
            const found = [], missing = [];
            for (const name of branchNames) {
                const objs = [];
                scene.traverse(o => { if (o !== scene && o.name === name) objs.push(o); });
                if (objs.length) found.push(...objs); else missing.push(name);
            }
            if (missing.length) { this.triggerError?.(new Error(`branches not found in the scene: ${missing.join(', ')}`)); return; }
            tree = nodeOf(scene);
            for (const obj of found) {
                count++;
                const node = nodeOf(obj);
                tree.children.push(node);
                visit(obj, node.children, 1);
            }
        } else {
            let base = scene;
            if (this.properties.root !== 'Scene Root') {
                base = scene.getObjectByName('TJS_MODELS_ROOT');
                if (!base) { this.triggerError?.(new Error('TJS_MODELS_ROOT not found in the scene')); return; }
            }
            tree = nodeOf(base);
            visit(base, tree.children, 0);
        }
        _out(this, 'tree', tree);
        _out(this, 'count', count);
        _fire(this, 'done');
    };
    LG.registerNodeType('TJS/Scene/GetTree', TJSSceneGetTree);


    // ─── TJS/Scene/GetObjectByUuid (2026-10-07) ──────────────────────────────
    // L'uuid arriva da Scene Get Tree o dal grafo ECharts (ECH/Events/OnClick → data.id):
    // a differenza del nome è univoco.
    function TJSSceneGetObjectByUuid() {
        this.addInput('trigger', ACTION);
        this.addInput('uuid',    'string');
        this.addOutput('done',   EVENT);
        this.addOutput('object', 0);
        this.addOutput('name',   'string');
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [210, 70];
    }
    TJSSceneGetObjectByUuid.title = 'Scene Get Object By Uuid';
    TJSSceneGetObjectByUuid.desc  = 'Finds a scene object by uuid (unique, unlike the name). Works in the TJS object flow or with "Test on panel"';
    TJSSceneGetObjectByUuid.error_output = true;
    TJSSceneGetObjectByUuid.portHelp = {
        inputs: {
            trigger: 'event — looks for the object',
            uuid:    'text — uuid of the object, from Scene Get Tree (uuid field) or from the ECharts graph (ECH/Events/OnClick, data output → id)',
        },
        outputs: {
            done:   'event — object found',
            object: 'THREE.Object3D — direct reference, connect it to Object Highlight, Set Visibility, Set Transform…',
            name:   'text — object name',
            error:  'event — no object with this uuid (e.g. scene reloaded: uuids change at every load). Port hidden by default: right-click → Show error',
        },
    };
    TJSSceneGetObjectByUuid.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        this.clearError?.();
        const uuid = this.getInputData(this.findInputSlot('uuid'));
        const obj = uuid ? ctx.scene.getObjectByProperty('uuid', String(uuid)) : null;
        if (!obj) { this.triggerError?.(new Error(`no object with uuid "${uuid ?? ''}"`)); return; }
        _out(this, 'object', obj);
        _out(this, 'name', obj.name || '');
        _fire(this, 'done');
    };
    LG.registerNodeType('TJS/Scene/GetObjectByUuid', TJSSceneGetObjectByUuid);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Object — trasformazioni sugli oggetti della scena
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Object/SetPosition ───────────────────────────────────────────────
    // Sposta un oggetto in una posizione world assoluta — per riferimento
    // diretto (priorità) o per nome.
    function TJSSetPosition() {
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'object name', '', v => { this.properties.name = v; }, { property: 'name' });
        this.addInput('trigger',   ACTION);
        this.addInput('object',   0);          // THREE.Object3D — riferimento diretto, ha priorità su 'nome' se collegato
        this.addInput('name',      'string');
        this.addInput('position',  0);  // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);         // passthrough — solo se agito per riferimento
        this.color   = '#2a1a4a';
        this.bgcolor = '#4a1d96';
        this.size    = [220, 130];
    }
    TJSSetPosition.title = 'Set Position';
    TJSSetPosition.desc  = 'Moves an object to the given {x,y,z} position — by direct reference or by name';
    TJSSetPosition.portHelp = {
        inputs: {
            trigger:  'event — applies the position',
            object:   'THREE.Object3D — direct reference, optional, takes priority over "name" if connected',
            name:     'text — name of the object in the scene, used only if "object" is not connected, overrides the widget',
            position: '{x,y,z} or [x,y,z]/vec3 (e.g. from Vector/Pack/XYZtoVec3 or Params/Object/ObjectVec3) — absolute world position, required. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
        },
        outputs: {
            done:      'event — fired once applied',
            '→object': 'THREE.Object3D — the modified object (passthrough), present only when acting by direct reference — by name it may apply to several objects at once, so it stays empty',
        },
    };
    TJSSetPosition.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const refObj = this.getInputData(1);
        const posIn  = this.getInputData(3);
        const pos    = _readPoint3(posIn);
        if (!pos) { _pointWarn(this, 'position', posIn); return; }
        if (refObj?.isObject3D) {
            refObj.position.set(pos.x ?? pos[0] ?? 0, pos.y ?? pos[1] ?? 0, pos.z ?? pos[2] ?? 0);
            this.setOutputData(1, refObj);
        } else {
            const name = this.getInputData(2) ?? this.properties.name;
            if (name == null) return;
            ctx.scene.traverse(obj => {
                if (obj.name === name) {
                    obj.position.set(pos.x ?? pos[0] ?? 0, pos.y ?? pos[1] ?? 0, pos.z ?? pos[2] ?? 0);
                }
            });
        }
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/SetPosition', TJSSetPosition);


    // ─── TJS/Object/SetRotation ───────────────────────────────────────────────
    // Ruota un oggetto (euler in gradi, ordine XYZ) — per riferimento diretto
    // (priorità) o per nome.
    function TJSSetRotation() {
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'object name', '', v => { this.properties.name = v; }, { property: 'name' });
        this.addInput('trigger',   ACTION);
        this.addInput('object',   0);          // THREE.Object3D — riferimento diretto, ha priorità su 'nome' se collegato
        this.addInput('name',      'string');
        this.addInput('rotation',  0);  // {x,y,z} | [x,y,z] | vec3, gradi — vedi portHelp
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);         // passthrough — solo se agito per riferimento
        this.color   = '#2a1a4a';
        this.bgcolor = '#4a1d96';
        this.size    = [220, 130];
    }
    TJSSetRotation.title = 'Set Rotation';
    TJSSetRotation.desc  = 'Rotates an object — euler values in degrees {x,y,z} — by direct reference or by name';
    TJSSetRotation.portHelp = {
        inputs: {
            trigger:  'event — applies the rotation',
            object:   'THREE.Object3D — direct reference, optional, takes priority over "name" if connected',
            name:     'text — name of the object in the scene, used only if "object" is not connected, overrides the widget',
            rotation: '{x,y,z} or [x,y,z]/vec3 (e.g. from Vector/Pack/XYZtoVec3 or Params/Object/ObjectVec3) — euler in DEGREES (not radians), required',
        },
        outputs: {
            done:      'event — fired once applied',
            '→object': 'THREE.Object3D — the modified object (passthrough), present only when acting by direct reference — by name it may apply to several objects at once, so it stays empty',
        },
    };
    TJSSetRotation.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const refObj = this.getInputData(1);
        const rot    = this.getInputData(3);
        if (!rot) return;
        const D2R = Math.PI / 180;
        if (refObj?.isObject3D) {
            refObj.rotation.set(
                (rot.x ?? rot[0] ?? 0) * D2R,
                (rot.y ?? rot[1] ?? 0) * D2R,
                (rot.z ?? rot[2] ?? 0) * D2R
            );
            this.setOutputData(1, refObj);
        } else {
            const name = this.getInputData(2) ?? this.properties.name;
            if (name == null) return;
            ctx.scene.traverse(obj => {
                if (obj.name === name) {
                    obj.rotation.set(
                        (rot.x ?? rot[0] ?? 0) * D2R,
                        (rot.y ?? rot[1] ?? 0) * D2R,
                        (rot.z ?? rot[2] ?? 0) * D2R
                    );
                }
            });
        }
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/SetRotation', TJSSetRotation);


    // ─── TJS/Object/SetScale ──────────────────────────────────────────────────
    // Scala un oggetto. Input: {x,y,z} oppure numero scalare uniforme — per
    // riferimento diretto (priorità) o per nome.
    function TJSSetScale() {
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'object name', '', v => { this.properties.name = v; }, { property: 'name' });
        this.addInput('trigger',  ACTION);
        this.addInput('object',  0);          // THREE.Object3D — riferimento diretto, ha priorità su 'nome' se collegato
        this.addInput('name',     'string');
        this.addInput('scale',    0);          // {x,y,z} o number
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);         // passthrough — solo se agito per riferimento
        this.color   = '#2a1a4a';
        this.bgcolor = '#4a1d96';
        this.size    = [220, 130];
    }
    TJSSetScale.title = 'Set Scale';
    TJSSetScale.desc  = 'Scales an object — accepts {x,y,z} or a uniform scalar number — by direct reference or by name';
    TJSSetScale.portHelp = {
        inputs: {
            trigger: 'event — applies the scale',
            object:  'THREE.Object3D — direct reference, optional, takes priority over "name" if connected',
            name:    'text — name of the object in the scene, used only if "object" is not connected, overrides the widget',
            scale:   'number (uniform scale on the 3 axes) or {x,y,z}, required',
        },
        outputs: {
            done:      'event — fired once applied',
            '→object': 'THREE.Object3D — the modified object (passthrough), present only when acting by direct reference — by name it may apply to several objects at once, so it stays empty',
        },
    };
    TJSSetScale.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const refObj = this.getInputData(1);
        const input  = this.getInputData(3);
        if (input == null) return;
        let sx, sy, sz;
        if (typeof input === 'number') {
            sx = sy = sz = input;
        } else {
            sx = input.x ?? 1; sy = input.y ?? 1; sz = input.z ?? 1;
        }
        if (refObj?.isObject3D) {
            refObj.scale.set(sx, sy, sz);
            this.setOutputData(1, refObj);
        } else {
            const name = this.getInputData(2) ?? this.properties.name;
            if (name == null) return;
            ctx.scene.traverse(obj => {
                if (obj.name === name) obj.scale.set(sx, sy, sz);
            });
        }
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/SetScale', TJSSetScale);


    // ─── TJS/Object/GetTransform ──────────────────────────────────────────────
    // Legge posizione/rotazione/scala/visibilità di un Object3D per riferimento
    // diretto — nessuna traverse(), zero ambiguità (lavora su un puntatore
    // vero, non su un nome). Complemento in lettura di SetTransform; stessa
    // forma di output di Scene Get Object By Name per poterli scambiare
    // facilmente a valle. Alimentato tipicamente da 'oggetti' di
    // Scene Get Object Names, da un evento (es. OnPick) o dal passthrough di
    // un altro nodo Object/Set*.
    function TJSObjectGetTransform() {
        this.addInput('trigger',   ACTION);
        this.addInput('object',   0);        // THREE.Object3D — riferimento diretto
        this.addOutput('position', 'object'); // {x,y,z} world
        this.addOutput('rotation', 'object'); // {x,y,z} euler gradi
        this.addOutput('scale',    'object'); // {x,y,z}
        this.addOutput('visible',  'boolean');
        this.addOutput('found',  'boolean');
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [220, 150];
    }
    TJSObjectGetTransform.title = 'Object Get Transform';
    TJSObjectGetTransform.desc  = 'Reads transform and visibility of an Object3D by direct reference (not the name)';
    TJSObjectGetTransform.portHelp = {
        inputs: {
            trigger: 'event — reads the current properties of the object',
            object:  'THREE.Object3D — direct reference, required',
        },
        outputs: {
            position: '{x,y,z} — world position',
            rotation: '{x,y,z} — euler rotation in degrees',
            scale:    '{x,y,z}',
            visible:  'boolean',
            found:    'boolean — false if "object" is not connected or is not a valid Object3D (in that case the other outputs are not updated)',
        },
    };
    TJSObjectGetTransform.prototype.onAction = function () {
        const obj = this.getInputData(1);
        if (!obj?.isObject3D) {
            this.setOutputData(4, false);
            return;
        }
        const wp = _getWorldPosition(obj);
        const R  = 180 / Math.PI;
        this.setOutputData(0, wp);
        this.setOutputData(1, { x: obj.rotation.x * R, y: obj.rotation.y * R, z: obj.rotation.z * R });
        this.setOutputData(2, { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z });
        this.setOutputData(3, obj.visible);
        this.setOutputData(4, true);
    };
    LG.registerNodeType('TJS/Object/GetTransform', TJSObjectGetTransform);


    // ─── TJS/Object/Rename ────────────────────────────────────────────────────
    // Rinomina un Object3D per riferimento diretto (non il nome corrente).
    function TJSObjectRename() {
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'new name', '', v => { this.properties.name = v; }, { property: 'name' });
        this.addInput('trigger', ACTION);
        this.addInput('object', 0);        // THREE.Object3D — riferimento diretto
        this.addInput('name',    'string'); // sovrascrive il widget
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);       // passthrough — stesso riferimento in ingresso, per concatenare
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [220, 120];
    }
    TJSObjectRename.title = 'Object Rename';
    TJSObjectRename.desc  = 'Renames an Object3D by direct reference';
    TJSObjectRename.portHelp = {
        inputs: {
            trigger: 'event — applies the new name',
            object:  'THREE.Object3D — direct reference, required',
            name:    'text — new name, overrides the widget',
        },
        outputs: {
            done:      'event — fired once renamed',
            '→object': 'THREE.Object3D — the same input object (passthrough — the → symbol means it is the same reference, not new data), to chain other nodes',
        },
    };
    TJSObjectRename.prototype.onAction = function () {
        const obj  = this.getInputData(1);
        const nome = this.getInputData(2) ?? this.properties.name;
        if (!obj?.isObject3D || !nome) return;
        obj.name = nome;
        this.setOutputData(1, obj);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/Rename', TJSObjectRename);


    // ─── TJS/Object/MergeChildMeshes ──────────────────────────────────────────
    // Salda in un'unica Mesh tutte le Mesh figlie DIRETTE (un solo livello
    // sotto, non l'intero sottoalbero) dell'oggetto in ingresso, eliminando i
    // vertici duplicati alle giunzioni (BufferGeometryUtils.mergeGeometries +
    // mergeVertices) e ricalcolando le normali per un'ombreggiatura continua.
    // Nome: 'nome' (opzionale) assegna il nome della mesh risultante; se
    // scollegato/vuoto resta il default di sempre (nome invariato se 'oggetto'
    // era già una Mesh, altrimenti "<nome padre>_merged").
    // Materiale: 'materiale' (opzionale) è il NOME di un materiale già
    // esistente da cercare in tutta la scena (per .material.name) e
    // assegnare al risultato; se scollegato/vuoto o non trovato, valgono i
    // default di sempre — se 'oggetto' è già una Mesh (caso tipico: un
    // placeholder/contenitore con materiale proprio e le mesh reali come
    // figlie) il materiale resta quello del padre; se 'oggetto' è un Group
    // (nessun materiale proprio) si usa quello della prima mesh figlia
    // trovata. Le mesh figlie originarie vengono rimosse e le loro geometrie
    // disposte — le loro property di materiale NON vengono disposte
    // (potrebbero essere condivise altrove).
    function TJSObjectMergeChildMeshes() {
        this.addProperty('name',      '', 'string');
        this.addProperty('material',  '', 'string');
        this.addWidget('text', 'mesh name',        '', v => { this.properties.name     = v; }, { property: 'name' });
        this.addWidget('text', 'material (name)',  '', v => { this.properties.material = v; }, { property: 'material' });
        this.addInput('trigger',   ACTION);
        this.addInput('object',   0);          // THREE.Object3D — genitore, obbligatorio
        this.addInput('name',      'string');   // sovrascrive il widget — nome della mesh risultante
        this.addInput('material', 'string');   // sovrascrive il widget — nome di un materiale esistente da assegnare
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);        // passthrough — stesso riferimento del genitore in ingresso
        this.addOutput('mesh',     0);        // la Mesh risultante — NON un passthrough puro: coincide con oggetto solo se oggetto era già una Mesh
        this.addOutput('count',    'number'); // quante mesh figlie sono state saldate
        this.color   = '#3a1a1a';   // famiglia Cancellazioni (distruttivo: rimuove le mesh figlie originarie)
        this.bgcolor = '#7f1d1d';
        this.size    = [240, 190];
    }
    TJSObjectMergeChildMeshes.title = 'Object Merge Child Meshes';
    TJSObjectMergeChildMeshes.desc  = 'Merges the direct child Meshes into a single one, removing the duplicate vertices at the joints';
    TJSObjectMergeChildMeshes.portHelp = {
        inputs: {
            trigger:    'event — runs the merge (cannot be undone)',
            object:     'THREE.Object3D — parent whose direct child Meshes are merged, required',
            name:       'text — name of the resulting mesh, optional (overrides the widget); if empty the default stays (unchanged if "object" was already a Mesh, "<parent name>_merged" if it was a Group)',
            material:   'text — name of a material already in the scene to assign to the result, optional (overrides the widget); if empty or not found the defaults apply (material of the parent if it was a Mesh, of the first child mesh if it was a Group)',
        },
        outputs: {
            done:      'event — fired once merged',
            '→object': 'THREE.Object3D — the same input object (passthrough — the → symbol means it is the same reference, not new data)',
            mesh:      'THREE.Mesh — the mesh resulting from the merge (NOT a passthrough: it is "object" only if "object" was already a Mesh, otherwise it is a new child Mesh)',
            count:     'number — how many direct child meshes were merged and removed',
        },
    };
    TJSObjectMergeChildMeshes.prototype.onAction = function () {
        const ctx    = this.graph?._appContext;
        const parent = this.getInputData(1);
        if (!parent?.isObject3D) return;
        const kids = parent.children.filter(c => c.isMesh);
        if (kids.length < 1) return;

        const geometries = [];
        for (const child of kids) {
            child.updateMatrix();
            const g = child.geometry.clone();
            g.applyMatrix4(child.matrix);   // porta la geometria in spazio locale al genitore
            geometries.push(g);
        }

        let merged = null;
        try {
            merged = mergeGeometries(geometries, false);
            if (merged) {
                merged = mergeVertices(merged);
                merged.computeVertexNormals();
            }
        } catch (e) {
            console.warn('[TJS/Object/MergeChildMeshes] merge failed:', e);
            merged = null;
        }
        for (const g of geometries) g.dispose();
        if (!merged) return;   // geometrie incompatibili (es. attributi diversi) — nessuna modifica

        const nameOverride = String(this.getInputData(2) ?? this.properties.name ?? '').trim();
        const matNameQuery = String(this.getInputData(3) ?? this.properties.material ?? '').trim();
        let materialOverride = null;
        if (matNameQuery) {
            materialOverride = ctx?.scene ? _findMaterialByName(ctx.scene, matNameQuery) : null;
            if (!materialOverride) console.warn(`[TJS/Object/MergeChildMeshes] material "${matNameQuery}" not found, using the default`);
        }

        let resultMesh;
        if (parent.isMesh) {
            parent.geometry?.dispose?.();
            parent.geometry = merged;
            if (materialOverride) parent.material = materialOverride;
            if (nameOverride) parent.name = nameOverride;
            resultMesh = parent;
        } else {
            const material = materialOverride ?? kids[0].material ?? new THREE.MeshStandardMaterial();
            resultMesh = new THREE.Mesh(merged, material);
            resultMesh.name = nameOverride || (parent.name ? parent.name + '_merged' : 'merged');
            parent.add(resultMesh);
        }

        for (const child of kids) {
            child.geometry?.dispose?.();
            child.removeFromParent();
        }

        this.setOutputData(1, parent);
        this.setOutputData(2, resultMesh);
        this.setOutputData(3, kids.length);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/MergeChildMeshes', TJSObjectMergeChildMeshes);


    // ─── TJS/Object/ExportGLB ──────────────────────────────────────────────────
    // Esporta un Object3D (e tutti i suoi discendenti, materiali/texture
    // inclusi) in formato binario .glb e avvia subito il download nel
    // browser — non passa dal nodo nativo 'File IO/Download' perché il suo
    // contratto dati (stringa/JSON vs binario) non è garantito per un
    // ArrayBuffer GLB; qui il download è gestito direttamente (Blob +
    // <a download> + revokeObjectURL), stesso pattern minimo usato ovunque
    // nei browser per scaricare dati generati lato client. 'fatto' viene
    // emesso solo a download realmente avviato (GLTFExporter.parse è
    // asincrono), non alla sola chiamata del nodo.
    // Vista clay attiva (finestra Ambiente): il GLB conterrebbe il materiale clay al posto degli
    // originali — si chiede conferma (2026-10-21, richiesta dell'utente).
    function _clayConfirm(ctx) {
        if (!ctx?.clay?.isEnabled?.()) return true;
        return window.confirm('Clay view is active: the GLB will contain the clay material instead of the original materials.\n\nSave anyway? (Cancel, then turn Clay off in the Environment window to keep the originals.)');
    }

    function TJSObjectExportGLB() {
        this.addProperty('filename', 'export', 'string');
        this.addWidget('text', 'file name', 'export', v => { this.properties.filename = v; }, { property: 'filename' });
        this.addInput('trigger',   ACTION);
        this.addInput('object',   0);          // THREE.Object3D — cosa esportare, obbligatorio
        this.addInput('fileName', 'string');   // sovrascrive il widget (senza estensione)
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);          // passthrough — stesso riferimento in ingresso (NON i byte del .glb, vedi portHelp)
        this.color   = '#4a3010';   // famiglia Salvataggio
        this.bgcolor = '#a16207';
        this.size    = [230, 110];
    }
    TJSObjectExportGLB.title = 'Object Export GLB';
    TJSObjectExportGLB.desc  = 'Exports an Object3D (with its descendants) to .glb and starts the download in the browser';
    TJSObjectExportGLB.portHelp = {
        inputs: {
            trigger:  'event — starts the export',
            object:   'THREE.Object3D — what to export, with all its descendants, required',
            fileName: 'text — name of the downloaded file, without the ".glb" extension, overrides the widget',
        },
        outputs: {
            done:      'event — fired when the download has started (after the export, which is asynchronous)',
            '→object': 'THREE.Object3D — the same input object (passthrough — the → symbol means it is the same reference, NOT the bytes of the exported .glb file, which are never exposed as graph data)',
        },
    };
    TJSObjectExportGLB.prototype.onAction = function () {
        const obj = this.getInputData(1);
        if (!obj?.isObject3D) return;
        if (!_clayConfirm(this.graph?._appContext)) return;
        const raw  = (this.getInputData(2) ?? this.properties.filename ?? 'export').trim() || 'export';
        const name = raw.toLowerCase().endsWith('.glb') ? raw : raw + '.glb';
        const exporter = new GLTFExporter();
        exporter.parse(
            obj,
            (result) => {
                const blob = new Blob([result], { type: 'model/gltf-binary' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                this.setOutputData(1, obj);
                this.triggerSlot(0);
            },
            (err) => console.error('[TJS/Object/ExportGLB] export failed:', err),
            { binary: true },
        );
    };
    LG.registerNodeType('TJS/Object/ExportGLB', TJSObjectExportGLB);


    // ─── TJS/Model/Load URL ───────────────────────────────────────────────────
    // Carica nel pannello un modello da un URL ricevuto a runtime (es. dal pulsante
    // "Vedi" di HTM/HYS/Archivio Esercitazioni, via bus), senza che sia un modello
    // collegato all'oggetto. Formati di loadAnyModel: glb/gltf, obj, wrl/wrz/vrml, drc,
    // ply, svg. Il modello caricato da questo nodo sostituisce il precedente (stesso nodo).
    function _disposeTree(root) {
        root?.traverse?.((o) => {
            o.geometry?.dispose?.();
            for (const m of [].concat(o.material ?? [])) {
                if (!m || m.name === 'TJS_CLAY') continue;   // clay: condiviso dal pannello (TJS-clay.mjs)
                for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
                m.dispose?.();
            }
        });
    }
    function _fitCamera(ctx, obj) {
        const cam = ctx?.camera, controls = ctx?.orbitControls;
        const box = new THREE.Box3().setFromObject(obj);
        if (!cam || box.isEmpty()) return;
        const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        const maxSize = Math.max(size.x, size.y, size.z) || 1;
        const from = controls?.target ?? center;
        const dir = new THREE.Vector3().subVectors(cam.position, from);
        if (dir.lengthSq() < 1e-12) dir.set(1, 0.6, 1);
        dir.normalize();
        if (cam.isPerspectiveCamera) {
            const dist = (maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))) * 1.25;
            cam.position.copy(center).addScaledVector(dir, dist);
            cam.near = dist / 100;
            cam.far  = dist * 100;
        } else if (cam.isOrthographicCamera) {
            cam.position.copy(center).addScaledVector(dir, maxSize * 2);
            cam.zoom = Math.min((cam.right - cam.left), (cam.top - cam.bottom)) / (maxSize * 1.25);
            cam.near = -maxSize * 10;
            cam.far  = maxSize * 10;
        }
        cam.updateProjectionMatrix();
        controls?.target?.copy(center);
        controls?.update?.();
    }

    function TJSModelLoadURL() {
        this.addInput('trigger', ACTION);
        this.addInput('url',     'string,object');
        this.addOutput('done',     EVENT);
        this.addOutput('object',   0);
        this.addOutput('error',   EVENT);
        this.addOutput('message', 'string');
        this.addProperty('fitCamera', true);
        this.addProperty('replace', true);
        this.addWidget('toggle', 'fit camera', true, v => { this.properties.fitCamera = v; }, { property: 'fitCamera' });
        this.addWidget('toggle', 'replace the previous one', true, v => { this.properties.replace = v; }, { property: 'replace' });
        this._loaded = [];
        this._url = '';
        this._token = 0;
        this._ctrl = null;
        this.color   = '#064e3b';   // famiglia Creazione (intensa — produce un nuovo Object3D nella scena)
        this.bgcolor = '#065f46';
        this.size    = [240, 130];
    }
    TJSModelLoadURL.title = 'Model Load URL';
    TJSModelLoadURL.desc  = 'Loads into the panel the model of a URL received at runtime (glb, gltf, obj, wrl/wrz, drc, ply, svg), replacing the one loaded before by this node';
    TJSModelLoadURL.portHelp = {
        inputs: {
            trigger: 'event — loads the model of the "url" input (the same URL already shown is not reloaded)',
            url:     'text (file URL) or object with model_url / url / mod_abs_url — for example the App Bus Receiver payload from the "View" button of the Exercise Archive. Empty = removes the loaded model.',
        },
        outputs: {
            done:    'event — model loaded and added to the scene',
            object:  'THREE.Object3D — the group of the loaded model (child of the panel models root)',
            error:   'event — loading failed',
            message: 'text — description of the error, or the name of the loaded file',
        },
        properties: {
            fitCamera: 'After loading, the camera frames the model.',
            replace:   'Removes (and frees from memory) the model loaded before by this node.',
        },
    };
    TJSModelLoadURL.prototype._clear = function () {
        for (const g of this._loaded) { g.removeFromParent(); _disposeTree(g); }
        this._loaded = [];
        this._url = '';
    };
    TJSModelLoadURL.prototype.onAction = async function () {
        const ctx = this.graph?._appContext;
        const parent = ctx?.modelsRoot ?? ctx?.scene;
        if (!parent) return;
        const v = this.getInputData(1);
        const url = String((v && typeof v === 'object') ? (v.model_url ?? v.url ?? v.mod_abs_url ?? '') : (v ?? '')).trim();
        if (!url) { this._clear(); _ctxDirty(this); return; }
        if (url === this._url && this._loaded.length) return;

        const token = ++this._token;
        this._ctrl?.abort();
        const ctrl = (this._ctrl = new AbortController());
        const name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'model');
        try {
            const obj = await loadAnyModel({ mod_abs_url: url }, { signal: ctrl.signal });
            if (token !== this._token || ctx.signal?.aborted) { _disposeTree(obj); return; }
            TJS_checkModel(obj, { url, modName: name, app: 'TJS' });
            if (this.properties.replace !== false) this._clear();
            const g = new THREE.Group();
            g.name = (v && typeof v === 'object' && v.title) ? String(v.title) : name;
            // esercitazione di provenienza (payload dell'Archivio): la usa TJS/Model/Save Esercitazione
            const ese = (v && typeof v === 'object' && Number(v.id_ese) > 0)
                ? { id_ese: Number(v.id_ese), title: v.title ?? '', model_file: v.model_file ?? '' } : null;
            g.userData = { loadedUrl: url, esercitazione: ese };
            g.add(obj);
            parent.add(g);
            this._loaded.push(g);
            this._url = url;
            if (this.properties.fitCamera !== false) _fitCamera(ctx, g);
            _ctxDirty(this);
            this.setOutputData(1, g);
            this.setOutputData(3, name);
            this.triggerSlot(0);
        } catch (e) {
            if (e?.name === 'AbortError' || token !== this._token) return;
            const msg = `${name}: ${e?.message ?? e}`;
            console.warn('[TJS/Model/Load URL]', msg, e);
            this.setOutputData(3, msg);
            this.triggerSlot(2);
        }
    };
    TJSModelLoadURL.prototype.onStop = function () { this._ctrl?.abort(); this._token++; };
    TJSModelLoadURL.prototype.onRemoved = function () { this.onStop(); this._clear(); _ctxDirty(this); };
    LG.registerNodeType('TJS/Model/Load URL', TJSModelLoadURL);


    // ─── TJS/Model/Save Esercitazione ─────────────────────────────────────────
    // Salva in GLB, nella cartella di un'esercitazione HySpace, l'oggetto così com'è nella
    // scena (con le modifiche fatte nel pannello). Chiede il nome (proposto: quello del
    // modello attuale con estensione .glb), chiede conferma se il file c'è già, e (proprietà
    // imposta_modello) lo registra come modello dell'esercitazione. Solo amministratore
    // (api/hys_archive_tool.php?action=save). Esportazione: TJS-glb-export.mjs.
    function _panelToast(ctx, text, isError = false) {
        const host = ctx?.renderer?.domElement?.parentElement;
        if (!host) { (isError ? console.warn : console.info)('[TJS]', text); return; }
        let box = host.querySelector(':scope > .tjs-toast');
        if (!box) {
            box = document.createElement('div');
            box.className = 'tjs-toast';
            box.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);max-width:90%;z-index:30;' +
                                'padding:6px 12px;border-radius:4px;font:13px/1.35 system-ui,sans-serif;pointer-events:none;';
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
            host.appendChild(box);
        }
        box.style.background = isError ? 'rgba(120,20,20,.92)' : 'rgba(20,30,50,.88)';
        box.style.color = '#fff';
        box.textContent = text;
        clearTimeout(box._t);
        box._t = setTimeout(() => box.remove(), isError ? 9000 : 5000);
    }
    const _mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';

    function TJSModelSaveEse() {
        this.addInput('trigger',       ACTION);
        this.addInput('object',       0);
        this.addInput('exercise', 'number,object');
        this.addOutput('done',     EVENT);
        this.addOutput('file',    'object');
        this.addOutput('error',   EVENT);
        this.addOutput('message', 'string');
        this.addProperty('setAsModel', true);
        this.addWidget('toggle', 'set as model', true, v => { this.properties.setAsModel = v; }, { property: 'setAsModel' });
        this._busy = false;
        this.color   = '#4a3010';   // famiglia Salvataggio
        this.bgcolor = '#a16207';
        this.size    = [250, 110];
    }
    TJSModelSaveEse.title = 'Model Save Exercise';
    TJSModelSaveEse.desc  = 'Saves as GLB, in the exercise folder, the object as it is in the scene (with the changes): asks for the name and, if the file exists, for confirmation — administrator only';
    TJSModelSaveEse.portHelp = {
        inputs: {
            trigger:  'event — starts saving (for example from a ReseArch/Menu/Command "Save model")',
            object:   'THREE.Object3D — what to save, with its descendants and its transform; usually the "object" output of TJS/Model/Load URL',
            exercise: 'optional — id_ese (number) or object with id_ese; if missing, the exercise from which Load URL loaded the object is used',
        },
        outputs: {
            done:    'event — file saved',
            file:    'object { id_ese, model_file, model_url, bytes, model_set } — for App Bus Emitter (e.g. "ese:salvato", bus ON) → "saved" input of the Exercise Archive, which updates the row',
            error:   'event — saving failed (cancelling the name is not an error)',
            message: 'text — result or error',
        },
        properties: {
            setAsModel: 'The saved GLB becomes the model of the exercise (field modello_3d). Off: the file is only saved in the folder.',
        },
    };
    TJSModelSaveEse.prototype._fail = function (ctx, msg) {
        _panelToast(ctx, msg, true);
        this.setOutputData(3, msg);
        this.triggerSlot(2);
    };
    TJSModelSaveEse.prototype.onAction = async function () {
        const ctx = this.graph?._appContext;
        if (this._busy) { _panelToast(ctx, 'Saving already in progress…'); return; }
        const obj = this.getInputData(1);
        if (!obj?.isObject3D) { this._fail(ctx, 'Nothing to save: connect the "object" output of TJS/Model/Load URL (or another scene object).'); return; }
        const v = this.getInputData(2);
        const fromObj = obj.userData?.esercitazione ?? null;
        const idEse = Number((v && typeof v === 'object') ? v.id_ese : v) || Number(fromObj?.id_ese) || 0;
        if (!(idEse > 0)) { this._fail(ctx, 'Unknown exercise: the object does not come from the Archive and the "exercise" input is empty.'); return; }
        if (!_clayConfirm(ctx)) { _panelToast(ctx, 'Saving cancelled.'); return; }

        // nome proposto: il modello attuale con estensione .glb (stessa sottocartella)
        const cur = String((v && typeof v === 'object' && v.model_file) || fromObj?.model_file
                           || decodeURIComponent(String(obj.userData?.loadedUrl ?? '').split('?')[0].split('/').pop() || '')).trim();
        const proposal = cur ? cur.replace(/\.[^./]*$/, '') + '.glb' : 'model.glb';
        const title = (v && typeof v === 'object' && v.title) || fromObj?.title || `exercise ${idEse}`;
        const answer = window.prompt(`Save the model of «${title}» in the exercise folder.\n\nFile name (confirm or rename):`, proposal);
        if (answer === null) return;
        let name = answer.trim().replace(/\\/g, '/');
        if (!name) { this._fail(ctx, 'Empty name: nothing was saved.'); return; }
        if (!/\.glb$/i.test(name)) name = name.replace(/\.[^./]*$/, '') + '.glb';

        this._busy = true;
        try {
            _panelToast(ctx, 'Exporting GLB…');
            const { glb, stats } = await TJS_exportGlb(obj);
            if (glb.byteLength > 100 * 1048576) throw new Error(`GLB of ${_mb(glb.byteLength)}: over the 100 MB limit`);
            const send = async (overwrite) => {
                const q = new URLSearchParams({ action: 'save', id_ese: String(idEse), name, overwrite: overwrite ? '1' : '0',
                                                set_model: this.properties.setAsModel === false ? '0' : '1' });
                const r = await fetch(`api/hys_archive_tool.php?${q}`, { method: 'POST', credentials: 'same-origin',
                                      headers: { 'Content-Type': 'application/octet-stream' }, body: glb });
                const j = await r.json().catch(() => null);
                return { r, j };
            };
            _panelToast(ctx, `Sending (${_mb(glb.byteLength)})…`);
            let { r, j } = await send(false);
            if (r.status === 409 && j?.exists) {
                if (!window.confirm(`The file ${j.path ?? name} already exists in the exercise folder.\nOverwrite it?`)) {
                    _panelToast(ctx, 'Saving cancelled.');
                    return;
                }
                ({ r, j } = await send(true));
            }
            if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
            const d = j.data;
            if (fromObj && Number(fromObj.id_ese) === idEse && d.model_set) fromObj.model_file = d.model_file;
            const notes = [];
            if (stats.materialsConverted) notes.push(`${stats.materialsConverted} materials converted`);
            if (stats.texturesMissing) notes.push(`${stats.texturesMissing} texture${stats.texturesMissing === 1 ? '' : 's'} not found, removed`);
            if (stats.normalsFixed) notes.push(`normals computed on ${stats.normalsFixed} meshes`);
            if (stats.removed) notes.push(`${stats.removed} backgrounds/helpers excluded`);
            const msg = `Saved ${d.model_file} (${_mb(d.bytes)})${d.model_set ? ' as the model of the exercise' : ''}${notes.length ? ' — ' + notes.join(', ') : ''}.`;
            _panelToast(ctx, msg);
            this.setOutputData(1, { ...d, title });
            this.setOutputData(3, msg);
            this.triggerSlot(0);
        } catch (e) {
            console.warn('[TJS/Model/Save Esercitazione]', e);
            this._fail(ctx, `Saving failed: ${e?.message ?? e}`);
        } finally {
            this._busy = false;
        }
    };
    LG.registerNodeType('TJS/Model/Save Esercitazione', TJSModelSaveEse);


    // ─── TJS/Object/SetTransform ──────────────────────────────────────────────
    // Applica posizione, rotazione e scala su un riferimento Object3D diretto.
    // Tutti gli input sono opzionali: viene modificato solo ciò che è connesso.
    // L'oggetto viene riemesso in output per consentire il chaining.
    function TJSObjectSetTransform() {
        this.addInput('trigger',   ACTION);
        this.addInput('object',   0);        // THREE.Object3D — riferimento diretto
        this.addInput('position',  0);        // {x,y,z} | [x,y,z] | THREE.Vector3
        this.addInput('rotation°', 0);        // {x,y,z} | [x,y,z] in gradi
        this.addInput('scale',     0);        // {x,y,z} | number (uniforme)
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);        // passthrough — stesso riferimento in ingresso, per concatenare
        this.color   = '#2a1a4a';
        this.bgcolor = '#4a1d96';
        this.size    = [230, 145];
    }
    TJSObjectSetTransform.title = 'Object Set Transform';
    TJSObjectSetTransform.desc  = 'Applies position/rotation/scale to an Object3D by direct reference';
    TJSObjectSetTransform.portHelp = {
        inputs: {
            trigger:    'event — applies the transform',
            object:     'THREE.Object3D — direct reference (not the name), required',
            position:   '{x,y,z} | [x,y,z] | THREE.Vector3 — optional, untouched if not connected. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            'rotation°': '{x,y,z} | [x,y,z] in DEGREES — optional, untouched if not connected',
            scale:      '{x,y,z} | uniform number — optional, untouched if not connected',
        },
        outputs: {
            done:      'event — fired once applied',
            '→object': 'THREE.Object3D — the same input object (passthrough — the → symbol means it is the same reference, not new data), to chain other nodes',
        },
    };
    TJSObjectSetTransform.prototype.onAction = function () {
        const obj = this.getInputData(1);
        if (!obj?.isObject3D) return;
        const posIn = this.getInputData(2);
        const pos = _readPoint3(posIn);
        if (posIn != null && !pos) _pointWarn(this, 'position', posIn);
        const rot = this.getInputData(3);
        const scl = this.getInputData(4);
        const D2R = Math.PI / 180;
        if (pos != null) {
            obj.position.set(
                pos.x ?? pos[0] ?? 0,
                pos.y ?? pos[1] ?? 0,
                pos.z ?? pos[2] ?? 0,
            );
        }
        if (rot != null) {
            obj.rotation.set(
                (rot.x ?? rot[0] ?? 0) * D2R,
                (rot.y ?? rot[1] ?? 0) * D2R,
                (rot.z ?? rot[2] ?? 0) * D2R,
            );
        }
        if (scl != null) {
            if (typeof scl === 'number') {
                obj.scale.setScalar(scl);
            } else {
                obj.scale.set(scl.x ?? scl[0] ?? 1, scl.y ?? scl[1] ?? 1, scl.z ?? scl[2] ?? 1);
            }
        }
        this.setOutputData(1, obj);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/SetTransform', TJSObjectSetTransform);


    // ─── TJS/Object/SetMaterial ───────────────────────────────────────────────
    // Aggiorna colore, opacità e wireframe di un Object3D per riferimento diretto.
    // Attraversa tutti i Mesh discendenti (utile anche su Group).
    function TJSObjectSetMaterial() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('object',   0);        // THREE.Object3D — riferimento diretto
        this.addInput('color',    'string'); // hex, sovrascrive widget
        this.addInput('opacity',   'number'); // 0..1, sovrascrive widget
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);        // passthrough — stesso riferimento in ingresso, per concatenare
        this.color   = '#2a1a4a';
        this.bgcolor = '#4a1d96';
        this.size    = [230, 170];
    }
    TJSObjectSetMaterial.title = 'Object Set Material';
    TJSObjectSetMaterial.desc  = 'Updates color/opacity/wireframe on all the Meshes of an Object3D';
    TJSObjectSetMaterial.portHelp = {
        inputs: {
            trigger:    'event — applies the changes',
            object:     'THREE.Object3D — direct reference, also walks the descendant Meshes (useful on a Group)',
            color:      'text — hex color (e.g. "ffffff"), overrides the widget',
            opacity:    'number 0–1, overrides the widget',
            wireframe:  'boolean, overrides the widget',
        },
        outputs: {
            done:      'event — fired once applied',
            '→object': 'THREE.Object3D — the same input object (passthrough — the → symbol means it is the same reference, not new data)',
        },
    };
    TJSObjectSetMaterial.prototype.onAction = function () {
        const obj = this.getInputData(1);
        if (!obj?.isObject3D) return;
        const _in = (i, prop) => { const v = this.getInputData(i); return v != null ? v : this.properties[prop]; };
        const colorHex  = String(_in(2, 'color')     ?? 'ffffff').replace('#', '');
        const opacity   = Math.max(0, Math.min(1, Number(_in(3, 'opacity')   ?? 1)));
        const wireframe = Boolean(_in(4, 'wireframe') ?? false);
        obj.traverse(o => {
            if (!o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (!m) continue;
                m.color?.setHex?.(parseInt(colorHex, 16));
                m.opacity     = opacity;
                m.transparent = opacity < 1;
                m.wireframe   = wireframe;
                m.needsUpdate = true;
            }
        });
        this.setOutputData(1, obj);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/SetMaterial', TJSObjectSetMaterial);


    // ─── TJS/Object/AssignMaterial ────────────────────────────────────────────
    // Assegna un materiale (per riferimento, non una copia) a una Mesh, o a
    // tutte le Mesh discendenti di un Group — il pezzo che chiude il cerchio
    // fra TJS/Material/Create + Material/Set* (che producono/modificano un
    // materiale scollegato da qualunque oggetto) e la scena vera.
    function TJSObjectAssignMaterial() {
        this.addInput('trigger',   ACTION);
        this.addInput('object',   0);          // THREE.Object3D — riferimento diretto
        this.addInput('material', 'material'); // THREE.Material — riferimento diretto
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);          // passthrough
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 110];
    }
    TJSObjectAssignMaterial.title = 'Object Assign Material';
    TJSObjectAssignMaterial.desc  = 'Assigns a material (by reference) to a Mesh, or to all the descendant Meshes of a Group';
    TJSObjectAssignMaterial.portHelp = {
        inputs: {
            trigger:  'event — applies the assignment',
            object:   'THREE.Object3D — direct reference, required. If it is a Mesh the material is assigned to it, if it is a Group to all its descendant Meshes (same shared instance, not a copy for each)',
            material: 'THREE.Material — direct reference to assign, required (e.g. from Material Create, Material Get By Name, or another Material Set*)',
        },
        outputs: {
            done:      'event — fired once assigned',
            '→object': 'THREE.Object3D — the same input object (passthrough)',
        },
    };
    TJSObjectAssignMaterial.prototype.onAction = function () {
        const obj = this.getInputData(1);
        const mat = this.getInputData(2);
        if (!obj?.isObject3D || !mat?.isMaterial) return;
        if (obj.isMesh) {
            obj.material = mat;
        } else {
            obj.traverse(o => { if (o.isMesh) o.material = mat; });
        }
        this.setOutputData(1, obj);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/AssignMaterial', TJSObjectAssignMaterial);


    // ─── TJS/Object/GetMaterial ────────────────────────────────────────────────
    // Estrae il riferimento materiale da una Mesh — il pezzo che rende
    // esplicito che il materiale è condiviso (puntatore, non copia): se vuoi
    // partire da un oggetto invece che da Material Create/GetByName/GetAll,
    // questo è il passaggio obbligato prima di un Material Set* — decisione
    // presa esplicitamente il 2026-09-21 per non illudere che si stia
    // modificando "il colore di QUESTO oggetto" quando in realtà si sta
    // modificando una definizione potenzialmente condivisa con altri.
    // Include il conteggio di quante Mesh nella scena condividono lo stesso
    // materiale (stessa traverse+confronto per riferimento di Material Get
    // Objects Using It — economico, vedi portHelp).
    function TJSObjectGetMaterial() {
        this.addInput('trigger',  ACTION);
        this.addInput('object',  0);   // THREE.Object3D — riferimento diretto, atteso una Mesh
        this.addOutput('done',      EVENT);
        this.addOutput('material',  'material');  // primo/unico materiale (materiali[0] se multi-materiale)
        this.addOutput('materials',  'array');     // TUTTI i materiali della mesh (array anche se uno solo)
        this.addOutput('count',      'number');    // quante Mesh nella scena (compreso "object") condividono materials[0]
        this.addOutput('shared',  'boolean');   // conteggio > 1
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [230, 150];
    }
    TJSObjectGetMaterial.title = 'Object Get Material';
    TJSObjectGetMaterial.desc  = 'Extracts the material(s) of a Mesh, with a count of how much it is shared in the scene';
    TJSObjectGetMaterial.portHelp = {
        inputs: {
            trigger: 'event — reads the current material',
            object:  'THREE.Object3D — direct reference, must be a Mesh (with .material), required',
        },
        outputs: {
            done:      'event — fired once read (only if "object" is a Mesh with a material)',
            material:  'THREE.Material — the first (or only) material of the mesh, direct reference',
            materials: 'array of THREE.Material — all the materials of the mesh (length 1 in the common case, more if multi-material)',
            count:     'number — how many Meshes in the scene ("object" itself included) use the same "material" — tells how much it is shared before changing it',
            shared:    'boolean — shortcut for "count > 1", to branch without an extra Compare node',
        },
    };
    TJSObjectGetMaterial.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const obj = this.getInputData(1);
        if (!obj?.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        this.setOutputData(1, mats[0] ?? null);
        this.setOutputData(2, mats);

        let count = 0;
        if (ctx?.scene && mats[0]) {
            let root = null;
            ctx.scene.traverse(o => { if (!root && o.name === 'TJS_MODELS_ROOT') root = o; });
            const base = root ?? ctx.scene;
            base.traverse(o => {
                if (!o.isMesh || !o.material) return;
                const ms = Array.isArray(o.material) ? o.material : [o.material];
                if (ms.includes(mats[0])) count++;
            });
        }
        this.setOutputData(3, count);
        this.setOutputData(4, count > 1);

        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/GetMaterial', TJSObjectGetMaterial);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Texture — texture come entità a sé stanti, per alimentare 'map'/
    // 'normalMap'/'roughnessMap'/ecc. sui nodi Material/Set* (in arrivo come
    // passo successivo: input opzionali via RMB → Inputs, stesso schema già
    // usato per i parametri numerici/colore). Stessa natura "scollegata" dei
    // materiali: una THREE.Texture non è mai nella scena, esiste in memoria
    // dal momento in cui viene caricata.
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Texture/Load ──────────────────────────────────────────────────────
    // Carica una texture da URL (THREE.TextureLoader, asincrono) — nodo puro,
    // nessuna traverse. 'fatto' scatta solo a caricamento completato (non al
    // trigger), coerente con Object Export GLB (altra operazione async del
    // file). Ogni trigger avvia un NUOVO caricamento (nessuna cache per URL,
    // per semplicità — se serve evitare ricaricamenti ripetuti dello stesso
    // URL è un'estensione successiva).
    // NOTA su colorSpace: il loader NON imposta .colorSpace — dipende
    // dall'uso finale (sRGB per 'map'/colore, lineare per 'normalMap'/
    // 'roughnessMap'/ecc.) e questo nodo non sa ancora a cosa verrà
    // assegnata la texture. Da gestire quando aggiungeremo gli input
    // 'map'/'normalMap'/ecc. sui nodi Material/Set*.
    function TJSTextureLoad() {
        this.addProperty('url', '', 'string');
        this.addWidget('text', 'url', '', v => { this.properties.url = v; }, { property: 'url' });
        this.addInput('trigger', ACTION);
        this.addInput('url',     'string');   // sovrascrive il widget
        this.addOutput('done',    EVENT);
        this.addOutput('texture',  'texture');
        this.color   = '#14532d';   // famiglia Creazione — astratta (dato non ancora assegnato a nessun materiale)
        this.bgcolor = '#166534';
        this.size    = [230, 100];
    }
    TJSTextureLoad.title = 'Texture Load';
    TJSTextureLoad.desc  = 'Loads a texture from a URL (asynchronous) — to assign it to a material go through TJS/Texture/Map and the "maps" pin of a Material Set*';
    TJSTextureLoad.portHelp = {
        inputs: {
            trigger: 'event — starts loading (asynchronous)',
            url:     'text — texture URL (jpg/png/webp/etc.), overrides the widget. Subject to CORS if the server does not allow it',
            repeatX: '(absent by default, from the right-click menu → Inputs) number — horizontal repetitions (also enables RepeatWrapping on both axes)',
            repeatY: '(absent by default, from the right-click menu → Inputs) number — vertical repetitions (also enables RepeatWrapping on both axes)',
        },
        outputs: {
            done:    'event — fired only when loading is COMPLETE (not at the trigger, which only starts it)',
            texture: 'THREE.Texture — direct reference; to use it on a material pass it to the "texture" input of TJS/Texture/Map (which sets type, color space and controls)',
        },
    };
    TJSTextureLoad.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        return [['repeatX', 'number'], ['repeatY', 'number']].filter(([n]) => !has.has(n));
    };
    TJSTextureLoad.prototype.onAction = function () {
        const url = this.getInputData(1) ?? this.properties.url;
        if (!url) return;
        const loader = new THREE.TextureLoader();
        loader.load(
            url,
            (texture) => {
                const rxIdx = this.findInputSlot('repeatX');
                const ryIdx = this.findInputSlot('repeatY');
                if (rxIdx !== -1 || ryIdx !== -1) {
                    const rx = rxIdx !== -1 ? this.getInputData(rxIdx) : null;
                    const ry = ryIdx !== -1 ? this.getInputData(ryIdx) : null;
                    if (rx != null || ry != null) {
                        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                        texture.repeat.set(rx ?? 1, ry ?? 1);
                    }
                }
                this.setOutputData(1, texture);
                _ctxDirty(this);
                this.triggerSlot(0);
            },
            undefined,
            (err) => {
                console.warn(`[TJS/Texture/Load] loading failed for "${url}":`, err);
            },
        );
    };
    LG.registerNodeType('TJS/Texture/Load', TJSTextureLoad);

    // ─── TJS/Texture/Map ───────────────────────────────────────────────────────
    // Definisce UNA mappa di materiale: tipo (colore, normal, bump, displacement, env…),
    // sorgente (texture da Texture Load, oppure URL caricato qui) e controlli. L'uscita
    // "mappe" è un array: quello ricevuto sull'ingresso "mappe" + questa mappa, così i
    // nodi si concatenano; da solo dà [questa mappa], e più Map si possono raccogliere
    // anche con Params/Array/Maker. Va al pin "mappe" di un Material Set* (vedi
    // _matApplyMaps). Lo spazio colore lo decide il tipo (sRGB per colore/emissive/env/
    // matcap, lineare per le mappe di dati), risolvendo la nota di Texture Load.
    function TJSTextureMap() {
        this.addInput('maps',     'array');     // catena: mappe precedenti
        this.addInput('texture',   'texture');   // da TJS/Texture/Load (prevale sull'URL)
        this.addInput('url',       'string');    // sovrascrive il widget
        this.addInput('intensity', 'number');    // sovrascrive il widget
        this.addOutput('maps',    'array');
        this.addProperty('type', 'map', 'string');
        this.addProperty('url', '', 'string');
        this.addProperty('intensity', '', 'string');
        this.addProperty('bias', 0, 'number');
        this.addProperty('uv', '0', 'string');
        this.addProperty('repeat', '', 'string');
        this.addProperty('remove', false, 'boolean');
        this.addWidget('combo',  'type', 'map', v => { this.properties.type = v; this._retitle(); },
                       { values: Object.keys(_MAP_TYPES), property: 'type' });
        this.addWidget('text',   'url',            '', v => { this.properties.url = v; }, { property: 'url' });
        this.addWidget('text',   'intensity',      '', v => { this.properties.intensity = v; }, { property: 'intensity' });
        this.addWidget('number', 'bias (displ.)',  0,  v => { this.properties.bias = v; }, { property: 'bias', step: 1, precision: 3 });
        this.addWidget('combo',  'set UV', '0', v => { this.properties.uv = v; }, { values: ['0', '1'], property: 'uv' });
        this.addWidget('text',   'repeat x,y',     '', v => { this.properties.repeat = v; }, { property: 'repeat' });
        this.addWidget('toggle', 'remove from material', false, v => { this.properties.remove = v; }, { property: 'remove' });
        this._url = null;
        this._tex = null;
        this.color   = '#14532d';   // famiglia Creazione — astratta (dato, non ancora su un materiale)
        this.bgcolor = '#166534';
        this.size    = [250, 250];
        this._retitle();
    }
    TJSTextureMap.title = 'Texture Map';
    TJSTextureMap.desc  = 'One material map (type, texture or URL, intensity, UV, repeat) for the "maps" pin of the Material Set* nodes — chains with other Maps or is collected with Params/Array/Maker';
    TJSTextureMap.portHelp = {
        inputs: {
            maps:      'array (optional) — maps of the previous Maps in the chain: the output repeats them and adds this one',
            texture:   'THREE.Texture (optional, from Texture Load) — takes priority over the URL',
            url:       'text (optional) — image URL, overrides the widget; loaded here only once (reloaded if it changes)',
            intensity: 'number (optional) — overrides the "intensity" widget',
        },
        outputs: {
            maps: 'array of maps ([...maps input, this map]) — to the "maps" pin of a Material Set*',
        },
        properties: {
            type: 'Which material map: map (color), alpha, ao, emissive, normal, bump, displacement, roughness, metalness, env (reflections), light, specular, clearcoat, clearcoatRoughness, matcap. The Set node skips (with a console warning) the types its material does not have. displacement moves the vertices only in rendering: it needs a highly subdivided geometry, and raycast/collisions/pick keep using the original shape. bump: from a grayscale image, a light alternative to normal (glTF does not support it, so it never comes from GLB files). env: equirectangular image of the reflections for THIS material (Lambert/Phong/Basic do not use the scene environment).',
            url: 'Image URL (if no texture arrives on the pin).',
            intensity: 'Empty = the material value is not touched. Meaning by type: ao → aoMapIntensity (0–1), normal → normalScale, bump → bumpScale, displacement → displacementScale (in scene units), env → envMapIntensity (Standard/Physical) or reflectivity (Basic/Lambert/Phong), light → lightMapIntensity, emissive → emissiveIntensity.',
            bias: 'Displacement only: constant offset added (displacementBias), e.g. −scale/2 to center.',
            uv: 'UV coordinate set of the mesh: 0 = first UV, 1 = second (typical for ao and light baked in Blender).',
            repeat: '"x,y" — texture repetitions (enables RepeatWrapping). Empty = not touched. Note: the texture is shared, it applies to all the materials using it.',
            remove: 'On: removes the map of this type from the material (texture and URL ignored).',
        },
    };
    TJSTextureMap.prototype._retitle = function () { this.title = 'Map · ' + (this.properties.type || 'map'); };
    TJSTextureMap.prototype.onConfigure = function () { this._retitle(); };
    TJSTextureMap.prototype.onPropertyChanged = function (name) { if (name === 'type') setTimeout(() => this._retitle(), 0); };
    /** Texture: dal pin, altrimenti dall'URL (caricata una volta; ridisegna quando arriva). */
    TJSTextureMap.prototype._texture = function () {
        const t = this.getInputData(1);
        if (t?.isTexture) return t;
        const url = String(this.getInputData(2) ?? this.properties.url ?? '').trim();
        if (!url) return null;
        if (url !== this._url) {
            this._url = url;
            this._tex = new THREE.TextureLoader().load(
                url,
                () => _ctxDirty(this),
                undefined,
                (err) => console.warn(`[TJS/Texture/Map] loading failed for "${url}":`, err),
            );
            this._tex.name = url.split('/').pop();
        }
        return this._tex;
    };
    TJSTextureMap.prototype.onExecute = function () {
        const p = this.properties;
        const inInt = this.getInputData(3);
        const intensity = (inInt != null && Number.isFinite(Number(inInt))) ? Number(inInt)
                        : (String(p.intensity ?? '').trim() !== '' && Number.isFinite(Number(p.intensity))) ? Number(p.intensity)
                        : null;
        const rep = String(p.repeat ?? '').split(/[\s,;x]+/).filter(Boolean).map(Number);
        const def = {
            __tjsMap:  true,
            type:      p.type || 'map',
            texture:   p.remove ? null : this._texture(),
            remove:    !!p.remove,
            intensity,
            bias:      Number.isFinite(Number(p.bias)) ? Number(p.bias) : null,
            uv:        p.uv === '1' || p.uv === 1 ? 1 : 0,
            repeat:    rep.length >= 2 && rep.every(Number.isFinite) ? [rep[0], rep[1]] : null,
        };
        const prev = _flattenMaps(this.getInputData(0, true));
        this.setOutputData(0, [...prev, def]);
    };
    LG.registerNodeType('TJS/Texture/Map', TJSTextureMap);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Material — materiali come entità a sé stanti, scollegate dagli
    // oggetti. IMPORTANTE (chiarito 2026-09-21): un THREE.Material NON fa mai
    // parte della scena — nessun .add()/.parent/appartenenza, esiste in
    // memoria dal momento in cui viene creato. "Si vede" solo quando
    // assegnato a mesh.material (vedi TJS/Object/AssignMaterial). Nessun
    // registro globale dei materiali in Three.js: "trovare per nome" o
    // "trovare gli oggetti che lo usano" può funzionare SOLO attraversando
    // le Mesh della scena (stesso principio di _findMaterialByName, già
    // usato da MergeChildMeshes).
    // ═══════════════════════════════════════════════════════════════════════════

    const _MAT_CTORS = {
        Basic:    'MeshBasicMaterial',
        Depth:    'MeshDepthMaterial',
        Lambert:  'MeshLambertMaterial',
        Matcap:   'MeshMatcapMaterial',
        Normal:   'MeshNormalMaterial',
        Phong:    'MeshPhongMaterial',
        Physical: 'MeshPhysicalMaterial',
    };

    // Applica colore/opacità/wireframe — SEMPRE visibili su ogni nodo
    // Material/Set* (non nascondibili da RMB, a differenza dei parametri
    // specifici del tipo, aggiunti via onGetInputs) — su richiesta esplicita:
    // sono i tre parametri comuni a (quasi) tutti i tipi di materiale
    // Three.js. Stessa logica già usata da Object/SetMaterial, qui applicata
    // a un materiale per riferimento invece che a tutte le Mesh di un
    // Object3D. Guardie su ogni property: alcuni tipi non la possiedono
    // (es. MeshDepthMaterial/MeshNormalMaterial non hanno .color).
    // FIX (2026-09-21, su richiesta esplicita): letto per NOME (findInputSlot),
    // non per indice fisso — colore/opacità/wireframe sono ora anche loro
    // rimovibili da RMB → Inputs (come side/fog), quindi il loro indice di
    // slot non è più garantito stabile. Il widget resta comunque il
    // fallback quando il pin è assente O disconnesso: sono "sempre attivi"
    // nel senso che producono sempre un valore, non nel senso di essere
    // pin obbligatori.
    function _matApplyCommon(node, mat) {
        const colorSlot = node.findInputSlot('color');
        const colorIn   = (colorSlot !== -1 ? node.getInputData(colorSlot) : undefined) ?? node.properties.color;
        if (colorIn && mat.color) mat.color.setHex(parseInt(String(colorIn).replace('#', ''), 16));

        const opacitySlot = node.findInputSlot('opacity');
        const opacityIn    = (opacitySlot !== -1 ? node.getInputData(opacitySlot) : undefined) ?? node.properties.opacity;
        if (opacityIn != null && mat.opacity !== undefined) {
            mat.opacity     = Math.max(0, Math.min(1, Number(opacityIn)));
            mat.transparent = mat.opacity < 1;
        }

        const wireSlot = node.findInputSlot('wireframe');
        const wireIn    = (wireSlot !== -1 ? node.getInputData(wireSlot) : undefined) ?? node.properties.wireframe;
        if (wireIn != null && mat.wireframe !== undefined) mat.wireframe = Boolean(wireIn);
    }

    // Converte 'front'/'back'/'double' (case-insensitive) o un numero già
    // valido (THREE.FrontSide=0/BackSide=1/DoubleSide=2) in un side valido.
    function _matSideValue(v) {
        if (typeof v === 'number') return v;
        const s = String(v).toLowerCase();
        if (s.startsWith('back'))   return THREE.BackSide;
        if (s.startsWith('double')) return THREE.DoubleSide;
        return THREE.FrontSide;
    }

    // Applica 'side'/'fog' se i rispettivi pin sono presenti E collegati —
    // condivisi da tutti i Material/Set*, nessun widget/property di
    // fallback (a differenza di colore/opacità/wireframe): sono puramente
    // opzionali, se il pin non c'è la property del materiale non viene
    // toccata.
    function _matApplySideFog(node, mat) {
        const sideIdx = node.findInputSlot('side');
        if (sideIdx !== -1) {
            const side = node.getInputData(sideIdx);
            if (side != null) mat.side = _matSideValue(side);
        }
        const fogIdx = node.findInputSlot('fog');
        if (fogIdx !== -1) {
            const fog = node.getInputData(fogIdx);
            if (fog != null && mat.fog !== undefined) mat.fog = Boolean(fog);
        }
    }

    // Applica 'emissive'/'emissiveIntensity' se i rispettivi pin sono
    // presenti E collegati — condiviso da Lambert/Phong/Standard/Physical.
    // Stessa filosofia di _matApplySideFog: puramente opzionale, nessun
    // fallback.
    function _matApplyEmissive(node, mat) {
        const colorIdx = node.findInputSlot('emissive');
        if (colorIdx !== -1) {
            const c = node.getInputData(colorIdx);
            if (c && mat.emissive) mat.emissive.setHex(parseInt(String(c).replace('#', ''), 16));
        }
        const intIdx = node.findInputSlot('emissiveIntensity');
        if (intIdx !== -1) {
            const v = node.getInputData(intIdx);
            if (v != null && mat.emissiveIntensity !== undefined) mat.emissiveIntensity = Number(v);
        }
    }

    // Applica 'metalness'/'roughness' se presenti E collegati — condiviso
    // da Standard/Physical (Physical estende Standard, stesse due property).
    function _matApplyMetalRough(node, mat) {
        const mIdx = node.findInputSlot('metalness');
        if (mIdx !== -1) {
            const v = node.getInputData(mIdx);
            if (v != null && mat.metalness !== undefined) mat.metalness = Math.max(0, Math.min(1, Number(v)));
        }
        const rIdx = node.findInputSlot('roughness');
        if (rIdx !== -1) {
            const v = node.getInputData(rIdx);
            if (v != null && mat.roughness !== undefined) mat.roughness = Math.max(0, Math.min(1, Number(v)));
        }
    }

    // Mappe dei materiali (2026-09-24): un solo pin "mappe" sui nodi Material/Set*, che
    // riceve le definizioni prodotte da TJS/Texture/Map — in catena (ogni Map aggiunge la
    // sua all'array ricevuto) o raccolte con Params/Array/Maker (array di array: si
    // appiattisce). Per ogni tipo presente: texture nello slot + controlli (intensità,
    // bias, set UV, ripetizione); lo stesso tipo ripetuto → vale l'ultimo. Gli slot non
    // citati restano come sono. Un tipo che il materiale non ha (es. displacement su un
    // Basic) viene saltato con un avviso in console.
    //   type: [proprietà mappa, mappa COLORE (sRGB) o DATI (lineare), controllo intensità]
    const _MAP_TYPES = {
        map:                ['map',                   true,  null],
        alpha:              ['alphaMap',              false, null],
        ao:                 ['aoMap',                 false, 'aoMapIntensity'],
        emissive:           ['emissiveMap',           true,  'emissiveIntensity'],
        normal:             ['normalMap',             false, 'normalScale'],
        bump:               ['bumpMap',               false, 'bumpScale'],
        displacement:       ['displacementMap',       false, 'displacementScale'],
        roughness:          ['roughnessMap',          false, null],
        metalness:          ['metalnessMap',          false, null],
        env:                ['envMap',                true,  'envMapIntensity'],
        light:              ['lightMap',              false, 'lightMapIntensity'],
        specular:           ['specularMap',           false, null],
        clearcoat:          ['clearcoatMap',          false, null],
        clearcoatRoughness: ['clearcoatRoughnessMap', false, null],
        matcap:             ['matcap',                true,  null],
    };

    /** Appiattisce array annidati e tiene solo le definizioni di TJS/Texture/Map. */
    function _flattenMaps(v, out = []) {
        if (Array.isArray(v)) { for (const x of v) _flattenMaps(x, out); }
        else if (v && v.__tjsMap) out.push(v);
        return out;
    }

    function _matApplyMaps(node, mat) {
        const idx = node.findInputSlot('maps');
        if (idx === -1) return;
        const defs = _flattenMaps(node.getInputData(idx, true));
        const last = new Map();                        // tipo → ultima definizione
        for (const d of defs) last.set(d.type, d);
        for (const d of last.values()) {
            const spec = _MAP_TYPES[d.type];
            if (!spec) continue;
            const [prop, isColor, ctrl] = spec;
            if (!(prop in mat)) {
                console.warn(`[TJS/Material] map "${d.type}" not supported by ${mat.type} — skipped`);
                continue;
            }
            if (d.remove) { mat[prop] = null; continue; }
            const tex = d.texture;
            if (!tex?.isTexture) continue;
            tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            if (d.type === 'env' && !tex.isCubeTexture) tex.mapping = THREE.EquirectangularReflectionMapping;
            if (Number.isInteger(d.uv)) tex.channel = d.uv;
            if (d.repeat) {
                tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(d.repeat[0], d.repeat[1]);
            }
            tex.needsUpdate = true;
            mat[prop] = tex;
            // controlli: intensità (normal = normalScale x/y; env sui materiali senza
            // envMapIntensity = reflectivity), bias solo per displacement
            if (d.intensity != null && Number.isFinite(d.intensity)) {
                if (ctrl === 'normalScale') mat.normalScale?.set(d.intensity, d.intensity);
                else if (ctrl && ctrl in mat) mat[ctrl] = d.intensity;
                else if (d.type === 'env' && 'reflectivity' in mat) mat.reflectivity = d.intensity;
            }
            if (d.type === 'displacement' && d.bias != null && Number.isFinite(d.bias)) mat.displacementBias = d.bias;
        }
    }

    // ─── TJS/Material/Create ──────────────────────────────────────────────────
    // Crea un materiale scollegato da qualunque oggetto — nodo puro, nessuna
    // traverse. Va poi assegnato con TJS/Object/AssignMaterial e/o
    // personalizzato con uno dei nodi TJS/Material/Set* (in arrivo
    // progressivamente, uno o pochi tipi alla volta).
    function TJSMaterialCreate() {
        this.addProperty('name', '',      'string');
        this.addProperty('type', 'Basic', 'string');
        this.addWidget('text',  'name', '',      v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('combo', 'type', 'Basic', v => { this.properties.type = v; },
                       { values: Object.keys(_MAT_CTORS), property: 'type' });
        this.addInput('trigger',    ACTION);
        this.addInput('name',       'string');   // sovrascrive il widget
        this.addOutput('done',     EVENT);
        this.addOutput('material', 'material');
        this.color   = '#14532d';   // famiglia Creazione — astratta (dato non ancora "nella scena", vedi nota sopra)
        this.bgcolor = '#166534';
        this.size    = [220, 110];
    }
    TJSMaterialCreate.title = 'Material Create';
    TJSMaterialCreate.desc  = 'Creates a Three.js material (Basic/Depth/Lambert/Matcap/Normal/Phong/Physical) — it is not assigned to any object until you use Object Assign Material';
    TJSMaterialCreate.portHelp = {
        inputs: {
            trigger: 'event — creates a NEW material (every trigger creates a different one, it does not reuse the previous one)',
            name:    'text — material name (readable by Material Get By Name), overrides the widget',
        },
        outputs: {
            done:     'event — fired once the material is created',
            material: 'THREE.Material — direct reference to the new material, of the type chosen in the "type" widget',
        },
    };
    TJSMaterialCreate.prototype.onAction = function () {
        const name    = this.getInputData(1) ?? this.properties.name ?? '';
        const typeKey = _MAT_CTORS[this.properties.type] ? this.properties.type : 'Basic';
        const Ctor    = THREE[_MAT_CTORS[typeKey]];
        if (!Ctor) return;
        const mat = new Ctor();
        mat.name  = name;
        this.setOutputData(1, mat);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/Create', TJSMaterialCreate);


    // ─── TJS/Material/SetBasic ────────────────────────────────────────────────
    // Modifica un MeshBasicMaterial esistente (per riferimento). TUTTI i pin
    // tranne trigger/materiale sono rimovibili da RMB sul singolo pin, e
    // riaggiungibili da RMB sul nodo → Inputs (su richiesta esplicita,
    // 2026-09-21) — colore/opacità/wireframe sono presenti di default alla
    // creazione del nodo (con relativo widget, che resta comunque il
    // fallback se il pin è assente/disconnesso), side/fog partono assenti.
    // Un pin NON presente non viene letto né toccato in fase di
    // aggiornamento (letti per nome via findInputSlot, non per indice
    // fisso — necessario perché rimuovendone uno gli indici degli altri
    // si spostano).
    function TJSMaterialSetBasic() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material'); // THREE.MeshBasicMaterial — riferimento diretto
        this.addInput('color',    'string');
        this.addInput('opacity',   'number');
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→material',  'material');
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 150];
    }
    TJSMaterialSetBasic.title = 'Material Set Basic';
    TJSMaterialSetBasic.desc  = 'Modifies a MeshBasicMaterial by reference — extra parameters from the right-click menu → Inputs';
    TJSMaterialSetBasic.portHelp = {
        inputs: {
            trigger:    'event — applies the changes',
            material:   'THREE.Material — direct reference (MeshBasicMaterial expected, but not checked), required',
            color:      'text — hex color (e.g. "ffffff"), present by default (removable by right-clicking the pin), overrides the widget',
            opacity:    'number 0–1, present by default (removable by right-clicking the pin), overrides the widget (also sets .transparent automatically if < 1)',
            wireframe:  'boolean, present by default (removable by right-clicking the pin), overrides the widget',
            side:       '(absent by default, from the right-click menu → Inputs) "front"/"back"/"double" or a THREE.*Side number — which face to render',
            fog:        '(absent by default, from the right-click menu → Inputs) boolean — whether the material is affected by the scene fog',
            maps:       '(absent by default, from the right-click menu → Inputs) array of maps from TJS/Texture/Map (chained, or collected with Params/Array/Maker; arrays of arrays too): for each type present it sets the texture and its controls, the other slots stay as they were; a type this material does not support is skipped with a console warning',
        },
        outputs: {
            done:        'event — fired once applied',
            '→material': 'THREE.Material — the same input material (passthrough), to chain other nodes',
        },
    };
    TJSMaterialSetBasic.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['color', 'string'], ['opacity', 'number'], ['wireframe', 'boolean'],
            ['side', 'string'], ['fog', 'boolean'],
            ['maps', 'array'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSMaterialSetBasic.prototype.onAction = function () {
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        _matApplyCommon(this, mat);
        _matApplySideFog(this, mat);
        _matApplyMaps(this, mat);
        mat.needsUpdate = true;
        this.setOutputData(1, mat);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/SetBasic', TJSMaterialSetBasic);


    // ─── TJS/Material/SetLambert ──────────────────────────────────────────────
    // Modifica un MeshLambertMaterial esistente (per riferimento) — diffuse
    // puro, ombreggiatura Gouraud, nessun riflesso speculare. Stesso schema
    // di SetBasic: colore/opacità/wireframe presenti di default (rimovibili),
    // il resto opzionale da menù RMB → Inputs.
    function TJSMaterialSetLambert() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material'); // THREE.MeshLambertMaterial — riferimento diretto
        this.addInput('color',    'string');
        this.addInput('opacity',   'number');
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→material',  'material');
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 150];
    }
    TJSMaterialSetLambert.title = 'Material Set Lambert';
    TJSMaterialSetLambert.desc  = 'Modifies a MeshLambertMaterial by reference — extra parameters from the right-click menu → Inputs';
    TJSMaterialSetLambert.portHelp = {
        inputs: {
            trigger:            'event — applies the changes',
            material:           'THREE.Material — direct reference (MeshLambertMaterial expected, but not checked), required',
            color:              'text — hex color, present by default (removable by right-clicking the pin), overrides the widget',
            opacity:            'number 0–1, present by default (removable by right-clicking the pin), overrides the widget (also sets .transparent automatically if < 1)',
            wireframe:          'boolean, present by default (removable by right-clicking the pin), overrides the widget',
            emissive:           '(absent by default, from the right-click menu → Inputs) text — emissive hex color (added to the diffuse color, independent of the light)',
            emissiveIntensity:  '(absent by default, from the right-click menu → Inputs) number — intensity of the emissive color',
            side:               '(absent by default, from the right-click menu → Inputs) "front"/"back"/"double" or a THREE.*Side number — which face to render',
            fog:                '(absent by default, from the right-click menu → Inputs) boolean — whether the material is affected by the scene fog',
            maps:       '(absent by default, from the right-click menu → Inputs) array of maps from TJS/Texture/Map (chained, or collected with Params/Array/Maker; arrays of arrays too): for each type present it sets the texture and its controls, the other slots stay as they were; a type this material does not support is skipped with a console warning',
        },
        outputs: {
            done:        'event — fired once applied',
            '→material': 'THREE.Material — the same input material (passthrough), to chain other nodes',
        },
    };
    TJSMaterialSetLambert.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['color', 'string'], ['opacity', 'number'], ['wireframe', 'boolean'],
            ['emissive', 'string'], ['emissiveIntensity', 'number'],
            ['side', 'string'], ['fog', 'boolean'],
            ['maps', 'array'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSMaterialSetLambert.prototype.onAction = function () {
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        _matApplyCommon(this, mat);
        _matApplyEmissive(this, mat);
        _matApplySideFog(this, mat);
        _matApplyMaps(this, mat);
        mat.needsUpdate = true;
        this.setOutputData(1, mat);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/SetLambert', TJSMaterialSetLambert);


    // ─── TJS/Material/SetPhong ────────────────────────────────────────────────
    // Modifica un MeshPhongMaterial esistente (per riferimento) — riflesso
    // speculare regolabile (Blinn-Phong), a differenza di Lambert.
    function TJSMaterialSetPhong() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material'); // THREE.MeshPhongMaterial — riferimento diretto
        this.addInput('color',    'string');
        this.addInput('opacity',   'number');
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→material',  'material');
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 150];
    }
    TJSMaterialSetPhong.title = 'Material Set Phong';
    TJSMaterialSetPhong.desc  = 'Modifies a MeshPhongMaterial by reference — extra parameters from the right-click menu → Inputs';
    TJSMaterialSetPhong.portHelp = {
        inputs: {
            trigger:            'event — applies the changes',
            material:           'THREE.Material — direct reference (MeshPhongMaterial expected, but not checked), required',
            color:              'text — hex color, present by default (removable by right-clicking the pin), overrides the widget',
            opacity:            'number 0–1, present by default (removable by right-clicking the pin), overrides the widget (also sets .transparent automatically if < 1)',
            wireframe:          'boolean, present by default (removable by right-clicking the pin), overrides the widget',
            emissive:           '(absent by default, from the right-click menu → Inputs) text — emissive hex color',
            emissiveIntensity:  '(absent by default, from the right-click menu → Inputs) number — intensity of the emissive color',
            specular:           '(absent by default, from the right-click menu → Inputs) text — hex color of the specular highlight (Three.js default 0x111111)',
            shininess:          '(absent by default, from the right-click menu → Inputs) number — size/intensity of the specular highlight (Three.js default 30, higher = smaller and sharper highlight)',
            side:               '(absent by default, from the right-click menu → Inputs) "front"/"back"/"double" or a THREE.*Side number — which face to render',
            fog:                '(absent by default, from the right-click menu → Inputs) boolean — whether the material is affected by the scene fog',
            maps:       '(absent by default, from the right-click menu → Inputs) array of maps from TJS/Texture/Map (chained, or collected with Params/Array/Maker; arrays of arrays too): for each type present it sets the texture and its controls, the other slots stay as they were; a type this material does not support is skipped with a console warning',
        },
        outputs: {
            done:        'event — fired once applied',
            '→material': 'THREE.Material — the same input material (passthrough), to chain other nodes',
        },
    };
    TJSMaterialSetPhong.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['color', 'string'], ['opacity', 'number'], ['wireframe', 'boolean'],
            ['emissive', 'string'], ['emissiveIntensity', 'number'],
            ['specular', 'string'], ['shininess', 'number'],
            ['side', 'string'], ['fog', 'boolean'],
            ['maps', 'array'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSMaterialSetPhong.prototype.onAction = function () {
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        _matApplyCommon(this, mat);
        _matApplyEmissive(this, mat);
        const specIdx = this.findInputSlot('specular');
        if (specIdx !== -1) {
            const c = this.getInputData(specIdx);
            if (c && mat.specular) mat.specular.setHex(parseInt(String(c).replace('#', ''), 16));
        }
        const shinIdx = this.findInputSlot('shininess');
        if (shinIdx !== -1) {
            const v = this.getInputData(shinIdx);
            if (v != null) mat.shininess = Number(v);
        }
        _matApplySideFog(this, mat);
        _matApplyMaps(this, mat);
        mat.needsUpdate = true;
        this.setOutputData(1, mat);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/SetPhong', TJSMaterialSetPhong);


    // ─── TJS/Material/SetStandard ─────────────────────────────────────────────
    // Modifica un MeshStandardMaterial esistente (per riferimento) — workflow
    // PBR metalness/roughness. Nota: MeshPhysicalMaterial ESTENDE
    // MeshStandardMaterial, quindi questo stesso nodo funziona anche su un
    // materiale Physical (ne modifica solo la parte "Standard" — usa
    // Material Set Physical in aggiunta per clearcoat/transmission/ior).
    function TJSMaterialSetStandard() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material'); // THREE.MeshStandardMaterial — riferimento diretto
        this.addInput('color',    'string');
        this.addInput('opacity',   'number');
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→material',  'material');
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 150];
    }
    TJSMaterialSetStandard.title = 'Material Set Standard';
    TJSMaterialSetStandard.desc  = 'Modifies a MeshStandardMaterial by reference — extra parameters from the right-click menu → Inputs';
    TJSMaterialSetStandard.portHelp = {
        inputs: {
            trigger:            'event — applies the changes',
            material:           'THREE.Material — direct reference (MeshStandardMaterial or MeshPhysicalMaterial expected, but not checked), required',
            color:              'text — hex color, present by default (removable by right-clicking the pin), overrides the widget',
            opacity:            'number 0–1, present by default (removable by right-clicking the pin), overrides the widget (also sets .transparent automatically if < 1)',
            wireframe:          'boolean, present by default (removable by right-clicking the pin), overrides the widget',
            metalness:          '(absent by default, from the right-click menu → Inputs) number 0–1 — 0 = dielectric (plastic/wood...), 1 = pure metal',
            roughness:          '(absent by default, from the right-click menu → Inputs) number 0–1 — 0 = specular/glossy, 1 = fully matte/rough',
            emissive:           '(absent by default, from the right-click menu → Inputs) text — emissive hex color',
            emissiveIntensity:  '(absent by default, from the right-click menu → Inputs) number — intensity of the emissive color',
            side:               '(absent by default, from the right-click menu → Inputs) "front"/"back"/"double" or a THREE.*Side number — which face to render',
            fog:                '(absent by default, from the right-click menu → Inputs) boolean — whether the material is affected by the scene fog',
            maps:       '(absent by default, from the right-click menu → Inputs) array of maps from TJS/Texture/Map (chained, or collected with Params/Array/Maker; arrays of arrays too): for each type present it sets the texture and its controls, the other slots stay as they were; a type this material does not support is skipped with a console warning',
        },
        outputs: {
            done:        'event — fired once applied',
            '→material': 'THREE.Material — the same input material (passthrough), to chain other nodes',
        },
    };
    TJSMaterialSetStandard.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['color', 'string'], ['opacity', 'number'], ['wireframe', 'boolean'],
            ['metalness', 'number'], ['roughness', 'number'],
            ['emissive', 'string'], ['emissiveIntensity', 'number'],
            ['side', 'string'], ['fog', 'boolean'],
            ['maps', 'array'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSMaterialSetStandard.prototype.onAction = function () {
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        _matApplyCommon(this, mat);
        _matApplyMetalRough(this, mat);
        _matApplyEmissive(this, mat);
        _matApplySideFog(this, mat);
        _matApplyMaps(this, mat);
        mat.needsUpdate = true;
        this.setOutputData(1, mat);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/SetStandard', TJSMaterialSetStandard);


    // ─── TJS/Material/SetPhysical ─────────────────────────────────────────────
    // Modifica un MeshPhysicalMaterial esistente (per riferimento) — estende
    // Standard con clearcoat, transmission (vetro/trasparenze fisicamente
    // corrette) e indice di rifrazione. Per metalness/roughness/emissive
    // "ereditati" da Standard, usa Material Set Standard sullo stesso
    // riferimento (funziona anche su un Physical, ne è la superclasse).
    function TJSMaterialSetPhysical() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material'); // THREE.MeshPhysicalMaterial — riferimento diretto
        this.addInput('color',    'string');
        this.addInput('opacity',   'number');
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→material',  'material');
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 150];
    }
    TJSMaterialSetPhysical.title = 'Material Set Physical';
    TJSMaterialSetPhysical.desc  = 'Modifies a MeshPhysicalMaterial by reference (clearcoat/transmission/ior) — extra parameters from the right-click menu → Inputs';
    TJSMaterialSetPhysical.portHelp = {
        inputs: {
            trigger:             'event — applies the changes',
            material:            'THREE.Material — direct reference (MeshPhysicalMaterial expected, but not checked), required',
            color:               'text — hex color, present by default (removable by right-clicking the pin), overrides the widget',
            opacity:             'number 0–1, present by default (removable by right-clicking the pin), overrides the widget (also sets .transparent automatically if < 1)',
            wireframe:           'boolean, present by default (removable by right-clicking the pin), overrides the widget',
            metalness:           '(absent by default, from the right-click menu → Inputs) number 0–1',
            roughness:           '(absent by default, from the right-click menu → Inputs) number 0–1',
            emissive:            '(absent by default, from the right-click menu → Inputs) text — emissive hex color',
            emissiveIntensity:   '(absent by default, from the right-click menu → Inputs) number — intensity of the emissive color',
            clearcoat:           '(absent by default, from the right-click menu → Inputs) number 0–1 — transparent coating layer over the base material (e.g. car paint)',
            clearcoatRoughness:  '(absent by default, from the right-click menu → Inputs) number 0–1 — roughness of the clearcoat layer (0 = mirror)',
            transmission:        '(absent by default, from the right-click menu → Inputs) number 0–1 — 0 = opaque, >0 enables physical transparency (glass) and sets .transparent automatically',
            ior:                 '(absent by default, from the right-click menu → Inputs) number ≥1 — index of refraction (1.5 typical for glass)',
            side:                '(absent by default, from the right-click menu → Inputs) "front"/"back"/"double" or a THREE.*Side number — which face to render',
            fog:                 '(absent by default, from the right-click menu → Inputs) boolean — whether the material is affected by the scene fog',
            maps:       '(absent by default, from the right-click menu → Inputs) array of maps from TJS/Texture/Map (chained, or collected with Params/Array/Maker; arrays of arrays too): for each type present it sets the texture and its controls, the other slots stay as they were; a type this material does not support is skipped with a console warning',
        },
        outputs: {
            done:        'event — fired once applied',
            '→material': 'THREE.Material — the same input material (passthrough), to chain other nodes',
        },
    };
    TJSMaterialSetPhysical.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['color', 'string'], ['opacity', 'number'], ['wireframe', 'boolean'],
            ['metalness', 'number'], ['roughness', 'number'],
            ['emissive', 'string'], ['emissiveIntensity', 'number'],
            ['clearcoat', 'number'], ['clearcoatRoughness', 'number'],
            ['transmission', 'number'], ['ior', 'number'],
            ['side', 'string'], ['fog', 'boolean'],
            ['maps', 'array'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSMaterialSetPhysical.prototype.onAction = function () {
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        _matApplyCommon(this, mat);
        _matApplyMetalRough(this, mat);
        _matApplyEmissive(this, mat);
        _matApplyMaps(this, mat);

        const ccIdx = this.findInputSlot('clearcoat');
        if (ccIdx !== -1) {
            const v = this.getInputData(ccIdx);
            if (v != null) mat.clearcoat = Math.max(0, Math.min(1, Number(v)));
        }
        const ccrIdx = this.findInputSlot('clearcoatRoughness');
        if (ccrIdx !== -1) {
            const v = this.getInputData(ccrIdx);
            if (v != null) mat.clearcoatRoughness = Math.max(0, Math.min(1, Number(v)));
        }
        const transIdx = this.findInputSlot('transmission');
        if (transIdx !== -1) {
            const v = this.getInputData(transIdx);
            if (v != null) {
                mat.transmission = Math.max(0, Math.min(1, Number(v)));
                if (mat.transmission > 0) mat.transparent = true;
            }
        }
        const iorIdx = this.findInputSlot('ior');
        if (iorIdx !== -1) {
            const v = this.getInputData(iorIdx);
            if (v != null) mat.ior = Math.max(1, Number(v));
        }

        _matApplySideFog(this, mat);
        mat.needsUpdate = true;
        this.setOutputData(1, mat);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/SetPhysical', TJSMaterialSetPhysical);


    // ─── TJS/Material/SetDepth ────────────────────────────────────────────────
    // Modifica un MeshDepthMaterial esistente (per riferimento) — visualizza
    // la distanza dalla camera in scala di grigi, usato per depth pass/shadow
    // map custom. NON ha un colore proprio (il widget/pin 'colore' resta
    // presente per coerenza con tutti gli altri Set*, ma non ha alcun
    // effetto su questo tipo — nessun .color su MeshDepthMaterial). Niente
    // 'fog': non applicabile a un depth pass.
    function TJSMaterialSetDepth() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material'); // THREE.MeshDepthMaterial — riferimento diretto
        this.addInput('color',    'string');
        this.addInput('opacity',   'number');
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→material',  'material');
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 150];
    }
    TJSMaterialSetDepth.title = 'Material Set Depth';
    TJSMaterialSetDepth.desc  = 'Modifies a MeshDepthMaterial by reference — extra parameters from the right-click menu → Inputs';
    TJSMaterialSetDepth.portHelp = {
        inputs: {
            trigger:       'event — applies the changes',
            material:      'THREE.Material — direct reference (MeshDepthMaterial expected, but not checked), required',
            color:         'text — present for consistency with the other Set* nodes, but WITHOUT EFFECT on this type (MeshDepthMaterial has no .color)',
            opacity:       'number 0–1, present by default (removable by right-clicking the pin), overrides the widget (also sets .transparent automatically if < 1)',
            wireframe:     'boolean, present by default (removable by right-clicking the pin), overrides the widget',
            side:          '(absent by default, from the right-click menu → Inputs) "front"/"back"/"double" or a THREE.*Side number — which face to render',
            depthPacking:  '(absent by default, from the right-click menu → Inputs) text — "basic" (default) or "rgba" (for higher precision on shadow maps)',
            maps:       '(absent by default, from the right-click menu → Inputs) array of maps from TJS/Texture/Map (chained, or collected with Params/Array/Maker; arrays of arrays too): for each type present it sets the texture and its controls, the other slots stay as they were; a type this material does not support is skipped with a console warning',
        },
        outputs: {
            done:        'event — fired once applied',
            '→material': 'THREE.Material — the same input material (passthrough), to chain other nodes',
        },
    };
    TJSMaterialSetDepth.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['color', 'string'], ['opacity', 'number'], ['wireframe', 'boolean'],
            ['side', 'string'], ['depthPacking', 'string'],
            ['maps', 'array'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSMaterialSetDepth.prototype.onAction = function () {
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        _matApplyCommon(this, mat);
        const sideIdx = this.findInputSlot('side');
        if (sideIdx !== -1) {
            const side = this.getInputData(sideIdx);
            if (side != null) mat.side = _matSideValue(side);
        }
        const dpIdx = this.findInputSlot('depthPacking');
        if (dpIdx !== -1) {
            const dp = this.getInputData(dpIdx);
            if (dp != null) mat.depthPacking = String(dp).toLowerCase().startsWith('rgba') ? THREE.RGBADepthPacking : THREE.BasicDepthPacking;
        }
        _matApplyMaps(this, mat);
        mat.needsUpdate = true;
        this.setOutputData(1, mat);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/SetDepth', TJSMaterialSetDepth);


    // ─── TJS/Material/SetMatcap ───────────────────────────────────────────────
    // Modifica un MeshMatcapMaterial esistente (per riferimento) — shading
    // finto "sphere-mapped" via texture matcap, nessuna luce necessaria nella
    // scena. La texture matcap stessa NON è coperta qui (serie di nodi
    // texture in arrivo) — solo i parametri non-texture.
    function TJSMaterialSetMatcap() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material'); // THREE.MeshMatcapMaterial — riferimento diretto
        this.addInput('color',    'string');
        this.addInput('opacity',   'number');
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→material',  'material');
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 150];
    }
    TJSMaterialSetMatcap.title = 'Material Set Matcap';
    TJSMaterialSetMatcap.desc  = 'Modifies a MeshMatcapMaterial by reference — extra parameters from the right-click menu → Inputs';
    TJSMaterialSetMatcap.portHelp = {
        inputs: {
            trigger:      'event — applies the changes',
            material:     'THREE.Material — direct reference (MeshMatcapMaterial expected, but not checked), required',
            color:        'text — hex color, present by default (removable by right-clicking the pin), overrides the widget — tints the matcap texture',
            opacity:      'number 0–1, present by default (removable by right-clicking the pin), overrides the widget (also sets .transparent automatically if < 1)',
            wireframe:    'boolean, present by default (removable by right-clicking the pin), overrides the widget',
            flatShading:  '(absent by default, from the right-click menu → Inputs) boolean — flat facets instead of interpolated normals ("low poly" look)',
            side:         '(absent by default, from the right-click menu → Inputs) "front"/"back"/"double" or a THREE.*Side number — which face to render',
            fog:          '(absent by default, from the right-click menu → Inputs) boolean — whether the material is affected by the scene fog',
            maps:       '(absent by default, from the right-click menu → Inputs) array of maps from TJS/Texture/Map (chained, or collected with Params/Array/Maker; arrays of arrays too): for each type present it sets the texture and its controls, the other slots stay as they were; a type this material does not support is skipped with a console warning',
        },
        outputs: {
            done:        'event — fired once applied',
            '→material': 'THREE.Material — the same input material (passthrough), to chain other nodes',
        },
    };
    TJSMaterialSetMatcap.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['color', 'string'], ['opacity', 'number'], ['wireframe', 'boolean'],
            ['flatShading', 'boolean'], ['side', 'string'], ['fog', 'boolean'],
            ['maps', 'array'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSMaterialSetMatcap.prototype.onAction = function () {
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        _matApplyCommon(this, mat);
        const fsIdx = this.findInputSlot('flatShading');
        if (fsIdx !== -1) {
            const v = this.getInputData(fsIdx);
            if (v != null) { mat.flatShading = Boolean(v); mat.needsUpdate = true; }
        }
        _matApplySideFog(this, mat);
        _matApplyMaps(this, mat);
        mat.needsUpdate = true;
        this.setOutputData(1, mat);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/SetMatcap', TJSMaterialSetMatcap);


    // ─── TJS/Material/SetNormal ───────────────────────────────────────────────
    // Modifica un MeshNormalMaterial esistente (per riferimento) — visualizza
    // le normali come colore RGB, nessuna luce necessaria. NON ha un colore
    // proprio (come Depth: il widget/pin 'colore' resta per coerenza ma non
    // ha effetto). Niente 'fog': non applicabile a un material diagnostico.
    function TJSMaterialSetNormal() {
        this.addProperty('color',     'ffffff', 'string');
        this.addProperty('opacity',   1,        'number');
        this.addProperty('wireframe', false,    'boolean');
        this.addWidget('text',   'color hex',  'ffffff', v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'opacity',    1,        v => { this.properties.opacity   = Math.max(0, Math.min(1, v)); }, { property: 'opacity' });
        this.addWidget('toggle', 'wireframe',  false,    v => { this.properties.wireframe = v; }, { property: 'wireframe' });
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material'); // THREE.MeshNormalMaterial — riferimento diretto
        this.addInput('color',    'string');
        this.addInput('opacity',   'number');
        this.addInput('wireframe', 'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→material',  'material');
        this.color   = '#2a1a4a';   // famiglia Set
        this.bgcolor = '#4a1d96';
        this.size    = [230, 150];
    }
    TJSMaterialSetNormal.title = 'Material Set Normal';
    TJSMaterialSetNormal.desc  = 'Modifies a MeshNormalMaterial by reference — extra parameters from the right-click menu → Inputs';
    TJSMaterialSetNormal.portHelp = {
        inputs: {
            trigger:      'event — applies the changes',
            material:     'THREE.Material — direct reference (MeshNormalMaterial expected, but not checked), required',
            color:        'text — present for consistency with the other Set* nodes, but WITHOUT EFFECT on this type (MeshNormalMaterial has no .color)',
            opacity:      'number 0–1, present by default (removable by right-clicking the pin), overrides the widget (also sets .transparent automatically if < 1)',
            wireframe:    'boolean, present by default (removable by right-clicking the pin), overrides the widget',
            flatShading:  '(absent by default, from the right-click menu → Inputs) boolean — flat facets instead of interpolated normals',
            side:         '(absent by default, from the right-click menu → Inputs) "front"/"back"/"double" or a THREE.*Side number — which face to render',
            maps:       '(absent by default, from the right-click menu → Inputs) array of maps from TJS/Texture/Map (chained, or collected with Params/Array/Maker; arrays of arrays too): for each type present it sets the texture and its controls, the other slots stay as they were; a type this material does not support is skipped with a console warning',
        },
        outputs: {
            done:        'event — fired once applied',
            '→material': 'THREE.Material — the same input material (passthrough), to chain other nodes',
        },
    };
    TJSMaterialSetNormal.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['color', 'string'], ['opacity', 'number'], ['wireframe', 'boolean'],
            ['flatShading', 'boolean'], ['side', 'string'],
            ['maps', 'array'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSMaterialSetNormal.prototype.onAction = function () {
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        _matApplyCommon(this, mat);
        const fsIdx = this.findInputSlot('flatShading');
        if (fsIdx !== -1) {
            const v = this.getInputData(fsIdx);
            if (v != null) { mat.flatShading = Boolean(v); mat.needsUpdate = true; }
        }
        const sideIdx = this.findInputSlot('side');
        if (sideIdx !== -1) {
            const side = this.getInputData(sideIdx);
            if (side != null) mat.side = _matSideValue(side);
        }
        _matApplyMaps(this, mat);
        mat.needsUpdate = true;
        this.setOutputData(1, mat);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/SetNormal', TJSMaterialSetNormal);


    // ─── TJS/Material/GetObjectsUsingIt ───────────────────────────────────────
    // Trova le Mesh della scena che usano un materiale (per riferimento) —
    // unico modo possibile, Three.js non tiene un registro dei materiali.
    // Stessa forma di output di Scene Get Object Names, per riusare gli
    // stessi pattern a valle (Array Get [i], ecc.).
    function TJSMaterialGetObjectsUsingIt() {
        this.addInput('trigger',   ACTION);
        this.addInput('material', 'material');
        this.addOutput('done',    EVENT);
        this.addOutput('names',     'array');
        this.addOutput('count',    'number');
        this.addOutput('paths', 'array');
        this.addOutput('objects',  'array');
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [240, 140];
    }
    TJSMaterialGetObjectsUsingIt.title = 'Material Get Objects Using It';
    TJSMaterialGetObjectsUsingIt.desc  = 'Lists the scene Meshes that use the given material (by reference)';
    TJSMaterialGetObjectsUsingIt.portHelp = {
        inputs: {
            trigger:   'event — recomputes the list',
            material:  'THREE.Material — direct reference to look for, required',
        },
        outputs: {
            done:     'event — fired once the list is recomputed (even if empty)',
            names:    'array of text — names of the Meshes using the material (also in the multi-material case, array on mesh.material)',
            count:    'number — how many items in "names"/"paths"/"objects" (same index)',
            paths:    'array of text — path of each Mesh from TJS_MODELS_ROOT/scene, same format as Scene Name Filter',
            objects:  'array of THREE.Object3D — direct reference of each Mesh, same index as "names"/"paths"',
        },
    };
    TJSMaterialGetObjectsUsingIt.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const mat = this.getInputData(1);
        if (!mat?.isMaterial) return;
        let root = null;
        ctx.scene.traverse(o => { if (!root && o.name === 'TJS_MODELS_ROOT') root = o; });
        const base = root ?? ctx.scene;
        const names = [], paths = [], objs = [];
        base.traverse(obj => {
            if (!obj.isMesh || !obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            if (!mats.includes(mat)) return;
            names.push(obj.name);
            paths.push(_pathFromBase(obj, base).join('\\'));
            objs.push(obj);
        });
        this.setOutputData(1, names);
        this.setOutputData(2, names.length);
        this.setOutputData(3, paths);
        this.setOutputData(4, objs);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/GetObjectsUsingIt', TJSMaterialGetObjectsUsingIt);


    // ─── TJS/Material/GetByName ───────────────────────────────────────────────
    // Cerca nella scena il primo materiale con quel nome — riusa
    // _findMaterialByName (già usato da Object/MergeChildMeshes). Come
    // Scene Get Object By Name: si ferma al primo trovato, nessun filtro a
    // percorso (i materiali non hanno una posizione nella gerarchia).
    function TJSMaterialGetByName() {
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'material name', '', v => { this.properties.name = v; }, { property: 'name' });
        this.addInput('trigger', ACTION);
        this.addInput('name',    'string');
        this.addOutput('done',     EVENT);
        this.addOutput('material', 'material');
        this.addOutput('found',   'boolean');
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [220, 110];
    }
    TJSMaterialGetByName.title = 'Material Get By Name';
    TJSMaterialGetByName.desc  = 'Looks in the scene for the first material with that name (by reference)';
    TJSMaterialGetByName.portHelp = {
        inputs: {
            trigger: 'event — runs the search',
            name:    'text — exact name of the material, overrides the widget',
        },
        outputs: {
            done:      'event — fired only if a material was found',
            material:  'THREE.Material — direct reference found',
            found:     'boolean — false if no material in the scene has that name (in that case "material" is not updated)',
        },
    };
    TJSMaterialGetByName.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name = this.getInputData(1) ?? this.properties.name;
        const mat  = name ? _findMaterialByName(ctx.scene, name) : null;
        if (!mat) {
            this.setOutputData(2, false);
            return;
        }
        this.setOutputData(1, mat);
        this.setOutputData(2, true);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Material/GetByName', TJSMaterialGetByName);


    // ─── TJS/Object/Clone ─────────────────────────────────────────────────────
    // Clona un Object3D. Il clone condivide geometry e material (non li duplica).
    // Assegna opzionalmente un nuovo nome al clone.
    function TJSObjectClone() {
        this.addProperty('newName', '', 'string');
        this.addWidget('text', 'new name', '', v => { this.properties.newName = v; }, { property: 'newName' });
        this.addInput('trigger',     ACTION);
        this.addInput('object',     0);        // THREE.Object3D originale
        this.addInput('newName',  'string'); // sovrascrive widget
        this.addOutput('done',      EVENT);
        this.addOutput('clone',      0);        // copia dell'oggetto
        this.color   = '#064e3b';   // famiglia Creazione (intensa — produce un nuovo Object3D)
        this.bgcolor = '#065f46';
        this.size    = [230, 115];
    }
    TJSObjectClone.title = 'Object Clone';
    TJSObjectClone.desc  = 'Deep clone of an Object3D — geometry and material shared (not duplicated)';
    TJSObjectClone.portHelp = {
        inputs: {
            trigger:      'event — runs the clone',
            object:       'THREE.Object3D — direct reference to clone, required',
            newName:      'text — name of the clone, overrides the widget (optional)',
        },
        outputs: {
            done:  'event — fired once the clone is created',
            clone: 'THREE.Object3D — the copy (NOT yet added to the scene, TJS/Scene/AddObject is needed)',
        },
    };
    TJSObjectClone.prototype.onAction = function () {
        const obj = this.getInputData(1);
        if (!obj?.isObject3D) return;
        const cloned = obj.clone();
        const name = this.getInputData(2) || this.properties.newName;
        if (name) cloned.name = name;
        this.setOutputData(1, cloned);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Object/Clone', TJSObjectClone);


    // ─── TJS/Material/GetAll ──────────────────────────────────────────────────
    // Elenca tutti i materiali degli oggetti sotto TJS_MODELS_ROOT.
    //
    // FIX (2026-09-21, segnalato dall'utente — "non riesco a recuperare il
    // materiale tramite Material Get Objects Using It"): usciva SOLO
    // un'istantanea dati {name,type,color,opacity,objName} — mai il vero
    // riferimento THREE.Material, quindi nessun modo di far arrivare un
    // materiale trovato qui dentro a un nodo che lavora per riferimento
    // (Material Set*, Object Assign Material, Material Get Objects Using It
    // stesso). Aggiunto l'output 'riferimenti' (stesso indice di
    // 'nomi'/'materiali') col vero puntatore. Nota collaterale, root cause
    // del "nome non estratto correttamente": i materiali creati da
    // Object/SetMaterial (l'unico nodo object-centric rimasto) non hanno un
    // .name — quindi 'nomi' mostra il placeholder generico "(Tipo)" per
    // quelli. Non è un bug di estrazione (m.name || ... è corretto), è che
    // quel nodo non prevede un modo per dare un nome — con l'output
    // 'riferimenti' il problema pratico si aggira comunque (non serve più
    // il nome per recuperare il materiale).
    function TJSMaterialGetAll() {
        this.addInput('trigger',      ACTION);
        this.addOutput('materials',   'array');    // [{name,type,color,opacity,objName}]
        this.addOutput('names',        'array');    // solo stringhe
        this.addOutput('count',       'number');
        this.addOutput('references', 'array');    // THREE.Material — stesso indice di "nomi"/"materiali"
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [220, 110];
    }
    TJSMaterialGetAll.title = 'Material Get All';
    TJSMaterialGetAll.desc  = 'Lists all the materials of the objects under TJS_MODELS_ROOT, with direct reference';
    TJSMaterialGetAll.portHelp = {
        inputs:  { trigger: 'event — recomputes the list' },
        outputs: {
            materials:   'array of {name, type, color, opacity, objName} — one item per unique material found (data snapshot, not a reference)',
            names:       'array of text — names only (or "(Type)" if the material has none — e.g. materials created by Object/SetMaterial, which never assigns a name)',
            count:       'number — how many items in "materials"/"names"/"references" (same index)',
            references:  'array of THREE.Material — direct reference of each material, same index as "names" — connect it to Material Set*/Object Assign Material/etc.',
        },
    };
    TJSMaterialGetAll.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        let root = null;
        ctx.scene.traverse(o => { if (!root && o.name === 'TJS_MODELS_ROOT') root = o; });
        const base = root ?? ctx.scene;
        const seen = new Set();
        const mats = [];
        const refs = [];
        base.traverse(obj => {
            if (!obj.isMesh) return;
            const ms = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of ms) {
                if (!m || seen.has(m.uuid)) continue;
                seen.add(m.uuid);
                mats.push({
                    name:    m.name || `(${m.type})`,
                    type:    m.type,
                    color:   m.color ? '#' + m.color.getHexString() : null,
                    opacity: m.opacity ?? 1,
                    objName: obj.name,
                });
                refs.push(m);
            }
        });
        this.setOutputData(0, mats);
        this.setOutputData(1, mats.map(m => m.name));
        this.setOutputData(2, mats.length);
        this.setOutputData(3, refs);
    };
    LG.registerNodeType('TJS/Material/GetAll', TJSMaterialGetAll);




    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Light — creazione e configurazione sorgenti luminose
    // Ogni nodo cerca nella scena una luce col nome indicato; se non esiste
    // la crea e la aggiunge. Questo permette al grafo di essere idempotente:
    // ri-eseguirlo aggiorna la luce senza duplicarla.
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Light/SetAmbient ─────────────────────────────────────────────────
    // Luce ambiente: illumina uniformemente tutti gli oggetti (no ombre).
    function TJSLightSetAmbient() {
        this.addProperty('name',      'AmbientLight', 'string');
        this.addProperty('color',     'ffffff',        'string');
        this.addProperty('intensity', 1.0,             'number');
        this.addWidget('text',   'light name',  'AmbientLight', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'ffffff',        v => { this.properties.color = v; }, { property: 'color' });
        this.addWidget('number', 'intensity',  1.0,             v => { this.properties.intensity = v; }, { property: 'intensity' });
        this.addInput('trigger',    ACTION);
        this.addInput('light',    0);   // THREE.Light — riferimento diretto, priorità su nome (nessuna ricerca/creazione)
        this.addInput('name',       'string');
        this.addInput('color',     'string');
        this.addInput('intensity',  'number');
        this.addOutput('done',     EVENT);
        this.addOutput('→light',  0);   // passthrough — la luce risolta (riferimento o trovata/creata), per concatenare altri Set*/Save senza ricercarla di nuovo
        this.color   = '#3b1a03';
        this.bgcolor = '#78350f';
        this.size    = [240, 190];   // +1 pin (light) rispetto al fix 2026-09-19
    }
    TJSLightSetAmbient.title = 'Light Set Ambient';
    TJSLightSetAmbient.desc  = 'Creates/updates an AmbientLight by name or direct reference — creation path from the right-click menu → Inputs';
    TJSLightSetAmbient.portHelp = {
        inputs: {
            trigger:   'event — creates/updates the light',
            light:   'THREE.Light — direct reference, takes priority over "name": if connected to a valid light there is no search and no creation',
            name:      'text — used only if "light" is not connected: unique name of the light (find-or-create), overrides the widget',
            color:     'text — hex color, overrides the widget',
            intensity: 'number, overrides the widget',
            path:      '(absent by default, from the right-click menu → Inputs) text — only at the FIRST creation (by name): path "A\\B\\C" where the light is attached; pin absent = TJS_LIGHTS_ROOT, pin present but not connected = scene root (ephemeral)',
        },
        outputs: {
            done:       'event — fired once the light is created/updated',
            '→light': 'THREE.Light — the resolved light (input reference or found/created by name), to chain other Light nodes without searching it again',
        },
    };
    TJSLightSetAmbient.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        return [['path', 'string']].filter(([n]) => !has.has(n));
    };
    TJSLightSetAmbient.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name      = this.getInputData(2) ?? this.properties.name;
        const hex       = this.getInputData(3) ?? this.properties.color;
        const intensity = this.getInputData(4) ?? this.properties.intensity;
        const color     = parseInt(String(hex).replace('#', ''), 16);
        const light     = _resolveLightRef(this, ctx, name, THREE.AmbientLight, color, intensity);
        light.color.setHex(color);
        light.intensity = Number(intensity);
        this.setOutputData(1, light);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/SetAmbient', TJSLightSetAmbient);


    // ─── TJS/Light/SetDirectional ─────────────────────────────────────────────
    // Luce direzionale parallela. Supporta ombre (castShadow).
    function TJSLightSetDirectional() {
        this.addProperty('name',        'DirectionalLight', 'string');
        this.addProperty('color',       'ffffff',            'string');
        this.addProperty('intensity',   1.0,                 'number');
        this.addProperty('castShadow',  false,               'boolean');
        this.addWidget('text',   'light name',    'DirectionalLight', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',    'ffffff',            v => { this.properties.color = v; }, { property: 'color' });
        this.addWidget('number', 'intensity',    1.0,                 v => { this.properties.intensity = v; }, { property: 'intensity' });
        this.addWidget('toggle', 'castShadow',   false,               v => { this.properties.castShadow = v; }, { property: 'castShadow' });
        this.addInput('trigger',      ACTION);
        this.addInput('light',      0);   // THREE.Light — riferimento diretto, priorità su nome (nessuna ricerca/creazione)
        this.addInput('name',         'string');
        this.addInput('color',       'string');
        this.addInput('intensity',    'number');
        this.addInput('position',     0);    // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addInput('target',       0);    // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addInput('castShadow',   'boolean');
        this.addOutput('done',       EVENT);
        this.addOutput('→light',    0);   // passthrough — la luce risolta, per concatenare altri Set*/Save senza ricercarla di nuovo
        this.color   = '#3b1a03';
        this.bgcolor = '#78350f';
        this.size    = [240, 270];   // +1 pin (light) rispetto al fix 2026-09-22
    }
    TJSLightSetDirectional.title = 'Light Set Directional';
    TJSLightSetDirectional.desc  = 'Creates/updates a DirectionalLight (supports shadows) — creation path from the right-click menu → Inputs';
    TJSLightSetDirectional.portHelp = {
        inputs: {
            trigger:    'event — creates/updates the light',
            light:    'THREE.Light — direct reference, takes priority over "name": if connected to a valid light there is no search and no creation',
            name:       'text — used only if "light" is not connected: unique name of the light (find-or-create), overrides the widget',
            color:      'text — hex color, overrides the widget',
            intensity:  'number, overrides the widget',
            position:   '{x,y,z} or [x,y,z]/vec3 — world position of the light (optional, untouched if not connected) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            target:     '{x,y,z} or [x,y,z]/vec3 — point the light aims at (optional; if not connected it keeps the current value, origin (0,0,0) at the first creation) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            castShadow: 'boolean — also enables renderer.shadowMap if true, overrides the widget',
            path:       '(absent by default, from the right-click menu → Inputs) text — only at the FIRST creation (by name): path "A\\B\\C" where the light is attached; pin absent = TJS_LIGHTS_ROOT, pin present but not connected = scene root (ephemeral)',
        },
        outputs: {
            done:       'event — fired once the light is created/updated',
            '→light': 'THREE.Light — the resolved light (input reference or found/created by name), to chain other Light nodes without searching it again',
        },
    };
    TJSLightSetDirectional.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        return [['path', 'string']].filter(([n]) => !has.has(n));
    };
    TJSLightSetDirectional.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name        = this.getInputData(2) ?? this.properties.name;
        const hex         = this.getInputData(3) ?? this.properties.color;
        const intensity   = this.getInputData(4) ?? this.properties.intensity;
        const pos         = this.getInputData(5);
        const target      = this.getInputData(6);
        const castShadow  = this.getInputData(7) ?? this.properties.castShadow;
        const color       = parseInt(String(hex).replace('#', ''), 16);
        const light       = _resolveLightRef(this, ctx, name, THREE.DirectionalLight, color, intensity);
        light.color.setHex(color);
        light.intensity   = Number(intensity);
        light.castShadow  = Boolean(castShadow);
        { const p = _readPoint3(pos); if (p) light.position.set(p.x, p.y, p.z); else _pointWarn(this, 'position', pos); }
        _applyLightTarget(ctx.scene, light, target);
        if (ctx.renderer && castShadow) ctx.renderer.shadowMap.enabled = true;
        this.setOutputData(1, light);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/SetDirectional', TJSLightSetDirectional);


    // ─── TJS/Light/SetHemisphere ──────────────────────────────────────────────
    // Luce emisferica: gradiente tra skyColor (dall'alto) e groundColor (dal basso).
    function TJSLightSetHemisphere() {
        this.addProperty('name',        'HemisphereLight', 'string');
        this.addProperty('skyColor',    'ffffff',           'string');
        this.addProperty('groundColor', '444444',           'string');
        this.addProperty('intensity',   0.8,                'number');
        this.addWidget('text',   'light name',    'HemisphereLight', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('text',   'sky hex',      'ffffff',           v => { this.properties.skyColor = v; }, { property: 'skyColor' });
        this.addWidget('text',   'ground hex',   '444444',           v => { this.properties.groundColor = v; }, { property: 'groundColor' });
        this.addWidget('number', 'intensity',    0.8,                v => { this.properties.intensity = v; }, { property: 'intensity' });
        this.addInput('trigger',      ACTION);
        this.addInput('light',      0);   // THREE.Light — riferimento diretto, priorità su nome (nessuna ricerca/creazione)
        this.addInput('name',         'string');
        this.addInput('skyColor',     'string');
        this.addInput('groundColor',  'string');
        this.addInput('intensity',    'number');
        this.addOutput('done',       EVENT);
        this.addOutput('→light',    0);   // passthrough — la luce risolta, per concatenare altri Set*/Save senza ricercarla di nuovo
        this.color   = '#3b1a03';
        this.bgcolor = '#78350f';
        this.size    = [240, 230];   // +1 pin (light) rispetto al fix 2026-09-19
    }
    TJSLightSetHemisphere.title = 'Light Set Hemisphere';
    TJSLightSetHemisphere.desc  = 'Creates/updates a HemisphereLight (sky + ground color) — creation path from the right-click menu → Inputs';
    TJSLightSetHemisphere.portHelp = {
        inputs: {
            trigger:      'event — creates/updates the light',
            light:      'THREE.Light — direct reference, takes priority over "name": if connected to a valid light there is no search and no creation',
            name:         'text — used only if "light" is not connected: unique name of the light (find-or-create), overrides the widget',
            skyColor:     'text — hex color from above, overrides the widget',
            groundColor:  'text — hex color from below, overrides the widget',
            intensity:    'number, overrides the widget',
            path:         '(absent by default, from the right-click menu → Inputs) text — only at the FIRST creation (by name): path "A\\B\\C" where the light is attached; pin absent = TJS_LIGHTS_ROOT, pin present but not connected = scene root (ephemeral)',
        },
        outputs: {
            done:       'event — fired once the light is created/updated',
            '→light': 'THREE.Light — the resolved light (input reference or found/created by name), to chain other Light nodes without searching it again',
        },
    };
    TJSLightSetHemisphere.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        return [['path', 'string']].filter(([n]) => !has.has(n));
    };
    TJSLightSetHemisphere.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name        = this.getInputData(2) ?? this.properties.name;
        const skyHex      = this.getInputData(3) ?? this.properties.skyColor;
        const groundHex   = this.getInputData(4) ?? this.properties.groundColor;
        const intensity   = this.getInputData(5) ?? this.properties.intensity;
        const skyColor    = parseInt(String(skyHex).replace('#', ''),    16);
        const groundColor = parseInt(String(groundHex).replace('#', ''), 16);
        const light       = _resolveLightRef(this, ctx, name, THREE.HemisphereLight, skyColor, groundColor, intensity);
        light.color.setHex(skyColor);
        light.groundColor.setHex(groundColor);
        light.intensity = Number(intensity);
        this.setOutputData(1, light);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/SetHemisphere', TJSLightSetHemisphere);


    // ─── TJS/Light/SetPoint ───────────────────────────────────────────────────
    // Luce puntiforme omnidirezionale (lampadina). Supporta ombre.
    function TJSLightSetPoint() {
        this.addProperty('name',       'PointLight', 'string');
        this.addProperty('color',      'ffffff',      'string');
        this.addProperty('intensity',  1.0,           'number');
        this.addProperty('distance',   0,             'number');   // 0 = nessun limite
        this.addProperty('decay',      2,             'number');
        this.addProperty('castShadow', false,         'boolean');
        this.addWidget('text',   'light name',  'PointLight', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'ffffff',      v => { this.properties.color = v; }, { property: 'color' });
        this.addWidget('number', 'intensity',  1.0,           v => { this.properties.intensity = v; }, { property: 'intensity' });
        this.addWidget('number', 'distance',   0,             v => { this.properties.distance = v; }, { property: 'distance' });
        this.addWidget('number', 'decay',      2,             v => { this.properties.decay = v; }, { property: 'decay' });
        this.addWidget('toggle', 'castShadow', false,         v => { this.properties.castShadow = v; }, { property: 'castShadow' });
        this.addInput('trigger',    ACTION);
        this.addInput('light',    0);   // THREE.Light — riferimento diretto, priorità su nome (nessuna ricerca/creazione)
        this.addInput('name',       'string');
        this.addInput('color',     'string');
        this.addInput('intensity',  'number');
        this.addInput('position',   0);   // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addInput('distance',   'number');
        this.addInput('decay',      'number');
        this.addInput('castShadow', 'boolean');
        this.addOutput('done',     EVENT);
        this.addOutput('→light',  0);   // passthrough — la luce risolta, per concatenare altri Set*/Save senza ricercarla di nuovo
        this.color   = '#3b1a03';
        this.bgcolor = '#78350f';
        this.size    = [240, 310];   // +1 pin (light)
    }
    TJSLightSetPoint.title = 'Light Set Point';
    TJSLightSetPoint.desc  = 'Creates/updates an omnidirectional PointLight (supports shadows) — creation path from the right-click menu → Inputs';
    TJSLightSetPoint.portHelp = {
        inputs: {
            trigger:    'event — creates/updates the light',
            light:    'THREE.Light — direct reference, takes priority over "name": if connected to a valid light there is no search and no creation',
            name:       'text — used only if "light" is not connected: unique name of the light (find-or-create), overrides the widget',
            color:      'text — hex color, overrides the widget',
            intensity:  'number, overrides the widget',
            position:   '{x,y,z} or [x,y,z]/vec3 — world position of the light (optional) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            distance:   'number — maximum range, 0 = no limit (physical attenuation), overrides the widget',
            decay:      'number — decay factor of the intensity with distance (2 = physically correct), overrides the widget',
            castShadow: 'boolean — also enables renderer.shadowMap if true, overrides the widget',
            path:       '(absent by default, from the right-click menu → Inputs) text — only at the FIRST creation (by name): path "A\\B\\C" where the light is attached; pin absent = TJS_LIGHTS_ROOT, pin present but not connected = scene root (ephemeral)',
        },
        outputs: {
            done:       'event — fired once the light is created/updated',
            '→light': 'THREE.Light — the resolved light (input reference or found/created by name), to chain other Light nodes without searching it again',
        },
    };
    TJSLightSetPoint.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        return [['path', 'string']].filter(([n]) => !has.has(n));
    };
    TJSLightSetPoint.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name       = this.getInputData(2) ?? this.properties.name;
        const hex        = this.getInputData(3) ?? this.properties.color;
        const intensity  = this.getInputData(4) ?? this.properties.intensity;
        const pos        = this.getInputData(5);
        const distance   = this.getInputData(6) ?? this.properties.distance;
        const decay      = this.getInputData(7) ?? this.properties.decay;
        const castShadow = this.getInputData(8) ?? this.properties.castShadow;
        const color      = parseInt(String(hex).replace('#', ''), 16);
        const light      = _resolveLightRef(this, ctx, name, THREE.PointLight, color, intensity, distance, decay);
        light.color.setHex(color);
        light.intensity  = Number(intensity);
        light.distance   = Number(distance);
        light.decay      = Number(decay);
        light.castShadow = Boolean(castShadow);
        { const p = _readPoint3(pos); if (p) light.position.set(p.x, p.y, p.z); else _pointWarn(this, 'position', pos); }
        if (ctx.renderer && castShadow) ctx.renderer.shadowMap.enabled = true;
        this.setOutputData(1, light);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/SetPoint', TJSLightSetPoint);


    // ─── TJS/Light/SetProbe ───────────────────────────────────────────────────
    // LightProbe: sorgente ambientale posizionabile, basata su armoniche
    // sferiche (SphericalHarmonics3). v1: solo termine costante (DC) — luce
    // uniforme in tutte le direzioni, equivalente a un AmbientLight
    // posizionabile. NON cattura (ancora) l'irradianza direzionale
    // dell'ambiente HDRI della scena (richiederebbe LightProbeGenerator da
    // una cube render target dedicata, non presente in TJS-env-manager.mjs,
    // che tiene solo la texture PMREM equirettangolare finale) — appuntato
    // per un eventuale v2, non implementato ora.
    function TJSLightSetProbe() {
        this.addProperty('name',      'LightProbe', 'string');
        this.addProperty('color',     'ffffff',      'string');
        this.addProperty('intensity', 1.0,           'number');
        this.addWidget('text',   'light name',  'LightProbe', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'ffffff',      v => { this.properties.color = v; }, { property: 'color' });
        this.addWidget('number', 'intensity',  1.0,           v => { this.properties.intensity = v; }, { property: 'intensity' });
        this.addInput('trigger',    ACTION);
        this.addInput('light',    0);   // THREE.Light — riferimento diretto, priorità su nome (nessuna ricerca/creazione)
        this.addInput('name',       'string');
        this.addInput('color',     'string');
        this.addInput('intensity',  'number');
        this.addInput('position',   0);   // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addOutput('done',     EVENT);
        this.addOutput('→light',  0);   // passthrough — la luce risolta, per concatenare altri Set*/Save senza ricercarla di nuovo
        this.color   = '#3b1a03';
        this.bgcolor = '#78350f';
        this.size    = [240, 230];
    }
    TJSLightSetProbe.title = 'Light Set Probe';
    TJSLightSetProbe.desc  = 'Creates/updates a LightProbe (v1: uniform ambient color/intensity, does not capture the HDRI) — creation path from the right-click menu → Inputs';
    TJSLightSetProbe.portHelp = {
        inputs: {
            trigger:    'event — creates/updates the light',
            light:    'THREE.Light — direct reference, takes priority over "name": if connected to a valid light there is no search and no creation',
            name:       'text — used only if "light" is not connected: unique name of the light (find-or-create), overrides the widget',
            color:      'text — hex color of the uniform ambient component, overrides the widget',
            intensity:  'number, overrides the widget',
            position:   '{x,y,z} or [x,y,z]/vec3 — world position of the probe (optional) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            path:       '(absent by default, from the right-click menu → Inputs) text — only at the FIRST creation (by name): path "A\\B\\C" where the light is attached; pin absent = TJS_LIGHTS_ROOT, pin present but not connected = scene root (ephemeral)',
        },
        outputs: {
            done:       'event — fired once the light is created/updated',
            '→light': 'THREE.Light — the resolved light (input reference or found/created by name), to chain other Light nodes without searching it again',
        },
    };
    TJSLightSetProbe.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        return [['path', 'string']].filter(([n]) => !has.has(n));
    };
    TJSLightSetProbe.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name      = this.getInputData(2) ?? this.properties.name;
        const hex       = this.getInputData(3) ?? this.properties.color;
        const intensity = this.getInputData(4) ?? this.properties.intensity;
        const pos       = this.getInputData(5);
        const color     = parseInt(String(hex).replace('#', ''), 16);
        const light     = _resolveLightRef(this, ctx, name, THREE.LightProbe);
        // Termine costante (indice 0) delle SH reali normalizzate: Y00 = 1/(2√π),
        // quindi per ottenere una radianza uniforme pari al colore serve
        // moltiplicare per 2√π. Gli altri 8 coefficienti restano a zero →
        // nessuna variazione direzionale (v1, vedi commento sopra).
        const c = new THREE.Color(color);
        const k = 2 * Math.sqrt(Math.PI);
        light.sh.coefficients[0].set(c.r * k, c.g * k, c.b * k);
        for (let i = 1; i < 9; i++) light.sh.coefficients[i].set(0, 0, 0);
        light.intensity = Number(intensity);
        { const p = _readPoint3(pos); if (p) light.position.set(p.x, p.y, p.z); else _pointWarn(this, 'position', pos); }
        this.setOutputData(1, light);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/SetProbe', TJSLightSetProbe);


    // ─── TJS/Light/SetRectArea ────────────────────────────────────────────────
    // Luce rettangolare planare (es. finestre, schermi). No ombre native.
    function TJSLightSetRectArea() {
        this.addProperty('name',      'RectAreaLight', 'string');
        this.addProperty('color',     'ffffff',         'string');
        this.addProperty('intensity', 5.0,              'number');
        this.addProperty('width',     4.0,              'number');
        this.addProperty('height',    2.0,              'number');
        this.addWidget('text',   'light name',  'RectAreaLight', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'ffffff',         v => { this.properties.color = v; }, { property: 'color' });
        this.addWidget('number', 'intensity',  5.0,              v => { this.properties.intensity = v; }, { property: 'intensity' });
        this.addWidget('number', 'width',      4.0,              v => { this.properties.width = v; }, { property: 'width' });
        this.addWidget('number', 'height',     2.0,              v => { this.properties.height = v; }, { property: 'height' });
        this.addInput('trigger',    ACTION);
        this.addInput('light',    0);   // THREE.Light — riferimento diretto, priorità su nome (nessuna ricerca/creazione)
        this.addInput('name',       'string');
        this.addInput('color',     'string');
        this.addInput('intensity',  'number');
        this.addInput('width',      'number');
        this.addInput('height',     'number');
        this.addInput('position',   0);   // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addOutput('done',     EVENT);
        this.addOutput('→light',  0);   // passthrough — la luce risolta, per concatenare altri Set*/Save senza ricercarla di nuovo
        this.color   = '#3b1a03';
        this.bgcolor = '#78350f';
        this.size    = [240, 290];   // +1 pin (light) rispetto al fix 2026-09-19
    }
    TJSLightSetRectArea.title = 'Light Set RectArea';
    TJSLightSetRectArea.desc  = 'Creates/updates a RectAreaLight (planar light, no shadow) — creation path from the right-click menu → Inputs';
    TJSLightSetRectArea.portHelp = {
        inputs: {
            trigger:   'event — creates/updates the light',
            light:   'THREE.Light — direct reference, takes priority over "name": if connected to a valid light there is no search and no creation',
            name:      'text — used only if "light" is not connected: unique name of the light (find-or-create), overrides the widget',
            color:     'text — hex color, overrides the widget',
            intensity: 'number, overrides the widget',
            width:     'number — width of the light panel, overrides the widget',
            height:    'number — height of the light panel, overrides the widget',
            position:  '{x,y,z} or [x,y,z]/vec3 — world position of the light (optional) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            path:      '(absent by default, from the right-click menu → Inputs) text — only at the FIRST creation (by name): path "A\\B\\C" where the light is attached; pin absent = TJS_LIGHTS_ROOT, pin present but not connected = scene root (ephemeral)',
        },
        outputs: {
            done:       'event — fired once the light is created/updated',
            '→light': 'THREE.Light — the resolved light (input reference or found/created by name), to chain other Light nodes without searching it again',
        },
    };
    TJSLightSetRectArea.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        return [['path', 'string']].filter(([n]) => !has.has(n));
    };
    TJSLightSetRectArea.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name      = this.getInputData(2) ?? this.properties.name;
        const hex       = this.getInputData(3) ?? this.properties.color;
        const intensity = this.getInputData(4) ?? this.properties.intensity;
        const width     = this.getInputData(5) ?? this.properties.width;
        const height    = this.getInputData(6) ?? this.properties.height;
        const pos       = this.getInputData(7);
        const color     = parseInt(String(hex).replace('#', ''), 16);
        const light     = _resolveLightRef(this, ctx, name, THREE.RectAreaLight, color, intensity, width, height);
        light.color.setHex(color);
        light.intensity = Number(intensity);
        light.width     = Number(width);
        light.height    = Number(height);
        { const p = _readPoint3(pos); if (p) light.position.set(p.x, p.y, p.z); else _pointWarn(this, 'position', pos); }
        this.setOutputData(1, light);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/SetRectArea', TJSLightSetRectArea);


    // ─── TJS/Light/SetSpot ────────────────────────────────────────────────────
    // Faretto conico. Supporta ombre (castShadow).
    function TJSLightSetSpot() {
        this.addProperty('name',        'SpotLight', 'string');
        this.addProperty('color',       'ffffff',     'string');
        this.addProperty('intensity',   1.0,          'number');
        this.addProperty('angle',       30,            'number');  // gradi
        this.addProperty('penumbra',    0.1,           'number');  // 0–1
        this.addProperty('castShadow',  false,         'boolean');
        this.addWidget('text',   'light name',  'SpotLight', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'ffffff',     v => { this.properties.color = v; }, { property: 'color' });
        this.addWidget('number', 'intensity',  1.0,          v => { this.properties.intensity = v; }, { property: 'intensity' });
        this.addWidget('number', 'angle (°)',  30,            v => { this.properties.angle = v; }, { property: 'angle' });
        this.addWidget('number', 'penumbra',   0.1,           v => { this.properties.penumbra = v; }, { property: 'penumbra' });
        this.addWidget('toggle', 'castShadow', false,         v => { this.properties.castShadow = v; }, { property: 'castShadow' });
        this.addInput('trigger',     ACTION);
        this.addInput('light',     0);   // THREE.Light — riferimento diretto, priorità su nome (nessuna ricerca/creazione)
        this.addInput('name',        'string');
        this.addInput('color',      'string');
        this.addInput('intensity',   'number');
        this.addInput('position',    0);   // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addInput('target',      0);   // {x,y,z} | [x,y,z] | vec3 — vedi portHelp
        this.addInput('angle',       'number');   // gradi
        this.addInput('penumbra',    'number');   // 0–1
        this.addInput('castShadow',  'boolean');
        this.addOutput('done',      EVENT);
        this.addOutput('→light',   0);   // passthrough — la luce risolta, per concatenare altri Set*/Save senza ricercarla di nuovo
        this.color   = '#3b1a03';
        this.bgcolor = '#78350f';
        this.size    = [240, 350];   // +1 pin (light) rispetto al fix 2026-09-22
    }
    TJSLightSetSpot.title = 'Light Set Spot';
    TJSLightSetSpot.desc  = 'Creates/updates a conical SpotLight (supports shadows) — creation path from the right-click menu → Inputs';
    TJSLightSetSpot.portHelp = {
        inputs: {
            trigger:    'event — creates/updates the light',
            light:    'THREE.Light — direct reference, takes priority over "name": if connected to a valid light there is no search and no creation',
            name:       'text — used only if "light" is not connected: unique name of the light (find-or-create), overrides the widget',
            color:      'text — hex color, overrides the widget',
            intensity:  'number, overrides the widget',
            position:   '{x,y,z} or [x,y,z]/vec3 — world position of the light (optional) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            target:     '{x,y,z} or [x,y,z]/vec3 — point the cone aims at (optional; if not connected it keeps the current value, origin (0,0,0) at the first creation) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            angle:      'number in DEGREES — cone aperture, overrides the widget',
            penumbra:   'number 0–1 — softness of the cone edge, overrides the widget',
            castShadow: 'boolean — also enables renderer.shadowMap if true, overrides the widget',
            path:       '(absent by default, from the right-click menu → Inputs) text — only at the FIRST creation (by name): path "A\\B\\C" where the light is attached; pin absent = TJS_LIGHTS_ROOT, pin present but not connected = scene root (ephemeral)',
        },
        outputs: {
            done:       'event — fired once the light is created/updated',
            '→light': 'THREE.Light — the resolved light (input reference or found/created by name), to chain other Light nodes without searching it again',
        },
    };
    TJSLightSetSpot.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        return [['path', 'string']].filter(([n]) => !has.has(n));
    };
    TJSLightSetSpot.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name       = this.getInputData(2) ?? this.properties.name;
        const hex        = this.getInputData(3) ?? this.properties.color;
        const intensity  = this.getInputData(4) ?? this.properties.intensity;
        const pos        = this.getInputData(5);
        const target     = this.getInputData(6);
        const angleDeg   = this.getInputData(7) ?? this.properties.angle;
        const penumbra   = this.getInputData(8) ?? this.properties.penumbra;
        const castShadow = this.getInputData(9) ?? this.properties.castShadow;
        const color      = parseInt(String(hex).replace('#', ''), 16);
        const light      = _resolveLightRef(this, ctx, name, THREE.SpotLight, color, intensity);
        light.color.setHex(color);
        light.intensity  = Number(intensity);
        light.angle      = Number(angleDeg) * (Math.PI / 180);
        light.penumbra   = Math.max(0, Math.min(1, Number(penumbra)));
        light.castShadow = Boolean(castShadow);
        { const p = _readPoint3(pos); if (p) light.position.set(p.x, p.y, p.z); else _pointWarn(this, 'position', pos); }
        _applyLightTarget(ctx.scene, light, target);
        if (ctx.renderer && castShadow) ctx.renderer.shadowMap.enabled = true;
        this.setOutputData(1, light);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/SetSpot', TJSLightSetSpot);


    // ─── TJS/Light/SetShadow ─────────────────────────────────────────────────
    // Configura i parametri shadow di una luce esistente, per riferimento
    // diretto (priorità) o per nome (fallback, cerca in tutta la scena).
    // Abilita automaticamente renderer.shadowMap se non già attivo.
    // Solo DirectionalLight/SpotLight/PointLight hanno .shadow in Three.js
    // (Ambient/Hemisphere/LightProbe/RectArea no, RectArea non supporta
    // ombre affatto) — vedi guard in onAction, prima un TypeError silente.
    function TJSLightSetShadow() {
        this.addProperty('name',           '',    'string');
        this.addProperty('mapSize',        1024,  'number');   // 512/1024/2048/4096
        this.addProperty('bias',           -0.001,'number');
        this.addProperty('radius',         1,     'number');   // blur PCF
        this.addProperty('near',           0.5,   'number');
        this.addProperty('far',            500,   'number');
        this.addProperty('normalBias',     0,     'number');
        this.addProperty('shadowIntensity',1,     'number');   // shadow.intensity, r0.174+
        this.addProperty('frustumX',       50,    'number');   // solo DirectionalLight
        this.addProperty('frustumY',       50,    'number');   // solo DirectionalLight
        this.addWidget('text',   'light name (if not connected)', '', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('number', 'mapSize',  1024,    v => { this.properties.mapSize = v; }, { property: 'mapSize' });
        this.addWidget('number', 'bias',    -0.001,   v => { this.properties.bias = v; }, { property: 'bias' });
        this.addWidget('number', 'radius',   1,       v => { this.properties.radius = v; }, { property: 'radius' });
        this.addWidget('number', 'near',     0.5,     v => { this.properties.near = v; }, { property: 'near' });
        this.addWidget('number', 'far',      500,     v => { this.properties.far = v; }, { property: 'far' });
        this.addInput('trigger',  ACTION);
        this.addInput('light',  0);        // THREE.Light — riferimento diretto, priorità su nome (nessuna ricerca)
        this.addInput('name',     'string');
        this.addInput('mapSize',  'number');
        this.addInput('bias',     'number');
        this.addInput('radius',   'number');
        this.addInput('near',     'number');
        this.addInput('far',      'number');
        this.addOutput('done',    EVENT);
        this.addOutput('→light', 0);   // passthrough — la stessa luce configurata, per concatenare altri nodi
        this.color   = '#3b1a03';
        this.bgcolor = '#a05220';
        this.size    = [250, 310];   // +1 pin (light) rispetto al fix 2026-09-19
    }
    TJSLightSetShadow.title = 'Light Set Shadow';
    TJSLightSetShadow.desc  = 'Configures the shadow of an existing light (mapSize, bias, radius, near, far + normalBias/intensity/frustum from right-click → Inputs)';
    TJSLightSetShadow.portHelp = {
        inputs: {
            trigger:    'event — applies the configuration',
            light:    'THREE.Light — direct reference, takes priority over "name": if connected there is no search in the scene',
            name:       'text — used only if "light" is not connected: name of the EXISTING light (it must already be in the scene, this node does not create one)',
            mapSize:    'number — shadow map side in pixels, power of 2 (512/1024/2048/4096), overrides the widget',
            bias:       'number — anti z-fighting offset, overrides the widget',
            radius:     'number — PCF blur of the shadow edge, overrides the widget',
            near:       'number — near plane of the shadow frustum (Directional/Spot/Point), overrides the widget',
            far:        'number — far plane of the shadow frustum (Directional/Spot/Point), overrides the widget',
            normalBias: '(absent by default, from the right-click menu → Inputs) number — anti peter-panning/acne offset on curved surfaces',
            shadowIntensity: '(absent by default, from the right-click menu → Inputs) number 0–1 — density/opacity of the shadow (shadow.intensity, r0.174+, if supported by the Three.js build)',
            frustumX:   '(absent by default, from the right-click menu → Inputs) number — half-width ±X of the shadow frustum, DirectionalLight ONLY (ignored for other types)',
            frustumY:   '(absent by default, from the right-click menu → Inputs) number — half-height ±Y of the shadow frustum, DirectionalLight ONLY (ignored for other types)',
        },
        outputs: {
            done:      'event — fired once applied',
            '→light': 'THREE.Light — the same configured light (input reference or found by name), to chain other nodes',
        },
    };
    TJSLightSetShadow.prototype.onGetInputs = function () {
        const has = new Set(this.inputs.map(i => i.name));
        const all = [
            ['normalBias', 'number'], ['shadowIntensity', 'number'],
            ['frustumX', 'number'], ['frustumY', 'number'],
        ];
        return all.filter(([n]) => !has.has(n));
    };
    TJSLightSetShadow.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const name    = this.getInputData(2) ?? this.properties.name;
        const mapSize = this.getInputData(3) ?? this.properties.mapSize;
        const bias    = this.getInputData(4) ?? this.properties.bias;
        const radius  = this.getInputData(5) ?? this.properties.radius;
        const near    = this.getInputData(6) ?? this.properties.near;
        const far     = this.getInputData(7) ?? this.properties.far;

        // Riferimento diretto (priorità) o ricerca per nome in tutta la scena
        let light = this.getInputData(1);
        if (!light?.isLight) {
            light = null;
            if (name) ctx.scene.traverse(obj => { if (!light && obj.isLight && obj.name === name) light = obj; });
        }
        if (!light?.isLight) {
            console.warn('[TJS/Light/SetShadow] light not found:', name);
            return;
        }
        // Solo Directional/Spot/PointLight hanno .shadow in Three.js — Ambient/
        // Hemisphere/LightProbe/RectArea no (RectArea non supporta ombre affatto).
        if (!light.shadow) {
            console.warn('[TJS/Light/SetShadow] this light type does not support shadows:', light.type ?? light);
            return;
        }

        light.castShadow = true;

        // Shadow map dimensions (devono essere potenze di 2)
        const sz = Math.max(1, Number(mapSize));
        light.shadow.mapSize.width  = sz;
        light.shadow.mapSize.height = sz;
        light.shadow.bias   = Number(bias);
        light.shadow.radius = Number(radius);

        // Shadow camera frustum near/far (valido per Directional/Spot/Point)
        if (light.shadow.camera) {
            light.shadow.camera.near = Number(near);
            light.shadow.camera.far  = Number(far);
        }

        // Opzionali (RMB → Inputs)
        const nbIdx = this.findInputSlot('normalBias');
        if (nbIdx !== -1) {
            const nb = this.getInputData(nbIdx);
            if (nb != null) light.shadow.normalBias = Number(nb);
        }
        const siIdx = this.findInputSlot('shadowIntensity');
        if (siIdx !== -1) {
            const si = this.getInputData(siIdx) ?? this.properties.shadowIntensity;
            if (si != null && 'intensity' in light.shadow) light.shadow.intensity = Number(si);
        }
        if (light.isDirectionalLight) {
            const fxIdx = this.findInputSlot('frustumX');
            if (fxIdx !== -1) {
                const fx = this.getInputData(fxIdx) ?? this.properties.frustumX;
                if (fx != null) { light.shadow.camera.left = -Math.abs(fx); light.shadow.camera.right = Math.abs(fx); }
            }
            const fyIdx = this.findInputSlot('frustumY');
            if (fyIdx !== -1) {
                const fy = this.getInputData(fyIdx) ?? this.properties.frustumY;
                if (fy != null) { light.shadow.camera.bottom = -Math.abs(fy); light.shadow.camera.top = Math.abs(fy); }
            }
        }
        if (light.shadow.camera) light.shadow.camera.updateProjectionMatrix?.();

        // Invalida la shadow map esistente per forzare il ricalcolo
        if (light.shadow.map) {
            light.shadow.map.dispose();
            light.shadow.map = null;
        }

        // Abilita shadowMap sul renderer
        if (ctx.renderer) {
            ctx.renderer.shadowMap.enabled      = true;
            ctx.renderer.shadowMap.needsUpdate  = true;
        }

        this.setOutputData(1, light);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/SetShadow', TJSLightSetShadow);


    // ─── TJS/Light/Save ───────────────────────────────────────────────────────
    // Salva ESPLICITAMENTE una o più luci in mod_spec.lights[] del modello
    // indicato, tramite il pannello Light Manager (TJS-light-manager.mjs).
    // Azione volutamente separata dai nodi Light Set*, che non salvano mai da
    // soli: l'uso di luci via grafo ha spesso natura effimera (dura quanto
    // l'esecuzione del flow) — comodo poterle gestire dal pannello Luci senza
    // per questo doverle persistere (decisione esplicita dell'utente,
    // 2026-09-22). Una luce PREESISTENTE (le due di default del pannello, o
    // qualunque altra trovata in scena all'apertura) resta bloccata: questo
    // nodo non la salva mai, coerente col lucchetto del pannello.
    //
    // FIX (2026-09-22, su richiesta esplicita): rimossa la ricerca per nome
    // — il nome si imposta già sui nodi Light Set* al momento della
    // creazione, qui serve solo il riferimento (diretto o come array, per
    // salvare più luci in un colpo solo). Input unico 'lights': accetta sia
    // una singola THREE.Light sia un array di THREE.Light.
    function TJSLightSave() {
        this.addProperty('modId', 0, 'number');
        this.addWidget('number', 'mod_id', 0, v => { this.properties.modId = v; }, { property: 'modId' });
        this.addInput('trigger', ACTION);
        this.addInput('lights',  0);        // THREE.Light singola O array di THREE.Light
        this.addInput('mod_id',  'number');
        this.addOutput('done',  EVENT);
        this.color   = '#4a3010';   // famiglia Salvataggio (stessa di Object/ExportGLB)
        this.bgcolor = '#a16207';
        this.size    = [230, 110];
    }
    TJSLightSave.title = 'Light Save';
    TJSLightSave.desc  = 'Saves one or more lights (created by Set* or from the Lights panel) in mod_spec.lights[] — explicit action, never automatic';
    TJSLightSave.portHelp = {
        inputs: {
            trigger: 'event — starts saving',
            lights:  'THREE.Light — a single light, or an array of THREE.Light to save several at once',
            mod_id:  'number — mod_id of the model to save into (same concept as the model picker of the Lights panel, or use ReseArch/Object/Model List to list them), overrides the widget',
        },
        outputs: { done: 'event — fired once saving is complete (asynchronous request to mod_spec_tool.php)' },
    };
    TJSLightSave.prototype.onAction = async function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        if (!ctx.lightManager) {
            console.warn('[TJS/Light/Save] Lights panel not ready yet for this panel.');
            return;
        }
        const raw    = this.getInputData(1);
        const lights = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        if (!lights.length) {
            console.warn('[TJS/Light/Save] no light in input.');
            return;
        }
        const modId = this.getInputData(2) ?? this.properties.modId;
        if (!modId) {
            console.warn('[TJS/Light/Save] mod_id missing or not valid.');
            return;
        }
        let any = false;
        for (const light of lights) {
            if (!light?.isLight) continue;
            const node = ctx.lightManager.adopt(light, modId);
            if (!node || node.isPreExisting) {
                console.warn('[TJS/Light/Save] pre-existing/unmanageable light, skipped.');
                continue;
            }
            any = true;
        }
        if (!any) return;
        // saveAllLights() salva l'intero set corrente per ogni modId toccato
        // (semantica identica al bottone del pannello) — evita di richiamare
        // saveLight() una volta per luce quando più luci condividono lo
        // stesso modello (ogni chiamata riscriverebbe comunque tutto il set).
        await ctx.lightManager.saveAllLights();
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Light/Save', TJSLightSave);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Pick — accesso ai punti collimati via raycast
    // Tutti leggono ctx.collimatedPoints[] che è il riferimento live allo stesso
    // array di state.collimatedPoints → le modifiche dal pannello UI sono
    // immediatamente visibili ai nodi senza nessuna sincronizzazione esplicita.
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Pick/GetAll ──────────────────────────────────────────────────────
    // Emette l'intera lista dei punti collimati come array e il conteggio.
    function TJSPickGetAll() {
        this.addInput('trigger', ACTION);
        this.addOutput('done',  EVENT);     // prima uscita (convenzione); aggiunta 2026-10-04
        this.addOutput('points', 'array');   // [{id,label,position,normal,face,materialIndex,uv,uv1,objName,timestamp}]
        this.addOutput('count',  'number');
        this.addOutput('positions', 'array');   // [{x,y,z}] — solo le coordinate (2026-10-19)
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [200, 110];
    }
    TJSPickGetAll.title = 'Pick Get All';
    TJSPickGetAll.desc  = 'Outputs all the collimated points and their count';
    TJSPickGetAll.portHelp = {
        inputs:  { trigger: 'event — reads the current list' },
        outputs: {
            points: 'array of {id, label, position, normal, face, materialIndex, uv, uv1, objName, timestamp} — copy of the collimated points. normal is in world coordinates; face/uv/uv1 are present for points acquired since 2026-10-03 (null for older ones or without UV)',
            count:  'number — how many points in "points"',
            positions: 'array of {x,y,z} — only the coordinates of the points, in the same order. The TJS nodes also accept "points" directly (they use position)',
            done:   'event — fired after updating points and count (parameter: the array of points)',
        },
    };
    TJSPickGetAll.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pts = (ctx?.collimatedPoints ?? []).slice();   // copia shallow per sicurezza
        _out(this, 'points', pts);
        _out(this, 'count',  pts.length);
        _out(this, 'positions', pts.map(p => ({ x: p.position?.x ?? 0, y: p.position?.y ?? 0, z: p.position?.z ?? 0 })));
        const t = this.findOutputSlot('done');
        if (t !== -1) this.triggerSlot(t, pts);
    };
    // Flow salvati prima del 2026-10-04: l'uscita 'fatto' manca, la si aggiunge (in coda:
    // le porte salvate restano dove sono, la scrittura è per nome)
    TJSPickGetAll.prototype.onConfigure = function () {
        if (this.findOutputSlot('done') === -1) this.addOutput('done', EVENT);
        if (this.findOutputSlot('positions') === -1) this.addOutput('positions', 'array');   // flow salvati prima del 2026-10-19
    };
    LG.registerNodeType('TJS/Pick/GetAll', TJSPickGetAll);

    // Uscite dei punti collimati comuni a GetByIndex e GetByLabel (scritte per nome)
    const PICK_PORT_HELP = {
        position: '{x,y,z} — position of the point',
        normal:   '{x,y,z} | null — normal at the point, WORLD coordinates (unlike the Events nodes, where it is local to the object)' + OPT,
        face:     'number | null — index of the triangle hit' + OPT,
        uv:       '{u,v} | null — map coordinates of the point (main UV channel); null without UV or for points acquired before 2026-10-03' + OPT,
        uv1:      '{u,v} | null — like uv, on the second UV channel' + OPT,
        objName:  'text — name of the object hit',
    };
    function _emitPickPoint(node, pt) {
        _out(node, 'position', { ...pt.position });
        _out(node, 'normal',   pt.normal ? { ...pt.normal } : null);
        _out(node, 'face',     pt.face ?? null);
        _out(node, 'uv',       pt.uv  ? { ...pt.uv }  : null);
        _out(node, 'uv1',      pt.uv1 ? { ...pt.uv1 } : null);
        _out(node, 'label',    pt.label);
        _out(node, 'objName',  pt.objName ?? null);
        _out(node, 'found',  true);
    }


    // ─── TJS/Pick/GetByIndex ─────────────────────────────────────────────────
    // Ritorna le proprietà del punto all'indice specificato (0-based).
    function TJSPickGetByIndex() {
        this.addProperty('index', 0, 'number');
        this.addWidget('number', 'index (0-based)', 0, v => { this.properties.index = Math.max(0, Math.floor(v)); }, { property: 'index' });
        this.addInput('trigger',  ACTION);
        this.addInput('index',   'number');
        this.addOutput('position','object');   // {x,y,z}
        this.addOutput('label',   'string');   // "P1", "P2" …
        this.addOutput('objName', 'string');
        this.addOutput('found', 'boolean');
        // normal, face, uv, uv1: opzionali (menu Outputs, 2026-10-03)
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [210, 130];
    }
    TJSPickGetByIndex.title = 'Pick Get By Index';
    TJSPickGetByIndex.desc  = 'Returns the properties of the point at the given index (0-based). Other outputs (normal, face, uv, uv1): right-click the node → Outputs.';
    TJSPickGetByIndex.portHelp = {
        inputs: {
            trigger: 'event — reads the point at the given index',
            index:   'integer (0-based), overrides the widget',
        },
        outputs: {
            ...PICK_PORT_HELP,
            label:    'text — label ("P1", "P2", …)',
            found:    'boolean — false if the index is out of range (in that case the other outputs are not updated)',
        },
    };
    TJSPickGetByIndex.prototype.onGetOutputs = function () { return _optionalOutputs(this, PICK_OPTIONAL_OUTPUTS); };
    TJSPickGetByIndex.prototype.onConfigure  = function () { _markRemovable(this, PICK_OPTIONAL_OUTPUTS); };
    TJSPickGetByIndex.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pts = ctx?.collimatedPoints ?? [];
        const idx = Math.max(0, Math.floor(Number(this.getInputData(1) ?? this.properties.index)));
        const pt  = pts[idx] ?? null;
        if (!pt) {
            _out(this, 'found', false);
            return;
        }
        _emitPickPoint(this, pt);
    };
    LG.registerNodeType('TJS/Pick/GetByIndex', TJSPickGetByIndex);


    // ─── TJS/Pick/GetByLabel ─────────────────────────────────────────────────
    // Cerca un punto per etichetta (es. "P3") e ritorna le sue proprietà.
    function TJSPickGetByLabel() {
        this.addProperty('label', 'P1', 'string');
        this.addWidget('text', 'label', 'P1', v => { this.properties.label = v; }, { property: 'label' });
        this.addInput('trigger',  ACTION);
        this.addInput('label',    'string');
        this.addOutput('position','object');
        this.addOutput('objName', 'string');
        this.addOutput('found', 'boolean');
        // normal, face, uv, uv1: opzionali (menu Outputs, 2026-10-03)
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [210, 110];
    }
    TJSPickGetByLabel.title = 'Pick Get By Label';
    TJSPickGetByLabel.desc  = 'Looks for a point by label (e.g. "P3"). Other outputs (normal, face, uv, uv1): right-click the node → Outputs.';
    TJSPickGetByLabel.portHelp = {
        inputs: {
            trigger: 'event — looks for the point with the given label',
            label:   'text — exact label (e.g. "P3"), overrides the widget',
        },
        outputs: {
            ...PICK_PORT_HELP,
            found:    'boolean — false if no point has that label (in that case the other outputs are not updated)',
        },
    };
    TJSPickGetByLabel.prototype.onGetOutputs = function () { return _optionalOutputs(this, PICK_OPTIONAL_OUTPUTS); };
    TJSPickGetByLabel.prototype.onConfigure  = function () { _markRemovable(this, PICK_OPTIONAL_OUTPUTS); };
    TJSPickGetByLabel.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pts = ctx?.collimatedPoints ?? [];
        const lbl = this.getInputData(1) ?? this.properties.label;
        const pt  = pts.find(p => p.label === lbl) ?? null;
        if (!pt) {
            _out(this, 'found', false);
            return;
        }
        _emitPickPoint(this, pt);
    };
    LG.registerNodeType('TJS/Pick/GetByLabel', TJSPickGetByLabel);


    // ─── TJS/Pick/Count ──────────────────────────────────────────────────────
    // Emette sempre il numero corrente di punti collimati (onExecute, non triggered).
    // Utile per alimentare un nodo ReseArch/Menu/Status con il conteggio live.
    function TJSPickCount() {
        this.addOutput('count', 'number');
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [170, 50];
    }
    TJSPickCount.title = 'Pick Count';
    TJSPickCount.desc  = 'Continuously outputs the number of collimated points';
    TJSPickCount.portHelp = {
        outputs: { count: 'number — updated at every tick, no trigger needed' },
    };
    TJSPickCount.prototype.onExecute = function () {
        const ctx = this.graph?._appContext;
        this.setOutputData(0, ctx?.collimatedPoints?.length ?? 0);
    };
    LG.registerNodeType('TJS/Pick/Count', TJSPickCount);


    // ─── TJS/Pick/Clear ──────────────────────────────────────────────────────
    // Cancella tutti i punti collimati (array + marker 3D).
    // Chiama ctx.clearPoints() che è un proxy lazy verso state.pickManager.clear().
    function TJSPickClear() {
        this.addInput('trigger', ACTION);
        this.addOutput('done',  EVENT);
        this.color   = '#3a1a1a';
        this.bgcolor = '#7f1d1d';
        this.size    = [170, 60];
    }
    TJSPickClear.title = 'Pick Clear';
    TJSPickClear.desc  = 'Deletes all the collimated points and removes the markers from the scene';
    TJSPickClear.portHelp = {
        inputs:  { trigger: 'event — empties the point list (cannot be undone)' },
        outputs: { done: 'event — fired once cleared' },
    };
    TJSPickClear.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx) return;
        ctx.clearPoints?.();   // proxy lazy → state.pickManager.clear()
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Pick/Clear', TJSPickClear);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Geometry — creazione di entità geometriche Three.js
    // I nodi creano oggetti (Mesh, Line…) ma NON li aggiungono alla scena.
    // Usa TJS/Scene/AddObject per aggiungerli.
    // ═══════════════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────────────
    // TJS/Geometry/Curve — curve 2D/3D e percorsi
    //
    // Convenzione comune a tutti i nodi di questo gruppo:
    //   Input  'origine' → {x,y} sommato come offset a tutti i punti di definizione.
    //   Output 'punto finale' → {x,y} ultimo punto campionato (utile per concatenare
    //          curve: collega 'punto finale' di una curva a 'origine' della successiva).
    //   Output 'punti' → [{x,y}] campionati (collegabile direttamente a Lathe / Extrude).
    // ───────────────────────────────────────────────────────────────────────────

    // origin: facoltativo, punto non valido = nessuno spostamento (formato in _readPoint3)
    function _orig(raw)  { const p = _readPoint3(raw); return { x: p?.x ?? 0, y: p?.y ?? 0 }; }
    function _v3(raw)    { const p = _readPoint3(raw); return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 }; }

    // Oggetto del nodo ricalcolato: stessa istanza, geometria nuova (2026-10-19). Prima si creava un
    // oggetto nuovo liberando geometria e materiale del vecchio, che però restava nella scena: il
    // ricalcolo non si vedeva (o, aggiungendo di nuovo, gli oggetti si moltiplicavano). Il colore si
    // aggiorna solo se il materiale è ancora quello del nodo (non se è stato sostituito, es. AssignMaterial).
    function _reuseObj(node, geom, makeObj, color) {
        if (node._obj) {
            node._obj.geometry?.dispose();
            node._obj.geometry = geom;
            if (color != null && Number.isFinite(color) && node._obj.material === node._ownMat) node._ownMat.color?.setHex(color);
            _ctxDirty(node);
        } else {
            node._obj = makeObj(geom);
            node._ownMat = node._obj.material;
        }
        return node._obj;
    }


    // ─── TJS/Geometry/Curve/Line ─────────────────────────────────────────────
    function TJSCurveLine() {
        this.addProperty('name',  'Line',   'string');
        this.addProperty('color', 'ffffff', 'string');
        this.addWidget('text', 'name',       'Line',   v => { this.properties.name  = v; }, { property: 'name' });
        this.addWidget('text', 'color hex',  'ffffff', v => { this.properties.color = v; }, { property: 'color' });
        this.addInput('trigger',       ACTION);
        this.addInput('origin',       0);
        this.addInput('points',         0);        // [{x,y,z}]
        this.addInput('color',        'string');
        this.addOutput('done',        EVENT);    // prima uscita (convenzione, 2026-10-04)
        this.addOutput('object',      'object'); // THREE.Line
        this.addOutput('endPoint', 0);
        this.color   = '#064e3b';
        this.bgcolor = '#065f46';
        this.size    = [240, 150];
    }
    TJSCurveLine.title = 'Curve Line';
    TJSCurveLine.desc  = '3D THREE.Line from {x,y,z} points with {x,y} origin offset';
    // Help pannello (prototipo 2026-09-19) — vedi FLE-help-panel.mjs
    TJSCurveLine.portHelp = {
        inputs: {
            trigger: 'event — recomputes the line with the current values',
            origin:  '{x,y} offset added to all the points (default 0,0) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            points:  'array of points [{x,y,z}, …] — at least 2, required. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            color:   'hex color string (e.g. "ffffff") — overrides the widget',
        },
        outputs: {
            object:        'THREE.Line ready to be added to the scene. Recomputing updates the same line (add it to the scene once)',
            endPoint:       '{x,y} last point (+ origin offset) — useful to chain curves',
            done:          'event — fired once the line is created',
        },
    };
    TJSCurveLine.prototype.onAction = function () {
        const rawIn  = this.getInputData(2);
        const points = _readPoints3(rawIn);
        if (!points) { _pointWarn(this, 'points', rawIn); return; }
        if (points.length < 2) return;
        const o     = _orig(this.getInputData(1));
        const hex   = this.getInputData(3) ?? this.properties.color;
        const color = parseInt(String(hex).replace('#', ''), 16);
        const verts = new Float32Array(points.length * 3);
        for (let i = 0; i < points.length; i++) {
            verts[i*3]   = (points[i].x ?? points[i][0] ?? 0) + o.x;
            verts[i*3+1] = (points[i].y ?? points[i][1] ?? 0) + o.y;
            verts[i*3+2] = points[i].z ?? points[i][2] ?? 0;
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        _reuseObj(this, geom, g => new THREE.Line(g, new THREE.LineBasicMaterial({ color })), color);
        this._obj.name = this.properties.name;
        const last = points[points.length - 1];
        // uscite per nome (2026-10-04): l'ordine delle porte cambia tra nodi nuovi e salvati
        _out(this, 'object', this._obj);
        _out(this, 'endPoint', { x: (last.x ?? last[0] ?? 0) + o.x, y: (last.y ?? last[1] ?? 0) + o.y });
        // FIX (2026-09-19): era triggerSlot(0), che qui punta a 'oggetto' (indice 0)
        // invece che a 'fatto' (EVENT, indice 2) — verificato nel sorgente di
        // LiteGraph (LGraphNode.prototype.triggerSlot: `slot` è un indice grezzo
        // in this.outputs, non un indice "solo eventi"). Se 'oggetto' non era
        // collegato a valle, il trigger su 'fatto' non partiva mai.
        _fire(this, 'done');
    };
    LG.registerNodeType('TJS/Geometry/Curve/Line', TJSCurveLine);


    // ─── TJS/Geometry/Curve/LineCurve ───────────────────────────────────────
    // THREE.LineCurve 2D — segmento singolo o polilinea compatibile con CurvePath.
    // Origine sommata a tutti i punti. 2 punti → LineCurve; N>2 → array di LineCurves.
    function TJSCurveLineCurve() {
        this.addProperty('samples', 10, 'number');
        this.addWidget('number', 'samples', 10, v => { this.properties.samples = Math.max(2, Math.floor(v)); }, { property: 'samples' });
        this.addInput('trigger',  ACTION);
        this.addInput('origin',  0);        // {x,y} — offset sommato a tutti i punti
        this.addInput('point',    0);        // [{x,y},...] — array di punti
        this.addInput('samples',  'number'); // sovrascrive il widget se connesso
        this.addOutput('done',        EVENT);
        this.addOutput('curves',      'object'); // THREE.LineCurve o Array<LineCurve>
        this.addOutput('endPoint', 0);        // {x,y} ultimo punto
        this.addOutput('points',        0);        // [{x,y}] — compatibile con GeometryLathe
        this.color   = '#14532d';
        this.bgcolor = '#166534';
        this.size    = [230, 155];
    }
    TJSCurveLineCurve.title = 'Line Curve 2D';
    TJSCurveLineCurve.desc  = '2D THREE.LineCurve — segment/polyline, compatible with CurvePath';
    TJSCurveLineCurve.portHelp = {
        inputs: {
            trigger: 'event — recomputes the curve',
            origin:  '{x,y} offset added to all the points (default 0,0) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            point:   'array of points [{x,y}, …] — 2 points = one segment, N>2 = polyline. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            samples: 'number — samples per segment in the "points" output, overrides the widget',
        },
        outputs: {
            done:           'event — fired once the computation is complete',
            curves:         'THREE.LineCurve (2 points) or array of LineCurve (N>2) — 2D ONLY, no z',
            endPoint:       '{x,y} last point (+ origin offset)',
            points:         'array of sampled {x,y} points — 2D ONLY',
        },
    };
    TJSCurveLineCurve.prototype.onAction = function () {
        const o       = _orig(this.getInputData(1));
        const rawPts  = this.getInputData(2);
        const sIn     = this.getInputData(3);
        const samples = Math.max(2, Math.floor(sIn != null ? sIn : (this.properties.samples ?? 10)));
        const pts     = rawPts == null ? [] : (_readPoints3(Array.isArray(rawPts) ? rawPts : [rawPts]) ?? (_pointWarn(this, 'point', rawPts), []));

        const vecs = pts.map(p => ({
            x: o.x + p.x,
            y: o.y + p.y,
        }));

        // FIX (2026-09-20): scriveva esplicitamente null su 'curva/e'/'punto
        // finale' quando i punti erano <2 (es. trigger "a vuoto" prima che
        // l'array a monte fosse completo) — a differenza dei nodi fratelli
        // (Curve Line, CatmullRom, QuadraticBezier, CubicBezier, Spline),
        // che in questo stesso caso fanno un return secco senza toccare le
        // uscite, preservando l'ultimo valore valido. Un nodo Variable
        // collegato a 'punto finale' (nessun guard "ignora null" come
        // Inspect) si ritrovava la variabile condivisa azzerata ad ogni
        // trigger incompleto, anche se il grafo aveva già calcolato un
        // punto buono in precedenza.
        if (vecs.length < 2) return;

        const curves = [];
        for (let i = 0; i < vecs.length - 1; i++) {
            curves.push(new THREE.LineCurve(
                new THREE.Vector2(vecs[i].x,     vecs[i].y),
                new THREE.Vector2(vecs[i+1].x,   vecs[i+1].y),
            ));
        }

        const allPts = [];
        for (let i = 0; i < curves.length; i++) {
            const segPts = curves[i].getPoints(Math.max(1, samples - 1));
            const start  = i === 0 ? 0 : 1;
            for (let j = start; j < segPts.length; j++) {
                allPts.push({ x: segPts[j].x, y: segPts[j].y });
            }
        }

        const last = vecs[vecs.length - 1];
        this.setOutputData(1, curves.length === 1 ? curves[0] : curves);
        this.setOutputData(2, { x: last.x, y: last.y });
        this.setOutputData(3, allPts);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/Curve/LineCurve', TJSCurveLineCurve);


    // ─── TJS/Geometry/Curve/LineCurve3 ──────────────────────────────────────
    // THREE.LineCurve3 3D — segmento singolo o polilinea compatibile con CurvePath 3D.
    // Origine sommata a tutti i punti. 2 punti → LineCurve3; N>2 → array di LineCurve3.
    function TJSCurveLineCurve3() {
        this.addProperty('samples', 10, 'number');
        this.addWidget('number', 'samples', 10, v => { this.properties.samples = Math.max(2, Math.floor(v)); }, { property: 'samples' });
        this.addInput('trigger',  ACTION);
        this.addInput('origin',  0);        // {x,y,z} — offset sommato a tutti i punti
        this.addInput('point',    0);        // [{x,y,z},...] — array di punti
        this.addInput('samples',  'number'); // sovrascrive il widget se connesso
        this.addOutput('done',        EVENT);
        this.addOutput('curves',      'object'); // THREE.LineCurve3 o Array<LineCurve3>
        this.addOutput('endPoint', 0);        // {x,y,z} ultimo punto
        this.addOutput('points',        0);        // [{x,y,z}]
        this.color   = '#14532d';
        this.bgcolor = '#166534';
        this.size    = [230, 155];
    }
    TJSCurveLineCurve3.title = 'Line Curve 3D';
    TJSCurveLineCurve3.desc  = '3D THREE.LineCurve3 — segment/polyline, compatible with 3D CurvePath';
    TJSCurveLineCurve3.portHelp = {
        inputs: {
            trigger: 'event — recomputes the curve',
            origin:  '{x,y,z} offset added to all the points (default 0,0,0) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            point:   'array of points [{x,y,z}, …] — 2 points = one segment, N>2 = polyline. NB: the output is a mathematical curve, not visible: to draw a line use Curve Line. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            samples: 'number — samples per segment in the "points" output, overrides the widget',
        },
        outputs: {
            done:           'event — fired once the computation is complete',
            curves:         'THREE.LineCurve3 (2 points) or array of LineCurve3 (N>2) — true 3D, usable in TJS/Animate/AlongCurve',
            endPoint:       '{x,y,z} last point (+ origin offset)',
            points:         'array of sampled {x,y,z} points — true 3D',
        },
    };
    TJSCurveLineCurve3.prototype.onAction = function () {
        const o       = _v3(this.getInputData(1));
        const rawPts  = this.getInputData(2);
        const sIn     = this.getInputData(3);
        const samples = Math.max(2, Math.floor(sIn != null ? sIn : (this.properties.samples ?? 10)));
        const pts     = rawPts == null ? [] : (_readPoints3(Array.isArray(rawPts) ? rawPts : [rawPts]) ?? (_pointWarn(this, 'point', rawPts), []));

        const vecs = pts.map(p => ({
            x: o.x + p.x,
            y: o.y + p.y,
            z: o.z + p.z,
        }));

        // FIX (2026-09-20): stesso bug di TJSCurveLineCurve (Line Curve 2D)
        // qui sopra — vedi il commento lì per i dettagli.
        if (vecs.length < 2) return;

        const curves = [];
        for (let i = 0; i < vecs.length - 1; i++) {
            curves.push(new THREE.LineCurve3(
                new THREE.Vector3(vecs[i].x,     vecs[i].y,     vecs[i].z),
                new THREE.Vector3(vecs[i+1].x,   vecs[i+1].y,   vecs[i+1].z),
            ));
        }

        const allPts = [];
        for (let i = 0; i < curves.length; i++) {
            const segPts = curves[i].getPoints(Math.max(1, samples - 1));
            const start  = i === 0 ? 0 : 1;
            for (let j = start; j < segPts.length; j++) {
                allPts.push({ x: segPts[j].x, y: segPts[j].y, z: segPts[j].z });
            }
        }

        const last = vecs[vecs.length - 1];
        this.setOutputData(1, curves.length === 1 ? curves[0] : curves);
        this.setOutputData(2, { x: last.x, y: last.y, z: last.z });
        this.setOutputData(3, allPts);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/Curve/LineCurve3', TJSCurveLineCurve3);


    // ─── TJS/Geometry/Curve/CatmullRom ──────────────────────────────────────
    // Input connectors sovrascrivono i widget se connessi.
    function TJSCurveCatmullRom() {
        this.addProperty('tension',   0.5,         'number');
        this.addProperty('closed',    false,       'boolean');
        this.addProperty('samples',   50,          'number');
        this.addProperty('name',      'CatmullRom','string');
        this.addProperty('color',     'ffaa00',    'string');
        this.addWidget('number', 'tension',    0.5,         v => { this.properties.tension = v; }, { property: 'tension' });
        this.addWidget('toggle', 'closed',     false,       v => { this.properties.closed  = v; }, { property: 'closed' });
        this.addWidget('number', 'samples',    50,          v => { this.properties.samples = Math.max(3, Math.floor(v)); }, { property: 'samples' });
        this.addWidget('text',   'name',       'CatmullRom',v => { this.properties.name    = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'ffaa00',    v => { this.properties.color   = v; }, { property: 'color' });
        this.addInput('trigger',   ACTION);
        this.addInput('origin',   0);          // {x,y,z}
        this.addInput('points',     0);          // [{x,y,z}]
        this.addInput('tension',   'number');   // sovrascrive widget
        this.addInput('closed',    'boolean');
        this.addInput('samples',   'number');
        this.addInput('name',      'string');
        this.addInput('color',    'string');   // hex
        this.addOutput('done',        EVENT);
        this.addOutput('curve',        'object'); // CatmullRomCurve3
        this.addOutput('object',      'object'); // THREE.Line anteprima
        this.addOutput('points',        0);        // [{x,y,z}] campionati
        this.addOutput('endPoint', 0);        // {x,y,z}
        this.color   = '#064e3b';
        this.bgcolor = '#065f46';
        this.size    = [250, 285];
    }
    TJSCurveCatmullRom.title = 'Curve CatmullRom';
    TJSCurveCatmullRom.desc  = 'CatmullRomCurve3 from {x,y,z} points with origin offset';
    TJSCurveCatmullRom.portHelp = {
        inputs: {
            trigger: 'event — recomputes the curve',
            origin:  '{x,y,z} offset added to all the points. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            points:  'array of points [{x,y,z}, …] — at least 2, required. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            tension: 'number — spline tension (0 = polygonal, typically 0.5), overrides the widget',
            closed:  'boolean — true = closed loop curve, overrides the widget',
            samples: 'number — total samples, overrides the widget (min 3)',
            name:    'text — name of the preview THREE.Line, overrides the widget',
            color:   'text — hex color of the preview THREE.Line, overrides the widget',
        },
        outputs: {
            done:           'event — fired once the computation is complete',
            curve:          'THREE.CatmullRomCurve3 — true 3D, usable in TJS/Animate/AlongCurve',
            object:         'THREE.Line — renderable preview of the curve (to be added to the scene with TJS/Scene/AddObject)',
            points:         'array of {x,y,z} points sampled on the curve',
            endPoint:       '{x,y,z} last sampled point',
        },
    };
    TJSCurveCatmullRom.prototype.onAction = function () {
        const rawIn  = this.getInputData(2);
        const rawPts = _readPoints3(rawIn);
        if (!rawPts) { _pointWarn(this, 'points', rawIn); return; }
        if (rawPts.length < 2) return;
        const _in     = (i, prop) => { const v = this.getInputData(i); return v != null ? v : this.properties[prop]; };
        const o       = _v3(this.getInputData(1));   // fix: era _orig (2D), CatmullRomCurve3 è 3D
        const tension = Number(_in(3, 'tension')  ?? 0.5);
        const closed  = Boolean(_in(4, 'closed')  ?? false);
        const samples = Math.max(3, Math.floor(_in(5, 'samples') ?? 50));
        const colorHex = String(_in(7, 'color') ?? 'ffaa00').replace('#', '');
        const color    = parseInt(colorHex, 16);
        const v3s     = rawPts.map(p => new THREE.Vector3(
            (p.x ?? p[0] ?? 0) + o.x,
            (p.y ?? p[1] ?? 0) + o.y,
            (p.z ?? p[2] ?? 0) + o.z,  // fix: ora include offset z
        ));
        const curve   = new THREE.CatmullRomCurve3(v3s, closed, 'catmullrom', tension);
        const pts3   = curve.getPoints(samples);
        const verts  = new Float32Array(pts3.length * 3);
        const ptsOut = [];
        for (let i = 0; i < pts3.length; i++) {
            verts[i*3]   = pts3[i].x;
            verts[i*3+1] = pts3[i].y;
            verts[i*3+2] = pts3[i].z;
            ptsOut.push({ x: pts3[i].x, y: pts3[i].y, z: pts3[i].z });
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        _reuseObj(this, geom, g => new THREE.Line(g, new THREE.LineBasicMaterial({ color })), color);
        this._obj.name = String(_in(6, 'name') ?? 'CatmullRom');
        const last = pts3[pts3.length - 1];
        this.setOutputData(1, curve);
        this.setOutputData(2, this._obj);
        this.setOutputData(3, ptsOut);
        this.setOutputData(4, { x: last.x, y: last.y, z: last.z });  // fix: aggiunto z
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/Curve/CatmullRom', TJSCurveCatmullRom);


    // ─── TJS/Geometry/Curve/QuadraticBezier ─────────────────────────────────
    // punti[3]: [start, ctrl, end] — origine è offset sommato a tutti i punti.
    function TJSCurveQuadraticBezier() {
        this.addProperty('samples', 32, 'number');
        this.addWidget('number', 'samples', 32, v => { this.properties.samples = Math.max(2, Math.floor(v)); }, { property: 'samples' });
        this.addInput('trigger',  ACTION);   // 0
        this.addInput('origin',  0);        // 1  offset traslazione (default 0,0)
        this.addInput('points',    0);        // 2  array [start, ctrl, end]
        this.addInput('samples',  'number'); // 3
        this.addOutput('done',        EVENT);   // 0
        this.addOutput('curve',        'object'); // 1
        this.addOutput('endPoint', 0);        // 2
        this.addOutput('points',        0);        // 3
        this.color   = '#14532d';
        this.bgcolor = '#166534';
        this.size    = [210, 120];
    }
    TJSCurveQuadraticBezier.title = 'Curve Quadratic Bezier';
    TJSCurveQuadraticBezier.desc  = '2D QuadraticBezierCurve — points[start,ctrl,end] + origin offset';
    TJSCurveQuadraticBezier.portHelp = {
        inputs: {
            trigger: 'event — recomputes the curve',
            origin:  '{x,y} offset added to all the points. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            points:  'array of EXACTLY 3 points [start, control, end] — {x,y} each. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            samples: 'number — samples on the curve, overrides the widget',
        },
        outputs: {
            done:           'event — fired once the computation is complete',
            curve:          'THREE.QuadraticBezierCurve — 2D ONLY, no z',
            endPoint:       '{x,y} last sampled point',
            points:         'array of sampled {x,y} points — 2D ONLY',
        },
    };
    TJSCurveQuadraticBezier.prototype.onAction = function () {
        const rawIn = this.getInputData(2);
        const raw   = _readPoints3(rawIn);
        if (!raw) { _pointWarn(this, 'points', rawIn); return; }
        if (raw.length < 3) return;
        const o       = _orig(this.getInputData(1));
        const samples = Math.max(2, Math.floor(this.getInputData(3) ?? this.properties.samples));
        const [p0, p1, p2] = raw.map(p => _orig(p));
        const curve = new THREE.QuadraticBezierCurve(
            new THREE.Vector2(o.x + p0.x, o.y + p0.y),
            new THREE.Vector2(o.x + p1.x, o.y + p1.y),
            new THREE.Vector2(o.x + p2.x, o.y + p2.y),
        );
        const pts  = curve.getPoints(samples);
        const last = pts[pts.length - 1];
        this.setOutputData(1, curve);
        this.setOutputData(2, { x: last.x, y: last.y });
        this.setOutputData(3, pts.map(v => ({ x: v.x, y: v.y })));
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/Curve/QuadraticBezier', TJSCurveQuadraticBezier);


    // ─── TJS/Geometry/Curve/CubicBezier ─────────────────────────────────────
    // punti[4]: [start, ctrl1, ctrl2, end] — origine è offset sommato a tutti i punti.
    function TJSCurveCubicBezier() {
        this.addProperty('samples', 32, 'number');
        this.addWidget('number', 'samples', 32, v => { this.properties.samples = Math.max(2, Math.floor(v)); }, { property: 'samples' });
        this.addInput('trigger',  ACTION);   // 0
        this.addInput('origin',  0);        // 1  offset traslazione (default 0,0)
        this.addInput('points',    0);        // 2  array [start, ctrl1, ctrl2, end]
        this.addInput('samples',  'number'); // 3
        this.addOutput('done',        EVENT);   // 0
        this.addOutput('curve',        'object'); // 1
        this.addOutput('endPoint', 0);        // 2
        this.addOutput('points',        0);        // 3
        this.color   = '#14532d';
        this.bgcolor = '#166534';
        this.size    = [210, 120];
    }
    TJSCurveCubicBezier.title = 'Curve Cubic Bezier';
    TJSCurveCubicBezier.desc  = '2D CubicBezierCurve — points[start,ctrl1,ctrl2,end] + origin offset';
    TJSCurveCubicBezier.portHelp = {
        inputs: {
            trigger: 'event — recomputes the curve',
            origin:  '{x,y} offset added to all the points. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            points:  'array of EXACTLY 4 points [start, control1, control2, end] — {x,y} each. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            samples: 'number — samples on the curve, overrides the widget',
        },
        outputs: {
            done:           'event — fired once the computation is complete',
            curve:          'THREE.CubicBezierCurve — 2D ONLY, no z',
            endPoint:       '{x,y} last sampled point',
            points:         'array of sampled {x,y} points — 2D ONLY',
        },
    };
    TJSCurveCubicBezier.prototype.onAction = function () {
        const rawIn = this.getInputData(2);
        const raw   = _readPoints3(rawIn);
        if (!raw) { _pointWarn(this, 'points', rawIn); return; }
        if (raw.length < 4) return;
        const o       = _orig(this.getInputData(1));
        const samples = Math.max(2, Math.floor(this.getInputData(3) ?? this.properties.samples));
        const [p0, p1, p2, p3] = raw.map(p => _orig(p));
        const curve = new THREE.CubicBezierCurve(
            new THREE.Vector2(o.x + p0.x, o.y + p0.y),
            new THREE.Vector2(o.x + p1.x, o.y + p1.y),
            new THREE.Vector2(o.x + p2.x, o.y + p2.y),
            new THREE.Vector2(o.x + p3.x, o.y + p3.y),
        );
        const pts  = curve.getPoints(samples);
        const last = pts[pts.length - 1];
        this.setOutputData(1, curve);
        this.setOutputData(2, { x: last.x, y: last.y });
        this.setOutputData(3, pts.map(v => ({ x: v.x, y: v.y })));
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/Curve/CubicBezier', TJSCurveCubicBezier);


    // ─── TJS/Geometry/Curve/Ellipse ─────────────────────────────────────────
    // EllipseCurve 2D. Origine = centro dell'ellisse. Angoli in gradi.
    // Input connectors sovrascrivono i widget se connessi.
    function TJSCurveEllipse() {
        this.addProperty('rx',         1,     'number');
        this.addProperty('ry',         0.5,   'number');
        this.addProperty('startAngle', 0,     'number');
        this.addProperty('endAngle',   360,   'number');
        this.addProperty('clockwise',  false, 'boolean');
        this.addProperty('rotation',   0,     'number');
        this.addProperty('samples',    32,    'number');
        this.addWidget('number', 'rx',          1,     v => { this.properties.rx         = v; }, { property: 'rx' });
        this.addWidget('number', 'ry',          0.5,   v => { this.properties.ry         = v; }, { property: 'ry' });
        this.addWidget('number', 'startAngle°', 0,     v => { this.properties.startAngle = v; }, { property: 'startAngle' });
        this.addWidget('number', 'endAngle°',   360,   v => { this.properties.endAngle   = v; }, { property: 'endAngle' });
        this.addWidget('toggle', 'clockwise',   false, v => { this.properties.clockwise  = v; }, { property: 'clockwise' });
        this.addWidget('number', 'rotation°',   0,     v => { this.properties.rotation   = v; }, { property: 'rotation' });
        this.addWidget('number', 'samples',     32,    v => { this.properties.samples    = Math.max(2, Math.floor(v)); }, { property: 'samples' });
        this.addInput('trigger',     ACTION);
        this.addInput('origin',     0);        // {x,y} = centro ellisse
        this.addInput('rx',          'number'); // sovrascrive widget
        this.addInput('ry',          'number');
        this.addInput('startAngle°', 'number');
        this.addInput('endAngle°',   'number');
        this.addInput('clockwise',   'boolean');
        this.addInput('rotation°',   'number');
        this.addInput('samples',     'number');
        this.addOutput('done',        EVENT);
        this.addOutput('curve',        'object');
        this.addOutput('endPoint', 0);
        this.addOutput('points',        0);
        this.color   = '#14532d';
        this.bgcolor = '#166534';
        this.size    = [240, 300];
    }
    TJSCurveEllipse.title = 'Curve Ellipse';
    TJSCurveEllipse.desc  = '2D EllipseCurve — origin=center, angles in degrees';
    // Help pannello (prototipo 2026-09-19) — vedi FLE-help-panel.mjs
    TJSCurveEllipse.portHelp = {
        inputs: {
            trigger:      'event — recomputes the curve with the current values',
            origin:       '{x,y} center of the ellipse (default 0,0)',
            rx:           'number — X radius, overrides the widget if connected',
            ry:           'number — Y radius, overrides the widget if connected',
            'startAngle°': 'number — start angle in degrees',
            'endAngle°':   'number — end angle in degrees (360 = full turn)',
            clockwise:    'boolean — true = clockwise',
            'rotation°':   'number — rotation of the whole ellipse, in degrees',
            samples:      'number — curve segments (resolution, min 2)',
        },
        outputs: {
            done:           'event — fired once the computation is complete',
            curve:          'THREE.EllipseCurve — 2D curve (x,y only, NO z: do not connect it directly to an input expecting 3D, e.g. TJS/Animate/AlongCurve)',
            endPoint:       '{x,y} last sampled point',
            points:         'array of points [{x,y}, …] sampled on the curve — 2D ONLY, no z',
        },
    };
    TJSCurveEllipse.prototype.onAction = function () {
        const o   = _orig(this.getInputData(1));
        const D2R = Math.PI / 180;
        const _in = (i, prop) => { const v = this.getInputData(i); return v != null ? v : this.properties[prop]; };
        const rx         = _in(2, 'rx')         ?? 1;
        const ry         = _in(3, 'ry')         ?? 0.5;
        const startAngle = _in(4, 'startAngle') ?? 0;
        const endAngle   = _in(5, 'endAngle')   ?? 360;
        const clockwise  = Boolean(_in(6, 'clockwise'));
        const rotation   = _in(7, 'rotation')   ?? 0;
        const samples    = Math.max(2, Math.floor(_in(8, 'samples') ?? 32));
        const curve = new THREE.EllipseCurve(
            o.x, o.y,
            rx, ry,
            startAngle * D2R,
            endAngle   * D2R,
            clockwise,
            rotation   * D2R,
        );
        const pts  = curve.getPoints(samples);
        const last = pts[pts.length - 1];
        this.setOutputData(1, curve);
        this.setOutputData(2, { x: last.x, y: last.y });
        this.setOutputData(3, pts.map(v => ({ x: v.x, y: v.y })));
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/Curve/Ellipse', TJSCurveEllipse);


    // ─── TJS/Geometry/Curve/Arc ─────────────────────────────────────────────
    // ArcCurve 2D (EllipseCurve rx=ry). Origine = centro. Angoli in gradi.
    // Input connectors sovrascrivono i widget se connessi.
    function TJSCurveArc() {
        this.addProperty('r',          1,     'number');
        this.addProperty('startAngle', 0,     'number');
        this.addProperty('endAngle',   180,   'number');
        this.addProperty('clockwise',  false, 'boolean');
        this.addProperty('samples',    32,    'number');
        this.addWidget('number', 'r (radius)',  1,     v => { this.properties.r          = v; }, { property: 'r' });
        this.addWidget('number', 'startAngle°', 0,     v => { this.properties.startAngle = v; }, { property: 'startAngle' });
        this.addWidget('number', 'endAngle°',   180,   v => { this.properties.endAngle   = v; }, { property: 'endAngle' });
        this.addWidget('toggle', 'clockwise',   false, v => { this.properties.clockwise  = v; }, { property: 'clockwise' });
        this.addWidget('number', 'samples',     32,    v => { this.properties.samples    = Math.max(2, Math.floor(v)); }, { property: 'samples' });
        this.addInput('trigger',     ACTION);
        this.addInput('origin',     0);        // {x,y} = centro arco
        this.addInput('r',           'number'); // sovrascrive widget
        this.addInput('startAngle°', 'number');
        this.addInput('endAngle°',   'number');
        this.addInput('clockwise',   'boolean');
        this.addInput('samples',     'number');
        this.addOutput('done',        EVENT);
        this.addOutput('curve',        'object');
        this.addOutput('endPoint', 0);
        this.addOutput('points',        0);
        this.color   = '#14532d';
        this.bgcolor = '#166534';
        this.size    = [230, 260];
    }
    TJSCurveArc.title = 'Curve Arc';
    TJSCurveArc.desc  = '2D ArcCurve (circular arc) — origin=center, angles in degrees';
    // Help pannello (prototipo 2026-09-19) — vedi FLE-help-panel.mjs
    TJSCurveArc.portHelp = {
        inputs: {
            trigger:      'event — recomputes the curve with the current values',
            origin:       '{x,y} center of the arc (default 0,0)',
            r:            'number — radius, overrides the widget if connected',
            'startAngle°': 'number — start angle in degrees',
            'endAngle°':   'number — end angle in degrees (360 = full circle)',
            clockwise:    'boolean — true = clockwise',
            samples:      'number — curve segments (resolution, min 2)',
        },
        outputs: {
            done:           'event — fired once the computation is complete',
            curve:          'THREE.ArcCurve — 2D curve (x,y only, NO z: do not connect it directly to an input expecting 3D, e.g. TJS/Animate/AlongCurve)',
            endPoint:       '{x,y} last sampled point',
            points:         'array of points [{x,y}, …] sampled on the curve — 2D ONLY, no z',
        },
    };
    TJSCurveArc.prototype.onAction = function () {
        const o   = _orig(this.getInputData(1));
        const D2R = Math.PI / 180;
        const _in = (i, prop) => { const v = this.getInputData(i); return v != null ? v : this.properties[prop]; };
        const r          = _in(2, 'r')          ?? 1;
        const startAngle = _in(3, 'startAngle') ?? 0;
        const endAngle   = _in(4, 'endAngle')   ?? 180;
        const clockwise  = Boolean(_in(5, 'clockwise'));
        const samples    = Math.max(2, Math.floor(_in(6, 'samples') ?? 32));
        const curve = new THREE.ArcCurve(
            o.x, o.y,
            r,
            startAngle * D2R,
            endAngle   * D2R,
            clockwise,
        );
        const pts  = curve.getPoints(samples);
        const last = pts[pts.length - 1];
        this.setOutputData(1, curve);
        this.setOutputData(2, { x: last.x, y: last.y });
        this.setOutputData(3, pts.map(v => ({ x: v.x, y: v.y })));
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/Curve/Arc', TJSCurveArc);


    // ─── TJS/Geometry/Curve/Spline ──────────────────────────────────────────
    // SplineCurve 2D da array {x,y} + offset origine.
    // Input connector samples sovrascrive il widget se connesso.
    function TJSCurveSpline() {
        this.addProperty('samples', 50, 'number');
        this.addWidget('number', 'samples', 50, v => { this.properties.samples = Math.max(2, Math.floor(v)); }, { property: 'samples' });
        this.addInput('trigger',  ACTION);
        this.addInput('origin',  0);
        this.addInput('points',    0);        // [{x,y}]
        this.addInput('samples',  'number'); // sovrascrive widget se connesso
        this.addOutput('done',        EVENT);
        this.addOutput('curve',        'object');
        this.addOutput('endPoint', 0);
        this.addOutput('points',        0);
        this.color   = '#14532d';
        this.bgcolor = '#166534';
        this.size    = [230, 135];
    }
    TJSCurveSpline.title = 'Curve Spline';
    TJSCurveSpline.desc  = '2D SplineCurve from {x,y} points with origin offset';
    TJSCurveSpline.portHelp = {
        inputs: {
            trigger: 'event — recomputes the curve',
            origin:  '{x,y} offset added to all the points. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            points:  'array of points [{x,y}, …] — at least 2, passes exactly through each one (interpolating) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            samples: 'number — samples on the curve, overrides the widget',
        },
        outputs: {
            done:           'event — fired once the computation is complete',
            curve:          'THREE.SplineCurve — 2D ONLY, no z',
            endPoint:       '{x,y} last sampled point',
            points:         'array of sampled {x,y} points — 2D ONLY',
        },
    };
    TJSCurveSpline.prototype.onAction = function () {
        const rawIn  = this.getInputData(2);
        const rawPts = _readPoints3(rawIn);
        if (!rawPts) { _pointWarn(this, 'points', rawIn); return; }
        if (rawPts.length < 2) return;
        const o      = _orig(this.getInputData(1));
        const sIn    = this.getInputData(3);
        const samples = Math.max(2, Math.floor(sIn != null ? sIn : (this.properties.samples ?? 50)));
        const v2s   = rawPts.map(p => new THREE.Vector2((p.x ?? p[0] ?? 0) + o.x, (p.y ?? p[1] ?? 0) + o.y));
        const curve = new THREE.SplineCurve(v2s);
        const pts   = curve.getPoints(samples);
        const last  = pts[pts.length - 1];
        this.setOutputData(1, curve);
        this.setOutputData(2, { x: last.x, y: last.y });
        this.setOutputData(3, pts.map(v => ({ x: v.x, y: v.y })));
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/Curve/Spline', TJSCurveSpline);


    // ─── TJS/Geometry/Curve/CurvePath ───────────────────────────────────────
    // THREE.CurvePath da array di curve 2D. Accetta anche una singola curva.
    function TJSCurvePath() {
        this.addProperty('autoClose', false, 'boolean');
        this.addProperty('samples',   64,    'number');
        this.addWidget('toggle', 'autoClose', false, v => { this.properties.autoClose = v; }, { property: 'autoClose' });
        this.addWidget('number', 'samples',   64,   v => { this.properties.samples   = Math.max(2, Math.floor(v)); }, { property: 'samples' });
        this.addInput('trigger',       ACTION);
        this.addInput('curve',         0);        // array di THREE.Curve o singola curva
        this.addOutput('done',        EVENT);    // prima uscita (convenzione, 2026-10-04)
        this.addOutput('curvePath',    'object');
        this.addOutput('endPoint', 0);
        this.addOutput('points',        0);
        this.color   = '#14532d';   // famiglia Creazione (astratta) — fix incongruenza colore (2026-09-19)
        this.bgcolor = '#166534';
        this.size    = [230, 140];
    }
    TJSCurvePath.title = 'Curve Path';
    TJSCurvePath.desc  = 'THREE.CurvePath from an array of 2D curves — outputs: path, end point, sampled points';
    TJSCurvePath.portHelp = {
        inputs: {
            trigger: 'event — recomputes the path',
            curve:   'a THREE.Curve or an array of curves (e.g. the "curve"/"curves" outputs of the other Curve/* nodes) — chained in order',
        },
        outputs: {
            curvePath:      'THREE.CurvePath — set of curves handled as a single curve',
            endPoint:       '{x,y} last sampled point',
            points:         'array of {x,y} points sampled on the whole path',
            done:           'event — fired once the computation is complete',
        },
    };
    TJSCurvePath.prototype.onAction = function () {
        const input = this.getInputData(1);
        const arr   = Array.isArray(input) ? input : (input ? [input] : []);
        if (arr.length === 0) return;
        const samples  = Math.max(2, Math.floor(this.properties.samples ?? 64));
        const path     = new THREE.CurvePath();
        path.autoClose = Boolean(this.properties.autoClose);
        for (const c of arr) { if (c) path.add(c); }
        const pts  = path.getPoints(samples);
        const last = pts[pts.length - 1];
        // uscite per nome (2026-10-04): l'ordine delle porte cambia tra nodi nuovi e salvati
        _out(this, 'curvePath', path);
        _out(this, 'endPoint', last ? { x: last.x, y: last.y } : null);
        _out(this, 'points', pts.map(v => ({ x: v.x, y: v.y })));
        // FIX (2026-09-19): era triggerSlot(0) → puntava a 'curvePath' (indice 0)
        // invece che a 'fatto' (EVENT, indice 3) — stesso bug di Curve/Line, vedi
        // nota lì. Se 'curvePath' non era collegato a valle, il trigger su
        // 'fatto' non partiva mai.
        _fire(this, 'done');
    };
    LG.registerNodeType('TJS/Geometry/Curve/CurvePath', TJSCurvePath);


    // ─── TJS/Geometry/PlaneGeometry ─────────────────────────────────────────
    // Widget rimasti: nome, colore hex, seg W, seg H.
    // larghezza e altezza solo via connettore (default 1).
    function TJSGeometryPlane() {
        this.addProperty('name',   'Plane',  'string');
        this.addProperty('color',  'aaaaaa', 'string');
        this.addProperty('width',  1,        'number');
        this.addProperty('height', 1,        'number');
        this.addProperty('segW',   1,        'number');
        this.addProperty('segH',   1,        'number');
        this.addWidget('text',   'name',       'Plane',  v => { this.properties.name  = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'aaaaaa', v => { this.properties.color = v; }, { property: 'color' });
        this.addWidget('number', 'seg W',      1, v => { this.properties.segW = Math.max(1, Math.floor(v)); }, { property: 'segW' });
        this.addWidget('number', 'seg H',      1, v => { this.properties.segH = Math.max(1, Math.floor(v)); }, { property: 'segH' });
        this.addInput('trigger',   ACTION);
        this.addInput('width', 'number');  // default: prop.width = 1
        this.addInput('height',   'number');  // default: prop.height = 1
        this.addInput('name',      'string');  // sovrascrive widget
        this.addInput('color',    'string');  // hex, sovrascrive widget
        this.addInput('segW',     'number');  // sovrascrive widget
        this.addInput('segH',     'number');
        this.addOutput('done',    EVENT);
        this.addOutput('object',  'object');
        this.color   = '#064e3b';
        this.bgcolor = '#065f46';
        this.size    = [230, 210];
    }
    TJSGeometryPlane.title = 'Geometry Plane';
    TJSGeometryPlane.desc  = 'Creates a plane (PlaneGeometry + MeshStandardMaterial)';
    // Help pannello (prototipo 2026-09-19) — vedi FLE-help-panel.mjs
    TJSGeometryPlane.portHelp = {
        inputs: {
            trigger:   'event — (re)creates the plane with the current values',
            width:     'number — width (default 1)',
            height:    'number — height (default 1)',
            name:      'text — name of the object in the scene, overrides the widget',
            color:     'text — hex color (e.g. "aaaaaa"), overrides the widget',
            segW:      'integer — horizontal segments (min 1)',
            segH:      'integer — vertical segments (min 1)',
        },
        outputs: {
            done:    'event — fired once the mesh is created',
            object:  'THREE.Mesh (PlaneGeometry + MeshStandardMaterial), ready to be added to the scene',
        },
    };
    TJSGeometryPlane.prototype.onAction = function () {
        const _in = (i, prop) => { const v = this.getInputData(i); return v != null ? v : this.properties[prop]; };
        const colorHex = String(_in(4, 'color') ?? 'aaaaaa').replace('#', '');
        const geom = new THREE.PlaneGeometry(
            Math.max(0.001, Number(_in(1, 'width')  ?? 1)),
            Math.max(0.001, Number(_in(2, 'height') ?? 1)),
            Math.max(1, Math.floor(_in(5, 'segW')   ?? 1)),
            Math.max(1, Math.floor(_in(6, 'segH')   ?? 1))
        );
        _reuseObj(this, geom, g => new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: parseInt(colorHex, 16), side: THREE.DoubleSide })), parseInt(colorHex, 16));
        this._obj.name = String(_in(3, 'name') ?? 'Plane');
        this.setOutputData(1, this._obj);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/PlaneGeometry', TJSGeometryPlane);


    // ─── TJS/Geometry/BoxGeometry ────────────────────────────────────────────
    // Widget rimasti: nome, colore hex.
    // width, height, depth solo via connettore (default 1).
    function TJSGeometryBox() {
        this.addProperty('name',   'Box',    'string');
        this.addProperty('color',  'aaaaaa', 'string');
        this.addProperty('width',  1,        'number');
        this.addProperty('height', 1,        'number');
        this.addProperty('depth',  1,        'number');
        this.addWidget('text', 'name',       'Box',    v => { this.properties.name  = v; }, { property: 'name' });
        this.addWidget('text', 'color hex',  'aaaaaa', v => { this.properties.color = v; }, { property: 'color' });
        this.addInput('trigger', ACTION);
        this.addInput('width',   'number');  // default: prop.width = 1
        this.addInput('height',  'number');
        this.addInput('depth',   'number');
        this.addInput('name',    'string');  // sovrascrive widget
        this.addInput('color',  'string');  // hex, sovrascrive widget
        this.addOutput('done',   EVENT);
        this.addOutput('object', 'object');
        this.color   = '#064e3b';
        this.bgcolor = '#065f46';
        this.size    = [230, 175];
    }
    TJSGeometryBox.title = 'Geometry Box';
    TJSGeometryBox.desc  = 'Creates a box (BoxGeometry + MeshStandardMaterial)';
    // Help pannello (prototipo 2026-09-19) — vedi FLE-help-panel.mjs
    TJSGeometryBox.portHelp = {
        inputs: {
            trigger: 'event — (re)creates the box with the current values',
            width:   'number — X width (default 1)',
            height:  'number — Y height (default 1)',
            depth:   'number — Z depth (default 1)',
            name:    'text — name of the object in the scene, overrides the widget',
            color:   'text — hex color (e.g. "aaaaaa"), overrides the widget',
        },
        outputs: {
            done:    'event — fired once the mesh is created',
            object:  'THREE.Mesh (BoxGeometry + MeshStandardMaterial), ready to be added to the scene',
        },
    };
    TJSGeometryBox.prototype.onAction = function () {
        const _in = (i, prop) => { const v = this.getInputData(i); return v != null ? v : this.properties[prop]; };
        const colorHex = String(_in(5, 'color') ?? 'aaaaaa').replace('#', '');
        const geom = new THREE.BoxGeometry(
            Math.max(0.001, Number(_in(1, 'width')  ?? 1)),
            Math.max(0.001, Number(_in(2, 'height') ?? 1)),
            Math.max(0.001, Number(_in(3, 'depth')  ?? 1))
        );
        _reuseObj(this, geom, g => new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: parseInt(colorHex, 16) })), parseInt(colorHex, 16));
        this._obj.name = String(_in(4, 'name') ?? 'Box');
        this.setOutputData(1, this._obj);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/BoxGeometry', TJSGeometryBox);


    // ─── TJS/Geometry/SphereGeometry · ConeGeometry · CylinderGeometry (2026-10-14) ──
    // Stesso schema di Box: widget nome, colore, segmenti; misure via connettore.
    // Angoli (in gradi) e aperture sono ingressi opzionali: tasto destro → Inputs.
    // Ingressi letti per nome (l'ordine di quelli opzionali varia).
    const D2R = Math.PI / 180;
    const ROUND_GEOMETRIES = {
        Sphere: {
            desc: 'Creates a sphere (SphereGeometry + MeshStandardMaterial); optional angles make segments and caps',
            sizes: [['radius', 1, 'number — radius (default 1)']],
            segments: [32, 'integer — segments around the Y axis (min 3; the vertical ones are half), overrides the widget'],
            optional: [
                ['phiStart°',   0,   'number in degrees — horizontal start angle'],
                ['phiLength°',  360, 'number in degrees — horizontal sweep (360 = full turn)'],
                ['thetaStart°', 0,   'number in degrees — vertical start angle (0 = top pole)'],
                ['thetaLength°',180, 'number in degrees — vertical sweep (180 = down to the bottom pole)'],
            ],
            build(v) {
                return new THREE.SphereGeometry(v.radius, v.segments, Math.max(2, Math.round(v.segments / 2)),
                    v['phiStart°'] * D2R, v['phiLength°'] * D2R, v['thetaStart°'] * D2R, v['thetaLength°'] * D2R);
            },
            open: v => v['phiLength°'] < 360 || v['thetaLength°'] < 180,
        },
        Cone: {
            desc: 'Creates a cone along the Y axis (ConeGeometry + MeshStandardMaterial); optional angle and open base',
            sizes: [['radius', 1, 'number — base radius (default 1)'], ['height', 1, 'number — height along Y (default 1)']],
            segments: [32, 'integer — segments around the Y axis (min 3), overrides the widget'],
            optional: [
                ['thetaStart°',  0,     'number in degrees — start angle around Y'],
                ['thetaLength°', 360,   'number in degrees — sweep around Y (360 = full turn)'],
                ['openEnded',    false, 'boolean — true: no base'],
            ],
            build(v) {
                return new THREE.ConeGeometry(v.radius, v.height, v.segments, 1, v.openEnded,
                    v['thetaStart°'] * D2R, v['thetaLength°'] * D2R);
            },
            open: v => v.openEnded || v['thetaLength°'] < 360,
        },
        Cylinder: {
            desc: 'Creates a cylinder along the Y axis (CylinderGeometry + MeshStandardMaterial); optional different radii, angle and open ends',
            sizes: [['radius', 1, 'number — radius of both ends (default 1)'], ['height', 1, 'number — height along Y (default 1)']],
            segments: [32, 'integer — segments around the Y axis (min 3), overrides the widget'],
            optional: [
                ['radiusTop',    null,  'number — radius of the top end, overrides "radius" (0 = cone)'],
                ['radiusBottom', null,  'number — radius of the bottom end, overrides "radius"'],
                ['thetaStart°',  0,     'number in degrees — start angle around Y'],
                ['thetaLength°', 360,   'number in degrees — sweep around Y (360 = full turn)'],
                ['openEnded',    false, 'boolean — true: no end caps (a tube)'],
            ],
            build(v) {
                return new THREE.CylinderGeometry(Math.max(0, v.radiusTop ?? v.radius), Math.max(0, v.radiusBottom ?? v.radius),
                    v.height, v.segments, 1, v.openEnded, v['thetaStart°'] * D2R, v['thetaLength°'] * D2R);
            },
            open: v => v.openEnded || v['thetaLength°'] < 360,
        },
    };

    function _registerRoundGeometry(kind, def) {
        const OPT = def.optional.map(([n, , , ]) => [n, n === 'openEnded' ? 'boolean' : 'number']);
        function Node() {
            this.addProperty('name',     kind,           'string');
            this.addProperty('color',    'aaaaaa',       'string');
            this.addProperty('segments', def.segments[0], 'number');
            this.addWidget('text',   'name',      kind,     v => { this.properties.name  = v; }, { property: 'name' });
            this.addWidget('text',   'color hex', 'aaaaaa', v => { this.properties.color = v; }, { property: 'color' });
            this.addWidget('number', 'segments',  def.segments[0], v => { this.properties.segments = Math.max(3, Math.round(v)); },
                           { min: 3, max: 256, step: 10, precision: 0, property: 'segments' });
            this.addInput('trigger', ACTION);
            for (const [n] of def.sizes) this.addInput(n, 'number');
            this.addInput('segments', 'number');
            this.addInput('name',     'string');
            this.addInput('color',    'string');
            this.addOutput('done',   EVENT);
            this.addOutput('object', 'object');
            this.color   = '#064e3b';
            this.bgcolor = '#065f46';
            const s = this.computeSize();
            this.size = [Math.max(230, s[0]), s[1] + 10];
        }
        Node.title = `Geometry ${kind}`;
        Node.desc  = def.desc;
        Node.portHelp = {
            inputs: {
                trigger:  `event — (re)creates the ${kind.toLowerCase()} with the current values`,
                ...Object.fromEntries(def.sizes.map(([n, , h]) => [n, h])),
                segments: def.segments[1],
                name:     'text — name of the object in the scene, overrides the widget',
                color:    'text — hex color (e.g. "aaaaaa"), overrides the widget',
                ...Object.fromEntries(def.optional.map(([n, d, h]) =>
                    [n, `(absent by default, from the right-click menu → Inputs) ${h}${d != null ? ` (default ${d})` : ''}`])),
            },
            outputs: {
                done:   'event — fired once the mesh is created',
                object: `THREE.Mesh (${kind}Geometry + MeshStandardMaterial, double-sided when open or partial), ready to be added to the scene`,
            },
        };
        Node.prototype.onGetInputs = function () {
            return OPT.filter(([n]) => this.findInputSlot(n) === -1).map(([n, t]) => [n, t, { removable: true }]);
        };
        Node.prototype.onConfigure = function () {
            for (const s of this.inputs ?? []) if (OPT.some(([n]) => n === s.name)) s.removable = true;
        };
        Node.prototype.onAction = function () {
            const _in = (name) => { const i = this.findInputSlot(name); return i === -1 ? null : this.getInputData(i); };
            const num = (x) => (x != null && x !== '' && Number.isFinite(Number(x))) ? Number(x) : null;
            const v = {};
            for (const [n, d] of def.sizes) v[n] = Math.max(0.001, num(_in(n)) ?? d);
            v.segments = Math.max(3, Math.round(num(_in('segments')) ?? num(this.properties.segments) ?? def.segments[0]));
            for (const [n, d] of def.optional) {
                const x = _in(n);
                v[n] = n === 'openEnded' ? (x != null ? !!x : d) : (num(x) ?? d);
            }
            const colorHex = String(_in('color') ?? this.properties.color ?? 'aaaaaa').replace('#', '');
            const color    = parseInt(colorHex, 16) || 0xaaaaaa;
            _reuseObj(this, def.build(v), (g) => {
                const material = new THREE.MeshStandardMaterial({ color });
                if (def.open(v)) material.side = THREE.DoubleSide;
                return new THREE.Mesh(g, material);
            }, color);
            this._obj.name = String(_in('name') ?? this.properties.name ?? kind);
            this.setOutputData(this.findOutputSlot('object'), this._obj);
            this.triggerSlot(this.findOutputSlot('done'));
        };
        LG.registerNodeType(`TJS/Geometry/${kind}Geometry`, Node);
    }
    for (const [kind, def] of Object.entries(ROUND_GEOMETRIES)) _registerRoundGeometry(kind, def);


    // ─── TJS/Geometry/LatheGeometry ─────────────────────────────────────────
    // Superficie di rivoluzione intorno all'asse Y.
    // Punti input: [{x,y}]  x=raggio (≥0), y=altezza.
    // Input connectors sovrascrivono i widget se connessi.
    function TJSGeometryLathe() {
        this.addProperty('name',      'Lathe',  'string');
        this.addProperty('color',     'aaaaaa', 'string');
        this.addProperty('segments',  12,       'number');
        this.addProperty('phiStart',  0,        'number');   // gradi
        this.addProperty('phiLength', 360,      'number');   // gradi
        this.addWidget('text',   'name',       'Lathe',   v => { this.properties.name      = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'aaaaaa',  v => { this.properties.color     = v; }, { property: 'color' });
        this.addWidget('number', 'segments',   12,   v => { this.properties.segments   = Math.max(3, Math.floor(v)); }, { property: 'segments' });
        this.addWidget('number', 'phiStart°',  0,    v => { this.properties.phiStart   = v; }, { property: 'phiStart' });
        this.addWidget('number', 'phiLength°', 360,  v => { this.properties.phiLength  = v; }, { property: 'phiLength' });
        this.addInput('trigger',   ACTION);
        this.addInput('points',     0);          // array [{x,y}]
        this.addInput('name',      'string');   // sovrascrive widget
        this.addInput('color',    'string');   // hex es. 'aaaaaa'
        this.addInput('segments',  'number');
        this.addInput('phiStart°', 'number');
        this.addInput('phiLength°','number');
        this.addOutput('done',   EVENT);
        this.addOutput('object', 'object');
        this.color   = '#064e3b';
        this.bgcolor = '#065f46';
        this.size    = [240, 260];   // fix (2026-09-19): leggero margine in più
    }
    TJSGeometryLathe.title = 'Geometry Lathe';
    TJSGeometryLathe.desc  = 'Surface of revolution around Y from {x,y} points — x=radius(≥0), y=height';
    TJSGeometryLathe.portHelp = {
        inputs: {
            trigger:     'event — (re)creates the mesh with the current values',
            points:      'array of points [{x,y}, …] — profile rotated around the Y axis: x=radius (≥0), y=height, at least 2. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            name:        'text — name of the object in the scene, overrides the widget',
            color:       'text — hex color, overrides the widget',
            segments:    'integer — segments around the axis (min 3), overrides the widget',
            'phiStart°': 'number in degrees — start angle of the revolution, overrides the widget',
            'phiLength°':'number in degrees — revolution sweep (360 = full turn), overrides the widget',
        },
        outputs: {
            done:    'event — fired once the mesh is created',
            object:  'THREE.Mesh (LatheGeometry + MeshStandardMaterial), ready to be added to the scene',
        },
    };
    TJSGeometryLathe.prototype.onAction = function () {
        const rawIn  = this.getInputData(1);
        const rawPts = _readPoints3(rawIn);
        if (!rawPts) { _pointWarn(this, 'points', rawIn); return; }
        if (rawPts.length < 2) return;
        const _in = (i, prop) => { const v = this.getInputData(i); return v != null ? v : this.properties[prop]; };
        const D2R      = Math.PI / 180;
        const colorHex = String(_in(3, 'color') ?? 'aaaaaa').replace('#', '');
        const color    = parseInt(colorHex, 16);
        const geom     = new THREE.LatheGeometry(
            rawPts.map(p => new THREE.Vector2(Math.max(0, p.x ?? p[0] ?? 0), p.y ?? p[1] ?? 0)),
            Math.max(3, Math.floor(_in(4, 'segments')  ?? 12)),
            (_in(5, 'phiStart')  ?? 0)   * D2R,
            (_in(6, 'phiLength') ?? 360) * D2R
        );
        _reuseObj(this, geom, g => new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide })), color);
        this._obj.name = String(_in(2, 'name') ?? 'Lathe');
        this.setOutputData(1, this._obj);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/LatheGeometry', TJSGeometryLathe);


    // ─── TJS/Geometry/ExtrudeGeometry ───────────────────────────────────────
    // Estrude un profilo 2D {x,y} lungo Z.  Serve min 3 punti.
    // Widget rimasti: nome, colore hex, bevel toggle.
    // depth, bevel thickness, bevel size, bevel segments solo via connettore.
    function TJSGeometryExtrude() {
        this.addProperty('name',           'Extrude', 'string');
        this.addProperty('color',          'aaaaaa',  'string');
        this.addProperty('depth',          1,         'number');
        this.addProperty('bevelEnabled',   false,     'boolean');
        this.addProperty('bevelThickness', 0.1,       'number');
        this.addProperty('bevelSize',      0.05,      'number');
        this.addProperty('bevelSegments',  3,         'number');
        this.addWidget('text',   'name',       'Extrude', v => { this.properties.name         = v; }, { property: 'name' });
        this.addWidget('text',   'color hex',  'aaaaaa',  v => { this.properties.color        = v; }, { property: 'color' });
        this.addWidget('toggle', 'bevel',      false,     v => { this.properties.bevelEnabled = v; }, { property: 'bevelEnabled' });
        this.addInput('trigger',         ACTION);
        this.addInput('points',           0);        // array [{x,y}] profilo 2D
        this.addInput('depth',           'number'); // default: prop.depth = 1
        this.addInput('name',            'string'); // sovrascrive widget
        this.addInput('color',          'string'); // hex, sovrascrive widget
        this.addInput('bevelThickness', 'number'); // default: 0.1
        this.addInput('bevelSize',      'number'); // default: 0.05
        this.addInput('bevelSegments',  'number'); // default: 3
        this.addOutput('done',   EVENT);
        this.addOutput('object', 'object');
        this.color   = '#064e3b';
        this.bgcolor = '#065f46';
        this.size    = [240, 245];
    }
    TJSGeometryExtrude.title = 'Geometry Extrude';
    TJSGeometryExtrude.desc  = 'Extrudes a 2D {x,y} profile along Z (min 3 points)';
    TJSGeometryExtrude.portHelp = {
        inputs: {
            trigger:          'event — (re)creates the mesh with the current values',
            points:           'array of points [{x,y}, …] — 2D profile to extrude, at least 3. Point format: {x,y,z}, [x,y,z], Vector3, text "x, y" or collimated points (Pick) — z ignored; not a point = console warning, ignored.',
            depth:            'number — extrusion depth along Z, overrides the widget',
            name:             'text — name of the object in the scene, overrides the widget',
            color:            'text — hex color, overrides the widget',
            bevelThickness:   'number — bevel thickness (only if bevel is on in the widget)',
            bevelSize:        'number — bevel size (only if bevel is on in the widget)',
            bevelSegments:    'integer — bevel segments (only if bevel is on in the widget)',
        },
        outputs: {
            done:    'event — fired once the mesh is created',
            object:  'THREE.Mesh (ExtrudeGeometry + MeshStandardMaterial), ready to be added to the scene',
        },
    };
    TJSGeometryExtrude.prototype.onAction = function () {
        const rawIn  = this.getInputData(1);
        const rawPts = _readPoints3(rawIn);
        if (!rawPts) { _pointWarn(this, 'points', rawIn); return; }
        if (rawPts.length < 3) return;
        const _in = (i, prop) => { const v = this.getInputData(i); return v != null ? v : this.properties[prop]; };
        const colorHex = String(_in(4, 'color') ?? 'aaaaaa').replace('#', '');
        const shape    = new THREE.Shape(rawPts.map(p => new THREE.Vector2(p.x ?? p[0] ?? 0, p.y ?? p[1] ?? 0)));
        const geom     = new THREE.ExtrudeGeometry(shape, {
            depth:          Math.max(0,    Number(_in(2, 'depth')          ?? 1)),
            bevelEnabled:   Boolean(this.properties.bevelEnabled),
            bevelThickness: Math.max(0,    Number(_in(5, 'bevelThickness') ?? 0.1)),
            bevelSize:      Math.max(0,    Number(_in(6, 'bevelSize')      ?? 0.05)),
            bevelSegments:  Math.max(1, Math.floor(_in(7, 'bevelSegments') ?? 3)),
        });
        _reuseObj(this, geom, g => new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: parseInt(colorHex, 16) })), parseInt(colorHex, 16));
        this._obj.name = String(_in(3, 'name') ?? 'Extrude');
        this.setOutputData(1, this._obj);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Geometry/ExtrudeGeometry', TJSGeometryExtrude);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Scene — aggiunta e rimozione dinamica di oggetti
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Scene/AddObject ─────────────────────────────────────────────────
    // Aggiunge un THREE.Object3D alla scena o a un oggetto padre specificato.
    // Toggle addToRoot ON  → parent = TJS_MODELS_ROOT (ricercato nella scena).
    // Toggle addToRoot OFF → parent cercato per 'percorso padre' (vuoto = scene root).
    //   percorso: "NomeGruppo" cerca ovunque nella scena; "A/B/C" naviga il percorso.
    // position: accetta {x,y,z}, THREE.Vector3 e [x,y,z].
    function TJSSceneAdd() {
        this.addProperty('addToRoot',  true, 'boolean');
        this.addProperty('parentPath', '',   'string');
        this.addWidget('toggle', 'add to ModelsRoot', true, v => { this.properties.addToRoot  = v; }, { property: 'addToRoot' });
        this.addWidget('text',   'parent path',           '',   v => { this.properties.parentPath = v; }, { property: 'parentPath' });
        this.addInput('trigger',        ACTION);
        this.addInput('object',        0); // THREE.Object3D — riferimento diretto (tipo jolly, coerente con tutti gli altri input 'oggetto' del file)
        this.addInput('position',       0);        // {x,y,z} | [x,y,z] | THREE.Vector3
        this.addInput('parentPath', 'string'); // sovrascrive widget (usato solo se toggle OFF)
        this.addOutput('done',    EVENT);
        this.addOutput('→object', 0);   // passthrough — stesso riferimento in ingresso, ora agganciato alla scena — per concatenare altri nodi senza dover ripassare da una ricerca
        this.color   = '#064e3b';   // famiglia Creazione (intensa — aggiunge un Object3D alla scena)
        this.bgcolor = '#065f46';
        this.size    = [260, 160];
    }
    TJSSceneAdd.title = 'Scene Add Object';
    TJSSceneAdd.desc  = 'Adds an object to TJS_MODELS_ROOT (toggle ON) or to a path (toggle OFF)';
    TJSSceneAdd.portHelp = {
        inputs: {
            trigger:         'event — runs the addition',
            object:          'THREE.Object3D — direct reference to add, required',
            position:        '{x,y,z} | [x,y,z] | THREE.Vector3 — position to assign before adding (optional) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
            parentPath:      'text — path like "Group/Subgroup" (used only with the "add to ModelsRoot" widget OFF), overrides the widget',
        },
        outputs: {
            done:       'event — fired once added',
            '→object':  'THREE.Object3D — the same input object, now a child of the scene (passthrough — the → symbol means it is the same reference, not new data), to chain Rename/SetTransform/SetMaterial/etc. without searching it again',
        },
    };
    TJSSceneAdd.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.scene) return;
        const obj = this.getInputData(1);
        if (!obj?.isObject3D) return;

        // Position — formato dei punti in _readPoint3 ({x,y,z}, [x,y,z], punto collimato…)
        const posIn = this.getInputData(2);
        const pos = _readPoint3(posIn);
        if (pos) obj.position.set(pos.x, pos.y, pos.z);
        else _pointWarn(this, 'position', posIn);

        // Determina il parent
        let parent = ctx.scene;
        if (this.properties.addToRoot) {
            // Toggle ON: cerca TJS_MODELS_ROOT nella scena
            ctx.scene.traverse(o => { if (o.name === 'TJS_MODELS_ROOT') parent = o; });
        } else {
            // Toggle OFF: usa percorso dal connettore o dal widget
            const pathStr = (this.getInputData(3) ?? this.properties.parentPath ?? '').trim();
            if (pathStr) {
                const parts = pathStr.split('/').filter(Boolean);
                let cur = ctx.scene;
                for (const part of parts) {
                    let found = null;
                    cur.traverse(o => { if (!found && o !== cur && o.name === part) found = o; });
                    if (!found) { cur = null; break; }
                    cur = found;
                }
                if (cur && cur !== ctx.scene) parent = cur;
            }
        }

        obj.removeFromParent?.();
        parent.add(obj);
        this.setOutputData(1, obj);
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Scene/AddObject', TJSSceneAdd);


    // ─── TJS/Scene/RemoveObject ──────────────────────────────────────────────
    // Rimuove un oggetto dalla scena per riferimento o per nome.
    function TJSSceneRemove() {
        this.addInput('trigger',  ACTION);
        this.addInput('object',  0);   // THREE.Object3D (priorità) — tipo jolly, coerente con gli altri input 'oggetto' del file
        this.addInput('name',     'string');   // fallback: ricerca per nome
        this.addOutput('done',   EVENT);
        this.color   = '#3a1a1a';   // famiglia Cancellazioni
        this.bgcolor = '#7f1d1d';
        this.size    = [230, 90];
    }
    TJSSceneRemove.title = 'Scene Remove Object';
    TJSSceneRemove.desc  = 'Removes an object from the scene by reference or by name';
    TJSSceneRemove.portHelp = {
        inputs: {
            trigger: 'event — runs the removal (cannot be undone)',
            object:  'THREE.Object3D — direct reference, takes priority over "name" if connected',
            name:    'text — name of the object in the scene, used only if "object" is not connected',
        },
        outputs: { done: 'event — fired once removed' },
    };
    TJSSceneRemove.prototype.onAction = function () {
        const ctx  = this.graph?._appContext;
        if (!ctx?.scene) return;
        const obj  = this.getInputData(1);
        const nome = this.getInputData(2);
        if (obj?.isObject3D) {
            obj.removeFromParent?.();
        } else if (nome) {
            let found = null;
            ctx.scene.traverse(o => { if (!found && o.name === nome) found = o; });
            found?.removeFromParent?.();
        }
        _ctxDirty(this);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Scene/RemoveObject', TJSSceneRemove);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Animate — animazioni lungo curve e percorsi
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Animate/AlongCurve ──────────────────────────────────────────────
    // Muove camera o oggetto nominato (input 'object') lungo una curva.
    // object='camera' → aggiorna posizione camera + orientamento.
    // object=nome     → imposta posizione world dell'oggetto (+ orientamento se
    //                    'target' è collegato).
    //
    // Orientamento — dove "guarda" mentre si muove, due modalità:
    //  - input 'target' NON collegato (default): guarda il punto successivo
    //    sulla curva → si orienta lungo la tangente al percorso (sorvolo/
    //    flythrough, guarda dove sta andando). Solo se object='camera'.
    //  - input 'target' collegato a un punto {x,y,z} fisso: guarda sempre quel
    //    punto, indipendentemente da dove si trova sulla curva — è quello che
    //    serve per un'orbita a 360° che tiene un oggetto sempre inquadrato al
    //    centro (una curva circolare centrata sull'oggetto + 'target' puntato
    //    sullo stesso centro). Aggiunto 2026-09-19.
    //
    // Nomi rinominati 2026-09-19 (era 'target'=oggetto che si muove,
    // 'guarda verso'=punto osservato — invertito, "target" si presta più
    // naturalmente a "punto osservato" in un contesto camera):
    //   vecchio 'target' (proprietà + input, oggetto in movimento) → 'object'
    //   vecchio 'guarda verso' (input, punto osservato)             → 'target'
    // Nessuna retrocompatibilità con flow salvati prima di questa rinomina
    // (proprietà E ordine degli input sono cambiati) — vedi memoria di
    // progetto no-backward-compat-unless-asked.
    function TJSAnimateAlongCurve() {
        this.addProperty('object',      'camera', 'string');
        this.addProperty('duration_ms', 3000,     'number');
        this.addProperty('loop',        false,    'boolean');
        this.addWidget('text',   'object (name / "camera")', 'camera', v => { this.properties.object      = v; }, { property: 'object' });
        this.addWidget('number', 'duration ms',              3000,     v => { this.properties.duration_ms = Math.max(1, v); }, { property: 'duration_ms' });
        this.addWidget('toggle', 'loop',                     false,    v => { this.properties.loop        = v; }, { property: 'loop' });
        this.addInput('trigger', ACTION);
        this.addInput('object',  'string');  // override proprietà — cosa si muove
        this.addInput('curve',   0);  // CatmullRomCurve3 o array [{x,y,z}, …] — vedi portHelp
        this.addInput('target',  0);  // {x,y,z} | [x,y,z] | vec3 fisso — punto osservato, sostituisce il lookAt tangente
        this.addOutput('done',        EVENT);
        this.addOutput('progress',    'number');  // 0..1 live
        this.color   = '#3a1a5a';   // famiglia Animazione (unificato con Rototranslate/ApplyTransform)
        this.bgcolor = '#6d28d9';
        this.size    = [270, 160];
        this._raf    = null;
    }
    TJSAnimateAlongCurve.title = 'Animate Along Curve';
    TJSAnimateAlongCurve.desc  = 'Animates the camera or an object along a CatmullRomCurve3 or an array of points';
    TJSAnimateAlongCurve.portHelp = {
        inputs: {
            trigger: 'event — starts the animation',
            object:  'text — "camera" (keyword, the active rendering camera) or the exact name of a scene object, overrides the widget',
            curve:   'THREE.Curve (with getPoint) or a plain array [{x,y,z}, …] linearly interpolated, required',
            target:  '{x,y,z} or [x,y,z]/vec3, fixed — point looked at for the whole animation; if not connected, it looks at the next point on the curve (tangent to the path) Point format: {x,y,z}, [x,y,z], Vector3, text "x, y, z" or collimated points (Pick); not a point = console warning, ignored.',
        },
        outputs: {
            done:       'event — fired at the end of the animation (never if loop=true)',
            progress:   'number 0..1 — live progress, updated at every frame',
        },
    };
    TJSAnimateAlongCurve.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx) return;
        const objectName  = this.getInputData(1) ?? this.properties.object ?? 'camera';
        const curve       = this.getInputData(2);
        if (!curve) {
            // FIX (2026-09-19): prima usciva qui senza dire nulla — indistinguibile
            // da "il trigger non è arrivato affatto". Causa più comune: l'input
            // 'curva' non è collegato, oppure lo era su uno slot diverso prima del
            // riordino dei parametri di questo nodo (era trigger/curva/object/target,
            // ora è trigger/object/curva/target) e serve ricollegarlo.
            console.warn(`[AlongCurve] No curve in input ("curve" input) — node "${this.title || this.type}" does nothing.`);
            return;
        }
        // Normalizzato subito in {x,y,z}: il resto della funzione lo usa così
        // (targetPoint.x/.y/.z), ma l'input ora accetta anche [x,y,z]/vec3
        // (fix 2026-09-21 — tipo di porta allargato da 'object' a jolly).
        const targetRaw    = this.getInputData(3);
        const targetPoint  = targetRaw != null ? _readPoint3(targetRaw) : null;   // {x,y,z} — formato in _readPoint3
        if (targetRaw != null && !targetPoint) _pointWarn(this, 'target', targetRaw);
        const duration    = Math.max(1, Number(this.properties.duration_ms ?? 3000));
        const loop        = Boolean(this.properties.loop);

        let target3d = null;
        if (objectName === 'camera') {
            target3d = ctx.camera;
        } else {
            ctx.scene?.traverse(o => { if (!target3d && o.name === objectName) target3d = o; });
        }
        if (!target3d) {
            // "camera" è una parola chiave letterale per la camera di rendering
            // attiva (ctx.camera) — NON è il nome mostrato nel pannello Camere
            // ("Camera principale" è solo un'etichetta UI di fallback quando
            // camera.name è vuoto, non il vero .name dell'oggetto three.js).
            // Qualsiasi altro valore viene cercato per nome esatto (scene.traverse,
            // case-sensitive) fra gli oggetti della scena — non serve passare da
            // "Scene Get Object By Name" solo per muovere l'oggetto: quel nodo
            // serve per LEGGERE una trasformazione, questo nodo risolve il nome da sé.
            console.warn(`[AlongCurve] Object "${objectName}" not found in the scene (and it is not the "camera" keyword) — node "${this.title || this.type}" does nothing.`);
            return;
        }

        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }

        const self = this;
        function getPointAt(t) {
            if (curve && typeof curve.getPoint === 'function') {
                const v = curve.getPoint(t);
                return { x: v.x, y: v.y, z: v.z };
            }
            if (Array.isArray(curve) && curve.length >= 2) {
                const raw = Math.max(0, Math.min(1, t)) * (curve.length - 1);
                const i   = Math.floor(raw);
                const f   = raw - i;
                const a   = curve[Math.min(i,   curve.length - 1)];
                const b   = curve[Math.min(i+1, curve.length - 1)];
                return { x: a.x + (b.x-a.x)*f, y: a.y + (b.y-a.y)*f, z: a.z + (b.z-a.z)*f };
            }
            return null;
        }

        function runAnim(startTime) {
            self._raf = requestAnimationFrame(function step(now) {
                const t  = Math.min((now - startTime) / duration, 1);
                const pt = getPointAt(t);
                if (pt) {
                    target3d.position.set(pt.x, pt.y, pt.z);
                    if (objectName === 'camera') _markCodeCameraMove(ctx.orbitControls);
                    if (targetPoint) {
                        target3d.lookAt(targetPoint.x, targetPoint.y, targetPoint.z);
                        if (objectName === 'camera' && ctx.orbitControls) {
                            // Risincronizza OrbitControls sulla posizione/target appena
                            // impostati — altrimenti il prossimo orbit.update() del loop
                            // di rendering (chiamato ogni frame indipendentemente da questo
                            // RAF) potrebbe interferire con l'orientamento. Stesso pattern
                            // già usato in _animateCameraTo/TJS-mainviews.mjs.
                            ctx.orbitControls.target.set(targetPoint.x, targetPoint.y, targetPoint.z);
                            try { ctx.orbitControls.update(); } catch { /* noop */ }
                        }
                    } else if (objectName === 'camera' && t < 0.999) {
                        const ptN = getPointAt(Math.min(t + 0.005, 1));
                        if (ptN) target3d.lookAt(ptN.x, ptN.y, ptN.z);
                    }
                }
                self.setOutputData(1, t);
                // AlongCurve ha un proprio RAF, fuori da onAction/onExecute — non può
                // passare da _ctxDirty(this) (che legge node.graph, qui "this" non è
                // rilevante nello stesso modo dentro la callback), quindi chiama
                // markDirty() sullo stesso _appContext direttamente. Stesso identico
                // meccanismo usato da _ctxDirty per tutti gli altri nodi, non un caso
                // speciale.
                self.graph?._appContext?.markDirty?.();
                if (t < 1) {
                    self._raf = requestAnimationFrame(step);
                } else {
                    self._raf = null;
                    if (loop) runAnim(performance.now());
                    else self.triggerSlot(0);
                }
            });
        }
        runAnim(performance.now());
    };
    TJSAnimateAlongCurve.prototype.onRemoved = function () {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    };
    LG.registerNodeType('TJS/Animate/AlongCurve', TJSAnimateAlongCurve);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Animate — rototraslazioni temporizzate con easing  (ex TJS/Anim)
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Animate/Rototranslate ────────────────────────────────────────────
    // Genera una rototraslazione animata nel tempo.
    // Ogni tick (onExecute) aggiorna gli output con la posizione/rotazione corrente.
    // 'change' (EVENT) viene emesso ogni tick → alimenta TJS/Animate/ApplyTransform.
    //
    // upDown=true  → sin(t·π): 0→1→0 in un singolo ciclo (ping-pong, no loop sinus.)
    // dumping=true → smoothstep sul tp corrente (inizio/fine morbidi)
    // stepMax>0    → quantizza t in N passi discreti
    // outputMatrix4=true → aggiunge output [16] col-major (THREE.Matrix4.fromArray)
    function TJSAnimRototranslate() {
        this.addProperty('seconds',       3,        'number');
        this.addProperty('stepMax',       30,       'number');
        this.addProperty('inputUnit',     'degrees', 'string');
        this.addProperty('outputMatrix4', false,    'boolean');
        this.addProperty('dumping',       false,    'boolean');
        this.addProperty('upDown',        false,    'boolean');
        this.addProperty('loop',          false,    'boolean');
        this.addWidget('number', 'seconds',          3,      v => { this.properties.seconds      = Math.max(0.01, v); }, { property: 'seconds' });
        // FIX (2026-09-19): mancava un widget per stepMax (unico parametro
        // numerico del nodo raggiungibile solo via input, mai da un campo
        // visibile) — probabile motivo per cui il default era stato scritto
        // dentro il NOME della porta ("step max:30"), l'unico caso in tutto
        // il file con un valore incorporato nell'etichetta. Aggiunto il
        // widget, rinominata la porta in modo pulito (vedi addInput sotto).
        this.addWidget('number', 'step max',        30,      v => { this.properties.stepMax      = Math.max(0, Math.floor(v)); }, { property: 'stepMax' });
        this.addWidget('combo',  'rotation in',     'degrees', v => { this.properties.inputUnit   = v; },
                       { values: ['degrees', 'radians'], property: 'inputUnit' });
        this.addWidget('toggle', 'output matrix4',  false,  v => { this.properties.outputMatrix4 = v; }, { property: 'outputMatrix4' });
        this.addWidget('toggle', 'dumping',          false,  v => { this.properties.dumping       = v; }, { property: 'dumping' });
        this.addWidget('toggle', 'up-down',          false,  v => { this.properties.upDown        = v; }, { property: 'upDown' });
        this.addWidget('toggle', 'loop',             false,  v => { this.properties.loop          = v; }, { property: 'loop' });
        this.addInput('trigger',     ACTION);
        this.addInput('seconds',     'number');
        this.addInput('stepMax',    'number');   // numero TOTALE di passi discreti sull'intero ciclo, non "al secondo"
        this.addInput('translation', 0);   // {x,y,z} | [x,y,z] | vec3, in metri
        this.addInput('rotation',   0);   // {x,y,z} | [x,y,z] | vec3, in gradi o radianti
        this.addInput('dumping',     'boolean');
        this.addInput('upDown',     'boolean');
        this.addInput('loop',        'boolean');
        this.addOutput('change',  EVENT);
        this.addOutput('matrix', 'object');      // {position:{x,y,z}, euler:{x,y,z}rad, progress:0..1}
        this.addOutput('matrix4', 'array');       // [16] col-major THREE.Matrix4 (se outputMatrix4=ON)
        this.color      = '#3a1a5a';
        this.bgcolor    = '#6d28d9';
        this.size       = [265, 335];   // +1 widget (step max) — margine ricalcolato
        this._startTime = null;
        this._playing   = false;
    }
    TJSAnimRototranslate.title = 'Anim Rototranslate';
    TJSAnimRototranslate.desc  = 'Timed rototranslation: ping-pong, dumping, loop';
    TJSAnimRototranslate.portHelp = {
        inputs: {
            trigger:        'event — starts the animation',
            seconds:        'number — duration of one cycle, overrides the widget',
            stepMax:        'integer — NOT "steps per second": it is the TOTAL number of discrete positions over the whole cycle (default 30). If >0 the movement jumps in steps instead of being continuous; if 0, no quantization (smooth movement)',
            translation:    '{x,y,z} or [x,y,z]/vec3, in meters — total displacement at the end of the cycle (t=1)',
            rotation:       '{x,y,z} or [x,y,z]/vec3 — total rotation at the end of the cycle, in degrees or radians according to the "rotation in" widget',
            dumping:        'boolean — smoothstep on start/end for a softer movement, overrides the widget',
            upDown:         'boolean — ping-pong (0→1→0 in one cycle) instead of linear 0→1, overrides the widget',
            loop:           'boolean — starts over instead of stopping at t=1, overrides the widget',
        },
        outputs: {
            change:  'event — fired at EVERY tick (not only at the end of the cycle), meant to drive TJS/Animate/ApplyTransform',
            matrix:  '{position:{x,y,z}, euler:{x,y,z} in radians, progress:0..1} — current state of the cycle',
            matrix4: 'array of 16 numbers (THREE.Matrix4 col-major) — present only if the "output matrix4" widget is on',
        },
    };

    TJSAnimRototranslate.prototype.onAction = function () {
        this._startTime = performance.now();
        this._playing   = true;
    };

    TJSAnimRototranslate.prototype.onExecute = function () {
        if (!this._playing || this._startTime === null) return;

        const secondi = Math.max(0.01, Number(this.getInputData(1) ?? this.properties.seconds));
        const stepMax = Math.max(0, Math.floor(Number(this.getInputData(2) ?? this.properties.stepMax ?? 30)));
        const tras    = this.getInputData(3) ?? { x: 0, y: 0, z: 0 };
        const rot     = this.getInputData(4) ?? { x: 0, y: 0, z: 0 };
        const dumping = Boolean(this.getInputData(5) ?? this.properties.dumping);
        const upDown  = Boolean(this.getInputData(6) ?? this.properties.upDown);
        const loop    = Boolean(this.getInputData(7) ?? this.properties.loop);
        const D2R     = (this.properties.inputUnit ?? 'degrees') === 'degrees' ? Math.PI / 180 : 1;

        const elapsed = performance.now() - this._startTime;
        let t = Math.min(elapsed / (secondi * 1000), 1);

        // Quantize a step
        if (stepMax > 0) t = Math.floor(t * stepMax) / stepMax;

        // Ping-pong: 0→1→0 in un ciclo (no sinusoide continua)
        let tp = upDown ? Math.sin(t * Math.PI) : t;

        // Smoothstep (dumping): inizio e fine graduali
        if (dumping) tp = tp * tp * (3 - 2 * tp);

        const position = {
            x: (tras.x ?? tras[0] ?? 0) * tp,
            y: (tras.y ?? tras[1] ?? 0) * tp,
            z: (tras.z ?? tras[2] ?? 0) * tp,
        };
        const euler = {
            x: (rot.x ?? rot[0] ?? 0) * D2R * tp,
            y: (rot.y ?? rot[1] ?? 0) * D2R * tp,
            z: (rot.z ?? rot[2] ?? 0) * D2R * tp,
        };

        this.setOutputData(1, { position, euler, progress: t });

        if (this.properties.outputMatrix4) {
            // Matrice R = Rx·Ry·Rz → col-major (THREE.Matrix4 convention)
            const rx = euler.x, ry = euler.y, rz = euler.z;
            const cx = Math.cos(rx), sx = Math.sin(rx);
            const cy = Math.cos(ry), sy = Math.sin(ry);
            const cz = Math.cos(rz), sz = Math.sin(rz);
            this.setOutputData(2, [
                cy*cz,              cy*sz,              -sy,    0,
                sx*sy*cz - cx*sz,   sx*sy*sz + cx*cz,   sx*cy, 0,
                cx*sy*cz + sx*sz,   cx*sy*sz - sx*cz,   cx*cy, 0,
                position.x,         position.y,         position.z, 1,
            ]);
        }

        _ctxDirty(this);         // segnala che questo tick produce output visivi
        this.triggerSlot(0);   // 'change' EVENT — attiva ApplyTransform a valle

        if (t >= 1) {
            if (loop) {
                this._startTime = performance.now();
            } else {
                this._playing = false;
            }
        }
    };

    TJSAnimRototranslate.prototype.onRemoved = function () {
        this._playing = false;
    };

    LG.registerNodeType('TJS/Animate/Rototranslate', TJSAnimRototranslate);


    // ─── TJS/Animate/ApplyTransform ───────────────────────────────────────────
    // Applica la matrice {position,euler,progress} di Rototranslate a oggetti
    // della scena. Gli oggetti si muovono relativamente alla loro posizione/
    // rotazione originale (catturate al primo trigger o all'azione 'reset').
    //
    // Inputs:
    //   trigger  (ACTION) — applica la trasformazione corrente
    //   reset    (ACTION) — ri-cattura le origini (utile dopo aver spostato a mano)
    //   oggetti  (wildcard) — stringa di nomi (virgola), array, o Object3D diretto
    //   matrice  (object) — {position,euler,progress} da Rototranslate
    function TJSAnimApplyTransform() {
        this.addProperty('names', '', 'string');
        this.addWidget('text', 'object names (comma)', '', v => { this.properties.names = v; }, { property: 'names' });
        this.addInput('trigger',  ACTION);
        this.addInput('reset',    ACTION);
        this.addInput('objects',  0);            // wildcard
        this.addInput('matrix',  'object');     // {position,euler,progress}
        this.addOutput('done',   EVENT);
        this.color    = '#3a1a5a';
        this.bgcolor  = '#6d28d9';
        this.size     = [265, 145];
        this._origins = new Map();   // uuid → {obj, pos:Vector3, quat:Quaternion}
    }
    TJSAnimApplyTransform.title = 'Anim Apply Transform';
    TJSAnimApplyTransform.desc  = 'Applies a rototranslation delta to objects; reset captures the origins again';
    TJSAnimApplyTransform.portHelp = {
        inputs: {
            trigger: 'event — applies the current transform (typically from Rototranslate/change)',
            reset:   'event — captures the origin positions/rotations again (use it after moving the objects by hand)',
            objects: 'string of comma-separated names, array of names, or a direct Object3D — if not connected the widget is used',
            matrix:  '{position:{x,y,z}, euler:{x,y,z} in radians} — delta from Rototranslate, required for the trigger',
        },
        outputs: { done: 'event — fired once applied' },
    };

    TJSAnimApplyTransform.prototype._resolveObjects = function () {
        const ctx   = this.graph?._appContext;
        if (!ctx?.scene) return [];
        const input = this.getInputData(2);
        if (input?.isObject3D) return [input];
        const names = [];
        if (typeof input === 'string') {
            names.push(...input.split(',').map(s => s.trim()).filter(Boolean));
        } else if (Array.isArray(input)) {
            const direct = input.filter(o => o?.isObject3D);
            if (direct.length > 0) return direct;
            for (const item of input) {
                if (typeof item === 'string') names.push(item.trim());
            }
        }
        if (names.length === 0) {
            const prop = this.properties.names ?? '';
            names.push(...prop.split(',').map(s => s.trim()).filter(Boolean));
        }
        const objs = [];
        for (const nm of names) {
            ctx.scene.traverse(o => { if (o.name === nm) objs.push(o); });
        }
        return objs;
    };

    TJSAnimApplyTransform.prototype._captureOrigins = function (objs) {
        for (const obj of objs) {
            if (!this._origins.has(obj.uuid)) {
                // Log una tantum per oggetto (non ad ogni frame) — dice ESATTAMENTE
                // cosa il nodo pensa di aver trovato, incluso se è ancora agganciato
                // alla scena (obj.parent) — un oggetto con parent=null è stato
                // rimosso/sostituito ma il riferimento qui resta "vivo": la
                // trasformazione verrebbe applicata a un oggetto ormai invisibile.
                console.log(`[ApplyTransform] origin captured for "${obj.name || '(no name)'}" (uuid ${obj.uuid.slice(0, 8)}…, type ${obj.type}, attached to the scene: ${!!obj.parent})`);
                this._origins.set(obj.uuid, {
                    obj,
                    pos:  new THREE.Vector3().copy(obj.position),
                    quat: new THREE.Quaternion().copy(obj.quaternion),
                });
            }
        }
    };

    TJSAnimApplyTransform.prototype.onAction = function (action) {
        // FIX (2026-09-19): due punti in cui il nodo restava silenziosamente
        // inerte (nessun errore, nessun movimento) — segnalati esplicitamente:
        //  1. "oggetti" risolto a zero oggetti (nome sbagliato/non in scena) →
        //     _origins non riceve mai nulla → il for più sotto non itera mai.
        //  2. 'change' di Rototranslate collegato per errore su 'reset' invece
        //     che su 'trigger' (stesso tipo ACTION, facile scambiarli) → il
        //     nodo cattura solo l'origine e ritorna, non applica mai la matrice.
        const objs = this._resolveObjects();
        if (action === 'reset') {
            console.log(`[ApplyTransform] "reset" action received (${objs.length} objects) — if you expected a movement, check that the upstream EVENT output is connected to "trigger", not to "reset".`);
            this._origins.clear();
            this._captureOrigins(objs);
            return;
        }
        // trigger (o evento da Rototranslate)
        if (objs.length === 0) {
            console.warn('[ApplyTransform] "objects" did not resolve any object in the scene (empty or wrong name, or the object does not have that exact .name) — no transform will be applied.');
        }
        this._captureOrigins(objs);   // lazy: cattura solo gli oggetti nuovi
        const mat = this.getInputData(3);
        if (!mat) return;
        const dp = mat.position ?? { x: 0, y: 0, z: 0 };
        const de = mat.euler    ?? { x: 0, y: 0, z: 0 };
        const deltaQuat = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(de.x ?? 0, de.y ?? 0, de.z ?? 0, 'XYZ')
        );
        // Solo gli oggetti risolti ORA: _origins è una cache delle origini, non
        // l'elenco dei bersagli — altrimenti, con "oggetti" pilotato dalla
        // selezione, continuerebbero a muoversi anche quelli selezionati prima.
        for (const o of objs) {
            const orig = this._origins.get(o.uuid);
            if (!orig) continue;
            const { obj, pos, quat } = orig;
            obj.position.set(
                pos.x + (dp.x ?? 0),
                pos.y + (dp.y ?? 0),
                pos.z + (dp.z ?? 0)
            );
            // Applica rotazione delta sopra al quaternion originale
            obj.quaternion.copy(quat).premultiply(deltaQuat);
        }
        _ctxDirty(this);
        this.triggerSlot(0);
    };

    TJSAnimApplyTransform.prototype.onRemoved = function () {
        this._origins.clear();
    };

    LG.registerNodeType('TJS/Animate/ApplyTransform', TJSAnimApplyTransform);


    // ═══════════════════════════════════════════════════════════════════════════
    // TJS/Align — allineamento panorama sferico a nuvola di punti
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── TJS/Align/SphereToCloud ─────────────────────────────────────────────
    // Data N≥3 coppie di punti corrispondenti:
    //   puntiNuvola  → coordinate assolute world (da TJS/Pick/GetAll o simile)
    //   puntiSfera   → punti sulla superficie della sfera in coordinate LOCALI
    //                  (hit.point sul mesh della sfera, che è all'origine)
    //
    // Calcola la posizione C e la rotazione R della sfera in world-space con
    // l'algoritmo di ottimizzazione alternata:
    //   1. Kabsch (SVD 3x3) → R che mappa le direzioni sfera→nuvola
    //   2. Least-squares intersection delle rette → aggiorna C
    //   ripete fino a convergenza (default 20 iterazioni)
    //
    // Output:
    //   matrix4       → 16 float col-major (THREE.Matrix4.fromArray) con R + C
    //   posizione     → {x,y,z} centro sfera in world
    //   rotazione     → {x,y,z} euler XYZ radianti (= mesh.rotation.set)
    //   transformation→ {posizione:[x,y,z], rotazione:[rx,ry,rz]} → mod_spec
    //   erroreRMS     → gradi angolari (qualità allineamento; <1° = ottimo)
    function TJSAlignSphereToCloud() {
        this.addProperty('maxIter', 20, 'number');
        this.addWidget('number', 'max iterations', 20,
            v => { this.properties.maxIter = Math.max(5, Math.floor(v)); }, { property: 'maxIter' });
        this.addInput('trigger',       ACTION);
        this.addInput('cloudPoints',   'array');    // [{x,y,z}] world
        this.addInput('spherePoints',    'array');    // [{x,y,z}] locale (sfera all'origine)
        this.addOutput('done',        EVENT);      // prima uscita (convenzione, 2026-10-04)
        this.addOutput('matrix4',      'array');    // 16 float col-major (THREE.Matrix4)
        this.addOutput('position',    'object');   // {x,y,z}
        this.addOutput('rotation',    'object');   // {x,y,z} euler XYZ rad
        this.addOutput('transformation','object');  // {posizione:[...], rotazione:[...]}
        this.addOutput('rmsError',    'number');   // gradi
        this.color   = '#1e3a5f';
        this.bgcolor = '#1e40af';
        this.size    = [270, 185];
    }
    TJSAlignSphereToCloud.title = 'Align Sphere to Cloud';
    TJSAlignSphereToCloud.desc  =
        'Computes position and orientation of the panoramic sphere relative to the point cloud (iterative Kabsch, ≥3 points)';
    TJSAlignSphereToCloud.portHelp = {
        inputs: {
            trigger:     'event — starts the computation. Mind the order: it must arrive AFTER the two arrays have been updated (e.g. from the done of Pick Get All or the trigger of the App Bus Receiver)',
            cloudPoints: 'array of {x,y,z} points in WORLD coordinates (e.g. from TJS/Pick/GetAll) — at least 3, same order as spherePoints',
            spherePoints: 'array of {x,y,z} points in coordinates LOCAL to the sphere (sphere at the origin) — at least 3, same order as cloudPoints. Arrays only: an array coming from the App Bus (App Bus Receiver) is wrapped in { value: [...] } and must be extracted first with Params/Object/Get Property, property "value" (also for cloudPoints)',
        },
        outputs: {
            matrix4:        'array of 16 numbers (THREE.Matrix4 col-major) — rotation + position combined',
            position:       '{x,y,z} — center of the sphere in world space',
            rotation:       '{x,y,z} — euler XYZ in RADIANS (compatible with mesh.rotation.set)',
            transformation: '{posizione:[x,y,z], rotazione:[rx,ry,rz]} — same result in the format ready for mod_spec',
            rmsError:       'number in degrees — alignment quality (<1° is considered excellent)',
            done:           'event — fired once the computation is complete',
        },
    };
    TJSAlignSphereToCloud.prototype.onAction = function () {
        // Nodo "rigido" (scelta esplicita, 2026-10-04): accetta solo array. Un array
        // passato sull'App Bus arriva incapsulato ({ objId, sourceApp, value: [...] },
        // vedi App Bus Emitter): va estratto nel flow con Params/Object/Get Property
        // ('value'). Prima un input non valido faceva uscire il nodo SENZA alcun
        // messaggio; ora lo dice in console.
        const cloudPts  = this.getInputData(1);
        const spherePts = this.getInputData(2);
        const bad = [['cloudPoints', cloudPts], ['spherePoints', spherePts]].filter(([, v]) => !Array.isArray(v));
        if (bad.length) {
            for (const [name, v] of bad) {
                const hint = v && typeof v === 'object' && Array.isArray(v.value)
                    ? " — it looks like an array coming from the App Bus: extract it with Params/Object/Get Property, property 'value'"
                    : '';
                console.warn(`[TJS/Align/SphereToCloud] '${name}' is not an array${hint}.`, v);
            }
            return;
        }
        if (cloudPts.length !== spherePts.length) {
            console.warn(`[TJS/Align/SphereToCloud] different number of points: cloud ${cloudPts.length}, sphere ${spherePts.length} — using only the first ${Math.min(cloudPts.length, spherePts.length)} pairs, in order`);
        }
        const n = Math.min(cloudPts.length, spherePts.length);
        if (n < 3) {
            console.warn('[TJS/Align/SphereToCloud] at least 3 pairs are needed (found:', n, ')');
            return;
        }
        const result = _alignSphereToCloud(cloudPts, spherePts, this.properties.maxIter ?? 20);
        if (!result) return;
        // uscite per nome (2026-10-04): l'ordine delle porte cambia tra nodi nuovi e salvati
        _out(this, 'matrix4',        result.matrix4);
        _out(this, 'position',      result.position);
        _out(this, 'rotation',      result.rotation);
        _out(this, 'transformation', result.transformation);
        _out(this, 'rmsError',      result.rmsErrorDeg);
        _fire(this, 'done');
    };
    LG.registerNodeType('TJS/Align/SphereToCloud', TJSAlignSphereToCloud);
}

// ─── Helper: percorso di un Object3D da 'base' (esclusa) a sé stesso ─────────
// Array di nomi, un elemento per livello di gerarchia — usato dal matching
// dei filtri nome/percorso (TJS/Scene/NameFilter + GetObjectNames).
function _pathFromBase(obj, base) {
    const parts = [];
    let cur = obj;
    while (cur && cur !== base) {
        parts.unshift(cur.name || '');
        cur = cur.parent;
    }
    return parts;
}

// ─── Helper: converte un singolo segmento glob (wildcard '*' e '?') in RegExp ─
function _globToRegExp(segment) {
    const escaped = segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp('^' + escaped + '$');
}

// ─── Helper: un pattern contro nome/percorso di un oggetto ───────────────────
// Senza '\' nel pattern → match sul solo nome (leaf), a qualunque profondità.
// Con '\' → match sul percorso completo da 'base', un segmento per livello
// (richiede la stessa identica profondità del pattern).
function _matchesNamePattern(pattern, name, path) {
    if (!pattern) return false;
    if (pattern.includes('\\')) {
        const segs = pattern.split('\\');
        if (segs.length !== path.length) return false;
        return segs.every((seg, i) => _globToRegExp(seg).test(path[i]));
    }
    return _globToRegExp(pattern).test(name);
}

// ─── Helper: un descrittore filtro {patterns[], operator} contro un oggetto ──
function _matchesNameFilter(filter, name, path) {
    if (!filter || !Array.isArray(filter.patterns) || filter.patterns.length === 0) return false;
    const hits = filter.patterns.map(p => _matchesNamePattern(p, name, path));
    return filter.operator === 'AND' ? hits.every(Boolean) : hits.some(Boolean);
}

// ─── Helper: trova un materiale per nome in tutta la scena ───────────────────
// Cerca tra i materiali di ogni Mesh (anche array multi-materiale) il primo
// con .name === name — usato da TJS/Object/MergeChildMeshes per assegnare un
// materiale esistente per nome invece del fallback automatico.
function _findMaterialByName(scene, name) {
    let found = null;
    scene.traverse(obj => {
        if (found || !obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
            if (m?.name === name) { found = m; break; }
        }
    });
    return found;
}

// ─── Helper: trova o crea una luce per nome nella scena ──────────────────────
// Cerca una luce isLight con il nome indicato in TUTTA la scena (non solo
// sotto 'parent' — una luce esistente non viene mai ri-spostata, 'parent'
// vale solo per il posizionamento alla PRIMA creazione, vedi
// _resolveLightParent). Se non esiste la crea con LightClass e i
// costructor args forniti.
function _findOrCreateLight(scene, name, parent, LightClass, ...args) {
    let light = null;
    scene.traverse(obj => { if (!light && obj.isLight && obj.name === name) light = obj; });
    if (!light) {
        light      = new LightClass(...args);
        light.name = name;
        (parent ?? scene).add(light);
    }
    return light;
}

// ─── Helper: risolve il parent per la creazione di una luce (2026-09-22) ─────
// Pin opzionale 'path' (RMB → Inputs, come i pin extra dei Material Set*)
// su tutti i nodi Light Set* che creano (non su SetShadow, che modifica solo
// una luce esistente). Comportamento a 3 stati, deciso con l'utente:
//  - pin ASSENTE                    → TJS_LIGHTS_ROOT (default, persistibile
//                                      via un futuro nodo Light/Save dedicato,
//                                      MAI in automatico da questi nodi)
//  - pin presente ma NON collegato  → scena radice (effimero, come le
//                                      due luci preesistenti di default)
//  - pin presente e collegato a un percorso → naviga da 'scene' un
//    segmento per livello, stesso formato '\' di NameFilter/GetObjectByName
//    (non '/' come in TJS/Scene/AddObject — quella è l'unica eccezione nel
//    file, qui si segue la convenzione dominante); path non trovato →
//    fallback su TJS_LIGHTS_ROOT con warning in console, mai un errore silente.
function _resolveLightParent(node, ctx) {
    const findLightsRoot = () => {
        let root = null;
        ctx.scene.traverse(o => { if (!root && o.name === 'TJS_LIGHTS_ROOT') root = o; });
        return root ?? ctx.scene;
    };
    const slot = node.findInputSlot('path');
    if (slot === -1) return findLightsRoot();

    const pathStr = node.getInputData(slot);
    if (!pathStr) return ctx.scene;   // pin presente ma scollegato → scena radice

    const parts = String(pathStr).split('\\').filter(Boolean);
    let cur = ctx.scene;
    for (const part of parts) {
        let found = null;
        cur.traverse(o => { if (!found && o !== cur && o.name === part) found = o; });
        if (!found) { cur = null; break; }
        cur = found;
    }
    if (cur) return cur;
    console.warn('[TJS/Light] path not found, falling back to TJS_LIGHTS_ROOT:', pathStr);
    return findLightsRoot();
}

// ─── Helper: risolve la luce su cui opera un nodo Light Set* (2026-09-22) ────
// Riferimento diretto ('oggetto', input FISSO a indice 1, priorità — NESSUNA
// ricerca/creazione se collegato a una luce valida) oppure nome (fallback:
// cerca-o-crea via _resolveLightParent/_findOrCreateLight, comportamento
// idempotente pre-esistente). In entrambi i casi adotta la luce nel Light
// Manager (adopt() è già idempotente, non tocca mai isPreExisting).
function _resolveLightRef(node, ctx, name, LightClass, ...args) {
    let light = node.getInputData(1);
    if (!light?.isLight) {
        const parent = _resolveLightParent(node, ctx);
        light = _findOrCreateLight(ctx.scene, name, parent, LightClass, ...args);
    }
    ctx.lightManager?.adopt(light);
    return light;
}

// ─── Helper: imposta il target di una luce con .target (Directional/Spot) ────
// .target è un Object3D separato (default origine) che determina la
// direzione del fascio: deve stare nel grafo della scena perché la sua
// matrixWorld si aggiorni, cosa che _findOrCreateLight (generico per tutti
// i tipi di luce, molti dei quali non hanno .target) non fa mai.
function _applyLightTarget(scene, light, tgt) {
    if (!light.target || tgt == null) return;
    const p = _readPoint3(tgt);
    if (!p) { console.warn('[TJS/Light] input "target": not a point — expected {x,y,z}, [x,y,z] or a collimated point. Received:', tgt); return; }
    if (light.target.parent !== scene) scene.add(light.target);
    light.target.position.set(p.x, p.y, p.z);
}

// ─── Helper: posizione world di un Object3D ───────────────────────────────────
// THREE.Vector3.getWorldPosition(target) internamente chiama
// target.setFromMatrixPosition(this.matrixWorld), che legge elements[12/13/14].
// Costruiamo un proxy minimale compatibile invece di importare THREE.
function _getWorldPosition(obj) {
    try {
        if (typeof obj.getWorldPosition === 'function') {
            const proxy = {
                x: 0, y: 0, z: 0,
                setFromMatrixPosition(m) {
                    this.x = m.elements[12];
                    this.y = m.elements[13];
                    this.z = m.elements[14];
                    return this;
                },
            };
            obj.getWorldPosition(proxy);
            return { x: proxy.x, y: proxy.y, z: proxy.z };
        }
    } catch { /* noop */ }
    // Fallback: posizione locale (senza trasformazioni parent)
    return { x: obj.position.x, y: obj.position.y, z: obj.position.z };
}

// ─── Helper animazione camera ─────────────────────────────────────────────────
// Interpolazione lineare easeInOut da posizione corrente a destinazione.
// ─── Movimenti della camera fatti dai nodi ───────────────────────────────
// (2026-10-12) OnCameraSettled deve distinguere l'utente dai nodi: OrbitControls emette lo
// stesso 'change' in entrambi i casi. I nodi che muovono la camera segnano l'istante
// sull'OrbitControls; un 'change' entro CODE_MOVE_MS da quel segno è "del codice" (comprende
// l'update() del render loop subito dopo, quando il nodo non lo chiama da sé).
const CODE_MOVE_MS = 120;
function _markCodeCameraMove(orbit) {
    if (orbit) orbit._tjsCodeMoveAt = performance.now();
}
function _isCodeCameraMove(orbit) {
    return !!orbit?._tjsCodeMoveAt && performance.now() - orbit._tjsCodeMoveAt < CODE_MOVE_MS;
}

function _animateCameraTo(camera, orbit, pos, target, durationMs) {
    if (!camera) return;
    const startPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const endPos   = { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0 };
    const startTgt = orbit ? { x: orbit.target.x, y: orbit.target.y, z: orbit.target.z } : { x: 0, y: 0, z: 0 };
    const endTgt   = target ? { x: target.x ?? 0, y: target.y ?? 0, z: target.z ?? 0 } : startTgt;
    const t0 = performance.now();
    const dur = Math.max(durationMs, 1);

    function lerp(a, b, t) { return a + (b - a) * t; }
    function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

    function step(now) {
        // tra 0 e 1: l'istante del frame (rAF) può precedere performance.now() della chiamata (2026-10-19)
        const raw  = Math.min(Math.max((now - t0) / dur, 0), 1);
        const ease = easeInOut(raw);

        camera.position.x = lerp(startPos.x, endPos.x, ease);
        camera.position.y = lerp(startPos.y, endPos.y, ease);
        camera.position.z = lerp(startPos.z, endPos.z, ease);

        _markCodeCameraMove(orbit);
        if (orbit) {
            orbit.target.x = lerp(startTgt.x, endTgt.x, ease);
            orbit.target.y = lerp(startTgt.y, endTgt.y, ease);
            orbit.target.z = lerp(startTgt.z, endTgt.z, ease);
            try { orbit.update(); } catch { /* noop */ }
        }

        if (raw < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}


// ═══════════════════════════════════════════════════════════════════════════
// Helper matematici per TJS/Align/SphereToCloud
// Algebra lineare 3×3 in pure JS (no dipendenze esterne).
// Convenzione: matrici row-major, vettori array [x,y,z].
// ═══════════════════════════════════════════════════════════════════════════

/** Prodotto matriciale 3×3 (row-major): C = A·B */
function _m3mul(A, B) {
    const C = new Array(9).fill(0);
    for (let i = 0; i < 3; i++)
        for (let k = 0; k < 3; k++) {
            if (A[i*3+k] === 0) continue;
            for (let j = 0; j < 3; j++) C[i*3+j] += A[i*3+k] * B[k*3+j];
        }
    return C;
}

/** Trasposta 3×3 (row-major) */
function _m3T(A) {
    return [A[0],A[3],A[6], A[1],A[4],A[7], A[2],A[5],A[8]];
}

/** Determinante 3×3 (row-major) */
function _m3det(A) {
    return A[0]*(A[4]*A[8]-A[5]*A[7]) - A[1]*(A[3]*A[8]-A[5]*A[6]) + A[2]*(A[3]*A[7]-A[4]*A[6]);
}

/**
 * Risolve il sistema lineare 3×3  A·x = b
 * con eliminazione gaussiana e pivot parziale.
 * Restituisce [x0, x1, x2].
 */
function _solve3(A, b) {
    const M = [
        [A[0], A[1], A[2], b[0]],
        [A[3], A[4], A[5], b[1]],
        [A[6], A[7], A[8], b[2]],
    ];
    for (let c = 0; c < 3; c++) {
        let mp = c;
        for (let r = c+1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[mp][c])) mp = r;
        [M[c], M[mp]] = [M[mp], M[c]];
        for (let r = c+1; r < 3; r++) {
            if (Math.abs(M[c][c]) < 1e-14) continue;
            const f = M[r][c] / M[c][c];
            for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
        }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
        if (Math.abs(M[i][i]) < 1e-14) continue;
        x[i] = M[i][3] / M[i][i];
        for (let k = i-1; k >= 0; k--) M[k][3] -= M[k][i] * x[i];
    }
    return x;
}

/**
 * Decomposizione spettrale di una matrice simmetrica 3×3 (row-major)
 * tramite iterazioni di Jacobi.
 * Restituisce { V, eigs } dove V ha gli autovettori come colonne (row-major)
 * ed eigs è l'array dei relativi autovalori.
 */
function _symeig3(A) {
    let a = [...A];
    let V = [1,0,0, 0,1,0, 0,0,1];  // accumulatore di rotazioni
    for (let iter = 0; iter < 60; iter++) {
        // Trova l'elemento fuori diagonale di valore massimo
        let p = 0, q = 1, mx = Math.abs(a[1]);
        if (Math.abs(a[2]) > mx) { mx = Math.abs(a[2]); p = 0; q = 2; }
        if (Math.abs(a[5]) > mx) { mx = Math.abs(a[5]); p = 1; q = 2; }
        if (mx < 1e-14) break;
        // Rotazione di Jacobi
        const apq = a[p*3+q], app = a[p*3+p], aqq = a[q*3+q];
        const tau = (aqq - app) / (2 * apq);
        const t   = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau*tau));
        const c   = 1 / Math.sqrt(1 + t*t), s = t * c;
        // Aggiorna a
        const na = [...a];
        na[p*3+p] = app - t*apq;  na[q*3+q] = aqq + t*apq;
        na[p*3+q] = na[q*3+p] = 0;
        for (let r = 0; r < 3; r++) {
            if (r === p || r === q) continue;
            na[r*3+p] = na[p*3+r] = c*a[r*3+p] - s*a[r*3+q];
            na[r*3+q] = na[q*3+r] = s*a[r*3+p] + c*a[r*3+q];
        }
        a = na;
        // Aggiorna V
        for (let r = 0; r < 3; r++) {
            const vp = V[r*3+p], vq = V[r*3+q];
            V[r*3+p] = c*vp - s*vq;
            V[r*3+q] = s*vp + c*vq;
        }
    }
    return { V, eigs: [a[0], a[4], a[8]] };
}

/**
 * Algoritmo di Kabsch: trova la rotazione R che minimizza Σ|dst_i − R·src_i|²
 * tramite SVD della matrice di cross-covarianza H = Σ src_i · dst_iᵀ.
 * src, dst: array di [x,y,z] normalizzati.
 * Restituisce R come matrice 3×3 row-major.
 */
function _kabsch(src, dst) {
    // H = Σ src·dst^T  (3×3 row-major)
    const H = new Array(9).fill(0);
    for (let i = 0; i < src.length; i++) {
        const s = src[i], d = dst[i];
        for (let r = 0; r < 3; r++)
            for (let c = 0; c < 3; c++) H[r*3+c] += s[r] * d[c];
    }
    // SVD via eigen-decomposizione di HᵀH = V·S²·Vᵀ
    const HtH = _m3mul(_m3T(H), H);
    const { V, eigs } = _symeig3(HtH);
    // Ordina le colonne di V per autovalore decrescente
    const ord = [0,1,2].sort((a,b) => eigs[b] - eigs[a]);
    const Vs  = new Array(9);
    for (let j = 0; j < 3; j++) for (let r = 0; r < 3; r++) Vs[r*3+j] = V[r*3+ord[j]];
    // U_j = H·V_j / σ_j  (σ_j = sqrt(autovalore))
    const S = ord.map(i => Math.sqrt(Math.max(0, eigs[i])));
    const U = new Array(9).fill(0);
    for (let j = 0; j < 3; j++) {
        if (S[j] < 1e-10) continue;
        for (let i = 0; i < 3; i++) {
            let sum = 0;
            for (let k = 0; k < 3; k++) sum += H[i*3+k] * Vs[k*3+j];
            U[i*3+j] = sum / S[j];
        }
    }
    // R = V·Uᵀ
    let R = _m3mul(Vs, _m3T(U));
    // Correzione riflessione: se det(R)<0 cambia segno all'ultima colonna di V
    if (_m3det(R) < 0) {
        for (let r = 0; r < 3; r++) Vs[r*3+2] *= -1;
        R = _m3mul(Vs, _m3T(U));
    }
    return R;
}

/**
 * Trova il punto C più vicino a N rette {P_i, direzione r_i}.
 * Risolve il sistema lineare [Σ(I−rᵢrᵢᵀ)]·C = [Σ(I−rᵢrᵢᵀ)·Pᵢ].
 * Ps: array di [x,y,z];  Rs: array di [x,y,z] normalizzati.
 */
function _closestToLines(Ps, Rs) {
    const A = new Array(9).fill(0), b = [0, 0, 0];
    for (let i = 0; i < Ps.length; i++) {
        const r = Rs[i], p = Ps[i];
        // Proiettore Πᵢ = I − r·rᵀ  (row-major 3×3)
        const Pi = [
            1-r[0]*r[0], -r[0]*r[1], -r[0]*r[2],
           -r[1]*r[0],  1-r[1]*r[1], -r[1]*r[2],
           -r[2]*r[0],  -r[2]*r[1],  1-r[2]*r[2],
        ];
        for (let j = 0; j < 9; j++) A[j] += Pi[j];
        for (let j = 0; j < 3; j++) {
            let s = 0;
            for (let k = 0; k < 3; k++) s += Pi[j*3+k] * p[k];
            b[j] += s;
        }
    }
    return _solve3(A, b);
}

/**
 * Algoritmo principale di allineamento sfera→nuvola.
 *
 * cloudPts  [{x,y,z}]: punti in world-space (nuvola)
 * spherePts [{x,y,z}]: punti sulla superficie della sfera (locale; sfera all'origine)
 *
 * Iterazione alternata (convergenza tipica in 5–15 passi):
 *   1. Normalizza i punti sfera → direzioni unitarie d_i
 *   2. Calcola direzioni osservate q_i = (P_i − C) / |P_i − C|
 *   3. Kabsch: R che mappa d_i → q_i
 *   4. Aggiorna C come punto più vicino alle rette {P_i, R·d_i}
 *
 * Restituisce:
 *   matrix4       [16 float col-major]  → THREE.Matrix4.fromArray(...)
 *   position      {x,y,z}              → mesh.position.set(...)
 *   rotation      {x,y,z}              → mesh.rotation.set(x,y,z) [euler XYZ rad]
 *   transformation {posizione,rotazione} → mod_spec.transformation
 *   rmsErrorDeg   number               → errore angolare medio quadratico in gradi
 */
/** Estrae [x,y,z] da un punto nei possibili formati:
 *  - {x,y,z}                     → coordinate dirette
 *  - {position:{x,y,z}, ...}      → formato pick-manager (TJS/Pick/GetAll)
 *  - [x,y,z]                     → array numerico
 */
// ─── Formato dei punti (2026-10-19, _doc/module-tjs-threejs.md §7.0) ────────────
// Un punto è {x, y, z}. Ogni nodo TJS che riceve punti li legge con _readPoint3 / _readPoints3,
// che accettano: {x,y,z} (anche THREE.Vector3), [x,y,z] e vec3 (array tipizzati), il testo
// "x, y, z", le schede dei punti collimati (TJS/Pick/GetAll: {label, position:{x,y,z}, …}) e gli
// Object3D (si usa .position). z mancante = 0 (punti 2D). Un valore non riconosciuto dà null:
// il nodo avvisa in console (_pointWarn) e non usa il punto. Prima ogni nodo leggeva con
// p.x ?? p[0] ?? 0 e una scheda punto diventava (0,0,0) senza avviso.
function _readPoint3(v) {
    if (v == null) return null;
    let p = v;
    if (typeof p === 'object' && !Array.isArray(p) && !ArrayBuffer.isView(p) && p.position && typeof p.position === 'object') p = p.position;
    let x, y, z;
    if (typeof p === 'string') {
        [x, y, z] = p.trim().split(/[\s,;]+/).filter(Boolean).map(Number);
    } else if (Array.isArray(p) || ArrayBuffer.isView(p)) {
        [x, y, z] = [p[0], p[1], p[2]];
    } else if (typeof p === 'object') {
        ({ x, y, z } = p);
    } else {
        return null;
    }
    const num = (n) => (n == null || n === '' ? NaN : Number(n));
    x = num(x); y = num(y); z = z == null ? 0 : num(z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

/** Elenco di punti: array di valori accettati da _readPoint3 → [{x,y,z}], null se uno non è un punto. */
function _readPoints3(arr) {
    if (!Array.isArray(arr)) return null;
    const out = [];
    for (const v of arr) {
        const pt = _readPoint3(v);
        if (!pt) return null;
        out.push(pt);
    }
    return out;
}

/** Avviso per un ingresso collegato che non contiene un punto (nessun avviso se non collegato). */
function _pointWarn(node, port, v) {
    if (v == null) return;
    console.warn(`[${node?.title ?? 'TJS'}] input "${port}": not a point — expected {x,y,z}, [x,y,z] or collimated points (Pick). Received:`, v);
}

function _extractXYZ(p) {
    const pt = _readPoint3(p);
    return pt ? [pt.x, pt.y, pt.z] : [0, 0, 0];
}

function _alignSphereToCloud(cloudPts, spherePts, maxIter = 20) {
    const n = Math.min(cloudPts.length, spherePts.length);
    if (n < 3) return null;

    // Converti in array flat [x,y,z] — gestisce sia {x,y,z} sia {position:{x,y,z},...}
    const Ps = cloudPts.slice(0, n).map(_extractXYZ);

    // Normalizza i punti sfera a direzioni unitarie
    const Ds = spherePts.slice(0, n).map(p => {
        const [x, y, z] = _extractXYZ(p);
        const L = Math.sqrt(x*x + y*y + z*z);
        return L > 1e-10 ? [x/L, y/L, z/L] : [1, 0, 0];
    });

    // Inizializzazione: C = centroide dei punti nuvola
    let C = [0, 0, 0];
    for (const p of Ps) { C[0] += p[0]; C[1] += p[1]; C[2] += p[2]; }
    C = [C[0]/n, C[1]/n, C[2]/n];

    let R = [1,0,0, 0,1,0, 0,0,1];   // identità

    for (let iter = 0; iter < maxIter; iter++) {
        // Direzioni osservate dal centro corrente C verso ogni punto nuvola
        const Qs = Ps.map(p => {
            const d = [p[0]-C[0], p[1]-C[1], p[2]-C[2]];
            const L = Math.sqrt(d[0]*d[0] + d[1]*d[1] + d[2]*d[2]);
            return L > 1e-10 ? [d[0]/L, d[1]/L, d[2]/L] : [1, 0, 0];
        });
        // Kabsch: trova R che porta d_i → q_i
        R = _kabsch(Ds, Qs);
        // Direzioni ruotate: r_i = R·d_i
        const Rs = Ds.map(d => [
            R[0]*d[0] + R[1]*d[1] + R[2]*d[2],
            R[3]*d[0] + R[4]*d[1] + R[5]*d[2],
            R[6]*d[0] + R[7]*d[1] + R[8]*d[2],
        ]);
        // Aggiorna C come punto più vicino alle rette {P_i, r_i}
        const newC = _closestToLines(Ps, Rs);
        const diff = Math.sqrt((newC[0]-C[0])**2 + (newC[1]-C[1])**2 + (newC[2]-C[2])**2);
        C = newC;
        if (diff < 1e-7) break;
    }

    // Errore RMS angolare (gradi) — misura della qualità
    let errSq = 0;
    for (let i = 0; i < n; i++) {
        const d  = Ds[i];
        const rd = [R[0]*d[0]+R[1]*d[1]+R[2]*d[2], R[3]*d[0]+R[4]*d[1]+R[5]*d[2], R[6]*d[0]+R[7]*d[1]+R[8]*d[2]];
        const q0 = [Ps[i][0]-C[0], Ps[i][1]-C[1], Ps[i][2]-C[2]];
        const ql = Math.sqrt(q0[0]*q0[0] + q0[1]*q0[1] + q0[2]*q0[2]);
        const qn = ql > 1e-10 ? [q0[0]/ql, q0[1]/ql, q0[2]/ql] : [1, 0, 0];
        const dot = Math.max(-1, Math.min(1, rd[0]*qn[0] + rd[1]*qn[1] + rd[2]*qn[2]));
        errSq += Math.acos(dot) ** 2;
    }
    const rmsErrorDeg = Math.sqrt(errSq / n) * (180 / Math.PI);

    // Matrice 4×4 col-major per THREE.Matrix4.fromArray()
    // col0=[R00,R10,R20,0] col1=[R01,R11,R21,0] col2=[R02,R12,R22,0] col3=[Cx,Cy,Cz,1]
    const matrix4 = [
        R[0], R[3], R[6], 0,
        R[1], R[4], R[7], 0,
        R[2], R[5], R[8], 0,
        C[0], C[1], C[2], 1,
    ];

    // Estrai angoli Euler XYZ per mod_spec (compatibile con loadPSH)
    const m4 = new THREE.Matrix4().set(
        R[0], R[1], R[2], 0,
        R[3], R[4], R[5], 0,
        R[6], R[7], R[8], 0,
        0,    0,    0,    1
    );
    const euler = new THREE.Euler().setFromRotationMatrix(m4, 'XYZ');

    return {
        matrix4,
        position:       { x: C[0], y: C[1], z: C[2] },
        rotation:       { x: euler.x, y: euler.y, z: euler.z },
        transformation: { posizione: [C[0], C[1], C[2]], rotazione: [euler.x, euler.y, euler.z] },
        rmsErrorDeg,
    };
}
