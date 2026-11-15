// ui/dashboard_windows.mjs
// BSP Tiling Window Manager for ReseArch dashboard.
//
// Public API:
//   initDashboardWindows(rootEl)  — mount WM inside #panelRoot
//   serialize()                   — BSP tree as plain JSON (future persistence)
//
// Modalità a schede (fase 6 di _doc/arch-i18n-a11y.md §7, deciso 2026-10-11): sotto i 992px di
// larghezza della finestra i pannelli non si affiancano. Una barra di schede in cima a #panelRoot
// elenca i pannelli; se ne vede uno alla volta, a tutto spazio. L'albero BSP (divisioni e
// proporzioni) non cambia: tornando sopra i 992px il layout è quello di prima, e la
// configurazione della dashboard si salva uguale.
//
// Panel HTML is compatible with template_XXX.mjs:
//   .panel-header  > .wm-left > [data-menu="left"]  +  .panel-toolbar  +  .wm-controls > .wm-ctrls-group > [data-menu="right"]
//   .panel-body
//   .panel-footer  > .pf-status + .pf-hints + .pf-controls

// ============================================================
// CONSTANTS
// ============================================================

import { te } from "../app/shared/i18n.mjs";

const GRID             = 30;     // snap grid, px
const BAR_SIZE         = 8;      // split-bar grab area, px
const MIN_PX           = 100;    // minimum cell dimension, px (150 fino al 2026-10-21)
const HIDE_DELAY       = 10_000; // auto-hide timeout, ms
const PHONE_BREAKPOINT = 600;    // smaller desk dimension → phone behaviour
const TABS_QUERY       = "(max-width: 991.98px)";   // sotto lg di Bootstrap: pannelli a schede

// ============================================================
// MODULE STATE
// ============================================================

let _rootEl  = null;   // #panelRoot element
let _bspRoot = null;   // root BSP node
let _deskW   = 0;
let _deskH   = 0;
let _maxLeaf = null;   // currently maximised leaf, or null
let _tabMode    = false; // pannelli a schede (finestra stretta)
let _activeLeaf = null;  // pannello visibile in modalità a schede
let _tabBarEl   = null;  // barra delle schede (role="tablist")

// ============================================================
// PUBLIC ENTRY POINT
// ============================================================

/**
 * Initialise the WM.  Call once after DOMContentLoaded.
 * @param {HTMLElement} rootEl  — the #panelRoot container
 */
export function initDashboardWindows(rootEl) {
    _rootEl = rootEl;
    _rootEl.innerHTML = "";

    const r = _rootEl.getBoundingClientRect();
    _deskW = Math.round(r.width)  || rootEl.offsetWidth;
    _deskH = Math.round(r.height) || rootEl.offsetHeight;

    _bspRoot = _makeLeaf(null);
    _layout(_bspRoot, { x: 0, y: 0, w: _deskW, h: _deskH }, false);
    _updateSplitButtons();

    // Modalità a schede: segue la larghezza della finestra
    const mq = window.matchMedia(TABS_QUERY);
    _tabMode = mq.matches;
    mq.addEventListener("change", ev => {
        _tabMode = ev.matches;
        _relayout(false);
        _updateSplitButtons();
    });
    _afterLayout();

    // Proportional relayout on container resize
    new ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect;
        const nW = Math.round(width), nH = Math.round(height);
        if (nW === _deskW && nH === _deskH) return;
        _deskW = nW; _deskH = nH;
        _relayout(false);
        _updateSplitButtons();
    }).observe(_rootEl);

    // Single delegated listener for all WM button clicks
    _rootEl.addEventListener("click", _handleWMClick);
}

// ============================================================
// BSP NODE FACTORIES
// ============================================================

function _makeLeaf(parent) {
    const el   = _buildPanelEl();
    const leaf = {
        type:       "leaf",
        el,
        parent,
        rect:       null,
        savedState: { objectId: null, modId: null, viewSpec: {}, selectedModelIds: null, embeddedFlow: null },
    };
    el._wmLeaf = leaf;  // back-reference used in event delegation
    return leaf;
}

function _makeSplit(dir, ratio, a, b, parent) {
    const bar   = _buildBarEl(dir);
    _rootEl.appendChild(bar);
    const split = { type: "split", dir, ratio, a, b, bar, parent, rect: null };
    bar._wmSplit = split;
    _setupBarDrag(bar, split);
    return split;
}

// ============================================================
// DOM BUILDERS
// ============================================================

let _serial = 0;

