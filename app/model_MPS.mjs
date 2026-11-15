// model_MPS.mjs
// Google Maps renderer (2D satellite + 3D) per oggetti MPS.
//
// mod_spec atteso:
// {
//   type:        "2D" | "3D",
//   geoCoord:    [lat, lng],
//   zoom:        number,          (2D)
//   mapId:       string,          (2D, facoltativo: Map ID della Cloud Console; assente = DEMO_MAP_ID)
//   altitude:    number,          (3D: quota sul livello del mare del punto inquadrato)
//   range:       number,          (3D: distanza in metri della camera dal punto; senza range
//                                  vista iniziale come prima: camera sul punto a quota altitude/150)
//   tilt:        number,          (3D, default 60)
//   coordinates: [{ lat, lng, altitude, nome, id_mrk, colore }, ...]
//     altitude opzionale: quota sul livello del mare; assente = segnaposto 10 m sopra edifici/terreno
//     id_mrk opzionale: correla il marker cliccato a un dato esterno
//     colore opzionale, hex (es. "#FBBC04"): sfondo del pin; assente = default Google
// }
//
// Quote 3D (verificato 2026-10-20): center.altitude di Map3DElement è sul livello del mare, la
// camera sta a `range` metri dal punto. Senza range Google mette la camera SUL punto.

import { appBusOn, appBusEmit } from "./app-bus.mjs";
import { mpsLoadFlows } from "./MPS_sub_modules/MPS-flow-runner.mjs";
import { t, te } from "./shared/i18n.mjs";

// ─── Stato per pannello ───────────────────────────────────────────────────────

const STATE_KEY = "__MPS_STATE__";

/** Distanza camera-punto (m) quando né la vista né il mod_spec la indicano. */
const DEFAULT_RANGE = 300;

/** Numero finito (anche da testo con virgola), altrimenti null: null, '' e undefined non diventano 0. */
function _finite(v) {
    if (v == null || v === '') return null;
    const n = Number(typeof v === 'string' ? v.trim().replace(',', '.') : v);
    return Number.isFinite(n) ? n : null;
}

// ─── Helpers lifecycle ────────────────────────────────────────────────────────

function destroyBodyInstance(bodyEl) {
    const st = bodyEl?.[STATE_KEY];
    if (!st) return;
    st.stopped = true;
    clearTimeout(st._suppressAutoPublishTimer);
    _stopGlide(st);
    // Rimuovi marker dal DOM (solo 3D: sono CustomElements figli della mappa)
    for (const m of st.markers ?? []) {
        try { m.remove?.(); } catch { /* noop */ }
    }
    for (const rec of st.flowMarkers?.values() ?? []) _detachFlowMarker(rec);
    st.flowMarkers?.clear();
    try { bodyEl.innerHTML = ''; } catch { /* noop */ }
    try { delete bodyEl[STATE_KEY]; } catch { /* noop */ }
}

function attachAbortCleanup(signal, bodyEl) {
    if (!signal?.addEventListener) return;
    signal.addEventListener('abort', () => destroyBodyInstance(bodyEl), { once: true });
}

function getObjectDisplayName(object) {
    if (!object) return t('app.mps.map');
    return object.obj_name || object.obj_title || t('app.mps.map_n', { id: object.obj_id ?? '' }).trim();
}

/**
 * Decide se questo pannello MPS deve gestire il messaggio bus.
 * Accetta broadcast (senza targetApp/targetObjId) o messaggi diretti a MPS+objId.
 */
function _shouldHandleMsg(msg, object) {
    const p = msg?.payload ?? {};
    if (p.targetApp    && p.targetApp    !== 'MPS')                              return false;
    if (p.targetObjId  != null && Number(p.targetObjId) !== Number(object?.obj_id)) return false;
    return true;
}

// ─── Init mappa 2D ───────────────────────────────────────────────────────────

async function _initMap2D(bodyEl, mod_spec, state, object) {
    const [{ Map }, { AdvancedMarkerElement, PinElement }] = await Promise.all([
        google.maps.importLibrary('maps'),
        google.maps.importLibrary('marker'),
    ]);

    // mapId: obbligatorio per AdvancedMarkerElement (segnaposto dei nodi MPS/Marker/*). Con un
    // mapId gli `styles` JSON sono ignorati: lo stile "silver" di prima è stato tolto (2026-10-20),
    // sul satellite senza etichette non cambiava nulla.
    const center = { lat: mod_spec.geoCoord[0], lng: mod_spec.geoCoord[1] };
    const map = new Map(bodyEl, {
        zoom:             mod_spec.zoom ?? 10,
        center,
        mapTypeId:        'satellite',
        mapId:            mod_spec.mapId || 'DEMO_MAP_ID',
        disableDefaultUI: true,
    });
    state.AdvMarkerCls  = AdvancedMarkerElement;
    state.PinElementCls = PinElement;

    // Emetti selection:change al click sulla mappa.
    // targetObjId: SEMPRE l'obj_id di questo stesso pannello — senza, il
    // messaggio è un broadcast che ogni altro pannello MPS aperto (qualunque
    // oggetto/zona mostri) applica ciecamente via panTo/flyCameraTo (bug
    // osservato con due pannelli su zone diverse d'Italia). Con targetObjId
    // solo pannelli sullo stesso oggetto reagiscono (incluso questo stesso
    // pannello: preserva il "click per centrare"); la sincronizzazione fra
    // oggetti diversi resta possibile ma va costruita esplicitamente con un
    // flow (App Bus Receiver con targetObjId a scelta → MPS/Camera/FlyTo).
    map.addListener('click', e => {
        if (state.stopped) return;
        appBusEmit('selection:change', {
            objId:       object?.obj_id ?? null,
            targetObjId: object?.obj_id ?? null,
            lat:         e.latLng.lat(),
            lng:         e.latLng.lng(),
        });
    });

    // Pubblica automaticamente la vista a fine pan/zoom/animazione (evento
    // standard 'idle' di google.maps.Map — si attiva solo dopo che l'utente
    // smette di interagire, non durante il drag).
    map.addListener('idle', () => _onViewSettled(state));

    state.map     = map;
    state.markers = [];
}

