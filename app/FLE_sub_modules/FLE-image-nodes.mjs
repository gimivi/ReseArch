// app/FLE_sub_modules/FLE-image-nodes.mjs
// Nodi per il trattamento delle immagini (2026-10-04), scritti secondo
// _doc/guide-fle-regole-nodi.md:
//
//   Media/Image/Load — carica un'immagine da URL (trigger → done | error)
//   Media/Image/Info — descrive le proprietà di un'immagine (dimensioni, proporzioni,
//                      formato; EXIF facoltativo con una libreria di contesto, es. exifr)
//
// Le uscite/ingressi immagine hanno il tipo 'image' (HTMLImageElement), lo stesso dei nodi
// nativi Media/Image/Draw e Media/Tools/Crop: si collegano fra loro.
// Solo onAction (niente onExecute): in LiteGraph 0.7.18 un evento diretto a un nodo che ha
// anche onExecute verrebbe rimandato al giro successivo del grafo (use_deferred_actions).

import { fleUseContext } from "./FLE-context-nodes.mjs";

/** Formato dell'immagine dal tipo di un data: URI o dall'estensione dell'URL. */
function imageFormat(src) {
    if (!src) return null;
    const m = /^data:image\/([a-z0-9.+-]+)/i.exec(src);
    if (m) return m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    if (src.startsWith('blob:')) return null;
    try {
        const path = new URL(src, window.location.href).pathname;
        const ext = (path.split('.').pop() || '').toLowerCase();
        if (!ext || ext === path.toLowerCase()) return null;
        return ext === 'jpg' ? 'jpeg' : ext;
    } catch { return null; }
}

function drawStatus(node, ctx2d, text) {
    if (!text || node.research_error) return;   // l'errore lo disegna il fork (patch 3)
    ctx2d.save();
    ctx2d.font = '9px monospace';
    ctx2d.fillStyle = 'rgba(255,255,255,0.5)';
    ctx2d.fillText(String(text).slice(0, 60), 6, node.size[1] - 6);
    ctx2d.restore();
}

