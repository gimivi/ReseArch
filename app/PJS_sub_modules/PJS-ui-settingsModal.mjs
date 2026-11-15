// APP/PJS_sub_modules/PJS-ui-settingsModal.mjs
import { getState, setDirty } from "./PJS-core.mjs";
import { t, te } from "../shared/i18n.mjs";

/**
 * Settings Modal
 * - Snap toggles (enabled + types + tolerance)
 * - Units metadata
 * - Grid metadata (no drawing yet)
 * - Selection filters (what is selectable)
 *
 * Design goals:
 * - Non-invasive: only reads/writes env.workspace.*
 * - Cancel restores snapshot (best-effort)
 * - OK commits and sets dirty
 */

const STATE_KEY = "_APP_STATE_";

const SNAP_TYPES = [
  { id: "endpoint", get label() { return t("app.pjs.settings.snap_endpoint"); } },
  { id: "midpoint", get label() { return t("app.pjs.settings.snap_midpoint"); } },
  { id: "center", get label() { return t("app.pjs.settings.snap_center"); } },
  { id: "intersection", get label() { return t("app.pjs.settings.snap_intersection"); } },
];

const UNITS = [
  { id: "px", label: "px" },
  { id: "mm", label: "mm" },
  { id: "cm", label: "cm" },
  { id: "m", label: "m" },
  { id: "in", label: "in" },
  { id: "ft", label: "ft" },
];

const SELECTABLE_KINDS = [
  { id: "point", get label() { return t("app.pjs.tool.point"); } },
  { id: "line", get label() { return t("app.pjs.tool.line"); } },
  { id: "polyline", get label() { return t("app.pjs.tool.polyline"); } },
  { id: "polygon", get label() { return t("app.pjs.tool.polygon"); } },
  { id: "rect", get label() { return t("app.pjs.tool.rect"); } },
  { id: "circle", get label() { return t("app.pjs.tool.circle"); } },
  { id: "ellipse", get label() { return t("app.pjs.tool.ellipse"); } },
  { id: "arc", get label() { return t("app.pjs.settings.kind_arc"); } },
  { id: "text", get label() { return t("app.pjs.tool.text"); } },
  { id: "imageOverlay", get label() { return t("app.pjs.settings.kind_image"); } },
];

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clampInt(x, lo, hi, fallback) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  const v = n | 0;
  return Math.max(lo, Math.min(hi, v));
}

function ensureWorkspaceDefaults(env) {
  env.workspace = env.workspace || {};

  // Snap
  env.workspace.snap = env.workspace.snap || {};
  env.workspace.snap.enabled = env.workspace.snap.enabled ?? true;
  env.workspace.snap.tolerancePx = clampInt(env.workspace.snap.tolerancePx ?? 12, 1, 200, 12);
  env.workspace.snap.types = env.workspace.snap.types || {};
  for (const ty of SNAP_TYPES) {
    env.workspace.snap.types[ty.id] = env.workspace.snap.types[ty.id] ?? true;
  }

  // Units
  env.workspace.units = env.workspace.units || {};
  env.workspace.units.unit = env.workspace.units.unit || "px";

  // Grid
  env.workspace.grid = env.workspace.grid || {};
  env.workspace.grid.enabled = env.workspace.grid.enabled ?? false;
  env.workspace.grid.snapToGrid = env.workspace.grid.snapToGrid ?? false;
  env.workspace.grid.spacingMain = clampInt(env.workspace.grid.spacingMain ?? 100, 1, 100000, 100);
  env.workspace.grid.subDivisions = clampInt(env.workspace.grid.subDivisions ?? 5, 0, 100, 5);
  env.workspace.grid.showSub = env.workspace.grid.showSub ?? true;

  // Selection
  env.workspace.selection = env.workspace.selection || {};
  env.workspace.selection.enabled = env.workspace.selection.enabled ?? true;
  env.workspace.selection.ignoreLockedLayers = env.workspace.selection.ignoreLockedLayers ?? true;
  env.workspace.selection.ignoreHiddenLayers = env.workspace.selection.ignoreHiddenLayers ?? true;
  env.workspace.selection.allow = env.workspace.selection.allow || {};
  // sensible defaults
  for (const k of SELECTABLE_KINDS) {
    if (env.workspace.selection.allow[k.id] == null) {
      env.workspace.selection.allow[k.id] = (k.id !== "imageOverlay");
    }
  }
}

