/**
 * app/template_XXX.mjs
 * Viewer template (baseline ReseArch v1.0) + specialization loader
 *
 * Contract:
 *   export async function render(container, object, models)
 *
 * container: expected to be the panel (root of window), containing:
 *   - .panel-header (dropdown left/right + toolbar)
 *   - .panel-body   (rendering area)
 *   - .panel-footer (command UI: status/hints/controls)
 *
 * object: record of selected research object, incl. obj_app and metadata
 * models: records from DB table `models`, enriched with mod_abs_url
 */

/** @type {WeakMap<HTMLElement, { destroy: () => void }>} */
import { t } from "./shared/i18n.mjs";
import { objectLevel } from "./shared/ui_level.mjs";
import { registerPanelHost, flowMenuItems } from "./shared/panel-flow.mjs";

const PANEL_STATE = new WeakMap();

/**
 * ======================================================
 * 1) SPECIALIZATION REGISTRY & LOADING
 * ======================================================
 * Each object.obj_app maps to a dynamic import loader.
 * A specialization module must export a plugin object with:
 *  - renderBody(ctx) [required]
 *  - getLeftMenu(ctx), getRightMenu(ctx), getToolbar(ctx) [optional]
 *  - destroy() [optional]
 *
 * Livelli di interazione (_doc/arch-i18n-a11y.md §5, _doc/arch-permessi.md §11.4): ctx.level è
 * il livello dell'utente PER QUESTO PANNELLO (10 osservatore · 20 utente · 25 ricercatore su
 * elementi non propri · 30 chi può modificare l'oggetto · 40 responsabile · 50 amministratore):
 * object.ui_level dal server, altrimenti il livello di base della pagina. Scritto anche in
 * data-ra-level sul pannello, per i sottomoduli (panelLevel() di app/shared/ui_level.mjs).
 * Una voce di menu o di toolbar con `minLevel: N` compare solo se ctx.level >= N; senza
 * minLevel è visibile a tutti. Il filtro è fatto qui, in un punto solo: i moduli segnano e basta.
 */
const SPEC_REGISTRY = {
  CSV: () => import("./model_CSV.mjs"), // Database file testo CSV
  DBJ: () => import("./model_DBJ.mjs"), // Database Json
  ECH: () => import("./model_ECH.mjs"), // Grafici Echart
  HTM: () => import("./model_HTM.mjs"), // Pagine Html
  HYS: () => import("./model_HYS.mjs"), // Virtual Museum HySapce
  IFC: () => import("./model_IFC.mjs"), // IFC Models
  FLE: () => import("./model_FLE.mjs"), // Flow Editor LiteGraph — sigla interna dell'editor dei flow, NON un'APP degli oggetti (aperto con oggetto sintetico, vedi ui/modal_flow_embedded.js)
  MPS: () => import("./model_MPS.mjs"), // Google Maps
  GSH: () => import("./model_GSH.mjs"), // Google Sheets viewer
  JSX: () => import("./model_JSX.mjs"), // JSXGraph (grafici geometrici/matematici interattivi)
  MYS: () => import("./model_MYS.mjs"), // Database MySql
  OLY: () => import("./model_OLY.mjs"), // Cartografia OpenLayers — _doc/module-oly-openlayers.md
  OSD: () => import("./model_OSD.mjs"), // OpensSeaDragon
  OWL: () => import("./model_OWL.mjs"), // OWL Web Ontology Language (Cytoscape.js)
  PDF: () => import("./model_PDF.mjs"), // FDocumenti PDF
  PJS: () => import("./model_PJS.mjs"), // Paper Js
  PSG: () => import("./model_PSG.mjs"), // Panorami Sferici Gigapixel
  TJS: () => import("./model_TJS.mjs"), // Three.Js
  TML: () => import("./model_TML.mjs"), // Timeline (vis-timeline) — _doc/module-tml-timeline.md
  VID: () => import("./model_VID.mjs"), // Video Mp4
  default: () => import("./spec_default.mjs"),
};

/**
 * Load specialization module based on object.obj_app (or fallback).
 * Expected export: default = plugin object
 */
