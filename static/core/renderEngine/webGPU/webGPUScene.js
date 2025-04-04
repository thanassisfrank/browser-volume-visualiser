// webGPURenderableManager.js
// handles the creation of renderable objects for the various scene objects available

import { Renderable, RenderableTypes, RenderableRenderModes} from "../renderEngine.js";
import { SceneObjectRenderModes } from "../sceneObjects.js";

export class WebGPUScene {
    #webGPU;
    #rayMarcher;
    #meshRender;

    // the scene graph, kept internal
    #graph;

    constructor(webGPU, rayMarcher, meshRender) {
        this.#webGPU = webGPU;
        this.#rayMarcher = rayMarcher;
        this.#meshRender = meshRender;

        this.#graph = [];
    }

    // creates a bounding box wireframe mesh 
    // uses box : {min : num[3], max : num[3]}
    addBoundingBox(box) {
        const points = new Float32Array([
            ...box.min,
            box.max[0], box.min[1], box.min[2],
            box.min[0], box.max[1], box.min[2],
            box.max[0], box.max[1], box.min[2],
            box.min[0], box.min[1], box.max[2],
            box.max[0], box.min[1], box.max[2],
            box.min[0], box.max[1], box.max[2],
            ...box.max,
        ]);
        
        const renderable = this.#meshRender.createMeshRenderable(
            points,
            new Uint32Array([
                0, 1,
                0, 2,
                0, 4,
                1, 3,
                1, 5,
                2, 3,
                2, 6,
                3, 7,
                4, 5,
                4, 6,
                5, 7,
                6, 7
            ]),
            RenderableRenderModes.MESH_WIREFRAME
        );

        // add to the scene graph
        this.#graph.push(renderable);
    }

    addMesh(mesh) {
        const renderable = this.#meshRender.createMeshRenderable(mesh.verts, mesh.indices, mesh.renderMode, mesh.material);
        this.#graph.push(renderable);
    }

    addVector(start, end, color=[0, 0, 0]) {
        const renderable = this.#meshRender.createMeshRenderable(
            new Float32Array([...start, ...end]),
            new Uint32Array([0, 1]),
            RenderableRenderModes.MESH_WIREFRAME,
            {front: { diffuseCol: color }, back: { diffuseCol: color }}
        );

        this.#graph.push(renderable);
    }

    addAxes(origin, length) {
        this.addVector(origin, [origin[0] + length, origin[1], origin[2]], [1, 0, 0]);
        this.addVector(origin, [origin[0], origin[1] + length, origin[2]], [0, 1, 0]);
        this.addVector(origin, [origin[0], origin[1], origin[2] + length], [0, 0, 1]);
    }

    // expects a data object 
    async addData(data, renderMode) {
        if (renderMode === SceneObjectRenderModes.NONE) return;
        if (renderMode & SceneObjectRenderModes.BOUNDING_WIREFRAME) {
            this.addBoundingBox(data.extentBox);
        }
        if (renderMode & SceneObjectRenderModes.DATA_RAY_VOLUME) {
            // create renderable for data
            this.#graph.push(await this.#rayMarcher.createRenderable(data));
        }
        if (renderMode & SceneObjectRenderModes.DATA_MESH_GEOMETRY) {
            // create mesh renderables
            if (data.geometry) {
                Object.values(data.geometry).map(mesh => this.addMesh(mesh));
            }
        }
    }

    // called externally to get a list of all renderables
    getRenderables() {
        // for now, graph is a simple list of all renderables
        // TODO: return sorted in correct render order
        return this.#graph;
    }

    getRenderablesOfType(type) {
        return this.getRenderables().filter(r => r.type & type);
    }

    // updates the internal states of a renderable
    // updates is an object that can hold arbitrary data
    updateRenderable(renderable, updates) {
        // see what type this renderable is
        // see what render mode this renderable has

        if (renderable.type & RenderableTypes.MESH) {
            // turn visibility on/off
        }

        if (renderable.type & RenderableTypes.UNSTRUCTURED_DATA) {
            if (renderable.renderMode & RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME) {
                // update renderable using the ray marcher
                this.#rayMarcher.updateUnstructuredDataRenderable(renderable, updates);
            }
        }
    }

    // called to manually delete all renderables and free resources
    clear() {
        for (let renderable of this.#graph) {
            this.#clearRenderable(renderable);
        }
    }

    #clearRenderable(renderable) {
        // the important data is stored within renderData
        var textures = renderable.renderData.textures;
        for (let textureName in textures) {
            this.#webGPU.deleteTexture(textures[textureName]);
        }
        var buffers = renderable.renderData.buffers;
        for (let bufferName in buffers) {
            const entry = buffers[bufferName];
            if (Array.isArray(entry)) {
                for (let buff of entry) {
                    this.#webGPU.deleteBuffer(buff);
                }
            } else {
                this.#webGPU.deleteBuffer(entry);
            }
        }
    }
}