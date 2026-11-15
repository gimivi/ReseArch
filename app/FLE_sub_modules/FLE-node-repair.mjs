// app/FLE_sub_modules/FLE-node-repair.mjs
// Ripara i nodi "orfani" che compaiono quando un grafo salvato referenzia un
// tipo di nodo non più registrato (rinominato/spostato nel menu — vedi
// FLE-nodes.mjs::REMAP — o rimosso). LiteGraph non perde i dati in questo
// caso: LGraph.prototype.configure(), se LiteGraph.createNode(type)
// fallisce, crea un LGraphNode "nudo" con has_errors=true e
// last_serialization=<dati originali completi: pos, size, properties,
// widgets_values, inputs/outputs con i link id originali> — verificato sul
// sorgente reale di litegraph.js, 2026-09-20. Da qui il titolo "undefined"
// visto in editor: this.constructor.title non esiste sulla classe base.
//
// Due percorsi complementari:
//   - repairKnownMigrations(graph): applica silenziosamente NODE_TYPE_MIGRATIONS
//     (nodi che abbiamo semplicemente RIPOSIZIONATO nel menu — stessa classe,
//     stessa struttura di input/output, nessuna decisione da chiedere).
//   - installErrorNodeMenu() + openNodeTypePicker(): fallback manuale per i
//     nodi rimasti senza migrazione nota (es. rimossi/sostituiti con una
//     classe diversa, come Panel→Note) — voce "Aggiorna nodo…" nel menu
//     tasto destro, piccola modale di ricerca fra tutti i tipi registrati.

import { t, te, formatDate } from "../shared/i18n.mjs";

// Separatori visivi di FLE-nodes.mjs (le tre "cartelle" fittizie usate per
// spaziare il menu contestuale) — mai un target valido per un rimpiazzo.
const _SEP_RE = /^─+ ○ ─+\/─$/;

/**
 * Mappa "vecchio type registrato → nuovo type registrato" per i nodi
 * spostati/rinominati nel menu senza cambiare classe (stessa struttura di
 * proprietà/input/output) — aggiornare ad ogni riorganizzazione futura del
 * REMAP in FLE-nodes.mjs. Voci del 2026-09-19/20: categorie File IO,
 * Cluster, Params/Type; rename File I/O→File IO (la barra in un nome di
 * categoria viene letta da LiteGraph come separatore di livello, spezzando
 * il menu in modo scorretto); dissoluzione di 'Display'/'Audio' nei nuovi
 * gruppi Debug/Interface/Media; dissoluzione di 'Params'/'Sets' — passata
 * per una tappa intermedia con Constants/UI/Variables/Array/Object/Data
 * TOP-LEVEL, poi corretta in 'Params' con quelle sei come sottocartelle
 * (stesso giorno, turno successivo).
 */
