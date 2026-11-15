// TJS-camera-manager.mjs
// Pannello gestione camere della scena TJS.
//
// Camere PREESISTENTI (isPreExisting=true):
//   – la camera principale creata in model_TJS.mjs
//   – solo FOV/near/far modificabili, non cancellabili, modifiche non salvabili
//
// Camere CREATE (isPreExisting=false):
//   – PerspectiveCamera o OrthographicCamera
//   – handle 3D sotto cameraRoot (TJS_CAMERA_ROOT)
//   – selezionabili e spostabili con il transform tool
//   – associate a un modello, salvabili in mod_spec.cameras[]
//   – cancellabili
//   – attivabili (diventa la camera di rendering attiva)
//
// Gli handle 3D sono visibili SOLO quando il pannello è aperto.
// Le camere salvate vengono ricaricate all'apertura dal mod_spec.

import { t, te } from '../shared/i18n.mjs';
import { panelLevel } from '../shared/ui_level.mjs';

// label: getter tradotto; è anche il nome predefinito di una camera nuova (poi è un dato)
const CAM_DEFS = [
  { type: 'Perspective',   get label() { return t('app.tjs.camera.type.perspective'); },  icon: 'bi-camera-video',     color: '#aaeeff' },
  { type: 'Orthographic',  get label() { return t('app.tjs.camera.type.orthographic'); }, icon: 'bi-crop',             color: '#aaffcc' },
];

// Livello di interazione (§5): i salvataggi in mod_spec solo da autore (30) in su
const _canSave = (el) => panelLevel(el) >= 30;   // livello del pannello (_doc/arch-permessi.md §11.4)

const HANDLE_COLOR = 0x44ccff;

// ─────────────────────────────────────────────────────────────────────────────

