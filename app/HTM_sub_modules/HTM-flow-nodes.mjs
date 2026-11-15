// app/HTM_sub_modules/HTM-flow-nodes.mjs
// Nodi LiteGraph context-aware per pannelli HTM in mode:"flow" (vedi
// model_HTM.mjs + HTM-flow-runner.mjs). Leggono/scrivono lo stato del
// pannello via graph._appContext.container — mai import diretto di
// model_HTM.mjs (isolamento per pannello, stesso pattern di
// TJS-flow-nodes.mjs / OSD-flow-nodes.mjs / MPS-flow-nodes.mjs).
//
// Famiglia HTM/DOM/*:
//   Container, Label — creano un elemento e lo agganciano a un parent
//     (input opzionale, default graph._appContext.container). onExecute
//     idempotente: crea l'elemento SOLO al primo giro (this._el), poi si
//     limita ad aggiornare testo/classe/stile se cambiati. Necessario
//     perché runStep() esegue TUTTO il grafo a ogni step (vedi
//     module-fle-architettura.md §3.1) — senza guardia ricreerebbero
//     l'elemento (perdendo focus/stato) a ogni evento, anche non correlato.
//   Button, Input — come sopra, ma sono anche SORGENTI di trigger: al primo
//     onExecute agganciano un listener DOM reale (click/input) che imposta
//     un flag e richiama graph.runStep(1) — stesso schema onStart→pending
//     →onExecute usato da MPS/Events/* e OSD/Events/*, adattato: qui
//     l'aggancio avviene in onExecute (non onStart) perché l'elemento non
//     esiste ancora al primo onStart del grafo.
//   Query — non crea nulla: cerca un elemento già presente nello scheletro
//     HTML statico (mod_spec.srcdoc) tramite selettore CSS, per permettere
//     al flow di popolare/gestire un "aggancio" preparato dall'autore
//     dell'HTML invece di costruire tutto da zero via nodi.

import { registerHTMHysNodes } from "./HTM-hys-nodes.mjs";
import { makeAppScriptNode } from "../FLE_sub_modules/FLE-app-script-node.mjs";
import { registerHTMDomElementNodes } from "./HTM-dom-element-nodes.mjs";

