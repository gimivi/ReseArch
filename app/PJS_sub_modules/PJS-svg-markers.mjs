// app/PJS_sub_modules/PJS-svg-markers.mjs
// Template dei marker SVG predefiniti per il tool SVG di PJS.
//
// Struttura di ogni marker:
//   id           — identificatore univoco
//   label        — nome visualizzato nell'interfaccia
//   hasLabel     — true se l'SVG contiene il segnaposto {{label}}
//   labelDefault — valore predefinito del campo etichetta
//   svg          — stringa SVG completa (self-contained, colori inclusi)
//
// Testo variabile: dove hasLabel=true il segnaposto {{label}} viene sostituito
// con il testo inserito dall'utente prima di chiamare paper.importSVG().
// Paper.js converte i tag <text> SVG in PointText, per cui il testo è un item
// Paper.js a tutti gli effetti (selezionabile, trasformabile).

import { t } from "../shared/i18n.mjs";

export const SVG_MARKERS = [

  // ── Pin ────────────────────────────────────────────────────────────────────

  {
    id:       'pin-fill',
    get label() { return t('app.pjs.marker.pin_fill'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <path fill="#dc3545"
    d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10z
       m0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
</svg>`,
  },

  {
    id:       'pin-outline',
    get label() { return t('app.pjs.marker.pin_outline'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <path fill="none" stroke="#dc3545" stroke-width="1"
    d="M8 15.5C8 15.5 2.5 10.2 2.5 6a5.5 5.5 0 0 1 11 0c0 4.2-5.5 9.5-5.5 9.5z"/>
  <circle cx="8" cy="6" r="2" fill="none" stroke="#dc3545" stroke-width="1"/>
</svg>`,
  },

  {
    id:           'pin-label',
    get label() { return t('app.pjs.marker.pin_label'); },
    hasLabel:     true,
    labelDefault: 'A',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 54">
  <path fill="#dc3545"
    d="M20 1C11.2 1 4 8.2 4 17c0 9.5 16 36 16 36S36 26.5 36 17C36 8.2 28.8 1 20 1z"/>
  <circle cx="20" cy="17" r="7" fill="white"/>
  <text x="20" y="21" text-anchor="middle"
        font-size="9" font-weight="bold"
        font-family="Arial,sans-serif" fill="#dc3545">{{label}}</text>
</svg>`,
  },

  // ── Frecce ─────────────────────────────────────────────────────────────────

  {
    id:       'arrow-up',
    get label() { return t('app.pjs.marker.arrow_up'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="12" fill="#0d6efd"/>
  <path fill="white" d="M12 5 L18 12 H14.5 V19 H9.5 V12 H6 Z"/>
</svg>`,
  },

  {
    id:       'arrow-right',
    get label() { return t('app.pjs.marker.arrow_right'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="12" fill="#0d6efd"/>
  <path fill="white" d="M19 12 L12 6 V9.5 H5 V14.5 H12 V18 Z"/>
</svg>`,
  },

  {
    id:       'arrow-down',
    get label() { return t('app.pjs.marker.arrow_down'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="12" fill="#0d6efd"/>
  <path fill="white" d="M12 19 L6 12 H9.5 V5 H14.5 V12 H18 Z"/>
</svg>`,
  },

  {
    id:       'arrow-left',
    get label() { return t('app.pjs.marker.arrow_left'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="12" fill="#0d6efd"/>
  <path fill="white" d="M5 12 L12 18 V14.5 H19 V9.5 H12 V6 Z"/>
</svg>`,
  },

  // ── Simboli ────────────────────────────────────────────────────────────────

  {
    id:       'star',
    get label() { return t('app.pjs.marker.star'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="#ffc107"
    d="M12 2 L14.4 8.8 L21.5 8.9 L15.8 13.2 L17.9 20.1
       L12 16 L6.1 20.1 L8.2 13.2 L2.5 8.9 L9.6 8.8 Z"/>
</svg>`,
  },

  {
    id:       'warning',
    get label() { return t('app.pjs.marker.warning'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="#fd7e14" d="M12 2 L22.5 21 H1.5 Z"/>
  <rect x="11" y="9" width="2" height="6" rx="0.8" fill="white"/>
  <circle cx="12" cy="18.2" r="1.2" fill="white"/>
</svg>`,
  },

  {
    id:       'info',
    get label() { return t('app.pjs.marker.info'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="11" fill="#0dcaf0"/>
  <circle cx="12" cy="7.5" r="1.5" fill="white"/>
  <rect x="11" y="10.5" width="2" height="7" rx="1" fill="white"/>
</svg>`,
  },

  {
    id:       'flag',
    get label() { return t('app.pjs.marker.flag'); },
    hasLabel: false,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <line x1="4" y1="2" x2="4" y2="22"
        stroke="#6f42c1" stroke-width="2" stroke-linecap="round"/>
  <path fill="#6f42c1" d="M4 4 H21 L17 11 L21 18 H4 Z"/>
</svg>`,
  },

];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getMarker(id) {
  return SVG_MARKERS.find(m => m.id === id) || null;
}

export function getMarkerOptions() {
  return SVG_MARKERS.map(m => ({ value: m.id, label: m.label }));
}
