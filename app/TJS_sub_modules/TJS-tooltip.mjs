// TJS_sub_modules/TJS-tooltip.mjs
//
// Cartellino 3D sopra l'oggetto puntato (nato in HySpace, ora generico).

import { THREE } from "./TJS-loaders.mjs";

/**
 * Tooltip 3D: cartellino rivolto sempre verso chi guarda (Sprite), sopra l'oggetto
 * puntato dal mirino o dal cursore. Riceve { title, author, hint }.
 */
export const TJS_TOOLTIP_STYLE = {
  width: 1.1,                 // m
  offsetY: 0.28,              // m sopra l'oggetto
  font: "Arial, Helvetica, sans-serif",
  bg: "rgba(20,22,30,0.85)",
  color: "#ffffff",
  hintColor: "#9fd7ff",
};

export function TJS_createTooltip({ parent, style = TJS_TOOLTIP_STYLE }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.renderOrder = 10;
  sprite.scale.set(style.width, style.width / 4, 1);
  sprite.visible = false;
  parent.add(sprite);

  let current = null; // oggetto e testo mostrati
  const pos = new THREE.Vector3();

  function draw({ title = "", author = "", hint = "" }) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, r = 36;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = style.bg;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(4, 4, W - 8, H - 8, r) : ctx.rect(4, 4, W - 8, H - 8);
    ctx.fill();
    const fit = (text, px, weight, maxW) => {
      let size = px;
      ctx.font = `${weight} ${size}px ${style.font}`;
      while (size > 20 && ctx.measureText(text).width > maxW) { size -= 2; ctx.font = `${weight} ${size}px ${style.font}`; }
    };
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (hint) { ctx.fillStyle = style.hintColor; fit(hint, 38, "normal", W - 80); ctx.fillText(hint, W / 2, 52); }
    ctx.fillStyle = style.color;
    fit(title, 64, "bold", W - 80);
    ctx.fillText(title, W / 2, hint ? 128 : 100);
    fit(author, 46, "normal", W - 80);
    ctx.fillText(author, W / 2, hint ? 198 : 176);
    tex.needsUpdate = true;
  }

  /** Mostra il tooltip su obj (o lo nasconde se info è null). */
  function show(obj, info) {
    if (!obj || !info) return hide();
    const key = `${info.title}|${info.author}|${info.hint}`;
    if (!current || current.key !== key) { draw(info); }
    current = { obj, key };
    obj.getWorldPosition(pos);
    parent.worldToLocal(pos);
    sprite.position.set(pos.x, pos.y + style.offsetY, pos.z);
    sprite.visible = true;
  }

  function hide() { sprite.visible = false; current = null; }

  function dispose() {
    parent.remove(sprite);
    sprite.material.dispose();
    tex.dispose();
  }

  return { show, hide, dispose };
}
