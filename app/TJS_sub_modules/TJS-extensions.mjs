// TJS_sub_modules/TJS-extensions.mjs
//
// Estensioni di un pannello TJS: il modo in cui una specializzazione (walkthrough, audio,
// zone, …) si aggancia a model_TJS SENZA che model_TJS la conosca. TJS base resta
// leggero: un'estensione si carica solo quando un nodo FLE "di capacità" la installa
// (passo 3), con import dinamico da un elenco chiuso di moduli della piattaforma.
//
// Regole:
//  - il grafo FLE configura e reagisce; il lavoro per frame lo fa l'estensione, dentro
//    il ciclo di TJS (onFrame), non il grafo → prestazioni come il codice nativo;
//  - un'estensione per nome e per pannello (install è idempotente);
//  - tutto ciò che l'estensione registra (frame, controlli, menu, eventi) viene tolto da
//    sola alla chiusura del pannello o con uninstall(name).
//
// Contratto di un'estensione:
//
//   install(name, factory, options)   factory(api, options) → istanza | Promise<istanza>
//   release(name)                     chi l'aveva installata non la usa più (conteggio d'uso)
//   istanza (tutto facoltativo):  { dispose(), configure(options), ...metodi propri }
//
// API passata alla factory (api):
//   THREE, scene, camera, renderer, bodyEl, modelsRoot, object, models, signal, cmdUI,
//   transformTool (selezione e gizmo: da spegnere se l'estensione usa i clic in altro modo)
//   markDirty()                        chiede un nuovo disegno
//   onFrame(fn)            → off       fn(dt, elapsed) a ogni tick; ritorna true = ridisegna
//   registerControls(name, ctrl)       controller per ControlsManager (activate/deactivate/
//                                      update(dt)→bool/handleEvent) — tolto al dispose
//   setControls(name)                  attiva un controller ("orbit", "eyelock" o registrato)
//   activeControls                     nome del controller attivo
//   onPick(fn)             → off       fn(lastHit) a ogni pick del pannello (evento 'pick')
//   raycast(ndcX, ndcY, roots?)        primo hit dal centro/NDC dato (default: modelli)
//   addMenuItem({ side, label, onClick })  → off   side "left" (oggetto) | "right" (app);
//                                      label stringa o funzione (letta all'apertura)
//   setAnimationLoop(on)               true = ciclo di renderer.setAnimationLoop (WebXR),
//                                      false = requestAnimationFrame (default)
//   onDispose(fn)                      pulizia aggiuntiva
//   get(name)                          istanza di un'altra estensione installata

/**
 * @param {object} host
 * @param {object} host.state            stato del pannello TJS
 * @param {object} host.THREE
 * @param {(mode:string)=>void} host.setControlsMode
 * @param {(on:boolean)=>void}  host.setAnimationLoop
 * @param {object|null} host.cmdUI
 */
