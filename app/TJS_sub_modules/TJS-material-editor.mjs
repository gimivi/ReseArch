// TJS-material-editor.mjs
// Pannello editor proprietà PBR del materiale selezionato (Mesh), esteso con
// pannelli dedicati per Points e Line — vedi "Salva su modello" in ciascuno:
// a differenza del resto del pannello (solo live, mai persistito), lo stile
// punti/linee viene scritto in mod_spec.pointsLineStyle del modello a cui
// l'oggetto selezionato appartiene (risalendo la catena `parent` fino al
// Group con `userData.modelRow`, creato in model_TJS.mjs al caricamento) —
// scelta esplicita dell'utente: il mod_spec di un modello è già inteso come
// personalizzazione di un'istanza, non della geometria condivisa nel file.
// setSelection(selection) viene chiamato da onSelectionChanged del transformTool.

import { applyPointShape } from './TJS-loaders.mjs';
import { t } from '../shared/i18n.mjs';
import { panelLevel } from '../shared/ui_level.mjs';

// Livello di interazione (§5): "Salva su modello" (mod_spec) solo da autore (30) in su
const _canSave = (el) => panelLevel(el) >= 30;   // livello del pannello (_doc/arch-permessi.md §11.4)

const SIDE_VALUES = { Front: 0, Back: 1, Double: 2 };
const SIDE_LABELS = { 0: 'Front', 1: 'Back', 2: 'Double' };