async function loadSpec(object) {
  const app = object?.obj_app || object?.app || "default";
  const loader = SPEC_REGISTRY[app] ?? SPEC_REGISTRY.default;
  const mod = await loader();

  // Prefer default export, fallback to module namespace
  const spec = mod?.default ?? mod;

  // Minimal validation + safe defaults
  if (!spec || typeof spec !== "object") {
    throw new Error(
      `[model_XXX] Specialization for app="${app}" is invalid (not an object).`
    );
  }
  if (typeof spec.renderBody !== "function") {
    throw new Error(
      `[model_XXX] Specialization for app="${app}" must export renderBody(ctx).`
    );
  }

  return spec;
}

/**
 * ======================================================
 * 2) PUBLIC ENTRY POINT (LIFECYCLE ORCHESTRATION)
 * ======================================================
 * Responsibilities:
 *  - cleanup previous viewer on the same panel (idempotent)
 *  - resolve panel parts
 *  - load specialization (plugin)
 *  - build header models (left/right/toolbar) and apply them to DOM
 *  - call spec.renderBody() passing a stable context + cmdUI + abort signal
 *  - register destroy() for panel reuse
 */
export async function render(container, object, models) {
  
  // Controlla e perfeziona da qui ...
  const panel = /** @type {HTMLElement} */ (container);
  if (!panel || !(panel instanceof HTMLElement)) {
    throw new Error("[model_XXX] render(): container/panel is not a valid HTMLElement");
  }

  // 1) Cleanup any previous viewer mounted on this panel
  const prev = PANEL_STATE.get(panel);
  if (prev) {
    try { prev.destroy(); } catch { /* noop */ }
    PANEL_STATE.delete(panel);
  }
  // ... fino a qui. Credo che in questa forma siano quasi inutili, ma in assoluto potrebbero avere un senso

  
  // 2) Resolve panel structure
  const { headerEl, bodyEl, leftDropdownEl, rightDropdownEl, toolbarEl, footerEl } =
    resolvePanelParts(panel);

  // 3) Prepare footer command UI e lo associa all'_APP_STATE_
  const cmdUI = createCmdUI(footerEl);
  
  const STATE_KEY = "_APP_STATE_"
  bodyEl[STATE_KEY] = {cmdUI};

  // Pannello per i nodi ReseArch/Menu/* e ReseArch/Panel/* dei flow (app/shared/panel-flow.mjs):
  // i runner ci agganciano i grafi, i menu ne leggono le voci
  registerPanelHost(bodyEl, { cmdUI });


  // 4) Create abort controller early (specialization gets the signal)
  const abort = new AbortController();

  // 5) Load specialization based on object.obj_app - Qui stiamo caricando proprio il model_XXX.mjs
  const spec = await loadSpec(object);

  // 6) Context shared across menu builders + specialization
  const level = objectLevel(object);
  panel.dataset.raLevel = String(level);
  const ctx = { panel, headerEl, bodyEl, footerEl, object, models, level };

  // 7) Build header models (data-only) using specialization when available
  const leftMenu = buildHeaderMenuLeft(ctx, spec);
  const rightMenu = buildHeaderMenuRight(ctx, spec);
  const toolbar = buildHeaderToolbar(ctx, spec);

  // 8) Apply header models to DOM
  applyDropdown(leftDropdownEl, leftMenu);
  applyDropdown(rightDropdownEl, rightMenu);
  applyToolbar(toolbarEl, toolbar);

  // 8b) Menu ricostruiti a ogni apertura: le voci dei flow (caricati anche dopo renderBody,
  //     o modificati in "Testa su panel") e le etichette che cambiano sono sempre attuali
  rebuildOnOpen(leftDropdownEl,  () => buildHeaderMenuLeft(ctx, spec));
  rebuildOnOpen(rightDropdownEl, () => buildHeaderMenuRight(ctx, spec));

  // 9) Render body (viewer owns panel-body)
  bodyEl.innerHTML = "";
  await spec.renderBody({
    ...ctx,
    cmdUI,
    signal: abort.signal,
  });

  // Log apertura oggetto (fire-and-forget, non blocca il render)
  fetch("api/log_view.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      obj_id:   object?.obj_id  ?? null,
      obj_app:  object?.obj_app ?? "",
      obj_name: getObjectDisplayName(object),
    }),
    credentials: "same-origin",
  }).catch(() => {});

  // 9b) Rebuild menus after renderBody (titolo e voci che l'App definisce solo durante il render)
  const leftMenuFinal  = buildHeaderMenuLeft(ctx, spec);
  const rightMenuFinal = buildHeaderMenuRight(ctx, spec);
  applyDropdown(leftDropdownEl,  leftMenuFinal);
  applyDropdown(rightDropdownEl, rightMenuFinal);

  // 10) Register cleanup for future reuse of the same panel
  PANEL_STATE.set(panel, {
    destroy() {
      abort.abort();
      try { spec.destroy?.(); } catch { /* noop */ }
      bodyEl.innerHTML = "";
    },
  });

  // Store object metadata on the panel element for external access (e.g. Flow Editor scan)
  try {
    panel.dataset.currentObjectName = getObjectDisplayName(object);
    panel.dataset.currentApp        = object?.obj_app ?? '';
    if (panel._wmLeaf?.savedState) {
      panel._wmLeaf.savedState.objectId = object?.obj_id ?? null;
      // Modelli EFFETTIVAMENTE caricati in questo pannello — può essere un
      // sottoinsieme di tutti quelli collegati all'oggetto (modal_tree_obj.js
      // filtra via checkbox prima di chiamare render()). Salvato qui, unico
      // punto che già aggiorna savedState dopo ogni render, per poter
      // riprodurre la stessa selezione al ripristino di una configurazione
      // dashboard (dashboard_cfg.mjs) invece di ricaricare sempre tutto.
      panel._wmLeaf.savedState.selectedModelIds = Array.isArray(models)
        ? models.map(m => m.mod_id).filter(id => id != null)
        : null;
      // Flow embedded in editing (object.__embeddedTarget — obj_id è SEMPRE
      // null per costruzione, vedi modal_flow_embedded.js): descrittore
      // separato per poter ricostruire il pannello al ripristino di una
      // configurazione dashboard (dashboard_cfg.mjs). NON include bodyEl
      // (riferimento DOM live, non serializzabile — limite noto, vedi
      // _doc/arch-dashboard-windows.md §10: il contesto "Testa su panel"
      // andrà rifatto a mano dopo il ripristino). Se il flow non ha ancora
      // un flowId (appena creato, mai salvato) non c'è nulla da ricostruire.
      const et = object?.__embeddedTarget;
      // kind/dshpId (2026-10-04): 'dashboard' = flow dashboard della Config
      // dshpId (_doc/arch-flow-dashboard.md §3.4). model_FLE.mjs aggiorna poi
      // flowId a ogni cambio del flow aperto (_setEditingFlow).
      panel._wmLeaf.savedState.embeddedFlow = (et && et.flowId != null)
        ? { kind: et.kind === 'dashboard' ? 'dashboard' : 'object', objId: et.objId ?? null,
            dshpId: et.dshpId ?? null, app: et.app ?? null, name: et.name ?? null, flowId: et.flowId }
        : null;
    }
  } catch { /* noop */ }
}

