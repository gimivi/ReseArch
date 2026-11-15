// ECH-templates/ECH-tpl-scatter.mjs
// Template: Scatter plot (dispersione).
//
// Dataset atteso (dopo mapping):
//   rows: [{ x, y, name?, series? }]
//   - x, y    : coordinate numeriche
//   - name    : (opzionale) etichetta del punto nel tooltip
//   - series  : (opzionale) raggruppamento → colori/serie distinte
//
// templateConfig:
//   title, subtitle, colors, showLegend, showTooltip,
//   xName, yName  (label assi),
//   symbolSize    (numero o nome campo per size proporzionale: "size")

export const TEMPLATE_META = {
    id:          "scatter-basic",
    label:       "Scatter (dispersione)",
    description: "Grafico di dispersione X/Y. Supporta serie multiple e simboli di dimensione variabile.",
    dataSchema: {
        required: [
            { field: "x", label: "Valore asse X" },
            { field: "y", label: "Valore asse Y" },
        ],
        optional: [
            { field: "name",   label: "Etichetta punto (tooltip)" },
            { field: "series", label: "Serie (raggruppamento)"    },
            { field: "size",   label: "Dimensione simbolo"        },
        ],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const hasSeries = rows.some(r => r.series != null && String(r.series).trim() !== "");
    const hasSize   = rows.some(r => r.size  != null);
    const fixedSize = typeof cfg.symbolSize === "number" ? cfg.symbolSize : 8;

    const makePoint = r => {
        const point = [toNum(r.x), toNum(r.y)];
        if (r.name) point.push(r.name); // ECharts usa il 3° elemento come label
        return {
            value:      point,
            symbolSize: hasSize ? Math.max(4, toNum(r.size)) : fixedSize,
        };
    };

    let seriesArr;
    if (!hasSeries) {
        seriesArr = [{
            type: "scatter",
            data: rows.map(makePoint),
        }];
    } else {
        const names = uniquePreserveOrder(rows.map(r => String(r.series ?? "")));
        seriesArr = names.map(name => ({
            type: "scatter",
            name,
            data: rows
                .filter(r => String(r.series ?? "") === name)
                .map(makePoint),
        }));
    }

    const option = {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip: cfg.showTooltip
            ? {
                trigger:   "item",
                formatter: p => {
                    const [x, y, name] = Array.isArray(p.value) ? p.value : [p.value, "", ""];
                    return `${p.seriesName ? p.seriesName + "<br>" : ""}${name ? name + "<br>" : ""}X: ${x}<br>Y: ${y}`;
                },
            }
            : { show: false },
        legend:  cfg.showLegend && hasSeries ? { show: true } : { show: false },
        xAxis:   { type: "value", name: cfg.xName, scale: true, nameLocation: "end" },
        yAxis:   { type: "value", name: cfg.yName, scale: true, nameLocation: "end" },
        series:  seriesArr,
        grid:    { containLabel: true },
    };

    return option;
}

const DEFAULTS = {
    title:      "",
    subtitle:   "",
    colors:     null,
    showLegend: true,
    showTooltip: true,
    xName:      "",
    yName:      "",
    symbolSize: 8,
};

const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const uniquePreserveOrder = arr => [...new Set(arr)];
