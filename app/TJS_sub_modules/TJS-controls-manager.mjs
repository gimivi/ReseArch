// TJS-controls-manager.mjs

/**
 * ControlsManager
 * - Registra UNA volta i listener su domElement
 * - Inoltra eventi a controller attivo: active.handleEvent(e, ctx)
 * - Chiamata nel loop: manager.update(dt)
 *
 * controller contract minimo:
 *  - activate(ctx)
 *  - deactivate(ctx)
 *  - update(dt, ctx) -> boolean
 *  - handleEvent(e, ctx)   (opzionale ma consigliato)
 */
export class ControlsManager {
  constructor(domElement, ctx) {
    this.domElement = domElement;
    this.ctx = ctx;

    this.controllers = new Map();
    this.activeName = null;
    this.active = null;

    this._boundHandler = (e) => this._handleEvent(e);

    this._listening = false;
  }

  register(name, controller) {
    this.controllers.set(name, controller);
  }

  start() {
    if (this._listening) return;
    this._listening = true;

    const el = this.domElement;
    // pointer
    el.addEventListener("pointerdown", this._boundHandler, { passive: false });
    el.addEventListener("pointermove", this._boundHandler, { passive: false });
    el.addEventListener("pointerup", this._boundHandler, { passive: false });
    el.addEventListener("pointercancel", this._boundHandler, { passive: false });

    // wheel
    el.addEventListener("wheel", this._boundHandler, { passive: false });

    // keyboard (meglio su window, così funziona anche se il canvas non ha focus)
    window.addEventListener("keydown", this._boundHandler, { passive: false });
    window.addEventListener("keyup", this._boundHandler, { passive: false });

    // optional: prevenire drag HTML
    el.addEventListener("dragstart", this._boundHandler, { passive: false });

    // se vuoi gestire contextmenu globalmente puoi aggiungerlo qui
    // el.addEventListener("contextmenu", this._boundHandler, { passive: false });
  }

  stop() {
    if (!this._listening) return;
    this._listening = false;

    const el = this.domElement;
    el.removeEventListener("pointerdown", this._boundHandler);
    el.removeEventListener("pointermove", this._boundHandler);
    el.removeEventListener("pointerup", this._boundHandler);
    el.removeEventListener("pointercancel", this._boundHandler);

    el.removeEventListener("wheel", this._boundHandler);

    window.removeEventListener("keydown", this._boundHandler);
    window.removeEventListener("keyup", this._boundHandler);

    el.removeEventListener("dragstart", this._boundHandler);
  }

  setMode(name) {
    if (name === this.activeName) return;

    const next = this.controllers.get(name);
    if (!next) throw new Error(`ControlsManager: controller '${name}' not registered`);

    // deactivate current
    if (this.active?.deactivate) this.active.deactivate(this.ctx);

    this.activeName = name;
    this.active = next;

    // activate new
    if (this.active?.activate) this.active.activate(this.ctx);
  }

  update(dt) {
    if (!this.active?.update) return false;
    return !!this.active.update(dt, this.ctx);
  }

  _handleEvent(e) {
    // Se vuoi, puoi filtrare eventi quando non siamo nel panel attivo ecc.
    if (this.active?.handleEvent) {
      this.active.handleEvent(e, this.ctx);
    }
  }
}
