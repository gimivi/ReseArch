// app/OSD_sub_modules/OSD-ui-filtersModal.mjs
// Pannello laterale filtri immagine OSD via openseadragon-filters (WebGL).
//
// Esportazioni:
//   openFiltersPanel({ bodyEl })          — toggle pannello (toolbar)
//   applyFiltersFromEnv(bodyEl)           — applica/aggiorna filtri da _env.filters (chiamare dopo importEnvelope)

import { getState } from "../PJS_sub_modules/PJS-core.mjs";
import { t, te } from "../shared/i18n.mjs";

const PANEL_KEY = '_osdFiltersPanel';

// ── Lazy load libreria ────────────────────────────────────────────────────────
let _lib = null, _libError = null;

async function ensureLib() {
  if (_lib)      return _lib;
  if (_libError) return null;
  try {
    _lib = await import('https://cdn.jsdelivr.net/npm/openseadragon-filters/+esm');
    return _lib;
  } catch (e) {
    _libError = e;
    console.error('[OSD-filters] Impossibile caricare openseadragon-filters:', e);
    return null;
  }
}

// ── Plugin WebGL per viewer ───────────────────────────────────────────────────
const _plugins = new WeakMap();

function getOrCreatePlugin(viewer) {
  if (_plugins.has(viewer)) return _plugins.get(viewer);
  const p = _lib.initWebGLFiltering(viewer);
  _plugins.set(viewer, p);
  return p;
}

// ── Preset convoluzione ───────────────────────────────────────────────────────
// k: kernel 3×3 (9 valori float, somma=1 → area uniforme invariata,
//                                somma=0 → area uniforme → nero, usare offset)
// offset: aggiunto al risultato prima del clamp (0.5 centra il nero su grigio medio)
const KERNELS = {
  sharpen: { k: [ 0,   -1,    0,   -1,   5,   -1,    0,   -1,    0  ], offset: 0.0 },
  blur:    { k: [ 1/9,  1/9,  1/9,  1/9, 1/9,  1/9,  1/9,  1/9,  1/9], offset: 0.0 },
  edge:    { k: [ 0,    1,    0,    1,  -4,    1,    0,    1,    0  ], offset: 0.0 },
  emboss:  { k: [-2,   -1,    0,   -1,   0,    1,    0,    1,    2  ], offset: 0.5 },
};

// Shader di convoluzione con u_textureSize esplicito e u_offset opzionale.
// CONVOLUTION_WEBGL della libreria non imposta mai u_textureSize (rimane [0,0]),
// causando divisione per zero → campioni nell'angolo → artefatti "massa marrone".
// u_spread: distanza di campionamento in pixel (default 1.0).
// u_strength: blend tra originale e filtrato via mix() — 0=originale, 1=pieno effetto, >1=over.
const CONVOLUTION_SHADER = `precision mediump float;
uniform sampler2D u_image;
uniform vec2  u_textureSize;
uniform float u_kernel[9];
uniform float u_offset;
uniform float u_strength;
uniform float u_spread;
varying vec2 v_texCoord;
void main() {
  vec2 p = vec2(u_spread) / u_textureSize;
  vec4 orig = texture2D(u_image, v_texCoord);
  vec4 s =
    texture2D(u_image, v_texCoord + p * vec2(-1.0,-1.0)) * u_kernel[0] +
    texture2D(u_image, v_texCoord + p * vec2( 0.0,-1.0)) * u_kernel[1] +
    texture2D(u_image, v_texCoord + p * vec2( 1.0,-1.0)) * u_kernel[2] +
    texture2D(u_image, v_texCoord + p * vec2(-1.0, 0.0)) * u_kernel[3] +
    texture2D(u_image, v_texCoord + p * vec2( 0.0, 0.0)) * u_kernel[4] +
    texture2D(u_image, v_texCoord + p * vec2( 1.0, 0.0)) * u_kernel[5] +
    texture2D(u_image, v_texCoord + p * vec2(-1.0, 1.0)) * u_kernel[6] +
    texture2D(u_image, v_texCoord + p * vec2( 0.0, 1.0)) * u_kernel[7] +
    texture2D(u_image, v_texCoord + p * vec2( 1.0, 1.0)) * u_kernel[8];
  vec3 filtered = clamp(s.rgb + u_offset, 0.0, 1.0);
  gl_FragColor = vec4(mix(orig.rgb, filtered, u_strength), orig.a);
}`;

