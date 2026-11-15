// ECH-templates/ECH-tpl-pie.mjs
// Template: Torta / Ciambella / Rosa dei venti.
//
// Dataset atteso (dopo mapping):
//   rows: [{ name, value }]   ←  "name" o "category" per l'etichetta
//
// templateConfig:
//   title, subtitle, colors, showLegend, showTooltip,
//   donut   (bool)  – ciambella invece di torta piena
//   rose    (bool)  – rose chart (nightingale): area proporzionale al valore
//   labelLine (bool) – mostra linee etichette esterne (default true)

export const TEMPLATE_META = {
    id:          "pie-basic",
    label:       "Torta / Ciambella",
    description: "Grafico a torta o ciambella per proporzioni. Supporta rose chart (nightingale).",
    dataSchema: {
        required: [
            { field: "name",  label: "Etichetta fetta (o 'category')" },
            { field: "value", label: "Valore"                         },
        ],
        optional: [],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const data = rows.map(r => ({
        name:  String(r.name ?? r.category ?? ""),
        value: toNum(r.value),
    }));

    const radius = cfg.donut ? ["38%", "65%"] : "65%";

    const option = {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "", left: "center" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip: cfg.showTooltip
            ? { trigger: "item", formatter: "{b}: {c} ({d}%)" }
            : { show: false },
        legend: cfg.showLegend
            ? { orient: "vertical", left: "left", top: "center" }
            : { show: false },
        series: [{
            type:      "pie",
            radius,
            roseType:  cfg.rose ? "area" : undefined,
            data,
            label: {
                show:     cfg.labelLine,
                position: "outside",
            },
            labelLine: { show: cfg.labelLine },
            emphasis: {
                itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.5)" },
            },
        }],
    };

    return option;
}

const DEFAULTS = {
    title:     "",
    subtitle:  "",
    colors:    null,
    showLegend: true,
    showTooltip: true,
    donut:     false,
    rose:      false,
    labelLine: true,
};

const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
