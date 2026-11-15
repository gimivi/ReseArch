// TJS_sub_modules/TJS-measure-tool.mjs
// Strumento di misura della distanza fra due punti selezionati via Shift+click.
//
// Funzionalità:
//   - Marker crosshair a 3 linee (senza archi) sul punto misurato
//   - Linea che unisce A e B con sprite di testo al centro (sempre leggibile)
//   - Misure cumulative M1, M2, ..., Mn conservate nella lista
//   - dX, dY, dZ + distanza totale, arrotondamento standard a 2 cifre decimali
//   - Scala marker regolabile (come Collima punti)
//   - "Look at" midpoint per ogni misura (stessa logica di Collima punti)
//   - EyeLock via addPoint(hit); Orbit via pointerup Shift+LMB
//   - Hit detection e look-at condivise con TJS-pick-manager

import { THREE } from './TJS-loaders.mjs';
import { resolveHit, resolveExistingHit, pickClosestPointCloud } from './TJS-hit-utils.mjs';
import { tjsCreateCrosshairTemplate } from './TJS-pick-manager.mjs';
import { tjsLookAtPoint } from './TJS-camera-utils.mjs';
import { tjsApplyPanoramaDepth } from './TJS-pano-depth.mjs';
import { t, te } from '../shared/i18n.mjs';

// Sprite canvas resolution (texture quality, non dimensione world)
const SPRITE_W = 320;
const SPRITE_H = 54;

const LINE_COLOR = 0xffff00;

/**
 * @param {object}      opts
 * @param {object}      opts.scene
 * @param {object}      opts.camera
 * @param {object}      opts.renderer
 * @param {object}      opts.modelsRoot
 * @param {function}    [opts.getActiveControls]  — () => 'orbit'|'eyelock'
 * @param {function}    [opts.getState]           — () => TJS state (per look-at)
 * @param {Element}     [opts.containerEl]        — colonna .tjs-rpanel dove montare la finestra
 * @param {object}      opts.cmdUI                — footer (messaggi di stato)
 * @param {function}    [opts.onClose]            — chiamato quando la X della finestra spegne lo strumento
 * @param {AbortSignal} opts.signal
 */