// ─── Init mappa 3D ───────────────────────────────────────────────────────────

async function _initMap3D(bodyEl, mod_spec, state, object) {
    // Marker3DElement NON è interattivo per progettazione — è la classe
    // ottimizzata per grandi dataset, senza click/hover/tastiera (vedi tabella
    // comparativa nella doc ufficiale Google). Per marker cliccabili serve
    // Marker3DInteractiveElement — stessa libreria 'maps3d', classe diversa.
    // PinElement (personalizzazione colore) viene invece da una libreria
    // diversa: 'marker' (confermato in _doc/GMaps/Indicatori.md).
    const [{ Map3DElement, Marker3DInteractiveElement }, { PinElement }] = await Promise.all([
        google.maps.importLibrary('maps3d'),
        google.maps.importLibrary('marker'),
    ]);

    const map = new Map3DElement({ ..._initialCamera(mod_spec), mode: 'SATELLITE' });

    // <gmp-map-3d> è un custom element: senza display/size espliciti resta
    // display:inline con un box di layout degenere. Il rendering WebGL può
    // "dipingere" comunque oltre quel box (i marker restano visibili), ma
    // click/hover restano vincolati al box reale — risultato: mappa visibile
    // ma nulla è cliccabile/hoverabile. Vedi anche css/ReseArch.css .mps-map3d.
    map.style.cssText = 'display:block; position:absolute; inset:0; width:100%; height:100%;';
    map.classList.add('mps-map3d');

    bodyEl.append(map);

    state.map         = map;
    state.markers     = [];
    state.MarkerCls    = Marker3DInteractiveElement;
    state.PinElementCls = PinElement;

    // Pubblica automaticamente la vista a fine pan/zoom/tilt/animazione.
    // Nome evento non uniforme nella doc ufficiale (compare sia come
    // 'gmp-steadystate' che 'gmp-steadychange' in pagine diverse): registro
    // entrambi, innocuo se uno dei due non spara mai. Payload { isSteady }.
    const onSteady = ev => { if (ev?.isSteady) _onViewSettled(state); };
    map.addEventListener('gmp-steadystate', onSteady);
    map.addEventListener('gmp-steadychange', onSteady);

    _addMarkers3D(mod_spec.coordinates ?? [], state, object);
}

/**
 * Vista 3D di apertura e di "Reimposta vista". Con mod_spec.range: punto inquadrato a quota
 * altitude (livello del mare, 0 se assente) e camera a range metri. Senza range: come prima,
 * camera sopra geoCoord a quota altitude (default 150).
 */
function _initialCamera(mod_spec) {
    const lat = mod_spec.geoCoord[0], lng = mod_spec.geoCoord[1];
    const tilt = mod_spec.tilt ?? 60;
    if (Number.isFinite(Number(mod_spec.range))) {
        return { center: { lat, lng, altitude: Number(mod_spec.altitude) || 0 }, range: Number(mod_spec.range), tilt };
    }
    return { center: { lat, lng, altitude: mod_spec.altitude ?? 150 }, tilt };
}

/**
 * Legge la vista corrente della mappa (centro + zoom/range + orientamento).
 * Ritorna null se la mappa non è ancora pronta.
 */
function _readCurrentView(state) {
    const { map, mod_spec } = state;
    if (!map) return null;

    if (mod_spec.type === '2D') {
        const c = map.getCenter?.();
        if (!c) return null;
        return {
            type: '2D',
            lat:  c.lat(),
            lng:  c.lng(),
            zoom: map.getZoom?.() ?? null,
        };
    }

    // 3D: Map3DElement espone center/range/tilt/heading come proprietà dirette
    // (stessi nomi accettati dal costruttore in _initMap3D).
    const c = map.center;
    if (!c) return null;
    return {
        type:     '3D',
        lat:      c.lat,
        lng:      c.lng,
        altitude: c.altitude ?? null,
        range:    map.range   ?? null,
        tilt:     map.tilt    ?? null,
        heading:  map.heading ?? null,
    };
}

/**
 * Pubblica la vista corrente sull'App Bus (evento custom 'mps:view:changed').
 * Unico trigger: fine pan/zoom/animazione (_onViewSettled) — mai continuo
 * durante il movimento, evita di floodare il bus (vedi arch-app-bus.md §9).
 * Pubblicare è innocuo: nessun pannello MPS lo applica automaticamente —
 * serve un flow esplicito (vedi renderBody più sotto e module-mps-maps.md §8).
 */
