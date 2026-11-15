// TJS-scene-tree.mjs
// Pannello ad albero degli oggetti 3D sotto TJS_MODELS_ROOT.
// Ogni riga espone: visibilità, wireframe, colore materiale, castShadow, receiveShadow.
// Il pannello viene montato nel containerEl condiviso (right-panel container).

import { t, te } from '../shared/i18n.mjs';

export function tjsCreateSceneTree({ THREE, modelsRoot, bodyEl, containerEl, onSelect, markDirty, signal }) {
  // containerEl = div flex-colonna lato destro; bodyEl = fallback legacy
  const mountTarget = containerEl ?? bodyEl;

  let panelEl   = null;
  let visible   = false;
  const expanded = new Set();   // uuid degli oggetti espansi

  // ── helpers materiali ─────────────────────────────────────────────────────

  function _getMaterials(obj) {
    const mats = [];
    obj.traverse(child => {
      if (!child.isMesh) return;
      const arr = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of arr) {
        if (m && !mats.includes(m)) mats.push(m);
      }
    });
    return mats;
  }

  function _isWireframe(obj) {
    const ms = _getMaterials(obj);
    return ms.length > 0 && ms[0].wireframe === true;
  }

  function _setWireframe(obj, val) {
    _getMaterials(obj).forEach(m => { m.wireframe = val; });
  }

  function _getColor(obj) {
    const ms = _getMaterials(obj);
    if (!ms.length || !ms[0].color) return null;
    return '#' + ms[0].color.getHexString();
  }

  function _hasMaterial(obj) {
    return _getMaterials(obj).length > 0;
  }

  // ── costruzione pannello ──────────────────────────────────────────────────

  function _buildPanel() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:relative',
      'flex:1',
      'min-height:180px',
      'overflow:hidden',
      'width:100%',
      'background:rgba(14,14,22,0.95)',
      'border-bottom:1px solid #2a2a3e',
      'display:flex', 'flex-direction:column',
      'font-family:system-ui,sans-serif',
      'font-size:12px',
      'color:#dde',
      'pointer-events:auto',
    ].join(';');

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'padding:5px 8px',
      'border-bottom:1px solid #2a2a3e',
      'background:rgba(0,0,0,0.25)',
      'flex-shrink:0',
    ].join(';');
    hdr.innerHTML = `<span style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em">${te('app.tjs.tree.title')}</span>`;

    const btnRefresh = document.createElement('button');
    btnRefresh.title = t('app.tjs.tree.refresh');
    btnRefresh.setAttribute('aria-label', btnRefresh.title);
    btnRefresh.innerHTML = '<i class="bi bi-arrow-clockwise" aria-hidden="true"></i>';
    btnRefresh.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;padding:2px 4px;font-size:13px;margin-right:2px';
    btnRefresh.onclick = () => _renderTree();

    const btnClose = document.createElement('button');
    btnClose.title = t('common.close');
    btnClose.setAttribute('aria-label', btnClose.title);
    btnClose.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
    btnClose.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;padding:2px 4px;font-size:13px';
    btnClose.onclick = () => hide();

    hdr.appendChild(btnRefresh);
    hdr.appendChild(btnClose);
    el.appendChild(hdr);

    // Legend row
    const leg = document.createElement('div');
    leg.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:flex-end',
      'gap:4px', 'padding:3px 8px',
      'border-bottom:1px solid #1a1a2a',
      'font-size:10px', 'color:#556', 'flex-shrink:0',
    ].join(';');
    leg.innerHTML = [
      `<span title="${te('app.tjs.tree.visible')}"><i class="bi bi-lightbulb" aria-hidden="true"></i></span>`,
      '<span title="Wireframe"><i class="bi bi-box" aria-hidden="true"></i></span>',
      `<span title="${te('app.tjs.tree.mat_color')}" style="display:inline-block;width:13px;height:13px;border:1px solid #444;border-radius:2px;background:#555"></span>`,
      '<span title="Cast shadow" style="font-size:9px">C</span>',
      '<span title="Receive shadow" style="font-size:9px">R</span>',
      `<span title="${te('app.tjs.tree.lock_sel')}"><i class="bi bi-lock" style="font-size:10px" aria-hidden="true"></i></span>`,
    ].join('');
    el.appendChild(leg);

    // Tree container
    const treeEl = document.createElement('div');
    treeEl.style.cssText = 'overflow-y:auto;flex:1;padding:2px 0';
    el.appendChild(treeEl);

    el._treeEl = treeEl;
    return el;
  }

  // ── rendering albero ──────────────────────────────────────────────────────

  function _renderTree() {
    if (!panelEl) return;
    const treeEl = panelEl._treeEl;
    treeEl.innerHTML = '';
    for (const child of modelsRoot.children) {
      _renderNode(child, treeEl, 0);
    }
  }

  function _shouldSkip(obj) {
    // Salta helpers interni Three.js
    if (obj.isLight || obj.isHelper || obj.isCamera) return true;
    if (obj.name === 'TJS_GRID') return true;
    return false;
  }

  function _renderNode(obj, container, depth) {
    if (_shouldSkip(obj)) return;

    const visibleChildren = obj.children.filter(c => !_shouldSkip(c));
    const hasChildren  = visibleChildren.length > 0;
    const isExpanded   = expanded.has(obj.uuid);
    const hasMat       = _hasMaterial(obj);

    // ── Riga ──────────────────────────────────────────────────────────────
    const rowEl = document.createElement('div');
    rowEl.style.cssText = [
      'display:flex', 'align-items:center',
      'padding:2px 6px',
      `padding-left:${6 + depth * 14}px`,
      'gap:3px',
      'border-radius:2px',
      'cursor:default',
      'user-select:none',
      'min-height:20px',
    ].join(';');
    rowEl.addEventListener('mouseenter', () => { rowEl.style.background = 'rgba(255,255,255,0.04)'; });
    rowEl.addEventListener('mouseleave', () => { rowEl.style.background = ''; });

    // toggle expand
    const toggleEl = document.createElement('span');
    toggleEl.style.cssText = 'width:12px;height:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer';
    if (hasChildren) {
      toggleEl.innerHTML = isExpanded
        ? '<i class="bi bi-chevron-down" style="font-size:9px"></i>'
        : '<i class="bi bi-chevron-right" style="font-size:9px"></i>';
      toggleEl.onclick = e => {
        e.stopPropagation();
        if (expanded.has(obj.uuid)) expanded.delete(obj.uuid);
        else expanded.add(obj.uuid);
        _renderTree();
      };
    } else {
      toggleEl.innerHTML = '<i class="bi bi-dot" style="font-size:9px;color:#333"></i>';
    }
    rowEl.appendChild(toggleEl);

    // icona tipo oggetto
    const typeIcon = document.createElement('span');
    typeIcon.style.cssText = 'flex-shrink:0;color:#556;font-size:11px;margin-right:1px';
    if (obj.isMesh)  typeIcon.innerHTML = '<i class="bi bi-triangle"></i>';
    else if (obj.isGroup || obj.isObject3D) typeIcon.innerHTML = '<i class="bi bi-folder2"></i>';
    else typeIcon.innerHTML = '<i class="bi bi-dot"></i>';
    rowEl.appendChild(typeIcon);

    // nome (cliccabile → seleziona oggetto)
    const nameEl = document.createElement('span');
    const displayName = obj.name
      ? obj.name
      : (obj.isMesh ? `Mesh` : t('app.tjs.tree.group'));
    nameEl.textContent = displayName;
    nameEl.title = `${obj.type} — ${obj.uuid.slice(0,8)}`;
    nameEl.style.cssText = [
      'flex:1', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
      onSelect ? 'cursor:pointer' : '',
    ].join(';');
    if (!obj.visible) nameEl.style.opacity = '0.35';
    if (onSelect) {
      nameEl.addEventListener('mouseenter', () => { nameEl.style.color = '#fff'; });
      nameEl.addEventListener('mouseleave', () => { nameEl.style.color = ''; });
      nameEl.addEventListener('click', e => {
        e.stopPropagation();
        onSelect(obj);
      });
    }
    rowEl.appendChild(nameEl);

    // ── Controlli (destra) ────────────────────────────────────────────────
    const ctrlEl = document.createElement('span');
    ctrlEl.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;margin-left:4px';

    // Visibilità
    const btnVis = document.createElement('button');
    btnVis.title = obj.visible ? t('app.tjs.tree.hide') : t('app.tjs.tree.show');
    btnVis.setAttribute('aria-label', `${btnVis.title}: ${displayName}`);
    btnVis.innerHTML = obj.visible
      ? '<i class="bi bi-lightbulb-fill" style="color:#ffd700"></i>'
      : '<i class="bi bi-lightbulb-off" style="color:#444"></i>';
    _styleCtrlBtn(btnVis);
    btnVis.onclick = e => {
      e.stopPropagation();
      obj.visible = !obj.visible;
      markDirty?.();
      _renderTree();
    };
    ctrlEl.appendChild(btnVis);

    // Wireframe (solo se ha materiale)
    if (hasMat) {
      const wf = _isWireframe(obj);
      const btnWf = document.createElement('button');
      btnWf.title = wf ? 'Solid' : 'Wireframe';
      btnWf.setAttribute('aria-label', `${btnWf.title}: ${displayName}`);
      btnWf.innerHTML = wf
        ? '<i class="bi bi-box" style="color:#6af"></i>'
        : '<i class="bi bi-box-fill" style="color:#667"></i>';
      _styleCtrlBtn(btnWf);
      btnWf.onclick = e => {
        e.stopPropagation();
        _setWireframe(obj, !_isWireframe(obj));
        markDirty?.();
        _renderTree();
      };
      ctrlEl.appendChild(btnWf);

      // Colore materiale
      const color = _getColor(obj);
      const btnMat = document.createElement('button');
      btnMat.title = t('app.tjs.mat.title');
      btnMat.setAttribute('aria-label', `${btnMat.title}: ${displayName}`);
      btnMat.style.cssText = [
        'width:13px', 'height:13px',
        `background:${color ?? '#888'}`,
        'border:1px solid #555', 'border-radius:2px',
        'cursor:pointer', 'padding:0', 'flex-shrink:0',
      ].join(';');
      btnMat.onclick = e => {
        e.stopPropagation();
        _openMaterialDialog(obj, btnMat);
      };
      ctrlEl.appendChild(btnMat);
    } else {
      // placeholder per allineamento
      const placeholder = document.createElement('span');
      placeholder.style.cssText = 'width:36px;display:inline-block';
      ctrlEl.appendChild(placeholder);
    }

    // Cast shadow
    const cbCast = _makeCheckbox(obj.castShadow, 'Cast shadow', '#4af');
    cbCast.onchange = () => {
      obj.castShadow = cbCast.checked;
      obj.traverse(c => { c.castShadow = cbCast.checked; });
      markDirty?.();
    };
    ctrlEl.appendChild(cbCast);

    // Receive shadow
    const cbRec = _makeCheckbox(obj.receiveShadow, 'Receive shadow', '#4f8');
    cbRec.onchange = () => {
      obj.receiveShadow = cbRec.checked;
      obj.traverse(c => { c.receiveShadow = cbRec.checked; });
      markDirty?.();
    };
    ctrlEl.appendChild(cbRec);

    // Lock selezione
    const locked = !!obj.userData.__tjs_no_select__;
    const cbLock = _makeCheckbox(locked, t('app.tjs.tree.lock_sel'), '#f84');
    cbLock.onchange = () => {
      if (cbLock.checked) {
        obj.userData.__tjs_no_select__ = true;
      } else {
        delete obj.userData.__tjs_no_select__;
      }
    };
    ctrlEl.appendChild(cbLock);

    rowEl.appendChild(ctrlEl);
    container.appendChild(rowEl);

    // ── Figli ─────────────────────────────────────────────────────────────
    if (hasChildren && isExpanded) {
      for (const child of visibleChildren) {
        _renderNode(child, container, depth + 1);
      }
    }
  }

  function _styleCtrlBtn(btn) {
    btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:1px 2px;font-size:12px;color:inherit;line-height:1';
  }

  function _makeCheckbox(checked, title, accentColor) {
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = checked;
    cb.title   = title;
    cb.setAttribute('aria-label', title);
    cb.style.cssText = `cursor:pointer;margin:0;width:11px;height:11px;accent-color:${accentColor}`;
    cb.onclick = e => e.stopPropagation();
    return cb;
  }

  // ── dialogo materiale ─────────────────────────────────────────────────────

  function _openMaterialDialog(obj, anchorEl) {
    document.querySelectorAll('.tjs-mat-dialog').forEach(el => el.remove());

    const mats = _getMaterials(obj);
    if (!mats.length) return;

    const mat = mats[0];

    // Salva valori originali di tutti i materiali per poter ripristinare su Annulla
    const originals = mats.map(m => ({
      color:       m.color     ? '#' + m.color.getHexString()     : null,
      emissive:    m.emissive  ? '#' + m.emissive.getHexString()  : null,
      opacity:     m.opacity   ?? 1,
      transparent: m.transparent ?? false,
    }));

    const initColor    = originals[0].color    ?? '#888888';
    const initEmissive = originals[0].emissive ?? '#000000';
    const initOpacity  = originals[0].opacity;
    const initTransp   = originals[0].transparent;

    const dlg = document.createElement('div');
    dlg.className = 'tjs-mat-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', t('app.tjs.mat.title'));

    const rect    = anchorEl.getBoundingClientRect();
    const leftPos = Math.min(rect.right + 8, window.innerWidth - 230);
    const topPos  = Math.max(4, Math.min(rect.top, window.innerHeight - 200));

    dlg.style.cssText = [
      'position:fixed',
      `left:${leftPos}px`,
      `top:${topPos}px`,
      'min-width:210px',
      'background:#1a1a2e',
      'border:1px solid #3a3a5e',
      'border-radius:6px',
      'padding:10px',
      'z-index:9999',
      'font-family:system-ui,sans-serif',
      'font-size:12px',
      'color:#dde',
      'box-shadow:0 6px 24px rgba(0,0,0,.7)',
    ].join(';');

    dlg.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">${te('app.tjs.mat.title')}</strong>
        <button id="_dlgClose" aria-label="${te('common.close')}" title="${te('common.close')}" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;padding:0 2px"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
      </div>
      ${_row(te('app.tjs.tree.diffuse'), `<input type="color" id="_matColor" value="${initColor}" style="width:44px;height:22px;border:1px solid #444;padding:1px;background:#111;border-radius:3px;cursor:pointer">`)}
      ${_row(te('app.tjs.tree.emissive'), `<input type="color" id="_matEmissive" value="${initEmissive}" style="width:44px;height:22px;border:1px solid #444;padding:1px;background:#111;border-radius:3px;cursor:pointer">`)}
      ${_row(te('app.tjs.mat.opacity'), `<input type="range" id="_matOpacity" min="0" max="1" step="0.01" value="${initOpacity}" style="width:90px;vertical-align:middle"><span id="_matOpacityVal" style="margin-left:4px;min-width:32px;display:inline-block">${Math.round(initOpacity*100)}%</span>`)}
      ${_row(te('app.tjs.tree.transparent'), `<input type="checkbox" id="_matTransparent" ${initTransp ? 'checked' : ''} style="cursor:pointer;accent-color:#4af">`)}
      <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:6px">
        <button id="_dlgClose2" style="background:#2244aa;color:#fff;border:none;border-radius:4px;padding:3px 12px;cursor:pointer;font-size:12px">${te('common.ok')}</button>
        <button id="_dlgCancel" style="background:#333;color:#bbb;border:none;border-radius:4px;padding:3px 12px;cursor:pointer;font-size:12px">${te('common.cancel')}</button>
      </div>
    `;

    document.body.appendChild(dlg);

    // Applica live tutte le proprietà correnti del dialog ai materiali
    function _applyLive() {
      const color   = dlg.querySelector('#_matColor').value;
      const emissive = dlg.querySelector('#_matEmissive').value;
      const opacity  = parseFloat(dlg.querySelector('#_matOpacity').value);
      const transp   = dlg.querySelector('#_matTransparent').checked;
      mats.forEach(m => {
        if (m.color)    m.color.set(color);
        if (m.emissive) m.emissive.set(emissive);
        m.opacity     = opacity;
        m.transparent = transp || opacity < 1;
        m.needsUpdate = true;
      });
      markDirty?.();
    }

    // Ripristina i valori originali (usato da Annulla)
    function _restoreOriginals() {
      mats.forEach((m, i) => {
        const o = originals[i];
        if (m.color    && o.color)    m.color.set(o.color);
        if (m.emissive && o.emissive) m.emissive.set(o.emissive);
        m.opacity     = o.opacity;
        m.transparent = o.transparent;
        m.needsUpdate = true;
      });
      markDirty?.();
    }

    // Anteprima live su ogni modifica
    dlg.querySelector('#_matColor').oninput    = _applyLive;
    dlg.querySelector('#_matEmissive').oninput = _applyLive;
    dlg.querySelector('#_matOpacity').oninput  = e => {
      dlg.querySelector('#_matOpacityVal').textContent = Math.round(e.target.value * 100) + '%';
      _applyLive();
    };
    dlg.querySelector('#_matTransparent').onchange = _applyLive;

    // OK: mantieni le modifiche live già applicate e chiudi
    const _closeKeep = () => { dlg.remove(); _renderTree(); };
    dlg.querySelector('#_dlgClose').onclick  = _closeKeep;
    dlg.querySelector('#_dlgClose2').onclick = _closeKeep;

    // Annulla: ripristina originali e chiudi
    dlg.querySelector('#_dlgCancel').onclick = () => {
      _restoreOriginals();
      dlg.remove();
      _renderTree();
    };

    // Clic fuori dal dialog → mantieni (come OK)
    const outsideHandler = e => {
      if (!dlg.contains(e.target) && e.target !== anchorEl) {
        dlg.remove();
        document.removeEventListener('mousedown', outsideHandler);
        _renderTree();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', outsideHandler), 80);

    if (signal) signal.addEventListener('abort', () => dlg.remove(), { once: true });
  }

  // label già protetta per HTML (te); l'etichetta si collega al primo id del controllo
  function _row(label, control) {
    const forId = /id="([^"]+)"/.exec(control)?.[1] ?? '';
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <label for="${forId}" style="min-width:72px;color:#889;margin:0">${label}</label>
      ${control}
    </div>`;
  }

  // ── API pubblica ──────────────────────────────────────────────────────────

  function show() {
    if (!panelEl) {
      panelEl = _buildPanel();
      mountTarget.appendChild(panelEl);
    }
    // Auto-espandi il primo livello
    for (const child of modelsRoot.children) {
      if (!_shouldSkip(child)) expanded.add(child.uuid);
    }
    _renderTree();
    panelEl.style.display = 'flex';
    visible = true;
  }

  function hide() {
    if (panelEl) panelEl.style.display = 'none';
    visible = false;
    document.querySelectorAll('.tjs-mat-dialog').forEach(el => el.remove());
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  // ── Aggiornamento automatico (2026-10-19) ──────────────────────────────────
  // Un modello aggiunto o tolto dopo l'apertura (es. TJS/Model/Load URL con la mesh da ComfyUI)
  // compariva solo premendo "aggiorna". three avvisa il genitore (childadded/childremoved):
  // l'albero si ridisegna al frame successivo e il modello nuovo si apre lungo la catena di
  // gruppi con un solo figlio (gruppo del file → scena glTF → …), così si vedono le parti.
  let _refreshPending = false;
  function _scheduleRefresh() {
    if (!visible || _refreshPending) return;
    _refreshPending = true;
    requestAnimationFrame(() => { _refreshPending = false; if (visible) _renderTree(); });
  }
  function _expandChain(obj) {
    for (let o = obj; o && !_shouldSkip(o); ) {
      expanded.add(o.uuid);
      const kids = o.children.filter(c => !_shouldSkip(c));
      o = kids.length === 1 ? kids[0] : null;
    }
  }
  const _onChildAdded = (e) => { if (e.child) _expandChain(e.child); _scheduleRefresh(); };
  modelsRoot.addEventListener('childadded', _onChildAdded);
  modelsRoot.addEventListener('childremoved', _scheduleRefresh);

  function dispose() {
    modelsRoot.removeEventListener('childadded', _onChildAdded);
    modelsRoot.removeEventListener('childremoved', _scheduleRefresh);
    document.querySelectorAll('.tjs-mat-dialog').forEach(el => el.remove());
    panelEl?.remove();
    panelEl  = null;
    visible  = false;
  }

  if (signal) signal.addEventListener('abort', dispose, { once: true });

  return { show, hide, toggle, dispose, isVisible: () => visible };
}
