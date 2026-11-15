// app/FLE_sub_modules/FLE-tree-nodes.mjs
// Nodi per alberi JSON { name, type, children } (2026-10-07) — generici: la struttura di
// una scena (TJS/Scene/GetTree), ma anche qualunque gerarchia con le stesse chiavi.
//
//   Params/Data/Tree Filter — toglie dall'albero i nodi che corrispondono a delle regole.
//
// Regole: una per riga, "Tipo = nome", con i jolly di TJS/Scene/NameFilter ('*' sequenza
// qualunque, '?' un carattere); più righe valgono in OR. "" = nome vuoto. Una riga senza
// '=' indica solo il tipo (qualunque nome). Righe vuote e righe che iniziano con '#'
// sono ignorate. Tipo: maiuscole indifferenti (come GetTree); nome: maiuscole contano
// (come NameFilter).
//   Group = ""        gruppi senza nome
//   Group = Pippo*    gruppi il cui nome inizia per Pippo
//   * = Helper*       qualunque tipo, nome che inizia per Helper
// Modo: "solleva figli" (il nodo sparisce, i figli salgono al genitore) oppure "togli ramo"
// (sparisce con tutto ciò che contiene). La radice non viene mai tolta. L'albero in
// ingresso non viene modificato: in uscita c'è una copia.
// A evento (trigger → done) e non continuo: in mezzo a una catena di eventi (Receiver →
// Tree Filter → ECH/Graph/FromTree) un nodo continuo leggerebbe dati vecchi.
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

const MODES = ['lift children', 'remove branch'];

function globToRegExp(glob, flags = '') {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + escaped + '$', flags);
}

/**
 * Regole dal testo del widget.
 * @returns {Array<{ type: RegExp, name: RegExp|null, line: number }>}
 * @throws Error con il numero di riga se una regola non è valida
 */
export function parseTreeRules(text) {
    const rules = [];
    String(text ?? '').split('\n').forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const eq = line.indexOf('=');
        const typePart = (eq === -1 ? line : line.slice(0, eq)).trim();
        let namePart = eq === -1 ? null : line.slice(eq + 1).trim();
        if (!typePart) throw new Error(`line ${i + 1}: missing type before "=" (use * for any type)`);
        if (namePart != null && namePart.length >= 2 && namePart.startsWith('"') && namePart.endsWith('"')) {
            namePart = namePart.slice(1, -1);   // "" = nome vuoto, "Pippo*" = Pippo*
        }
        rules.push({
            type: globToRegExp(typePart, 'i'),
            name: namePart == null ? null : globToRegExp(namePart),
            line: i + 1,
        });
    });
    return rules;
}

/**
 * Copia filtrata di un albero { name, type, children }.
 * @param {object} tree
 * @param {Array} rules   da parseTreeRules
 * @param {'lift children'|'remove branch'} mode
 * @returns {{ tree: object, removed: number }}
 */
export function filterTree(tree, rules, mode) {
    let removed = 0;
    const matches = n => rules.some(r =>
        r.type.test(String(n?.type ?? '')) && (r.name == null || r.name.test(String(n?.name ?? ''))));
    const countAll = n => 1 + (Array.isArray(n?.children) ? n.children.reduce((s, c) => s + countAll(c), 0) : 0);
    // figli filtrati di un nodo, già "appiattiti" quando un figlio viene sciolto
    const filterChildren = (children) => {
        const out = [];
        for (const c of Array.isArray(children) ? children : []) {
            if (!c || typeof c !== 'object') continue;
            if (rules.length && matches(c)) {
                if (mode === 'remove branch') { removed += countAll(c); continue; }
                removed += 1;
                out.push(...filterChildren(c.children));   // solleva i figli al genitore
                continue;
            }
            out.push({ ...c, children: filterChildren(c.children) });
        }
        return out;
    };
    return { tree: { ...tree, children: filterChildren(tree.children) }, removed };
}

export function registerTreeNodes(LG) {
    if (!LG) return;

    function TreeFilter() {
        this.addProperty('rules', '', 'string');
        this.addProperty('mode', MODES[0], 'string');
        this.addWidget('text', 'rules (Type = name, one per line)', '', v => { this.properties.rules = String(v ?? ''); }, { property: 'rules', multiline: true });
        this.addWidget('combo', 'mode', MODES[0], v => { this.properties.mode = v; }, { values: MODES, property: 'mode' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('tree', 'object');
        this.addOutput('done', LG.EVENT);
        this.addOutput('tree', 'object');
        this.addOutput('removed', 'number');
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [260, 120];
    }
    TreeFilter.title = 'Tree Filter';
    TreeFilter.desc  = 'Removes from a tree { name, type, children } (e.g. from TJS/Scene/GetTree) the nodes matching the rules "Type = name": only the node, lifting its children, or the whole branch. Works everywhere';
    TreeFilter.error_output = true;
    TreeFilter.portHelp = {
        inputs: {
            trigger: 'event — filters (usually from the done of Scene Get Tree or the trigger of an App Bus Receiver)',
            tree:    'object { name, type, children: [...] } — not modified',
        },
        outputs: {
            done:    'event — filtered tree ready',
            tree:    'object — filtered copy, same shape as the input (the root always stays)',
            removed: 'number — removed nodes (with "remove branch" the nodes of the branch count too)',
            error:   'event — "tree" is not an object or a rule is not valid (gives the line). Port hidden by default: right click → Show error',
        },
        properties: {
            rules: 'one rule per line, "Type = name", several lines in OR. Wildcards: * (any sequence), ? (one character). "" = empty name; without "=" any name matches; # at the start = comment. Type is case-insensitive, name is case-sensitive. Examples: Group = ""   ·   Group = Foo*   ·   * = Helper*   ·   Mesh = *_tmp. Empty = no filter (tree copied as is)',
            mode:  'lift children = only the node disappears, its children move up to the parent (e.g. unnamed container groups); remove branch = it disappears with everything it contains. To use both: two Tree Filters in a row',
        },
    };
    TreeFilter.prototype.onAction = function () {
        this.clearError?.();
        const tree = this.getInputData(this.findInputSlot('tree'));
        if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
            this.triggerError?.(new Error('"tree" must be an object { name, type, children }'));
            return;
        }
        let rules;
        try { rules = parseTreeRules(this.properties.rules); }
        catch (err) { this.triggerError?.(err); return; }
        const mode = MODES.includes(this.properties.mode) ? this.properties.mode : MODES[0];
        const res = filterTree(tree, rules, mode);
        this.setOutputData(this.findOutputSlot('tree'), res.tree);
        this.setOutputData(this.findOutputSlot('removed'), res.removed);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    LG.registerNodeType('Params/Data/Tree Filter', TreeFilter);
}