function _publishView(state) {
    const view = _readCurrentView(state);
    if (!view) {
        state.cmdUI?.update?.({ status: te('app.mps.view_unavailable') });
        return;
    }
    appBusEmit('mps:view:changed', {
        objId:     state.object?.obj_id ?? null,
        sourceApp: 'MPS',
        ...view,
    });
    state.cmdUI?.update?.({ status: te('app.mps.view_published') });
}

/**
 * Chiamata quando la camera si assesta (evento 'idle' in 2D, 'gmp-steadystate'/
 * 'gmp-steadychange' con isSteady:true in 3D). Pubblica la vista, MA salta la
 * pubblicazione se l'assestamento è conseguenza di una vista appena applicata
 * da remoto (_applyView) — altrimenti due pannelli con ricezione attiva si
 * rimbalzerebbero la vista all'infinito (A pubblica → B applica → B si
 * assesta → B ripubblica → A riapplica → ...).
 */
function _onViewSettled(state) {
    if (state.stopped) return;
    if (state._suppressAutoPublish) return;
    _publishView(state);
}

/**
 * Applica una vista ricevuta da 'mps:view:changed' alla mappa corrente.
 * Specularmente a _readCurrentView(): stessi campi, direzione opposta.
 */
function _applyView(state, view, opts = {}) {
    const { map, mod_spec } = state;
    if (!map || view?.lat == null || view?.lng == null) return;

    // Opzioni del nodo MPS/Camera/FlyTo (2026-10-20); senza opzioni: fly, 1200 ms.
    // motion: 'fly' (flyCameraTo di Google, arco) | 'glide' (scivolata nostra) | 'jump' (immediato)
    const motion   = ['glide', 'jump'].includes(opts.motion) ? opts.motion : 'fly';
    const duration = Number.isFinite(Number(opts.duration)) && Number(opts.duration) >= 0 ? Number(opts.duration) : 1200;

    // Sopprime l'auto-pubblicazione sul prossimo assestamento (vedi _onViewSettled):
    // questo cambio di vista è remoto, non un'interazione locale dell'utente.
    // Finestra: la durata dell'animazione (1200ms di default) più margine, almeno 2s.
    state._suppressAutoPublish = true;
    clearTimeout(state._suppressAutoPublishTimer);
    state._suppressAutoPublishTimer = setTimeout(() => {
        state._suppressAutoPublish = false;
    }, Math.max(2000, duration + 800));

    if (mod_spec.type === '2D') {
        map.setCenter({ lat: view.lat, lng: view.lng });
        if (view.zoom != null) map.setZoom(view.zoom);
    } else {
        // Quota sul livello del mare (verificato 2026-10-20). Senza quota: quella del punto
        // guardato ora (giusta nella stessa zona; per un luogo preciso passare dal nodo
        // MPS/Geo/Elevation). Range sempre presente: senza, Google mette la camera sul punto.
        const endCamera = {
            center:  { lat: view.lat, lng: view.lng, altitude: _finite(view.altitude) ?? _finite(map.center?.altitude) ?? 0 },
            tilt:    view.tilt    ?? 60,
            heading: view.heading ?? 0,
            range:   (_finite(view.range) || 0) > 0 ? _finite(view.range)
                   : (_finite(mod_spec.range) || 0) > 0 ? _finite(mod_spec.range) : DEFAULT_RANGE,
        };
        _stopGlide(state);
        if (motion === 'jump' || duration === 0) {
            map.stopCameraAnimation?.();
            map.center  = endCamera.center;
            map.tilt    = endCamera.tilt;
            map.heading = endCamera.heading;
            if (endCamera.range != null) map.range = endCamera.range;
        } else if (motion === 'glide') {
            _glideCamera(state, endCamera, duration);
        } else {
            map.flyCameraTo({ endCamera, durationMillis: duration });
        }
    }
}

function _stopGlide(state) {
    if (state._glideRaf) cancelAnimationFrame(state._glideRaf);
    state._glideRaf = null;
    state._glideToken = null;
    state._glideOffPointer?.();
    state._glideOffPointer = null;
}

/**
 * Scivolata della camera 3D: centro, quota, distanza, inclinazione e direzione interpolati in
 * linea retta con accelerazione/decelerazione morbida, senza l'arco di flyCameraTo (che si alza
 * e riscende). Range assente = resta quello attuale. Un clic sulla mappa la interrompe.
 */
