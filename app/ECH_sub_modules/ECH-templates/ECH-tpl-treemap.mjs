// ECH-templates/ECH-tpl-treemap.mjs
// Template: Treemap (rettangoli annidati proporzionali al valore).
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
//   showBreadcrumb (bool, default true)
//   leafDepth (numero|null) ← livelli visibili prima del drill-down; null = tutti

export const TEMPLATE_META = {
    id:          "treemap-basic",
    label:       "Treemap",
    description: "Rettangoli annidati dove l'area è proporzionale al valore. Supporta drill-down su più livelli.",
    dataSchema: {
        required: [
            { field: "id",        label: "ID nodo"     },
            { field: "parent_id", label: "ID genitore" },
            { field: "name",      label: "Nome nodo"   },
            { field: "value",     label: "Valore (area del rettangolo)" },
        ],
        optional: [],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    const first = rows[0];
    let treeData;

    if (first && (Array.isArray(first.children) || first.name != null) && !first.parent_id) {
        treeData = Array.isArray(first.children) ? first.children : [first];
    } else {
        const root = buildTreeFromRows(rows);
        treeData = root ? (Array.isArray(root.children) ? root.children : [root]) : [];
    }

    return {
        ...(cfg.title  ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        ...(cfg.colors ? { color: cfg.colors } : {}),
        tooltip: cfg.showTooltip
            ? { formatter: info => `${info.name}<br/>Valore: <b>${info.value}</b><br/>${(info.treePathInfo ?? []).map(p => p.name).join(" › ")}` }
            : { show: false },
        series: [{
            type:       "treemap",
            data:       treeData,
            leafDepth:  cfg.leafDepth,
            breadcrumb: { show: cfg.showBreadcrumb },
            label:      { show: true, formatter: "{b}" },
            upperLabel: { show: true, height: 30 },
            itemStyle:  { borderColor: "#fff", borderWidth: 2, gapWidth: 2 },
            levels: [
                {
                    itemStyle:  { borderWidth: 3, borderColor: "#333", gapWidth: 3 },
                    upperLabel: { show: false },
                },
                {
                    colorSaturation: [0.35, 0.5],
                    itemStyle:       { borderColorSaturation: 0.6, gapWidth: 1, borderWidth: 2 },
                },
            ],
        }],
    };
}

// Lista di adiacenza → albero (identico a ECH-tpl-tree.mjs)
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
    title:          "",
    subtitle:       "",
    colors:         null,
    showTooltip:    true,
    showBreadcrumb: true,
    leafDepth:      null,
};
