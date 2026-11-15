// TJS_sub_modules/TJS-gamepad.mjs
//
// Lettura di un gamepad (Gamepad API, mappatura "standard" dei controller Xbox /
// PlayStation / generici) per le app 3D della piattaforma. Nessuna dipendenza da
// three.js né da un modulo specifico: restituisce assi e pulsanti, l'app decide
// cosa farne. Da interrogare a ogni frame con poll().
//
// Mappatura standard (https://w3c.github.io/gamepad/#remapping):
//   assi    0/1 levetta sinistra (x, y)   2/3 levetta destra (x, y)   y positivo = giù
//   tasti   0 A/✕  1 B/◯  2 X/▢  3 Y/△  4 LB  5 RB  6 LT  7 RT  8 Back/Select  9 Start
//           10 L3  11 R3  12 ↑  13 ↓  14 ←  15 →
//
// Il gamepad convive con mouse e tastiera: sono ingressi indipendenti, l'app può
// sommarli (es. WASD + levetta) o dare la precedenza all'ultimo usato (lastActive).

export const TJS_PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

/**
 * @param {{ deadzone?: number, onConnect?: Function, onDisconnect?: Function }} [opts]
 * @returns {{ poll(): object, dispose(): void }}
 *   poll() → {
 *     connected, id,
 *     move: { x, y },  look: { x, y },     // levette, zona morta applicata, −1…1
 *     pressed: Set<number>,                // tasti premuti in questo frame (fronte di salita)
 *     held: Set<number>,                   // tasti tenuti premuti
 *     active: boolean,                     // qualche ingresso in questo frame
 *     lastActive: number,                  // performance.now() dell'ultimo ingresso
 *   }
 */
export function TJS_createGamepadInput({ deadzone = 0.15, onConnect = null, onDisconnect = null } = {}) {
  let index = null;       // gamepad in uso
  let prev = new Set();   // tasti premuti al frame precedente
  let lastActive = 0;

  const onConn = (e) => { if (index === null) index = e.gamepad.index; onConnect?.(e.gamepad); };
  const onDisc = (e) => { if (e.gamepad.index === index) { index = null; prev = new Set(); } onDisconnect?.(e.gamepad); };
  window.addEventListener("gamepadconnected", onConn);
  window.addEventListener("gamepaddisconnected", onDisc);

  // zona morta radiale, poi riscalata: niente deriva a levetta ferma, 0→1 continuo
  function stick(x, y) {
    const m = Math.hypot(x, y);
    if (m < deadzone) return { x: 0, y: 0 };
    const k = Math.min(1, (m - deadzone) / (1 - deadzone)) / m;
    return { x: x * k, y: y * k };
  }

  const EMPTY = { connected: false, id: "", move: { x: 0, y: 0 }, look: { x: 0, y: 0 },
                  pressed: new Set(), held: new Set(), active: false, lastActive: 0 };

  function poll() {
    const pads = navigator.getGamepads?.() ?? [];
    let gp = index !== null ? pads[index] : null;
    if (!gp) {                               // alcuni browser non emettono "connected" finché non si preme un tasto
      gp = [...pads].find((p) => p && p.connected) ?? null;
      index = gp ? gp.index : null;
    }
    if (!gp) return { ...EMPTY, lastActive };

    const a = gp.axes;
    const move = stick(a[0] ?? 0, a[1] ?? 0);
    const look = stick(a[2] ?? 0, a[3] ?? 0);

    const held = new Set();
    gp.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) held.add(i); });
    const pressed = new Set([...held].filter((i) => !prev.has(i)));
    prev = held;

    const active = pressed.size > 0 || held.size > 0 || move.x || move.y || look.x || look.y;
    if (active) lastActive = performance.now();

    return { connected: true, id: gp.id, move, look, pressed, held, active: !!active, lastActive };
  }

  function dispose() {
    window.removeEventListener("gamepadconnected", onConn);
    window.removeEventListener("gamepaddisconnected", onDisc);
  }

  return { poll, dispose };
}
