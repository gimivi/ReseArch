// app/JSX_sub_modules/JSX-flow-nodes.mjs
// Nodi LiteGraph per pannelli JSX (JSXGraph). Step 9 di _doc/arch-abilitazioni.md §7:
// il disegno non viene più da un file .mjs caricato come modello (eseguito per
// chiunque aprisse l'oggetto, senza controlli), ma da un flow embedded con il
// nodo JSX/Script — che, contenendo codice, passa dalla validazione dei flow.
//
// JSX/Script: il codice riceve board, JXG, params (= mod_spec.params del
// modello) e vars. È il corpo del vecchio `setup(board, JXG, params)`: per
// migrare un file .mjs basta copiarne il corpo della funzione nel nodo.
// Contesto: graph._appContext.board / .JXG / .params (JSX-flow-runner.mjs).

import { makeAppScriptNode } from "../FLE_sub_modules/FLE-app-script-node.mjs";

export function registerJSXFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[JSX-flow-nodes] LiteGraph not available'); return; }
    if (window._JSX_FLOW_NODES_REGISTERED) return;
    window._JSX_FLOW_NODES_REGISTERED = true;

    const JSXScript = makeAppScriptNode(LG, {
        title: 'JSX Script',
        desc:  "Draws on the panel's JSXGraph board: the code receives board (JXG.Board already created with the mod_spec options), " +
               "JXG (JSXGraph namespace), params (the model's mod_spec.params) and vars. By default it runs once when the flow starts, " +
               "like the old setup() of .mjs files: to migrate a file, copy its body here. " +
               "Contains code: the flow must be validated before it runs for other users.",
        contextNames: ['board', 'JXG', 'params'],
        getContext: (graph) => {
            const ctx = graph?._appContext;
            return ctx?.board && ctx?.JXG ? { board: ctx.board, JXG: ctx.JXG, params: ctx.params ?? {} } : null;
        },
        defaultCode: "// board, JXG, params, vars\nconst A = board.create('point', [1, 2], { name: 'A' });\nreturn A;",
        missingContext: 'no JSX board: the flow must be attached to a JSX object (or tried with "Testa su panel")',
    });
    LG.registerNodeType('JSX/Script', JSXScript);
}
