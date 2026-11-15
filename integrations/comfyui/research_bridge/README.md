# ReseArch Bridge per ComfyUI

Nodi personalizzati che collegano i workflow di ComfyUI ai flow della piattaforma ReseArch
(nodi `AI/ComfyUI/Run` e `AI/ComfyUI/Receive`). Progetto: `_doc/integrazione-comfyui.md` §9.

## Installazione (ComfyUI portable per Windows)

1. Copiare questa cartella `research_bridge` in
   `ComfyUI_windows_portable\ComfyUI\custom_nodes\`.
2. Consentire le richieste dalla pagina della piattaforma: duplicare il file di avvio
   (`run_nvidia_gpu.bat`, oppure `run_cpu.bat`) per esempio come `run_research.bat`, e aggiungere
   in fondo alla riga di avvio:
   ```
   .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --enable-cors-header https://www.dominio.it
   ```
   `--enable-cors-header` accetta **una** origine. Con più installazioni della piattaforma si può
   usare `*` (qualunque sito: da evitare se ComfyUI è raggiungibile da altri in rete).
3. Avviare ComfyUI con quel file. Nella console deve comparire il caricamento di
   `custom_nodes\research_bridge` senza errori; nel menu dei nodi c'è la categoria **ReseArch**.

Nessuna dipendenza da installare: usa solo librerie già presenti in ComfyUI.

## Il demo: ReseArch-Demo

Incluso nel pacchetto in due forme:
- `example_workflows/ReseArch-Demo.json`: il workflow da aprire in ComfyUI (menu dei modelli di
  workflow, *Templates*, sotto `research_bridge`). Text Input `prompt` → Text Output `text`, Image Input
  `image` → Image Output `image`, Publish `ReseArch-Demo`: il testo e l'immagine tornano uguali.
  Nessun modello né GPU: serve a provare il collegamento.
- `published/ReseArch-Demo.json`: la copia **già pubblicata**, quindi da ReseArch il demo funziona
  subito dopo l'installazione (nodo `AI/ComfyUI/Run`, `workflow` = `ReseArch-Demo`). Immagine di
  prova: `example.png`, inclusa in ComfyUI nella cartella `input`.

Per un workflow tuo partendo dal demo: *Save As* con un altro nome **e** nel nodo Publish un `name`
diverso da `ReseArch-Demo` (altrimenti la Queue sovrascrive la copia pubblicata del demo).

## Dove stanno i file

| File | Cartella | Nasce da |
|---|---|---|
| workflow modificabile (formato dell'interfaccia) | `ComfyUI/user/default/workflows/` | *Save* / *Save As* di ComfyUI |
| copia pubblicata (formato API, quella eseguita da ReseArch) | `custom_nodes/research_bridge/published/` | **Queue** con ReseArch Publish |

ReseArch esegue la copia pubblicata com'era all'ultima Queue: le modifiche a schermo arrivano solo
ripubblicando. La cartella si chiama `published` e non `workflows` perché ComfyUI tratta come esempi
dei pacchetti i `.json` delle cartelle `workflows`, `examples`… (le versioni precedenti usavano
`workflows/`: all'avvio il pacchetto sposta da solo quei file in `published/`).

## Aggiornare il pacchetto

Copiare i file nuovi **sopra** quelli esistenti e riavviare ComfyUI. **Non cancellare la cartella
`research_bridge/published/`**: contiene i workflow pubblicati. Se la si perde basta ripubblicarli
(aprire il workflow salvato e premere Queue); il demo torna con il pacchetto.

I workflow pubblicati **restano** dopo un riavvio di ComfyUI: sono file. Si ripubblica solo quando si
modifica il workflow. Nulla resta "in coda": Queue esegue il workflow una volta (e Publish salva il
file); ogni esecuzione da ReseArch mette in coda una copia nuova.

## Nodi

| Nodo | Uso |
|---|---|
| **ReseArch Text Input** | testo inviato da ReseArch (`key` + valore di prova) → STRING |
| **ReseArch Number Input** | numero inviato da ReseArch → FLOAT e INT (per il seed) |
| **ReseArch Image Input** | immagine inviata da ReseArch → IMAGE, MASK (immagine di prova dal menu) |
| **ReseArch Text Output** | rimanda un testo a ReseArch (`key`) |
| **ReseArch Number Output** | rimanda un numero (`key`) |
| **ReseArch Image Output** | rimanda un'immagine (`key`), salvata in `output/research/` |
| **ReseArch Model Output** | rimanda un modello 3D (`key`). Collegare **uno** fra: `mesh` (MESH, es. Hunyuan3D: convertita in GLB), `model_3d` (file 3D dei nodi recenti) o `model_file` (percorso già salvato, es. `glb_path` di MoGe). `folder`: dove salvare `mesh` / `model_3d` — `output` (in `output/research/`, permanente) o `temp` (cartella temporanea: ComfyUI può cancellarla in qualsiasi momento, **sconsigliata**). In ReseArch diventa l'URL del file |
| **ReseArch Depth Output** | rimanda la **mappa delle distanze** di una panoramica (`key`, es. `depth_exr`): ingresso `depth` = `moge_geometry` di *MoGe Panorama Inference* oppure `distance` di *DA2 Panorama Depth*. Salvata in `output/research/` come **EXR a 32 bit** (un canale `Y`, distanza dal punto di ripresa per pixel, 0 = non valido; scritto da `exr.py`, solo numpy/zlib). `units`: `auto` = `relative` sia per MoGe sia per DA2 (le panoramiche di MoGe fondono 12 viste **senza** la scala metrica, `apply_metric_scale=False`); `metric` solo per una mappa già in metri. Con `relative` in ReseArch si calibra con `TJS/Panorama/Depth Scale`. In ReseArch (kind `depth`) diventa l'URL dell'EXR, per `TJS/Panorama/Set Depth`: si misura sulla panoramica senza mesh |
| **ReseArch Publish** | `name`: eseguendo il workflow una volta (Queue) lo pubblica per ReseArch |

La `key` è il nome con cui ReseArch riconosce ingressi e uscite: diventa il nome delle porte del
nodo `AI/ComfyUI/Run`.

## Primo workflow: da testo a immagine

1. In ComfyUI aprire il workflow predefinito (testo → immagine).
2. Aggiungere **ReseArch Text Input** (`key` = `prompt`) e collegare la sua uscita `text`
   all'ingresso `text` del nodo *CLIP Text Encode* del prompt positivo.
3. (Facoltativo) **ReseArch Number Input** (`key` = `seed`): uscita `int` → `seed` del *KSampler*.
4. Aggiungere **ReseArch Image Output** (`key` = `image`) collegato all'uscita di *VAE Decode*.
5. Aggiungere **ReseArch Publish** (`name` = `testo-immagine`) e premere **Queue** una volta:
   il nodo scrive "Pubblicato…" e il workflow è disponibile per ReseArch.

In ReseArch: `ReseArch/Context/Service` (`type` = `comfyui`, `name` = `comfy`, url
`http://127.0.0.1:8188`) e `AI/ComfyUI/Run` (`workflow` = `testo-immagine`): compaiono gli
ingressi `prompt`, `seed` e l'uscita `image`.