export const NODE_TYPE_MIGRATIONS = {
    // 'Params/Input/*' → 'Params/Type/*' → (breve tappa) top-level
    // 'Constants|Variables|.../*' → destinazione finale sotto 'Params/*':
    // salta direttamente al target finale.
    'Params/Input/Const':     'Params/Constants/Number',
    'Params/Input/Boolean':   'Params/Constants/Boolean',
    'Params/Input/String':    'Params/Constants/String',
    'Params/Input/Variable':  'Params/Variables/Ref',
    'Params/Input/ConstText': 'Params/Constants/ConstText',
    'Params/Type/Number':     'Params/Constants/Number',
    'Params/Type/Boolean':    'Params/Constants/Boolean',
    'Params/Type/String':     'Params/Constants/String',
    'Params/Type/Array':      'Params/Array/Empty',
    'Params/Type/Object':     'Params/Object/Empty',
    'Params/Type/Data':       'Params/Data/Json Data',
    'Params/Type/Variable':   'Params/Variables/Ref',
    'Params/Type/ConstText':  'Params/Constants/ConstText',
    // Tappa intermedia (poche ore, stesso giorno): 'Constants'/'Variables'/
    // 'Array'/'Object'/'Data'/'UI' erano finite top-level per errore.
    'Constants/Number':       'Params/Constants/Number',
    'Constants/Boolean':      'Params/Constants/Boolean',
    'Constants/String':       'Params/Constants/String',
    'Constants/ConstText':    'Params/Constants/ConstText',
    'Variables/Ref':          'Params/Variables/Ref',
    'Variables/List':         'Params/Variables/List',
    'Variables/Get':          'Params/Variables/Get',
    'Variables/Set':          'Params/Variables/Set',
    'Array/Empty':            'Params/Array/Empty',
    'Array/Get [i]':          'Params/Array/Get [i]',
    'Array/Set [i]':          'Params/Array/Set [i]',
    'Array/Length':           'Params/Array/Length',
    'Array/Maker':            'Params/Array/Maker',
    'Object/Empty':           'Params/Object/Empty',
    'Object/Get Property':    'Params/Object/Get Property',
    'Object/Set Property':    'Params/Object/Set Property',
    'Object/Merge':           'Params/Object/Merge',
    'Object/Keys':            'Params/Object/Keys',
    'Object/Maker':           'Params/Object/Maker',
    'Data/Json Data':         'Params/Data/Json Data',
    'Data/Json Parse':        'Params/Data/Json Parse',
    'Data/Table [row][col]':  'Params/Data/Table [row][col]',
    'Data/Store':             'Params/Data/Store',
    'UI/Button':              'Params/UI/Button',
    'UI/Toggle':              'Params/UI/Toggle',
    'UI/Number':              'Params/UI/Number',
    'UI/Text':                'Params/UI/Text',
    'UI/Combo':               'Params/UI/Combo',
    'UI/Slider':              'Params/UI/Slider',
    'UI/SliderInternal':      'Params/UI/SliderInternal',
    'UI/Knob':                'Params/UI/Knob',
    // Ex Sets/List, Sets/Object, Sets/Table — dissolti in Params/Array|Object|Data.
    'Sets/List/Array':        'Params/Array/Empty',
    'Sets/List/ArrayItem':    'Params/Array/Get [i]',
    'Sets/List/SetArray':     'Params/Array/Set [i]',
    'Sets/List/Length':       'Params/Array/Length',
    'Sets/List/ArrayMaker':   'Params/Array/Maker',
    'Sets/Object/Object':     'Params/Object/Empty',
    'Sets/Object/Keys':       'Params/Object/Keys',
    'Sets/Object/Property':   'Params/Object/Get Property',
    'Sets/Object/Set':        'Params/Object/Set Property',
    'Sets/Object/Merge':      'Params/Object/Merge',
    'Sets/Object/ObjectMaker':'Params/Object/Maker',
    'Sets/Object/Data':       'Params/Data/Json Data',
    'Sets/Object/DataStore':  'Params/Data/Store',
    'Sets/Object/JSONParse':  'Params/Data/Json Parse',
    'Sets/Table/Table':       'Params/Data/Table [row][col]',
    // Ex Params/Var/* → Params/Variables/* ('Params/UI/*' non è mai
    // cambiato nel path finale, solo l'ORDINE interno — nessuna migrazione
    // serve per quello, un grafo salvato prima o dopo ha già il path
    // corretto).
    'Params/Var/Set':         'Params/Variables/Set',
    'Params/Var/Get':         'Params/Variables/Get',
    'Params/Var/List':        'Params/Variables/List',
    // 'Params/Time' → 'Events/Time/Time' (concettualmente un evento di
    // clock, non un parametro) → 'Time/Time' (Events dissolto, stesso
    // giorno turno successivo): salta direttamente al target finale.
    'Params/Time':            'Time/Time',
    // Tappa intermedia: chi avesse salvato un grafo quando 'Time' era
    // ancora 'Events/Time/*'.
    'Events/Time/Time':       'Time/Time',
    'Events/Time/Timer':      'Time/Timer',
    'Events/Time/Delay':      'Time/Delay',
    // 'Events' dissolto (2026-09-20): 'Events/Flow/*' → 'Flow/Events/*',
    // 'Logic/Flow/*' → 'Flow/Logic/*', 'Events/Debug/Log' → 'Debug/Log'.
    'Events/Flow/Counter':    'Flow/Events/Counter',
    'Events/Flow/Stepper':    'Flow/Events/Stepper',
    'Events/Flow/Sequence':   'Flow/Events/Sequence',
    'Events/Flow/Branch':     'Flow/Events/Branch',
    'Events/Flow/Filter':     'Flow/Events/Filter',
    'Events/Flow/Once':       'Flow/Events/Once',
    'Events/Flow/Semaphore':  'Flow/Events/Semaphore',
    'Events/Flow/WaitAll':    'Flow/Events/WaitAll',
    'Events/Flow/Trigger':    'Flow/Events/Trigger',
    'Events/Debug/Log':       'Debug/Log',
    'Logic/Flow/IF':          'Flow/Logic/IF',
    'Logic/Flow/Selector':    'Flow/Logic/Selector',
    'Logic/Flow/Sequence':    'Flow/Logic/Sequence',
    'Logic/Flow/Gate':        'Flow/Logic/Gate',
    'Logic/Flow/Branch':      'Flow/Logic/Branch',
    'Logic/Flow/Bypass':      'Flow/Logic/Bypass',
    'Params/Graph/Input':     'Cluster/Input',
    'Params/Graph/Output':    'Cluster/Output',
    'Params/Graph/Subgraph':  'Cluster/Subgraph',
    'Params/File/File':       'File IO/File',
    'Params/File/Download':   'File IO/Download',
    // Finestra brevissima in cui il nome era "File I/O" (stesso giorno) —
    // per chi avesse salvato un grafo proprio in quell'intervallo.
    'File I/O/File':          'File IO/File',
    'File I/O/Download':      'File IO/Download',

    // Riorganizzazione Debug/Interface/Media (2026-09-20): 'Display' e
    // 'Audio' dissolti, 'Draw Rectangle' rimosso (nessuna voce — bug
    // color/opacity mai letti, cade nel fallback manuale se qualcuno lo
    // aveva usato).
    'Display/Preview/Watch':   'Debug/Watch',
    'Display/Chart/Plot':      'Debug/Plot',
    'Display/UI/Alert':        'Debug/Alert',
    'Display/UI/Console':      'Debug/Console',
    'Display/UI/Progress':     'Debug/Progress',
    'Display/Preview/Inspect': 'Debug/Inspect',
    'Display/UI/Note':         'Debug/Note',
    'Params/UI/Gamepad':       'Interface/Gamepad',
    'Display/Canvas/Canvas':   'Media/Canvas',
    'Display/Canvas/Frame':    'Media/Frame',
    'Display/Image/Image':     'Media/Image/Image',
    'Display/Image/Draw':      'Media/Image/Draw',
    'Display/Image/Crop':      'Media/Tools/Crop',
    'Display/Image/Fade':      'Media/Tools/Fade',
    'Display/Media/Video':     'Media/Video/Video',
    'Display/Media/Webcam':    'Media/Video/Webcam',
    'Display/Color/Palette':   'Media/Tools/Palette',
    // Tappa intermedia (poche ore, stesso giorno): 'Media/Color/Palette'
    // prima di finire sotto 'Media/Tools' insieme a Crop/Fade.
    'Media/Color/Palette':     'Media/Tools/Palette',
    'Audio/Source/Source':     'Media/Audio/Source/Source',
    'Audio/Source/Media':      'Media/Audio/Source/Media',
    'Audio/Source/Oscillator': 'Media/Audio/Source/Oscillator',
    'Audio/Source/Signal':     'Media/Audio/Source/Signal',
    'Audio/Effects/Gain':      'Media/Audio/Effects/Gain',
    'Audio/Effects/ADSR':      'Media/Audio/Effects/ADSR',
    'Audio/Effects/Delay':     'Media/Audio/Effects/Delay',
    'Audio/Effects/Filter':    'Media/Audio/Effects/Filter',
    'Audio/Effects/Convolver': 'Media/Audio/Effects/Convolver',
    'Audio/Effects/Compressor':'Media/Audio/Effects/Compressor',
    'Audio/Analysis/Analyser': 'Media/Audio/Analysis/Analyser',
    'Audio/Analysis/Visualization': 'Media/Audio/Analysis/Visualization',
    'Audio/Mix/Mixer':         'Media/Audio/Mix/Mixer',
    'Audio/Output/Destination':'Media/Audio/Output/Destination',
    'Audio/Util/Script':       'Media/Audio/Util/Script',
    'Audio/MIDI/IO/Input':     'Media/Audio/MIDI/IO/Input',
    'Audio/MIDI/IO/Output':    'Media/Audio/MIDI/IO/Output',
    'Audio/MIDI/Data/Event':   'Media/Audio/MIDI/Data/Event',
    'Audio/MIDI/Data/CC':      'Media/Audio/MIDI/Data/CC',
    'Audio/MIDI/Data/Keys':    'Media/Audio/MIDI/Data/Keys',
    'Audio/MIDI/Flow/Filter':  'Media/Audio/MIDI/Flow/Filter',
    'Audio/MIDI/Util/Transpose': 'Media/Audio/MIDI/Util/Transpose',
    'Audio/MIDI/Util/Quantize':  'Media/Audio/MIDI/Util/Quantize',
    'Audio/MIDI/Source/Generator': 'Media/Audio/MIDI/Source/Generator',
    'Audio/MIDI/Source/FromFile':  'Media/Audio/MIDI/Source/FromFile',
    'Audio/MIDI/Output/Play':  'Media/Audio/MIDI/Output/Play',
    'Audio/MIDI/Display/Show': 'Media/Audio/MIDI/Display/Show',

    // 'Flow/Reroute' rinominato 'Flow/Hub' (2026-09-20, su richiesta
    // esplicita) — stessa classe/funzione, solo nome e aspetto cambiati.
    'Flow/Reroute': 'Flow/Hub',
    // 'Flow/Relay ←' RIMOSSO (2026-09-20): nessuna migrazione automatica,
    // nessun rimpiazzo diretto — chi lo aveva usato passa dal picker
    // manuale ("Aggiorna nodo…") e sceglie Hub o Wireless Out/In a seconda
    // del caso.

    // 'String/Compare' e 'String/Contains' spostati in 'Logic/String'
    // (2026-09-20, su richiesta esplicita) — producono un booleano, non una
    // stringa. Stessa classe/funzione nativa, solo path e titolo cambiati
    // (titolo ora 'Compare String', per distinguerlo dagli altri due nodi
    // "Compare" — vedi FLE-nodes.mjs).
    'String/Compare':  'Logic/String/Compare',
    'String/Contains': 'Logic/String/Contains',

    // 'Logic/Bool/CompareValues' → 'Logic/Bool/Compare Values' (2026-09-20,
    // su richiesta esplicita): solo uno spazio aggiunto fra le due parole,
    // ma è comunque un type/path diverso — serve la migrazione.
    'Logic/Bool/CompareValues': 'Logic/Bool/Compare Values',

    // 'Vector/Math/Operation' e 'Vector/Matrix/Mat4' RIMOSSI dal REMAP
    // (2026-09-20, trovati durante l'audit Help): stesso bug-famiglia dei
    // nodi Geometry — dipendono da glMatrix (mai caricato in questo
    // progetto), ReferenceError già al costruttore. Nessuna migrazione:
    // nessun rimpiazzo diretto, chi li aveva usati passa dal picker manuale.

    // 2026-10-04 — nodi del bus unificati sotto 'ReseArch/App Bus' (app/AppBus-flow-nodes.mjs).
    // Local Emitter (pubblica al trigger) → Emitter: proprietà event_type → topic, uscita
    // trigger → done, uscita payload → '→payload' (opzionale). Local Receiver → Receiver:
    // event_type → topic, porte con lo stesso nome. I vecchi Dashboard/App Emitter|Receiver
    // non hanno migrazione (non erano usati in nessun flow).
    'ReseArch/App/Local Emitter': {
        type: 'ReseArch/App Bus/Emitter',
        props: { event_type: 'topic' },
        outputs: { trigger: 'done', payload: '→payload' },
    },
    'ReseArch/App/Local Receiver': {
        type: 'ReseArch/App Bus/Receiver',
        props: { event_type: 'topic' },
    },
};

