// TJS_sub_modules/TJS-pick-manager.mjs
// Raccolta di punti collimati sull'oggetto via raycast.
//
// Trigger raccolta:
//   - EyeLock:  Shift+LMB con reticolo → ctx.onPick(hit) → pickManager.addPoint(hit)
//   - Orbit:    Shift+LMB sul canvas → raycast da posizione mouse → addPoint
//
// I punti sono mantenuti in state.collimatedPoints[] SEMPRE MUTATO IN-PLACE
// (push/splice) — mai sostituito — così state.appContext.collimatedPoints
// punta al medesimo array e i nodi LiteGraph TJS/Pick/* leggono dati live.
//
// Persistenza: merge in mod_spec.collimatedPoints[] del primo modello
// via api/mod_spec_tool.php

import { THREE } from './TJS-loaders.mjs';
import {
    snapToNearestMeshVertex,
    correctPointHit,
    pickClosestPointCloud,
    resolveHit,
    resolveExistingHit,
} from './TJS-hit-utils.mjs';
import { tjsLookAtPoint } from './TJS-camera-utils.mjs';
import { tjsApplyPanoramaDepth } from './TJS-pano-depth.mjs';
import { t, te } from '../shared/i18n.mjs';
import { panelLevel } from '../shared/ui_level.mjs';

/** "Salva" scrive i punti nel mod_spec: solo dal livello autore (30). */
const _canEdit = (el) => panelLevel(el) >= 30;   // livello del pannello (_doc/arch-permessi.md §11.4)

/**
 * @param {object}   opts
 * @param {object}   opts.state       — stato TJS del pannello
 * @param {object[]} opts.models      — righe DB modelli (per mod_id salvataggio)
 * @param {Element}  opts.bodyEl      — contenitore pannello (livello, fallback di containerEl)
 * @param {Element}  [opts.containerEl] — colonna .tjs-rpanel dove montare la finestra
 * @param {object}   opts.scene       — THREE.Scene
 * @param {object}   opts.camera      — THREE.Camera
 * @param {object}   opts.renderer    — THREE.WebGLRenderer
 * @param {object}   opts.modelsRoot  — THREE.Group root dei modelli caricati
 * @param {object}   opts.cmdUI       — footer cmdUI del pannello (messaggi di stato)
 * @param {function} [opts.onClose]   — chiamato quando la X della finestra spegne lo strumento
 * @param {AbortSignal} opts.signal
 */
