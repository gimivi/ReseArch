// ECH-templates/ECH-tpl-tree.mjs
// Template: Albero gerarchico.
//
// Dataset — due formati supportati:
//
//   A) JSON passthrough (dataSource.type="json", nessun mapping):
//      rows[0] = { name, value?, children: [{name, value?, children:[...]}, ...] }
//
//   B) Lista di adiacenza (da MySQL/CSV, dopo mapping):
//      rows: [{ id, parent_id, name, value? }]
//      Viene costruito l'albero automaticamente.
//      La radice è il nodo con parent_id null/vuoto o non presente nella lista.
//
// templateConfig:
//   title, subtitle, showTooltip,
//   orient    ("LR" | "RL" | "TB" | "BT", default "LR")
//   layout    ("orthogonal" | "radial", default "orthogonal")
//   expandAll (bool, default true)  ← espandi tutti i nodi

export const TEMPLATE_META = {
    id:          "tree-basic",
    label:       "Albero gerarchico",
    description: "Struttura ad albero per gerarchi e relazioni padre-figlio. Supporta layout ortogonale e radiale.",
    dataSchema: {
        required: [
            { field: "id",        label: "ID nodo"     },
            { field: "parent_id", label: "ID genitore" },
            { field: "name",      label: "Nome nodo"   },
        ],
        optional: [
            { field: "value", label: "Valore (dimensione nodo)" },
        ],
    },
};

export function buildOption(dataset, config = {}) {
    const rows = dataset?.rows ?? [];
    const cfg  = { ...DEFAULTS, ...config };

    // Determina il formato dei dati
    const first = rows[0];
    let treeData;

    if (first && (Array.isArray(first.children) || first.name != null) && !first.parent_id) {
        // Formato A: già struttura ad albero
        treeData = first;
    } else {
        // Formato B: lista di adiacenza → albero
        treeData = buildTreeFromRows(rows);
    }

    if (!treeData) {
        return { title: { text: "Dati non validi per il template tree" } };
    }

    // Marca tutti i nodi come espansi se richiesto
    if (cfg.expandAll) markExpanded(treeData);

    return {
        ...(cfg.title ? { title: { text: cfg.title, subtext: cfg.subtitle ?? "" } } : {}),
        tooltip: cfg.showTooltip
            ? { trigger: "item", triggerOn: "mousemove" }
            : { show: false },
        series: [{
            type:              "tree",
            data:              [treeData],
            orient:            cfg.orient,
            layout:            cfg.layout,
            symbol:            "emptyCircle",
            symbolSize:        7,
            label:             { position: cfg.orient === "LR" ? "left" : "top", verticalAlign: "middle", align: "right", fontSize: 12 },
            leaves:            { label: { position: cfg.orient === "LR" ? "right" : "bottom", verticalAlign: "middle", align: "left" } },
            emphasis:          { focus: "descendant" },
            expandAndCollapse: true,
            animationDuration: 550,
            animationDurationUpdate: 750,
        }],
    };
}

// --- Costruisce albero da lista di adiacenza ---
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
            value:     r[valF] != null ? Number(r[valF]) || 0 : undefined,
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
        const out = { name: node.name };
        if (node.value != null) out.value = node.value;
        if (node.children.length > 0) out.children = node.children.map(clean);
        return out;
    };

    if (roots.length === 1) return clean(roots[0]);
    if (roots.length === 0) return null;
    return { name: "root", children: roots.map(clean) };
}

function markExpanded(node) {
    if (!node) return;
    node.collapsed = false;
    if (Array.isArray(node.children)) node.children.forEach(markExpanded);
}

const DEFAULTS = {
    title:      "",
    subtitle:   "",
    showTooltip: true,
    orient:     "LR",
    layout:     "orthogonal",
    expandAll:  true,
};
