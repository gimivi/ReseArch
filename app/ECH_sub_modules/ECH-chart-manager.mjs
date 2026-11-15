// ECH_sub_modules/ECH-chart-manager.mjs
// Gestione del lifecycle di un'istanza ECharts: init, resize, dispose.
//
// Pattern resize anti-loop (identico a model_TJS.mjs / model_FLE.mjs):
//   - Container div: position:absolute, width/height 100% via CSS (non JS)
//   - ResizeObserver su bodyEl (non sul container)
//   - RAF guard + lastW/lastH: ignora notifiche ridondanti

// ============================================================
// INIT
// ============================================================

/**
 * Crea il div container, lo monta in bodyEl, inizializza ECharts.
 * @param {HTMLElement} bodyEl
 * @param {string|null} theme - "dark" | null
 * @returns {{ container: HTMLElement, chart: EChartsInstance }}
 */
export function echCreate(bodyEl, theme = null) {
    if (typeof window.echarts === "undefined") {
        throw new Error("[ECH-chart-manager] window.echarts non disponibile. Aggiungere ECharts in dashboard.php.");
    }

    // Controlla se esiste già un'istanza sullo stesso bodyEl (sicurezza extra)
    const existing = window.echarts.getInstanceByDom?.(bodyEl);
    if (existing) {
        try { existing.dispose(); } catch { /* noop */ }
    }

    // Container: position:absolute per evitare il loop resize Bootstrap
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;";
    bodyEl.appendChild(container);

    const w = bodyEl.clientWidth  || 600;
    const h = bodyEl.clientHeight || 400;

    const chart = window.echarts.init(container, theme ?? undefined, { width: w, height: h });
    return { container, chart };
}

// ============================================================
// RESIZE (anti-loop)
// ============================================================

/**
 * Attacca un ResizeObserver a bodyEl.
 * Usa RAF + lastW/lastH per evitare il loop resize Bootstrap.
 * Scrive state.resizeRAF (deve esistere nello state passato).
 *
 * @param {HTMLElement} bodyEl
 * @param {EChartsInstance} chart
 * @param {object} state - deve avere { resizeRAF, stopped }
 * @returns {ResizeObserver}
 */
export function echAttachResize(bodyEl, chart, state) {
    let lastW = 0;
    let lastH = 0;

    const ro = new ResizeObserver(() => {
        if (state.resizeRAF) return;                          // già in coda: salta
        state.resizeRAF = requestAnimationFrame(() => {
            state.resizeRAF = 0;
            if (state.stopped) return;

            const w = bodyEl.clientWidth  || 1;
            const h = bodyEl.clientHeight || 1;
            if (w === lastW && h === lastH) return;           // invariato: salta
            lastW = w;
            lastH = h;

            try {
                if (!chart.isDisposed()) chart.resize({ width: w, height: h });
            } catch { /* chart smontato nel frattempo */ }
        });
    });

    ro.observe(bodyEl);
    return ro;
}

// ============================================================
// DISPOSE
// ============================================================

/**
 * Dispose sicuro di un'istanza ECharts.
 * @param {EChartsInstance|null} chart
 */
export function echDispose(chart) {
    try {
        if (chart && !chart.isDisposed()) chart.dispose();
    } catch { /* noop */ }
}

// ============================================================
// EXPORT IMAGE
// ============================================================

/**
 * Scarica il grafico come PNG.
 * @param {EChartsInstance} chart
 * @param {string} [filename]
 */
export function echExportPNG(chart, filename = "chart.png") {
    try {
        const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
        const a   = document.createElement("a");
        a.href     = url;
        a.download = filename;
        a.click();
    } catch (err) {
        console.error("[ECH-chart-manager] Export PNG:", err);
    }
}
