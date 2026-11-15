"""
ReseArch Bridge — nodi personalizzati per ComfyUI (2026-10-04).

Collegano i workflow di ComfyUI ai flow della piattaforma ReseArch
(_doc/integrazione-comfyui.md §9):

  ReseArch Text Input / Number Input / Image Input  — valori che arrivano da ReseArch (con `key`)
  ReseArch Text Output / Number Output / Image Output — risultati che tornano a ReseArch (con `key`)
  ReseArch Publish — salva il workflow (formato API) con un nome, per eseguirlo da ReseArch

Installazione: copiare la cartella `research_bridge` in `ComfyUI/custom_nodes/` e riavviare
ComfyUI con `--enable-cors-header <origine della piattaforma>`.
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from . import routes  # noqa: F401  (registra gli indirizzi /research/* sul server di ComfyUI)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
