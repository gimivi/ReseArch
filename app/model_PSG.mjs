// model_PSG.mjs
// Renderer Three.js per panorami sferici gigapixel "PSG" (Pano Sfera Gigapixel)
// Specialization for template_XXX.mjs
//
// Obiettivi di questo file:
// - creare scena + renderer e montare canvas nel bodyEl
// - costruire sfera panoramica tileizzata con LOD basato su FOV
// - installare controls (Orbit/EyeLock)
// - collegarsi a cmdUI (footer del panel) tramite ctx.cmdUI
// - cleanup robusto su AbortSignal (per istanza/pannello)

import { THREE, loadAnyModel } from "./TJS_sub_modules/TJS-loaders.mjs";
import { t, te } from "./shared/i18n.mjs";

import { OrbitControls }   from "three/addons/controls/OrbitControls.js";
import { EffectComposer }  from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass }      from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass }      from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass }      from "three/addons/postprocessing/OutputPass.js";
import { ControlsManager } from "./TJS_sub_modules/TJS-controls-manager.mjs";
import { EyeLockControls } from "./TJS_sub_modules/TJS-eyelock-controls.mjs";

import { tjsToggleProjection } from "./TJS_sub_modules/TJS-projection.mjs";
import { tjsSetMainView } from "./TJS_sub_modules/TJS-mainviews.mjs";

import { tjsCreateTransformTool } from "./TJS_sub_modules/TJS-transform.mjs";
import { tjsCreateCutTool } from "./TJS_sub_modules/TJS-cut-core.mjs";

import {
  tjsHideSelected,
  tjsToggleWireframeSelected,
  tjsEraseSelected,
  tjsTargetAtSelection,
  tjsCameraAtSelection,
} from "./TJS_sub_modules/TJS-selection-actions.mjs";

// -------------------------------
// CONFIG / STATE
// -------------------------------

const STATE_KEY = "__PSG_RENDER_STATE__";

// ─── PSG Filter system ────────────────────────────────────────────────────────

const PSG_FILTER_DEFAULTS = Object.freeze({
  // cat.1 — Colore & Tono
  exposure:    0.0,   // EV stops  (-3 … +3)
  brightness:  0.0,   // additive  (-1 … +1)
  contrast:    1.0,   // pivot 0.5 (0.5 … 2)
  temperature: 0.0,   // cool/warm (-1 … +1)
  hue:         0.0,   // gradi    (-180 … +180)
  saturation:  1.0,   // moltipl. (0 … 2)
  vibrance:    0.0,   // boost    (0 … 1)
  // cat.3 — Analisi scientifica
  grayscale:   0.0,   // blend    (0 … 1)
  falseColor:  0.0,   // 0=off 1=inferno 2=viridis 3=jet
  threshold:  -1.0,   // -1=off   (0 … 1)
  posterize:   0.0,   // 0=off    (2 … 8 steps)
  // cat.4 — Effetti fotografici
  sepia:       0.0,   // blend    (0 … 1)
  nightVision: 0.0,   // blend    (0 … 1)
  invert:      0.0,   // 0 o 1
  vignette:    0.0,   // strength (0 … 1)
  grain:       0.0,   // strength (0 … 1)
});

const PSG_FILTER_PRESETS = {
  reset:   { ...PSG_FILTER_DEFAULTS },
  warm:    { ...PSG_FILTER_DEFAULTS, temperature:  0.55, saturation: 1.10, brightness:  0.03 },
  cool:    { ...PSG_FILTER_DEFAULTS, temperature: -0.45, saturation: 0.95, brightness: -0.02 },
  bw:      { ...PSG_FILTER_DEFAULTS, grayscale: 1.0, contrast: 1.10 },
  sepia:   { ...PSG_FILTER_DEFAULTS, sepia: 0.85, contrast: 1.05 },
  night:   { ...PSG_FILTER_DEFAULTS, nightVision: 1.0, grain: 0.30 },
  inferno: { ...PSG_FILTER_DEFAULTS, falseColor: 1.0 },
  viridis: { ...PSG_FILTER_DEFAULTS, falseColor: 2.0 },
  vivid:   { ...PSG_FILTER_DEFAULTS, saturation: 1.60, contrast: 1.10, vibrance: 0.40 },
  faded:   { ...PSG_FILTER_DEFAULTS, saturation: 0.50, contrast: 0.85, brightness: 0.05 },
};

// Definizioni UI per il modal (usate anche dal wiring); funzione perché le etichette
// dipendono dalla lingua dell'interfaccia (t)
const psgFilterDefs = () => [
  { section: t("app.psg.flt.sec_color"), icon: "bi-palette", items: [
    { key: "exposure",    label: t("app.psg.flt.exposure"), min:-3,   max:3,   step:0.05, fmt: v => (v>=0?"+":"")+v.toFixed(2)+" EV" },
    { key: "brightness",  label: t("app.psg.flt.brightness"), min:-1,   max:1,   step:0.01, fmt: v => (v>=0?"+":"")+v.toFixed(2) },
    { key: "contrast",    label: t("app.psg.flt.contrast"), min:0.5,  max:2,   step:0.01, fmt: v => v.toFixed(2) },
    { key: "temperature", label: t("app.psg.flt.temperature"), min:-1,   max:1,   step:0.01, fmt: v => v>0.01?`+${v.toFixed(2)} ☀`:v<-0.01?`${v.toFixed(2)} ❄`:t("app.psg.flt.neutral") },
    { key: "hue",         label: t("app.psg.flt.hue"), min:-180, max:180, step:1,    fmt: v => (v>=0?"+":"")+v.toFixed(0)+"°" },
    { key: "saturation",  label: t("app.psg.flt.saturation"), min:0,    max:2,   step:0.01, fmt: v => v.toFixed(2) },
    { key: "vibrance",    label: t("app.psg.flt.vibrance"), min:0,    max:1,   step:0.01, fmt: v => (v*100).toFixed(0)+"%" },
  ]},
  { section: t("app.psg.flt.sec_analysis"), icon: "bi-graph-up", items: [
    { key: "grayscale",   label: t("app.psg.flt.grayscale"), min:0, max:1, step:0.01, fmt: v => (v*100).toFixed(0)+"%" },
    { key: "falseColor",  label: t("app.psg.flt.false_color"), type:"select",
      options: [{v:0,l:t("app.psg.flt.off")},{v:1,l:"Inferno"},{v:2,l:"Viridis"},{v:3,l:"Jet"}] },
    { key: "threshold",   label: t("app.psg.flt.threshold"), min:-1, max:1,  step:0.01, fmt: v => v<-0.5?t("app.psg.flt.off"):v.toFixed(2) },
    { key: "posterize",   label: t("app.psg.flt.posterize"), min:0,  max:8,  step:1,    fmt: v => v<1.5?t("app.psg.flt.off"):t("app.psg.flt.levels", { n: v.toFixed(0) }) },
  ]},
  { section: t("app.psg.flt.sec_effects"), icon: "bi-camera", items: [
    { key: "sepia",       label: t("app.psg.flt.sepia"), min:0, max:1, step:0.01, fmt: v => (v*100).toFixed(0)+"%" },
    { key: "nightVision", label: t("app.psg.flt.night"), min:0, max:1, step:0.01, fmt: v => (v*100).toFixed(0)+"%" },
    { key: "invert",      label: t("app.psg.flt.invert"), min:0, max:1, step:1,    fmt: v => v>0.5?t("common.yes"):t("common.no") },
    { key: "vignette",    label: t("app.psg.flt.vignette"), min:0, max:1, step:0.01, fmt: v => (v*100).toFixed(0)+"%" },
    { key: "grain",       label: t("app.psg.flt.grain"), min:0, max:1, step:0.01, fmt: v => (v*100).toFixed(0)+"%" },
  ]},
];

