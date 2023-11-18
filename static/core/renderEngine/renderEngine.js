// renderEngine.js
// allows creation of a new rendering engine object
import { WebGPURenderEngine } from "./webGPU/webGPURenderEngine.js";
import { WebGPUBase } from "./webGPU/webGPUBase.js";
import {mat4} from 'https://cdn.skypack.dev/gl-matrix';
import { RenderableObjectTypes, traverseSceneGraph } from "./sceneObjects.js";

export const renderModes = {
    NONE: 0,
    ISO_SURFACE: 1,
    DATA_POINTS: 2,
    ISO_POINTS: 3,
    RAY_SURFACE: 4,
    RAY_VOLUME: 5,
    SURFACE: 6,
    WIREFRAME: 7,
    POINTS: 8
};

// the base renderengine prototype
export function EmptyRenderEngine() {
    this.setup = function(){};
    // TODO: accumulate transforms
    this.findCamera = function(scene){
        if (scene.length == 0) return;
        for (let obj of traverseSceneGraph(scene)) {
            // the objects from the children of this node
            if (obj.type == RenderableObjectTypes.CAMERA && obj.activeCamera == true) {
                return obj;
            }
        }
    }
    this.renderView = function(){};
    this.destroy = function(){};
}

export async function createRenderEngine(canvas) {
    if (navigator.gpu) {
        // use webGPU
        console.log("webgpu is supported")
        var webGPUBase = new WebGPUBase();
        await webGPUBase.setupWebGPU();
        return new WebGPURenderEngine(webGPUBase, canvas);
    } else {
        // use webgl
        module = "gl";
        console.log("webgpu is not supported, using webgl")
        return new EmptyRenderEngine();
    }
}

