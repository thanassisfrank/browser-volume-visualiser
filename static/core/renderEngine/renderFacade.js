// render.js
// handles the interface between main program and rendering apis
// chooses which to use depending on availability
import * as gpu from "./webGPU.js";
import * as gl from "./webgl.js";
import {module as marchModule} from "./marchingCubes/march.js";

export {
    autoSetRenderModule, 
    setRenderModule, 
    setupRenderer, 
    createBuffers, 
    buffersUpdateNeeded, 
    updateMeshBuffers, 
    renderView, 
    renderMesh,
    renderPoints, 
    deleteBuffers, 
    clearScreen, 
    resizeRenderingContext,
    renderModes
};

var module;

const renderModes = {
    ISO_SURFACE: 1,
    DATA_POINTS: 2,
    ISO_POINTS: 3
}

function autoSetRenderModule() {
    if (navigator.gpu) {
        // use webGPU
        module = "gpu";
        console.log("webgpu is supported")
    } else {
        // use webgl
        module = "gl";
        console.log("webgpu is not supported, using webgl")
    }
}

function setRenderModule(thisModule) {
    module = thisModule;
}

function changeModule() {}

function setupRenderer(...args) {
    if (module == "gpu") {
        return gpu.setupRenderer(...args);
    } else {
        return gl.setupRenderer(...args);
    }
}

function createBuffers(...args) {
    if (module == "gpu") {
        return gpu.createBuffers(...args);
    } else {
        return gl.createBuffers(...args);
    }
}

function buffersUpdateNeeded(...args) {
    if (!module) {
        return false;
    }
    return !(module == "gpu" && marchModule == "gpu")
}

function updateMeshBuffers(...args) {
    if (module == "gpu") {
        return gpu.updateBuffers(...args);
    } else {
        return gl.updateBuffers(...args);
    }
}

function renderView(...args) {
    if (module == "gpu") {
        return gpu.renderView(...args);
    } else {
        return gl.renderView(...args);
    }
}

function renderMesh(...args) {
    if (module == "gpu") {
        return gpu.renderMesh(...args);
    } else {
        console.log("not implemented yet")
    }
}

function renderPoints(...args) {
    if (module == "gpu") {
        return gpu.renderPoints(...args);
    }
}

function deleteBuffers(...args) {
    if (module == "gpu") {
        return gpu.deleteBuffers(...args);
    } else {
        return gl.deleteBuffers(...args);
    }
}

function clearScreen(...args) {
    if (module == "gpu") {
        return gpu.clearScreen(...args);
    } else {
        return gl.clearScreen(...args);
    }
}

function resizeRenderingContext(...args) {
    if (module == "gpu") {
        return gpu.resizeRenderingContext(...args)
    }
}