/**
 * ======================================================
 * 3) PANEL STRUCTURE RESOLUTION
 * ======================================================
 * Centralizes DOM queries and validates expected markup once.
 */
function resolvePanelParts(panel) {
  const headerEl =
    panel.querySelector(".panel-header") ||
    panel.querySelector("[data-panel-header]");

  const bodyEl =
    panel.querySelector(".panel-body") ||
    panel.querySelector("[data-panel-body]");

  const footerEl =
    panel.querySelector(".panel-footer") ||
    panel.querySelector("[data-panel-footer]");

  if (!headerEl || !bodyEl || !footerEl) {
    throw new Error("[model_XXX] panel structure not found (.panel-header/.panel-body/.panel-footer)");
  }

  const leftDropdownEl =
    headerEl.querySelector("[data-menu='left']") ||
    headerEl.querySelector(".menu-left") ||
    headerEl.querySelector(".dropdown-left") ||
    headerEl.querySelector("select, .dropdown");

  const rightDropdownEl =
    headerEl.querySelector("[data-menu='right']") ||
    headerEl.querySelector(".menu-right") ||
    headerEl.querySelector(".dropdown-right") ||
    headerEl.querySelectorAll("select, .dropdown")[1];

  if (!leftDropdownEl || !rightDropdownEl) {
    throw new Error("[model_XXX] left/right dropdown elements not found in panel-header");
  }

  const toolbarEl = headerEl.querySelector(".panel-toolbar");
  if (!toolbarEl) {
    throw new Error("[model_XXX] toolbar element not found in panel-header (.panel-toolbar)");
  }

  return { headerEl, bodyEl, leftDropdownEl, rightDropdownEl, toolbarEl, footerEl };
}

