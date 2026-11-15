// TJS_sub_modules/TJS-audio.mjs
//
// Musica di sottofondo (nata in HySpace, ora generica): playlist di file (in ordine casuale o no) oppure
// una radio in streaming, con dissolvenze. Un'istanza per pannello.
// In HySpace la configurano i nodi HYS/Audio/* dei flow dell'oggetto (HYS-flow-nodes.mjs).
//
// Avvio automatico: i browser (anche il Quest) fanno partire l'audio solo dopo un
// gesto dell'utente. play() chiamato prima viene tenuto "in attesa" e ripreso da
// unlock(), che il modulo ospite chiama sui gesti (click di ingresso, "Entra in VR",…).
//
// Nessun Web Audio: un semplice <audio> funziona con qualunque radio (anche senza
// intestazioni CORS). L'audio spaziale, se servirà, userà un'altra via.
//
// Regole (2026-09-26, "più musiche insieme"):
//  - UN SOLO sottofondo per pagina: quando una musica parte davvero, le altre istanze
//    vive (altri pannelli HySpace/TJS) "cedono": si fermano con dissolvenza ma restano
//    configurate; NON ripartono coi gesti (niente ping-pong fra pannelli), ripartono
//    col comando esplicito (menu "Musica" → setEnabled(true), oppure play()).
//  - un'istanza distrutta (dispose) resta MUTA per sempre: ogni comando successivo è
//    ignorato. Prima un grafo che teneva ancora il vecchio riferimento (es. "Testa su
//    panel" dopo la ricarica del pannello) poteva farla ripartire: musica "fantasma"
//    che nessun menu controllava.

const LIVE = new Set();   // istanze vive nella pagina (per la regola del sottofondo unico)

export const TJS_AUDIO_DEFAULTS = {
  volume: 0.35,     // 0…1
  fadeIn: 3,        // s all'inizio di ogni brano / alla ripresa
  fadeOut: 3,       // s alla fine di ogni brano / alla pausa
  shuffle: true,
};

