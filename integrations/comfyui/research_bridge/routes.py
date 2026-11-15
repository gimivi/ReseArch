"""Indirizzi aggiunti al server di ComfyUI (anche con prefisso /api, aggiunto da ComfyUI stesso)."""

from aiohttp import web

from . import store

try:
    from server import PromptServer
    _routes = PromptServer.instance.routes
except Exception:  # fuori da ComfyUI (prove): nessuna registrazione
    _routes = None


async def list_workflows(request):
    """Elenco dei workflow pubblicati con le key dei loro Input e Output."""
    return web.json_response({"workflows": store.list_all()})


async def get_workflow(request):
    name = request.match_info.get("name", "")
    try:
        data = store.load(name)
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    except FileNotFoundError:
        return web.json_response({"error": "workflow \"{}\" non pubblicato".format(name)}, status=404)
    inputs, outputs = store.describe(data.get("prompt"))
    return web.json_response({**data, "inputs": inputs, "outputs": outputs})


async def info(request):
    return web.json_response({"bridge": "research_bridge", "version": 2})


# tipi MIME che le librerie 3D si aspettano (mimetypes non conosce glb/gltf su tutti i sistemi)
_MIME = {"glb": "model/gltf-binary", "gltf": "model/gltf+json", "obj": "text/plain", "mtl": "text/plain",
         "ply": "application/octet-stream", "stl": "model/stl", "drc": "application/octet-stream",
         "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
         "exr": "image/x-exr"}


def resolve_file(kind, rel_path):
    """File dentro una cartella di ComfyUI (output / temp / input) → percorso assoluto; altrimenti ValueError."""
    import os
    import folder_paths
    bases = {"output": folder_paths.get_output_directory,
             "temp": folder_paths.get_temp_directory,
             "input": folder_paths.get_input_directory}
    if kind not in bases:
        raise ValueError("cartella non ammessa: {}".format(kind))
    base = os.path.realpath(bases[kind]())
    full = os.path.realpath(os.path.join(base, rel_path or ""))
    if full == base or os.path.commonpath([full, base]) != base:
        raise ValueError("percorso fuori dalla cartella {}".format(kind))
    if not os.path.isfile(full):
        raise FileNotFoundError(rel_path)
    return full


async def get_file(request):
    """Un file di ComfyUI con il suo nome vero nell'URL (/research/file/output/research/x.glb): i
    caricatori 3D riconoscono il formato dall'estensione, e un OBJ trova .mtl e texture accanto."""
    kind = request.match_info.get("kind", "")
    rel = request.match_info.get("path", "")
    try:
        full = resolve_file(kind, rel)
    except FileNotFoundError:
        return web.json_response({"error": "file non trovato"}, status=404)
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    ext = full.rsplit(".", 1)[-1].lower() if "." in full else ""
    headers = {"Content-Type": _MIME[ext]} if ext in _MIME else None
    return web.FileResponse(full, headers=headers)


if _routes is not None:
    _routes.get("/research/info")(info)
    _routes.get("/research/workflows")(list_workflows)
    _routes.get("/research/workflows/{name}")(get_workflow)
    _routes.get("/research/file/{kind}/{path:.*}")(get_file)
