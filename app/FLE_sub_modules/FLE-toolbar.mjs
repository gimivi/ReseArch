// app/FLE_sub_modules/FLE-toolbar.mjs
// Indicatore runtime nel footer della dashboard.
//
// Mostra: dot pulsante + quanti flow dashboard sono in esecuzione (nomi nel
// tooltip, con quelli sospesi perché aperti nell'editor) + bottone Stop.
// Dal 2026-10-04 il runtime esegue tutti i flow della Config caricata
// (_doc/arch-flow-dashboard.md §3.3): l'indicatore segue 'fle:runtime:changed'.
// Stop ferma tutto fino al prossimo caricamento di una Config.
// Esporta: initFlowToolbar()

import { t } from "../shared/i18n.mjs";

export function initFlowToolbar() {
    const indicator = document.getElementById('fle-indicator');
    const nameEl    = document.getElementById('fle-ind-name');
    const stopBtn   = document.getElementById('fle-ind-stop');
    if (!indicator) return;

    window.addEventListener('fle:runtime:changed', ev => {
        const { running = [], suspended = [] } = ev.detail ?? {};
        indicator.hidden = running.length === 0 && suspended.length === 0;
        if (!nameEl) return;
        nameEl.textContent = running.length === 1
            ? t('app.fle.indicator.one', { name: running[0].flowName || '—' })
            : t('app.fle.indicator.running', { n: running.length });
        if (suspended.length) nameEl.textContent += ' · ' + t('app.fle.indicator.suspended', { n: suspended.length });
        nameEl.title = [
            ...running.map(f => `▶ ${f.flowName || '#' + f.flowId}`),
            ...suspended.map(f => '✎ ' + t('app.fle.indicator.suspended_item', { name: f.flowName || '#' + f.flowId })),
        ].join('\n');
        if (stopBtn) stopBtn.hidden = running.length === 0;
    });

    stopBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('fle:stop'));
    });
}
