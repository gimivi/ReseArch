// ECH-templates/ECH-tpl-calendar.mjs
// Template: Calendar heatmap (GitHub-style activity chart).
//
// Dataset atteso (dopo mapping):
//   rows: [{ date, value }]
//   - date  : stringa "YYYY-MM-DD"
//   - value : valore numerico associato alla data
//
// templateConfig:
//   title, subtitle, showTooltip, showVisualMap,
//   year      (numero es. 2024, o stringa "2024"; null = anno corrente)
//   range     (override libero: "2024" | "2024-06" | ["2024-01","2024-06"])
//   cellSize  (numero pixel, default 13)
//   colors    (array 2 hex: [colore-min, colore-max])

export const TEMPLATE_META = {
    id:          "calendar-basic",
    label:       "Calendar heatmap",
    description: "Intensità giornaliera su griglia calendario (stile GitHub contributions).",
    dataSchema: {
        required: [
            { field: "date",  label: "Data (YYYY-MM-DD)" },
            { field: "value", label: "Valore giornaliero" },
        ],
        optional: [],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const data = rows.map(r => [
        String(r.date  ?? ""),
        toNum(r.value),
    ]).filter(([d]) => /^\d{4}-\d{2}-\d{2}$/.test(d));

    // Range: cfg.range > cfg.year > anno corrente
    const range = cfg.range
        ?? (cfg.year ? String(cfg.year) : String(new Date().getFullYear()));

    // Colori: default giallo→verde (stile GitHub)
    const colorRange = Array.isArray(cfg.colors) && cfg.colors.length >= 2
        ? [cfg.colors[0], cfg.colors[1]]
        : ["#ebedf0", "#196127"];

    const allValues = data.map(d => d[1]);
    const minV = allValues.length ? Math.min(...allValues) : 0;
    const maxV = allValues.length ? Math.max(...allValues) : 1;

    return {
        ...(cfg.title ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "", left: "center" } } : {}),
        tooltip: cfg.showTooltip
            ? { formatter: p => `${p.data[0]}<br/><b>${p.data[1]}</b>` }
            : { show: false },
        visualMap: {
            show:       cfg.showVisualMap,
            min:        minV,
            max:        maxV,
            calculable: true,
            orient:     "horizontal",
            left:       "center",
            top:        cfg.title ? 50 : 20,
            inRange:    { color: colorRange },
        },
        calendar: {
            top:          cfg.title ? 110 : 80,
            left:         40,
            right:        40,
            cellSize:     [cfg.cellSize, cfg.cellSize],
            range,
            itemStyle:    { borderWidth: 2, borderColor: "#fff" },
            yearLabel:    { show: true },
            monthLabel:   { show: true },
            dayLabel:     { firstDay: 1 },     // lunedì come primo giorno
        },
        series: [{
            type:              "heatmap",
            coordinateSystem:  "calendar",
            data,
            label:             { show: false },
        }],
    };
}

const DEFAULTS = {
    title:         "",
    subtitle:      "",
    showTooltip:   true,
    showVisualMap: true,
    year:          null,
    range:         null,
    cellSize:      13,
    colors:        null,
};

const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
