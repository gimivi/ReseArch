// TJS_sub_modules/TJS-cut-manager.mjs
// Pannello right-side per la gestione del clipping (Basic / Stencil).
// Sostituisce i controlli footer di TJS-cut-core, liberando il footer
// per i tool di trasformazione che devono orientare i piani di taglio.
//
// Sezioni:
//   1. Controlli attivi: ON/OFF, modalità, nascondi piani; per ogni piano: selezione (aggancia
//      il gizmo), taglio, visibilità, lato tenuto (Inverti), vista sulla sezione, cursore della
//      posizione lungo la normale; color picker + opacità (solo stencil)
//   2. Configurazioni: salva / applica / cancella preset in mod_spec.clipConfigs[]
//
// Modalità piani (2026-10-18): con la finestra aperta e il taglio attivo, model_TJS limita il
// clic in scena ai piani (hitFilter della selezione) e il clic nel vuoto non deseleziona.
//
// API pubblica:
//   show(), hide(), toggle(), isVisible() → boolean
//   refresh()     — risincronizza la UI dallo stato corrente del cutTool
//   syncPlanes()  — solo cursori e riga selezionata (piano mosso dal gizmo, selezione cambiata)
//   dispose()     — rimuove il pannello dal DOM

import { t, te } from "../shared/i18n.mjs";
import { panelLevel } from "../shared/ui_level.mjs";

/** Salvare/eliminare configurazioni scrive nel mod_spec: solo dal livello autore (30). */
const _canEdit = (el) => panelLevel(el) >= 30;   // livello del pannello (_doc/arch-permessi.md §11.4)

