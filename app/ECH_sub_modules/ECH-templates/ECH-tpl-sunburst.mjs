// ECH-templates/ECH-tpl-sunburst.mjs
// Template: Sunburst (torta multi-livello / raggi solari).
//
// Dataset — due formati supportati:
//
//   A) JSON passthrough:
//      rows[0] = { name, value, children?: [...] }
//
//   B) Lista di adiacenza (da MySQL/CSV):
//      rows: [{ id, parent_id, name, value }]
//
// templateConfig:
//   title, subtitle, colors, showTooltip,
//   radius   (array [inner%, outer%], default ["0%","90%"])
//   sort     ("desc"|"asc"|null, default null = ordine inserimento)
//   highlight ("descendant"|"ancestor"|"none", default "descendant")

export const TEMPLATE_META = {
    id:          "sunburst-basic",
    label:       "Sunburst (raggi solari)",
    description: "Torta multi-livello per gerarchie. Drill-down interattivo sui settori.",
    dataSchema: {
        required: [
            { field: "id",        label: "ID nodo"     },
            { field: "parent_id", label: "ID genitore" },
            { field: "name",      label: "Nome nodo"   },
            { field: "value",     label: "Valore (ampiezza settore)" },
        ],
        optional: [],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const first = rows[0];
    let sunData;

    if (first && (Array.isArray(first.children) || first.name != null) && !first.parent_id) {
        sunData = Array.isArray(first.children) ? first.children : [first];
    } else {
        const root = buildTreeFromRows(rows);
        sunData = root ? (Array.isArray(root.children) ? root.children : [root]) : [];
    }

    const sortVal = cfg.sort === "desc" ? "desc"
        : cfg.sort === "asc" ? "asc"
        : null;

    return {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "", left: "center" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip: cfg.showTooltip
            ? { trigger: "item" }
            : { show: false },
        series: [{
            type:      "sunburst",
            data:      sunData,
            radius:    cfg.radius,
            sort:      sortVal,
            emphasis:  { focus: cfg.highlight },
            label:     { rotate: "radial" },
            levels: [
                {},
                { r0: "15%", r: "35%", label: { align: "right"  } },
                { r0: "35%", r: "70%", label: { align: "right"  } },
                { r0: "70%", r: "72%", label: { position: "outside", padding: 3, silent: false }, itemStyle: { borderWidth: 3 } },
            ],
        }],
    };
}

// Lista di adiacenza → albero
function buildTreeFromRows(rows, opts = {}) {
    const idF  = opts.idField     ?? "id";
    const parF = opts.parentField ?? "parent_id";
    const nmF  = opts.nameField   ?? "name";
    const valF = opts.valueField  ?? "value";

    const map = new Map();
    for (const r of rows) {
        const id = String(r[idF] ?? "");
        map.set(id, {
            name:      String(r[nmF] ?? id),
            value:     Number(r[valF]) || 0,
            children:  [],
            _id:       id,
            _parentId: r[parF] != null && r[parF] !== "" ? String(r[parF]) : null,
        });
    }

    const roots = [];
    for (const node of map.values()) {
        if (node._parentId && map.has(node._parentId)) {
            map.get(node._parentId).children.push(node);
        } else {
            roots.push(node);
        }
    }

    const clean = node => {
        const out = { name: node.name, value: node.value };
        if (node.children.length > 0) out.children = node.children.map(clean);
        return out;
    };

    if (roots.length === 1) return clean(roots[0]);
    if (roots.length === 0) return null;
    return { name: "root", value: 0, children: roots.map(clean) };
}

const DEFAULTS = {
    title:     "",
    subtitle:  "",
    colors:    null,
    showTooltip: true,
    radius:    ["0%", "90%"],
    sort:      null,
    highlight: "descendant",
};
