// TJS_sub_modules/TJS-ext-audio.mjs
//
// Estensione "audio": musica di sottofondo di un pannello TJS (playlist di file della
// cartella del workpackage, oppure radio in streaming). Installata dai nodi
// TJS/Setup/Audio e TJS/Audio/Control; motore TJS-audio.mjs (lo stesso di HySpace).
//
// Percorsi relativi risolti da api/hys_audio_tool.php rispetto alla cartella del WP del
// flow (flowId) o, in mancanza, dell'oggetto: stesse regole e stessi controlli di HySpace.
// L'audio parte al primo gesto dell'utente nel pannello (regola dei browser).

import { TJS_createAudio } from "./TJS-audio.mjs";
import { t, te } from "../shared/i18n.mjs";

export default async function createAudioExtension(api) {
  const audio = TJS_createAudio();
  const el = api.bodyEl;

  const unlock = () => audio.unlock();
  el?.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  // Il messaggio va nello stato del footer, che è HTML (cmdUI): i testi di te() sono già
  // protetti, percorsi e messaggi d'errore no (esc).
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

  function notice(text) {
    console.warn("[TJS audio]", text);
    try { api.cmdUI?.update?.({ status: text }); } catch {}
  }

  /** Percorsi (testo separato da , ; a capo, o array) → URL dei file audio. */
  async function resolveMedia(paths, { flowId = null } = {}) {
    const items = (Array.isArray(paths) ? paths : String(paths ?? "").split(/[\n;,]+/))
      .map((x) => String(x).trim()).filter(Boolean);
    const objId = api.object?.obj_id ?? null;
    const out = [];
    for (const item of items) {
      if (/^(https?:)?\/\//i.test(item) || item.startsWith("/")) { out.push(item); continue; }
      const ref = flowId ? `flow_id=${flowId}` : (objId ? `obj_id=${objId}` : null);
      if (!ref) { notice(te("app.tjs.ext.audio.relative_no_ref.@", { item })); continue; }
      try {
        const r = await fetch(`api/hys_audio_tool.php?action=resolve&${ref}&path=${encodeURIComponent(item)}`,
                              { signal: api.signal ?? undefined });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) { notice(`"${esc(item)}": ${esc(j?.error ?? "HTTP " + r.status)}`); continue; }
        out.push(...(j.data?.files ?? []).map((f) => f.url));
      } catch (e) {
        if (e?.name !== "AbortError") notice(`"${esc(item)}": ${esc(e?.message ?? e)}`);
      }
    }
    return out;
  }

  api.addMenuItem({
    side: "right",
    label: () => (audio.on ? t("app.tjs.ext.audio.menu_off") : t("app.tjs.ext.audio.menu_on")),
    onClick: () => {
      if (!audio.status().mode) { notice(te("app.tjs.ext.audio.not_configured")); return; }
      audio.setEnabled(!audio.on);
    },
  });

  return {
    audio,
    resolveMedia,
    notice,
    dispose() {
      el?.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      audio.dispose();
    },
  };
}