/**
 * ======================================================
 * 4) HEADER MODEL BUILDERS (DATA ONLY)
 * ======================================================
 * Build menu/toolbar models. These functions must NOT touch the DOM.
 * They may call optional specialization hooks.
 */

/**
 * Toglie le voci con minLevel più alto del livello (anche nei sottomenu `items`) e i divisori
 * rimasti in testa, in coda o doppi.
 */
function filterByLevel(items, level) {
  const out = [];
  for (const it of items ?? []) {
    if (it && typeof it.minLevel === "number" && level < it.minLevel) continue;
    if (it && Array.isArray(it.items)) {
      const sub = filterByLevel(it.items, level);
      if (it.type === "dropdown" && !sub.length) continue;
      out.push({ ...it, items: sub });
      continue;
    }
    if (it?.type === "divider" && (!out.length || out[out.length - 1]?.type === "divider")) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1]?.type === "divider") out.pop();
  return out;
}

function buildMenuFromSpec(ctx, specFn, { title, defaultTitle }) {
  const override = typeof specFn === "function" ? specFn(ctx) : null;

  if (override && typeof override === "object") {
    return {
      title: title ?? (typeof override.title === "string" ? override.title : defaultTitle),
      items: filterByLevel(Array.isArray(override.items) ? override.items : [], ctx.level),
      header: override.header,
    };
  }

  return {
    title: title ?? defaultTitle,
    items: [],
  };
}

/**
 * Left header dropdown:
 * - title is always forced to object name
 */

function buildHeaderMenuLeft(ctx, spec) {
  const forcedTitle = getObjectDisplayName(ctx.object);
  const menu = buildMenuFromSpec(ctx, spec?.getLeftMenu, {
    title: forcedTitle,
  });
  // Dopo le voci dell'App: comandi dei nodi ReseArch/Menu/Command (menu "left"), poi gli stati
  // dei nodi ReseArch/Menu/Status — per tutte le App (app/shared/panel-flow.mjs)
  const flow = flowMenuItems(ctx.bodyEl);
  const items = [...menu.items];
  for (const group of [flow.left, flow.status]) {
    if (!group.length) continue;
    if (items.length) items.push({ type: "divider" });
    items.push(...group);
  }
  return { ...menu, items };
}

/**
 * Right header dropdown:
 * - default title "Opzioni"
 * - prima voce SEMPRE "Ricarica oggetto" (2026-09-22, richiesta esplicita:
 *   stessa voce in tutte le app, iniettata qui una sola volta invece che
 *   duplicata in ogni model_XXX.mjs) — rilegge object+models dal DB e
 *   ri-chiama render() sullo stesso pannello, rispettando la selezione di
 *   modelli scelta al primo inserimento (vedi reloadObjectPanel()).
 */
function buildHeaderMenuRight(ctx, spec) {
  const menu = buildMenuFromSpec(ctx, spec?.getRightMenu, {
    defaultTitle: t("app.template.menu.options"),
  });
  const reloadItem = {
    id: "reload-object",
    label: t("app.template.menu.reload_object.@"),
    onClick: () => { reloadObjectPanel(ctx.panel); },
  };
  // In coda i comandi dei nodi ReseArch/Menu/Command con menu "right" (app/shared/panel-flow.mjs)
  const flowRight = flowMenuItems(ctx.bodyEl).right;
  const items = [
    reloadItem,
    ...(menu.items.length ? [{ type: "divider" }, ...menu.items] : []),
    ...(flowRight.length ? [{ type: "divider" }, ...flowRight] : []),
  ];
  return { ...menu, items };
}

/**
 * Ricostruisce il dropdown a ogni apertura (show.bs.dropdown, prima che il menu compaia).
 * Un solo listener per dropdown: sostituito a ogni render del pannello.
 */
function rebuildOnOpen(dropdownRootEl, buildMenu) {
  if (dropdownRootEl._rebuildOnOpen) {
    dropdownRootEl.removeEventListener("show.bs.dropdown", dropdownRootEl._rebuildOnOpen);
  }
  const listener = (ev) => {
    // solo il toggle di questo menu, non eventuali dropdown annidati
    if (ev.target.closest("[data-menu]") !== dropdownRootEl) return;
    applyDropdown(dropdownRootEl, buildMenu());
  };
  dropdownRootEl._rebuildOnOpen = listener;
  dropdownRootEl.addEventListener("show.bs.dropdown", listener);
}

