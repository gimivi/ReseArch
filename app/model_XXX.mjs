// model_XXX.mjs
// ============================================================
// TEMPLATE DI RIFERIMENTO — "Hello ReseArch"
// ============================================================
// Punto di partenza per un nuovo modulo APP della piattaforma ReseArch.
// Guida completa (per uno sviluppatore umano o un'AI generativa) in:
//   _doc/guida-nuovo-modulo-ai.md
//
// Contratto plugin (obbligatorio renderBody, il resto opzionale):
// export default {
//   async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {},
//   getLeftMenu({ panel, headerEl, bodyEl, object, models })  => { title, items },
//   getRightMenu({ panel, headerEl, bodyEl, object, models }) => { title, items },
//   getToolbar({ panel, headerEl, bodyEl })                   => { items },
//   destroy() {}
// }
//
// Questo file è ESEGUIBILE così com'è: renderizza il nome dell'oggetto e
// l'elenco dei modelli associati, mostra un esempio funzionante di App Bus
// (ascolto + emissione) e un pulsante in toolbar. Copialo in
// app/model_<COD>.mjs, sostituisci "XXX" con il codice a 3 lettere della
// nuova APP e personalizza le sezioni segnalate.
//
// Questo template basta per un modulo semplice, a singolo file, con un solo
// pannello aperto per volta. Se il modulo cresce (più pannelli dello stesso
// tipo aperti insieme, tool interattivi, split multi-file, un modulo che ne
// ospita un altro) vedi "12. Pattern avanzati per moduli complessi" nella
// guida — pattern reali usati da model_TJS.mjs/model_OSD.mjs/model_PJS.mjs.

// ------------------------------------------------------------
// 1) IMPORT — librerie/moduli ES esterni
// ------------------------------------------------------------
// App Bus: comunicazione cross-panel (vedi _doc/arch-app-bus.md).
// Rimuovi l'import se il modulo non deve comunicare con altri pannelli.
import { appBusOn, appBusEmit } from "./app-bus.mjs";
// Testi dell'interfaccia: sempre da t() con chiavi in lang/it.json + lang/en.json
// (_doc/arch-i18n-a11y.md §2). I dati (nomi di oggetti e modelli) non si traducono.
import { t } from "./shared/i18n.mjs";

// Librerie di terze parti (Three.js, ECharts, Tabulator, ...):
// - se già caricate globalmente in dashboard.php, usale da window.<Lib>
// - se specializzate per questo solo modulo, caricale lazy on-demand
//   (pattern singleton, vedi _doc/arch-moduli-panel.md §2)


// ------------------------------------------------------------
// 2) CONFIG / STATE
// ------------------------------------------------------------
// Chiave univoca per lo stato di questo modulo su bodyEl. Deve essere
// diversa per ogni modulo (es. "__ECH_STATE__", "__MYS_STATE__", ...)
// per evitare collisioni se più moduli condividono lo stesso bodyEl.
const STATE_KEY = "__XXX_STATE__";


