// ECH-templates/ECH-tpl-graph.mjs
// Template: Grafo di rete (force-directed / circular / none).
//
// Dataset — due formati supportati:
//
//   A) JSON passthrough (dataSource.type="json", nessun mapping):
//      rows[0] = { nodes: [{id,name,value?,category?,x?,y?},...],
//                  links: [{source,target,value?},...],
//                  categories?: [{name},...] }
//
//   B) Rows flat (da MySQL o CSV, dopo mapping):
//      rows: [{ source, target, value?, sourceCategory?, targetCategory? }]
//      I nodi vengono estratti automaticamente da source/target.
//
// templateConfig:
//   title, subtitle, colors, showLegend, showTooltip,
//   layout    ("force" | "circular" | "none", default "force")
//   roam      (bool, default true)  ← zoom/pan
//   draggable (bool, default true)
//   labelShow (bool, default false)
//   symbolSize (numero, default 20)

export const TEMPLATE_META = {
    id:          "graph-basic",
    label:       "Grafo di rete",
    description: "Rete force-directed, circolare o con coordinate fisse. Supporta nodi con categoria/colore.",
    dataSchema: {
        required: [
            { field: "source", label: "Nodo sorgente" },
            { field: "target", label: "Nodo destinazione" },
        ],
        optional: [
            { field: "value",          label: "Peso arco" },
            { field: "sourceCategory", label: "Categoria nodo sorgente" },
            { field: "targetCategory", label: "Categoria nodo target" },
        ],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    let nodes, links, categories;

    // --- Formato A: JSON passthrough ---
    const first = rows[0];
    if (first && Array.isArray(first.nodes) && Array.isArray(first.links)) {
        nodes      = first.nodes;
        links      = first.links;
        categories = first.categories ?? [];
    } else {
        // --- Formato B: rows flat ---
        const nodeMap  = new Map();
        const catSet   = new Set();

        for (const r of rows) {
            const s  = String(r.source ?? "");
            const t  = String(r.target ?? "");
            const sc = r.sourceCategory != null ? String(r.sourceCategory) : undefined;
            const tc = r.targetCategory != null ? String(r.targetCategory) : undefined;

            if (s && !nodeMap.has(s)) nodeMap.set(s, { id: s, name: s, category: sc ?? 0, symbolSize: cfg.symbolSize });
            if (t && !nodeMap.has(t)) nodeMap.set(t, { id: t, name: t, category: tc ?? 0, symbolSize: cfg.symbolSize });
            if (sc) catSet.add(sc);
            if (tc) catSet.add(tc);
        }

        nodes  = [...nodeMap.values()];
        links  = rows.map(r => ({
            source: String(r.source ?? ""),
            target: String(r.target ?? ""),
            value:  toNum(r.value),
        }));
        categories = [...catSet].map(name => ({ name }));
    }

    const seriesBase = {
        type:             "graph",
        layout:           cfg.layout,
        data:             nodes,
        links,
        categories,
        roam:             cfg.roam,
        draggable:        cfg.draggable,
        symbolSize:       cfg.symbolSize,
        label:            { show: cfg.labelShow, position: "right", formatter: "{b}" },
        lineStyle:        { color: "source", curveness: 0.1 },
        emphasis:         { focus: "adjacency", lineStyle: { width: 4 } },
    };

    // Opzioni specifiche per layout
    if (cfg.layout === "circular") {
        seriesBase.circular = { rotateLabel: true };
    } else if (cfg.layout === "force") {
        seriesBase.force = {
            repulsion:    cfg.repulsion ?? 200,
            edgeLength:   cfg.edgeLength ?? [50, 150],
            gravity:      0.1,
            layoutAnimation: true,
        };
    } else if (cfg.layout === "none") {
        seriesBase.labelLayout  = { hideOverlap: true };
        seriesBase.scaleLimit   = { min: 0.4, max: 2 };
    }

    return {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip:               cfg.showTooltip ? {} : { show: false },
        legend:                cfg.showLegend && categories.length > 0
            ? [{ data: categories.map(c => c.name) }]
            : [{ show: false }],
        animationDurationUpdate: 1500,
        animationEasingUpdate:   "quinticInOut",
        series: [seriesBase],
    };
}

const DEFAULTS = {
    title:      "",
    subtitle:   "",
    colors:     null,
    showLegend: true,
    showTooltip: true,
    layout:     "force",
    roam:       true,
    draggable:  true,
    labelShow:  false,
    symbolSize: 20,
    repulsion:  200,
    edgeLength: [50, 150],
};

const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