const PSG_FILTER_SHADER = {
  uniforms: {
    tDiffuse:     { value: null },
    u_time:       { value: 0.0 },
    u_exposure:   { value: 0.0 },
    u_brightness: { value: 0.0 },
    u_contrast:   { value: 1.0 },
    u_temperature:{ value: 0.0 },
    u_hue:        { value: 0.0 },
    u_saturation: { value: 1.0 },
    u_vibrance:   { value: 0.0 },
    u_grayscale:  { value: 0.0 },
    u_falseColor: { value: 0.0 },
    u_threshold:  { value: -1.0 },
    u_posterize:  { value: 0.0 },
    u_sepia:      { value: 0.0 },
    u_nightVision:{ value: 0.0 },
    u_invert:     { value: 0.0 },
    u_vignette:   { value: 0.0 },
    u_grain:      { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float u_time, u_exposure, u_brightness, u_contrast, u_temperature;
    uniform float u_hue, u_saturation, u_vibrance;
    uniform float u_grayscale, u_falseColor, u_threshold, u_posterize;
    uniform float u_sepia, u_nightVision, u_invert, u_vignette, u_grain;
    varying vec2 vUv;

    // ── HSL helpers ──────────────────────────────────────────────
    float h2r(float p,float q,float t){
      if(t<0.)t+=1.; if(t>1.)t-=1.;
      if(t<1./6.) return p+(q-p)*6.*t;
      if(t<.5)    return q;
      if(t<2./3.) return p+(q-p)*(2./3.-t)*6.;
      return p;
    }
    vec3 rgb2hsl(vec3 c){
      float hi=max(c.r,max(c.g,c.b)), lo=min(c.r,min(c.g,c.b));
      float l=(hi+lo)*.5, d=hi-lo, h=0.,s=0.;
      if(d>.001){
        s=d/(1.-abs(2.*l-1.));
        if(hi==c.r)      h=mod((c.g-c.b)/d,6.)/6.;
        else if(hi==c.g) h=((c.b-c.r)/d+2.)/6.;
        else             h=((c.r-c.g)/d+4.)/6.;
        if(h<0.)h+=1.;
      }
      return vec3(h,clamp(s,0.,1.),clamp(l,0.,1.));
    }
    vec3 hsl2rgb(vec3 c){
      if(c.y<.001)return vec3(c.z);
      float q=c.z<.5?c.z*(1.+c.y):c.z+c.y-c.z*c.y, p=2.*c.z-q;
      return vec3(h2r(p,q,c.x+1./3.),h2r(p,q,c.x),h2r(p,q,c.x-1./3.));
    }

    // ── False-color (polynomial fit © Matías Valdenegger CC0) ────
    vec3 infernoColor(float t){
      return clamp(vec3(
        .0002+t*(.1065+t*(.5539+t*(.7964+t*(.1791-t*.7017)))),
        .0016+t*(.0518+t*(-.0469+t*(.5271+t*(.5678-t*.6700)))),
        .0139+t*(.5017+t*(.1042+t*(-.7868+t*(.5097+t*.2290))))),0.,1.);
    }
    vec3 viridisColor(float t){
      return clamp(vec3(
        .2777+t*(.1057+t*(.5552+t*(-.7745+t*(-.6448+t*.5932)))),
        .0048+t*(1.4046+t*(.6789+t*(-2.5851+t*(3.5521-t*1.5494)))),
        .3111+t*(1.3856+t*(-.8035+t*(2.0907+t*(-1.7198+t*.2448))))),0.,1.);
    }
    vec3 jetColor(float t){
      return clamp(vec3(
        min(4.*t-1.5,-4.*t+4.5),
        min(4.*t-.5, -4.*t+3.5),
        min(4.*t+.5, -4.*t+2.5)),0.,1.);
    }

    void main(){
      vec4 orig = texture2D(tDiffuse, vUv);
      vec3 c = orig.rgb;

      // ── cat.1 Colore & Tono ──────────────────────────────────
      c *= pow(2.0, u_exposure);
      c += u_brightness;
      c  = (c - 0.5) * u_contrast + 0.5;
      c.r += u_temperature * 0.12;
      c.b -= u_temperature * 0.12;

      if(abs(u_hue)>0.01 || abs(u_saturation-1.)>0.01 || u_vibrance>0.01){
        vec3 hsl = rgb2hsl(clamp(c,0.,1.));
        hsl.x += u_hue/360.; if(hsl.x>1.)hsl.x-=1.; if(hsl.x<0.)hsl.x+=1.;
        hsl.y  = clamp(hsl.y*u_saturation + u_vibrance*(1.-hsl.y)*.5, 0.,1.);
        c = hsl2rgb(hsl);
      }
      c = clamp(c,0.,1.);

      // ── cat.3 Analisi scientifica ────────────────────────────
      float lum = dot(c, vec3(0.2126,0.7152,0.0722));
      c = mix(c, vec3(lum), u_grayscale);

      if     (u_falseColor>2.5) c = jetColor(lum);
      else if(u_falseColor>1.5) c = viridisColor(lum);
      else if(u_falseColor>0.5) c = infernoColor(lum);

      if(u_threshold >= 0.0) c = vec3(step(u_threshold, lum));

      if(u_posterize >= 1.5){
        float n = floor(u_posterize+.5);
        c = floor(c*n)/max(n-1.,1.);
      }

      // ── cat.4 Effetti fotografici ────────────────────────────
      if(u_sepia>0.01){
        vec3 sep=vec3(dot(c,vec3(.393,.769,.189)),dot(c,vec3(.349,.686,.168)),dot(c,vec3(.272,.534,.131)));
        c = mix(c,sep,u_sepia);
      }
      if(u_nightVision>0.01){
        float nl=dot(c,vec3(.2126,.7152,.0722));
        c = mix(c,vec3(0.,nl*1.3,nl*.15),u_nightVision);
      }
      c = mix(c, 1.-c, u_invert);

      if(u_grain>0.01){
        float n=fract(sin(dot(vUv*1000.+u_time*.05,vec2(12.9898,78.233)))*43758.5453);
        c += (n-.5)*u_grain*.15;
      }
      if(u_vignette>0.01){
        vec2 uv2=vUv*(1.-vUv.yx);
        c *= clamp(pow(uv2.x*uv2.y*15., u_vignette*.6),0.,1.);
      }

      gl_FragColor = vec4(clamp(c,0.,1.), orig.a);
    }
  `,
};

// opzionale: helper globale se esiste
const fitCameraToObject = window.fitCameraToObject;

// registriamo le istanze attive (best-effort, per fallback destroy())
const ACTIVE_BODIES = new Set();

// Griglia: tienila coerente in un solo posto
const GRID = { size: 100, divisions: 20 };
const gridStep = GRID.size / GRID.divisions;

// -------------------------------
// SPECIALIZATION EXPORT (plugin)
// -------------------------------

export default {
  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
    if (!bodyEl) throw new Error("TJS.renderBody: bodyEl mancante");

    // Se per qualche motivo fosse rimasto uno stato precedente sullo stesso bodyEl, pulisco.
    destroyBodyInstance(bodyEl);

    // --- UI base del viewport (nota: stai modificando un div creato altrove) ---
    // NB: lo facciamo idempotente e ripristiniamo in destroy.
    const prevBodyStyle = {
      position: bodyEl.style.position,
      overflow: bodyEl.style.overflow,
    };

    bodyEl.style.position = bodyEl.style.position || "relative";
    bodyEl.style.overflow = "hidden";

    // --- Scene / Camera / Renderer ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101018);

    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    camera.position.set(0.0, 0.0, 0.01);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(bodyEl.clientWidth || 1, bodyEl.clientHeight || 1, false);

    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    bodyEl.appendChild(canvas);

    // --- Post-processing (filtri + porta aperta per cat.2/5/6 futuri) ---
    // Catena: RenderPass → [cat.2/5/6 futuri] → FilterPass → OutputPass
    // OutputPass è fondamentale: riapplica la conversione lineare→sRGB (gamma ≈ 2.2)
    // che renderer.render() faceva in automatico, evitando il darkening del pipeline.
    const composer   = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const filterPass = new ShaderPass(PSG_FILTER_SHADER);
    composer.addPass(filterPass);
    composer.addPass(new OutputPass());   // ← ripristina gamma/colorSpace identici a renderer.render()

    // --- Luci + Griglia (minimo indispensabile) ---
    {
      const ambient = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambient);

      const dir = new THREE.DirectionalLight(0xffffff, 0.9);
      dir.position.set(10, 12, 8);
      scene.add(dir);

      /*tolta in questo APP
      const grid = new THREE.GridHelper(GRID.size, GRID.divisions, 0x3355ff, 0x808080);
      grid.name = "TJS_GRID";
      
      
      scene.add(grid);
      */
    }

    // --- OrbitControls ---
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.06;
    orbit.target.set(0, 0, 0);
    orbit.update();

    // --- Reticle (per EyeLock) ---
    const reticleEl = tjsCreateReticle(bodyEl);

    // --- ctx per ControlsManager / EyeLock ---
    const controlsCtx = {
      THREE,
      camera,
      scene,
      renderer,
      raycaster: new THREE.Raycaster(),
      pickables: null,
      setReticle: (on) => {
        if (reticleEl) reticleEl.style.display = on ? "block" : "none";
      },
      onPick: (hit) => {
        // hook: agganciare UI/telemetrie se serve
        // console.log("EyeLock PICK:", hit?.point, hit?.object);
      },
    };

    const controlsMgr = new ControlsManager(renderer.domElement, controlsCtx);
    const eye = new EyeLockControls(renderer.domElement);
    eye.minFov    = 5;     // zoom massimo: 5° (era 20°, impediva il livello 4)
    eye.zoomSpeed = 0.01;  // ~1° per notch (era 0.05 → ~5° per notch)

    controlsMgr.register("orbit", {
      activate: () => {
        orbit.enabled = true;
      },
      deactivate: () => {
        orbit.enabled = false;
      },
      update: (dt) => orbit.update(dt),
    });
    controlsMgr.register("eyelock", eye);

    controlsMgr.start();
    controlsMgr.setMode("eyelock");

    // --- Root per modelli ---
    const modelsRoot = new THREE.Group();
    modelsRoot.name = "TJS_MODELS_ROOT";
    scene.add(modelsRoot);
    controlsCtx.pickables = [modelsRoot];

    // --- Tools ---
    const transformTool = tjsCreateTransformTool({
      THREE,
      scene,
      camera,
      domEl: renderer.domElement,
      orbitControls: orbit,
      selectableRoot: modelsRoot,
      cmdUI: cmdUI ?? null,
      gridStep,
      rotStepDeg: 15,
      scaleStep: 0.1,
    });

    const cutTool = tjsCreateCutTool({
      THREE,
      scene,
      renderer,
      camera,
      domEl: renderer.domElement,
      cmdUI: cmdUI ?? null,
      transformTool,
      selectableRoot: modelsRoot,
      initialMode: "basic",
    });

    // --- Stato (creato PRIMA di observer/loop per evitare riferimenti prematuri) ---
    const state = {
      stopped: false,
      panel,
      headerEl,
      bodyEl,
      prevBodyStyle,

      scene,
      camera,
      renderer,

      controlsMgr,
      orbitControls: orbit,
      eyeLockControls: eye,
      activeControls: "eyelock",
      orbitDistance: null,

      reticleEl,
      transformTool,
      cutTool,
      modelsRoot,
      tileManager: null,   // assegnato dopo la costruzione

      composer,
      filterPass,
      filterUniforms: Object.assign({}, PSG_FILTER_DEFAULTS),
      filtersModalEl: null,

      resizeObserver: null,
      resizeRAF: 0,
      rafId: 0,
    };

    bodyEl[STATE_KEY] = state;
    ACTIVE_BODIES.add(bodyEl);

    // cleanup per istanza legato al signal del template
    attachAbortCleanup(signal, bodyEl);

    // --- ResizeObserver (FIX: non usa state prima che esista) ---
    let lastW = 0;
    let lastH = 0;

    const resizeObserver = new ResizeObserver(() => {
      if (state.resizeRAF) return;
      state.resizeRAF = requestAnimationFrame(() => {
        state.resizeRAF = 0;
        if (state.stopped) return;

        const w = bodyEl.clientWidth || 1;
        const h = bodyEl.clientHeight || 1;
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;

        const cam = state.camera;

        if (cam.isPerspectiveCamera) {
          cam.aspect = w / h;
          cam.updateProjectionMatrix();
        } else if (cam.isOrthographicCamera) {
          const aspect = w / h;
          const halfH = (cam.top - cam.bottom) / 2;
          cam.left = -halfH * aspect;
          cam.right = halfH * aspect;
          cam.updateProjectionMatrix();
        }

        renderer.setSize(w, h, false);
        state.composer?.setSize(w, h);

        // Resize HUD canvas: adatta buffer alla nuova larghezza
        if (state.hudCanvas) {
          state.hudCanvas.width = w;
          state.applyHudStyle(state.hud2d);
          state.psgLastStatus = ""; // forza ridisegno al prossimo frame
        }
      });
    });

    resizeObserver.observe(bodyEl);
    state.resizeObserver = resizeObserver;

    // --- Toolbar icons sync (FIX: cerca in headerEl/panel, non in bodyEl) ---
    // Poiché i bottoni sono creati dal template nella toolbar dell’header.
    tjsUpdateProjectionToggleButton(headerEl ?? panel, bodyEl);
    tjsUpdateControlsToggleButton(headerEl ?? panel, bodyEl);
    tjsUpdateAtToggleButton(headerEl ?? panel, bodyEl);

    /* Tolgo la parte di caricamento dei modelli perchè qui carichiamo solo la sfera per il rendering del Pano Sferico Gigapixel
    // --- Load models ---
    const arr = Array.isArray(models) ? models : [];
    if (arr.length) {
      cmdUI?.show({
        status: `Caricamento modelli: 0/${arr.length}`,
        hints: "",
      });

      let loadedCount = 0;

      const tasks = arr.map(async (row, idx) => {
        const label =
          row?.mod_name || row?.mod_id || row?.mod_abs_url || `#${idx + 1}`;

        try {
          const obj3d = await loadAnyModel(row, {
            onProgress: (loaded, total) => {
              // best-effort: non spammare troppo, ma aggiorna
              if (total > 0) {
                cmdUI?.update({
                  status: `Carico ${label}: ${Math.round(
                    (loaded / total) * 100
                  )}% (${loadedCount}/${arr.length})`,
                });
              }
            },
          });

          // se nel frattempo è stato abortito: smonta subito ciò che hai creato
          if (signal?.aborted || state.stopped) {
            disposeObject3D(obj3d);
            return { ok: false, label, error: new Error("aborted") };
          }

          const g = new THREE.Group();
          g.name = `MODEL_${idx}`;
          g.userData = { modelRow: row };
          g.add(obj3d);
          modelsRoot.add(g);

          loadedCount += 1;
          cmdUI?.update({ status: `Caricamento modelli: ${loadedCount}/${arr.length}` });

          return { ok: true, label, obj: g };
        } catch (err) {
          loadedCount += 1;
          cmdUI?.update({ status: `Errore su ${label} (${loadedCount}/${arr.length})` });
          return { ok: false, label, error: err };
        }
      });

      const results = await Promise.all(tasks);
      const failed = results.filter((r) => !r.ok);

      if (failed.length) {
        console.warn("TJS: alcuni modelli non sono stati caricati:", failed);
      }

      // Fit camera
      try {
        if (typeof fitCameraToObject === "function") {
          fitCameraToObject(camera, modelsRoot, orbit, 1.25);
        } else {
          fitCameraFallback(camera, orbit, modelsRoot, { fitOffset: 1.25 });
        }
      } catch (e) {
        console.warn("TJS: fit camera fallito:", e);
      }

      cmdUI?.update({
        status: failed.length
          ? `Caricati con errori (${failed.length}).`
          : "Caricamento completato.",
      });
    } else {
      cmdUI?.show({ status: "Nessun modello nell'array models.", hints: "" });
    }

    */

   
    const arr = Array.isArray(models) ? models : [];
    const fullPath = arr[0]?.mod_abs_url || "";
    const baseUrl = fullPath.substring(0, fullPath.lastIndexOf('/') + 1);
    // Soglie FOV (decrescenti) per i 5 livelli LOD (0=coarse … 4=fine)
    // Level 0: fov > 55° | 1: 40–55° | 2: 25–40° | 3: 12–25° | 4: ≤ 12°
    const thresholds = [70, 55, 40, 25, 12];


    const tileManager = new TileManager(scene, camera, {
        baseUrl,
        thresholds,
        radius: 500
    });
    state.tileManager = tileManager;

    // --- Footer hints ---
    cmdUI.show({
      hints: t("app.psg.hints"),
    });

    // --- HUD canvas (Az / Ze / FOV / Liv) ---
    // Canvas 2D trasparente sovrapposto al viewport, appena sopra il footer.
    // Scrittura diretta su canvas: zero reflow DOM, zero parsing HTML.
    const footerFontPx = parseFloat(getComputedStyle(cmdUI.el()).fontSize) || 12;
    const applyHudStyle = (cx) => {
      cx.font         = `${footerFontPx}px monospace`;
      cx.textBaseline = "middle";
      cx.textAlign    = "center";
      cx.shadowColor  = "rgba(0,0,0,0.85)";
      cx.shadowBlur   = 3;
    };
    const hudCanvas = document.createElement("canvas");
    hudCanvas.width  = bodyEl.clientWidth || 800;
    hudCanvas.height = Math.ceil(footerFontPx + 10);
    const _footerH   = cmdUI.el().offsetHeight || 32;
    hudCanvas.style.cssText = `position:absolute;bottom:${Math.round(_footerH * 1.0)}px;left:50%;transform:translateX(-50%);white-space:nowrap;pointer-events:none;z-index:4;`;
    bodyEl.appendChild(hudCanvas);
    const hud2d = hudCanvas.getContext("2d");
    applyHudStyle(hud2d);
    state.hudCanvas     = hudCanvas;
    state.hud2d         = hud2d;
    state.applyHudStyle = applyHudStyle;

    // --- PSG Crosshair + controls + keydown ---
    const crosshairEl = psgCreateCrosshair(bodyEl);
    state.crosshairEl      = crosshairEl;
    state.crosshairVisible = false;
    state.capturedPoints   = [];
    state.flyTo            = null;
    state.hudVisible       = true;
    state.captureModalEl   = null;
    state.pointsModalEl    = null;
    state.psgLastStatus    = "";

    psgSetupControls(state, cmdUI);

    // Rimostra footer quando il mouse entra nella zona bassa del viewport
    {
      const _footerEl  = cmdUI.el();
      const _hoverZone = (_footerEl.offsetHeight || 32) * 1.5; // stessa banda del canvas
      bodyEl.addEventListener("mousemove", (e) => {
        const rect = bodyEl.getBoundingClientRect();
        if ((rect.bottom - e.clientY) <= _hoverZone) {
          _footerEl.classList.add("is-visible");
          _footerEl.setAttribute("aria-hidden", "false");
        }
      }, { signal });
    }

    // Spazio cattura punto (solo con mirino attivo)
    document.addEventListener("keydown", (e) => {
      if (!state.crosshairVisible || e.code !== "Space") return;
      e.preventDefault(); e.stopImmediatePropagation();
      const _kd = new THREE.Vector3();
      state.camera.getWorldDirection(_kd);
      const _az = ((Math.atan2(_kd.x, -_kd.z) * 180 / Math.PI) + 360) % 360;
      const _ze = Math.acos(Math.max(-1, Math.min(1, _kd.y))) * 180 / Math.PI;
      psgOpenCaptureModal(state, _az, _ze);
    }, { signal, capture: true });

    // --- Render loop (legato allo stato) ---
    const timer = new THREE.Timer();   // THREE.Clock è deprecato dalla r183
    const _psgDir = new THREE.Vector3();

    const animate = () => {
      if (state.stopped) return;

      //Questa è l'unica che ho inserito rispetto al modello base
      tileManager.update();

      timer.update();
      const dt = timer.getDelta();
      state.controlsMgr?.update(dt);

      // Fly-to animato (easeInOutSine)
      if (state.flyTo) {
        const ft = state.flyTo;
        const k  = Math.min((performance.now() - ft.startTime) / (ft.duration * 1000), 1);
        const ez = -(Math.cos(Math.PI * k) - 1) / 2;
        const ey = state.eyeLockControls;
        ey.yaw   = ft.startYaw   + ft.dYaw   * ez;
        ey.pitch = ft.startPitch + ft.dPitch * ez;
        ey._lookVelYaw = ey._lookVelPitch = 0;
        if (k >= 1) state.flyTo = null;
      }

      // HUD canvas: disegna Az/Ze/FOV/Liv solo quando cambia
      if (state.hudVisible) {
        const cam = state.camera;
        cam.getWorldDirection(_psgDir);
        const az = ((Math.atan2(_psgDir.x, -_psgDir.z) * 180 / Math.PI) + 360) % 360;
        const ze = Math.acos(Math.max(-1, Math.min(1, _psgDir.y))) * 180 / Math.PI;
        const d  = (v) => v.toFixed(2).padStart(6, '0') + '°';
        const s  = `Az ${d(az)}   Ze ${d(ze)}   FOV ${d(cam.fov)}   ${t('app.psg.hud_level')} ${state.tileManager?.activeLevel ?? 0}`;
        if (s !== state.psgLastStatus) {
          state.psgLastStatus = s;
          const cv = state.hudCanvas; const cx = state.hud2d;
          cx.clearRect(0, 0, cv.width, cv.height);
          cx.fillStyle = "white";
          cx.fillText(s, cv.width / 2, cv.height / 2);
        }
      }

      state.cutTool?.beforeRender?.();
      if (state.filterPass && state.filterUniforms.grain > 0.01)
        state.filterPass.uniforms.u_time.value += dt;
      state.composer.render();

      state.rafId = requestAnimationFrame(animate);
    };

    animate();
  },

  getLeftMenu({ object, bodyEl }) {
    return {
      title: getObjectDisplayName(object),
      items: [
        { id: "mode-orbit", label: "Orbit", onClick: () => setControlsMode(bodyEl, "orbit") },
        { id: "mode-eyelock", label: "EyeLock", onClick: () => setControlsMode(bodyEl, "eyelock") },
      ],
    };
  },

  getRightMenu({ bodyEl }) {
    return {
      title: "☰",
      items: [
        { id: "filtri", label: t("app.psg.filters_title"), onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (st) psgOpenFiltersModal(st);
          }
        },
        { id: "punti-collimati", label: t("app.psg.points_title"), onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (st) psgOpenPointsListModal(st);
          }
        },
      ],
    };
  },

  // FIX: prendiamo headerEl/panel dal ctx, così in futuro puoi fare cose più intelligenti.
  // Qui lo usiamo indirettamente perché i bottoni sono in toolbar (header), non nel body.
  getToolbar({ panel, headerEl, bodyEl }) {
    const root = headerEl ?? panel;

    return {
      items: [
        {
          type: "button",
          id: "btnProjToggle",
          iconClass: "bi bi-box",
          className: "icon-only",
          title: t("app.psg.tb.axonometric"),
          attrs: { "aria-label": t("app.psg.tb.axonometric") },
          disabled: true,
          onClick: () => {
            tjsToggleProjection(bodyEl, STATE_KEY);
            tjsUpdateProjectionToggleButton(root, bodyEl);
          },
        },

        { type: "spacer", width: 6 },

        {
          type: "button",
          id: "btnCtrlToggle",
          iconClass: "bi bi-eye",
          className: "icon-only",
          title: "EyeLock",
          attrs: { "aria-label": "EyeLock" },
          disabled: true,
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st) return;

            const next = st.activeControls === "orbit" ? "eyelock" : "orbit";
            setControlsMode(bodyEl, next);

            tjsUpdateControlsToggleButton(root, bodyEl);
            tjsUpdateAtToggleButton(root, bodyEl);
          },
        },

        {
          type: "button",
          id: "btnAtToggle",
          iconClass: "bi bi-box-arrow-in-down-right",
          className: "icon-only",
          title: "TargetAt",
          attrs: { "aria-label": "TargetAt" },
          disabled: true,
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.transformTool) return;

            if (st.activeControls === "orbit") {
              tjsTargetAtSelection(bodyEl, STATE_KEY);
            } else {
              tjsCameraAtSelection(bodyEl, STATE_KEY);
            }

            tjsUpdateAtToggleButton(root, bodyEl);
          },
        },

        { type: "spacer", width: 6 },

        {
          type: "dropdown",
          title: t("app.psg.tb.views"),
          iconClass: "bi bi-image",
          disabled: true,
          items: [
            { id: "Front", label: "Front", onClick: () => tjsSetMainView(bodyEl, "Front") },
            { id: "Left", label: "Left", onClick: () => tjsSetMainView(bodyEl, "Left") },
            { id: "Back", label: "Back", onClick: () => tjsSetMainView(bodyEl, "Back") },
            { id: "Right", label: "Right", onClick: () => tjsSetMainView(bodyEl, "Right") },
            { id: "Top", label: "Top", onClick: () => tjsSetMainView(bodyEl, "Top") },
            { id: "Bottom", label: "Bottom", onClick: () => tjsSetMainView(bodyEl, "Bottom") },
          ],
        },

        { type: "spacer", width: 6 },

        {
          type: "button",
          id: "btnOff",
          iconClass: "bi bi-lightbulb-off",
          className: "icon-only",
          title: t("app.psg.tb.hide_selected"),
          attrs: { "aria-label": t("app.psg.tb.hide_selected") },
          disabled: true,
          onClick: () => tjsHideSelected(bodyEl, STATE_KEY),
        },
        {
          type: "button",
          id: "btnWireframe",
          iconClass: "bi bi-box-fill",
          className: "icon-only",
          title: t("app.psg.tb.wireframe"),
          attrs: { "aria-label": t("app.psg.tb.wireframe") },
          disabled: true,
          onClick: () => tjsToggleWireframeSelected(bodyEl, STATE_KEY),
        },
        {
          type: "button",
          id: "btnLayers",
          iconClass: "bi bi-layers",
          className: "icon-only",
          title: t("app.psg.tb.layers"),
          attrs: { "aria-label": t("app.psg.tb.layers") },
          disabled: true,
          onClick: () => console.log("Layers"),
        },

        { type: "spacer", width: 6 },

        {
          type: "button",
          id: "btnMove",
          iconClass: "bi bi-arrows-move",
          className: "icon-only",
          title: t("app.psg.tb.move"),
          attrs: { "aria-label": t("app.psg.tb.move") },
          disabled: true,
          onClick: () => bodyEl?.[STATE_KEY]?.transformTool?.setMode?.("translate"),
        },
        {
          type: "button",
          id: "btnRotate",
          iconClass: "bi bi-arrow-clockwise",
          className: "icon-only",
          title: t("app.psg.tb.rotate"),
          attrs: { "aria-label": t("app.psg.tb.rotate") },
          disabled: true,
          onClick: () => bodyEl?.[STATE_KEY]?.transformTool?.setMode?.("rotate"),
        },
        {
          type: "button",
          id: "btnScale",
          iconClass: "bi bi-aspect-ratio",
          className: "icon-only",
          title: t("app.psg.tb.scale"),
          attrs: { "aria-label": t("app.psg.tb.scale") },
          disabled: true,
          onClick: () => bodyEl?.[STATE_KEY]?.transformTool?.setMode?.("scale"),
        },

        { type: "spacer", width: 6 },

        {
          type: "button",
          id: "btnClip",
          iconClass: "bi bi-scissors",
          className: "icon-only",
          title: t("app.psg.tb.clipping"),
          attrs: { "aria-label": t("app.psg.tb.clipping") },
          disabled: true,
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.cutTool) return;

            const cutTool = st.cutTool;
            const tt = st.transformTool;

            // ✅ selezione multipla reale (array)
            const selection = Array.isArray(tt?.selection) ? tt.selection.filter(Boolean) : [];

            // il cutTool nuovo espone targetRoots[] (array)
            const prevTargets = Array.isArray(cutTool?.targetRoots) ? cutTool.targetRoots : [];
            const hasPrev = prevTargets.length > 0;
            const hasSel = selection.length > 0;

            // D) no prev, no selection
            if (!hasPrev && !hasSel) {
              st.cmdUI?.update?.({ status: te("app.psg.clip_select_first.@") });
              return;
            }

            // C) no prev, selection => usa selection come target
            if (!hasPrev && hasSel) {
              if (selection.length === 1) {
                cutTool.setTarget(selection[0], { resetDefaults: true });
              } else {
                cutTool.setTargets(selection, { resetDefaults: true });
              }
              cutTool.showUI();
              return;
            }

            // A) prev, no selection => mostra toolbar clipping su target esistente
            if (hasPrev && !hasSel) {
              cutTool.showUI();
              if (!cutTool.enabled) cutTool.enable();
              return;
            }

            // B) prev + selection => chiedi se sostituire target
            // (per ora conferma sempre: confrontare arrays è più complesso e non serve)
            const ok = window.confirm(t("app.psg.clip_confirm"));
            if (ok) {
              cutTool.disable();
              if (selection.length === 1) {
                cutTool.setTarget(selection[0], { resetDefaults: true });
              } else {
                cutTool.setTargets(selection, { resetDefaults: true });
              }
              cutTool.showUI();
            } else {
              cutTool.showUI();
              if (!cutTool.enabled) cutTool.enable();
            }
          }
        },


        { type: "spacer", width: 6 },

        {
          type: "button",
          id: "btnErase",
          iconClass: "bi bi-eraser",
          className: "icon-only",
          title: t("app.psg.tb.erase"),
          attrs: { "aria-label": t("app.psg.tb.erase") },
          disabled: true,
          onClick: () => tjsEraseSelected(bodyEl, STATE_KEY),
        },
      ],
    };
  },

  // best-effort: la pulizia vera avviene su AbortSignal (per istanza).
  destroy() {
    // Se rimangono istanze vive per qualche motivo, prova a ripulirle.
    for (const bodyEl of Array.from(ACTIVE_BODIES)) {
      destroyBodyInstance(bodyEl);
    }
  },
};

