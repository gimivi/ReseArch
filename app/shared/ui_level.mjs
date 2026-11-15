// app/shared/ui_level.mjs
// Livello di interazione lato client (_doc/arch-i18n-a11y.md §5, _doc/arch-permessi.md §11.4).
//
//   pageLevel()       livello di base della pagina (window.RA_CTX.level, dashboard.php)
//   objectLevel(obj)  livello per un oggetto: obj.ui_level dal server (modal_tree_obj_tools.php),
//                     altrimenti quello di base
//   panelLevel(el)    livello del pannello che contiene el: app/template_XXX.mjs lo scrive in
//                     data-ra-level sul pannello quando apre un oggetto
//
// Tetto per dispositivo (_doc/arch-i18n-a11y.md §5 punto 5 e §7, deciso 2026-10-11): sul telefono
// (< 768px) il livello dei comandi non supera 20: si consulta e si usano gli strumenti in memoria,
// senza salvataggi né editor. Tablet e desktop usano il livello reale. Il tetto si legge all'apertura
// del pannello: ruotare o ridimensionare non cambia i pannelli già aperti.
//
// Solo interfaccia: i controlli veri restano lato server.

export const LEVEL = Object.freeze({
  GUEST: 5,         // ospite (account esterno, non in users): consultazione dei contenuti aperti agli ospiti
  VIEWER: 10,       // consultazione
  USER: 20,         // strumenti che lavorano in memoria, flow in sola lettura
  RESEARCHER: 25,   // membri della ricerca su elementi non propri, P e I di altre ricerche
  AUTHOR: 30,       // modifica e salva quell'elemento
  MANAGER: 40,
  ADMIN: 50,
});

export const PHONE_MAX_LEVEL = LEVEL.USER;

/** true sotto i 768px (telefono, punto di rottura md di Bootstrap). */
export function isPhone() {
  return !!window.matchMedia?.("(max-width: 767.98px)").matches;
}

/** Applica il tetto del dispositivo a un livello. */
export function deviceCap(level) {
  return isPhone() ? Math.min(level, PHONE_MAX_LEVEL) : level;
}

export function pageLevel() {
  const lv = Number(window.RA_CTX?.level);
  return deviceCap(Number.isFinite(lv) ? lv : LEVEL.ADMIN);
}

export function objectLevel(object) {
  const lv = Number(object?.ui_level);
  return object && object.ui_level != null && Number.isFinite(lv) ? deviceCap(lv) : pageLevel();
}

export function panelLevel(el) {
  const host = el?.closest?.("[data-ra-level]");
  const lv = Number(host?.dataset?.raLevel);
  return host && Number.isFinite(lv) ? deviceCap(lv) : pageLevel();
}
