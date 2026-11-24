// model_ECH.mjs
// Renderer ECharts per grafici (ECH)
// Specialization per template_XXX.mjs
//
// Obiettivi:
// - caricare i dati dalla sorgente configurata in mod_spec.dataSource
// - selezionare il template ECharts da mod_spec.template
// - assemblare l'option e montare il chart in bodyEl
// - gestire refresh, export PNG
// - cleanup robusto su AbortSignal
//
// Schema mod_spec atteso:
// {
//   dataSource: { type:"mysql"|"json"|"csv_url", sql|url|inline, mapping:{} },
//   template:   "bar-basic" | "line-basic" | ...,
//   templateConfig: { title, colors, showLegend, showTooltip, showDataZoom, dark, ... },
//   optionOverrides: {}   ← merge diretto sull'ECharts option (escape hatch)
// }

import { loadData }             from "./ECH_sub_modules/ECH-data-loader.mjs";
import { buildEChartsOption }  from "./ECH_sub_modules/ECH-option-builder.mjs";
import {
    echCreate,
    echAttachResize,
    echDispose,
    echExportPNG,
} from "./ECH_sub_modules/ECH-chart-manager.mjs";
import { openDataSourcePanel } from "./ECH_sub_modules/ECH-panel-datasource.mjs";
import { openLayoutPanel }     from "./ECH_sub_modules/ECH-panel-layout.mjs";
import { appBusOn, appBusEmit, APP_EVENT_TYPES } from "./app-bus.mjs";
import { echLoadFlows }        from "./ECH_sub_modules/ECH-flow-runner.mjs";
import { t, te }                from "./shared/i18n.mjs";

// -------------------------------
// CONFIG / STATE
// -------------------------------

const STATE_KEY = "__ECH_STATE__";

// ===============================
// HELPERS PRIVATI
// ===============================

function destroyBodyInstance(bodyEl) {
    const st = bodyEl?.[STATE_KEY];
    if (!st) return;

    st.stopped = true;

    try { if (st.resizeRAF) cancelAnimationFrame(st.resizeRAF); } catch { /* noop */ }
    try { st.resizeObserver?.disconnect(); }                      catch { /* noop */ }
    try { echDispose(st.chart); }                                 catch { /* noop */ }

    try {
        bodyEl.style.position = st.prevBodyStyle?.position ?? "";
        bodyEl.style.overflow = st.prevBodyStyle?.overflow ?? "";
    } catch { /* noop */ }

    try { delete bodyEl[STATE_KEY]; } catch { /* noop */ }
}

function attachAbortCleanup(signal, bodyEl) {
    if (!signal?.addEventListener) return;
    signal.addEventListener("abort", () => destroyBodyInstance(bodyEl), { once: true });
}

function getObjectDisplayName(object) {
    if (!object) return t("app.ech.chart");
    return object.obj_name || object.obj_title || object.name || object.title
        || t("app.ech.chart_n", { id: object.obj_id ?? "" }).trim();
}

/**
 * Decide se questo pannello ECH deve gestire il messaggio bus.
 * Accetta messaggi broadcast (senza targetApp/targetObjId) o diretti a ECH+objId.
 */
function _shouldHandleMsg(msg, object) {
    const p = msg?.payload ?? {};
    if (p.targetApp    && p.targetApp    !== 'ECH')                          return false;
    if (p.targetObjId  != null && Number(p.targetObjId) !== Number(object?.obj_id)) return false;
    return true;
}

/**
 * Aggancia i listener App Bus + localEvents sugli eventi ECharts.
 * Va richiamato sia all'init sia ogni volta che il chart viene ricreato
 * (cambio tema, cambio layout).
 * state.localEvents alimenta i nodi flow embedded ECH/Events/* (vedi
 * ECH-flow-nodes.mjs) — stesso evento reale, un dispatch in più, nessuna
 * logica duplicata rispetto all'emissione App Bus già esistente.
 */
