// TJS_sub_modules/TJS-model-check.mjs
//
// Controlli e correzioni automatiche dei modelli caricati (TJS, HySpace), con TRACCIA:
// la correzione rende il modello utilizzabile subito, la traccia ricorda che il file va
// sistemato a mano (es. riesportandolo da Blender).
//
// Correzione attuale:
//   missing_normals — mesh senza attributo NORMAL (tipico di file convertiti dal VRML):
//                     three.js attiva il flat shading, quindi la LUCE sembra giusta, ma le
//                     OMBRE ricevute usano la normale → normalize(0) = NaN → nessuna ombra.
//                     Si calcolano le normali (computeVertexNormals); l'aspetto non cambia.
//
// Traccia su tre livelli:
//   1. console (gruppo con modello, URL, mesh corrette);
//   2. registro in memoria della pagina (TJS_modelWarnings) per l'avviso a schermo e la
//      voce di menu "Avvisi modelli" del modulo che ha caricato il modello;
//   3. registro attività della piattaforma (api/model_warning_tool.php → activity_log,
//      action "model:warning"), al massimo una volta al giorno per modello e tipo.

import { t } from '../shared/i18n.mjs';

const WARNINGS = new Map();        // chiave "tipo|mod_id|url" → avviso
const SENT = new Set();            // avvisi già inviati al server in questa pagina

// Testo per console e registro (w.text). A schermo si usa la chiave app.tjs.warn.<kind>.
const LABELS = {
  missing_normals: "senza normali: calcolate automaticamente (le ombre ricevute non funzionavano); riesportare con le normali (Blender: glTF → Data → Mesh → Normals)",
};

/**
 * Calcola le normali mancanti. Ritorna { count, names } (mesh corrette).
 * Una geometria condivisa da più mesh si corregge una volta sola.
 */
export function TJS_fixMissingNormals(root) {
  const done = new Set();
  const names = [];
  root?.traverse((o) => {
    const g = o.isMesh ? o.geometry : null;
    if (!g || done.has(g) || !g.attributes?.position || g.attributes.normal) return;
    done.add(g);
    g.computeVertexNormals();
    names.push(o.name || o.parent?.name || "(senza nome)");
  });
  return { count: names.length, names };
}

/**
 * Controlla e corregge un modello appena caricato; registra un avviso se ha corretto qualcosa.
 * @param {THREE.Object3D} root
 * @param {object} info  { modId, modName, url, app }  (app = "TJS" | "HYS" | …)
 * @returns {object|null} l'avviso registrato, o null se il modello era a posto
 */
export function TJS_checkModel(root, info = {}) {
  const fix = TJS_fixMissingNormals(root);
  if (!fix.count) return null;
  return report("missing_normals", info, { meshes: fix.count, names: fix.names.slice(0, 30) });
}

function report(kind, { modId = null, modName = "", url = "", app = "" } = {}, detail = {}) {
  const key = `${kind}|${modId ?? ""}|${url}`;
  const w = { kind, modId, modName: modName || url.split("/").pop() || t("app.tjs.warn.model_fallback.@"), url, app, detail,
              text: LABELS[kind] ?? kind, at: new Date().toISOString() };
  const isNew = !WARNINGS.has(key);
  WARNINGS.set(key, w);

  if (isNew) {
    console.groupCollapsed(`[modello] ${w.modName}${modId ? ` (mod_id ${modId})` : ""}: ${w.text}`);
    console.log("url:", url);
    console.log("dettaglio:", detail);
    console.groupEnd();
  }

  // traccia permanente: solo per i modelli del database (mod_id), una volta per pagina
  if (modId && !SENT.has(key)) {
    SENT.add(key);
    fetch("api/model_warning_tool.php", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mod_id: modId, kind, app, url, detail }),
    }).catch(() => { /* la traccia non deve mai disturbare il caricamento */ });
  }
  return w;
}

/** Avvisi registrati in questa pagina (tutti, o solo quelli dei modelli indicati per url/mod_id). */
export function TJS_modelWarnings(filter = null) {
  const all = [...WARNINGS.values()];
  if (!filter) return all;
  return all.filter((w) => filter({ modId: w.modId, url: w.url, app: w.app }));
}

/** Testo leggibile per un elenco di avvisi (menu "Avvisi modelli"). */
export function TJS_formatModelWarnings(list) {
  if (!list.length) return t("app.tjs.warn.none.@");
  const kindText = (w) => { const k = `app.tjs.warn.${w.kind}`; const s = t(k); return s === k ? w.text : s; };
  return list.map((w) => `• ${w.modName}${w.modId ? ` (mod_id ${w.modId})` : ""} — ${kindText(w)}` +
                         (w.detail?.meshes ? ` [${w.detail.meshes} mesh]` : "")).join("\n");
}
