// js/monitor.js
// Heartbeat: aggiorna la sessione attiva ogni 60 secondi e
// mantiene l'icona utenti connessi nell'header sincronizzata.

(function () {
    'use strict';

    const INTERVAL_MS = 60_000;           // 60 secondi
    const ENDPOINT    = 'api/heartbeat.php';
    const PAGE        = 'dashboard';

    function updateBadge(count) {
        const btn = document.getElementById('btnMonitor');
        if (!btn) return;

        // Nome accessibile e suggerimento aggiornati col conteggio (testo da catalogo, js/i18n.js)
        const label = typeof window.t === 'function' ? window.t('header.users_online', { n: count }) : String(count);
        btn.title = label;
        btn.setAttribute('aria-label', label);

        if (count > 1) {
            btn.innerHTML =
                `<span class="fw-bold" aria-hidden="true">${count}</span>` +
                `<i class="bi bi-people" style="font-size:1.2rem;" aria-hidden="true"></i>`;
        } else {
            btn.innerHTML =
                `<i class="bi bi-person" style="font-size:1.2rem;" aria-hidden="true"></i>`;
        }
    }

    async function heartbeat() {
        try {
            const body = new URLSearchParams({ page: PAGE });
            const res  = await fetch(ENDPOINT, { method: 'POST', body });
            if (!res.ok) return;
            const data = await res.json();
            if (typeof data.active_count === 'number') {
                updateBadge(data.active_count);
            }
        } catch (_) {
            // silently fail: non interrompiamo l'app per un heartbeat mancato
        }
    }

    // Prima chiamata appena la pagina è pronta, poi ogni INTERVAL_MS
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', heartbeat);
    } else {
        heartbeat();
    }

    setInterval(heartbeat, INTERVAL_MS);
})();