export function TJS_createAudio({ onChange = null } = {}) {
  const el = new Audio();
  el.preload = "auto";
  el.volume = 0;

  let mode = null;          // "playlist" | "stream" | null
  let list = [];            // URL della playlist
  let order = [];           // ordine di riproduzione (indici di list)
  let pos = -1;             // posizione in order
  let opts = { ...TJS_AUDIO_DEFAULTS };
  let wantPlaying = false;  // l'utente/il grafo vuole la musica
  let blocked = false;      // play() rifiutato: in attesa di un gesto
  let enabled = true;       // interruttore "Musica ON/OFF" del menu
  let fadeTimer = null;
  let endingFade = false;   // dissolvenza di fine brano già avviata
  let errorsInRow = 0;
  let disposed = false;
  let yielded = false;      // ha ceduto il posto alla musica di un altro pannello
  let self = null;          // l'oggetto restituito (per LIVE)

  const emit = () => onChange?.(status());

  // ── volume con rampa lineare ──────────────────────────────────────────────
  // basata sul tempo trascorso, non sul numero di passi: dura quanto richiesto anche
  // se il timer è impreciso (Windows) o rallentato (scheda in secondo piano)
  function ramp(target, seconds, done) {
    clearInterval(fadeTimer);
    const from = el.volume;
    if (!seconds) { el.volume = clamp01(target); done?.(); return; }
    const t0 = performance.now(), ms = seconds * 1000;
    fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = clamp01(from + (target - from) * k);
      if (k >= 1) { clearInterval(fadeTimer); fadeTimer = null; done?.(); }
    }, 1000 / 30);
  }

  // ── riproduzione ──────────────────────────────────────────────────────────
  function tryPlay() {
    if (disposed || !enabled || !wantPlaying || !el.src) return;
    const p = el.play();
    if (p?.then) {
      p.then(() => {
        if (disposed) { el.pause(); return; }
        blocked = false; errorsInRow = 0; ramp(opts.volume, opts.fadeIn);
        for (const other of LIVE) if (other !== self) other._yield();   // sottofondo unico
        emit();
      })
       .catch((e) => {
         if (e?.name === "NotAllowedError") { blocked = true; emit(); }   // serve un gesto
         else if (e?.name !== "AbortError") console.warn("[TJS audio] play:", e?.message ?? e);
       });
    }
  }

  function makeOrder() {
    order = list.map((_, i) => i);
    if (opts.shuffle) for (let i = order.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  function loadCurrent() {
    endingFade = false;
    el.volume = 0;
    if (mode === "stream") return;
    const url = list[order[pos]];
    el.src = url ?? "";
  }

  function advance() {
    if (mode !== "playlist" || !list.length) return;
    pos++;
    if (pos >= order.length) { makeOrder(); pos = 0; }  // fine giro: nuovo ordine
    loadCurrent();
    tryPlay();
    emit();
  }

  el.addEventListener("ended", () => { if (mode === "playlist") advance(); });
  el.addEventListener("error", () => {
    if (!el.src) return;
    console.warn("[TJS audio] file non riproducibile:", el.src);
    if (mode === "playlist" && ++errorsInRow < list.length) advance(); // salta il brano difettoso
  });
  // dissolvenza in uscita negli ultimi secondi del brano
  el.addEventListener("timeupdate", () => {
    if (mode !== "playlist" || endingFade || !isFinite(el.duration)) return;
    if (el.duration - el.currentTime <= opts.fadeOut) { endingFade = true; ramp(0, Math.max(0.1, el.duration - el.currentTime)); }
  });

  // ── API ───────────────────────────────────────────────────────────────────
  function setPlaylist(urls, o = {}) {
    if (disposed) return;
    stopNow();
    opts = { ...TJS_AUDIO_DEFAULTS, ...clean(o) };
    mode = "playlist";
    list = (urls ?? []).filter(Boolean);
    makeOrder();
    pos = -1;
    emit();
  }

  function setStream(url, o = {}) {
    if (disposed) return;
    stopNow();
    opts = { ...TJS_AUDIO_DEFAULTS, ...clean(o) };
    mode = "stream";
    list = [];
    el.src = url ?? "";
    emit();
  }

  function play() {
    if (disposed) return;
    yielded = false;
    wantPlaying = true;
    if (mode === "playlist" && pos < 0) { advance(); return; }
    tryPlay();
  }

  function pause() {
    wantPlaying = false;
    ramp(0, opts.fadeOut, () => { el.pause(); emit(); });
  }

  function toggle() { (wantPlaying && !el.paused) ? pause() : play(); }

  function next() {
    if (disposed || mode !== "playlist") return;
    ramp(0, Math.min(1, opts.fadeOut), () => advance());
  }

  function setVolume(v, seconds = 1) {
    opts.volume = clamp01(Number(v));
    if (!el.paused) ramp(opts.volume, seconds);
    emit();
  }

  /** Gesto dell'utente: riprende la riproduzione rimasta in attesa. */
  function unlock() { if (!yielded && (blocked || (wantPlaying && el.paused))) tryPlay(); }

  /** Un'altra musica è partita: si ferma con dissolvenza restando configurata. */
  function _yield() {
    if (disposed || yielded || el.paused) return;
    yielded = true;
    ramp(0, Math.min(1.5, opts.fadeOut), () => { el.pause(); emit(); });
  }

  /** Interruttore del menu: spegne/riaccende senza perdere la configurazione. */
  function setEnabled(on) {
    if (disposed) return;
    enabled = !!on;
    if (enabled) yielded = false;
    if (!enabled) ramp(0, 0.5, () => el.pause());
    else tryPlay();
    emit();
  }

  function stopNow() {
    clearInterval(fadeTimer);
    el.pause();
    el.removeAttribute("src");
    el.load();
  }

  function dispose() {
    disposed = true;
    wantPlaying = false;
    stopNow();
    onChange = null;
    LIVE.delete(self);
  }

  function status() {
    return {
      mode, playing: !el.paused, blocked, enabled, wantPlaying, yielded,
      track: mode === "playlist" ? list[order[pos]] ?? null : (mode === "stream" ? el.src : null),
      count: list.length, volume: opts.volume,
    };
  }

  self = {
    setPlaylist, setStream, play, pause, toggle, next, setVolume, unlock, setEnabled, dispose, status, _yield,
    get enabled() { return enabled; },
    /** acceso e non ceduto a un altro pannello: è quello che il menu "Musica" mostra */
    get on() { return enabled && !yielded; },
    get disposed() { return disposed; },
  };
  LIVE.add(self);
  return self;
}

function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }

function clean(o) {
  const out = {};
  for (const k of ["volume", "fadeIn", "fadeOut"]) if (Number.isFinite(Number(o[k]))) out[k] = Number(o[k]);
  if (typeof o.shuffle === "boolean") out.shuffle = o.shuffle;
  return out;
}
