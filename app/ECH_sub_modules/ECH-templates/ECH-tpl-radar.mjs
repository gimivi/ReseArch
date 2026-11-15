// ECH-templates/ECH-tpl-radar.mjs
// Template: Radar chart (ragnatela).
//
// Dataset atteso (dopo mapping):
//   rows: [{ indicator, value, series? }]
//   - indicator : nome dell'asse radiale (es. "Forza", "Velocità"…)
//   - value     : valore numerico per quell'indicatore
//   - series    : (opzionale) nome del soggetto/entità valutata
//                 → più poligoni sovrapposti, uno per serie
//
// templateConfig:
//   title, subtitle, colors, showLegend, showTooltip,
//   shape   ("polygon" | "circle")
//   maxAuto (bool, default true) – calcola automaticamente il max per asse;
//           se false, usa cfg.maxValue come massimo fisso per tutti gli assi

export const TEMPLATE_META = {
    id:          "radar-basic",
    label:       "Radar (ragnatela)",
    description: "Grafico radar per confronto multi-dimensionale. Supporta serie multiple sovrapposte.",
    dataSchema: {
        required: [
            { field: "indicator", label: "Nome indicatore (asse radiale)" },
            { field: "value",     label: "Valore"                        },
        ],
        optional: [
            { field: "series", label: "Serie / Entità valutata (poligono)" },
        ],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const indicators  = uniquePreserveOrder(rows.map(r => String(r.indicator ?? "")));
    const seriesNames = uniquePreserveOrder(rows.map(r => String(r.series ?? "default")));

    // Calcola max per ogni indicatore (con 20% di headroom)
    const radarIndicator = indicators.map(ind => {
        const vals = rows
            .filter(r => String(r.indicator ?? "") === ind)
            .map(r => toNum(r.value));
        const mx = cfg.maxAuto
            ? Math.max(...vals) * 1.2
            : (cfg.maxValue ?? 100);
        return { name: ind, max: mx || 1 };
    });

    const seriesData = seriesNames.map(name => ({
        name,
        value: indicators.map(ind => {
            const row = rows.find(
                r => String(r.indicator ?? "") === ind && String(r.series ?? "default") === name
            );
            return row ? toNum(row.value) : 0;
        }),
    }));

    const option = {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip: cfg.showTooltip ? {} : { show: false },
        legend:  cfg.showLegend && seriesNames.length > 1
            ? { show: true, data: seriesNames }
            : { show: false },
        radar: {
            indicator: radarIndicator,
            shape:     cfg.shape ?? "polygon",
        },
        series: [{
            type: "radar",
            data: seriesData,
        }],
    };

    return option;
}

const DEFAULTS = {
    title:      "",
    subtitle:   "",
    colors:     null,
    showLegend: true,
    showTooltip: true,
    shape:      "polygon",
    maxAuto:    true,
    maxValue:   100,
};

const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const uniquePreserveOrder = arr => [...new Set(arr)];
