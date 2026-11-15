// ECH-templates/ECH-tpl-gauge.mjs
// Template: Gauge (tachimetro / cruscotto).
//
// Dataset atteso (dopo mapping):
//   rows: [{ name, value, min?, max? }]
//   - Una riga = un puntatore/gauge (se più righe → gauge multi-puntatore).
//   - min/max per riga sovrascrivono i valori globali.
//
// templateConfig:
//   title, subtitle, showTooltip,
//   min       (numero globale, default 0)
//   max       (numero globale, default 100)
//   unit      (stringa suffisso, es. "%", "km/h", "°C")
//   splitNum  (numero tacche, default 10)
//   colors    (array di soglie: [[0.3,"#67e0e3"],[0.7,"#37a2da"],[1,"#fd666d"]])
//             oppure singolo array hex (usa i colori in sequenza per i puntatori)

export const TEMPLATE_META = {
    id:          "gauge-basic",
    label:       "Gauge (tachimetro)",
    description: "Indicatore circolare per KPI e metriche. Supporta gauge multipli e soglie di colore.",
    dataSchema: {
        required: [
            { field: "name",  label: "Etichetta gauge" },
            { field: "value", label: "Valore corrente"  },
        ],
        optional: [
            { field: "min", label: "Valore minimo (override)" },
            { field: "max", label: "Valore massimo (override)" },
        ],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    // Colori delle soglie: default o da config
    // Se cfg.colors è array di [soglia, colore] lo usiamo come axisLine.lineStyle.color
    // Se è array di hex li usiamo per i puntatori
    let axisLineColor = DEFAULT_AXIS_COLORS;
    let pointerColors = null;

    if (Array.isArray(cfg.colors) && cfg.colors.length > 0) {
        if (Array.isArray(cfg.colors[0])) {
            // Soglie: [[0.3, "#aaa"], [0.7, "#bbb"], [1, "#ccc"]]
            axisLineColor = cfg.colors;
        } else {
            // Hex semplici: colori per i puntatori
            pointerColors = cfg.colors;
        }
    }

    const data = rows.map((r, i) => ({
        value: toNum(r.value),
        name:  String(r.name ?? `Gauge ${i + 1}`),
        min:   r.min != null ? toNum(r.min) : undefined,
        max:   r.max != null ? toNum(r.max) : undefined,
        ...(pointerColors ? { itemStyle: { color: pointerColors[i % pointerColors.length] } } : {}),
    }));

    return {
        ...(cfg.title ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "", left: "center" } } : {}),
        tooltip: cfg.showTooltip
            ? { formatter: p => `${p.name}: <b>${p.value}${cfg.unit}</b>` }
            : { show: false },
        series: [{
            type:     "gauge",
            min:      cfg.min,
            max:      cfg.max,
            splitNumber: cfg.splitNum,
            radius:   "80%",
            axisLine: {
                lineStyle: {
                    width: 20,
                    color: axisLineColor,
                },
            },
            pointer: {
                itemStyle: { color: "auto" },
            },
            axisTick:  { distance: -25, length: 6,  lineStyle: { color: "#fff", width: 1 } },
            splitLine: { distance: -35, length: 14, lineStyle: { color: "#fff", width: 2 } },
            axisLabel: {
                color:    "inherit",
                distance: 35,
                fontSize: 12,
                formatter: v => `${v}${cfg.unit}`,
            },
            detail: {
                valueAnimation: true,
                formatter:      v => `{value}${cfg.unit}`,
                color:          "inherit",
            },
            data,
        }],
    };
}

// Colori di default: verde→giallo→rosso
const DEFAULT_AXIS_COLORS = [
    [0.3, "#67e0e3"],
    [0.7, "#37a2da"],
    [1.0, "#fd666d"],
];

const DEFAULTS = {
    title:    "",
    subtitle: "",
    showTooltip: true,
    min:      0,
    max:      100,
    unit:     "",
    splitNum: 10,
    colors:   null,
};

const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