export function tjsCreateCutManager({
  cutTool,
  models,
  containerEl,
  transformTool = null,   // selezione del piano dalla finestra (aggancia il gizmo)
  onViewPlane   = null,   // (id) => void — porta la vista di fronte alla sezione
  cmdUI    = null,
  signal   = null,
  markDirty = () => {},
}) {
  let panelEl  = null;
  let visible  = false;

  // refs ai nodi DOM aggiornati in _render()
  let _onOffBtn, _modeBtn, _hidePlanesBtn;
  const _planeRows = {};   // id → { wrap, selBtn, enableChk, eyeBtn, eyeIcon, range, num }
  let _stencilSection, _colorInput, _opacityInput, _opacityVal, _solidChk;
  let _configList, _cfgNameInput;

  // ── Helpers DOM ──────────────────────────────────────────────────────────────

  function _mkBtn(icon, title, onClick) {
    const btn = document.createElement('button');
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = `<i class="bi ${icon}" style="font-size:13px;pointer-events:none" aria-hidden="true"></i>`;
    btn.style.cssText = 'background:transparent;border:1px solid transparent;border-radius:3px;color:#99a;cursor:pointer;padding:3px 5px;line-height:1;display:flex;align-items:center';
    btn.onmouseenter = () => { btn.style.borderColor = '#3a3a5a'; btn.style.color = '#dde'; };
    btn.onmouseleave = () => { btn.style.borderColor = 'transparent'; btn.style.color = '#99a'; };
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _mkTextBtn(label, title, onClick, color = '#2244aa') {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.title = title;
    btn.style.cssText = `background:${color};border:none;border-radius:3px;color:#eef;cursor:pointer;padding:3px 8px;font-size:11px;white-space:nowrap`;
    btn.onmouseenter = () => { btn.style.filter = 'brightness(1.2)'; };
    btn.onmouseleave = () => { btn.style.filter = ''; };
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _sectionHdr(label) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:6px 8px 3px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#445;border-bottom:1px solid #1a1a2a;margin-bottom:2px;flex-shrink:0';
    el.textContent = label;
    return el;
  }

  function _row(css = '') {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px;' + css;
    return el;
  }

  function _label(text, css = '') {
    const el = document.createElement('span');
    el.textContent = text;
    el.style.cssText = 'font-size:11px;color:#889;' + css;
    return el;
  }

  // ── Build panel ──────────────────────────────────────────────────────────────

  function _build() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:relative',
      'flex:1',
      'min-height:180px',
      'overflow:hidden',
      'width:100%',
      'background:rgba(14,14,22,0.95)',
      'display:flex',
      'flex-direction:column',
      'font-family:system-ui,sans-serif',
      'font-size:12px',
      'color:#dde',
      'pointer-events:auto',
    ].join(';');

    // ── Header ───────────────────────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #2a2a3e;background:rgba(0,0,0,0.25);flex-shrink:0';

    const title = document.createElement('span');
    title.style.cssText = 'font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#bbc';
    title.innerHTML = `<i class="bi bi-scissors" style="margin-right:5px;font-size:12px;color:#7ac" aria-hidden="true"></i>${te('app.tjs.cut.panel_title')}`;
    hdr.appendChild(title);

    const hdrBtns = document.createElement('div');
    hdrBtns.style.cssText = 'display:flex;gap:2px';
    hdrBtns.appendChild(_mkBtn('bi-x-lg', t('common.close'), () => hide()));
    hdr.appendChild(hdrBtns);
    el.appendChild(hdr);

    // ── Scrollable body ───────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.style.cssText = 'overflow-y:auto;flex:1;display:flex;flex-direction:column';
    el.appendChild(body);

    // ─── Sezione: Controlli ───────────────────────────────────────────────────
    body.appendChild(_sectionHdr(t('app.tjs.cut.controls')));

    // Row 1: ON/OFF + modalità
    const row1 = _row();
    _onOffBtn = document.createElement('button');
    _onOffBtn.style.cssText = 'border:1px solid #3a3a5a;border-radius:3px;cursor:pointer;padding:3px 10px;font-size:11px;font-weight:600;background:#1e1e32';
    _onOffBtn.addEventListener('click', () => {
      if (!cutTool) return;
      if (cutTool.enabled) cutTool.disable();
      else cutTool.enable();
      _render();
      markDirty();
    });
    row1.appendChild(_label(t('app.tjs.cut.clip_label'), 'flex-shrink:0'));
    row1.appendChild(_onOffBtn);

    _modeBtn = document.createElement('button');
    _modeBtn.style.cssText = 'border:1px solid #3a3a5a;border-radius:3px;cursor:pointer;padding:3px 8px;font-size:11px;background:#1e1e32;color:#dde';
    _modeBtn.addEventListener('click', () => {
      if (!cutTool) return;
      cutTool.setMode(cutTool.mode === 'basic' ? 'stencil' : 'basic');
      _render();
      markDirty();
    });
    row1.appendChild(_modeBtn);
    body.appendChild(row1);

    // Row 2: nascondi piani
    const row2 = _row();
    _hidePlanesBtn = document.createElement('button');
    _hidePlanesBtn.style.cssText = 'border:1px solid #3a3a5a;border-radius:3px;cursor:pointer;padding:3px 8px;font-size:11px;background:#1e1e32;color:#dde;display:flex;align-items:center;gap:4px';
    _hidePlanesBtn.innerHTML = `<i class="bi bi-eye" style="font-size:12px;pointer-events:none" aria-hidden="true"></i><span style="pointer-events:none;font-size:11px">${te('app.tjs.cut.hide_planes')}</span>`;
    _hidePlanesBtn.addEventListener('click', () => {
      if (!cutTool) return;
      cutTool.togglePlanesHidden?.();
      _render();
      markDirty();
    });
    row2.appendChild(_hidePlanesBtn);
    body.appendChild(row2);

    // Divider
    const div1 = document.createElement('div');
    div1.style.cssText = 'height:1px;background:#1a1a2a;margin:4px 8px;flex-shrink:0';
    body.appendChild(div1);

    // Rows per piano
    body.appendChild(_label(t('app.tjs.cut.plane_columns'), 'padding:2px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;display:block'));
    body.appendChild(_label(t('app.tjs.cut.planes_mode_note'), 'padding:0 8px 4px;font-size:10px;color:#99a;display:block'));

    for (const id of ['XY', 'XZ', 'YZ']) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'border-left:2px solid transparent;padding:1px 0 3px';
      const prow = _row('min-height:26px');

      // nome del piano = pulsante di selezione (gizmo agganciato, Sposta lungo la normale)
      const selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.textContent = id;
      selBtn.title = t('app.tjs.cut.plane_select', { id });
      selBtn.setAttribute('aria-label', selBtn.title);
      selBtn.style.cssText = 'font-size:12px;font-weight:600;color:#8ab;min-width:30px;flex-shrink:0;background:#1e1e32;border:1px solid #2e2e4a;border-radius:3px;cursor:pointer;padding:1px 4px';
      selBtn.addEventListener('click', () => {
        const actor = cutTool?.getPlaneActor?.(id);
        if (!actor || !transformTool) return;
        if (!actor.visible) { cutTool?.setPlaneVisible?.(id, true); _render(); }
        transformTool.selectObject(actor, { reason: 'cut-panel' });
        markDirty();
      });
      prow.appendChild(selBtn);

      // enable-for-cut checkbox
      const enableChk = document.createElement('input');
      enableChk.type = 'checkbox';
      enableChk.title = t('app.tjs.cut.plane_enable', { id });
      enableChk.setAttribute('aria-label', enableChk.title);
      enableChk.style.cssText = 'cursor:pointer;accent-color:#4af;width:14px;height:14px;flex-shrink:0';
      enableChk.addEventListener('change', () => {
        cutTool?.setPlaneEnabledForCut?.(id, enableChk.checked);
        cutTool?.refreshCut?.();
        markDirty();
      });
      prow.appendChild(enableChk);

      // visibility eye toggle
      const eyeBtn = document.createElement('button');
      const eyeIcon = document.createElement('i');
      eyeIcon.style.cssText = 'font-size:14px;pointer-events:none';
      eyeIcon.setAttribute('aria-hidden', 'true');
      eyeBtn.appendChild(eyeIcon);
      eyeBtn.title = t('app.tjs.cut.plane_toggle', { id });
      eyeBtn.setAttribute('aria-label', eyeBtn.title);
      eyeBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:#7ac;padding:2px 4px;display:flex;align-items:center';
      eyeBtn.addEventListener('click', () => {
        const st = cutTool?.getState?.();
        const p = st?.planes?.find(x => x.id === id);
        if (!p) return;
        cutTool?.setPlaneVisible?.(id, !p.visible);
        markDirty();
        _render();
      });
      prow.appendChild(eyeBtn);

      // lato tenuto
      prow.appendChild(_mkBtn('bi-arrow-left-right', t('app.tjs.cut.plane_flip', { id }), () => {
        cutTool?.flipPlane?.(id);
        markDirty();
      }));

      // vista di fronte alla sezione
      prow.appendChild(_mkBtn('bi-camera-video', t('app.tjs.cut.plane_view', { id }), () => onViewPlane?.(id)));

      wrap.appendChild(prow);

      // cursore della posizione lungo la normale + valore
      const posRow = _row('padding-top:0');
      const range = document.createElement('input');
      range.type = 'range';
      range.style.cssText = 'flex:1;min-width:0;cursor:pointer;accent-color:#4af';
      range.setAttribute('aria-label', t('app.tjs.cut.plane_pos', { id }));
      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'tjs-rpanel-num-input';
      num.style.width = '72px';
      num.setAttribute('aria-label', t('app.tjs.cut.plane_pos', { id }));
      range.addEventListener('input', () => {
        cutTool?.setPlaneOffset?.(id, parseFloat(range.value));
        num.value = _fmt(parseFloat(range.value));
        transformTool?.refreshValues?.();
        markDirty();
      });
      num.addEventListener('change', () => {
        const v = parseFloat(num.value);
        if (!Number.isFinite(v)) return;
        cutTool?.setPlaneOffset?.(id, v);
        syncPlanes();
        transformTool?.refreshValues?.();
        markDirty();
      });
      posRow.appendChild(range);
      posRow.appendChild(num);
      wrap.appendChild(posRow);

      body.appendChild(wrap);
      _planeRows[id] = { wrap, selBtn, enableChk, eyeBtn, eyeIcon, range, num };
    }

    // ─── Sezione Stencil ──────────────────────────────────────────────────────
    const div2 = document.createElement('div');
    div2.style.cssText = 'height:1px;background:#1a1a2a;margin:4px 8px;flex-shrink:0';
    body.appendChild(div2);

    _stencilSection = document.createElement('div');
    _stencilSection.style.cssText = 'display:none;flex-direction:column;gap:2px';

    body.appendChild(_sectionHdr(t('app.tjs.cut.cap_fill')));

    // Color row
    const colorRow = _row();
    colorRow.appendChild(_label(t('app.tjs.cut.color_label'), 'flex-shrink:0'));
    _colorInput = document.createElement('input');
    _colorInput.type = 'color';
    _colorInput.setAttribute('aria-label', t('app.tjs.cut.cap_color'));
    _colorInput.style.cssText = 'width:32px;height:22px;padding:0 2px;border:1px solid #555;border-radius:3px;cursor:pointer;background:transparent;flex-shrink:0';
    _colorInput.addEventListener('input', () => {
      const hex = parseInt(_colorInput.value.slice(1), 16);
      cutTool?.setCapColor?.(hex);
      markDirty();
    });
    colorRow.appendChild(_colorInput);
    _stencilSection.appendChild(colorRow);

    // Opacity row
    const opRow = _row();
    opRow.appendChild(_label(t('app.tjs.cut.opacity_label'), 'flex-shrink:0'));
    _opacityInput = document.createElement('input');
    _opacityInput.type = 'range';
    _opacityInput.setAttribute('aria-label', t('app.tjs.cut.cap_opacity'));
    _opacityInput.min = '0'; _opacityInput.max = '1'; _opacityInput.step = '0.05';
    _opacityInput.style.cssText = 'flex:1;cursor:pointer;accent-color:#4af';
    _opacityVal = document.createElement('span');
    _opacityVal.style.cssText = 'min-width:28px;text-align:right;color:#99a;font-size:11px;flex-shrink:0';
    _opacityInput.addEventListener('input', () => {
      const v = parseFloat(_opacityInput.value);
      _opacityVal.textContent = v.toFixed(2);
      cutTool?.setCapOpacity?.(v);
      markDirty();
    });
    opRow.appendChild(_opacityInput);
    opRow.appendChild(_opacityVal);
    _stencilSection.appendChild(opRow);

    // Sezione opaca: pieno anche quando il materiale tagliato è trasparente
    const solidRow = _row();
    _solidChk = document.createElement('input');
    _solidChk.type = 'checkbox';
    _solidChk.id = 'tjs-cut-solid-' + Math.random().toString(36).slice(2, 8);
    _solidChk.title = t('app.tjs.cut.cap_solid_hint');
    _solidChk.style.cssText = 'cursor:pointer;accent-color:#4af;width:14px;height:14px;flex-shrink:0';
    _solidChk.addEventListener('change', () => {
      cutTool?.setCapSolid?.(_solidChk.checked);
      _opacityInput.disabled = _solidChk.checked;
      markDirty();
    });
    const solidLbl = document.createElement('label');
    solidLbl.htmlFor = _solidChk.id;
    solidLbl.textContent = t('app.tjs.cut.cap_solid');
    solidLbl.title = _solidChk.title;
    solidLbl.style.cssText = 'font-size:11px;color:#889;cursor:pointer';
    solidRow.appendChild(_solidChk);
    solidRow.appendChild(solidLbl);
    _stencilSection.appendChild(solidRow);

    body.appendChild(_stencilSection);

    // ─── Sezione: Configurazioni ──────────────────────────────────────────────
    const div3 = document.createElement('div');
    div3.style.cssText = 'height:1px;background:#1a1a2a;margin:4px 8px;flex-shrink:0';
    body.appendChild(div3);

    body.appendChild(_sectionHdr(t('app.tjs.cut.configs')));

    // Save row (solo autore: scrive nel mod_spec)
    const saveRow = _row('flex-shrink:0');
    if (!_canEdit(containerEl)) saveRow.style.display = 'none';
    _cfgNameInput = document.createElement('input');
    _cfgNameInput.type = 'text';
    _cfgNameInput.placeholder = t('app.tjs.cut.config_name_ph');
    _cfgNameInput.setAttribute('aria-label', t('app.tjs.cut.config_name_ph'));
    _cfgNameInput.style.cssText = 'flex:1;background:#1a1a2e;border:1px solid #2e2e4a;border-radius:3px;color:#dde;padding:3px 6px;font-size:11px;min-width:0';
    _cfgNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') _saveConfig(_cfgNameInput.value); });
    saveRow.appendChild(_cfgNameInput);
    saveRow.appendChild(_mkTextBtn(t('common.save'), t('app.tjs.cut.config_save_tip'),() => _saveConfig(_cfgNameInput.value)));
    body.appendChild(saveRow);

    // Config list
    _configList = document.createElement('div');
    _configList.style.cssText = 'overflow-y:auto;flex:1;padding:2px 0;min-height:40px;max-height:160px';
    body.appendChild(_configList);

    if (signal) signal.addEventListener('abort', () => hide(), { once: true });

    return el;
  }

  // ── Render (sync DOM ← cutTool state) ───────────────────────────────────────

  function _render() {
    if (!panelEl || !visible) return;
    const st = cutTool?.getState?.();
    if (!st) return;

    // ON/OFF
    _onOffBtn.textContent = st.enabled ? 'ON' : 'OFF';
    _onOffBtn.style.color      = st.enabled ? '#4f8' : '#aaa';
    _onOffBtn.style.borderColor = st.enabled ? '#2a6' : '#3a3a5a';

    // Mode
    _modeBtn.textContent = st.mode === 'stencil' ? 'Stencil' : 'Basic';
    _modeBtn.style.color = st.mode === 'stencil' ? '#fa8' : '#dde';

    // Hide planes
    const hidden = st.planesHidden;
    _hidePlanesBtn.querySelector('i').className = hidden ? 'bi bi-eye-slash' : 'bi bi-eye';
    _hidePlanesBtn.querySelector('span').textContent = hidden ? t('app.tjs.cut.show_planes') : t('app.tjs.cut.hide_planes');
    _hidePlanesBtn.style.color = hidden ? '#fa8' : '#dde';

    // Per-plane rows
    for (const p of st.planes) {
      const row = _planeRows[p.id];
      if (!row) continue;
      row.enableChk.checked = p.enabledForCut;
      row.eyeIcon.className = p.visible ? 'bi bi-eye' : 'bi bi-eye-slash';
      row.eyeBtn.style.color = p.visible ? '#7ac' : '#445';
    }
    syncPlanes();

    // Stencil section
    const isStencil = st.mode === 'stencil';
    _stencilSection.style.display = isStencil ? 'flex' : 'none';
    if (isStencil) {
      _colorInput.value = '#' + st.capColor.toString(16).padStart(6, '0');
      _opacityInput.value = String(st.capOpacity);
      _opacityVal.textContent = st.capOpacity.toFixed(2);
      _solidChk.checked = !!st.capSolid;
      _opacityInput.disabled = !!st.capSolid;
    }

    _renderConfigList();
  }

  function _fmt(v) { return Number.isFinite(v) ? (Math.round(v * 1000) / 1000).toFixed(3) : ''; }

  // Cursori (intervallo = estensione dei target lungo la normale) e riga del piano selezionato.
  // Chiamata anche da model_TJS quando il gizmo muove un piano o cambia la selezione.
  function syncPlanes() {
    if (!panelEl || !visible) return;
    const sel = transformTool?.selection ?? [];
    const selActor = sel.length === 1 ? sel[0] : null;
    for (const id of Object.keys(_planeRows)) {
      const row = _planeRows[id];
      const r = cutTool?.getPlaneRange?.(id);
      row.range.disabled = !r;
      row.num.disabled = !r;
      if (r) {
        const step = Math.max(1e-6, (r.max - r.min) / 1000);
        row.range.min = String(r.min);
        row.range.max = String(r.max);
        row.range.step = String(step);
        row.num.step = String(Number(step.toPrecision(2)));
        if (document.activeElement !== row.range) row.range.value = String(r.value);
        if (document.activeElement !== row.num) row.num.value = _fmt(r.value);
      }
      const isSel = !!selActor && selActor === cutTool?.getPlaneActor?.(id);
      row.wrap.style.borderLeftColor = isSel ? '#4af' : 'transparent';
      row.wrap.style.background = isSel ? 'rgba(68,170,255,0.08)' : '';
      row.selBtn.setAttribute('aria-pressed', String(isSel));
    }
  }

  // ── Config list ──────────────────────────────────────────────────────────────

  function _getConfigs() {
    try {
      const raw = models?.[0]?.mod_spec;
      const spec = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      return Array.isArray(spec?.clipConfigs) ? spec.clipConfigs : [];
    } catch { return []; }
  }

  function _renderConfigList() {
    if (!_configList) return;
    _configList.innerHTML = '';
    const configs = _getConfigs();

    if (!configs.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px;text-align:center;color:#334;font-size:11px';
      empty.textContent = t('app.tjs.cut.configs_empty');
      _configList.appendChild(empty);
      return;
    }

    for (const cfg of configs) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;padding:3px 8px;gap:4px;min-height:24px';
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });

      const nameEl = document.createElement('span');
      nameEl.textContent = cfg.name ?? cfg.id;
      nameEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#aab';
      nameEl.title = cfg.name ?? cfg.id;
      row.appendChild(nameEl);

      // Mode badge
      const badge = document.createElement('span');
      badge.textContent = cfg.mode === 'stencil' ? 'S' : 'B';
      badge.title = cfg.mode === 'stencil' ? 'Stencil' : 'Basic';
      badge.style.cssText = `font-size:9px;color:#fff;background:${cfg.mode === 'stencil' ? '#7a4' : '#47a'};border-radius:2px;padding:1px 4px;flex-shrink:0`;
      row.appendChild(badge);

      // Apply button
      const applyBtn = document.createElement('button');
      applyBtn.textContent = t('common.apply');
      applyBtn.title = t('app.tjs.cut.config_apply_tip');
      applyBtn.style.cssText = 'background:#1a3a6a;border:none;border-radius:3px;color:#8cf;cursor:pointer;padding:2px 6px;font-size:10px;flex-shrink:0';
      applyBtn.onmouseenter = () => { applyBtn.style.background = '#1e4a8a'; };
      applyBtn.onmouseleave = () => { applyBtn.style.background = '#1a3a6a'; };
      applyBtn.addEventListener('click', () => _applyConfig(cfg));
      row.appendChild(applyBtn);

      // Delete button (solo autore: scrive nel mod_spec)
      if (!_canEdit(containerEl)) { _configList.appendChild(row); continue; }
      const delBtn = document.createElement('button');
      delBtn.innerHTML = '<i class="bi bi-x" style="pointer-events:none;font-size:13px" aria-hidden="true"></i>';
      delBtn.title = t('app.tjs.cut.config_delete_tip');
      delBtn.setAttribute('aria-label', delBtn.title);
      delBtn.style.cssText = 'background:transparent;border:none;color:#556;cursor:pointer;padding:1px 3px;display:flex;align-items:center;flex-shrink:0';
      delBtn.onmouseenter = () => { delBtn.style.color = '#d44'; };
      delBtn.onmouseleave = () => { delBtn.style.color = '#556'; };
      delBtn.addEventListener('click', () => _deleteConfig(cfg.id));
      row.appendChild(delBtn);

      _configList.appendChild(row);
    }
  }

  // ── Config save / apply / delete ─────────────────────────────────────────────

  async function _saveConfig(name) {
    if (!name?.trim()) { _cfgNameInput.focus(); return; }
    const st = cutTool?.getState?.();
    const transforms = cutTool?.getPlaneTransforms?.();
    if (!st) return;

    const cfg = {
      id:         'clip_' + Math.random().toString(36).slice(2, 10),
      name:       name.trim(),
      mode:       st.mode,
      capColor:   st.capColor,
      capOpacity: st.capOpacity,
      capSolid:   !!st.capSolid,
      planes:     transforms ?? st.planes,
    };

    await _mergeAndSave(list => { list.push(cfg); return list; });
    _cfgNameInput.value = '';
    _render();
  }

  function _applyConfig(cfg) {
    cutTool?.applyConfig?.(cfg);
    _render();
    markDirty();
  }

  async function _deleteConfig(id) {
    if (!window.confirm(t('app.tjs.cut.config_delete_confirm'))) return;
    await _mergeAndSave(list => list.filter(c => c.id !== id));
    _render();
  }

  async function _mergeAndSave(mutateFn) {
    const row = models?.[0];
    if (!row) {
      cmdUI?.update?.({ status: te('app.tjs.cut.no_model.@') });
      return;
    }
    try {
      const raw  = row.mod_spec;
      const spec = { ...(raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}) };
      spec.clipConfigs = mutateFn(Array.isArray(spec.clipConfigs) ? spec.clipConfigs : []);

      cmdUI?.update?.({ status: te('app.tjs.cut.config_saving') });
      const res  = await fetch('api/mod_spec_tool.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'save', mod_id: row.mod_id, mod_spec: spec }),
      });
      const data = await res.json();
      if (data.ok) {
        row.mod_spec = spec;
        cmdUI?.update?.({ status: te('app.tjs.cut.config_saved') });
      } else {
        cmdUI?.update?.({ status: te('app.tjs.cut.save_error', { error: data.error ?? t('app.tjs.cut.error_unknown') }) });
      }
    } catch {
      cmdUI?.update?.({ status: te('errors.network') });
    }
  }

  // ── Show / hide / toggle ──────────────────────────────────────────────────────

  function show() {
    if (!panelEl) panelEl = _build();
    if (!panelEl.parentNode) containerEl.appendChild(panelEl);
    panelEl.style.display = 'flex';
    visible = true;
    _render();
  }

  function hide() {
    if (panelEl) panelEl.style.display = 'none';
    visible = false;
  }

  function toggle() { visible ? hide() : show(); }

  return {
    show, hide, toggle,
    isVisible: () => visible,
    refresh:   _render,
    syncPlanes,
    dispose() { panelEl?.remove(); panelEl = null; visible = false; },
  };
}
