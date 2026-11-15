# ComfyUI-DA2

Nodi ComfyUI per **DA² — Depth Anything in Any Direction** (Haodong Li et al., ICLR 2026): distanza
da una panoramica equirettangolare 360° × 180°, con un solo passaggio del modello.

- Codice originale: <https://github.com/EnVision-Research/DA-2> (Apache-2.0)
- Pesi: <https://huggingface.co/haodongli/DA-2> (Apache-2.0, `model.safetensors`, 1,38 GB)
- Articolo: arXiv 2509.26618

La cartella `da2_model/` è il codice del modello copiato **senza modifiche** dal repository originale
(commit `d659838`, licenza in `LICENSE-DA2`). Il resto (`nodes.py`, `geometry.py`) è scritto per
ReseArch (2026-10-17).

## Perché non il pacchetto ufficiale

`pip install -e src` del repository originale impone versioni fisse e vecchie (torch 2.5.0, xformers
0.0.28, diffusers 0.32, transformers 4.46, gradio 5.49…): installato nel Python di ComfyUI sostituirebbe
PyTorch e romperebbe ComfyUI (e le schede recenti, es. RTX 50xx). Qui si usa solo il modello, con le
librerie già presenti in ComfyUI: torch, torchvision, einops, huggingface_hub, safetensors, numpy, PIL.
**Nessuna installazione.** xFormers non serve (avviso "xFormers not available" innocuo: si usa
l'attenzione di PyTorch).

## Installazione

1. Copiare la cartella `ComfyUI-DA2` in `ComfyUI/custom_nodes/`.
2. Riavviare ComfyUI.
3. Al primo uso il nodo **DA2 Load Model** scarica i pesi in `ComfyUI/models/da2/model.safetensors`
   (oppure copiarli lì a mano).

## Nodi

**DA2 Load Model** — `precision`: fp16 (predefinito, come l'originale), bf16, fp32. Uscita `da2_model`.

**DA2 Panorama Depth**

| Ingresso | |
|---|---|
| `da2_model` | da DA2 Load Model |
| `image` | panoramica equirettangolare (rapporto 2:1); il modello lavora internamente a ~600 mila pixel |
| `model_3d` | `mesh` (superficie con la foto come texture), `points` (nuvola colorata), `none` |
| `step` | un vertice ogni N pixel (2 = ~0,5 milioni di vertici e ~25 MB per un'immagine 2048 × 1024) |
| `discontinuity` | solo mesh: toglie i triangoli fra punti a distanze diverse oltre questa frazione (bordi degli oggetti) |
| `filename_prefix` | dove salvare il GLB nella cartella output (predefinito `3d/DA2`) |

| Uscita | |
|---|---|
| `depth` | profondità in grigi, vicino = chiaro (2°–98° percentile) |
| `depth_colored` | profondità con la scala Spectral (vicino = rosso, lontano = blu) |
| `normal` | normali per pixel in coordinate del mondo (Y in alto), rivolte verso il punto di ripresa: (n+1)/2 |
| `mask` | pixel con distanza valida |
| `glb_path` | percorso del GLB nella cartella output → `model_file` di ReseArch Model Output |
| `max_distance` | distanza al 98° percentile (la scala è relativa: DA² stima distanze invarianti di scala) |
| `distance` | (2026-10-19) distanze **vere** per pixel, non normalizzate, con la maschera (tipo `RA_DISTANCE`, stessa forma della geometria di MoGe) → ingresso `depth` di **ReseArch Depth Output** (EXR a 32 bit per misurare sulla panoramica in ReseArch) |

### Orientamento del modello 3D

Il GLB usa la stessa convenzione delle mesh panoramiche di **MoGe** in ComfyUI (2026-10-18): Y in alto, il
pixel (u, v) — u da sinistra, v dall'alto — sta nella direzione `(−sin 2πu · sin πv, cos πv, cos 2πu · sin πv)`,
il centro dell'immagine guarda verso −Z (davanti alla telecamera predefinita di Three.js). I modelli di DA2 e
di MoGe dalla stessa foto si sovrappongono. La sfera panoramica di ReseArch/TJS (`SphereGeometry` con
`scale(-1, 1, 1)`) coincide con entrambi se ruotata di **−90° attorno a Y**. Le distanze sono relative
(circa 1 = la parete più lontana).

## Workflow per ReseArch

- `example_workflows/RA_Pano_DA2.json` — formato dell'editor: in ComfyUI menu **Workflow → Templates**
  (sezione ComfyUI-DA2), oppure trascinare il file nella finestra. Si modifica e si ripubblica con
  **Queue** (il nodo ReseArch Publish lo salva come `RA_Pano_DA2`).
- `published/RA_Pano_DA2.json` — la copia già pubblicata (formato del ponte `research_bridge`, non si apre
  nell'editor): copiarla in `ComfyUI/custom_nodes/research_bridge/published/` per usarla subito da ReseArch.
  NON in una cartella `workflows/` o `example_workflows/`: ComfyUI la mostrerebbe fra i template.

Ha le stesse key di `RA_Pano_MoGe` — `image` in ingresso; `depth_exr` (dal 2026-10-19, ReseArch Depth Output), `img_depth`, `img_depth_color`, `img_normal`,
`img_mask`, `mesh` in uscita — quindi nel nodo ComfyUI Run di ReseArch si sceglie dall'ingresso `workflow`
senza cambiare porte.

Verificato (2026-10-17, RTX 5080 Laptop, ComfyUI 0.41.2, PyTorch 2.14): panoramica 2048 × 1024 in 3,4 s,
3,1 GB di memoria video, GLB 25,6 MB (522 mila vertici, 1 milione di triangoli).