function getConvolutionFilter(name, convParams, viewer) {
  const def = KERNELS[name];
  if (!def || !_lib?.convertToWebGLFilter) return null;
  const w = viewer?.canvas?.width  || viewer?.container?.clientWidth  || 1024;
  const h = viewer?.canvas?.height || viewer?.container?.clientHeight || 768;
  const cp = convParams || {};
  return _lib.convertToWebGLFilter('osd-conv', CONVOLUTION_SHADER, {
    u_kernel:       def.k,
    u_textureSize:  [w, h],
    u_offset:       def.offset,
    u_strength:     cp.strength ?? 1.0,
    u_spread:       cp.spread   ?? 1.0,
  });
}

// ── Preset colormap (GLSL ES 1.0 compatibili, no dynamic array indexing) ──────
const COLORMAP_STOPS = {
  viridis: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  inferno: [[0,0,4],[120,28,109],[187,55,84],[249,142,9],[252,255,164]],
  jet:     [[0,0,143],[0,0,255],[0,255,255],[255,255,0],[255,128,0],[128,0,0]],
  hot:     [[0,0,0],[255,0,0],[255,255,0],[255,255,255]],
};
const _colormapFilters = {};

function makeColormapShader(stops) {
  const segs = stops.length - 1;
  const n    = (v) => v.toFixed(5);
  const lines = stops.slice(0, -1).map((s0, i) => {
    const s1 = stops[i + 1];
    const t0 = n(i / segs), t1 = n((i + 1) / segs);
    const kw = i === 0 ? 'if' : 'else if';
    const cd = i < segs - 1 ? `${kw} (t < ${t1})` : 'else';
    return `  ${cd} { c = mix(` +
      `vec3(${n(s0[0]/255)},${n(s0[1]/255)},${n(s0[2]/255)}), ` +
      `vec3(${n(s1[0]/255)},${n(s1[1]/255)},${n(s1[2]/255)}), ` +
      `(t - ${t0}) * ${segs}.0); }`;
  });
  return `precision mediump float;
uniform sampler2D u_image;
varying vec2 v_texCoord;
void main() {
  vec4 color = texture2D(u_image, v_texCoord);
  float t = clamp(dot(color.rgb, vec3(0.299,0.587,0.114)), 0.0, 1.0);
  vec3 c;
${lines.join('\n')}
  gl_FragColor = vec4(c, color.a);
}`;
}

function getColormapFilter(name) {
  if (!COLORMAP_STOPS[name] || !_lib?.convertToWebGLFilter) return null;
  if (_colormapFilters[name]) return _colormapFilters[name];
  _colormapFilters[name] = _lib.convertToWebGLFilter(
    `osd-cmap-${name}`, makeColormapShader(COLORMAP_STOPS[name]), {}
  );
  return _colormapFilters[name];
}

// ── Shader custom ─────────────────────────────────────────────────────────────
const WRAPPER_LINES = 8;

function wrapShader(body) {
  return `precision mediump float;
uniform sampler2D u_image;
uniform float u_p1, u_p2, u_p3, u_p4;
varying vec2 v_texCoord;

void main() {
  vec4 color = texture2D(u_image, v_texCoord);
  vec2 uv    = v_texCoord;
${body.split('\n').map(l => '  ' + l).join('\n')}
}`;
}

function defaultAdvancedSource() {
  return `precision mediump float;
uniform sampler2D u_image;
uniform float u_p1, u_p2, u_p3, u_p4;
varying vec2 v_texCoord;

void main() {
  vec4 color = texture2D(u_image, v_texCoord);
  vec2 uv    = v_texCoord;

  /* scrivi qui il tuo shader */
  gl_FragColor = color;
}`;
}

function adjustErrors(msg, offset) {
  return msg.replace(/ERROR:\s*\d+:(\d+):/g, (_, line) => {
    return t('app.osd.filters.shader_line', { n: Math.max(1, parseInt(line) - offset) });
  });
}

