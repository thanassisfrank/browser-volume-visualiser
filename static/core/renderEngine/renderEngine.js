// renderEngine.js
// allows creation of a new rendering engine object
import { WebGPURenderEngine } from "./webGPU/webGPURenderEngine.js";
import { WebGPUBase } from "./webGPU/webGPUBase.js";
import { mat4 } from '../utils/gl-matrix.js';

export const DataSrcTypes = {
    NONE:  "none",
    AXIS:  "axis",
    ARRAY: "array" 
}

export const DataSrcNames = {}

export const DataSrcUints = {
    NONE:    0,
    VALUE_A: 1,
    VALUE_B: 2,
    AXIS_X:  3,
    AXIS_Y:  4,
    AXIS_Z:  5
}

export const GPUResourceTypes = {
    NONE: 0,
    BUFFER: 1,
    TEXTURE: 2
}


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
    EMPTY:              0,
    POINT_LIGHT:        1,
    MESH:               2,
    DATA:               4,
    UNSTRUCTURED_DATA:  8,
};

export const RenderableRenderModes = {
    NONE:                           0,
    MESH_SURFACE:                   1,
    MESH_WIREFRAME:                 2,
    MESH_POINTS:                    4,
    DATA_RAY_VOLUME:                8,
    UNSTRUCTURED_DATA_RAY_VOLUME:  16,
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

    // information about sorting
    // whether to enable depth dorting for this element
    this.depthSort = false;
    // the coords of the point used for depth sorting in object space
    this.objectSpaceMidPoint = [null, null, null];
    // whether this renderable is considered high priority to be drawn first
    this.highPriority = false;


    // renderData is what is held by the render engine
    // this needs to be explicitly deleted when an object is deleted
    this.renderData = {
        buffers: {},
        textures: {},
        samplers: {},
        bindGroups: {},
    };

    // data that is a reference to another renderable
    // not owned by this one, shouldn't be deleted when this is
    this.sharedData = {
        buffers: {},
        textures: {},
        samplers: {},
        bindGroups: {},
    }

    // additional data that doesn't need to be cleaned up
    this.passData = {};
    // a serialised version of the front and back materials
    this.serialisedMaterials = new Float32Array();

    // for meshes
    this.vertexCount = 0;
    this.indexCount = 0;
}


export async function createRenderEngine(canvas, verbose=false) {
    if (!navigator.gpu) throw Error("WebGPU not supported");

    // use webGPU
    var webGPUBase = new WebGPUBase(verbose);
    await webGPUBase.setupWebGPU();
    const renderEngine = new WebGPURenderEngine(webGPUBase, canvas);
    await renderEngine.setup();
    return renderEngine;
}