// ------------------------------------------------------------
// 3) SPECIALIZATION EXPORT (plugin)
// ------------------------------------------------------------
export default {
  async renderBody({ bodyEl, object, models, cmdUI, signal }) {
    if (!bodyEl) throw new Error("XXX.renderBody: bodyEl mancante");

    // Idempotenza: se il panel viene riusato senza passare da destroy(),
    // ripulisci prima uno stato precedente rimasto appeso.
    destroyBodyInstance(bodyEl);

    const state = { cmdUI, helloCount: 0 };
    bodyEl[STATE_KEY] = state;

    // --- UI minima: "Hello ReseArch" -----------------------------------
    const root = document.createElement("div");
    root.className = "xxx-hello";
    root.style.cssText = "height:100%; overflow:auto; padding:1rem;";

    const h = document.createElement("h5");
    h.textContent = t("app.template.xxx.heading", { name: getObjectDisplayName(object) });
    root.appendChild(h);

    const meta = document.createElement("p");
    meta.className = "text-muted";
    meta.textContent = `obj_app: ${object?.obj_app ?? "?"} · obj_id: ${object?.obj_id ?? "?"}`;
    root.appendChild(meta);

    const list = document.createElement("ul");
    for (const m of Array.isArray(models) ? models : []) {
      const li = document.createElement("li");
      li.textContent = `${m.mod_name ?? m.mod_id ?? t("app.template.xxx.model_default.@")} — ${m.mod_abs_url ?? t("app.template.xxx.no_file")}`;
      list.appendChild(li);
    }
    root.appendChild(list);

    bodyEl.appendChild(root);
    state.root = root;

    // --- Footer cmdUI (vedi _doc/arch-template-cmdui.md) ----------------
    cmdUI?.show({ status: t("app.template.xxx.ready"), hints: t("app.template.xxx.hints") });

    // --- App Bus: esempio di ASCOLTO ------------------------------------
    // signal → la sottoscrizione si rimuove da sola alla chiusura del panel.
    // Rimuovi/adatta se il modulo non deve reagire a eventi di altri pannelli.
    appBusOn("selection:change", ({ payload, sourceApp }) => {
      cmdUI?.update({ status: t("app.template.xxx.received", { event: "selection:change", app: sourceApp ?? "?" }) });
    }, signal);

    // --- MCP (Model Context Protocol) -----------------------------------
    // Non esiste oggi un client MCP da importare qui: il server MCP
    // (vedi _doc/integrazione-mcp-server.md, roadmap non ancora implementata)
    // controllerà i pannelli passando dall'App Bus, esattamente come sopra.
    // Per rendere questo modulo "pilotabile" da MCP in futuro basta:
    //  - usare/emettere eventi App Bus con nomi chiari (<app>:<entità>:<azione>)
    //  - documentarli in _doc/arch-app-bus.md quando il modulo è pronto

    // --- Accesso dati MySQL diretto (opzionale, DA VALUTARE) ------------
    // api/grid.php esiste già ma è specifico di model_MYS.mjs: richiede una
    // riga in cfg/grid_schema.php (whitelist server-side per mod_id/colonne).
    // Non è un endpoint generico riutilizzabile senza modifiche server-side.
    // Se questo modulo deve leggere/scrivere righe MySQL arbitrarie, va
    // valutato un endpoint dedicato — non abilitare per default.

    signal?.addEventListener("abort", () => destroyBodyInstance(bodyEl), { once: true });
  },

  /**
   * Left menu: azioni specifiche del modulo (titolo forzato al nome oggetto).
   */
  getLeftMenu({ object, bodyEl }) {
    return {
      title: getObjectDisplayName(object),
      items: [
        {
          id: "xxx-hello",
          label: t("app.template.xxx.greet"),
          onClick: () => {
            const state = bodyEl?.[STATE_KEY];
            if (!state) return;
            state.helloCount += 1;
            state.cmdUI?.update({ status: `Hello #${state.helloCount}` });
          },
        },
      ],
    };
  },

  /**
   * Right menu: azioni sulle qualità del modello (vuoto di default).
   */
  getRightMenu() {
    return { title: "☰", items: [] };
  },

  /**
   * Toolbar: esempio di pulsante che emette un evento App Bus.
   * Rimuovi se il modulo non ha bisogno di una toolbar.
   */
  getToolbar({ bodyEl }) {
    return {
      items: [
        {
          type: "button",
          id: "btnXxxEmit",
          iconClass: "bi bi-broadcast",
          className: "icon-only",
          title: t("app.template.xxx.emit_title"),
          onClick: () => {
            const state = bodyEl?.[STATE_KEY];
            appBusEmit("xxx:hello:clicked", { objId: state?.helloCount ?? null }, { sourceApp: "XXX" });
            state?.cmdUI?.update({ status: t("app.template.xxx.emitted", { event: "xxx:hello:clicked" }) });
          },
        },
      ],
    };
  },

  // La pulizia effettiva avviene su AbortSignal per-istanza (vedi renderBody).
  // destroy() è un fallback best-effort per il ciclo di vita del pannello.
  destroy() {},
};


// ------------------------------------------------------------
// 4) HELPERS
// ------------------------------------------------------------
function destroyBodyInstance(bodyEl) {
  if (!bodyEl) return;
  const state = bodyEl[STATE_KEY];
  if (!state) return;

  // Eventuali cleanup di risorse esterne del modulo (istanze di libreria,
  // ResizeObserver, timer, WebSocket, ...) vanno fatti qui.

  try { delete bodyEl[STATE_KEY]; } catch {}
}

function getObjectDisplayName(object) {
  if (!object) return t("app.template.object_default.@");
  return (
    object.obj_name ||
    object.obj_title ||
    object.name ||
    object.title ||
    (object.obj_id != null ? t("app.template.object_n.@", { id: object.obj_id }) : t("app.template.object_default.@"))
  );
}
