"""Geometria e immagini dalla mappa delle distanze di DA² (solo numpy e PIL, già presenti in ComfyUI).

Convenzione degli assi (2026-10-18): la stessa delle mesh panoramiche di MoGe in ComfyUI
(comfy_extras/nodes_moge.py: direzioni Z in alto di spherical_uv_to_directions, poi assi [1, 2, 0]
per il glTF, Y in alto). Un pixel (u, v) dell'immagine equirettangolare (u da sinistra, v dall'alto,
0..1) guarda nella direzione

    d = ( −sin(2πu)·sin(πv),  cos(πv),  cos(2πu)·sin(πv) )

Il centro dell'immagine (u = 0,5) guarda verso −Z, davanti alla telecamera predefinita di Three.js.
Rispetto alla sfera panoramica di TJS (SphereGeometry con scale(-1, 1, 1)) è una rotazione di −90°
attorno a Y: con la sfera ruotata così, MoGe e DA2 coincidono entrambi con la foto.
"""

import io
import json
import struct

import numpy as np

# ColorBrewer "Spectral" (11 classi), la stessa scala dei colori della demo di DA²: vicino = rosso
_SPECTRAL = np.array([
    [158, 1, 66], [213, 62, 79], [244, 109, 67], [253, 174, 97], [254, 224, 139], [255, 255, 191],
    [230, 245, 152], [171, 221, 164], [102, 194, 165], [50, 136, 189], [94, 79, 162]], dtype=np.float32) / 255.0


def directions(height, width):
    """Direzioni unitarie (H, W, 3) dei centri dei pixel, nella convenzione delle mesh di MoGe."""
    u = (np.arange(width, dtype=np.float32) + 0.5) / width
    v = (np.arange(height, dtype=np.float32) + 0.5) / height
    lon = 2.0 * np.pi * u[None, :]
    lat = np.pi * v[:, None]
    s = np.sin(lat)
    return np.stack(np.broadcast_arrays(-np.sin(lon) * s, np.cos(lat), np.cos(lon) * s), axis=-1)


def valid_mask(distance):
    return np.isfinite(distance) & (distance > 0)


def normalized(distance, mask, near_bright=True):
    """Distanza in 0..1 fra il 2° e il 98° percentile dei pixel validi (come la demo di DA²)."""
    vals = distance[mask]
    if vals.size == 0:
        return np.zeros_like(distance, dtype=np.float32)
    lo, hi = np.quantile(vals, 0.02), np.quantile(vals, 0.98)
    t = np.clip((distance - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    t[~mask] = 1.0
    return (1.0 - t) if near_bright else t


def colorize(t):
    """Valori 0..1 → RGB 0..1 con la scala Spectral (0 = rosso, 1 = blu)."""
    x = np.clip(t, 0.0, 1.0) * (len(_SPECTRAL) - 1)
    i = np.clip(np.floor(x).astype(np.int32), 0, len(_SPECTRAL) - 2)
    f = (x - i)[..., None]
    return _SPECTRAL[i] * (1.0 - f) + _SPECTRAL[i + 1] * f


def points_from_distance(distance):
    return distance[..., None].astype(np.float32) * directions(*distance.shape)


def normals(points, mask):
    """Normali per pixel dalle differenze fra i vicini (orizzontale con giro completo), rivolte
    verso il centro della sfera (chi guarda), in coordinate del mondo TJS."""
    dx = np.roll(points, -1, axis=1) - np.roll(points, 1, axis=1)
    dy = np.zeros_like(points)
    dy[1:-1] = points[2:] - points[:-2]
    dy[0], dy[-1] = points[1] - points[0], points[-1] - points[-2]
    n = np.cross(dx, dy)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-8)
    flip = np.sum(n * points, axis=-1) > 0
    n[flip] = -n[flip]
    ok = mask & np.roll(mask, 1, axis=1) & np.roll(mask, -1, axis=1)
    n[~ok] = 0.0
    return n, ok


def _pad4(b, fill=b"\x00"):
    return b + fill * ((4 - len(b) % 4) % 4)


def _glb(gltf, binary):
    js = _pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    binary = _pad4(binary)
    total = 12 + 8 + len(js) + 8 + len(binary)
    return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(binary), 0x004E4942) + binary)


def _accessor(buffers, data, ctype, kind, target=None, minmax=False):
    """Aggiunge un bufferView + accessor; restituisce l'indice dell'accessor."""
    gltf, chunks = buffers
    offset = sum(len(c) for c in chunks)
    raw = _pad4(data.tobytes())
    chunks.append(raw)
    view = {"buffer": 0, "byteOffset": offset, "byteLength": data.nbytes}
    if target:
        view["target"] = target
    gltf["bufferViews"].append(view)
    acc = {"bufferView": len(gltf["bufferViews"]) - 1, "componentType": ctype,
           "count": int(data.shape[0]), "type": kind}
    if ctype in (5121, 5123) and kind != "SCALAR":
        acc["normalized"] = True
    if minmax:
        acc["min"] = data.min(axis=0).astype(float).tolist()
        acc["max"] = data.max(axis=0).astype(float).tolist()
    gltf["accessors"].append(acc)
    return len(gltf["accessors"]) - 1