function _glideCamera(state, endCamera, duration) {
    const map = state.map;
    const c = map.center;
    if (c?.lat == null || c?.lng == null) {   // nessuna vista di partenza: come jump
        map.center = endCamera.center; map.tilt = endCamera.tilt; map.heading = endCamera.heading;
        if (endCamera.range != null) map.range = endCamera.range;
        return;
    }
    map.stopCameraAnimation?.();
    const from = {
        lat: c.lat, lng: c.lng, alt: c.altitude ?? 0,
        tilt: map.tilt ?? endCamera.tilt, heading: map.heading ?? 0, range: map.range ?? null,
    };
    const to = {
        lat: endCamera.center.lat, lng: endCamera.center.lng, alt: endCamera.center.altitude ?? 0,
        tilt: endCamera.tilt, range: endCamera.range ?? from.range,
    };
    const dHeading = ((((endCamera.heading - from.heading) % 360) + 540) % 360) - 180;   // via più breve
    const lerp = (a, b, k) => a + (b - a) * k;
    const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    const token = {};
    state._glideToken = token;
    const onPointer = () => _stopGlide(state);
    map.addEventListener?.('pointerdown', onPointer, { once: true });
    state._glideOffPointer = () => map.removeEventListener?.('pointerdown', onPointer);
    const t0 = performance.now();
    const step = (now) => {
        if (state.stopped || state._glideToken !== token) return;
        const k = Math.min(1, (now - t0) / duration);
        const e = ease(k);
        map.center  = { lat: lerp(from.lat, to.lat, e), lng: lerp(from.lng, to.lng, e), altitude: lerp(from.alt, to.alt, e) };
        map.tilt    = lerp(from.tilt, to.tilt, e);
        map.heading = (from.heading + dHeading * e + 360) % 360;
        if (from.range != null && to.range != null) map.range = lerp(from.range, to.range, e);
        if (k < 1) state._glideRaf = requestAnimationFrame(step);
        else _stopGlide(state);
    };
    state._glideRaf = requestAnimationFrame(step);
}

/**
 * Emette selection:change per un marker — stessa forma sia dal click reale
 * sia dal nodo flow MPS/Marker/GoTo (che deve comportarsi come un click).
 * Notifica anche state.localEvents ('markerClick'): è la sorgente locale del
 * nodo flow MPS/Events/OnMarkerClick — indipendente dall'App Bus, funziona
 * anche se il flow non pubblica nulla all'esterno.
 *
 * targetObjId: stesso motivo del click 2D (vedi _initMap2D) — senza, il
 * click su un marker di QUESTO pannello fa volare la camera di qualunque
 * altro pannello MPS aperto, su un oggetto/zona completamente diverso.
 */
function _emitMarkerSelection(state, object, el) {
    appBusEmit('selection:change', {
        objId:       object?.obj_id ?? null,
        targetObjId: object?.obj_id ?? null,
        lat:         el.lat,
        lng:         el.lng,
        altitude:    _finite(el.altitude),   // livello del mare; null = sconosciuta (non 0)
        nome:        el.nome ?? null,
        id_mrk:      el.id_mrk ?? null,
        colore:      el.colore ?? null,
    });
    state.localEvents?.dispatchEvent(new CustomEvent('markerClick', { detail: el }));
}

/**
 * Cerca un marker per id_mrk in mod_spec.coordinates (dati di configurazione,
 * non i CustomElement renderizzati — funziona anche se la mappa è 2D, dove
 * oggi non esiste alcun marker disegnato).
 */
function _findMarkerData(state, id_mrk) {
    const list = state.mod_spec?.coordinates ?? [];
    return list.find(c => String(c.id_mrk ?? '') === String(id_mrk)) ?? null;
}

/**
 * Nodo flow MPS/Marker/GoTo: stesso identico effetto del click reale sul
 * marker (solo emissione selection:change) — l'eventuale spostamento della
 * telecamera dipende dal receiver selection:change già presente, non da qui.
 */
function _goToMarker(state, object, id_mrk) {
    const el = _findMarkerData(state, id_mrk);
    if (!el) return false;
    _emitMarkerSelection(state, object, el);
    return true;
}

/**
 * Nodo flow MPS/Marker/ViewTo: la posizione della camera non cambia, solo
 * l'orientamento (heading) — calcolato con il bearing standard fra il centro
 * corrente e il marker. Solo 3D (2D non ha orientamento).
 */
function _viewToMarker(state, id_mrk) {
    if (state.mod_spec?.type !== '3D') return false;
    const el = _findMarkerData(state, id_mrk);
    const current = _readCurrentView(state);
    if (!el || !current) return false;
    const heading = _computeHeading(current.lat, current.lng, el.lat, el.lng);
    _applyView(state, { ...current, heading });
    return true;
}

/** Bearing iniziale (great-circle) in gradi, da (fromLat,fromLng) a (toLat,toLng). */
function _computeHeading(fromLat, fromLng, toLat, toLng) {
    const rad  = Math.PI / 180;
    const phi1 = fromLat * rad, phi2 = toLat * rad;
    const dLng = (toLng - fromLng) * rad;
    const y = Math.sin(dLng) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
    const theta = Math.atan2(y, x);
    return (theta / rad + 360) % 360;
}

/**
 * Nodo flow MPS/Style/SetStyle: sostituisce (o rimuove, se colore falsy) il
 * PinElement del marker con id_mrk indicato: segnaposto del mod_spec (solo 3D) o creato da un flow (2D e 3D).
 */
function _setMarkerStyle(state, id_mrk, colore) {
    if (!state.PinElementCls) return false;
    // segnaposto creato da un flow (2D e 3D): stesso id → cambia il colore del suo stile
    if (state.flowMarkers?.has(String(id_mrk))) {
        return _updateFlowMarker(state, state.object, id_mrk, { color: colore || '' });
    }
    const marker = (state.markers ?? []).find(m => m.dataset?.mpsIdMrk === String(id_mrk));
    if (!marker) return false;
    for (const child of Array.from(marker.children)) {
        if (child instanceof state.PinElementCls) child.remove();
    }
    if (colore) {
        try {
            const pin = new state.PinElementCls({ background: colore });
            marker.append(pin);
        } catch (e) {
            console.warn('[MPS] PinElement colore non applicato:', colore, e);
            return false;
        }
    }
    return true;
}

