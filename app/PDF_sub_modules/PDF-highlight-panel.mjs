// PDF-highlight-panel.mjs
// Pannello laterale per la gestione delle annotazioni PDF.
// Unifica viste salvate + evidenziazioni testo in un'unica interfaccia.
//
// API pubblica:
//   show() / hide() / toggle() / isVisible()
//   setHighlights(arr, types)     → carica dati, tipi, aggiorna lista
//   setCurrentUser(userId, canEditAll) → permessi edit/delete per l'utente corrente
//   setCurrentPage(n)             → aggiorna il filtro "pagina corrente"
//   onSelect(hl)                  → callback: utente clicca una voce
//   onEdit(hl)                    → callback: utente clicca matita
//   onShowAll()                   → callback: pulsante "Tutto"
//   onShowPage(n)                 → callback: pulsante "Pagina"
//   onHide()                      → callback: pulsante "Nascondi"
//   onDelete(hl_id, mod_id)       → callback: utente elimina voce
//   onVisibilityChange(v)         → callback: visibilità cambiata
//   dispose()

// ─────────────────────────────────────────────────────────────────────────────

import { t, te, formatDate } from "../shared/i18n.mjs";
import { panelLevel } from "../shared/ui_level.mjs";

export function pdfCreateHighlightPanel({ containerEl, signal } = {}) {

  let visible      = false;
  let highlights   = [];
  let types        = [];
  let filterTypeId = null;   // null = tutti
  let searchQuery  = '';
  let currentPage  = 1;
  let currentUserId  = null;
  let canEditAll     = false;

  // ── DOM ───────────────────────────────────────────────────────────────────

  const panel = document.createElement('div');
  panel.className    = 'pdf-hl-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', t('app.pdf.annotations'));
  panel.style.display = 'none';

  panel.innerHTML = `
    <div class="pdf-hl-panel-hdr">
      <span class="pdf-hl-panel-title">${te('app.pdf.annotations')}</span>
      <button type="button" class="pdf-hl-panel-close" title="${te('common.close')}" aria-label="${te('common.close')}"><span aria-hidden="true">✕</span></button>
    </div>

    <div class="pdf-hl-panel-filters">
      <div class="pdf-hl-panel-types"></div>
      <input type="search" class="pdf-hl-panel-search" placeholder="${te('app.pdf.hl.search_ph')}" aria-label="${te('common.search')}">
    </div>

    <div class="pdf-hl-panel-actions">
      <button type="button" class="pdf-hl-panel-btn" data-act="all"  title="${te('app.pdf.hl.show_all_title')}">
        <i class="bi bi-layers" aria-hidden="true"></i> ${te('app.pdf.hl.show_all')}
      </button>
      <button type="button" class="pdf-hl-panel-btn" data-act="page" title="${te('app.pdf.hl.show_page_title')}">
        <i class="bi bi-file-earmark" aria-hidden="true"></i> ${te('app.pdf.hl.show_page')}
      </button>
      <button type="button" class="pdf-hl-panel-btn" data-act="hide" title="${te('app.pdf.hl.hide_title')}">
        <i class="bi bi-eye-slash" aria-hidden="true"></i> ${te('app.pdf.hl.hide')}
      </button>
    </div>

    <div class="pdf-hl-panel-list"></div>
  `;

  containerEl.appendChild(panel);

  const typesEl  = panel.querySelector('.pdf-hl-panel-types');
  const searchEl = panel.querySelector('.pdf-hl-panel-search');
  const listEl   = panel.querySelector('.pdf-hl-panel-list');
  const btnClose = panel.querySelector('.pdf-hl-panel-close');

  // ── Hover card (globale, position:fixed) ──────────────────────────────────

  const hoverCard = document.createElement('div');
  hoverCard.className = 'pdf-hl-hover-card';
  hoverCard.style.display = 'none';
  document.body.appendChild(hoverCard);

  let _hoverTimer = 0;

  function _showHoverCard(hl, rowEl) {
    clearTimeout(_hoverTimer);
    const r = rowEl.getBoundingClientRect();

    // Contenuto della card
    const color   = (hl.hlt_color ?? '#888').substring(0, 7);
    const label   = hl.hl_label || hl.hlt_title || '';
    const text    = hl.hl_text  ? `"${hl.hl_text.substring(0, 300)}${hl.hl_text.length > 300 ? '…' : ''}"` : '';
    const note    = hl.hl_note  || '';
    const author  = hl.hl_author || '';
    const date    = hl.hl_created_at ? _fmtDate(hl.hl_created_at) : '';
    const metaParts = [`p.${hl.hl_page}`, `${Math.round((hl.hl_scale ?? 1) * 100)}%`];
    if (hl.hl_rotation) metaParts.push(`${hl.hl_rotation}°`);
    if (hl.hl_spread)   metaParts.push('⊞');

    hoverCard.innerHTML = `
      <div class="pdf-hl-hc-hdr">
        <span class="pdf-hl-hc-badge" style="background:${color}">${_esc(hl.hlt_title ?? '')}</span>
        ${label && label !== hl.hlt_title ? `<span class="pdf-hl-hc-label">${_esc(label)}</span>` : ''}
      </div>
      ${text ? `<blockquote class="pdf-hl-hc-text">${_esc(text)}</blockquote>` : ''}
      ${note ? `<p class="pdf-hl-hc-note">${_esc(note)}</p>` : ''}
      <div class="pdf-hl-hc-meta">
        ${author ? `<span><i class="bi bi-person"></i> ${_esc(author)}</span>` : ''}
        ${date   ? `<span><i class="bi bi-clock"></i> ${_esc(date)}</span>`   : ''}
        <span><i class="bi bi-file-earmark"></i> ${metaParts.join(' · ')}</span>
      </div>
    `;

    hoverCard.style.display = 'block';

    // Posiziona a sinistra del pannello, allineata alla riga
    const cw = hoverCard.offsetWidth  || 300;
    const ch = hoverCard.offsetHeight || 120;
    let left = r.left - cw - 8;
    let top  = r.top;
    if (left < 4) left = r.right + 8;          // se non c'è spazio a sinistra, va a destra
    if (top + ch > window.innerHeight - 8)
      top = window.innerHeight - ch - 8;         // non uscire in basso
    top = Math.max(4, top);

    hoverCard.style.left = left + 'px';
    hoverCard.style.top  = top  + 'px';
  }

  function _hideHoverCard(delay = 80) {
    clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(() => { hoverCard.style.display = 'none'; }, delay);
  }

  // Mantieni la card visibile quando il mouse vi si sposta sopra
  hoverCard.addEventListener('mouseenter', () => clearTimeout(_hoverTimer));
  hoverCard.addEventListener('mouseleave', () => _hideHoverCard());

  // ── Events ────────────────────────────────────────────────────────────────

  btnClose.addEventListener('click', () => hide());

  panel.querySelector('[data-act="all"]').addEventListener('click',  () => api.onShowAll?.());
  panel.querySelector('[data-act="page"]').addEventListener('click', () => api.onShowPage?.(currentPage));
  panel.querySelector('[data-act="hide"]').addEventListener('click', () => api.onHide?.());

  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value.trim().toLowerCase();
    _renderList();
  });

  if (signal) signal.addEventListener('abort', dispose, { once: true });

  // ── API pubblica ──────────────────────────────────────────────────────────

  const api = {
    onSelect:           null,
    onEdit:             null,
    onShowAll:          null,
    onShowPage:         null,
    onHide:             null,
    onDelete:           null,
    onVisibilityChange: null,
  };

  function show() {
    if (visible) return;
    visible = true;
    panel.style.display = 'flex';
    api.onVisibilityChange?.(true);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    panel.style.display = 'none';
    hoverCard.style.display = 'none';
    api.onVisibilityChange?.(false);
  }

  function toggle() { visible ? hide() : show(); }
  function isVisible() { return visible; }

  function setHighlights(arr, typesArr) {
    highlights = Array.isArray(arr) ? arr : [];
    types      = Array.isArray(typesArr) ? typesArr : [];
    _renderTypeFilters();
    _renderList();
  }

  function setCurrentPage(n) {
    currentPage = n;
  }

  function setCurrentUser(userId, editAll) {
    currentUserId = userId ?? null;
    canEditAll    = !!editAll;
    _renderList();   // ricrea le righe con i pulsanti aggiornati
  }

  function dispose() {
    hoverCard.remove();
    panel.remove();
  }

  Object.assign(api, { show, hide, toggle, isVisible, setHighlights, setCurrentPage, setCurrentUser, dispose });

  // ── Render filtri tipo ────────────────────────────────────────────────────

  function _renderTypeFilters() {
    typesEl.innerHTML = '';

    const allPill = _pill(t('common.all'), null, filterTypeId === null);
    allPill.addEventListener('click', () => {
      filterTypeId = null;
      _updateTypeActive();
      _renderList();
    });
    typesEl.appendChild(allPill);

    for (const ty of types) {
      const pill = _pill(ty.hlt_title, ty.hlt_color, filterTypeId === ty.hlt_id);
      pill.dataset.hltId = String(ty.hlt_id);
      pill.addEventListener('click', () => {
        filterTypeId = ty.hlt_id;
        _updateTypeActive();
        _renderList();
      });
      typesEl.appendChild(pill);
    }
  }

  function _updateTypeActive() {
    for (const pill of typesEl.querySelectorAll('.pdf-hl-pill')) {
      const id = pill.dataset.hltId ? parseInt(pill.dataset.hltId, 10) : null;
      pill.classList.toggle('active', id === filterTypeId);
    }
  }

  // ── Render lista ──────────────────────────────────────────────────────────

  function _renderList() {
    const filtered = _filteredHighlights();
    listEl.innerHTML = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className   = 'pdf-hl-panel-empty';
      empty.textContent = highlights.length
        ? t('app.pdf.hl.no_results')
        : t('app.pdf.hl.none_saved');
      listEl.appendChild(empty);
      return;
    }

    for (const hl of filtered) {
      listEl.appendChild(_makeRow(hl));
    }
  }

  function _filteredHighlights() {
    return highlights.filter(hl => {
      if (filterTypeId !== null && hl.hlt_id !== filterTypeId) return false;
      if (searchQuery) {
        const hay = [hl.hl_text, hl.hl_label, hl.hl_note, hl.hl_tags]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(searchQuery)) return false;
      }
      return true;
    });
  }

  function _makeRow(hl) {
    const row  = document.createElement('div');
    row.className = 'pdf-hl-panel-row';

    // Striscia colore tipo
    const stripe = document.createElement('div');
    stripe.className   = 'pdf-hl-panel-stripe';
    stripe.style.background = (hl.hlt_color ?? '#888').substring(0, 7);

    // Icona tipo
    const ico = document.createElement('i');
    ico.className = hl.hlt_is_view
      ? 'bi bi-chat-square-text pdf-hl-panel-ico'
      : 'bi bi-highlighter pdf-hl-panel-ico';
    ico.style.color = (hl.hlt_color ?? '#888').substring(0, 7);

    // Info
    const info  = document.createElement('div');
    info.className = 'pdf-hl-panel-info';

    const label = document.createElement('span');
    label.className   = 'pdf-hl-panel-label';
    label.textContent = hl.hl_label || hl.hlt_title;

    const preview = document.createElement('span');
    preview.className   = 'pdf-hl-panel-preview';
    preview.textContent = hl.hl_text
      ? `"${hl.hl_text.substring(0, 70)}${hl.hl_text.length > 70 ? '…' : ''}"`
      : (hl.hl_note ? hl.hl_note.substring(0, 70) : '');

    const meta = document.createElement('span');
    meta.className   = 'pdf-hl-panel-meta';
    const metaParts  = [`p.${hl.hl_page}`, `${Math.round((hl.hl_scale ?? 1) * 100)}%`];
    if (hl.hl_rotation) metaParts.push(`${hl.hl_rotation}°`);
    if (hl.hl_spread)   metaParts.push('⊞');
    meta.textContent = metaParts.join(' · ');

    info.append(label, preview, meta);

    // Bottoni riga (visibili solo agli utenti autorizzati)
    const btns   = document.createElement('div');
    btns.className = 'pdf-hl-panel-row-btns';

    // Livello del pannello (_doc/arch-permessi.md §11.4): modifica/eliminazione solo da 30 in su
    const canModify = panelLevel(containerEl) >= 30
      && (canEditAll || (currentUserId !== null && hl.hl_user_id === currentUserId));

    if (canModify) {
      const btnEdit = _iconBtn('bi bi-pencil', t('common.edit'));
      btnEdit.classList.add('pdf-hl-panel-btn--edit');
      btns.appendChild(btnEdit);

      const btnDel = _iconBtn('bi bi-trash3', t('common.delete'));
      btnDel.classList.add('pdf-hl-panel-btn--del');
      btns.appendChild(btnDel);

      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        _hideHoverCard(0);
        api.onEdit?.(hl);
      });

      btnDel.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(t('app.pdf.hl.confirm_delete', { name: hl.hl_label || hl.hlt_title }))) return;
        _hideHoverCard(0);
        await api.onDelete?.(hl.hl_id, hl.mod_id);
      });
    }

    row.append(stripe, ico, info, btns);

    // Click su riga → naviga + flash
    row.addEventListener('click', (e) => {
      if (e.target.closest('.pdf-hl-panel-row-btns')) return;
      _hideHoverCard(0);
      api.onSelect?.(hl);
    });

    // Hover card
    row.addEventListener('mouseenter', () => _showHoverCard(hl, row));
    row.addEventListener('mouseleave', () => _hideHoverCard());

    return row;
  }

  // ── Helpers DOM ───────────────────────────────────────────────────────────

  function _pill(label, color, active) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'pdf-hl-pill' + (active ? ' active' : '');
    btn.textContent = label;
    if (color) {
      btn.style.borderColor = color.substring(0, 7);
      if (active) btn.style.background = color.substring(0, 7) + '44';
    }
    return btn;
  }

  function _iconBtn(iconClass, title) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'pdf-hl-panel-icon-btn';
    btn.title     = title;
    btn.setAttribute('aria-label', title);
    const ico = document.createElement('i');
    ico.className = iconClass;
    btn.appendChild(ico);
    return btn;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _fmtDate(s) {
    if (!s) return '';
    try {
      const d = new Date(s);
      return formatDate(d, { day:'2-digit', month:'2-digit', year:'numeric',
                             hour:'2-digit', minute:'2-digit' });
    } catch { return s; }
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Return ────────────────────────────────────────────────────────────────

  _renderList();
  return api;
}
