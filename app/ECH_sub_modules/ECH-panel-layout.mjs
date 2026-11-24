// ECH_sub_modules/ECH-panel-layout.mjs
// Pannello modale Bootstrap per configurare mod_spec.template e mod_spec.templateConfig.
//
// Uso:
//   import { openLayoutPanel } from "./ECH_sub_modules/ECH-panel-layout.mjs";
//   openLayoutPanel(currentModSpec, async (updatedModSpec) => { ... });

import { te } from "../shared/i18n.mjs";

const MODAL_ID = "echLayoutModal";

// Opzioni template disponibili (id → etichetta tradotta, già protetta per HTML)
const templateOptions = () => ({
    "bar-basic":      te("app.ech.tpl.bar"),
    "line-basic":     te("app.ech.tpl.line"),
    "pie-basic":      te("app.ech.tpl.pie"),
    "scatter-basic":  te("app.ech.tpl.scatter"),
    "radar-basic":    te("app.ech.tpl.radar"),
    "sankey-basic":   te("app.ech.tpl.sankey"),
    "heatmap-basic":  te("app.ech.tpl.heatmap"),
    "graph-basic":    te("app.ech.tpl.graph"),
    "tree-basic":     te("app.ech.tpl.tree"),
    "treemap-basic":  te("app.ech.tpl.treemap"),
    "sunburst-basic": te("app.ech.tpl.sunburst"),
    "gauge-basic":    te("app.ech.tpl.gauge"),
    "calendar-basic": te("app.ech.tpl.calendar"),
});

// ============================================================
// ENTRY POINT
// ============================================================

export function openLayoutPanel(modSpec, onSave) {
    ensureModal();

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById(MODAL_ID));
    populateForm(modSpec);

    const saveBtn = document.getElementById(`${MODAL_ID}-save`);
    const newSave = saveBtn.cloneNode(true);
    saveBtn.replaceWith(newSave);

    newSave.addEventListener("click", async () => {
        const updated = collectForm(modSpec);
        if (!updated) return;
        modal.hide();
        await onSave(updated);
    });

    modal.show();
}

// ============================================================
// CREAZIONE MODALE
// ============================================================

