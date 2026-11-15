// app/PJS_sub_modules/PJS-interactive.mjs
// Hover "lift" shadow + click → App Bus 'interactive:click'
// per item Paper.js con data.interactiveId valorizzato.
//
// Attivo SOLO in navigate mode (tools.activeName === 'navigate').
// Si aggancia agli eventi nativi del container OSD (overlay ha pointerEvents:none in navigate).
//
// Hover: shadow Paper.js → view.update()    cursore → pointer
// Click: appBusEmit('interactive:click', payload completo) — non blocca OSD

import { getState } from "./PJS-core.mjs";
import { appBusEmit } from "../app-bus.mjs";

const SHADOW_BLUR   = 20;
const SHADOW_ALPHA  = 0.40;
const SHADOW_DX     = 0;
const SHADOW_DY     = -6;   // verso l'alto = effetto "sollevato"

export function attachInteractive(bodyEl, { signal } = {}) {
  const state = getState(bodyEl);
  if (!state?.viewer) return;

  const viewer    = state.viewer;
  const container = viewer.element;
  if (!container) return;

  let _hovered  = null;
  let _origShad = null;  // { color, blur, dx, dy }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _isNavigate() {
    const tools = getState(bodyEl)?.tools;
    return !tools || tools.activeName === 'navigate';
  }

  function _clientToImage(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const px   = clientX - rect.left;
    const py   = clientY - rect.top;
    const vp   = viewer.viewport.viewerElementToViewportCoordinates(new OpenSeadragon.Point(px, py));
    return viewer.viewport.viewportToImageCoordinates(vp);  // { x, y }
  }

  function _hitInteractive(imgPt) {
    const sc = getState(bodyEl)?.scope;
    if (!sc?.project) return null;

    const pt     = new sc.Point(imgPt.x, imgPt.y);
    const result = sc.project.hitTest(pt, {
      tolerance: 5,
      fill: true, stroke: true, bounds: true,
    });
    if (!result) return null;

    // Risale al top-level item con interactiveId
    let item = result.item;
    while (item) {
      if (item.data?.interactiveId) return item;
      if (!item.parent || item.parent.className === 'Layer') return null;
      item = item.parent;
    }
    return null;
  }

  function _applyShadow(item) {
    const sc = getState(bodyEl)?.scope;
    if (!sc) return;
    sc.activate();
    _origShad = {
      color: item.shadowColor ? item.shadowColor.clone() : null,
      blur:  item.shadowBlur  ?? 0,
      dx:    item.shadowOffset?.x ?? 0,
      dy:    item.shadowOffset?.y ?? 0,
    };
    item.shadowColor  = new sc.Color(0, 0, 0, SHADOW_ALPHA);
    item.shadowBlur   = SHADOW_BLUR;
    item.shadowOffset = new sc.Point(SHADOW_DX, SHADOW_DY);
    sc.view.update();
  }

  function _clearShadow(item) {
    const sc = getState(bodyEl)?.scope;
    if (!sc || !_origShad) return;
    sc.activate();
    item.shadowColor  = _origShad.color;
    item.shadowBlur   = _origShad.blur;
    item.shadowOffset = new sc.Point(_origShad.dx, _origShad.dy);
    _origShad = null;
    sc.view.update();
  }

  function _buildPayload(item) {
    const d   = item.data || {};
    const pos = item.position;
    const st  = getState(bodyEl);

    // testo: estrae content dal figlio PointText
    const textChild = item.children
      ? item.children.find?.(c => c.data?.__textPart || c.content !== undefined)
      : null;

    return {
      interactiveId: d.interactiveId || '',
      kind:          d.kind || '',
      // text
      content:       textChild?.content ?? '',
      styleId:       d.styleId       || '',
      justification: textChild?.justification || '',
      // image
      url:           d.url           || '',
      relPath:       d.relPath       || '',
      filename:      d.filename      || '',
      // marker
      markerId:      d.markerId      || '',
      markerLabel:   d.markerLabel   || '',
      svgScale:      d.svgScale      ?? 0,
      svgRotation:   d.svgRotation   ?? 0,
      // comuni
      layerId:       d.layerId       || '',
      position:      { x: pos?.x ?? 0, y: pos?.y ?? 0 },
      sourceApp:     'OSD',
      sourcePanelId: st?.winId || st?.mod_id || '',
    };
  }

  // ── Event handlers ────────────────────────────────────────────────────────────

  const onMove = (e) => {
    if (!_isNavigate()) {
      if (_hovered) { _clearShadow(_hovered); _hovered = null; container.style.cursor = ''; }
      return;
    }

    const imgPt = _clientToImage(e.clientX, e.clientY);
    const hit   = _hitInteractive(imgPt);

    if (hit === _hovered) return;  // nessun cambiamento

    if (_hovered) { _clearShadow(_hovered); _hovered = null; }

    if (hit) {
      _hovered = hit;
      _applyShadow(hit);
      container.style.cursor = 'pointer';
    } else {
      container.style.cursor = '';
    }
  };

  const onClick = (e) => {
    if (e.button !== 0) return;
    if (!_isNavigate()) return;

    const imgPt = _clientToImage(e.clientX, e.clientY);
    const hit   = _hitInteractive(imgPt);
    if (!hit) return;

    e.preventDefault();

    const payload = _buildPayload(hit);
    appBusEmit('interactive:click', payload, {
      broadcast:     false,
      sourceApp:     'OSD',
      sourcePanelId: payload.sourcePanelId,
    });
  };

  container.addEventListener('pointermove', onMove, { passive: true });
  container.addEventListener('click',       onClick);

  signal?.addEventListener('abort', () => {
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('click',       onClick);
    if (_hovered) { try { _clearShadow(_hovered); } catch {} _hovered = null; }
    container.style.cursor = '';
  });
}
