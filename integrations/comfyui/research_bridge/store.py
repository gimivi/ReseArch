"""Archivio dei workflow pubblicati per ReseArch (file JSON nella cartella `published/` del pacchetto)."""

import json
import math
import os
import re
import shutil
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
# NON "workflows": ComfyUI tratta come esempi dei pacchetti (menu Templates) i .json delle cartelle
# example_workflows / example / examples / workflow / workflows e li serve a chiunque; le copie
# pubblicate (formato API) comparirebbero lì come esempi non apribili (2026-10-06).
WORKFLOWS_DIR = os.path.join(_HERE, "published")
_OLD_DIR = os.path.join(_HERE, "workflows")


def _migrate_old_dir():
    """Sposta in published/ i workflow pubblicati con le versioni precedenti (cartella workflows/)."""
    if not os.path.isdir(_OLD_DIR):
        return
    try:
        os.makedirs(WORKFLOWS_DIR, exist_ok=True)
        for fn in os.listdir(_OLD_DIR):
            src, dst = os.path.join(_OLD_DIR, fn), os.path.join(WORKFLOWS_DIR, fn)
            if fn.endswith(".json") and not os.path.exists(dst):
                shutil.move(src, dst)
        if not any(f.endswith(".json") for f in os.listdir(_OLD_DIR)):
            shutil.rmtree(_OLD_DIR, ignore_errors=True)
    except OSError:
        pass   # cartella non scrivibile: resta com'è


_migrate_old_dir()

# class_type dei nodi del pacchetto → (ruolo, tipo del valore)
INPUT_CLASSES = {
    "ReseArchTextInput": "text",
    "ReseArchNumberInput": "number",
    "ReseArchImageInput": "image",
}
OUTPUT_CLASSES = {
    "ReseArchTextOutput": "text",
    "ReseArchNumberOutput": "number",
    "ReseArchImageOutput": "image",
    "ReseArchModelOutput": "model",
    "ReseArchDepthOutput": "depth",
}
PUBLISH_CLASS = "ReseArchPublish"

_NAME_RE = re.compile(r"^[\w\- ]{1,80}$", re.UNICODE)


def safe_name(name):
    """Nome di workflow ammesso (lettere, cifre, spazio, - e _), altrimenti ValueError."""
    name = str(name or "").strip()
    if not _NAME_RE.match(name):
        raise ValueError("nome non valido: usare lettere, cifre, spazi, - e _ (max 80 caratteri)")
    return name


def _path(name):
    return os.path.join(WORKFLOWS_DIR, safe_name(name) + ".json")


def describe(prompt):
    """Input e Output del pacchetto presenti in un workflow (formato API), ordinati per key."""
    inputs, outputs = [], []
    for node_id, node in (prompt or {}).items():
        if not isinstance(node, dict):
            continue
        cls = node.get("class_type")
        key = str((node.get("inputs") or {}).get("key", "")).strip()
        if cls in INPUT_CLASSES and key:
            inputs.append({"key": key, "kind": INPUT_CLASSES[cls], "node": node_id})
        elif cls in OUTPUT_CLASSES and key:
            outputs.append({"key": key, "kind": OUTPUT_CLASSES[cls], "node": node_id})
    inputs.sort(key=lambda x: x["key"])
    outputs.sort(key=lambda x: x["key"])
    return inputs, outputs


def _clean(value):
    """Copia del workflow senza i campi interni di ComfyUI (is_changed) e senza numeri non validi
    (NaN, infinito): il file e le risposte devono restare JSON leggibile dal browser."""
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items() if k != "is_changed"}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def save(name, prompt):
    os.makedirs(WORKFLOWS_DIR, exist_ok=True)
    data = {"name": safe_name(name), "saved": int(time.time()), "prompt": _clean(prompt)}
    tmp = _path(name) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, allow_nan=False)
    os.replace(tmp, _path(name))
    return data


def load(name):
    with open(_path(name), "r", encoding="utf-8") as f:
        return json.load(f)


def list_all():
    out = []
    if not os.path.isdir(WORKFLOWS_DIR):
        return out
    for fn in sorted(os.listdir(WORKFLOWS_DIR)):
        if not fn.endswith(".json"):
            continue
        try:
            data = load(fn[:-5])
        except Exception:  # file illeggibile o nome non più valido: saltato
            continue
        inputs, outputs = describe(data.get("prompt"))
        out.append({"name": data.get("name", fn[:-5]), "saved": data.get("saved"),
                    "inputs": inputs, "outputs": outputs})
    return out