/**
 * Rimuove i marker esistenti e ricrea quelli dall'array coordinates passato.
 * Permette sia il reload completo sia il filtraggio.
 */
function _addMarkers3D(coordinates, state, object) {
    for (const m of state.markers) { try { m.remove(); } catch { /* noop */ } }
    state.markers = [];

    for (const el of coordinates) {
        // altitude = livello del mare; senza, 10 m sopra edifici o terreno (prima: 10 m sul mare)
        const alt = _finite(el.altitude);
        const marker = new state.MarkerCls({
            position:     { lat: el.lat, lng: el.lng, altitude: (alt ?? 0) + 10 },
            altitudeMode: alt != null ? 'ABSOLUTE' : 'RELATIVE_TO_MESH',
            extruded:     true,
            label:        el.nome ?? '',
            // title: testo di accessibilità (screen reader) + tooltip nativo al
            // passaggio del mouse — se il tooltip compare, l'interattività è confermata.
            title:        el.nome ?? '',
        });
        // id_mrk: correla il marker a un dato esterno (definito da mod_spec.coordinates[].id_mrk).
        marker.dataset.mpsIdMrk = el.id_mrk ?? '';

        // Colore personalizzato (mod_spec.coordinates[].colore, hex es. "#FBBC04").
        // Se assente: pin di default di Google (nessun PinElement appeso).
        if (el.colore && state.PinElementCls) {
            try {
                const pin = new state.PinElementCls({ background: el.colore });
                marker.append(pin);
            } catch (e) {
                console.warn('[MPS] PinElement colore non applicato:', el.colore, e);
            }
        }

        // Emetti selection:change al click sul marker.
        // Nome evento non documentato con certezza per Marker3DInteractiveElement
        // (la doc ufficiale parla genericamente di "click event listener"): registro
        // sia 'click' (probabile, coerente con AdvancedMarkerElement 2D) sia
        // 'gmp-click' (nome usato da altri custom element gmp-*) — innocuo se uno
        // dei due non spara mai.
        const onMarkerClick = () => {
            if (state.stopped) return;
            _emitMarkerSelection(state, object, el);
        };
        marker.addEventListener('click', onMarkerClick);
        marker.addEventListener('gmp-click', onMarkerClick);

        state.map.append(marker);
        state.markers.push(marker);
    }
}

// ─── Segnaposto dei flow (nodi MPS/Marker/Add, AddList, Update, Remove, Fit) ────
// Distinti da quelli del mod_spec (state.markers, solo 3D): vivono in state.flowMarkers
// (id → record), funzionano in 2D (AdvancedMarkerElement, serve il mapId) e in 3D
// (Marker3DInteractiveElement). Stesso id = il segnaposto viene sostituito.

const FLOW_ALT_MODES = { mesh: 'RELATIVE_TO_MESH', ground: 'CLAMP_TO_GROUND', relative: 'RELATIVE_TO_GROUND', absolute: 'ABSOLUTE' };
const FLOW_COLLISION = { required: 'REQUIRED', optional: 'OPTIONAL_AND_HIDES_LOWER_PRIORITY', priority: 'REQUIRED_AND_HIDES_OPTIONAL' };
const FLOW_STYLE_DEFAULT = {
    color: '', borderColor: '', glyphColor: '', glyph: '', icon: '', scale: 1, showLabel: true,
    altitudeMode: 'mesh', height: 10, extruded: true, occluded: true, collision: 'required', zIndex: null,
};
let _flowMarkerSeq = 0;

/** Dato in ingresso → record; null se mancano lat/lng validi. Accetta lat/lng, lon, latitude/longitude. */
function _flowMarkerRecord(data, opts) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const lat = _finite(data.lat ?? data.latitude);
    const lng = _finite(data.lng ?? data.lon ?? data.longitude);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const idField = opts.idField || 'id', labelField = opts.labelField || 'name';
    const rawId = data[idField];
    return {
        id:       rawId != null && rawId !== '' ? String(rawId) : `mrk${++_flowMarkerSeq}`,
        group:    String(opts.group || 'flow'),
        lat, lng,
        altitude: _finite(data.altitude),
        label:    String(data[labelField] ?? ''),
        labelField,
        data:     { ...data },
        style:    { ...(opts.style || {}) },
        onClick:  opts.onClick || 'event',
        index:    Number.isInteger(opts.index) ? opts.index : null,
        el:       null,
    };
}

/** Forma pubblica (uscite dei nodi, OnMarkerClick): anche id_mrk/nome come i segnaposto del mod_spec. */
function _flowMarkerPublic(rec) {
    return {
        id: rec.id, id_mrk: rec.id, name: rec.label, nome: rec.label, group: rec.group,
        lat: rec.lat, lng: rec.lng, altitude: rec.altitude, source: 'flow', data: { ...rec.data },
    };
}