function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;

    // Costruisce le option del select template
    const templateOpts = Object.entries(templateOptions())
        .map(([id, label]) => `<option value="${id}">${label}</option>`)
        .join("");

    const div = document.createElement("div");
    div.innerHTML = `
<div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-labelledby="${MODAL_ID}-title" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="${MODAL_ID}-title">${te("app.ech.tb.config_layout")}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${te("common.close")}"></button>
      </div>

      <div class="modal-body">

        <!-- Tipo template -->
        <div class="mb-3">
          <label class="form-label fw-semibold" for="${MODAL_ID}-template">${te("app.ech.lay.chart_type")}</label>
          <select class="form-select" id="${MODAL_ID}-template">${templateOpts}</select>
        </div>

        <!-- Testi -->
        <div class="row g-2 mb-3">
          <div class="col-6">
            <label class="form-label" for="${MODAL_ID}-chart-title">${te("common.title")}</label>
            <input type="text" class="form-control" id="${MODAL_ID}-chart-title" placeholder="${te("app.ech.lay.title_ph")}">
          </div>
          <div class="col-6">
            <label class="form-label" for="${MODAL_ID}-subtitle">${te("common.subtitle")}</label>
            <input type="text" class="form-control" id="${MODAL_ID}-subtitle" placeholder="${te("app.ech.lay.subtitle_ph")}">
          </div>
        </div>

        <!-- Colori -->
        <div class="mb-3">
          <label class="form-label fw-semibold" for="${MODAL_ID}-colors">${te("app.ech.lay.palette")}
            <span class="text-muted small ms-2">${te("app.ech.lay.palette_hint")}</span>
          </label>
          <input type="text" class="form-control font-monospace" id="${MODAL_ID}-colors"
            placeholder="#5470c6, #91cc75, #fac858, #ee6666, #73c0de">
        </div>

        <!-- Opzioni visualizzazione -->
        <div class="mb-3">
          <label class="form-label fw-semibold d-block">${te("app.ech.lay.visible_elements")}</label>
          <div class="d-flex flex-wrap gap-3">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-legend">
              <label class="form-check-label" for="${MODAL_ID}-legend">${te("app.ech.lay.legend")}</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-tooltip">
              <label class="form-check-label" for="${MODAL_ID}-tooltip">Tooltip</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-datazoom">
              <label class="form-check-label" for="${MODAL_ID}-datazoom">${te("app.ech.lay.datazoom")}</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-dark">
              <label class="form-check-label" for="${MODAL_ID}-dark">${te("app.ech.lay.dark")}</label>
            </div>
          </div>
        </div>

        <!-- Opzioni template-specifiche -->
        <hr>
        <div class="mb-2">
          <label class="form-label fw-semibold">${te("app.ech.lay.specific_options")}</label>
        </div>

        <!-- Bar / Line -->
        <div id="${MODAL_ID}-sec-barline">
          <div class="d-flex flex-wrap gap-3 mb-2">
            <div class="form-check" id="${MODAL_ID}-sec-bar-h">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-horizontal">
              <label class="form-check-label" for="${MODAL_ID}-horizontal">${te("app.ech.lay.horizontal_bars")}</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-stack">
              <label class="form-check-label" for="${MODAL_ID}-stack">${te("app.ech.lay.stacked_bars")}</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-smooth">
              <label class="form-check-label" for="${MODAL_ID}-smooth">${te("app.ech.lay.smooth_lines")}</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-area">
              <label class="form-check-label" for="${MODAL_ID}-area">${te("app.ech.lay.area_lines")}</label>
            </div>
          </div>
        </div>

        <!-- Pie -->
        <div id="${MODAL_ID}-sec-pie" style="display:none">
          <div class="d-flex flex-wrap gap-3 mb-2">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-donut">
              <label class="form-check-label" for="${MODAL_ID}-donut">${te("app.ech.lay.donut")}</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="${MODAL_ID}-rose">
              <label class="form-check-label" for="${MODAL_ID}-rose">${te("app.ech.lay.rose")}</label>
            </div>
          </div>
        </div>

        <!-- Scatter -->
        <div id="${MODAL_ID}-sec-scatter" style="display:none">
          <div class="row g-2 mb-2">
            <div class="col-4">
              <label class="form-label" for="${MODAL_ID}-xname">${te("app.ech.lay.x_label")}</label>
              <input type="text" class="form-control" id="${MODAL_ID}-xname">
            </div>
            <div class="col-4">
              <label class="form-label" for="${MODAL_ID}-yname">${te("app.ech.lay.y_label")}</label>
              <input type="text" class="form-control" id="${MODAL_ID}-yname">
            </div>
            <div class="col-4">
              <label class="form-label" for="${MODAL_ID}-symbolsize">${te("app.ech.lay.symbol_size")}</label>
              <input type="number" class="form-control" id="${MODAL_ID}-symbolsize" value="8" min="2" max="40">
            </div>
          </div>
        </div>

        <!-- Radar -->
        <div id="${MODAL_ID}-sec-radar" style="display:none">
          <div class="mb-2">
            <label class="form-label" for="${MODAL_ID}-radarshape">${te("app.ech.lay.shape")}</label>
            <select class="form-select form-select-sm w-auto" id="${MODAL_ID}-radarshape">
              <option value="polygon">${te("app.ech.lay.polygon")}</option>
              <option value="circle">${te("app.ech.lay.circle")}</option>
            </select>
          </div>
        </div>

        <!-- Sankey -->
        <div id="${MODAL_ID}-sec-sankey" style="display:none">
          <div class="row g-2 mb-2">
            <div class="col-4">
              <label class="form-label" for="${MODAL_ID}-sankey-orient">${te("app.ech.lay.orientation")}</label>
              <select class="form-select form-select-sm" id="${MODAL_ID}-sankey-orient">
                <option value="horizontal">${te("app.ech.lay.horizontal")}</option>
                <option value="vertical">${te("app.ech.lay.vertical")}</option>
              </select>
            </div>
            <div class="col-4">
              <label class="form-label" for="${MODAL_ID}-curveness">${te("app.ech.lay.curveness")}</label>
              <input type="number" class="form-control" id="${MODAL_ID}-curveness"
                value="0.5" min="0" max="1" step="0.1">
            </div>
            <div class="col-4">
              <label class="form-label" for="${MODAL_ID}-linecolor">${te("app.ech.lay.line_color")}</label>
              <select class="form-select form-select-sm" id="${MODAL_ID}-linecolor">
                <option value="gradient">${te("app.ech.lay.gradient")}</option>
                <option value="source">${te("app.ech.lay.from_source")}</option>
                <option value="target">${te("app.ech.lay.from_target")}</option>
              </select>
            </div>
          </div>
        </div>

      </div><!-- /modal-body -->

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${te("common.cancel")}</button>
        <button type="button" class="btn btn-primary" id="${MODAL_ID}-save">${te("app.ech.save_refresh")}</button>
      </div>

    </div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);

    document.getElementById(`${MODAL_ID}-template`).addEventListener("change", updateTemplateSections);
}

// ============================================================
// POPULATE / COLLECT
// ============================================================

function populateForm(modSpec) {
    const tpl = modSpec?.template ?? "bar-basic";
    const cfg = modSpec?.templateConfig ?? {};

    setVal(`${MODAL_ID}-template`, tpl);
    setVal(`${MODAL_ID}-chart-title`, cfg.title ?? "");   // non -title: è l'id del titolo della finestra
    setVal(`${MODAL_ID}-subtitle`, cfg.subtitle ?? "");
    setVal(`${MODAL_ID}-colors`,   Array.isArray(cfg.colors) ? cfg.colors.join(", ") : (cfg.colors ?? ""));

    setCheck(`${MODAL_ID}-legend`,   cfg.showLegend    !== false);
    setCheck(`${MODAL_ID}-tooltip`,  cfg.showTooltip   !== false);
    setCheck(`${MODAL_ID}-datazoom`, cfg.showDataZoom  === true);
    setCheck(`${MODAL_ID}-dark`,     cfg.dark          === true);

    // Bar/Line
    setCheck(`${MODAL_ID}-horizontal`, cfg.horizontal === true);
    setCheck(`${MODAL_ID}-stack`,      cfg.stack      === true);
    setCheck(`${MODAL_ID}-smooth`,     cfg.smooth     === true);
    setCheck(`${MODAL_ID}-area`,       cfg.area       === true);
    // Pie
    setCheck(`${MODAL_ID}-donut`, cfg.donut === true);
    setCheck(`${MODAL_ID}-rose`,  cfg.rose  === true);
    // Scatter
    setVal(`${MODAL_ID}-xname`,      cfg.xName      ?? "");
    setVal(`${MODAL_ID}-yname`,      cfg.yName      ?? "");
    setVal(`${MODAL_ID}-symbolsize`, cfg.symbolSize ?? 8);
    // Radar
    setVal(`${MODAL_ID}-radarshape`, cfg.shape ?? "polygon");
    // Sankey
    setVal(`${MODAL_ID}-sankey-orient`, cfg.orient        ?? "horizontal");
    setVal(`${MODAL_ID}-curveness`,     cfg.curveness     ?? 0.5);
    setVal(`${MODAL_ID}-linecolor`,     cfg.lineColorMode ?? "gradient");

    updateTemplateSections();
}

function collectForm(modSpec) {
    const tpl = getVal(`${MODAL_ID}-template`);

    const colorsRaw = getVal(`${MODAL_ID}-colors`).trim();
    const colors = colorsRaw
        ? colorsRaw.split(",").map(c => c.trim()).filter(Boolean)
        : null;

    const base = {
        title:        getVal(`${MODAL_ID}-chart-title`),
        subtitle:     getVal(`${MODAL_ID}-subtitle`),
        colors,
        showLegend:   getCheck(`${MODAL_ID}-legend`),
        showTooltip:  getCheck(`${MODAL_ID}-tooltip`),
        showDataZoom: getCheck(`${MODAL_ID}-datazoom`),
        dark:         getCheck(`${MODAL_ID}-dark`),
    };

    // Opzioni specifiche per template
    let extra = {};
    if (tpl === "bar-basic") {
        extra = {
            horizontal: getCheck(`${MODAL_ID}-horizontal`),
            stack:      getCheck(`${MODAL_ID}-stack`),
        };
    } else if (tpl === "line-basic") {
        extra = {
            smooth: getCheck(`${MODAL_ID}-smooth`),
            area:   getCheck(`${MODAL_ID}-area`),
        };
    } else if (tpl === "pie-basic") {
        extra = {
            donut: getCheck(`${MODAL_ID}-donut`),
            rose:  getCheck(`${MODAL_ID}-rose`),
        };
    } else if (tpl === "scatter-basic") {
        extra = {
            xName:      getVal(`${MODAL_ID}-xname`),
            yName:      getVal(`${MODAL_ID}-yname`),
            symbolSize: Number(getVal(`${MODAL_ID}-symbolsize`)) || 8,
        };
    } else if (tpl === "radar-basic") {
        extra = { shape: getVal(`${MODAL_ID}-radarshape`) };
    } else if (tpl === "sankey-basic") {
        extra = {
            orient:        getVal(`${MODAL_ID}-sankey-orient`),
            curveness:     Number(getVal(`${MODAL_ID}-curveness`)) || 0.5,
            lineColorMode: getVal(`${MODAL_ID}-linecolor`),
        };
    }

    return {
        ...modSpec,
        template:       tpl,
        // le opzioni che il modale non mostra (es. step, arrowEvery, polar) restano
        templateConfig: { ...(modSpec?.templateConfig ?? {}), ...base, ...extra },
    };
}

// ============================================================
// UI HELPERS
// ============================================================

function updateTemplateSections() {
    const tpl = getVal(`${MODAL_ID}-template`);
    toggle(`${MODAL_ID}-sec-barline`, tpl === "bar-basic" || tpl === "line-basic");
    toggle(`${MODAL_ID}-sec-pie`,     tpl === "pie-basic");
    toggle(`${MODAL_ID}-sec-scatter`, tpl === "scatter-basic");
    toggle(`${MODAL_ID}-sec-radar`,   tpl === "radar-basic");
    toggle(`${MODAL_ID}-sec-sankey`,  tpl === "sankey-basic");
}

function toggle(id, show)    { const el = document.getElementById(id); if (el) el.style.display = show ? "" : "none"; }
function setVal(id, val)     { const el = document.getElementById(id); if (el) el.value = val ?? ""; }
function setCheck(id, bool)  { const el = document.getElementById(id); if (el) el.checked = !!bool; }
function getVal(id)          { return document.getElementById(id)?.value ?? ""; }
function getCheck(id)        { return !!(document.getElementById(id)?.checked); }
