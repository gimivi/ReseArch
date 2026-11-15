// FLE_sub_modules/FLE-node-Point3DSum.mjs
// Nodo custom esemplificativo: somma di due punti 3D (vettori [x, y, z]).
//
// Input:  A → vec3 [x, y, z]
//         B → vec3 [x, y, z]
// Output: A+B → vec3 somma componente per componente
//
// Tipo registrato: "Vector/Math/Point3DSum"

export function registerPoint3DSum(LiteGraph) {

    // --- Costruttore del nodo ---
    function Point3DSumNode() {
        this.addInput("A", "vec3");
        this.addInput("B", "vec3");
        this.addOutput("A+B", "vec3");

        // Dimensione di default del box
        this.size = [160, 60];

        // Valore di output iniziale (utile per ispezione prima dell'esecuzione)
        this._result = [0, 0, 0];
    }

    // Metadati statici letti da LiteGraph
    Point3DSumNode.title = "Point3D Sum";
    Point3DSumNode.desc  = "Sum of two 3D points/vectors [x, y, z]";

    // --- Esecuzione (chiamata ad ogni tick del graph loop) ---
    Point3DSumNode.prototype.onExecute = function () {
        const a = this.getInputData(0) ?? [0, 0, 0];
        const b = this.getInputData(1) ?? [0, 0, 0];

        const ax = typeof a === "number" ? a : (a[0] ?? 0);
        const ay = typeof a === "number" ? 0 : (a[1] ?? 0);
        const az = typeof a === "number" ? 0 : (a[2] ?? 0);
        const bx = typeof b === "number" ? b : (b[0] ?? 0);
        const by = typeof b === "number" ? 0 : (b[1] ?? 0);
        const bz = typeof b === "number" ? 0 : (b[2] ?? 0);

        this._result = [ax + bx, ay + by, az + bz];
        this.setOutputData(0, this._result);
    };

    // --- Disegno aggiuntivo: mostra il risultato nel box del nodo ---
    Point3DSumNode.prototype.onDrawBackground = function (ctx) {
        if (this.flags?.collapsed) return;
        const r = this._result;
        if (!r) return;

        ctx.font = "10px monospace";
        ctx.fillStyle = "#aaa";
        ctx.fillText(
            `[${r[0].toFixed(2)}, ${r[1].toFixed(2)}, ${r[2].toFixed(2)}]`,
            8,
            this.size[1] - 6
        );
    };

    // --- Registrazione ---
    LiteGraph.registerNodeType("Vector/Math/Point3DSum", Point3DSumNode);
}