/** Stile effettivo: default ← stile del nodo ← color/glyph/icon del dato (se valorizzati). */
function _flowMarkerStyle(rec) {
    const s = { ...FLOW_STYLE_DEFAULT, ...rec.style };
    for (const k of ['color', 'glyph', 'icon']) {
        if (rec.data[k] != null && rec.data[k] !== '') s[k] = String(rec.data[k]);
    }
    return s;
}

/** Glifo del pin: icona (URL) · "@" iniziale dell'etichetta · "#" numero d'ordine · testo · vuoto = default Google. */
function _flowMarkerGlyph(s, rec) {
    if (s.icon) { try { return new URL(s.icon, location.href); } catch { /* testo sotto */ } }
    if (s.glyph === '@') return rec.label ? rec.label.trim().charAt(0).toUpperCase() : undefined;
    if (s.glyph === '#') return rec.index != null ? String(rec.index + 1) : undefined;
    return s.glyph ? String(s.glyph) : undefined;
}

function _dedupClick(fn) {
    let last = 0;
    return () => { const now = performance.now(); if (now - last < 300) return; last = now; fn(); };
}

function _buildFlowMarkerEl(state, object, rec) {
    const s = _flowMarkerStyle(rec);
    const pinOpts = {};
    if (s.color)       pinOpts.background  = s.color;
    if (s.borderColor) pinOpts.borderColor = s.borderColor;
    if (s.glyphColor)  pinOpts.glyphColor  = s.glyphColor;
    const scale = _finite(s.scale);
    if (scale != null && scale > 0 && scale !== 1) pinOpts.scale = scale;
    const glyph = _flowMarkerGlyph(s, rec);
    if (glyph !== undefined) pinOpts.glyph = glyph;
    const pin = new state.PinElementCls(pinOpts);
    const collisionBehavior = FLOW_COLLISION[s.collision] ?? 'REQUIRED';
    const zIndex = _finite(s.zIndex);
    const title = rec.label || rec.id;
    let el;

    if (state.mod_spec.type === '2D') {
        const wrap = document.createElement('div');
        wrap.className = 'mps-mrk';
        wrap.append(pin.element ?? pin);
        if (s.showLabel && rec.label) {
            const lb = document.createElement('span');
            lb.className = 'mps-mrk-label';
            lb.textContent = rec.label;
            wrap.append(lb);
        }
        el = new state.AdvMarkerCls({
            map: state.map, position: { lat: rec.lat, lng: rec.lng }, content: wrap, title,
            gmpClickable: rec.onClick !== 'none', collisionBehavior,
            ...(zIndex != null ? { zIndex } : {}),
        });
    } else {
        // altitudeMode: mesh = sopra edifici/terreno, ground = appoggiato, relative = sopra il
        // terreno, absolute = quota del dato (livello del mare) + height; senza quota → relative
        let altitudeMode = FLOW_ALT_MODES[s.altitudeMode] ?? 'RELATIVE_TO_MESH';
        let altitude = _finite(s.height) ?? 0;
        if (altitudeMode === 'ABSOLUTE') {
            if (rec.altitude == null) altitudeMode = 'RELATIVE_TO_GROUND';
            else altitude += rec.altitude;
        }
        el = new state.MarkerCls({
            position: { lat: rec.lat, lng: rec.lng, altitude },
            altitudeMode,
            extruded:          !!s.extruded && altitudeMode !== 'CLAMP_TO_GROUND',
            drawsWhenOccluded: !!s.occluded,
            sizePreserved:     true,
            label:             s.showLabel ? rec.label : '',
            title,
            collisionBehavior,
            ...(zIndex != null ? { zIndex } : {}),
        });
        el.append(pin);
        state.map.append(el);
    }

    if (rec.onClick !== 'none') {
        const onClick = _dedupClick(() => _onFlowMarkerClick(state, object, rec));
        el.addEventListener?.('gmp-click', onClick);
        if (state.mod_spec.type === '2D') el.addListener?.('click', onClick);
        else el.addEventListener?.('click', onClick);
    }
    return el;
}

function _onFlowMarkerClick(state, object, rec) {
    if (state.stopped) return;
    const pub = _flowMarkerPublic(rec);
    if (rec.onClick === 'select') {
        appBusEmit('selection:change', {
            objId: object?.obj_id ?? null, targetObjId: object?.obj_id ?? null,
            lat: pub.lat, lng: pub.lng, altitude: pub.altitude,
            nome: pub.nome, id_mrk: pub.id_mrk, group: pub.group,
        });
    }
    state.localEvents?.dispatchEvent(new CustomEvent('markerClick', { detail: pub }));
}

function _detachFlowMarker(rec) {
    try {
        if (rec.el instanceof HTMLElement && rec.el.localName?.startsWith('gmp-marker-3d')) rec.el.remove();
        else if (rec.el) rec.el.map = null;
    } catch { /* noop */ }
    rec.el = null;
}

/** Crea (o sostituisce, stesso id) un segnaposto. → { rec } oppure { error }. */
function _addFlowMarker(state, object, data, opts = {}) {
    if (!state.map || !state.PinElementCls) return { error: 'map not ready' };
    const rec = _flowMarkerRecord(data, opts);
    if (!rec) return { error: 'marker without valid lat/lng' };
    const old = state.flowMarkers.get(rec.id);
    if (old) { _detachFlowMarker(old); state.flowMarkers.delete(rec.id); }
    try { rec.el = _buildFlowMarkerEl(state, object, rec); }
    catch (e) { return { error: e?.message || String(e) }; }
    state.flowMarkers.set(rec.id, rec);
    return { rec: _flowMarkerPublic(rec) };
}

