"""Nodi ComfyUI per DA² — Depth Anything in Any Direction (2026-10-17).

Modello: haodongli/DA-2 (Apache-2.0), codice in da2_model/ copiato senza modifiche da
EnVision-Research/DA-2 (vedi LICENSE-DA2). NON si installa il pacchetto ufficiale: imporrebbe
torch 2.5 e altre versioni vecchie, rompendo ComfyUI. Servono solo librerie già presenti in ComfyUI
(torch, torchvision, einops, huggingface_hub, safetensors, numpy, PIL).
"""

import json
import logging
import os

import numpy as np
import torch

from . import geometry

log = logging.getLogger("ComfyUI-DA2")
CATEGORY = "DA2"
REPO_ID = "haodongli/DA-2"
WEIGHTS = "model.safetensors"
_HERE = os.path.dirname(os.path.abspath(__file__))


def _models_dir():
    import folder_paths
    d = os.path.join(folder_paths.models_dir, "da2")
    os.makedirs(d, exist_ok=True)
    return d


def _weights_path():
    """Pesi in ComfyUI/models/da2/model.safetensors; scaricati da Hugging Face la prima volta (1,38 GB)."""
    path = os.path.join(_models_dir(), WEIGHTS)
    if os.path.isfile(path):
        return path
    from huggingface_hub import hf_hub_download
    log.info("DA2: download of %s/%s (about 1.4 GB) into %s", REPO_ID, WEIGHTS, _models_dir())
    return hf_hub_download(repo_id=REPO_ID, filename=WEIGHTS, local_dir=_models_dir())


class DA2LoadModel:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "precision": (["fp16", "bf16", "fp32"], {"default": "fp16",
                          "tooltip": "Calcolo: fp16 come l'originale (più veloce, meno memoria); fp32 più preciso"}),
        }}

    RETURN_TYPES = ("DA2_MODEL",)
    RETURN_NAMES = ("da2_model",)
    FUNCTION = "load"
    CATEGORY = CATEGORY
    DESCRIPTION = ("Carica DA² (Depth Anything in Any Direction). La prima volta scarica i pesi da Hugging Face "
                   "(haodongli/DA-2, 1,38 GB) in models/da2.")

    def load(self, precision):
        import comfy.model_management as mm
        from safetensors.torch import load_file
        from .da2_model.spherevit import SphereViT

        with open(os.path.join(_HERE, "infer.json"), "r", encoding="utf-8") as f:
            config = json.load(f)
        device = mm.get_torch_device()
        model = SphereViT(config)
        state = load_file(_weights_path(), device="cpu")
        missing, unexpected = model.load_state_dict(state, strict=False)
        if missing or unexpected:
            log.warning("DA2: %d missing and %d unexpected weights", len(missing), len(unexpected))
        model.eval()
        model = model.to(device)
        dtype = {"fp16": torch.float16, "bf16": torch.bfloat16, "fp32": torch.float32}[precision]
        return ({"model": model, "device": device, "dtype": dtype},)