function _buildPanelEl() {
    const id      = ++_serial;
    const leftId  = `wm-left-${id}`;
    const rightId = `wm-right-${id}`;

    const panel = document.createElement("div");
    panel.className = "panel wm-panel";
    panel.id = `wm-panel-${id}`;
    panel.innerHTML = `
<div class="panel-header">
  <div class="wm-left">
    <button class="btn btn-sm btn-link wm-btn wm-stub wm-left-stub" type="button"
            aria-expanded="false" title="${te('panel.show_left')}" aria-label="${te('panel.show_left')}">
      <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
    </button>
    <div class="dropdown" data-menu="left">
      <button class="btn btn-sm btn-link dropdown-toggle no-caret"
              type="button" id="${leftId}"
              data-bs-toggle="dropdown" aria-expanded="false">
        <i class="bi bi-list" aria-hidden="true"></i><span class="wm-title">${te('panel.title_default')}</span>
      </button>
      <ul class="dropdown-menu" aria-labelledby="${leftId}"></ul>
    </div>
  </div>

  <div class="panel-toolbar"></div>
  <button class="btn btn-sm btn-link wm-btn panel-toolbar-stub"
          type="button" title="${te('panel.tools')}" tabindex="-1" aria-hidden="true"
          style="pointer-events:none;cursor:default;">
    <i class="bi bi-tools"></i>
  </button>

  <div class="wm-controls">
    <button class="btn btn-sm btn-link wm-btn wm-stub wm-ctrls-stub" type="button"
            aria-expanded="false" title="${te('panel.show_controls')}" aria-label="${te('panel.show_controls')}">
      <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
    </button>
    <div class="wm-ctrls-group">
    <div class="dropdown" data-menu="right">
      <button class="btn btn-sm btn-link wm-btn dropdown-toggle no-caret"
              type="button" id="${rightId}"
              data-bs-toggle="dropdown" aria-expanded="false" title="${te('panel.menu')}" aria-label="${te('panel.menu')}">
        <i class="bi bi-list" aria-hidden="true"></i>
      </button>
      <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="${rightId}"></ul>
    </div>
    <button class="btn btn-sm btn-link wm-btn panel-models"
            type="button" title="${te('panel.objects.@')}" aria-label="${te('panel.objects.@')}">
      <i class="bi bi-box2" aria-hidden="true"></i>
    </button>
    <button class="btn btn-sm btn-link wm-btn panel-flow-embedded"
            type="button" title="${te('panel.flow_embedded')}" aria-label="${te('panel.flow_embedded')}">
      <i class="bi bi-diagram-2" aria-hidden="true"></i>
    </button>
    <span class="wm-hdr-sep"></span>
    <button class="btn btn-sm btn-link wm-btn" data-wm="split-v"
            type="button" title="${te('panel.split_v')}" aria-label="${te('panel.split_v')}">
      <i class="bi bi-layout-split" aria-hidden="true"></i>
    </button>
    <button class="btn btn-sm btn-link wm-btn" data-wm="split-h"
            type="button" title="${te('panel.split_h')}" aria-label="${te('panel.split_h')}">
      <i class="bi bi-layout-split rotate-90" aria-hidden="true"></i>
    </button>
    <button class="btn btn-sm btn-link wm-btn" data-wm="maximize"
            type="button" title="${te('panel.maximize')}" aria-label="${te('panel.maximize')}">
      <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>
    </button>
    <button class="btn btn-sm btn-link wm-btn" data-wm="close"
            type="button" title="${te('panel.close')}" aria-label="${te('panel.close')}">
      <i class="bi bi-x-lg" aria-hidden="true"></i>
    </button>
    </div>
  </div>
</div>

<div class="panel-body"></div>

<div class="panel-footer">
  <div class="panel-footer-left">
    <div class="pf-status"></div>
  </div>
  <div class="panel-footer-center">
    <div class="pf-hints"></div>
  </div>
  <div class="panel-footer-right">
    <div class="pf-controls"></div>
  </div>
</div>

<div class="wm-hot-top"></div>
<div class="wm-hot-bottom"></div>`;

    _rootEl.appendChild(panel);
    _setupAutoHide(panel);
    _setupHeaderCompact(panel);
    // Il nome dell'oggetto aperto (template_XXX.mjs) è l'etichetta della scheda
    new MutationObserver(() => { if (_tabMode) _renderTabs(); })
        .observe(panel, { attributes: true, attributeFilter: ["data-current-object-name"] });
    return panel;
}