// -------------------------------
// HELPERS (lifecycle / UI / misc)
// -------------------------------

function attachAbortCleanup(signal, bodyEl) {
  if (!signal || typeof signal.addEventListener !== "function") return;
  signal.addEventListener(
    "abort",
    () => {
      destroyBodyInstance(bodyEl);
    },
    { once: true }
  );
}

function destroyBodyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;

  st.stopped = true;

  try {
    if (st.rafId) cancelAnimationFrame(st.rafId);
  } catch {}

  try {
    if (st.resizeRAF) cancelAnimationFrame(st.resizeRAF);
  } catch {}

  try {
    st.resizeObserver?.disconnect?.();
  } catch {}

  // tile manager panorama
  try { st.tileManager?.dispose?.(); } catch {}

  // tools (se espongono destroy/dispose)
  try { st.cutTool?.destroy?.(); } catch {}
  try { st.cutTool?.dispose?.(); } catch {}
  try { st.transformTool?.destroy?.(); } catch {}
  try { st.transformTool?.dispose?.(); } catch {}

  // controls
  try { st.controlsMgr?.stop?.(); } catch {}
  try { st.orbitControls?.dispose?.(); } catch {}

  // scene objects
  try { disposeObject3D(st.modelsRoot); } catch {}
  try {
    // rimuovi root dalla scena
    if (st.modelsRoot?.parent) st.modelsRoot.parent.remove(st.modelsRoot);
  } catch {}

  // reticle DOM
  try { st.reticleEl?.remove?.(); } catch {}

  // HUD canvas
  try { st.hudCanvas?.remove?.(); } catch {}

  // EffectComposer
  try { st.composer?.dispose?.(); } catch {}

  // Modali PSG
  try { if (st.captureModalEl)  { bootstrap.Modal.getInstance(st.captureModalEl)?.dispose();  st.captureModalEl.remove();  } } catch {}
  try { if (st.pointsModalEl)   { bootstrap.Modal.getInstance(st.pointsModalEl)?.dispose();   st.pointsModalEl.remove();   } } catch {}
  try { if (st.filtersModalEl)  { bootstrap.Modal.getInstance(st.filtersModalEl)?.dispose();  st.filtersModalEl.remove();  } } catch {}

  // renderer / canvas
  try {
    const canvas = st.renderer?.domElement;
    // rimuovi canvas dal DOM se ancora presente
    if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
  } catch {}

  try { st.renderer?.dispose?.(); } catch {}
  try { st.renderer?.forceContextLoss?.(); } catch {}

  // ripristino style bodyEl
  try {
    bodyEl.style.position = st.prevBodyStyle?.position ?? "";
    bodyEl.style.overflow = st.prevBodyStyle?.overflow ?? "";
  } catch {}

  try { delete bodyEl[STATE_KEY]; } catch {}
  ACTIVE_BODIES.delete(bodyEl);
}

