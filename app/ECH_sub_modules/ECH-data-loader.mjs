// ECH_sub_modules/ECH-data-loader.mjs
// Unico punto di ingresso per tutte le sorgenti dati di model_ECH.mjs.
//
// Sorgenti supportate:
//   "mysql"   → POST a api/ech_data.php con la SQL da mod_spec (richiede admin)
//   "json"    → fetch di un URL esterno oppure dati inline in mod_spec
//   "csv_url" → fetch di un URL che produce CSV (es. Google Sheets export)
//
// Output normalizzato (sempre uguale, indipendente dalla sorgente):
//   { rows: [{ campoA, campoB, ... }], rawRows: [...], headers: [...], meta: { count, fields } }
//
// Il campo `mapping` in dataSource traduce i nomi/indici raw nei nomi
// che il template si aspetta (category, value, series, …).

import { t } from "../shared/i18n.mjs";

const ECH_DATA_API = "api/ech_data.php";

// ============================================================
// ENTRY POINT PUBBLICO
// ============================================================

/**
 * Carica e normalizza i dati dalla sorgente configurata in dataSource.
 * @param {object} dataSource - mod_spec.dataSource
 * @param {AbortSignal} [signal]
 * @returns {Promise<NormalizedDataset>}
 */
export async function loadData(dataSource, signal) {
    if (!dataSource || !dataSource.type) {
        throw new Error("[ECH-data-loader] " + t("app.ech.error.ds_type_missing"));
    }

    let rawResult;

    switch (dataSource.type) {
        case "mysql":
            rawResult = await loadMySQL(dataSource, signal);
            break;
        case "json":
            rawResult = await loadJSON(dataSource, signal);
            break;
        case "csv_url":
            rawResult = await loadCSV(dataSource, signal);
            break;
        default:
            throw new Error("[ECH-data-loader] " + t("app.ech.error.ds_type_unknown", { type: dataSource.type }));
    }

    // Applica il mapping (se definito) per normalizzare i nomi dei campi
    const normalized = applyMapping(rawResult, dataSource.mapping ?? null);
    return normalized;
}

// ============================================================
// SORGENTE: mysql
// ============================================================

async function loadMySQL(ds, signal) {
    const sql = ds.sql ?? "";
    if (!sql.trim()) throw new Error("[ECH-data-loader] mysql: " + t("app.ech.error.ds_field_empty", { field: "sql" }));

    const res = await fetch(ECH_DATA_API, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sql, params: ds.params ?? [] }),
        signal,
    });

    if (!res.ok) throw new Error(`[ECH-data-loader] mysql: HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(`[ECH-data-loader] mysql: ${json.error ?? t("app.ech.error.api")}`);

    return {
        rawRows: json.rows ?? [],
        headers: json.fields ?? [],
        isNamedFields: true,          // i campi sono già named (da PDO FETCH_ASSOC)
    };
}

// ============================================================
// SORGENTE: json
// ============================================================

async function loadJSON(ds, signal) {
    let data;

    if (ds.inline != null) {
        // Dati inline in mod_spec
        data = ds.inline;
    } else if (ds.url) {
        const res = await fetch(ds.url, { signal });
        if (!res.ok) throw new Error(`[ECH-data-loader] json: HTTP ${res.status}`);
        data = await res.json();
    } else {
        throw new Error("[ECH-data-loader] json: " + t("app.ech.error.ds_json_missing"));
    }

    // Se è già un array di oggetti, usalo come rawRows.
    // Altrimenti lo passiamo al template "così com'è" tramite rawRows[0].
    const isArray = Array.isArray(data);
    const rawRows = isArray ? data : [data];
    const headers = rawRows.length > 0 && typeof rawRows[0] === "object"
        ? Object.keys(rawRows[0])
        : [];

    return { rawRows, headers, isNamedFields: true };
}

// ============================================================
// SORGENTE: csv_url
// ============================================================

async function loadCSV(ds, signal) {
    if (!ds.url) throw new Error("[ECH-data-loader] csv_url: " + t("app.ech.error.ds_field_missing", { field: "url" }));

    const res = await fetch(ds.url, { signal });
    if (!res.ok) throw new Error(`[ECH-data-loader] csv_url: HTTP ${res.status}`);
    const text = await res.text();

    const delimiter = ds.delimiter ?? ",";
    const hasHeader = ds.hasHeader !== false; // default true

    const allRows = parseCSV(text, delimiter);
    if (allRows.length === 0) return { rawRows: [], headers: [], isNamedFields: false };

    let headers = [];
    let dataRows = allRows;

    if (hasHeader) {
        headers = allRows[0].map(h => h.trim());
        dataRows = allRows.slice(1);
    }

    // Converti array-di-array in array-di-oggetti se abbiamo header
    let rawRows;
    if (hasHeader && headers.length > 0) {
        rawRows = dataRows.map(row =>
            Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]))
        );
        return { rawRows, headers, isNamedFields: true };
    } else {
        // Senza header: rawRows rimangono array (mapping per indice)
        return { rawRows: dataRows, headers, isNamedFields: false };
    }
}

// --- Parser CSV robusto (gestisce virgolette, escape "". Google Sheets compatible) ---
function parseCSV(text, delimiter = ",") {
    const rows = [];
    let col = "", row = [], inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch   = text[i];
        const next = text[i + 1];

        if (inQuotes) {
            if (ch === '"' && next === '"') { col += '"'; i++; }
            else if (ch === '"')            { inQuotes = false; }
            else                            { col += ch; }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === delimiter) {
                row.push(col); col = "";
            } else if (ch === "\r" && next === "\n") {
                row.push(col); col = "";
                if (row.length > 0) rows.push(row);
                row = []; i++;
            } else if (ch === "\n" || ch === "\r") {
                row.push(col); col = "";
                if (row.length > 0) rows.push(row);
                row = [];
            } else {
                col += ch;
            }
        }
    }
    // Ultima riga senza newline finale
    if (col !== "" || row.length > 0) {
        row.push(col);
        if (row.length > 0) rows.push(row);
    }

    // Rimuove righe completamente vuote
    return rows.filter(r => r.some(c => c !== ""));
}

// ============================================================
// MAPPING: raw → normalizzato
// ============================================================

/**
 * Applica il mapping dei campi.
 * mapping es: { "category": "mese", "value": "totale", "series": "tipo" }
 *             { "category": 0, "value": 1 }  ← per CSV senza header
 *
 * Se mapping è null/undefined, i rawRows vengono usati così come sono.
 */
function applyMapping(rawResult, mapping) {
    const { rawRows, headers, isNamedFields } = rawResult;

    if (!mapping || Object.keys(mapping).length === 0) {
        // Nessun mapping: i rawRows sono già il dataset (utile per JSON passthrough)
        return buildNormalizedDataset(rawRows, headers);
    }

    const mappedRows = rawRows.map(raw => {
        const out = {};
        for (const [targetField, source] of Object.entries(mapping)) {
            if (typeof source === "number") {
                // Indice colonna (CSV senza header o con header)
                out[targetField] = Array.isArray(raw) ? raw[source] : Object.values(raw)[source];
            } else if (typeof source === "string") {
                // Nome campo (named fields)
                out[targetField] = raw[source];
            }
        }
        return out;
    });

    return buildNormalizedDataset(mappedRows, Object.keys(mapping));
}

function buildNormalizedDataset(rows, fields) {
    return {
        rows,
        meta: {
            count:  rows.length,
            fields: fields,
        },
    };
}
