// app/shared/columns-to-rows.mjs
// Dati a colonne → righe (2026-11-22). Usato dalla sorgente json di ECH (ECH-data-loader.mjs) e dai nodi
// Params/Data/Columns To Rows e Web/Open-Meteo/Forecast (FLE-web-nodes.mjs).
//
//   { time: ["00:00","01:00"], t: [12, 13] }
//     wide → [{ time:"00:00", t:12 }, { time:"01:00", t:13 }]
//     long → [{ time:"00:00", variable:"t", value:12 }, { time:"01:00", variable:"t", value:13 }]

/**
 * Valore a un percorso con i punti ("hourly", "data.items"). Percorso vuoto = il dato stesso.
 * @returns {{ found: boolean, value: any }}
 */
export function readPath(data, path) {
    let cur = data;
    for (const part of String(path ?? "").split(".").map(s => s.trim()).filter(Boolean)) {
        if (cur == null || typeof cur !== "object" || !(part in cur)) return { found: false, value: undefined };
        cur = cur[part];
    }
    return { found: true, value: cur };
}

/**
 * Oggetto di colonne-array → righe. Sono colonne solo i valori array; con lunghezze diverse le
 * righe in più hanno null. Nessuna colonna (o non un oggetto) → null.
 * @param {object} data
 * @param {"wide"|"long"} mode
 * @param {string} [key] - solo long: la colonna che resta (predefinita: la prima)
 * @returns {{ rows: object[], fields: string[] } | null}
 */
export function columnsToRows(data, mode = "wide", key = "") {
    const isObject = data != null && typeof data === "object" && !Array.isArray(data);
    const cols = isObject ? Object.keys(data).filter(k => Array.isArray(data[k])) : [];
    if (cols.length === 0) return null;
    const n = Math.max(...cols.map(c => data[c].length));

    if (mode !== "long") {
        const rows = Array.from({ length: n }, (_, i) =>
            Object.fromEntries(cols.map(c => [c, data[c][i] ?? null])));
        return { rows, fields: cols };
    }

    const keyCol = key && cols.includes(key) ? key : cols[0];
    const rows = [];
    for (const c of cols) {
        if (c === keyCol) continue;
        for (let i = 0; i < n; i++) {
            rows.push({ [keyCol]: data[keyCol][i] ?? null, variable: c, value: data[c][i] ?? null });
        }
    }
    return { rows, fields: [keyCol, "variable", "value"] };
}
