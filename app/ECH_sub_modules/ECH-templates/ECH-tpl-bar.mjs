// ECH-templates/ECH-tpl-bar.mjs
// Template: Grafico a barre verticali (o orizzontali).
//
// Dataset atteso (dopo mapping):
//   rows: [{ category, value, series? }]
//   - category : etichetta sull'asse categoriale
//   - value    : valore numerico
//   - series   : (opzionale) raggruppamento → barre affiancate
//
// templateConfig supportati:
//   title, subtitle, colors, showLegend, showTooltip, showDataZoom,
//   horizontal (bool), stack (bool), smooth (ignorato)

export const TEMPLATE_META = {
    id:          "bar-basic",
    label:       "Barre",
    description: "Barre verticali o orizzontali per confronto categoriale. Supporta raggruppamento e stack per serie.",
    dataSchema: {
        required: [
            { field: "category", label: "Categoria (asse X)" },
            { field: "value",    label: "Valore (asse Y)"    },
        ],
        optional: [
            { field: "series", label: "Serie (raggruppamento / colore)" },
        ],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const hasSeries = rows.some(r => r.series != null && String(r.series).trim() !== "");

    let categories, seriesArr;

    if (!hasSeries) {
        // --- Singola serie ---
        categories = rows.map(r => String(r.category ?? ""));
        seriesArr  = [{
            type:  "bar",
            data:  rows.map(r => toNum(r.value)),
            stack: cfg.stack ? "total" : undefined,
        }];
    } else {
        // --- Serie multiple (barre affiancate o stacked) ---
        categories   = uniquePreserveOrder(rows.map(r => String(r.category ?? "")));
        const names  = uniquePreserveOrder(rows.map(r => String(r.series ?? "")));

        seriesArr = names.map(name => ({
            type:  "bar",
            name,
            stack: cfg.stack ? "total" : undefined,
            data:  categories.map(cat => {
                const row = rows.find(r => String(r.category) === cat && String(r.series) === name);
                return row ? toNum(row.value) : 0;
            }),
        }));
    }

    // Assi: orizzontale inverte categoryAxis e valueAxis
    const categoryAxis = {
        type:      "category",
        data:      categories,
        axisLabel: { rotate: (!cfg.horizontal && categories.length > 10) ? 45 : 0 },
    };
    const valueAxis = { type: "value" };

    const option = {
        ...(cfg.title    ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        ...(cfg.colors   ? { color: cfg.colors } : {}),
        tooltip:  cfg.showTooltip  ? { trigger: "axis" }   : { show: false },
        legend:   cfg.showLegend   ? { show: true }        : { show: false },
        xAxis:    cfg.horizontal   ? valueAxis             : categoryAxis,
        yAxis:    cfg.horizontal   ? categoryAxis          : valueAxis,
        series:   seriesArr,
        grid:     { containLabel: true },
    };

    if (cfg.showDataZoom) {
        option.dataZoom = [{ type: "slider" }, { type: "inside" }];
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
    horizontal:   false,
    stack:        false,
};

// --- Utils ------------------------------------------------------------------
const toNum = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const uniquePreserveOrder = arr => [...new Set(arr)];
