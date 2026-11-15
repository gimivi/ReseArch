// TJS_sub_modules/TJS-flow-nodes-panorama.mjs
//
// Nodi FLE per misurare sulle panoramiche sferiche con la mappa delle distanze (2026-10-19),
// senza mesh: EXR di MoGe / DA2 da ComfyUI (ReseArch Depth Output → nodo ComfyUI Run, kind "depth").
//
//   TJS/Panorama/Mark         marca la sfera come panorama (in: sfera, out: sfera marcata), da mettere
//                             dopo TJS/Geometry/SphereGeometry; le sfere di loadPSH sono già marcate
//   TJS/Panorama/Set Depth    associa la mappa (URL dell'EXR) alla sfera marcata, con la scala:
//                             da lì Collima e Misura sulla sfera danno punti 3D
//   TJS/Panorama/Depth Point  punto 3D di una uv della sfera (es. da Events/OnPick)
//   TJS/Panorama/Depth Scale  calibrazione: scala da una distanza nota fra due punti;
//                             con apply la imposta sulla sfera e riscala i punti collimati
//
// Calcoli in TJS-pano-depth.mjs. Registrati da registerTJSFlowNodes() (TJS-flow-nodes.mjs).

import {
    tjsLoadDepthMap, tjsFindPanorama, tjsIsPanorama, tjsMarkPanorama, tjsDepthPoint, tjsDepthScaleFromPair,
    tjsSetPanoramaDepth, tjsGetPanoramaDepth,
} from './TJS-pano-depth.mjs';