function _isErrorNode(node) {
    return !!node?.has_errors;
}

/** Rimuove un link "a metà" (un lato non ha più uno slot compatibile) — ripulisce entrambi gli endpoint invece di lasciare riferimenti a penzoloni. */
function _dropLink(graph, linkId) {
    const link = graph.links[linkId];
    if (!link) return;
    const origin = graph.getNodeById(link.origin_id);
    const target = graph.getNodeById(link.target_id);
    if (origin?.outputs?.[link.origin_slot]?.links) {
        origin.outputs[link.origin_slot].links = origin.outputs[link.origin_slot].links.filter(id => id !== linkId);
    }
    if (target?.inputs?.[link.target_slot]?.link === linkId) {
        target.inputs[link.target_slot].link = null;
    }
    delete graph.links[linkId];
}

/**
 * Sostituisce un nodo placeholder (has_errors) con un'istanza vera del tipo
 * indicato: riporta proprietà/widget da last_serialization e riaggancia i
 * link ORIGINALI per NOME di slot (funziona sia per una classe spostata —
 * struttura identica, riaggancio 1:1 — sia per un rimpiazzo con una classe
 * diversa: gli slot senza corrispondenza sul nodo nuovo vengono scollegati
 * puliti, non lasciati a penzoloni).
 *
 * NON usa graph.remove(placeholder): quel metodo DISCONNETTE (e CANCELLA da
 * graph.links) ogni slot collegato come parte della rimozione — esattamente
 * i dati che servono per riagganciare il nodo nuovo. Il placeholder viene
 * quindi tolto "a mano" (splice diretto su _nodes/_nodes_by_id), lasciando
 * graph.links intatto fino al riaggancio. Riusa lo stesso id del
 * placeholder: origin_id/target_id nei link lo referenziano già, quindi non
 * vanno toccati — solo l'indice di slot (può differire anche a parità di
 * nome) e gli array .link/.links del nodo nuovo, vuoti di default.
 */