function _buildBarEl(dir) {
    const bar     = document.createElement("div");
    bar.className = `wm-bar ${dir === "h" ? "wm-bar-h" : "wm-bar-v"}`;
    return bar;
}

// ============================================================
// LAYOUT ENGINE
// ============================================================

/**
 * Recursively place all panels and bars according to BSP ratios.
 * @param {object}  node    — BSP node (leaf or split)
 * @param {{x,y,w,h}} rect — available rectangle in px
 * @param {boolean} animate — add wm-anim class for CSS transitions
 */
function _layout(node, rect, animate) {
    node.rect = { ...rect };

    if (node.type === "leaf") {
        _placeEl(node.el, rect, animate);
        return;
    }

    const { x, y, w, h } = rect;

    if (node.dir === "v") {
        const sx = _snap(x + node.ratio * w, x, x + w);
        _layout(node.a, { x,  y, w: sx - x,      h }, animate);
        _layout(node.b, { x: sx, y, w: x + w - sx, h }, animate);
        _placeEl(node.bar, { x: sx - BAR_SIZE / 2, y, w: BAR_SIZE, h }, animate);
    } else {
        const sy = _snap(y + node.ratio * h, y, y + h);
        _layout(node.a, { x, y,  w, h: sy - y      }, animate);
        _layout(node.b, { x, y: sy, w, h: y + h - sy }, animate);
        _placeEl(node.bar, { x, y: sy - BAR_SIZE / 2, w, h: BAR_SIZE }, animate);
    }
}

function _placeEl(el, { x, y, w, h }, animate) {
    if (animate) el.classList.add("wm-anim");
    else         el.classList.remove("wm-anim");
    const s   = el.style;
    s.left   = `${Math.round(x)}px`;
    s.top    = `${Math.round(y)}px`;
    s.width  = `${Math.round(w)}px`;
    s.height = `${Math.round(h)}px`;
}

/** Snap a split position to the grid, clamped to keep both cells ≥ MIN_PX. */
function _snap(v, lo, hi) {
    const snapped = Math.round(v / GRID) * GRID;
    return Math.max(lo + MIN_PX, Math.min(hi - MIN_PX, snapped));
}

function _relayout(animate) {
    if (_bspRoot) _layout(_bspRoot, { x: 0, y: 0, w: _deskW, h: _deskH }, animate);
    _afterLayout();
}

// ============================================================
// TABS  (finestra sotto i 992px)
// ============================================================

/**
 * Da chiamare dopo ogni _layout(): in modalità a schede rimette ogni pannello a tutto spazio
 * sotto la barra e mostra solo quello attivo; fuori dalla modalità toglie la barra e lascia
 * le posizioni calcolate dal BSP. node.rect non cambia, quindi le regole delle divisioni restano.
 */
function _afterLayout() {
    if (!_rootEl || !_bspRoot) return;
    _rootEl.classList.toggle("wm-tabs", _tabMode);

    if (!_tabMode) {
        if (_tabBarEl) _tabBarEl.hidden = true;
        _walkLeaves(_bspRoot, l => {
            l.el.removeAttribute("role");
            l.el.removeAttribute("aria-labelledby");
            if (!_maxLeaf) l.el.style.visibility = "";
        });
        _walkSplits(_bspRoot, sp => { sp.bar.style.display = ""; });
        return;
    }

    // Niente pannello massimizzato con le schede: ognuno è già a tutto spazio
    if (_maxLeaf) _toggleMaximize(_maxLeaf);

    _ensureTabBar();
    _tabBarEl.hidden = false;
    const barH = _tabBarEl.offsetHeight || 36;

    const leaves = [];
    _walkLeaves(_bspRoot, l => leaves.push(l));
    if (!leaves.includes(_activeLeaf)) _activeLeaf = leaves[0] ?? null;

    for (const l of leaves) {
        _placeEl(l.el, { x: 0, y: barH, w: _deskW, h: Math.max(0, _deskH - barH) }, false);
        l.el.style.visibility = l === _activeLeaf ? "" : "hidden";
        l.el.setAttribute("role", "tabpanel");
        l.el.setAttribute("aria-labelledby", `${l.el.id}-tab`);
    }
    _walkSplits(_bspRoot, sp => { sp.bar.style.display = "none"; });
    _renderTabs();
}