/** Utility: dispose sicuro di geometrie/materiali/texture */
function disposeObject3D(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose?.();

    if (obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of materials) {
        for (const k of [
          "map",
          "normalMap",
          "roughnessMap",
          "metalnessMap",
          "aoMap",
          "emissiveMap",
          "alphaMap",
        ]) {
          if (m?.[k]) m[k].dispose?.();
        }
        m?.dispose?.();
      }
    }
  });
}

function tjsCreateReticle(bodyEl) {
  const el = document.createElement("div");
  el.className = "tjs-reticle";
  el.style.position = "absolute";
  el.style.left = "50%";
  el.style.top = "50%";
  el.style.transform = "translate(-50%, -50%)";
  el.style.pointerEvents = "none";
  el.style.display = "none";
  el.style.width = "30px";
  el.style.height = "30px";

  const mk = (css) => {
    const s = document.createElement("div");
    s.style.position = "absolute";
    s.style.background = "white";
    s.style.boxShadow = "0 0 2px rgba(0,0,0,9)";
    Object.assign(s.style, css);
    el.appendChild(s);
  };

  const thickness = "2px";
  const arm = "10px";

  mk({ left: "50%", top: "0", width: thickness, height: arm, transform: "translateX(-50%)" });
  mk({ left: "50%", bottom: "0", width: thickness, height: arm, transform: "translateX(-50%)" });
  mk({ top: "50%", left: "0", height: thickness, width: arm, transform: "translateY(-50%)" });
  mk({ top: "50%", right: "0", height: thickness, width: arm, transform: "translateY(-50%)" });

  bodyEl.appendChild(el);
  return el;
}