/**
 * "Ricarica oggetto" (menu destro, tutte le app) — rilegge object+models dal
 * DB e ri-chiama render() sullo stesso pannello. Rispetta la selezione di
 * modelli fatta al primo inserimento (panel._wmLeaf.savedState.selectedModelIds,
 * lo stesso campo che dashboard_cfg.mjs usa per il ripristino configurazioni,
 * scritto qui sotto in render() dopo ogni render riuscito) — assente/vuota =
 * comportamento di sempre, ricarica tutti i modelli collegati all'oggetto.
 * No-op (con warning) per pannelli senza un oggetto reale in DB (es. flow
 * embedded in editing, object.__embeddedTarget — objectId è sempre null).
 */
async function reloadObjectPanel(panel) {
  const leaf  = panel?._wmLeaf;
  const objId = leaf?.savedState?.objectId;
  if (objId == null) {
    console.warn("[template_XXX] Ricarica oggetto: nessun oggetto DB associato a questo pannello.");
    return;
  }
  const selectedModelIds = leaf?.savedState?.selectedModelIds ?? null;
  try {
    const res  = await fetch(`ui/modal_tree_obj_tools.php?action=models_by_obj&obj_id=${encodeURIComponent(objId)}`, { credentials: "same-origin" });
    const data = await res.json();
    if (!data.success || !data.data?.object) throw new Error(data.error || "Oggetto non trovato");
    const freshObject = data.data.object;
    const allModels   = data.data.models ?? [];
    const models = (Array.isArray(selectedModelIds) && selectedModelIds.length)
      ? allModels.filter(m => selectedModelIds.includes(m.mod_id))
      : allModels;
    await render(panel, freshObject, models);
  } catch (err) {
    console.warn("[template_XXX] Ricarica oggetto fallita:", err.message);
  }
}

/**
 * Toolbar:
 * - model is { items: [...] }
 */
function buildHeaderToolbar(ctx, spec) {
  const override = spec?.getToolbar?.(ctx);
  if (override && typeof override === "object") {
    return { items: filterByLevel(Array.isArray(override.items) ? override.items : [], ctx.level) };
  }
  return { items: [] };
}

/**
 * ======================================================
 * 5) HEADER DOM APPLIERS (DOM ONLY)
 * ======================================================
 * Apply menu/toolbar models to existing DOM roots.
 */

function applyDropdown(dropdownRootEl, menu) {
  const btn = dropdownRootEl.querySelector("button.dropdown-toggle");
  const ul = dropdownRootEl.querySelector("ul.dropdown-menu");

  if (!btn || !ul) {
    throw new Error("[model_XXX] applyDropdown: struttura dropdown Bootstrap non trovata.");
  }

  // Rimuovi eventuale listener dinamico precedente (evita duplicati al rebuild)
  if (dropdownRootEl._dynamicRefreshListener) {
    dropdownRootEl.removeEventListener('show.bs.dropdown', dropdownRootEl._dynamicRefreshListener);
    dropdownRootEl._dynamicRefreshListener = null;
  }

  // Il pulsante del WM ha icona ☰ + .wm-title (sinistra) o solo icona (destra): il titolo
  // non deve cancellare l'icona, altrimenti l'header compatto non ha più nulla da ridurre
  const title = menu.title ?? "";
  const titleEl = btn.querySelector(".wm-title");
  if (titleEl) {
    titleEl.textContent = title;
  } else if (btn.querySelector("i")) {
    btn.title = title;
    btn.setAttribute("aria-label", title);
  } else {
    btn.textContent = title;
  }
  btn.dataset.panelLabel = title;

  ul.innerHTML = "";

  if (menu.header) {
    const liH = document.createElement("li");
    const h6 = document.createElement("h6");
    h6.className = "dropdown-header";
    h6.textContent = menu.header;
    liH.appendChild(h6);
    ul.appendChild(liH);
  }

  if (menu.header && (menu.items?.length ?? 0) > 0) {
    const liDiv = document.createElement("li");
    const hr = document.createElement("hr");
    hr.className = "dropdown-divider";
    liDiv.appendChild(hr);
    ul.appendChild(liDiv);
  }

  // Tiene traccia delle voci con getValue per il refresh lazy all'apertura
  const dynamicItems = [];

  for (const item of menu.items ?? []) {
    if (item.type === "divider") {
      const li = document.createElement("li");
      const hr = document.createElement("hr");
      hr.className = "dropdown-divider";
      li.appendChild(hr);
      ul.appendChild(li);
      continue;
    }

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "dropdown-item";
    a.href = "#";
    a.textContent = item.label ?? item.id ?? "";

    if (item.disabled) {
      a.classList.add("disabled");
      a.setAttribute("aria-disabled", "true");
      a.tabIndex = -1;
    }

    if (item.active) a.classList.add("active");

    // Se l'item ha getValue, registra per il refresh lazy all'apertura; valore anche subito,
    // perché con rebuildOnOpen il menu nasce dentro show.bs.dropdown (il listener qui sotto
    // scatterebbe solo all'apertura successiva)
    if (typeof item.getValue === "function") {
      dynamicItems.push({ el: a, item });
      const val = item.getValue();
      if (val != null) a.textContent = `${item.label}: ${val}`;
    }

    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (item.disabled) return;
      if (typeof item.onClick === "function") item.onClick();
    });

    li.appendChild(a);
    ul.appendChild(li);
  }

  // Aggancia listener Bootstrap per aggiornare i valori status all'apertura
  if (dynamicItems.length > 0) {
    const listener = () => {
      for (const { el, item } of dynamicItems) {
        const val = item.getValue();
        el.textContent = val != null
          ? `${item.label}: ${val}`
          : item.label;
      }
    };
    dropdownRootEl._dynamicRefreshListener = listener;
    dropdownRootEl.addEventListener('show.bs.dropdown', listener);
  }

  if (!(menu.items?.length)) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "dropdown-item-text text-muted";
    span.textContent = t("app.template.menu.no_actions");
    li.appendChild(span);
    ul.appendChild(li);
  }
}