function _ensureTabBar() {
    if (_tabBarEl && _tabBarEl.isConnected) return;
    _tabBarEl = document.createElement("div");
    _tabBarEl.className = "wm-tabbar";
    _tabBarEl.setAttribute("role", "tablist");
    _tabBarEl.setAttribute("aria-label", te("panel.tabs_label"));
    _tabBarEl.addEventListener("click", e => {
        const tab = e.target.closest("[role='tab']");
        if (tab) _activateTab(tab._wmLeaf, false);
    });
    // Tastiera (pattern WAI-ARIA delle schede): frecce, Home, Fine
    _tabBarEl.addEventListener("keydown", e => {
        const tabs = [..._tabBarEl.querySelectorAll("[role='tab']")];
        const i = tabs.indexOf(document.activeElement);
        if (i < 0) return;
        let j = null;
        if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = tabs.length - 1;
        if (j === null) return;
        e.preventDefault();
        _activateTab(tabs[j]._wmLeaf, true);
    });
    _rootEl.prepend(_tabBarEl);
}

function _activateTab(leaf, focusTab) {
    if (!leaf) return;
    _activeLeaf = leaf;
    _afterLayout();
    if (focusTab) _tabBarEl.querySelector(`#${CSS.escape(leaf.el.id)}-tab`)?.focus();
}

function _renderTabs() {
    if (!_tabBarEl) return;
    const leaves = [];
    _walkLeaves(_bspRoot, l => leaves.push(l));
    _tabBarEl.replaceChildren(...leaves.map((l, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wm-tab";
        b.id = `${l.el.id}-tab`;
        b.setAttribute("role", "tab");
        b.setAttribute("aria-controls", l.el.id);
        const active = l === _activeLeaf;
        b.setAttribute("aria-selected", active ? "true" : "false");
        b.tabIndex = active ? 0 : -1;
        b.textContent = l.el.dataset.currentObjectName || te("panel.tab_n", { n: i + 1 });
        b._wmLeaf = l;
        return b;
    }));
}

// ============================================================
// SPLIT
// ============================================================

function _splitLeaf(leaf, dir) {
    if (_maxLeaf) return;  // no split while a panel is maximised

    const isPhone = Math.min(_deskW, _deskH) < PHONE_BREAKPOINT;

    if (isPhone) {
        // Phone: only the root (lone) panel can be split — one split total
        if (leaf.parent !== null) return;
        // Force direction based on current orientation
        dir = _deskW >= _deskH ? "v" : "h";
    }

    const rect = { ...(leaf.rect ?? { x: 0, y: 0, w: _deskW, h: _deskH }) };

    // Reject if either resulting half would be smaller than MIN_PX
    if (dir === "v" && rect.w < 2 * MIN_PX) return;
    if (dir === "h" && rect.h < 2 * MIN_PX) return;

    const newLeaf = _makeLeaf(null);
    const split   = _makeSplit(dir, 0.5, leaf, newLeaf, leaf.parent);

    // Replace leaf in grandparent
    const gp = leaf.parent;
    if (!gp) {
        _bspRoot = split;
    } else {
        if (gp.a === leaf) gp.a = split;
        else               gp.b = split;
    }

    leaf.parent    = split;
    newLeaf.parent = split;

    _layout(split, rect, true);
    if (_tabMode) _activeLeaf = newLeaf;   // con le schede il nuovo pannello è quello mostrato
    _afterLayout();
    _updateSplitButtons();
}

// ============================================================
// CLOSE
// ============================================================

function _closeLeaf(leaf) {
    if (!leaf.parent) return;  // last panel — never close it

    const split     = leaf.parent;
    const sibling   = split.a === leaf ? split.b : split.a;
    const rect      = { ...split.rect };
    const gp        = split.parent;

    // Remove closed panel and the divider bar from DOM
    leaf.el.remove();
    split.bar.remove();

    // Reconnect sibling to grandparent
    sibling.parent = gp;
    if (!gp) {
        _bspRoot = sibling;
    } else {
        if (gp.a === split) gp.a = sibling;
        else                gp.b = sibling;
    }

    _layout(sibling, rect, true);
    if (_activeLeaf === leaf) _activeLeaf = null;   // _afterLayout sceglie il primo pannello
    _afterLayout();
    _updateSplitButtons();
}

// ============================================================
// SPLIT BUTTON STATE
// ============================================================

/**
 * Enable / disable split buttons on every leaf based on:
 * - Phone mode (min desk dimension < PHONE_BREAKPOINT):
 *     only the sole root leaf can split (one split total);
 *     direction is forced by orientation so both buttons behave the same.
 * - Tablet / desktop:
 *     a split is allowed only when the resulting halves would both be ≥ MIN_PX.
 */
