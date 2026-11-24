// FLE_sub_modules/FLE-node-Point3DSum.mjs
// Operazione componente per componente fra due punti/vettori 3D: + - * /
// (2026-11-24; prima faceva solo la somma).
//
// Input:  A, B   → vec3: [x, y, z] oppure {x, y, z} (guide-fle-regole-nodi §2)
// Output: result → vec3: array [x, y, z] nuovo a ogni calcolo
//
// Un ingresso vuoto vale l'elemento neutro dell'operazione: 0 per + e -, 1 per * e /.
// La divisione per 0 segue JavaScript: Infinity, oppure NaN per 0/0.
//
// Tipo registrato: "Vector/Math/Point3DSum" (nome storico, resta per i grafi salvati).

const OPERATIONS = {
    "+": { neutral: 0, fn: (a, b) => a + b },
    "-": { neutral: 0, fn: (a, b) => a - b },
    "*": { neutral: 1, fn: (a, b) => a * b },
    "/": { neutral: 1, fn: (a, b) => a / b },
};
const OPERATION_NAMES = Object.keys(OPERATIONS);
const TEXT_ROW = 16;   // riga del risultato, sotto il widget

/** [x,y,z] | {x,y,z} → [x,y,z]; componenti assenti = 0; nessun vettore = elemento neutro. */
function readVec3(v, neutral) {
    if (v == null || typeof v !== "object") return [neutral, neutral, neutral];
    if (Array.isArray(v) || ArrayBuffer.isView(v)) return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
    return [v.x ?? 0, v.y ?? 0, v.z ?? 0];
}

export function registerPoint3DSum(LiteGraph) {

    function Point3DOperationNode() {
        this.addProperty("operation", "+", "enum", { values: OPERATION_NAMES });
        this.addWidget("combo", "operation", "+", v => { this.properties.operation = v; },
            { values: OPERATION_NAMES, property: "operation" });

        this.addInput("A", "vec3");
        this.addInput("B", "vec3");
        this.addOutput("result", "vec3");

        this.size = this.computeSize();
        this._result = null;
    }

    Point3DOperationNode.title = "Point3D Operation";
    Point3DOperationNode.desc  = "Component-wise operation (+ - * /) between two 3D points/vectors";
    Point3DOperationNode.portHelp = {
        inputs: {
            A: "3D point/vector — [x, y, z] or {x, y, z}. Empty = neutral element (0 for + and -, 1 for * and /).",
            B: "3D point/vector — [x, y, z] or {x, y, z}. Empty = neutral element. Not a number: to multiply by a single factor use Vector/Math/Scale.",
        },
        outputs: {
            result: "[x, y, z] — each component of A combined with the same component of B. Dividing by 0 gives Infinity (NaN for 0/0).",
        },
        properties: {
            operation: "+ sum, - difference (A - B), * product, / quotient (A / B).",
        },
    };

    // Calcolo senza stato: ricalcolato quando viene letto (lib/litegraph, patch 7)
    Point3DOperationNode.pure = true;

    Point3DOperationNode.prototype.computeSize = function () {
        const size = LiteGraph.LGraphNode.prototype.computeSize.call(this);
        size[1] += TEXT_ROW;
        return size;
    };

    // Nodi salvati quando il nodo faceva solo la somma: uscita "A+B" e senza posto per il widget
    Point3DOperationNode.prototype.onConfigure = function () {
        if (this.outputs?.[0]) this.outputs[0].name = "result";
        const min = this.computeSize();
        this.size[0] = Math.max(this.size[0], min[0]);
        this.size[1] = Math.max(this.size[1], min[1]);
    };

    Point3DOperationNode.prototype.onExecute = function () {
        const { neutral, fn } = OPERATIONS[this.properties.operation] ?? OPERATIONS["+"];
        const a = readVec3(this.getInputData(0), neutral);
        const b = readVec3(this.getInputData(1), neutral);
        this._result = [fn(a[0], b[0]), fn(a[1], b[1]), fn(a[2], b[2])];
        this.setOutputData(0, this._result);
    };

    // Mostra il risultato nel box del nodo
    Point3DOperationNode.prototype.onDrawBackground = function (ctx) {
        if (this.flags?.collapsed || !this._result) return;
        ctx.font = "10px monospace";
        ctx.fillStyle = "#aaa";
        ctx.textAlign = "left";
        ctx.fillText(`[${this._result.map(n => Number(n).toFixed(2)).join(", ")}]`, 8, this.size[1] - 6);
    };

    LiteGraph.registerNodeType("Vector/Math/Point3DSum", Point3DOperationNode);
}