export function tjsCreateCameraManager({
  THREE,
  scene,
  cameraRoot,          // THREE.Group "TJS_CAMERA_ROOT"
  models,
  bodyEl,
  containerEl,
  transformTool,
  setRenderCamera,     // callback (cam: THREE.Camera) => void — cambia la camera attiva
  getRenderCamera,     // callback () => THREE.Camera — legge la camera corrente
  cmdUI,
  signal,
}) {
  const mountTarget = containerEl ?? bodyEl;

  let panelEl    = null;
  let visible    = false;
  let handleScale = 1.0;

  /** @type {Array<CameraNode>} */
  const cameras = [];

  // Handle geo (lazy)
  let _handleGeo = null;

  function _getHandleGeo() {
    if (!_handleGeo) {
      // Corpo camera: box piatto
      const body = new THREE.BoxGeometry(0.4, 0.28, 0.18);
      // "Obiettivo": cilindro davanti
      const lens = new THREE.CylinderGeometry(0.09, 0.09, 0.14, 8);
      // Combino in un BufferGeometry merged
      // Per semplicità usiamo Group con due mesh, non merged
      _handleGeo = { body, lens };
    }
    return _handleGeo;
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function _init() {
    // Camera preesistente (quella principale passata tramite getRenderCamera)
    const mainCam = getRenderCamera?.();
    if (mainCam) {
      cameras.push({
        id:            mainCam.uuid,
        name:          mainCam.name || t('app.tjs.camera.main_default'),
        type:          mainCam.isPerspectiveCamera ? 'Perspective' : 'Orthographic',
        isPreExisting: true,
        modelId:       null,
        camera:        mainCam,
        handle:        null,
        helperMesh:    null,
        isActive:      true,
      });
    }

    // Reload da mod_spec
    const modArr = Array.isArray(models) ? models : [];
    for (const row of modArr) {
      const spec = _parseSpec(row?.mod_spec);
      if (!Array.isArray(spec?.cameras)) continue;
      for (const cd of spec.cameras) _recreateFromSpec(cd, row.mod_id);
    }
  }

  function _parseSpec(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // ── Costruzione camera + handle ─────────────────────────────────────────────

  function _buildCamera(type) {
    if (type === 'Perspective') {
      return new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    } else {
      return new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);
    }
  }

  function _buildHandle(camera) {
    const mat  = new THREE.MeshBasicMaterial({
      color: HANDLE_COLOR, depthTest: false, transparent: true, opacity: 0.85,
    });
    const geo = _getHandleGeo();

    const bodyMesh = new THREE.Mesh(geo.body, mat);
    const lensMesh = new THREE.Mesh(geo.lens, mat.clone());
    lensMesh.rotation.x = Math.PI / 2;
    lensMesh.position.z = -0.16;

    const group = new THREE.Group();
    group.name  = `TJS_CAM_HANDLE_${camera.uuid}`;
    group.userData.__tjs_selectable__ = true;
    group.userData.__tjs_camera__     = true;

    group.add(bodyMesh);
    group.add(lensMesh);
    group.add(camera);   // camera figlia → si sposta con il gruppo

    bodyMesh.visible = false;
    lensMesh.visible = false;

    bodyMesh.scale.setScalar(handleScale);
    lensMesh.scale.setScalar(handleScale);

    return { group, meshes: [bodyMesh, lensMesh] };
  }

  function _genId() { return 'cam_' + Math.random().toString(36).slice(2, 10); }

  // API: aggiunge camera creata dall'utente
  function addCamera(type, modelId, pos = null) {
    const camera = _buildCamera(type);
    const id     = _genId();
    camera.name  = `TJS_CAM_${id}`;

    const defaultPos   = pos ?? { x: 5, y: 3, z: 8 };
    const { group, meshes } = _buildHandle(camera);
    group.position.set(defaultPos.x, defaultPos.y, defaultPos.z);
    if (visible) meshes.forEach(m => { m.visible = true; });
    cameraRoot.add(group);

    cameras.push({ id, name: CAM_DEFS.find(d => d.type === type)?.label ?? type,
      type, isPreExisting: false, modelId: modelId ?? null,
      camera, handle: group, helperMesh: meshes, isActive: false });
    _renderPanel();
    return cameras[cameras.length - 1];
  }

  function _recreateFromSpec(cd, modelId) {
    if (!cd?.type || !cd?.id) return;
    if (cameras.some(n => n.id === cd.id)) return;

    const camera = _buildCamera(cd.type);
    camera.name  = `TJS_CAM_${cd.id}`;

    if (typeof cd.fov  === 'number' && camera.isPerspectiveCamera) camera.fov  = cd.fov;
    if (typeof cd.near === 'number') camera.near = cd.near;
    if (typeof cd.far  === 'number') camera.far  = cd.far;
    camera.updateProjectionMatrix();

    const pos = cd.position ?? { x: 5, y: 3, z: 8 };
    const { group, meshes } = _buildHandle(camera);
    group.position.set(pos.x, pos.y, pos.z);
    if (cd.rotation) {
      group.rotation.set(cd.rotation.x ?? 0, cd.rotation.y ?? 0, cd.rotation.z ?? 0);
    }
    cameraRoot.add(group);

    cameras.push({ id: cd.id, name: cd.name ?? (CAM_DEFS.find(d => d.type === cd.type)?.label ?? cd.type),
      type: cd.type, isPreExisting: false, modelId: modelId ?? null,
      camera, handle: group, helperMesh: meshes, isActive: false });
  }

  // API: rimuove camera creata
  function removeCamera(id) {
    const idx = cameras.findIndex(n => n.id === id);
    if (idx < 0) return;
    const node = cameras[idx];
    if (node.isPreExisting) return;

    // Se era la camera attiva, ripristina la principale
    if (node.isActive) {
      const main = cameras.find(n => n.isPreExisting);
      if (main) _activateCamera(main.id);
    }

    cameraRoot.remove(node.handle);
    node.helperMesh?.forEach(m => { m.geometry?.dispose?.(); m.material?.dispose?.(); });
    cameras.splice(idx, 1);
    _renderPanel();
  }

  // Attiva una camera per il rendering
  function _activateCamera(id) {
    const node = cameras.find(n => n.id === id);
    if (!node) return;

    cameras.forEach(n => { n.isActive = false; });
    node.isActive = true;
    setRenderCamera?.(node.camera);
    _renderPanel();
  }

  // ── Visibilità handle ────────────────────────────────────────────────────────

  function _setHandlesVisible(vis) {
    for (const node of cameras) {
      if (Array.isArray(node.helperMesh)) {
        node.helperMesh.forEach(m => { m.visible = vis; });
      }
    }
  }

  function _applyHandleScale(val) {
    handleScale = Math.max(0.1, val);
    for (const node of cameras) {
      if (Array.isArray(node.helperMesh)) {
        node.helperMesh.forEach(m => m.scale.setScalar(handleScale));
      }
    }
  }

  // ── Salvataggio ─────────────────────────────────────────────────────────────

  function _nodeToSpec(node) {
    const c  = node.camera;
    const wp = new THREE.Vector3();
    const wr = new THREE.Euler();
    if (node.handle) {
      node.handle.getWorldPosition(wp);
      wr.setFromQuaternion(node.handle.getWorldQuaternion(new THREE.Quaternion()));
    }
    const out = {
      id:       node.id,
      name:     node.name,
      type:     node.type,
      near:     c.near,
      far:      c.far,
      position: { x: wp.x, y: wp.y, z: wp.z },
      rotation: { x: wr.x, y: wr.y, z: wr.z },
    };
    if (c.isPerspectiveCamera) out.fov = c.fov;
    return out;
  }

  async function saveCamera(id) {
    const node = cameras.find(n => n.id === id);
    if (!node || node.isPreExisting) return;
    await _saveForModel(node.modelId);
  }

  async function saveAllCameras() {
    const mids = [...new Set(cameras.filter(n => !n.isPreExisting && n.modelId != null).map(n => String(n.modelId)))];
    for (const mid of mids) await _saveForModel(mid);
  }

  async function _saveForModel(modelId) {
    if (modelId == null) { cmdUI?.update?.({ status: t('app.tjs.no_model.@') }); return; }
    const modArr = Array.isArray(models) ? models : [];
    const row    = modArr.find(r => String(r.mod_id) === String(modelId));
    if (!row)    { cmdUI?.update?.({ status: t('app.tjs.model_not_found_id.@', { id: modelId }) }); return; }

    const spec     = { ...(_parseSpec(row.mod_spec) ?? {}) };
    spec.cameras   = cameras.filter(n => !n.isPreExisting && String(n.modelId) === String(modelId)).map(_nodeToSpec);

    try {
      cmdUI?.update?.({ status: t('app.tjs.camera.saving') });
      const res  = await fetch('api/mod_spec_tool.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', mod_id: row.mod_id, mod_spec: spec }),
      });
      const data = await res.json();
      if (data.ok) { row.mod_spec = spec; cmdUI?.update?.({ status: t('app.tjs.camera.saved') }); }
      else          cmdUI?.update?.({ status: t('app.tjs.error_detail', { error: data.error }) });
    } catch { cmdUI?.update?.({ status: t('errors.network') }); }
  }

  // ── UI pannello ─────────────────────────────────────────────────────────────

  function _buildPanel() {
    const el = document.createElement('div');
    el.className = 'tjs-rpanel-item';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'tjs-rpanel-hdr';
    const title = document.createElement('span');
    title.className = 'tjs-rpanel-hdr-title';
    title.textContent = t('app.tjs.camera.title');
    hdr.appendChild(title);
    const hdrBtns = document.createElement('div');
    hdrBtns.className = 'tjs-rpanel-hdr-btns';
    if (_canSave(mountTarget)) hdrBtns.appendChild(_hdrBtn('bi-cloud-upload', t('app.tjs.camera.save_all'), () => saveAllCameras()));
    hdrBtns.appendChild(_hdrBtn('bi-x-lg', t('common.close'), () => hide()));
    hdr.appendChild(hdrBtns);
    el.appendChild(hdr);

    // Addbar
    const addBar = document.createElement('div');
    addBar.className = 'tjs-rpanel-addbar';
    const addLbl = document.createElement('div');
    addLbl.className = 'tjs-rpanel-addbar-lbl';
    addLbl.textContent = t('app.tjs.camera.add');
    addBar.appendChild(addLbl);

    const addBtns = document.createElement('div');
    addBtns.className = 'tjs-rpanel-addbar-btns';
    for (const def of CAM_DEFS) {
      const btn = document.createElement('button');
      btn.className = 'tjs-rpanel-addbar-btn';
      btn.innerHTML = `<i class="bi ${def.icon}" style="color:${def.color}" aria-hidden="true"></i><span>${te('app.tjs.camera.type.' + def.type.toLowerCase())}</span>`;
      btn.onclick = () => _promptAddCamera(def.type);
      addBtns.appendChild(btn);
    }
    addBar.appendChild(addBtns);

    // Scala handle
    const scaleRow = document.createElement('div');
    scaleRow.className = 'tjs-rpanel-scale-row';
    const scaleLbl = document.createElement('label');
    scaleLbl.className = 'tjs-rpanel-scale-lbl';
    scaleLbl.textContent = t('app.tjs.handle_scale');
    scaleLbl.htmlFor = 'tjsCamScale_' + Math.random().toString(36).slice(2, 8);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0.1'; slider.max = '5'; slider.step = '0.05';
    slider.value = String(handleScale);
    slider.className = 'tjs-rpanel-range';
    slider.id = scaleLbl.htmlFor;
    slider.style.flex = '1';
    const scaleVal = document.createElement('span');
    scaleVal.className = 'tjs-rpanel-scale-val';
    scaleVal.textContent = handleScale.toFixed(2);
    slider.oninput = () => { _applyHandleScale(parseFloat(slider.value)); scaleVal.textContent = handleScale.toFixed(2); };
    scaleRow.appendChild(scaleLbl);
    scaleRow.appendChild(slider);
    scaleRow.appendChild(scaleVal);
    addBar.appendChild(scaleRow);
    el.appendChild(addBar);

    // Lista
    const listEl = document.createElement('div');
    listEl.className = 'tjs-rpanel-list';
    el._listEl = listEl;
    el.appendChild(listEl);
    return el;
  }

  function _renderPanel() {
    if (!panelEl) return;
    const listEl = panelEl._listEl;
    listEl.innerHTML = '';

    const pre = cameras.filter(n =>  n.isPreExisting);
    const usr = cameras.filter(n => !n.isPreExisting);

    if (pre.length) { listEl.appendChild(_sectionHdr(t('app.tjs.section.preexisting'), true));  pre.forEach(n => listEl.appendChild(_makeRow(n))); }
    if (usr.length) { listEl.appendChild(_sectionHdr(t('app.tjs.section.created'), false)); usr.forEach(n => listEl.appendChild(_makeRow(n))); }

    if (!cameras.length) {
      const empty = document.createElement('div');
      empty.className = 'tjs-rpanel-empty';
      empty.textContent = t('app.tjs.camera.empty');
      listEl.appendChild(empty);
    }
  }

  function _sectionHdr(label, locked) {
    const el = document.createElement('div');
    el.className = 'tjs-rpanel-section';
    el.innerHTML = locked
      ? `<i class="bi bi-lock" style="font-size:9px" aria-hidden="true"></i> ${label}`
      : `<i class="bi bi-pencil" style="font-size:9px" aria-hidden="true"></i> ${label}`;
    return el;
  }

  function _makeRow(node) {
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.className = 'tjs-rpanel-row';

    // Icona tipo + attiva
    const def = CAM_DEFS.find(d => d.type === node.type);
    const ico = document.createElement('span');
    ico.className = 'tjs-rpanel-type-ico';
    ico.innerHTML = `<i class="bi ${def?.icon ?? 'bi-camera-video'}" style="color:${node.isActive ? '#fff' : (def?.color ?? '#aaa')}"></i>`;
    ico.title     = node.isActive ? t('app.tjs.camera.active_title') : '';
    row.appendChild(ico);

    // Nome
    if (node.isPreExisting) {
      const nm = document.createElement('span');
      nm.className   = 'tjs-rpanel-name tjs-rpanel-name--ro';
      nm.textContent = node.name;
      row.appendChild(nm);
    } else {
      const nm = document.createElement('input');
      nm.className = 'tjs-rpanel-name-input';
      nm.type  = 'text';
      nm.value = node.name;
      nm.setAttribute('aria-label', t('common.name'));
      nm.onchange = () => { node.name = nm.value.trim() || node.name; };
      row.appendChild(nm);
    }

    // Badge attiva / lock
    if (node.isActive) {
      const activeTag = document.createElement('span');
      activeTag.style.cssText = 'font-size:9px;background:#224;color:#6af;border:1px solid #335;border-radius:3px;padding:1px 4px;flex-shrink:0';
      activeTag.textContent = t('app.tjs.camera.active_tag');
      row.appendChild(activeTag);
    }

    if (node.isPreExisting) {
      const lk = document.createElement('span');
      lk.className = 'tjs-rpanel-lock';
      lk.innerHTML = '<i class="bi bi-lock"></i>';
      lk.title     = t('app.tjs.camera.locked_hint');
      row.appendChild(lk);
    } else {
      _appendModelBadge(row, node);
    }

    // Dettagli (FOV/near/far)
    const btnDet = document.createElement('button');
    btnDet.className = 'tjs-rpanel-btn';
    btnDet.innerHTML = '<i class="bi bi-sliders"></i>';
    btnDet.title     = t('app.tjs.camera.properties');
    btnDet.onclick   = () => {
      const det = wrap.querySelector('.tjs-rpanel-details');
      if (det) det.remove(); else wrap.appendChild(_makeDetails(node));
    };
    row.appendChild(btnDet);

    // Attiva (solo user-created o preesistente non attiva)
    if (!node.isActive) {
      const btnAct = document.createElement('button');
      btnAct.className = 'tjs-rpanel-btn';
      btnAct.innerHTML = '<i class="bi bi-play-circle" style="color:#6f6"></i>';
      btnAct.title     = t('app.tjs.camera.activate');
      btnAct.onclick   = () => _activateCamera(node.id);
      row.appendChild(btnAct);
    }

    // Seleziona handle (user-created)
    if (!node.isPreExisting && node.handle && transformTool) {
      const btnSel = document.createElement('button');
      btnSel.className = 'tjs-rpanel-btn';
      btnSel.innerHTML = '<i class="bi bi-cursor"></i>';
      btnSel.title     = t('app.tjs.camera.select_handle');
      btnSel.onclick   = () => {
        transformTool.selectObject(node.handle);
        if (!transformTool.gizmoEnabled) transformTool.enableGizmo(true);
      };
      row.appendChild(btnSel);
    }

    // Delete / Save (user-created)
    if (!node.isPreExisting) {
      const btnDel = document.createElement('button');
      btnDel.className = 'tjs-rpanel-btn';
      btnDel.innerHTML = '<i class="bi bi-trash3" style="color:#f65"></i>';
      btnDel.title     = t('app.tjs.camera.delete');
      btnDel.onclick   = () => { if (confirm(t('app.tjs.confirm_delete_named', { name: node.name }))) removeCamera(node.id); };
      row.appendChild(btnDel);

      if (_canSave(mountTarget)) {
        const btnSave = document.createElement('button');
        btnSave.className = 'tjs-rpanel-btn';
        btnSave.innerHTML = '<i class="bi bi-floppy" style="color:#6af"></i>';
        btnSave.title     = t('app.tjs.camera.save_model.@');
        btnSave.onclick   = () => saveCamera(node.id);
        row.appendChild(btnSave);
      }
    }

    // Accessibilità: nome accessibile = title per i pulsanti a sola icona
    row.querySelectorAll('button[title]').forEach(b => { if (!b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.title); });
    row.querySelectorAll('i.bi').forEach(i => i.setAttribute('aria-hidden', 'true'));

    wrap.appendChild(row);
    return wrap;
  }

  function _makeDetails(node) {
    const det = document.createElement('div');
    det.className = 'tjs-rpanel-details';

    const addRow = (label, ctrl) => {
      const r = document.createElement('div');
      r.className = 'tjs-rpanel-detail-row';
      const lbl = document.createElement('span');
      lbl.className   = 'tjs-rpanel-detail-lbl';
      lbl.textContent = label;
      ctrl.setAttribute('aria-label', label);
      r.appendChild(lbl); r.appendChild(ctrl); det.appendChild(r);
    };

    if (node.camera.isPerspectiveCamera) {
      addRow('FOV', _numInput(node.camera.fov, 1, v => { node.camera.fov = v; node.camera.updateProjectionMatrix(); }));
    }
    addRow('Near', _numInput(node.camera.near, 0.01, v => { node.camera.near = v; node.camera.updateProjectionMatrix(); }));
    addRow('Far',  _numInput(node.camera.far,  10,   v => { node.camera.far  = v; node.camera.updateProjectionMatrix(); }));
    return det;
  }

  function _appendModelBadge(row, node) {
    const modArr = Array.isArray(models) ? models : [];
    if (!modArr.length) return;
    const modRow  = modArr.find(r => String(r.mod_id) === String(node.modelId));
    const rawName = modRow?.mod_name ?? (node.modelId ? `M${node.modelId}` : '?');
    const label   = rawName.length > 9 ? rawName.slice(0, 9) + '…' : rawName;
    const badge   = document.createElement('button');
    badge.className   = 'tjs-rpanel-badge';
    badge.textContent = label;
    badge.title       = t('app.tjs.model_badge.@', { name: rawName });
    badge.onclick     = () => _openModelChangeDlg(node);
    row.appendChild(badge);
  }

  // ── Dialoghi ────────────────────────────────────────────────────────────────

  function _promptAddCamera(type) {
    const modArr = Array.isArray(models) ? models : [];
    if (modArr.length <= 1) { addCamera(type, modArr[0]?.mod_id ?? null); return; }
    _openModelPickerDlg(type);
  }

  function _openModelPickerDlg(type) {
    _closeAllDlgs();
    const def    = CAM_DEFS.find(d => d.type === type);
    const modArr = Array.isArray(models) ? models : [];
    const dlg    = _dlg('tjs-cam-picker');
    dlg.innerHTML = `
      <div class="tjs-dlg-title"><i class="bi ${def.icon}" style="color:${def.color};margin-right:6px" aria-hidden="true"></i>${te('app.tjs.camera.type.' + def.type.toLowerCase())}</div>
      <label for="_camModSel" class="tjs-dlg-lbl" style="display:block">${te('app.tjs.associate_model.@')}</label>
      <select id="_camModSel" class="tjs-dlg-select">
        ${modArr.map(r => `<option value="${r.mod_id}">${r.mod_name ?? te('app.tjs.model_fallback.@', { id: r.mod_id })}</option>`).join('')}
      </select>
      <div class="tjs-dlg-footer">
        <button id="_camPickOk" class="tjs-dlg-btn tjs-dlg-btn--primary">${te('common.create')}</button>
        <button id="_camPickKo" class="tjs-dlg-btn tjs-dlg-btn--cancel">${te('common.cancel')}</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#_camPickOk').onclick = () => { const mid = parseInt(dlg.querySelector('#_camModSel').value); dlg.remove(); addCamera(type, mid); };
    dlg.querySelector('#_camPickKo').onclick = () => dlg.remove();
    if (signal) signal.addEventListener('abort', () => dlg.remove(), { once: true });
  }

  function _openModelChangeDlg(node) {
    _closeAllDlgs();
    const modArr = Array.isArray(models) ? models : [];
    if (!modArr.length) return;
    const dlg = _dlg('tjs-cam-modchg');
    dlg.innerHTML = `
      <div class="tjs-dlg-title">${te('app.tjs.associate_model_title.@')}</div>
      <label for="_camModChg" class="tjs-dlg-lbl" style="display:block">${te('app.tjs.camera.save_model_for.@')}</label>
      <select id="_camModChg" class="tjs-dlg-select">
        ${modArr.map(r => `<option value="${r.mod_id}" ${String(r.mod_id) === String(node.modelId) ? 'selected' : ''}>${r.mod_name ?? te('app.tjs.model_fallback.@', { id: r.mod_id })}</option>`).join('')}
      </select>
      <div class="tjs-dlg-footer">
        <button id="_camChgOk" class="tjs-dlg-btn tjs-dlg-btn--primary">${te('common.ok')}</button>
        <button id="_camChgKo" class="tjs-dlg-btn tjs-dlg-btn--cancel">${te('common.cancel')}</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#_camChgOk').onclick = () => { node.modelId = parseInt(dlg.querySelector('#_camModChg').value); dlg.remove(); _renderPanel(); };
    dlg.querySelector('#_camChgKo').onclick = () => dlg.remove();
    if (signal) signal.addEventListener('abort', () => dlg.remove(), { once: true });
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  function _hdrBtn(icon, title, onclick) {
    const b = document.createElement('button');
    b.className = 'tjs-rpanel-hdr-btn';
    b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
    b.title   = title;
    b.setAttribute('aria-label', title);
    b.onclick = onclick;
    return b;
  }

  function _numInput(val, step, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'number';
    inp.className = 'tjs-rpanel-num-input';
    inp.step  = String(step);
    inp.value = String(Math.round(val * 1000) / 1000);
    inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) onChange(v); };
    return inp;
  }

  function _dlg(cls) {
    const d = document.createElement('div');
    d.className = `tjs-dlg ${cls}`;
    d.setAttribute('role', 'dialog');
    return d;
  }

  function _closeAllDlgs() {
    document.querySelectorAll('.tjs-cam-picker,.tjs-cam-modchg').forEach(e => e.remove());
  }

  // ── API pubblica ─────────────────────────────────────────────────────────────

  function show() {
    if (!panelEl) { panelEl = _buildPanel(); mountTarget.appendChild(panelEl); }
    _setHandlesVisible(true);
    _renderPanel();
    panelEl.style.display = 'flex';
    visible = true;
  }

  function hide() {
    _setHandlesVisible(false);
    if (panelEl) panelEl.style.display = 'none';
    visible = false;
    _closeAllDlgs();
  }

  function toggle() { if (visible) hide(); else show(); }

  function dispose() {
    _setHandlesVisible(false);
    _closeAllDlgs();
    panelEl?.remove();
    panelEl = null;
    visible = false;
    _handleGeo?.body?.dispose?.();
    _handleGeo?.lens?.dispose?.();
  }

  if (signal) signal.addEventListener('abort', dispose, { once: true });
  _init();

  return { show, hide, toggle, dispose, isVisible: () => visible, addCamera, removeCamera, saveCamera, saveAllCameras };
}