const SHADER_PRESETS = {
  sepia: {
    get label() { return t('app.osd.filters.preset.sepia'); },
    body:
`float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
vec3 s = vec3(lum * 1.07, lum * 0.74, lum * 0.43);
gl_FragColor = vec4(mix(color.rgb, s, u_p1), color.a);`,
    params: [1.0, 0.5, 0.5, 0.5],
  },
  vignette: {
    get label() { return t('app.osd.filters.preset.vignette'); },
    body:
`float d = length(uv - 0.5);
float v = 1.0 - smoothstep(u_p1, u_p2, d);
gl_FragColor = vec4(color.rgb * v, color.a);`,
    params: [0.35, 0.75, 0.5, 0.5],
  },
  emboss: {
    get label() { return t('app.osd.filters.preset.emboss'); },
    body:
`/* u_p1 = passo pixel (0.001), u_p2 = intensità, u_p3 = grigio base */
vec2  p  = vec2(u_p1, u_p1);
float c  = dot(color.rgb,                              vec3(0.299,0.587,0.114));
float nw = dot(texture2D(u_image, uv - p).rgb,         vec3(0.299,0.587,0.114));
float se = dot(texture2D(u_image, uv + p).rgb,         vec3(0.299,0.587,0.114));
float e  = clamp((se - nw) * u_p2 + u_p3, 0.0, 1.0);
gl_FragColor = vec4(vec3(e), color.a);`,
    params: [0.0012, 2.0, 0.5, 0.5],
  },
  falso_colore: {
    get label() { return t('app.osd.filters.preset.false_color'); },
    body:
`float t = dot(color.rgb, vec3(0.299, 0.587, 0.114));
vec3 c;
if      (t < 0.25) c = mix(vec3(0.0,0.0,0.56), vec3(0.0,0.0,1.0), t*4.0);
else if (t < 0.50) c = mix(vec3(0.0,0.0,1.0),  vec3(0.0,1.0,0.0), (t-0.25)*4.0);
else if (t < 0.75) c = mix(vec3(0.0,1.0,0.0),  vec3(1.0,1.0,0.0), (t-0.50)*4.0);
else               c = mix(vec3(1.0,1.0,0.0),  vec3(1.0,0.0,0.0), (t-0.75)*4.0);
gl_FragColor = vec4(mix(color.rgb, c, u_p1), color.a);`,
    params: [1.0, 0.5, 0.5, 0.5],
  },
  posterize: {
    get label() { return t('app.osd.filters.preset.posterize'); },
    body:
`float lev = max(2.0, floor(u_p1 * 15.0) + 2.0);
gl_FragColor = vec4(floor(color.rgb * lev) / lev, color.a);`,
    params: [0.25, 0.5, 0.5, 0.5],
  },
  stretch: {
    get label() { return t('app.osd.filters.preset.stretch'); },
    body:
`vec3 str = (color.rgb - u_p1) / max(u_p2 - u_p1, 0.001);
gl_FragColor = vec4(clamp(str, 0.0, 1.0), color.a);`,
    params: [0.1, 0.9, 0.5, 0.5],
  },
};

// ── Filter spec ───────────────────────────────────────────────────────────────
function defaultSpec() {
  return {
    brightness: 0, contrast: 1, gamma: 1,
    greyscale: false, invert: false,
    threshold:         { enabled: false, value: 128 },
    convolution:       'none',
    convolutionParams: { strength: 1.0, spread: 1.0 },
    colormap:          'none',
    customShader: { enabled: false, advanced: false, source: '', params: [0.5, 0.5, 0.5, 0.5] },
  };
}

function specFromPanel(panelEl) {
  const q = (name) => panelEl.querySelector(`[data-osdf="${name}"]`);
  return {
    brightness:  Number(q('brightness').value),
    contrast:    Number(q('contrast').value),
    gamma:       Number(q('gamma').value),
    greyscale:   q('greyscale').checked,
    invert:      q('invert').checked,
    threshold:         { enabled: q('thresh-en').checked, value: Number(q('thresh').value) },
    convolution:       q('convolution').value,
    convolutionParams: { strength: Number(q('conv-strength').value), spread: Number(q('conv-spread').value) },
    colormap:    q('colormap').value,
    customShader: {
      enabled:  q('shader-en').checked,
      advanced: q('shader-adv').checked,
      source:   q('shader-src').value,
      params:   [1,2,3,4].map(i => Number(q(`sp-val-${i}`).value)),
    },
  };
}