/**
 * Toolbar model:
 *   { items: Array<
 *        | { type:"button", id?, label?, iconHtml?, iconClass?, title?, disabled?, className?, attrs?, onClick? }
 *        | { type:"spacer", width?: number }
 *        | { type:"divider" }
 *        | { type:"dropdown", id?, label?, iconHtml?, iconClass?, title?, disabled?, className?, attrs?, items:[...] }
 *     > }
 */
function applyToolbar(toolbarEl, toolbar) {
  if (!toolbarEl) return;

  toolbarEl.innerHTML = "";
  toolbarEl.classList.add("d-flex", "align-items-center", "gap-1");

  const items = toolbar?.items ?? [];
  if (!items.length) return;

  for (const it of items) {
    if (!it) continue;

    if (it.type === "spacer") {
      const s = document.createElement("span");
      s.className = "toolbar-spacer";
      s.style.display = "inline-block";
      s.style.width = `${Number.isFinite(it.width) ? it.width : 8}px`;
      toolbarEl.appendChild(s);
      continue;
    }

    if (it.type === "divider") {
      const d = document.createElement("span");
      d.className = "toolbar-divider";
      d.style.display = "inline-block";
      d.style.width = "1px";
      d.style.height = "1.25rem";
      d.style.opacity = "0.4";
      d.style.background = "currentColor";
      toolbarEl.appendChild(d);
      continue;
    }

    if (it.type === "dropdown") {
      const dd = document.createElement("div");
      dd.className = "dropdown";

      const btn = document.createElement("button");
      applyToolbarItemAttrs(btn, it);

      btn.type = "button";
      btn.className = `btn btn-sm btn-link dropdown-toggle ${it.className ?? ""}`.trim();
      btn.setAttribute("data-bs-toggle", "dropdown");
      btn.setAttribute("aria-expanded", "false");
      if (it.title) btn.title = it.title;
      if (it.title && !it.label && !btn.hasAttribute("aria-label")) btn.setAttribute("aria-label", it.title);
      if (it.disabled) {
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
      }

      btn.appendChild(renderToolbarButtonContent(it));

      const ul = document.createElement("ul");
      ul.className = "dropdown-menu";

      for (const sub of it.items ?? []) {
        if (sub?.type === "divider") {
          const li = document.createElement("li");
          const hr = document.createElement("hr");
          hr.className = "dropdown-divider";
          li.appendChild(hr);
          ul.appendChild(li);
          continue;
        }

        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "dropdown-item d-flex align-items-center gap-2";
        a.href = "#";
        if (sub?.title) a.title = sub.title;

        if (sub?.iconHtml) {
          const span = document.createElement("span");
          span.innerHTML = sub.iconHtml;
          a.appendChild(span);
        } else if (sub?.iconClass) {
          const i = document.createElement("i");
          i.className = sub.iconClass;
          i.setAttribute("aria-hidden", "true");
          a.appendChild(i);
        }
        if (sub?.label) a.appendChild(document.createTextNode(sub.label));

        if (sub?.disabled) {
          a.classList.add("disabled");
          a.setAttribute("aria-disabled", "true");
          a.tabIndex = -1;
        }

        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          if (sub?.disabled) return;
          if (typeof sub?.onClick === "function") sub.onClick();
        });

        li.appendChild(a);
        ul.appendChild(li);
      }

      dd.appendChild(btn);
      dd.appendChild(ul);
      toolbarEl.appendChild(dd);
      continue;
    }

    // default: button
    const btn = document.createElement("button");
    applyToolbarItemAttrs(btn, it);

    btn.type = "button";
    btn.className = `btn btn-sm btn-link ${it.className ?? ""}`.trim();
    if (it.title) btn.title = it.title;
    // Pulsante a sola icona: il titolo fa anche da nome accessibile
    if (it.title && !it.label && !btn.hasAttribute("aria-label")) btn.setAttribute("aria-label", it.title);
    if (it.disabled) btn.disabled = true;

    btn.appendChild(renderToolbarButtonContent(it));

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (it.disabled) return;
      if (typeof it.onClick === "function") it.onClick();
    });

    toolbarEl.appendChild(btn);
  }
}

