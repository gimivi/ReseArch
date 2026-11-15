"""Nodi ComfyUI del ponte ReseArch (API classica dei nodi personalizzati: INPUT_TYPES / FUNCTION)."""

import os
import uuid

from . import store


def _always_changed():
    """Valore di IS_CHANGED sempre diverso: il nodo viene rieseguito a ogni esecuzione.

    NON float("nan"): ComfyUI scrive il valore nel workflow conservato nella storia
    ("is_changed": [NaN]) e /history diventa JSON non valido per il browser (2026-10-06).
    """
    return uuid.uuid4().hex

CATEGORY = "ReseArch"


def _broadcast(event, data):
    """Annuncio a tutti i client collegati al WebSocket di ComfyUI (anche a chi non ha messo in coda)."""
    try:
        from server import PromptServer
        PromptServer.instance.send_sync(event, data)
    except Exception:  # fuori da ComfyUI (prove) o server non pronto: niente annuncio
        pass


# ── Input ─────────────────────────────────────────────────────────────────────

class ReseArchTextInput:
    """Testo che arriva da ReseArch; il widget `value` è il valore di prova in ComfyUI."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "key": ("STRING", {"default": "prompt", "tooltip": "Nome con cui ReseArch riconosce questo ingresso"}),
            "value": ("STRING", {"default": "", "multiline": True, "tooltip": "Valore di prova; da ReseArch viene sostituito"}),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = "Testo inviato da un flow ReseArch (nodo AI/ComfyUI/Run), riconosciuto dalla key."

    def run(self, key, value):
        return (value,)


class ReseArchNumberInput:
    """Numero che arriva da ReseArch (uscita decimale e intera, es. per il seed)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "key": ("STRING", {"default": "number"}),
            "value": ("FLOAT", {"default": 0.0, "min": -1e15, "max": 1e15, "step": 0.01}),
        }}

    RETURN_TYPES = ("FLOAT", "INT")
    RETURN_NAMES = ("value", "int")
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = "Numero inviato da un flow ReseArch, riconosciuto dalla key. Uscita int = valore arrotondato."

    def run(self, key, value):
        return (float(value), int(round(value)))


def _input_images():
    import folder_paths
    d = folder_paths.get_input_directory()
    files = [f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))]
    return sorted(folder_paths.filter_files_content_types(files, ["image"]))


