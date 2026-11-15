// app/FLE_sub_modules/FLE-comfyui-client.mjs
// Client di un server ComfyUI (2026-10-04) — usato da ReseArch/Context/Service (type comfyui) e
// dai nodi AI/ComfyUI/Run e Receive. Richiede sul server il pacchetto research_bridge
// (integrations/comfyui/research_bridge) e l'avvio con --enable-cors-header <origine>.
// Specifica: _doc/integrazione-comfyui.md §9.

const WORKFLOWS_TTL = 5000;

/** Identificativo casuale del client (ComfyUI manda gli eventi di esecuzione a chi ha messo in coda). */
function newClientId() {
    const a = new Uint8Array(16);
    (globalThis.crypto || window.crypto).getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * JSON di ComfyUI letto in modo tollerante: Python scrive NaN / Infinity (es. "is_changed": [NaN]
 * nella storia dei prompt, da IS_CHANGED di nodi qualsiasi), che il JSON del browser rifiuta.
 * Fuori dalle stringhe diventano null; il resto del testo non viene toccato.
 */
export function parseComfyJSON(text) {
    try { return JSON.parse(text); } catch { /* prova a ripulire */ }
    let out = '', inStr = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            out += c;
            if (c === '\\') { out += text[++i] ?? ''; continue; }
            if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; out += c; continue; }
        if (text.startsWith('NaN', i)) { out += 'null'; i += 2; continue; }
        if (text.startsWith('-Infinity', i)) { out += 'null'; i += 8; continue; }
        if (text.startsWith('Infinity', i)) { out += 'null'; i += 7; continue; }
        out += c;
    }
    return JSON.parse(out);
}