function renderToolbarButtonContent(it) {
  const wrap = document.createElement("span");
  wrap.className = "d-inline-flex align-items-center gap-1";

  if (it.iconHtml) {
    const span = document.createElement("span");
    span.innerHTML = it.iconHtml; // trusted source only
    wrap.appendChild(span);
  } else if (it.iconClass) {
    const i = document.createElement("i");
    i.className = it.iconClass;
    i.setAttribute("aria-hidden", "true");
    wrap.appendChild(i);
  }

  if (it.label) {
    const lbl = document.createElement("span");
    lbl.textContent = it.label;
    wrap.appendChild(lbl);
  }

  return wrap;
}

function applyToolbarItemAttrs(el, it) {
  if (!el || !it) return;

  if (it.id) el.id = String(it.id);

  const attrs = it.attrs && typeof it.attrs === "object" ? it.attrs : null;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      el.setAttribute(k, String(v));
    }
  }
}

/**
 * ======================================================
 * 6) FOOTER CMD UI
 * ======================================================
 * A small UI adapter for the panel footer that allows specializations
 * to show status/hints/controls without directly manipulating markup.
 */

function createCmdUI(footerEl) {
  if (!footerEl) throw new Error("[cmdUI] footerEl missing");

  const statusEl = footerEl.querySelector(".pf-status");
  const hintsEl  = footerEl.querySelector(".pf-hints");
  const ctrlsEl  = footerEl.querySelector(".pf-controls");

  if (!statusEl || !hintsEl || !ctrlsEl) {
    throw new Error("[cmdUI] footer markup missing (.pf-status/.pf-hints/.pf-controls)");
  }

  // Messaggi di stato annunciati dagli screen reader (_doc/arch-i18n-a11y.md §6.3)
  if (!statusEl.hasAttribute("role")) statusEl.setAttribute("role", "status");
  if (!statusEl.hasAttribute("aria-live")) statusEl.setAttribute("aria-live", "polite");

  // IMPORTANT: footer must receive click events
  footerEl.style.pointerEvents = "auto";
  footerEl.style.zIndex = footerEl.style.zIndex || "20";

  // Visibilità: due modalità (vedi _doc/footer-cmdui-pattern.md)
  // - keepAlive=true  → footer persistente fino a endCommand()
  // - keepAlive=false → auto-hide dopo AUTO_HIDE_MS di inattività
  const AUTO_HIDE_MS = 15000;
  let _keepAlive = false;
  let _autoHideTimer = null;

  function _clearTimer() {
    if (_autoHideTimer !== null) { clearTimeout(_autoHideTimer); _autoHideTimer = null; }
  }

  function _scheduleHide() {
    _clearTimer();
    _autoHideTimer = setTimeout(() => { _autoHideTimer = null; api.hide(); }, AUTO_HIDE_MS);
  }

  const api = {
    show({ status = "", hints = "", controls = null, keepAlive = false } = {}) {
      _clearTimer();
      _keepAlive = !!keepAlive;

      footerEl.classList.add("is-visible");
      footerEl.setAttribute("aria-hidden", "false");

      setContent(statusEl, status, { mode: "html", clearOnNull: false });
      setContent(hintsEl, hints, { mode: "text", clearOnNull: false });

      if (controls !== null) {
        setContent(ctrlsEl, controls, { mode: "nodes", clearOnNull: true });
      }

      if (!_keepAlive) _scheduleHide();
    },

    update({ status, hints, controls } = {}) {
      setContent(statusEl, status, { mode: "html", clearOnNull: false });
      setContent(hintsEl, hints, { mode: "text", clearOnNull: false });

      if (controls === undefined) return; // do not touch
      // con keepAlive: stringa vuota non cancella i controls (protezione durante comando attivo)
      if (_keepAlive && controls === "") return;
      if (controls === null) {
        ctrlsEl.innerHTML = "";
        return;
      }
      setContent(ctrlsEl, controls, { mode: "nodes", clearOnNull: true });

      // reset timer sui messaggi non-persistenti (allunga finestra visibilità)
      if (!_keepAlive) _scheduleHide();
    },

    // Messaggio dai flow (nodi ReseArch/Panel/Status e /Hints): scrive come testo semplice e
    // APRE il footer se è chiuso. Non tocca i controlli e non toglie keepAlive: un comando
    // dell'App in corso resta tale. L'evento fa ricomparire anche l'intestazione
    // (ui/dashboard_windows.mjs), senza la quale il footer resta trasparente.
    // hold (2026-10-14): il footer resta aperto finché il flow non chiama endCommand()
    // (ingresso release dei nodi Panel), poi si chiude dopo AUTO_HIDE_MS.
    notify({ status, hints, hold = false } = {}) {
      setContent(statusEl, status, { mode: "text", clearOnNull: false });
      setContent(hintsEl, hints, { mode: "text", clearOnNull: false });
      footerEl.classList.add("is-visible");
      footerEl.setAttribute("aria-hidden", "false");
      footerEl.dispatchEvent(new CustomEvent("cmdui:notify"));
      if (hold) { _keepAlive = true; _clearTimer(); }
      else if (!_keepAlive) _scheduleHide();
    },

    // Chiama quando il comando attivo termina: rilascia keepAlive e avvia auto-hide.
    endCommand() {
      _keepAlive = false;
      _scheduleHide();
    },

    hide({ clear = true } = {}) {
      _clearTimer();
      _keepAlive = false;
      footerEl.classList.remove("is-visible");
      footerEl.setAttribute("aria-hidden", "true");
      if (clear) {
        statusEl.innerHTML = "";
        hintsEl.textContent = "";
        ctrlsEl.innerHTML = "";
      }
    },

    el() { return footerEl; }
  };

  // Expose the central HTML-escaping policy to specializations/tools.
  api.escapeHtml = escapeHtml;

  return api;
}

