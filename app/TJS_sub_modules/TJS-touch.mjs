// TJS_sub_modules/TJS-touch.mjs
//
// Navigazione in prima persona da schermo touch (tablet, telefoni) per le app 3D della
// piattaforma. Come TJS-gamepad.mjs, legge solo gli ingressi: l'app decide cosa farne.
// Usa i Pointer Events e considera SOLO i puntatori "touch" (mouse e penna restano
// all'app come prima).
//
// Due modalità:
//   "stick" (predefinita) — metà sinistra: levetta virtuale che compare dove si appoggia
//                           il pollice (move.x/y −1…1, y positivo = indietro, come la
//                           levetta sinistra del gamepad); metà destra: trascina = guarda.
//   "tap"                 — tutto lo schermo: trascina = guarda (niente levetta); l'app
//                           usa i tocchi brevi per "vai lì".
// In entrambe: tocco breve (fermo, rapido) → onTap(ndcX, ndcY); tocco prolungato fermo
// → onLongPress(ndcX, ndcY); trascinamento per guardare → onLook(dx, dy) in pixel CSS.
// Il primo contatto chiama onStart() (gesto dell'utente: audio, video, ingresso).
//
// Il canvas riceve touch-action: none (niente scorrimento/zoom della pagina) e niente menu
// del tocco prolungato; preventDefault su pointerdown evita i finti eventi mouse del tocco.

export function TJS_createTouchInput(el, {
  mode = "stick",
  stickRadius = 60,        // px: escursione piena della levetta
  tapMaxMove = 12,         // px: oltre, non è più un tocco ma un trascinamento
  tapMaxMs = 350,          // ms: durata massima di un tocco breve
  longPressMs = 550,       // ms: tocco fermo più lungo = tocco prolungato
  onStart = null, onTap = null, onLongPress = null, onLook = null,
} = {}) {
  let currentMode = mode === "tap" ? "tap" : "stick";
  let started = false;
  const pointers = new Map();          // pointerId → { x0, y0, x, y, t0, role, moved, long, timer }
  let stickId = null, lookId = null;
  const move = { x: 0, y: 0 };

  // levetta disegnata (sopra il canvas, senza intercettare i tocchi)
  const host = el.parentElement ?? el;
  const base = document.createElement("div");
  const knob = document.createElement("div");
  base.style.cssText = `position:absolute;width:${stickRadius * 2}px;height:${stickRadius * 2}px;margin:-${stickRadius}px 0 0 -${stickRadius}px;` +
    "border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(20,22,30,.25);pointer-events:none;display:none;z-index:5;";
  knob.style.cssText = "position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;" +
    "background:rgba(159,215,255,.55);pointer-events:none;display:none;z-index:6;";
  host.appendChild(base);
  host.appendChild(knob);

  const prevTouchAction = el.style.touchAction;
  el.style.touchAction = "none";
  el.style.webkitTouchCallout = "none";
  el.style.userSelect = "none";

  const rect = () => el.getBoundingClientRect();
  const hostRect = () => host.getBoundingClientRect();
  const ndc = (x, y) => { const r = rect(); return [((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1]; };

  function showStick(p) {
    const hr = hostRect();
    base.style.left = `${p.x0 - hr.left}px`; base.style.top = `${p.y0 - hr.top}px`;
    knob.style.left = `${p.x - hr.left}px`;  knob.style.top = `${p.y - hr.top}px`;
    base.style.display = knob.style.display = "block";
  }
  function hideStick() { base.style.display = knob.style.display = "none"; }

  function onDown(e) {
    if (e.pointerType !== "touch") return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch {}
    if (!started) { started = true; onStart?.(); }
    const r = rect();
    const p = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(),
                role: null, moved: false, long: false, timer: 0 };
    if (currentMode === "stick" && stickId === null && e.clientX < r.left + r.width / 2) { p.role = "stick"; stickId = e.pointerId; }
    else if (lookId === null) { p.role = "look"; lookId = e.pointerId; }
    p.timer = setTimeout(() => {
      if (!p.moved && pointers.has(e.pointerId)) { p.long = true; onLongPress?.(...ndc(p.x, p.y)); }
    }, longPressMs);
    pointers.set(e.pointerId, p);
  }

  function onMoveEvt(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > tapMaxMove) { p.moved = true; clearTimeout(p.timer); }
    if (p.role === "stick") {
      let sx = (p.x - p.x0) / stickRadius, sy = (p.y - p.y0) / stickRadius;
      const m = Math.hypot(sx, sy);
      if (m > 1) { sx /= m; sy /= m; }
      move.x = sx; move.y = sy;
      if (p.moved) showStick({ x0: p.x0, y0: p.y0, x: p.x0 + sx * stickRadius, y: p.y0 + sy * stickRadius });
    } else if (p.role === "look" && p.moved) {
      onLook?.(dx, dy);
    }
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    clearTimeout(p.timer);
    pointers.delete(e.pointerId);
    if (e.pointerId === stickId) { stickId = null; move.x = move.y = 0; hideStick(); }
    if (e.pointerId === lookId) lookId = null;
    const quick = performance.now() - p.t0 <= tapMaxMs;
    if (e.type === "pointerup" && !p.moved && !p.long && quick) onTap?.(...ndc(p.x, p.y));
  }

  const noMenu = (e) => { if (pointers.size) e.preventDefault(); };
  el.addEventListener("pointerdown", onDown, { passive: false });
  el.addEventListener("pointermove", onMoveEvt, { passive: false });
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("contextmenu", noMenu);

  function setMode(m) {
    currentMode = m === "tap" ? "tap" : "stick";
    if (currentMode === "tap" && stickId !== null) { pointers.delete(stickId); stickId = null; move.x = move.y = 0; hideStick(); }
  }

  function dispose() {
    for (const p of pointers.values()) clearTimeout(p.timer);
    pointers.clear();
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMoveEvt);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("contextmenu", noMenu);
    el.style.touchAction = prevTouchAction;
    base.remove();
    knob.remove();
  }

  return {
    get move() { return move; },
    get stickActive() { return stickId !== null; },
    get started() { return started; },
    get mode() { return currentMode; },
    setMode,
    dispose,
  };
}
