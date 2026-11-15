// TJS_sub_modules/TJS-ext-registry.mjs
//
// ELENCO CHIUSO delle estensioni che un flow può installare in un pannello TJS.
// Un nodo FLE non può caricare codice arbitrario (nessun URL, nessun nome libero): può solo
// chiedere uno di questi nomi, e il modulo corrispondente viene importato su richiesta —
// chi non usa un'estensione non la scarica. Per aggiungerne una: un file
// TJS-ext-<nome>.mjs con `export default async function (api, options) → istanza`
// (contratto in TJS-extensions.mjs) e una riga qui sotto.

const MODULES = {
  walkthrough: () => import("./TJS-ext-walkthrough.mjs"),
  audio:       () => import("./TJS-ext-audio.mjs"),
  zones:       () => import("./TJS-ext-zones.mjs"),
};

export const TJS_EXTENSION_NAMES = Object.freeze(Object.keys(MODULES));

/**
 * Installa (o riconfigura) l'estensione `name` nell'host `ext` (appContext.ext).
 * La registrazione è sincrona: model_TJS la attende prima del primo frame.
 * Ogni chiamata va bilanciata da TJS_releaseExtension quando chi la usa si ferma.
 * @returns {Promise<object|null>} istanza dell'estensione
 */
export function TJS_useExtension(ext, name, options = {}) {
  const load = MODULES[name];
  if (!ext) return Promise.resolve(null);
  if (!load) {
    console.error(`[TJS-ext] estensione "${name}" non prevista (ammesse: ${TJS_EXTENSION_NAMES.join(", ")})`);
    return Promise.resolve(null);
  }
  return ext.install(name, async (api, opts) => (await load()).default(api, opts), options);
}

export function TJS_releaseExtension(ext, name) {
  ext?.release?.(name);
}
