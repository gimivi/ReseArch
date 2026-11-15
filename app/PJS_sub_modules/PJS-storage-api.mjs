// APP/PJS_sub_modules/PJS-storage-api.mjs
const API_URL = "api/pjs.php";

async function apiCall(payload, signal) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.ok !== true) {
    const msg = j?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return j;
}

export async function listDrawings({ mod_id, signal }) {
  return apiCall({ action: "list", mod_id }, signal);
}

export async function loadDrawing({ dwg_id, signal }) {
  return apiCall({ action: "load", dwg_id }, signal);
}

export async function newDrawing({ mod_id, dwg_name, dwg_description, dwg_version, dwg_sce_json, dwg_show = 1, dwg_share = 1, signal }) {
  return apiCall({ action: "new", mod_id, dwg_name, dwg_description, dwg_version, dwg_sce_json, dwg_show, dwg_share }, signal);
}

export async function saveDrawing({ dwg_id, dwg_name, dwg_description, dwg_version, dwg_sce_json, dwg_show = 1, dwg_share = 1, signal }) {
  return apiCall({ action: "save", dwg_id, dwg_name, dwg_description, dwg_version, dwg_sce_json, dwg_show, dwg_share }, signal);
}

export async function deleteDrawing({ dwg_id, signal }) {
  return apiCall({ action: "delete", dwg_id }, signal);
}

export async function updateMeta({ dwg_id, patch, signal }) {
  return apiCall({ action: "updateMeta", dwg_id, ...patch }, signal);
}

export async function duplicateDrawing({ dwg_id, dwg_name, dwg_description, signal }) {
  return apiCall({ action: "duplicate", dwg_id, dwg_name, dwg_description }, signal);
}