function _updateSplitButtons() {
    const isPhone = Math.min(_deskW, _deskH) < PHONE_BREAKPOINT;

    _walkLeaves(_bspRoot, leaf => {
        const rect = leaf.rect ?? { w: 0, h: 0 };
        const btnV = leaf.el.querySelector("[data-wm='split-v']");
        const btnH = leaf.el.querySelector("[data-wm='split-h']");

        let canV, canH;
        if (isPhone) {
            // On phones allow one split only (root leaf) in the forced direction
            const isRoot   = leaf.parent === null;
            const forcedH  = _deskW < _deskH;  // portrait → horizontal split
            canV = isRoot && !forcedH;
            canH = isRoot &&  forcedH;
        } else {
            canV = rect.w >= 2 * MIN_PX;
            canH = rect.h >= 2 * MIN_PX;
        }

        if (btnV) btnV.disabled = !canV;
        if (btnH) btnH.disabled = !canH;
    });
}

// ============================================================
// MAXIMIZE
// ============================================================

function _toggleMaximize(leaf) {
    const btn = leaf.el.querySelector("[data-wm='maximize'] i");

    if (_maxLeaf === leaf) {
        // Restore
        leaf.el.classList.remove("wm-max");
        if (btn) btn.className = "bi bi-arrows-fullscreen";
        _maxLeaf = null;
        _showAllNodes();
        _relayout(false);
    } else {
        // Maximise (restore previous if any)
        if (_maxLeaf) {
            _maxLeaf.el.classList.remove("wm-max");
            const prev = _maxLeaf.el.querySelector("[data-wm='maximize'] i");
            if (prev) prev.className = "bi bi-arrows-fullscreen";
        }
        _maxLeaf = leaf;
        _hideOtherNodes(leaf);
        leaf.el.classList.add("wm-max");
        if (btn) btn.className = "bi bi-fullscreen-exit";
    }
}

function _hideOtherNodes(except) {
    _walkLeaves(_bspRoot, l => { if (l !== except) l.el.style.visibility = "hidden"; });
    _walkSplits(_bspRoot, s => { s.bar.style.visibility = "hidden"; });
}

function _showAllNodes() {
    _walkLeaves(_bspRoot, l => { l.el.style.visibility = ""; });
    _walkSplits(_bspRoot, s => { s.bar.style.visibility = ""; });
}

function _walkLeaves(node, fn) {
    if (!node) return;
    if (node.type === "leaf") { fn(node); return; }
    _walkLeaves(node.a, fn);
    _walkLeaves(node.b, fn);
}

function _walkSplits(node, fn) {
    if (!node || node.type === "leaf") return;
    fn(node);
    _walkSplits(node.a, fn);
    _walkSplits(node.b, fn);
}

// ============================================================
// BAR DRAG  (resize both adjacent cells simultaneously)
// ============================================================

function _setupBarDrag(bar, split) {
    bar.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        bar.classList.add("active");

        const pointerId   = e.pointerId;
        const startX      = e.clientX;
        const startY      = e.clientY;
        const { x: rx, y: ry, w: rw, h: rh } = split.rect;
        const startSplitX = rx + split.ratio * rw;
        const startSplitY = ry + split.ratio * rh;

        const onMove = ev => {
            if (split.dir === "v") {
                const raw  = startSplitX + (ev.clientX - startX);
                split.ratio = (_snap(raw, rx, rx + rw) - rx) / rw;
            } else {
                const raw  = startSplitY + (ev.clientY - startY);
                split.ratio = (_snap(raw, ry, ry + rh) - ry) / rh;
            }
            _layout(split, split.rect, false);
        };

        const onUp = () => {
            bar.releasePointerCapture(pointerId);
            bar.classList.remove("active");
            bar.removeEventListener("pointermove", onMove);
            bar.removeEventListener("pointerup",   onUp);
        };

        bar.addEventListener("pointermove", onMove);
        bar.addEventListener("pointerup",   onUp);
    });
}

// ============================================================
// COMPACT HEADER  (risponde alla larghezza del panel)
// ============================================================
//
// Quando l'header non sta nel pannello si compatta in tre fasi, la toolbar centrale per ultima:
//   1. hdr-cl     — il blocco di sinistra (☰ + nome dell'oggetto) diventa ⋮
//   2. hdr-cr     — anche i controlli di destra (☰, Oggetti, Flow, dividi, espandi, chiudi) diventano ⋮
//   3. hdr-scroll — la toolbar non sta ancora: scorre seguendo il mouse (rotella e dito su touch)
// Entrando in un ⋮ (o toccandolo) quel blocco si apre (hdr-peek-left / hdr-peek-right) e il resto
// si compatta: l'altro blocco diventa ⋮, la toolbar diventa l'icona attrezzi.