function getObjectDisplayName(object) {
  if (!object) return t("app.psg.object.@");
  return (
    object.obj_name ||
    object.obj_title ||
    object.name ||
    object.title ||
    t("app.psg.object_n.@", { id: object.obj_id ?? "" }).trim()
  );
}

function setControlsMode(bodyEl, mode) {
  const st = bodyEl?.[STATE_KEY];
  if (!st?.controlsMgr) return;

  if (mode === "eyelock") {
    // ORBIT -> EYE: salva distanza orbitale
    const cam = st.camera;
    const orbit = st.orbitControls;
    st.orbitDistance = Math.max(0.001, cam.position.distanceTo(orbit.target));
  }

  if (mode === "orbit") {
    // EYE -> ORBIT: riallinea il target in base alla direzione corrente
    const cam = st.camera;
    const orbit = st.orbitControls;

    const dist = Math.max(0.001, st.orbitDistance ?? 10);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);

    orbit.target.copy(cam.position).addScaledVector(fwd, dist);
    orbit.update();
  }

  st.controlsMgr.setMode(mode);
  st.activeControls = mode;
}

// --- Toolbar button sync (ROOT = headerEl o panel) ---
// FIX: i bottoni sono nella toolbar dell’header, non nel bodyEl.

function tjsUpdateProjectionToggleButton(rootEl, bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st?.camera) return;

  const btn = rootEl?.querySelector?.("#btnProjToggle");
  if (!btn) return;

  const icon = btn.querySelector("i");
  if (!icon) return;

  const isOrtho = !!st.camera.isOrthographicCamera;

  // Mostra l’icona della modalità NON attiva
  icon.className = isOrtho ? "bi bi-gem rotate-90" : "bi bi-box";

  const nextTitle = isOrtho ? t("app.psg.tb.perspective") : t("app.psg.tb.axonometric");
  btn.title = nextTitle;
  btn.setAttribute("aria-label", nextTitle);
}

function tjsUpdateControlsToggleButton(rootEl, bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;

  const btn = rootEl?.querySelector?.("#btnCtrlToggle");
  if (!btn) return;

  const icon = btn.querySelector("i");
  if (!icon) return;

  const isEye = st.activeControls === "eyelock";

  icon.className = isEye ? "bi bi-compass" : "bi bi-eye";

  const nextTitle = isEye ? "Orbit" : "EyeLock";
  btn.title = nextTitle;
  btn.setAttribute("aria-label", nextTitle);
}

function tjsUpdateAtToggleButton(rootEl, bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.("#btnAtToggle");
  if (!st || !btn) return;

  const icon = btn.querySelector("i");
  if (!icon) return;

  const isEye = st.activeControls === "eyelock";

  icon.className = isEye
    ? "bi bi-box-arrow-in-up-right"
    : "bi bi-box-arrow-in-down-right";

  const title = isEye
    ? t("app.psg.tb.camera_at")
    : t("app.psg.tb.target_at");
  btn.title = title;
  btn.setAttribute("aria-label", title);
}

/** Utility: fit camera (fallback se non esiste helper globale) */
function fitCameraFallback(camera, controls, object3d, opts = {}) {
  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) return;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z);
  const fitOffset = opts.fitOffset ?? 1.25;

  const fov = camera.fov * (Math.PI / 180);
  const distance = (maxSize / (2 * Math.tan(fov / 2))) * fitOffset;

  const dir = new THREE.Vector3().subVectors(camera.position, controls?.target ?? center).normalize();
  camera.position.copy(center).addScaledVector(dir, distance);

  controls?.target?.copy(center);
  controls?.update?.();

  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
}

// --- PSG: TileManager e TileSphere ---
// Gestione LOD tileizzato per panorami sferici gigapixel.

// Configurazione LOD: nMeridians × nParallels per livello (indice 0 = più grossolano).
const LOD_CONFIGS = [
  { nMeridians: 6,  nParallels: 3 , factor:4},
  { nMeridians: 12, nParallels: 6 , factor:2},
  { nMeridians: 24, nParallels: 12, factor:2},
  { nMeridians: 48, nParallels: 24, factor:1},
  { nMeridians: 96, nParallels: 48, factor:1},
];

class TileManager {
  constructor(scene, camera, options) {
    this.scene      = scene;
    this.camera     = camera;
    this.baseUrl    = options.baseUrl;
    this.thresholds = options.thresholds;
    this.tileSphere = new TileSphere(options.radius);

    this.activeLevel  = -1;
    this.activeTiles  = new Map();  // key "level-P-M" → { mesh, texture }
    this.loadingTiles = new Set();  // chiavi in-flight (anti race-condition)

    this.frustum          = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();

    // Performance: TextureLoader singleton (stateless dopo load(), sicuro da condividere)
    this._textureLoader = new THREE.TextureLoader();
    // Throttle updateVisibility: confronta projScreenMatrix con frame precedente
    this._lastProjScreenMatrix  = new THREE.Matrix4();
    this._needsVisibilityUpdate = true; // forza il primo frame

    // Limita le fetch concorrenti per non saturare la rete
    this._maxConcurrentLoads = 8;
    this._activeLoads = 0;
    this._loadQueue   = [];  // { mesh, key, url, level }
  }

