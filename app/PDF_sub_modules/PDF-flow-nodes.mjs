// app/PDF_sub_modules/PDF-flow-nodes.mjs
// Nodi LiteGraph context-aware per pannelli PDF (PDF.js viewer + annotazioni).
// Leggono/scrivono lo stato del pannello via graph._appContext (vedi
// PDF-flow-runner.mjs) — mai import diretto di model_PDF.mjs (isolamento
// per pannello, stesso pattern di MPS-flow-nodes.mjs/MYS-flow-nodes.mjs).
//
// model_PDF.mjs non usa l'App Bus (nessun appBusOn/appBusEmit nel modulo):
// tutti i nodi Events/* si agganciano a graph._appContext.localEvents, una
// EventTarget creata apposta per questo (state.localEvents in model_PDF.mjs),
// stesso principio di DBJ/GSH/MYS.
//
// Cinque famiglie:
//   PDF/Events/*    — sorgenti (onStart → _pending → onExecute).
//   PDF/Nav/*       — navigazione pagina (onAction).
//   PDF/View/*      — zoom/rotazione/layout (onAction).
//   PDF/Document/*  — cambio documento attivo (onAction, asincrono).
//   PDF/Highlight/* — annotazioni: lettura/navigazione/visibilità/cancellazione.
//   PDF/Search/*    — ricerca full-text (onAction, FindText asincrono).

