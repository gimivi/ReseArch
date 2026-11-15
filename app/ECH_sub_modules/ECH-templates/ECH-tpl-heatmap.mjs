// ECH-templates/ECH-tpl-heatmap.mjs
// Template: Heatmap cartesiana.
//
// Dataset atteso (dopo mapping):
//   rows: [{ x, y, value }]
//   - x     : categoria asse X (stringa)
//   - y     : categoria asse Y (stringa)
//   - value : valore numerico → determina il colore della cella
//
// templateConfig:
//   title, subtitle, colors (array 2 hex: [min-color, max-color]),
//   showTooltip, showVisualMap (bool),
//   minValue, maxValue  ← se null li calcola automaticamente
//   invertY (bool)      ← inverte ordine asse Y (default false)

export const TEMPLATE_META = {
    id:          "heatmap-basic",
    label:       "Heatmap",
    description: "Mappa di calore su assi categoriali. Utile per matrici di correlazione, calendari di attività, ecc.",
    dataSchema: {
        required: [
            { field: "x",     label: "Categoria asse X" },
            { field: "y",     label: "Categoria asse Y" },
            { field: "value", label: "Valore (intensità colore)" },
        ],
        optional: [],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const xCategories = uniquePreserveOrder(rows.map(r => String(r.x ?? "")));
    const yCategories = uniquePreserveOrder(rows.map(r => String(r.y ?? "")));

    if (cfg.invertY) yCategories.reverse();

    const data = rows.map(r => [
        String(r.x  ?? ""),
        String(r.y  ?? ""),
        toNum(r.value),
    ]);

    const allValues = rows.map(r => toNum(r.value));
    const minV = cfg.minValue ?? Math.min(...allValues);
    const maxV = cfg.maxValue ?? Math.max(...allValues);

    // Palette colore: default blu→rosso; override con 2 hex in cfg.colors
    const colorRange = Array.isArray(cfg.colors) && cfg.colors.length >= 2
        ? [cfg.colors[0], cfg.colors[1]]
        : ["#313695", "#a50026"];

    const option = {
        ...(cfg.title ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        tooltip: cfg.showTooltip
            ? { position: "top", formatter: p => `${p.data[0]} / ${p.data[1]}: <b>${p.data[2]}</b>` }
            : { show: false },
        grid:   { top: cfg.title ? 60 : 20, bottom: 60, left: 80, right: cfg.showVisualMap ? 100 : 20 },
        xAxis:  { type: "category", data: xCategories, splitArea: { show: true } },
        yAxis:  { type: "category", data: yCategories, splitArea: { show: true } },
        visualMap: cfg.showVisualMap ? {
            min:        minV,
            max:        maxV,
            calculable: true,
            orient:     "vertical",
            right:      0,
            top:        "center",
            inRange:    { color: colorRange },
        } : {
            show:    false,
            min:     minV,
            max:     maxV,
            inRange: { color: colorRange },
        },
        series: [{
            type:              "heatmap",
            data,
            label:             { show: xCategories.length <= 15 },
            emphasis:          { itemStyle: { shadowBlur: 10 } },
        }],
    };

    return option;
}

const DEFAULTS = {
    title:         "",
    subtitle:      "",
    colors:        null,
    showTooltip:   true,
    showVisualMap: true,
    minValue:      null,
    maxValue:      null,
    invertY:       false,
};

const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const uniquePreserveOrder = arr => [...new Set(arr)];
