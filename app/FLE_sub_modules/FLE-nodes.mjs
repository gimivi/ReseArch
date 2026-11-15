// app/FLE_sub_modules/FLE-nodes.mjs
// Registrazione nodi LiteGraph custom per il Flow Editor di ReseArch.
// Usa window.LiteGraph (caricato come script globale in dashboard.php).
// Idempotente grazie al flag _FLE_NODES_REGISTERED su window.
//
// CONVENZIONE WIDGET (bug fix 2026-08-30): ogni this.addWidget(...) il cui
// scopo è editare una property del nodo (tutti tranne i widget 'button')
// DEVE passare { property: 'nomeProperty' } come ultimo argomento options.
// Senza, il widget resta scollegato dalla property agli occhi di LiteGraph:
// LGraphNode.prototype.serialize() include widgets_values SOLO se
// this.serialize_widgets === true (mai impostato in questo file, di
// proposito: le property bastano), quindi il salvataggio del grafo non
// porta con sé il valore del widget — e LGraphNode.prototype.configure()
// risincronizza widget.value da this.properties[options.property] SOLO se
// quel binding è dichiarato. Risultato senza il binding: la property è
// sempre corretta (letta/scritta dal codice del nodo), ma il CAMPO
// visualizzato nel widget torna al valore di default hardcoded ad ogni
// riapertura del flow — esattamente il bug segnalato su Params/Variables/Set
// (ex Params/Var/Set).
// Il callback esistente (v => this.properties.x = v) resta comunque utile e
// va mantenuto: LiteGraph lo richiama comunque dopo aver scritto la
// property via options.property, i due meccanismi non sono in conflitto.

import { registerPJSFlowNodes } from "../PJS_sub_modules/PJS-flow-nodes.mjs";
import { registerOSDFlowNodes } from "../OSD_sub_modules/OSD-flow-nodes.mjs";
import { registerAppBusFlowNodes } from "../AppBus-flow-nodes.mjs";
import { registerMPSFlowNodes } from "../MPS_sub_modules/MPS-flow-nodes.mjs";
import { registerHYSFlowNodes } from "../HYS_sub_modules/HYS-flow-nodes.mjs";
import { registerHTMFlowNodes } from "../HTM_sub_modules/HTM-flow-nodes.mjs";
import { registerDBJFlowNodes } from "../DBJ_sub_modules/DBJ-flow-nodes.mjs";
import { registerGSHFlowNodes } from "../GSH_sub_modules/GSH-flow-nodes.mjs";
import { registerMYSFlowNodes } from "../MYS_sub_modules/MYS-flow-nodes.mjs";
import { registerPDFFlowNodes } from "../PDF_sub_modules/PDF-flow-nodes.mjs";
import { registerECHFlowNodes } from "../ECH_sub_modules/ECH-flow-nodes.mjs";
import { registerJSXFlowNodes } from "../JSX_sub_modules/JSX-flow-nodes.mjs";
import { registerTMLFlowNodes } from "../TML_sub_modules/TML-flow-nodes.mjs";
import { registerIFCFlowNodes } from "../IFC_sub_modules/IFC-flow-nodes.mjs";
import { registerOLYFlowNodes } from "../OLY_sub_modules/OLY-flow-nodes.mjs";
import { registerLoopNodes } from "./FLE-loop-nodes.mjs";
import { registerContextNodes } from "./FLE-context-nodes.mjs";
import { registerImageNodes } from "./FLE-image-nodes.mjs";
import { registerErrorNodes } from "./FLE-error-nodes.mjs";
import { registerStartNodes } from "./FLE-start-nodes.mjs";
import { registerTreeNodes } from "./FLE-tree-nodes.mjs";
import { registerServiceNodes } from "./FLE-service-nodes.mjs";
import { registerComfyNodes } from "./FLE-comfyui-nodes.mjs";
import { registerDeviceNodes } from "./FLE-device-nodes.mjs";
import { registerSignalNodes } from "./FLE-signal-nodes.mjs";
import { registerTextNodes } from "./FLE-text-nodes.mjs";
import { registerWebNodes } from "./FLE-web-nodes.mjs";
import { layoutMarkdown, drawLayout } from "./FLE-markdown-canvas.mjs";
import { panelCmdUI, panelOfGraph, openObjectInPanel } from "../shared/panel-flow.mjs";

// extractFields (selezione dei campi di un payload) è in app/AppBus-flow-nodes.mjs
// dal 2026-10-04, insieme ai nodi App Bus Emitter/Receiver che la usano.