export function TJS_createExtensionHost({ state, THREE, setControlsMode, setAnimationLoop, cmdUI = null }) {
  const installed = new Map();   // name → { instance, cleanups:[], ready:Promise }
  const frameFns = new Set();
  const menuItems = new Set();   // { side, label, onClick, owner }
  let loopRequests = 0;          // quante estensioni chiedono il ciclo XR
  let disposed = false;
  const rc = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function makeApi(owner) {
    const cleanups = owner.cleanups;
    const track = (fn) => { cleanups.push(fn); return fn; };

    return {
      THREE,
      get scene() { return state.scene; },
      get camera() { return state.camera; },
      get renderer() { return state.renderer; },
      get bodyEl() { return state.bodyEl; },
      get modelsRoot() { return state.modelsRoot; },
      get object() { return state.object; },
      get models() { return state.models ?? []; },
      get signal() { return state.signal ?? null; },
      get appContext() { return state.appContext ?? null; },
      get transformTool() { return state.transformTool ?? null; },   // selezione/gizmo del pannello
      cmdUI,

      markDirty: () => state.markDirty?.(),

      onFrame(fn) {
        frameFns.add(fn);
        const off = () => frameFns.delete(fn);
        return track(off);
      },

      registerControls(name, controller) {
        state.controlsMgr.register(name, controller);
        track(() => {
          if (state.activeControls === name) setControlsMode("orbit");
          state.controlsMgr.controllers.delete(name);
        });
      },
      setControls: (name) => setControlsMode(name),
      get activeControls() { return state.activeControls; },

      onPick(fn) {
        const h = (e) => fn(e.detail);
        state.localEvents.addEventListener("pick", h);
        return track(() => state.localEvents.removeEventListener("pick", h));
      },

      raycast(x = 0, y = 0, roots = null) {
        ndc.set(x, y);
        rc.setFromCamera(ndc, state.camera);
        return rc.intersectObjects(roots ?? [state.modelsRoot], true)[0] ?? null;
      },

      addMenuItem({ side = "left", label, onClick }) {
        const item = { side: side === "right" ? "right" : "left", label, onClick };
        menuItems.add(item);
        return track(() => menuItems.delete(item));
      },

      setAnimationLoop(on) {
        const want = !!on;
        if (want === !!owner.loop) return;
        owner.loop = want;
        loopRequests += want ? 1 : -1;
        setAnimationLoop(loopRequests > 0);
      },

      onDispose(fn) { track(fn); },

      get: (name) => installed.get(name)?.instance ?? null,
    };
  }

  function runCleanups(owner) {
    if (owner.loop) { owner.loop = false; loopRequests--; setAnimationLoop(loopRequests > 0); }
    for (const fn of owner.cleanups.splice(0).reverse()) {
      try { fn(); } catch (e) { console.warn("[TJS-ext] cleanup:", e); }
    }
  }

  /**
   * Installa un'estensione (una volta per nome). Se è già installata, le passa le nuove
   * opzioni con configure() e ritorna l'istanza esistente.
   */
  async function install(name, factory, options = {}) {
    if (disposed) return null;
    const have = installed.get(name);
    if (have) {
      have.refs++;
      const inst = await have.ready;
      try { inst?.configure?.(options); } catch (e) { console.warn(`[TJS-ext] ${name}.configure:`, e); }
      return inst;
    }
    const owner = { cleanups: [], loop: false, instance: null, ready: null, refs: 1 };
    installed.set(name, owner);
    owner.ready = (async () => {
      try {
        const inst = await factory(makeApi(owner), options);
        if (disposed || installed.get(name) !== owner) {   // pannello chiuso nel frattempo
          try { inst?.dispose?.(); } catch {}
          runCleanups(owner);
          return null;
        }
        owner.instance = inst ?? {};
        state.markDirty?.();
        return owner.instance;
      } catch (e) {
        console.error(`[TJS-ext] installazione di "${name}" fallita:`, e);
        runCleanups(owner);
        installed.delete(name);
        return null;
      }
    })();
    return owner.ready;
  }

  function uninstall(name) {
    const owner = installed.get(name);
    if (!owner) return;
    installed.delete(name);
    try { owner.instance?.dispose?.(); } catch (e) { console.warn(`[TJS-ext] ${name}.dispose:`, e); }
    runCleanups(owner);
    state.markDirty?.();
  }

  /**
   * Chi aveva chiamato install() non la usa più: l'estensione si toglie quando nessuno
   * la usa (es. il grafo di prova dell'editor si ferma, ma il flow vero la usa ancora).
   */
  function release(name) {
    const owner = installed.get(name);
    if (owner && --owner.refs <= 0) uninstall(name);
  }

  /** Attende le installazioni in corso (al massimo timeoutMs), prima di dare il via al ciclo. */
  async function whenReady(timeoutMs = 10000) {
    const pending = [...installed.values()].map((o) => o.ready);
    if (!pending.length) return;
    let timer;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((r) => { timer = setTimeout(r, timeoutMs); }),
    ]);
    clearTimeout(timer);
  }

  /** Chiamata dal ciclo di TJS a ogni tick. Ritorna true se qualcuno chiede di ridisegnare. */
  function frame(dt, elapsed) {
    if (!frameFns.size) return false;
    let dirty = false;
    for (const fn of frameFns) {
      try { if (fn(dt, elapsed)) dirty = true; } catch (e) { console.error("[TJS-ext] onFrame:", e); frameFns.delete(fn); }
    }
    return dirty;
  }

  /** Voci di menu delle estensioni per il lato indicato, nel formato dei menu del template. */
  function menu(side) {
    const out = [];
    let i = 0;
    for (const it of menuItems) {
      if (it.side !== side) continue;
      const label = typeof it.label === "function" ? it.label() : it.label;
      out.push({ id: `ext-${side}-${i++}`, label: String(label ?? ""), onClick: it.onClick });
    }
    return out;
  }

  function dispose() {
    if (disposed) return;
    for (const name of [...installed.keys()].reverse()) uninstall(name);
    disposed = true;
    frameFns.clear();
    menuItems.clear();
  }

  return {
    install, release, uninstall, whenReady, frame, menu, dispose,
    has: (name) => installed.has(name),
    get: (name) => installed.get(name)?.instance ?? null,
    get names() { return [...installed.keys()]; },
  };
}