/** Cambia stile (fuso con quello attuale) e/o dati (lat/lng/etichetta...) di un segnaposto. */
function _updateFlowMarker(state, object, id, style, data) {
    const rec = state.flowMarkers.get(String(id ?? ''));
    if (!rec) return false;
    if (style && typeof style === 'object') rec.style = { ...rec.style, ...style };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        rec.data = { ...rec.data, ...data };
        const lat = _finite(rec.data.lat ?? rec.data.latitude);
        const lng = _finite(rec.data.lng ?? rec.data.lon ?? rec.data.longitude);
        if (lat != null && lng != null) { rec.lat = lat; rec.lng = lng; }
        rec.altitude = _finite(rec.data.altitude);
        rec.label = String(rec.data[rec.labelField] ?? rec.label);
    }
    _detachFlowMarker(rec);
    try { rec.el = _buildFlowMarkerEl(state, object, rec); }
    catch (e) { console.warn('[MPS] segnaposto non aggiornato:', e); state.flowMarkers.delete(rec.id); return false; }
    return true;
}

/** Toglie segnaposto: { id } · { group } · { all:true }. → quanti. */
function _removeFlowMarkers(state, sel = {}) {
    let n = 0;
    for (const [id, rec] of [...state.flowMarkers]) {
        const hit = sel.all || (sel.id != null && id === String(sel.id)) || (sel.group != null && rec.group === String(sel.group));
        if (!hit) continue;
        _detachFlowMarker(rec);
        state.flowMarkers.delete(id);
        n++;
    }
    return n;
}

function _listFlowMarkers(state, group) {
    const all = [...state.flowMarkers.values()];
    return (group ? all.filter(r => r.group === String(group)) : all).map(_flowMarkerPublic);
}

