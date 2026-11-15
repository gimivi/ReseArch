// ECH_sub_modules/ECH-option-builder.mjs
// Registry dei template e assemblaggio finale dell'ECharts option.
//
// Flusso:
//   1. loadTemplate(name)   → importa il modulo template giusto
//   2. buildOption(dataset, modSpec) → chiama template.buildOption() + applica optionOverrides
//
// Per aggiungere un nuovo template:
//   1. Creare ECH-templates/ECH-tpl-xxx.mjs con export { TEMPLATE_META, buildOption }
//   2. Aggiungere la voce in TEMPLATE_REGISTRY qui sotto

import { t } from "../shared/i18n.mjs";

// ============================================================
// REGISTRY (lazy imports)
// ============================================================

const TEMPLATE_REGISTRY = {
    "bar-basic":     () => import("./ECH-templates/ECH-tpl-bar.mjs"),
    "line-basic":    () => import("./ECH-templates/ECH-tpl-line.mjs"),
    "pie-basic":     () => import("./ECH-templates/ECH-tpl-pie.mjs"),
    "scatter-basic": () => import("./ECH-templates/ECH-tpl-scatter.mjs"),
    "radar-basic":   () => import("./ECH-templates/ECH-tpl-radar.mjs"),
    "sankey-basic":  () => import("./ECH-templates/ECH-tpl-sankey.mjs"),
    "heatmap-basic":  () => import("./ECH-templates/ECH-tpl-heatmap.mjs"),
    "graph-basic":    () => import("./ECH-templates/ECH-tpl-graph.mjs"),
    "tree-basic":     () => import("./ECH-templates/ECH-tpl-tree.mjs"),
    "treemap-basic":  () => import("./ECH-templates/ECH-tpl-treemap.mjs"),
    "sunburst-basic": () => import("./ECH-templates/ECH-tpl-sunburst.mjs"),
    "gauge-basic":    () => import("./ECH-templates/ECH-tpl-gauge.mjs"),
    "calendar-basic": () => import("./ECH-templates/ECH-tpl-calendar.mjs"),
    // Da implementare:
    // "surface-3d":     () => import("./ECH-templates/ECH-tpl-surface3d.mjs"),
};

// Cache moduli già importati
const _moduleCache = new Map();

/**
 * Carica (e cachea) il modulo template per nome.
 * @param {string} name - es. "bar-basic"
 * @returns {Promise<{ TEMPLATE_META, buildOption }>}
 */
export async function loadTemplate(name) {
    if (_moduleCache.has(name)) return _moduleCache.get(name);

    const loader = TEMPLATE_REGISTRY[name];
    if (!loader) throw new Error("[ECH-option-builder] " + t("app.ech.error.template_unknown", { name, list: Object.keys(TEMPLATE_REGISTRY).join(", ") }));

    const mod = await loader();
    _moduleCache.set(name, mod);
    return mod;
}

/**
 * Lista dei template disponibili (meta info).
 * Utile per popolare i pannelli di configurazione.
 * Nota: carica tutti i moduli → usare con parsimonia.
 */
export async function listTemplates() {
    const list = [];
    for (const name of Object.keys(TEMPLATE_REGISTRY)) {
        try {
            const mod = await loadTemplate(name);
            list.push(mod.TEMPLATE_META);
        } catch { /* template non ancora implementato */ }
    }
    return list;
}

// ============================================================
// ASSEMBLAGGIO OPTION
// ============================================================

/**
 * Costruisce l'ECharts option completo.
 * @param {object} dataset  - output normalizzato di ECH-data-loader
 * @param {object} modSpec  - mod_spec completo dal DB
 * @returns {Promise<object>} ECharts option
 */
export async function buildEChartsOption(dataset, modSpec) {
    const templateName = modSpec?.template ?? "bar-basic";
    const config       = modSpec?.templateConfig ?? {};
    const overrides    = modSpec?.optionOverrides ?? {};

    const tpl    = await loadTemplate(templateName);
    let   option = tpl.buildOption(dataset, config);

    // optionOverrides: merge profondo per permettere overrides puntuali senza
    // sovrascrivere l'intera option (es. aggiungere una seconda yAxis)
    if (overrides && Object.keys(overrides).length > 0) {
        option = deepMerge(option, deepClone(overrides));
    }

    return option;
}

// ============================================================
// UTILS: deepClone / deepMerge
// ============================================================

function deepClone(x) {
    return JSON.parse(JSON.stringify(x ?? {}));
}

function deepMerge(target, src) {
    if (!isObj(target) && !Array.isArray(target)) return src;

    if (Array.isArray(src)) {
        if (!Array.isArray(target)) target = [];
        for (let i = 0; i < src.length; i++) {
            if (src[i] === undefined) continue;
            if (isObj(src[i]) && isObj(target[i]))           target[i] = deepMerge(target[i], src[i]);
            else if (Array.isArray(src[i]) && Array.isArray(target[i])) target[i] = deepMerge(target[i], src[i]);
            else                                              target[i] = deepClone(src[i]);
        }
        return target;
    }

    if (isObj(src)) {
        if (!isObj(target)) target = {};
        for (const k of Object.keys(src)) {
            const sv = src[k], tv = target[k];
            if (Array.isArray(sv))  target[k] = deepMerge(Array.isArray(tv) ? tv : [], sv);
            else if (isObj(sv))     target[k] = deepMerge(isObj(tv) ? tv : {}, sv);
            else                    target[k] = sv;
        }
        return target;
    }

    return src;
}

const isObj = o => Object.prototype.toString.call(o) === "[object Object]";
