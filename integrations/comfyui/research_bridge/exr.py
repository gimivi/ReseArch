"""Scrittura di un OpenEXR a un canale (2026-10-19): mappa delle distanze per ReseArch.

Solo numpy, zlib e struct (nessuna libreria in più, nessuna funzione interna di ComfyUI):
un'immagine scanline con il canale "Y" in FLOAT a 32 bit, compressione ZIP (blocchi di 16 righe)
o nessuna. Riga 0 = riga in alto dell'immagine (lineOrder INCREASING_Y, come lo standard).
Letta in ReseArch da three.js (EXRLoader) senza perdita di precisione.

Attributi aggiunti all'intestazione (stringhe): researchUnits ("relative" / "metric") e
researchSource ("da2", "moge", …), letti da TJS per la scala.
"""

import struct
import zlib

import numpy as np

_MAGIC = b"\x76\x2f\x31\x01"
_FLOAT = 2                 # pixel type FLOAT
_NO_COMPRESSION = 0
_ZIP_COMPRESSION = 3       # zlib, 16 righe per blocco
_ZIP_LINES = 16


def _attr(name, type_name, value):
    return name.encode("ascii") + b"\0" + type_name.encode("ascii") + b"\0" + struct.pack("<i", len(value)) + value


def _zip_block(raw):
    """Compressione ZIP di OpenEXR: byte riordinati (pari poi dispari), differenze, zlib."""
    b = np.frombuffer(raw, dtype=np.uint8)
    t = np.concatenate([b[0::2], b[1::2]])
    d = t.astype(np.int16)
    d[1:] = (t[1:].astype(np.int16) - t[:-1].astype(np.int16) + 128 + 256) % 256
    return zlib.compress(d.astype(np.uint8).tobytes(), 6)


def write_exr_y(path, values, units="relative", source="", compression="zip"):
    """Scrive `values` (H, W, float) come EXR a un canale Y FLOAT. Restituisce (larghezza, altezza)."""
    a = np.ascontiguousarray(np.asarray(values, dtype="<f4"))
    if a.ndim != 2:
        raise ValueError("servono valori (H, W), ricevuto {}".format(a.shape))
    h, w = a.shape
    comp = _ZIP_COMPRESSION if compression == "zip" else _NO_COMPRESSION

    header = _MAGIC + struct.pack("<i", 2)
    chlist = b"Y\0" + struct.pack("<i", _FLOAT) + b"\0\0\0\0" + struct.pack("<ii", 1, 1) + b"\0"
    box = struct.pack("<iiii", 0, 0, w - 1, h - 1)
    header += _attr("channels", "chlist", chlist)
    header += _attr("compression", "compression", bytes([comp]))
    header += _attr("dataWindow", "box2i", box)
    header += _attr("displayWindow", "box2i", box)
    header += _attr("lineOrder", "lineOrder", b"\0")
    header += _attr("pixelAspectRatio", "float", struct.pack("<f", 1.0))
    header += _attr("screenWindowCenter", "v2f", struct.pack("<ff", 0.0, 0.0))
    header += _attr("screenWindowWidth", "float", struct.pack("<f", 1.0))
    header += _attr("researchUnits", "string", str(units).encode("utf-8"))
    if source:
        header += _attr("researchSource", "string", str(source).encode("utf-8"))
    header += b"\0"

    lines = _ZIP_LINES if comp == _ZIP_COMPRESSION else 1
    chunks = []
    for y0 in range(0, h, lines):
        raw = a[y0:y0 + lines].tobytes()      # un solo canale: le righe sono già nell'ordine del file
        data = raw
        if comp == _ZIP_COMPRESSION:
            z = _zip_block(raw)
            if len(z) < len(raw):              # regola di OpenEXR: se non conviene si scrive non compresso
                data = z
        chunks.append(struct.pack("<ii", y0, len(data)) + data)

    offset = len(header) + 8 * len(chunks)
    table = b""
    for c in chunks:
        table += struct.pack("<Q", offset)
        offset += len(c)

    with open(path, "wb") as f:
        f.write(header)
        f.write(table)
        for c in chunks:
            f.write(c)
    return w, h