const PEEK_CLEAR_DELAY = 80;   // ms prima di richiudere il blocco aperto quando il mouse esce
const SCROLL_EDGE      = 24;   // px ai bordi della toolbar che valgono già inizio / fine
const COMPACT_STAGES   = ['hdr-cl', 'hdr-cr', 'hdr-scroll'];
const PEEK_NEEDS       = { 'hdr-peek-left': 'hdr-cl', 'hdr-peek-right': 'hdr-cr' };

/**
 * Misura la larghezza naturale dell'header e applica le fasi di compattazione che servono.
 * Viene chiamata al resize del panel, quando cambia la toolbar e quando cambia il titolo.
 * Il blocco aperto (peek) resta aperto se il suo lato è ancora compattato.
 */
function _checkHeaderCompact(panelEl) {
    const header = panelEl.querySelector('.panel-header');
    if (!header) return;

    const availW = panelEl.clientWidth;
    if (availW === 0) return; // panel non ancora posizionato

    const peek = Object.keys(PEEK_NEEDS).filter(c => header.classList.contains(c));
    header.classList.remove(...COMPACT_STAGES, ...Object.keys(PEEK_NEEDS));

    // Con width:max-content l'header si espande al suo contenuto ignorando il vincolo
    // right:0 dell'absolute positioning; il reflow è sincrono, nessun repaint intermedio.
    const fits = () => {
        header.style.width = 'max-content';
        const naturalW = header.scrollWidth;
        header.style.width = '';
        return naturalW <= availW - 4;
    };
    for (const stage of COMPACT_STAGES) {
        if (fits()) break;
        header.classList.add(stage);
    }

    for (const p of peek) if (header.classList.contains(PEEK_NEEDS[p])) header.classList.add(p);
    _syncHeaderStubs(header);
}

function _syncHeaderStubs(header) {
    header.querySelector('.wm-left-stub')
        ?.setAttribute('aria-expanded', String(header.classList.contains('hdr-peek-left')));
    header.querySelector('.wm-ctrls-stub')
        ?.setAttribute('aria-expanded', String(header.classList.contains('hdr-peek-right')));
}

/**
 * Imposta ResizeObserver + MutationObserver, apertura dei blocchi compattati e scorrimento toolbar.
 */