function applySpecToPanel(spec, panelEl) {
  const d = defaultSpec();
  const s = {
    ...d, ...spec,
    threshold:         { ...d.threshold,         ...(spec?.threshold         || {}) },
    convolutionParams: { ...d.convolutionParams,  ...(spec?.convolutionParams || {}) },
    customShader:      { ...d.customShader,       ...(spec?.customShader      || {}) },
  };
  const q  = (n) => panelEl.querySelector(`[data-osdf="${n}"]`);
  const qv = (n) => panelEl.querySelector(`[data-osdf="${n}-val"]`);

  q('brightness').value  = s.brightness;   qv('brightness').textContent = s.brightness;
  q('contrast').value    = s.contrast;     qv('contrast').textContent   = Number(s.contrast).toFixed(2);
  q('gamma').value       = s.gamma;        qv('gamma').textContent      = Number(s.gamma).toFixed(2);
  q('greyscale').checked = s.greyscale;
  q('invert').checked    = s.invert;
  q('thresh-en').checked = s.threshold.enabled;
  q('thresh').disabled   = !s.threshold.enabled;
  q('thresh').value      = s.threshold.value;  qv('thresh').textContent = s.threshold.value;
  q('convolution').value = s.convolution;
  const cp = s.convolutionParams;
  q('conv-strength').value = cp.strength;  qv('conv-strength').textContent = Number(cp.strength).toFixed(2);
  q('conv-spread').value   = cp.spread;    qv('conv-spread').textContent   = Number(cp.spread).toFixed(1);
  q('conv-params').style.display = s.convolution !== 'none' ? 'block' : 'none';
  q('colormap').value    = s.colormap;

  const cs = s.customShader;
  q('shader-en').checked  = cs.enabled;
  q('shader-adv').checked = cs.advanced;
  q('shader-src').value   = cs.source || '';
  const pArr = Array.isArray(cs.params) ? cs.params : [0.5, 0.5, 0.5, 0.5];
  [1,2,3,4].forEach(i => { q(`sp-val-${i}`).value = pArr[i-1] ?? 0.5; });
  _syncGuide(q('shader-guide'), cs.advanced);
}

function _syncGuide(el, isAdv) { if (el) el.style.display = isAdv ? 'none' : ''; }

// ── Raccolta filtri base (senza shader custom) ────────────────────────────────
// viewer è necessario per leggere le dimensioni canvas → u_textureSize corretto.
function collectBaseFilters(spec, viewer) {
  const { BRIGHTNESS_WEBGL, CONTRAST_WEBGL, GAMMA_WEBGL,
          GREYSCALE_WEBGL, INVERT_WEBGL, THRESHOLDING_WEBGL } = _lib;
  const d = defaultSpec();
  const s = { ...d, ...spec, threshold: { ...d.threshold, ...(spec?.threshold || {}) } };
  const f = [];

  if (s.brightness !== 0)              f.push(BRIGHTNESS_WEBGL(s.brightness));
  if (Math.abs(s.contrast - 1) > 0.02) f.push(CONTRAST_WEBGL(s.contrast));
  if (Math.abs(s.gamma - 1)    > 0.02) f.push(GAMMA_WEBGL(s.gamma));

  const conv = getConvolutionFilter(s.convolution, s.convolutionParams, viewer);
  if (conv) f.push(conv);

  if (s.greyscale) f.push(GREYSCALE_WEBGL());

  const cm = getColormapFilter(s.colormap);
  if (cm) f.push(cm);

  if (s.invert)            f.push(INVERT_WEBGL());
  if (s.threshold.enabled) f.push(THRESHOLDING_WEBGL(s.threshold.value));

  return f;
}

function uniformsFromParams(params) {
  const p = Array.isArray(params) ? params : [0.5, 0.5, 0.5, 0.5];
  return { u_p1: p[0] ?? 0.5, u_p2: p[1] ?? 0.5, u_p3: p[2] ?? 0.5, u_p4: p[3] ?? 0.5 };
}