class ReseArchImageInput:
    """Immagine che arriva da ReseArch (caricata nella cartella input di ComfyUI)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "key": ("STRING", {"default": "image"}),
            "image": (_input_images(), {"image_upload": True, "tooltip": "Immagine di prova; da ReseArch viene sostituita"}),
        }}

    RETURN_TYPES = ("IMAGE", "MASK")
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = "Immagine inviata da un flow ReseArch, riconosciuta dalla key."

    def run(self, key, image):
        from nodes import LoadImage
        return LoadImage().load_image(image)

    @classmethod
    def IS_CHANGED(cls, key, image):
        from nodes import LoadImage
        return LoadImage.IS_CHANGED(image)

    @classmethod
    def VALIDATE_INPUTS(cls, key, image):
        # definita con "image" fra gli argomenti: ComfyUI non confronta il valore con l'elenco del
        # menu (un file appena caricato da ReseArch potrebbe non esserci ancora)
        import folder_paths
        if not folder_paths.exists_annotated_filepath(image):
            return "immagine non trovata: {}".format(image)
        return True


# ── Output ────────────────────────────────────────────────────────────────────

class _OutputBase:
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    FUNCTION = "run"
    CATEGORY = CATEGORY

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # sempre rieseguito: ReseArch deve ricevere il risultato anche se il resto è in cache
        return _always_changed()

    def _emit(self, entry):
        _broadcast("research.output", entry)
        return {"ui": {"research": [entry]}}


class ReseArchTextOutput(_OutputBase):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "key": ("STRING", {"default": "text"}),
            "text": ("STRING", {"forceInput": True}),
        }}

    DESCRIPTION = "Rimanda un testo a ReseArch con la sua key."

    def run(self, key, text):
        return self._emit({"key": key, "kind": "text", "value": str(text)})


class ReseArchNumberOutput(_OutputBase):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "key": ("STRING", {"default": "number"}),
            "value": ("FLOAT", {"forceInput": True}),
        }}

    DESCRIPTION = "Rimanda un numero a ReseArch con la sua key."

    def run(self, key, value):
        return self._emit({"key": key, "kind": "number", "value": float(value)})


class ReseArchImageOutput(_OutputBase):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "key": ("STRING", {"default": "image"}),
            "images": ("IMAGE",),
        }}

    DESCRIPTION = "Rimanda a ReseArch la prima immagine (salvata in output/research) con la sua key; le altre del lotto sono salvate e mostrate in ComfyUI."

    def run(self, key, images):
        import numpy as np
        from PIL import Image
        import folder_paths

        out_dir = folder_paths.get_output_directory()
        prefix = "research/" + "".join(c if c.isalnum() or c in "-_" else "_" for c in str(key))[:40]
        full_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix, out_dir, images[0].shape[1], images[0].shape[0])
        saved = []
        for i, image in enumerate(images):
            arr = np.clip(255.0 * image.cpu().numpy(), 0, 255).astype(np.uint8)
            fname = "{}_{:05}_.png".format(filename, counter)
            Image.fromarray(arr).save(os.path.join(full_folder, fname), compress_level=4)
            saved.append({"filename": fname, "subfolder": subfolder, "type": "output"})
            counter += 1
        first = saved[0]
        entry = {"key": key, "kind": "image", "filename": first["filename"],
                 "subfolder": first["subfolder"], "type": first["type"]}
        _broadcast("research.output", entry)
        return {"ui": {"research": [entry], "images": saved}}


# tipi file 3D dei nodi recenti di ComfyUI (comfy_api: File3DAny, File3DGLB, …); l'unione con la
# virgola è accettata dalla validazione dei collegamenti di ComfyUI
FILE_3D_TYPES = ",".join(["FILE_3D", "FILE_3D_GLB", "FILE_3D_GLTF", "FILE_3D_OBJ", "FILE_3D_PLY",
                          "FILE_3D_STL", "FILE_3D_FBX", "FILE_3D_USDZ"])


def _strip_annotation(path):
    """"cartella/file.glb [output]" → "cartella/file.glb" (formato dei percorsi annotati di ComfyUI)."""
    p = str(path or "").strip()
    for tag in (" [output]", " [input]", " [temp]"):
        if p.endswith(tag):
            return p[: -len(tag)]
    return p


def _locate_model(model_file):
    """Percorso di un modello già salvato → (tipo di cartella, sottocartella, nome file).

    Accetta un percorso relativo alla cartella output (come glb_path di MoGe o Preview 3D),
    un percorso annotato, oppure un percorso assoluto dentro le cartelle output / temp / input.
    """
    import folder_paths
    p = _strip_annotation(model_file)
    if not p:
        raise ValueError("model_file vuoto")
    bases = [("output", folder_paths.get_output_directory()),
             ("temp", folder_paths.get_temp_directory()),
             ("input", folder_paths.get_input_directory())]
    candidates = [os.path.abspath(p)] if os.path.isabs(p) else [os.path.abspath(os.path.join(b, p)) for _, b in bases]
    for full in candidates:
        if not os.path.isfile(full):
            continue
        for kind, base in bases:
            base = os.path.abspath(base)
            if os.path.commonpath([full, base]) == base:
                rel = os.path.relpath(full, base).replace("\\", "/")
                sub, _, name = rel.rpartition("/")
                return kind, sub, name
        raise ValueError("il modello deve stare nelle cartelle di ComfyUI (output, temp, input): {}".format(full))
    raise ValueError("modello non trovato: {}".format(p))


def _mesh_to_glb_bytes(mesh):
    """MESH di ComfyUI (es. Hunyuan3D) → byte GLB, con la funzione di ComfyUI stesso.

    Versioni recenti: comfy_extras.nodes_save_3d.mesh_item_to_glb_bytes (quella di "Create 3D File
    (from Mesh)", conserva texture, colori, normali). Versioni precedenti: save_glb di
    nodes_hunyuan3d (solo geometria). Se il lotto ha più mesh si usa la prima.
    """
    try:
        from comfy_extras.nodes_save_3d import mesh_item_to_glb_bytes
        glb = mesh_item_to_glb_bytes(mesh, 0)
    except ImportError:
        import tempfile
        from comfy_extras.nodes_hunyuan3d import save_glb
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "mesh.glb")
            save_glb(mesh.vertices[0], mesh.faces[0], path)
            with open(path, "rb") as f:
                glb = f.read()
    if not glb:
        raise ValueError("la mesh è vuota (nessun vertice o faccia)")
    return glb


class ReseArchModelOutput(_OutputBase):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"key": ("STRING", {"default": "model"})},
                "optional": {
                    "mesh": ("MESH", {"tooltip": "Mesh di ComfyUI (es. Hunyuan3D): convertita in GLB e salvata"}),
                    "model_3d": (FILE_3D_TYPES, {"tooltip": "File 3D dei nodi recenti di ComfyUI: salvato"}),
                    "model_file": ("STRING", {"forceInput": True,
                                              "tooltip": "Percorso di un modello già salvato (es. glb_path di MoGe), relativo alla cartella output"}),
                    "folder": (["output", "temp"], {"default": "output",
                                                    "tooltip": "Dove salvare i modelli ricevuti da mesh o model_3d: output (permanente, output/research) oppure temp (svuotata da ComfyUI a ogni riavvio)"}),
                }}

    DESCRIPTION = ("Rimanda a ReseArch un modello 3D con la sua key. Collegare UNO solo fra: mesh (MESH, es. "
                   "Hunyuan3D, convertita in GLB), model_3d (file 3D dei nodi recenti) o model_file (percorso già "
                   "salvato, es. glb_path di MoGe). mesh e model_3d sono salvati in output/research o, con folder = "
                   "temp, nella cartella temporanea. In ReseArch diventa l'URL del file, da caricare con "
                   "TJS/Model/Load URL (glb, gltf, obj, ply).")

    def run(self, key, mesh=None, model_3d=None, model_file=None, folder="output"):
        import uuid
        import folder_paths
        def _set(v):   # collegato? (niente "if v": su oggetti PyTorch la verità è ambigua)
            return v is not None and not (isinstance(v, str) and not v.strip())
        given = [n for n, v in (("mesh", mesh), ("model_3d", model_3d), ("model_file", model_file)) if _set(v)]
        if not given:
            raise ValueError("collegare uno fra mesh, model_3d e model_file")
        if len(given) > 1:
            raise ValueError("collegare un solo ingresso fra mesh, model_3d e model_file (collegati: {})".format(", ".join(given)))

        if _set(model_file):
            kind, sub, name = _locate_model(model_file)       # file già salvato: resta dov'è
            fmt = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        else:
            kind = "temp" if folder == "temp" else "output"
            base = folder_paths.get_temp_directory() if kind == "temp" else folder_paths.get_output_directory()
            sub = "research"
            target = os.path.join(base, sub)
            os.makedirs(target, exist_ok=True)
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(key))[:40] or "model"
            if mesh is not None:
                fmt = "glb"
                name = "{}_{}.glb".format(safe, uuid.uuid4().hex[:8])
                with open(os.path.join(target, name), "wb") as f:
                    f.write(_mesh_to_glb_bytes(mesh))
            else:
                fmt = (getattr(model_3d, "format", "") or "glb").lower()
                name = "{}_{}.{}".format(safe, uuid.uuid4().hex[:8], fmt)
                model_3d.save_to(os.path.join(target, name))
        return self._emit({"key": key, "kind": "model", "filename": name, "subfolder": sub,
                           "type": kind, "format": fmt})


# ── Mappa delle distanze (EXR) ─────────────────────────────────────────────────

# Geometria panoramica di MoGe (nodi del nucleo di ComfyUI) o distanze di DA2 (ComfyUI-DA2): entrambe
# dizionari con "depth" (B, H, W) = distanza dal punto di ripresa per pixel e "mask" (B, H, W)
DEPTH_TYPES = "MOGE_GEOMETRY,RA_DISTANCE"


class ReseArchDepthOutput(_OutputBase):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "key": ("STRING", {"default": "depth_exr"}),
            "depth": (DEPTH_TYPES, {"tooltip": "moge_geometry di MoGe Panorama Inference oppure distance di DA2 Panorama Depth"}),
        }, "optional": {
            "units": (["auto", "relative", "metric"], {"default": "auto",
                      "tooltip": "auto: relative per MoGe e DA2 (le panoramiche MoGe ignorano la scala metrica: viste fuse senza scala). metric solo per una mappa gia' in metri. Con relative in ReseArch serve la calibrazione: TJS/Panorama/Depth Scale"}),
        }}

    DESCRIPTION = ("Rimanda a ReseArch la mappa delle distanze di una panoramica (MoGe o DA2) come EXR a 32 bit "
                   "(un canale, distanza dal punto di ripresa per pixel, 0 = pixel non valido), in output/research. "
                   "In ReseArch diventa l'URL del file, da usare con TJS/Panorama/Set Depth o Depth Point: si misura "
                   "sulla panoramica senza mesh.")

    def run(self, key, depth, units="auto"):
        import uuid
        import numpy as np
        import folder_paths
        from .exr import write_exr_y

        if not isinstance(depth, dict) or "depth" not in depth:
            raise ValueError("depth: serve moge_geometry (MoGe) o distance (DA2)")
        d = depth["depth"]
        d = d.detach().float().cpu().numpy() if hasattr(d, "detach") else np.asarray(d, dtype=np.float32)
        d = d[0] if d.ndim == 3 else d                                   # primo elemento del lotto
        m = depth.get("mask")
        if m is not None:
            m = m.detach().cpu().numpy() if hasattr(m, "detach") else np.asarray(m)
            m = (m[0] if m.ndim == 3 else m).astype(bool)
        else:
            m = np.ones(d.shape, dtype=bool)
        m &= np.isfinite(d) & (d > 0)
        values = np.where(m, d, 0.0).astype(np.float32)

        source = str(depth.get("source") or "moge")
        if units == "auto":
            # MoGePanoramaInference fonde 12 viste con apply_metric_scale=False: distanze relative, come DA2
            units = str(depth.get("units") or "relative")

        base = folder_paths.get_output_directory()
        sub = "research"
        os.makedirs(os.path.join(base, sub), exist_ok=True)
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(key))[:40] or "depth"
        name = "{}_{}.exr".format(safe, uuid.uuid4().hex[:8])
        w, h = write_exr_y(os.path.join(base, sub, name), values, units=units, source=source)
        valid = float(m.mean()) if m.size else 0.0
        return self._emit({"key": key, "kind": "depth", "filename": name, "subfolder": sub, "type": "output",
                           "width": w, "height": h, "units": units, "source": source, "valid": round(valid, 4)})


# ── Publish ───────────────────────────────────────────────────────────────────

class ReseArchPublish:
    """Salva il workflow corrente (formato API) con un nome: ReseArch lo elenca e lo esegue."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"name": ("STRING", {"default": "workflow"})},
                "hidden": {"prompt": "PROMPT"}}

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = ("Esegui il workflow una volta (Queue) per pubblicarlo con questo nome: diventa disponibile "
                   "nel nodo AI/ComfyUI/Run di ReseArch. Quando lo esegue ReseArch, questo nodo viene tolto.")

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return _always_changed()

    def run(self, name, prompt=None):
        data = store.save(name, prompt or {})
        inputs, outputs = store.describe(data["prompt"])
        text = "Pubblicato \"{}\": {} ingressi ({}), {} uscite ({})".format(
            data["name"], len(inputs), ", ".join(i["key"] for i in inputs) or "-",
            len(outputs), ", ".join(o["key"] for o in outputs) or "-")
        return {"ui": {"text": [text]}}


NODE_CLASS_MAPPINGS = {
    "ReseArchTextInput": ReseArchTextInput,
    "ReseArchNumberInput": ReseArchNumberInput,
    "ReseArchImageInput": ReseArchImageInput,
    "ReseArchTextOutput": ReseArchTextOutput,
    "ReseArchNumberOutput": ReseArchNumberOutput,
    "ReseArchImageOutput": ReseArchImageOutput,
    "ReseArchModelOutput": ReseArchModelOutput,
    "ReseArchDepthOutput": ReseArchDepthOutput,
    "ReseArchPublish": ReseArchPublish,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ReseArchTextInput": "ReseArch Text Input",
    "ReseArchNumberInput": "ReseArch Number Input",
    "ReseArchImageInput": "ReseArch Image Input",
    "ReseArchTextOutput": "ReseArch Text Output",
    "ReseArchNumberOutput": "ReseArch Number Output",
    "ReseArchImageOutput": "ReseArch Image Output",
    "ReseArchModelOutput": "ReseArch Model Output",
    "ReseArchDepthOutput": "ReseArch Depth Output",
    "ReseArchPublish": "ReseArch Publish",
}