function _attachChartBusEvents(chart, object, state) {
    const objId = object?.obj_id ?? null;

    // Click su un elemento del grafico → selection:change
    chart.on('click', params => {
        const selection = {
            field:      params.name       ?? null,
            value:      params.value      ?? null,
            seriesName: params.seriesName ?? null,
            dataIndex:  params.dataIndex  ?? null,
        };
        state.lastSelection = selection;   // sorgente per ECH/Chart/GetSelected
        appBusEmit('selection:change', { objId, ...selection });
        // data = elemento cliccato com'è nei dati (nodo del grafo/albero con id = uuid TJS,
        // vedi ECH/Graph/FromTree): solo ai nodi ECH/Events/OnClick, non sul bus
        state.localEvents?.dispatchEvent(new CustomEvent('click', { detail: { ...selection, data: params.data ?? null } }));
    });

    // Legenda e zoom: solo ai nodi del flow (ECH/Events/*). Niente filter:apply diretto sul bus
    // (tolto 2026-11-22): con più grafici ECH nella stessa dashboard ognuno riapplicava lo zoom
    // dell'altro e lo rimandava → rimbalzo infinito, pagina bloccata. Per sincronizzare i grafici:
    // OnDataZoom → App Bus Emitter → Receiver → Chart/SetZoom (anti-rimbalzo con only_user).
    chart.on('legendselectchanged', params => {
        const selected = params.selected ?? {};
        state.localEvents?.dispatchEvent(new CustomEvent('legendChange', { detail: { selected } }));
    });

    chart.on('datazoom', params => {
        // params può portare start/end direttamente oppure in batch[0]
        const z    = params.batch?.[0] ?? params;
        const zoom = { start: z.start ?? 0, end: z.end ?? 100 };
        // source: 'flow' se è l'eco di uno zoom chiesto dal flow (Chart/SetZoom), per non
        // rimandarlo indietro quando più grafici si sincronizzano via App Bus (2026-11-22)
        const f = state._flowZoom;
        const fromFlow = !!f && Date.now() - f.t < 1500 && Math.abs(f.start - zoom.start) < 0.01 && Math.abs(f.end - zoom.end) < 0.01;
        if (fromFlow) state._flowZoom = null;
        state.localEvents?.dispatchEvent(new CustomEvent('dataZoom', { detail: { ...zoom, source: fromFlow ? 'flow' : 'user' } }));
    });
}

/**
 * Applica un highlight (o lo rimuove) sul chart — estratta dal vecchio
 * receiver App Bus `selection:change` per essere riusata anche da
 * ECH/Chart/Highlight (flow embedded), stesso principio di
 * _goToHighlight in model_PDF.mjs: una sola definizione, comportamento
 * identico via bus o via flow.
 */
function _applyHighlight(chart, p) {
    if (!chart) return;
    chart.dispatchAction({ type: 'downplay' });
    if (p.dataIndex != null && p.seriesName != null) {
        chart.dispatchAction({ type: 'highlight', seriesName: p.seriesName, dataIndex: p.dataIndex });
        chart.dispatchAction({ type: 'showTip',   seriesName: p.seriesName, dataIndex: p.dataIndex });
    } else if (p.field != null) {
        chart.dispatchAction({ type: 'highlight', name: p.field });
    }
}

/** Estratta dal vecchio receiver `filter:apply.zoom` — vedi _applyHighlight. */
function _applyZoom(chart, start, end, state = null) {
    if (!chart) return;
    const s = Number.isFinite(Number(start)) ? Number(start) : 0;
    const e = Number.isFinite(Number(end)) ? Number(end) : 100;
    if (state) state._flowZoom = { start: s, end: e, t: Date.now() };
    chart.dispatchAction({ type: 'dataZoom', start: s, end: e });
}

/** Estratta dal vecchio receiver `filter:apply.legend` — vedi _applyHighlight. */
function _applyLegend(chart, selected) {
    if (!chart || !selected) return;
    for (const [name, visible] of Object.entries(selected)) {
        chart.dispatchAction({ type: visible ? 'legendSelect' : 'legendUnSelect', name });
    }
}

/**
 * Ricrea il chart con il tema opposto (dark/light) e ridisegna — estratta
 * dal vecchio onClick "Tema scuro/chiaro" del menu destro per essere
 * riusata anche da ECH/Chart/ToggleTheme (flow embedded).
 */