function _setupHeaderCompact(panelEl) {
    const header  = panelEl.querySelector('.panel-header');
    const toolbar = panelEl.querySelector('.panel-toolbar');
    const leftEl  = panelEl.querySelector('.wm-left');
    const ctrlsEl = panelEl.querySelector('.wm-controls');
    const stubEl  = panelEl.querySelector('.panel-toolbar-stub');
    const titleEl = panelEl.querySelector('.wm-title');
    if (!header || !toolbar || !leftEl || !ctrlsEl) return;

    const check = () => _checkHeaderCompact(panelEl);

    // Reagisce al ridimensionamento del panel, al popolamento della toolbar e al nome dell'oggetto
    new ResizeObserver(check).observe(panelEl);
    new MutationObserver(check).observe(toolbar, { childList: true });
    if (titleEl) new MutationObserver(check).observe(titleEl, { childList: true, characterData: true, subtree: true });

    // ── Blocco aperto (peek): il ⋮ di sinistra o di destra apre quel blocco, il resto si compatta ──
    const sides = [
        { el: leftEl,  cls: 'hdr-peek-left',  stub: leftEl.querySelector('.wm-left-stub'),
          first: () => leftEl.querySelector('[data-menu="left"] > button') },
        { el: ctrlsEl, cls: 'hdr-peek-right', stub: ctrlsEl.querySelector('.wm-ctrls-stub'),
          first: () => ctrlsEl.querySelector('.wm-ctrls-group button') },
    ];
    let peekTimer = null;

    function setPeek(side) {
        clearTimeout(peekTimer);
        header.classList.remove(...Object.keys(PEEK_NEEDS));
        if (side && header.classList.contains(PEEK_NEEDS[side.cls])) header.classList.add(side.cls);
        _syncHeaderStubs(header);
    }

    function scheduleClear() {
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => {
            // Un menu a tendina aperto nel blocco lo tiene aperto: si richiude con il menu
            if (header.querySelector('.wm-left .dropdown-menu.show, .wm-controls .dropdown-menu.show')) return;
            if (header.querySelector('.wm-left:hover, .wm-controls:hover, .panel-toolbar-stub:hover')) return;
            setPeek(null);
        }, PEEK_CLEAR_DELAY);
    }

    for (const side of sides) {
        side.el.addEventListener('mouseenter', () => setPeek(side));
        side.el.addEventListener('mouseleave', scheduleClear);
        side.el.addEventListener('focusin', () => setPeek(side));
        side.el.addEventListener('focusout', (e) => { if (!side.el.contains(e.relatedTarget)) scheduleClear(); });
        side.el.addEventListener('hidden.bs.dropdown', scheduleClear);
        side.stub?.addEventListener('click', (e) => {
            setPeek(side);
            // Da tastiera il ⋮ sparisce: il fuoco passa al primo comando del blocco aperto
            if (e.detail === 0) side.first()?.focus();
        });
    }

    // Lo stub della toolbar è zona neutra: mantiene il peek attivo mentre il mouse ci transita
    stubEl?.addEventListener('mouseenter', () => clearTimeout(peekTimer));
    stubEl?.addEventListener('mouseleave', scheduleClear);

    // Su touch non c'è uscita del mouse: un tocco fuori dal blocco aperto lo richiude
    panelEl.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        if (!header.classList.contains('hdr-peek-left') && !header.classList.contains('hdr-peek-right')) return;
        if (e.target.closest('.wm-left, .wm-controls')) return;
        setPeek(null);
    });

    // ── Scorrimento toolbar (hdr-scroll): la posizione del mouse sceglie la parte visibile ──
    let scrollTarget = 0;
    let scrollRaf    = 0;

    function scrollStep() {
        const before = toolbar.scrollLeft;
        const d = scrollTarget - before;
        toolbar.scrollLeft = Math.abs(d) < 4 ? scrollTarget : before + d * 0.25;
        scrollRaf = (Math.abs(d) < 4 || toolbar.scrollLeft === before) ? 0 : requestAnimationFrame(scrollStep);
    }

    function stopScroll() {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = 0;
    }

    toolbar.addEventListener('mousemove', (e) => {
        if (!header.classList.contains('hdr-scroll')) return;
        const max = toolbar.scrollWidth - toolbar.clientWidth;
        if (max <= 0) return;
        const r = toolbar.getBoundingClientRect();
        const x = (e.clientX - r.left - SCROLL_EDGE) / Math.max(1, r.width - 2 * SCROLL_EDGE);
        scrollTarget = Math.min(1, Math.max(0, x)) * max;
        if (!scrollRaf) scrollRaf = requestAnimationFrame(scrollStep);
    });
    toolbar.addEventListener('mouseleave', stopScroll);

    // Rotella (anche verticale) → scorrimento orizzontale; il dito su touch scorre da sé
    toolbar.addEventListener('wheel', (e) => {
        if (!header.classList.contains('hdr-scroll')) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!d) return;
        e.preventDefault();
        stopScroll();
        toolbar.scrollLeft += d;
    }, { passive: false });
}

// ============================================================
// AUTO-HIDE HEADER / FOOTER
// ============================================================

function _setupAutoHide(panelEl) {
    const footerEl  = panelEl.querySelector(".panel-footer");
    const hotTop    = panelEl.querySelector(".wm-hot-top");
    const hotBottom = panelEl.querySelector(".wm-hot-bottom");
    let timer = null;

    function show() {
        panelEl.classList.add("wm-hf-visible");
        clearTimeout(timer);
        // Timer always starts, but removes the class only if an object
        // has been loaded (template_XXX.mjs sets dataset.currentObjectName
        // after render() completes).  No object → header stays visible.
        timer = setTimeout(() => {
            if (panelEl.dataset.currentObjectName) {
                panelEl.classList.remove("wm-hf-visible");
            }
        }, HIDE_DELAY);
    }

    // Top hot zone (10 px) → show header
    hotTop.addEventListener("mouseenter", show);

    // Bottom hot zone (10 px) → show footer (if it has content) + header
    hotBottom.addEventListener("mouseenter", show);

    // When the viewer calls cmdUI.show(), footer gets .is-visible → show header too
    const mo = new MutationObserver(() => {
        if (footerEl.classList.contains("is-visible")) show();
    });
    mo.observe(footerEl, { attributes: true, attributeFilter: ["class"] });

    // cmdUI.notify() (messaggi dai flow): il footer può essere già aperto ma trasparente
    // perché l'intestazione è scomparsa — la classe non cambia, quindi serve un evento
    footerEl.addEventListener("cmdui:notify", show);

    // Header visible immediately on panel creation (no object → no auto-hide)
    show();
}