  update() {
    const fov = this.camera.fov;

    // thresholds decrescenti [60,50,40,30,15]: appena fov supera una soglia ci fermiamo.
    let newLevel = 0;
    for (let i = 0; i < this.thresholds.length; i++) {
      if (fov <= this.thresholds[i]) { newLevel = i; } else { break; }
    }

    if (newLevel !== this.activeLevel) {
      this.switchLevel(newLevel);
      return; // le nuove mesh saranno processate dal prossimo frame
    }

    this.updateVisibility();
  }

  switchLevel(level) {
    // Ordine critico:
    // 1. Rimuovere mesh dalla scena PRIMA di disposeMeshes()
    // 2. Salvare texture uscenti per i placeholder del nuovo livello
    // 3. Costruire nuove mesh con placeholder; liberare texture originali
    this.tileSphere.tileMeshes.forEach(mesh => this.scene.remove(mesh));

    const prevTextures  = new Map();
    this.activeTiles.forEach((item, key) => prevTextures.set(key, item.texture));

    this.activeTiles.clear();
    this.loadingTiles.clear();
    this._loadQueue   = [];
    this._activeLoads = 0;
    this.activeLevel = level;

    const { nMeridians, nParallels, factor } = LOD_CONFIGS[level];
    this.tileSphere.createLevelMeshes(level, nMeridians, nParallels, factor, (mesh, lvl, M, P) => {
      this._applyPlaceholder(mesh, M, P, level - 1, prevTextures);
      this.scene.add(mesh);
    });

    // I clone nei placeholder sono GPU-indipendenti: le originali possono essere liberate.
    prevTextures.forEach(tex => tex.dispose());
    this._needsVisibilityUpdate = true;
  }

  /**
   * Applica come placeholder il clone della texture del tile padre (livello L-1).
   * Ogni livello raddoppia entrambe le dimensioni → tile (M,P) a livello L
   * corrisponde al quadrante (M%2, P%2) del tile (⌊M/2⌋, ⌊P/2⌋) a livello L-1.
   *
   * UV (SphereGeometry: u=phi 0→1, v=theta 1→0 alto→basso):
   *   offset_u = (M%2)*0.5      → metà sinistra o destra del padre
   *   offset_v = 0.5 se P pari  → metà superiore; 0.0 se dispari → metà inferiore
   *   repeat   = (0.5, 0.5)     → un quarto del tile padre
   */
  _applyPlaceholder(mesh, M, P, parentLevel, prevTextures) {
    if (parentLevel < 0) return;

    const parentKey = `${parentLevel}-${Math.floor(P / 2)}-${Math.floor(M / 2)}`;
    const parentTex = prevTextures.get(parentKey);
    if (!parentTex) return;

    // Clone indipendente: uuid diverso → oggetto GPU separato.
    const placeholder = parentTex.clone();
    placeholder.generateMipmaps = false;
    placeholder.minFilter = THREE.LinearFilter;
    placeholder.wrapS = THREE.ClampToEdgeWrapping;
    placeholder.wrapT = THREE.ClampToEdgeWrapping;
    placeholder.repeat.set(0.5, 0.5);
    placeholder.offset.set(
      (M % 2) * 0.5,
      (P % 2 === 0) ? 0.5 : 0.0
    );
    placeholder.needsUpdate = true;

    mesh.material.map = placeholder;
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
    mesh.userData.placeholderTexture = placeholder;
  }

  updateVisibility() {
    // Throttle: salta se camera, FOV e aspect non sono cambiati.
    // projScreenMatrix cattura tutti questi casi in un'unica comparazione.
    this.projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );

    if (!this._needsVisibilityUpdate &&
        !_matricesDiffer(this.projScreenMatrix, this._lastProjScreenMatrix)) {
      return;
    }

    this._lastProjScreenMatrix.copy(this.projScreenMatrix);
    this._needsVisibilityUpdate = false;
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    this.tileSphere.tileMeshes.forEach(mesh => {
      const { M, P } = mesh.userData;
      const key = `${this.activeLevel}-${P}-${M}`;

      // BBox pre-calcolata alla creazione: nessun ricalcolo ogni frame.
      const visible = this.frustum.intersectsBox(mesh.userData.bbox);
      mesh.visible  = visible;

      if (visible) {
        if (!this.activeTiles.has(key) && !this.loadingTiles.has(key)) {
          this._loadTileTexture(mesh);
        }
      } else {
        if (this.activeTiles.has(key)) {
          this._unloadTileTexture(key);
        }
      }
    });
  }

  _loadTileTexture(mesh) {
    const { M, P } = mesh.userData;
    const level = this.activeLevel;
    const key   = `${level}-${P}-${M}`;
    const url   = `${this.baseUrl}/Livello-${level}/img${P}-${M}.jpg`;

    this.loadingTiles.add(key);

    if (this._activeLoads < this._maxConcurrentLoads) {
      this._fetchTile(mesh, key, url, level);
    } else {
      this._loadQueue.push({ mesh, key, url, level });
    }
  }

  _fetchTile(mesh, key, url, level) {
    this._activeLoads++;

    this._textureLoader.load(
      url,
      (texture) => {
        this._activeLoads--;
        this.loadingTiles.delete(key);

        // Texture stale: il livello è cambiato mentre era in volo
        if (this.activeLevel !== level) { texture.dispose(); this._drainQueue(); return; }

        // Nessun mipmap: la camera è sempre dentro la sfera, le tile sono
        // sempre vicine. I mipmap non migliorano la qualità e occupano ~33% di VRAM.
        texture.generateMipmaps = false;
        texture.minFilter       = THREE.LinearFilter;
        texture.colorSpace      = THREE.SRGBColorSpace;

        if (mesh.userData.placeholderTexture) {
          mesh.userData.placeholderTexture.dispose();
          delete mesh.userData.placeholderTexture;
        }

        mesh.material.map = texture;
        mesh.material.color.set(0xffffff);
        mesh.material.needsUpdate = true;
        this.activeTiles.set(key, { mesh, texture });
        this._drainQueue();
      },
      undefined,
      (err) => {
        this._activeLoads--;
        this.loadingTiles.delete(key);
        console.warn(`PSG: tile fallito [${key}] — ${url}`, err);
        this._drainQueue();
      }
    );
  }

  _drainQueue() {
    while (this._loadQueue.length > 0 && this._activeLoads < this._maxConcurrentLoads) {
      const item = this._loadQueue.shift();
      // salta se livello cambiato o tile già non più in loading
      if (item.level !== this.activeLevel || !this.loadingTiles.has(item.key)) continue;
      this._fetchTile(item.mesh, item.key, item.url, item.level);
    }
  }

  _unloadTileTexture(key) {
    const item = this.activeTiles.get(key);
    if (!item) return;
    const { mesh, texture } = item;

    mesh.visible = false;
    mesh.material.map = null;
    mesh.material.color.set(0x2a2a2a);
    mesh.material.needsUpdate = true;
    texture.dispose();
    this.activeTiles.delete(key);
  }

  dispose() {
    this.tileSphere.tileMeshes.forEach(mesh => this.scene.remove(mesh));
    this.activeTiles.forEach(item => item.texture?.dispose());
    this.activeTiles.clear();
    this.loadingTiles.clear();
    this._loadQueue   = [];
    this._activeLoads = 0;
    this.tileSphere.disposeMeshes();
  }
}

class TileSphere {
  constructor(radius = 1) {
    this.radius     = radius;
    this.tileMeshes = [];
  }

  /**
   * Crea tutte le mesh per il livello LOD specificato.
   * Suddivisione uniforme originale: nMeridians × nParallels tile.
   * BBox pre-calcolata dopo scale(-1,1,1) per il frustum culling senza ricalcolo ogni frame.
   */
  createLevelMeshes(level, nMeridians, nParallels, factor, onTileCreated) {
    this.disposeMeshes();

    const phiSegs   = nMeridians * factor;  // texture fornisce il dettaglio; 4 segmenti per tile bastano
    const thetaSegs = nParallels * factor;

    for (let M = 0; M < nMeridians; M++) {
      const phiStart  = (M / nMeridians) * Math.PI * 2;
      const phiLength = (1 / nMeridians) * Math.PI * 2;

      for (let P = 0; P < nParallels; P++) {
        const thetaStart  = (P / nParallels) * Math.PI;
        const thetaLength = (1 / nParallels) * Math.PI;

        const geom = new THREE.SphereGeometry(
          this.radius,
          phiSegs, thetaSegs,
          phiStart, phiLength,
          thetaStart, thetaLength
        );
        geom.scale(-1, 1, 1);

        // computeBoundingBox DOPO scale: la mesh è statica, calcoliamo una volta sola.
        geom.computeBoundingBox();
        const bbox = geom.boundingBox.clone();

        const mat  = new THREE.MeshBasicMaterial({ map: null, color: 0x2a2a2a });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData = { M, P, bbox };

        this.tileMeshes.push(mesh);
        if (onTileCreated) onTileCreated(mesh, level, M, P);
      }
    }

    return this.tileMeshes;
  }

