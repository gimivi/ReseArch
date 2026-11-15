// ECH-templates/ECH-tpl-sankey.mjs
// Template: Diagramma di Sankey (flussi).
//
// Dataset atteso (dopo mapping):
//   rows: [{ source, target, value }]
//   - source : nodo di partenza (stringa)
//   - target : nodo di arrivo  (stringa)
//   - value  : entità del flusso (numero)
//
// I nodi vengono estratti automaticamente dalle colonne source/target.
// Non serve un campo "nodes" separato.
//
// templateConfig:
//   title, subtitle, colors, showTooltip,
//   orient       ("horizontal" | "vertical", default "horizontal")
//   curveness    (0–1, default 0.5)
//   nodeAlign    ("justify" | "left" | "right")
//   lineColorMode ("gradient" | "source" | "target" | hex fisso)

export const TEMPLATE_META = {
    id:          "sankey-basic",
    label:       "Sankey (flussi)",
    description: "Diagramma di flusso per visualizzare trasferimenti e proporzioni tra nodi.",
    dataSchema: {
        required: [
            { field: "source", label: "Nodo sorgente" },
            { field: "target", label: "Nodo destinazione" },
            { field: "value",  label: "Intensità flusso" },
        ],
        optional: [],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    // Estrai nodi unici (preservando l'ordine di apparizione)
    const nodeSet = new Set();
    for (const r of rows) {
        if (r.source != null) nodeSet.add(String(r.source));
        if (r.target != null) nodeSet.add(String(r.target));
    }
    const nodes = [...nodeSet].map(name => ({ name }));

    const links = rows.map(r => ({
        source: String(r.source ?? ""),
        target: String(r.target ?? ""),
        value:  toNum(r.value),
    }));

    const option = {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip: cfg.showTooltip
            ? { trigger: "item", triggerOn: "mousemove" }
            : { show: false },
        series: [{
            type:   "sankey",
            orient: cfg.orient,
            data:   nodes,
            links,
            nodeAlign: cfg.nodeAlign,
            emphasis:  { focus: "adjacency" },
            lineStyle: {
                color:     cfg.lineColorMode,
                curveness: cfg.curveness,
            },
            label: { position: cfg.orient === "vertical" ? "top" : "right" },
        }],
    };

    return option;
}

const DEFAULTS = {
    title:         "",
    subtitle:      "",
    colors:        null,
    showTooltip:   true,
    orient:        "horizontal",
    curveness:     0.5,
    nodeAlign:     "justify",
    lineColorMode: "gradient",
};

const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