// ── DOM del pannello ──────────────────────────────────────────────────────────
function buildPanel() {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute', 'top:0', 'right:0', 'bottom:0', 'width:230px',
    'background:rgba(14,14,22,0.96)', 'border-left:1px solid #2a2a3e',
    'display:flex', 'flex-direction:column',
    'font-family:system-ui,sans-serif', 'font-size:12px', 'color:#dde',
    'z-index:100', 'pointer-events:auto', 'box-shadow:-4px 0 12px rgba(0,0,0,0.4)',
  ].join(';');

  const range    = 'width:100%;accent-color:#6c757d;cursor:pointer';
  const lRow     = 'display:flex;justify-content:space-between;margin-bottom:3px;align-items:baseline';
  const lbl      = 'font-size:11px;color:#bbc';
  const val      = 'font-size:11px;color:#888';
  const mb       = 'margin-bottom:10px';
  const chkRow   = 'display:flex;align-items:center;gap:7px;margin-bottom:8px';
  const sep      = 'border-top:1px solid #222;padding-top:10px;margin-bottom:10px';
  const sel      = ['width:100%','background:#131320','color:#dde',
                    'border:1px solid #2a2a3e','border-radius:4px',
                    'padding:4px 6px','font-size:11px','cursor:pointer','margin-top:3px'].join(';');
  const psKeys   = Object.keys(SHADER_PRESETS);

  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', t('app.osd.filters.title'));
  el.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;
            padding:6px 9px;border-bottom:1px solid #2a2a3e;
            background:rgba(0,0,0,0.3);flex-shrink:0">
  <span style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em">${te('app.osd.filters.title')}</span>
  <button data-osdf="close" title="${te('common.close')}" aria-label="${te('common.close')}"
          style="background:none;border:none;color:#888;cursor:pointer;padding:2px 5px;font-size:13px;line-height:1">
    <i class="bi bi-x-lg" aria-hidden="true"></i></button>
</div>