function _toggleTheme(state, bodyEl) {
    if (!state?.modSpec) return;
    const cfg = state.modSpec.templateConfig ?? {};
    cfg.dark  = !cfg.dark;
    state.modSpec.templateConfig = cfg;

    echDispose(state.chart);
    const { container, chart } = echCreate(bodyEl, cfg.dark ? "dark" : null);
    state.chart     = chart;
    state.container = container;
    _attachChartBusEvents(chart, state.object, state);

    return loadAndRender(state.modSpec, state, null);
}

// Salva mod_spec su DB e poi ridisegna.
async function saveAndRefresh(state, bodyEl) {
    const { modId, modSpec, cmdUI } = state;
    if (modId) {
        cmdUI?.update({ status: te("app.ech.status.saving_config") });
        try {
            const res = await fetch("api/mod_spec_tool.php", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ action: "save", mod_id: modId, mod_spec: modSpec }),
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error ?? t("app.ech.error.api"));
        } catch (err) {
            cmdUI?.update({ status: te("app.ech.error.save", { msg: err.message }) });
            console.error("[ECH] saveAndRefresh:", err);
            return;
        }
    }
    await loadAndRender(modSpec, state, null);
}

/**
 * Applica un dataset già caricato/normalizzato al chart (costruisce l'option
 * e chiama setOption). Estratta da loadAndRender per essere riusabile anche
 * da state.setData con un dataset esterno (flow embedded, vedi
 * ECH/Chart/SetData) — non solo dalla sorgente configurata in mod_spec.
 */
async function _renderDataset(dataset, state) {
    const { chart, cmdUI, modSpec } = state;
    if (!chart || state.stopped) return false;

    let option;
    try {
        option = await buildEChartsOption(dataset, modSpec);
    } catch (err) {
        cmdUI?.update({ status: te("app.ech.error.template", { msg: err.message }) });
        console.error("[ECH] buildEChartsOption:", err);
        return false;
    }
    if (state.stopped) return false;

    try {
        chart.setOption(option, { notMerge: true });
        state.lastDataset = dataset;   // sorgente per ECH/Chart/GetData
        cmdUI?.update({
            status: te("app.ech.status.rows", { n: dataset.meta?.count ?? "?", template: modSpec.template ?? "?" }),
        });
        // Sorgente per ECH/Events/OnDataLoaded (flow embedded).
        state.localEvents?.dispatchEvent(new CustomEvent('dataLoaded', {
            detail: { count: dataset.meta?.count ?? null, template: modSpec.template ?? null },
        }));
        return true;
    } catch (err) {
        cmdUI?.update({ status: te("app.ech.error.render", { msg: err.message }) });
        console.error("[ECH] setOption:", err);
        return false;
    }
}

// Carica dati dalla sorgente configurata in mod_spec.dataSource + disegna.
// Richiamata al mount, dal bottone Refresh e da ECH/Chart/Refresh
// (state.refresh) — per un dataset fornito da un flow vedi invece
// state.setData/_renderDataset sopra, che salta questo fetch.
async function loadAndRender(modSpec, state, signal) {
    const { cmdUI } = state;

    cmdUI?.update({ status: te("app.ech.status.loading_data") });

    let dataset;
    try {
        dataset = await loadData(modSpec.dataSource, signal);
    } catch (err) {
        if (signal?.aborted || state.stopped) return;
        cmdUI?.update({ status: te("app.ech.error.data", { msg: err.message }) });
        console.error("[ECH] loadData:", err);
        return;
    }
    if (signal?.aborted || state.stopped) return;

    await _renderDataset(dataset, state);
}

/**
 * Normalizza un dataset esterno (input di ECH/Chart/SetData) alla forma
 * attesa da buildEChartsOption: un array grezzo di record (es. l'output di
 * DBS/DBJ/Data/GetRecords, DBS/GSH/Data/GetRows, DBS/MYS/Data/GetSelectedRow)
 * diventa {rows, rawRows, headers, meta}; un oggetto già in quella forma
 * (es. da un altro pannello ECH via ECH/Chart/GetData) passa invariato.
 */
