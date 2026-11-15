"""
ComfyUI-DA2 — DA² (Depth Anything in Any Direction) per ComfyUI (2026-10-17).

  DA2 Load Model      — carica il modello (pesi scaricati la prima volta in models/da2)
  DA2 Panorama Depth  — da una panoramica equirettangolare: profondità, profondità a colori,
                        normali, maschera e modello 3D GLB orientato come le mesh di MoGe

Installazione: copiare la cartella `ComfyUI-DA2` in `ComfyUI/custom_nodes/` e riavviare ComfyUI.
Nessuna libreria da installare. Vedi README.md.
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