export function createComfyClient(baseUrl) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
    const clientId = newClientId();

    async function send(path, init = {}) {
        let res;
        try {
            res = await fetch(base + path, init);
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            const e = new Error(`ComfyUI not reachable at ${base}: is it running? Start it with --enable-cors-header ${origin}`);
            e.network = true;   // errore di rete (o risposta senza CORS): uploadImage lo rilegge
            throw e;
        }
        if (!res.ok) {
            let j = null;
            try { j = parseComfyJSON(await res.text()); } catch { /* corpo non JSON */ }
            const e = j?.error;
            let msg = typeof e === 'string' ? e : (e?.message || '');
            if (e?.details) msg += ` (${e.details})`;
            // errori di validazione del workflow: un riassunto per nodo
            for (const [id, ne] of Object.entries(j?.node_errors ?? {})) {
                const first = ne?.errors?.[0];
                if (first) msg += ` · nodo ${id} ${ne.class_type || ''}: ${first.message}${first.details ? ' — ' + first.details : ''}`;
            }
            if (res.status === 404 && path.startsWith('/research/')) {
                msg = msg || 'research_bridge package not installed in ComfyUI (custom_nodes/research_bridge)';
            }
            throw new Error(`ComfyUI ${res.status}${msg ? ': ' + msg : ''}`);
        }
        return res;
    }
    const getJSON  = async (path, init) => parseComfyJSON(await (await send(path, init)).text());
    const postJSON = (path, body) => getJSON(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // ── WebSocket condiviso (eventi di esecuzione e annunci research.output) ──
    let ws = null, wsOpen = null, reconnectTimer = null;
    const listeners = new Set();
    function ensureSocket() {
        if (ws && ws.readyState === 1) return Promise.resolve();
        if (wsOpen) return wsOpen;
        wsOpen = new Promise((resolve, reject) => {
            let sock;
            try { sock = new WebSocket(base.replace(/^http/i, 'ws') + '/ws?clientId=' + clientId); }
            catch (err) { wsOpen = null; reject(err); return; }
            ws = sock;
            sock.onopen = () => { wsOpen = null; resolve(); };
            sock.onerror = () => { if (wsOpen) { wsOpen = null; reject(new Error('ComfyUI WebSocket not available')); } };
            sock.onclose = () => {
                if (ws === sock) ws = null;
                if (wsOpen) { wsOpen = null; reject(new Error('ComfyUI WebSocket closed')); }
                // ricollega da solo finché qualcuno ascolta (es. ComfyUI riavviato)
                if (listeners.size && !reconnectTimer) {
                    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (listeners.size) ensureSocket().catch(() => {}); }, 3000);
                }
            };
            sock.onmessage = (ev) => {
                if (typeof ev.data !== 'string') return;          // anteprime binarie: ignorate
                let msg; try { msg = parseComfyJSON(ev.data); } catch { return; }
                for (const fn of [...listeners]) { try { fn(msg); } catch (e) { console.error('[ComfyUI client]', e); } }
            };
        });
        return wsOpen;
    }

    // ── Stato dei Run di questo flow (2026-10-17): avvisi locali, senza WebSocket ──
    // ComfyUI Run → emitRun a ogni cambio di stato; ComfyUI Progress → onRun
    const runListeners = new Set();

    let workflows = [], workflowsAt = 0, workflowsInflight = null;

    return {
        type: 'comfyui',
        url: base,
        clientId,

        /** Versione di ComfyUI (verifica della connessione) + presenza del pacchetto research_bridge. */
        async check() {
            const stats = await getJSON('/system_stats');
            await getJSON('/research/info');
            return { version: stats?.system?.comfyui_version || '?' };
        },

        get cachedWorkflows() { return workflows; },
        /** Workflow pubblicati con ReseArch Publish: [{ name, inputs:[{key,kind,node}], outputs:[…] }]. */
        listWorkflows(force = false) {
            if (workflowsInflight) return workflowsInflight;
            if (!force && workflowsAt && Date.now() - workflowsAt < WORKFLOWS_TTL) return Promise.resolve(workflows);
            workflowsInflight = getJSON('/research/workflows')
                .then(j => { workflows = j?.workflows ?? []; workflowsAt = Date.now(); return workflows; })
                .finally(() => { workflowsInflight = null; });
            return workflowsInflight;
        },
        getWorkflow(name) { return getJSON('/research/workflows/' + encodeURIComponent(name)); },

        /**
         * Carica un'immagine (HTMLImageElement, canvas, video) nella cartella input; restituisce il nome per LoadImage.
         * maxSide > 0: se il lato più lungo lo supera, l'immagine viene rimpicciolita (proporzioni invariate).
         * (2026-10-14) Oltre --max-upload-size (100 MB di base) ComfyUI rifiuta l'invio con una risposta
         * senza CORS: il browser la vede come errore di rete. Qui il messaggio dice peso e motivo probabile.
         */
        async uploadImage(img, filename, { maxSide = 0 } = {}) {
            const w0 = img.naturalWidth || img.videoWidth || img.width, h0 = img.naturalHeight || img.videoHeight || img.height;
            if (!w0 || !h0) throw new Error('image empty or not loaded yet');
            const k = maxSide > 0 ? Math.min(1, maxSide / Math.max(w0, h0)) : 1;
            const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            let blob;
            try { blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error(`PNG conversion failed (${w}×${h}): image too large for the browser, lower maxImageSide`)), 'image/png')); }
            catch (err) {
                if (err?.name === 'SecurityError') throw new Error('image from another site without CORS permission: in Image Load use crossOrigin "anonymous" with a server that allows it');
                throw err;
            }
            const fd = new FormData();
            fd.append('image', blob, filename);
            fd.append('overwrite', 'true');
            fd.append('type', 'input');
            let j;
            try { j = await getJSON('/upload/image', { method: 'POST', body: fd }); }
            catch (err) {
                if (err?.network || /^ComfyUI 413/.test(err?.message || '')) {
                    const mb = (blob.size / 1048576).toFixed(1);
                    throw new Error(`image upload failed (PNG ${mb} MB, ${w}×${h}): probably above ComfyUI's limit ` +
                        `(--max-upload-size, 100 MB by default). Lower maxImageSide on the node or start ComfyUI with --max-upload-size 500`);
                }
                throw err;
            }
            return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
        },

        /** Mette in coda un workflow (formato API): restituisce prompt_id. */
        async queuePrompt(prompt) {
            const j = await postJSON('/prompt', { prompt, client_id: clientId });
            if (!j?.prompt_id) throw new Error('ComfyUI did not return a prompt_id');
            return j.prompt_id;
        },
        /** Ferma un'esecuzione (se è in corso) o la toglie dalla coda (se è in attesa). */
        async cancel(promptId) {
            await Promise.allSettled([
                postJSON('/interrupt', { prompt_id: promptId }),
                postJSON('/queue', { delete: [promptId] }),
            ]);
        },
        async history(promptId) { return (await getJSON('/history/' + encodeURIComponent(promptId)))?.[promptId] ?? null; },

        /** Coda attuale: job in esecuzione e in attesa (nell'ordine), con mine = messo in coda da questo client. */
        async getQueue() {
            const j = await getJSON('/queue');
            const norm = (arr, status) => (arr ?? [])
                .map(it => ({ id: it?.[1], number: it?.[0], status, mine: it?.[3]?.client_id === clientId, created: it?.[3]?.create_time ?? null }))
                .sort((a, b) => a.number - b.number)
                .map((x, i) => ({ ...x, position: i + 1 }));
            return { running: norm(j?.queue_running, 'in_progress'), pending: norm(j?.queue_pending, 'pending') };
        },
        /** Job recenti con i tempi (ComfyUI recente: /api/jobs). status: '' (tutti) | 'completed' | 'failed' | … */
        async getJobs({ limit = 20, status = '' } = {}) {
            const q = new URLSearchParams({ limit: String(limit), sort_order: 'desc' });
            if (status) q.set('status', status);
            try {
                return (await getJSON('/api/jobs?' + q))?.jobs ?? [];
            } catch (err) {
                if (/ComfyUI 404/.test(err?.message)) throw new Error('this ComfyUI version has no job list (/api/jobs): please update it');
                throw err;
            }
        },
        /** Risorse del server: sistema (RAM, versioni) e dispositivi (GPU, VRAM). */
        systemStats() { return getJSON('/system_stats'); },
        /** Tempi di un prompt dalla sua storia: istanti (ms) di invio, inizio e fine esecuzione. */
        timing(historyItem) {
            const t = { created: historyItem?.prompt?.[3]?.create_time ?? null, start: null, end: null };
            for (const m of historyItem?.status?.messages ?? []) {
                const [name, data] = m || [];
                if (name === 'execution_start') t.start = data?.timestamp ?? null;
                else if (name === 'execution_success' || name === 'execution_error' || name === 'execution_interrupted') t.end = data?.timestamp ?? null;
            }
            return t;
        },

        /** URL di un file con il suo nome vero nel percorso (research_bridge): i caricatori 3D
         *  riconoscono il formato dall'estensione e un OBJ trova .mtl e texture accanto. */
        fileUrl({ filename, subfolder = '', type = 'output' }) {
            const rel = [subfolder, filename].filter(Boolean).join('/').split('/').map(encodeURIComponent).join('/');
            return `${base}/research/file/${encodeURIComponent(type)}/${rel}`;
        },
        viewUrl({ filename, subfolder = '', type = 'output' }) {
            return `${base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
        },
        loadImage(entry) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`ComfyUI image not loaded (${entry.filename})`));
                img.src = this.viewUrl(entry);
            });
        },

        ensureSocket,
        /** Ascolta i messaggi del WebSocket (apre la connessione se serve); restituisce la funzione per smettere. */
        on(fn) {
            listeners.add(fn);
            ensureSocket().catch(() => {});
            return () => listeners.delete(fn);
        },
        /** Ascolta lo stato dei Run: fn({ workflow, node, phase, text, position, percent, wait_s, exec_s }). */
        onRun(fn) {
            runListeners.add(fn);
            return () => runListeners.delete(fn);
        },
        emitRun(info) {
            for (const fn of [...runListeners]) { try { fn(info); } catch (e) { console.error('[ComfyUI client]', e); } }
        },
        /** Chiude la connessione e dimentica gli ascoltatori (chi ascolta si riaggancia in onStart). */
        close() {
            listeners.clear();
            runListeners.clear();
            clearTimeout(reconnectTimer); reconnectTimer = null;
            try { ws?.close(); } catch { /* ignora */ }
            ws = null; wsOpen = null;
        },
    };
}
