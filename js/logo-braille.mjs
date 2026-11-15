// js/logo-braille.mjs — "lettura" del braille nel logo sui dispositivi a tocco.
//
// Toccando la fascia braille del logo compare una lente: la sola fascia, ingrandita 3×, con il punto toccato
// fermo sotto il dito; muovendo il dito sui puntini ingranditi il telefono dà un breve impulso ogni volta che
// il dito entra su un puntino (Vibration API: Android con Chrome, Firefox, Samsung Internet; non iPhone/iPad,
// dove Safari non la offre: lì resta la lente, utile alla lettura visiva). Staccando il dito la lente sparisce.
//
// Uso: <img src="img/Logo_Research.svg" data-braille-haptics> + <script type="module" src="js/logo-braille.mjs">.
// I puntini si leggono dal file SVG stesso: i <circle> dentro un gruppo con aria-label che contiene "braille"
// (anche se il logo cambia, non c'è nulla da ricopiare qui). Si considerano le traslazioni dei gruppi.
// Note:
//  - il browser concede la vibrazione solo dopo il primo tocco sulla pagina (attivazione dell'utente):
//    il primissimo passaggio del dito può restare muto;
//  - sul logo il trascinamento non fa scorrere la pagina (touch-action: none), altrimenti il gesto si perde.

const ZOOM = 3;        // ingrandimento della lente
const PULSE_MS = 50;   // durata dell'impulso (scelta provata su Android; sotto i 30 ms molti motori non partono). Serve il feedback tattile attivo nel telefono
const HIT = 15;        // raggio di presa attorno al puntino, in unità dell'SVG (i puntini distano 34)
const canVibrate = typeof navigator.vibrate === 'function';

async function readDots(url) {
  const txt = await (await fetch(url)).text();
  const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
  const svg = doc.documentElement;
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const box = vb.length === 4 ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
    : { x: 0, y: 0, w: +svg.getAttribute('width') || 1, h: +svg.getAttribute('height') || 1 };
  const dots = [];
  for (const g of doc.querySelectorAll('g[aria-label*="braille" i]')) {
    for (const c of g.querySelectorAll('circle')) {
      let x = +c.getAttribute('cx'), y = +c.getAttribute('cy');
      for (let el = c.parentElement; el && el !== svg.parentElement; el = el.parentElement) {
        const m = /translate\(\s*([-\d.]+)[\s,]*([-\d.]+)?\s*\)/.exec(el.getAttribute?.('transform') || '');
        if (m) { x += +m[1]; y += +(m[2] || 0); }
      }
      dots.push({ x, y, r: +c.getAttribute('r') || 10 });
    }
  }
  return { box, dots };
}

async function attach(img) {
  const { box, dots } = await readDots(img.currentSrc || img.src);
  if (!dots.length) return;
  img.style.touchAction = 'none';

  // fascia braille in coordinate SVG, con un margine di un passo fra i puntini
  const pad = 34;
  const band = {
    y0: Math.min(...dots.map(d => d.y - d.r)) - pad,
    y1: Math.max(...dots.map(d => d.y + d.r)) + pad,
  };

  // da coordinate dello schermo a coordinate dell'SVG (preserveAspectRatio predefinito: adatta e centra)
  const layout = () => {
    const r = img.getBoundingClientRect();
    const s = Math.min(r.width / box.w, r.height / box.h);
    return { r, s, ox: r.left + (r.width - box.w * s) / 2, oy: r.top + (r.height - box.h * s) / 2 };
  };
  const toSvg = (cx, cy, L) => ({ x: box.x + (cx - L.ox) / L.s, y: box.y + (cy - L.oy) / L.s });

  let lens = null;   // { el, ox, oy } — ox, oy: punto fermo dell'ingrandimento (coordinate dello schermo)
  const inside = new Map();

  function openLens(e, L) {
    const top = L.oy + (band.y0 - box.y) * L.s, h = (band.y1 - band.y0) * L.s;
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `position:fixed;left:${L.r.left}px;top:${top}px;width:${L.r.width}px;height:${h}px;`
      + 'overflow:hidden;background:#fff;border-radius:4px;box-shadow:0 1px 6px rgba(0,0,0,.35);'
      + `pointer-events:none;z-index:1000;transform:scale(${ZOOM});`
      + `transform-origin:${e.clientX - L.r.left}px ${e.clientY - top}px;`;
    const pic = img.cloneNode(false);
    pic.removeAttribute('data-braille-haptics'); pic.removeAttribute('id'); pic.alt = '';
    pic.style.cssText = `position:absolute;left:0;top:${L.r.top - top}px;width:${L.r.width}px;height:${L.r.height}px;touch-action:none;`;
    el.appendChild(pic);
    document.body.appendChild(el);
    lens = { el, ox: e.clientX, oy: e.clientY };
  }
  function closeLens() { lens?.el.remove(); lens = null; }

  const onMove = e => {
    if (e.pointerType === 'mouse') return;
    const L = layout();
    // con la lente aperta: il punto sotto il dito si riporta sul logo togliendo l'ingrandimento attorno al punto fermo
    const cx = lens ? lens.ox + (e.clientX - lens.ox) / ZOOM : e.clientX;
    const cy = lens ? lens.oy + (e.clientY - lens.oy) / ZOOM : e.clientY;
    const p = toSvg(cx, cy, L);
    let hit = -1;
    for (let i = 0; i < dots.length; i++) {
      if ((dots[i].x - p.x) ** 2 + (dots[i].y - p.y) ** 2 <= HIT * HIT) { hit = i; break; }
    }
    if (canVibrate && hit !== -1 && hit !== inside.get(e.pointerId)) navigator.vibrate(PULSE_MS);
    inside.set(e.pointerId, hit);
  };
  img.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const L = layout(), p = toSvg(e.clientX, e.clientY, L);
    if (p.y >= band.y0 && p.y <= band.y1) {
      img.setPointerCapture?.(e.pointerId);   // il dito resta "nostro" anche fuori dal logo, dentro la lente
      openLens(e, L);
    }
    onMove(e);
  });
  img.addEventListener('pointermove', onMove);
  const onEnd = e => { inside.delete(e.pointerId); closeLens(); };
  img.addEventListener('pointerup', onEnd);
  img.addEventListener('pointercancel', onEnd);
  img.addEventListener('lostpointercapture', onEnd);
  img.addEventListener('contextmenu', e => { if (lens) e.preventDefault(); }); // niente menu a pressione lunga
}

document.querySelectorAll('img[data-braille-haptics]').forEach(img => attach(img).catch(err => console.warn('[logo-braille]', err)));