export function replaceErrorNode(graph, placeholder, newTypeOrSpec) {
    const LG = window.LiteGraph;
    // Migrazione semplice: 'nuovo/tipo'. Migrazione con rinomine (2026-10-04):
    // { type, props: { vecchia: nuova }, inputs: { vecchia: nuova }, outputs: { vecchia: nuova } }
    const spec    = typeof newTypeOrSpec === 'string' ? { type: newTypeOrSpec } : (newTypeOrSpec || {});
    const newType = spec.type;
    const info = placeholder.last_serialization || {};
    const newNode = LG.createNode(newType);
    if (!newNode) return null;
    const renProp = k => spec.props?.[k]   ?? k;
    const renIn   = n => spec.inputs?.[n]  ?? n;
    const renOut  = n => spec.outputs?.[n] ?? n;

    const oldId      = placeholder.id;
    const oldInputs  = (placeholder.inputs  ?? []).map(i => ({ name: renIn(i.name), link: i.link }));
    const oldOutputs = (placeholder.outputs ?? []).map(o => ({ name: renOut(o.name), links: [...(o.links ?? [])] }));

    const idx = graph._nodes.indexOf(placeholder);
    if (idx !== -1) graph._nodes.splice(idx, 1);
    delete graph._nodes_by_id[oldId];
    placeholder.graph = null;

    newNode.id  = oldId;
    newNode.pos = [...(placeholder.pos ?? [0, 0])];
    if (placeholder.size) newNode.size = [...placeholder.size];

    if (info.properties) {
        for (const k in info.properties) {
            const nk = renProp(k);
            if (nk in newNode.properties) newNode.properties[nk] = info.properties[k];
        }
    }
    if (newNode.widgets) {
        for (const w of newNode.widgets) {
            if (w?.options?.property && newNode.properties[w.options.property] !== undefined) {
                w.value = newNode.properties[w.options.property];
            }
        }
    }

    graph.add(newNode, true);   // stesso id del placeholder → i link (mai toccati finora) restano coerenti

    // Porte collegate che nel nodo nuovo sono OPZIONALI (onGetInputs/onGetOutputs): si
    // aggiungono prima di riagganciare i fili, altrimenti i link andrebbero persi.
    const optIn  = newNode.onGetInputs?.()  ?? [];
    const optOut = newNode.onGetOutputs?.() ?? [];
    for (const oi of oldInputs) {
        if (oi.link == null || newNode.findInputSlot(oi.name) !== -1) continue;
        const o = optIn.find(([n]) => n === oi.name);
        if (o) newNode.addInput(o[0], o[1], o[2]);
    }
    for (const oo of oldOutputs) {
        if (!oo.links.length || newNode.findOutputSlot(oo.name) !== -1) continue;
        const o = optOut.find(([n]) => n === oo.name);
        if (o) newNode.addOutput(o[0], o[1], o[2]);
    }

    for (const oldInput of oldInputs) {
        if (oldInput.link == null) continue;
        const link    = graph.links[oldInput.link];
        const newIdx  = newNode.inputs?.findIndex(i => i.name === oldInput.name) ?? -1;
        if (newIdx === -1 || !link) { if (link) _dropLink(graph, oldInput.link); continue; }
        link.target_slot = newIdx;
        newNode.inputs[newIdx].link = oldInput.link;
    }
    for (const oldOutput of oldOutputs) {
        const newIdx = newNode.outputs?.findIndex(o => o.name === oldOutput.name) ?? -1;
        for (const linkId of oldOutput.links) {
            const link = graph.links[linkId];
            if (newIdx === -1 || !link) { if (link) _dropLink(graph, linkId); continue; }
            link.origin_slot = newIdx;
            (newNode.outputs[newIdx].links ??= []).push(linkId);
        }
    }

    graph.updateExecutionOrder();
    graph.setDirtyCanvas(true, true);
    return newNode;
}

