// FLE_sub_modules/FLE-help-panel.mjs
// Pannello laterale "Help" per il Flow Editor (model_FLE.mjs, unico editor dei
// flow dal 2026-10-04): mostra la descrizione del nodo LiteGraph
// selezionato e il formato atteso di ciascun input/output. Sola lettura,
// nessuna persistenza — si aggiorna solo quando cambia la selezione nel
// canvas (lgCanvas.onNodeSelected/onNodeDeselected, vedi model_FLE.mjs),
// non ad ogni frame/hover: zero hit-test sul canvas, zero problemi di timing.
//
// Sorgente dei testi (prototipo 2026-09-19, categoria TJS/Geometry):
//  - Descrizione nodo: NodeType.desc — già presente su quasi tutti i nodi
//    custom del progetto, nessun nuovo dato richiesto per questa parte.
//  - Formato porte: NodeType.portHelp = { inputs: {nome: testo}, outputs: {nome: testo} },
//    proprietà statica OPZIONALE aggiunta nodo per nodo (vedi TJS-flow-nodes.mjs
//    per i primi esempi). Se assente per una porta si mostra solo il tipo
//    grezzo (fallback leggibile, mai un buco vuoto) — permette di estendere
//    la copertura in modo incrementale, un modulo/nodo alla volta.

import { t } from "../shared/i18n.mjs";

// Etichette dei tipi di porta (fallback quando il nodo non documenta la porta): chiavi del catalogo
const TYPE_LABELS = {
  number:     'app.fle.help.type.number',
  string:     'app.fle.help.type.string',
  boolean:    'app.fle.help.type.boolean',
  object:     'app.fle.help.type.object',
  array:      'app.fle.help.type.array',
  material:   'app.fle.help.type.material',
  texture:    'app.fle.help.type.texture',
  namefilter: 'app.fle.help.type.namefilter',
};

// Help statico della toolbar del Flow Editor (model_FLE.mjs::getToolbar) —
// mostrato solo quando nessun nodo è selezionato. Tenuto qui invece che in
// model_FLE.mjs perché è testo di help, non comportamento — se la toolbar
// cambia, questo elenco va aggiornato insieme (nessun collegamento
// automatico ai bottoni reali, è testo statico).
const TOOLBAR_HELP = [
  { icon: 'bi-fullscreen', labelKey: 'app.fle.help.tb.fit.label', descKey: 'app.fle.help.tb.fit.desc' },
  { icon: 'bi-fullscreen-exit', labelKey: 'app.fle.help.tb.one.label', descKey: 'app.fle.help.tb.one.desc' },
  { icon: 'bi-bezier2', labelKey: 'app.fle.help.tb.links.label', descKey: 'app.fle.help.tb.links.desc' },
  { icon: 'bi-grid-3x3', labelKey: 'app.fle.help.tb.grid.label', descKey: 'app.fle.help.tb.grid.desc' },
  { icon: 'bi-arrow-counterclockwise', labelKey: 'app.fle.help.tb.undo.label', descKey: 'app.fle.help.tb.undo.desc' },
  { icon: 'bi-floppy', labelKey: 'app.fle.help.tb.save.label', descKey: 'app.fle.help.tb.save.desc.@' },
  { icon: 'bi-trash', labelKey: 'app.fle.help.tb.clear.label', descKey: 'app.fle.help.tb.clear.desc' },
  { icon: 'bi-play-circle', labelKey: 'app.fle.help.tb.test.label', descKey: 'app.fle.help.tb.test.desc' },
  { icon: 'bi-play-fill', labelKey: 'app.fle.help.tb.run.label', descKey: 'app.fle.help.tb.run.desc' },
  { icon: 'bi-question-circle', labelKey: 'app.fle.help.tb.help.label', descKey: 'app.fle.help.tb.help.desc' },
];

function _formatType(type) {
  const LG = window.LiteGraph;
  if (LG && (type === LG.EVENT || type === LG.ACTION)) return t('app.fle.help.type.event');
  if (type === 0 || type === '0' || type === '*' || type == null) return t('app.fle.help.type.any');
  if (typeof type === 'string' && TYPE_LABELS[type]) return t(TYPE_LABELS[type]);
  return String(type);
}

