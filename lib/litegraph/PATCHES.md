# Modifiche a LiteGraph.js 0.7.18

Ogni modifica al sorgente originale (`litegraph.js`, `litegraph.css`) va registrata qui, **una
voce per modifica**, e fatta in un commit dedicato. Nel codice, ogni punto modificato porta un
commento `// [ReseArch patch N] …` per ritrovarlo.

Formato di una voce:

```
## N — titolo breve  (versione 0.7.18-research.N, AAAA-MM-GG)
- File / funzione: …
- Problema: comportamento dell'originale e perché ci serve diverso
- Modifica: cosa è cambiato
```

---

## 0 — Copia originale  (versione 0.7.18-research.0, 2026-10-04)
- File: `litegraph.js`, `litegraph.css`, `LICENSE` copiati senza modifiche dal pacchetto npm
  `litegraph.js@0.7.18` (identici a quelli serviti da cdn.jsdelivr.net, verificato con sha256).
- Motivo: base di partenza del fork leggero, vedi `_doc/arch-litegraph.md`.

## 1 — Pin che blocca davvero il nodo  (versione 0.7.18-research.1, 2026-10-04)
- File / funzioni: `litegraph.js` — `LGraphCanvas.prototype.processMouseMove` (trascinamento dei
  nodi selezionati), `LGraphCanvas.prototype.processMouseUp` (rilascio: arrotondamento e aggancio
  alla griglia), `LGraphCanvas.prototype.getNodeMenuOptions` (voce di menu),
  `LGraphCanvas.prototype.drawNode` (segno grafico).
- Problema: la voce *Pin* imposta `flags.pinned`, ma nell'originale il flag impedisce solo di
  portare il nodo in primo piano al clic: il trascinamento sposta comunque tutti i nodi
  selezionati, nativi e custom. Il commento di `pin()` ("Forces the node to do not move") promette
  un comportamento che il codice non ha.
- Modifica: i nodi bloccati vengono saltati durante il trascinamento e non vengono arrotondati né
  agganciati alla griglia al rilascio; la voce di menu diventa "Unpin" quando il nodo è bloccato;
  un pallino arancio a destra nel titolo segnala il nodo bloccato. Gli altri nodi selezionati
  insieme a un nodo bloccato si spostano normalmente.

## 2 — Mode ridotto ad Active / Disabled  (versione 0.7.18-research.2, 2026-10-04)
- File / funzioni: `litegraph.js` — `LiteGraph.createNode` (registra `node._nativeMode`),
  `LGraphNode.prototype.configure` (normalizza la modalità caricata),
  `LGraphNode.prototype.triggerSlot` (niente eventi ai nodi disattivati),
  `LGraphCanvas.onMenuNodeMode` e pannello proprietà del nodo (solo due voci, nuove funzioni
  `LGraphCanvas.RESEARCH_MODES` / `researchModeLabel` / `researchModeValue`),
  `LGraphCanvas.prototype.drawNode` (velo "DISABLED").
- Problema: delle quattro modalità originali, con nodi che lavorano a evento (`onAction`)
  *Never* bloccava solo `onExecute` (gli eventi arrivavano comunque: il nodo non si spegneva),
  *On Trigger* chiamava `onExecute` al posto di `onAction` (i nodi smettevano di funzionare) e
  aggiungeva da sé le porte `onTrigger`/`onExecuted`, *On Event* non cambiava nulla.
- Modifica: il menu *Mode* offre solo **Active** e **Disabled**.
  - *Disabled* = `NEVER`, che ora blocca anche gli eventi (`triggerSlot` salta il nodo); il nodo
    appare velato con la scritta DISABLED.
  - *Active* = la **modalità nativa** del nodo, quella impostata dal suo costruttore e salvata in
    `node._nativeMode` alla creazione (non serializzata): `ALWAYS` per quasi tutti, ma `ON_EVENT`
    per `basic/console` e `ON_TRIGGER` per `logic/IF`, che senza la loro modalità si
    comporterebbero male (log a ogni ciclo, Branch che scatta a ogni ciclo).
  - Al caricamento, un nodo salvato in una modalità diversa da *Disabled* torna alla sua nativa.