/**
 * Applica NODE_TYPE_MIGRATIONS a tutti i nodi in errore del grafo. Da
 * chiamare subito dopo graph.configure(savedSpec).
 * @returns {{migrated: Array<{oldType,newType,title}>, unresolved: LGraphNode[]}}
 *   'unresolved' = placeholder rimasti (nessuna migrazione nota) — passare a
 *   markUnresolvedNodes() perché invitino all'azione invece di "undefined".
 */
export function repairKnownMigrations(graph) {
    const migrated   = [];
    const unresolved = [];
    for (const node of [...graph._nodes]) {
        if (!_isErrorNode(node)) continue;
        const oldType = node.type;
        const target  = NODE_TYPE_MIGRATIONS[oldType];
        if (!target) { unresolved.push(node); continue; }
        const newType = typeof target === 'string' ? target : target.type;
        const newNode = replaceErrorNode(graph, node, target);
        if (newNode) {
            migrated.push({ oldType, newType, title: newNode.title || newNode.constructor.title || newType });
        } else {
            unresolved.push(node);
        }
    }
    return { migrated, unresolved };
}

/** Titolo dei placeholder rimasti irrisolti — invita all'azione invece di mostrare "undefined". */
export function markUnresolvedNodes(nodes) {
    for (const node of nodes) {
        node.title = '⚠ ' + t('app.fle.repair.unresolved_title');
    }
}