export function tjsCreatePickManager({
    state, models, bodyEl, containerEl,
    scene, camera, renderer, modelsRoot,
    cmdUI, onClose, signal,
}) {
    let _active      = false;
    let _panelEl     = null;
    let _snapEnabled = true;   // toggle Snap Vertex: ON=vertice più vicino, OFF=hit point raw

    // ── Marcatori 3D — crosshair a 3 cerchi + 3 diametri ─────────────────────
    // Un template viene creato una volta nell'origine; per ogni punto acquisito
    // si clona il gruppo e si posiziona al punto catturato.
    // I cerchi di diametro unitario (r=0.5) sono orientati sui tre piani principali:
    //   XZ → rosso  |  XY → verde  |  ZY → blu
    // depthTest:false → sempre visibili anche quando occultati da mesh.
    let _markerScale = 1.0;

    const _markerTemplate = tjsCreateCrosshairTemplate();
    const _markerGroup    = new THREE.Group();
    _markerGroup.name     = 'TJS_PICK_MARKERS';
    scene.add(_markerGroup);

    // ── Orbit-mode pick: Shift+LMB → raycast da mouse ─────────────────────────
    let _pdX = 0, _pdY = 0;
    const DRAG_THR = 5; // px: sopra questa soglia era drag, non click

    renderer.domElement.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;   // traccia solo LMB per non falsare la soglia
        _pdX = e.clientX; _pdY = e.clientY;
    }, { signal });

    renderer.domElement.addEventListener('pointerup', e => {
        if (!_active) return;
        if (state.activeControls !== 'orbit') return;  // EyeLock gestito via onPick
        if (e.button !== 0 || !e.shiftKey) return;
        if (Math.abs(e.clientX - _pdX) > DRAG_THR ||
            Math.abs(e.clientY - _pdY) > DRAG_THR) return;

        const rect = renderer.domElement.getBoundingClientRect();
        const ndc  = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width)  *  2 - 1,
           -((e.clientY - rect.top)  / rect.height) *  2 + 1,
        );
        const rc = new THREE.Raycaster();
        rc.setFromCamera(ndc, state.camera);  // state.camera: aggiornato da cameraManager

        const targets = modelsRoot ? [modelsRoot] : scene.children;
        const hit = resolveHit(rc, targets, _snapEnabled, state.pointHitFilter);   // scarta parti tagliate e piani
        if (hit) _ingest(hit);
    }, { signal });

    // ── Core: acquisisce un hit e lo aggiunge alla lista ──────────────────────

    function _ingest(hit) {
        // Sfera panoramica con mappa delle distanze: il punto è quello 3D (TJS-pano-depth.mjs)
        const dp = tjsApplyPanoramaDepth(hit);
        if (dp?.pending) { cmdUI?.update?.({ status: te('app.tjs.pano.depth_pending') }); return; }
        if (dp?.invalid) { cmdUI?.update?.({ status: te('app.tjs.pano.depth_invalid') }); return; }
        if (dp) hit = dp;
        const pos = hit.point;

        // Normale in world space (solo per Mesh con face; Points non ha face)
        let n = null;
        if (hit.face?.normal) {
            n = hit.face.normal.clone()
                .transformDirection(hit.object.matrixWorld)
                .normalize();
        }

        const idx = state.collimatedPoints.length + 1;
        const pt  = {
            id:        _uid(),
            label:     `P${idx}`,
            position:  { x: pos.x, y: pos.y, z: pos.z },
            normal:    n ? { x: n.x, y: n.y, z: n.z } : null,
            // (2026-10-03) stessi dati di intersezione dei nodi TJS/Events/*:
            // face = indice del triangolo, uv/uv1 = coordinate di mappa (null senza UV)
            face:          hit.faceIndex ?? null,
            materialIndex: hit.face?.materialIndex ?? null,
            uv:            hit.uv  ? { u: hit.uv.x,  v: hit.uv.y }  : null,
            uv1:           hit.uv1 ? { u: hit.uv1.x, v: hit.uv1.y } : null,
            objName:   hit.object?.name || null,
            // punto ricavato dalla mappa delle distanze di una panoramica (null altrimenti):
            // { distance, raw, scale, units, sphere (uuid), spherePoint }
            panoDepth: hit.panoDepth ? { ...hit.panoDepth, spherePoint: _xyz(hit.panoDepth.spherePoint) } : null,
            timestamp: new Date().toISOString(),
        };

        state.collimatedPoints.push(pt);   // in-place → appContext ref rimane valida
        _addMarker(pt);
        _refreshPanel();
        cmdUI?.update?.({ status: te('app.tjs.pick.acquired', { label: pt.label, n: state.collimatedPoints.length }) });
        state.markDirty?.();
    }

    function _addMarker(pt) {
        // Clona il template (geometry e material CONDIVISI — non duplicati in memoria)
        const grp = _markerTemplate.clone();
        grp.position.set(pt.position.x, pt.position.y, pt.position.z);
        grp.scale.setScalar(_markerScale);
        grp.name            = `TJS_PICK_${pt.id}`;
        grp.userData.pickId = pt.id;
        _markerGroup.add(grp);
    }

    function _removeMarker(id) {
        const grp = _markerGroup.children.find(c => c.userData.pickId === id);
        if (grp) _markerGroup.remove(grp);
        // Geometry/material condivisi con il template: NON fare dispose qui
    }

    /** Aggiorna la scala di tutti i marker esistenti. */
    function _applyScaleToAll() {
        for (const grp of _markerGroup.children) {
            grp.scale.setScalar(_markerScale);
        }
    }

    function _uid() {
        return Math.random().toString(36).slice(2, 10);
    }

    function _xyz(v) {
        return v ? { x: v.x, y: v.y, z: v.z } : null;
    }

    // ── Finestra laterale (colonna .tjs-rpanel, come Oggetti scena / Luci) ────

    function _buildPanel() {
        const el = document.createElement('div');
        el.id = 'tjsPickPanel';
        el.className = 'tjs-rpanel-item';

        el.innerHTML = `
            <div class="tjs-rpanel-hdr">
                <span class="tjs-rpanel-hdr-title">
                    <i class="bi bi-geo-alt-fill" style="color:#fbbf24" aria-hidden="true"></i> ${te('app.tjs.pick.title')}
                    <span id="tjsPkCount" style="color:#6b7280;font-weight:normal;text-transform:none;letter-spacing:0"></span>
                </span>
                <div class="tjs-rpanel-hdr-btns">
                    <button type="button" class="tjs-rpanel-hdr-btn" id="tjsPkClose"
                            title="${te('common.close')}" aria-label="${te('common.close')}">
                        <i class="bi bi-x-lg" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            <div class="tjs-rpanel-tool-body">
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:3px 0;border-bottom:1px solid #374151">
                <span style="font-size:10px;color:#6b7280">${te('app.tjs.tool.shift_click')}</span>
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;
                              font-size:11px;color:#d1d5db;user-select:none">
                    <input type="checkbox" id="tjsPkSnap" ${_snapEnabled ? 'checked' : ''}
                           style="accent-color:#fbbf24;cursor:pointer">
                    ${te('app.tjs.tool.snap_vertex')}
                </label>
            </div>

            <div style="display:flex;align-items:center;gap:6px;padding:2px 0">
                <label for="tjsPkScale" style="font-size:11px;color:#9ca3af;flex:1;margin:0">${te('app.tjs.tool.marker_scale')}</label>
                <input type="number" id="tjsPkScale" value="${_markerScale}" min="0.01" step="0.1"
                       style="width:60px;background:#1f2937;border:1px solid #374151;
                              border-radius:3px;color:#d1d5db;font-size:11px;
                              padding:1px 4px;text-align:right">
                <span style="font-size:10px;color:#6b7280">× ⬤
                    <span style="color:#ff3333">XZ</span>
                    <span style="color:#33cc55">XY</span>
                    <span style="color:#3399ff">ZY</span>
                </span>
            </div>

            <div id="tjsPkList" class="tjs-rpanel-tool-list"></div>
            <div style="display:flex;gap:4px">
                <button id="tjsPkClear" class="btn btn-sm btn-outline-danger"
                        style="flex:1;font-size:11px">
                    <i class="bi bi-trash" aria-hidden="true"></i> ${te('app.tjs.pick.clear')}
                </button>
                <button id="tjsPkSave" class="btn btn-sm btn-outline-success"
                        style="flex:1;font-size:11px;${_canEdit(bodyEl) ? '' : 'display:none'}">
                    <i class="bi bi-cloud-arrow-up" aria-hidden="true"></i> ${te('common.save')}
                </button>
            </div>
            </div>
        `;

        (containerEl ?? bodyEl).appendChild(el);

        // La X spegne lo strumento: model_TJS aggiorna il pulsante della toolbar
        el.querySelector('#tjsPkClose').addEventListener('click', () => {
            setActive(false);
            onClose?.();
        });

        el.querySelector('#tjsPkClear').addEventListener('click', () => {
            if (state.collimatedPoints.length && !confirm(t('app.tjs.pick.clear_confirm'))) return;
            clear();
        });

        el.querySelector('#tjsPkSave').addEventListener('click', () => {
            const modId = _firstModId();
            if (!modId) { alert(t('app.tjs.pick.no_model.@')); return; }
            saveToModSpec(modId);
        });

        el.querySelector('#tjsPkSnap').addEventListener('change', e => {
            _snapEnabled = e.target.checked;
        });

        el.querySelector('#tjsPkScale').addEventListener('change', e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) {
                _markerScale = v;
                _applyScaleToAll();
                state.markDirty?.();
            }
        });

        return el;
    }

    function _refreshPanel() {
        if (!_panelEl) return;

        const list  = _panelEl.querySelector('#tjsPkList');
        const count = _panelEl.querySelector('#tjsPkCount');
        if (!list) return;

        count.textContent = t('app.tjs.pick.count', { n: state.collimatedPoints.length });
        list.innerHTML    = '';

        for (const pt of state.collimatedPoints) {
            const p   = pt.position;
            const fmt = v => v.toFixed(3);
            const coords  = `(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`;
            const depthTxt = pt.panoDepth ? ` | ${t('app.tjs.pano.depth_tip', { d: pt.panoDepth.distance.toFixed(3) })}` : '';
            const tooltip = `${coords}${pt.objName ? ' | ' + pt.objName : ''}${depthTxt}`;

            const row = document.createElement('div');
            row.style.cssText = [
                'display:flex', 'align-items:center', 'gap:4px',
                'padding:3px 2px', 'border-bottom:1px solid #1f2937',
            ].join(';');

            row.innerHTML = `
                <span style="color:#fbbf24;min-width:28px;font-weight:bold">${pt.label}${pt.panoDepth ? '<sup title="' + te('app.tjs.pano.depth_mark') + '">d</sup>' : ''}</span>
                <span style="flex:1;font-size:10px;color:#9ca3af;
                             overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                      title="${tooltip}">${coords}</span>
                <button class="tjsPkLook"
                        style="background:none;border:none;color:#60a5fa;
                               cursor:pointer;padding:0 4px;font-size:13px;line-height:1"
                        title="${te('app.tjs.pick.look')}" aria-label="${te('app.tjs.pick.look')}">
                    <i class="bi bi-eye" aria-hidden="true"></i>
                </button>
                <button class="tjsPkDel"
                        style="background:none;border:none;color:#ef4444;
                               cursor:pointer;padding:0 4px;font-size:16px;line-height:1"
                        title="${te('app.tjs.pick.delete')}" aria-label="${te('app.tjs.pick.delete')}"><span aria-hidden="true">×</span></button>
            `;
            row.querySelector('.tjsPkLook').addEventListener('click', () => _lookAtPoint(pt));
            row.querySelector('.tjsPkDel').addEventListener('click',  () => removePoint(pt.id));
            list.appendChild(row);
        }
    }

    /**
     * Ruota la vista verso il punto collimato senza spostare la camera.
     *
     * Orbit mode: sposta orbit.target sul punto → la camera orbita/guarda verso di esso
     *             dalla posizione corrente (stesso effetto di "porta target sul pivot").
     * EyeLock mode: calcola yaw/pitch della direzione camera→punto e li applica
     *               all'EyeLockControls (camera ferma, solo rotazione).
     */
    function _lookAtPoint(pt) {
        tjsLookAtPoint(pt.position, state);
    }

    function _firstModId() {
        return (Array.isArray(models) ? models : [])[0]?.mod_id ?? null;
    }

    // ── API pubblica ──────────────────────────────────────────────────────────

    /**
     * Chiamato da onPick in model_TJS (EyeLock Shift+LMB con reticolo).
     * Ignorato se pick mode non è attivo.
     */
    function addPoint(hit) {
        if (!_active || !hit) return;
        const resolved = resolveExistingHit(hit, _snapEnabled);
        if (resolved) _ingest(resolved);
    }

    /** Attiva/disattiva modalità raccolta e mostra/nasconde pannello. */
    function setActive(val) {
        _active = Boolean(val);
        _markerGroup.visible = _active;   // marker visibili solo quando il pannello è aperto
        if (_active && !_panelEl) _panelEl = _buildPanel();
        if (_panelEl) _panelEl.style.display = _active ? 'flex' : 'none';
        if (_active) _refreshPanel();
        state.markDirty?.();
    }

    function isActive() { return _active; }

    /** Cancella tutti i punti (array mutato in-place, marker rimossi dalla scena). */
    function clear() {
        _markerGroup.clear();   // geometry/material condivisi con template → non fare dispose
        state.collimatedPoints.splice(0);   // in-place
        _refreshPanel();
        cmdUI?.update?.({ status: te('app.tjs.pick.cleared') });
        state.markDirty?.();
    }

    /** Rimuove un singolo punto per id. */
    function removePoint(id) {
        _removeMarker(id);
        const idx = state.collimatedPoints.findIndex(p => p.id === id);
        if (idx !== -1) state.collimatedPoints.splice(idx, 1);
        // Ricalcola etichette progressive
        state.collimatedPoints.forEach((p, i) => { p.label = `P${i + 1}`; });
        state.markDirty?.();
        _refreshPanel();
    }

    /** Salva punti in mod_spec del primo modello (merge, non sovrascrittura). */
    async function saveToModSpec(modId) {
        try {
            cmdUI?.update?.({ status: te('app.tjs.pick.saving') });

            // Leggi mod_spec attuale per fare merge
            const getRes  = await fetch(`api/mod_spec_tool.php?action=load&mod_id=${modId}`);
            const getData = await getRes.json();
            const raw     = getData?.data?.mod_spec ?? {};
            const spec    = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});

            // Sostituisce solo la chiave collimatedPoints
            spec.collimatedPoints = state.collimatedPoints.map(p => ({ ...p }));

            const postRes = await fetch('api/mod_spec_tool.php', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ action: 'save', mod_id: modId, mod_spec: spec }),
            });
            const postData = await postRes.json();
            if (!postData.ok) throw new Error(postData.error ?? 'save failed');

            cmdUI?.update?.({
                status: te('app.tjs.pick.saved', { n: state.collimatedPoints.length, id: modId }),
            });
        } catch (err) {
            console.error('[TJS-pick-manager] saveToModSpec:', err);
            cmdUI?.update?.({ status: te('app.tjs.pick.save_error', { error: err.message }) });
        }
    }

    /**
     * Ripristina punti da array (es. da mod_spec al caricamento del pannello).
     * Svuota prima lo stato corrente, poi aggiunge in-place.
     */
    function loadPoints(pts) {
        if (!Array.isArray(pts) || !pts.length) return;
        clear();  // rimuove marker esistenti e svuota in-place
        for (const pt of pts) {
            state.collimatedPoints.push(pt);
            _addMarker(pt);
        }
        _refreshPanel();
        state.markDirty?.();
        console.log(`[TJS-pick-manager] caricati ${pts.length} punti da mod_spec`);
    }

    /**
     * Nuova scala della mappa delle distanze di una sfera (TJS/Panorama/Depth Scale con apply):
     * i punti misurati su quella sfera si allontanano/avvicinano al centro di conseguenza.
     */
    function rescaleDepthPoints(sphere, newScale) {
        if (!sphere?.isObject3D || !(newScale > 0)) return 0;
        const c = sphere.getWorldPosition(new THREE.Vector3());
        let n = 0;
        for (const pt of state.collimatedPoints) {
            const pd = pt.panoDepth;
            if (!pd || pd.sphere !== sphere.uuid || !(pd.scale > 0)) continue;
            const f = newScale / pd.scale;
            const p = new THREE.Vector3(pt.position.x, pt.position.y, pt.position.z).sub(c).multiplyScalar(f).add(c);
            pt.position = { x: p.x, y: p.y, z: p.z };
            pd.distance *= f;
            pd.scale = newScale;
            const grp = _markerGroup.children.find(g => g.userData.pickId === pt.id);
            grp?.position.copy(p);
            n++;
        }
        if (n) { _refreshPanel(); state.markDirty?.(); }
        return n;
    }

    /** Cleanup risorse (chiamato da destroyBodyInstance o AbortSignal). */
    function dispose() {
        _markerGroup.clear();
        _markerGroup.parent?.remove(_markerGroup);
        // Dispose del template (geometry + material di tutte le line del crosshair)
        _markerTemplate.traverse(obj => {
            obj.geometry?.dispose();
            obj.material?.dispose();
        });
        _panelEl?.remove();
        _panelEl = null;
    }

    /**
     * Fallback EyeLock per point cloud: cerca il vertice più vicino alla retta del raggio.
     * Chiamato da model_TJS.mjs quando onPick riceve null (nessun hit standard).
     * In Snap OFF viene ignorato (la modalità raw non ha senso come fallback).
     */
    function tryPickFromRay(ray, targets) {
        if (!_active || !_snapEnabled) return;
        const closest = pickClosestPointCloud(ray, targets, state.pointHitFilter);
        if (closest) _ingest(closest);
    }

    signal?.addEventListener('abort', dispose, { once: true });

    return { addPoint, setActive, isActive, clear, removePoint,
             saveToModSpec, loadPoints, tryPickFromRay, rescaleDepthPoints, dispose };
}

