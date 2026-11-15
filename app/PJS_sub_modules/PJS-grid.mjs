// APP/PJS_sub_modules/PJS-grid.mjs

/**
 * Grid subsystem V1
 * - stato minimo letto da state._env.workspace.grid
 * - nessun disegno della griglia in questa fase
 * - solo quantizzazione del command point
 */

export function ensureGridState(state) {
  if (!state) throw new Error("PJS-grid: missing state");

  const ws = (state._env ||= {}).workspace ||= {};
  ws.grid ||= {};

  if (typeof ws.grid.enabled !== "boolean") ws.grid.enabled = false;
  if (!Number.isFinite(ws.grid.stepX) || ws.grid.stepX <= 0) ws.grid.stepX = 10;
  if (!Number.isFinite(ws.grid.stepY) || ws.grid.stepY <= 0) ws.grid.stepY = 10;

  return ws.grid;
}

export function getGridSettings(state) {
  return ensureGridState(state);
}

export function isGridEnabled(state) {
  return !!ensureGridState(state).enabled;
}

export function setGridEnabled(state, enabled) {
  const g = ensureGridState(state);
  g.enabled = !!enabled;
  return g;
}

export function setGridSteps(state, stepX, stepY = stepX) {
  const g = ensureGridState(state);

  if (Number.isFinite(stepX) && stepX > 0) g.stepX = stepX;
  if (Number.isFinite(stepY) && stepY > 0) g.stepY = stepY;

  return g;
}

export function quantizePointToGrid(ctx, point) {
  const state = ctx?.state;
  const scope = state?.scope;
  if (!state || !scope || !point) return point;

  const g = ensureGridState(state);
  if (!g.enabled) return point;

  const x = Math.round(point.x / g.stepX) * g.stepX;
  const y = Math.round(point.y / g.stepY) * g.stepY;

  return new scope.Point(x, y);
}