/**
 * Costruisce il testo del report (usato sia per l'alert sia per il
 * contenuto del nodo Note aggiunto al grafo).
 */
export function formatMigrationReport(migrated, targetLabel) {
    const date  = formatDate(new Date());
    const lines = [
        targetLabel ? t('app.fle.repair.report_title_target', { target: targetLabel, date })
                    : t('app.fle.repair.report_title', { date }),
        '',
        t('app.fle.repair.report_moved'),
        ...migrated.map(m => `• "${m.title}": ${m.oldType} → ${m.newType}`),
        '',
        t('app.fle.repair.report_check'),
    ];
    return lines.join('\n');
}

/**
 * Aggiunge un nodo Debug/Note al grafo con il report della migrazione, così
 * resta consultabile in seguito (non solo nell'alert, che si chiude e si
 * dimentica) se qualcosa nel grafo smettesse di funzionare come prima.
 * Posizionato in un angolo fisso: l'utente lo sposta se copre altro.
 */
export function addReportNote(graph, text) {
    const LG = window.LiteGraph;
    const note = LG.createNode('Debug/Note');
    if (!note) return null;
    note.pos = [20, 20];
    note.size = [340, 200];
    note.properties.text = text;
    graph.add(note);
    graph.setDirtyCanvas(true, true);
    return note;
}