function openBootstrapModal(modalEl) {
  // Bootstrap 5 modal expected globally
  // eslint-disable-next-line no-undef
  const m = new bootstrap.Modal(modalEl, { backdrop: "static", keyboard: false });
  m.show();
  return m;
}

function buildModalShell(modalId, title) {
  const modalEl = document.createElement("div");
  modalEl.className = "modal fade";
  modalEl.id = modalId;
  modalEl.tabIndex = -1;
  modalEl.setAttribute("aria-labelledby", `${modalId}_title`);
  modalEl.innerHTML = `
    <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
      <div class="modal-content bg-body text-body">
        <div class="modal-header">
          <h5 class="modal-title" id="${modalId}_title">${title}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${te("common.close")}"></button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-footer"></div>
      </div>
    </div>
  `;
  return modalEl;
}

let _fieldSeq = 0;

function rowCheckbox(labelText, checked, onChange) {
  const row = document.createElement("div");
  row.className = "form-check";

  const input = document.createElement("input");
  input.className = "form-check-input";
  input.type = "checkbox";
  input.checked = !!checked;
  input.id = `pjsSet_${++_fieldSeq}`;

  const label = document.createElement("label");
  label.className = "form-check-label";
  label.htmlFor = input.id;
  label.textContent = labelText;

  input.addEventListener("change", () => onChange?.(input.checked));
  row.append(input, label);
  return { row, input, label };
}

function rowNumber(labelText, value, { min = 0, max = 999999, step = 1 } = {}, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "d-flex align-items-center gap-2";

  const lab = document.createElement("div");
  lab.style.minWidth = "160px";
  lab.textContent = labelText;

  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control form-control-sm";
  input.style.maxWidth = "140px";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value ?? 0);
  input.setAttribute("aria-label", labelText);

  input.addEventListener("change", () => {
    const v = clampInt(input.value, min, max, value ?? 0);
    input.value = String(v);
    onChange?.(v);
  });

  wrap.append(lab, input);
  return { wrap, input };
}

function rowSelect(labelText, value, options, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "d-flex align-items-center gap-2";

  const lab = document.createElement("div");
  lab.style.minWidth = "160px";
  lab.textContent = labelText;

  const sel = document.createElement("select");
  sel.className = "form-select form-select-sm";
  sel.style.maxWidth = "160px";
  sel.setAttribute("aria-label", labelText);

  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.addEventListener("change", () => onChange?.(sel.value));

  wrap.append(lab, sel);
  return { wrap, sel };
}

