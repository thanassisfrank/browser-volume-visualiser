// viewElems.js
// defines a set of classes that handle setup of the various possible elements within a view

import { DataArrayTypes } from "./core/data/dataConstants.js";
import { DataSrcTypes } from "./core/renderEngine/renderEngine.js";
import { ColourScales, DataSrcUses } from "./core/renderEngine/webGPU/rayMarching/webGPURayMarching.js";
import { get, hexStringToRGBArray, setupCanvasDims } from "./core/utils.js";


// close btn
export class CloseBtnHandler {
    #elem;

    #pressed = false;

    #listeners = {
        "click": (e) => {
            this.#pressed = true;
        },
        "mousedown": (e) => {
            e.stopPropagation();
        }
    }

    constructor(container) {
        this.#elem = container.querySelector(".view-close");

        this.addListeners();
    }

    get pressed() {
        return this.#pressed;
    }

    addListeners() {
        if (!this.#elem) return;

        for (let type in this.#listeners) {
            this.#elem.addEventListener(type, this.#listeners[type]);
        }
    }

    removeListeners() {
        if (!this.#elem) return;

        for (let type in this.#listeners) {
            this.#elem.removeEventListener(type, this.#listeners[type]);
        }
    }
}


export class DataSrcSelectElemHandler {
    #elem;
    #dataSrcUse;

    #changed = true;

    #listeners = {
        "change": e => this.#changed = true,
    };

    constructor(container, dataArrays, dataSrcUse) {
        this.#dataSrcUse = dataSrcUse;
        if (this.#dataSrcUse == DataSrcUses.ISO_SURFACE) {
            this.#elem = container.querySelector(".view-iso-surface-src-select");
        } else if (this.#dataSrcUse == DataSrcUses.SURFACE_COL) {
            this.#elem = container.querySelector(".view-surface-col-src-select");
        }

        const sources = [
            {name: "None", type: DataSrcTypes.NONE},
            {name: "x", type: DataSrcTypes.AXIS},
            {name: "y", type: DataSrcTypes.AXIS},
            {name: "z", type: DataSrcTypes.AXIS},
            ...dataArrays
        ];

        this.#init(sources)
    }

    #init(sources) {
        const axisGroup = document.createElement("optgroup");
        axisGroup.label = "Axis";

        const dataGroup = document.createElement("optgroup");
        dataGroup.label = "Data";

        const calcGroup = document.createElement("optgroup");
        calcGroup.label = "Calc";

        // setup the elem
        for (let srcDesc of sources) {
            const optElem = document.createElement("OPTION");
            optElem.dataset.type = srcDesc.type;  
            optElem.dataset.arrayType = srcDesc.arrayType;
            optElem.dataset.name = srcDesc.name;   
            optElem.innerText = srcDesc.name;

            if (srcDesc.type == DataSrcTypes.AXIS) {
                axisGroup.appendChild(optElem);
                continue;
            }
            if (srcDesc.type == DataSrcTypes.ARRAY) {
                if (srcDesc.arrayType == DataArrayTypes.DATA) {
                    dataGroup.appendChild(optElem);
                    continue;
                } else if (srcDesc.arrayType == DataArrayTypes.CALC) {
                    calcGroup.appendChild(optElem);
                    continue;
                }
            }
            this.#elem.appendChild(optElem);
        }

        if (axisGroup.childElementCount > 0) this.#elem.appendChild(axisGroup);
        if (dataGroup.childElementCount > 0) this.#elem.appendChild(dataGroup);
        if (calcGroup.childElementCount > 0) this.#elem.appendChild(calcGroup);

        // add event listener
        for (let type in this.#listeners) {
            this.#elem.addEventListener(type, this.#listeners[type]);
        }
    }

    getChanged() {
        if (this.#changed) {
            this.#changed = false;
            return true;
        }

        return false;
    }

    getSrc() {
        const selected = this.#elem.options[this.#elem.selectedIndex];
        return {
            name: selected.dataset.name,
            type: selected.dataset.type,
            arrayType: selected.dataset.arrayType
        };
    }

    removeListeners() {
        for (let type in this.#listeners) {
            this.#elem.removeEventListener(type, this.#listeners[type]);
        }
    }
}


// clip box
export class ClipElemHandler {
    #elems;
    #fullBox;