// Patch idempotente: aggiunge "Aggiorna nodo…" al menu tasto-destro di
// qualunque nodo has_errors. I placeholder sono istanze NUDE di
// LiteGraph.LGraphNode (nessuna classe propria su cui appendere un
// getExtraMenuOptions dedicato), quindi si patcha il prototipo base una sola
// volta — i nodi con un proprio getExtraMenuOptions (es. Inspect) non sono
// affetti: la resolution dei prototype JS usa il loro, più specifico,
// un override su un'istanza/sottoclasse vince sempre su quello ereditato.
export function installErrorNodeMenu() {
    const LG = window.LiteGraph;
    if (!LG || LG._fleErrorMenuPatched) return;
    LG._fleErrorMenuPatched = true;

    LG.LGraphNode.prototype.getExtraMenuOptions = function (graphcanvas, options) {
        if (!this.has_errors) return;
        options.push({
            content: '🔧 ' + t('app.fle.repair.menu'),
            callback: () => openNodeTypePicker(this, graphcanvas),
        });
    };
}

const _PICKER_MODAL_ID = '_fle_node_picker_modal';

/** Piccola modale di ricerca fra tutti i tipi di nodo registrati — scelta manuale del rimpiazzo per un nodo in errore. */
export function openNodeTypePicker(placeholder, _graphcanvas) {
    const LG = window.LiteGraph;
    let modal = document.getElementById(_PICKER_MODAL_ID);
    if (!modal) {
        modal = document.createElement('div');
        modal.id        = _PICKER_MODAL_ID;
        modal.className = 'modal fade';
        modal.tabIndex  = -1;
        modal.setAttribute('aria-labelledby', `${_PICKER_MODAL_ID}_title`);
        modal.innerHTML = `
<div class="modal-dialog modal-fullscreen-md-down modal-dialog-scrollable">
  <div class="modal-content bg-dark text-light">
    <div class="modal-header py-2 border-0">
      <h6 class="modal-title mb-0" id="${_PICKER_MODAL_ID}_title">${te('app.fle.repair.title')}</h6>
      <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="${te('common.close')}"></button>
    </div>
    <div class="modal-body p-2">
      <input type="text" class="form-control form-control-sm mb-2" placeholder="${te('app.fle.repair.filter')}" aria-label="${te('app.fle.repair.filter')}" id="${_PICKER_MODAL_ID}_filter">
      <div class="list-group" id="${_PICKER_MODAL_ID}_list" style="max-height:50vh;overflow-y:auto;"></div>
    </div>
  </div>
</div>`;
        document.body.appendChild(modal);
    }

    const oldType = placeholder.type;
    modal.querySelector('.modal-title').textContent = t('app.fle.repair.title_was', { type: oldType });

    const listEl   = modal.querySelector(`#${_PICKER_MODAL_ID}_list`);
    const filterEl = modal.querySelector(`#${_PICKER_MODAL_ID}_filter`);

    const allTypes = Object.keys(LG.registered_node_types)
        .filter(ty => !_SEP_RE.test(ty))
        .sort();

    function render(filter) {
        const f = (filter || '').toLowerCase();
        listEl.innerHTML = '';
        for (const ty of allTypes) {
            if (f && !ty.toLowerCase().includes(f)) continue;
            const item = document.createElement('button');
            item.type         = 'button';
            item.className    = 'list-group-item list-group-item-action py-1 px-2 small bg-dark text-light border-secondary';
            item.textContent  = ty;
            item.addEventListener('click', () => {
                replaceErrorNode(placeholder.graph, placeholder, ty);
                bootstrap.Modal.getInstance(modal)?.hide();
            });
            listEl.appendChild(item);
        }
    }
    render('');
    filterEl.value = '';
    filterEl.oninput = () => render(filterEl.value);

    (bootstrap.Modal.getInstance(modal) ?? new bootstrap.Modal(modal)).show();
    modal.addEventListener('shown.bs.modal', () => filterEl.focus(), { once: true });
}
