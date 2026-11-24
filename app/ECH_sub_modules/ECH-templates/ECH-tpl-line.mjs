// ECH-templates/ECH-tpl-line.mjs
// Template: Grafico a linee.
//
// Dataset atteso (dopo mapping):
//   rows: [{ category, value, series? }]
//   - category : etichetta sull'asse X (temporale o categoriale)
//   - value    : valore numerico
//   - series   : (opzionale) → linee multiple
//   - rotate   : (opzionale) angolo in gradi (bussola, 0 = nord, orario) → simbolo a freccia
//                ruotato su ogni punto, es. direzione del vento (2026-11-22)
//
// templateConfig supportati:
//   title, subtitle, colors, showLegend, showTooltip, showDataZoom,
//   smooth (bool), area (bool), connectNulls (bool),
//   step ("start" | "middle" | "end" | false) — linea a gradini,
//   showSymbol (bool, default true) — false = linee senza pallini (con "rotate" le frecce restano),
//   arrowEvery (n, default 3) — con "rotate": una freccia ogni n punti,
//   arrowSize (px, default 12), arrowFlip (bool, default true) — "rotate" è la direzione DA CUI
//   viene il fenomeno (convenzione meteo): la freccia punta dalla parte opposta, verso dove va

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
            { field: "rotate", label: "Direzione in gradi (frecce)" },
        ],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const hasSeries = rows.some(r => r.series != null && String(r.series).trim() !== "");
    const hasRotate = rows.some(r => r.rotate != null && r.rotate !== "" && Number.isFinite(Number(r.rotate)));
    const every     = Math.max(1, Math.round(Number(cfg.arrowEvery) || 1));
    const arrowSize = Number(cfg.arrowSize) > 0 ? Number(cfg.arrowSize) : 12;
    const step      = ["start", "middle", "end"].includes(cfg.step) ? cfg.step : (cfg.step === true ? "middle" : undefined);

    // con "rotate": un punto = { value, symbol, symbolRotate }. ECharts ruota in senso antiorario
    // partendo dalla freccia verso l'alto (nord), la bussola gira in senso orario → segno meno.
    const point = (row, i) => {
        if (!row) return null;
        const v = toNum(row.value);
        if (!hasRotate) return v;
        const deg = Number(row.rotate);
        if (i % every !== 0 || row.rotate == null || row.rotate === "" || !Number.isFinite(deg)) return { value: v, symbol: "none" };
        const toward = cfg.arrowFlip === false ? deg : deg + 180;
        return { value: v, symbol: "arrow", symbolSize: [arrowSize * 0.7, arrowSize], symbolRotate: -toward, rotate: deg };
    };
    const common = () => ({
        type:         "line",
        smooth:       cfg.smooth,
        step,
        areaStyle:    cfg.area ? {} : undefined,
        connectNulls: cfg.connectNulls,
        ...(hasRotate ? { showSymbol: true, showAllSymbol: true } : (cfg.showSymbol === false ? { showSymbol: false } : {})),
    });

    let categories, seriesArr;

    if (!hasSeries) {
        categories = rows.map(r => String(r.category ?? ""));
        seriesArr  = [{ ...common(), data: rows.map(point) }];
    } else {
        categories  = uniquePreserveOrder(rows.map(r => String(r.category ?? "")));
        const names = uniquePreserveOrder(rows.map(r => String(r.series ?? "")));
        // indice per (categoria, serie): niente find() ripetuto su migliaia di righe
        const byKey = new Map(rows.map(r => [String(r.category) + "\u0000" + String(r.series), r]));

        seriesArr = names.map(name => ({
            ...common(),
            name,
            data: categories.map((cat, i) => point(byKey.get(cat + "\u0000" + name), i)),
        }));
    }

    const option = {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip:  cfg.showTooltip ? {
            trigger: "axis",
            // con le frecce: anche la direzione in gradi nel tooltip
            ...(hasRotate ? { formatter: ps => {
                const list = Array.isArray(ps) ? ps : [ps];
                const head = list[0]?.axisValueLabel ?? "";
                return [head, ...list.filter(p => p.value != null && (p.value?.value ?? p.value) != null).map(p => {
                    const d = p.data && typeof p.data === "object" ? p.data : { value: p.data };
                    const dir = d.rotate != null ? ` · ${Math.round(d.rotate)}°` : "";
                    return `${p.marker}${p.seriesName ? p.seriesName + ": " : ""}${d.value}${dir}`;
                })].join("<br>");
            } } : {}),
        } : { show: false },
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
    step:         false,
    showSymbol:   true,
    arrowEvery:   3,
    arrowSize:    12,
    arrowFlip:    true,
};

// --- Utils ------------------------------------------------------------------
const toNum = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const uniquePreserveOrder = arr => [...new Set(arr)];
