// march.js
// handles the interface between main program and marching apis
// chooses which to use depending on availability
import * as gpu from "../webGPU.js";
import * as wasm from "./marchingWasm.js";
import * as js from "./marchingJS.js";

export var module;

export var maxBufferSize;

export function autoSetMarchModule() {
    if (navigator.gpu) {
        // use webGPU
        setMarchModule("gpu");
        console.log("webgpu is supported")
    } else {
        // use wasm
        setMarchModule("wasm");
        console.log("webgpu is not supported, using wasm")
    }
}


export function updateBuffersNeeded() {
    return module != "gpu";
}

export function setMarchModule(thisModule) {
    module = thisModule;
}

export function getMarchModule() {
    return module;
}

export async function setupMarchModule() {
    if (module == "gpu") {
        await gpu.setupMarchModule();
        maxBufferSize = gpu.maxStorageBufferBindingSize;
    } else if (module == "wasm") {
        await wasm.setupWasm();
    }
}

export async function setupMarch(...args) {
    if (module == "gpu") {
        await gpu.setupMarch(...args);
    } else if (module == "wasm") {
        await wasm.setupData(...args);
    }
}

export async function setupMarchFine(...args) {
    if (module == "gpu") {
        await gpu.setupMarchFine(...args);
    } else if (module == "wasm") {
        await wasm.setupMarchFine(...args);
    }
}

// called when marching a regular grid of raw data
export async function march(...args) {
    if (module == "gpu") {
        await gpu.march(...args);
    } else if (module == "wasm") {
        wasm.generateMeshWasm(...args);
    } else {
        js.generateMesh(...args);
    }
}

export async function marchMulti(datas, meshes, threshold) {
    if (module == "gpu") {
        // set off all marches asynchronously
        for (let i = 0; i < datas.length; i++) {
            march(datas[i], meshes[i], threshold);
        }
        // wait until queue is empty again
        await gpu.waitForDone();
    } else {
        for (let i = 0; i < datas.length; i++) {
            await march(datas[i], meshes[i], threshold);
        }
    }
}

export async function updateActiveBlocks(...args) {
    if (module == "gpu") {
        await gpu.updateActiveBlocks(...args);
    } else if (module == "wasm") {
        wasm.updateActiveBlocks(...args);
    }
}

export async function updateMarchFineData(...args) {
    if (module == "gpu") {
        await gpu.updateMarchFineData(...args);
    } else if (module == "wasm") {
        wasm.updateMarchFineData(...args);
    }
}
// called when marching
export async function marchFine(...args) {
    if (module == "gpu") {
        await gpu.marchFine(...args);
    } else if (module == "wasm") {
        wasm.generateMeshFineWASM(...args);
    }
}

export async function cleanupMarchData(...args) {
    // wasm instances are garbage collected
    if (module == "gpu") {
        await gpu.cleanupMarchData(...args);
    }
}