<div style="flex:1;overflow-y:auto;padding:12px 11px">

  <div style="${mb}">
    <div style="${lRow}"><span style="${lbl}">${te('app.osd.filters.brightness')}</span><span data-osdf="brightness-val" style="${val}">0</span></div>
    <input type="range" data-osdf="brightness" aria-label="${te('app.osd.filters.brightness')}" min="-255" max="255" step="1" value="0" style="${range}">
  </div>
  <div style="${mb}">
    <div style="${lRow}"><span style="${lbl}">${te('app.osd.filters.contrast')}</span><span data-osdf="contrast-val" style="${val}">1.00</span></div>
    <input type="range" data-osdf="contrast" aria-label="${te('app.osd.filters.contrast')}" min="0.1" max="3" step="0.05" value="1" style="${range}">
  </div>
  <div style="${mb}">
    <div style="${lRow}"><span style="${lbl}">${te('app.osd.filters.gamma')}</span><span data-osdf="gamma-val" style="${val}">1.00</span></div>
    <input type="range" data-osdf="gamma" aria-label="${te('app.osd.filters.gamma')}" min="0.1" max="5" step="0.05" value="1" style="${range}">
  </div>

  <div style="${sep}">
    <span style="${lbl}">${te('app.osd.filters.convolution')}</span>
    <select data-osdf="convolution" aria-label="${te('app.osd.filters.convolution')}" style="${sel}">
      <option value="none">${te('app.osd.filters.none')}</option>
      <option value="sharpen">${te('app.osd.filters.conv.sharpen')}</option>
      <option value="blur">${te('app.osd.filters.conv.blur')}</option>
      <option value="edge">${te('app.osd.filters.conv.edge')}</option>
      <option value="emboss">${te('app.osd.filters.conv.emboss')}</option>
    </select>
    <div data-osdf="conv-params" style="display:none;margin-top:8px">
      <div style="${mb}">
        <div style="${lRow}">
          <span style="${lbl}">${te('app.osd.filters.strength')}</span>
          <span data-osdf="conv-strength-val" style="${val}">1.00</span>
        </div>
        <input type="range" data-osdf="conv-strength" aria-label="${te('app.osd.filters.strength')}" min="0" max="2" step="0.05" value="1" style="${range}">
      </div>
      <div>
        <div style="${lRow}">
          <span style="${lbl}">${te('app.osd.filters.spread')}</span>
          <span data-osdf="conv-spread-val" style="${val}">1.0</span>
        </div>
        <input type="range" data-osdf="conv-spread" aria-label="${te('app.osd.filters.spread')}" min="0.5" max="4" step="0.25" value="1" style="${range}">
      </div>
    </div>
  </div>

  <div style="${sep}">
    <div style="${chkRow}">
      <input type="checkbox" data-osdf="greyscale" aria-label="${te('app.osd.filters.greyscale')}" style="margin:0;cursor:pointer;accent-color:#6c757d">
      <span style="${lbl}">${te('app.osd.filters.greyscale')}</span>
    </div>
    <span style="${lbl}">${te('app.osd.filters.colormap')}</span>
    <select data-osdf="colormap" aria-label="${te('app.osd.filters.colormap')}" style="${sel}">
      <option value="none">${te('app.osd.filters.none')}</option>
      <option value="viridis">Viridis</option>
      <option value="inferno">Inferno</option>
      <option value="jet">Jet</option>
      <option value="hot">Hot</option>
    </select>
  </div>

  <div style="${sep}">
    <div style="${chkRow}">
      <input type="checkbox" data-osdf="invert" aria-label="${te('app.osd.filters.invert')}" style="margin:0;cursor:pointer;accent-color:#6c757d">
      <span style="${lbl}">${te('app.osd.filters.invert')}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
      <div style="${chkRow};margin-bottom:0">
        <input type="checkbox" data-osdf="thresh-en" aria-label="${te('app.osd.filters.threshold')}" style="margin:0;cursor:pointer;accent-color:#6c757d">
        <span style="${lbl}">${te('app.osd.filters.threshold')}</span>
      </div>
      <span data-osdf="thresh-val" style="${val}">128</span>
    </div>
    <input type="range" data-osdf="thresh" aria-label="${te('app.osd.filters.threshold_value')}" min="0" max="255" step="1" value="128" disabled style="${range}">
  </div>

  <!-- ── Shader custom ── -->
  <div style="border-top:1px solid #222;padding-top:8px">
    <div data-osdf="shader-hdr"
         style="display:flex;align-items:center;gap:7px;cursor:pointer;
                padding-bottom:6px;user-select:none">
      <input type="checkbox" data-osdf="shader-en" aria-label="${te('app.osd.filters.shader_custom')}"
             style="margin:0;cursor:pointer;accent-color:#6c757d"
             onclick="event.stopPropagation()">
      <span style="font-size:11px;color:#bbc;font-weight:600;flex:1">${te('app.osd.filters.shader_custom')}</span>
      <span data-osdf="shader-chevron" style="color:#555;font-size:10px;transition:transform 0.15s">▶</span>
    </div>

    <div data-osdf="shader-body" style="display:none">
      <select data-osdf="shader-preset" aria-label="${te('app.osd.filters.preset_label')}" style="${sel};margin-bottom:7px">
        <option value="">${te('app.osd.filters.preset_none')}</option>
        ${psKeys.map(k => `<option value="${k}">${SHADER_PRESETS[k].label}</option>`).join('')}
      </select>

      <label style="display:flex;align-items:center;justify-content:flex-end;
                    gap:5px;font-size:10px;color:#666;cursor:pointer;margin-bottom:5px">
        <input type="checkbox" data-osdf="shader-adv" style="margin:0;cursor:pointer;accent-color:#6c757d">
        ${te('app.osd.filters.advanced')}
      </label>

      <div data-osdf="shader-guide"
           style="font-size:9px;color:#555;font-family:monospace;margin-bottom:3px;line-height:1.5">
        ${te('app.osd.filters.guide_available')} <b style="color:#6ea8fe">color</b> (vec4) &nbsp;
        <b style="color:#6ea8fe">uv</b> (vec2) &nbsp;
        <b style="color:#6ea8fe">u_p1…u_p4</b> (float)<br>
        ${te('app.osd.filters.guide_set')} <b style="color:#6ea8fe">gl_FragColor</b>
      </div>

      <textarea data-osdf="shader-src" aria-label="${te('app.osd.filters.shader_src')}" rows="8" spellcheck="false"
                placeholder="${te('app.osd.filters.shader_placeholder')}"
                style="width:100%;height:115px;background:#0d0d1a;color:#c8e6c9;
                       border:1px solid #2a2a3e;border-radius:3px;padding:5px 6px;
                       font-family:'Cascadia Code',Consolas,monospace;font-size:10px;
                       resize:vertical;box-sizing:border-box;line-height:1.45"></textarea>

      <div data-osdf="shader-err" role="alert"
           style="display:none;background:#3a0000;border:1px solid #7a0000;
                  border-radius:3px;padding:5px;margin-top:3px;
                  font-size:10px;color:#ffaaaa;font-family:monospace;
                  white-space:pre-wrap;max-height:70px;overflow-y:auto"></div>

      <div style="margin-top:8px">
        ${[1,2,3,4].map(i => `
        <div style="display:grid;grid-template-columns:1fr 60px;gap:5px;
                    align-items:center;margin-bottom:5px">
          <span data-osdf="sp-label-${i}"
                style="font-size:10px;color:#888;font-family:monospace">u_p${i}</span>
          <input type="number" data-osdf="sp-val-${i}" aria-label="u_p${i}" value="0.5" step="0.05"
                 style="background:#131320;color:#dde;border:1px solid #2a2a3e;
                        border-radius:3px;padding:3px 5px;font-size:10px;
                        width:100%;box-sizing:border-box;text-align:right">
        </div>`).join('')}
      </div>

      <button data-osdf="shader-apply"
              style="width:100%;margin-top:6px;background:none;
                     border:1px solid #6ea8fe;color:#6ea8fe;
                     border-radius:4px;padding:5px 0;font-size:11px;cursor:pointer">
        ${te('app.osd.filters.compile_apply')}
      </button>
    </div>
  </div>

