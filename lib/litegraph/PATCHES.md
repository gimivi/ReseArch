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
