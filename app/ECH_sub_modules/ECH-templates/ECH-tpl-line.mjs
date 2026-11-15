// ECH-templates/ECH-tpl-line.mjs
// Template: Grafico a linee.
//
// Dataset atteso (dopo mapping):
//   rows: [{ category, value, series? }]
//   - category : etichetta sull'asse X (temporale o categoriale)
//   - value    : valore numerico
//   - series   : (opzionale) → linee multiple
//
// templateConfig supportati:
//   title, subtitle, colors, showLegend, showTooltip, showDataZoom,
//   smooth (bool), area (bool), connectNulls (bool)

export const TEMPLATE_META = {
    id:          "line-basic",
    label:       "Linee",
    description: "Grafico a linee per serie temporali o trend. Supporta linee multiple, area e smoothing.",
    dataSchema: {
        required: [
            { field: "category", label: "Categoria / Periodo (asse X)" },
            { field: "value",    label: "Valore (asse Y)"              },
        ],
        optional: [
            { field: "series", label: "Serie (linee multiple)" },
        ],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const hasSeries = rows.some(r => r.series != null && String(r.series).trim() !== "");

    let categories, seriesArr;

    if (!hasSeries) {
        categories = rows.map(r => String(r.category ?? ""));
        seriesArr  = [{
            type:         "line",
            data:         rows.map(r => toNum(r.value)),
            smooth:       cfg.smooth,
            areaStyle:    cfg.area ? {} : undefined,
            connectNulls: cfg.connectNulls,
        }];
    } else {
        categories  = uniquePreserveOrder(rows.map(r => String(r.category ?? "")));
        const names = uniquePreserveOrder(rows.map(r => String(r.series ?? "")));

        seriesArr = names.map(name => ({
            type:         "line",
            name,
            smooth:       cfg.smooth,
            areaStyle:    cfg.area ? {} : undefined,
            connectNulls: cfg.connectNulls,
            data:         categories.map(cat => {
                const row = rows.find(r => String(r.category) === cat && String(r.series) === name);
                return row ? toNum(row.value) : null;
            }),
        }));
    }

    const option = {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip:  cfg.showTooltip ? { trigger: "axis" }  : { show: false },
        legend:   cfg.showLegend  ? { show: true }       : { show: false },
        xAxis:    { type: "category", data: categories },
        yAxis:    { type: "value" },
        series:   seriesArr,
        grid:     { containLabel: true },
    };

    if (cfg.showDataZoom) {
        option.dataZoom = [
            { type: "slider", filterMode: "none" },
            { type: "inside", filterMode: "none" },
        ];
    }

    return option;
}

// --- Defaults ---------------------------------------------------------------
const DEFAULTS = {
    title:        "",
    subtitle:     "",
    colors:       null,
    showLegend:   true,
    showTooltip:  true,
    showDataZoom: false,
    smooth:       false,
    area:         false,
    connectNulls: false,
};

// --- Utils ------------------------------------------------------------------
const toNum = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const uniquePreserveOrder = arr => [...new Set(arr)];