export async function openSettingsModal({ panel, headerEl, bodyEl } = {}) {
  const st = bodyEl?.[STATE_KEY] || getState(bodyEl);
  const env = st?.pjs?._env;
  if (!env) return;

  ensureWorkspaceDefaults(env);
  const snapshot = deepClone(env.workspace);

  const modalId = `settingsModal_${st.winId || crypto.randomUUID()}`;
  const modalEl = buildModalShell(modalId, te("app.pjs.settings.title"));
  document.body.appendChild(modalEl);

  const body = modalEl.querySelector(".modal-body");
  const foot = modalEl.querySelector(".modal-footer");

  // Sections
  const sec = (title) => {
    const w = document.createElement("div");
    w.className = "mb-3";
    const h = document.createElement("div");
    h.className = "fw-semibold mb-2";
    h.textContent = title;
    w.appendChild(h);
    return w;
  };

  // --- SNAP ---
  const snapSec = sec(t("app.pjs.settings.osnap"));
  const snapEnabled = rowCheckbox(t("app.pjs.settings.enable_snap"), env.workspace.snap.enabled, (v) => {
    env.workspace.snap.enabled = !!v;
  });
  snapSec.appendChild(snapEnabled.row);

  const tol = rowNumber(t("app.pjs.settings.tolerance"), env.workspace.snap.tolerancePx, { min: 1, max: 200, step: 1 }, (v) => {
    env.workspace.snap.tolerancePx = v;
  });
  tol.wrap.classList.add("mt-2");
  snapSec.appendChild(tol.wrap);

  const typesWrap = document.createElement("div");
  typesWrap.className = "mt-2 d-flex flex-wrap gap-3";
  for (const ty of SNAP_TYPES) {
    const c = rowCheckbox(ty.label, env.workspace.snap.types[ty.id], (v) => {
      env.workspace.snap.types[ty.id] = !!v;
    });
    typesWrap.appendChild(c.row);
  }
  snapSec.appendChild(typesWrap);
  body.appendChild(snapSec);

  // --- UNITS ---
  const unitsSec = sec(t("app.pjs.settings.units"));
  const u = rowSelect(t("app.pjs.settings.unit"), env.workspace.units.unit, UNITS, (v) => {
    env.workspace.units.unit = v;
  });
  unitsSec.appendChild(u.wrap);
  const calibHint = document.createElement("div");
  calibHint.className = "text-muted small mt-1";
  calibHint.textContent = t("app.pjs.settings.calibration_later");
  unitsSec.appendChild(calibHint);
  body.appendChild(unitsSec);

  // --- GRID ---
  const gridSec = sec(t("app.pjs.settings.grid"));
  gridSec.appendChild(rowCheckbox(t("app.pjs.settings.show_grid"), env.workspace.grid.enabled, (v) => {
    env.workspace.grid.enabled = !!v;
  }).row);
  gridSec.appendChild(rowCheckbox(t("app.pjs.settings.show_subgrid"), env.workspace.grid.showSub, (v) => {
    env.workspace.grid.showSub = !!v;
  }).row);
  gridSec.appendChild(rowCheckbox(t("app.pjs.settings.snap_grid"), env.workspace.grid.snapToGrid, (v) => {
    env.workspace.grid.snapToGrid = !!v;
  }).row);

  const g1 = rowNumber(t("app.pjs.settings.main_spacing"), env.workspace.grid.spacingMain, { min: 1, max: 100000, step: 1 }, (v) => {
    env.workspace.grid.spacingMain = v;
  });
  g1.wrap.classList.add("mt-2");
  gridSec.appendChild(g1.wrap);

  const g2 = rowNumber(t("app.pjs.settings.subdivisions"), env.workspace.grid.subDivisions, { min: 0, max: 100, step: 1 }, (v) => {
    env.workspace.grid.subDivisions = v;
  });
  g2.wrap.classList.add("mt-2");
  gridSec.appendChild(g2.wrap);
  body.appendChild(gridSec);

  // --- SELECTION ---
  const selSec = sec(t("app.pjs.settings.selection"));
  selSec.appendChild(rowCheckbox(t("app.pjs.settings.enable_selection"), env.workspace.selection.enabled, (v) => {
    env.workspace.selection.enabled = !!v;
  }).row);
  selSec.appendChild(rowCheckbox(t("app.pjs.settings.ignore_locked"), env.workspace.selection.ignoreLockedLayers, (v) => {
    env.workspace.selection.ignoreLockedLayers = !!v;
  }).row);
  selSec.appendChild(rowCheckbox(t("app.pjs.settings.ignore_hidden"), env.workspace.selection.ignoreHiddenLayers, (v) => {
    env.workspace.selection.ignoreHiddenLayers = !!v;
  }).row);

  const allowGrid = document.createElement("div");
  allowGrid.className = "mt-2 d-grid";
  allowGrid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  allowGrid.style.gap = "0.25rem 1.5rem";

  for (const k of SELECTABLE_KINDS) {
    const c = rowCheckbox(k.label, env.workspace.selection.allow[k.id], (v) => {
      env.workspace.selection.allow[k.id] = !!v;
    });
    allowGrid.appendChild(c.row);
  }
  selSec.appendChild(allowGrid);
  body.appendChild(selSec);

  // Footer buttons
  const bCancel = document.createElement("button");
  bCancel.className = "btn btn-sm btn-outline-secondary";
  bCancel.textContent = t("common.cancel");

  const bOk = document.createElement("button");
  bOk.className = "btn btn-sm btn-primary";
  bOk.textContent = t("common.ok");

  foot.append(bCancel, bOk);

  const m = openBootstrapModal(modalEl);

  bCancel.addEventListener("click", () => {
    // Restore snapshot
    env.workspace = deepClone(snapshot);
    try { setDirty(bodyEl, false); } catch {}
    m.hide();
  });

  bOk.addEventListener("click", () => {
    try { setDirty(bodyEl, true); } catch {}
    m.hide();
  });

  modalEl.addEventListener("hidden.bs.modal", () => {
    try { modalEl.remove(); } catch {}
  });
}