</div>

<div style="display:flex;gap:7px;padding:8px 10px;border-top:1px solid #2a2a3e;
            flex-shrink:0;background:rgba(0,0,0,0.2)">
  <button data-osdf="reset"
          style="flex:1;background:none;border:1px solid #555;color:#aaa;
                 border-radius:4px;padding:4px 0;font-size:11px;cursor:pointer">${te('app.osd.filters.reset')}</button>
</div>`;

  return el;
}

// ── Collega eventi ────────────────────────────────────────────────────────────
function wireEvents(panelEl, bodyEl) {
  const q  = (n) => panelEl.querySelector(`[data-osdf="${n}"]`);
  const qv = (n) => panelEl.querySelector(`[data-osdf="${n}-val"]`);

  function getViewer() { return getState(bodyEl)?.viewer ?? null; }

  function applyNow() {
    const viewer = getViewer();
    const spec   = specFromPanel(panelEl);

    // Auto-save to drawing envelope (persisted with draw save/load)
    const pjs = getState(bodyEl);
    if (pjs?._env) pjs._env.filters = spec;

    if (!viewer || !_lib) return;
    const plugin = getOrCreatePlugin(viewer);
    const base   = collectBaseFilters(spec, viewer);

    let filters = base;
    const ss = panelEl._shaderState;
    if (spec.customShader.enabled && ss?.compiled && ss.compiledSource) {
      try {
        const cf = _lib.convertToWebGLFilter(
          'osd-custom', ss.compiledSource, uniformsFromParams(spec.customShader.params)
        );
        filters = [...base, cf];
      } catch { /* shader precedentemente invalido — ignora */ }
    }

    filters.length ? plugin.setFilters(filters) : plugin.clearFilters();
  }

  // controlli base
  q('brightness').addEventListener('input', () => { qv('brightness').textContent = q('brightness').value; applyNow(); });
  q('contrast').addEventListener('input',   () => { qv('contrast').textContent   = Number(q('contrast').value).toFixed(2); applyNow(); });
  q('gamma').addEventListener('input',      () => { qv('gamma').textContent      = Number(q('gamma').value).toFixed(2); applyNow(); });
  q('greyscale').addEventListener('change',   applyNow);
  q('invert').addEventListener('change',      applyNow);
  q('colormap').addEventListener('change',    applyNow);
  q('thresh-en').addEventListener('change', () => { q('thresh').disabled = !q('thresh-en').checked; applyNow(); });
  q('thresh').addEventListener('input',     () => { qv('thresh').textContent = q('thresh').value; applyNow(); });

  q('convolution').addEventListener('change', () => {
    q('conv-params').style.display = q('convolution').value !== 'none' ? 'block' : 'none';
    applyNow();
  });
  q('conv-strength').addEventListener('input', () => { qv('conv-strength').textContent = Number(q('conv-strength').value).toFixed(2); applyNow(); });
  q('conv-spread').addEventListener('input',   () => { qv('conv-spread').textContent   = Number(q('conv-spread').value).toFixed(1);   applyNow(); });

  q('close').addEventListener('click',      () => { panelEl.style.display = 'none'; });

  q('reset').addEventListener('click', () => {
    applySpecToPanel(defaultSpec(), panelEl);
    panelEl._shaderState = { compiled: false, compiledSource: null };
    const pjs = getState(bodyEl);
    if (pjs?._env) delete pjs._env.filters;
    const v = getViewer();
    if (v && _lib) getOrCreatePlugin(v).clearFilters();
  });

  // shader section
  q('shader-hdr').addEventListener('click', () => {
    const body = q('shader-body');
    const chev = q('shader-chevron');
    const open = body.style.display !== 'none';
    body.style.display     = open ? 'none' : 'block';
    chev.style.transform   = open ? '' : 'rotate(90deg)';
  });

  q('shader-en').addEventListener('change', applyNow);
  [1,2,3,4].forEach(i => q(`sp-val-${i}`).addEventListener('input', applyNow));

  q('shader-preset').addEventListener('change', () => {
    const p = SHADER_PRESETS[q('shader-preset').value];
    if (!p) return;
    q('shader-src').value = q('shader-adv').checked ? wrapShader(p.body) : p.body;
    p.params.forEach((v, i) => { q(`sp-val-${i + 1}`).value = v; });
    q('shader-err').style.display = 'none';
  });

  q('shader-adv').addEventListener('change', () => {
    const isAdv = q('shader-adv').checked;
    const src   = q('shader-src');
    src.value = isAdv ? (src.value.trim() ? wrapShader(src.value) : defaultAdvancedSource()) : '';
    _syncGuide(q('shader-guide'), isAdv);
    panelEl._shaderState = { compiled: false, compiledSource: null };
    q('shader-err').style.display = 'none';
  });

  const applyBtn = q('shader-apply');
  applyBtn.addEventListener('click', () => {
    const spec  = specFromPanel(panelEl);
    const cs    = spec.customShader;
    const errEl = q('shader-err');
    const src   = cs.source.trim();
    if (!src) { errEl.textContent = t('app.osd.filters.shader_empty'); errEl.style.display = 'block'; return; }

    const full   = cs.advanced ? src : wrapShader(src);
    const viewer = getViewer();
    if (!viewer || !_lib) return;
    const plugin = getOrCreatePlugin(viewer);

    try {
      const cf   = _lib.convertToWebGLFilter('osd-custom', full, uniformsFromParams(cs.params));
      const base = collectBaseFilters(spec, viewer);
      plugin.setFilters([...base, cf]);
      panelEl._shaderState        = { compiled: true, compiledSource: full };
      errEl.style.display         = 'none';
      applyBtn.textContent        = t('app.osd.filters.applied');
      setTimeout(() => { if (applyBtn.isConnected) applyBtn.textContent = t('app.osd.filters.compile_apply'); }, 1500);
    } catch (e) {
      panelEl._shaderState = { compiled: false, compiledSource: null };
      errEl.textContent    = cs.advanced ? e.message : adjustErrors(e.message, WRAPPER_LINES);
      errEl.style.display  = 'block';
    }
  });
}

// ── API pubblica ──────────────────────────────────────────────────────────────

export async function openFiltersPanel({ bodyEl }) {
  const lib = await ensureLib();
  if (!lib) return;

  const existing = bodyEl[PANEL_KEY];
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  const panelEl = buildPanel();
  panelEl._shaderState = { compiled: false, compiledSource: null };
  bodyEl.appendChild(panelEl);
  bodyEl[PANEL_KEY] = panelEl;

  wireEvents(panelEl, bodyEl);

  const saved = getState(bodyEl)?._env?.filters;
  if (saved) applySpecToPanel(saved, panelEl);
}

export async function applyFiltersFromEnv(bodyEl) {
  const lib = await ensureLib();
  if (!lib) return;

  const pjs     = getState(bodyEl);
  const viewer  = pjs?.viewer;
  const filters = pjs?._env?.filters ?? null;
  const panel   = bodyEl[PANEL_KEY];

  if (panel) applySpecToPanel(filters ?? defaultSpec(), panel);

  if (!viewer) return;

  function doApply() {
    if (!filters) {
      getOrCreatePlugin(viewer).clearFilters();
      return;
    }
    const base = collectBaseFilters(filters, viewer);
    if (filters.customShader?.enabled && filters.customShader?.source?.trim()) {
      try {
        const cs  = filters.customShader;
        const src = cs.advanced ? cs.source : wrapShader(cs.source);
        base.push(_lib.convertToWebGLFilter('osd-custom', src, uniformsFromParams(cs.params)));
      } catch { /* shader non valido — ignora silenziosamente all'avvio */ }
    }
    const plugin = getOrCreatePlugin(viewer);
    base.length ? plugin.setFilters(base) : plugin.clearFilters();
  }

  if (viewer.isOpen()) doApply();
  else viewer.addOnceHandler('open', doApply);
}