// ============================================================
// EVENT DELEGATION
// ============================================================

function _handleWMClick(e) {
    const btn = e.target.closest("[data-wm]");
    if (!btn) return;

    const panelEl = btn.closest(".wm-panel");
    if (!panelEl) return;

    const leaf = panelEl._wmLeaf;
    if (!leaf) return;

    switch (btn.dataset.wm) {
        case "split-v":  _splitLeaf(leaf, "v");   break;
        case "split-h":  _splitLeaf(leaf, "h");   break;
        case "maximize": _toggleMaximize(leaf);    break;
        case "close":    _closeLeaf(leaf);         break;
    }
}

// ============================================================
// SERIALIZATION  (future MySQL persistence)
// ============================================================

function _serializeNode(node) {
    if (node.type === "leaf") {
        return { type: "leaf", savedState: { ...node.savedState } };
    }
    return {
        type:  "split",
        dir:   node.dir,
        ratio: node.ratio,
        a:     _serializeNode(node.a),
        b:     _serializeNode(node.b),
    };
}

/** Returns the full BSP layout as a plain-object tree for JSON storage. */
export function serialize() {
    return _bspRoot ? _serializeNode(_bspRoot) : null;
}

/**
 * Restore a dashboard from a serialized BSP tree (previously obtained via serialize()).
 * Clears the current layout and rebuilds panels, bars and split bars from the stored tree.
 * Returns an array of { leafEl, objectId, selectedModelIds, embeddedFlow } — one entry
 * per leaf. selectedModelIds is null when absent from the saved data (older configs, or
 * objects loaded with every model) — the caller should treat null as "load everything".
 * embeddedFlow is { kind, objId, dshpId, app, name, flowId } when the leaf held a "flow embedded"
 * (kind 'object') or a dashboard flow (kind 'dashboard', dshpId = its Dashboard Config)
 * editing panel, else null — see _doc/arch-dashboard-windows.md §10 for the known
 * limitation (no live bodyEl link, "Testa su panel" must be redone manually).
 * The caller is responsible for loading the objects into the panel elements.
 */
export function deserialize(tree) {
    if (!_rootEl || !tree) return [];

    // Clear existing panels and bars
    _rootEl.innerHTML = "";
    _serial   = 0;
    _bspRoot  = null;
    _maxLeaf  = null;

    // Refresh desk dimensions
    const r = _rootEl.getBoundingClientRect();
    _deskW   = Math.round(r.width)  || _rootEl.offsetWidth;
    _deskH   = Math.round(r.height) || _rootEl.offsetHeight;

    const leaves = [];
    _bspRoot = _deserializeNode(tree, null, leaves);
    _tabBarEl = null;      // svuotato con _rootEl.innerHTML: si ricrea
    _activeLeaf = null;

    _layout(_bspRoot, { x: 0, y: 0, w: _deskW, h: _deskH }, false);
    _afterLayout();
    _updateSplitButtons();

    return leaves; // [{ leafEl, objectId, selectedModelIds, embeddedFlow }]
}

function _deserializeNode(node, parent, leaves) {
    if (!node || node.type === "leaf") {
        const leaf  = _makeLeaf(parent);
        const objId = node?.savedState?.objectId ?? null;
        const selectedModelIds = Array.isArray(node?.savedState?.selectedModelIds)
            ? node.savedState.selectedModelIds
            : null;
        const ef = node?.savedState?.embeddedFlow;
        const embeddedFlow = (ef && ef.flowId != null)
            ? { kind: ef.kind === 'dashboard' ? 'dashboard' : 'object', objId: ef.objId ?? null,
                dshpId: ef.dshpId ?? null, app: ef.app ?? null, name: ef.name ?? null, flowId: ef.flowId }
            : null;
        if (objId != null) leaf.savedState.objectId = objId;
        leaf.savedState.selectedModelIds = selectedModelIds;
        leaf.savedState.embeddedFlow     = embeddedFlow;
        leaves.push({ leafEl: leaf.el, objectId: objId, selectedModelIds, embeddedFlow });
        return leaf;
    }
    // Split: create children first, then the split node that references them
    const a     = _deserializeNode(node.a, null, leaves);
    const b     = _deserializeNode(node.b, null, leaves);
    const split = _makeSplit(node.dir, node.ratio ?? 0.5, a, b, parent);
    a.parent    = split;
    b.parent    = split;
    return split;
}
