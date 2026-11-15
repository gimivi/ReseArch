// app/OSD_sub_modules/OSD-flow-nodes.mjs
// Nodi LiteGraph context-aware per OpenSeadragon.
// Ogni nodo accede al viewer via this.graph._appContext.viewer().
// Registrazione idempotente tramite window._OSD_FLOW_NODES_REGISTERED.
//
// Menu contestuale LiteGraph → sottomenu "OSD":
//   OSD/Viewport/* — zoom, pan, bounds, goHome
//   OSD/Image/*    — dimensioni, pagina corrente, sequence
//   OSD/Events/*   — nodi reattivi (animation-finish, page-change, pick)

export function registerOSDFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[OSD-flow-nodes] LiteGraph non disponibile'); return; }
    if (window._OSD_FLOW_NODES_REGISTERED) return;
    window._OSD_FLOW_NODES_REGISTERED = true;

    const ACTION = LG.ACTION ?? -1;
    const EVENT  = LG.EVENT  ?? -1;

    // Helper: ottieni OpenSeadragon Point e Rect dal namespace globale
    function _osdPoint(x, y) {
        const OSD = window.OpenSeadragon;
        return new OSD.Point(x ?? 0, y ?? 0);
    }
    function _osdRect(x, y, w, h) {
        const OSD = window.OpenSeadragon;
        return new OSD.Rect(x ?? 0, y ?? 0, w ?? 0, h ?? 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OSD/Viewport — controllo e lettura del viewport OSD
    // ─────────────────────────────────────────────────────────────────────────

    function OSDViewportGetZoom() {
        this.addOutput('zoom',    'number');   // zoom immagine assoluto
        this.addOutput('zoomPct', 'number');   // percentuale rispetto allo zoom iniziale
        this.color   = '#001a3a';
        this.bgcolor = '#002a5a';
        this.size    = [200, 65];
    }
    OSDViewportGetZoom.title = 'Viewport Get Zoom';
    OSDViewportGetZoom.desc  = 'Current viewport zoom (absolute image value)';
    OSDViewportGetZoom.portHelp = {
        outputs: {
            zoom:    "Absolute viewport zoom (number) — the same scale OpenSeadragon uses internally (getZoom(true), image coordinates, not normalized to the viewport).",
            zoomPct: "Zoom relative to the initial 'home' view, as a percentage (number) — 100 = home zoom, 200 = twice as much, etc.",
        },
    };
    OSDViewportGetZoom.prototype.onExecute = function () {
        const vp = this.graph?._appContext?.viewer?.()?.viewport;
        if (!vp) return;
        const zoom = vp.getZoom(true);
        const home = vp.getHomeZoom ? vp.getHomeZoom(true) : 1;
        this.setOutputData(0, zoom);
        this.setOutputData(1, home > 0 ? (zoom / home) * 100 : 0);
    };
    LG.registerNodeType('OSD/Viewport/GetZoom', OSDViewportGetZoom);


    function OSDViewportSetZoom() {
        this.addProperty('zoom',        1.0,  'number');
        this.addProperty('immediately', true, 'boolean');
        this.addWidget('number', 'zoom',        1.0,  v => { this.properties.zoom        = Math.max(0.001, v); }, { property: 'zoom' });
        this.addWidget('toggle', 'immediately', true, v => { this.properties.immediately = v; }, { property: 'immediately' });
        this.addInput('trigger',      ACTION);
        this.addInput('zoom',         'number');
        this.addOutput('done',        EVENT);
        this.color   = '#001a3a';
        this.bgcolor = '#002a5a';
        this.size    = [210, 100];
    }
    OSDViewportSetZoom.title = 'Viewport Set Zoom';
    OSDViewportSetZoom.desc  = 'Sets the absolute zoom level of the viewport';
    OSDViewportSetZoom.portHelp = {
        inputs: {
            trigger: "Event: applies the zoom when a trigger arrives (ACTION) — without a trigger the node does nothing.",
            zoom:    "Absolute zoom to set (number) — if not connected, the node's 'zoom' property is used (the same numeric widget shown on the node). Minimum value forced to 0.001.",
        },
        outputs: {
            done: "Event (EVENT) emitted right after the new zoom is applied (immediate or animated according to the 'immediately' property).",
        },
    };
    OSDViewportSetZoom.prototype.onAction = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        const zoom  = Math.max(0.001, this.getInputData(1) ?? this.properties.zoom);
        const imm   = this.properties.immediately;
        viewer.viewport.zoomTo(zoom, null, imm);
        viewer.viewport.applyConstraints(imm);
        this.triggerSlot(0);
    };
    LG.registerNodeType('OSD/Viewport/SetZoom', OSDViewportSetZoom);


    function OSDViewportZoomBy() {
        this.addProperty('factor',     1.5,  'number');
        this.addProperty('immediately', true, 'boolean');
        this.addWidget('number', 'factor',     1.5,  v => { this.properties.factor      = Math.max(0.001, v); }, { property: 'factor' });
        this.addWidget('toggle', 'immediately', true, v => { this.properties.immediately = v; }, { property: 'immediately' });
        this.addInput('trigger',  ACTION);
        this.addInput('factor',   'number');
        this.addInput('refX',     'number');   // image px (opzionale)
        this.addInput('refY',     'number');
        this.addOutput('done',    EVENT);
        this.color   = '#001a3a';
        this.bgcolor = '#002a5a';
        this.size    = [210, 145];
    }
    OSDViewportZoomBy.title = 'Viewport Zoom By';
    OSDViewportZoomBy.desc  = 'Relative zoom (multiplier) with an optional reference point';
    OSDViewportZoomBy.portHelp = {
        inputs: {
            trigger: "Event: applies the relative zoom when a trigger arrives (ACTION).",
            factor:  "Zoom multiplier (number) — e.g. 2 doubles the zoom, 0.5 halves it. If not connected, the 'factor' property is used. Minimum value forced to 0.001.",
            refX:    "X coordinate in image pixels (number, optional) of the point to zoom around — if refX and refY are both missing, zooms on the current viewport center.",
            refY:    "Y coordinate in image pixels (number, optional), see refX.",
        },
        outputs: {
            done: "Event (EVENT) emitted right after the relative zoom is applied.",
        },
    };
    OSDViewportZoomBy.prototype.onAction = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        const vp     = viewer.viewport;
        const factor = Math.max(0.001, this.getInputData(1) ?? this.properties.factor);
        const imm    = this.properties.immediately;
        const rx     = this.getInputData(2);
        const ry     = this.getInputData(3);
        const refPt  = (rx != null && ry != null)
            ? vp.imageToViewportCoordinates(_osdPoint(rx, ry))
            : null;
        vp.zoomBy(factor, refPt, imm);
        vp.applyConstraints(imm);
        this.triggerSlot(0);
    };
    LG.registerNodeType('OSD/Viewport/ZoomBy', OSDViewportZoomBy);


    function OSDViewportGetCenter() {
        this.addOutput('cx', 'number');   // image px
        this.addOutput('cy', 'number');
        this.color   = '#001a3a';
        this.bgcolor = '#002a5a';
        this.size    = [190, 65];
    }
    OSDViewportGetCenter.title = 'Viewport Get Center';
    OSDViewportGetCenter.desc  = 'Current viewport center in image coordinates (px)';
    OSDViewportGetCenter.portHelp = {
        outputs: {
            cx: "X coordinate of the viewport center, in image pixels (number) — NOT normalized viewport coordinates.",
            cy: "Y coordinate of the viewport center, in image pixels (number).",
        },
    };
    OSDViewportGetCenter.prototype.onExecute = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        try {
            const vp = viewer.viewport;
            const c  = vp.viewportToImageCoordinates(vp.getCenter());
            this.setOutputData(0, c.x);
            this.setOutputData(1, c.y);
        } catch {}
    };
    LG.registerNodeType('OSD/Viewport/GetCenter', OSDViewportGetCenter);


    function OSDViewportPanTo() {
        this.addProperty('immediately', false, 'boolean');
        this.addWidget('toggle', 'immediately', false, v => { this.properties.immediately = v; }, { property: 'immediately' });
        this.addInput('trigger',  ACTION);
        this.addInput('x',        'number');   // image px
        this.addInput('y',        'number');
        this.addOutput('done',    EVENT);
        this.color   = '#001a3a';
        this.bgcolor = '#002a5a';
        this.size    = [200, 110];
    }
    OSDViewportPanTo.title = 'Viewport Pan To';
    OSDViewportPanTo.desc  = 'Centers the viewport on an image coordinate (px)';
    OSDViewportPanTo.portHelp = {
        inputs: {
            trigger: "Event: pans when a trigger arrives (ACTION).",
            x: "X coordinate in image pixels (number) to center the viewport on — 0 if not connected.",
            y: "Y coordinate in image pixels (number) to center the viewport on — 0 if not connected.",
        },
        outputs: {
            done: "Event (EVENT) emitted right after the pan starts (immediate or animated according to the 'immediately' property).",
        },
    };
    OSDViewportPanTo.prototype.onAction = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        const vp  = viewer.viewport;
        const x   = this.getInputData(1) ?? 0;
        const y   = this.getInputData(2) ?? 0;
        const imm = this.properties.immediately;
        const vpPt = vp.imageToViewportCoordinates(_osdPoint(x, y));
        vp.panTo(vpPt, imm);
        this.triggerSlot(0);
    };
    LG.registerNodeType('OSD/Viewport/PanTo', OSDViewportPanTo);


    function OSDViewportGetBounds() {
        this.addInput('trigger', ACTION);
        this.addOutput('bounds', 'object');   // {x,y,width,height} image px
        this.color   = '#001a3a';
        this.bgcolor = '#002a5a';
        this.size    = [200, 80];
    }
    OSDViewportGetBounds.title = 'Viewport Get Bounds';
    OSDViewportGetBounds.desc  = 'Current visible bounds in image coordinates (px)';
    OSDViewportGetBounds.portHelp = {
        inputs: {
            trigger: "Event: updates the 'bounds' output when a trigger arrives (ACTION) — without a trigger the output keeps the last value.",
        },
        outputs: {
            bounds: "Object {x, y, width, height} — the visible rectangle of the viewport, in image pixels (not normalized coordinates). null on internal error.",
        },
    };
    OSDViewportGetBounds.prototype.onAction = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        try {
            const vp = viewer.viewport;
            const r  = vp.viewportToImageRectangle(vp.getBounds(true));
            this.setOutputData(0, { x: r.x, y: r.y, width: r.width, height: r.height });
        } catch { this.setOutputData(0, null); }
    };
    LG.registerNodeType('OSD/Viewport/GetBounds', OSDViewportGetBounds);


    function OSDViewportFitBounds() {
        this.addProperty('padding',     0.05, 'number');
        this.addProperty('immediately', false,'boolean');
        this.addWidget('number', 'padding',     0.05,  v => { this.properties.padding     = Math.max(0, v); }, { property: 'padding' });
        this.addWidget('toggle', 'immediately', false, v => { this.properties.immediately = v; }, { property: 'immediately' });
        this.addInput('trigger',  ACTION);
        this.addInput('bounds',   'object');   // {x,y,width,height} image px
        this.addOutput('done',    EVENT);
        this.color   = '#001a3a';
        this.bgcolor = '#002a5a';
        this.size    = [220, 115];
    }
    OSDViewportFitBounds.title = 'Viewport Fit Bounds';
    OSDViewportFitBounds.desc  = 'Fits the viewport to a rectangle in image coordinates';
    OSDViewportFitBounds.portHelp = {
        inputs: {
            trigger: "Event: fits the viewport when a trigger arrives (ACTION).",
            bounds:  "Object {x, y, width, height} in image pixels — the rectangle to fit the viewport to (e.g. the output of 'Viewport Get Bounds' or of a selection tool). If missing or without width/height, the node does nothing.",
        },
        outputs: {
            done: "Event (EVENT) emitted right after the viewport is fitted to the rectangle (with the margin of the 'padding' property).",
        },
    };
    OSDViewportFitBounds.prototype.onAction = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        const b = this.getInputData(1);
        if (!b || b.width == null || b.height == null) return;
        try {
            const vp  = viewer.viewport;
            const pad = this.properties.padding;
            const imm = this.properties.immediately;
            const imgRect  = _osdRect(
                b.x - b.width  * pad,
                b.y - b.height * pad,
                b.width  * (1 + 2 * pad),
                b.height * (1 + 2 * pad)
            );
            const vpRect = vp.imageToViewportRectangle(imgRect);
            vp.fitBounds(vpRect, imm);
            this.triggerSlot(0);
        } catch {}
    };
    LG.registerNodeType('OSD/Viewport/FitBounds', OSDViewportFitBounds);


    function OSDViewportGoHome() {
        this.addProperty('immediately', false, 'boolean');
        this.addWidget('toggle', 'immediately', false, v => { this.properties.immediately = v; }, { property: 'immediately' });
        this.addInput('trigger', ACTION);
        this.addOutput('done',   EVENT);
        this.color   = '#001a3a';
        this.bgcolor = '#002a5a';
        this.size    = [200, 85];
    }
    OSDViewportGoHome.title = 'Viewport Go Home';
    OSDViewportGoHome.desc  = 'Returns the viewport to the initial (home) view';
    OSDViewportGoHome.portHelp = {
        inputs: {
            trigger: "Event: returns the viewport to the home view when a trigger arrives (ACTION).",
        },
        outputs: {
            done: "Event (EVENT) emitted right after the return to the home view starts.",
        },
    };
    OSDViewportGoHome.prototype.onAction = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        viewer.viewport.goHome(this.properties.immediately);
        this.triggerSlot(0);
    };
    LG.registerNodeType('OSD/Viewport/GoHome', OSDViewportGoHome);


    // ─────────────────────────────────────────────────────────────────────────
    // OSD/Image — informazioni sull'immagine / sequence
    // ─────────────────────────────────────────────────────────────────────────

    function OSDImageGetSize() {
        this.addOutput('width',  'number');
        this.addOutput('height', 'number');
        this.color   = '#001040';
        this.bgcolor = '#001a60';
        this.size    = [190, 65];
    }
    OSDImageGetSize.title = 'Image Get Size';
    OSDImageGetSize.desc  = 'Pixel size of the current image';
    OSDImageGetSize.portHelp = {
        outputs: {
            width:  "Width of the current image, in native pixels (number) — the real file size, not the size shown on screen.",
            height: "Height of the current image, in native pixels (number).",
        },
    };
    OSDImageGetSize.prototype.onExecute = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        try {
            const item = viewer.world.getItemAt(viewer.currentPage());
            const size = item?.getContentSize?.() ?? { x: 0, y: 0 };
            this.setOutputData(0, size.x);
            this.setOutputData(1, size.y);
        } catch {}
    };
    LG.registerNodeType('OSD/Image/GetSize', OSDImageGetSize);


    function OSDImageGetPage() {
        this.addOutput('page',  'number');
        this.addOutput('total', 'number');
        this.color   = '#001040';
        this.bgcolor = '#001a60';
        this.size    = [190, 65];
    }
    OSDImageGetPage.title = 'Image Get Page';
    OSDImageGetPage.desc  = 'Current page and total (multi-image sequence)';
    OSDImageGetPage.portHelp = {
        outputs: {
            page:  "Index of the current page (number, 0-based) in the OSD sequence.",
            total: "Total number of pages/images in the sequence (number) — 1 if the viewer shows a single image.",
        },
    };
    OSDImageGetPage.prototype.onExecute = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        this.setOutputData(0, viewer.currentPage?.() ?? 0);
        this.setOutputData(1, viewer.world?.getItemCount?.() ?? 1);
    };
    LG.registerNodeType('OSD/Image/GetPage', OSDImageGetPage);


    function OSDImageGoToPage() {
        this.addProperty('page', 0, 'number');
        this.addWidget('number', 'page', 0, v => { this.properties.page = Math.max(0, Math.floor(v)); }, { property: 'page' });
        this.addInput('trigger', ACTION);
        this.addInput('page',    'number');
        this.addOutput('done',   EVENT);
        this.color   = '#001040';
        this.bgcolor = '#001a60';
        this.size    = [200, 90];
    }
    OSDImageGoToPage.title = 'Image Go To Page';
    OSDImageGoToPage.desc  = 'Goes to the given page of a sequence';
    OSDImageGoToPage.portHelp = {
        inputs: {
            trigger: "Event: goes to the page when a trigger arrives (ACTION).",
            page:    "Index of the target page (number, 0-based) — if not connected, the 'page' property is used (widget 'page' on the node). Forced to an integer ≥ 0.",
        },
        outputs: {
            done: "Event (EVENT) emitted right after the page change is requested.",
        },
    };
    OSDImageGoToPage.prototype.onAction = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (!viewer) return;
        const page = Math.max(0, Math.floor(this.getInputData(1) ?? this.properties.page));
        viewer.goToPage?.(page);
        this.triggerSlot(0);
    };
    LG.registerNodeType('OSD/Image/GoToPage', OSDImageGoToPage);


    function OSDImageGetPageCount() {
        this.addOutput('count', 'number');
        this.color   = '#001040';
        this.bgcolor = '#001a60';
        this.size    = [180, 50];
    }
    OSDImageGetPageCount.title = 'Image Get Page Count';
    OSDImageGetPageCount.desc  = 'Total number of images in the sequence';
    OSDImageGetPageCount.portHelp = {
        outputs: {
            count: "Total number of pages/images in the sequence (number) — 1 if the viewer shows a single image.",
        },
    };
    OSDImageGetPageCount.prototype.onExecute = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        this.setOutputData(0, viewer?.world?.getItemCount?.() ?? 1);
    };
    LG.registerNodeType('OSD/Image/GetPageCount', OSDImageGetPageCount);


    // ─────────────────────────────────────────────────────────────────────────
    // OSD/Events — nodi reattivi (pattern onStart → _pending → onExecute)
    // ─────────────────────────────────────────────────────────────────────────

    function OSDEventsOnAnimationFinish() {
        this.addOutput('trigger', EVENT);
        this.addOutput('zoom',    'number');
        this.addOutput('cx',      'number');
        this.addOutput('cy',      'number');
        this._pending    = null;
        this._osdHandler = null;
        this.color   = '#001a1a';
        this.bgcolor = '#002a2a';
        this.size    = [220, 100];
    }
    OSDEventsOnAnimationFinish.title = 'Events On Animation Finish';
    OSDEventsOnAnimationFinish.desc  = 'Reacts to the end of every OSD zoom/pan animation';
    OSDEventsOnAnimationFinish.portHelp = {
        outputs: {
            trigger: "Event (EVENT) emitted every time a zoom/pan animation of the OSD viewport ends (native 'animation-finish' handler).",
            zoom: "Absolute viewport zoom at the end of the animation (number) — 0 if the state could not be read when the event fired.",
            cx:   "X coordinate of the viewport center at the end of the animation, in image pixels (number).",
            cy:   "Y coordinate of the viewport center at the end of the animation, in image pixels (number).",
        },
    };
    OSDEventsOnAnimationFinish.prototype.onStart = function () {
        const ctx    = this.graph?._appContext;
        const viewer = ctx?.viewer?.();
        if (!viewer) return;
        this._pending = null;
        const g    = this.graph;
        const self = this;
        const handler = () => {
            try {
                const vp = viewer.viewport;
                const c  = vp.viewportToImageCoordinates(vp.getCenter());
                self._pending = { zoom: vp.getZoom(true), cx: c.x, cy: c.y };
            } catch {
                self._pending = { zoom: 0, cx: 0, cy: 0 };
            }
            try { g.runStep(1); } catch {}
        };
        viewer.addHandler('animation-finish', handler);
        this._osdHandler = handler;
        ctx.signal?.addEventListener('abort', () => {
            try { viewer.removeHandler('animation-finish', self._osdHandler); } catch {}
        }, { once: true });
    };
    OSDEventsOnAnimationFinish.prototype.onStop = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (viewer && this._osdHandler) {
            try { viewer.removeHandler('animation-finish', this._osdHandler); } catch {}
            this._osdHandler = null;
        }
    };
    OSDEventsOnAnimationFinish.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p.zoom);
        this.setOutputData(2, p.cx);
        this.setOutputData(3, p.cy);
        this.triggerSlot(0);
    };
    LG.registerNodeType('OSD/Events/OnAnimationFinish', OSDEventsOnAnimationFinish);


    function OSDEventsOnPageChange() {
        this.addOutput('trigger', EVENT);
        this.addOutput('page',    'number');
        this._pending    = null;
        this._osdHandler = null;
        this.color   = '#001a1a';
        this.bgcolor = '#002a2a';
        this.size    = [210, 80];
    }
    OSDEventsOnPageChange.title = 'Events On Page Change';
    OSDEventsOnPageChange.desc  = 'Reacts to a page change in an OSD sequence';
    OSDEventsOnPageChange.portHelp = {
        outputs: {
            trigger: "Event (EVENT) emitted every time the current page of the OSD sequence changes (native 'page' handler).",
            page: "Index of the new current page (number, 0-based) — 0 if missing from the native event.",
        },
    };
    OSDEventsOnPageChange.prototype.onStart = function () {
        const ctx    = this.graph?._appContext;
        const viewer = ctx?.viewer?.();
        if (!viewer) return;
        this._pending = null;
        const g    = this.graph;
        const self = this;
        const handler = ({ page }) => {
            self._pending = { page: page ?? 0 };
            try { g.runStep(1); } catch {}
        };
        viewer.addHandler('page', handler);
        this._osdHandler = handler;
        ctx.signal?.addEventListener('abort', () => {
            try { viewer.removeHandler('page', self._osdHandler); } catch {}
        }, { once: true });
    };
    OSDEventsOnPageChange.prototype.onStop = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (viewer && this._osdHandler) {
            try { viewer.removeHandler('page', this._osdHandler); } catch {}
            this._osdHandler = null;
        }
    };
    OSDEventsOnPageChange.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p.page);
        this.triggerSlot(0);
    };
    LG.registerNodeType('OSD/Events/OnPageChange', OSDEventsOnPageChange);


    // ─── OSD/Events/OnPick ────────────────────────────────────────────────────
    // Click nativo sul canvas OSD → coordinate immagine (px). Nota: se un tool
    // di disegno PJS è attivo, l'overlay Paper.js cattura il click prima che
    // arrivi a OSD (pointerEvents:auto durante il disegno) — questo nodo si
    // attiva quindi in modalità Navigate o quando non c'è overlay attivo.
    function OSDEventsOnPick() {
        this.addOutput('trigger', EVENT);
        this.addOutput('x',       'number');  // px immagine
        this.addOutput('y',       'number');  // px immagine
        this._pending    = null;
        this._osdHandler = null;
        this.color   = '#001a1a';
        this.bgcolor = '#002a2a';
        this.size    = [200, 90];
    }
    OSDEventsOnPick.title = 'Events On Pick';
    OSDEventsOnPick.desc  = 'Fires on a click on the OSD canvas — image coordinates (px)';
    OSDEventsOnPick.portHelp = {
        outputs: {
            trigger: "Event (EVENT) emitted on every native click on the OSD canvas ('canvas-click' handler). Note: if a PJS drawing tool is active, the Paper.js overlay catches the click before it gets here.",
            x: "X coordinate of the clicked point, in image pixels (number) — 0 if the conversion fails.",
            y: "Y coordinate of the clicked point, in image pixels (number) — 0 if the conversion fails.",
        },
    };
    OSDEventsOnPick.prototype.onStart = function () {
        const ctx    = this.graph?._appContext;
        const viewer = ctx?.viewer?.();
        if (!viewer) return;
        this._pending = null;
        const g    = this.graph;
        const self = this;
        const handler = ev => {
            try {
                const vp    = viewer.viewport;
                const vpPt  = vp.viewerElementToViewportCoordinates(ev.position);
                const imgPt = vp.viewportToImageCoordinates(vpPt);
                self._pending = { x: imgPt.x, y: imgPt.y };
            } catch {
                self._pending = { x: 0, y: 0 };
            }
            try { g.runStep(1); } catch {}
        };
        viewer.addHandler('canvas-click', handler);
        this._osdHandler = handler;
        ctx.signal?.addEventListener('abort', () => {
            try { viewer.removeHandler('canvas-click', self._osdHandler); } catch {}
        }, { once: true });
    };
    OSDEventsOnPick.prototype.onStop = function () {
        const viewer = this.graph?._appContext?.viewer?.();
        if (viewer && this._osdHandler) {
            try { viewer.removeHandler('canvas-click', this._osdHandler); } catch {}
            this._osdHandler = null;
        }
    };
    OSDEventsOnPick.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p.x);
        this.setOutputData(2, p.y);
        this.triggerSlot(0);
    };
    LG.registerNodeType('OSD/Events/OnPick', OSDEventsOnPick);
}
