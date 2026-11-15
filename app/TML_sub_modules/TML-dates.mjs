// app/TML_sub_modules/TML-dates.mjs
// Date storiche per la timeline TML (_doc/module-tml-timeline.md §2).
//
// Convenzione unica:
//   - nei dati (file JSON del modello, mod_spec): stringa "YYYY", "YYYY-MM", "YYYY-MM-DD",
//     "YYYY-MM-DDTHH:mm[:ss]" con anno STORICO: -753 = 753 a.C., l'anno 0 non esiste.
//     Un numero intero vale come anno ("1492" e 1492 sono la stessa data).
//   - sulle porte dei nodi e nel bus: number = millisecondi UTC (Date.getTime()).
//
// Perché un parser nostro: new Date("-0753-04-21") non è valido (servono anni a 6 cifre con
// segno) e Date.UTC tratta gli anni 0–99 come 1900–1999. Qui si usa setUTCFullYear, che
// accetta qualunque anno. Anno storico → astronomico (quello di Date): a.C. = -(storico) + 1,
// quindi -753 → -752, -1 → 0.
//
// Tutto in UTC: niente fusi orari locali (che per date antiche danno scarti strani).

import { t, lang } from "../shared/i18n.mjs";

// Nomi dei mesi nella lingua dell'interfaccia (Intl), calcolati una volta per lingua.
const _monthCache = new Map();
function _months(style) {
    const key = `${lang()}|${style}`;
    if (_monthCache.has(key)) return _monthCache.get(key);
    let list;
    try {
        const fmt = new Intl.DateTimeFormat(lang(), { month: style, timeZone: 'UTC' });
        list = Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2000, i, 15))));
    } catch {
        list = Array.from({ length: 12 }, (_, i) => String(i + 1));
    }
    _monthCache.set(key, list);
    return list;
}
/** Nome del mese (1-12) per esteso: "ottobre" / "October". */
export const monthName      = (m) => _months('long')[m - 1];
/** Nome del mese (1-12) abbreviato: "ott" / "Oct". */
export const monthNameShort = (m) => _months('short')[m - 1];

export const PRECISIONS = ['year', 'month', 'day', 'minute', 'second'];

const RE_DATE = /^\s*(-?)(\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?)?)?\s*$/;

/** Anno storico (… -2, -1, 1, 2 …) → anno astronomico di Date (… -1, 0, 1, 2 …). */
export function histToAstro(year) {
    if (!Number.isInteger(year) || year === 0) throw new Error(t('app.tml.date.err.year', { year }));
    return year < 0 ? year + 1 : year;
}

/** Anno astronomico → anno storico (0 → -1, -752 → -753). */
export function astroToHist(year) {
    return year <= 0 ? year - 1 : year;
}

/** Millisecondi UTC da parti con anno STORICO. Mese e giorno a partire da 1. */
export function fromParts(year, month = 1, day = 1, hour = 0, minute = 0, second = 0) {
    const y = histToAstro(Number(year));
    const m = Number(month), d = Number(day);
    if (!(m >= 1 && m <= 12)) throw new Error(t('app.tml.date.err.month', { month }));
    if (!(d >= 1 && d <= 31)) throw new Error(t('app.tml.date.err.day', { day }));
    const dt = new Date(0);
    dt.setUTCFullYear(y, m - 1, d);
    dt.setUTCHours(Number(hour) || 0, Number(minute) || 0, Number(second) || 0, 0);
    if (dt.getUTCMonth() !== m - 1) throw new Error(t('app.tml.date.err.nonexistent', { day: d, month: m }));
    return dt.getTime();
}

/** Parti con anno STORICO da millisecondi UTC. */
export function toParts(ms) {
    const dt = new Date(Number(ms));
    if (Number.isNaN(dt.getTime())) return null;
    return {
        year:   astroToHist(dt.getUTCFullYear()),
        month:  dt.getUTCMonth() + 1,
        day:    dt.getUTCDate(),
        hour:   dt.getUTCHours(),
        minute: dt.getUTCMinutes(),
        second: dt.getUTCSeconds(),
    };
}

/**
 * Legge una data nel formato dei dati.
 * @param {string|number} value  "-753-04-21", "1492", "1492-10", 1492 …
 * @returns {{ ms: number, precision: string }}
 * @throws Error con un messaggio leggibile se la data non è valida
 */
export function parseHistDate(value) {
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) throw new Error(t('app.tml.date.err.not_integer', { value }));
        return { ms: fromParts(value), precision: 'year' };
    }
    if (typeof value !== 'string') throw new Error(t('app.tml.date.err.missing'));
    const m = RE_DATE.exec(value);
    if (!m) throw new Error(t('app.tml.date.err.unrecognized', { value }));
    const [, sign, y, mo, d, h, mi, s] = m;
    const year = Number(y) * (sign ? -1 : 1);
    const precision = s != null ? 'second' : mi != null ? 'minute' : d != null ? 'day' : mo != null ? 'month' : 'year';
    return { ms: fromParts(year, mo ?? 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0), precision };
}

/** Come parseHistDate ma restituisce null invece di lanciare (per valori opzionali). */
export function tryParseHistDate(value) {
    if (value == null || value === '') return null;
    try { return parseHistDate(value); } catch { return null; }
}

