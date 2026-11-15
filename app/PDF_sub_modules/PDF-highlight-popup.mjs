// PDF-highlight-popup.mjs
// Popover per il salvataggio di annotazioni (testo evidenziato) e viste.
//
// showForText(selData, types) → mostrato dopo selezione testo nel textLayer
// showForView(viewState, types) → mostrato per salvare una vista
// setMarkerPosition(x, y)     → aggiorna la posizione del marker (dopo clic su pagina)
//
// Callback da impostare:
//   popup.onSave              = async (data) => { ... }  ← riceve il payload da salvare
//   popup.onRequestPlacement  = (callback) => { ... }    ← richiesta clic su pagina

// ─────────────────────────────────────────────────────────────────────────────

import { t, te } from "../shared/i18n.mjs";

export function pdfCreateHighlightPopup({ containerEl, signal } = {}) {

  let _selData    = null;   // dati selezione testo corrente
  let _viewState  = null;   // stato vista corrente
  let _isView     = false;
  let _markerX    = 0.5;    // posizione marker normalizzata (0-1)
  let _markerY    = 0.04;
  let _editId     = null;   // hl_id se in modalità modifica, null se nuova annotazione
  let _editModId  = null;

  // ── DOM ───────────────────────────────────────────────────────────────────

  const el = _div('pdf-hl-popup');
  el.style.display = 'none';
  el.innerHTML = `
    <div class="pdf-hl-popup-hdr">
      <span class="pdf-hl-popup-title">${te('app.pdf.hl.save_annotation')}</span>
      <button type="button" class="pdf-hl-popup-close" title="${te('common.cancel')}" aria-label="${te('common.cancel')}"><span aria-hidden="true">✕</span></button>
    </div>
    <div class="pdf-hl-popup-body">
      <select class="pdf-hl-popup-type" aria-label="${te('common.type')}"></select>
      <input  class="pdf-hl-popup-label" type="text" placeholder="${te('app.pdf.hl.label_ph')}" aria-label="${te('app.pdf.hl.label')}" maxlength="255">
      <textarea class="pdf-hl-popup-note" placeholder="${te('app.pdf.hl.note_ph')}" aria-label="${te('common.notes')}" rows="3"></textarea>
      <div class="pdf-hl-popup-info"></div>
      <div class="pdf-hl-popup-placement" style="display:none">
        <button type="button" class="pdf-hl-popup-place-btn">
          <i class="bi bi-crosshair" aria-hidden="true"></i> ${te('app.pdf.hl.click_place')}
        </button>
        <span class="pdf-hl-popup-place-coords"></span>
      </div>
    </div>
    <div class="pdf-hl-popup-footer">
      <button type="button" class="pdf-hl-popup-save">${te('common.save')}</button>
      <button type="button" class="pdf-hl-popup-cancel">${te('common.cancel')}</button>
    </div>
  `;
  containerEl.appendChild(el);

  const titleEl     = el.querySelector('.pdf-hl-popup-title');
  const typeEl      = el.querySelector('.pdf-hl-popup-type');
  const labelEl     = el.querySelector('.pdf-hl-popup-label');
  const noteEl      = el.querySelector('.pdf-hl-popup-note');
  const infoEl      = el.querySelector('.pdf-hl-popup-info');
  const placementEl = el.querySelector('.pdf-hl-popup-placement');
  const placeBtn    = el.querySelector('.pdf-hl-popup-place-btn');
  const placeCoordsEl = el.querySelector('.pdf-hl-popup-place-coords');
  const btnClose    = el.querySelector('.pdf-hl-popup-close');
  const btnSave     = el.querySelector('.pdf-hl-popup-save');
  const btnCancel   = el.querySelector('.pdf-hl-popup-cancel');

  // ── Events ────────────────────────────────────────────────────────────────

  btnClose.addEventListener('click',  hide);
  btnCancel.addEventListener('click', hide);

  btnSave.addEventListener('click', async () => {
    const hlt_id = parseInt(typeEl.value, 10);
    if (!hlt_id) return;
    btnSave.disabled = true;
    try {
      await api.onSave?.(_buildPayload(hlt_id));
    } finally {
      btnSave.disabled = false;
      hide();
    }
  });

  // Chiudi con Escape
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); hide(); }
  });

  // Bottone posizionamento marker:
  // nasconde SOLO visivamente il popup (non cancella _viewState/_selData)
  // così _buildPayload può ancora costruire il payload corretto dopo il clic.
  placeBtn.addEventListener('click', () => {
    if (!api.onRequestPlacement) return;
    el.style.display = 'none';   // nasconde senza chiamare hide() che azzera lo stato
    api.onRequestPlacement((x, y) => {
      setMarkerPosition(x, y);
      el.style.display = 'flex';
    });
  });

  if (signal) signal.addEventListener('abort', dispose, { once: true });

  // ── API pubblica ──────────────────────────────────────────────────────────

  const api = {
    onSave:             null,
    onRequestPlacement: null,   // (callback(x,y)) => void  — entra in modalità clic-pagina

    showForText(selData, types) {
      _editId    = null;
      _editModId = null;
      _selData   = selData;
      _viewState = null;
      _isView    = false;
      _populate(types.filter(ty => !ty.hlt_is_view));
      titleEl.textContent = t('app.pdf.hl.save_highlight');
      infoEl.textContent  = `"${(selData.text ?? '').substring(0, 100)}…"`;
      infoEl.style.display = selData.text ? '' : 'none';
      placementEl.style.display = 'none';
      _show();
      _positionNear(selData.anchorEl);
    },

    showForEdit(hl, typesArr) {
      // Apre il popup pre-compilato per modificare label/nota/tipo di un'annotazione esistente
      _editId   = hl.hl_id;
      _editModId = hl.mod_id;
      _selData  = null;
      _viewState = null;
      _isView   = !!(hl.hlt_is_view);
      const filtered = typesArr.filter(ty => !!ty.hlt_is_view === _isView);
      _populate(filtered);
      // Seleziona il tipo corrente dell'annotazione
      typeEl.value = String(hl.hlt_id ?? '');
      titleEl.textContent  = t('app.pdf.hl.edit_annotation');
      infoEl.textContent   = hl.hl_text
        ? `"${(hl.hl_text).substring(0, 100)}…"`
        : (hl.hlt_is_view ? t('app.pdf.hl.page_n', { n: hl.hl_page }) : '');
      infoEl.style.display = '';
      placementEl.style.display = 'none';
      // Pre-compila campi
      labelEl.value = hl.hl_label ?? '';
      noteEl.value  = hl.hl_note  ?? '';
      el.style.display = 'flex';
      _positionCenter();
      labelEl.focus();
    },

    showForView(viewState, types) {
      _editId    = null;
      _editModId = null;
      _viewState = viewState;
      _selData   = null;
      _isView    = true;
      // Ripristina posizione marker ai valori della vista (o default)
      _markerX = viewState.markerX ?? 0.5;
      _markerY = viewState.markerY ?? 0.04;
      _populate(types.filter(ty => ty.hlt_is_view));
      titleEl.textContent  = t('app.pdf.hl.save_view');
      infoEl.textContent   = t('app.pdf.hl.page_zoom', { n: viewState.page, z: Math.round(viewState.scale * 100) });
      infoEl.style.display = '';
      placementEl.style.display = '';
      _updatePlaceCoords();
      _show();
      _positionCenter();
    },

    setMarkerPosition,
    hide,
    dispose,
  };

  function setMarkerPosition(x, y) {
    _markerX = Math.max(0, Math.min(1, x));
    _markerY = Math.max(0, Math.min(1, y));
    _updatePlaceCoords();
  }

  function _updatePlaceCoords() {
    placeCoordsEl.textContent =
      `${Math.round(_markerX * 100)}% · ${Math.round(_markerY * 100)}%`;
  }

  return api;

  // ── Internals ─────────────────────────────────────────────────────────────

  function _populate(types) {
    typeEl.innerHTML = '';
    for (const ty of types) {
      const opt = document.createElement('option');
      opt.value       = String(ty.hlt_id);
      opt.textContent = ty.hlt_title;
      typeEl.appendChild(opt);
    }
    // Aggiorna colore swatch quando cambia la selezione
    _updateTypeSwatch(types);
    typeEl.addEventListener('change', () => _updateTypeSwatch(types), { once: false });
  }

  function _updateTypeSwatch(types) {
    const hlt_id = parseInt(typeEl.value, 10);
    const ty     = types.find(x => x.hlt_id === hlt_id);
    typeEl.style.borderLeftColor = ty?.hlt_color?.substring(0, 7) ?? '#888';
  }

  function _show() {
    labelEl.value = '';
    noteEl.value  = '';
    el.style.display = 'flex';
    labelEl.focus();
  }

  function hide() {
    el.style.display = 'none';
    _selData   = null;
    _viewState = null;
    _editId    = null;
    _editModId = null;
  }

  function _positionNear(anchorEl) {
    if (!anchorEl) { _positionCenter(); return; }
    const ab = anchorEl.getBoundingClientRect();
    const cb = containerEl.getBoundingClientRect();
    // Tenta di posizionare il popup sotto la pagina, centrato
    const left = Math.max(4, Math.min(
      ab.left - cb.left + ab.width / 2 - 160,
      cb.width - 328
    ));
    const top  = Math.max(4, ab.bottom - cb.top + 8);
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }

  function _positionCenter() {
    const cb = containerEl.getBoundingClientRect();
    el.style.left = Math.max(4, (cb.width  - 320) / 2) + 'px';
    el.style.top  = Math.max(4, (cb.height - 260) / 2) + 'px';
  }

  function _buildPayload(hlt_id) {
    // Modalità modifica: solo campi editabili
    if (_editId) {
      return {
        action:   'update',
        hl_id:    _editId,
        mod_id:   _editModId,
        hlt_id,
        hl_label: labelEl.value.trim() || null,
        hl_note:  noteEl.value.trim()  || null,
      };
    }
    if (_isView && _viewState) {
      return {
        hlt_id,
        hl_label:       labelEl.value.trim() || null,
        hl_note:        noteEl.value.trim()  || null,
        hl_page:        _viewState.page,
        hl_scale:       _viewState.scale,
        hl_rotation:    _viewState.rotation  ?? 0,
        hl_spread:      _viewState.spread    ? 1 : 0,
        hl_scroll_top:  _viewState.scrollTop  ?? 0,
        hl_scroll_left: _viewState.scrollLeft ?? 0,
        hl_rects:       null,
        hl_marker_x:    _markerX,   // aggiornato da setMarkerPosition o default 0.5
        hl_marker_y:    _markerY,   // aggiornato da setMarkerPosition o default 0.04
      };
    }
    // Testo evidenziato
    return {
      hlt_id,
      hl_text:        _selData?.text  ?? '',
      hl_label:       labelEl.value.trim() || null,
      hl_note:        noteEl.value.trim()  || null,
      hl_page:        _selData?.pageNum    ?? 1,
      hl_scale:       _selData?.scale      ?? 1,
      hl_rotation:    _selData?.rotation   ?? 0,
      hl_spread:      _selData?.spread     ? 1 : 0,
      hl_scroll_top:  _selData?.scrollTop  ?? 0,
      hl_scroll_left: _selData?.scrollLeft ?? 0,
      hl_rects:       _selData?.rects      ?? [],
      hl_marker_x:    null,
      hl_marker_y:    null,
    };
  }

  function dispose() {
    el.remove();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function _div(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