/** Distanza in metri (haversine). */
function _distanceM(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180, R = 6371000;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2
            + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Inquadra i segnaposto (di un gruppo o tutti). 2D: fitBounds. 3D: punto medio, quota media dei
 * dati che la hanno (altrimenti quella del punto guardato ora), range dal segnaposto più lontano.
 * → quanti inquadrati.
 */
function _fitFlowMarkers(state, group, opts = {}) {
    const recs = [...state.flowMarkers.values()].filter(r => !group || r.group === String(group));
    if (!recs.length || !state.map) return 0;
    if (state.mod_spec.type === '2D') {
        if (recs.length === 1) { state.map.panTo({ lat: recs[0].lat, lng: recs[0].lng }); return 1; }
        const b = new google.maps.LatLngBounds();
        for (const r of recs) b.extend({ lat: r.lat, lng: r.lng });
        state.map.fitBounds(b, _finite(opts.padding) ?? 60);
        return recs.length;
    }
    const lat = recs.reduce((s, r) => s + r.lat, 0) / recs.length;
    const lng = recs.reduce((s, r) => s + r.lng, 0) / recs.length;
    const alts = recs.map(r => r.altitude).filter(a => a != null);
    const far = Math.max(0, ...recs.map(r => _distanceM(lat, lng, r.lat, r.lng)));
    _applyView(state, {
        lat, lng,
        altitude: alts.length ? alts.reduce((s, a) => s + a, 0) / alts.length : null,
        range:    Math.max(DEFAULT_RANGE, far * 3.5),
        tilt:     state.map.tilt ?? 45,
        heading:  state.map.heading ?? 0,
    }, opts);
    return recs.length;
}

// ─── Export plugin ────────────────────────────────────────────────────────────

export default {

    async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
        destroyBodyInstance(bodyEl);

        const mod_spec = models?.[0]?.mod_spec ?? {};

        const state = {
            stopped:   false,
            bodyEl,    // pannello dei nodi ReseArch/Menu/* e /Panel/* (MPS-flow-runner.mjs)
            map:       null,
            markers:   [],
            MarkerCls: null,
            mod_spec,
            object,
            cmdUI,
            mod_id: models?.[0]?.mod_id ?? null,   // riferimento diagnostico (il salvataggio flow embedded ora avviene per obj_id, vedi FLE-api.mjs)
            // EventTarget locale, indipendente dall'App Bus — sorgente per i
            // nodi flow MPS/Events/* (es. OnMarkerClick). Vedi _emitMarkerSelection.
            localEvents: new EventTarget(),
            // segnaposto creati dai nodi MPS/Marker/Add* (id → record), 2D e 3D; vedi _addFlowMarker
            flowMarkers: new Map(),
        };
        bodyEl[STATE_KEY] = state;
        attachAbortCleanup(signal, bodyEl);

        // Metodi usati dai nodi flow embedded (MPS-flow-runner.mjs / MPS-flow-nodes.mjs) —
        // wrappano le funzioni module-level già usate da UI/App Bus, nessuna duplicazione.
        state.readView       = () => _readCurrentView(state);
        state.applyView      = (view, opts) => _applyView(state, view, opts);
        state.listMarkers    = () => state.mod_spec?.coordinates ?? [];
        state.goToMarker     = (id_mrk) => _goToMarker(state, object, id_mrk);
        state.viewToMarker   = (id_mrk) => _viewToMarker(state, id_mrk);
        state.setMarkerStyle = (id_mrk, colore) => _setMarkerStyle(state, id_mrk, colore);
        state.addFlowMarker     = (data, opts) => _addFlowMarker(state, object, data, opts);
        state.updateFlowMarker  = (id, style, data) => _updateFlowMarker(state, object, id, style, data);
        state.removeFlowMarkers = (sel) => _removeFlowMarkers(state, sel);
        state.listFlowMarkers   = (group) => _listFlowMarkers(state, group);
        state.fitFlowMarkers    = (group, opts) => _fitFlowMarkers(state, group, opts);

        bodyEl.style.position = bodyEl.style.position || 'relative';
        bodyEl.style.overflow = 'hidden';

        try {
            if (mod_spec.type === '2D') {
                await _initMap2D(bodyEl, mod_spec, state, object);
            } else {
                await _initMap3D(bodyEl, mod_spec, state, object);
            }
        } catch (err) {
            cmdUI?.show({ status: te('app.mps.err.map', { msg: err.message }), hints: '' });
            console.error('[MPS]', err);
            return;
        }

        // Flow embedded (Contesto 3): unico canale per costruire una
        // sincronizzazione fra pannelli — vedi nota sotto, sopra filter:apply.
        await mpsLoadFlows(state, object, signal);

        // ── App Bus: receiver ────────────────────────────────────────────────

        // data:refresh → ricarica i marker dal mod_spec
        appBusOn('data:refresh', msg => {
            if (!_shouldHandleMsg(msg, object)) return;
            const st = bodyEl[STATE_KEY];
            if (!st || st.stopped) return;
            if (st.mod_spec.type !== '2D') {
                _addMarkers3D(st.mod_spec.coordinates ?? [], st, object);
            }
        }, signal);

        // selection:change → pan 2D o fly-to 3D sulle coordinate ricevute
        appBusOn('selection:change', msg => {
            if (!_shouldHandleMsg(msg, object)) return;
            const st = bodyEl[STATE_KEY];
            if (!st?.map || st.stopped) return;
            const p = msg.payload ?? {};
            if (p.lat == null || p.lng == null) return;

            if (st.mod_spec.type === '2D') {
                st.map.panTo({ lat: p.lat, lng: p.lng });
            } else {
                // quota del segnaposto (livello del mare) o del punto guardato ora; range sempre
                _applyView(st, { lat: p.lat, lng: p.lng, altitude: p.altitude, tilt: 60 });
            }
        }, signal);

        // Nessun ascolto automatico di mps:view:changed: la sincronizzazione fra
        // pannelli avviene SOLO se costruita esplicitamente in un flow FLE
        // (App Bus Receiver sul pannello sorgente → MPS/Camera/FlyTo su quello
        // destinatario). Vedi MPS_sub_modules/MPS-flow-runner.mjs e
        // MPS-flow-nodes.mjs. L'emissione automatica a fine pan/zoom
        // (_onViewSettled → _publishView, sopra in _initMap2D/_initMap3D) resta
        // invece attiva: pubblicare sul bus è innocuo finché nessuno lo applica
        // senza che sia stato esplicitamente cablato.

        // filter:apply → mostra solo i marker il cui nome contiene il valore cercato
        appBusOn('filter:apply', msg => {
            if (!_shouldHandleMsg(msg, object)) return;
            const st = bodyEl[STATE_KEY];
            if (!st || st.stopped || st.mod_spec.type === '2D') return;
            const filters = msg.payload?.filters ?? {};

            const term = filters.nome ?? null;
            if (term == null) {
                // Nessun filtro → mostra tutti
                _addMarkers3D(st.mod_spec.coordinates ?? [], st, object);
            } else {
                const filtered = (st.mod_spec.coordinates ?? [])
                    .filter(c => String(c.nome ?? '').toLowerCase().includes(String(term).toLowerCase()));
                _addMarkers3D(filtered, st, object);
            }
        }, signal);

        cmdUI?.show({ status: te('app.mps.loaded'), hints: '' });
    },

    getLeftMenu({ object }) {
        return {
            title: getObjectDisplayName(object),
            items: [],
        };
    },

    getRightMenu({ bodyEl }) {
        return {
            title: '☰',
            items: [
                {
                    id:    'mps-reset',
                    label: t('app.mps.menu.reset_view'),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.map || !st.mod_spec) return;
                        const { geoCoord, zoom, type } = st.mod_spec;
                        if (type === '2D') {
                            st.map.setCenter({ lat: geoCoord[0], lng: geoCoord[1] });
                            st.map.setZoom(zoom ?? 10);
                        } else {
                            st.map.flyCameraTo({ endCamera: _initialCamera(st.mod_spec), durationMillis: 1000 });
                        }
                    },
                },
            ],
        };
    },

    getToolbar() {
        // Pubblicazione vista: solo automatica a fine pan/zoom (_onViewSettled).
        // Nessun pulsante manuale — l'applicazione da parte di altri pannelli
        // richiede comunque un flow esplicito (vedi renderBody).
        return { items: [] };
    },

    destroy() { /* cleanup gestito da AbortSignal / destroyBodyInstance */ },
};