export function fleCreateHelpPanel({ containerEl, signal }) {
  let panelEl      = null;
  let visible      = false;
  let currentNode  = null;

  // ── Costruzione ──────────────────────────────────────────────────────────

  function _group(label, icon) {
    const g = document.createElement('div');
    g.className = 'tjs-rpanel-group';
    const ttl = document.createElement('div');
    ttl.className = 'tjs-rpanel-group-title';
    if (icon) ttl.innerHTML = `<i class="bi ${icon}" style="margin-right:4px" aria-hidden="true"></i>`;
    ttl.appendChild(document.createTextNode(label));
    g.appendChild(ttl);
    return g;
  }

  function _portRow(port, helpMap) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:4px 2px;border-bottom:1px solid rgba(255,255,255,0.06)';
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:600;color:#dde;font-size:11px';
    nameEl.textContent = port.name;
    const fmtEl = document.createElement('div');
    fmtEl.style.cssText = 'font-size:10px;color:#99a;margin-top:1px';
    fmtEl.textContent = helpMap?.[port.name] ?? _formatType(port.type);
    row.appendChild(nameEl);
    row.appendChild(fmtEl);
    return row;
  }

  function _portList(group, ports, helpMap, emptyLabel) {
    if (ports.length) {
      for (const p of ports) group.appendChild(_portRow(p, helpMap));
    } else {
      const none = document.createElement('div');
      none.style.cssText = 'font-size:10px;color:#556;padding:2px';
      none.textContent = emptyLabel;
      group.appendChild(none);
    }
  }

  function _rebuild(scroll) {
    scroll.innerHTML = '';

    if (!currentNode) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:16px 12px 8px;font-size:11px;color:#889;text-align:center';
      msg.textContent = t('app.fle.help.select_node');
      scroll.appendChild(msg);

      const hr = document.createElement('hr');
      hr.style.cssText = 'width:70%;margin:8px auto;border:none;border-top:1px solid rgba(255,255,255,0.12)';
      scroll.appendChild(hr);

      // Legenda marcatore '°' (2026-09-21, su richiesta esplicita) — vedi
      // FLE-nodes.mjs, commento sopra "cls.title = newName.split('/').pop()
      // + ' °'" nel loop REMAP, dove il marcatore viene effettivamente
      // applicato ai nodi nativi.
      const legendGroup = _group(t('app.fle.help.legend_title'), 'bi-asterisk');
      scroll.appendChild(legendGroup);
      const legendText = document.createElement('div');
      legendText.style.cssText = 'font-size:10px;color:#99a;line-height:1.5;padding:2px 2px 6px';
      legendText.textContent = t('app.fle.help.legend_text');
      legendGroup.appendChild(legendText);

      const hr2 = document.createElement('hr');
      hr2.style.cssText = 'width:70%;margin:8px auto;border:none;border-top:1px solid rgba(255,255,255,0.12)';
      scroll.appendChild(hr2);

      const tbGroup = _group(t('app.fle.help.toolbar_title'), 'bi-tools');
      scroll.appendChild(tbGroup);
      for (const item of TOOLBAR_HELP) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:4px 2px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:6px;align-items:flex-start';
        const icon = document.createElement('i');
        icon.className = `bi ${item.icon}`;
        icon.setAttribute('aria-hidden', 'true');
        icon.style.cssText = 'color:#8ab;font-size:12px;margin-top:1px;flex-shrink:0';
        const textWrap = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-weight:600;color:#dde;font-size:11px';
        nameEl.textContent = t(item.labelKey);
        const descEl = document.createElement('div');
        descEl.style.cssText = 'font-size:10px;color:#99a;margin-top:1px';
        descEl.textContent = t(item.descKey);
        textWrap.appendChild(nameEl);
        textWrap.appendChild(descEl);
        row.appendChild(icon);
        row.appendChild(textWrap);
        tbGroup.appendChild(row);
      }
      return;
    }

    const node     = currentNode;
    const ctor     = node.constructor ?? {};
    const portHelp = ctor.portHelp ?? {};

    const infoGroup = _group(t('app.fle.help.node'), 'bi-info-circle');
    scroll.appendChild(infoGroup);

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:13px;font-weight:700;color:#fff;margin-bottom:2px';
    titleEl.textContent = node.title || ctor.title || node.type || '—';
    infoGroup.appendChild(titleEl);

    const typeEl = document.createElement('div');
    typeEl.style.cssText = 'font-size:10px;color:#778;margin-bottom:8px';
    typeEl.textContent = node.type ?? '';
    infoGroup.appendChild(typeEl);

    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:11px;color:#cde;line-height:1.4';
    descEl.textContent = ctor.desc || t('app.fle.help.no_desc');
    infoGroup.appendChild(descEl);

    const inputs  = node.inputs  ?? [];
    const outputs = node.outputs ?? [];

    const inGroup = _group(t('app.fle.help.inputs', { n: inputs.length }), 'bi-box-arrow-in-down-right');
    scroll.appendChild(inGroup);
    _portList(inGroup, inputs, portHelp.inputs, t('app.fle.help.no_inputs'));

    const outGroup = _group(t('app.fle.help.outputs', { n: outputs.length }), 'bi-box-arrow-up-right');
    scroll.appendChild(outGroup);
    _portList(outGroup, outputs, portHelp.outputs, t('app.fle.help.no_outputs'));

    // Proprietà/widget documentate dal nodo (portHelp.properties: { nome: testo }) —
    // aggiunto 2026-09-23 per i nodi HYS/*; mostrato solo se il nodo le documenta
    const propHelp = portHelp.properties ?? null;
    const propNames = propHelp ? Object.keys(propHelp) : [];
    if (propNames.length) {
      const propGroup = _group(t('app.fle.help.properties', { n: propNames.length }), 'bi-sliders');
      scroll.appendChild(propGroup);
      _portList(propGroup, propNames.map((name) => ({ name })), propHelp, '');
    }
  }

  function _buildPanel() {
    const el = document.createElement('div');
    el.className = 'tjs-rpanel-item';

    const hdr = document.createElement('div');
    hdr.className = 'tjs-rpanel-hdr';
    const title = document.createElement('span');
    title.className = 'tjs-rpanel-hdr-title';
    title.textContent = t('app.fle.help.title');
    hdr.appendChild(title);

    const hdrBtns = document.createElement('div');
    hdrBtns.className = 'tjs-rpanel-hdr-btns';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tjs-rpanel-hdr-btn';
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
    closeBtn.title = t('common.close');
    closeBtn.setAttribute('aria-label', t('common.close'));
    closeBtn.onclick = () => hide();
    hdrBtns.appendChild(closeBtn);
    hdr.appendChild(hdrBtns);
    el.appendChild(hdr);

    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow-y:auto;flex:1';
    el._scroll = scroll;
    el.appendChild(scroll);

    _rebuild(scroll);
    return el;
  }

  // ── API pubblica ─────────────────────────────────────────────────────────

  function setSelection(node) {
    currentNode = node ?? null;
    if (visible && panelEl?._scroll) _rebuild(panelEl._scroll);
  }

  function show() {
    if (!panelEl) { panelEl = _buildPanel(); containerEl.appendChild(panelEl); }
    panelEl.style.display = 'flex';
    containerEl.classList.add('is-active');
    visible = true;
  }

  function hide() {
    if (panelEl) panelEl.style.display = 'none';
    containerEl.classList.remove('is-active');
    visible = false;
  }

  function toggle() { if (visible) hide(); else show(); }

  function dispose() {
    panelEl?.remove();
    panelEl = null;
    visible = false;
  }

  if (signal) signal.addEventListener('abort', dispose, { once: true });

  return { show, hide, toggle, isVisible: () => visible, setSelection, dispose };
}