export function registerTJSPanoramaNodes() {
    const LG = window.LiteGraph;
    if (!LG) return;
    if (window._TJS_PANORAMA_NODES_REGISTERED) return;
    window._TJS_PANORAMA_NODES_REGISTERED = true;

    const ACTION = LG.ACTION ?? -1;
    const EVENT  = LG.EVENT  ?? -1;

    // Tassonomia colori (_doc/module-fle-architettura.md §10): Set / Calcolo
    const SETCOLOR  = '#2a1a4a', SETBGCOLOR  = '#4a1d96';
    const CALCCOLOR = '#1e3a5f', CALCBGCOLOR = '#1e40af';

    const ctxOf = (node) => node.graph?._appContext ?? null;
    const num   = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

    // uv da {u,v} (nodi TJS) o da {x,y} (THREE.Vector2)
    // URL dell'EXR: testo, oppure messaggio App Bus non filtrato ({ value, objId, … } se il Receiver
    // ha "fields" vuoto) o oggetto con url. '' se non c'è un testo utilizzabile.
    const urlOf = (v) => {
        if (v == null) return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'object') {
            const s = v.value ?? v.url ?? v.model_url ?? '';
            return typeof s === 'string' ? s.trim() : '';
        }
        return '';
    };

    const uvOf = (v) => {
        if (!v || typeof v !== 'object') return null;
        const u = Number(v.u ?? v.x), w = Number(v.v ?? v.y);
        return Number.isFinite(u) && Number.isFinite(w) ? { u, v: w } : null;
    };

    // Sfera MARCATA: ingresso object (la sfera o un suo antenato/discendente) → nome → ultimo punto
    // colpito → prima marcata della scena
    function sphereOf(node, input, name) {
        const ctx = ctxOf(node);
        const root = ctx?.modelsRoot ?? ctx?.scene ?? null;
        if (input?.isObject3D) return tjsFindPanorama(input);
        if (name && root) {
            let byName = null;
            root.traverse((o) => { if (!byName && o.name === name) byName = o; });
            if (byName) return tjsFindPanorama(byName);
        }
        const uuid = ctx?.lastHit?.sceneObject?.uuid;
        if (uuid && ctx?.scene) {
            const o = ctx.scene.getObjectByProperty('uuid', uuid);
            if (tjsIsPanorama(o)) return o;
        }
        return tjsFindPanorama(null, root);
    }

    // Mappa: URL in ingresso (o proprietà) → quella associata alla sfera
    async function mapOf(sphere, url) {
        if (url) return tjsLoadDepthMap(url);
        const info = tjsGetPanoramaDepth(sphere);
        if (!info?.url) return null;
        return info.map ?? (await tjsLoadDepthMap(info.url));
    }

    const v3 = (p) => (p ? { x: p.x, y: p.y, z: p.z } : null);

    // ─── TJS/Panorama/Mark ───────────────────────────────────────────────────
    function TJSPanoramaMark() {
        this.addProperty('panorama', true, 'boolean');
        this.addWidget('toggle', 'panorama', true, v => { this.properties.panorama = !!v; }, { property: 'panorama' });
        this.addInput('trigger', ACTION);
        this.addInput('sphere',  0);
        this.addOutput('done',    EVENT);
        this.addOutput('→sphere', 0);
        this.color = SETCOLOR; this.bgcolor = SETBGCOLOR;
        this.size  = [200, 80];
    }
    TJSPanoramaMark.title = 'Panorama Mark';
    TJSPanoramaMark.desc  = 'Marks a sphere as a panorama, to put on the path right after TJS/Geometry/SphereGeometry: only marked spheres take a distance map (Panorama Set Depth) and give 3D points with Pick and Measure (no snap to vertices on them). Spheres of the panorama models (loadPSH) are already marked.';
    TJSPanoramaMark.portHelp = {
        inputs: {
            trigger: 'event — marks (or unmarks) the sphere',
            sphere:  'THREE.Object3D — a mesh with SphereGeometry, or an object containing one (the first is taken)',
        },
        outputs: {
            done:      'event — fired once marked; not fired if no SphereGeometry was found',
            '→sphere': 'THREE.Object3D — the marked sphere (passthrough), to go on with material, scale, rotation, Add Object…',
        },
        properties: { panorama: 'true: marks the sphere as panorama · false: removes the mark' },
    };
    TJSPanoramaMark.prototype.onAction = function () {
        const sphere = tjsMarkPanorama(this.getInputData(1), this.properties.panorama !== false);
        if (!sphere) { console.warn('[TJS/Panorama/Mark] no SphereGeometry in the input object'); return; }
        this.setOutputData(1, sphere);
        this.triggerSlot(0);
    };
    LG.registerNodeType('TJS/Panorama/Mark', TJSPanoramaMark);

    // ─── TJS/Panorama/Set Depth ──────────────────────────────────────────────
    function TJSPanoramaSetDepth() {
        this.addProperty('name',  '', 'string');
        this.addProperty('url',   '', 'string');
        this.addProperty('scale', 1,  'number');
        this.addWidget('text',   'sphere name', '', v => { this.properties.name = String(v ?? '').trim(); }, { property: 'name' });
        this.addWidget('text',   'EXR url',     '', v => { this.properties.url = String(v ?? '').trim(); },  { property: 'url' });
        this.addWidget('number', 'scale',       1,  v => { this.properties.scale = Math.max(1e-9, num(v, 1)); }, { min: 0, step: 0.1, precision: 4, property: 'scale' });
        this.addInput('trigger', ACTION);
        this.addInput('sphere',  0);
        this.addInput('url',     'string');
        this.addInput('scale',   'number');
        this.addOutput('done',    EVENT);
        this.addOutput('→sphere', 0);
        this.addOutput('units',   'string');
        this.addOutput('source',  'string');
        this.color = SETCOLOR; this.bgcolor = SETBGCOLOR;
        this.size  = [240, 150];
    }
    TJSPanoramaSetDepth.title = 'Panorama Set Depth';
    TJSPanoramaSetDepth.desc  = 'Links a distance map (EXR from ComfyUI: ReseArch Depth Output, MoGe or DA2) to a panorama sphere. From then on Pick and Measure on that sphere give 3D points (center + direction × distance × scale) — measuring without a mesh.';
    TJSPanoramaSetDepth.portHelp = {
        inputs: {
            trigger: 'event — loads the EXR and links it to the sphere',
            sphere:  'THREE.Object3D — the panorama sphere (or its model), marked: from a panorama model (loadPSH) or by Panorama Mark. Mirrored on the geometry or with Set Scale −1, both work. Not connected: "sphere name", else the last hit sphere, else the first marked sphere in the scene',
            url:     'text — URL of the EXR (output of kind "depth" of AI/ComfyUI/Run), overrides the widget. Also an App Bus message: from an object it takes "value" (or "url"); better to write "value" in the "fields" of the Receiver',
            scale:   'number — scene meters per map unit. MoGe and DA2 panoramas give relative distances: calibrate with Panorama Depth Scale (a known distance). 1 only for a map already in meters. Overrides the widget',
        },
        outputs: {
            done:      'event — fired when the EXR is loaded and linked',
            '→sphere': 'THREE.Object3D — the sphere (passthrough)',
            units:     'text — units written in the EXR: "relative" (MoGe and DA2 panoramas) or "metric" (map already in meters)',
            source:    'text — model that produced the map ("moge", "da2")',
        },
        properties: {
            name:  'name of the sphere object, used when "sphere" is not connected',
            url:   'URL of the EXR, used when "url" is not connected',
            scale: 'scale, used when "scale" is not connected',
        },
    };
    TJSPanoramaSetDepth.prototype.onAction = function () {
        const sphere = sphereOf(this, this.getInputData(1), this.properties.name);
        const inUrl  = this.getInputData(2);
        const url    = urlOf(inUrl) || urlOf(this.properties.url);
        const scale  = num(this.getInputData(3), num(this.properties.scale, 1));
        if (!sphere) { console.warn('[TJS/Panorama/Set Depth] no marked panorama sphere found: add TJS/Panorama/Mark after the sphere'); return; }
        if (!url) {
            console.warn('[TJS/Panorama/Set Depth] EXR url missing' + (inUrl != null && typeof inUrl !== 'string'
                ? ': the "url" input received an object without a text value/url (App Bus Receiver: write "value" in "fields")' : ''));
            return;
        }
        tjsSetPanoramaDepth(sphere, { url, scale })
            .then((info) => {
                this.setOutputData(1, sphere);
                this.setOutputData(2, info.units ?? '');
                this.setOutputData(3, info.source ?? '');
                this.triggerSlot(0);
            })
            .catch((e) => console.warn('[TJS/Panorama/Set Depth]', e?.message ?? e));
    };
    LG.registerNodeType('TJS/Panorama/Set Depth', TJSPanoramaSetDepth);

    // ─── TJS/Panorama/Depth Point ────────────────────────────────────────────
    function TJSPanoramaDepthPoint() {
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'sphere name', '', v => { this.properties.name = String(v ?? '').trim(); }, { property: 'name' });
        this.addInput('trigger', ACTION);
        this.addInput('uv',      'object');
        this.addInput('sphere',  0);
        this.addInput('url',     'string');
        this.addInput('scale',   'number');
        this.addOutput('done',     EVENT);
        this.addOutput('point',    'object');
        this.addOutput('distance', 'number');
        this.addOutput('found',    'boolean');
        this.color = CALCCOLOR; this.bgcolor = CALCBGCOLOR;
        this.size  = [230, 150];
    }
    TJSPanoramaDepthPoint.title = 'Panorama Depth Point';
    TJSPanoramaDepthPoint.desc  = '3D point of a uv of the panorama sphere, read from the distance map (EXR): center + direction × distance × scale. Without uv it uses the last hit point (Events/OnPick).';
    TJSPanoramaDepthPoint.portHelp = {
        inputs: {
            trigger: 'event — computes the point',
            uv:      '{u,v} — map coordinates on the sphere (uv output of Events/OnPick, Pick/Get By Label…). Not connected: the uv of the last hit point',
            sphere:  'THREE.Object3D — the marked panorama sphere. Not connected: "sphere name", else the last hit sphere, else the first marked sphere',
            url:     'text — URL of an EXR to use instead of the one linked with Panorama Set Depth',
            scale:   'number — overrides the scale linked to the sphere (default 1)',
        },
        outputs: {
            done:     'event — fired after the computation (also when the pixel is not valid: see found)',
            point:    '{x,y,z} — world position of the measured point',
            distance: 'number — distance from the sphere center, in scene units (map value × scale)',
            found:    'boolean — false if the pixel has no valid distance or the map is missing (point and distance not updated)',
        },
        properties: { name: 'name of the sphere object, used when "sphere" is not connected' },
    };
    TJSPanoramaDepthPoint.prototype.onAction = function () {
        const ctx    = ctxOf(this);
        const uv     = uvOf(this.getInputData(1)) ?? uvOf(ctx?.lastHit?.sceneObject?.uv);
        const sphere = sphereOf(this, this.getInputData(2), this.properties.name);
        const url    = urlOf(this.getInputData(3));
        const finish = (found) => { this.setOutputData(3, found); this.triggerSlot(0); };
        if (!uv || !sphere) { finish(false); return; }
        mapOf(sphere, url).then((map) => {
            if (!map) { finish(false); return; }
            const info  = tjsGetPanoramaDepth(sphere);
            const scale = num(this.getInputData(4), info?.scale ?? 1);
            const r = tjsDepthPoint(sphere, map, uv.u, uv.v, scale);
            if (!r) { finish(false); return; }
            this.setOutputData(1, v3(r.point));
            this.setOutputData(2, r.distance);
            finish(true);
        }).catch((e) => { console.warn('[TJS/Panorama/Depth Point]', e?.message ?? e); finish(false); });
    };
    LG.registerNodeType('TJS/Panorama/Depth Point', TJSPanoramaDepthPoint);

    // ─── TJS/Panorama/Depth Scale ────────────────────────────────────────────
    function TJSPanoramaDepthScale() {
        this.addProperty('labelA',   'P1', 'string');
        this.addProperty('labelB',   'P2', 'string');
        this.addProperty('distance', 1,    'number');
        this.addProperty('apply',    true, 'boolean');
        this.addWidget('text',   'point A',            'P1', v => { this.properties.labelA = String(v ?? '').trim(); }, { property: 'labelA' });
        this.addWidget('text',   'point B',            'P2', v => { this.properties.labelB = String(v ?? '').trim(); }, { property: 'labelB' });
        this.addWidget('number', 'known distance (m)', 1,    v => { this.properties.distance = Math.max(0, num(v, 1)); }, { min: 0, step: 0.1, precision: 3, property: 'distance' });
        this.addWidget('toggle', 'apply to sphere',    true, v => { this.properties.apply = !!v; }, { property: 'apply' });
        this.addInput('trigger',  ACTION);
        this.addInput('uvA',      'object');
        this.addInput('uvB',      'object');
        this.addInput('distance', 'number');
        this.addInput('sphere',   0);
        this.addOutput('done',      EVENT);
        this.addOutput('scale',     'number');
        this.addOutput('rawLength', 'number');
        this.addOutput('found',     'boolean');
        this.color = CALCCOLOR; this.bgcolor = CALCBGCOLOR;
        this.size  = [250, 190];
    }
    TJSPanoramaDepthScale.title = 'Panorama Depth Scale';
    TJSPanoramaDepthScale.desc  = 'Calibration: scale that makes the distance between two points of the panorama equal to a known distance (needed for DA2, whose distances are relative). With "apply to sphere" it becomes the scale of the linked map and the collimated points on that sphere are rescaled.';
    TJSPanoramaDepthScale.portHelp = {
        inputs: {
            trigger:  'event — computes the scale',
            uvA:      '{u,v} — first point. Not connected: the uv of the collimated point "point A" (e.g. P1)',
            uvB:      '{u,v} — second point. Not connected: the uv of the collimated point "point B" (e.g. P2)',
            distance: 'number — real distance between the two points, in meters, overrides the widget',
            sphere:   'THREE.Object3D — the marked panorama sphere. Not connected: the sphere of point A, else the first marked sphere',
        },
        outputs: {
            done:      'event — fired after the computation',
            scale:     'number — meters per map unit (connect it to Panorama Set Depth, or use "apply to sphere")',
            rawLength: 'number — distance between the two points in map units (scale 1)',
            found:     'boolean — false if a point is missing or its pixel has no valid distance',
        },
        properties: {
            labelA:   'label of the collimated point used when uvA is not connected',
            labelB:   'label of the collimated point used when uvB is not connected',
            distance: 'known distance in meters',
            apply:    'true: sets the scale on the sphere and rescales its collimated points',
        },
    };
    TJSPanoramaDepthScale.prototype.onAction = function () {
        const ctx = ctxOf(this);
        const pts = ctx?.collimatedPoints ?? [];
        const pA  = pts.find(p => p.label === this.properties.labelA) ?? null;
        const pB  = pts.find(p => p.label === this.properties.labelB) ?? null;
        const uvA = uvOf(this.getInputData(1)) ?? uvOf(pA?.uv);
        const uvB = uvOf(this.getInputData(2)) ?? uvOf(pB?.uv);
        const known = num(this.getInputData(3), num(this.properties.distance, 0));
        let sphereIn = this.getInputData(4);
        if (!sphereIn && pA?.panoDepth?.sphere && ctx?.scene) sphereIn = ctx.scene.getObjectByProperty('uuid', pA.panoDepth.sphere);
        const sphere = sphereOf(this, sphereIn, '');
        const finish = (found) => { this.setOutputData(3, found); this.triggerSlot(0); };
        if (!uvA || !uvB || !sphere || !(known > 0)) { finish(false); return; }
        mapOf(sphere, '').then((map) => {
            if (!map) { finish(false); return; }
            const r = tjsDepthScaleFromPair(sphere, map, uvA, uvB, known);
            if (!r) { finish(false); return; }
            this.setOutputData(1, r.scale);
            this.setOutputData(2, r.rawLength);
            if (this.properties.apply) {
                const info = tjsGetPanoramaDepth(sphere);
                if (info) info.scale = r.scale;
                ctx?.pickManager?.rescaleDepthPoints?.(sphere, r.scale);
                ctx?.markDirty?.();
            }
            finish(true);
        }).catch((e) => { console.warn('[TJS/Panorama/Depth Scale]', e?.message ?? e); finish(false); });
    };
    LG.registerNodeType('TJS/Panorama/Depth Scale', TJSPanoramaDepthScale);
}
