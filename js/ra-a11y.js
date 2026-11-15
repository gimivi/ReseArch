// js/ra-a11y.js — aiuti di accessibilità comuni a tutte le pagine con header
// (fase 7 di _doc/arch-i18n-a11y.md). Script classico: va caricato DOPO js/i18n.js
// (window.t) e DOPO Tabulator.
//
// 1. Finestre Bootstrap: alla chiusura il fuoco torna all'elemento che aveva il fuoco quando la
//    finestra si è aperta, anche con finestre aperte una sopra l'altra (WCAG 2.4.3).
// 2. Tabulator: testi interni (paginazione, caricamento, errore) dal catalogo; caselle di selezione
//    delle righe con un nome accessibile.
// 3. Righe di tabella che si attivano col clic (selezione, scelta di un elemento): nei contenitori
//    con data-ra-rows="activate" le righe diventano raggiungibili col Tab e si attivano con
//    Invio o Spazio (WCAG 2.1.1).
(function () {
    "use strict";
    const tr = (k, p) => (typeof window.t === "function" ? window.t(k, p) : k);

    // ── 1. Ritorno del fuoco dalle finestre ─────────────────────────────────
    document.addEventListener("show.bs.modal", (ev) => {
        const opener = document.activeElement;
        if (opener && opener !== document.body && !ev.target.contains(opener)) ev.target._raOpener = opener;
    });
    document.addEventListener("hidden.bs.modal", (ev) => {
        const opener = ev.target._raOpener;
        ev.target._raOpener = null;
        // Solo se nessun'altra finestra ha già preso il fuoco e l'elemento è ancora visibile
        if (!opener || !opener.isConnected || opener.offsetParent === null) return;
        if (document.activeElement && document.activeElement !== document.body &&
            document.activeElement.closest(".modal.show")) return;
        opener.focus();
    });

    // ── 2. Tabulator: testi dal catalogo ────────────────────────────────────
    if (window.Tabulator) {
        const lang = {
            data: { loading: tr("a11y.tab.loading"), error: tr("a11y.tab.error") },
            pagination: {
                page_size: tr("a11y.tab.page_size"), page_title: tr("a11y.tab.page_title"),
                first: tr("a11y.tab.first"), first_title: tr("a11y.tab.first_title"),
                last: tr("a11y.tab.last"), last_title: tr("a11y.tab.last_title"),
                prev: tr("a11y.tab.prev"), prev_title: tr("a11y.tab.prev_title"),
                next: tr("a11y.tab.next"), next_title: tr("a11y.tab.next_title"),
                all: tr("a11y.tab.all"),
                counter: { showing: tr("a11y.tab.showing"), of: tr("a11y.tab.of"), rows: tr("a11y.tab.rows"), pages: tr("a11y.tab.pages") },
            },
        };
        try {
            window.Tabulator.defaultOptions.langs = Object.assign({}, window.Tabulator.defaultOptions.langs, { ra: lang });
            window.Tabulator.defaultOptions.locale = "ra";
        } catch (e) { console.warn("[ra-a11y] Tabulator defaultOptions:", e); }
    }

    // ── 2b + 3. Righe e caselle di selezione di Tabulator ───────────────────
    function fixNode(root) {
        if (!(root instanceof Element)) return;
        // caselle "rowSelection" senza nome
        root.querySelectorAll?.(".tabulator input[type='checkbox']:not([aria-label])").forEach((cb) => {
            const inHeader = !!cb.closest(".tabulator-col");
            cb.setAttribute("aria-label", tr(inHeader ? "a11y.tab.select_all" : "a11y.tab.select_row"));
        });
        // righe attivabili da tastiera
        const rows = root.matches?.(".tabulator-row") ? [root] : root.querySelectorAll?.(".tabulator-row") ?? [];
        rows.forEach((row) => {
            if (row.hasAttribute("tabindex") || !row.closest("[data-ra-rows='activate']")) return;
            row.tabIndex = 0;
        });
    }
    new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) fixNode(n);
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => fixNode(document.body));

    document.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        const row = ev.target;
        if (!(row instanceof Element) || !row.classList.contains("tabulator-row")) return;
        if (!row.closest("[data-ra-rows='activate']")) return;
        ev.preventDefault();
        // il clic sulla prima cella fa partire rowClick / la selezione di Tabulator
        (row.querySelector(".tabulator-cell") || row).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
})();