/**
 * ======================================================
 * 7) FOOTER CMD UTILITIES 
 * ======================================================
 */

//Anche questa qui sotto restituisce troppe protezioni..or or or or ..io ridurrei
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

/**
 * setContent(hostEl, value, options)
 * - mode: "html"  => string is assigned to innerHTML
 * - mode: "text"  => string is assigned to textContent
 * - mode: "nodes" => accepts string (as HTML), Node, Array<Node>
 *
 * Notes:
 * - value === undefined => do nothing (preserve current content)
 * - value === null      => clear if clearOnNull = true
 */
function setContent(hostEl, value, { mode = "nodes", clearOnNull = true } = {}) {
  if (!hostEl) return;
  if (value === undefined) return;

  if (value === null) {
    if (clearOnNull) hostEl.innerHTML = "";
    return;
  }

  if (typeof value === "string") {
    if (mode === "text") hostEl.textContent = value;
    else hostEl.innerHTML = value; // html OR nodes accept HTML strings
    return;
  }

  if (value instanceof Node) {
    hostEl.innerHTML = "";
    hostEl.appendChild(value);
    return;
  }

  if (Array.isArray(value)) {
    hostEl.innerHTML = "";
    for (const n of value) if (n instanceof Node) hostEl.appendChild(n);
    return;
  }

  // fallback: clear to avoid stale content
  hostEl.innerHTML = "";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

