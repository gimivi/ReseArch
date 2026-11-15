// js/login-bg/login-bg.mjs — sfondo generativo della pagina di accesso (index.php).
//
// Sceglie un generatore dall'elenco GENERATORS (attributo data-generator del contenitore #raLoginBg;
// se manca o non esiste, uno a caso), lo monta sul canvas e collega le due icone in basso a destra:
//   #raBgDownload → scarica il modello (un triangolo, OBJ) prodotto dal generatore;
//   #raBgPaper    → link all'articolo che descrive la logica del generatore (url e citazione da meta.paper).
// Per aggiungere un generatore: un file js/login-bg/<nome>.mjs con
//   export const meta = { id, title, paper: { url, citation } }
//   export function create(canvas, options) → { seed, exportOBJ(), destroy() }
// e una riga in GENERATORS.
// Se qualcosa va storto (niente WebGL, CDN irraggiungibile) si torna alla texture classica: window.raLoginTexture().

const GENERATORS = {
  triangoli: () => import('./pattern-triangoli.mjs'),
};

function fallback(err) {
  if (err) console.warn('[login-bg]', err);
  document.getElementById('raLoginBg')?.remove();
  document.getElementById('raBgTools')?.remove();
  document.body.classList.remove('ra-login-bg');
  window.raLoginTexture?.();
}

async function start() {
  const root = document.getElementById('raLoginBg');
  const canvas = root?.querySelector('canvas');
  if (!canvas) return fallback();

  const names = Object.keys(GENERATORS);
  const wanted = root.dataset.generator;
  const name = GENERATORS[wanted] ? wanted : names[Math.floor(Math.random() * names.length)];
  const mod = await GENERATORS[name]();
  const bg = mod.create(canvas);

  // icona: articolo
  const paper = document.getElementById('raBgPaper');
  if (paper && mod.meta?.paper?.url) {
    paper.href = mod.meta.paper.url;
    paper.title = mod.meta.paper.citation;
  } else paper?.remove();

  // icona: scarica il modello
  const dl = document.getElementById('raBgDownload');
  if (dl && typeof bg.exportOBJ === 'function') {
    dl.addEventListener('click', () => {
      const blob = new Blob([bg.exportOBJ()], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${mod.meta?.id || name}-${bg.seed}.obj`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  } else dl?.remove();

  // le icone vanno dentro il piede della pagina (partials/a11y_footer.php): così restano nella sua fascia
  // anche quando la pagina è più alta dello schermo e scorre
  const tools = document.getElementById('raBgTools');
  const footer = document.querySelector('body > footer');
  if (tools && footer) footer.appendChild(tools);
  tools?.removeAttribute('hidden');
}

start().catch(fallback);