def mesh_glb(points, mask, image, step=2, discontinuity=0.05):
    """Mesh a griglia (un vertice ogni `step` pixel) con l'immagine come texture, senza i
    triangoli a cavallo dei salti di distanza (rapporto fra lati > 1 + discontinuity).
    La colonna di destra si richiude sulla prima (giro completo della panoramica)."""
    from PIL import Image

    H, W = mask.shape
    rows = np.arange(0, H, step)
    cols = np.arange(0, W, step)
    P = points[rows][:, cols]
    M = mask[rows][:, cols]
    D = np.linalg.norm(P, axis=-1)
    # colonna di chiusura: stessi punti della prima, u = 1
    P = np.concatenate([P, P[:, :1]], axis=1)
    M = np.concatenate([M, M[:, :1]], axis=1)
    D = np.concatenate([D, D[:, :1]], axis=1)
    h, w = M.shape
    u = np.concatenate([(cols + 0.5) / W, [1.0]]).astype(np.float32)
    v = ((rows + 0.5) / H).astype(np.float32)
    uv = np.stack(np.broadcast_arrays(u[None, :], v[:, None]), axis=-1).reshape(-1, 2)

    idx = np.arange(h * w, dtype=np.uint32).reshape(h, w)
    a, b, c, d = idx[:-1, :-1], idx[:-1, 1:], idx[1:, :-1], idx[1:, 1:]
    Df = D.reshape(-1)
    Mf = M.reshape(-1)
    tris = np.concatenate([np.stack([a, c, b], -1).reshape(-1, 3), np.stack([b, c, d], -1).reshape(-1, 3)])
    keep = Mf[tris].all(axis=1)
    if discontinuity > 0:
        dt = Df[tris]
        keep &= dt.max(axis=1) <= dt.min(axis=1) * (1.0 + discontinuity)
    tris = tris[keep]
    used = np.unique(tris)
    remap = np.zeros(h * w, dtype=np.uint32)
    remap[used] = np.arange(used.size, dtype=np.uint32)
    pos = P.reshape(-1, 3)[used].astype(np.float32)
    tex = uv[used].astype(np.float32)
    ind = remap[tris].reshape(-1).astype(np.uint32)

    png = io.BytesIO()
    Image.fromarray(image).save(png, format="PNG", compress_level=4)
    png = png.getvalue()

    gltf = {"asset": {"version": "2.0", "generator": "ComfyUI-DA2"}, "buffers": [], "bufferViews": [],
            "accessors": [], "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "DA2_panorama"}]}
    chunks = []
    pa = _accessor((gltf, chunks), pos, 5126, "VEC3", 34962, minmax=True)
    ta = _accessor((gltf, chunks), tex, 5126, "VEC2", 34962)
    ia = _accessor((gltf, chunks), ind, 5125, "SCALAR", 34963)
    off = sum(len(c) for c in chunks)
    chunks.append(_pad4(png))
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(png)})
    gltf["images"] = [{"bufferView": len(gltf["bufferViews"]) - 1, "mimeType": "image/png"}]
    gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}]
    gltf["textures"] = [{"sampler": 0, "source": 0}]
    gltf["materials"] = [{"name": "DA2_texture", "doubleSided": True,
                          "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.0,
                                                   "roughnessFactor": 1.0},
                          "extensions": {"KHR_materials_unlit": {}}}]
    gltf["extensionsUsed"] = ["KHR_materials_unlit"]
    gltf["meshes"] = [{"name": "DA2_panorama", "primitives": [{
        "attributes": {"POSITION": pa, "TEXCOORD_0": ta}, "indices": ia, "material": 0, "mode": 4}]}]
    binary = b"".join(chunks)
    gltf["buffers"] = [{"byteLength": len(binary)}]
    return _glb(gltf, binary), int(pos.shape[0]), int(ind.size // 3)


def points_glb(points, mask, image, step=2):
    """Nuvola di punti colorati (un punto ogni `step` pixel)."""
    P = points[::step, ::step].reshape(-1, 3)
    C = image[::step, ::step].reshape(-1, 3)
    M = mask[::step, ::step].reshape(-1)
    pos = P[M].astype(np.float32)
    col = C[M].astype(np.uint8)
    col = np.concatenate([col, np.full((col.shape[0], 1), 255, np.uint8)], axis=1)   # RGBA, 4 byte allineati
    gltf = {"asset": {"version": "2.0", "generator": "ComfyUI-DA2"}, "buffers": [], "bufferViews": [],
            "accessors": [], "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "DA2_points"}]}
    chunks = []
    pa = _accessor((gltf, chunks), pos, 5126, "VEC3", 34962, minmax=True)
    ca = _accessor((gltf, chunks), col, 5121, "VEC4", 34962)
    gltf["materials"] = [{"name": "DA2_points", "pbrMetallicRoughness": {"metallicFactor": 0.0},
                          "extensions": {"KHR_materials_unlit": {}}}]
    gltf["extensionsUsed"] = ["KHR_materials_unlit"]
    gltf["meshes"] = [{"name": "DA2_points", "primitives": [{
        "attributes": {"POSITION": pa, "COLOR_0": ca}, "material": 0, "mode": 0}]}]
    binary = b"".join(chunks)
    gltf["buffers"] = [{"byteLength": len(binary)}]
    return _glb(gltf, binary), int(pos.shape[0]), 0