- Verificato senza browser (Node + vm): evento non consegnato a un nodo disattivato e di nuovo
  consegnato dopo la riattivazione; modalità native; normalizzazione al caricamento;
  `_nativeMode` assente dal JSON.

## 3 — Porta d'errore  (versione 0.7.18-research.3, 2026-10-04)
- File / funzioni: `litegraph.js` — `LGraphNode.prototype.getConnectionPos` (posizione),
  `LGraphNode.prototype.computeSize` (altezza), `LGraphCanvas.prototype.drawNode` (disegno
  delle uscite: inizio dei widget; messaggio d'errore),
  `LGraphCanvas.prototype.getNodeMenuOptions` (voce di menu), nuove funzioni
  `LGraphNode.prototype.hasErrorOutput` / `findErrorSlot` / `showErrorOutput` /
  `triggerError` / `clearError`, `LGraphCanvas.onMenuNodeErrorOutput`,
  costante `LiteGraph.RESEARCH_ERROR_SLOT`.
- Problema: un'uscita `error` messa fra le uscite normali costringeva a scegliere fra due
  regole (error ultima / porte opzionali aggiunte in coda) e ogni nodo segnalava gli errori a
  modo suo, senza dire il motivo a chi era collegato.
- Modifica:
  - Un tipo di nodo dichiara `NodeType.error_output = true`. La porta `error` (EVENT, rossa,
    segno `research_error: true` sullo slot) **non esiste per default**: il menu del nodo offre
    "Show error" / "Hide error". Nascondere stacca i fili (con conferma se ce ne sono).
  - La porta è disegnata **in basso a destra, sotto i widget**, fuori dalla colonna delle uscite:
    `getConnectionPos` le dà la posizione sul fondo del nodo e ricompatta le altre uscite;
    `computeSize` aggiunge la sua riga sotto i widget; il disegno delle uscite non la conta
    per l'inizio dei widget. `showErrorOutput` conserva la dimensione scelta del nodo.
  - `node.triggerError(err)`: messaggio rosso in basso a sinistra del nodo (`node.research_error`),
    `console.warn`, ed evento sulla porta `error` se visibile, con parametro
    `{ message, node, title, type, time }`. `node.clearError()` toglie il messaggio.
  - Lo slot (con `research_error`) si salva nel flow come le altre porte.
- Verificato senza browser (Node + vm): porta assente per default, voce di menu, posizione
  sotto i widget, ricompattazione delle uscite aggiunte dopo, parametro dell'evento, salvataggio
  e ricaricamento, rimozione con stacco dei fili; patch 1-2 ancora verdi.

## 4 — Rotella: chiamata alla processMouseWheel attuale  (versione 0.7.18-research.4, 2026-10-04)
- File / funzioni: `litegraph.js` — `LGraphCanvas.prototype.bindEvents` (`_mousewheel_callback`).
- Problema: `bindEvents` collegava la rotella con `this.processMouseWheel.bind(this)`, cioè una copia
  fissata alla creazione del canvas. Una sostituzione fatta dopo (`model_FLE.mjs::_patchCursorZoom`:
  zoom centrato sul cursore e rotella passata ai nodi) non veniva mai chiamata.
- Modifica: il collegamento chiama `that_canvas.processMouseWheel(e)` al momento dell'evento, quindi
  usa la funzione attuale del canvas.
- Effetto: si attivano davvero lo zoom centrato sul cursore (scritto il 2026-09-21, mai entrato in
  funzione) e lo scorrimento con la rotella dei nodi che lo gestiscono (Debug/Text View, Debug/Inspect).
- Verificato senza browser (Node + jsdom): la rotella arriva alla funzione sostituita dopo
  `bindEvents`, per `mousewheel` e `DOMMouseScroll`.

## 5 — Copia e incolla attraverso gli appunti di sistema  (versione 0.7.18-research.5, 2026-10-05)
- File / funzioni: `litegraph.js` — `LGraphCanvas.prototype.copyToClipboard` (copia anche negli appunti
  di sistema), `LGraphCanvas.prototype.processKey` (Ctrl+V), nuova `LGraphCanvas.prototype.processPaste`
  (evento `paste` sul canvas, collegato in `bindEvents` e tolto in `unbindEvents`), nuove funzioni
  `LiteGraph.researchWriteSystemClipboard` / `researchParseNodesText`, costante
  `LiteGraph.RESEARCH_CLIPBOARD_FORMAT`.
- Problema: la copia di LiteGraph vive solo nel `localStorage` del browser (chiave
  `litegrapheditor_clipboard`): impossibile passare dei nodi a un altro browser o computer, o incollare un
  testo di nodi preparato altrove (es. i flow d'esempio).
- Modifica:
  - Ctrl+C scrive la stessa copia anche negli appunti di sistema (`navigator.clipboard.writeText`, con il
    campo `format: "litegraph-nodes"`); se non è possibile resta la copia interna.
  - Ctrl+V: il browser manda subito dopo il tasto l'evento `paste` con gli appunti (senza chiedere
    permessi); se il testo è un insieme di nodi LiteGraph viene incollato quello. Altrimenti (testo
    qualunque, o nessun evento `paste`) dopo 60 ms si incolla dalla copia interna come prima. Un solo
    incolla per tasto.
  - Accettati il formato della copia (con o senza `format`) e un **flow intero salvato**
    (`graph.serialize()`): i collegamenti per id vengono convertiti in collegamenti per indice.
- Verificato senza browser (Node + jsdom): copia negli appunti, incolla da appunti in un grafo nuovo
  (nodi, collegamento, impostazioni, posizione del mouse, una sola volta), ripiego sulla copia interna
  con testo qualunque o senza evento, flow intero convertito, testi non validi rifiutati; patch 1–4
  ancora verdi.

## 6 — Nodi di solo passaggio senza ciclo del grafo  (versione 0.7.18-research.6, 2026-10-17)
- File / funzioni: `litegraph.js` — nuova funzione interna `researchPassthroughData`, usata da
  `LGraphNode.prototype.getInputData` e `LGraphNode.prototype.getInputOrProperty`.
- Problema: `Flow/Hub` (FLE-nodes.mjs) inoltrava i dati con `onExecute`. Ma `triggerSlot` rimanda al
  giro successivo del ciclo gli eventi diretti a un nodo che ha `onExecute` (`use_deferred_actions`),
  e i flow dei pannelli (HTM, ECH, GSH…, tutti tranne TJS e OSD) non hanno il ciclo: gli eventi
  restavano fermi nell'Hub e i dati non passavano. Nell'editor, dove il ciclo gira, sembrava funzionare.
- Modifica: un nodo il cui costruttore ha `passthrough = true` è trasparente per i dati. Chi legge un
  ingresso collegato a quel nodo riceve il valore che entra nel suo primo ingresso, al momento, anche
  attraverso più nodi in fila (anello di nodi di passaggio: null, al più 32 passaggi). L'Hub non ha più
  `onExecute`, quindi gli eventi passano subito come con Flow/Events/Sequence.
- Verificato senza browser (Node + vm, grafo fermo): evento attraverso un Hub ricevuto subito, dato
  attraverso due Hub e diretto (`getInputOrProperty`) aggiornati a ogni evento, anello di Hub senza
  ricorsione infinita.

## 7 — Nodi di calcolo puri ricalcolati alla lettura  (versione 0.7.18-research.7, 2026-10-17)
- File / funzioni: `litegraph.js` — `researchPassthroughData` (patch 6), quindi `getInputData` e
  `getInputOrProperty`.
- Problema: i nodi di calcolo (Maths/Operators/*, Params/Object/ObjectVec3…) scrivono l'uscita solo in
  `onExecute`, cioè nel ciclo del grafo. Un nodo che agisce su un evento legge quindi il risultato del
  giro precedente (TJS: lo slider applica sempre il valore di prima, l'ultimo non arriva mai) oppure
  nessun risultato (pannelli senza ciclo: HTM, ECH…).
- Modifica: un nodo il cui costruttore ha `pure = true` viene ricalcolato (`onExecute`) nel momento in cui
  un altro nodo legge la sua uscita, risalendo anche più nodi puri in fila (al più 32 passaggi; nodo con
  modo "Never" escluso). `pure` va messo solo su nodi senza stato e senza tempo/caso: in FLE-nodes.mjs
  ObjectVec3 e i nativi math/operation, abs, floor, frac, clamp, lerp, smoothstep, scale, range,
  trigonometry, to_number, converter.
- Verificato senza browser (Node + vm, grafo fermo): testo "2.5" → to_number → operation (×−1) → vec
  {−r, r, −r} e range 0..100 → 1..0, tre eventi di fila, ognuno con i valori appena arrivati.

## 8 — Incolla con nodi di tipo sconosciuto  (versione 0.7.18-research.8, 2026-11-22)
- File / funzioni: `litegraph.js` — `LGraphCanvas.prototype.pasteFromClipboard`.
- Problema: i collegamenti negli appunti sono per indice del nodo nell'elenco. Un nodo di tipo non
  registrato (file del modulo non caricato sul server, cache del browser) veniva saltato e l'elenco si
  accorciava: tutti i fili dei nodi successivi finivano su nodi sbagliati o andavano persi, senza avviso
  (successo con il flow della dashboard meteo: Accumulate / Layer Add Points non ancora sul server).
- Modifica: il nodo sconosciuto lascia il suo posto vuoto (null); i suoi fili si perdono, gli altri
  restano giusti. Alla fine un avviso (console + alert) elenca i tipi non incollati.

## 9 — Subgraph: porte Cluster/Input e Cluster/Output  (versione 0.7.18-research.9, 2026-11-22)
- File / funzioni: `litegraph.js` — nuove `LiteGraph.researchNodeType`, `researchPortType`,
  `researchSameNamePorts`, `researchRenamePort`, `Subgraph.prototype.researchAddPort` /
  `researchRemovePort`; modificate `drawSubgraphPanelLeft/Right`, `showSubgraphPropertiesDialog(Right)`,
  `onMenuNodeToSubgraph`, `GraphInput.updateType/onPropertyChanged/onAction/onRemoved`,
  `GraphOutput.updateType/onPropertyChanged/onAction/onRemoved`.
- Problema:
  1. FLE svuota il registro e ri-registra `graph/input|output|subgraph` come `Cluster/*`, ma la
     libreria creava i nodi con i nomi originali scritti a mano: i riquadri "Graph Inputs/Outputs"
     dentro il subgraph non creavano niente ("graph input node not found").
  2. "+" e "✕" sotto il nodo Subgraph toccavano solo la porta esterna: nessun Cluster/Input|Output
     dentro, nessuna registrazione nel sottografo (dati mai passati), porte tolte che ricomparivano
     alla riapertura perché il nodo interno restava.
  3. Rinomina verso un nome già usato: errore in console ma il nodo prendeva comunque il nome, porta
     e nodo desincronizzati. Due Input con lo stesso nome (copia e incolla): eliminarne uno toglieva
     la porta anche all'altro.
  4. Tipo evento: l'ingresso inoltrava il trigger solo con tipo `-1`; l'uscita con "event"/"action"
     convertiva la porta ma non la proprietà, e `onAction` non inoltrava mai.
  5. `GraphInput.updateType` riportava il valore predefinito a 0/""/true a ogni caricamento.
- Modifica: tipi presi dalla classe registrata; "+" crea il nodo interno (la porta nasce dalla sua
  registrazione), "✕" elimina i nodi interni con quel nome; rinomina verso un nome usato rifiutata
  (il nodo torna al nome di prima), porta tolta solo se nessun altro nodo con lo stesso nome la usa;
  "event", "action", "-1" e -1 = evento per ingressi e uscite; valore predefinito conservato se è del
  tipo giusto. "To Subgraph" resta disattivato (`if(0)` nell'originale, `buildFromNodes` incompleto).
- Verificato senza browser (Node + vm, registro svuotato e ri-registrato come in FLE, 16 prove):
  "+" e "✕", evento dentro e fuori, rinomina e rifiuto, salvataggio e riapertura (porte una volta
  sola, valore conservato), copia con lo stesso nome, eliminazione dei nodi interni.

## 10 — Finestre di LiteGraph visibili in FLE  (versione 0.7.18-research.10, 2026-11-22)
- File / funzioni: `litegraph.js` — nuova `LGraphCanvas.prototype.researchMountPanel`, usata al posto
  di `canvas.parentNode.appendChild(panel)` in `showSubgraphPropertiesDialog(Right)`,
  `showShowNodePanel` e nel pannello "Options".
- Problema: le finestre di `createPanel` hanno stile solo dentro un elemento `.litegraph`
  (`.litegraph .dialog`: posizione, sfondo, dimensioni). In FLE il canvas non ha quell'antenato: la
  finestra restava statica in alto a sinistra, coperta dal canvas. I "+" del nodo Subgraph (fuori) e
  dei riquadri "Graph Inputs/Outputs" (dentro) sembravano non fare nulla; cliccando di nuovo subito,
  il doppio clic apriva il subgraph.
- Modifica: se il canvas non è dentro un `.litegraph`, la finestra va in un contenitore trasparente
  `.litegraph.research-panel-host` (assoluto sopra il canvas, `pointer-events: none`, la finestra sì),
  tolto alla chiusura della finestra.
- Verificato in Chrome headless con i nodi FLE e il canvas montato come in FLE: finestra "Subgraph
  Inputs" visibile e in primo piano (fuori e dentro il subgraph), aggiunta e "✕" di porte con i nodi
  interni (patch 9), nessun contenitore rimasto dopo la chiusura; screenshot controllato.

## 11 — Tipo delle porte: elenco a scelta, non vincolante  (versione 0.7.18-research.11, 2026-11-22)
- File / funzioni: `litegraph.js` — nuove `LiteGraph.RESEARCH_TYPES`, `researchTypeLabel`,
  `researchTypeValue`, `researchTypeChoices`, `researchAddTypeWidget`, `LGraphCanvas.researchTypeDatalist`;
  modificati i costruttori e `updateType` di `GraphInput`/`GraphOutput`, `researchAddPort`, le finestre
  "Subgraph Inputs/Outputs" e i riquadri "Graph Inputs/Outputs".
- Problema: il tipo di una porta si scriveva a mano senza sapere quali esistono; un ingresso nuovo era
  `number` senza dirlo; i tipi evento e generico comparivano come `-1` e `0`.
- Modifica: il campo Type di Cluster/Input e Cluster/Output è un widget "combo" (freccette + elenco):
  tipi più usati dai nodi della piattaforma, tipi delle porte già presenti nel flow (grafo radice e
  sottografi), in fondo "other…" che chiede un tipo libero. Nelle finestre del Subgraph il campo Type ha
  gli stessi suggerimenti (datalist, si può scrivere altro). Etichette: `*` = generico (salvato come
  ""), `event` = -1. Ingresso nuovo senza tipo = generico.
- Verificato in Chrome headless: elenco con il tipo personalizzato di un'altra porta, scelta dal widget,
  "other…" con prompt (il nuovo tipo entra nell'elenco), `*`, riapertura (`event` resta), suggerimenti
  della finestra, tipo vuoto = generico; screenshot controllato. Prove della patch 9 ancora tutte OK.

## 12 — Riordino delle porte del Subgraph  (versione 0.7.18-research.12, 2026-11-22)
- File / funzioni: `litegraph.js` — nuova `Subgraph.prototype.researchMovePort(kind, slot, delta)`;
  pulsanti ↑ ↓ in `showSubgraphPropertiesDialog` e `showSubgraphPropertiesDialogRight`.
- Problema: LiteGraph non sa spostare le porte di un nodo; per riordinare ingressi e uscite di un
  Subgraph bisognava eliminarli e ricrearli, perdendo i fili esterni.
- Modifica: ↑ ↓ su ogni riga delle finestre "Subgraph Inputs/Outputs" (dopo la ✕) scambiano la porta con
  la vicina e aggiornano gli indici salvati nei fili (`link.target_slot` per gli ingressi,
  `link.origin_slot` e `slot_index` per le uscite). Dentro non cambia nulla: porte e Cluster/Input|Output
  si abbinano per nome. L'ordine nuovo si salva con il nodo.
- Verificato senza browser (Node + vm, 17 prove): spostamenti di ingressi e uscite collegati, fili
  coerenti nei due versi, dato ed evento che passano ancora, limite sulla prima porta, salvataggio e
  riapertura. In Chrome headless: tre pulsanti per riga, ↓ e ↑ dalla finestra, fili che seguono la porta
  (screenshot controllato).

## 13 — Subgraph: dati ed eventi insieme; porte dei nodi incollati  (versione 0.7.18-research.13, 2026-11-23)
- File / funzioni: `litegraph.js` — `Subgraph.prototype.onAction`, `Subgraph.prototype.onSubgraphTrigger`,
  `GraphOutput.prototype.onAction`; nuove `GraphInput.prototype.onAdded`, `GraphOutput.prototype.onAdded`.
- Problema:
  1. Il Subgraph copiava ingressi e uscite dati solo in `onExecute` (un giro del ciclo alla volta), mentre
     gli eventi passano subito: chi riceveva il `done` di un Subgraph leggeva l'uscita dati del giro
     precedente (la prima volta null — "il subgraph non viene eseguito": grafo del fusto con LatheGeometry →
     Scene Add Object), e un evento in ingresso trovava i dati del giro precedente.
  2. Un Cluster/Input|Output incollato o clonato è configurato prima di entrare nel grafo
     (`pasteFromClipboard`, `clone`): la porta non veniva registrata e il nodo Subgraph restava senza porte.
- Modifica: evento in ingresso → prima i valori attuali degli ingressi dati vanno nel sottografo e i
  Cluster/Input dati si aggiornano; evento in uscita → prima ogni Cluster/Output dati legge il suo ingresso
  e il nodo Subgraph aggiorna le sue uscite dati, poi parte l'evento. `onAdded` registra (o condivide) la
  porta quando il nodo entra nel grafo.
- Verificato: Chrome headless con i nodi FLE e TJS veri e il ciclo acceso (grafo del fusto incollato in un
  Subgraph: porte create all'incolla, `Mesh:Fusto` già al primo evento come il grafo fuori); Node + vm:
  valore scritto insieme all'evento → uscita giusta a ogni evento ([2,10,14]; senza la patch [null,0,2]);
  prove delle patch 9 e 12 ancora tutte OK.

## 14 — Nodi nei cicli: valori nuovi a ogni calcolo, uscite aggiornate subito  (versione 0.7.18-research.14, 2026-11-24)
- File / funzioni: `litegraph.js` — `researchPassthroughData` (patch 7); `onExecute` di `Math3DXYToVec2`,
  `Math3DXYZToVec3`, `Math3DXYZWToVec4`, `Math3DVec3Scale`, `Math3DVec3Normalize`, `Math3DVec3Lerp`,
  `MathOperation`, `ConstantArray`, `SetArray`, `SetObject`, `MergeObjects`; nuova `Variable.pure`;
  `onAction` di `Stepper`, `EventCounter`, `DataStore`.
- Problema (Repeat → calcoli → Collect):
  1. i nodi sopra riscrivevano sempre lo stesso vettore, array o oggetto: Collect riceveva N volte lo stesso
     riferimento e tutti gli elementi valevano come l'ultimo;
  2. Counter, Stepper (`index`), Data Store e Ref in lettura scrivevano l'uscita solo in `onExecute`: dentro
     un ciclo sincrono restava ferma al valore precedente;
  3. Array Set [i] non aveva l'ingresso dell'indice e con indice 0 non scriveva mai.
- Modifica:
  1. valore nuovo a ogni calcolo. Set Property lavora su una copia (oggetti semplici e array; le istanze di
     classi, es. Three.js, restano modificate sul posto). Merge tiene l'accumulo interno, in uscita una copia.
     Array Set [i] continua a modificare l'array in ingresso;
  2. uscita scritta in `onAction`, prima dell'evento. Data Store legge `data` al momento di `assign`.
     `pure` può essere una funzione (nodo) → boolean: Ref è puro solo quando legge (in scrittura ogni lettura
     ripeterebbe la scrittura, es. x = x + 1);
  3. ingresso `index` (i nodi salvati lo ricevono alla riapertura), valgono gli indici ≥ 0.
- Non toccati: Maths Accumulate, Var Set/Get (la memoria è il loro scopo: non ripartono a ogni avvio).
- Verificato senza browser (Node, nodi FLE veri): 25 prove, più scaletta, griglia e censimento dei nodi di
  calcolo tra Repeat e Collect (nessun elemento ripetuto); Ref x = x + 1 cresce di 1 a ciclo come prima.

## 15 — Vector Lerp: ingresso f numerico  (versione 0.7.18-research.15, 2026-11-24)
- File / funzione: `litegraph.js` — costruttore di `Math3DVec3Lerp`.
- Problema: `f` (fattore 0..1) era dichiarato `vec3`, quindi nessun numero si poteva collegare.
- Modifica: tipo `number`. I nodi già salvati conservano il tipo vecchio: vanno reinseriti.
- Verificato in Node: numero collegato a `f`, risultato corretto per 0, 0.25 e 1.

## 16 — Subgraph: widget dei parametri  (versione 0.7.18-research.16, 2026-11-24)
- File / funzioni: `litegraph.js` — nuove `Subgraph.prototype.researchParamInputs`, `researchSyncWidgets`,
  `researchParamWidget`; modificate `computeSize`, `onDrawBackground`, `onDblClick` di Subgraph. GraphInput:
  proprietà `show_widget`, `min`, `max`, `step`, widget relativi, `researchNumberOptions`, `researchStep`,
  `researchNormalizeValue`, `researchUpdateWidgets`; modificati costruttore, `updateType`, `onPropertyChanged`.
- Problema: il valore predefinito di una porta (Value di Cluster/Input) si cambiava solo entrando nel
  sottografo.
- Modifica: un Cluster/Input number, string o boolean con "Show widget" acceso compare come widget sul nodo
  Subgraph, nell'ordine delle porte. Il widget legge e scrive il Value del Cluster/Input: nessun dato
  duplicato, si salva con il sottografo, ogni copia ha i suoi valori. Porta collegata: vince il filo, il
  widget è disattivato e mostra il valore che arriva. Numeri: min e max (vuoti = nessun limite; valgono per
  il widget, non per il filo), step = incremento di una freccetta. Doppio clic su un widget non apre il
  sottografo. Opzione spenta = nodo come prima.
- Verificato: Node con i nodi FLE veri (34 prove: valori, limiti, filo, rinomina, riordino, cambio di tipo,
  rimozione, salvataggio e riapertura, copia, stesso nome, evento, nodi salvati prima); Chrome headless con
  clic veri (freccette, interruttore, finestre di testo e numero, widget disattivato, spegnimento) e
  schermate controllate, pagina con il solo LiteGraph.
- Nota: trascinare un widget numerico non ne cambia il valore, qui come in tutti i nodi (nell'originale la
  riga che calcola `e.deltaX` in `adjustMouseEvent` è commentata).