/** Stringa nel formato dei dati (inverso di parseHistDate), alla precisione indicata. */
export function toHistString(ms, precision = 'day') {
    const p = toParts(ms);
    if (!p) return '';
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    let out = String(p.year);
    if (precision === 'year') return out;
    out += '-' + pad(p.month);
    if (precision === 'month') return out;
    out += '-' + pad(p.day);
    if (precision === 'day') return out;
    out += 'T' + pad(p.hour) + ':' + pad(p.minute);
    if (precision === 'minute') return out;
    return out + ':' + pad(p.second);
}

/**
 * Anno con l'era nella lingua dell'interfaccia: "753 a.C." / "753 BC", "1492", "1492 d.C." / "AD 1492"
 * (era: 'auto' → d.C. solo se showAD, 'always', 'never').
 */
export function formatYear(year, era = 'auto', showAD = false) {
    if (year < 0) return era === 'never' ? String(year) : t('app.tml.date.bc', { year: -year });
    if (era === 'always' || (era === 'auto' && showAD)) return t('app.tml.date.ad', { year });
    return String(year);
}

/**
 * Etichetta leggibile nella lingua dell'interfaccia: "753 a.C.", "ottobre 1492",
 * "12 ottobre 1492, 14:30" (in inglese "753 BC", "October 1492", "October 12, 1492, 14:30").
 * @param {number} ms
 * @param {string} precision  year | month | day | minute | second
 * @param {string} era        auto | always | never
 * @param {boolean} showAD    con era 'auto': aggiunge "d.C." agli anni positivi
 */
export function formatHistDate(ms, precision = 'day', era = 'auto', showAD = false) {
    const p = toParts(ms);
    if (!p) return '';
    const y = formatYear(p.year, era, showAD);
    const pad = (n) => String(n).padStart(2, '0');
    const month = monthName(p.month);
    switch (precision) {
        case 'year':   return y;
        case 'month':  return t('app.tml.date.month_year', { month, year: y });
        case 'day':    return t('app.tml.date.day_month_year', { day: p.day, month, year: y });
        case 'minute': return t('app.tml.date.date_time', { date: t('app.tml.date.day_month_year', { day: p.day, month, year: y }), time: `${pad(p.hour)}:${pad(p.minute)}` });
        default:       return t('app.tml.date.date_time', { date: t('app.tml.date.day_month_year', { day: p.day, month, year: y }), time: `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` });
    }
}

const DUR_UNITS = { s: 1000, min: 60000, h: 3600000, d: 86400000, y: 31556952000 };   // y = 365,2425 d

/** "1d", "5000y", "30min", "2h", "10s" → millisecondi; null se il testo non è valido. */
export function parseDuration(text) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(s|min|h|d|y)\s*$/.exec(String(text ?? ''));
    return m ? Number(m[1]) * DUR_UNITS[m[2]] : null;
}

/**
 * Etichette dell'asse per vis-timeline (opzione format.minorLabels / majorLabels).
 * vis passa (date: moment UTC, scale, step). Con passi di 10+ anni le tacche cadono su anni
 * astronomici tondi (-700, -600 …): si mostrano come "700 a.C." (scarto di un anno, invisibile
 * a quella scala) invece di "701 a.C."; la tacca 0 è "1 a.C.". Al passo di un anno l'etichetta
 * è esatta.
 */
export function makeAxisFormat(getEra) {
    const yearLabel = (ms, step) => {
        const astro = new Date(ms).getUTCFullYear();
        const { era, showAD } = getEra();
        if (step >= 10 && astro < 0) return formatYear(astro, era, showAD);        // -700 → "700 a.C."
        return formatYear(astroToHist(astro), era, showAD);
    };
    const parts = (ms) => toParts(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return {
        minorLabels(date, scale, step) {
            const ms = +date;
            const p = parts(ms);
            if (!p) return '';
            switch (scale) {
                case 'year':        return yearLabel(ms, step);
                case 'month':       return monthNameShort(p.month);
                case 'week':
                case 'day':
                case 'weekday':     return String(p.day);
                case 'hour':        return `${pad(p.hour)}:00`;
                case 'minute':      return `${pad(p.hour)}:${pad(p.minute)}`;
                case 'second':      return `${pad(p.minute)}:${pad(p.second)}`;
                default:            return '';
            }
        },
        majorLabels(date, scale) {
            const ms = +date;
            const p = parts(ms);
            if (!p) return '';
            const { era, showAD } = getEra();
            const y = formatYear(p.year, era, showAD);
            switch (scale) {
                case 'month':       return y;
                case 'week':
                case 'day':
                case 'weekday':     return t('app.tml.date.month_year', { month: monthName(p.month), year: y });
                case 'hour':
                case 'minute':      return t('app.tml.date.day_month_year', { day: p.day, month: monthNameShort(p.month), year: y });
                case 'second':      return t('app.tml.date.date_time', { date: t('app.tml.date.day_month_year', { day: p.day, month: monthNameShort(p.month), year: y }), time: `${pad(p.hour)}:00` });
                default:            return '';
            }
        },
    };
}
