// model_renderers.js (NON-module bridge)
//
// ReseArch V1.0 convention (FINAL):
//   (container, object, models)
//
// Each renderer ES module MUST export:
//   export function render(container, object, models) { ... }
//   // async is allowed
//
// This facade exposes non-module functions on window.ModelRenderers,
// while lazily loading the real renderers via dynamic import().

(function initModelRenderersBridge() {
  window.ModelRenderers = window.ModelRenderers || {};
  const MR = window.ModelRenderers;

  // Cache delle Promise dei moduli (lazy-load, una sola volta per path)
  const __rendererModulePromises = Object.create(null);

  function importRendererModule(path) {
    if (!path || typeof path !== 'string') {
      throw new Error('importRendererModule: path non valido');
    }
    if (!__rendererModulePromises[path]) {
      __rendererModulePromises[path] = import(path);
    }
    return __rendererModulePromises[path];
  }

  // Config: dove stanno i moduli ES.
  // Path RELATIVI: se model_renderers.js è nella stessa cartella dei model_XXX.mjs

  const DEFAULT_RENDERER = './template_XXX.mjs';

  // 'FLE' = editor dei flow (sigla interna, non un'APP degli oggetti: vedi
  // SPEC_REGISTRY in template_XXX.mjs e ui/modal_flow_embedded.js).
  const APPS = [
    'CSV','DBJ','ECH','FLE','GSH','HTM','HYS','IFC','JSX','MPS','MYS','OLY','OSD','OWL','PDF','PJS','TJS','TML','VID','PSG'
  ];

  const RENDERERS = Object.fromEntries(
    APPS.map(app => [app, DEFAULT_RENDERER])
  );

  // eventuali override
  //RENDERERS.TJS = './template_TJS.mjs';

  async function runRenderer(key, container, object, models) {
    const modPath = RENDERERS[key];
    if (!modPath) throw new Error(`Renderer non configurato: ${key}`);

    const mod = await importRendererModule(modPath);

    // Convenzione: ogni modulo esporta render(container, object, models)
    if (typeof mod.render !== 'function') {
      throw new Error(`Il modulo ${modPath} non esporta "render(container, object, models)"`);
    }

    return mod.render(container, object, models);
  }

  // API generica (ordine: container, object, models)
  MR.run = (key, container, object, models) => runRenderer(key, container, object, models);

  // Helpers di configurazione
  MR.keys = () => Object.keys(RENDERERS);
  MR.getPath = (key) => RENDERERS[key];
  MR.setPath = (key, path) => {
    if (!key) throw new Error('setPath: key mancante');
    if (!path || typeof path !== 'string') throw new Error('setPath: path non valido');
    RENDERERS[key] = path;
  };
  MR.preload = (key) => {
    const modPath = RENDERERS[key];
    if (!modPath) throw new Error(`Renderer non configurato: ${key}`);
    return importRendererModule(modPath);
  };

  // API specifiche (signature: container, object, models)
  for (const key of Object.keys(RENDERERS)) {
    MR[key] = (container, object, models) => runRenderer(key, container, object, models);
  }
})();