    constructor (container, extentBox) {
        this.#elems = {
            min: [
                container.querySelector(".view-clip-min-x"),
                container.querySelector(".view-clip-min-y"),
                container.querySelector(".view-clip-min-z"),
            ],
            max: [
                container.querySelector(".view-clip-max-x"),
                container.querySelector(".view-clip-max-y"),
                container.querySelector(".view-clip-max-z"),
            ]
        }

        this.#fullBox = structuredClone(extentBox);;

        this.setupElems(extentBox);
    }

    setupElems(extentBox) {
        for (let i = 0; i < this.#elems.min.length; i++) {
            const elem = this.#elems.min[i];
            if (!elem) continue;
            elem.min = extentBox.min[i];
            elem.max = extentBox.max[i];
            elem.step = (extentBox.max[i] - extentBox.min[i])/1000;
            elem.value = extentBox.min[i];
        }

        for (let i = 0; i < this.#elems.max.length; i++) {
            const elem = this.#elems.max[i];
            if (!elem) continue;
            elem.min = -extentBox.max[i];
            elem.max = -extentBox.min[i];
            elem.step = -(extentBox.max[i] - extentBox.min[i])/1000;
            elem.value = -extentBox.max[i];
        }
    }

    getClipBox() {
        return {
            min: [
                parseFloat(this.#elems.min[0].value) ?? this.#fullBox.min[0],
                parseFloat(this.#elems.min[1].value) ?? this.#fullBox.min[1],
                parseFloat(this.#elems.min[2].value) ?? this.#fullBox.min[2],
            ],
            max: [
                -parseFloat(this.#elems.max[0].value) ?? this.#fullBox.max[0],
                -parseFloat(this.#elems.max[1].value) ?? this.#fullBox.max[1],
                -parseFloat(this.#elems.max[2].value) ?? this.#fullBox.max[2],
            ],
        }
    }

    removeListeners() {}
}

// threshold slider
export class ThresholdSliderHandler {
    #elem;
    #readoutElem;

    #thresholdTrackers = {};

    #listeners = {
        "mousedown": (e) => {
            e.stopPropagation();
        }
    }

    constructor(container, width="210px") {
        this.#elem = container.querySelector(".view-threshold");
        this.#readoutElem = container.querySelector(".view-threshold-value");

        this.#setupElem(width);
    }

    #setupElem(width) {
        if (!this.#elem) return;
        this.#elem.style.width = width;

        for (let type in this.#listeners) {
            this.#elem.addEventListener(type, this.#listeners[type]);
        }
    }

    setLimits(limits) {
        const val = (limits[0] + limits[1]) / 2;

        if (this.#elem) {
            this.#elem.min = limits[0];
            this.#elem.max = limits[1];
            this.#elem.step = (limits[1] - limits[0]) / 5000;
            
            this.#elem.value = val;
        }
        
        this.setValue(val);
    }

    setValue(val) {
        if (this.#elem) this.#elem.value = val;;
        if (this.#readoutElem) this.#readoutElem.innerText = val.toPrecision(3);

        for (let id in this.#thresholdTrackers) {
            this.#thresholdTrackers[id] = true;
        }
    }

    getValue() {
        return parseFloat(this.#elem.value);
    }

    didThresholdChange(id = "default") {
        const changed = this.#thresholdTrackers[id] ?? true;
        this.#thresholdTrackers[id] = false;
        return changed;
    };

    removeListeners() {
        if (!this.#elem) return;

        for (let type in this.#listeners) {
            this.#elem.removeEventListener(type, this.#listeners[type]);
        }
    }
}


// frame
export class FrameElemHandler {
    #elem;
    #camera;
    #shiftFac;

    #listeners = {
        "mousedown": (e) => {
            if (this.#elem.requestPointerLock) {
                this.#elem.requestPointerLock()
                    .catch(e => console.log("couldn't lock pointer"));
            }
            if (e.ctrlKey) {
                // pan
                this.#camera.startMove(e.movementX, e.movementY, 0, "pan");
            } else if (e.altKey) {
                // dolly forward/back
                this.#camera.startMove(0, 0, e.movementY, "dolly");
            } else {
                // rotate
                this.#camera.startMove(e.movementX, e.movementY, 0, "orbit");
            }
        },
        "mousemove": (e) => {
            let x = e.movementX;
            let y = e.movementY;
            if (e.shiftKey) {
                x *= this.#shiftFac;
                y *= this.#shiftFac;
            }
            if (e.ctrlKey) {
                // pan
                this.#camera.move(x, y, 0, "pan");
            } else if (e.altKey) {
                // dolly forward/back
                this.#camera.move(0, 0, y, "dolly");
            } else {
                // rotate
                this.#camera.move(x, y, 0, "orbit");
            }
        },
        "mouseup": (e) => {
            if (document.exitPointerLock) {
                document.exitPointerLock();
            }
            this.#camera.endMove();
        },
        "mouseleave": (e) => {
            this.#camera.endMove();
        },
        "wheel": (e) => {
            e.preventDefault();
            this.#camera.startMove(0, 0, 0, "orbit");
            this.#camera.move(0, 0, e.deltaY, "orbit");
            this.#camera.endMove();
        }
    }

    constructor(container, camera, shiftFac=0.5) {
        this.#elem = container.querySelector(".view-frame");
        this.#camera = camera;
        this.#shiftFac = shiftFac;

        for (let type in this.#listeners) {
            this.#elem.addEventListener(type, this.#listeners[type]);
        }
    }

    getBox() {
        return this.#elem?.getBoundingClientRect();
    }

    removeListeners() {
        for (let type in this.#listeners) {
            this.#elem.removeEventListener(type, this.#listeners[type]);
        }
    }
}


// volume transfer
export class TransferFunctionHandler {
    #colElems;
    #opElems;

    constructor(container) {
        this.#colElems = Array(...container.querySelectorAll(".view-vol-col"));
        this.#opElems  = Array(...container.querySelectorAll(".view-vol-op"));
    }
    
    getTransferFunction() {
        return {
            colour: this.#colElems.map(elem => hexStringToRGBArray(elem.value)),
            opacity: this.#opElems.map(elem => parseFloat(elem.value))
        }
    }

    removeListeners() {}
}

// geom enable
export class EnabledGeometryHandler {
    #elem;
    #enableTemplate;
    #data;

    constructor (container, data) {
        this.#elem = container.querySelector(".view-geometry-enable-container");
        this.#enableTemplate = get("geometry-enable-template");

        this.#data = data;

        this.init();
    }

    init() {
        // initialise the geometry enable checkboxes
        
        for (let meshName in this.#data.geometry) {
            const docFrag = this.#enableTemplate.content.cloneNode(true);

            docFrag.querySelector("label").innerText = meshName;
            const checkbox = docFrag.querySelector(".view-enable-geometry");
            checkbox.dataset.geometryName = meshName;
            checkbox.checked = this.#data.geometry[meshName].showByDefault;

            this.#elem.appendChild(docFrag);
        }
    }

    getEnabledGeometry() {
        return {};
    }

    removeEventListeners() {}
}

// col scale select
export class ColScaleHandler {
    #elem;

    constructor(container) {
        this.#elem = container.querySelector(".view-surface-col-scale-select");

        this.setupElem();
    }

    setupElem() {
        if (!this.#elem) return;

        for (let scale in ColourScales) {
            const subElem = document.createElement("OPTION");
            subElem.innerText = scale;
            subElem.value = ColourScales[scale];     
            this.#elem.appendChild(subElem);
        }
    }

    getValue() {
        return this.#elem.value;
    }

    removeListeners() {}
}


export class AxesWidget {
    canvas;
    ctx;
    invertY;
    vecCols = ["#f00", "#0f0", "#00f"];

    constructor(container, invertY = true) {
        this.canvas = container.querySelector(".view-axes-widget")
        this.invertY = invertY;

        this.init();
    }

    // initialise the canvas
    init () {
        this.ctx = this.canvas.getContext("2d");
        this.vectorLength = Math.min(this.canvas.width, this.canvas.height) / 2;
        this.midPoint = [this.canvas.width / 2, this.canvas.height / 2];
    }

    // update the axes display, expects viewMat is gl-matrix formatted
    update (viewMat) {
        if (!this.canvas) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (let i = 0; i < 3; i++) {
            // extract basis vector directions
            const vecOut = [viewMat[4 * i + 0], viewMat[4 * i + 1], viewMat[4 * i + 2]];

            this.ctx.strokeStyle = this.vecCols[i];
            this.ctx.beginPath();
            this.ctx.moveTo(this.midPoint[0], this.midPoint[1]);
            this.ctx.lineTo(
                vecOut[0] * this.vectorLength + this.midPoint[0],
                vecOut[1] * this.vectorLength * (this.invertY ? -1 : 1) + this.midPoint[1]
            );
            this.ctx.stroke();
        }
    }
}