export function registerImageNodes(LG) {
    if (!LG) return;

    // ─────────────────────────────────────────────────────────────────────────
    // Media/Image/Load
    // ─────────────────────────────────────────────────────────────────────────
    const CROSS = ['anonymous', 'use-credentials', 'none'];

    function ImageLoad() {
        this.addProperty('url',         '',          'string');
        this.addProperty('crossOrigin', 'anonymous', 'string');
        this.addWidget('text',  'url',         '',          v => { this.properties.url = String(v ?? '').trim(); }, { property: 'url' });
        this.addWidget('combo', 'crossOrigin', 'anonymous', v => { this.properties.crossOrigin = v; }, { values: CROSS, property: 'crossOrigin' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('url',     'string');
        this.addOutput('done',   LG.EVENT);
        this.addOutput('image',  'image');
        // 'error': porta del fork (patch 3), nascosta per default — tasto destro → Show error
        this._status = '';
        this._seq = 0;
        this.color   = '#14532d';   // famiglia Creazione astratta
        this.bgcolor = '#166534';
        this.size    = [260, 110];
    }
    ImageLoad.error_output = true;
    ImageLoad.title = 'Image Load';
    ImageLoad.desc  = 'On trigger loads an image from a URL and fires done with the image, or error';
    ImageLoad.portHelp = {
        inputs: {
            trigger: 'event — starts loading',
            url:     'text — image URL (http/https, relative path, data: or blob:); when connected it overrides the "url" widget',
        },
        outputs: {
            done:  'event — fired when the image is loaded (the "image" output is already set)',
            image: 'image (HTMLImageElement) — can be connected to Media/Image/Info and to the native nodes Media/Image/Draw, Media/Tools/Crop',
            error: 'event — fired if the URL is empty or loading fails; parameter { message, node, title, type, time }. Port hidden by default: right click on the node → Show error (the message is written in red on the node anyway). With crossOrigin "anonymous" the image server must allow CORS, otherwise choose "none" (the image is shown but its pixels cannot be read)',
        },
    };
    ImageLoad.prototype.onAction = function () {
        const linked = this.getInputData(this.findInputSlot('url'));
        const url = String((linked != null && linked !== '') ? linked : this.properties.url || '').trim();
        const fail = (msg) => {
            this._status = '';
            this.setOutputData(this.findOutputSlot('image'), null);
            this.triggerError?.(new Error(msg));
        };
        this.clearError?.();
        if (!url) { fail('no URL'); return; }

        const seq = ++this._seq;
        const img = new Image();
        if (this.properties.crossOrigin && this.properties.crossOrigin !== 'none') img.crossOrigin = this.properties.crossOrigin;
        this._status = 'loading…';
        this.setDirtyCanvas(true, false);
        img.onload = () => {
            if (seq !== this._seq) return;   // superato da un caricamento più recente
            this._status = `${img.naturalWidth} × ${img.naturalHeight}`;
            this.setOutputData(this.findOutputSlot('image'), img);
            this.setDirtyCanvas(true, false);
            this.triggerSlot(this.findOutputSlot('done'));
        };
        img.onerror = () => {
            if (seq !== this._seq) return;
            fail('loading failed' + (img.crossOrigin ? ' (CORS?)' : ''));
        };
        img.src = url;
    };
    ImageLoad.prototype.onDrawForeground = function (ctx2d) { drawStatus(this, ctx2d, this._status); };
    LG.registerNodeType('Media/Image/Load', ImageLoad);


    // ─────────────────────────────────────────────────────────────────────────
    // Media/Image/Info
    // ─────────────────────────────────────────────────────────────────────────
    const INFO_OPTIONAL_OUTPUTS = [['aspect', 'number'], ['format', 'string'], ['exif', 'object']];

    function ImageInfo() {
        this.addProperty('context', '', 'string');
        this.addWidget('text', 'context', '', v => { this.properties.context = String(v ?? '').trim(); }, { property: 'context' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('image',   'image');
        this.addOutput('done',   LG.EVENT);
        this.addOutput('info',   'object');
        this.addOutput('width',  'number');
        this.addOutput('height', 'number');
        // aspect, format, exif: opzionali (tasto destro → Outputs); 'error': porta del fork (patch 3)
        this._status = '';
        this._seq = 0;
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [240, 110];
    }
    ImageInfo.error_output = true;
    ImageInfo.title = 'Image Info';
    ImageInfo.desc  = 'On trigger describes an image: size, aspect ratio, orientation, format; with a context library (e.g. exifr) also the EXIF data';
    ImageInfo.portHelp = {
        inputs: {
            trigger: 'event — computes the properties of the input image',
            image:   'image (HTMLImageElement, also a canvas or a video) — e.g. the "image" output of Media/Image/Load. If empty: error (no done)',
        },
        outputs: {
            done:   'event — fired when the computation is finished (after the optional EXIF reading)',
            info:   'object { width, height, aspect, orientation, megapixels, format, src, exif } — orientation: "landscape" | "portrait" | "square"; format inferred from the data: type or the URL extension (null if it cannot be inferred); exif present only with the "context" widget',
            width:  'number — width in pixels (natural size, not the display size)',
            height: 'number — height in pixels',
            aspect: 'number — width / height (optional: right click on the node → Outputs)',
            format: 'text — image format, e.g. "jpeg", "png", "webp"; null if it cannot be inferred (optional)',
            error:  'event — missing image, or EXIF reading failed (missing or unsuitable context): in this case info/width/height are written anyway, but done is not fired. Parameter { message, node, title, type, time }. Port hidden by default: right click on the node → Show error',
            exif:   'object — EXIF data (camera, shooting date, GPS…) read with the library of the context named in the "context" widget, e.g. a ReseArch/Context/Library node with name = exifr and url = https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs; null without context or if the image has no EXIF (optional)',
        },
    };
    ImageInfo.prototype.onGetOutputs = function () {
        return INFO_OPTIONAL_OUTPUTS
            .filter(([name]) => this.findOutputSlot(name) === -1)
            .map(([name, type]) => [name, type, { removable: true }]);
    };
    ImageInfo.prototype.onConfigure = function () {
        for (const o of this.outputs ?? []) {
            if (INFO_OPTIONAL_OUTPUTS.some(([n]) => n === o.name)) o.removable = true;
        }
    };
    ImageInfo.prototype._out = function (name, value) {
        const i = this.findOutputSlot(name);
        if (i !== -1) this.setOutputData(i, value);
    };
    ImageInfo.prototype.onAction = async function () {
        const img = this.getInputData(this.findInputSlot('image'));
        const w = img?.naturalWidth || img?.videoWidth || img?.width || 0;
        const h = img?.naturalHeight || img?.videoHeight || img?.height || 0;
        if (!img || !w || !h) {
            for (const n of ['info', 'width', 'height', 'aspect', 'format', 'exif']) this._out(n, null);
            this._status = '';
            this.triggerError?.(new Error('no image (or not loaded yet)'));
            return;
        }
        const seq = ++this._seq;
        const src = img.currentSrc || img.src || '';
        const info = {
            width:       w,
            height:      h,
            aspect:      Math.round((w / h) * 10000) / 10000,
            orientation: w === h ? 'square' : (w > h ? 'landscape' : 'portrait'),
            megapixels:  Math.round((w * h / 1e6) * 100) / 100,
            format:      imageFormat(src),
            src:         src || null,
        };

        let exif = null;
        let exifError = null;
        this.clearError?.();
        if (this.properties.context) {
            this._status = 'reading EXIF…';
            this.setDirtyCanvas(true, false);
            try {
                const lib   = await fleUseContext(this, this.properties.context);
                const parse = lib?.parse || lib?.default?.parse;
                if (typeof parse !== 'function') throw new Error(`the context "${this.properties.context}" has no parse function (an EXIF library such as exifr is needed)`);
                exif = (await parse(src || img)) ?? null;
            } catch (err) {
                exifError = err;
            }
            info.exif = exif;
        }
        if (seq !== this._seq) return;   // superato da un calcolo più recente

        this._out('info',   info);
        this._out('width',  w);
        this._out('height', h);
        this._out('aspect', info.aspect);
        this._out('format', info.format);
        this._out('exif',   exif);
        this._status = `${w} × ${h}${info.format ? ' · ' + info.format : ''}${exif ? ' · EXIF' : ''}`;
        if (exifError) { this.triggerError?.(new Error('EXIF: ' + (exifError?.message || exifError))); return; }
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ImageInfo.prototype.onDrawForeground = function (ctx2d) { drawStatus(this, ctx2d, this._status); };
    LG.registerNodeType('Media/Image/Info', ImageInfo);
}