## Da immagine a modello 3D (MoGe) verso TJS

1. In ComfyUI: **ReseArch Image Input** (`key` = `image`) → `image` di *MoGe Process*; uscita `glb_path`
   → `model_file` di **ReseArch Model Output** (`key` = `mesh`); **ReseArch Publish** (`name` = `moge`), Queue.
2. In ReseArch, nel **flow embedded di un oggetto TJS**: `ReseArch/Context/Service` (comfyui), un'immagine
   (es. `Media/Image/Load`) → ingresso `image` di **ComfyUI Run** (`workflow` = `moge`); uscita `mesh`
   (URL del file) → ingresso `url` di **TJS/Model/Load URL**, `done` di Run → `trigger` di Load URL.
   TJS carica glb/gltf, obj, ply (non stl, fbx, usdz).

## Da Hunyuan3D (MESH) verso TJS

L'uscita `MESH` di Hunyuan3D va **direttamente** all'ingresso `mesh` di ReseArch Model Output (non serve
*Create 3D File (from Mesh)*): la conversione in GLB usa la stessa funzione di ComfyUI e conserva
texture, colori e normali. Lasciare `folder` = `output`: con `temp` il file può essere cancellato
pochi secondi dopo, prima che ReseArch lo scarichi (osservato in una prova reale).

## Indirizzi aggiunti al server di ComfyUI

- `GET /research/info` — presenza del pacchetto
- `GET /research/workflows` — workflow pubblicati, con key e tipo di ingressi e uscite
- `GET /research/workflows/<nome>` — un workflow (formato API)
- `GET /research/file/<output|temp|input>/<percorso>` — un file con il suo nome vero nell'URL (i caricatori
  3D riconoscono il formato dall'estensione; `/view?filename=…` non basta). Solo file dentro quelle cartelle.

(ComfyUI li espone anche con il prefisso `/api`.) I workflow pubblicati stanno nella cartella
`published/` di questo pacchetto.

## Note

- Gli Output vengono rieseguiti a ogni esecuzione anche se il resto è in cache, perché ReseArch
  riceva sempre il risultato. `IS_CHANGED` restituisce un identificativo sempre diverso, **non**
  `float("nan")`: ComfyUI scrive quel valore nella storia del prompt e un `NaN` rende `/history` JSON
  non valido per il browser.
- Ogni Output annuncia il risultato a tutti i client collegati (evento WebSocket
  `research.output`): così `AI/ComfyUI/Receive` riceve anche i workflow avviati da ComfyUI.
- Quando ReseArch esegue un workflow toglie il nodo Publish, che quindi non viene risalvato.