function _normalizeExternalDataset(input) {
    if (Array.isArray(input)) {
        const headers = input.length ? Object.keys(input[0]) : [];
        return { rows: input, rawRows: input, headers, meta: { count: input.length, fields: headers } };
    }
    if (input && Array.isArray(input.rows)) return input;
    return { rows: [], rawRows: [], headers: [], meta: { count: 0, fields: [] } };
}

// ===============================
// SPECIALIZATION EXPORT (plugin)
// ===============================

export default {

    async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
        if (!bodyEl) throw new Error("ECH.renderBody: bodyEl mancante");

        if (typeof window.echarts === "undefined") {
            bodyEl.innerHTML = `<div class="p-3 text-danger fw-bold" role="alert">
                ${te("app.ech.error.no_echarts")}
            </div>`;
            return;
        }

        // Cleanup precedente
        destroyBodyInstance(bodyEl);

        const prevBodyStyle = {
            position: bodyEl.style.position,
            overflow: bodyEl.style.overflow,
        };
        bodyEl.style.position = bodyEl.style.position || "relative";
        bodyEl.style.overflow = "hidden";

        // Recupera mod_spec dal primo model
        const firstModel = Array.isArray(models) ? models[0] : null;
        const modId      = firstModel?.mod_id ?? null;
        let   modSpec    = firstModel?.mod_spec ?? null;

        if (typeof modSpec === "string") {
            try { modSpec = JSON.parse(modSpec); } catch { modSpec = null; }
        }

        // Guardia: se non c'è dataSource né almeno un template, mostra placeholder
        if (!modSpec?.dataSource && !modSpec?.template) {
            bodyEl.innerHTML = `<div class="p-3 text-muted">
                <strong>ECH</strong>: ${te("app.ech.not_configured")}<br>
                ${te("app.ech.not_configured_hint.@")}
            </div>`;
            return;
        }

        // Tema dark se richiesto
        const theme = modSpec?.templateConfig?.dark ? "dark" : null;

        // Init ECharts
        let container, chart;
        try {
            ({ container, chart } = echCreate(bodyEl, theme));
        } catch (err) {
            cmdUI?.show({ status: te("app.ech.error.init", { msg: err.message }), hints: "" });
            return;
        }

        // Stato istanza
        const state = {
            bodyEl,   // pannello dei nodi ReseArch/Menu/* e /Panel/* (ECH-flow-runner.mjs)
            chart,
            container,
            modId,
            modSpec,
            object,
            cmdUI,
            prevBodyStyle,
            resizeObserver: null,
            resizeRAF:      0,
            stopped:        false,
            // EventTarget locale, indipendente dall'App Bus — sorgente per i
            // nodi flow ECH/Events/* (vedi ECH-flow-nodes.mjs).
            localEvents: new EventTarget(),
            // Ultimo dataset renderizzato (dataSource configurato o
            // ECH/Chart/SetData) — sorgente per ECH/Chart/GetData.
            lastDataset: null,
            // Ultimo punto cliccato sul grafico — sorgente per ECH/Chart/GetSelected.
            lastSelection: null,
            // Wrapper sottili su funzioni module-level già usate dalla UI —
            // nessuna logica duplicata, stesso principio di model_MPS.mjs/model_PDF.mjs.
            highlight:   (p)     => _applyHighlight(state.chart, p ?? {}),
            downplay:    ()      => state.chart?.dispatchAction({ type: 'downplay' }),
            setZoom:     (s, e)  => _applyZoom(state.chart, s, e, state),
            setLegend:   (sel)   => _applyLegend(state.chart, sel),
            setData:     (rows)  => _renderDataset(_normalizeExternalDataset(rows), state),
            refresh:     ()      => loadAndRender(state.modSpec, state, null),
            exportPNG:   (name)  => echExportPNG(state.chart, name || "chart.png"),
            toggleTheme: ()      => _toggleTheme(state, bodyEl),
        };
        bodyEl[STATE_KEY] = state;

        // Collega eventi ECharts → App Bus + localEvents (flow embedded)
        _attachChartBusEvents(chart, object, state);

        // ResizeObserver anti-loop
        state.resizeObserver = echAttachResize(bodyEl, chart, state);

        // Abort cleanup
        attachAbortCleanup(signal, bodyEl);

        // Flow embedded (Contesto 3): unico canale per costruire logica
        // reattiva a click/zoom/legenda/dati di questo pannello — stesso
        // principio di MPS/DBJ/GSH/MYS/PDF.
        await echLoadFlows(state, object, signal);

        // ── App Bus: receiver ────────────────────────────────────────────────
        // Il signal del pannello rimuove automaticamente i listener alla chiusura.

        // data:refresh → ricarica dati
        appBusOn('data:refresh', msg => {
            if (!_shouldHandleMsg(msg, object)) return;
            loadAndRender(state.modSpec, state, null);
        }, signal);

        // selection:change → highlight sul punto/categoria corrispondente
        appBusOn('selection:change', msg => {
            if (!_shouldHandleMsg(msg, object)) return;
            if (state.stopped) return;
            _applyHighlight(state.chart, msg.payload ?? {});
        }, signal);

        // Carica dati e disegna
        cmdUI?.show({ status: te("app.ech.status.init"), hints: "" });
        await loadAndRender(modSpec, state, signal);
    },

    // ---- Menu sinistra ----
    getLeftMenu({ object }) {
        return {
            title: getObjectDisplayName(object),
            items: [],
        };
    },

    // ---- Menu destra ----
    getRightMenu({ bodyEl }) {
        return {
            title: "☰",
            items: [
                {
                    id:    "toggle-dark",
                    label: t("app.ech.menu.toggle_dark"),
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (st) _toggleTheme(st, bodyEl);
                    },
                },
            ],
        };
    },

    // ---- Toolbar ----
    getToolbar({ panel, headerEl, bodyEl }) {
        return {
            items: [
                // --- Refresh ---
                {
                    type:      "button",
                    id:        "btnECHRefresh",
                    iconClass: "bi bi-arrow-clockwise",
                    className: "icon-only",
                    title:     t("app.ech.tb.reload_data"),
                    attrs:     { "aria-label": t("app.ech.tb.reload_data") },
                    onClick: async () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.chart || !st?.modSpec) return;
                        await loadAndRender(st.modSpec, st, null);
                    },
                },

                { type: "spacer", width: 6 },

                // --- Export PNG ---
                {
                    type:      "button",
                    id:        "btnECHExport",
                    iconClass: "bi bi-download",
                    className: "icon-only",
                    title:     t("app.ech.tb.export_png"),
                    attrs:     { "aria-label": t("app.ech.tb.export_png") },
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st?.chart) return;
                        echExportPNG(st.chart, "chart.png");
                    },
                },

                { type: "spacer", width: 6 },

                // --- Configura dati ---
                {
                    type:      "button",
                    id:        "btnECHData",
                    iconClass: "bi bi-database",
                    className: "icon-only",
                    title:     t("app.ech.tb.config_data"),
                    attrs:     { "aria-label": t("app.ech.tb.config_data") },
                    minLevel:  30,
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st) return;
                        openDataSourcePanel(st.modSpec, async updatedSpec => {
                            st.modSpec = updatedSpec;
                            await saveAndRefresh(st, bodyEl);
                        });
                    },
                },

                // --- Configura layout ---
                {
                    type:      "button",
                    id:        "btnECHLayout",
                    iconClass: "bi bi-palette",
                    className: "icon-only",
                    title:     t("app.ech.tb.config_layout"),
                    attrs:     { "aria-label": t("app.ech.tb.config_layout") },
                    minLevel:  30,
                    onClick: () => {
                        const st = bodyEl?.[STATE_KEY];
                        if (!st) return;
                        openLayoutPanel(st.modSpec, async updatedSpec => {
                            st.modSpec = updatedSpec;
                            // Tema può essere cambiato: ricrea il chart
                            const dark = updatedSpec?.templateConfig?.dark;
                            if (dark !== (st.modSpec?.templateConfig?.dark)) {
                                echDispose(st.chart);
                                const { container, chart } = echCreate(bodyEl, dark ? "dark" : null);
                                st.chart     = chart;
                                st.container = container;
                                _attachChartBusEvents(chart, st.object, st);
                            }
                            await saveAndRefresh(st, bodyEl);
                        });
                    },
                },
            ],
        };
    },

    destroy() { /* cleanup gestito da AbortSignal / destroyBodyInstance */ },
};