// ── Template crosshair (esportato) ───────────────────────────────────────────
// Crea il template dei marker crosshair.
// withArcs: true  → 3 cerchi + 3 diametri  (pick-manager, stile completo)
//           false → solo 3 diametri          (measure-tool, stile minimo)
// Diametro unitario (r = 0.5). Piani principali:
//   XZ → rosso  |  XY → verde  |  ZY → blu
// depthTest:false → sempre visibili sopra la geometria.
export function tjsCreateCrosshairTemplate({ withArcs = true } = {}) {
    const r    = 0.5;
    const SEGS = 48;
    const tpl  = new THREE.Group();
    tpl.name   = 'TJS_CROSSHAIR_TEMPLATE';

    const RED   = 0xff3333;
    const GREEN = 0x33cc55;
    const BLUE  = 0x3399ff;

    function makeCircle(color, rx, ry, rz) {
        const curve = new THREE.EllipseCurve(0, 0, r, r, 0, 2 * Math.PI, false, 0);
        const pts   = curve.getPoints(SEGS);
        pts.push(pts[0].clone());
        const geo  = new THREE.BufferGeometry().setFromPoints(pts);
        const mat  = new THREE.LineBasicMaterial({ color, depthTest: false, toneMapped: false });
        const loop = new THREE.Line(geo, mat);
        loop.renderOrder = 999;
        loop.rotation.set(rx, ry, rz);
        return loop;
    }

    function makeLine(color, p1, p2) {
        const geo  = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...p1),
            new THREE.Vector3(...p2),
        ]);
        const mat  = new THREE.LineBasicMaterial({ color, depthTest: false, toneMapped: false });
        const line = new THREE.Line(geo, mat);
        line.renderOrder = 999;
        return line;
    }

    if (withArcs) tpl.add(makeCircle(RED,  -Math.PI / 2, 0, 0));
    tpl.add(makeLine(RED,   [-r, 0, 0], [r, 0, 0]));

    if (withArcs) tpl.add(makeCircle(GREEN, 0, 0, 0));
    tpl.add(makeLine(GREEN, [0, -r, 0], [0, r, 0]));

    if (withArcs) tpl.add(makeCircle(BLUE,  0, Math.PI / 2, 0));
    tpl.add(makeLine(BLUE,  [0, 0, -r], [0, 0, r]));

    return tpl;
}

