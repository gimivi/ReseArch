// model_VID.mjs
// Video player — playlist da models[].mod_abs_url

import { t, te } from "./shared/i18n.mjs";

function getObjectDisplayName(object) {
  if (!object) return t("app.vid.object.@");
  return (
    object.obj_name ||
    object.obj_title ||
    object.name ||
    object.title ||
    t("app.vid.object_n.@", { id: object.obj_id ?? "" }).trim()
  );
}

export default {
  async renderBody({ bodyEl, object, models, cmdUI, signal }) {
  bodyEl.innerHTML = "";

  // 1) Playlist normalizzata
  const playlist = normalizeVideoPlaylist(models);

  // UI container
  const wrap = document.createElement("div");
  wrap.className = "vid-wrap";
  wrap.innerHTML = `
    <div class="vid-stage"></div>
  `;
  bodyEl.appendChild(wrap);

  const stage = wrap.querySelector(".vid-stage");

  if (playlist.length === 0) {
    stage.innerHTML = `<div class="text-muted p-2">${te("app.vid.no_videos")}</div>`;
    bodyEl.__VID = { playlist: [], index: -1, video: null };
    return;
  }

  // 2) Video element con CONTROLS di default
  const video = document.createElement("video");
  video.className = "vid-el";
  video.controls = true;      // <-- lasciamo i comandi di default
  video.playsInline = true;
  video.preload = "metadata";

  // autoplay “realistico”: parte muto (permesso), poi l’utente abilita audio dai controls
  video.autoplay = true;
  video.muted = true;

  // loop solo se singolo video, altrimenti loop di sequenza gestito da JS
  video.loop = (playlist.length === 1);

  stage.appendChild(video);

  // 3) Stato condiviso (serve anche alla toolbar per i dot)
  bodyEl.__VID = {
    playlist,
    index: 0,
    video,
  };

  // 4) Carica il primo video
  selectVideoByIndex(bodyEl, 0, { autoplay: true });

  // cleanup al cambio pannello
  signal?.addEventListener('abort', () => {
    try { video.pause(); } catch {}
    bodyEl.__VID = null;
  }, { once: true });

  // 5) Quando finisce: next, e a fine lista riparte da 0 (loop sequenza)
  video.addEventListener("ended", () => {
    const st = bodyEl.__VID;
    if (!st?.playlist?.length) return;

    if (st.playlist.length === 1) {
      // se singolo, ci pensa video.loop
      return;
    }

    const next = (st.index + 1) % st.playlist.length;
    selectVideoByIndex(bodyEl, next, { autoplay: true });
  });

  // CSS minimo (se vuoi puoi spostarlo nel CSS globale)
  const style = document.createElement("style");
  style.textContent = `
    .vid-wrap { height: 100%; width: 100%; display:flex; }
    .vid-stage { flex:1; background:#000; border-radius:12px; overflow:hidden; }
    .vid-el { width:100%; height:100%; object-fit:contain; background:#000; display:block; }
    /* dot in toolbar: ci basiamo sul CSS già esistente, ma teniamo un fallback minimo */
    .dot { cursor:pointer; }
    .dot.active { outline: 2px solid rgba(255,255,255,.35); }
  `;
  bodyEl.appendChild(style);
  },

  /**
   * Left menu:
   * title is forced by template, but we still return something sane.
   */
  getLeftMenu({ object }) {
    return {
      title: getObjectDisplayName(object),
      items: [],
    };
  },

  getRightMenu() {
    return { title: '☰', items: [] };
  },


  getToolbar({ bodyEl }) {
    return {
      items: [
        { type: "spacer", width: 8 },
        ...buildDotsToolbarItems(bodyEl),
      ],
    };
  },





  destroy() {},
};
// INIZIO FUNZIONI DI SUPPORTO AL FUNZIONAMENTO DELLA SPECIFICA APP -------------------
function normalizeVideoPlaylist(models) {
  const arr = Array.isArray(models) ? models : (models ? [models] : []);
  return arr
    .filter(m => typeof (m?.mod_abs_url) === "string" && m.mod_abs_url.trim().length > 0)
    .map(m => ({
      url: m.mod_abs_url,
      name: String(m?.mod_name ?? t("app.vid.video")).trim(),
      desc: String(m?.mod_description ?? "").trim(),
    }));
}

function getPanelRootFromBody(bodyEl) {
  let el = bodyEl;
  while (el && el !== document.body) {
    if (el.classList?.contains("panel")) return el;
    el = el.parentElement;
  }
  return null;
}

function updateDotsActive(bodyEl) {
  const st = bodyEl.__VID;
  const panel = getPanelRootFromBody(bodyEl);
  if (!st || !panel) return;

  panel.querySelectorAll("[data-vid-dot]").forEach(btn => {
    const i = parseInt(btn.getAttribute("data-vid-dot"), 10);
    btn.classList.toggle("active", i === st.index);
  });
}

function selectVideoByIndex(bodyEl, index, { autoplay = true } = {}) {
  const st = bodyEl.__VID;
  if (!st?.video || !st?.playlist?.length) return;

  const n = st.playlist.length;
  const i = ((index % n) + n) % n;
  st.index = i;

  const item = st.playlist[i];
  const v = st.video;

  // Stop current
  try { v.pause(); } catch {}

  // Switch source
  v.src = item.url;
  v.currentTime = 0;

  // prova autoplay (muted già true di default)
  if (autoplay) {
    v.play().catch(() => {});
  }

  updateDotsActive(bodyEl);
}

function buildDotsToolbarItems(bodyEl) {
  const st = bodyEl.__VID;
  const list = st?.playlist ?? [];
  if (!list.length) return [];

  return list.map((m, i) => {
    // tooltip: nome + (a capo) descrizione
    const tip = m.desc ? `${m.name}\n${m.desc}` : m.name;

    return {
      type: "button",
      className: "dot" + (i === st.index ? " active" : ""),
      title: tip,
      attrs: { "data-vid-dot": String(i), "aria-label": t("app.vid.play_n", { n: i + 1, name: m.name }) },
      onClick: () => selectVideoByIndex(bodyEl, i, { autoplay: true }),
    };
  });
}
