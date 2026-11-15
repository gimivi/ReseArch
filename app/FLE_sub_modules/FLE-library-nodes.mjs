// app/FLE_sub_modules/FLE-library-nodes.mjs
// Nodi di libreria (step 8 di _doc/arch-abilitazioni.md §6): script validati e
// promossi dall'amministratore a nodi con porte fisse e codice NON modificabile.
// Il codice sta nel DB (tabella fle_library_nodes), non nel grafo: il grafo
// salva solo il tipo del nodo e la versione usata (properties.lib_version).
// Per questo un flow che usa solo nodi di libreria non richiede validazione.
//
// Tipo LiteGraph: 'ReseArch/Libreria/<categoria>/<nome>'. Categoria e nome sono
// fissi dalla creazione (cambiarli renderebbe orfani i flow che li usano).
//
// Versioni: aggiornamento ESPLICITO. Ogni nodo nel grafo resta sulla versione
// con cui è stato inserito; se ne esiste una più recente, il titolo lo segnala e
// il menu del nodo (tasto destro) offre "Update to version N". Le versioni
// ritirate restano eseguibili per i flow che le usano, ma non si inseriscono più.
//
// Esecuzione: stesse regole di Script/Flexi — gira su 'trigger' (ACTION), gli
// input arrivano come variabili, più `vars` condiviso; 'done' su successo,
// 'error' (ultima uscita) se il codice lancia un'eccezione.
//
// Caricamento: ensureLibraryNodes() scarica il catalogo una volta per pagina
// e registra i tipi. FLE-api.mjs la attende prima di ogni fleLoad /
// fleListForObject, così un grafo non viene mai configurato prima che i suoi
// nodi di libreria esistano. registerFlowNodes() (che svuota il registro di
// LiteGraph) richiama reregisterLibraryNodes() alla fine.

const API = 'api/fle_library_tool.php';
const TYPE_PREFIX = 'ReseArch/Libreria/';

let _catalog = null;        // Map type → { category, name, versions: Map<n, def>, latest, latestActive }
let _loading = null;        // Promise del primo caricamento