export function registerHTMFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[HTM-flow-nodes] LiteGraph not available'); return; }
    if (window._HTM_FLOW_NODES_REGISTERED) return;
    window._HTM_FLOW_NODES_REGISTERED = true;

    // Nodi HTM/HYS/* (scheda dell'esercitazione di HySpace): file a parte
    registerHTMHysNodes();

    const COLOR   = '#3a2400';
    const BGCOLOR = '#6a4a00';
    const EVCOLOR   = '#062a1a';
    const EVBGCOLOR = '#0a4a2e';

    // ─────────────────────────────────────────────────────────────────────────
    // Helper condivisi
    // ─────────────────────────────────────────────────────────────────────────

    // Risolve il parent a cui agganciare l'elemento: input collegato (deve
    // essere un vero Node del DOM) oppure, di default, il contenitore del
    // documento corrente (graph._appContext.container — un getter lazy,
    // sempre il div vivo anche se il documento è stato ricaricato).
    function resolveParent(node, inputIndex) {
        const linked = node.getInputData(inputIndex);
        if (linked && typeof linked === 'object' && linked.nodeType === 1) return linked;
        return node.graph?._appContext?.container ?? null;
    }

    function ensureAttached(el, parent) {
        if (parent && el.parentElement !== parent) parent.appendChild(el);
    }

    function updateClassStyle(el, props) {
        const cls = props.css_class || '';
        if (el.className !== cls) el.className = cls;
        const style = props.style || '';
        if (el.getAttribute('style') !== style) el.setAttribute('style', style);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Container — <div> generico, per layout senza HTML statico
    // ─────────────────────────────────────────────────────────────────────────
    function HTMDomContainer() {
        this.addProperty('css_class', '', 'string');
        this.addProperty('style',     '', 'string');
        this.addWidget('text', 'class', '', v => { this.properties.css_class = String(v ?? ''); }, { property: 'css_class' });
        this.addWidget('text', 'style', '', v => { this.properties.style = String(v ?? ''); }, { property: 'style' });
        this.addInput('parent', 'object');
        this.addOutput('el', 'object');
        this._el = null;
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [200, 90];
    }
    HTMDomContainer.title = 'DOM Container';
    HTMDomContainer.desc  = 'Creates a <div> in the document; other HTM/DOM/* nodes can attach to it via "parent"';
    HTMDomContainer.portHelp = {
        inputs: {
            parent: 'DOM element (Node) to attach the <div> to — if not connected, or if the connected value is not a real DOM Node, defaults to the root container of the HTM panel.',
        },
        outputs: {
            el: 'Reference to the created <div> element (DOM Node) — pass it as "parent" to other HTM/DOM/* nodes to nest them inside.',
        },
    };
    HTMDomContainer.prototype.onExecute = function () {
        if (!this._el) this._el = document.createElement('div');
        ensureAttached(this._el, resolveParent(this, 0));
        updateClassStyle(this._el, this.properties);
        this.setOutputData(0, this._el);
    };
    HTMDomContainer.prototype.onRemoved = function () {
        try { this._el?.remove(); } catch {}
        this._el = null;
    };
    LG.registerNodeType('HTM/DOM/Container', HTMDomContainer);


    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Label — testo statico o dinamico (input "text" sovrascrive il widget)
    // ─────────────────────────────────────────────────────────────────────────
    function HTMDomLabel() {
        this.addProperty('text_default', '', 'string');
        this.addProperty('css_class',    '', 'string');
        this.addProperty('style',        '', 'string');
        this.addWidget('text', 'text', '', v => { this.properties.text_default = String(v ?? ''); }, { property: 'text_default' });
        this.addWidget('text', 'class', '', v => { this.properties.css_class = String(v ?? ''); }, { property: 'css_class' });
        this.addInput('parent', 'object');
        this.addInput('text',   0);
        this.addOutput('el', 'object');
        this._el = null;
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [200, 100];
    }
    HTMDomLabel.title = 'DOM Label';
    HTMDomLabel.desc  = 'Creates a text <span>; if "text" is connected it overrides the widget';
    HTMDomLabel.portHelp = {
        inputs: {
            parent: 'DOM element (Node) to attach the <span> to — default: root container of the panel, as in DOM Container.',
            text:   'Text to show (any value, converted to string with String()) — if connected, overrides the "text" widget; if not connected or null/undefined, the widget value is kept.',
        },
        outputs: {
            el: 'Reference to the created <span> element (DOM Node).',
        },
    };
    HTMDomLabel.prototype.onExecute = function () {
        if (!this._el) this._el = document.createElement('span');
        ensureAttached(this._el, resolveParent(this, 0));
        updateClassStyle(this._el, this.properties);
        const text = this.getInputData(1);
        const value = (text !== undefined && text !== null) ? text : this.properties.text_default;
        const str = String(value ?? '');
        if (this._el.textContent !== str) this._el.textContent = str;
        this.setOutputData(0, this._el);
    };
    HTMDomLabel.prototype.onRemoved = function () {
        try { this._el?.remove(); } catch {}
        this._el = null;
    };
    LG.registerNodeType('HTM/DOM/Label', HTMDomLabel);


    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Button — sorgente di trigger "click"
    // ─────────────────────────────────────────────────────────────────────────
    function HTMDomButton() {
        this.addProperty('text_default', 'Button', 'string');
        this.addProperty('css_class',    'btn btn-primary btn-sm', 'string');
        this.addWidget('text', 'text', 'Button', v => { this.properties.text_default = String(v ?? ''); }, { property: 'text_default' });
        this.addWidget('text', 'class', 'btn btn-primary btn-sm', v => { this.properties.css_class = String(v ?? ''); }, { property: 'css_class' });
        this.addInput('parent', 'object');
        this.addInput('text',   0);
        this.addOutput('click', LG.EVENT);
        this.addOutput('el',    'object');
        this._el = null;
        this._clicked = false;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [200, 100];
    }
    HTMDomButton.title = 'DOM Button';
    HTMDomButton.desc  = 'Creates a <button>; fires "click" (trigger) on every press';
    HTMDomButton.portHelp = {
        inputs: {
            parent: 'DOM element (Node) to attach the <button> to — default: root container of the panel.',
            text:   'Button label (any value, converted to string) — if connected, overrides the "text" widget.',
        },
        outputs: {
            click: 'Trigger (EVENT): fired once on every REAL user click on the button in the browser — not fired by code/other nodes.',
            el:    'Reference to the created <button> element (DOM Node).',
        },
    };
    HTMDomButton.prototype.onExecute = function () {
        if (!this._el) {
            this._el = document.createElement('button');
            this._el.type = 'button';
            this._el.addEventListener('click', () => {
                this._clicked = true;
                try { this.graph?.runStep(1); } catch {}
            });
        }
        ensureAttached(this._el, resolveParent(this, 0));
        updateClassStyle(this._el, this.properties);
        const text = this.getInputData(1);
        const value = (text !== undefined && text !== null) ? text : this.properties.text_default;
        const str = String(value ?? '');
        if (this._el.textContent !== str) this._el.textContent = str;
        this.setOutputData(1, this._el);
        if (this._clicked) {
            this._clicked = false;
            this.triggerSlot(0);
        }
    };
    HTMDomButton.prototype.onRemoved = function () {
        try { this._el?.remove(); } catch {}
        this._el = null;
    };
    LG.registerNodeType('HTM/DOM/Button', HTMDomButton);


    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Input — campo di input; sorgente di trigger "change"
    // ─────────────────────────────────────────────────────────────────────────
    function HTMDomInput() {
        this.addProperty('input_type',   'text', 'string');
        this.addProperty('placeholder',  '', 'string');
        this.addProperty('value_default','', 'string');
        this.addProperty('css_class',    'form-control form-control-sm', 'string');
        this.addWidget('combo', 'type', 'text',
            v => { this.properties.input_type = v; },
            { property: 'input_type', values: ['text', 'number', 'email', 'password', 'checkbox'] });
        this.addWidget('text', 'placeholder', '', v => { this.properties.placeholder = String(v ?? ''); }, { property: 'placeholder' });
        this.addWidget('text', 'class', 'form-control form-control-sm', v => { this.properties.css_class = String(v ?? ''); }, { property: 'css_class' });
        this.addInput('parent', 'object');
        this.addInput('value',  0); // per impostare il valore da flow (programmatico)
        this.addOutput('change', LG.EVENT);
        this.addOutput('value',  0);
        this.addOutput('el',     'object');
        this._el = null;
        this._changed = false;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [200, 130];
    }
    HTMDomInput.title = 'DOM Input';
    HTMDomInput.desc  = 'Creates an <input>; fires "change" (trigger) and outputs the current value on every keystroke';
    HTMDomInput.portHelp = {
        inputs: {
            parent: 'DOM element (Node) to attach the <input> to — default: root container of the panel.',
            value:  'Value to SET on the field programmatically: string for text/number/email/password types, boolean for checkbox — overrides the current value ONLY if different from the one already there (prevents user typing from being rewritten if the graph closes a value→value loop).',
        },
        outputs: {
            change: 'Trigger (EVENT): fired on every REAL user edit of the field (DOM events "input" and "change") — not fired when the value changes via the "value" input.',
            value:  'Current value of the field: string for text/number types, boolean for checkbox.',
            el:     'Reference to the created <input> element (DOM Node).',
        },
    };
    HTMDomInput.prototype.onExecute = function () {
        if (!this._el) {
            this._el = document.createElement('input');
            const onUserEdit = () => {
                this._changed = true;
                try { this.graph?.runStep(1); } catch {}
            };
            this._el.addEventListener('input',  onUserEdit);
            this._el.addEventListener('change', onUserEdit);
        }
        ensureAttached(this._el, resolveParent(this, 0));
        updateClassStyle(this._el, this.properties);

        const type = this.properties.input_type || 'text';
        if (this._el.type !== type) this._el.type = type;
        if (this._el.placeholder !== this.properties.placeholder) this._el.placeholder = this.properties.placeholder || '';

        // Valore imposto dal flow (link "value") sovrascrive quello corrente
        // SOLO se diverso — altrimenti ogni digitazione dell'utente verrebbe
        // subito riscritta dal proprio stesso valore in uscita (se qualcuno
        // ha richiuso il loop value→value nel grafo).
        const isCheckbox = type === 'checkbox';
        const incoming = this.getInputData(1);
        if (incoming !== undefined && incoming !== null) {
            if (isCheckbox) {
                const b = !!incoming;
                if (this._el.checked !== b) this._el.checked = b;
            } else if (String(incoming) !== this._el.value) {
                this._el.value = String(incoming);
            }
        } else if (!this._initialized) {
            if (isCheckbox) this._el.checked = !!this.properties.value_default;
            else this._el.value = this.properties.value_default || '';
        }
        this._initialized = true;

        this.setOutputData(1, isCheckbox ? this._el.checked : this._el.value);
        this.setOutputData(2, this._el);
        if (this._changed) {
            this._changed = false;
            this.triggerSlot(0);
        }
    };
    HTMDomInput.prototype.onRemoved = function () {
        try { this._el?.remove(); } catch {}
        this._el = null;
    };
    LG.registerNodeType('HTM/DOM/Input', HTMDomInput);


    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Query — aggancia un elemento già presente nello scheletro
    // statico (mod_spec.srcdoc) tramite selettore CSS
    // ─────────────────────────────────────────────────────────────────────────
    function HTMDomQuery() {
        this.addProperty('selector', '', 'string');
        this.addWidget('text', 'CSS selector', '', v => { this.properties.selector = String(v ?? ''); }, { property: 'selector' });
        this.addOutput('el', 'object');
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [200, 70];
    }
    HTMDomQuery.title = 'DOM Query';
    HTMDomQuery.desc  = 'Finds an existing element in the document by CSS selector (e.g. "#slot-1")';
    HTMDomQuery.portHelp = {
        outputs: {
            el: 'DOM element found with querySelector(selector) in the static HTML skeleton of the panel (mod_spec.srcdoc) — null if the selector is empty or matches nothing. No inputs: the selector is set only from the node\'s "selector" widget/property.',
        },
    };
    HTMDomQuery.prototype.onExecute = function () {
        const root = this.graph?._appContext?.container;
        const sel  = this.properties.selector || '';
        const el   = (root && sel) ? root.querySelector(sel) : null;
        this.setOutputData(0, el || null);
    };
    LG.registerNodeType('HTM/DOM/Query', HTMDomQuery);

    // Nodi che agiscono su elementi già presenti (On Event, Get/Set Value, Set Text|Class|Attr,
    // Chat View — 2026-10-04): file a parte
    registerHTMDomElementNodes(LG);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/Script (2026-09-28, step 9 di _doc/arch-abilitazioni.md §7): sostituisce
    // la modalità "inject" (script dentro l'HTML del modello, eseguiti senza
    // controlli). Il codice riceve container (il div del documento) e vars;
    // contiene codice → il flow passa dalla validazione (nodo critico lato server).
    // ─────────────────────────────────────────────────────────────────────────
    const HTMScript = makeAppScriptNode(LG, {
        title: 'HTM Script',
        desc:  "JavaScript code for an HTM document: receives container (the document div, with the HTML skeleton already inserted) " +
               "and vars. By default it runs once when the flow starts. Replaces the <script> tags of the old 'inject' mode. " +
               "Contains code: the flow must be validated before it runs for other users.",
        contextNames: ['container'],
        getContext: (graph) => {
            const c = graph?._appContext?.container;
            return c ? { container: c } : null;
        },
        defaultCode: "// container, vars\ncontainer.querySelector('h1')?.classList.add('text-primary');",
        missingContext: 'no HTM document: the flow must be attached to an HTM object (or tested with "Test on panel")',
    });
    LG.registerNodeType('HTM/Script', HTMScript);
}