  disposeMeshes() {
    this.tileMeshes.forEach(mesh => {
      if (mesh.userData.placeholderTexture) {
        mesh.userData.placeholderTexture.dispose();
        delete mesh.userData.placeholderTexture;
      }
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        mesh.material.map = null; // texture gestite da TileManager, non disponiamo qui
        mesh.material.dispose();
      }
    });
    this.tileMeshes = [];
  }
}

/** Confronto Matrix4 elemento per elemento con tolleranza. */
function _matricesDiffer(a, b, eps = 1e-7) {
  const ae = a.elements, be = b.elements;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ae[i] - be[i]) > eps) return true;
  }
  return false;
}


// ─── PSG helpers ─────────────────────────────────────────────────────────────

/** Mirino rosso 30×30 px con gap centrale 6×6 px. */
function psgCreateCrosshair(bodyEl) {
  const SIZE = 30, GAP = 6, ARM = (SIZE - GAP) / 2, THICK = 2;
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.left = el.style.top = "50%";
  el.style.transform = "translate(-50%,-50%)";
  el.style.width = SIZE + "px";
  el.style.height = SIZE + "px";
  el.style.pointerEvents = "none";
  el.style.display = "none";
  el.style.zIndex = "8";
  const mkArm = (css) => {
    const d = document.createElement("div");
    d.style.position = "absolute";
    d.style.background = "rgba(255,50,50,1)";
    d.style.boxShadow = "0 0 3px rgba(0,0,0,.9)";
    Object.assign(d.style, css);
    el.appendChild(d);
  };
  const h = SIZE / 2;
  mkArm({ left: (h - THICK/2) + "px", top:    "0",  width: THICK+"px", height: ARM+"px" });
  mkArm({ left: (h - THICK/2) + "px", bottom: "0",  width: THICK+"px", height: ARM+"px" });
  mkArm({ top:  (h - THICK/2) + "px", left:   "0",  height: THICK+"px", width: ARM+"px" });
  mkArm({ top:  (h - THICK/2) + "px", right:  "0",  height: THICK+"px", width: ARM+"px" });
  bodyEl.appendChild(el);
  return el;
}

/** Due checkbox Bootstrap (Az/Ze + Mirino) nei controls del footer. */
function psgSetupControls(state, cmdUI) {
  const uid  = "psg" + Date.now();
  const mkCk = (id, label, checked) => {
    const wrap  = document.createElement("div");
    wrap.className = "form-check form-check-inline mb-0";
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "checkbox";
    input.id = id;
    input.checked = checked;
    const lbl = document.createElement("label");
    lbl.className = "form-check-label text-white";
    lbl.style.fontSize = "0.75rem";
    lbl.htmlFor = id;
    lbl.textContent = label;
    wrap.append(input, lbl);
    return { wrap, input };
  };
  const ck1 = mkCk(uid + "_h", "Az/Ze",  true);
  const ck2 = mkCk(uid + "_c", t("app.psg.crosshair"), false);

  ck1.input.addEventListener("change", () => {
    state.hudVisible = ck1.input.checked;
    if (!state.hudVisible && state.hudCanvas) {
      state.hud2d.clearRect(0, 0, state.hudCanvas.width, state.hudCanvas.height);
      state.psgLastStatus = "";
    }
  });
  ck2.input.addEventListener("change", () => {
    state.crosshairVisible = ck2.input.checked;
    if (state.crosshairEl)
      state.crosshairEl.style.display = state.crosshairVisible ? "block" : "none";
  });

  const btnFlt = document.createElement("button");
  btnFlt.type      = "button";
  btnFlt.className = "btn btn-sm btn-outline-light py-0 px-2";
  btnFlt.style.fontSize = "0.70rem";
  btnFlt.textContent = t("app.psg.filters");
  btnFlt.addEventListener("click", () => psgOpenFiltersModal(state));

  const wrap = document.createElement("div");
  wrap.className = "d-flex gap-2 align-items-center";
  wrap.append(ck1.wrap, ck2.wrap, btnFlt);
  cmdUI.update({ controls: wrap });
}

/** Modale acquisizione punto collimato (Spazio con mirino attivo). */
function psgOpenCaptureModal(state, az, ze) {
  if (!state.captureModalEl) {
    const tmp = document.createElement("div");
    tmp.innerHTML = '<div class="modal fade" tabindex="-1">'
      + '<div class="modal-dialog modal-fullscreen-md-down"><div class="modal-content bg-dark text-white">'
      + '<div class="modal-header border-secondary py-2">'
      + '<h6 class="modal-title mb-0">' + te("app.psg.point_title") + '</h6>'
      + '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="' + te("common.close") + '"></button>'
      + '</div><div class="modal-body py-2">'
      + '<p class="mb-2 small text-secondary">'
      + 'Az: <span class="psg-az text-white fw-bold">\u2014</span> &nbsp; '
      + 'Ze: <span class="psg-ze text-white fw-bold">\u2014</span></p>'
      + '<div class="mb-2"><label class="form-label small mb-1">' + te("common.name") + '</label>'
      + '<input class="form-control form-control-sm bg-secondary text-white border-0 psg-name" placeholder="' + te("app.psg.point_name_ph") + '" aria-label="' + te("common.name") + '"></div>'
      + '<div class="row g-2">'
      + '<div class="col-4"><label class="form-label small mb-1">X</label>'
      + '<input class="form-control form-control-sm bg-secondary text-white border-0 psg-x" type="number" value="0" step="0.001"></div>'
      + '<div class="col-4"><label class="form-label small mb-1">Y</label>'
      + '<input class="form-control form-control-sm bg-secondary text-white border-0 psg-y" type="number" value="0" step="0.001"></div>'
      + '<div class="col-4"><label class="form-label small mb-1">Z</label>'
      + '<input class="form-control form-control-sm bg-secondary text-white border-0 psg-z" type="number" value="0" step="0.001"></div>'
      + '</div></div>'
      + '<div class="modal-footer border-secondary py-2">'
      + '<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">' + te("common.cancel") + '</button>'
      + '<button type="button" class="btn btn-primary btn-sm psg-save">' + te("common.save") + '</button>'
      + '</div></div></div></div>';
    state.captureModalEl = tmp.firstElementChild;
    document.body.appendChild(state.captureModalEl);
  }
  const el  = state.captureModalEl;
  const fmt = (v) => v.toFixed(2).padStart(6, "0") + "\u00b0";
  el.querySelector(".psg-az").textContent = fmt(az);
  el.querySelector(".psg-ze").textContent = fmt(ze);
  el.querySelector(".psg-name").value = t("app.psg.point_n", { n: state.capturedPoints.length + 1 });
  el.querySelector(".psg-x").value = "0";
  el.querySelector(".psg-y").value = "0";
  el.querySelector(".psg-z").value = "0";

  const bsModal = bootstrap.Modal.getOrCreateInstance(el);
  const oldBtn  = el.querySelector(".psg-save");
  const newBtn  = oldBtn.cloneNode(true);
  oldBtn.replaceWith(newBtn);
  newBtn.addEventListener("click", () => {
    state.capturedPoints.push({
      id:   Date.now(),
      name: el.querySelector(".psg-name").value.trim() || t("app.psg.point_n", { n: state.capturedPoints.length + 1 }),
      x:    parseFloat(el.querySelector(".psg-x").value) || 0,
      y:    parseFloat(el.querySelector(".psg-y").value) || 0,
      z:    parseFloat(el.querySelector(".psg-z").value) || 0,
      az, ze,
    });
    bsModal.hide();
  }, { once: true });
  bsModal.show();
}

/** Modale lista punti collimati: editabile + fly-to per ogni riga. */
function psgOpenPointsListModal(state) {
  if (!state.pointsModalEl) {
    const tmp = document.createElement("div");
    tmp.innerHTML = '<div class="modal fade" tabindex="-1">'
      + '<div class="modal-dialog modal-fullscreen-md-down modal-lg"><div class="modal-content bg-dark text-white">'
      + '<div class="modal-header border-secondary py-2">'
      + '<h6 class="modal-title mb-0">' + te("app.psg.points_title") + '</h6>'
      + '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="' + te("common.close") + '"></button>'
      + '</div><div class="modal-body p-2">'
      + '<table class="table table-dark table-sm table-bordered mb-1">'
      + '<thead><tr><th>' + te("common.name") + '</th><th>X</th><th>Y</th><th>Z</th>'
      + '<th>Az</th><th>Ze</th>'
      + '<th class="text-center" style="width:48px"></th></tr></thead>'
      + '<tbody class="psg-pts-tbody"></tbody></table>'
      + '<p class="psg-no-pts text-muted text-center small mb-0">' + te("app.psg.no_points") + '</p>'
      + '</div>'
      + '<div class="modal-footer border-secondary py-2">'
      + '<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">' + te("common.close") + '</button>'
      + '</div></div></div></div>';
    state.pointsModalEl = tmp.firstElementChild;
    document.body.appendChild(state.pointsModalEl);
  }
  const el    = state.pointsModalEl;
  const tbody = el.querySelector(".psg-pts-tbody");
  const noMsg = el.querySelector(".psg-no-pts");
  const fmt   = (v) => v.toFixed(2).padStart(6, "0") + "\u00b0";
  const fmtN  = (v) => (isFinite(v) ? v.toFixed(3) : "0.000");

  tbody.innerHTML = "";
  const pts = state.capturedPoints;
  noMsg.style.display = pts.length ? "none" : "";

  pts.forEach((pt) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input class="form-control form-control-sm bg-secondary text-white border-0 p-1 psg-n" value="'
        + _psgEsc(pt.name) + '"></td>'
      + '<td><input class="form-control form-control-sm bg-secondary text-white border-0 p-1 psg-px"'
        + ' type="number" step="0.001" value="' + fmtN(pt.x) + '"></td>'
      + '<td><input class="form-control form-control-sm bg-secondary text-white border-0 p-1 psg-py"'
        + ' type="number" step="0.001" value="' + fmtN(pt.y) + '"></td>'
      + '<td><input class="form-control form-control-sm bg-secondary text-white border-0 p-1 psg-pz"'
        + ' type="number" step="0.001" value="' + fmtN(pt.z) + '"></td>'
      + '<td class="small align-middle text-nowrap">' + fmt(pt.az) + '</td>'
      + '<td class="small align-middle text-nowrap">' + fmt(pt.ze) + '</td>'
      + '<td class="text-center align-middle">'
        + '<button class="btn btn-sm btn-outline-info py-0 px-1 psg-eye" title="' + te("app.psg.go_to_point") + '" aria-label="' + te("app.psg.go_to_point") + '">'
        + '<i class="bi bi-eye" aria-hidden="true"></i></button></td>';
    const [inN, inX, inY, inZ] = tr.querySelectorAll("input");
    inN.addEventListener("change", () => { pt.name = inN.value; });
    inX.addEventListener("change", () => { pt.x = parseFloat(inX.value) || 0; });
    inY.addEventListener("change", () => { pt.y = parseFloat(inY.value) || 0; });
    inZ.addEventListener("change", () => { pt.z = parseFloat(inZ.value) || 0; });
    tr.querySelector(".psg-eye").addEventListener("click", () => {
      bootstrap.Modal.getInstance(el)?.hide();
      psgFlyToAzZe(state, pt.az, pt.ze);
    });
    tbody.appendChild(tr);
  });
  bootstrap.Modal.getOrCreateInstance(el).show();
}