export function registerPDFFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[PDF-flow-nodes] LiteGraph non disponibile'); return; }
    if (window._PDF_FLOW_NODES_REGISTERED) return;
    window._PDF_FLOW_NODES_REGISTERED = true;

    const COLOR   = '#241a4a';
    const BGCOLOR = '#3a2a78';
    const EVCOLOR   = '#1a2a3a';
    const EVBGCOLOR = '#2a4a68';

    // Helper comune ai nodi Events/*: onStart auto-pulente (rimuove una
    // sottoscrizione precedente prima di ricrearla — onStart può essere
    // richiamato più volte quando il contesto del grafo cambia, vedi
    // model_FLE.mjs::_reinitGraphNodes / module-fle-architettura.md §4.2).
    function _wireLocalEvent(node, eventName, mapDetail) {
        node._cleanup?.();
        node._cleanup = null;
        const ctx = node.graph?._appContext;
        const bus = ctx?.localEvents;
        if (!bus) return;
        node._pending = null;
        const g = node.graph;
        const handler = ev => {
            node._pending = mapDetail ? mapDetail(ev.detail) : ev.detail;
            try { g.runStep(1); } catch {}
        };
        bus.addEventListener(eventName, handler);
        node._cleanup = () => bus.removeEventListener(eventName, handler);
        ctx.signal?.addEventListener('abort', () => node._cleanup?.(), { once: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Events/OnPageChange
    // ─────────────────────────────────────────────────────────────────────────
    function PDFEventsOnPageChange() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('page',    'number');
        this.addOutput('total',   'number');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 90];
    }
    PDFEventsOnPageChange.title = 'Events On Page Change';
    PDFEventsOnPageChange.desc  = 'Fires when the current page changes (scroll or navigation)';
    PDFEventsOnPageChange.portHelp = {
        outputs: {
            trigger: 'event — emitted on every page change',
            page:    'number — current page, 1-based',
            total:   'number — total pages of the document',
        },
    };
    PDFEventsOnPageChange.prototype.onStart = function () { _wireLocalEvent(this, 'pageChange'); };
    PDFEventsOnPageChange.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    PDFEventsOnPageChange.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p.page);
        this.setOutputData(2, p.total);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Events/OnPageChange', PDFEventsOnPageChange);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Events/OnScaleChange
    // ─────────────────────────────────────────────────────────────────────────
    function PDFEventsOnScaleChange() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('scale',   'number');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    PDFEventsOnScaleChange.title = 'Events On Scale Change';
    PDFEventsOnScaleChange.desc  = 'Fires when the zoom changes (CSS scale, e.g. 1.5 = 150%)';
    PDFEventsOnScaleChange.portHelp = {
        outputs: {
            trigger: 'event — emitted on every zoom change',
            scale:   'number — CSS scale factor applied to rendering (e.g. 1.5 = 150%)',
        },
    };
    PDFEventsOnScaleChange.prototype.onStart = function () { _wireLocalEvent(this, 'scaleChange'); };
    PDFEventsOnScaleChange.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    PDFEventsOnScaleChange.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p.scale);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Events/OnScaleChange', PDFEventsOnScaleChange);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Events/OnTextSelected
    // ─────────────────────────────────────────────────────────────────────────
    function PDFEventsOnTextSelected() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('text',    'string');
        this.addOutput('page',    'number');
        this.addOutput('rects',   'array');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 100];
    }
    PDFEventsOnTextSelected.title = 'Events On Text Selected';
    PDFEventsOnTextSelected.desc  = 'Fires when text is selected (requires the text layer to be enabled)';
    PDFEventsOnTextSelected.portHelp = {
        outputs: {
            trigger: 'event — emitted on every text selection',
            text:    'string — selected text, as is (sel.toString())',
            page:    'number — page where the selection is, 1-based',
            rects:   'array of {x,y,w,h} — one rectangle per selected line, NORMALIZED 0-1 coordinates relative to the page (not absolute pixels)',
        },
    };
    PDFEventsOnTextSelected.prototype.onStart = function () { _wireLocalEvent(this, 'textSelected'); };
    PDFEventsOnTextSelected.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    PDFEventsOnTextSelected.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p.text);
        this.setOutputData(2, p.pageNum);
        this.setOutputData(3, p.rects);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Events/OnTextSelected', PDFEventsOnTextSelected);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Events/OnHighlightSelected
    // ─────────────────────────────────────────────────────────────────────────
    function PDFEventsOnHighlightSelected() {
        this.addOutput('trigger',   LG.EVENT);
        this.addOutput('highlight', 'object');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    PDFEventsOnHighlightSelected.title = 'Events On Highlight Selected';
    PDFEventsOnHighlightSelected.desc  = "Fires when an annotation is selected (click in the panel or PDF/Highlight/GoTo)";
    PDFEventsOnHighlightSelected.portHelp = {
        outputs: {
            trigger:   'event — emitted on every annotation selection',
            highlight: 'object — row of pdf_highlights (join pdf_highlights_type): hl_id, mod_id, hlt_id, hl_text, hl_label, hl_note, hl_tags, hl_page (1-based), hl_scale, hl_rotation, hl_spread, hl_rects (array of {x,y,w,h} normalized 0-1), hl_marker_x/hl_marker_y (0-1), hl_user_id, hlt_title, hlt_color, hlt_is_view',
        },
    };
    PDFEventsOnHighlightSelected.prototype.onStart = function () { _wireLocalEvent(this, 'highlightSelected'); };
    PDFEventsOnHighlightSelected.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    PDFEventsOnHighlightSelected.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Events/OnHighlightSelected', PDFEventsOnHighlightSelected);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Events/OnAnnotationSaved
    // ─────────────────────────────────────────────────────────────────────────
    function PDFEventsOnAnnotationSaved() {
        this.addOutput('trigger',   LG.EVENT);
        this.addOutput('highlight', 'object');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    PDFEventsOnAnnotationSaved.title = 'Events On Annotation Saved';
    PDFEventsOnAnnotationSaved.desc  = "Fires when an annotation is saved successfully (new or edited)";
    PDFEventsOnAnnotationSaved.portHelp = {
        outputs: {
            trigger:   'event — emitted on every successful save (creation or edit)',
            highlight: 'object — row of pdf_highlights just saved, as returned by the server (hl_id, mod_id, hlt_id, hl_text, hl_label, hl_note, hl_tags, hl_page, hl_scale, hl_rotation, hl_spread, hl_rects, hl_marker_x/y, hl_user_id)',
        },
    };
    PDFEventsOnAnnotationSaved.prototype.onStart = function () { _wireLocalEvent(this, 'annotationSaved'); };
    PDFEventsOnAnnotationSaved.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    PDFEventsOnAnnotationSaved.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Events/OnAnnotationSaved', PDFEventsOnAnnotationSaved);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Events/OnAnnotationDeleted
    // ─────────────────────────────────────────────────────────────────────────
    function PDFEventsOnAnnotationDeleted() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('hl_id',   'number');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 70];
    }
    PDFEventsOnAnnotationDeleted.title = 'Events On Annotation Deleted';
    PDFEventsOnAnnotationDeleted.desc  = "Fires when an annotation is deleted successfully";
    PDFEventsOnAnnotationDeleted.portHelp = {
        outputs: {
            trigger: 'event — emitted on every successful deletion',
            hl_id:   'number — id (pdf_highlights.hl_id) of the annotation just deleted from the DB',
        },
    };
    PDFEventsOnAnnotationDeleted.prototype.onStart = function () {
        _wireLocalEvent(this, 'annotationDeleted', d => d.hl_id);
    };
    PDFEventsOnAnnotationDeleted.prototype.onStop = function () { this._cleanup?.(); this._cleanup = null; };
    PDFEventsOnAnnotationDeleted.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Events/OnAnnotationDeleted', PDFEventsOnAnnotationDeleted);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Nav/*
    // ─────────────────────────────────────────────────────────────────────────
    function PDFNavGoToPage() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('page',    'number');
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 60];
    }
    PDFNavGoToPage.title = 'Nav Go To Page';
    PDFNavGoToPage.desc  = 'Goes to the given page (1-based)';
    PDFNavGoToPage.portHelp = {
        inputs: {
            trigger: 'action — starts the navigation',
            page:    'number — target page, 1-based',
        },
        outputs: { done: 'event — emitted after the navigation' },
    };
    PDFNavGoToPage.prototype.onAction = function () {
        const ctx  = this.graph?._appContext;
        const page = this.getInputData(1);
        if (page == null || !ctx?.goToPage) return;
        ctx.goToPage(page);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Nav/GoToPage', PDFNavGoToPage);


    function PDFNavNextPage() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [160, 50];
    }
    PDFNavNextPage.title = 'Nav Next Page';
    PDFNavNextPage.desc  = 'Goes to the next page';
    PDFNavNextPage.portHelp = {
        inputs:  { trigger: 'action — starts the navigation' },
        outputs: { done:    'event — emitted after the navigation' },
    };
    PDFNavNextPage.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.nextPage) return;
        ctx.nextPage();
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Nav/NextPage', PDFNavNextPage);


    function PDFNavPrevPage() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [160, 50];
    }
    PDFNavPrevPage.title = 'Nav Prev Page';
    PDFNavPrevPage.desc  = 'Goes to the previous page';
    PDFNavPrevPage.portHelp = {
        inputs:  { trigger: 'action — starts the navigation' },
        outputs: { done:    'event — emitted after the navigation' },
    };
    PDFNavPrevPage.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.prevPage) return;
        ctx.prevPage();
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Nav/PrevPage', PDFNavPrevPage);


    function PDFNavGetCurrentPage() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('page',   'number');
        this.addOutput('total',  'number');
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 70];
    }
    PDFNavGetCurrentPage.title = 'Nav Get Current Page';
    PDFNavGetCurrentPage.desc  = 'Returns the current page and the total number of pages';
    PDFNavGetCurrentPage.portHelp = {
        inputs: { trigger: 'action — reads the values when the trigger arrives' },
        outputs: {
            page:  'number — current page, 1-based (null if no document is loaded)',
            total: 'number — total pages of the document (null if no document is loaded)',
        },
    };
    PDFNavGetCurrentPage.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        this.setOutputData(0, ctx?.currentPage ?? null);
        this.setOutputData(1, ctx?.totalPages  ?? null);
    };
    LG.registerNodeType('PDF/Nav/GetCurrentPage', PDFNavGetCurrentPage);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/View/*
    // ─────────────────────────────────────────────────────────────────────────
    function PDFViewSetZoom() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('scale',   'number');
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 60];
    }
    PDFViewSetZoom.title = 'View Set Zoom';
    PDFViewSetZoom.desc  = 'Sets the absolute zoom (CSS scale, e.g. 1.5 = 150%, clamped to 0.1–10)';
    PDFViewSetZoom.portHelp = {
        inputs: {
            trigger: 'action — applies the zoom',
            scale:   'number — absolute CSS scale factor (e.g. 1.5 = 150%), clamped internally to 0.1–10',
        },
        outputs: { done: 'event — emitted after it is applied' },
    };
    PDFViewSetZoom.prototype.onAction = function () {
        const ctx   = this.graph?._appContext;
        const scale = this.getInputData(1);
        if (scale == null || !ctx?.setZoom) return;
        ctx.setZoom(scale);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/View/SetZoom', PDFViewSetZoom);


    function PDFViewZoomStep() {
        this.addInput('trigger',   LG.ACTION);
        this.addInput('direction', 'number');   // +1 = avanti, -1 = indietro nei livelli preimpostati
        this.addOutput('done',     LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 60];
    }
    PDFViewZoomStep.title = 'View Zoom Step';
    PDFViewZoomStep.desc  = 'Moves one level through the zoom presets (direction: +1/-1)';
    PDFViewZoomStep.portHelp = {
        inputs: {
            trigger:   'action — moves one level forward/back',
            direction: 'number — any value >0 moves one level forward through the zoom presets, <=0 moves back',
        },
        outputs: { done: 'event — emitted after it is applied' },
    };
    PDFViewZoomStep.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const dir = this.getInputData(1);
        if (!ctx?.zoomStep) return;
        ctx.zoomStep(dir > 0 ? 1 : -1);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/View/ZoomStep', PDFViewZoomStep);


    function PDFViewFitWidth() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [170, 50];
    }
    PDFViewFitWidth.title = 'View Fit Width';
    PDFViewFitWidth.desc  = 'Fits the zoom to the panel width';
    PDFViewFitWidth.portHelp = {
        inputs:  { trigger: 'action — applies fit-to-width' },
        outputs: { done:    'event — emitted after it is applied' },
    };
    PDFViewFitWidth.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.fitWidth) return;
        ctx.fitWidth();
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/View/FitWidth', PDFViewFitWidth);


    function PDFViewFitPage() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [170, 50];
    }
    PDFViewFitPage.title = 'View Fit Page';
    PDFViewFitPage.desc  = 'Fits the zoom to show the whole page';
    PDFViewFitPage.portHelp = {
        inputs:  { trigger: 'action — applies fit-to-page' },
        outputs: { done:    'event — emitted after it is applied' },
    };
    PDFViewFitPage.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.fitPage) return;
        ctx.fitPage();
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/View/FitPage', PDFViewFitPage);


    function PDFViewSetRotation() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('deg',     'number');   // normalizzato a 0/90/180/270
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 60];
    }
    PDFViewSetRotation.title = 'View Set Rotation';
    PDFViewSetRotation.desc  = 'Sets the rotation (0, 90, 180, 270 — normalized to the nearest multiple of 90)';
    PDFViewSetRotation.portHelp = {
        inputs: {
            trigger: 'action — applies the rotation',
            deg:     'number — degrees, normalized internally to the nearest multiple of 90 (0/90/180/270)',
        },
        outputs: { done: 'event — emitted after it is applied' },
    };
    PDFViewSetRotation.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const deg = this.getInputData(1);
        if (deg == null || !ctx?.setRotation) return;
        ctx.setRotation(deg);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/View/SetRotation', PDFViewSetRotation);


    function PDFViewSetSpread() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('enabled', 'boolean');
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 60];
    }
    PDFViewSetSpread.title = 'View Set Spread';
    PDFViewSetSpread.desc  = 'Turns the two-page side-by-side view on/off';
    PDFViewSetSpread.portHelp = {
        inputs: {
            trigger: 'action — applies the setting',
            enabled: 'boolean — true = two pages side by side, false = single page',
        },
        outputs: { done: 'event — emitted after it is applied' },
    };
    PDFViewSetSpread.prototype.onAction = function () {
        const ctx     = this.graph?._appContext;
        const enabled = this.getInputData(1);
        if (!ctx?.setSpread) return;
        ctx.setSpread(!!enabled);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/View/SetSpread', PDFViewSetSpread);


    function PDFViewSetTextLayer() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('enabled', 'boolean');
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 60];
    }
    PDFViewSetTextLayer.title = 'View Set Text Layer';
    PDFViewSetTextLayer.desc  = 'Turns the text layer on/off (text selection — required by Events/OnTextSelected)';
    PDFViewSetTextLayer.portHelp = {
        inputs: {
            trigger: 'action — applies the setting',
            enabled: 'boolean — true enables the text layer (needed for Events/OnTextSelected to fire)',
        },
        outputs: { done: 'event — emitted after it is applied' },
    };
    PDFViewSetTextLayer.prototype.onAction = function () {
        const ctx     = this.graph?._appContext;
        const enabled = this.getInputData(1);
        if (!ctx?.setTextLayer) return;
        ctx.setTextLayer(!!enabled);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/View/SetTextLayer', PDFViewSetTextLayer);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Document/Open
    // ─────────────────────────────────────────────────────────────────────────
    function PDFDocumentOpen() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('index',   'number');   // 0-based, indice in models[]
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 60];
    }
    PDFDocumentOpen.title = 'Document Open';
    PDFDocumentOpen.desc  = 'Changes the active document of the panel (0-based index among the linked models) — asynchronous';
    PDFDocumentOpen.portHelp = {
        inputs: {
            trigger: 'action — starts the document change',
            index:   'number — 0-based index in the array of PDF models linked to the object (NOT a mod_id)',
        },
        outputs: { done: 'event — emitted ONLY after the asynchronous loading of the document has completed' },
    };
    PDFDocumentOpen.prototype.onAction = function () {
        const ctx   = this.graph?._appContext;
        const index = this.getInputData(1);
        if (index == null || !ctx?.openDocument) return;
        const self = this;
        // triggerSlot propaga subito ai link collegati appena richiamato — vedi
        // la stessa nota in DBJDataRefresh (DBJ-flow-nodes.mjs).
        Promise.resolve(ctx.openDocument(index))
            .then(() => { try { self.triggerSlot(0); } catch {} })
            .catch(err => console.warn('[PDF-flow-nodes] openDocument:', err));
    };
    LG.registerNodeType('PDF/Document/Open', PDFDocumentOpen);

    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Document/OpenUrl (2026-10-21)
    // ─────────────────────────────────────────────────────────────────────────
    function PDFDocumentOpenUrl() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('url',     'string');
        this.addOutput('done',   LG.EVENT);
        this.addOutput('pages',  'number');
        this.addProperty('via', 'auto', 'string');
        this.addWidget('combo', 'via', 'auto', v => { this.properties.via = v; }, { values: ['auto', 'direct', 'server'], property: 'via' });
        this._token = 0;
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [210, 80];
    }
    PDFDocumentOpenUrl.error_output = true;
    PDFDocumentOpenUrl.title = 'Document Open Url';
    PDFDocumentOpenUrl.desc  = 'Opens in the panel a PDF from a web address, outside the linked models (no annotations: they belong to a model). Many sites do not let other sites read their files: then the PDF passes through the platform server — asynchronous';
    PDFDocumentOpenUrl.portHelp = {
        inputs: {
            trigger: 'action — starts loading',
            url:     'string — http(s) address of a PDF, or a path of the platform',
        },
        outputs: {
            done:  'event — emitted ONLY after the document has been loaded and shown',
            pages: 'number — pages of the document',
            error: 'event — not an http(s) address, not a PDF, too big, unreachable, or refused by the server. Port hidden by default: right click → Show error',
        },
        properties: {
            via: 'auto = first directly from the site; if the site does not allow it, through the platform server (api/remote_file.php: only PDF, max 60 MB, only public addresses) · direct = only directly · server = always through the server',
        },
    };
    PDFDocumentOpenUrl.prototype.onAction = function () {
        this.clearError?.();
        const ctx = this.graph?._appContext;
        if (!ctx?.openUrl) { this.triggerError?.(new Error('not a PDF panel')); return; }
        const token = ++this._token;
        const self = this;
        Promise.resolve(ctx.openUrl(this.getInputData(this.findInputSlot('url')), { via: this.properties.via }))
            .then(r => {
                if (token !== self._token) return;
                self.setOutputData(self.findOutputSlot('pages'), r?.pages ?? null);
                self.triggerSlot(self.findOutputSlot('done'));
            })
            .catch(err => { if (token === self._token && err?.message !== 'superseded') self.triggerError?.(err); });
    };
    LG.registerNodeType('PDF/Document/OpenUrl', PDFDocumentOpenUrl);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Highlight/*
    // ─────────────────────────────────────────────────────────────────────────
    function PDFHighlightGetAll() {
        this.addInput('trigger',     LG.ACTION);
        this.addOutput('highlights', 'array');
        this.addOutput('count',      'number');
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 70];
    }
    PDFHighlightGetAll.title = 'Highlight Get All';
    PDFHighlightGetAll.desc  = 'Returns the annotations loaded for the current document';
    PDFHighlightGetAll.portHelp = {
        inputs: { trigger: 'action — reads the list when the trigger arrives' },
        outputs: {
            highlights: 'array of objects — rows of pdf_highlights for the current document (hl_id, mod_id, hlt_id, hl_text, hl_label, hl_note, hl_tags, hl_page, hl_scale, hl_rotation, hl_spread, hl_rects, hl_marker_x/y, hl_user_id, hlt_title, hlt_color, hlt_is_view)',
            count:      'number — length of the highlights array',
        },
    };
    PDFHighlightGetAll.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const hls = ctx?.getHighlights?.() ?? [];
        this.setOutputData(0, hls);
        this.setOutputData(1, hls.length);
    };
    LG.registerNodeType('PDF/Highlight/GetAll', PDFHighlightGetAll);


    function PDFHighlightGoTo() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('hl_id',   0);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 60];
    }
    PDFHighlightGoTo.title = 'Highlight Go To';
    PDFHighlightGoTo.desc  = "Goes to an annotation (same effect as a click in the annotations panel — also fires Events/OnHighlightSelected)";
    PDFHighlightGoTo.portHelp = {
        inputs: {
            trigger: 'action — starts the navigation',
            hl_id:   'number — id (pdf_highlights.hl_id) of the target annotation',
        },
        outputs: { done: 'event — emitted ONLY if the annotation still exists (also fires Events/OnHighlightSelected)' },
    };
    PDFHighlightGoTo.prototype.onAction = function () {
        const ctx   = this.graph?._appContext;
        const hl_id = this.getInputData(1);
        if (hl_id == null || !ctx?.goToHighlight) return;
        if (ctx.goToHighlight(hl_id)) this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Highlight/GoTo', PDFHighlightGoTo);


    function PDFHighlightShowAll() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 50];
    }
    PDFHighlightShowAll.title = 'Highlight Show All';
    PDFHighlightShowAll.desc  = 'Shows the annotations on all pages';
    PDFHighlightShowAll.portHelp = {
        inputs:  { trigger: 'action — shows the annotations' },
        outputs: { done:    'event — emitted after it is applied' },
    };
    PDFHighlightShowAll.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.showAllHighlights) return;
        ctx.showAllHighlights();
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Highlight/ShowAll', PDFHighlightShowAll);


    function PDFHighlightShowPage() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('page',    'number');
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 60];
    }
    PDFHighlightShowPage.title = 'Highlight Show Page';
    PDFHighlightShowPage.desc  = 'Shows the annotations only on the given page';
    PDFHighlightShowPage.portHelp = {
        inputs: {
            trigger: 'action — shows the annotations',
            page:    'number — page on which to show the annotations, 1-based',
        },
        outputs: { done: 'event — emitted after it is applied' },
    };
    PDFHighlightShowPage.prototype.onAction = function () {
        const ctx  = this.graph?._appContext;
        const page = this.getInputData(1);
        if (page == null || !ctx?.showPageHighlights) return;
        ctx.showPageHighlights(page);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Highlight/ShowPage', PDFHighlightShowPage);


    function PDFHighlightHide() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [170, 50];
    }
    PDFHighlightHide.title = 'Highlight Hide';
    PDFHighlightHide.desc  = 'Hides all visible annotations';
    PDFHighlightHide.portHelp = {
        inputs:  { trigger: 'action — hides the annotations' },
        outputs: { done:    'event — emitted after it is applied' },
    };
    PDFHighlightHide.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.hideHighlights) return;
        ctx.hideHighlights();
        this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Highlight/Hide', PDFHighlightHide);


    function PDFHighlightDelete() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('hl_id',   0);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 60];
    }
    PDFHighlightDelete.title = 'Highlight Delete';
    PDFHighlightDelete.desc  = "Deletes an annotation (asynchronous, no confirmation — also fires Events/OnAnnotationDeleted)";
    PDFHighlightDelete.portHelp = {
        inputs: {
            trigger: 'action — starts the deletion',
            hl_id:   'number — id (pdf_highlights.hl_id) of the annotation to delete',
        },
        outputs: { done: 'event — emitted ONLY when the deletion succeeds in the DB (asynchronous, no confirmation asked — also fires Events/OnAnnotationDeleted)' },
    };
    PDFHighlightDelete.prototype.onAction = function () {
        const ctx   = this.graph?._appContext;
        const hl_id = this.getInputData(1);
        if (hl_id == null || !ctx?.deleteHighlight) return;
        const self = this;
        Promise.resolve(ctx.deleteHighlight(hl_id))
            .then(ok => { if (ok) { try { self.triggerSlot(0); } catch {} } })
            .catch(err => console.warn('[PDF-flow-nodes] deleteHighlight:', err));
    };
    LG.registerNodeType('PDF/Highlight/Delete', PDFHighlightDelete);


    // ─────────────────────────────────────────────────────────────────────────
    // PDF/Search/*
    // ─────────────────────────────────────────────────────────────────────────
    function PDFSearchFindText() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('query',   'string');
        this.addOutput('done',    LG.EVENT);
        this.addOutput('matches', 'array');
        this.addOutput('count',   'number');
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [200, 90];
    }
    PDFSearchFindText.title = 'Search Find Text';
    PDFSearchFindText.desc  = 'Searches a string in the whole document (asynchronous) and goes to the first result — no visual highlighting, only page navigation (see pdfSearchText, PDF-core.mjs)';
    PDFSearchFindText.portHelp = {
        inputs: {
            trigger: 'action — starts the search',
            query:   'string — text to search, case-insensitive, in the whole text of the document',
        },
        outputs: {
            done:    'event — emitted after the asynchronous search has completed (no match required)',
            matches: 'array of {page, index, snippet} — page: 1-based page number of the match; index: position of the match in the concatenated text of the page; snippet: ~60 characters of context around the match',
            count:   'number — length of the matches array',
        },
    };
    PDFSearchFindText.prototype.onAction = function () {
        const ctx   = this.graph?._appContext;
        const query = this.getInputData(1);
        if (!query || !ctx?.searchText) return;
        const self = this;
        ctx.searchText(query)
            .then(matches => {
                self.setOutputData(1, matches);
                self.setOutputData(2, matches.length);
                try { self.triggerSlot(0); } catch {}
            })
            .catch(err => console.warn('[PDF-flow-nodes] searchText:', err));
    };
    LG.registerNodeType('PDF/Search/FindText', PDFSearchFindText);


    function PDFSearchGoToMatch() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('index',   'number');
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 60];
    }
    PDFSearchGoToMatch.title = 'Search Go To Match';
    PDFSearchGoToMatch.desc  = "Goes to the page of result n (0-based index in the last search)";
    PDFSearchGoToMatch.portHelp = {
        inputs: {
            trigger: 'action — starts the navigation',
            index:   'number — 0-based index in the matches array of the last search (PDF/Search/FindText)',
        },
        outputs: { done: 'event — emitted ONLY if the index is valid' },
    };
    PDFSearchGoToMatch.prototype.onAction = function () {
        const ctx   = this.graph?._appContext;
        const index = this.getInputData(1);
        if (index == null || !ctx?.goToSearchMatch) return;
        if (ctx.goToSearchMatch(index)) this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Search/GoToMatch', PDFSearchGoToMatch);


    function PDFSearchNext() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 50];
    }
    PDFSearchNext.title = 'Search Next';
    PDFSearchNext.desc  = 'Goes to the next result (back to the first after the last)';
    PDFSearchNext.portHelp = {
        inputs:  { trigger: 'action — moves to the next result' },
        outputs: { done:    'event — emitted ONLY if the last search has at least one result (cyclic: back to the first after the last)' },
    };
    PDFSearchNext.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.nextSearchMatch) return;
        if (ctx.nextSearchMatch()) this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Search/Next', PDFSearchNext);


    function PDFSearchPrev() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 50];
    }
    PDFSearchPrev.title = 'Search Prev';
    PDFSearchPrev.desc  = "Goes to the previous result (back to the last before the first)";
    PDFSearchPrev.portHelp = {
        inputs:  { trigger: 'action — moves back to the previous result' },
        outputs: { done:    'event — emitted ONLY if the last search has at least one result (cyclic: back to the last before the first)' },
    };
    PDFSearchPrev.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.prevSearchMatch) return;
        if (ctx.prevSearchMatch()) this.triggerSlot(0);
    };
    LG.registerNodeType('PDF/Search/Prev', PDFSearchPrev);
}
