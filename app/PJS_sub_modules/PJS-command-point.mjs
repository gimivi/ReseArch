// APP/PJS_sub_modules/PJS-command-point.mjs

import {
  ensureSnapSystem,
  snapPick,
  snapUpdateMarker,
  snapClearMarker
} from "./PJS-snap.mjs";
import {
  ensureGridState,
  quantizePointToGrid
} from "./PJS-grid.mjs";
/**
 * Command point resolver
 *
 * Pipeline:
 * raw point
 *   -> snap (optional)
 *   -> ortho (optional)
 *   -> grid (future)
 *
 * Restituisce sempre un oggetto descrittivo, non solo un Point,
 * così i tool possono leggere anche metadati utili.
 */

export function ensureCommandPointSystem(bodyEl) {
  ensureSnapSystem(bodyEl);

  const state = bodyEl?.[Symbol.for("PJS_STATE")] || bodyEl?._pjsState || null;
  if (state) {
    try { ensureGridState(state); } catch {}
  }
}

export function resolveCommandPoint(ctx, {
  rawPoint,
  basePoint = null,
  event = null,
  allowSnap = true,
  allowOrtho = false,
  allowGrid = false
} = {}) {
  if (!ctx?.bodyEl) throw new Error("resolveCommandPoint: missing ctx.bodyEl");
  if (!rawPoint) throw new Error("resolveCommandPoint: missing rawPoint");
  
  try { ensureGridState(ctx.state); } catch {}

  let point = rawPoint.clone();
  let snap = null;
  let orthoApplied = false;
  let gridApplied = false;

  // 1) SNAP
  const altBypass = !!ctx.isAltDown?.() || !!event?.modifiers?.alt;

  if (allowSnap && !altBypass) {
    const s = snapPick(ctx.bodyEl, rawPoint);
    if (s?.imgPoint) {
      snap = s;
      point = s.imgPoint.clone();
      snapUpdateMarker(ctx.bodyEl, s, rawPoint);
    } else {
      snapClearMarker(ctx.bodyEl);
    }
  } else {
    snapClearMarker(ctx.bodyEl);
  }

  // 2) ORTHO
  if (allowOrtho && basePoint && !!event?.modifiers?.shift) {
    const orthoPoint = applyOrthoConstraint(ctx, point, basePoint);
    if (orthoPoint) {
      point = orthoPoint;
      orthoApplied = true;
    }
  }

  // 3) GRID (future hook)
// 3) GRID
if (allowGrid) {
  const gridPoint = quantizePointToGrid(ctx, point);
  if (gridPoint) {
    const changed = gridPoint.x !== point.x || gridPoint.y !== point.y;
    point = gridPoint;
    gridApplied = changed;
  }
}

  return {
    rawPoint: rawPoint.clone(),
    point,
    snap,
    orthoApplied,
    gridApplied
  };
}

export function clearCommandPointUi(ctx) {
  try { snapClearMarker(ctx?.bodyEl); } catch {}
}

function applyOrthoConstraint(ctx, point, basePoint) {
  const scope = ctx?.state?.scope;
  if (!scope || !point || !basePoint) return point;

  const dx = point.x - basePoint.x;
  const dy = point.y - basePoint.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return new scope.Point(point.x, basePoint.y);
  }

  return new scope.Point(basePoint.x, point.y);
}