/**
 * Fly-to animato verso (azDeg, zeDeg) con easeInOutSine.
 * yaw = PI - az_rad  |  pitch = PI/2 - ze_rad
 */
function psgFlyToAzZe(state, azDeg, zeDeg, duration) {
  if (duration === undefined) duration = 1.5;
  const PI       = Math.PI;
  const tgtYaw   = PI - (azDeg * PI / 180);
  const tgtPitch = Math.max(-PI / 2 + 0.01,
                   Math.min( PI / 2 - 0.01, PI / 2 - (zeDeg * PI / 180)));
  if (state.activeControls !== "eyelock") {
    state.controlsMgr.setMode("eyelock");
    state.activeControls = "eyelock";
  }
  const eye = state.eyeLockControls;
  let dYaw = tgtYaw - eye.yaw;
  while (dYaw >  PI) dYaw -= 2 * PI;
  while (dYaw < -PI) dYaw += 2 * PI;
  state.flyTo = {
    startYaw:   eye.yaw,
    startPitch: eye.pitch,
    dYaw:       dYaw,
    dPitch:     tgtPitch - eye.pitch,
    startTime:  performance.now(),
    duration:   duration,
  };
}

// ─── PSG Filters ─────────────────────────────────────────────────────────────

/** Aggiorna un singolo uniform e lo stato locale. */
function psgSetFilter(state, key, val) {
  state.filterUniforms[key] = val;
  const uKey = `u_${key}`;
  if (state.filterPass?.uniforms[uKey] !== undefined)
    state.filterPass.uniforms[uKey].value = val;
}

/** Apre il modal filtri (lazy creation). */
function psgOpenFiltersModal(state) {
  if (!state.filtersModalEl) {
    const tmp = document.createElement("div");
    tmp.innerHTML = _psgFiltersModalHTML();
    state.filtersModalEl = tmp.firstElementChild;
    document.body.appendChild(state.filtersModalEl);
    _psgWireFiltersModal(state);
  } else {
    _psgSyncFiltersUI(state);
  }
  bootstrap.Modal.getOrCreateInstance(state.filtersModalEl).show();
}

/** Costruisce l'HTML del modal filtri. */
function _psgFiltersModalHTML() {
  const presets = [
    {k:"reset",l:te("common.none")},{k:"warm",l:te("app.psg.preset.warm")},{k:"cool",l:te("app.psg.preset.cool")},
    {k:"bw",l:"B&amp;W"},{k:"sepia",l:te("app.psg.flt.sepia")},{k:"night",l:te("app.psg.flt.night")},
    {k:"inferno",l:"Inferno"},{k:"viridis",l:"Viridis"},
    {k:"vivid",l:te("app.psg.preset.vivid")},{k:"faded",l:te("app.psg.preset.faded")},
  ];
  let h = `
  <div class="modal fade" tabindex="-1">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg">
  <div class="modal-content bg-dark text-white">
  <div class="modal-header border-secondary py-2">
    <h6 class="modal-title mb-0"><i class="bi bi-sliders me-2" aria-hidden="true"></i>${te("app.psg.filters_title")}</h6>
    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="${te("common.close")}"></button>
  </div>
  <div class="modal-body p-2" style="max-height:70vh;overflow-y:auto;">
    <div class="d-flex flex-wrap gap-1 mb-3">`;
  for (const p of presets)
    h += `<button type="button" class="btn btn-sm btn-outline-secondary psg-flt-preset" data-preset="${p.k}">${p.l}</button>`;
  h += `</div><div class="accordion accordion-flush" id="psgFltAcc">`;

  psgFilterDefs().forEach((sec, si) => {
    const open = si === 0 ? "show" : "";
    const coll = si === 0 ? ""       : "collapsed";
    h += `
    <div class="accordion-item border-secondary" style="background:#1a1a24">
    <h2 class="accordion-header">
      <button class="accordion-button ${coll}" type="button"
              data-bs-toggle="collapse" data-bs-target="#psgFltS${si}"
              style="background:#1a1a24;color:#fff;font-size:.82rem;padding:.45rem .7rem">
        <i class="bi ${sec.icon} me-2" aria-hidden="true"></i>${_psgEsc(sec.section)}
      </button>
    </h2>
    <div id="psgFltS${si}" class="accordion-collapse collapse ${open}">
    <div class="accordion-body p-2">`;

    for (const item of sec.items) {
      h += `<div class="row align-items-center mb-1 g-1">
        <div class="col-3"><span class="small text-white-50">${_psgEsc(item.label)}</span></div>`;
      if (item.type === "select") {
        h += `<div class="col-9"><select class="form-select form-select-sm bg-secondary text-white border-0 psg-flt-ctrl" data-flt="${item.key}" aria-label="${_psgEsc(item.label)}">`;
        for (const o of item.options)
          h += `<option value="${o.v}">${_psgEsc(o.l)}</option>`;
        h += `</select></div>`;
      } else {
        const dv = PSG_FILTER_DEFAULTS[item.key];
        h += `<div class="col-7"><input type="range" class="form-range psg-flt-ctrl"
               data-flt="${item.key}" aria-label="${_psgEsc(item.label)}" min="${item.min}" max="${item.max}"
               step="${item.step}" value="${dv}"></div>
              <div class="col-2 text-end"><span class="small psg-flt-val" data-flt="${item.key}">${item.fmt(dv)}</span></div>`;
      }
      h += `</div>`;
    }
    h += `</div></div></div>`;
  });

  h += `</div></div>
  <div class="modal-footer border-secondary py-2">
    <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">${te("common.close")}</button>
    <button type="button" class="btn btn-sm btn-outline-danger psg-flt-reset-all">${te("app.psg.reset_all")}</button>
  </div>
  </div></div></div>`;
  return h;
}

/** Collega gli eventi del modal allo stato. */
function _psgWireFiltersModal(state) {
  const el   = state.filtersModalEl;
  const defs = psgFilterDefs().flatMap(s => s.items);

  el.querySelectorAll(".psg-flt-ctrl").forEach(ctrl => {
    const key = ctrl.dataset.flt;
    const def = defs.find(d => d.key === key);
    const onInput = () => {
      const v = parseFloat(ctrl.value);
      psgSetFilter(state, key, v);
      const vEl = el.querySelector(`.psg-flt-val[data-flt="${key}"]`);
      if (vEl && def?.fmt) vEl.textContent = def.fmt(v);
    };
    ctrl.addEventListener("input",  onInput);
    ctrl.addEventListener("change", onInput);
  });

  el.querySelectorAll(".psg-flt-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = PSG_FILTER_PRESETS[btn.dataset.preset];
      if (!preset) return;
      for (const [k, v] of Object.entries(preset)) psgSetFilter(state, k, v);
      _psgSyncFiltersUI(state);
    });
  });

  el.querySelector(".psg-flt-reset-all").addEventListener("click", () => {
    for (const [k, v] of Object.entries(PSG_FILTER_DEFAULTS)) psgSetFilter(state, k, v);
    _psgSyncFiltersUI(state);
  });
}

/** Sincronizza i controlli UI con filterUniforms correnti (usato su riapertura/preset). */
function _psgSyncFiltersUI(state) {
  const el = state.filtersModalEl;
  if (!el) return;
  const defs = psgFilterDefs().flatMap(s => s.items);
  el.querySelectorAll(".psg-flt-ctrl").forEach(ctrl => {
    const key = ctrl.dataset.flt;
    const val = state.filterUniforms[key] ?? PSG_FILTER_DEFAULTS[key];
    ctrl.value = val;
    const def = defs.find(d => d.key === key);
    const vEl = el.querySelector(`.psg-flt-val[data-flt="${key}"]`);
    if (vEl && def?.fmt) vEl.textContent = def.fmt(parseFloat(val));
  });
}

function _psgEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