export function tjsCreateMeasureTool({
    scene, camera, renderer, modelsRoot,
    getActiveControls,
    getState,
    markDirty,
    containerEl,
    cmdUI, onClose, signal,
}) {
    // ── Stato ─────────────────────────────────────────────────────────────────
    let _active         = false;
    let _phase          = 0;         // 0 = attende A  |  1 = attende B
    let _ptA            = null;      // THREE.Vector3 — punto pendente
    let _pendingMarkerA = null;      // clone template pendente (fase 1)
    let _measurements   = [];        // misure completate
    let _measureCounter = 0;         // ID ever-increasing
    let _snapEnabled    = false;
    let _markerScale    = 1.0;
    let _panelEl        = null;

    // ── Gruppo 3D ──────────────────────────────────────────────────────────────
    const _group   = new THREE.Group();
    _group.name    = 'TJS_MEASURE_GROUP';
    _group.visible = false;
    scene.add(_group);

    // ── Template crosshair senza archi (condiviso con pick-manager, solo linee) ─
    const _markerTemplate = tjsCreateCrosshairTemplate({ withArcs: false });

    // ── Helpers 3D ────────────────────────────────────────────────────────────

    function _makeMarker() {
        const grp = _markerTemplate.clone();
        grp.renderOrder = 999;
        return grp;
    }

    function _makeLine(pA, pB) {
        const geo = new THREE.BufferGeometry().setFromPoints([pA, pB]);
        const mat = new THREE.LineBasicMaterial({
            color: LINE_COLOR, depthTest: false, toneMapped: false,
        });
        const l   = new THREE.Line(geo, mat);
        l.renderOrder = 999;
        return l;
    }

    // Sprite: testo solo distanza (es. "1.23"), canvas come texture ad alta risoluzione.
    // La dimensione world-space è controllata da _setSpriteScale() via _markerScale.
    function _makeLabelSprite(dist) {
        const canvas  = document.createElement('canvas');
        canvas.width  = SPRITE_W;
        canvas.height = SPRITE_H;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = 'rgba(8, 8, 22, 0.88)';
        ctx.fillRect(0, 0, SPRITE_W, SPRITE_H);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth   = 2;
        ctx.strokeRect(1, 1, SPRITE_W - 2, SPRITE_H - 2);

        ctx.fillStyle    = '#facc15';
        ctx.font         = 'bold 28px monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(_fmt2(dist), SPRITE_W / 2, SPRITE_H / 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;

        const mat   = new THREE.SpriteMaterial({
            map: tex, depthTest: false, toneMapped: false, transparent: true,
        });
        const sprite       = new THREE.Sprite(mat);
        sprite.renderOrder = 1000;
        _setSpriteScale(sprite);
        return sprite;
    }

    // Scala world-space dello sprite: proporzionale a _markerScale.
    // Il canvas è ad alta risoluzione (320×54) ma la dimensione world è piccola.
    function _setSpriteScale(sprite) {
        const aspect = SPRITE_W / SPRITE_H;
        const h      = 0.35 * _markerScale;   // altezza in unità world
        sprite.scale.set(aspect * h, h, 1);
    }

    // ── Dispose per singola misura ─────────────────────────────────────────────
    // Marker: geometry/material condivisi con template → solo remove, no dispose
    // Line + sprite: risorse proprie → dispose
    function _disposeMeasurement(m) {
        _group.remove(m.markerA);
        _group.remove(m.markerB);
        if (m.lineObj) {
            m.lineObj.geometry?.dispose();
            m.lineObj.material?.dispose();
            _group.remove(m.lineObj);
        }
        if (m.labelSprite) {
            m.labelSprite.material?.map?.dispose();
            m.labelSprite.material?.dispose();
            _group.remove(m.labelSprite);
        }
    }

    // ── Arrotondamento standard a 2 cifre decimali ────────────────────────────
    // Cifra dopo la 2ª: 0-4 → per difetto; 5-9 → per eccesso. Valore unico.
    function _fmt2(v) {
        return (Math.round(v * 100) / 100).toFixed(2);
    }

    // ── Drag threshold ────────────────────────────────────────────────────────
    let _pdX = 0, _pdY = 0;
    const DRAG_THR = 5;

    renderer.domElement.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;   // traccia solo LMB per non falsare la soglia
        _pdX = e.clientX; _pdY = e.clientY;
    }, { signal });

    // Orbit mode: Shift+LMB → raycast + hit resolution condivisa
    renderer.domElement.addEventListener('pointerup', e => {
        if (!_active) return;
        if (getActiveControls?.() === 'eyelock') return;
        if (e.button !== 0 || !e.shiftKey) return;
        if (Math.abs(e.clientX - _pdX) > DRAG_THR ||
            Math.abs(e.clientY - _pdY) > DRAG_THR) return;

        const rect = renderer.domElement.getBoundingClientRect();
        const ndc  = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width)  *  2 - 1,
           -((e.clientY - rect.top)  / rect.height) *  2 + 1,
        );
        const rc      = new THREE.Raycaster();
        const cam     = getState?.()?.camera ?? camera;   // camera live (cameraManager)
        rc.setFromCamera(ndc, cam);
        const targets = modelsRoot ? [modelsRoot] : scene.children.filter(c => c !== _group);

        const hit = resolveHit(rc, targets, _snapEnabled, getState?.()?.pointHitFilter);   // scarta parti tagliate e piani
        if (hit) _pickHit(hit);
    }, { signal });

    // Sfera panoramica con mappa delle distanze: si misura fra i punti 3D (TJS-pano-depth.mjs)
    function _pickHit(hit) {
        const dp = tjsApplyPanoramaDepth(hit);
        if (dp?.pending) { cmdUI?.update?.({ status: te('app.tjs.pano.depth_pending') }); return; }
        if (dp?.invalid) { cmdUI?.update?.({ status: te('app.tjs.pano.depth_invalid') }); return; }
        _onPick((dp ?? hit).point.clone());
    }

    // ── State machine ─────────────────────────────────────────────────────────
    function _onPick(worldPt) {
        if (_phase === 0) {
            // — Acquisisce A —
            _ptA            = worldPt;
            _phase          = 1;
            _pendingMarkerA = _makeMarker();
            _pendingMarkerA.position.copy(_ptA);
            _pendingMarkerA.scale.setScalar(_markerScale);
            _group.add(_pendingMarkerA);
            cmdUI?.update?.({ status: te('app.tjs.measure.point_a_acquired') });
            _refreshPanel();
            markDirty?.();

        } else if (_phase === 1) {
            // — Acquisisce B → completa misura —
            const ptB     = worldPt;
            const markerA = _pendingMarkerA;
            _pendingMarkerA = null;
            _phase = 0;

            const markerB = _makeMarker();
            markerB.position.copy(ptB);
            markerB.scale.setScalar(_markerScale);
            _group.add(markerB);

            const lineObj = _makeLine(_ptA, ptB);
            _group.add(lineObj);

            const dX   = ptB.x - _ptA.x;
            const dY   = ptB.y - _ptA.y;
            const dZ   = ptB.z - _ptA.z;
            const dist = _ptA.distanceTo(ptB);

            _measureCounter++;
            const id = `M${_measureCounter}`;

            const mid = new THREE.Vector3().addVectors(_ptA, ptB).multiplyScalar(0.5);
            const labelSprite = _makeLabelSprite(dist);
            labelSprite.position.copy(mid);
            _group.add(labelSprite);

            _measurements.push({
                id,
                ptA: _ptA.clone(), ptB: ptB.clone(),
                mid: mid.clone(),
                dX, dY, dZ, dist,
                markerA, markerB, lineObj, labelSprite,
            });
            _ptA = null;

            cmdUI?.update?.({
                status: te('app.tjs.measure.done', { id, dist: dist.toFixed(4) }),
            });
            _refreshPanel();
            markDirty?.();
        }
    }

    // ── Finestra laterale (colonna .tjs-rpanel, come Oggetti scena / Luci) ──
    function _buildPanel() {
        const el = document.createElement('div');
        el.id = 'tjsMeasurePanel';
        el.className = 'tjs-rpanel-item';

        el.innerHTML = `
            <div class="tjs-rpanel-hdr">
                <span class="tjs-rpanel-hdr-title">
                    <i class="bi bi-rulers" style="color:#facc15" aria-hidden="true"></i> ${te('app.tjs.measure.title')}
                    <span id="tjsMsCount" style="color:#6b7280;font-weight:normal;text-transform:none;letter-spacing:0"></span>
                </span>
                <div class="tjs-rpanel-hdr-btns">
                    <button type="button" class="tjs-rpanel-hdr-btn" id="tjsMsClose"
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
                    <input type="checkbox" id="tjsMsSnap" ${_snapEnabled ? 'checked' : ''}
                           style="accent-color:#facc15;cursor:pointer">
                    ${te('app.tjs.tool.snap_vertex')}
                </label>
            </div>

            <div style="display:flex;align-items:center;gap:6px;padding:2px 0">
                <label for="tjsMsScale" style="font-size:11px;color:#9ca3af;flex:1;margin:0">${te('app.tjs.tool.marker_scale')}</label>
                <input type="number" id="tjsMsScale" value="${_markerScale}"
                       min="0.01" step="0.1"
                       style="width:60px;background:#1f2937;border:1px solid #374151;
                              border-radius:3px;color:#d1d5db;font-size:11px;
                              padding:1px 4px;text-align:right">
                <span style="font-size:10px;color:#6b7280">× +</span>
            </div>

            <div id="tjsMsStatus" role="status" aria-live="polite"
                 style="font-size:11px;color:#9ca3af;padding:2px 0;
                        border-bottom:1px solid #1f2937;min-height:16px">
            </div>

            <div id="tjsMsList" class="tjs-rpanel-tool-list"></div>

            <button id="tjsMsClearAll" class="btn btn-sm btn-outline-danger"
                    style="font-size:11px">
                <i class="bi bi-trash" aria-hidden="true"></i> ${te('app.tjs.measure.clear_all')}
            </button>
            </div>
        `;

        // La X spegne lo strumento: model_TJS aggiorna il pulsante della toolbar
        el.querySelector('#tjsMsClose').addEventListener('click', () => {
            setActive(false);
            onClose?.();
        });

        el.querySelector('#tjsMsSnap').addEventListener('change', e => {
            _snapEnabled = e.target.checked;
        });

        el.querySelector('#tjsMsScale').addEventListener('change', e => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) { _markerScale = v; _applyScaleToAll(); markDirty?.(); }
        });

        el.querySelector('#tjsMsClearAll').addEventListener('click', () => {
            if (_measurements.length && !confirm(t('app.tjs.measure.clear_all_confirm'))) return;
            clearAll();
        });

        return el;
    }

    function _refreshPanel() {
        if (!_panelEl) return;

        // Status in corso
        const statusEl = _panelEl.querySelector('#tjsMsStatus');
        if (statusEl) {
            statusEl.textContent = _phase === 1
                ? t('app.tjs.measure.status_b')
                : (_measurements.length ? t('app.tjs.measure.status_next') : t('app.tjs.measure.status_a'));
        }

        const countEl = _panelEl.querySelector('#tjsMsCount');
        if (countEl) countEl.textContent = t('app.tjs.measure.count', { n: _measurements.length });

        const listEl = _panelEl.querySelector('#tjsMsList');
        if (!listEl) return;
        listEl.innerHTML = '';

        for (const m of _measurements) {
            const row = document.createElement('div');
            row.style.cssText = [
                'padding:5px 4px',
                'border-bottom:1px solid #1f2937',
                'display:flex', 'flex-direction:column', 'gap:3px',
            ].join(';');

            // Header: ID + look-at + elimina
            const hdr = document.createElement('div');
            hdr.style.cssText = 'display:flex;align-items:center;gap:4px';
            hdr.innerHTML = `
                <span style="color:#facc15;font-weight:bold;font-size:12px;flex:1">${m.id}</span>
                <button class="tjsMsLook"
                        style="background:none;border:none;color:#60a5fa;
                               cursor:pointer;padding:0 4px;font-size:13px;line-height:1"
                        title="${te('app.tjs.measure.look_mid')}" aria-label="${te('app.tjs.measure.look_mid')}">
                    <i class="bi bi-eye" aria-hidden="true"></i>
                </button>
                <button class="tjsMsDel"
                        style="background:none;border:none;color:#ef4444;
                               cursor:pointer;padding:0 4px;font-size:16px;line-height:1"
                        title="${te('app.tjs.measure.delete')}" aria-label="${te('app.tjs.measure.delete')}"><span aria-hidden="true">×</span></button>
            `;
            hdr.querySelector('.tjsMsLook').addEventListener('click', () => {
                const st = getState?.();
                if (st) tjsLookAtPoint(m.mid, st);
            });
            hdr.querySelector('.tjsMsDel').addEventListener('click', () => removeMeasurement(m.id));
            row.appendChild(hdr);

            // Componenti dX dY dZ
            const comps = document.createElement('div');
            comps.style.cssText = 'font-size:10px;color:#9ca3af;display:flex;gap:8px';
            comps.innerHTML = `
                <span><span style="color:#f87171">X</span> ${_fmt2(m.dX)}</span>
                <span><span style="color:#4ade80">Y</span> ${_fmt2(m.dY)}</span>
                <span><span style="color:#60a5fa">Z</span> ${_fmt2(m.dZ)}</span>
            `;
            row.appendChild(comps);

            // Distanza totale
            const dtot = document.createElement('div');
            dtot.style.cssText = 'font-size:12px;color:#facc15;font-weight:bold';
            dtot.innerHTML = `D: ${_fmt2(m.dist)} <span style="color:#9ca3af;font-size:10px;font-weight:normal">u</span>`;
            row.appendChild(dtot);

            listEl.appendChild(row);
        }
    }

    // ── Scale ─────────────────────────────────────────────────────────────────
    function _applyScaleToAll() {
        if (_pendingMarkerA) _pendingMarkerA.scale.setScalar(_markerScale);
        for (const m of _measurements) {
            m.markerA?.scale.setScalar(_markerScale);
            m.markerB?.scale.setScalar(_markerScale);
            if (m.labelSprite) _setSpriteScale(m.labelSprite);
        }
    }

    // ── API pubblica ──────────────────────────────────────────────────────────

    /** EyeLock path: hit già formato da ControlsManager. */
    function addPoint(hit) {
        if (!_active || !hit) return;
        const resolved = resolveExistingHit(hit, _snapEnabled);
        if (resolved) _pickHit(resolved);
    }

    /** EyeLock fallback: point cloud più vicino al raggio (hit null). */
    function tryFromRay(ray, targets) {
        if (!_active || !_snapEnabled) return;
        const closest = pickClosestPointCloud(ray, targets, getState?.()?.pointHitFilter);
        if (closest) _onPick(closest.point.clone());
    }

    /** Rimuove una singola misura per ID. */
    function removeMeasurement(id) {
        const idx = _measurements.findIndex(m => m.id === id);
        if (idx === -1) return;
        _disposeMeasurement(_measurements[idx]);
        _measurements.splice(idx, 1);
        _refreshPanel();
        markDirty?.();
    }

    /** Cancella tutte le misure e il punto pendente. */
    function clearAll() {
        for (const m of _measurements) _disposeMeasurement(m);
        _measurements.length = 0;
        if (_pendingMarkerA) { _group.remove(_pendingMarkerA); _pendingMarkerA = null; }
        _ptA   = null;
        _phase = 0;
        markDirty?.();
        _refreshPanel();
        cmdUI?.update?.({ status: te('app.tjs.measure.cleared') });
    }

    function setActive(val) {
        _active        = Boolean(val);
        _group.visible = _active;

        if (_active && !_panelEl) {
            const host = containerEl ?? renderer.domElement.parentElement;
            if (host) { _panelEl = _buildPanel(); host.appendChild(_panelEl); }
        }
        if (_panelEl) _panelEl.style.display = _active ? 'flex' : 'none';

        if (_active) {
            _refreshPanel();
            const base = _measurements.length ? `${te('app.tjs.measure.count', { n: _measurements.length })} — ` : '';
            cmdUI?.update?.({ status: base + (_phase === 1
                ? te('app.tjs.measure.status_b_short')
                : te('app.tjs.measure.status_a')) });
        } else {
            cmdUI?.update?.({ status: '' });
        }
        markDirty?.();
    }

    function isActive() { return _active; }

    function dispose() {
        for (const m of _measurements) _disposeMeasurement(m);
        _measurements.length = 0;
        // Dispose shared template geometry/material
        _markerTemplate.traverse(obj => {
            obj.geometry?.dispose();
            obj.material?.dispose();
        });
        _group.parent?.remove(_group);
        _panelEl?.remove();
        _panelEl = null;
    }

    signal?.addEventListener('abort', dispose, { once: true });

    return { setActive, isActive, addPoint, tryFromRay, removeMeasurement, clearAll, dispose };
}