class DA2PanoramaDepth:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "da2_model": ("DA2_MODEL",),
            "image": ("IMAGE", {"tooltip": "Panoramica equirettangolare 360° × 180° (rapporto 2:1)"}),
            "model_3d": (["mesh", "points", "none"], {"default": "mesh",
                         "tooltip": "mesh: superficie con l'immagine come texture · points: nuvola di punti colorati · none: niente file 3D"}),
            "step": ("INT", {"default": 2, "min": 1, "max": 16,
                     "tooltip": "Un vertice ogni N pixel: 1 = massimo dettaglio (file grande), 4 = leggero"}),
            "discontinuity": ("FLOAT", {"default": 0.05, "min": 0.0, "max": 1.0, "step": 0.01,
                              "tooltip": "Solo mesh: toglie i triangoli fra punti a distanze diverse oltre questa frazione (bordi degli oggetti); 0 = nessun taglio"}),
            "filename_prefix": ("STRING", {"default": "3d/DA2"}),
        }}

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING", "FLOAT", "RA_DISTANCE")
    RETURN_NAMES = ("depth", "depth_colored", "normal", "mask", "glb_path", "max_distance", "distance")
    FUNCTION = "run"
    CATEGORY = CATEGORY
    DESCRIPTION = ("Distanza da una panoramica equirettangolare con DA². Uscite: profondità (vicino = chiaro), "
                   "profondità a colori, normali, maschera dei pixel validi e un modello 3D GLB orientato come le "
                   "mesh panoramiche di MoGe: Y in alto, centro della foto verso −Z (scala relativa, centro = "
                   "punto di ripresa; la sfera panoramica di ReseArch/TJS coincide ruotata di −90° su Y). glb_path va a "
                   "model_file di ReseArch Model Output. distance (distanze vere per pixel, non normalizzate) va a "
                   "ReseArch Depth Output: EXR per misurare sulla panoramica in ReseArch.")

    def run(self, da2_model, image, model_3d, step, discontinuity, filename_prefix):
        import comfy.model_management as mm
        import folder_paths

        model, device, dtype = da2_model["model"], da2_model["device"], da2_model["dtype"]
        img = image[:1].to(device).permute(0, 3, 1, 2).float()          # (1, 3, H, W), 0..1
        use_autocast = device.type == "cuda" and dtype != torch.float32
        mm.throw_exception_if_processing_interrupted()
        with torch.no_grad(), torch.autocast(device.type, dtype=dtype, enabled=use_autocast):
            distance = model(img)
        distance = distance.float().cpu().numpy()[0]                     # (H, W)
        rgb = np.clip(image[0].cpu().numpy() * 255.0, 0, 255).astype(np.uint8)

        mask = geometry.valid_mask(distance)
        gray = geometry.normalized(distance, mask, near_bright=True)
        colored = geometry.colorize(geometry.normalized(distance, mask, near_bright=False))
        points = geometry.points_from_distance(np.where(mask, distance, 0.0))
        nrm, nmask = geometry.normals(points, mask)
        normal_rgb = (nrm + 1.0) * 0.5
        normal_rgb[~nmask] = 0.0

        glb_path = ""
        if model_3d != "none":
            if model_3d == "mesh":
                data, nv, nt = geometry.mesh_glb(points, mask, rgb, step=step, discontinuity=discontinuity)
            else:
                data, nv, nt = geometry.points_glb(points, mask, rgb, step=step)
            out_dir = folder_paths.get_output_directory()
            full_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
                filename_prefix, out_dir, rgb.shape[1], rgb.shape[0])
            fname = "{}_{:05}_.glb".format(filename, counter)
            with open(os.path.join(full_folder, fname), "wb") as f:
                f.write(data)
            glb_path = "/".join(p for p in (subfolder, fname) if p)
            log.info("DA2: %s — %d vertices, %d triangles, %.1f MB", glb_path, nv, nt, len(data) / 1e6)

        def as_image(a):
            a = np.asarray(a, dtype=np.float32)
            if a.ndim == 2:
                a = np.repeat(a[..., None], 3, axis=-1)
            return torch.from_numpy(a)[None]

        max_d = float(np.quantile(distance[mask], 0.98)) if mask.any() else 0.0
        # distanze vere (stessa forma della geometria di MoGe: "depth" e "mask" (1, H, W)), per ReseArch Depth Output
        dist_packet = {"depth": torch.from_numpy(np.where(mask, distance, 0.0).astype(np.float32))[None],
                       "mask": torch.from_numpy(mask)[None], "source": "da2", "units": "relative"}
        return (as_image(gray), as_image(colored), as_image(normal_rgb), as_image(mask.astype(np.float32)),
                glb_path, max_d, dist_packet)


NODE_CLASS_MAPPINGS = {
    "DA2LoadModel": DA2LoadModel,
    "DA2PanoramaDepth": DA2PanoramaDepth,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DA2LoadModel": "DA2 Load Model",
    "DA2PanoramaDepth": "DA2 Panorama Depth",
}
