// FLE_sub_modules/FLE-app-schemas.mjs
// Schema degli eventi App Bus per ogni applicazione ReseArch.
//
// Struttura per app:
//   label      → nome leggibile
//   events     → { 'event:type': ['campo1', 'campo2', ...] }
//
// Per aggiungere lo schema di una nuova app:
//   1. Aggiungere una voce in APP_SCHEMAS
//   2. Elencare i tipi di evento e i campi del payload
//
// I campi sono quelli effettivamente presenti nel payload emesso dall'app —
// riferimento vivo, non solo hint UI: dal 2026-08-25 (routing App
// Emitter/Receiver per topic anziché per obj_id/pannello) resta l'unico
// consumatore getFieldsForTopic(), che cerca qui i campi noti di un topic
// senza sapere a priori quale app l'abbia originato.

const APP_SCHEMAS = {

    ECH: {
        label: 'ECharts',
        events: {
            // emessi da ECH
            'selection:change': ['field', 'value', 'seriesName', 'dataIndex', 'objId'],
            'filter:apply':     ['filters', 'objId'],
            // ricevuti da ECH (anche emessi per data:refresh)
            'data:refresh':     ['targetApp', 'targetObjId'],
        },
    },

    TJS: {
        label: 'Three.js',
        events: {
            'selection:change': ['objId', 'position', 'normal', 'face'],
            'data:refresh':     [],
        },
    },

    PSG: {
        label: 'Panorama Sferico',
        events: {
            'selection:change': ['lat', 'lon', 'fov', 'objId'],
            'data:refresh':     [],
        },
    },

    HYS: {
        label: 'HySpace',
        events: {
            // emesso a ogni ingresso in una stanza del museo (broadcast)
            'hys:room:enter': ['objId', 'id_ese', 'idu', 'title', 'author', 'from', 'neighbors'],
        },
    },

    MPS: {
        label: 'Google Maps',
        events: {
            'selection:change': ['lat', 'lng', 'altitude', 'nome', 'id_mrk', 'colore', 'objId'],
            'filter:apply':     ['filters', 'objId'],
            'data:refresh':     ['targetApp', 'targetObjId'],
            'mps:view:changed': ['lat', 'lng', 'zoom', 'altitude', 'range', 'tilt', 'heading', 'objId'],
        },
    },

    FLE: {
        label: 'Flow Editor',
        events: {
            'data:refresh': [],
        },
    },
};

// Tipi di evento standard disponibili per tutte le app (fallback)
const STANDARD_EVENTS = {
    'selection:change': ['field', 'value', 'objId', 'row'],
    'filter:apply':     ['filters'],
    'data:refresh':     ['targetApp'],
    'panel:focus':      ['panelId'],
};

/**
 * Restituisce i campi noti per un topic/evento, cercando in TUTTI gli schema
 * app (non uno specifico) — usata dai nodi App Bus Emitter/Receiver (prima App Emitter/Receiver, 2026-08-25): con
 * il routing per topic/nome canale al posto di obj_id, quei nodi non
 * conoscono più "quale app" li ha originati, quindi non possono più chiedere
 * lo schema di una app specifica. Puro aiuto visivo (hint sul nodo): un topic
 * non deve necessariamente corrispondere a un evento realmente documentato
 * qui — se non lo è, ritorna semplicemente [].
 */
export function getFieldsForTopic(topic) {
    if (!topic) return [];
    for (const appCode of Object.keys(APP_SCHEMAS)) {
        const fields = APP_SCHEMAS[appCode]?.events?.[topic];
        if (fields?.length) return fields;
    }
    return STANDARD_EVENTS[topic] ?? [];
}