export function tjsCreateMaterialEditor({
  THREE,
  bodyEl,
  containerEl,
  cmdUI,
  signal,
  markDirty = () => {},
}) {
  const mountTarget = containerEl ?? bodyEl;
  let panelEl  = null;
  let visible  = false;
  let currentSelection = [];

  // ── Helpers selezione ────────────────────────────────────────────────────────

  function _getFirstMesh(selection) {
    for (const obj of selection) {
      if (obj.isMesh) return obj;
      let found = null;
      obj.traverse(c => { if (!found && c.isMesh) found = c; });
      if (found) return found;
    }
    return null;
  }

  // Come _getFirstMesh, ma riconosce anche Points/Line — priorità al primo
  // oggetto "renderizzabile" incontrato, di qualsiasi tipo.
  function _getFirstStyleTarget(selection) {
    const isTarget = (o) => o.isMesh || o.isPoints || o.isLine;
    for (const obj of selection) {
      if (isTarget(obj)) return obj;
      let found = null;
      obj.traverse(c => { if (!found && isTarget(c)) found = c; });
      if (found) return found;
    }
    return null;
  }

  function _getFirstMaterial(obj) {
    if (!obj) return null;
    return Array.isArray(obj.material) ? obj.material[0] : obj.material;
  }

  function _applyToObjs(selection, predicate, fn) {
    const seen = new Set();
    for (const obj of selection) {
      if (predicate(obj) && !seen.has(obj)) { seen.add(obj); fn(obj); }
      obj.traverse(c => { if (predicate(c) && !seen.has(c)) { seen.add(c); fn(c); } });
    }
    markDirty();
  }

  function _applyToMeshes(selection, fn) { _applyToObjs(selection, o => o.isMesh, fn); }
  function _applyToPoints(selection, fn) { _applyToObjs(selection, o => o.isPoints, fn); }
  function _applyToLines(selection, fn)  { _applyToObjs(selection, o => o.isLine, fn); }

  function _applyToMats(selection, fn) {
    const seen = new Set();
    _applyToMeshes(selection, mesh => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) { if (m && !seen.has(m)) { seen.add(m); fn(m); } }
    });
    // markDirty già chiamato da _applyToMeshes
  }

  // ── Persistenza stile punti/linee (mod_spec.pointsLineStyle) ────────────────

  function _parseSpec(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // Risale la catena `parent` fino al Group creato da model_TJS.mjs al
  // caricamento (`g.userData = { modelRow: row }`), per sapere a quale riga
  // `models` (e quindi quale mod_spec) appartiene l'oggetto selezionato.
  function _findOwningModelRow(obj) {
    let cur = obj;
    while (cur) {
      if (cur.userData?.modelRow) return cur.userData.modelRow;
      cur = cur.parent;
    }
    return null;
  }

  async function _saveStyle(row, partialStyle) {
    if (!row) { cmdUI?.update?.({ status: t('app.tjs.mat.no_model.@') }); return; }
    const spec = { ...(_parseSpec(row.mod_spec) ?? {}) };
    spec.pointsLineStyle = { ...(spec.pointsLineStyle ?? {}), ...partialStyle };
    try {
      cmdUI?.update?.({ status: t('app.tjs.mat.saving') });
      const res = await fetch('api/mod_spec_tool.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', mod_id: row.mod_id, mod_spec: spec }),
      });
      const data = await res.json();
      if (data.ok) { row.mod_spec = spec; cmdUI?.update?.({ status: t('app.tjs.mat.saved.@') }); }
      else          cmdUI?.update?.({ status: t('app.tjs.error_detail', { error: data.error }) });
    } catch { cmdUI?.update?.({ status: t('errors.network') }); }
  }

  // Ritorna null sotto il livello autore: i chiamanti aggiungono il pulsante solo se c'è
  function _saveBtn(onclick) {
    if (!_canSave(mountTarget)) return null;
    const b = document.createElement('button');
    b.className = 'tjs-rpanel-addbar-btn';
    b.style.cssText = 'width:100%;justify-content:center;margin-top:6px';
    b.innerHTML = '<i class="bi bi-floppy" style="margin-right:4px;color:#6af" aria-hidden="true"></i>';
    b.appendChild(document.createTextNode(t('app.tjs.mat.save_to_model.@')));
    b.onclick = onclick;
    return b;
  }

  // ── Costruzione pannello ─────────────────────────────────────────────────────

  function _buildPanel() {
    const el = document.createElement('div');
    el.className = 'tjs-rpanel-item';

    const hdr = document.createElement('div');
    hdr.className = 'tjs-rpanel-hdr';
    const title = document.createElement('span');
    title.className  = 'tjs-rpanel-hdr-title';
    title.textContent = t('app.tjs.mat.title');
    hdr.appendChild(title);
    const hdrBtns = document.createElement('div');
    hdrBtns.className = 'tjs-rpanel-hdr-btns';
    hdrBtns.appendChild(_hdrBtn('bi-x-lg', t('common.close'), () => hide()));
    hdr.appendChild(hdrBtns);
    el.appendChild(hdr);

    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow-y:auto;flex:1';
    el._scroll = scroll;
    el.appendChild(scroll);

    _rebuildContent(scroll, currentSelection);
    return el;
  }

  function _rebuildContent(scroll, selection) {
    scroll.innerHTML = '';

    const target = _getFirstStyleTarget(selection);

    if (!target) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:12px;font-size:11px;color:#889;text-align:center';
      msg.textContent = t('app.tjs.mat.no_selection');
      scroll.appendChild(msg);
      return;
    }

    if (target.isPoints) { _buildPointsPanel(scroll, selection, target); return; }
    if (target.isLine)   { _buildLinePanel(scroll, selection, target); return; }

    const mesh = target;
    const mat  = _getFirstMaterial(mesh);

    // ── Info ──────────────────────────────────────────────────────────────────
    const infoGroup = _group(t('app.tjs.mat.object'), 'bi-box');
    scroll.appendChild(infoGroup);
    _infoRow(infoGroup, t('common.name'), mesh.name || '—');
    _infoRow(infoGroup, t('app.tjs.mat.mat_type'), mat?.type ?? '—');

    // ── Ombre ─────────────────────────────────────────────────────────────────
    const shadowGroup = _group(t('app.tjs.mat.shadows'), 'bi-brightness-alt-high');
    scroll.appendChild(shadowGroup);

    _fieldRow(shadowGroup, 'Cast shadow', _checkbox(mesh.castShadow, v => {
      _applyToMeshes(selection, m => { m.castShadow = v; });
    }));
    _fieldRow(shadowGroup, 'Receive shadow', _checkbox(mesh.receiveShadow, v => {
      _applyToMeshes(selection, m => { m.receiveShadow = v; });
    }));

    // Shadow Receiver: sostituisce il materiale con ShadowMaterial (solo ombre, fondo trasparente)
    const isShadowMat = mesh.material?.isShadowMaterial || !!mesh.userData.__origMat;
    _fieldRow(shadowGroup, t('app.tjs.mat.shadow_only'), _checkbox(isShadowMat, v => {
      if (v) {
        // Salva materiale originale e sostituisce con ShadowMaterial
        _applyToMeshes(selection, m => {
          if (m.userData.__origMat) return;  // già applicato
          m.userData.__origMat = m.material;
          const sm = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.4, transparent: true });
          sm.name = '__ShadowReceiver__';
          m.material = sm;
          m.receiveShadow = true;
        });
      } else {
        // Ripristina materiale originale
        _applyToMeshes(selection, m => {
          if (!m.userData.__origMat) return;
          m.material.dispose?.();
          m.material = m.userData.__origMat;
          delete m.userData.__origMat;
        });
      }
      if (panelEl?._scroll) _rebuildContent(panelEl._scroll, currentSelection);
    }));

    // Controlli ShadowMaterial attivi
    if (isShadowMat && mesh.material?.isShadowMaterial) {
      const sm = mesh.material;
      _fieldRow(shadowGroup, t('app.tjs.mat.shadow_color'), _colorInput('#' + (sm.color?.getHexString() ?? '000000'), v => {
        _applyToMeshes(selection, m => { if (m.material?.isShadowMaterial) m.material.color?.set(v); });
      }));
      _fieldRow(shadowGroup, t('app.tjs.mat.shadow_opacity'), _range(sm.opacity ?? 0.4, 0, 1, 0.01, v => {
        _applyToMeshes(selection, m => { if (m.material?.isShadowMaterial) { m.material.opacity = v; } });
      }));
    }

    if (!mat) return;

    // ── Base ──────────────────────────────────────────────────────────────────
    const baseGroup = _group('Base', 'bi-circle-half');
    scroll.appendChild(baseGroup);

    if (mat.color !== undefined) {
      _fieldRow(baseGroup, t('common.color'), _colorInput('#' + mat.color.getHexString(), v => {
        _applyToMats(selection, m => { m.color?.set(v); });
      }));
    }

    if (mat.opacity !== undefined) {
      _fieldRow(baseGroup, t('app.tjs.mat.opacity'), _range(mat.opacity, 0, 1, 0.01, v => {
        _applyToMats(selection, m => {
          m.opacity = v; m.transparent = v < 1; m.needsUpdate = true;
        });
      }));
    }

    const sideLabel = SIDE_LABELS[mat.side] ?? 'Front';
    _fieldRow(baseGroup, t('app.tjs.mat.side'), _select(Object.keys(SIDE_VALUES), sideLabel, v => {
      _applyToMats(selection, m => { m.side = SIDE_VALUES[v]; m.needsUpdate = true; });
    }));

    _fieldRow(baseGroup, 'Wireframe', _checkbox(mat.wireframe ?? false, v => {
      _applyToMats(selection, m => { m.wireframe = v; });
    }));

    _fieldRow(baseGroup, 'Flat Shading', _checkbox(mat.flatShading ?? false, v => {
      _applyToMats(selection, m => { if ('flatShading' in m) { m.flatShading = v; m.needsUpdate = true; } });
    }));

    _fieldRow(baseGroup, 'Depth Write', _checkbox(mat.depthWrite ?? true, v => {
      _applyToMats(selection, m => { m.depthWrite = v; });
    }));

    // ── PBR standard ──────────────────────────────────────────────────────────
    if (mat.isMeshStandardMaterial) {
      const pbrGroup = _group('PBR', 'bi-gem');
      scroll.appendChild(pbrGroup);

      _fieldRow(pbrGroup, 'Roughness', _range(mat.roughness, 0, 1, 0.01, v => {
        _applyToMats(selection, m => { if ('roughness' in m) m.roughness = v; });
      }));

      _fieldRow(pbrGroup, 'Metalness', _range(mat.metalness, 0, 1, 0.01, v => {
        _applyToMats(selection, m => { if ('metalness' in m) m.metalness = v; });
      }));

      if (mat.emissive) {
        _fieldRow(pbrGroup, 'Emissive', _colorInput('#' + mat.emissive.getHexString(), v => {
          _applyToMats(selection, m => { m.emissive?.set(v); });
        }));
        _fieldRow(pbrGroup, 'Emissive Int.', _range(mat.emissiveIntensity ?? 1, 0, 5, 0.05, v => {
          _applyToMats(selection, m => { if ('emissiveIntensity' in m) m.emissiveIntensity = v; });
        }));
      }

      if (mat.aoMapIntensity !== undefined) {
        _fieldRow(pbrGroup, 'AO Map Int.', _range(mat.aoMapIntensity, 0, 1, 0.01, v => {
          _applyToMats(selection, m => { if ('aoMapIntensity' in m) m.aoMapIntensity = v; });
        }));
        if (!mat.aoMap) {
          const note = document.createElement('div');
          note.style.cssText = 'font-size:10px;color:#556;padding:0 2px 4px';
          note.textContent = t('app.tjs.mat.ao_note');
          pbrGroup.appendChild(note);
        }
      }

      if (mat.normalScale) {
        _fieldRow(pbrGroup, 'Normal Scale', _range(mat.normalScale.x, 0, 3, 0.05, v => {
          _applyToMats(selection, m => { m.normalScale?.set(v, v); });
        }));
      }

      // Env map intensity — la riflessione richiede scene.environment (impostabile dal pannello Ambiente › IBL)
      _fieldRow(pbrGroup, t('app.tjs.mat.reflection'), _range(mat.envMapIntensity ?? 1, 0, 3, 0.05, v => {
        _applyToMats(selection, m => { if ('envMapIntensity' in m) m.envMapIntensity = v; });
      }));
    }

    // ── MeshPhysicalMaterial ──────────────────────────────────────────────────
    if (mat.isMeshPhysicalMaterial) {
      const physGroup = _group('Physical', 'bi-stars');
      scroll.appendChild(physGroup);

      _fieldRow(physGroup, 'Clearcoat', _range(mat.clearcoat ?? 0, 0, 1, 0.01, v => {
        _applyToMats(selection, m => { if ('clearcoat' in m) m.clearcoat = v; });
      }));
      _fieldRow(physGroup, 'Clearcoat Rough.', _range(mat.clearcoatRoughness ?? 0, 0, 1, 0.01, v => {
        _applyToMats(selection, m => { if ('clearcoatRoughness' in m) m.clearcoatRoughness = v; });
      }));
      _fieldRow(physGroup, 'Transmission', _range(mat.transmission ?? 0, 0, 1, 0.01, v => {
        _applyToMats(selection, m => {
          if ('transmission' in m) { m.transmission = v; m.transparent = v > 0; m.needsUpdate = true; }
        });
      }));
      _fieldRow(physGroup, 'IOR', _numInput(mat.ior ?? 1.5, 0.1, v => {
        _applyToMats(selection, m => { if ('ior' in m) m.ior = v; });
      }));
      _fieldRow(physGroup, 'Thickness', _range(mat.thickness ?? 0, 0, 5, 0.05, v => {
        _applyToMats(selection, m => { if ('thickness' in m) m.thickness = v; });
      }));
      _fieldRow(physGroup, 'Sheen', _range(mat.sheen ?? 0, 0, 1, 0.01, v => {
        _applyToMats(selection, m => { if ('sheen' in m) m.sheen = v; });
      }));
      if (mat.sheenColor) {
        _fieldRow(physGroup, 'Sheen Color', _colorInput('#' + mat.sheenColor.getHexString(), v => {
          _applyToMats(selection, m => { m.sheenColor?.set(v); });
        }));
        _fieldRow(physGroup, 'Sheen Rough.', _range(mat.sheenRoughness ?? 0, 0, 1, 0.01, v => {
          _applyToMats(selection, m => { if ('sheenRoughness' in m) m.sheenRoughness = v; });
        }));
      }
      _fieldRow(physGroup, 'Iridescence', _range(mat.iridescence ?? 0, 0, 1, 0.01, v => {
        _applyToMats(selection, m => { if ('iridescence' in m) m.iridescence = v; });
      }));
    }

    // ── Texture attive (sola lettura) ─────────────────────────────────────────
    const texSlots = ['map','normalMap','roughnessMap','metalnessMap','aoMap',
                      'emissiveMap','envMap','alphaMap','displacementMap'];
    const active = texSlots.filter(k => mat[k]);
    const texGroup = _group(t('app.tjs.mat.textures'), 'bi-image');
    scroll.appendChild(texGroup);
    if (active.length) {
      for (const slot of active) {
        const tex  = mat[slot];
        const name = tex?.name || tex?.image?.src?.split('/').pop() || slot;
        _infoRow(texGroup, slot, name);
      }
    } else {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:4px 0 2px;font-size:10px;color:#556';
      msg.textContent = t('app.tjs.mat.no_textures');
      texGroup.appendChild(msg);
    }
  }

  // ── Pannello Points ──────────────────────────────────────────────────────────

  function _buildPointsPanel(scroll, selection, pts) {
    const mat = _getFirstMaterial(pts);

    const infoGroup = _group(t('app.tjs.mat.object'), 'bi-box');
    scroll.appendChild(infoGroup);
    _infoRow(infoGroup, t('common.name'), pts.name || '—');
    _infoRow(infoGroup, t('app.tjs.mat.mat_type'), mat?.type ?? '—');
    if (!mat) return;

    const ptGroup = _group(t('app.tjs.mat.points'), 'bi-braces-asterisk');
    scroll.appendChild(ptGroup);

    if (mat.color !== undefined) {
      _fieldRow(ptGroup, t('app.tjs.mat.tint'), _colorInput('#' + mat.color.getHexString(), v => {
        _applyToPoints(selection, obj => { obj.material?.color?.set(v); });
      }));
    }

    _fieldRow(ptGroup, t('app.tjs.mat.size'), _numInput(mat.size ?? 0.02, 0.001, v => {
      _applyToPoints(selection, obj => { if (obj.material) obj.material.size = Math.max(0.0001, v); });
    }));

    _fieldRow(ptGroup, t('app.tjs.attenuation'), _checkbox(mat.sizeAttenuation ?? true, v => {
      _applyToPoints(selection, obj => { if (obj.material) obj.material.sizeAttenuation = v; });
    }));

    const currentShape = mat.userData.__pointShape ?? (mat.map ? 'round' : 'square');
    _fieldRow(ptGroup, t('app.tjs.mat.shape'), _shapeSelect(currentShape, v => {
      _applyToPoints(selection, obj => { if (obj.material) applyPointShape(obj.material, v); });
    }));

    const row = _findOwningModelRow(pts);
    const ptSave = _saveBtn(() => _saveStyle(row, {
      size:            mat.size,
      sizeAttenuation: mat.sizeAttenuation,
      shape:           mat.userData.__pointShape ?? (mat.map ? 'round' : 'square'),
    }));
    if (ptSave) ptGroup.appendChild(ptSave);
  }

  // ── Pannello Line ────────────────────────────────────────────────────────────

  function _buildLinePanel(scroll, selection, line) {
    const mat = _getFirstMaterial(line);

    const infoGroup = _group(t('app.tjs.mat.object'), 'bi-box');
    scroll.appendChild(infoGroup);
    _infoRow(infoGroup, t('common.name'), line.name || '—');
    _infoRow(infoGroup, t('app.tjs.mat.mat_type'), mat?.type ?? '—');
    if (!mat) return;

    const lnGroup = _group(t('app.tjs.mat.line'), 'bi-slash-lg');
    scroll.appendChild(lnGroup);

    if (mat.color !== undefined) {
      _fieldRow(lnGroup, t('common.color'), _colorInput('#' + mat.color.getHexString(), v => {
        _applyToLines(selection, obj => { obj.material?.color?.set(v); });
      }));
    }

    _fieldRow(lnGroup, t('app.tjs.mat.line_width'), _numInput(mat.linewidth ?? 1, 0.5, v => {
      _applyToLines(selection, obj => { if (obj.material) obj.material.linewidth = Math.max(0.1, v); });
    }));

    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:#667;padding:0 2px 4px';
    note.textContent = t('app.tjs.mat.line_note');
    lnGroup.appendChild(note);

    const row = _findOwningModelRow(line);
    const lnSave = _saveBtn(() => _saveStyle(row, { lineWidth: mat.linewidth }));
    if (lnSave) lnGroup.appendChild(lnSave);
  }

  // Valore interno (square/round) separato dal testo mostrato (tradotto)
  function _shapeSelect(current, onChange) {
    const opts = [
      { v: 'square', label: t('app.tjs.shape.square') },
      { v: 'round',  label: t('app.tjs.shape.round') },
    ];
    return _select(opts, current === 'round' ? 'round' : 'square', v => onChange(v));
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────

  function _group(label, icon) {
    const g = document.createElement('div');
    g.className = 'tjs-rpanel-group';
    const ttl = document.createElement('div');
    ttl.className = 'tjs-rpanel-group-title';
    ttl.innerHTML = `<i class="bi ${icon}" style="margin-right:4px" aria-hidden="true"></i>`;
    ttl.appendChild(document.createTextNode(label));
    g.appendChild(ttl);
    return g;
  }

  function _fieldRow(container, label, ctrl) {
    const row = document.createElement('div');
    row.className = 'tjs-rpanel-field-row';
    const lbl = document.createElement('span');
    lbl.className   = 'tjs-rpanel-field-lbl';
    lbl.textContent = label;
    row.appendChild(lbl);
    // Accessibilità: l'etichetta è uno <span>, il nome dei campi passa da aria-label
    if (ctrl instanceof HTMLElement) {
      const fields = ctrl.matches('input,select') ? [ctrl] : [...ctrl.querySelectorAll('input,select')];
      fields.forEach(f => { if (!f.hasAttribute('aria-label')) f.setAttribute('aria-label', label); });
    }
    if (ctrl instanceof HTMLElement) row.appendChild(ctrl);
    container.appendChild(row);
  }

  function _infoRow(container, label, value) {
    const row = document.createElement('div');
    row.className = 'tjs-rpanel-field-row';
    const lbl = document.createElement('span');
    lbl.className   = 'tjs-rpanel-field-lbl';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.style.cssText = 'font-size:10px;color:#aab;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px';
    val.title = value;
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    container.appendChild(row);
  }

  function _hdrBtn(icon, title, onclick) {
    const b = document.createElement('button');
    b.className = 'tjs-rpanel-hdr-btn';
    b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
    b.title   = title;
    b.setAttribute('aria-label', title);
    b.onclick = onclick;
    return b;
  }

  function _colorInput(hex, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'color';
    inp.className = 'tjs-rpanel-color-input';
    inp.value = (hex && hex.length === 7) ? hex : '#ffffff';
    inp.oninput = () => onChange(inp.value);
    return inp;
  }

  function _checkbox(checked, onChange) {
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.className = 'tjs-rpanel-checkbox';
    cb.checked = !!checked;
    cb.onchange = () => onChange(cb.checked);
    return cb;
  }

  function _range(val, min, max, step, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1';
    const r = document.createElement('input');
    r.type = 'range'; r.className = 'tjs-rpanel-range';
    r.min = String(min); r.max = String(max); r.step = String(step);
    r.value = String(val);
    const n = document.createElement('input');
    n.type = 'number'; n.className = 'tjs-rpanel-num-input';
    n.style.width = '44px';
    n.min = String(min); n.max = String(max); n.step = String(step);
    n.value = String(Math.round(val * 1000) / 1000);
    r.oninput = () => {
      const v = parseFloat(r.value);
      n.value = String(Math.round(v * 1000) / 1000);
      if (Number.isFinite(v)) onChange(v);
    };
    n.onchange = () => {
      const v = Math.min(max, Math.max(min, parseFloat(n.value)));
      r.value = String(v);
      if (Number.isFinite(v)) onChange(v);
    };
    wrap.appendChild(r); wrap.appendChild(n);
    return wrap;
  }

  function _numInput(val, step, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'number'; inp.className = 'tjs-rpanel-num-input';
    inp.step  = String(step);
    inp.value = String(Math.round(val * 1000) / 1000);
    inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) onChange(v); };
    return inp;
  }

  // options: stringhe (valore = testo) oppure { v, label } (valore interno + testo mostrato)
  function _select(options, current, onChange) {
    const sel = document.createElement('select');
    sel.className = 'tjs-rpanel-select';
    for (const opt of options) {
      const o = document.createElement('option');
      const v = typeof opt === 'object' ? opt.v : opt;
      o.value = v; o.textContent = typeof opt === 'object' ? opt.label : opt;
      if (v === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }

  // ── API pubblica ──────────────────────────────────────────────────────────────

  function setSelection(selection) {
    currentSelection = Array.isArray(selection) ? selection : [];
    if (visible && panelEl?._scroll) {
      _rebuildContent(panelEl._scroll, currentSelection);
    }
  }

  function show() {
    if (!panelEl) { panelEl = _buildPanel(); mountTarget.appendChild(panelEl); }
    panelEl.style.display = 'flex';
    visible = true;
  }

  function hide() {
    if (panelEl) panelEl.style.display = 'none';
    visible = false;
  }

  function toggle() { if (visible) hide(); else show(); }

  function dispose() {
    panelEl?.remove();
    panelEl  = null;
    visible  = false;
  }

  if (signal) signal.addEventListener('abort', dispose, { once: true });

  return { show, hide, toggle, dispose, isVisible: () => visible, setSelection };
}
