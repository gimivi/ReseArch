// model_CSV.mjs
// CSV file viewer — dati da models[0].mod_abs_url, layout Tabulator

import { t } from "./shared/i18n.mjs";

function getObjectDisplayName(object) {
  if (!object) return t("app.csv.object.@");
  return (
    object.obj_name ||
    object.obj_title ||
    object.name ||
    object.title ||
    t("app.csv.object_n.@", { id: object.obj_id ?? "" }).trim()
  );
}

export default {
  /**
   * Render the body content for the selected object.
   * This default implementation:
   * - shows object summary
   * - lists models filtered by mod_obj_id (if available) or shows all models
   * - provides a placeholder "viewer area"
   */
  async renderBody({ bodyEl, object, models, cmdUI, signal }) {
      const csvUrl = models[0].mod_abs_url;
      if (!csvUrl) {
        bodyEl.textContent = t("app.csv.no_url");
        return;
      }

      const spec = parseModSpec(models[0].mod_spec) ?? { view: { columns: [] } };
      const host = document.createElement("div");
      host.className = "tabulator-host";
      host.style.width = "100%";
      host.style.height = "100%";
      host.style.overflow = "hidden";
      bodyEl.appendChild(host);

      const TabulatorCtor =
        window.Tabulator ?? Tabulator ?? null;

      if (!TabulatorCtor) {
        host.textContent = t("app.csv.no_tabulator");
        return;
      }

      // CSV → records
      let records = [];
      try {
        records = parseCSV(await fetchText(csvUrl));
      } catch (e) {
        host.textContent = t("app.csv.load_error", { msg: e.message });
        return;
      }

      const table = new TabulatorCtor(host, {
        data: records,
        columns: specToTabulatorColumns(spec, records),
        layout: "fitColumns",
        height: "100%",
        pagination: "local",
        paginationSize: 10,
        paginationCounter: "rows",
        placeholder: t("app.csv.no_records"),
      });

      table.on("tableBuilt", () => autoFitPageSize(table, bodyEl));
      table.on("renderComplete", () => autoFitPageSize(table, bodyEl));

      const ro = new ResizeObserver(() => {
        autoFitPageSize(table, bodyEl);
        table.redraw(true);
      });
      ro.observe(bodyEl);

      bodyEl.__tabulator = table;
      bodyEl.__resizeObserver = ro;

      signal?.addEventListener('abort', () => {
        ro.disconnect();
        try { table.destroy(); } catch {}
        bodyEl.__tabulator = null;
        bodyEl.__resizeObserver = null;
      }, { once: true });

  },

  /**
   * Left menu:
   * title is forced by template, but we still return something sane.
   */
  getLeftMenu({ object }) {
    return {
      title: getObjectDisplayName(object),
      items: [],
    };
  },

  getRightMenu() {
    return { title: '☰', items: [] };
  },

  destroy() {},
};
/* =======================
   Utilities parseModSpec
   ======================= */

function parseModSpec(modSpecRaw) {
  if (!modSpecRaw) return null;
  if (typeof modSpecRaw === "object") return modSpecRaw;

  if (typeof modSpecRaw === "string") {
    const s = modSpecRaw.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (e) {
      throw new Error(t("app.csv.spec_invalid", { msg: e.message }));
    }
  }
  return null;
}

/* =======================
   Colonne da mod_spec
   ======================= */

function specToTabulatorColumns(spec, records) {
  const specColumns = Array.isArray(spec?.view?.columns)
    ? spec.view.columns
    : [];

  if (specColumns.length) {
    return specColumns.map((c) => {
      const col = {
        title: c.caption ?? c.field ?? "",
        field: c.field,
        editable: (c.mode ?? "rw").toLowerCase() === "rw",
        headerSort: true,
      };

      // width opzionale
      if (c.width !== undefined && c.width !== null && c.width !== "") {
        col.width = c.width;
      }

      return col;
    });
  }

  // fallback automatico
  if (records?.length) {
    return Object.keys(records[0]).map((k) => ({
      title: k,
      field: k,
      editable: false,
      headerSort: true,
    }));
  }

  return [];
}

/* =======================
   CSV parsing
   ======================= */

function detectDelimiter(lines) {
  const count = (line, sep) => {
    let q = false, n = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') q = !q;
      else if (!q && line[i] === sep) n++;
    }
    return n;
  };

  let semi = 0, comma = 0;
  for (const l of lines) {
    semi += count(l, ";");
    comma += count(l, ",");
  }
  return semi >= comma ? ";" : ",";
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = "", q = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
      continue;
    }
    if (!q && ch === sep) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCSV(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim());

  if (!lines.length) return [];

  const sep = detectDelimiter(lines.slice(0, 5));
  const rows = lines.map((l) => splitCsvLine(l, sep));
  const headers = rows[0];

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = {};
    rows[i].forEach((v, c) => r[headers[c]] = v ?? "");
    records.push(r);
  }
  return records;
}

/* =======================
   Page size automatico
   ======================= */

function autoFitPageSize(table, container) {
  const root = table?.element;
  if (!root) return;

  const h = container.clientHeight;
  if (h < 60) return;

  const hh = root.querySelector(".tabulator-header")?.offsetHeight || 0;
  const fh = root.querySelector(".tabulator-footer")?.offsetHeight || 0;

  const avail = h - hh - fh;
  let rh = root.querySelector(".tabulator-row")?.offsetHeight || 28;

  const size = Math.max(1, Math.floor(avail / rh));

  if (container.__pageSize !== size) {
    container.__pageSize = size;
    table.setPageSize(size);
  }
}

/* =======================
   FETCH
   ======================= */

async function fetchText(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}