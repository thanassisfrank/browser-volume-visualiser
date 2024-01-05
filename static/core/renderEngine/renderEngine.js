// renderEngine.js
// allows creation of a new rendering engine object
import { WebGPURenderEngine } from "./webGPU/webGPURenderEngine.js";
import { WebGPUBase } from "./webGPU/webGPUBase.js";
import { mat4 } from 'https://cdn.skypack.dev/gl-matrix';


// // applied to scene obj
// export const RenderModes = {
//     NONE:           0,
//     ISO_SURFACE:    1,
//     DATA_POINTS:    2,
//     ISO_POINTS:     4,
//     RAY_SURFACE:    8,
//     RAY_VOLUME:    16,
//     SURFACE:       32,
//     WIREFRAME:     64,
//     POINTS:       128,
// };

// Renderables ====================================================================================
// these are the objects directly consumed by draw calls

// applied to renderables to tell the renderer what kind of object it is
export const RenderableTypes = {
    EMPTY:          0,
    POINT_LIGHT:    1,
    MESH:           2,
    DATA:           4
};

export const RenderableRenderModes = {
    NONE:                   0,
    MESH_SURFACE:           1,
    MESH_WIREFRAME:         2,
    MESH_POINTS:            4,
    DATA_RAY_VOLUME:        8,
};

// base renderable object
export function Renderable(type = RenderableTypes.EMPTY, renderMode = RenderableRenderModes.NONE) {
    // from world -> object space
    // set and tracked externally by scene graph
    this.transform = mat4.create();

    // type is the class of object
    this.type = type;
    // renderMode tells the renderer what to do with this data
    this.renderMode = renderMode;

    // information about auxiliary functions the render engine can do
    this.depthSort = false;

    // renderData is what is held by the render engine
    // this needs to be explicitly deleted when an object is deleted
    this.renderData = {
        buffers: {},
        textures: {},
        samplers: {},
    };

    // additional data that doesn't need to be cleaned up
    this.passData = {};
    // a serialised version of the front and back materials
    this.serialisedMaterials = new Float32Array();

    // for meshes
    this.vertexCount = 0;
    this.indexCount = 0;
}



// the base renderengine prototype
export function EmptyRenderEngine() {
    this.setup = function(){};
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

