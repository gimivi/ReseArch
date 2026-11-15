// app/HTM_sub_modules/HTM-sanitize.mjs
// Pulizia dell'HTML che entra nella pagina della piattaforma (2026-10-21, estratta da model_HTM.mjs):
// usata dallo scheletro statico dei documenti HTM e dal nodo HTM/DOM/Set HTML.

const STRIP_TAGS = ['script', 'iframe', 'frame', 'object', 'embed', 'base', 'meta', 'link'];
const URL_ATTRS  = ['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'srcset'];

/**
 * Converte l'HTML in nodi SENZA eseguire nulla (DOMParser crea un documento inerte) e toglie
 * tutto ciò che può eseguire codice nel contesto della piattaforma: tag script/iframe/object/
 * embed/base/meta/link, attributi on*, URL javascript:/vbscript:/data:text/html, srcdoc.
 * stripStyles: toglie anche <style> (contenuti esterni: uno stile varrebbe per tutta la dashboard).
 * @returns {{ fragment: DocumentFragment, removed: number }}
 */
export function sanitizeHTML(html, { stripStyles = false } = {}) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    let removed = 0;
    const tags = stripStyles ? [...STRIP_TAGS, 'style'] : STRIP_TAGS;
    // <meta charset> (prima riga delle pagine salvate come file) si toglie senza contarlo: non esegue nulla
    doc.body.querySelectorAll(tags.join(',')).forEach(el => {
        if (!(el.localName === 'meta' && el.hasAttribute('charset') && el.attributes.length === 1)) removed++;
        el.remove();
    });
    doc.body.querySelectorAll('*').forEach(el => {
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();
            const val  = attr.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
            if (name.startsWith('on') || name === 'srcdoc' ||
                (URL_ATTRS.includes(name) && /(^|,)(javascript|vbscript):|^data:text\/html/.test(val))) {
                el.removeAttribute(attr.name);
                removed++;
            }
        }
    });
    const fragment = document.createDocumentFragment();
    for (const n of [...doc.body.childNodes]) fragment.appendChild(document.importNode(n, true));
    return { fragment, removed };
}