function _parseNames(str) {
    return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** Tipo LiteGraph di un nodo di libreria. */
export function libraryType(category, name) {
    return `${TYPE_PREFIX}${category}/${name}`;
}

async function _fetchCatalog() {
    const r = await fetch(`${API}?action=list`, { credentials: 'same-origin' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) throw new Error(j?.error || `HTTP ${r.status}`);
    const map = new Map();
    for (const n of j.data || []) {
        const versions = new Map();
        let latest = 0, latestActive = 0;
        for (const v of n.versions) {
            versions.set(v.version, {
                ...v,
                inputs:  _parseNames(v.inputs),
                outputs: _parseNames(v.outputs),
            });
            latest = Math.max(latest, v.version);
            if (v.status === 'approved') latestActive = Math.max(latestActive, v.version);
        }
        map.set(libraryType(n.category, n.name), { category: n.category, name: n.name, versions, latest, latestActive });
    }
    return map;
}

/**
 * Scarica (una volta) il catalogo e registra i nodi. Non lancia mai: se il
 * catalogo non è raggiungibile, i flow si caricano comunque (i nodi di
 * libreria risulteranno orfani, riparabili come gli altri).
 */
export function ensureLibraryNodes() {
    if (!_loading) {
        _loading = _fetchCatalog()
            .then(map => { _catalog = map; reregisterLibraryNodes(); })
            .catch(err => { console.warn('[FLE-library] catalogo non disponibile:', err.message); _catalog = new Map(); });
    }
    return _loading;
}

/** (Ri)registra in LiteGraph tutti i nodi del catalogo già scaricato. */
export function reregisterLibraryNodes() {
    const LG = window.LiteGraph;
    if (!LG || !_catalog) return;
    for (const [type, entry] of _catalog) {
        LG.registerNodeType(type, _makeClass(LG, type, entry));
    }
}
// Hook per FLE-nodes.mjs::registerFlowNodes() (evita un import circolare)
window.__FLE_LIBRARY_REREGISTER = reregisterLibraryNodes;

function _makeClass(LG, type, entry) {
    const latestDef = entry.versions.get(entry.latestActive || entry.latest);

    function LibraryNode() {
        this.addProperty('lib_version', entry.latestActive || entry.latest, 'number');
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.color   = '#134e4a';
        this.bgcolor = '#0f766e';
        this.size    = [220, 60];
        this._fn = null; this._fnVersion = null; this._lastError = null;
        this._rebuildPorts();
    }
    LibraryNode.title = entry.name;
    LibraryNode.desc  = (latestDef?.desc || '') +
        `\n\nLibrary node (code validated by the administrator, not editable). Latest version: ${entry.latestActive || entry.latest}.`;
    LibraryNode.portHelp = {
        inputs:  { trigger: "Trigger (ACTION): the code runs only in response to this, like Script.", "*": "Fixed inputs of the version used by the node, available in the code as variables." },
        outputs: { done: "EVENT fired if the code finishes without errors.", "*": "Fixed outputs of the version used by the node.", error: "EVENT (last output) with the error message, instead of 'done'." },
    };
    // Versioni tutte ritirate: il tipo resta registrato (per i flow esistenti) ma non compare nel menu.
    if (!entry.latestActive) LibraryNode.skip_list = true;

    LibraryNode.prototype._def = function () {
        return entry.versions.get(Number(this.properties.lib_version)) || null;
    };

    LibraryNode.prototype._rebuildPorts = function () {
        const def = this._def();
        const wantIn  = def ? def.inputs : [];
        const wantOut = [...(def ? def.outputs : []), 'error'];
        const curIn  = this.inputs.slice(1).map(p => p.name);
        const curOut = this.outputs.slice(1).map(p => p.name);
        const inChanged  = curIn.length  !== wantIn.length  || curIn.some((n, i) => n !== wantIn[i]);
        const outChanged = curOut.length !== wantOut.length || curOut.some((n, i) => n !== wantOut[i]);
        // Nessun cambio di forma: niente da fare (preserva i link, vedi Script/Flexi)
        if (inChanged) {
            while (this.inputs.length > 1) this.removeInput(this.inputs.length - 1);
            for (const n of wantIn) this.addInput(n, 0);
        }
        if (outChanged) {
            while (this.outputs.length > 1) this.removeOutput(this.outputs.length - 1);
            for (const n of wantOut) this.addOutput(n, 0);
        }
        const v = Number(this.properties.lib_version);
        const newer = (entry.latestActive || entry.latest) > v;
        this.title = `${entry.name} v${v}` + (newer ? ` → v${entry.latestActive || entry.latest} available` : '');
        if (inChanged || outChanged) this.setDirtyCanvas?.(true, true);
    };

    LibraryNode.prototype.onConfigure = function () {
        this._rebuildPorts();
    };

    LibraryNode.prototype.getExtraMenuOptions = function () {
        const target = entry.latestActive || entry.latest;
        const v = Number(this.properties.lib_version);
        if (target <= v) return [];
        return [{
            content: `Update to version ${target}`,
            callback: () => {
                const def = entry.versions.get(target);
                if (!window.confirm(`Update "${entry.name}" from version ${v} to ${target}?\n` +
                    (def?.desc ? `\n${def.desc}\n` : '') +
                    '\nIf inputs or outputs change, the links of those ports must be redone.')) return;
                this.properties.lib_version = target;
                this._fn = null;
                this._rebuildPorts();
            },
        }];
    };

    LibraryNode.prototype.onAction = function () {
        const def = this._def();
        const errIdx = this.outputs.length - 1;
        if (!def) {
            this._lastError = `version ${this.properties.lib_version} not found`;
            this.triggerSlot(errIdx, this._lastError);
            this.setDirtyCanvas(true, true);
            return;
        }
        const ins = def.inputs;
        const hasOwnVars = ins.includes('vars');
        const paramNames = hasOwnVars ? ins : [...ins, 'vars'];
        const graphVars  = this.graph ? (this.graph.vars = this.graph.vars || {}) : {};
        const argValues  = ins.map((_, i) => this.getInputData(i + 1));
        const paramValues = hasOwnVars ? argValues : [...argValues, graphVars];

        let result;
        try {
            // Compilato una volta per versione (il codice viene dal catalogo, mai dal grafo)
            if (this._fnVersion !== def.version) {
                // eslint-disable-next-line no-new-func
                this._fn = new Function(...paramNames, `"use strict";\n${def.code}`);
                this._fnVersion = def.version;
            }
            result = this._fn(...paramValues);
        } catch (err) {
            console.error(`[FLE-library] ${entry.name} v${def.version}:`, err);
            this._lastError = err?.message || String(err);
            this.setDirtyCanvas(true, true);
            this.triggerSlot(errIdx, this._lastError);
            return;
        }
        this._lastError = null;
        const outs = def.outputs;
        if (result !== null && result !== undefined && typeof result === 'object' && !Array.isArray(result)) {
            outs.forEach((name, i) => this.setOutputData(i + 1, result[name]));
        } else if (outs.length === 1) {
            this.setOutputData(1, result);
        }
        this.triggerSlot(0);
        this.setDirtyCanvas(true, true);
    };

    LibraryNode.prototype.onDrawForeground = function (ctx) {
        if (!this._lastError) return;
        ctx.fillStyle = '#f87171';
        ctx.font      = 'bold 10px monospace';
        ctx.fillText('⚠ ' + this._lastError.substring(0, 32), 6, this.size[1] - 6);
    };

    return LibraryNode;
}
