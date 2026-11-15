// app/FLE_sub_modules/FLE-panels.mjs
// Elenco dei panel aperti in dashboard con un oggetto caricato — usato sia dal
// picker "Testa su panel" di model_FLE.mjs (Contesto 1, dev-mode) sia dal
// picker "Flow embedded" (ui/modal_flow_embedded.js, Scenario per-panel):
// UNA sola query DOM condivisa, per non duplicare la logica in due posti.

import { t } from "../shared/i18n.mjs";

/**
 * @param {object}  [opts]
 * @param {Element} [opts.exclude] — panel da escludere dai risultati (es. il
 *   panel chiamante: non ha senso scegliere se stesso come target).
 * @returns {{ bodyEl: Element, app: string, objId: number, name: string, panelEl: Element }[]}
 */
export function getOpenPanelsForFlow({ exclude } = {}) {
    const result = [];
    document.querySelectorAll('.panel.wm-panel').forEach(el => {
        if (exclude && el === exclude) return;
        const app    = el.dataset.currentApp || '';
        const name   = el.dataset.currentObjectName || t('app.template.object_n.@', { id: el._wmLeaf?.savedState?.objectId ?? '?' });
        const objId  = Number(el._wmLeaf?.savedState?.objectId) || 0;
        const bodyEl = el.querySelector('.panel-body');
        // 'FLE' = finestra dell'editor dei flow (sigla interna, non un'APP degli
        // oggetti): non è un target valido su cui testare/collegare un flow.
        if (bodyEl && app && app !== 'FLE') {
            result.push({ bodyEl, app, objId, name, panelEl: el });
        }
    });
    return result;
}