export function registerFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[FLE-nodes] LiteGraph not available'); return; }
    if (window._FLE_NODES_REGISTERED) return;
    window._FLE_NODES_REGISTERED = true;
    // Reset flag specializzati: vengono re-registrati dopo clearRegisteredTypes()
    window._TJS_FLOW_NODES_REGISTERED   = false;
    window._OSD_FLOW_NODES_REGISTERED   = false;
    window._PJS_FLOW_NODES_REGISTERED   = false;
    window._APPBUS_FLOW_NODES_REGISTERED = false;
    window._MPS_FLOW_NODES_REGISTERED   = false;
    window._DBJ_FLOW_NODES_REGISTERED   = false;
    window._GSH_FLOW_NODES_REGISTERED   = false;
    window._MYS_FLOW_NODES_REGISTERED   = false;
    window._PDF_FLOW_NODES_REGISTERED   = false;
    window._ECH_FLOW_NODES_REGISTERED   = false;
    window._JSX_FLOW_NODES_REGISTERED   = false;
    window._TML_FLOW_NODES_REGISTERED   = false;

    // =========================================================================
    // Riorganizza i nodi built-in in struttura Grasshopper-style.
    // Salva tutte le registrazioni esistenti, azzera, e ri-registra con i
    // nuovi percorsi. I nodi custom ReseArch vengono registrati più avanti.
    // =========================================================================
    const _builtIn = { ...LG.registered_node_types };
    LG.clearRegisteredTypes();
    // Nodi di libreria già scaricati (FLE-library-nodes.mjs): vanno ri-registrati
    // dopo lo svuotamento. Se il catalogo non è ancora arrivato, li registrerà lui.
    window.__FLE_LIBRARY_REREGISTER?.();

    const REMAP = [
        // ── Params ────────────────────────────────────────────────────────────
        // Sei sottocartelle, in QUESTO ordine (2026-09-20, su richiesta
        // esplicita — Params torna categoria top-level, le sei sotto-voci
        // erano state rese top-level per errore nel giro precedente).
        // ── Params/Constants ─────────────────────────────────────────────────
        // Ex 'Params/Type': tolti Array/Object/Data/Variable, che hanno ora
        // una cartella propria (vedi sotto) — qui restano solo le vere
        // costanti di tipo primitivo.
        ['basic/const',                  'Params/Constants/Number'],
        ['basic/boolean',                'Params/Constants/Boolean'],
        ['basic/string',                 'Params/Constants/String'],
        // ── Params/Variables ─────────────────────────────────────────────────
        // Consolida qui il nativo basic/variable, insieme ai custom
        // Set/Get/List registrati più sotto in questo file — rinominato 'Ref'
        // per non confondersi col termine generico "variabile": legge/scrive
        // per nome su uno tra tre "contenitori" condivisi (litegraph/graph/
        // global — vedi memoria/doc per scope e persistenza). I tre custom
        // Set/Get/List condividono SOLO graph.vars (stesso storage di 'Ref'
        // con container:'graph').
        ['basic/variable',               'Params/Variables/Ref'],
        // ── Params/Array ─────────────────────────────────────────────────────
        // Fonde 'Params/Type/Array' (dichiarazione) con le operazioni ex
        // 'Sets/List/*' — un solo posto per tutto quello che riguarda gli
        // array. 'Maker' (custom, ex Sets/List/ArrayMaker) registrato più
        // sotto in questo file.
        ['basic/array',                  'Params/Array/Empty'],
        ['basic/array[]',                'Params/Array/Get [i]'],
        ['basic/set_array',              'Params/Array/Set [i]'],
        ['basic/length',                 'Params/Array/Length'],
        // ── Params/Object ────────────────────────────────────────────────────
        // Fonde 'Params/Type/Object' con le operazioni ex 'Sets/Object/*'.
        // 'Maker' (custom, ex Sets/Object/ObjectMaker) registrato più sotto
        // in questo file.
        ['basic/object',                 'Params/Object/Empty'],
        ['basic/object_property',        'Params/Object/Get Property'],
        ['basic/set_object',             'Params/Object/Set Property'],
        ['basic/merge_objects',          'Params/Object/Merge'],
        // 'Keys' non citata nella richiesta di riordino — lasciata qui per
        // assenza di un posto più ovvio (stesso trattamento di Note/Palette
        // nel giro di riordino precedente).
        ['basic/object_keys',            'Params/Object/Keys'],
        // ── Params/Data ──────────────────────────────────────────────────────
        // Fonde 'Params/Type/Data' con 'Sets/Object/DataStore|JSONParse' e
        // 'Sets/Table/Table'.
        ['basic/data',                   'Params/Data/Json Data'],
        ['basic/jsonparse',              'Params/Data/Json Parse'],
        ['basic/table[][]',              'Params/Data/Table [row][col]'],
        // 'basic/data_store' → NON TROVATO nel sorgente di LiteGraph 0.7.18
        // (verificato 2026-09-20, nessun file in src/nodes/ lo definisce):
        // questa riga fallisce silenziosamente ad ogni caricamento (solo un
        // console.warn) e 'Params/Data/Store' non compare mai nel menu.
        // Lasciata per ora, da rimuovere se confermato che è un residuo.
        ['basic/data_store',             'Params/Data/Store'],
        // ── Params/UI ────────────────────────────────────────────────────────
        // Ordine alfabetico (su richiesta esplicita).
        ['widget/button',                'Params/UI/Button'],
        ['widget/combo',                 'Params/UI/Combo'],
        ['widget/knob',                  'Params/UI/Knob'],
        ['widget/number',                'Params/UI/Number'],
        ['widget/hslider',               'Params/UI/Slider'],
        ['widget/internal_slider',       'Params/UI/SliderInternal'],
        ['widget/text',                  'Params/UI/Text'],
        ['widget/toggle',                'Params/UI/Toggle'],
        // ── Cluster ───────────────────────────────────────────────────────────
        // Spostati fuori da Params (2026-09-20): non sono parametri, sono il
        // meccanismo di incapsulamento di un pezzo di grafo in un nodo solo —
        // analogo al "Cluster" di Grasshopper. Colori/help sotto il REMAP.
        ['graph/subgraph',               'Cluster/Subgraph'],
        ['graph/input',                  'Cluster/Input'],
        ['graph/output',                 'Cluster/Output'],
        // ── File IO ───────────────────────────────────────────────────────────
        // Spostati fuori da Params (2026-09-20): non sono parametri, sono
        // l'unica coppia di nodi che fa I/O con il filesystem dell'utente —
        // meritano una categoria propria. Colori/help sotto il REMAP.
        // NB: "File IO", non "File I/O" (2026-09-20) — la barra viene letta
        // da LiteGraph come separatore di livello nel type-string, quindi
        // "File I/O/File" si spezzava in TRE livelli ("File I" › "O" ›
        // "File") invece dei due voluti — da qui il menu visivamente rotto.
        ['basic/file',                   'File IO/File'],
        ['basic/download',               'File IO/Download'],
        // ── Maths ─────────────────────────────────────────────────────────────
        ['math/operation',               'Maths/Operators/Operation'],
        ['math/abs',                     'Maths/Operators/Abs'],
        ['math/floor',                   'Maths/Operators/Floor'],
        ['math/frac',                    'Maths/Operators/Frac'],
        ['math/accumulate',              'Maths/Operators/Accumulate'],
        ['math/average',                 'Maths/Operators/Average'],
        ['math/clamp',                   'Maths/Operators/Clamp'],
        ['math/lerp',                    'Maths/Operators/Lerp'],
        ['math/smoothstep',              'Maths/Operators/SmoothStep'],
        ['math/scale',                   'Maths/Operators/Scale'],
        ['math/range',                   'Maths/Operators/Range'],
        // math/formula → omesso: sostituito dal nodo custom Maths/Operators/Formula
        ['math/trigonometry',            'Maths/Trig/Trigonometry'],
        ['math/rand',                    'Maths/Random/Rand'],
        ['math/noise',                   'Maths/Random/Noise'],
        ['math/spikes',                  'Maths/Random/Spikes'],
        ['math/tendTo',                  'Maths/Time/TendTo'],
        ['math/to_number',               'Maths/Util/ToNumber'],
        ['math/converter',               'Maths/Util/Converter'],
        ['basic/cast',                   'Maths/Util/Cast'],
        // ── Logic ─────────────────────────────────────────────────────────────
        // 'Logic/Flow/*' spostato sotto 'Flow/Logic' (2026-09-20, su
        // richiesta esplicita) — restano qui Bool/Numeric/String. 'String'
        // aggiunta lo stesso giorno spostando qui i due nodi logici che
        // stavano nel gruppo 'String' principale (Compare/Contains, che
        // producono un booleano, non una stringa).
        // I tre nodi "Compare" (Bool/Numeric/String) sono implementazioni
        // NATIVE genuinamente diverse (verificato sul sorgente LiteGraph):
        // - logic/CompareBool: N input booleani dinamici, vero solo se
        //   TUTTI sono uguali tra loro (titolo nativo "bool == bool").
        // - math/compare: 2 numeri, uscite multiple attivabili a piacere
        //   (A==B, A!=B, A>B, A<B, ...) — un vero comparatore multi-operatore.
        // - string/compare: 2 stringhe, semplice `a == b` (via
        //   LiteGraph.wrapFunctionAsNode, non una classe).
        // Titoli distinti in 'Compare Bool'/'Compare Number'/'Compare String'
        // subito dopo il loop REMAP (vedi sotto) per non farli confondere.
        ['logic/AND',                    'Logic/Bool/AND'],
        ['logic/OR',                     'Logic/Bool/OR'],
        ['logic/NOT',                    'Logic/Bool/NOT'],
        ['basic/not',                    'Logic/Bool/Invert'],
        ['logic/CompareBool',            'Logic/Bool/Compare'],
        ['basic/CompareValues',          'Logic/Bool/Compare Values'],
        ['math/compare',                 'Logic/Numeric/Compare'],
        ['math/condition',               'Logic/Numeric/Condition'],
        ['string/compare',               'Logic/String/Compare'],
        ['string/contains',              'Logic/String/Contains'],
        // ── Time ──────────────────────────────────────────────────────────────
        // Nuovo gruppo top-level (2026-09-20, su richiesta esplicita) — ex
        // 'Events/Time/*' (e 'basic/time' era passato per 'Params/Time' la
        // mattina stessa). 'Events' dissolto: Time/Flow/Log erano le sue
        // uniche voci, tutte spostate altrove — vedi sotto.
        ['basic/time',                   'Time/Time'],
        ['events/timer',                 'Time/Timer'],
        ['events/delay',                 'Time/Delay'],
        // ── Flow (aggiunte a quello principale più sotto in questo file) ────────
        // 'Events/Flow/*' → 'Flow/Events/*' e 'Logic/Flow/*' → 'Flow/Logic/*'
        // (2026-09-20, su richiesta esplicita): il gruppo 'Flow' principale
        // (Hub, Trigger Pass/Gate, Wireless Out/In — nodi custom registrati
        // più sotto in questo file) guadagna due sottocartelle.
        ['events/counter',               'Flow/Events/Counter'],
        ['events/stepper',               'Flow/Events/Stepper'],
        ['events/sequence',              'Flow/Events/Sequence'],
        ['events/branch',                'Flow/Events/Branch'],
        ['events/filter',                'Flow/Events/Filter'],
        ['events/once',                  'Flow/Events/Once'],
        ['events/semaphore',             'Flow/Events/Semaphore'],
        ['events/waitAll',               'Flow/Events/WaitAll'],
        ['events/trigger',               'Flow/Events/Trigger'],
        ['logic/IF',                     'Flow/Logic/IF'],
        ['logic/selector',               'Flow/Logic/Selector'],
        ['logic/sequence',               'Flow/Logic/Sequence'],
        ['math/gate',                    'Flow/Logic/Gate'],
        ['math/branch',                  'Flow/Logic/Branch'],
        ['math/bypass',                  'Flow/Logic/Bypass'],
        // 'events/log' → 'Debug/Log' (2026-09-20, su richiesta esplicita):
        // un solo input ACTION, onAction fa `console.log(action, param)` —
        // l'equivalente a EVENTO di 'Debug/Console' (che logga un VALORE),
        // stessa famiglia diagnostica.
        ['events/log',                   'Debug/Log'],
        // ── String ────────────────────────────────────────────────────────────
        // Spostato dal gruppo Sets/Logic/Events al gruppo "funzioni pure"
        // (Maths/String/Geometry/Vector), 2026-09-20 — su richiesta esplicita.
        // Compare/Contains spostati poi in 'Logic/String' (stesso giorno):
        // producono un booleano, non una stringa — vedi il blocco Logic sopra.
        ['string/concatenate',           'String/Concatenate'],
        ['string/split',                 'String/Split'],
        ['string/toFixed',               'String/ToFixed'],
        ['string/toString',              'String/ToString'],
        ['string/toTable',               'String/ToTable'],
        ['string/toUpperCase',           'String/ToUpperCase'],
        // ── Vector ────────────────────────────────────────────────────────────
        ['math3d/xy-to-vec2',            'Vector/Pack/XYtoVec2'],
        ['math3d/xyz-to-vec3',           'Vector/Pack/XYZtoVec3'],
        ['math3d/xyzw-to-vec4',          'Vector/Pack/XYZWtoVec4'],
        ['math3d/vec2-to-xy',            'Vector/Unpack/Vec2toXY'],
        ['math3d/vec3-to-xyz',           'Vector/Unpack/Vec3toXYZ'],
        ['math3d/vec4-to-xyzw',          'Vector/Unpack/Vec4toXYZW'],
        ['math3d/vec3-dot',              'Vector/Math/Dot'],
        ['math3d/vec3-length',           'Vector/Math/Length'],
        ['math3d/vec3-lerp',             'Vector/Math/Lerp'],
        ['math3d/vec3-normalize',        'Vector/Math/Normalize'],
        ['math3d/vec3-scale',            'Vector/Math/Scale'],
        // 'math3d/operation' ('Vector/Math/Operation') e 'math3d/mat4'
        // ('Vector/Matrix/Mat4') RIMOSSI dal REMAP (2026-09-20, trovati
        // durante l'audit Help): STESSO bug-famiglia dei nodi Geometry già
        // rimossi sopra — entrambi chiamano vec3.*/mat4.* di glMatrix nel
        // loro codice reale (verificato sul sorgente: 'operation' fa
        // `this._result = vec3.create()` già nel COSTRUTTORE, 'mat4' fa
        // `this._result = mat4.create()` sempre nel costruttore) — glMatrix
        // non è associato a questa Web App (stesso accertamento fatto per
        // Geometry). ReferenceError immediato al solo trascinamento sul
        // grafo, prima ancora di un qualunque runStep. Gli altri 5 nodi
        // Vector/Math (Dot/Length/Lerp/Normalize/Scale) NON usano glMatrix
        // — sono matematica manuale su array [x,y,z], funzionano
        // regolarmente, lasciati intatti.
        // ── Geometry — RIMOSSA (2026-09-20) ─────────────────────────────────────
        // Rimossi perché usano glMatrix, libreria non associata a questa Web
        // App: 'geometry/points3D'/'connectPoints'/'polygon'/'extrude'/
        // 'transform'/'points_to_instances'/'eval' chiamano tutti vec3.*/
        // mat4.* di glMatrix nel loro codice reale (non solo alla
        // costruzione) — ReferenceError al primo runStep. Anche a
        // parte questo, il formato dati che producono ({vertices, normals}
        // in stile litegl.js) non ha nessun ponte verso THREE.BufferGeometry
        // in questo progetto, quindi non sarebbero comunque visualizzabili.
        // ── Debug ─────────────────────────────────────────────────────────────
        // Nuovo gruppo (2026-09-20, su richiesta esplicita): raccoglie tutti
        // i nodi di sola ispezione/diagnostica del grafo, prima sparsi sotto
        // Display/Preview, Display/UI, Display/Chart — nessuno di questi
        // produce/modifica dati per il grafo, servono solo a "vedere cosa
        // succede" mentre lavori. 'Inspect' è custom nostro (più sotto in
        // questo file), gli altri 5 nativi LiteGraph. 'Log' (ex Events/Debug/
        // Log, spostato qui in un secondo momento) registrato più sotto in
        // questo blocco REMAP (era fisicamente vicino a Events/Logic/Time,
        // non spostato di riga per non disfare quella sezione) — stessa
        // famiglia, console.log su un evento invece che su un valore.
        ['basic/watch',                  'Debug/Watch'],
        ['graphics/plot',                'Debug/Plot'],
        ['basic/alert',                  'Debug/Alert'],
        ['basic/console',                'Debug/Console'],
        // 'widget/panel' RIMOSSO (2026-09-19): il nodo nativo "WidgetPanel" è
        // testualmente "Non interactive panel" nel .desc originale di
        // LiteGraph — disegna solo un rettangolo decorativo con un unico
        // widget bottone "Update", nessuno spazio per testo. Sostituito da
        // Debug/Note (poco più sotto in questo file) per lo stesso bisogno
        // (appunti/istruzioni), stavolta funzionante.
        ['widget/progress',              'Debug/Progress'],
        // ── Interface ─────────────────────────────────────────────────────────
        // Nuovo gruppo (2026-09-20): dispositivi di input fisici — solo
        // Gamepad per ora (spostato da Params/UI, dove viveva in mezzo a
        // widget-UI del grafo senza nulla a che fare con l'hardware).
        ['input/gamepad',                'Interface/Gamepad'],
        // ── Media ─────────────────────────────────────────────────────────────
        // Nuovo gruppo (2026-09-20, su richiesta esplicita): tutto ciò che
        // produce/elabora immagini, video, audio e canvas — prima diviso fra
        // 'Display' (grafica 2D) e 'Audio' (separato). Ordine interno (su
        // richiesta esplicita): Audio, Image, Video, Canvas, Frame, Tools.
        // 'Draw Rectangle' RIMOSSO: le property 'color'/'opacity' sono
        // dichiarate ma MAI lette nel suo onExecute reale (bug nel nodo
        // nativo, verificato sul sorgente — disegna sempre con l'ultimo
        // fillStyle lasciato sul canvas da qualcos'altro), quindi di fatto
        // incontrollabile.
        //
        // Audio/MIDI: intera sotto-struttura invariata, solo rinidificata
        // sotto Media/Audio/* (prima top-level 'Audio/*'). MIDI resta così
        // com'è per ora (compresi i 2 nodi rotti FromFile/Play, vedi sotto) —
        // in futuro un nodo dedicato per caricare la libreria mancante SOLO
        // per il flow che ne ha bisogno, non globalmente.
        ['audio/source',                 'Media/Audio/Source/Source'],
        ['audio/media_source',           'Media/Audio/Source/Media'],
        ['audio/oscillator',             'Media/Audio/Source/Oscillator'],
        ['audio/signal',                 'Media/Audio/Source/Signal'],
        ['audio/gain',                   'Media/Audio/Effects/Gain'],
        ['audio/adsr',                   'Media/Audio/Effects/ADSR'],
        ['audio/delay',                  'Media/Audio/Effects/Delay'],
        ['audio/biquadfilter',           'Media/Audio/Effects/Filter'],
        ['audio/convolver',              'Media/Audio/Effects/Convolver'],
        ['audio/dynamicsCompressor',     'Media/Audio/Effects/Compressor'],
        ['audio/analyser',               'Media/Audio/Analysis/Analyser'],
        ['audio/visualization',          'Media/Audio/Analysis/Visualization'],
        ['audio/mixer',                  'Media/Audio/Mix/Mixer'],
        ['audio/destination',            'Media/Audio/Output/Destination'],
        ['audio/script',                 'Media/Audio/Util/Script'],
        // 'midi/fromFile'/'midi/play' — dipendenze esterne mai caricate qui
        // (midi-parser-js, Audiosynth.js — stesso caso di SillyClient),
        // falliscono da sole (boxcolor rosso + console.error), lasciate per
        // ora com'è deciso sopra.
        ['midi/input',                   'Media/Audio/MIDI/IO/Input'],
        ['midi/output',                  'Media/Audio/MIDI/IO/Output'],
        ['midi/event',                   'Media/Audio/MIDI/Data/Event'],
        ['midi/cc',                      'Media/Audio/MIDI/Data/CC'],
        ['midi/keys',                    'Media/Audio/MIDI/Data/Keys'],
        ['midi/filter',                  'Media/Audio/MIDI/Flow/Filter'],
        ['midi/transpose',               'Media/Audio/MIDI/Util/Transpose'],
        ['midi/quantize',                'Media/Audio/MIDI/Util/Quantize'],
        ['midi/generator',               'Media/Audio/MIDI/Source/Generator'],
        ['midi/fromFile',                'Media/Audio/MIDI/Source/FromFile'],
        ['midi/play',                    'Media/Audio/MIDI/Output/Play'],
        ['midi/show',                    'Media/Audio/MIDI/Display/Show'],
        ['graphics/image',               'Media/Image/Image'],
        ['graphics/drawImage',           'Media/Image/Draw'],
        ['graphics/video',               'Media/Video/Video'],
        ['graphics/webcam',              'Media/Video/Webcam'],
        ['graphics/canvas',              'Media/Canvas'],
        ['graphics/frame',               'Media/Frame'],
        // 'Palette' spostata qui da 'Media/Color/Palette' (2026-09-20, su
        // richiesta esplicita) — insieme a Crop/Fade, confermato che
        // funzionano anche su Video/Webcam in ingresso (vedi nota altrove
        // in questo doc/memoria).
        ['graphics/cropImage',           'Media/Tools/Crop'],
        ['graphics/imagefade',           'Media/Tools/Fade'],
        ['color/palette',                'Media/Tools/Palette'],
        // ── Script ────────────────────────────────────────────────────────────
        // 'basic/script' (nodo nativo LiteGraph) volutamente ESCLUSO: la sua
        // property 'code' è editabile solo tramite il pannello proprietà del
        // codeeditor.js "editor" standalone di LiteGraph (widgets_info type
        // 'code'), che qui non è caricato — nel nostro canvas quel nodo non
        // ha alcuna UI per modificare codice/input. Usare 'Script/Flexi' (poco
        // più sotto in questo file), che ha editor a modale integrato.
        // ── Network ───────────────────────────────────────────────────────────
        // 'network/httprequest' e 'network/websocket' RIMOSSI (2026-09-28, su
        // richiesta esplicita): non essenziali, e canali di uscita dati verso
        // server arbitrari. La voce di menu vive ora sotto 'ReseArch/Network'
        // (segnaposto registrato più sotto), dove andranno i futuri nodi di
        // rete specializzati per la piattaforma. La protezione vera contro
        // l'esfiltrazione sarà la CSP (vedi _doc/arch-abilitazioni.md), non
        // questa rimozione: anche TJS/Model/Load URL & co. accettano URL da filo.
        // 'network/sillyclient' RIMOSSO (2026-09-19): stesso caso di
        // 'widget/panel' — dipende dalla classe globale SillyClient, fornita
        // da uno script esterno di terze parti (sillyclient.js, un demo
        // server tamats.com) mai caricato in questo progetto. Con
        // SillyClient undefined il nodo si limita a un console.error e non
        // fa nulla — zero funzionalità, nessun crash. 'Network/WS/WebSocket'
        // (websocket nativo) copre già lo stesso bisogno.
    ];

    for (const [oldName, newName] of REMAP) {
        const cls = _builtIn[oldName];
        if (cls) {
            // FIX (2026-09-20): LiteGraph.registerNodeType() NON tocca mai
            // .title se è già valorizzato (vedi sorgente: `if (!base_class.title)
            // base_class.title = classname`) — e ogni nodo nativo ha già un
            // .title proprio (es. ConstantNumber.title = "Const Number").
            // Registrare 'basic/const' sotto 'Params/Constants/Number' NON
            // rinomina quindi la voce che appare nel menu: quella riga usa
            // sempre node.title (verificato in LGraphCanvas.onMenuAdd, che
            // costruisce ogni entry con `content: node.title`), non l'ultimo
            // segmento del type registrato. La cartella (category, derivata
            // dal type) si aggiorna correttamente da sola — è SOLO l'etichetta
            // del nodo dentro la cartella a restare quella originale finché
            // non la si sovrascrive esplicitamente, come qui.
            // Suffisso '°' (2026-09-21, su richiesta esplicita): marca nel
            // menu i nodi NATIVI di LiteGraph rispetto a quelli custom della
            // piattaforma (TJS/Debug/Params/ecc., senza marcatore) — utile
            // perché aggiungere trigger/eventi extra da tasto destro su un
            // nodo nativo è un'operazione valida del motore, mentre sui nodi
            // custom crea porte scollegate dalla logica reale (che ha già i
            // propri trigger cablati per indice fisso). Vedi anche
            // FLE-help-panel.mjs (TOOLBAR_HELP) per la spiegazione mostrata
            // in-app. Stesso marcatore aggiunto anche in _setCanvasTitle
            // sotto e sui tre "Compare" più giù, gli altri due punti che
            // impostano .title per nodi nativi in questo file.
            cls.title = newName.split('/').pop() + ' °';
            LG.registerNodeType(newName, cls);
        } else {
            console.warn(`[FLE-nodes] built-in not found: ${oldName}`);
        }
    }

    // ── Titoli distinti per i tre nodi "Compare" di Logic (2026-09-20, su
    // richiesta esplicita) ───────────────────────────────────────────────────
    // Il loop REMAP sopra assegna a TUTTI e tre lo stesso titolo generico
    // "Compare" (ultimo segmento del path per ciascuno) — impossibile
    // distinguerli sia nel menu sia una volta piazzati sul grafo, pur
    // trattandosi di tre implementazioni native con comportamento diverso
    // (vedi commento nel blocco REMAP "── Logic ──"). A differenza del
    // pattern menu-breve/canvas-esplicito usato per Variables/Array/Object/
    // Data, qui il titolo va cambiato in modo semplice e diretto (stesso
    // testo in menu e su canvas): la cartella (Bool/Numeric/String) non basta
    // da sola a comunicare la differenza, che è funzionale, non solo di
    // posizione nel menu.
    if (_builtIn['logic/CompareBool']) _builtIn['logic/CompareBool'].title = 'Compare Bool °';
    if (_builtIn['math/compare'])      _builtIn['math/compare'].title      = 'Compare Number °';
    if (_builtIn['string/compare'])    _builtIn['string/compare'].title    = 'Compare String °';

    // (2026-10-17) Nodi di calcolo puri: l'uscita dipende solo dagli ingressi e dalle proprietà, quindi
    // si può ricalcolare quando viene letta (lib/litegraph, patch 7). Senza, a valle di un evento si
    // leggeva il risultato del giro precedente (TJS) o nessun risultato (pannelli senza ciclo).
    // Esclusi i nodi con stato o legati al tempo/caso (accumulate, average, rand, noise, spikes, tendTo).
    for (const name of ['math/operation', 'math/abs', 'math/floor', 'math/frac', 'math/clamp', 'math/lerp',
                        'math/smoothstep', 'math/scale', 'math/range', 'math/trigonometry',
                        'math/to_number', 'math/converter',
                        // (2026-10-21) lettura di campi e posizioni: senza stato, servono a valle dei Receiver
                        'basic/object_property', 'basic/object_keys', 'basic/array[]',
                        // (2026-11-04) costanti: nei pannelli senza ciclo del grafo (tutti tranne TJS/OSD)
                        // non scrivevano mai l'uscita → un valore scritto in una costante arrivava vuoto
                        'basic/const', 'basic/boolean', 'basic/string', 'basic/data', 'basic/object', 'basic/array']) {
        if (_builtIn[name]) _builtIn[name].pure = true;
    }

    // ── Titolo "esplicito" sul grafo per Variables/Array/Object/Data
    // (2026-09-20, su richiesta esplicita) ───────────────────────────────────
    // Nel menu contestuale l'etichetta resta breve (es. "Empty", "Get [i]") —
    // la cartella comunica già "Array"/"Object"/ecc., ripeterlo lì è
    // ridondante. Ma una volta piazzato sul grafo, isolato dal menu, quel
    // nome breve non basta più a capire su cosa opera il nodo — qui invece
    // serve il contesto esplicito ("Array Empty", "Var Set", ...). Soluzione:
    // NodeClass.title resta il nome breve (usato dal menu, via
    // LGraphCanvas.onMenuAdd → `content: node.title`), mentre
    // NodeClass.prototype.onNodeCreated risistema this.title (solo
    // sull'ISTANZA, non sulla classe) subito dopo la creazione — chiamato da
    // LiteGraph.createNode() una sola volta, alla nascita del nodo.
    // Persistenza verificata sul sorgente: LGraphNode.prototype.serialize()
    // scrive `title` SOLO se `this.title != this.constructor.title` — quindi
    // il titolo esplicito sull'istanza si salva e si ripristina correttamente
    // da un grafo salvato, senza bisogno di altro codice.
    // NON applicato a 'Constants' (Number/Boolean/String/Text): richiesta
    // esplicita di lasciarle senza ridondanza in entrambi i casi.
    function _setCanvasTitle(cls, canvasTitle) {
        if (!cls) return;
        const prev = cls.prototype.onNodeCreated;
        cls.prototype.onNodeCreated = function () {
            if (prev) prev.call(this);
            this.title = canvasTitle + ' °';   // stesso marcatore nativo del menu, vedi REMAP sopra
        };
    }
    _setCanvasTitle(_builtIn['basic/variable'],   'Var Ref');
    _setCanvasTitle(_builtIn['basic/array'],      'Array Empty');
    _setCanvasTitle(_builtIn['basic/array[]'],    'Array Get [i]');
    _setCanvasTitle(_builtIn['basic/set_array'],  'Array Set [i]');
    _setCanvasTitle(_builtIn['basic/length'],     'Array Length');
    _setCanvasTitle(_builtIn['basic/object'],           'Object Empty');
    _setCanvasTitle(_builtIn['basic/object_property'],  'Object Get Property');
    _setCanvasTitle(_builtIn['basic/set_object'],       'Object Set Property');
    _setCanvasTitle(_builtIn['basic/merge_objects'],    'Object Merge');
    _setCanvasTitle(_builtIn['basic/object_keys'],      'Object Keys');
    _setCanvasTitle(_builtIn['basic/data'],         'Json Data');
    _setCanvasTitle(_builtIn['basic/jsonparse'],    'Data Json Parse');
    _setCanvasTitle(_builtIn['basic/table[][]'],    'Data Table [row][col]');
    _setCanvasTitle(_builtIn['basic/data_store'],   'Data Store');

    // ── Params — Help sui nodi nativi (Constants/Variables/Array/Object/Data)
    // (2026-09-20, estensione pannello Help a tutti i nodi ancora scoperti,
    // su richiesta esplicita) — stesso meccanismo di Cluster/File IO sotto:
    // proprietà statiche su classi native recuperate da _builtIn.
    {
        const numCls = _builtIn['basic/const'];
        if (numCls) {
            numCls.desc = "Numeric constant — no inputs. The value is set with the 'value' widget/property (number). Output 'value': the same number on every execution. When collapsed it shows the value instead of the title.";
            numCls.portHelp = { outputs: { value: "The number set in the node's 'value' property." } };
        }
        const boolCls = _builtIn['basic/boolean'];
        if (boolCls) {
            boolCls.desc = "Boolean constant — no fixed inputs, but an optional EVENT input 'toggle' (can be added from the node menu) that INVERTS the value on every trigger received, regardless of the data it carries. The value can also be set with the 'value' widget/property (toggle). Output 'bool': the current state.";
            boolCls.portHelp = {
                inputs: { toggle: "Trigger (EVENT) — the carried data does not matter: every event received simply inverts the current value." },
                outputs: { bool: "true/false, the current state of the toggle." },
            };
        }
        const strCls = _builtIn['basic/string'];
        if (strCls) {
            strCls.desc = "String constant — no inputs. The value is set with the 'value' widget/property (text) or by dragging a text file onto the node (the file content replaces the value). Output 'string': the same text on every execution.";
            strCls.portHelp = { outputs: { string: "The text set in the 'value' property (or the last text file dragged onto the node)." } };
        }

        // 'Var Ref' (ex Variable): BUG trovato durante questo stesso audit —
        // la classe nativa Variable.prototype.getTitle() ritorna SEMPRE
        // `this.properties.varname`, ignorando `this.title` — questo rende
        // silenziosamente inutile il pattern "titolo esplicito sul grafo"
        // (_setCanvasTitle sopra, che scrive su this.title): LiteGraph
        // disegna il titolo chiamando node.getTitle() quando esiste (non
        // this.title direttamente — verificato in litegraph.js, il ramo
        // "var title = node.getTitle ? node.getTitle() : node.title" usato
        // dal renderer del canvas), quindi "Var Ref" impostato da
        // onNodeCreated non compariva MAI sul grafo, solo nel menu. Fix:
        // getTitle riscritto per mostrare ENTRAMBE le informazioni ("Var
        // Ref: <nome variabile>") invece di rimuovere l'una o l'altra.
        const varCls = _builtIn['basic/variable'];
        if (varCls) {
            varCls.prototype.getTitle = function () {
                return 'Var Ref: ' + (this.properties.varname || '');
            };
            varCls.desc = "Reads or writes a variable identified by name (property 'varname'), NOT connected to this project's custom Var Set/Get/List mechanism — it is a separate, native LiteGraph store. The scope is chosen with the 'container' property: 'litegraph' (default) = shared by ALL graphs open in the page (global LiteGraph.Globals object); 'graph' = this graph only (graph.vars); 'global' = the browser window object. If the 'in' input is connected, on every execution it WRITES that value into the variable (Set behaviour); if NOT connected, it only READS it (Get behaviour) — same node, two modes depending on whether it is connected.";
            varCls.portHelp = {
                inputs: { in: "If connected: the value to write into the variable on every execution (any type). If not connected: the node only reads the value already present." },
                outputs: { out: "The current value of the variable, just read or just written." },
            };
        }

        const arrEmptyCls = _builtIn['basic/array'];
        if (arrEmptyCls) {
            arrEmptyCls.desc = "Array constant — if the 'json' input is connected, it CLONES its content (element by element), overwriting the internal value; otherwise it uses the value set in the 'value' widget/property (JSON text, e.g. '1,2,3' or '[1,2,3]'). Outputs: the array itself and its length.";
            arrEmptyCls.portHelp = {
                inputs: { json: "Array to clone into this node (overwrites the value set by hand in the widget), optional." },
                outputs: { arrayOut: "The current array (cloned from the input if connected, otherwise the widget's one).", length: "Number of elements in the array (integer)." },
            };
        }
        const arrGetCls = _builtIn['basic/array[]'];
        if (arrGetCls) {
            arrGetCls.desc = "Reads ONE element from an array (or string, or table row) given the index — it does not modify the original array. If the 'index' input is not connected it uses the 'index' property.";
            arrGetCls.portHelp = {
                inputs: { array: "Array, string or table (array of arrays) to read from.", index: "Index (number, 0-based) of the element to extract — if not connected, uses the node's 'index' property." },
                outputs: { value: "The element found at the requested index (any type) — no output if the array or the index is missing." },
            };
        }
        const arrSetCls = _builtIn['basic/set_array'];
        if (arrSetCls) {
            arrSetCls.desc = "Writes ONE element into an EXISTING array, at the index set in the 'index' property (no dedicated input for the index: change it from the node's property panel). WARNING: it modifies the input array DIRECTLY (in-place mutation, no copy) — if the same array is used elsewhere in the graph, it changes there too.";
            arrSetCls.portHelp = {
                inputs: { arr: "Array to modify (must already exist — the node does not create it).", value: "The new value to write at position 'index'." },
                outputs: { arr: "The same array received as input, now modified." },
            };
        }
        const arrLenCls = _builtIn['basic/length'];
        if (arrLenCls) {
            arrLenCls.desc = "Returns the length (.length property) of any value that has one — array, string, or other array-like object. If the value has no .length property, returns 0.";
            arrLenCls.portHelp = {
                inputs: { "": "Array, string or other value with a .length property." },
                outputs: { "": "Integer — the length, or 0 if the input value has none." },
            };
        }

        const objEmptyCls = _builtIn['basic/object'];
        if (objEmptyCls) {
            objEmptyCls.desc = "Object constant — no inputs, no property to set via widget: it simply exposes an empty JS object {} (always the SAME reference on every execution, useful as a base to fill with the 'Set Property'/'Merge' nodes).";
            objEmptyCls.portHelp = { outputs: { obj: "A JavaScript object {} — the same reference persists between graph executions." } };
        }
        const objGetCls = _builtIn['basic/object_property'];
        if (objGetCls) {
            objGetCls.desc = "Reads ONE property from an object, by name — the name is set in the node's 'value' widget/property (text), not from a dedicated input. When collapsed it shows 'in.<property name>'.";
            objGetCls.portHelp = {
                inputs: { obj: "The object to read from (any JS object)." },
                outputs: { property: "The value of the requested property — any type, undefined if the property does not exist on the object." },
            };
        }
        const objSetCls = _builtIn['basic/set_object'];
        if (objSetCls) {
            objSetCls.desc = "Writes ONE property on an EXISTING object — the property name is set in the node's 'prop.' widget/property (text), not from a dedicated input. WARNING: it modifies the input object DIRECTLY (in-place mutation) — if the same object is used elsewhere in the graph, it changes there too.";
            objSetCls.portHelp = {
                inputs: { obj: "Object to modify (must already exist).", value: "The value to write into the property named by the 'prop.' widget." },
                outputs: { obj: "The same object received as input, now modified." },
            };
        }
        const objMergeCls = _builtIn['basic/merge_objects'];
        if (objMergeCls) {
            objMergeCls.desc = "Copies all the properties of A and B (in this order — B overwrites A for equal names) into an accumulator object inside the node, which grows on every execution (properties written in the past remain even if A/B stop providing them). The 'clear' button on the node empties the accumulator.";
            objMergeCls.portHelp = {
                inputs: { A: "First source object (optional).", B: "Second source object (optional) — its properties win over A's in case of conflict." },
                outputs: { out: "The node's internal accumulator object, with all the properties seen so far from A and B." },
            };
        }
        const objKeysCls = _builtIn['basic/object_keys'];
        if (objKeysCls) {
            objKeysCls.desc = "Returns an array with the names (strings) of all the own properties of an object — equivalent to Object.keys().";
            objKeysCls.portHelp = {
                inputs: { obj: "The object whose properties to list." },
                outputs: { keys: "Array of strings — the object's property names, in Object.keys() order." },
            };
        }

        const dataCls = _builtIn['basic/data'];
        if (dataCls) {
            dataCls.desc = "JSON data constant — the value is set in the 'value' widget/property (JSON text, e.g. '{\"a\":1}'), parsed automatically, with a green/red box showing valid/invalid JSON. No inputs: the text is written directly in the widget.";
            dataCls.portHelp = { outputs: { data: "The value already parsed by JSON.parse() — object, array, number or string depending on the JSON written in the widget." } };
        }
        const jsonParseCls = _builtIn['basic/jsonparse'];
        if (jsonParseCls) {
            jsonParseCls.desc = "Converts a JSON string into a JS object/array — unlike 'Json Data' (whose JSON is FIXED in the widget), here the text comes from a connected input and is re-parsed every time the 'parse' trigger arrives (button on the node or ACTION input). Green/red box = parsing succeeded/failed.";
            jsonParseCls.portHelp = {
                inputs: { parse: "Trigger (ACTION/EVENT): starts parsing the current text in 'json' — alternative to the 'parse' button on the node.", json: "JSON string to parse (e.g. '{\"a\":1}' or '[1,2,3]')." },
                outputs: { done: "EVENT emitted right after a successful parse (useful to chain further actions).", object: "The result of JSON.parse() on the input string — object or array." },
            };
        }
        const tableCls = _builtIn['basic/table[][]'];
        if (tableCls) {
            tableCls.desc = "Reads ONE cell from a table (an array of arrays — rows of columns) given row and column. If the 'row'/'col' inputs are not connected it uses the node's 'row'/'column' properties.";
            tableCls.portHelp = {
                inputs: { table: "Table as an array of arrays, e.g. [[1,2],[3,4]].", row: "Row index (0-based) — if not connected, uses the 'row' property.", col: "Column index (0-based) — if not connected, uses the 'column' property." },
                outputs: { value: "The value at cell [row][col], or null if the row does not exist." },
            };
        }
        // 'Params/Data/Store' (basic/data_store): NON ESISTE nella versione
        // di litegraph.js usata da questo progetto (0.7.18) — verificato,
        // nessuna registrazione nel sorgente reale. _builtIn['basic/data_store']
        // è sempre undefined, il warning "built-in non trovato" nel loop
        // REMAP sopra lo segnala già ad ogni caricamento. Nessun Help da
        // scrivere: il nodo non compare mai nel menu.
    }

    // ── Cluster — colori (tassonomia §10) e Help sui tre nodi nativi
    // spostati sopra (Subgraph/Input/Output — analogo al "Cluster" di
    // Grasshopper: incapsula un pezzo di grafo in un nodo solo, con ingressi
    // e uscite nominati). Famiglia Instradamento (Flow): instradano
    // esecuzione/valori attraverso il confine del sottografo, nessun calcolo
    // proprio né effetto sulla scena — stesso colore ora applicato anche a
    // Flow/Hub (2026-09-20); ancora da applicare a Flow/Trigger Pass|Gate,
    // Flow/Wireless Out|In.
    {
        const subgraphCls = _builtIn['graph/subgraph'];
        if (subgraphCls) {
            subgraphCls.color   = '#1f2937';
            subgraphCls.bgcolor = '#374151';
            subgraphCls.desc    = "Contains a nested graph — like a Grasshopper 'Cluster': it wraps a complex piece of flow into a single reusable node. Double click to open/edit the inner graph in the same canvas. The two '+' buttons at the bottom of the node add an input or an output to the subgraph (they automatically create, inside it, a Cluster/Input or Cluster/Output node). Inside the subgraph two native panels appear ('Graph Inputs'/'Graph Outputs', top left/right) with an 'X' button to leave and go back to the containing graph.";
            subgraphCls.portHelp = {
                inputs: { enabled: "Optional boolean (can be added from the node menu): if connected and false, the subgraph is not executed on that tick — inputs/outputs stay at the values of the last valid execution. The other inputs/outputs visible on the node are dynamic: one for each Cluster/Input|Output node inside the subgraph, with the same name and type set on that inner node." },
                outputs: { "*": "One for each Cluster/Output node inside the subgraph — name, type and value come from there and cannot be set from outside." },
            };
        }

        // 'Input'/'Output': funzionano SOLO dentro un nodo Cluster/Subgraph —
        // leggono/scrivono su this.graph.inputs/outputs, popolati e letti
        // solo dal meccanismo di Subgraph.onExecute. Fuori da un sottografo
        // (nel grafo principale di un pannello) degradano a inerti: Input
        // torna sempre e solo il suo valore di default (nessun codice in
        // questo progetto chiama graph.setInputData dall'esterno), Output
        // scrive in un posto che nessuno legge mai.
        const inputCls = _builtIn['graph/input'];
        if (inputCls) {
            inputCls.color   = '#1f2937';
            inputCls.bgcolor = '#374151';
            inputCls.desc    = "Defines an input of the containing Cluster — works ONLY inside a Cluster/Subgraph node. Property 'name' = slot name seen from outside on the Subgraph node; 'type' = type (number/boolean/string/other); 'value' = default value if the Subgraph receives nothing on that slot. Used OUTSIDE a subgraph it becomes a simple typed constant: the value never arrives from outside.";
            inputCls.portHelp = {
                outputs: { "": "Value of the input — name and type are set from the node properties (name/type), not here." },
            };
        }

        const outputCls = _builtIn['graph/output'];
        if (outputCls) {
            outputCls.color   = '#1f2937';
            outputCls.bgcolor = '#374151';
            outputCls.desc    = "Defines an output of the containing Cluster — works ONLY inside a Cluster/Subgraph node. Property 'name' = slot name seen from outside on the Subgraph node; 'type' = value type. Used OUTSIDE a subgraph it writes to a place nobody ever reads: no visible effect.";
            outputCls.portHelp = {
                inputs: { "": "Value to expose as an output of the Cluster — name and type are set from the node properties (name/type), not here." },
            };
        }
    }

    // ── File IO — colori (tassonomia §10, _doc/module-fle-architettura.md)
    // e Help sui due nodi nativi spostati sopra. Sono classi NATIVE
    // LiteGraph (non nostre): si personalizzano assegnando le stesse
    // proprietà statiche (color/bgcolor/desc/portHelp) direttamente sul
    // constructor recuperato da _builtIn, stesso oggetto già registrato
    // col nuovo nome nel loop sopra.
    {
        // 'File' (ex Const File): legge/estrae un dato da una fonte esterna
        // (fetch da URL o file locale trascinato sul nodo) — famiglia Get,
        // nessun effetto collaterale visibile nel grafo oltre a produrre il
        // valore in uscita.
        const fileCls = _builtIn['basic/file'];
        if (fileCls) {
            fileCls.color   = '#1a2a4a';
            fileCls.bgcolor = '#1e3a5f';
            fileCls.desc    = "Reads the content of a file: from a remote URL (fetch) or by dragging a local file directly onto the node. The parsing format (text/json/arraybuffer/blob) is set in the 'type' property. The content read goes out on 'file' on every execution — green box = fetch succeeded, red = error.";
            fileCls.portHelp = {
                inputs: {
                    url: "URL of the resource to download — optional if the node's 'url' property is already set. Alternatively, drag a local file directly onto the node: no URL needed.",
                },
                outputs: {
                    file: "Content of the resource, already parsed according to the 'type' property (text/JSON/ArrayBuffer/Blob).",
                },
            };
        }

        // 'Download' (ex Download): NON fa fetch di nulla — scrive un dato
        // già presente nel grafo su un file locale (persistenza sul disco
        // dell'utente, non su DB) — famiglia Salvataggio.
        const downloadCls = _builtIn['basic/download'];
        if (downloadCls) {
            downloadCls.color   = '#4a3010';
            downloadCls.bgcolor = '#a16207';
            downloadCls.desc    = "Saves a value as a local file on the user's disk — it does NOT fetch anything. 'data' is the CONTENT to write into the file (not a URL to download): if it is already a string it is written as is, otherwise it is converted to JSON. The file name is set in the 'filename' property. To download a remote resource and save a local copy, first connect 'File IO/File' and bring its 'file' output here on 'data'.";
            downloadCls.portHelp = {
                inputs: {
                    data:     "The content to save in the file — a value already present in the graph (string or object, converted to JSON if not already text), NOT a URL to download.",
                    download: "Trigger: starts saving when it receives an event, alternative to the 'Download' button on the node (which still requires 'data' to have a value).",
                },
            };
        }
    }

    // ── Help su altri nodi nativi sparsi (Maths/Util/Cast, Logic/Bool,
    // Debug, Time) — stesso meccanismo dei blocchi sopra (2026-09-20).
    {
        const castCls = _builtIn['basic/cast'];
        if (castCls) {
            castCls.desc = "Pure passthrough — outputs exactly the value received as input, without any real conversion. It only serves to BYPASS LiteGraph's type compatibility check between two slots that would otherwise refuse the connection (e.g. connecting a 'number' to an input that expects 'string').";
            castCls.portHelp = {
                inputs: { in: "Any value, of any type." },
                outputs: { out: "The same value received as input, unchanged — no conversion applied." },
            };
        }

        const invertCls = _builtIn['basic/not'];
        if (invertCls) {
            invertCls.desc = "Generic logical negation (!value) — works on any type, not only booleans: JavaScript first converts the value to 'truthy/falsy' (e.g. 0, '', null, undefined become true; anything else becomes false).";
            invertCls.portHelp = {
                inputs: { "": "Any value — evaluated as truthy/falsy according to JavaScript rules." },
                outputs: { "": "true/false, the negation of the input value." },
            };
        }

        // 'Compare Values' (basic/CompareValues, nativo GenericCompare):
        // NOTA — questo nodo ha un proprio getTitle() nativo che ritorna
        // SEMPRE "*A == *B" (o "*A != *B"), indipendentemente da
        // this.title — il rename di oggi (spazio in "Compare Values", vedi
        // sopra) cambia quindi SOLO l'etichetta nel menu contestuale, mai il
        // titolo effettivamente disegnato sul nodo una volta piazzato sul
        // grafo (che mostra sempre l'operatore corrente). Comportamento
        // preesistente della classe nativa, non introdotto da questa
        // modifica — utile saperlo, non un bug da correggere (il titolo
        // dinamico è più informativo di uno statico).
        const compareValuesCls = _builtIn['basic/CompareValues'];
        if (compareValuesCls) {
            compareValuesCls.desc = "Compares A and B with the operator chosen in the 'Op.' widget (only '==' and '!=' are actually implemented, although the '@OP' list of the property also suggests <,>,<=,>=,||,&& — verified on the source: those cases are commented out/inactive). Equality is shallow on own properties if A and B are objects (not a recursive deep-equal), strict (===) for other types. If an input is not connected it uses the corresponding A/B property.";
            compareValuesCls.portHelp = {
                inputs: { A: "First value — if not connected, uses the 'A' property.", B: "Second value — if not connected, uses the 'B' property." },
                outputs: { true: "true if the comparison (== or !=, according to the 'Op.' widget) is satisfied, otherwise false.", false: "The exact complement of the 'true' output (always the opposite)." },
            };
        }

        const watchCls = _builtIn['basic/watch'];
        if (watchCls) {
            watchCls.desc = "Shows the input value written directly on the node body (useful for quick debugging without opening the console) — numbers with 3 decimals, arrays printed recursively as '[1,2,3]', other types with their standard string conversion. When collapsed, the value replaces the title.";
            watchCls.portHelp = { inputs: { value: "Any value to inspect." } };
        }
        const consoleCls = _builtIn['basic/console'];
        if (consoleCls) {
            consoleCls.desc = "Writes a value to the browser console (F12) — three distinct EVENT inputs choose the level: 'log' (console.log), 'warn' (console.warn), 'error' (console.error). If 'msg' is not connected it uses the saved 'msg' property; if no message is available it still writes a default text with the received action.";
            consoleCls.portHelp = {
                inputs: { log: "Trigger (EVENT): writes with console.log.", warn: "Trigger (EVENT): writes with console.warn.", error: "Trigger (EVENT): writes with console.error.", msg: "The value to write to the console — any type, converted to string by the console itself." },
            };
        }
        const alertCls = _builtIn['basic/alert'];
        if (alertCls) {
            alertCls.desc = "Opens a native browser alert() window with the text set in the 'Text' widget — BLOCKING: it pauses the whole page until the user closes the window (the running flow too, not only the interface).";
            alertCls.portHelp = { inputs: { "": "Trigger (EVENT) — the carried data does not matter, it always opens the alert with the text of the 'Text' widget." } };
        }

        const timeCls = _builtIn['basic/time'];
        if (timeCls) {
            timeCls.desc = "Exposes the time elapsed since the graph started (this.graph.globaltime) — not the system/calendar time. Updated on every execution tick, it resets when the graph is stopped and restarted.";
            timeCls.portHelp = {
                outputs: { "in ms": "Time elapsed since the graph started, in milliseconds.", "in sec": "The same time, in seconds (with decimals)." },
            };
        }
    }

    // ── Maths — Help sui nodi nativi (Operators/Trig/Random/Time/Util),
    // più Logic/Numeric e i 3 nodi Flow/Logic che condividono lo stesso file
    // nativo math.js (Bypass, Gate, Branch) (2026-09-20).
    {
        const converterCls = _builtIn['math/converter'];
        if (converterCls) {
            converterCls.desc = "Converts a number (or the first element of an array/vector) into a fixed-length vector output — the outputs are dynamic (can be added from the node menu: number/vec2/vec3/vec4) and are computed only if connected. If the input is already an array/vector shorter than the requested length, the missing components stay at 0.";
            converterCls.portHelp = {
                inputs: { in: "Number, or array/vector (Float32Array or plain Array) whose first components are taken." },
                outputs: { number: "The value as a single number (first element if the input is an array).", vec2: "Float32Array of 2 components.", vec3: "Float32Array of 3 components.", vec4: "Float32Array of 4 components." },
            };
        }
        const toNumberCls = _builtIn['math/to_number'];
        if (toNumberCls) {
            toNumberCls.desc = "Converts any value to a number with Number() — numeric strings become the corresponding number, non-numeric strings become NaN, booleans become 0/1.";
            toNumberCls.portHelp = {
                inputs: { in: "Any value to convert (string, boolean, etc.)." },
                outputs: { out: "The result of Number(value) — may be NaN if the conversion is not possible." },
            };
        }
        const rangeCls = _builtIn['math/range'];
        if (rangeCls) {
            rangeCls.desc = "Remaps a number from a source range (in_min..in_max) to a target range (out_min..out_max), with linear interpolation — e.g. from 0..255 to 0..1. The 4 limits are also dynamic inputs (can be added from the menu) besides properties. When collapsed it shows the last computed value.";
            rangeCls.portHelp = {
                inputs: { in: "The number to remap.", in_min: "Lower bound of the source range (optional, otherwise uses the property).", in_max: "Upper bound of the source range.", out_min: "Lower bound of the target range.", out_max: "Upper bound of the target range." },
                outputs: { out: "The remapped value (may fall outside out_min..out_max if 'in' was outside in_min..in_max).", clamped: "The same remapped value, but clamped inside out_min..out_max." },
            };
        }
        const randCls = _builtIn['math/rand'];
        if (randCls) {
            randCls.desc = "Generates a random number (Math.random()) between 'min' and 'max' on EVERY execution — not a fixed value, it changes continuously while the graph runs. min/max are also dynamic inputs besides properties.";
            randCls.portHelp = {
                inputs: { min: "Lower bound of the range (optional, otherwise uses the property).", max: "Upper bound of the range." },
                outputs: { value: "Uniform random number between min and max, recomputed on every execution." },
            };
        }
        const noiseCls = _builtIn['math/noise'];
        if (noiseCls) {
            noiseCls.desc = "Pseudo-random noise that is CONTINUOUS over time (unlike 'Rand'): close values of the 'in' input produce close outputs — useful for organic movements/vibrations. It sums several noise 'octaves' (properties 'octaves'/'persistence') for a richer result, then scales it between min/max.";
            noiseCls.portHelp = {
                inputs: { in: "Coordinate/time along which to sample the noise (number) — close values give close results." },
                outputs: { out: "Noise value scaled between the 'min' and 'max' properties." },
            };
        }
        const spikesCls = _builtIn['math/spikes'];
        if (spikesCls) {
            spikesCls.desc = "Generates a pulse (spike, from 0 to 1 and back) at random time intervals between 'min_time' and 'max_time' seconds, lasting 'duration' — no inputs: it uses the real elapsed time (this.graph.elapsed_time) to decide when to fire.";
            spikesCls.portHelp = { outputs: { out: "0 at rest, rises towards 1 and falls back during a spike." } };
        }
        const clampCls = _builtIn['math/clamp'];
        if (clampCls) {
            clampCls.desc = "Clamps (saturates) a number inside the [min, max] range of the properties — if the value is already inside the range it goes out unchanged.";
            clampCls.portHelp = { inputs: { in: "Number to limit." }, outputs: { out: "The number, forced inside [min, max]." } };
        }
        const lerpCls = _builtIn['math/lerp'];
        if (lerpCls) {
            lerpCls.desc = "Linear interpolation between A and B according to the factor 'f' (property, or dynamic input 'f' if connected) — f=0 gives A, f=1 gives B, intermediate values a proportional blend.";
            lerpCls.portHelp = {
                inputs: { A: "Start value (f=0).", B: "End value (f=1).", f: "Interpolation factor 0..1 (optional, otherwise uses the 'f' property)." },
                outputs: { out: "A*(1-f) + B*f." },
            };
        }
        const absCls = _builtIn['math/abs'];
        if (absCls) { absCls.desc = "Absolute value (Math.abs) — removes the sign of the number."; absCls.portHelp = { inputs: { in: "Number." }, outputs: { out: "The number without sign." } }; }
        const floorCls = _builtIn['math/floor'];
        if (floorCls) { floorCls.desc = "Rounds down (Math.floor) — removes the decimal part, always downwards (negatives too, e.g. -1.2 → -2)."; floorCls.portHelp = { inputs: { in: "Number with possible decimals." }, outputs: { out: "The integer rounded down." } }; }
        const fracCls = _builtIn['math/frac'];
        if (fracCls) { fracCls.desc = "Returns only the decimal part (value % 1) — e.g. 3.75 → 0.75."; fracCls.portHelp = { inputs: { in: "Number." }, outputs: { out: "The fractional part (between -1 and 1, follows the sign of the input)." } }; }
        const smoothCls = _builtIn['math/smoothstep'];
        if (smoothCls) {
            smoothCls.desc = "S-curve (smoothstep) between the thresholds A and B (properties): below A it returns 0, above B it returns 1, in between a smooth (non-linear) transition instead of a sharp jump.";
            smoothCls.portHelp = { inputs: { in: "Number to evaluate." }, outputs: { out: "0..1, with a smooth transition between the thresholds A and B." } };
        }
        const scaleCls = _builtIn['math/scale'];
        if (scaleCls) { scaleCls.desc = "Multiplies the input value by the 'factor' property — v * factor."; scaleCls.portHelp = { inputs: { in: "Number." }, outputs: { out: "in * factor." } }; }
        const accCls = _builtIn['math/accumulate'];
        if (accCls) {
            accCls.desc = "Accumulates a total that grows on every execution — if 'inc' is connected, it adds that value; otherwise it adds a fixed increment (property 'increment', default 1). The total persists in the 'value' property and does not reset by itself.";
            accCls.portHelp = { inputs: { inc: "Amount to add in this execution (optional — if missing, uses 'increment')." }, outputs: { total: "The total accumulated so far." } };
        }
        const avgCls = _builtIn['math/average'];
        if (avgCls) {
            avgCls.desc = "Moving average (low-pass filter) over the last N executions, with N = property 'samples' — smooths fast/noisy variations of a value over time.";
            avgCls.portHelp = { inputs: { in: "Number to filter, sampled on every execution." }, outputs: { out: "Average of the last 'samples' readings." } };
        }
        const tendToCls = _builtIn['math/tendTo'];
        if (tendToCls) {
            tendToCls.desc = "Progressively moves the output value towards the current input, with a speed given by the 'factor' property (0..1: higher = faster) — useful to smooth a value that changes in jumps (making it 'chase' the target smoothly instead of jumping onto it).";
            tendToCls.portHelp = { inputs: { in: "The target value to tend towards." }, outputs: { out: "The current value, which gradually approaches 'in' on every execution." } };
        }
        const operationCls = _builtIn['math/operation'];
        if (operationCls) {
            operationCls.desc = "Arithmetic operation between A and B chosen in the 'Op.' widget (+, -, *, /, %, ^, max, min). A can also be an ARRAY or an OBJECT (not only a number): in that case the operation is applied element by element with the same B on each, returning an array/object of the same shape. If an input is not connected it uses the A/B property.";
            operationCls.portHelp = {
                inputs: { A: "First operand — number, or array/object to apply the operation element by element.", B: "Second operand (always a number — the same value is applied to every element if A is an array/object)." },
                outputs: { "=": "The result — number if A was a number, array if A was an array, object if A was an object." },
            };
        }
        const compareNumCls = _builtIn['math/compare'];
        if (compareNumCls) {
            compareNumCls.desc = "Compares two numbers A and B — SIX outputs are available (A==B, A!=B, A>B, A<B, A>=B, A<=B), which can be added from the node menu: only those actually connected are computed on every execution (the others stay inactive, to save computation). If an input is not connected it uses the A/B property.";
            compareNumCls.portHelp = {
                inputs: { A: "First number — if not connected, uses the 'A' property.", B: "Second number — if not connected, uses the 'B' property." },
                outputs: { "A==B": "true if A equals B.", "A!=B": "true if A differs from B.", "A>B": "true if A is greater than B.", "A<B": "true if A is less than B.", "A>=B": "true if A is greater than or equal to B.", "A<=B": "true if A is less than or equal to B." },
            };
        }
        const conditionCls = _builtIn['math/condition'];
        if (conditionCls) {
            conditionCls.desc = "Evaluates a condition between A and B with the operator chosen in the 'Cond.' widget (>, <, ==, !=, <=, >=, ||, &&) — unlike 'Compare' (Logic/Numeric) it has ONE boolean output active at a time (plus its complement), not six independent outputs. If an input is not connected it uses the A/B property.";
            conditionCls.portHelp = {
                inputs: { A: "First value — if not connected, uses the 'A' property.", B: "Second value — if not connected, uses the 'B' property." },
                outputs: { true: "Result of the chosen condition (e.g. A>B if the operator is '>').", false: "The exact complement of 'true' (always the opposite)." },
            };
        }
        const trigCls = _builtIn['math/trigonometry'];
        if (trigCls) {
            trigCls.desc = "Trigonometric functions on an angle in RADIANS — six outputs available (sin, cos, tan, asin, acos, atan), which can be added from the node menu and are computed only if connected. The result is then scaled by 'amplitude' and shifted by 'offset' (properties, or dynamic inputs if connected): result = amplitude * f(v) + offset.";
            trigCls.portHelp = {
                inputs: { v: "Angle in radians.", amplitude: "Scale factor of the result (optional, otherwise uses the property).", offset: "Value added to the final result (optional, otherwise uses the property)." },
                outputs: { sin: "amplitude·sin(v)+offset", cos: "amplitude·cos(v)+offset", tan: "amplitude·tan(v)+offset", asin: "amplitude·asin(v)+offset (v must be in -1..1)", acos: "amplitude·acos(v)+offset (v must be in -1..1)", atan: "amplitude·atan(v)+offset" },
            };
        }

        // Maths/Trig/Deg2Rad, Maths/Trig/Rad2Deg — conversioni semplici, utili
        // per comporre calcoli PRIMA di alimentare un input rotation/angle:
        // Trigonometry (sopra) lavora in radianti, mentre tutti i nodi
        // TJS/Object/Set*, TJS/Camera/*, ecc. si aspettano gradi.
        {
            function TrigDeg2Rad() {
                this.addProperty('deg', 0, 'number');
                this.addWidget('number', 'degrees', 0, v => { this.properties.deg = v; }, { property: 'deg' });
                this.addInput('degrees', 'number');
                this.addOutput('radians', 'number');
                this.color   = '#0c2340';
                this.bgcolor = '#1e3a5f';
                this.size    = [180, 60];
            }
            TrigDeg2Rad.title = 'Deg2Rad';
            TrigDeg2Rad.desc  = 'Converts degrees to radians (× π/180) — useful to feed Maths/Trig/Trigonometry (which works in radians) from an angle in degrees';
            TrigDeg2Rad.portHelp = {
                inputs:  { degrees: "Angle in degrees (optional, otherwise property 'deg')." },
                outputs: { radians: 'The same angle in radians (degrees × π/180).' },
            };
            TrigDeg2Rad.prototype.onExecute = function () {
                const deg = this.getInputData(0) ?? this.properties.deg ?? 0;
                this.setOutputData(0, deg * Math.PI / 180);
            };
            LG.registerNodeType('Maths/Trig/Deg2Rad', TrigDeg2Rad);

            function TrigRad2Deg() {
                this.addProperty('rad', 0, 'number');
                this.addWidget('number', 'radians', 0, v => { this.properties.rad = v; }, { property: 'rad' });
                this.addInput('radians', 'number');
                this.addOutput('degrees', 'number');
                this.color   = '#0c2340';
                this.bgcolor = '#1e3a5f';
                this.size    = [180, 60];
            }
            TrigRad2Deg.title = 'Rad2Deg';
            TrigRad2Deg.desc  = 'Converts radians to degrees (× 180/π) — useful to bring the result of Maths/Trig/Trigonometry (which works in radians) back to degrees before feeding it to a TJS/Object/Set* (all in degrees)';
            TrigRad2Deg.portHelp = {
                inputs:  { radians: "Angle in radians (optional, otherwise property 'rad')." },
                outputs: { degrees: 'The same angle in degrees (radians × 180/π).' },
            };
            TrigRad2Deg.prototype.onExecute = function () {
                const rad = this.getInputData(0) ?? this.properties.rad ?? 0;
                this.setOutputData(0, rad * 180 / Math.PI);
            };
            LG.registerNodeType('Maths/Trig/Rad2Deg', TrigRad2Deg);
        }

        // 3 nodi Flow/Logic condividono lo stesso file nativo math.js
        // (Bypass/Gate/Branch) — Help aggiunto qui per tenerlo vicino alla
        // fonte verificata, anche se la cartella finale è 'Flow/Logic'.
        const bypassCls = _builtIn['math/bypass'];
        if (bypassCls) {
            bypassCls.desc = "Pure passthrough on the DATA channel (not events) — returns exactly the value received, without any processing. Used to bypass LiteGraph's type check between two slots that would otherwise refuse the connection (same idea as 'basic/cast', but in the Flow/Logic context). Different from 'Flow/Trigger Pass', which works on the EVENT/ACTION channel, not on data.";
            bypassCls.portHelp = { inputs: { in: "Any value." }, outputs: { out: "The same value, unchanged." } };
        }
        const gateCls = _builtIn['math/gate'];
        if (gateCls) {
            gateCls.desc = "2-way data selector: if 'v' is true it lets A through, otherwise B — no event involved, only routing of a value already present on every execution (different from 'Flow/Trigger Gate', which conditions the passage of a TRIGGER, not of data).";
            gateCls.portHelp = {
                inputs: { v: "Boolean condition — true selects A, false selects B.", A: "Value passed to the output if v is true.", B: "Value passed to the output if v is false." },
                outputs: { out: "A or B, according to the value of v." },
            };
        }
        const branchCls = _builtIn['math/branch'];
        if (branchCls) {
            branchCls.desc = "Routes a value to ONE of the two outputs according to 'cond' — the one NOT chosen explicitly receives null (it does not simply stay 'not updated': it is reset on every execution). Different from 'Gate' (which chooses between two different VALUES A/B): here there is a single value, and the choice is WHICH OUTPUT to route it to.";
            branchCls.portHelp = {
                inputs: { in: "The value to route.", cond: "Boolean condition — true routes to 'true', false to 'false'." },
                outputs: { true: "The value of 'in' if cond is true, otherwise null.", false: "The value of 'in' if cond is false, otherwise null." },
            };
        }
    }

    // ── Vector — Help sui nodi nativi rimasti (Pack/Unpack/Math) (2026-09-20).
    // Nota: "vec2"/"vec3"/"vec4" qui sono semplici Float32Array di 2/3/4
    // numeri (NON classi THREE.Vector2/3 — nessuna conversione automatica,
    // serve un adattamento manuale se collegati a nodi TJS che si aspettano
    // istanze THREE.Vector3 vere).
    {
        const xyToVec2Cls = _builtIn['math3d/xy-to-vec2'];
        if (xyToVec2Cls) {
            xyToVec2Cls.desc = "Packs two numbers X/Y into a 2D vector — Float32Array(2), NOT a THREE.Vector2 instance. If an input is not connected it uses the corresponding property.";
            xyToVec2Cls.portHelp = { inputs: { x: "X component (optional, otherwise uses the 'x' property).", y: "Y component (optional, otherwise uses the 'y' property)." }, outputs: { vec2: "Float32Array [x, y]." } };
        }
        const xyzToVec3Cls = _builtIn['math3d/xyz-to-vec3'];
        if (xyzToVec3Cls) {
            xyzToVec3Cls.desc = "Packs three numbers X/Y/Z into a 3D vector — Float32Array(3), NOT a THREE.Vector3 instance. If an input is not connected it uses the corresponding property.";
            xyzToVec3Cls.portHelp = { inputs: { x: "X component (optional, otherwise property 'x').", y: "Y component (optional, otherwise property 'y').", z: "Z component (optional, otherwise property 'z')." }, outputs: { vec3: "Float32Array [x, y, z]." } };
        }
        const xyzwToVec4Cls = _builtIn['math3d/xyzw-to-vec4'];
        if (xyzwToVec4Cls) {
            xyzwToVec4Cls.desc = "Packs four numbers X/Y/Z/W into a 4D vector — Float32Array(4). If an input is not connected it uses the corresponding property.";
            xyzwToVec4Cls.portHelp = { inputs: { x: "X component.", y: "Y component.", z: "Z component.", w: "W component." }, outputs: { vec4: "Float32Array [x, y, z, w]." } };
        }
        const vec2ToXyCls = _builtIn['math3d/vec2-to-xy'];
        if (vec2ToXyCls) {
            vec2ToXyCls.desc = "Unpacks a 2D vector (Float32Array or plain array) into its two separate numeric components.";
            vec2ToXyCls.portHelp = { inputs: { vec2: "2D vector — array-like with at least 2 elements." }, outputs: { x: "The first element (v[0]).", y: "The second element (v[1])." } };
        }
        const vec3ToXyzCls = _builtIn['math3d/vec3-to-xyz'];
        if (vec3ToXyzCls) {
            vec3ToXyzCls.desc = "Unpacks a 3D vector (Float32Array or plain array) into its three separate numeric components.";
            vec3ToXyzCls.portHelp = { inputs: { vec3: "3D vector — array-like with at least 3 elements." }, outputs: { x: "v[0]", y: "v[1]", z: "v[2]" } };
        }
        const vec4ToXyzwCls = _builtIn['math3d/vec4-to-xyzw'];
        if (vec4ToXyzwCls) {
            vec4ToXyzwCls.desc = "Unpacks a 4D vector (Float32Array or plain array) into its four separate numeric components.";
            vec4ToXyzwCls.portHelp = { inputs: { vec4: "4D vector — array-like with at least 4 elements." }, outputs: { x: "v[0]", y: "v[1]", z: "v[2]", w: "v[3]" } };
        }
        const vec3DotCls = _builtIn['math3d/vec3-dot'];
        if (vec3DotCls) {
            vec3DotCls.desc = "Dot product between two 3D vectors — manual maths (A[0]*B[0]+A[1]*B[1]+A[2]*B[2]), does NOT depend on glMatrix.";
            vec3DotCls.portHelp = { inputs: { A: "First 3D vector (array-like).", B: "Second 3D vector (array-like)." }, outputs: { out: "Scalar number — the dot product A·B." } };
        }
        const vec3LenCls = _builtIn['math3d/vec3-length'];
        if (vec3LenCls) {
            vec3LenCls.desc = "Length (magnitude/Euclidean norm) of a 3D vector — sqrt(x²+y²+z²).";
            vec3LenCls.portHelp = { inputs: { in: "3D vector (array-like)." }, outputs: { out: "Number — the length of the vector." } };
        }
        const vec3LerpCls = _builtIn['math3d/vec3-lerp'];
        if (vec3LerpCls) {
            vec3LerpCls.desc = "Component-wise linear interpolation between two 3D vectors A and B, according to the factor 'f' (property, or input if connected) — f=0 gives A, f=1 gives B.";
            vec3LerpCls.portHelp = { inputs: { A: "Start 3D vector (f=0).", B: "End 3D vector (f=1).", f: "Interpolation factor 0..1 (optional, otherwise uses the 'f' property)." }, outputs: { out: "Float32Array(3) — A*(1-f) + B*f, component by component." } };
        }
        const vec3NormCls = _builtIn['math3d/vec3-normalize'];
        if (vec3NormCls) {
            vec3NormCls.desc = "Normalizes a 3D vector — same direction, length brought to 1 (divides every component by the vector magnitude).";
            vec3NormCls.portHelp = { inputs: { in: "3D vector (array-like), non-zero." }, outputs: { out: "Float32Array(3) — the same vector, with length 1." } };
        }
        const vec3ScaleCls = _builtIn['math3d/vec3-scale'];
        if (vec3ScaleCls) {
            vec3ScaleCls.desc = "Scales (multiplies) the three components of a 3D vector by a common factor 'f' (property, or input if connected).";
            vec3ScaleCls.portHelp = { inputs: { in: "3D vector (array-like).", f: "Scale factor (optional, otherwise uses the 'f' property)." }, outputs: { out: "Float32Array(3) — the scaled vector." } };
        }
    }

    // ── String + Logic/String — Help sui nodi nativi (2026-09-20). Questi
    // nodi sono creati con LiteGraph.wrapFunctionAsNode(): i nomi degli
    // ingressi sono generati AUTOMATICAMENTE dai nomi dei parametri della
    // funzione JS originale (verificato sul sorgente: wrapFunctionAsNode usa
    // getParameterNames(func) per gli input, e chiama SEMPRE l'unica uscita
    // "out" — per questo qui sotto compaiono chiavi come "a"/"b"/"str" invece
    // di nomi più descrittivi: sono quelli reali, non scelti da noi).
    {
        const concatCls = _builtIn['string/concatenate'];
        if (concatCls) {
            concatCls.desc = "Concatenates two strings (a + b) — if one of the two inputs is not connected, it simply returns the other one unchanged (not an error).";
            concatCls.portHelp = { inputs: { a: "First string.", b: "Second string." }, outputs: { out: "a + b, or only one of the two if the other is not connected." } };
        }
        const toUpCls = _builtIn['string/toUpperCase'];
        if (toUpCls) {
            toUpCls.desc = "Converts a string to upper case — if the input value is not a string, it returns it unchanged (no forced conversion).";
            toUpCls.portHelp = { inputs: { a: "String to convert." }, outputs: { out: "The string in upper case (or the original value if it was not a string)." } };
        }
        const splitCls = _builtIn['string/split'];
        if (splitCls) {
            splitCls.desc = "Splits a string (or every string of an array of strings) into an array of substrings, according to the separator. If 'separator' is not connected it uses the 'separator' property (default ',').";
            splitCls.portHelp = {
                inputs: { str: "String to split, or array of strings (in that case each one is split separately).", separator: "The separator to use (optional, otherwise uses the 'separator' property, default ',')." },
                outputs: { out: "Array of substrings (or array of arrays, if the input was already an array)." },
            };
        }
        const toFixedCls = _builtIn['string/toFixed'];
        if (toFixedCls) {
            toFixedCls.desc = "Converts a number to a string with a fixed number of decimals ('precision' property, default 0) — e.g. 3.14159 with precision 2 becomes '3.14'. If the input is not a number, it returns it unchanged.";
            toFixedCls.portHelp = { inputs: { a: "Number to format." }, outputs: { out: "String with the number formatted to 'precision' decimals." } };
        }
        const toStringCls = _builtIn['string/toString'];
        if (toStringCls) {
            toStringCls.desc = "Converts any value to a string — an object becomes JSON (JSON.stringify), any other type uses JavaScript's standard string conversion (String()).";
            toStringCls.portHelp = { inputs: { a: "Any value." }, outputs: { out: "The text representation of the value." } };
        }
        const toTableCls = _builtIn['string/toTable'];
        if (toTableCls) {
            toTableCls.desc = "Converts a multi-line text into a table: it splits first by lines (newline), then each line into columns according to the 'separator' property (default ',') — e.g. a CSV pasted as text becomes a table directly usable by 'Params/Data/Table [row][col]'.";
            toTableCls.portHelp = { inputs: { "": "Multi-line text, e.g. the content of a CSV file." }, outputs: { table: "Array of arrays of strings — one table row for each line of text.", rows: "Number of rows in the table (integer)." } };
        }

        const compareStrCls = _builtIn['string/compare'];
        if (compareStrCls) {
            compareStrCls.desc = "Compares two strings with simple equality (a == b) — no case-insensitive or trim option, a single different character makes the result false.";
            compareStrCls.portHelp = { inputs: { a: "First string.", b: "Second string." }, outputs: { out: "true if the two strings are identical character by character, otherwise false." } };
        }
        const containsCls = _builtIn['string/contains'];
        if (containsCls) {
            containsCls.desc = "Checks whether string 'a' CONTAINS the substring 'b' (String.indexOf != -1) — case-sensitive, no option to ignore case.";
            containsCls.portHelp = { inputs: { a: "String to search in.", b: "Substring to look for inside 'a'." }, outputs: { out: "true if 'b' is contained in 'a', otherwise false." } };
        }
    }

    // ── Logic/Bool (AND/OR/NOT/Compare) + Flow/Logic (IF/Selector/Sequence)
    // — Help sui nodi nativi rimasti, tutti dal file nativo logic.js
    // (2026-09-20).
    {
        const andCls = _builtIn['logic/AND'];
        if (andCls) {
            andCls.desc = "Logical AND on N boolean inputs (starts with 2 fixed 'a'/'b', others can be added from the node menu, all named 'and') — true ONLY if ALL the connected inputs are true.";
            andCls.portHelp = { inputs: { "*": "Boolean inputs (a, b, and other 'and' inputs that can be added from the menu) — all must be true." }, outputs: { out: "true if every input is true, otherwise false." } };
        }
        const orCls = _builtIn['logic/OR'];
        if (orCls) {
            orCls.desc = "Logical OR on N boolean inputs (starts with 2 fixed 'a'/'b', others can be added from the node menu, all named 'or') — true if AT LEAST ONE of the connected inputs is true.";
            orCls.portHelp = { inputs: { "*": "Boolean inputs (a, b, and other 'or' inputs that can be added from the menu) — one true is enough." }, outputs: { out: "true if at least one input is true, otherwise false." } };
        }
        const notCls = _builtIn['logic/NOT'];
        if (notCls) {
            notCls.desc = "Logical negation of a boolean (!in) — unlike 'Invert' (basic/not) it accepts ONLY booleans as the declared slot type, not any value.";
            notCls.portHelp = { inputs: { in: "Boolean value." }, outputs: { out: "The negation (!in)." } };
        }
        const compareBoolCls = _builtIn['logic/CompareBool'];
        if (compareBoolCls) {
            compareBoolCls.desc = "Compares N boolean values for mutual equality (starts with 2 fixed 'a'/'b', others can be added from the node menu, all named 'bool') — true ONLY if they are ALL equal (one value different from the first is enough to give false; sequential check that stops at the first mismatch). Different from 'Logic/Numeric/Compare' and 'Logic/String/Compare': here equality is among SEVERAL values at once, not only two.";
            compareBoolCls.portHelp = { inputs: { "*": "Boolean values to compare (a, b, and other 'bool' inputs that can be added from the menu)." }, outputs: { out: "true if all the connected inputs have the same value, otherwise false." } };
        }

        const ifCls = _builtIn['logic/IF'];
        if (ifCls) {
            ifCls.desc = "Routes a TRIGGER (not data) to one of two EVENT outputs according to 'condition' — unlike 'Flow/Logic/Branch' (which routes a VALUE to two data outputs), here there is no data to pass: only the execution pulse continues on 'true' or on 'false'.";
            ifCls.portHelp = { inputs: { onTrigger: "Trigger (ACTION) that starts the evaluation.", condition: "Boolean value that decides which output receives the trigger." }, outputs: { true: "EVENT emitted if 'condition' is true.", false: "EVENT emitted if 'condition' is false." } };
        }
        const selectorCls = _builtIn['logic/selector'];
        if (selectorCls) {
            selectorCls.desc = "Chooses ONE of several inputs (A/B/C/D fixed, others 'E'/'F'/'G'/'H' can be added from the menu) according to the numeric index 'sel' — sel is taken modulo the number of available inputs, so there is no need to worry about going out of range.";
            selectorCls.portHelp = { inputs: { sel: "Numeric index (0-based) of the input to select — reduced modulo the number of available inputs.", "*": "Candidate inputs (A, B, C, D and others that can be added from the menu) — any type." }, outputs: { out: "The value of the input selected by 'sel'." } };
        }
        const sequenceCls = _builtIn['logic/sequence'];
        if (sequenceCls) {
            sequenceCls.desc = "Chooses ONE text element from a sequence defined as a comma-separated string ('sequence' property, default 'A,B,C') according to the index 'index' — if the 'seq' input is connected, it REPLACES the default sequence with a new list (always as a string 'x,y,z').";
            sequenceCls.portHelp = { inputs: { index: "Numeric index (0-based) of the element to extract — reduced modulo the length of the sequence.", seq: "Alternative sequence as a string 'a,b,c' (optional — if missing uses the 'sequence' property)." }, outputs: { out: "The text element chosen from the sequence." } };
        }
    }

    // ── Flow/Events (9 nodi) + Time/Timer + Time/Delay + Debug/Log — Help
    // sui nodi nativi rimasti, tutti dal file nativo events.js (2026-09-20).
    {
        const logCls = _builtIn['events/log'];
        if (logCls) {
            logCls.desc = "Writes to the browser console (console.log) the action and parameter received from a trigger — the EVENT equivalent of 'Debug/Console' (which logs a data VALUE, not a trigger).";
            logCls.portHelp = { inputs: { event: "Trigger (ACTION) — the node logs both the action name and its parameter, if any." } };
        }
        const timerCls = _builtIn['events/timer'];
        if (timerCls) {
            timerCls.desc = "Emits an EVENT every N milliseconds ('interval' property/input) — the first trigger fires IMMEDIATELY when the graph starts (this.time starts at 0), then it repeats regularly. The node title always shows the current interval (e.g. 'Timer: 1000ms').";
            timerCls.portHelp = { inputs: { interval: "Interval in milliseconds between one tick and the next (optional, otherwise uses the 'interval' property)." }, outputs: { on_tick: "EVENT emitted every time the interval elapses." } };
        }
        const delayCls = _builtIn['events/delay'];
        if (delayCls) {
            delayCls.desc = "Delays a trigger by N milliseconds ('time_in_ms' property/input) — every event received is re-emitted on its own after the delay, regardless of other events arrived in the meantime (they queue up, they do not replace each other).";
            delayCls.portHelp = { inputs: { event: "Trigger (ACTION) to delay — its parameter is preserved and re-emitted with it.", time_in_ms: "Delay in milliseconds (optional, otherwise uses the 'time_in_ms' property)." }, outputs: { on_time: "EVENT emitted when the delay expires, with the same parameter received as input." } };
        }

        const counterCls = _builtIn['events/counter'];
        if (counterCls) {
            counterCls.desc = "Counter incremented/decremented by triggers — 'inc' increases by 1, 'dec' decreases by 1, 'reset' sets it to zero. If the 'Count Exec.' property is on, the counter also increases by itself on every graph execution (not only on triggers). When collapsed it shows the current value instead of the title.";
            counterCls.portHelp = {
                inputs: { inc: "Trigger: increments by 1.", dec: "Trigger: decrements by 1.", reset: "Trigger: resets the counter to zero." },
                outputs: { change: "EVENT emitted only when the value really changes (not on every trigger received, if the value stays the same).", num: "The current value of the counter (number)." },
            };
        }
        const stepperCls = _builtIn['events/stepper'];
        if (stepperCls) {
            stepperCls.desc = "Steps through N EVENT outputs (2 fixed, others can be added with the '+' button on the node) on every 'step' trigger — 'reset' goes back to the first. The optional 'index' input allows forcing the position directly (instead of advancing one at a time with 'step').";
            stepperCls.portHelp = {
                inputs: { index: "Forces the current index directly (optional — if connected, replaces manual stepping with 'step').", step: "Trigger: advances to the next output (wrapping around after the last).", reset: "Trigger: goes back to the first output (index 0)." },
                outputs: { index: "The current index (number) — always updated.", "*": "The actual EVENT outputs (2 by default, others can be added) — only the one matching the current index receives the trigger." },
            };
        }
        const sequenceEvCls = _builtIn['events/sequence'];
        if (sequenceEvCls) {
            sequenceEvCls.desc = "Re-emits EVERY trigger received on ALL its EVENT outputs at once (3 by default, others can be added with the '+' button) — it does not choose a path, it fires them all together. When collapsed the title appears empty (native behaviour, not a bug — the node is meant to be left expanded, horizontally).";
            sequenceEvCls.portHelp = { inputs: { "*": "One or more ACTION inputs — each one, when triggered, re-emits on ALL outputs." }, outputs: { "*": "EVENTs re-emitted in parallel on every trigger received on any input." } };
        }
        const waitAllCls = _builtIn['events/waitAll'];
        if (waitAllCls) {
            waitAllCls.desc = "Waits until EVERY input (2 by default, others can be added with the '+' button) has received at least one trigger before emitting its single output — a visual indicator (green/black squares) shows which inputs have already arrived. After emitting it resets automatically, ready for a new round. Title always empty (native behaviour).";
            waitAllCls.portHelp = { inputs: { "*": "ACTION inputs to wait for — the order in which they arrive does not matter, they must all arrive at least once." }, outputs: { "": "EVENT emitted only when ALL inputs have arrived at least once since the last reset." } };
        }
        const filterCls = _builtIn['events/filter'];
        if (filterCls) {
            filterCls.desc = "Lets a trigger through only if its parameter satisfies the filters set in the properties: 'equal_to' (the parameter must be EXACTLY equal to this value), 'has_property'+'property_equal_to' (if the parameter is an object, it must have this property, optionally with this value). Empty filters = no check on that criterion.";
            filterCls.portHelp = { inputs: { event: "Trigger (ACTION) with a parameter to check against the filters." }, outputs: { event: "EVENT re-emitted ONLY if the parameter passes all the filters set; otherwise the trigger is blocked with no output." } };
        }
        const branchEvCls = _builtIn['events/branch'];
        if (branchEvCls) {
            branchEvCls.desc = "Routes a TRIGGER to one of two EVENT outputs according to 'cond' — equivalent to 'Flow/Logic/IF' but born in the events file instead of logic (same behaviour).";
            branchEvCls.portHelp = { inputs: { in: "Trigger (ACTION) to route.", cond: "Boolean value that decides the output." }, outputs: { true: "EVENT emitted if cond is true.", false: "EVENT emitted if cond is false." } };
        }
        const onceCls = _builtIn['events/once'];
        if (onceCls) {
            onceCls.desc = "Lets ONLY THE FIRST trigger received on 'in' through — all the following ones are silently blocked until a trigger arrives on 'reset', which unlocks the passage again (only once).";
            onceCls.portHelp = { inputs: { in: "Trigger (ACTION) — passes only the first time after start or after the last reset.", reset: "Trigger: unlocks the passage again (the next 'in' will pass)." }, outputs: { out: "EVENT re-emitted only for the first 'in' received after start or after the last reset." } };
        }
        const semaphoreCls = _builtIn['events/semaphore'];
        if (semaphoreCls) {
            semaphoreCls.desc = "Two-state gate: 'green' opens it, 'red' closes it — a trigger on 'go' passes to 'continue' ONLY if the semaphore is green at that moment, otherwise it goes to 'blocked'. The 'reset' button on the node sets it back to red. A coloured box (green/orange) shows the current state.";
            semaphoreCls.portHelp = {
                inputs: { go: "Trigger to let through (if the semaphore is green) or block (if red).", green: "Trigger: opens the semaphore.", red: "Trigger: closes the semaphore." },
                outputs: { continue: "EVENT emitted if 'go' arrives while the semaphore is green.", blocked: "EVENT emitted if 'go' arrives while the semaphore is red.", is_green: "Boolean — the current state of the semaphore (updated on every execution)." },
            };
        }
        const triggerEvCls = _builtIn['events/trigger'];
        if (triggerEvCls) {
            triggerEvCls.desc = "Converts a VALUE (not a trigger) into an EVENT when it is 'truthy' — useful to turn data that becomes true/false into an execution pulse. Property 'only_on_change': if on (default), it re-emits only when the value CHANGES compared to the previous round, not on every execution in which it stays true.";
            triggerEvCls.portHelp = {
                inputs: { if: "The value to evaluate as true/false on every execution — any type." },
                outputs: { true: "EVENT emitted when the value is truthy (according to the 'only_on_change' property).", change: "EVENT emitted every time the value CHANGES compared to the previous round (both towards true and towards false).", false: "EVENT emitted when the value is falsy (according to the 'only_on_change' property)." },
            };
        }
    }

    // ── Params/UI (8 widget nativi) + Debug/Plot + Debug/Progress +
    // Interface/Gamepad — Help sui nodi nativi rimasti
    // (2026-09-20). I widget UI sono anche CONTROLLI INTERATTIVI disegnati
    // sul nodo stesso (bottone/slider/manopola/ecc.) — cliccabili/trascinabili
    // direttamente sul canvas, non solo collegabili con fili.
    {
        const btnCls = _builtIn['widget/button'];
        if (btnCls) {
            btnCls.desc = "Button clickable directly on the node ('text' property = label) — no inputs. It has TWO outputs, both unnamed: the first is an EVENT emitted on click (with the value of the 'message' property as parameter), the second is a boolean that is true ONLY while the button is held down (mouse down).";
            btnCls.portHelp = { outputs: { "": "First output (EVENT): trigger on click, with 'message' as parameter. Second output (boolean): true while the button is pressed, false at rest." } };
        }
        const toggleCls = _builtIn['widget/toggle'];
        if (toggleCls) {
            toggleCls.desc = "On/off switch clickable directly on the node — it can also be driven by a direct boolean input or by an 'e' trigger (which INVERTS the state, like a click). The two outputs are updated together on every change.";
            toggleCls.portHelp = {
                inputs: { "": "Boolean — forces the state directly (overrides the click).", e: "Trigger (ACTION): inverts the current state, like a click on the widget." },
                outputs: { v: "The current state (boolean).", e: "EVENT emitted on every state change, with the new value as parameter." },
            };
        }
        const numCls2 = _builtIn['widget/number'];
        if (numCls2) {
            numCls2.desc = "Numeric value adjustable by dragging vertically on the node (drag = increments/decrements by 'step' every 10px, Shift=×10, Alt/Cmd=×0.1) or with a quick click at the top/bottom of the node — clamped within the 'min'/'max' properties. No inputs: the value is set only by interacting with the widget or from the property panel.";
            numCls2.portHelp = { outputs: { "": "The current value (number), always within min..max." } };
        }
        const comboCls = _builtIn['widget/combo'];
        if (comboCls) {
            comboCls.desc = "Drop-down menu with the options defined in the 'values' property (string separated by ';', e.g. 'A;B;C') — no inputs: the selection is made only by clicking the widget on the node or from the property panel.";
            comboCls.portHelp = { outputs: { "": "The selected string (one of the 'values').", change: "EVENT emitted every time the selection changes, with the new string as parameter." } };
        }
        const knobCls = _builtIn['widget/knob'];
        if (knobCls) {
            knobCls.desc = "Circular knob adjustable by dragging vertically on the node — value between the 'min'/'max' properties, 'precision' decimals shown. No inputs.";
            knobCls.portHelp = { outputs: { "": "The current value (number), between min and max." } };
        }
        const sliderIntCls = _builtIn['widget/internal_slider'];
        if (sliderIntCls) {
            sliderIntCls.desc = "Slider that uses LiteGraph's NATIVE widget (same style as a slider in a property panel), instead of drawing itself like 'H.Slider' — equivalent behaviour, different look. No inputs.";
            sliderIntCls.portHelp = { outputs: { "": "The current value (number), between the 'min' and 'max' properties." } };
        }
        const hsliderCls = _builtIn['widget/hslider'];
        if (hsliderCls) {
            hsliderCls.desc = "Horizontal slider drawn entirely by the node (not a native widget) — dragged directly on the node body. No inputs.";
            hsliderCls.portHelp = { outputs: { "": "The current value (number), between the 'min' and 'max' properties." } };
            // FIX (2026-09-21, segnalato dall'utente — "la barra dello
            // slider a volte appare tutta spostata a sinistra, fuori dal
            // nodo, alla riapertura del grafo"): bug del nodo nativo,
            // verificato sul sorgente reale (litegraph.js src/nodes/
            // interface.js, WidgetHSlider). this.value (rapporto 0..1 usato
            // SOLO per disegnare la barra: `rect(4,4,(size[0]-8)*this.value,
            // ...)`) è un campo separato da this.properties.value, MAI
            // serializzato né ripristinato da configure() — il costruttore
            // lo inizializza a -1 come sentinella. Al reload,
            // this.properties.value/min/max tornano corretti (le property
            // si ripristinano sempre), ma this.value resta -1 finché non
            // trascini lo slider almeno una volta: (size[0]-8)*(-1) dà una
            // larghezza NEGATIVA → il rettangolo si disegna a sinistra di
            // x=4, quindi fuori dal nodo. Fix: dopo ogni configure(),
            // ricalcola this.value dal value/min/max appena ripristinati.
            const prevHsliderConfigure = hsliderCls.prototype.onConfigure;
            hsliderCls.prototype.onConfigure = function () {
                prevHsliderConfigure?.call(this);
                const { value, min, max } = this.properties;
                const range = (max - min) || 1;
                this.value = Math.max(0, Math.min(1, (value - min) / range));
            };
        }
        const textCls = _builtIn['widget/text'];
        if (textCls) {
            textCls.desc = "Shows a text or a number (formatted with 'decimals' decimals) directly on the node body — it is a display, it produces NO output. The 'resize' button in the property panel resizes the node to fit the current text.";
            textCls.portHelp = { inputs: { "": "The value to show — string or number. If missing, shows the 'value' property." } };
        }

        // ─── Params/UI/ColorPicker ───────────────────────────────────────────
        // Nessun widget nativo LiteGraph per la scelta colore (nessun
        // 'widget/color' in litegraph.js) — nodo custom che apre il color
        // picker nativo del sistema operativo/browser (<input type="color">).
        // Pensato in particolare per i pin 'colore' dei nodi TJS/Material/Set*
        // (accettano testo hex).
        //
        // Redesign (2026-09-22, su richiesta esplicita utente):
        //  - Nessun widget bottone nativo (niente testo/label) — l'INTERO
        //    corpo del nodo, 50×50px esatti, È il bottone/swatch: colorato
        //    col colore corrente, click ovunque sul corpo per aprire il
        //    picker. Hit-test in onMouseDown, stesso pattern già in uso per
        //    Debug/Inspect (drawY = pos[1] - NODE_TITLE_HEIGHT).
        //  - Nuovo output 'trigger' (EVENT), oltre a 'colore' (string) —
        //    si attiva alla CONFERMA del colore (evento nativo 'change' del
        //    picker, quando l'utente chiude/conferma), non ad ogni tick del
        //    drag live (evento 'input', che continua ad aggiornare solo il
        //    valore visivo/l'output dati, senza sparare trigger ripetuti).
        //  - FIX bug posizione: l'<input type=color> nascosto veniva
        //    parcheggiato a (-9999,-9999) — alcuni browser, con l'elemento
        //    così fuori viewport, non riescono ad ancorare il picker vicino
        //    al bottone (appariva sempre in alto a sinistra della finestra,
        //    posizione (0,0)) e la riapertura successiva poteva fallire in
        //    silenzio. Ora l'input resta invisibile (opacity:0, 1×1px) ma
        //    DENTRO il viewport, riposizionato ad ogni apertura esattamente
        //    appena sotto il nodo sul canvas reale (graphCanvas.ds +
        //    canvas.getBoundingClientRect(), stesso principio già verificato
        //    per fitAllNodes/zoomOneToOne in model_FLE.mjs), quindi il
        //    picker nativo del browser si apre ancorato lì.
        (function () {
            function ColorPicker() {
                this.addProperty('color', 'ffffff', 'string');
                this.addOutput('trigger', LG.EVENT);
                this.addOutput('color',   'string');
                this.color   = '#0c2340';
                this.bgcolor = '#1e3a5f';
                this.size    = [50, 50];
                this._input  = null;   // <input type=color> nascosto, riusato
            }
            ColorPicker.title = 'Color Picker';
            ColorPicker.desc  = 'Native system colour picker — the node body is the button/preview, click to open the picker';
            ColorPicker.portHelp = {
                outputs: {
                    trigger: 'event — emitted when the picker is confirmed/closed with a chosen colour (not on every live change while dragging)',
                    color:   'text — hex colour WITHOUT "#" (e.g. "ff8800"), same format as the text "color" ports of TJS/Material/Set* — updated live during selection',
                },
            };
            ColorPicker.prototype.onDrawForeground = function (ctx) {
                if (this.flags?.collapsed) return;
                ctx.save();
                ctx.fillStyle = '#' + (this.properties.color || 'ffffff');
                ctx.fillRect(0, 0, this.size[0], this.size[1]);
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.strokeRect(0.5, 0.5, this.size[0] - 1, this.size[1] - 1);
                ctx.restore();
            };
            // Click ovunque sul corpo (non sulla title bar) → apre il picker.
            // Ritorna true per dire a LiteGraph "gestito io", niente drag nodo.
            ColorPicker.prototype.onMouseDown = function (e, pos, graphCanvas) {
                const TH    = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
                const drawY = pos[1] - TH;
                if (drawY < 0) return false;   // click sulla title bar → drag nodo normale
                this._openPicker(graphCanvas);
                return true;
            };
            ColorPicker.prototype._ensureInput = function () {
                if (this._input) return;
                this._input = document.createElement('input');
                this._input.type = 'color';
                // Invisibile ma DENTRO il viewport (mai a coordinate assurde
                // tipo -9999,-9999) — vedi commento di testa sul redesign.
                this._input.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
                document.body.appendChild(this._input);
                // Live: aggiorna solo colore/anteprima/output dati, nessun trigger.
                this._input.addEventListener('input', () => {
                    this.properties.color = this._input.value.replace('#', '');
                });
                // Conferma/chiusura: aggiorna e SPARA il trigger, una sola volta.
                this._input.addEventListener('change', () => {
                    this.properties.color = this._input.value.replace('#', '');
                    this.setOutputData(1, this.properties.color);
                    this.triggerSlot(0);
                });
            };
            ColorPicker.prototype._openPicker = function (graphCanvas) {
                this._ensureInput();
                // Riposiziona ad ogni apertura — il nodo può essere stato
                // spostato o il canvas pannato/zoomato dall'ultima volta.
                if (graphCanvas?.canvas && graphCanvas.ds) {
                    const rect   = graphCanvas.canvas.getBoundingClientRect();
                    const localX = this.pos[0];
                    const localY = this.pos[1] + this.size[1];   // appena sotto il corpo del nodo
                    const [cx, cy] = graphCanvas.ds.convertOffsetToCanvas([localX, localY]);
                    this._input.style.left = `${Math.round(rect.left + cx)}px`;
                    this._input.style.top  = `${Math.round(rect.top  + cy)}px`;
                }
                this._input.value = '#' + (this.properties.color || 'ffffff');
                this._input.click();
            };
            ColorPicker.prototype.onExecute = function () {
                this.setOutputData(1, this.properties.color || 'ffffff');
            };
            ColorPicker.prototype.onRemoved = function () {
                this._input?.remove();
                this._input = null;
            };
            LG.registerNodeType('Params/UI/ColorPicker', ColorPicker);
        })();

        const plotCls = _builtIn['graphics/plot'];
        if (plotCls) {
            plotCls.desc = "Draws up to 4 numeric curves over time directly on the node body (a scrolling strip, every execution adds a point) — useful to see how a value changes without opening the console. The 'scale' property sets the vertical scale of the plot.";
            plotCls.portHelp = { inputs: { A: "First curve (white).", B: "Second curve (red).", C: "Third curve (green).", D: "Fourth curve (blue)." } };
        }
        const progressCls = _builtIn['widget/progress'];
        if (progressCls) {
            progressCls.desc = "Horizontal progress bar — shows the input value as a percentage between the 'min' and 'max' properties. No output: display only.";
            progressCls.portHelp = { inputs: { "": "Number to show as progress, between the 'min' and 'max' properties." } };
        }

        const gamepadCls = _builtIn['input/gamepad'];
        if (gamepadCls) {
            gamepadCls.desc = "Reads the state of a USB or Bluetooth gamepad/controller connected to the browser (native Gamepad API — the user must press a button at least once to 'activate' the gamepad for the browser). The 'gamepad_index' property chooses which controller if there is more than one; 'threshold' filters the noise of the analog sticks near the centre. Only 2 outputs are fixed (left X/Y axes); MANY others are available as dynamic outputs that can be added from the node menu (right_x_axis/right_y_axis, trigger_left/right, a_button/b_button/x_button/y_button/lb_button/rb_button/ls_button/rs_button/start_button/back_button, hat/hat_left/right/up/down) — computed only if actually connected.";
            gamepadCls.portHelp = {
                outputs: {
                    left_x_axis: "Left stick, X axis (-1..1, 0 if within 'threshold').",
                    left_y_axis: "Left stick, Y axis (-1..1, 0 if within 'threshold').",
                    button_pressed: "EVENT emitted at the FIRST instant any button is pressed (parameter = button name, e.g. 'a', 'lb', 'start') — it does not repeat while the button stays pressed.",
                    "*": "Additional dynamic outputs (can be added from the node menu) — axes/triggers as numbers, buttons as 0/1, directional pad (hat) as a bitmask.",
                },
            };
        }

    }

    // ── Media/Audio — Help sui 15 nodi nativi (2026-09-20). PREMESSA
    // fondamentale per capire tutti questi nodi: gli slot di tipo "audio"
    // NON sono valori JS passati ad ogni esecuzione (a differenza di tutti
    // gli altri tipi in questo progetto) — rappresentano invece un
    // collegamento LIVE del grafo Web Audio nativo del browser
    // (AudioNode.connect()/disconnect(), verificato via
    // LGAudio.onConnectionsChange/createAudioNodeWrapper sul sorgente): il
    // suono scorre continuamente attraverso quei collegamenti, non un
    // frame/tick alla volta come i dati normali. Gli input NUMERICI invece
    // (frequency, gain, ecc.) sincronizzano un parametro Web Audio ad ogni
    // esecuzione — quelli sì sono normali dati LiteGraph.
    {
        const audSrcCls = _builtIn['audio/source'];
        if (audSrcCls) {
            audSrcCls.desc = "Plays an audio file (wav/ogg/mp3) from a URL or dragged onto the node — properties 'src' (URL/resource), 'loop', 'autoplay', 'playbackRate'. The volume goes through an internal GainNode, the file is not altered.";
            audSrcCls.portHelp = {
                inputs: { gain: "Volume (0..1) — synchronizes the 'gain' property.", playbackRate: "Playback speed (1 = normal) — dynamic input, can be added from the menu.", src: "Audio URL/resource to load — dynamic input.", Play: "Trigger (ACTION, dynamic): starts playback.", Stop: "Trigger (ACTION, dynamic): stops all the sounds being played." },
                outputs: { out: "LIVE audio connection to the next node (e.g. an Effects/* or Output/Destination) — not per-tick data.", buffer: "Decoded AudioBuffer, once loaded (dynamic).", start: "EVENT when a playback starts (dynamic).", ended: "EVENT when a playback ends naturally (dynamic)." },
            };
        }
        const audMediaCls = _builtIn['audio/media_source'];
        if (audMediaCls) {
            audMediaCls.desc = "Captures audio from the device MICROPHONE (getUserMedia) — requires explicit permission from the user to the browser, and a secure context (HTTPS or localhost).";
            audMediaCls.portHelp = { inputs: { gain: "Volume of the microphone signal (0..1)." }, outputs: { out: "LIVE audio connection with the microphone signal." } };
        }
        const audOscCls = _builtIn['audio/oscillator'];
        if (audOscCls) {
            audOscCls.desc = "Generates a continuous synthetic tone — waveform chosen in the 'type' property (sine/square/sawtooth/triangle/custom), frequency in Hz. It starts/stops by itself when the graph is started/stopped (onStart/onStop).";
            audOscCls.portHelp = {
                inputs: { frequency: "Frequency in Hz (dynamic).", detune: "Detune in cents, typically ±1200 (dynamic).", type: "Waveform as a string (dynamic)." },
                outputs: { out: "LIVE audio connection with the generated tone." },
            };
        }
        const audSignalCls = _builtIn['audio/signal'];
        if (audSignalCls) {
            audSignalCls.desc = "Extracts the amplitude of ONE specific frequency band from an FFT spectrum (the 'freqs' output of 'Media/Audio/Analysis/Analyser') — useful to make a node react to a precise frequency (e.g. the bass) instead of the overall volume.";
            audSignalCls.portHelp = {
                inputs: { freqs: "Array of amplitudes per frequency bin (0-255), typically from the 'freqs' output of 'Analysis/Analyser'.", band: "Frequency in Hz to extract (dynamic, otherwise uses the 'band' property)." },
                outputs: { signal: "Amplitude interpolated at the requested frequency, scaled by the 'amplitude' property (number, typically 0..amplitude)." },
            };
        }
        const audGainCls = _builtIn['audio/gain'];
        if (audGainCls) {
            audGainCls.desc = "Controls the volume of an audio signal (native GainNode) — inserted in the chain between a source and the output.";
            audGainCls.portHelp = { inputs: { in: "Incoming LIVE audio connection.", gain: "Volume factor (1 = unchanged, 0 = mute, >1 amplifies)." }, outputs: { out: "LIVE audio connection, with the volume applied." } };
        }
        const audAdsrCls = _builtIn['audio/adsr'];
        if (audAdsrCls) {
            audAdsrCls.desc = "Classic synthesizer ADSR envelope (Attack/Decay/Sustain/Release) — controls the volume over time according to the 'gate' state: when 'gate' becomes true the Attack→Decay phase starts towards the Sustain level; when it goes back to false the Release phase starts towards silence.";
            audAdsrCls.portHelp = {
                inputs: { in: "LIVE audio connection to modulate in volume.", gate: "Boolean — true = note pressed (Attack/Decay/Sustain), false = note released (Release).", A: "Attack time in seconds (dynamic).", D: "Decay time in seconds (dynamic).", S: "Sustain level 0..1 (dynamic).", R: "Release time in seconds (dynamic)." },
                outputs: { out: "LIVE audio connection, with the volume envelope applied." },
            };
        }
        const audDelayCls = _builtIn['audio/delay'];
        if (audDelayCls) {
            audDelayCls.desc = "Delays the audio signal by a fixed time (simple echo, no feedback) — max 10 seconds (limit of the DelayNode created).";
            audDelayCls.portHelp = { inputs: { in: "LIVE audio connection to delay.", time: "Delay in seconds (dynamic, otherwise uses the 'delayTime' property)." }, outputs: { out: "LIVE audio connection, delayed." } };
        }
        const audFilterCls = _builtIn['audio/biquadfilter'];
        if (audFilterCls) {
            audFilterCls.desc = "Parametric audio filter (BiquadFilterNode) — type chosen in the 'type' property (lowpass/highpass/bandpass/lowshelf/highshelf/peaking/notch/allpass), cutoff frequency and resonance (Q) configurable.";
            audFilterCls.portHelp = { inputs: { in: "LIVE audio connection to filter.", frequency: "Cutoff frequency in Hz (dynamic).", detune: "Detune in cents (dynamic).", Q: "Resonance/quality factor of the filter (dynamic)." }, outputs: { out: "LIVE audio connection, filtered." } };
        }
        const audConvCls = _builtIn['audio/convolver'];
        if (audConvCls) {
            audConvCls.desc = "Applies a reverb effect by convolving the signal with an 'impulse response' loaded from an audio file ('impulse_src' property, URL or dragged onto the node) — the quality/character of the reverb depends entirely on the chosen impulse file.";
            audConvCls.portHelp = { inputs: { in: "LIVE audio connection to process." }, outputs: { out: "LIVE audio connection, with the reverb applied." } };
        }
        const audCompCls = _builtIn['audio/dynamicsCompressor'];
        if (audCompCls) {
            audCompCls.desc = "Dynamics compressor (DynamicsCompressorNode) — automatically reduces the volume of the loudest peaks above 'threshold' (dB), according to 'ratio'/'knee'/'attack'/'release' — useful to even out the perceived volume.";
            audCompCls.portHelp = {
                inputs: { in: "LIVE audio connection to compress.", threshold: "Threshold in dB above which compression starts (dynamic).", knee: "Width of the soft transition around the threshold, in dB (dynamic).", ratio: "Compression ratio (e.g. 12 = reduces by 12dB for every dB above the threshold) (dynamic).", reduction: "Reduction applied at this instant, in dB — read only via property (dynamic).", attack: "Reaction time at the start of a peak, in seconds (dynamic).", release: "Recovery time after a peak, in seconds (dynamic)." },
                outputs: { out: "LIVE audio connection, compressed." },
            };
        }
        const audAnalyserCls = _builtIn['audio/analyser'];
        if (audAnalyserCls) {
            audAnalyserCls.desc = "Analyses the incoming audio signal and exposes the frequency spectrum and the waveform as normal numeric data (NOT an outgoing audio connection — this node has no audio 'out': insert it as a branch, not in series on the main chain).";
            audAnalyserCls.portHelp = {
                inputs: { in: "LIVE audio connection to analyse.", minDecibels: "Minimum decibel threshold considered (dynamic).", maxDecibels: "Maximum decibel threshold considered (dynamic).", smoothingTimeConstant: "How much successive readings are smoothed/averaged, 0..1 (dynamic)." },
                outputs: { freqs: "Uint8Array — amplitude (0-255) for each frequency band (FFT spectrum), computed only if connected.", samples: "Uint8Array — waveform over time (oscilloscope), computed only if connected." },
            };
        }
        const audVisCls = _builtIn['audio/visualization'];
        if (audVisCls) {
            audVisCls.desc = "Draws the 'data' values (typically 'freqs' or 'samples' from Analysis/Analyser) directly on the node body as a bar/line chart — no output, display only.";
            audVisCls.portHelp = { inputs: { data: "Array of numbers to draw (e.g. Uint8Array from Analysis/Analyser).", mark: "Frequency (Hz) to highlight with a vertical red line, optional." } };
        }
        const audMixerCls = _builtIn['audio/mixer'];
        if (audMixerCls) {
            audMixerCls.desc = "Sums two audio signals into one, each with its own independent volume (gain1/gain2).";
            audMixerCls.portHelp = {
                inputs: { in1: "First LIVE audio connection.", "in1 gain": "Volume of the first signal (dynamic).", in2: "Second LIVE audio connection.", "in2 gain": "Volume of the second signal (dynamic)." },
                outputs: { out: "LIVE audio connection, sum of the two weighted signals." },
            };
        }
        const audDestCls = _builtIn['audio/destination'];
        if (audDestCls) {
            audDestCls.desc = "Final output to the device speakers/headphones — LAST link of the chain: any audio signal must arrive here (directly or through other effects) to be actually audible.";
            audDestCls.portHelp = { inputs: { in: "LIVE audio connection to play on the system audio output." } };
        }
        const audScriptCls = _builtIn['audio/script'];
        if (audScriptCls) {
            audScriptCls.desc = "Processes the audio signal SAMPLE BY SAMPLE with custom JavaScript code (ScriptProcessorNode — API deprecated by the W3C but still working in current browsers) — the 'code' property defines 'this.onaudioprocess', which receives the input/output buffers in blocks of 4096 samples.";
            audScriptCls.portHelp = { inputs: { in: "LIVE audio connection entering the processor." }, outputs: { out: "LIVE audio connection processed by the code." } };
        }
    }

    // ── Media/Audio/MIDI — Help sui 12 nodi nativi (2026-09-20). PREMESSA:
    // il tipo "midi" qui è un'istanza della classe interna MIDIEvent
    // (proprietà .channel/.cmd/.data[]/.note/.velocity/.octave, con
    // .toString() leggibile) — un OGGETTO strutturato, non un numero o una
    // stringa. Richiede l'API Web MIDI del browser (navigator.requestMIDIAccess
    // — permesso esplicito dell'utente, supporto limitato su alcuni browser).
    // Due nodi (FromFile/Play) dipendono da librerie terze MAI incluse in
    // questo progetto — restano nel menu ma NON funzionano (vedi dettaglio).
    {
        const midiInCls = _builtIn['midi/input'];
        if (midiInCls) {
            midiInCls.desc = "Reads events from a MIDI input port ('port' property, chosen among the detected devices) — requires the Web MIDI API with the user's permission. Every hardware MIDI event generates both the 'midi' data and a type-specific EVENT.";
            midiInCls.portHelp = {
                // NOTA: la slot fissa 'out' (type "midi") è dichiarata nel
                // costruttore nativo ma onExecute aggiorna solo slot chiamate
                // ESATTAMENTE "midi" o "last_midi" — quirk della libreria
                // originale (non introdotto da questo progetto): se serve il
                // valore MIDIEvent corrente, aggiungi dal menu del nodo
                // l'uscita dinamica 'last_midi', non fare affidamento su 'out'.
                outputs: { out: "Declared by the native node but NEVER set by onExecute (quirk of the original library) — use instead the dynamic output 'last_midi' (can be added from the node menu) for the current MIDIEvent.", on_midi: "EVENT for ANY MIDI message received.", on_noteon: "EVENT only for Note On messages (dynamic).", on_noteoff: "EVENT only for Note Off messages (dynamic).", on_cc: "EVENT only for Control Change (dynamic).", on_pc: "EVENT only for Program Change (dynamic).", on_pitchbend: "EVENT only for Pitch Bend (dynamic)." },
            };
        }
        const midiOutCls = _builtIn['midi/output'];
        if (midiOutCls) {
            midiOutCls.desc = "Sends a MIDIEvent to a MIDI output port ('port' property, chosen among the detected devices) — requires the Web MIDI API.";
            midiOutCls.portHelp = { inputs: { send: "Trigger (EVENT) with a MIDIEvent as parameter — sends it on the configured port." }, outputs: { on_midi: "EVENT re-emitted with the same MIDIEvent, right after sending." } };
        }
        const midiShowCls = _builtIn['midi/show'];
        if (midiShowCls) {
            midiShowCls.desc = "Shows on the node body the text representation (.toString()) of the last MIDIEvent received — pure diagnostic display.";
            midiShowCls.portHelp = { inputs: { in: "Trigger (ACTION) with a MIDIEvent as parameter." }, outputs: { on_midi: "EVENT re-emitted right after showing the event, with the same MIDIEvent." } };
        }
        const midiFilterCls = _builtIn['midi/filter'];
        if (midiFilterCls) {
            midiFilterCls.desc = "Lets through only the MIDIEvents matching the criteria set (properties 'channel'/'cmd'/'min_value'/'max_value', -1 = no filter on that criterion) — the 'Learn' button on the node automatically captures the criteria from the NEXT MIDI event received, instead of setting them by hand.";
            midiFilterCls.portHelp = { inputs: { in: "Trigger (EVENT) with a MIDIEvent to evaluate." }, outputs: { on_midi: "EVENT re-emitted with the same MIDIEvent ONLY if it passes all the active filters." } };
        }
        const midiEventCls = _builtIn['midi/event'];
        if (midiEventCls) {
            midiEventCls.desc = "Builds a MIDIEvent from scratch from the channel/cmd/value1/value2 properties (or the equivalent dynamic inputs) — or, if it receives an event on 'assign', COPIES its parameters from that MIDIEvent instead of building a new one.";
            midiEventCls.portHelp = {
                inputs: { send: "Trigger (EVENT): builds and sends the MIDIEvent according to the current parameters.", assign: "Trigger (EVENT) with a MIDIEvent — copies its parameters (channel/cmd/value1/value2) instead of building.", cmd: "Numeric MIDI command (dynamic).", note: "Note number or note name as a string, e.g. 'C4' (dynamic).", value1: "First data byte, 0..127 (dynamic).", value2: "Second data byte, 0..127 (dynamic)." },
                outputs: { midi: "The MIDIEvent built (dynamic).", on_midi: "EVENT emitted in response to the 'send' trigger.", command: "The current numeric MIDI command (dynamic).", note: "Note number (only if cmd is Note On/Off, dynamic).", velocity: "Velocity 0..127 (Note On only, dynamic).", cc: "Controller number (= value1, dynamic).", cc_value: "Controller value (= value2, dynamic).", pitch: "Pitch computed from the note (dynamic).", gate: "true if the last assigned event was Note On, false if Note Off (dynamic).", pitchbend: "Computed pitch bend value (Pitch Bend cmd only, dynamic)." },
            };
        }
        const midiCcCls = _builtIn['midi/cc'];
        if (midiCcCls) {
            midiCcCls.desc = "Reads the current value of ONE MIDI controller ('cc' property, number 0..127) from the global state of the last connected MIDI device — continuous polling on every execution, not an event.";
            midiCcCls.portHelp = { outputs: { value: "Current value of the chosen controller (0..127), or unchanged if no MIDI input is active." } };
        }
        const midiGenCls = _builtIn['midi/generator'];
        if (midiGenCls) {
            midiGenCls.desc = "Automatically generates a MIDI note (Note On followed by Note Off after 'duration' seconds) from a scale of notes defined as CSV ('notes' property, e.g. 'A,A#,B,C,...') — 'sequence' mode (advances in order) or 'random', 'mode' property.";
            midiGenCls.portHelp = {
                inputs: { generate: "Trigger (ACTION): generates the next note.", scale: "Alternative scale as a CSV of notes (dynamic, otherwise uses the 'notes' property).", octave: "Base octave of the generated note (dynamic, otherwise uses the 'octave' property)." },
                outputs: { note: "EVENT with a Note On MIDIEvent, automatically followed (after 'duration' seconds) by a second EVENT with Note Off." },
            };
        }
        const midiTransCls = _builtIn['midi/transpose'];
        if (midiTransCls) {
            midiTransCls.desc = "Shifts the pitch of a Note On/Off MIDIEvent by N semitones ('amount' property/input, positive = higher) — non-note events pass unchanged.";
            midiTransCls.portHelp = { inputs: { in: "Trigger (ACTION) with a MIDIEvent to transpose.", amount: "Number of semitones to shift (dynamic, positive or negative)." }, outputs: { out: "EVENT with the transposed MIDIEvent (or unchanged, if it was not a note)." } };
        }
        const midiQuantCls = _builtIn['midi/quantize'];
        if (midiQuantCls) {
            midiQuantCls.desc = "Forces a Note On/Off MIDIEvent to the nearest valid note belonging to a scale ('scale' property/input, CSV as in Generator) — useful to 'correct' off-scale notes without changing their rhythm.";
            midiQuantCls.portHelp = { inputs: { note: "Trigger (ACTION) with a MIDIEvent to quantize.", scale: "Alternative scale as CSV (dynamic, otherwise uses the 'scale' property)." }, outputs: { out: "EVENT with the MIDIEvent quantized to the nearest valid note." } };
        }
        const midiFromFileCls = _builtIn['midi/fromFile'];
        if (midiFromFileCls) {
            midiFromFileCls.desc = "Loads a .mid file and plays its events over time — requires the third-party library 'midi-parser.js', NEVER included at dashboard.php level (so as not to weigh down the graphs that do not use it). WITHOUT action: it stays NOT WORKING (red box). By connecting the 'parser' output of the 'Media/Audio/MIDI/Util/Load MidiParser' node to the 'parser' input here (patch added on 2026-09-20), the node works normally — the library is downloaded dynamically ONLY at that moment, only for that graph, via jsDelivr.";
            midiFromFileCls.portHelp = {
                inputs: { "": "ACTION trigger: 'play' starts/restarts from the beginning, 'pause' pauses/resumes.", parser: "Ready parsing module — connect here the 'parser' output of 'Load MidiParser' (or any node exposing an object with the same .parse(Uint8Array) method). If connected, it ALWAYS takes priority over the global MidiParser library." },
                outputs: { note: "EVENT with a MIDIEvent for every event of the MIDI file, at the right time in the timeline." },
            };
        }
        const midiPlayCls = _builtIn['midi/play'];
        if (midiPlayCls) {
            midiPlayCls.desc = "Plays an incoming MIDI note with a software synthesizer — requires the third-party library 'Audiosynth.js', NEVER included at dashboard.php level (so as not to weigh down the graphs that do not use it). WITHOUT action: it stays NOT WORKING (red box, no sound). By connecting the 'synth' output of the 'Media/Audio/MIDI/Util/Load Audiosynth' node to the 'instrument' input here (patch added on 2026-09-20), the node plays normally — the library is downloaded dynamically ONLY at that moment, only for that graph, via jsDelivr.";
            midiPlayCls.portHelp = {
                inputs: { note: "Trigger (ACTION) with a MIDIEvent — if 'instrument' is connected (or if Audiosynth is already global), it plays the note with the available instrument.", volume: "Volume 0..1 (dynamic).", duration: "Note duration in seconds (dynamic).", instrument: "Ready instrument — connect here the 'synth' output of 'Load Audiosynth' (or any node exposing an object with the same .play(note,octave,duration,volume) method). If connected, it ALWAYS takes priority over the global AudioSynth library." },
                outputs: { note: "EVENT re-emitted with the same MIDIEvent, regardless of whether audio is produced." },
            };
        }
        const midiKeysCls = _builtIn['midi/keys'];
        if (midiKeysCls) {
            midiKeysCls.desc = "Piano keyboard drawn on the node ('num_octaves'/'start_octave' properties) — both INTERACTIVE (clicking a key generates a note) and REACTIVE (highlights the keys according to the incoming MIDIEvents).";
            midiKeysCls.portHelp = {
                inputs: { note: "Trigger (ACTION) with a Note On/Off MIDIEvent — highlights/turns off the matching key on the drawn keyboard.", reset: "Trigger (ACTION): turns off all the highlighted keys." },
                outputs: { note: "EVENT with a Note On/Off MIDIEvent — emitted both when an event arrives as input and when the user clicks a key directly on the node." },
            };
        }
    }

    // ── Media/Image, Video, Canvas, Frame, Tools — Help sui 9 nodi nativi
    // rimasti, tutti dal file nativo graphics.js (2026-09-20). Nota: i tipi
    // "image"/"canvas"/"video" qui sono elementi DOM veri (HTMLImageElement,
    // HTMLCanvasElement, HTMLVideoElement) o simili — compatibili con
    // ctx.drawImage(), non JSON/valori semplici.
    {
        const imgCls = _builtIn['graphics/image'];
        if (imgCls) {
            imgCls.desc = "Loads an image from a URL ('url' property, or dragged onto the node) — jpg/jpeg/png/gif. The 'load' button in the property panel reloads manually. Orange box = loading, green = ready.";
            imgCls.portHelp = { outputs: { frame: "The loaded HTMLImageElement — null if not ready yet." } };
        }
        const paletteCls = _builtIn['color/palette'];
        if (paletteCls) {
            paletteCls.desc = "Generates a colour by interpolating between 4 fixed colours (properties colorA..colorD, hexadecimal) according to the position 'f' (0..1) along the gradient — f=0 gives colorA, f=1 gives colorD, intermediate values blend between neighbouring colours in the sequence.";
            paletteCls.portHelp = { inputs: { f: "Position along the gradient, 0..1 (default 0.5 if not connected)." }, outputs: { Color: "Array [r,g,b] with components 0..1 (not 0..255) — the box on the node shows a preview of the colour." } };
        }
        const frameCls = _builtIn['graphics/frame'];
        if (frameCls) {
            frameCls.desc = "Viewer: draws any image/canvas/video received as input on the node body. The 'resize' button in the property panel adapts the node size to the real size of the image; the 'view' button opens the image in an enlarged view (if configured in the project).";
            frameCls.portHelp = { inputs: { "": "Image, canvas or video to display (HTMLImageElement/HTMLCanvasElement/HTMLVideoElement)." } };
        }
        const fadeCls = _builtIn['graphics/imagefade'];
        if (fadeCls) {
            fadeCls.desc = "Cross-fade between two images on an internal canvas (fixed size, 'width'/'height' properties) — 'fade' 0 shows only img1, 1 shows only img2, intermediate values overlay them with transparency.";
            fadeCls.portHelp = { inputs: { img1: "First image (below).", img2: "Second image (above, with opacity = fade).", fade: "Fade amount 0..1 (optional, otherwise uses the 'fade' property)." }, outputs: { "": "The internal canvas with the two images blended." } };
        }
        const cropCls = _builtIn['graphics/cropImage'];
        if (cropCls) {
            cropCls.desc = "Crops a portion of an image onto a fixed-size canvas ('width'/'height' properties) — 'x'/'y' move the image (not the crop area: negative values move it up/left), 'scale' resizes it before cropping.";
            cropCls.portHelp = { inputs: { "": "Source image to crop." }, outputs: { "": "Canvas with the cropped portion, at the fixed 'width'×'height' size." } };
        }
        const canvasCls = _builtIn['graphics/canvas'];
        if (canvasCls) {
            canvasCls.desc = "Creates an empty 2D canvas of fixed size ('width'/'height' properties) on which other nodes (e.g. DrawImage) can draw — if 'autoclear' is on (default), it is cleared automatically on every execution before other nodes draw on it.";
            canvasCls.portHelp = { inputs: { clear: "Trigger (ACTION): clears the canvas immediately, regardless of 'autoclear'." }, outputs: { "": "The HTMLCanvasElement, ready to be drawn on by other nodes." } };
        }
        const drawImgCls = _builtIn['graphics/drawImage'];
        if (drawImgCls) {
            drawImgCls.desc = "Draws an image inside an existing canvas, at position x/y — it must run AFTER the node that creates/clears the canvas (e.g. 'Canvas'), in the same step, otherwise the drawing may be erased by autoclear.";
            drawImgCls.portHelp = { inputs: { canvas: "The canvas to draw on (must already exist).", img: "Source image or canvas to draw.", x: "Target X coordinate (optional, otherwise uses the 'x' property).", y: "Target Y coordinate (optional, otherwise uses the 'y' property)." } };
        }
        const videoCls = _builtIn['graphics/video'];
        if (videoCls) {
            videoCls.desc = "Plays a video from a URL ('url' property) in automatic loop, muted (browser autoplay requires muted:true). The 't' input allows manual 'scrubbing' to position 0..1 of the duration (it pauses while doing so).";
            videoCls.portHelp = {
                inputs: { t: "Normalized playback position 0..1 (optional) — if provided, moves the video to that point and pauses it." },
                outputs: { frame: "The current HTMLVideoElement (compatible with ctx.drawImage).", t: "Current playback time, in seconds.", d: "Total duration of the video, in seconds." },
            };
        }
        const webcamCls = _builtIn['graphics/webcam'];
        if (webcamCls) {
            webcamCls.desc = "Captures the video stream of the device WEBCAM (getUserMedia, video only) — requires explicit permission from the user and a secure context (HTTPS or localhost). Black box = not requested, green = active, red = permission denied/error. NOTE: if permission is denied, the node does NOT retry automatically — a page reload or a change of the 'facingMode' property is needed to restart openStream().";
            webcamCls.portHelp = { outputs: { Webcam: "The video element of the webcam stream (compatible with ctx.drawImage) — empty/null until permission has been granted." } };
        }
    }

    // =========================================================================
    // Debug/Note — appunti/istruzioni d'uso liberi nel grafo, pura
    // annotazione (nessun input/output, non partecipa all'esecuzione).
    // Path aggiornato da Display/UI/Note (2026-09-20): il gruppo 'Display' è
    // stato dissoluto nella riorganizzazione Debug/Interface/Media dello
    // stesso giorno — Note non era stata esplicitamente menzionata in quella
    // richiesta, spostata qui per analogia (non modifica dati del grafo,
    // serve solo mentre si lavora, stessa natura degli altri nodi Debug).
    // Motivazione (2026-09-19): 'widget/panel' (rinominato Display/UI/Panel,
    // REMAP sopra) è il node nativo LiteGraph "WidgetPanel" — il suo stesso
    // .desc originale dice "Non interactive panel": disegna solo un
    // rettangolo decorativo (bordo + gradiente) con UN widget bottone
    // "Update", NESSUNO spazio testo. Non adatto per note/istruzioni — da
    // qui questo nodo dedicato, non un fix del Panel nativo.
    // Colore: famiglia "UI (grafo o APP)" della tassonomia — vedi
    // _doc/module-fle-architettura.md §10 (finora solo proposta, mai
    // assegnata a un nodo reale: questo è il primo).
    //
    // FIX (2026-09-21): il widget 'text' nativo con multiline:true (click →
    // LGraphCanvas.prototype.prompt) disegna SEMPRE anche un'anteprima del
    // valore corrente dentro la riga del widget stesso — duplicata con
    // l'intero testo ridisegnato sotto da onDrawForeground, esteticamente
    // sgradevole (segnalato dall'utente). Sostituito con lo stesso pattern
    // di Params/Constants/ConstText: un widget bottone (nessun testo dentro,
    // solo l'etichetta fissa "✎ Modifica appunti") che apre un editor
    // modale Bootstrap — zero duplicazione per costruzione, non serve più
    // nasconderlo per pulizia. Aggiunta comunque, su richiesta esplicita,
    // la possibilità di nascondere anche questo bottone (tasto destro →
    // Nascondi/Mostra pulsante modifica): con il bottone nascosto il nodo
    // mostra solo il testo, editabile comunque da un'altra voce del menu
    // tasto destro sempre presente. Aggiunta anche la dimensione font,
    // configurabile nello stesso editor modale (property 'fontSize').
    // =========================================================================

    // (2026-10-06) Markdown: il testo può essere formattato (titoli, grassetto, elenchi, codice,
    // tabelle allineate) — disegnato da FLE-markdown-canvas.mjs, nessun HTML. property 'format':
    // 'markdown' (predefinito) o 'text'. Rotella sopra il nodo = scorrimento se il testo è lungo.
    const _NOTE_MODAL_ID = '_fle_note_modal';
    const _NOTE_FORMATS  = ['markdown', 'text'];

    function ReseArchNote() {
        this.addProperty('text',           '',   'string');
        this.addProperty('fontSize',       11,   'number');
        this.addProperty('showEditButton', true, 'boolean');
        this.addProperty('format',         'markdown', 'string');
        this._lay = null; this._layKey = ''; this._scrollY = 0;

        this._editWidget = this.addWidget('button', '✎ Edit note', null, () => this._openEditor());

        this.color   = '#0c4a6e';
        this.bgcolor = '#0369a1';
        this.size    = [260, 160];
        this.resizable = true;
    }

    ReseArchNote.title = 'Note txt\\md';
    ReseArchNote.desc  = "Free notes/instructions — runs nothing, only text visible in the graph. Markdown format (default: headings #, **bold**, *italic*, `code`, lists, quotes >, ``` blocks and aligned | a | b | tables) or plain text. Mouse wheel over the node to scroll a long text. Right click on the node: hide/show the edit button, edit note.";
    ReseArchNote.portHelp = {
        properties: {
            text:     'the text of the note (Markdown or plain text)',
            format:   'markdown: headings, bold, italic, code, lists, quotes, code blocks, tables with aligned columns · text: plain text',
            fontSize: 'text size in pixels (headings are proportional)',
        },
    };

    // Aggiunge/toglie this._editWidget da this.widgets in base alla property
    // showEditButton — richiamata sia dopo la creazione sia da onConfigure
    // (al caricamento di un grafo salvato con showEditButton:false).
    ReseArchNote.prototype._syncEditButtonVisibility = function () {
        this.widgets = this.widgets || [];
        const has = this.widgets.includes(this._editWidget);
        if (this.properties.showEditButton && !has) {
            this.widgets.push(this._editWidget);
        } else if (!this.properties.showEditButton && has) {
            this.widgets = this.widgets.filter(w => w !== this._editWidget);
        }
    };
    ReseArchNote.prototype.onConfigure = function () {
        this._syncEditButtonVisibility();
    };

    ReseArchNote.prototype._openEditor = function () {
        let modal = document.getElementById(_NOTE_MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id        = _NOTE_MODAL_ID;
            modal.className = 'modal fade';
            modal.tabIndex  = -1;
            modal.innerHTML = `
<div class="modal-dialog modal-fullscreen-md-down modal-lg">
  <div class="modal-content bg-dark text-light">
    <div class="modal-header py-2 border-0">
      <h6 class="modal-title mb-0">Note</h6>
      <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body p-2">
      <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
        <label for="${_NOTE_MODAL_ID}_fs" class="form-label mb-0 small">Text size</label>
        <input type="number" id="${_NOTE_MODAL_ID}_fs" class="form-control form-control-sm" style="width:80px" min="6" max="48" step="1">
        <label for="${_NOTE_MODAL_ID}_fmt" class="form-label mb-0 small ms-2">Format</label>
        <select id="${_NOTE_MODAL_ID}_fmt" class="form-select form-select-sm" style="width:auto">
          <option value="markdown">Markdown</option>
          <option value="text">Plain text</option>
        </select>
        <span class="small text-secondary ms-2"># heading · **bold** · *italic* · \`code\` · - list · | table |</span>
      </div>
      <div class="d-flex gap-2" style="min-height:320px">
        <textarea id="${_NOTE_MODAL_ID}_ta"
          class="form-control font-monospace border-0"
          style="flex:1 1 50%;height:340px;resize:vertical;font-size:13px;line-height:1.6;
                 background:#1e1e1e;color:#d4d4d4"
          placeholder="Write your notes…"></textarea>
        <div id="${_NOTE_MODAL_ID}_pv" style="flex:1 1 50%;height:340px;overflow:auto;background:#0369a1;border-radius:4px;padding:6px">
          <canvas id="${_NOTE_MODAL_ID}_cv" style="display:block"></canvas>
        </div>
      </div>
    </div>
    <div class="modal-footer py-2 border-0">
      <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
      <button type="button" class="btn btn-sm btn-primary" id="${_NOTE_MODAL_ID}_save">Save</button>
    </div>
  </div>
</div>`;
            document.body.appendChild(modal);
        }
        const ta = modal.querySelector(`#${_NOTE_MODAL_ID}_ta`);
        const fs = modal.querySelector(`#${_NOTE_MODAL_ID}_fs`);
        const fmt = modal.querySelector(`#${_NOTE_MODAL_ID}_fmt`);
        const pv = modal.querySelector(`#${_NOTE_MODAL_ID}_pv`);
        const cv = modal.querySelector(`#${_NOTE_MODAL_ID}_cv`);
        ta.value = this.properties.text || '';
        fs.value = this.properties.fontSize ?? 11;
        fmt.value = _NOTE_FORMATS.includes(this.properties.format) ? this.properties.format : 'markdown';
        // anteprima: stesso disegno del nodo, alla larghezza del nodo (o del riquadro, se più stretto)
        const preview = () => {
            const ctx = cv.getContext('2d');
            const w = Math.max(120, Math.min(this.size[0] - 12, pv.clientWidth - 12 || this.size[0] - 12));
            const size = parseInt(fs.value, 10) || 11;
            const lay = layoutMarkdown(ctx, ta.value, { width: w, fontSize: size, format: fmt.value });
            const dpr = window.devicePixelRatio || 1;
            cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(Math.max(20, lay.height) * dpr);
            cv.style.width = w + 'px'; cv.style.height = Math.max(20, lay.height) + 'px';
            const c2 = cv.getContext('2d');
            c2.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawLayout(c2, lay, 0, 0);
        };
        let pvTimer = null;
        const schedule = () => { clearTimeout(pvTimer); pvTimer = setTimeout(preview, 120); };
        ta.oninput = schedule; fs.oninput = schedule; fmt.onchange = schedule;
        modal.addEventListener('shown.bs.modal', preview, { once: true });
        const oldBtn = modal.querySelector(`#${_NOTE_MODAL_ID}_save`);
        const newBtn = oldBtn.cloneNode(true);
        oldBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', () => {
            this.properties.text = ta.value;
            const n = parseInt(fs.value, 10);
            this.properties.fontSize = Number.isFinite(n) ? Math.max(6, Math.min(48, n)) : 11;
            this.properties.format = fmt.value;
            this._layKey = '';
            this.setDirtyCanvas(true, false);
            bootstrap.Modal.getInstance(modal)?.hide();
        });
        (bootstrap.Modal.getInstance(modal) ?? new bootstrap.Modal(modal)).show();
        modal.addEventListener('shown.bs.modal', () => ta.focus(), { once: true });
    };

    ReseArchNote.prototype.getExtraMenuOptions = function (_graph, options) {
        options.push({
            content: this.properties.showEditButton ? '🔒 Hide edit button' : '🔓 Show edit button',
            callback: () => {
                this.properties.showEditButton = !this.properties.showEditButton;
                this._syncEditButtonVisibility();
            },
        });
        options.push({
            content: '✏️ Edit note…',
            callback: () => this._openEditor(),
        });
    };

    // Disegna il testo (multi-riga, wrap automatico, dimensione font
    // configurabile) direttamente sul corpo del nodo — nessuna anteprima nel
    // widget da duplicare, il bottone di modifica non mostra testo proprio.
    ReseArchNote.prototype._top = function () { return this.widgets?.length ? 30 : 8; };
    ReseArchNote.prototype._layout = function (ctx) {
        const width = this.size[0] - 12, fontSize = this.properties.fontSize || 11;
        const format = this.properties.format === 'text' ? 'text' : 'markdown';
        const text = this.properties.text || '';
        const key = `${width}|${fontSize}|${format}|${text.length}|${text}`;
        if (key !== this._layKey) { this._lay = layoutMarkdown(ctx, text, { width, fontSize, format }); this._layKey = key; }
        return this._lay;
    };
    ReseArchNote.prototype._maxScroll = function () {
        return Math.max(0, (this._lay?.height ?? 0) - (this.size[1] - this._top() - 4));
    };
    ReseArchNote.prototype.onDrawForeground = function (ctx) {
        if (this.flags?.collapsed) return;
        if (!this.properties.text) return;
        const lay = this._layout(ctx);
        const top = this._top();
        this._scrollY = Math.max(0, Math.min(this._scrollY, this._maxScroll()));
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top - 2, this.size[0], this.size[1] - top + 2);
        ctx.clip();
        drawLayout(ctx, lay, 6, top - this._scrollY);
        ctx.restore();
        // barra di scorrimento se il testo è più lungo del nodo
        const max = this._maxScroll();
        if (max > 0) {
            const trackH = this.size[1] - top - 4, thumbH = Math.max(14, trackH * trackH / lay.height);
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(this.size[0] - 5, top, 3, trackH);
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillRect(this.size[0] - 5, top + (trackH - thumbH) * (this._scrollY / max), 3, thumbH);
        }
    };
    ReseArchNote.prototype.onMouseWheel = function (e) {
        const max = this._maxScroll();
        if (max === 0) return false;               // testo che sta tutto: la rotella torna allo zoom del canvas
        const step = (this.properties.fontSize || 11) * 3;
        this._scrollY = Math.max(0, Math.min(this._scrollY + (e.deltaY > 0 ? step : -step), max));
        this.setDirtyCanvas(true, false);
        e.preventDefault?.();
        return true;
    };

    LG.registerNodeType('Debug/Note', ReseArchNote);

    // =========================================================================
    // Debug/PasteImage — incolla un'immagine dagli appunti di sistema e la
    // mostra sul corpo del nodo (utile per lasciare piccoli screenshot di
    // aiuto dentro il grafo, stesso spirito di Debug/Note ma per immagini —
    // non è una funzione Three.js, per questo vive qui e non sotto TJS).
    // Lettura tramite Async Clipboard API (navigator.clipboard.read()),
    // innescata da un bottone (non dall'evento nativo 'paste'): un click è
    // un user-gesture valido su ogni browser, mentre agganciare 'paste' a
    // livello documento sarebbe ambiguo con più nodi di questo tipo nel
    // grafo (quale nodo riceve l'incolla?) e richiederebbe gestire il focus.
    // Richiede contesto sicuro (HTTPS o localhost), stessa richiesta di ogni
    // altro uso di navigator.clipboard in questo file.
    // =========================================================================
    function DebugPasteImage() {
        this.addWidget('button', 'Paste from clipboard', null, () => this._pasteFromClipboard());
        this.addOutput('image', 'image');   // HTMLImageElement, compatibile con ctx.drawImage
        this.color     = '#0c4a6e';   // famiglia "UI (grafo o APP)" — stessa di Debug/Note, non Inspect
        this.bgcolor   = '#0369a1';
        this.size      = [260, 200];
        this._img      = null;
        this._imgUrl   = null;
        this._status   = 'No image — click the button to paste';
        this.resizable = true;
    }
    DebugPasteImage.title = 'Paste Image';
    DebugPasteImage.desc  = "Pastes an image from the system clipboard (screenshot, etc.) and shows it on the node";
    DebugPasteImage.portHelp = {
        outputs: { image: 'HTMLImageElement — the most recently pasted image, compatible with ctx.drawImage; null until an image has been pasted.' },
    };
    DebugPasteImage.prototype._pasteFromClipboard = async function () {
        if (!navigator.clipboard?.read) {
            this._status = 'Clipboard API not available (HTTPS or localhost required)';
            return;
        }
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const type = item.types.find(t => t.startsWith('image/'));
                if (!type) continue;
                const blob = await item.getType(type);
                const url  = URL.createObjectURL(blob);
                const img  = new Image();
                img.onload = () => {
                    if (this._imgUrl) URL.revokeObjectURL(this._imgUrl);
                    this._imgUrl = url;
                    this._img    = img;
                    this._status = `${img.naturalWidth}×${img.naturalHeight}`;
                };
                img.src = url;
                return;
            }
            this._status = 'No image found in the clipboard';
        } catch (e) {
            this._status = 'Clipboard read failed: ' + (e?.message || e);
            console.warn('[Debug/PasteImage] clipboard.read() failed:', e);
        }
    };
    DebugPasteImage.prototype.onExecute = function () {
        this.setOutputData(0, this._img ?? null);
    };
    DebugPasteImage.prototype.onDrawForeground = function (ctx) {
        if (this.flags?.collapsed) return;
        const pad = 4;
        const top = 30;   // sotto il widget "Paste from clipboard" (NODE_WIDGET_HEIGHT=20 + margine)
        const w = this.size[0] - pad * 2;
        const h = this.size[1] - top - pad;
        if (h <= 0) return;
        ctx.save();
        if (this._img) {
            const scale = Math.min(w / this._img.naturalWidth, h / this._img.naturalHeight, 1);
            const dw = this._img.naturalWidth  * scale;
            const dh = this._img.naturalHeight * scale;
            const dx = pad + (w - dw) / 2;
            const dy = top + (h - dh) / 2;
            ctx.drawImage(this._img, dx, dy, dw, dh);
        } else {
            ctx.font      = '10px sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText(this._status, pad + 2, top + 14);
        }
        ctx.restore();
    };
    DebugPasteImage.prototype.onRemoved = function () {
        if (this._imgUrl) URL.revokeObjectURL(this._imgUrl);
    };
    LG.registerNodeType('Debug/PasteImage', DebugPasteImage);

    // (ReseArch/Dashboard/App Emitter|Receiver rimossi il 2026-10-04: sostituiti da
    //  ReseArch/App Bus/Emitter|Receiver in app/AppBus-flow-nodes.mjs, che si
    //  collegano al bus da soli — nessun collegamento esterno nel runtime/editor.)


    // =========================================================================
    // ReseArch/Object/Model List — elenca mod_id/mod_name dell'oggetto del
    // pannello (2026-09-22). Sostituisce la categoria "ReseArch/Edit Objects"
    // (Field Extract/Set/Map), rimossa su richiesta esplicita perché
    // duplicava i nodi nativi Params/Object/Get Property, Params/Object/Set
    // Property e Params/Data/Json Data — vedi _doc/module-fle-manuale-utente.md.
    // Legge ctx.models (righe DB modelli, popolato da TJS-flow-runner.mjs e
    // dal ramo TJS di model_FLE.mjs::_injectTestContext per "Testa su
    // panel") — oggi disponibile solo nel contesto TJS. Pensato in
    // particolare per alimentare l'ingresso mod_id di TJS/Light/Save.
    // =========================================================================
    function ObjectModelList() {
        this.addOutput('mod_ids',   0);
        this.addOutput('mod_names', 0);
        this.addOutput('count',     'number');
        this.color   = '#78350f';
        this.bgcolor = '#92400e';
        this.size    = [210, 90];
    }
    ObjectModelList.title = 'Model List';
    ObjectModelList.desc  = "Lists the models (mod_id/mod_name) of the panel's current object";
    ObjectModelList.portHelp = {
        outputs: {
            mod_ids:   "array of numbers — mod_id of every model linked to the panel's object, same order as mod_names",
            mod_names: 'array of text — mod_name of every model, same order as mod_ids',
            count:     'number — how many models',
        },
    };
    ObjectModelList.prototype.onExecute = function () {
        const models = this.graph?._appContext?.models ?? [];
        this.setOutputData(0, models.map(m => m.mod_id));
        this.setOutputData(1, models.map(m => m.mod_name ?? `Model ${m.mod_id}`));
        this.setOutputData(2, models.length);
    };
    LG.registerNodeType('ReseArch/Object/Model List', ObjectModelList);


    // =========================================================================
    // ReseArch/Object/Open — apre un oggetto nel pannello del flow (2026-10-13)
    // ─────────────────────────────────────────────────────────────────────────
    // Pensato a valle di un App Bus Receiver: il pannello che chiede pubblica
    // l'obj_id su un topic, gli oggetti che si alternano nel pannello di
    // destinazione hanno lo stesso flow con il Receiver di quel topic. Si apre
    // sempre nel PROPRIO pannello (app/shared/panel-flow.mjs::openObjectInPanel):
    // il caricamento lo fa la piattaforma e chiude l'App corrente, flow compreso.
    // Per questo `done` parte PRIMA dell'apertura: dopo, questo grafo non c'è più.
    // Stesso oggetto già aperto (con gli stessi modelli) → nessuna azione: niente
    // cicli né riaperture da un messaggio "retain".
    // =========================================================================
    function ObjectOpen() {
        this.addProperty('obj_id', 0, 'number');
        this.addWidget('number', 'obj_id', 0, v => { this.properties.obj_id = Math.max(0, Math.round(v)); },
                       { property: 'obj_id', min: 0, step: 10, precision: 0 });
        this.addInput('trigger', LG.ACTION);
        this.addInput('obj_id',  'number');
        this.addInput('mod_ids', 'array');
        this.addOutput('done',   LG.EVENT);
        this.color   = '#78350f';
        this.bgcolor = '#92400e';
        this.size    = [210, 100];
    }
    ObjectOpen.title = 'Object Open';
    ObjectOpen.desc  = "Opens an object in this flow's panel, replacing the current one (and stopping this flow) — typically after an App Bus Receiver";
    ObjectOpen.portHelp = {
        inputs: {
            trigger: 'Pulse: opens the object. Nothing happens if the same object (with the same models) is already open, or if the flow has no panel (dashboard flows).',
            obj_id:  "number — obj_id of the object to open (see the Objects window); if connected it overrides the 'obj_id' widget.",
            mod_ids: 'array of numbers — optional: only these models of the object; empty or not connected = all the linked models.',
        },
        outputs: {
            done: 'Event: emitted BEFORE the opening, because opening replaces the panel content and stops this flow. Nodes after it run while the old object is still open.',
        },
    };
    ObjectOpen.prototype.onAction = function () {
        const raw   = this.getInputData(1);
        const objId = Number(raw ?? this.properties.obj_id);
        const mods  = this.getInputData(2);
        const panel = panelOfGraph(this.graph);
        this.triggerSlot(0);
        if (!panel || !(objId > 0)) return;
        // Non si aspetta: il grafo può essere fermato durante l'apertura
        openObjectInPanel(panel, objId, Array.isArray(mods) ? mods : null);
    };
    ObjectOpen.prototype.onDrawForeground = function (ctx) {
        const id = this.getInputData?.(1) ?? this.properties.obj_id;
        if (id) _drawSubtitle(ctx, this, `obj ${id}`);
    };
    LG.registerNodeType('ReseArch/Object/Open', ObjectOpen);


    // =========================================================================
    // ReseArch/Object/Index — trova un oggetto del WP per chiave (2026-10-17)
    // ─────────────────────────────────────────────────────────────────────────
    // Gli obj_id cambiano da un'installazione all'altra, il nome del file no.
    // Mappa { chiave: obj_id } degli oggetti visibili del WP con obj_type_A =
    // type_A (default "Help"); chiave = nome del file del primo modello senza
    // cartella, estensione e suffisso di lingua (Help/help-ui-TJS.en.html →
    // help-ui-TJS). Server: ui/modal_tree_obj_tools.php?action=index_by_type.
    // `trigger` (ri)legge la mappa (es. da Flow/Events/OnStart); `find` cerca
    // `key`, leggendo prima la mappa se non c'è ancora. Uso tipico: On Event
    // (attr data-help) → find → found → App Bus Emitter "Help" con obj_id.
    // =========================================================================
    function _indexKey(filename) {
        return String(filename ?? '').split('/').pop()
            .replace(/\.[^.]+$/, '')                     // estensione
            .replace(/\.[a-z]{2}(-[A-Za-z]{2})?$/, '');  // suffisso di lingua (.en, .pt-BR)
    }
    function ObjectIndex() {
        this.addProperty('type_A', 'Help', 'string');
        this.addWidget('text', 'type_A', 'Help', v => { this.properties.type_A = String(v ?? '').trim(); this._map = null; },
                       { property: 'type_A' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('find',    LG.ACTION);
        this.addInput('key',     'string');
        this.addOutput('done',      LG.EVENT);
        this.addOutput('found',     LG.EVENT);
        this.addOutput('not_found', LG.EVENT);
        this.addOutput('error',     LG.EVENT);
        this.addOutput('obj_id',    'number');
        this.addOutput('count',     'number');
        this._map = null;        // Map chiave → obj_id
        this._loading = null;    // Promise della lettura in corso
        this.color   = '#78350f';
        this.bgcolor = '#92400e';
        this.size    = [210, 150];
    }
    ObjectIndex.title = 'Object Index';
    ObjectIndex.desc  = 'Finds an object of the work package by a stable key (the file name of its model) instead of its obj_id, which changes from one installation to another';
    ObjectIndex.portHelp = {
        inputs: {
            trigger: 'Pulse: reads (again) the objects with obj_type_A = type_A, e.g. from Flow/Events/OnStart. Optional: find reads them by itself the first time.',
            find:    'Pulse: looks up key; then found (obj_id written) or not_found.',
            key:     'text — the key to look up: file name of the first model of the object, without folder, extension and language suffix (Help/help-ui-TJS.en.html → help-ui-TJS). Usually the value output of HTM/DOM/On Event with attr = data-help.',
        },
        outputs: {
            done:      'Event: objects read (count written).',
            found:     'Event: key found, obj_id written.',
            not_found: 'Event: no visible object with that key (obj_id = 0).',
            error:     'Event: the objects could not be read (see the browser console).',
            obj_id:    'number — obj_id of the object found, 0 if not found',
            count:     'number — how many objects the index contains',
        },
        properties: {
            type_A: 'obj_type_A of the objects to index (default Help; the administrator may use another word, e.g. Aiuto)',
        },
    };
    ObjectIndex.prototype._load = function () {
        if (this._loading) return this._loading;
        const typeA = this.properties.type_A || 'Help';
        this._loading = (async () => {
            const res = await fetch(`ui/modal_tree_obj_tools.php?action=index_by_type&type_a=${encodeURIComponent(typeA)}`,
                                    { credentials: 'same-origin' });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
            const map = new Map();
            for (const r of data.data ?? []) {
                const k = _indexKey(r.mod_filename);
                if (!k) continue;
                if (map.has(k)) { console.warn(`[Object Index] key "${k}" used by obj ${map.get(k)} and ${r.obj_id}: keeping the first`); continue; }
                map.set(k, Number(r.obj_id));
            }
            this._map = map;
            this.setOutputData(5, map.size);
            return map;
        })();
        this._loading.finally(() => { this._loading = null; }).catch(() => {});
        return this._loading;
    };
    ObjectIndex.prototype.onAction = async function (action) {
        try {
            if (action === 'find') {
                const map = this._map ?? await this._load();
                const id  = map.get(String(this.getInputData(2) ?? '').trim()) ?? 0;
                this.setOutputData(4, id);
                this.triggerSlot(id ? 1 : 2);
            } else {
                this._map = null;
                await this._load();
                this.triggerSlot(0);
            }
        } catch (err) {
            console.warn('[Object Index]', err);
            this.triggerSlot(3);
        }
    };
    ObjectIndex.prototype.onDrawForeground = function (ctx) {
        if (this._map) _drawSubtitle(ctx, this, `${this._map.size} objects`);
    };
    LG.registerNodeType('ReseArch/Object/Index', ObjectIndex);


    // =========================================================================
    // ReseArch/Dashboard/Open — carica una configurazione della dashboard (2026-10-17)
    // ─────────────────────────────────────────────────────────────────────────
    // Come "Applica" della modale configurazioni, senza conferma: usa
    // app/dashboard_cfg.mjs::restoreConfig (importato al trigger, così FLE non
    // dipende dalla dashboard al caricamento). Il caricamento ricostruisce tutti
    // i pannelli e ferma i flow della Config precedente, compreso quello di questo
    // nodo: `done` parte PRIMA. Config già caricata → nessuna azione (retain, cicli).
    // Visibilità e WP li controlla il server (action=load, dc_visible).
    // Per nome (2026-10-17): il nome è lo stesso in ogni installazione, l'id no.
    // Se c'è un nome (ingresso o widget) vince sull'id: si cerca nell'elenco
    // (action=list, già filtrato per visibilità), confronto senza maiuscole/spazi ai bordi.
    // =========================================================================
    function DashboardOpen() {
        this.addProperty('dshp_id', 0, 'number');
        this.addProperty('name', '', 'string');
        this.addWidget('number', 'dshp_id', 0, v => { this.properties.dshp_id = Math.max(0, Math.round(v)); },
                       { property: 'dshp_id', min: 0, step: 10, precision: 0 });
        this.addWidget('text', 'name', '', v => { this.properties.name = String(v ?? ''); }, { property: 'name' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('dshp_id', 'number');
        this.addInput('name',    'string');
        this.addOutput('done',      LG.EVENT);
        this.addOutput('not_found', LG.EVENT);
        this._busy = false;
        this.color   = '#78350f';
        this.bgcolor = '#92400e';
        this.size    = [230, 104];
    }
    DashboardOpen.title = 'Dashboard Open';
    DashboardOpen.desc  = 'Loads a dashboard configuration, by id or by name, replacing all the panels (and stopping this flow)';
    DashboardOpen.portHelp = {
        inputs: {
            trigger: 'Pulse: loads the configuration. Nothing happens if it is already the loaded one. Only configurations of the current work package that the user can see are loaded (checked by the server).',
            dshp_id: "number — id of the configuration (see Dashboard Config List or the configurations window); if connected it overrides the 'dshp_id' widget. Used only when there is no name.",
            name:    "text — name of the configuration (case and surrounding spaces ignored); if connected it overrides the 'name' widget. A name wins over the id: names stay the same in every installation, ids do not.",
        },
        outputs: {
            done:      'Event: emitted BEFORE loading, because loading rebuilds every panel and stops the running flows, this one included.',
            not_found: 'Event: no visible configuration with that name, or no id/name given (see the browser console).',
        },
    };
    DashboardOpen.prototype._name = function () {
        const v = this.getInputData(2);
        return String(v ?? this.properties.name ?? '').trim();
    };
    DashboardOpen.prototype.onAction = async function () {
        if (this._busy) return;
        const name = this._name();
        let dshpId = 0;
        if (name) {
            this._busy = true;
            try {
                const res  = await fetch('api/wp_dashboard_cfg_tool.php?action=list', { credentials: 'same-origin' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (!json.ok) throw new Error(json.error || 'list failed');
                const key = name.toLowerCase();
                const row = (json.data ?? []).find(r => String(r.dshp_name ?? '').trim().toLowerCase() === key);
                dshpId = Number(row?.dshp_id ?? 0);
                if (!(dshpId > 0)) console.warn(`[Dashboard Open] configuration not found: "${name}"`);
            } catch (err) {
                console.warn('[Dashboard Open]', err);
            } finally {
                this._busy = false;
            }
        } else {
            dshpId = Number(this.getInputData(1) ?? this.properties.dshp_id);
        }
        if (!(dshpId > 0)) { this.triggerSlot(1); return; }
        this.triggerSlot(0);
        // Non si aspetta: il grafo viene fermato durante il caricamento
        import('../dashboard_cfg.mjs').then(m => {
            if (m.getCurrentDshp()?.dshpId === dshpId) return;
            m.restoreConfig(dshpId);
        }).catch(err => console.warn('[Dashboard Open]', err));
    };
    DashboardOpen.prototype.onDrawForeground = function (ctx) {
        const name = this.getInputData?.(2) ?? this.properties.name;
        const id   = this.getInputData?.(1) ?? this.properties.dshp_id;
        if (name) _drawSubtitle(ctx, this, String(name));
        else if (id) _drawSubtitle(ctx, this, `config ${id}`);
    };
    LG.registerNodeType('ReseArch/Dashboard/Open', DashboardOpen);


    // =========================================================================
    // ReseArch/Dashboard/Config List — configurazioni visibili del WP (2026-10-17)
    // ─────────────────────────────────────────────────────────────────────────
    // A evento (nel pannello HTM non c'è un ciclo continuo): al trigger chiede
    // l'elenco al server (action=list, già filtrato per visibilità) e scrive le
    // uscite prima di `done`. Ordine: per nome. `current` = Config caricata (0 = nessuna).
    // =========================================================================
    function DashboardConfigList() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',     LG.EVENT);
        this.addOutput('error',    LG.EVENT);
        this.addOutput('options',  'array');
        this.addOutput('dshp_ids', 'array');
        this.addOutput('names',    'array');
        this.addOutput('count',    'number');
        this.addOutput('current',  'number');
        this._busy = false;
        this.color   = '#78350f';
        this.bgcolor = '#92400e';
        this.size    = [210, 160];
    }
    DashboardConfigList.title = 'Dashboard Config List';
    DashboardConfigList.desc  = 'Lists the dashboard configurations of the work package that the user can see';
    DashboardConfigList.portHelp = {
        inputs: {
            trigger: 'Pulse: asks the server for the list.',
        },
        outputs: {
            done:     'Event: the list has arrived (outputs already written).',
            error:    'Event: the list could not be read (see the browser console).',
            options:  'array of objects { value, label } — value = dshp_id, label = name: ready for HTM/DOM/Set Options',
            dshp_ids: 'array of numbers — id of every configuration, sorted by name, same order as names',
            names:    'array of text — name of every configuration, same order as dshp_ids',
            count:    'number — how many configurations',
            current:  'number — id of the configuration loaded now, 0 if none',
        },
    };
    DashboardConfigList.prototype.onAction = async function () {
        if (this._busy) return;
        this._busy = true;
        try {
            const res  = await fetch('api/wp_dashboard_cfg_tool.php?action=list', { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || 'list failed');
            const rows = (json.data ?? []).slice()
                .sort((a, b) => String(a.dshp_name ?? '').localeCompare(String(b.dshp_name ?? ''), undefined, { numeric: true }));
            let current = 0;
            try { current = (await import('../dashboard_cfg.mjs')).getCurrentDshp()?.dshpId ?? 0; } catch (_) { /* fuori dashboard */ }
            this.setOutputData(2, rows.map(r => ({ value: String(r.dshp_id), label: r.dshp_name ?? '' })));
            this.setOutputData(3, rows.map(r => Number(r.dshp_id)));
            this.setOutputData(4, rows.map(r => r.dshp_name ?? ''));
            this.setOutputData(5, rows.length);
            this.setOutputData(6, current);
            this.triggerSlot(0);
        } catch (err) {
            console.warn('[Dashboard Config List]', err);
            this.triggerSlot(1);
        } finally {
            this._busy = false;
        }
    };
    LG.registerNodeType('ReseArch/Dashboard/Config List', DashboardConfigList);


    // =========================================================================
    // Sets/Filter/Gate  — lascia passare solo se la condizione è vera
    // =========================================================================
    const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like'];

    // A evento dal 2026-10-04 (prima "a dato", con pass/block come dati e senza
    // eventi): così sta fra un App Bus Receiver e un Emitter, che lavorano al
    // trigger. Famiglia di colore Instradamento (guide-fle-regole-nodi.md §10).
    function FilterGate() {
        this.addProperty('field', '',   'string');
        this.addProperty('op',   'eq', 'string');
        this.addProperty('value', '',   'string');
        this.addWidget('text',  'field', '', v => { this.properties.field = v; }, { property: 'field' });
        this.addWidget('combo', 'op', 'eq', v => { this.properties.op = v; }, { values: OPS, property: 'op' });
        this.addWidget('text',  'value', '', v => { this.properties.value = v; }, { property: 'value' });
        this.addInput('trigger',  LG.ACTION);
        this.addInput('payload',  'object');
        this.addOutput('pass',    LG.EVENT);
        this.addOutput('block',   LG.EVENT);
        this.addOutput('payload', 'object');
        this.color   = '#1f2937';
        this.bgcolor = '#374151';
        this.size    = [210, 120];
    }
    FilterGate.title = 'Filter / Gate';
    FilterGate.desc  = 'On trigger, evaluates a condition on the payload and emits pass (true) or block (false)';
    FilterGate.portHelp = {
        inputs: {
            trigger: "event — evaluates the condition on the incoming payload",
            payload: "object to evaluate — the condition compares payload[field] with the 'value' widget, according to the chosen operator (eq/neq/gt/gte/lt/lte/like). Loose comparison (\"5\" == 5); numeric 'value' → numeric comparison; 'like' = substring, case-sensitive",
        },
        outputs: {
            pass:    "event — emitted if the condition is true",
            block:   "event — emitted if the condition is false",
            payload: "the payload received, unchanged — written before the pass/block event",
        },
    };
    FilterGate.prototype.onAction = function () {
        const payload = this.getInputData(this.findInputSlot('payload'));
        const { field, op, value } = this.properties;
        const actual = payload != null ? payload[field] : undefined;
        const cmp    = (!isNaN(value) && value !== '') ? Number(value) : value;
        let pass = false;
        switch (op) {
            case 'eq':   pass = actual ==  cmp; break;
            case 'neq':  pass = actual !=  cmp; break;
            case 'gt':   pass = actual >   cmp; break;
            case 'gte':  pass = actual >=  cmp; break;
            case 'lt':   pass = actual <   cmp; break;
            case 'lte':  pass = actual <=  cmp; break;
            case 'like': pass = String(actual ?? '').includes(String(cmp)); break;
            default:     pass = Boolean(actual);
        }
        // prima i dati, poi l'evento
        this.setOutputData(this.findOutputSlot('payload'), payload);
        this.triggerSlot(this.findOutputSlot(pass ? 'pass' : 'block'));
    };
    LG.registerNodeType('ReseArch/Filter/Gate', FilterGate);


    // =========================================================================
    // Maths/Operators/Formula  — applica espressione numerica (variabile: x)
    // =========================================================================
    function Formula() {
        this.addProperty('expr', 'x', 'string');
        this.addWidget('text', 'expr (x=input)', 'x', v => { this.properties.expr = v; }, { property: 'expr' });
        this.addInput('x',       'number');
        this.addOutput('result', 'number');
        this.color   = '#78350f';
        this.bgcolor = '#92400e';
        this.size    = [200, 70];
    }
    Formula.title = 'Formula';
    Formula.desc  = 'Applies a numeric expression. Variable: x';
    Formula.portHelp = {
        inputs: { x: "Number used as the variable 'x' in the widget expression (default 0 if not connected)." },
        outputs: { result: "The result of evaluating the widget expression, with x replaced by the input value — NaN if the expression contains a syntax error." },
    };
    // Cache della funzione compilata (2026-09-28): prima new Function veniva
    // chiamato ad ogni onExecute, cioè ad ogni ciclo del grafo. Ora si
    // ricompila solo quando cambia 'expr'; anche l'errore di sintassi è in
    // cache (_fn = null), così un'espressione rotta non ritenta ogni frame.
    Formula.prototype._getFn = function () {
        const expr = this.properties.expr;
        if (this._fnExpr !== expr) {
            this._fnExpr = expr;
            try {
                // eslint-disable-next-line no-new-func
                this._fn = new Function('x', `"use strict"; return (${expr});`);
            } catch (_) { this._fn = null; }
        }
        return this._fn;
    };
    Formula.prototype.onExecute = function () {
        const x = this.getInputData(0) ?? 0;
        const fn = this._getFn();
        let result = NaN;
        if (fn) {
            try { result = fn(x); } catch (_) { result = NaN; }
        }
        this.setOutputData(0, result);
    };
    LG.registerNodeType('ReseArch/Expression/Formula', Formula);


    // =========================================================================
    // Maths/Time/Debounce  — raggruppa eventi ravvicinati, emette l'ultimo
    // =========================================================================
    function Debounce() {
        this.addProperty('delay_ms', 300, 'number');
        this.addWidget('number', 'delay ms', 300, v => { this.properties.delay_ms = v; }, { property: 'delay_ms' });
        this.addInput('payload',  0);
        this.addOutput('payload', 0);
        this.color   = '#78350f';
        this.bgcolor = '#92400e';
        this.size    = [190, 70];
        this._timer  = null;
        this._last   = null;
    }
    Debounce.title = 'Debounce';
    Debounce.desc  = 'Delays the emission and discards intermediate events';
    Debounce.portHelp = {
        inputs: { payload: "Value to propagate (any type) — every new value received RESETS the waiting timer ('delay_ms' property), discarding the intermediate ones." },
        outputs: { payload: "The LAST value received, emitted only 'delay_ms' milliseconds after values stopped arriving (it also forces a new graph round via graph.runStep(), being asynchronous with respect to the normal execution cycle)." },
    };
    Debounce.prototype.onExecute = function () {
        const input = this.getInputData(0);
        if (input === undefined) return;
        this._last = input;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => {
            this.setOutputData(0, this._last);
            this.graph?.runStep?.();
        }, Math.max(0, this.properties.delay_ms));
    };
    LG.registerNodeType('ReseArch/Tools/Debounce', Debounce);


    // =========================================================================
    // ReseArch/Network/In sviluppo — segnaposto (2026-09-28)
    // =========================================================================
    // LiteGraph mostra una cartella di menu solo se contiene almeno un nodo
    // registrato: questo nodo inerte tiene viva la voce 'ReseArch/Network'
    // finché non arrivano i nodi di rete specializzati per la piattaforma
    // (che sostituiranno i nativi network/httprequest|websocket, rimossi).
    // Da eliminare quando esisterà il primo nodo vero in questa cartella.
    function NetworkPlaceholder() {
        this.color   = '#333';
        this.bgcolor = '#444';
        this.size    = [220, 30];
    }
    NetworkPlaceholder.title = 'In development';
    NetworkPlaceholder.desc  = "Placeholder, does nothing. The network nodes specialized for the platform (communication with other servers) will go here. The native HTTP Request and WebSocket nodes were removed for security: they could send data to arbitrary servers.";
    NetworkPlaceholder.prototype.onExecute = function () {};
    LG.registerNodeType('ReseArch/Network/In sviluppo', NetworkPlaceholder);


    // =========================================================================
    // Debug/Inspect  — mostra JSON del payload direttamente sul nodo
    // (spostato da Display/Preview/Inspect nel gruppo Debug, 2026-09-20 —
    // insieme ad Alert/Console/Plot/Progress/Watch, tutti nodi di sola
    // ispezione/diagnostica del grafo)
    // =========================================================================

    // Fallback copia testo per contesti senza Clipboard API (HTTP non sicuro, ecc.)
    function _insFallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
    }

    const _INS_LH    = 14;  // line height px
    const _INS_PAD   = 6;   // padding top/bottom
    const _INS_SBW   = 8;   // larghezza VISIVA della scrollbar
    // FIX (2026-09-21, segnalato dall'utente): _INS_SBW da solo era anche la
    // zona CLICCABILE/trascinabile — 8px è troppo stretto da centrare col
    // mouse, soprattutto con testo lungo e thumb piccolo: il click mancava
    // il bersaglio e finiva sul nodo sottostante (drag nodo invece di
    // scroll). _INS_SBHIT è la zona di hit-test, più larga della barra
    // disegnata (che resta 8px, look invariato) — pattern standard "hit
    // target più grande del visivo".
    const _INS_SBHIT = 18;
    const _INS_TOP   = 4;   // margine extra oltre alla riga di pin (vedi _insTopClear)
    const _INS_HDR   = 14;  // altezza riga header di Inspect (tipo/dimensione del dato) — assente in InspectMulti

    // FIX (2026-09-21, segnalato dall'utente): il contenuto disegnato da
    // onDrawForeground partiva da un offset FISSO dal top del corpo,
    // indipendente da quante righe di pin (input/output) LiteGraph disegna
    // realmente lì — con un solo input va quasi sempre bene, ma su
    // InspectMulti (N input dinamici) il testo finiva SOPRA i pin degli
    // slot successivi al primo, sovrapponendosi a cerchietti ed etichette.
    // Clearance dinamica: numero di righe pin (il massimo fra input e
    // output, disegnati su due colonne indipendenti alla stessa altezza di
    // riga) moltiplicato per l'altezza riga nativa di LiteGraph.
    function _insPinRows(node) {
        return Math.max(node.inputs?.length || 0, node.outputs?.length || 0);
    }
    function _insTopClear(node) {
        const slotH = window.LiteGraph?.NODE_SLOT_HEIGHT || 20;
        return _insPinRows(node) * slotH + _INS_TOP;
    }

    // Numero di righe JSON visibili nell'area sotto l'header, dato l'altezza nodo.
    function _insVisLines(node) {
        return Math.max(1, Math.floor((node.size[1] - _INS_PAD - _insTopClear(node) - _INS_HDR) / _INS_LH));
    }

    // Tipo "elementare" di un elemento d'array, per il riepilogo "array(n) di X".
    function _insElType(x) {
        if (x === null) return 'null';
        if (Array.isArray(x)) return 'array';
        if (typeof x === 'number') return Number.isInteger(x) ? 'integer' : 'number';
        return typeof x;
    }

    // Descrive il valore ricevuto: tipo, dimensione (lunghezza array/stringa,
    // n. campi oggetto al primo livello, n. elementi Map/Set), tipo omogeneo
    // degli elementi per gli array, elenco chiavi per gli oggetti.
    function _insDescribe(v) {
        if (v === null)      return { type: 'null' };
        if (v === undefined) return { type: 'undefined' };
        const t = typeof v;
        if (t === 'boolean') return { type: 'boolean' };
        if (t === 'number')  return { type: Number.isInteger(v) ? 'integer' : 'number' };
        if (t === 'string')  return { type: 'string', size: v.length };
        if (t === 'function')return { type: 'function' };
        if (Array.isArray(v)) {
            const elType = v.length ? _insElType(v[0]) : null;
            const uniform = elType !== null && v.every(x => _insElType(x) === elType);
            return { type: 'array', size: v.length, of: v.length ? (uniform ? elType : 'mixed') : null };
        }
        if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return { type: v.constructor.name, size: v.length };
        if (v instanceof Date) return { type: 'Date' };
        if (v instanceof Map)  return { type: 'Map', size: v.size };
        if (v instanceof Set)  return { type: 'Set', size: v.size };
        if (t === 'object') {
            const keys = Object.keys(v);
            return { type: (v.constructor?.name && v.constructor.name !== 'Object') ? v.constructor.name : 'object', size: keys.length, keys };
        }
        return { type: t };
    }

    function _insFormatMeta(d) {
        let s = d.type;
        if (d.size !== undefined && d.size !== null) s += `(${d.size})`;
        if (d.of) s += ` of ${d.of}`;
        if (d.keys?.length) s += ': ' + d.keys.slice(0, 6).join(', ') + (d.keys.length > 6 ? '…' : '');
        return s;
    }

    function Inspect() {
        this.addInput('value', 0);
        this.color     = '#1a1a2e';
        this.bgcolor   = '#16213e';
        this.size      = [280, 180];
        this._json     = '—';
        this._lines    = ['—'];
        this._meta     = '';
        this._scrollY  = 0;
        this.resizable = true;
    }
    Inspect.title = 'Inspect';
    Inspect.desc  = 'Shows the content of the value as JSON, with type and size highlighted (resizable, scroll with mouse wheel)';
    Inspect.portHelp = {
        inputs: { value: "Any value to inspect — shown on the node body as pretty-printed JSON, with a header summarizing type/size (e.g. 'array(12) of number', 'object(3): a, b, c'). No output: it is a display-only node." },
    };
    Inspect.prototype.onExecute = function () {
        const v = this.getInputData(0);
        if (v === undefined || v === null) {
            // Mantiene l'ultimo valore mostrato invece di azzerarlo: runStep()
            // rilancia onExecute su OGNI nodo ad ogni step (vedi §7 in
            // module-fle-architettura.md), quindi un Inspect collegato
            // all'Emitter A riceve null anche quando è l'Emitter B, altrove nel
            // grafo, ad aver innescato lo step — null qui significa "niente di
            // nuovo per questo collegamento in questo step", non "valore vuoto".
            return;
        }

        this._meta = _insFormatMeta(_insDescribe(v));

        // TypedArray (Float32Array, ecc.) → JSON.stringify emette {"0":x,"1":y,...}
        // Convertiamo in array regolare per una visualizzazione corretta.
        let val = v;
        if (ArrayBuffer.isView(val) && !(val instanceof DataView)) val = Array.from(val);
        try { this._json = JSON.stringify(val, null, 2); }
        catch (_) { this._json = String(v); }
        // Nasconde il label 'value' per non sovrapporsi al contenuto
        this.inputs[0].label = '';

        this._lines = this._json.split('\n');
        // Clamp scroll se le righe diminuiscono
        const vis     = _insVisLines(this);
        this._scrollY = Math.max(0, Math.min(this._scrollY, Math.max(0, this._lines.length - vis)));
    };
    Inspect.prototype.onDrawForeground = function (ctx) {
        if (!this._lines?.length) return;
        const lines  = this._lines;
        const totalH = this.size[1];
        const totalW = this.size[0];
        const vis    = _insVisLines(this);
        const needSB = lines.length > vis;
        const topClear = _insTopClear(this);
        const _X     = 8;   // margine sinistro — la separazione verticale (topClear) basta a evitare il pin, qui serve solo respiro dal bordo
        const textW  = totalW - (needSB ? _INS_SBW + 6 : 0) - _X - 6;

        ctx.save();

        // Header: tipo/dimensione del dato ricevuto, sempre visibile (non scrolla)
        if (this._meta) {
            ctx.font      = 'bold 10px monospace';
            ctx.fillStyle = 'rgba(255,200,120,0.9)';
            const metaW = ctx.measureText(this._meta).width;
            const metaTxt = metaW > textW
                ? this._meta.slice(0, Math.floor(this._meta.length * textW / metaW) - 1) + '…'
                : this._meta;
            ctx.fillText(metaTxt, _X, topClear + _INS_LH - 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.moveTo(_X - 4, topClear + _INS_HDR - 1);
            ctx.lineTo(totalW - 6, topClear + _INS_HDR - 1);
            ctx.stroke();
        }

        ctx.font      = '10px monospace';
        ctx.fillStyle = 'rgba(180,255,180,0.85)';

        let y = _INS_LH + topClear + _INS_HDR;
        for (let i = this._scrollY; i < lines.length && y <= totalH - 4; i++) {
            const line  = lines[i];
            const lineW = ctx.measureText(line).width;
            ctx.fillText(
                lineW > textW ? line.slice(0, Math.floor(line.length * textW / lineW) - 1) + '…' : line,
                _X, y
            );
            y += _INS_LH;
        }

        // Scrollbar verticale (solo sull'area JSON, sotto l'header)
        if (needSB) {
            const sbX    = totalW - _INS_SBW - 2;
            const sbTop  = topClear + _INS_HDR;
            const sbH    = totalH - sbTop - 4;
            const thumbH = Math.max(18, sbH * vis / lines.length);
            const thumbY = sbTop + (sbH - thumbH) * (this._scrollY / Math.max(1, lines.length - vis));
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(sbX, sbTop, _INS_SBW, sbH);
            ctx.fillStyle = 'rgba(180,255,180,0.5)';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(sbX, thumbY, _INS_SBW, thumbH, 2);
            else               ctx.rect(sbX, thumbY, _INS_SBW, thumbH);
            ctx.fill();
        }

        ctx.restore();
    };
    Inspect.prototype.onMouseWheel = function (e) {
        const vis       = _insVisLines(this);
        const maxScroll = Math.max(0, this._lines.length - vis);
        if (maxScroll === 0) return false;   // niente da scorrere: lascia passare lo zoom del canvas
        const delta   = e.deltaY > 0 ? 1 : -1;
        this._scrollY = Math.max(0, Math.min(this._scrollY + delta, maxScroll));
        e.preventDefault?.();
        e.stopPropagation?.();
        return true;
    };
    // Intercetta click/drag sulla scrollbar: restituisce true → LiteGraph non trascina il nodo.
    Inspect.prototype.onMouseDown = function (e, pos) {
        const TH    = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
        const drawY = pos[1] - TH;   // coordinata Y nel draw-context (0 = top del body)
        if (drawY < 0) return false;  // click sulla title bar → drag nodo normale
        const vis       = _insVisLines(this);
        const maxScroll = Math.max(0, this._lines.length - vis);
        if (maxScroll === 0) return false;  // niente da scorrere: lascia fare il drag del nodo
        const sbHitX = this.size[0] - _INS_SBHIT;   // zona cliccabile, più larga della barra visiva (_INS_SBW)
        if (pos[0] < sbHitX) return false;  // click nel testo → drag nodo normale
        const topClear = _insTopClear(this);
        const sbTop  = topClear + _INS_HDR;
        const sbH    = this.size[1] - sbTop - 4;
        const thumbH = Math.max(18, sbH * vis / this._lines.length);
        const thumbY = sbTop + (sbH - thumbH) * (this._scrollY / maxScroll);
        if (drawY >= thumbY && drawY <= thumbY + thumbH) {
            // Click sul thumb → drag mode
            this._sbDrag    = true;
            this._sbDragY0  = pos[1];
            this._sbDragSY  = this._scrollY;
        } else {
            // Click sul track → salta alla posizione
            const rel = Math.max(0, drawY - sbTop - thumbH / 2);
            this._scrollY = Math.max(0, Math.min(Math.round(rel / Math.max(1, sbH - thumbH) * maxScroll), maxScroll));
        }
        e.stopPropagation?.();
        return true;  // consuma l'evento: nessun drag del nodo
    };
    Inspect.prototype.onMouseMove = function (e, pos) {
        if (!this._sbDrag) return;
        const vis       = _insVisLines(this);
        const maxScroll = Math.max(0, this._lines.length - vis);
        if (maxScroll === 0) return;
        const sbH    = this.size[1] - (_insTopClear(this) + _INS_HDR) - 4;
        const thumbH = Math.max(18, sbH * vis / this._lines.length);
        const trackH = Math.max(1, sbH - thumbH);
        const dy     = pos[1] - this._sbDragY0;
        this._scrollY = Math.max(0, Math.min(Math.round(this._sbDragSY + dy / trackH * maxScroll), maxScroll));
    };
    Inspect.prototype.onMouseUp = function () {
        this._sbDrag = false;
    };
    Inspect.prototype.getExtraMenuOptions = function (_graph, options) {
        const self = this;
        options.push({
            content: '📋 Copy content',
            callback: () => {
                const body = self._json ?? self._lines?.join('\n') ?? '';
                const text = self._meta ? `// ${self._meta}\n${body}` : body;
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text).catch(() => _insFallbackCopy(text));
                } else {
                    _insFallbackCopy(text);
                }
            },
        });
    };
    LG.registerNodeType('Debug/Inspect', Inspect);


    // =========================================================================
    // Debug/InspectMulti — come Inspect, ma con N input concatenati in un
    // unico report testuale (uno slot per valore, 1 di base — tasto destro
    // per aggiungere/rimuovere, stesso pattern di Params/Array/Maker). Ogni
    // blocco è preceduto da "In: <nome del pin di uscita del nodo collegato
    // a monte>" — il nome del pin all'ORIGINE del link, non quello dello
    // slot di QUESTO nodo — seguito dal valore in JSON pretty-print e una
    // riga vuota di separazione dal blocco successivo.
    // =========================================================================

    // Come _insVisLines di Inspect, ma senza la riga header (InspectMulti non
    // ne ha) — riusa lo stesso _insTopClear condiviso (dinamico sul numero
    // di pin, non fisso: qui gli input crescono da 1 a N).
    function _insmVisLines(node) {
        return Math.max(1, Math.floor((node.size[1] - _INS_PAD - _insTopClear(node)) / _INS_LH));
    }

    // Nome del pin di uscita collegato allo slot 'slot' di 'node' — risale il
    // link fino al nodo origine. Fallback sul nome dello slot locale se lo
    // slot non risulta collegato (non dovrebbe capitare: onExecute salta i
    // non collegati, resta solo come rete di sicurezza).
    function _insmSourceLabel(node, slot) {
        const link = node.getInputLink ? node.getInputLink(slot) : null;
        if (!link) return node.inputs[slot]?.name || `in${slot}`;
        const originNode = node.graph?.getNodeById(link.origin_id);
        const originSlot = originNode?.outputs?.[link.origin_slot];
        return originSlot?.name || node.inputs[slot]?.name || `in${slot}`;
    }

    function _insmFormatValue(v) {
        let val = v;
        if (ArrayBuffer.isView(val) && !(val instanceof DataView)) val = Array.from(val);
        try { return JSON.stringify(val, null, 2); }
        catch (_) { return String(v); }
    }

    function InspectMulti() {
        this.addInput('in0', 0);
        this.addOutput('text', 'string');
        this.color     = '#1a1a2e';
        this.bgcolor   = '#16213e';
        this.size      = [300, 200];
        this._lines    = ['—'];
        this._scrollY  = 0;
        this.resizable = true;
    }
    InspectMulti.title = 'Inspect Multi';
    InspectMulti.desc  = 'Like Inspect but with N inputs, concatenated into a single text report — right click to add/remove slots';
    InspectMulti.portHelp = {
        inputs:  { "*": "One slot for every value to inspect (1 by default — add/remove with right click on the node). In the report every value is preceded by \"In: <name of the output pin of the connected node>\" — the name of the UPSTREAM pin, not of this slot." },
        outputs: { text: "Concatenated text report of all the connected slots (the same shown on the node body), ready to be saved/logged elsewhere." },
    };
    InspectMulti.prototype.onExecute = function () {
        const blocks = [];
        for (let i = 0; i < this.inputs.length; i++) {
            const v = this.getInputData(i);
            if (v === undefined || v === null) continue;   // slot non collegato o niente di nuovo in questo step (stesso motivo di Inspect)
            blocks.push(`In: ${_insmSourceLabel(this, i)}\n${_insmFormatValue(v)}\n`);
        }
        if (!blocks.length) return;   // mantiene l'ultimo report invece di azzerarlo
        const text = blocks.join('\n');
        this._lines   = text.split('\n');
        const vis     = _insmVisLines(this);
        this._scrollY = Math.max(0, Math.min(this._scrollY, Math.max(0, this._lines.length - vis)));
        this.setOutputData(0, text);
    };
    InspectMulti.prototype.onDrawForeground = function (ctx) {
        if (!this._lines?.length) return;
        const lines  = this._lines;
        const totalH = this.size[1];
        const totalW = this.size[0];
        const vis    = _insmVisLines(this);
        const needSB = lines.length > vis;
        const topClear = _insTopClear(this);
        const _X     = 8;
        const textW  = totalW - (needSB ? _INS_SBW + 6 : 0) - _X - 6;

        ctx.save();
        ctx.font = '10px monospace';

        let y = _INS_LH + topClear;
        for (let i = this._scrollY; i < lines.length && y <= totalH - 4; i++) {
            const line  = lines[i];
            ctx.fillStyle = line.startsWith('In: ') ? 'rgba(255,200,120,0.9)' : 'rgba(180,255,180,0.85)';
            const lineW = ctx.measureText(line).width;
            ctx.fillText(
                lineW > textW ? line.slice(0, Math.floor(line.length * textW / lineW) - 1) + '…' : line,
                _X, y
            );
            y += _INS_LH;
        }

        if (needSB) {
            const sbX    = totalW - _INS_SBW - 2;
            const sbTop  = topClear;
            const sbH    = totalH - sbTop - 4;
            const thumbH = Math.max(18, sbH * vis / lines.length);
            const thumbY = sbTop + (sbH - thumbH) * (this._scrollY / Math.max(1, lines.length - vis));
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(sbX, sbTop, _INS_SBW, sbH);
            ctx.fillStyle = 'rgba(180,255,180,0.5)';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(sbX, thumbY, _INS_SBW, thumbH, 2);
            else               ctx.rect(sbX, thumbY, _INS_SBW, thumbH);
            ctx.fill();
        }
        ctx.restore();
    };
    InspectMulti.prototype.onMouseWheel = function (e) {
        const vis       = _insmVisLines(this);
        const maxScroll = Math.max(0, this._lines.length - vis);
        if (maxScroll === 0) return false;   // niente da scorrere: lascia passare lo zoom del canvas
        const delta   = e.deltaY > 0 ? 1 : -1;
        this._scrollY = Math.max(0, Math.min(this._scrollY + delta, maxScroll));
        e.preventDefault?.();
        e.stopPropagation?.();
        return true;
    };
    InspectMulti.prototype.onMouseDown = function (e, pos) {
        const TH    = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
        const drawY = pos[1] - TH;
        if (drawY < 0) return false;
        const vis       = _insmVisLines(this);
        const maxScroll = Math.max(0, this._lines.length - vis);
        if (maxScroll === 0) return false;
        const sbHitX = this.size[0] - _INS_SBHIT;   // zona cliccabile, più larga della barra visiva (_INS_SBW)
        if (pos[0] < sbHitX) return false;
        const topClear = _insTopClear(this);
        const sbTop  = topClear;
        const sbH    = this.size[1] - sbTop - 4;
        const thumbH = Math.max(18, sbH * vis / this._lines.length);
        const thumbY = sbTop + (sbH - thumbH) * (this._scrollY / maxScroll);
        if (drawY >= thumbY && drawY <= thumbY + thumbH) {
            this._sbDrag   = true;
            this._sbDragY0 = pos[1];
            this._sbDragSY = this._scrollY;
        } else {
            const rel = Math.max(0, drawY - sbTop - thumbH / 2);
            this._scrollY = Math.max(0, Math.min(Math.round(rel / Math.max(1, sbH - thumbH) * maxScroll), maxScroll));
        }
        e.stopPropagation?.();
        return true;
    };
    InspectMulti.prototype.onMouseMove = function (e, pos) {
        if (!this._sbDrag) return;
        const vis       = _insmVisLines(this);
        const maxScroll = Math.max(0, this._lines.length - vis);
        if (maxScroll === 0) return;
        const sbH    = this.size[1] - _insTopClear(this) - 4;
        const thumbH = Math.max(18, sbH * vis / this._lines.length);
        const trackH = Math.max(1, sbH - thumbH);
        const dy     = pos[1] - this._sbDragY0;
        this._scrollY = Math.max(0, Math.min(Math.round(this._sbDragSY + dy / trackH * maxScroll), maxScroll));
    };
    InspectMulti.prototype.onMouseUp = function () {
        this._sbDrag = false;
    };
    InspectMulti.prototype.getExtraMenuOptions = function (_graph, options) {
        options.push({
            content: '＋ Add slot',
            callback: () => { this.addInput(`in${this.inputs.length}`, 0); },
        });
        if (this.inputs.length > 1) {
            options.push({
                content: '− Remove last slot',
                callback: () => { this.removeInput(this.inputs.length - 1); },
            });
        }
        const self = this;
        options.push({
            content: '📋 Copy content',
            callback: () => {
                const text = self._lines?.join('\n') ?? '';
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text).catch(() => _insFallbackCopy(text));
                } else {
                    _insFallbackCopy(text);
                }
            },
        });
    };
    LG.registerNodeType('Debug/InspectMulti', InspectMulti);


    // =========================================================================
    // Params/Constants/ConstText — costante stringa multi-riga con editor
    // modale (ex Params/Input/ConstText → Params/Type/ConstText →
    // Constants/ConstText → qui, 2026-09-20)
    // =========================================================================

    const _CONSTTEXT_MODAL_ID = '_fle_consttext_modal';

    function ConstText() {
        this.addProperty('value', '', 'string');
        this.addOutput('text', 'string');
        this.addWidget('button', '✎ Edit text', null, () => this._openEditor());
        this.color   = '#1a1a00';
        this.bgcolor = '#3a3a00';
        this.size    = [220, 60];
    }
    ConstText.title = 'Text';   // non 'Const Text': niente ridondanza per Constants (solo Var/Object/Array/Data la usano)
    ConstText.desc  = 'Multi-line string constant — click the button to open the editor';
    ConstText.portHelp = {
        outputs: { text: "The text (multi-line too) written in the node's modal editor — unchanged on every execution until it is edited again." },
    };
    ConstText.prototype.onExecute = function () {
        this.setOutputData(0, this.properties.value ?? '');
    };
    ConstText.prototype.onDrawForeground = function (ctx) {
        if (this.flags?.collapsed) return;
        let preview = (this.properties.value ?? '').slice(0, 200).replace(/\n/g, '↵');
        if (!preview) return;
        ctx.font      = '9px monospace';
        ctx.fillStyle = 'rgba(255,255,180,0.65)';
        // (2026-10-04) anteprima tagliata alla larghezza del nodo: prima usciva dai bordi
        const maxW = this.size[0] - 12;
        if (ctx.measureText(preview).width > maxW) {
            while (preview.length > 1 && ctx.measureText(preview + '…').width > maxW) preview = preview.slice(0, -1);
            preview += '…';
        }
        ctx.fillText(preview, 6, this.size[1] - 5);
    };
    ConstText.prototype._openEditor = function () {
        let modal = document.getElementById(_CONSTTEXT_MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id        = _CONSTTEXT_MODAL_ID;
            modal.className = 'modal fade';
            modal.tabIndex  = -1;
            modal.innerHTML = `
<div class="modal-dialog modal-fullscreen-md-down modal-lg">
  <div class="modal-content bg-dark text-light">
    <div class="modal-header py-2 border-0">
      <h6 class="modal-title mb-0">Const Text</h6>
      <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body p-2">
      <textarea id="${_CONSTTEXT_MODAL_ID}_ta"
        class="form-control font-monospace border-0"
        style="height:300px;resize:vertical;font-size:13px;line-height:1.6;
               background:#1e1e1e;color:#d4d4d4"
        placeholder="Write the text…"></textarea>
    </div>
    <div class="modal-footer py-2 border-0">
      <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
      <button type="button" class="btn btn-sm btn-primary" id="${_CONSTTEXT_MODAL_ID}_save">Save</button>
    </div>
  </div>
</div>`;
            document.body.appendChild(modal);
        }
        const ta     = modal.querySelector(`#${_CONSTTEXT_MODAL_ID}_ta`);
        ta.value     = this.properties.value ?? '';
        const oldBtn = modal.querySelector(`#${_CONSTTEXT_MODAL_ID}_save`);
        const newBtn = oldBtn.cloneNode(true);
        oldBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', () => {
            this.properties.value = ta.value;
            bootstrap.Modal.getInstance(modal)?.hide();
        });
        (bootstrap.Modal.getInstance(modal) ?? new bootstrap.Modal(modal)).show();
        modal.addEventListener('shown.bs.modal', () => ta.focus(), { once: true });
    };
    LG.registerNodeType('Params/Constants/ConstText', ConstText);


    // =========================================================================
    // Array/Maker — raccoglie N input in un array (ex Sets/List/ArrayMaker)
    // Object/Maker — raccoglie N input in un oggetto {chiave: valore} (ex
    // Sets/Object/ObjectMaker)
    // In entrambi: tasto destro sul nodo → Aggiungi / Rimuovi slot.
    // Per ObjectMaker: il nome dello slot diventa la chiave — rinominalo con
    // tasto destro → Rename sul singolo pin.
    // =========================================================================

    function ArrayMaker() {
        this.addInput('[0]', 0);
        this.addInput('[1]', 0);
        this.addOutput('array', 'array');
        this.color   = '#0c2340';
        this.bgcolor = '#1e3a5f';
        this.size    = [180, 80];
    }
    ArrayMaker.title = 'Maker';   // etichetta menu: la cartella dice già 'Array'
    _setCanvasTitle(ArrayMaker, 'Array Maker');   // titolo sul grafo: esplicito una volta isolato dal menu
    ArrayMaker.desc  = 'Collects the inputs into an array — right click to add/remove slots';
    ArrayMaker.portHelp = {
        inputs: { "*": "One slot for every element of the final array (2 by default, [0]/[1] — add/remove with right click on the node). Any type; an unconnected slot becomes null in the array." },
        outputs: { array: "Array with one element for every input slot, in the same order (index 0 = first slot)." },
    };
    ArrayMaker.prototype.onExecute = function () {
        const arr = [];
        for (let i = 0; i < this.inputs.length; i++) arr.push(this.getInputData(i) ?? null);
        this.setOutputData(0, arr);
    };
    ArrayMaker.prototype.onConfigure = function () {
        this.size[1] = Math.max(60, this.inputs.length * 20 + 40);
    };
    ArrayMaker.prototype.getExtraMenuOptions = function (graph, options) {
        options.push({
            content: '＋ Add slot',
            callback: () => {
                this.addInput(`[${this.inputs.length}]`, 0);
                this.size[1] = Math.max(60, this.inputs.length * 20 + 40);
            },
        });
        if (this.inputs.length > 1) {
            options.push({
                content: '− Remove last slot',
                callback: () => {
                    this.removeInput(this.inputs.length - 1);
                    this.size[1] = Math.max(60, this.inputs.length * 20 + 40);
                },
            });
        }
    };
    LG.registerNodeType('Params/Array/Maker', ArrayMaker);


    function ObjectMaker() {
        this.addInput('key0', 0);
        this.addInput('key1', 0);
        this.addOutput('object', 'object');
        this.color   = '#0c2340';
        this.bgcolor = '#1e3a5f';
        this.size    = [200, 80];
    }
    ObjectMaker.title = 'Maker';   // etichetta menu: la cartella dice già 'Object'
    _setCanvasTitle(ObjectMaker, 'Object Maker');   // titolo sul grafo: esplicito una volta isolato dal menu
    ObjectMaker.desc  = 'Collects the inputs into a {key: value} object — rename the pins to change the keys';
    ObjectMaker.portHelp = {
        inputs: { "*": "One slot for every property of the final object (2 by default, key0/key1 — add/remove/rename with right click on the node). THE PIN NAME becomes the object key — renaming the pin is the ONLY way to change the key. Any value type; an unconnected slot becomes null." },
        outputs: { object: "Object {pinName: value} — one property for every input slot." },
    };
    ObjectMaker.prototype.onExecute = function () {
        const obj = {};
        for (let i = 0; i < this.inputs.length; i++) {
            const key = this.inputs[i].name || `key${i}`;
            obj[key]  = this.getInputData(i) ?? null;
        }
        this.setOutputData(0, obj);
    };
    ObjectMaker.prototype.onConfigure = function () {
        this.size[1] = Math.max(60, this.inputs.length * 20 + 40);
    };
    ObjectMaker.prototype.getExtraMenuOptions = function (graph, options) {
        options.push({
            content: '＋ Add slot',
            callback: () => {
                this.addInput(`key${this.inputs.length}`, 0);
                this.size[1] = Math.max(60, this.inputs.length * 20 + 40);
            },
        });
        if (this.inputs.length > 1) {
            options.push({
                content: '− Remove last slot',
                callback: () => {
                    this.removeInput(this.inputs.length - 1);
                    this.size[1] = Math.max(60, this.inputs.length * 20 + 40);
                },
            });
        }
        options.push({
            content: '✎ Rename slot…',
            callback: () => {
                const idx = parseInt(prompt(`Index of the slot to rename (0 – ${this.inputs.length - 1}):`) ?? '-1');
                if (isNaN(idx) || idx < 0 || idx >= this.inputs.length) return;
                const name = prompt(`New key name for slot ${idx}:`, this.inputs[idx].name ?? `key${idx}`);
                if (name != null) this.inputs[idx].name = name.trim() || `key${idx}`;
            },
        });
    };
    LG.registerNodeType('Params/Object/Maker', ObjectMaker);


    // =========================================================================
    // Params/Object/ObjectVec3 — variante fissa di ObjectMaker già predisposta
    // con 3 slot x/y/z (niente aggiungi/rimuovi/rinomina: qui la forma è
    // fissa per costruzione). Gemello "in formato oggetto" di
    // Vector/Pack/XYZtoVec3 (che produce invece un array/vec3) — stesso
    // output {x,y,z} accettato da tutti i TJS/Object/Set*, TJS/Camera/*,
    // ecc. Se un input non è collegato usa la property corrispondente,
    // stesso comportamento di XYZtoVec3.
    // =========================================================================
    function ObjectVec3() {
        this.addProperty('x', 0, 'number');
        this.addProperty('y', 0, 'number');
        this.addProperty('z', 0, 'number');
        this.addWidget('number', 'x', 0, v => { this.properties.x = v; }, { property: 'x' });
        this.addWidget('number', 'y', 0, v => { this.properties.y = v; }, { property: 'y' });
        this.addWidget('number', 'z', 0, v => { this.properties.z = v; }, { property: 'z' });
        this.addInput('x', 'number');
        this.addInput('y', 'number');
        this.addInput('z', 'number');
        this.addOutput('object', 'object');
        this.color   = '#0c2340';
        this.bgcolor = '#1e3a5f';
        this.size    = [180, 110];
    }
    ObjectVec3.title = 'ObjectVec3';
    _setCanvasTitle(ObjectVec3, 'Object Vec3');
    ObjectVec3.desc  = 'Packs x/y/z into an {x,y,z} object — "object" twin of Vector/Pack/XYZtoVec3 (which produces an array/vec3), same format accepted by all the TJS/Object/Set* nodes';
    ObjectVec3.portHelp = {
        inputs: {
            x: "X component (optional, otherwise property 'x').",
            y: "Y component (optional, otherwise property 'y').",
            z: "Z component (optional, otherwise property 'z').",
        },
        outputs: { object: '{x,y,z} — same format accepted by all the TJS/Object/Set*, TJS/Camera/* nodes, etc. (which also accept the equivalent array/vec3 of XYZtoVec3).' },
    };
    ObjectVec3.prototype.onExecute = function () {
        const x = this.getInputData(0) ?? this.properties.x ?? 0;
        const y = this.getInputData(1) ?? this.properties.y ?? 0;
        const z = this.getInputData(2) ?? this.properties.z ?? 0;
        this.setOutputData(0, { x, y, z });
    };
    ObjectVec3.pure = true;   // ricalcolato quando viene letto (lib/litegraph, patch 7)
    LG.registerNodeType('Params/Object/ObjectVec3', ObjectVec3);


    // =========================================================================
    // Params/Variables/Set|Get|List (ex Params/Var/*, 2026-09-20) — variabili
    // nominative nel grafo ("wireless link" via graph.vars)
    // ─────────────────────────────────────────────────────────────────────────
    // Set: scrive il valore.  Get: legge il valore.  List: mostra tutto.
    // Toggle "modalità continua":
    //   OFF (default) → onAction solo su trigger, onExecute inattivo
    //   ON            → onExecute ogni frame, onAction ancora disponibile
    //
    // I nodi comunicano tramite this.graph.vars = { [name]: value }.
    // =========================================================================

    function VarSet() {
        this.addProperty('name',       'var1', 'string');
        this.addProperty('continuous', false,  'boolean');
        this.addWidget('text',   'variable name',   'var1', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('toggle', 'continuous mode', false,  v => { this.properties.continuous = v; }, { property: 'continuous' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('name',    'string');  // sovrascrive widget se connesso
        this.addInput('value',   0);        // qualsiasi tipo
        this.addOutput('done',   LG.EVENT);
        this.mode    = LG.ALWAYS;
        this.color   = '#1e3a5f';
        this.bgcolor = '#1e40af';
        this.size    = [220, 125];
    }
    VarSet.title = 'Set';   // etichetta menu: la cartella dice già 'Variables'
    _setCanvasTitle(VarSet, 'Var Set');   // titolo sul grafo: esplicito una volta isolato dal menu
    VarSet.desc  = 'Writes a value into graph.vars — readable by Var Get anywhere in the graph';
    VarSet.portHelp = {
        inputs: {
            trigger: "Trigger (ACTION): writes the value ONLY at this instant — used when the 'continuous mode' property/widget is OFF (default).",
            name: "Name of the variable as a string — if connected, overrides the node's 'variable name' widget.",
            value: "The value to write (any type) into the given variable.",
        },
        outputs: { done: "EVENT emitted right after writing, in response to the trigger received." },
    };
    VarSet.prototype._write = function () {
        this.graph.vars = this.graph.vars || {};
        const name = this.getInputData(1) || this.properties.name;
        if (!name) return;
        this.graph.vars[name] = this.getInputData(2);
    };
    VarSet.prototype.onExecute = function () {
        if (!this.properties.continuous) return;
        this._write();
    };
    VarSet.prototype.onAction = function () {
        this._write();
        this.triggerSlot(0);
    };
    LG.registerNodeType('Params/Variables/Set', VarSet);


    function VarGet() {
        this.addProperty('name',       'var1', 'string');
        this.addProperty('continuous', false,  'boolean');
        this.addWidget('text',   'variable name',   'var1', v => { this.properties.name = v; }, { property: 'name' });
        this.addWidget('toggle', 'continuous mode', false,  v => { this.properties.continuous = v; }, { property: 'continuous' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('name',    'string');  // sovrascrive widget se connesso
        this.addOutput('done',   LG.EVENT);
        this.addOutput('value',  0);        // qualsiasi tipo
        this.mode    = LG.ALWAYS;
        this.color   = '#1e3a5f';
        this.bgcolor = '#1e40af';
        this.size    = [220, 110];
    }
    VarGet.title = 'Get';   // etichetta menu: la cartella dice già 'Variables'
    _setCanvasTitle(VarGet, 'Var Get');   // titolo sul grafo: esplicito una volta isolato dal menu
    VarGet.desc  = 'Reads a value from graph.vars by name';
    VarGet.portHelp = {
        inputs: {
            trigger: "Trigger (ACTION): reads the value ONLY at this instant — used when the 'continuous mode' property/widget is OFF (default).",
            name: "Name of the variable as a string — if connected, overrides the node's 'variable name' widget.",
        },
        outputs: { done: "EVENT emitted right after reading, in response to the trigger received.", value: "The current value of the variable — undefined if it has never been written." },
    };
    VarGet.prototype._read = function () {
        this.graph.vars = this.graph.vars || {};
        const name = this.getInputData(1) || this.properties.name;
        return name != null ? this.graph.vars[name] : undefined;
    };
    VarGet.prototype.onExecute = function () {
        // Continua: aggiorna valore ogni frame senza sparare done
        if (!this.properties.continuous) return;
        this.setOutputData(1, this._read());
    };
    VarGet.prototype.onAction = function () {
        this.setOutputData(1, this._read());
        this.triggerSlot(0);
    };
    LG.registerNodeType('Params/Variables/Get', VarGet);


    function VarList() {
        this.addOutput('vars', 'object');  // intero graph.vars
        this.mode    = LG.ALWAYS;
        this.color   = '#1e3a5f';
        this.bgcolor = '#1e40af';
        this.size    = [240, 60];
        this._cache  = {};
    }
    VarList.title = 'List';   // etichetta menu: la cartella dice già 'Variables'
    _setCanvasTitle(VarList, 'Var List');   // titolo sul grafo: esplicito una volta isolato dal menu
    VarList.desc  = 'Shows all the variables in graph.vars and exposes the whole dictionary as output';
    VarList.portHelp = {
        outputs: { vars: "The whole graph.vars dictionary {name: value, ...} — ALL the variables written by any Var Set in the graph, not just one. The node body also lists every key visually with its type/preview." },
    };
    VarList.prototype.onExecute = function () {
        this._cache = this.graph?.vars ?? {};
        this.setOutputData(0, this._cache);
    };
    VarList.prototype.onDrawBackground = function (ctx) {
        if (this.flags?.collapsed) return;
        const vars = this._cache ?? {};
        const keys = Object.keys(vars);
        const LINE = 16, PAD = 8;

        // Auto-resize in base al numero di variabili
        const needed = Math.max(40, keys.length * LINE + PAD * 2);
        if (this.size[1] !== needed) this.size[1] = needed;

        ctx.font = '10px monospace';

        if (keys.length === 0) {
            ctx.fillStyle = '#555';
            ctx.fillText('(no variables)', PAD, 14);
            return;
        }

        let y = 14;
        for (const k of keys) {
            const v    = vars[k];
            const type = Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v);

            ctx.fillStyle = '#aaa';
            ctx.fillText(k + ':', PAD, y);

            const kw = ctx.measureText(k + ':  ').width;
            ctx.fillStyle = type === 'number'  ? '#86efac'
                          : type === 'string'  ? '#fde68a'
                          : type === 'boolean' ? '#93c5fd'
                          : type === 'array'   ? '#f9a8d4'
                          : type === 'object'  ? '#c4b5fd'
                          : '#888';

            let disp;
            if (v === null || v === undefined) {
                disp = String(v);
            } else if (type === 'array') {
                disp = `[…${v.length}]`;
            } else if (type === 'object') {
                const ks = Object.keys(v);
                disp = '{' + ks.slice(0, 3).join(', ') + (ks.length > 3 ? '…' : '') + '}';
            } else {
                disp = String(v).slice(0, 28);
            }

            ctx.fillText(disp, PAD + kw, y);
            y += LINE;
        }
    };
    LG.registerNodeType('Params/Variables/List', VarList);


    // 'Flow/Relay ←' (BackwardRelay) RIMOSSO (2026-09-20, su richiesta
    // esplicita): passthrough con input a destra/output a sinistra per
    // ridurre l'intreccio dei fili — funzione ormai coperta da
    // 'Flow/Wireless Out'/'In' (nessun filo affatto) e da 'Flow/Hub' (punto
    // di diramazione spostabile nel grafo).

    // =========================================================================
    // Flow/Hub — sposta nel grafo il punto da cui diramano più fili collegati
    // a una stessa sorgente (ex 'Reroute', rinominato 2026-09-20 su richiesta
    // esplicita — l'uso reale non è "instradare un filo", è dare un punto di
    // fan-out comodo lontano dalla sorgente originale).
    // ─────────────────────────────────────────────────────────────────────────
    // Stile normale (come Watch, 2026-09-20 su richiesta esplicita): niente
    // più il cerchietto 16×16 con pallino disegnato a mano — dimensione
    // piccola ma standard, titolo e pin di input/output visibili con il
    // rendering nativo di LiteGraph. Una volta collegato, l'utente lo
    // collassa (cerchietto nativo sul titolo): resta visibile solo la
    // scritta "Hub", ingombro minimo — nessun codice dedicato necessario,
    // è il comportamento di default di LiteGraph quando il titolo non è
    // soppresso (la vecchia versione lo sopprimeva esplicitamente).
    // Wildcard: passa sia dati che trigger/eventi, nessuna elaborazione.
    // =========================================================================

    function Hub() {
        this.addInput('',  0);   // wildcard, label vuota
        this.addOutput('', 0);   // wildcard, label vuota
        this.size  = [60, 30];   // stessa dimensione di Watch
        this.color   = '#1f2937';   // famiglia Instradamento (Flow), tassonomia §10
        this.bgcolor = '#374151';
    }
    Hub.title = 'Hub';
    Hub.desc  = 'Moves in the graph the point from which several wires connected to the same source branch out — no processing, only passthrough. Once connected, collapse it (dot on the title): only "Hub" stays visible.';
    Hub.portHelp = {
        inputs: { "": "Wildcard — any data type OR a trigger/event, passed unchanged." },
        outputs: { "": "The same value/event received as input, without any processing." },
    };

    // (2026-10-17) Niente onExecute: LiteGraph rimanda gli eventi dei nodi che ce l'hanno al giro
    // successivo del ciclo del grafo, e i flow dei pannelli (HTM, ECH…) non hanno il ciclo — gli
    // eventi restavano fermi nell'Hub. I dati passano con passthrough: chi legge l'uscita dell'Hub
    // legge direttamente quello che entra (lib/litegraph, patch 6).
    Hub.passthrough = true;
    Hub.prototype.onAction = function (action, param) {
        this.triggerSlot(0, param);
    };

    LG.registerNodeType('Flow/Hub', Hub);


    // =========================================================================
    // Flow/Trigger Pass — passthrough minimale per trigger/eventi.
    // ─────────────────────────────────────────────────────────────────────────
    // Un solo input ACTION e un solo output EVENT. Non fa nulla se non
    // rilanciare l'impulso. Utile come punto di giunzione visiva o per
    // spezzare un filo trigger senza interrompere la catena.
    // =========================================================================

    function TriggerPass() {
        this.addInput('in',  LG.ACTION);
        this.addOutput('out', LG.EVENT);
        this.color   = '#1c3a1c';
        this.bgcolor = '#14532d';
        this.size    = [120, 40];
    }
    TriggerPass.title = 'Trigger Pass';
    TriggerPass.desc  = 'Trigger passthrough — receives ACTION and re-emits EVENT';
    TriggerPass.portHelp = {
        inputs: { in: "Incoming trigger (ACTION), with its parameter if any." },
        outputs: { out: "EVENT re-emitted immediately, with the same parameter received." },
    };
    TriggerPass.prototype.onAction = function (action, param) {
        this.triggerSlot(0, param);
    };
    LG.registerNodeType('Flow/Trigger Pass', TriggerPass);


    // =========================================================================
    // Flow/Trigger Gate — lascia passare o blocca un trigger.
    // ─────────────────────────────────────────────────────────────────────────
    // Usa onAction (non onExecute) perché gli eventi ACTION/EVENT non transitano
    // attraverso il normale meccanismo dati di LiteGraph.
    // Toggle 'enabled': ON → trigger passa su 'done'; OFF → devia su 'blocked'.
    // Connettore 'enabled' (boolean) sovrascrive il toggle se connesso.
    // Indicatore visivo nel body: verde = aperto, rosso = chiuso.
    // =========================================================================

    function TriggerGate() {
        this.addProperty('enabled', true, 'boolean');
        this.addWidget('toggle', 'enabled', true, v => { this.properties.enabled = v; }, { property: 'enabled' });
        this.addInput('trigger',  LG.ACTION);
        this.addInput('enabled',  'boolean');  // sovrascrive widget se connesso
        this.addOutput('done',    LG.EVENT);   // trigger passa (gate aperto)
        this.addOutput('blocked', LG.EVENT);   // trigger deviato (gate chiuso)
        this.color   = '#14532d';
        this.bgcolor = '#166534';
        this.size    = [200, 95];
    }
    TriggerGate.title = 'Trigger Gate';
    TriggerGate.desc  = 'Lets a trigger through or blocks it — separate output for blocked triggers';
    TriggerGate.portHelp = {
        inputs: { trigger: "Trigger (ACTION) to let through or block.", enabled: "Optional boolean — if connected, overrides the node's 'enabled' widget." },
        outputs: { done: "EVENT emitted if the gate is open (enabled true).", blocked: "EVENT emitted if the gate is closed (enabled false) — instead of simply losing the trigger, it diverts it here." },
    };
    TriggerGate.prototype.onAction = function (action, param) {
        const raw     = this.getInputData(1);
        const enabled = raw != null ? Boolean(raw) : this.properties.enabled;
        if (enabled) {
            this.triggerSlot(0, param);   // gate aperto → done
        } else {
            this.triggerSlot(1, param);   // gate chiuso → blocked
        }
    };
    TriggerGate.prototype.onDrawBackground = function (ctx) {
        if (this.flags?.collapsed) return;
        const raw     = this.getInputData(1);
        const enabled = raw != null ? Boolean(raw) : this.properties.enabled;
        const w = this.size[0], h = this.size[1];
        // Indicatore stato: cerchio colorato + testo
        const r  = 7, cx = w - 16, cy = h / 2;
        ctx.fillStyle = enabled ? '#4ade80' : '#f87171';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.font      = 'bold 10px sans-serif';
        ctx.fillStyle = enabled ? '#4ade80' : '#f87171';
        ctx.fillText(enabled ? 'OPEN' : 'CLOSED', 8, cy + 4);
    };
    LG.registerNodeType('Flow/Trigger Gate', TriggerGate);


    // =========================================================================
    // Flow/Wireless Out & Flow/Wireless In — collegamento "senza filo" tra due
    // punti qualsiasi del grafo, stile parametri wireless di Grasshopper.
    // ─────────────────────────────────────────────────────────────────────────
    // Risolve il problema di '← Relay' qui sopra: le tangenti d'innesto dei
    // fili in LiteGraph sono fisse, e un filo che deve tornare "indietro" (da
    // destra verso sinistra) finisce spesso per nascondersi dietro il body
    // del nodo a cui si collega. Wireless Out/In evita del tutto il filo:
    // nessun collegamento visuale, solo un nome di 'canale' in comune tra i
    // due nodi (proprietà testuale, come 'topic' in Panel Emitter/Receiver).
    //
    // Differenza rispetto a Params/Variables/Set|Get (ex Params/Var/Set|Get, vedi sopra): quei nodi
    // condividono solo un VALORE, che chi legge vede solo quando IL SUO
    // PROPRIO trigger scatta (serve comunque un evento locale, es. via toggle
    // "continua" o un wire dedicato) — non inoltrano l'evento stesso. Qui
    // invece è l'evento che viene propagato: quando un trigger arriva su
    // Wireless Out, il nodo cerca — nella stessa chiamata, in modo sincrono —
    // tutti i Wireless In con lo stesso canale nel grafo e ne rilancia
    // direttamente il trigger (triggerSlot), esattamente come farebbe un filo
    // vero. La sequenza temporale degli eventi è quindi preservata 1:1: non è
    // polling, nessun ritardo, il ricevitore non ha bisogno di un trigger
    // proprio. Più Wireless In sullo stesso canale = fan-out, come un filo
    // con più uscite.
    // =========================================================================

    function WirelessIn() {
        this.addProperty('channel', 'channel1', 'string');
        this.addWidget('text', 'channel', 'channel1', v => { this.properties.channel = v; }, { property: 'channel' });
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('value',   0);
        this.color   = '#3b0764';
        this.bgcolor = '#581c87';
        this.size    = [170, 70];
    }
    WirelessIn.title = '📡 Wireless In';
    WirelessIn.desc  = 'Receives trigger/value from a Wireless Out with the same channel — no visible wire';
    WirelessIn.portHelp = {
        outputs: { trigger: "EVENT emitted when any Wireless Out with the same 'channel' receives a trigger (re-emitted synchronously, same timing as a real wire).", value: "The value sent by the matching Wireless Out, updated at the same instant as the trigger." },
    };
    WirelessIn.prototype._receive = function (value, param) {
        this.setOutputData(1, value);
        this.triggerSlot(0, param);
    };
    LG.registerNodeType('Flow/Wireless In', WirelessIn);


    function WirelessOut() {
        this.addProperty('channel', 'channel1', 'string');
        this.addWidget('text', 'channel', 'channel1', v => { this.properties.channel = v; }, { property: 'channel' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('value',   0);
        this.addOutput('done',   LG.EVENT);  // opzionale: continuare anche via filo locale
        this.color   = '#3b0764';
        this.bgcolor = '#581c87';
        this.size    = [170, 80];
    }
    WirelessOut.title = '📡 Wireless Out';
    WirelessOut.desc  = 'Forwards trigger/value to all the Wireless In nodes with the same channel — no visible wire';
    WirelessOut.portHelp = {
        inputs: { trigger: "Trigger (ACTION) that starts forwarding to all the Wireless In nodes with the same 'channel'.", value: "The value to send together with the trigger (any type)." },
        outputs: { done: "Optional EVENT, to continue ALSO with a visible local wire, in parallel with the wireless transmission." },
    };
    WirelessOut.prototype.onAction = function (action, param) {
        const channel = this.properties.channel;
        const value   = this.getInputData(1);
        if (channel) {
            for (const n of this.graph?._nodes ?? []) {
                if (n !== this && n.constructor === WirelessIn && n.properties.channel === channel) {
                    n._receive(value, param);
                }
            }
        }
        this.triggerSlot(0, param);
    };
    LG.registerNodeType('Flow/Wireless Out', WirelessOut);


    // =========================================================================
    // ReseArch/Menu/Command  — voce nel menu sinistro (default) o destro che
    // emette un trigger. Le automazioni sull'OGGETTO vanno nel menu sinistro
    // (quello che ne porta il nome), quelle sull'APP nel menu destro (2026-09-22).
    // Dal 2026-10-13 vale per tutte le App: il runner aggancia il grafo al
    // pannello (app/shared/panel-flow.mjs) e template_XXX.mjs legge le voci
    // all'apertura del menu. Al click: fire() → triggerSlot(0) diretto, così
    // funziona anche nei grafi a eventi, che non girano in continuo.
    // =========================================================================
    function MenuCommand() {
        this.addProperty('label', 'Action', 'string');
        this.addProperty('side',  'left', 'string');   // 'left' (default) | 'right'
        this.addWidget('text', 'label', 'Action', v => { this.properties.label = v; }, { property: 'label' });
        this.addWidget('combo', 'menu',  'left', v => { this.properties.side = v; }, { property: 'side', values: ['left', 'right'] });
        this.addOutput('trigger', LG.EVENT);
        this.color   = '#2d1b69';
        this.bgcolor = '#4c1d95';
        this.size    = [200, 90];
    }
    MenuCommand.title = 'Menu Command';
    MenuCommand.desc  = 'Adds an entry to the left menu (object commands, default) or to the right menu (app commands) of the panel that emits a trigger on click — any app';
    MenuCommand.portHelp = {
        outputs: { trigger: "EVENT emitted when the user clicks the matching menu entry (label set by the 'label' widget, side chosen by the 'menu' widget: left = object commands (default), right = app commands) — no parameter." },
    };
    /** Chiamato dalla voce di menu (app/shared/panel-flow.mjs). */
    MenuCommand.prototype.fire = function () {
        this.triggerSlot(0);
    };
    MenuCommand.prototype.onDrawForeground = function (ctx) {
        _drawSubtitle(ctx, this, this.properties.label || '—');
    };
    LG.registerNodeType('ReseArch/Menu/Command', MenuCommand);


    // =========================================================================
    // ReseArch/Menu/Status  — voce nel menu sinistro che mostra un valore.
    // Il valore si legge all'apertura del menu (getValue), direttamente dal
    // filo d'ingresso: nei grafi a eventi onExecute non gira mai.
    // =========================================================================
    function MenuStatus() {
        this.addProperty('label', 'Status', 'string');
        this.addWidget('text', 'label', 'Status', v => { this.properties.label = v; }, { property: 'label' });
        this.addInput('value', 0);
        this.color   = '#1a3a2a';
        this.bgcolor = '#14532d';
        this.size    = [200, 70];
        this._displayValue = null;
    }
    MenuStatus.title = 'Menu Status';
    MenuStatus.desc  = 'Adds an entry to the left menu of the panel that shows an updated value — any app';
    MenuStatus.portHelp = {
        inputs: { value: "The value to show (any type, converted to string) next to the label of the 'label' widget, in the entry of the panel's left menu — read when the menu is opened." },
    };
    MenuStatus.prototype.onExecute = function () {
        this.getValue();
    };
    /** Letto all'apertura del menu: ultimo valore arrivato sul filo, altrimenti l'ultimo visto. */
    MenuStatus.prototype.getValue = function () {
        const v = this.getInputData(0);
        if (v !== undefined) this._displayValue = v;
        return this._displayValue;
    };
    MenuStatus.prototype.onDrawForeground = function (ctx) {
        const val = this._displayValue;
        const txt = val != null ? `${this.properties.label}: ${val}` : this.properties.label;
        _drawSubtitle(ctx, this, txt);
    };
    LG.registerNodeType('ReseArch/Menu/Status', MenuStatus);


    // =========================================================================
    // ReseArch/Panel/Status e ReseArch/Panel/Hints — testo nel footer del
    // pannello, per tutte le App (2026-10-13, ex PJS/Panel/*). cmdUI.notify()
    // scrive il testo e apre il footer se è chiuso, senza interrompere un
    // comando dell'App in corso. Il pannello è quello a cui il grafo è
    // agganciato (app/shared/panel-flow.mjs); senza pannello (flow dashboard)
    // il nodo non scrive nulla e prosegue.
    // =========================================================================
    // hold (2026-10-14): il footer resta aperto (niente chiusura dopo 15 s) finché
    // un evento sull'ingresso release non lo libera; da lì si chiude dopo 15 s.
    function _panelTextNode(field, title, desc, what) {
        function PanelText() {
            this.addProperty('message', '', 'string');
            this.addProperty('hold', false, 'boolean');
            this.addWidget('text', 'message', '', v => { this.properties.message = v; }, { property: 'message' });
            this.addWidget('toggle', 'hold', false, v => { this.properties.hold = !!v; }, { property: 'hold' });
            this.addInput('trigger', LG.ACTION);
            this.addInput('message', 'string');
            this.addInput('release', LG.ACTION);
            this.addOutput('done',   LG.EVENT);
            this.color   = '#1a1a1a';
            this.bgcolor = '#2a2a2a';
            this.size    = [220, 120];
        }
        PanelText.title = title;
        PanelText.desc  = desc;
        PanelText.portHelp = {
            inputs: {
                trigger: `Pulse: writes the text in the panel footer (${what}) and opens the footer if it is closed.`,
                message: "Text (string) to show — if connected it overrides the 'message' widget.",
                release: "Pulse: ends the 'hold' of the footer, which then closes after 15 s (e.g. from the done of the job whose progress is shown).",
            },
            outputs: { done: 'Event: emitted after the footer is updated (also when the flow has no panel).' },
            properties: {
                message: 'Text to show when the message input is not connected.',
                hold:    'Off: the footer closes 15 s after the last message. On: it stays open until an event arrives on release (of this or another Panel node of the same panel).',
            },
        };
        PanelText.prototype.onAction = function (action) {
            const ui = panelCmdUI(this.graph);
            if (action === 'release') { ui?.endCommand?.(); return; }
            const msg = this.getInputData(1) ?? this.properties.message;
            ui?.notify?.({ [field]: String(msg ?? ''), hold: !!this.properties.hold });
            this.triggerSlot(0);
        };
        PanelText.prototype.onDrawForeground = function (ctx) {
            if (this.properties.message) _drawSubtitle(ctx, this, this.properties.message);
        };
        return PanelText;
    }
    LG.registerNodeType('ReseArch/Panel/Status', _panelTextNode('status', 'Panel Status',
        'Writes the status text (left) in the panel footer and opens the footer — any app', 'status, left'));
    LG.registerNodeType('ReseArch/Panel/Hints', _panelTextNode('hints', 'Panel Hints',
        'Writes the hints text (centre) in the panel footer and opens the footer — any app', 'hints, centre'));


    // =========================================================================
    // ReseArch/Panel/Message — piccola finestra Bootstrap con titolo e testo
    // (2026-10-14). Non blocca la pagina né il flow, a differenza di Debug/Alert
    // (alert() del browser). Una sola finestra per la pagina, riusata da tutti i
    // nodi: un messaggio nuovo sostituisce quello aperto.
    // =========================================================================
    function _flowMessageModal() {
        let el = document.getElementById('raFlowMessageModal');
        if (el) return el;
        const tr = (k, fb) => (typeof window.t === 'function' ? window.t(k) : fb);
        el = document.createElement('div');
        el.className = 'modal fade';
        el.id = 'raFlowMessageModal';
        el.tabIndex = -1;
        el.setAttribute('aria-labelledby', 'raFlowMessageTitle');
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = `
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content bg-body text-body">
              <div class="modal-header py-2">
                <h2 class="modal-title fs-6" id="raFlowMessageTitle"></h2>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body" style="white-space: pre-line; overflow-wrap: anywhere;"></div>
              <div class="modal-footer py-2">
                <button type="button" class="btn btn-sm btn-primary" data-bs-dismiss="modal"></button>
              </div>
            </div>
          </div>`;
        const close = tr('common.close', 'Chiudi');
        el.querySelector('.btn-close').setAttribute('aria-label', close);
        el.querySelector('.modal-footer .btn').textContent = close;
        document.body.appendChild(el);
        return el;
    }
    function PanelMessage() {
        this.addProperty('title',   '', 'string');
        this.addProperty('message', '', 'string');
        this.addWidget('text', 'title',   '', v => { this.properties.title = v; },   { property: 'title' });
        this.addWidget('text', 'message', '', v => { this.properties.message = v; }, { property: 'message' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('title',   'string');
        this.addInput('message', 'string');
        this.addOutput('done',   LG.EVENT);
        this.color   = '#1a1a1a';
        this.bgcolor = '#2a2a2a';
        this.size    = [240, 120];
    }
    PanelMessage.title = 'Panel Message';
    PanelMessage.desc  = 'Opens a small window with a title and a text (plain text, line breaks kept) and a Close button; it does not block the page or the flow — any app';
    PanelMessage.portHelp = {
        inputs: {
            trigger: 'Pulse: opens the window (replaces the text if it is already open).',
            title:   "Title (string) — if connected it overrides the 'title' widget.",
            message: "Text (string) — if connected it overrides the 'message' widget. Line breaks (\\n) are kept.",
        },
        outputs: { done: 'Event: emitted when the window is opened.' },
        properties: { title: 'Title of the window.', message: 'Text of the window.' },
    };
    PanelMessage.prototype.onAction = function () {
        const title = this.getInputData(1) ?? this.properties.title;
        const msg   = this.getInputData(2) ?? this.properties.message;
        const el = _flowMessageModal();
        el.querySelector('.modal-title').textContent = String(title ?? '');
        el.querySelector('.modal-body').textContent  = String(msg ?? '');
        const Modal = window.bootstrap?.Modal;
        if (Modal) Modal.getOrCreateInstance(el).show();
        else console.warn('[Panel Message] Bootstrap non disponibile:', title, msg);
        this.triggerSlot(0);
    };
    PanelMessage.prototype.onDrawForeground = function (ctx) {
        if (this.properties.title) _drawSubtitle(ctx, this, this.properties.title);
    };
    LG.registerNodeType('ReseArch/Panel/Message', PanelMessage);


    // =========================================================================
    // String/Format — testo da un modello con segnaposto {a} {b} {c} {d}
    // (2026-10-14). {a:1} = numero con 1 decimale; valore mancante = "—";
    // {a?} = valore mancante lasciato vuoto (2026-10-15, es. allegati facoltativi).
    // A evento: compone al trigger, così funziona nei grafi a eventi.
    // =========================================================================
    const FORMAT_KEYS = ['a', 'b', 'c', 'd'];
    function StringFormat() {
        this.addProperty('template', '{a}', 'string');
        this.addWidget('text', 'template', '{a}', v => { this.properties.template = v; }, { property: 'template' });
        this.addInput('trigger', LG.ACTION);
        for (const k of FORMAT_KEYS) this.addInput(k, 0);
        this.addOutput('done', LG.EVENT);
        this.addOutput('text', 'string');
        this.size = [260, 150];
    }
    StringFormat.title = 'Format';
    StringFormat.desc  = "Builds a text from the 'template' with the placeholders {a} {b} {c} {d} replaced by the inputs — {a:1} writes a number with 1 decimal; a missing value is written as '—', with {a?} it is left empty";
    StringFormat.portHelp = {
        inputs: {
            trigger: 'Pulse: builds the text and emits done.',
            a: 'Value for {a} (any type).', b: 'Value for {b}.', c: 'Value for {c}.', d: 'Value for {d}.',
        },
        outputs: { done: 'Event: the text is ready.', text: 'The built text (string).' },
        properties: { template: 'Text with placeholders, e.g. "Running {a} · Pending {b} · Average {c:1} s". {a?}: empty instead of "—" when the value is missing. \\n starts a new line.' },
    };
    StringFormat.prototype.onAction = function () {
        const vals = {};
        FORMAT_KEYS.forEach((k, i) => { vals[k] = this.getInputData(i + 1); });
        const text = String(this.properties.template ?? '')
            .replace(/\\n/g, '\n')
            .replace(/\{([abcd])(\?)?(?::(\d))?\}/g, (_m, k, opt, dec) => {
                const v = vals[k];
                if (v === undefined || v === null || v === '') return opt ? '' : '—';
                if (dec != null && Number.isFinite(Number(v))) return Number(v).toFixed(Number(dec));
                return String(v);
            });
        this.setOutputData(1, text);
        this.triggerSlot(0);
    };
    LG.registerNodeType('String/Format', StringFormat);


    // =========================================================================
    // Script/Flexi — script JS con input/output dinamici ed editor modale
    //
    // Proprietà:
    //   inputs_def   CSV di nomi input (es. "pts, raggio")
    //   outputs_def  CSV di nomi output (es. "result, debug")
    //   code         corpo della funzione JS
    //
    // Il codice riceve gli input come variabili con lo stesso nome e deve
    // restituire un oggetto con le chiavi degli output:
    //   return { result: pts.map(p => ({x: p.x * raggio, y: p.y})) };
    // Se l'output è uno solo, è accettato anche un valore scalare/array diretto.
    //
    // ESECUZIONE: nodo evento (onAction, non onExecute) — pattern identico a
    // VarSet/VarGet/Hub più sopra in questo file. Lo script gira SOLO
    // quando arriva un segnale sull'input 'trigger' (ACTION): serve collegare
    // a monte un nodo che emetta un EVENT, es. Flow/Events/Trigger,
    // Time/Timer, oppure — per un flow TJS — TJS/Events/OnPick,
    // TJS/Events/OnSelectionChanged, TJS/Events/OnCameraSettled. Senza un
    // wire sul 'trigger' il nodo non esegue mai, anche se gli input dati
    // sono collegati.
    //
    // Uscita 'error' (EVENT, sempre l'ultima porta): spara con param =
    // messaggio d'errore se il codice lancia un'eccezione, al posto di
    // 'done' (che spara solo su esecuzione riuscita). L'ultimo errore resta
    // visibile anche sul nodo stesso (badge rosso disegnato sotto l'anteprima
    // di codice) finché non si verifica una nuova esecuzione con successo.
    //
    // STATO CONDIVISO tra script diversi: oltre agli input dichiarati, il
    // codice riceve sempre un parametro implicito `vars` — è lo stesso
    // graph.vars usato da Params/Variables/Set e Params/Variables/Get (ex Params/Var/Set|Get, § più sopra in
    // questo file), quindi uno script "init" può fare `vars.log = []` e un
    // altro script "append" (nodo diverso, anche altrove nel grafo) può fare
    // `vars.log = (vars.log || []).concat(nuovoDato)` — nessun wiring
    // Var Get/Set necessario, basta usare lo stesso nome di chiave. Ordine di
    // esecuzione = ordine dei trigger nel grafo, come sempre con onAction.
    // =========================================================================
    const _FLEXI_MODAL_ID = '_fle_flexi_script_modal';

    function FlexiScript() {
        this.addProperty('inputs_def',  '',                      'string');
        this.addProperty('outputs_def', 'result',                'string');
        this.addProperty('code',        'return { result: null };', 'string');
        this.addWidget('text',   'input ports',       '',       v => { this.properties.inputs_def  = v; this._rebuildPorts(); }, { property: 'inputs_def' });
        this.addWidget('text',   'output ports',      'result', v => { this.properties.outputs_def = v; this._rebuildPorts(); }, { property: 'outputs_def' });
        this.addWidget('button', '✏  Edit code', null,   () => this._openEditor());
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color   = '#1e3a5f';
        this.bgcolor = '#1e40af';
        this.size    = [240, 130];
        this._rebuildPorts();
    }
    FlexiScript.title = 'Script';
    FlexiScript.desc  = 'Configurable JS script: dynamic inputs/outputs, modal editor, error output';
    FlexiScript.portHelp = {
        inputs: {
            trigger: "Trigger (ACTION) — the script runs ONLY in response to this, never automatically on every graph execution (an upstream event is needed, e.g. Time/Timer or an Events/* node).",
            "*": "One slot for every name listed in the 'input ports' widget (CSV, e.g. 'pts, radius') — any type, available in the code as a variable with the same name.",
        },
        outputs: {
            done: "EVENT emitted if the script ends WITHOUT errors (alternative to 'error', never both on the same trigger).",
            "*": "One slot for every name listed in the 'output ports' widget (default 'result') — set from what the script returns with `return { name: value, ... }` (or directly a value if only one output is declared).",
            error: "EVENT always present as the LAST output — fires with the error message as parameter if the code throws an exception, instead of 'done'.",
        },
    };

    FlexiScript.prototype._parseNames = function (str) {
        return (str || '').split(',').map(s => s.trim()).filter(Boolean);
    };

    FlexiScript.prototype._rebuildPorts = function () {
        const wantIn  = this._parseNames(this.properties.inputs_def);
        const wantOut = [...this._parseNames(this.properties.outputs_def), 'error']; // 'error' sempre ultima

        const curIn  = this.inputs.slice(1).map(p => p.name);
        const curOut = this.outputs.slice(1).map(p => p.name);

        // No-op se la forma non è cambiata: preserva i link esistenti sulle
        // porte dinamiche. Senza questo controllo, ogni riapertura di un flow
        // salvato richiama onConfigure → _rebuildPorts() che smontava e
        // rimontava tutte le porte da zero (removeInput/removeOutput
        // disconnettono il link nel grafo; addInput/addOutput ne creano di
        // nuove senza link) ANCHE quando il testo di 'input ports'/'output
        // ports' non era affatto cambiato — un filo collegato a una porta
        // dinamica (es. 'points') risultava quindi sempre scollegato al
        // ricaricamento del flow, indipendentemente dal nodo a monte.
        const inChanged  = curIn.length  !== wantIn.length  || curIn.some((n, i) => n !== wantIn[i]);
        const outChanged = curOut.length !== wantOut.length || curOut.some((n, i) => n !== wantOut[i]);
        if (!inChanged && !outChanged) return;

        if (inChanged) {
            while (this.inputs.length > 1) this.removeInput(this.inputs.length - 1);
            for (const name of wantIn) this.addInput(name, 0);
        }
        if (outChanged) {
            while (this.outputs.length > 1) this.removeOutput(this.outputs.length - 1);
            for (const name of wantOut) this.addOutput(name, 0);
        }
        this.setDirtyCanvas(true, true);
    };

    FlexiScript.prototype.onConfigure = function () {
        this._rebuildPorts();
    };

    FlexiScript.prototype._openEditor = function () {
        let modal = document.getElementById(_FLEXI_MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id        = _FLEXI_MODAL_ID;
            modal.className = 'modal fade';
            modal.tabIndex  = -1;
            modal.innerHTML = `
<div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-centered">
  <div class="modal-content" style="background:#0f172a;color:#e2e8f0;border:1px solid #334155">
    <div class="modal-header py-2 border-0">
      <span class="fw-semibold">Script — editor</span>
      <button type="button" class="btn-close btn-close-white ms-auto" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body p-2">
      <div class="text-secondary small mb-1" id="${_FLEXI_MODAL_ID}_hint"></div>
      <textarea id="${_FLEXI_MODAL_ID}_ta"
        class="form-control font-monospace border-0"
        style="height:420px;resize:vertical;font-size:13px;line-height:1.6;
               background:#1e293b;color:#e2e8f0;tab-size:4;outline:none"
        spellcheck="false" autocomplete="off" autocorrect="off"></textarea>
    </div>
    <div class="modal-footer py-2 border-0">
      <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
      <button type="button" class="btn btn-sm btn-primary" id="${_FLEXI_MODAL_ID}_save">Save</button>
    </div>
  </div>
</div>`;
            document.body.appendChild(modal);

            modal.querySelector(`#${_FLEXI_MODAL_ID}_ta`).addEventListener('keydown', e => {
                if (e.key !== 'Tab') return;
                e.preventDefault();
                const ta = e.target, s = ta.selectionStart, end = ta.selectionEnd;
                ta.value = ta.value.substring(0, s) + '    ' + ta.value.substring(end);
                ta.selectionStart = ta.selectionEnd = s + 4;
            });
        }

        const ta   = modal.querySelector(`#${_FLEXI_MODAL_ID}_ta`);
        const hint = modal.querySelector(`#${_FLEXI_MODAL_ID}_hint`);
        ta.value = this.properties.code;

        const ins  = this._parseNames(this.properties.inputs_def);
        const outs = this._parseNames(this.properties.outputs_def);
        hint.textContent =
            'Input: ' + (ins.length ? ins.join(', ') : '(none)') +
            '  ·  return { ' + (outs.length ? outs.join(', ') : 'result') + ': … }' +
            '  ·  vars: state shared between scripts (e.g. vars.log = (vars.log||[]).concat(x))';

        const oldBtn = modal.querySelector(`#${_FLEXI_MODAL_ID}_save`);
        const newBtn = oldBtn.cloneNode(true);
        oldBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', () => {
            this.properties.code = ta.value;
            bootstrap.Modal.getInstance(modal)?.hide();
        });

        (bootstrap.Modal.getInstance(modal) ?? new bootstrap.Modal(modal)).show();
        modal.addEventListener('shown.bs.modal', () => ta.focus(), { once: true });
    };

    FlexiScript.prototype.onAction = function () {
        const ins    = this._parseNames(this.properties.inputs_def);
        const outs   = this._parseNames(this.properties.outputs_def);
        const errIdx = 1 + outs.length; // 'error' è sempre l'ultima porta (vedi _rebuildPorts)
        const argValues = ins.map((_, i) => this.getInputData(i + 1)); // +1: skip trigger

        // 'vars' = graph.vars (stesso storage di Params/Variables/Set|Get, ex Params/Var/Set|Get, vedi commento
        // sopra): parametro implicito per condividere stato tra script diversi.
        // Non aggiunto se l'utente ha già dichiarato un input chiamato 'vars'
        // (eviterebbe un duplicate parameter name → SyntaxError in strict mode).
        const hasOwnVars = ins.includes('vars');
        const paramNames = hasOwnVars ? ins : [...ins, 'vars'];
        const graphVars = this.graph ? (this.graph.vars = this.graph.vars || {}) : {};
        const paramValues = hasOwnVars ? argValues : [...argValues, graphVars];

        // Cache della funzione compilata (2026-09-28): si ricompila solo se
        // cambiano codice o nomi degli input, non ad ogni trigger. Un errore
        // di sintassi non va in cache: new Function rilancia e finisce nel
        // catch sotto come prima (stesso output 'error').
        const fnKey = paramNames.join(',') + '\n' + this.properties.code;
        let result;
        try {
            if (this._fnKey !== fnKey) {
                // eslint-disable-next-line no-new-func
                this._fn    = new Function(...paramNames, `"use strict";\n${this.properties.code}`);
                this._fnKey = fnKey;
            }
            result = this._fn(...paramValues);
        } catch (err) {
            console.error('[FlexiScript] error:', err);
            this._lastError = err?.message || String(err);
            this.setDirtyCanvas(true, true);
            this.triggerSlot(errIdx, this._lastError);
            return;
        }

        this._lastError = null;
        if (result !== null && result !== undefined && typeof result === 'object' && !Array.isArray(result)) {
            outs.forEach((name, i) => this.setOutputData(i + 1, result[name]));
        } else if (outs.length === 1) {
            this.setOutputData(1, result);
        }
        this.triggerSlot(0);
        this.setDirtyCanvas(true, true);
    };

    FlexiScript.prototype.onDrawForeground = function (ctx) {
        const lines = this.properties.code.trim().split('\n').slice(0, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font      = '10px monospace';
        lines.forEach((l, i) => ctx.fillText(l.substring(0, 28), 6, this.size[1] - 20 + i * 13));
        if (this._lastError) {
            ctx.fillStyle = '#f87171';
            ctx.font      = 'bold 10px monospace';
            ctx.fillText('⚠ ' + this._lastError.substring(0, 32), 6, this.size[1] - 6);
        }
    };

    LG.registerNodeType('Script/Flexi', FlexiScript);


    // =========================================================================
    // Media/Audio/MIDI/Util/Load Audiosynth & Load MidiParser (2026-09-20, su
    // richiesta esplicita) — caricano dinamicamente, SOLO quando uno di questi
    // nodi è presente in un grafo aperto, le due librerie terze che 'MIDI
    // Play'/'MIDI fromFile' richiedono ma che questo progetto non carica mai a
    // livello di dashboard.php (vedi audit Help sui nodi MIDI, stesso giorno):
    // niente sovraccarico per i grafi che non fanno audio/MIDI.
    // ─────────────────────────────────────────────────────────────────────────
    // Design a NODI SEPARATI (non incorporato dentro Play/fromFile stessi) su
    // richiesta esplicita dell'utente: l'uscita del loader è una vera porta
    // LiteGraph da collegare all'ingresso nuovo aggiunto su Play/fromFile (vedi
    // sotto) — questo rende il meccanismo genuinamente SOSTITUIBILE: un futuro
    // loader diverso (es. un'altra libreria di sintesi, o un altro parser MIDI)
    // può collegarsi allo stesso ingresso, basta che esponga la stessa
    // interfaccia (.play(nota,ottava,durata,volume) per il synth, .parse(Uint8Array)
    // per il parser) — non è un caso speciale cablato per queste due librerie.
    // Se l'ingresso non è collegato, Play/fromFile si comportano ESATTAMENTE
    // come prima (controllano la libreria globale, restano rotti se assente):
    // zero regressioni per i grafi che non usano i loader.
    // Cache di caricamento condivisa a livello di pagina (non per-grafo): più
    // istanze dello stesso loader, anche in grafi diversi aperti sulla stessa
    // pagina, scaricano lo script una volta sola (Promise cache per URL).
    // =========================================================================

    const _scriptLoadCache = {};
    function _loadScriptOnce(url) {
        if (!_scriptLoadCache[url]) {
            _scriptLoadCache[url] = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = url;
                s.onload  = () => resolve();
                s.onerror = () => reject(new Error(`Unable to download ${url}`));
                document.head.appendChild(s);
            });
        }
        return _scriptLoadCache[url];
    }

    const _AUDIOSYNTH_CDN  = 'https://cdn.jsdelivr.net/gh/keithwhor/audiosynth@master/audiosynth.js';
    const _MIDIPARSER_CDN  = 'https://cdn.jsdelivr.net/gh/colxi/midi-parser-js@master/src/main.js';

    function LoadAudiosynth() {
        this.addProperty('instrument', 'piano', 'string');
        this.addWidget('combo', 'instrument', 'piano', v => {
            this.properties.instrument = v;
            this._buildInstrument();
        }, { values: ['piano', 'organ', 'acoustic', 'edm'], property: 'instrument' });
        this.addOutput('synth', 'audiosynth');
        this.color   = '#1e3a5f';
        this.bgcolor = '#1e40af';
        this.size    = [200, 70];
        this._synth      = null;
        this._instrument = null;
        this.boxcolor = '#FA3';   // giallo: caricamento in corso
        this._load();
    }
    LoadAudiosynth.title = 'Load Audiosynth';
    LoadAudiosynth.desc  = "Dynamically loads the Audiosynth.js library (github.com/keithwhor/audiosynth, via jsDelivr) ONLY when this node is present in an open graph — it does not touch dashboard.php. Once ready, it creates the instrument chosen in the 'instrument' widget (piano/organ/acoustic/edm) and exposes as output the object ready to be connected to the 'instrument' input of 'MIDI Play'. Box: yellow=loading, green=ready, red=network error.";
    LoadAudiosynth.portHelp = {
        outputs: { synth: "The chosen AudioSynth.createInstrument(...) instance — object with a .play(note, octave, duration, volume) method. null until the library has finished loading." },
    };
    LoadAudiosynth.prototype._load = async function () {
        try {
            if (typeof AudioSynth === 'undefined') {
                await _loadScriptOnce(_AUDIOSYNTH_CDN);
            }
            this._synth = new AudioSynth();
            this._buildInstrument();
            this.boxcolor = '#9F9';
        } catch (err) {
            this.boxcolor = 'red';
            console.error('[Load Audiosynth]', err);
        }
    };
    LoadAudiosynth.prototype._buildInstrument = function () {
        if (!this._synth) return;
        this._instrument = this._synth.createInstrument(this.properties.instrument);
    };
    LoadAudiosynth.prototype.onExecute = function () {
        this.setOutputData(0, this._instrument);
    };
    LG.registerNodeType('Media/Audio/MIDI/Util/Load Audiosynth', LoadAudiosynth);


    function LoadMidiParser() {
        this.addOutput('parser', 'midiparser');
        this.color   = '#1e3a5f';
        this.bgcolor = '#1e40af';
        this.size    = [190, 50];
        this._parser = null;
        this.boxcolor = '#FA3';   // giallo: caricamento in corso
        this._load();
    }
    LoadMidiParser.title = 'Load MidiParser';
    LoadMidiParser.desc  = "Dynamically loads the midi-parser-js library (github.com/colxi/midi-parser-js, via jsDelivr) ONLY when this node is present in an open graph — it does not touch dashboard.php. It exposes as output the module ready to be connected to the 'parser' input of 'MIDI fromFile'. Box: yellow=loading, green=ready, red=network error.";
    LoadMidiParser.portHelp = {
        outputs: { parser: "The MidiParser module — object with a .parse(Uint8Array) method that returns the tracks/events structure of the MIDI file. null until the library has finished loading." },
    };
    LoadMidiParser.prototype._load = async function () {
        try {
            if (typeof MidiParser === 'undefined') {
                await _loadScriptOnce(_MIDIPARSER_CDN);
            }
            this._parser = MidiParser;
            this.boxcolor = '#9F9';
        } catch (err) {
            this.boxcolor = 'red';
            console.error('[Load MidiParser]', err);
        }
    };
    LoadMidiParser.prototype.onExecute = function () {
        this.setOutputData(0, this._parser);
    };
    LG.registerNodeType('Media/Audio/MIDI/Util/Load MidiParser', LoadMidiParser);


    // Patch su 'MIDI Play' (midi/play) e 'MIDI fromFile' (midi/fromFile) —
    // classi NATIVE, patchate con lo stesso meccanismo già usato per
    // _setCanvasTitle (wrap di onNodeCreated): aggiungono un ingresso in più
    // per accettare la libreria dal loader, SENZA toccare il comportamento
    // di fallback nativo (se l'ingresso non è collegato, tutto resta come
    // documentato nell'audit Help — controllo sulla libreria globale, rosso
    // se assente).
    {
        const playCls = _builtIn['midi/play'];
        if (playCls) {
            const prevCreated = playCls.prototype.onNodeCreated;
            playCls.prototype.onNodeCreated = function () {
                if (prevCreated) prevCreated.call(this);
                this._instrumentInputIndex = this.inputs.length;
                this.addInput('instrument', 'audiosynth');
            };
            const prevOnAction = playCls.prototype.onAction;
            playCls.prototype.onAction = function (event, midi_event) {
                const external = this.getInputData(this._instrumentInputIndex);
                if (external) this.instrument = external;
                prevOnAction.call(this, event, midi_event);
            };
            // desc/portHelp definitivi già impostati nel blocco Help
            // "Media/Audio/MIDI" più sopra in questo file (aggiornati insieme
            // a questa patch, stesso giorno) — non riassegnati qui per non
            // duplicare la stessa informazione in due punti del codice.
        }

        const fromFileCls = _builtIn['midi/fromFile'];
        if (fromFileCls) {
            const prevCreated2 = fromFileCls.prototype.onNodeCreated;
            fromFileCls.prototype.onNodeCreated = function () {
                if (prevCreated2) prevCreated2.call(this);
                this._parserInputIndex = this.inputs.length;
                this.addInput('parser', 'midiparser');
            };
            const origLoadMIDIFile = fromFileCls.prototype.loadMIDIFile;
            fromFileCls.prototype.loadMIDIFile = function (url) {
                const externalParser = this.getInputData(this._parserInputIndex);
                if (!externalParser) { origLoadMIDIFile.call(this, url); return; }
                const that = this;
                LiteGraph.fetchFile(url, "arraybuffer", function (data) {
                    that.boxcolor = "#AFA";
                    that._midi = externalParser.parse(new Uint8Array(data));
                    if (that.properties.autoplay) that.play();
                }, function () {
                    that.boxcolor = "#FAA";
                    that._midi = null;
                });
            };
            // desc/portHelp definitivi già impostati nel blocco Help
            // "Media/Audio/MIDI" più sopra in questo file (aggiornati insieme
            // a questa patch, stesso giorno) — non riassegnati qui per non
            // duplicare la stessa informazione in due punti del codice.
        }
    }


    // Registra nodi OSD, PJS, Local e MPS (disponibili in tutti i flow,
    // anche senza panel attivo — servono comunque _appContext per funzionare
    // davvero, ma devono comparire nel menu contestuale e nei grafi caricati
    // da subito, non solo dopo "Testa su panel"/un flow embedded reale).
    // I vecchi nodi ReseArch/Bus/Emit-On/* (Bus-flow-nodes.mjs) sono stati
    // rimossi il 2026-08-25: ridondanti con App Emitter/Receiver e Local
    // Emitter/Receiver (routing per topic), che coprono lo stesso bisogno con
    // un solo nodo generico invece di uno per ogni evento fisso.
    registerPJSFlowNodes();
    registerOSDFlowNodes();
    registerAppBusFlowNodes();
    registerMPSFlowNodes();
    registerDBJFlowNodes();
    registerGSHFlowNodes();
    registerMYSFlowNodes();
    registerPDFFlowNodes();
    registerECHFlowNodes();
    registerHYSFlowNodes();
    registerHTMFlowNodes();   // HTM/DOM/* e HTM/HYS/* (scheda esercitazione) nel menu fin da subito
    registerJSXFlowNodes();   // JSX/Script (2026-09-28): sostituisce i file .mjs dei modelli JSX
    registerTMLFlowNodes();   // TML/* timeline (2026-10-07), vedi _doc/module-tml-timeline.md §6
    registerIFCFlowNodes();   // IFC/* BIM (2026-11-04), vedi _doc/module-ifc-bim.md §2.5
    registerOLYFlowNodes();   // OLY/* cartografia (2026-11-04), vedi _doc/module-oly-openlayers.md §10
    registerLoopNodes(LG);    // Flow/Loop/* + Params/Array/Series (2026-10-03), vedi FLE-loop-nodes.mjs
    registerContextNodes(LG); // ReseArch/Context/Library (2026-10-04), vedi FLE-context-nodes.mjs
    registerImageNodes(LG);   // Media/Image/Load, Media/Image/Info (2026-10-04), vedi FLE-image-nodes.mjs
    registerErrorNodes(LG);   // Flow/Error Info (2026-10-04), vedi FLE-error-nodes.mjs
    registerStartNodes(LG);   // Flow/Events/OnStart (2026-10-07), vedi FLE-start-nodes.mjs
    registerTreeNodes(LG);    // Params/Data/Tree Filter (2026-10-07), vedi FLE-tree-nodes.mjs
    registerServiceNodes(LG); // ReseArch/Context/Service, AI/Ollama/Chat (2026-10-04), vedi FLE-service-nodes.mjs
    registerComfyNodes(LG);   // AI/ComfyUI/Run, AI/ComfyUI/Receive (2026-10-04), vedi FLE-comfyui-nodes.mjs
    registerDeviceNodes(LG);  // ReseArch/Context/Device, IoT/* (2026-10-12), vedi FLE-device-nodes.mjs
    registerSignalNodes(LG);  // IoT/Smooth|Map Range|Throttle|Calibrate (2026-10-12), vedi FLE-signal-nodes.mjs
    registerTextNodes(LG);    // Debug/Text View (2026-10-04), vedi FLE-text-nodes.mjs
    registerWebNodes(LG);     // String/Split List, Flow/Switch, Web/URL/*, Web/Open Window, Web/Wikipedia/Article (2026-10-21), vedi FLE-web-nodes.mjs

    // =========================================================================
    // Patch ordine categorie + separatori visivi nel menu contestuale.
    // LiteGraph ordina le categorie alfabeticamente; questo override restituisce
    // l'ordine desiderato e inserisce categorie-separatore tra i gruppi.
    // I separatori appaiono come cartelle espandibili con un unico nodo inerte
    // (non aggiungibile in modo utile al canvas).
    // =========================================================================
    if (!LG._fleMenuPatched) {
        LG._fleMenuPatched = true;

        // Separatori visivamente identici ma con path distinti (stessa
        // lunghezza dei tratti, ma numero di caratteri diverso) — 4° aggiunto
        // 2026-09-20 per separare il nuovo gruppo Interface/Media/Network.
        const _SEP_PATHS = [
            '─── ○ ───',
            '──── ○ ────',
            '───── ○ ─────',
            '────── ○ ──────',
        ];
        for (const sepCat of _SEP_PATHS) {
            const _Sep = function() { this.size = [200, 14]; };
            _Sep.title = '──────────────────';
            _Sep.desc  = '';
            _Sep.prototype.onExecute = function () {};
            LG.registerNodeType(sepCat + '/─', _Sep);
        }

        const _ORDERED = [
            // 'HTM' e 'HYS' aggiunte dopo 'MPS' (2026-09-26, su richiesta esplicita):
            // prima non erano in elenco e finivano in coda al menu, dopo 'Script'.
            'ReseArch', 'DBS', 'ECH', 'MPS', 'HTM', 'HYS', 'IFC', 'JSX', 'OLY', 'OSD', 'PDF', 'PJS', 'TJS', 'TML',
            _SEP_PATHS[0],
            // 'Sets' dissolto (2026-09-20, su richiesta esplicita) dentro
            // 'Params', che torna categoria top-level con sei sottocartelle
            // (Constants, Variables, Array, Object, Data, UI — ordine e
            // nesting corretti in un secondo tempo lo stesso giorno, erano
            // finiti top-level per errore).
            // 'Events' dissolto (2026-09-20, turno successivo, su richiesta
            // esplicita): 'Events/Time/*' promosso a top-level 'Time' (dopo
            // 'Logic'), 'Events/Flow/*' e 'Logic/Flow/*' spostati sotto il
            // 'Flow' principale (sottocartelle 'Events'/'Logic' — vedi
            // REMAP sopra), 'Events/Debug/Log' spostato in 'Debug/Log'.
            // Nessuna voce native/custom lascia 'Events' con qualcosa
            // dentro, quindi sparisce da sola dal menu (nessuna voce in
            // _HIDDEN necessaria).
            'Params', 'Time',
            _SEP_PATHS[1],
            // 'String' spostato qui dal gruppo Sets/Logic/Events (2026-09-20,
            // su richiesta esplicita) — funzioni pure, stessa famiglia di
            // Maths/Geometry/Vector.
            // 'Geometry' rimossa dall'elenco (2026-09-20): la categoria
            // nativa geometry/* è stata tolta dal REMAP sopra, nessun nodo
            // la usa più — voce diventata innocua ma inutile da tenere qui.
            // 'Logic' spostata QUI (2026-09-20, turno successivo, su
            // richiesta esplicita) — prima viveva nel gruppo Params/Time:
            // raccoglie funzioni/operatori (Bool/Numeric/String), non
            // parametri, quindi la sua famiglia naturale è questa
            // (Maths/Logic/String/Vector). Guadagna anche 'Logic/String'
            // (Compare/Contains, spostati da 'String' principale — vedi
            // REMAP sopra).
            'Maths', 'Logic', 'String', 'Vector',
            _SEP_PATHS[2],
            // Nuovo gruppo (2026-09-20, su richiesta esplicita): 'File IO'
            // spostata qui (prima di 'Interface', dove viveva accanto a
            // Params/Sets, ora dissolti), 'Interface' (dispositivi input
            // fisici, solo Gamepad per ora — spostato da Params/UI), 'Media'
            // (immagini/video/audio/canvas — assorbe gli ex gruppi 'Display'
            // e 'Audio', dissolti), 'Network' (spostata qui dall'ultimo
            // gruppo, dove stava vicino a nodi non imparentati).
            // 'Network' tolta (2026-09-28): i nodi nativi sono stati rimossi,
            // la voce vive ora sotto 'ReseArch/Network'.
            // 'AI' (2026-10-04): nodi che usano servizi esterni (Ollama, poi ComfyUI)
            // 'IoT' (2026-10-12): dispositivi ESP8266/ESP32/Arduino (_doc/arch-iot-dispositivi.md)
            // 'Web' (2026-10-21): indirizzi, controllo iframe, nuova scheda, Wikipedia (FLE-web-nodes.mjs)
            'File IO', 'Interface', 'IoT', 'Media', 'Web', 'AI',
            _SEP_PATHS[3],
            // 'Cluster' spostato qui (2026-09-20, su richiesta esplicita) —
            // dal gruppo Params, dove viveva accanto a Sets/Logic/Events, a
            // questo insieme a Script/Flow. 'Debug' è il nuovo gruppo
            // diagnostica (Alert/Console/Inspect/Plot/Progress/Watch, ex
            // sparsi sotto Display). 'Flow' aggiunta esplicitamente insieme
            // (stesso motivo di 'File IO' sopra: senza una voce in _ORDERED
            // finiva in coda in ordine arbitrario — sono i nodi custom
            // Flow/Hub, Flow/Trigger Pass|Gate, Flow/Wireless Out|In di
            // FLE-nodes.mjs).
            'Cluster', 'Debug', 'Flow', 'Script',
        ];

        // Categorie da nascondere completamente (spostate altrove o obsolete).
        // 'Bus' non combacia più con nulla dal 2026-08-25 (i nodi Bus/Emit-On
        // erano già sotto 'ReseArch/Bus/*', mai stati un top-level 'Bus' —
        // e ora sono comunque rimossi, vedi registerFlowNodes() sopra):
        // lasciato per sicurezza, innocuo se non combacia con nessuna categoria.
        const _HIDDEN = new Set(['Bus', 'Math3d', 'math3d']);

        // Costruisce il Set dei path di categoria completi (es. 'ReseArch/App',
        // 'Constants') ispezionando registered_node_types.
        // LiteGraph imposta cls.category = path senza l'ultimo segmento,
        // quindi usiamo lastIndexOf('/') — stesso criterio interno di LiteGraph.
        function _buildActual(filter) {
            const cats = new Set();
            const types = LG.registered_node_types;
            for (const path in types) {
                const cls = types[path];
                if (cls?.skip_list) continue;
                if (filter && cls?.filter !== filter) continue;
                const last = path.lastIndexOf('/');
                if (last > 0) cats.add(path.substring(0, last));
            }
            return cats;
        }

        // FIX (2026-09-20): 'matching.sort()' ordinava le SOTTOCARTELLE di un
        // gruppo sempre alfabeticamente (es. 'Params/Array' < 'Params/Constants'
        // < ... < 'Params/Variables'), ignorando l'ordine "logico" voluto —
        // stesso bug-famiglia di quello sui titoli/ordine leaf, causa diversa
        // (qui è un .sort() esplicito nostro, non un comportamento di default
        // di LiteGraph). Mappa di ordine esplicito per le sottocartelle dirette
        // di un gruppo top-level: usata al posto del sort alfabetico quando
        // presente; qualunque sottocartella non elencata finisce comunque in
        // fondo (mai persa, solo non prioritizzata).
        const _SUB_ORDER = {
            Params: ['Constants', 'Variables', 'Array', 'Object', 'Data', 'UI'],
            Media:  ['Audio', 'Image', 'Video', 'Tools'],
            // 'Flow' guadagna due sottocartelle (2026-09-20, su richiesta
            // esplicita — ex Events/Flow e Logic/Flow). I nodi custom già
            // in 'Flow' (Hub, Trigger Pass|Gate, Wireless Out|In) non sono
            // sottocartelle: LiteGraph li elenca comunque DOPO le
            // sottocartelle nel menu (limite nativo, non di questo file —
            // stesso motivo per cui 'Media/Canvas'/'Frame' finiscono dopo
            // le sottocartelle di 'Media').
            Flow: ['Events', 'Logic', 'Loop'],
            // Aggiunta difensiva (2026-09-20): coincide oggi con l'ordine
            // alfabetico di default, ma esplicitarla evita di ricadere nello
            // stesso bug-famiglia se un domani cambiasse (già successo 3
            // volte in questa sessione fidandosi del fallback alfabetico).
            Logic: ['Bool', 'Numeric', 'String'],
        };
        function _subOrderRank(catPath, orderedPrefix, subOrder) {
            const head = catPath.slice(orderedPrefix.length + 1).split('/')[0];
            const idx = subOrder.indexOf(head);
            return idx === -1 ? subOrder.length : idx;
        }

        LG.getNodeTypesCategories = function (filter) {
            const actual = _buildActual(filter);

            const result = [];

            for (const ordered of _ORDERED) {
                if (_SEP_PATHS.includes(ordered)) {
                    // Separatore: inserito direttamente senza controllo in actual
                    result.push(ordered);
                    continue;
                }
                // Tutte le categorie complete il cui top-level corrisponde a ordered
                const prefix = ordered + '/';
                const matching = [...actual].filter(c => c === ordered || c.startsWith(prefix));
                const subOrder = _SUB_ORDER[ordered];
                if (subOrder) {
                    matching.sort((a, b) => {
                        const ra = _subOrderRank(a, ordered, subOrder);
                        const rb = _subOrderRank(b, ordered, subOrder);
                        return ra !== rb ? ra - rb : a.localeCompare(b);
                    });
                } else {
                    matching.sort();
                }
                result.push(...matching);
            }

            // Categorie non previste (future): append in coda, escluse quelle nascoste
            for (const cat of actual) {
                const tl = cat.split('/')[0];
                if (!_ORDERED.includes(tl) && !_HIDDEN.has(tl)) result.push(cat);
            }

            return result;
        };
    }

    // FIX (2026-09-20): l'ordine con cui i nodi appaiono DENTRO una cartella
    // (non l'ordine dei gruppi top-level, quello è _ORDERED sopra) segue
    // l'ordine di REGISTRAZIONE — verificato sul sorgente di LiteGraph,
    // LGraphCanvas.onMenuAdd chiama LiteGraph.getNodeTypesInCategory(), che
    // di default (auto_sort_node_types=false, mai attivato in questo
    // progetto) itera registered_node_types con un semplice `for...in`,
    // quindi nell'ordine di inserimento delle chiavi. Il loop del REMAP qui
    // sopra registra in blocco tutte le voci native di una categoria, ma i
    // nodi CUSTOM (Maker, Set/Get/List, ecc.) si registrano in un blocco di
    // codice separato più avanti in questo file, eseguito DOPO — finiscono
    // quindi sempre in fondo alla loro cartella, indipendentemente da dove
    // "logicamente" li si vorrebbe. Fix: ri-registra le chiavi interessate
    // nell'ordine voluto (delete + re-set, così l'insertion order cambia).
    function _reorderNodeTypes(prefix, orderedLeaves) {
        for (const leaf of orderedLeaves) {
            const fullType = prefix + '/' + leaf;
            const cls = LG.registered_node_types[fullType];
            if (!cls) continue;
            delete LG.registered_node_types[fullType];
            LG.registered_node_types[fullType] = cls;
        }
    }
    _reorderNodeTypes('Params/Variables', ['List', 'Get', 'Set', 'Ref']);
    _reorderNodeTypes('Params/Array',     ['Empty', 'Maker', 'Get [i]', 'Set [i]', 'Length']);
    _reorderNodeTypes('Params/Object',    ['Empty', 'Maker', 'ObjectVec3', 'Get Property', 'Set Property', 'Merge', 'Keys']);
    // Ordine alfabetico su richiesta esplicita (2026-09-20): 'Debug' mescola
    // nativi (REMAP, sopra) e custom (Note/Inspect, registrati altrove in
    // questo file) — stesso motivo per cui serve _reorderNodeTypes (Bug 2).
    // 'Flow/Events'/'Flow/Logic' sono tutti nativi ma l'ordine di
    // registrazione nel REMAP non era alfabetico.
    _reorderNodeTypes('Debug',       ['Alert', 'Console', 'Inspect', 'Inspect Multi', 'Log', 'Note', 'Paste Image', 'Plot', 'Progress', 'Watch']);
    _reorderNodeTypes('Flow/Events', ['Branch', 'Counter', 'Filter', 'Once', 'Semaphore', 'Sequence', 'Stepper', 'Trigger', 'WaitAll']);
    _reorderNodeTypes('Flow/Logic',  ['Branch', 'Bypass', 'Gate', 'IF', 'Selector', 'Sequence']);
}


// ============================================================
// Helper interno
// ============================================================

function _drawSubtitle(ctx, node, text) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font      = '10px monospace';
    ctx.fillText(text, 6, node.size[1] - 6);
}
