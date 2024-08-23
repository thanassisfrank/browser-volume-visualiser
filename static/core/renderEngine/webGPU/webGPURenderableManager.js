// webGPURenderableManager.js
// handles the creation of renderable objects for the various scene objects available

import { EmptyRenderEngine, Renderable, RenderableTypes, RenderableRenderModes} from "../renderEngine.js";
import {mat4, vec4, vec3} from 'https://cdn.skypack.dev/gl-matrix';
import { SceneObjectTypes, SceneObjectRenderModes, defaultMaterial} from "../sceneObjects.js";
import { DataFormats, ResolutionModes } from "../../data/data.js";

import * as cgns from "../../data/cgns_hdf5.js";


export function WebGPURenderableManager(webGPUBase, rayMarcher) {
    var webGPU = webGPUBase;
    this.rayMarcher = rayMarcher;

    // setup scene object for rendering ===========================================================
    // create the needed renderables for a scene object to be displayed as desired
    
    // take a scene object as input and creates its needed renderables
    this.setupSceneObject = function(sceneObj) {
        // get rid of any renderables already present
        for (let renderable of sceneObj.renderables) {
            this.destroyRenderable(renderable);
        }

        if (sceneObj.renderMode == SceneObjectRenderModes.NONE) return;

        if (sceneObj.renderMode & SceneObjectRenderModes.BOUNDING_WIREFRAME) {
            // create a bounding wireframe for the object
            sceneObj.renderables.push(this.createBoundingWireFrame(sceneObj));
        }
        // first filter by object type
        switch (sceneObj.objectType) {
            case SceneObjectTypes.MESH:
                this.setupMeshSceneObject(sceneObj);
                break;
            case SceneObjectTypes.DATA:
                this.setupDataSceneObject(sceneObj);
                break; 
            case SceneObjectTypes.AXES:
                this.setupAxesSceneObject(sceneObj);
                break;
            case SceneObjectTypes.VECTOR:
                this.setupVectorObject(sceneObj);
                break;
            // nothing is rendered for these by default
            case SceneObjectTypes.EMPTY:
            case SceneObjectTypes.CAMERA:
            case SceneObjectTypes.LIGHT:
            default:
                break;
        }
    }  

    this.updateSceneObject = function(dt, sceneObj) {
        switch (sceneObj.objectType) {
            case SceneObjectTypes.DATA:
                this.updateDataRenderables(sceneObj);
                break;
            default:
                break;
        }
        
    }

    this.updateDataRenderables = function(data) {
        // propogate the threshold to its renderables
        for (let renderable of data.renderables) {
            renderable.passData.threshold = data.threshold;
        }
        if (data.renderMode & SceneObjectRenderModes.DATA_RAY_VOLUME && data.resolutionMode == ResolutionModes.DYNAMIC) {
            // setup the dataset for ray marching
            this.rayMarcher.updateDynamicDataObj(data);
        }
    }

    this.clearRenderables = function(sceneObj) {
        for (let renderable of sceneObj.renderables) {
            this.destroyRenderable(renderable);
        }
    }

    this.destroyRenderable = function(renderable) {
        // the important data is stored within renderData
        var textures = renderable.renderData.textures;
        for (let textureName in textures) {
            webGPU.deleteTexture(textures[textureName]);
        }
        var buffers = renderable.renderData.buffers;
        for (let bufferName in buffers) {
            webGPU.deleteBuffer(buffers[bufferName]);
        }
    }

    this.createBoundingWireFrame = function(sceneObj) {
        // get the bounding points first
        var points = sceneObj.getBoundaryPoints();

        // check if points were generated properly
        if (!points || points.length != 8 * 3) return;

        var renderable = webGPU.meshRenderableFromArrays(
            points,
            new Float32Array(points.length * 3), 
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
        renderable.serialisedMaterials = webGPU.serialiseMaterials({}, {});
        
        return renderable;
    }

    this.createFloorWireFrame = function(sceneObj) {
        // get the bounding points first
        var points = sceneObj.getDatasetBoundaryPoints();

        // check if points were generated properly
        if (!points || points.length != 8 * 3) return;

        var renderable = webGPU.meshRenderableFromArrays(
            points,
            new Float32Array(points.length * 3), 
            new Uint32Array([
                0, 1,
                0, 4,
                1, 5,
                4, 5,
            ]), 
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderable.serialisedMaterials = webGPU.serialiseMaterials({}, {});
        
        return renderable;
    }

    // move mesh data to renderable
    this.setupMeshSceneObject = async function(mesh) {
        var renderable = webGPU.meshRenderableFromArrays(mesh.verts, mesh.norms, mesh.indices, mesh.renderMode);

        // set the materials
        renderable.serialisedMaterials = webGPU.serialiseMaterials(mesh.frontMaterial, mesh.backMaterial);

        mesh.renderables.push(renderable);
    }


    // perform the setup needed depending on the data render mode
    this.setupDataSceneObject = async function(data) {
        if (data.renderMode & SceneObjectRenderModes.DATA_POINTS) {
            // create data points mesh renderable
            try {
                this.setupDataPointsMeshObject(data);
            } catch (e) {
                console.error("Unable to setup data object for DATA_POINTS render mode");
                console.error(e);
            }
        }
        if (data.renderMode & SceneObjectRenderModes.DATA_WIREFRAME) {
            // create cells wireframe mesh object
            try {
                this.setupDataCellsWireframeMeshObject(data);
            } catch (e) {
                console.error("Unable to setup data object for MESH_WIREFRAME render mode");
                console.error(e);
            }
        }
        if (data.renderMode & SceneObjectRenderModes.DATA_MARCH_SURFACE ||
            data.renderMode & SceneObjectRenderModes.DATA_MARCH_POINTS
        ) {
            // interface with marching cubes engine to move data to GPU
            console.warn("sorry, Marching cubes data render modes are not supported yet");
        }
        if (data.renderMode & SceneObjectRenderModes.DATA_RAY_VOLUME) {
            // setup the dataset for ray marching
            try {
                await this.rayMarcher.setupRayMarch(data);
            } catch (e) {
                console.error("Unable to setup data object for DATA_RAY_VOLUME render mode:", e);
            }
        }
    }

    this.setupDataPointsMeshObject = function(data) {
        var renderable = webGPU.meshRenderableFromArrays(
            data.data.positions, 
            new Float32Array(data.data.positions.length), 
            new Uint32Array(64), 
            RenderableRenderModes.MESH_POINTS
        );
        renderable.serialisedMaterials = webGPU.serialiseMaterials(defaultMaterial, defaultMaterial);

        data.renderables.push(renderable);
    }

    this.setupDataCellsWireframeMeshObject = function(data) {
        var indices = [];
        // iterate through all cells in the dataset, adding the edge indices for each
        let cellType, cellOffset;
        for (let i = 0; i < data.data.cellTypes.length; i++) {
            cellType = data.data.cellTypes[i];
            if (cellType != 10) throw "Unsupported cell type '" + cellType.toString() + "'";
            cellOffset = data.data.cellOffsets[i];

            // add edges
            indices.push(data.data.cellConnectivity[cellOffset + 0]);
            indices.push(data.data.cellConnectivity[cellOffset + 1]);
            indices.push(data.data.cellConnectivity[cellOffset + 0]);
            indices.push(data.data.cellConnectivity[cellOffset + 2]);
            indices.push(data.data.cellConnectivity[cellOffset + 0]);
            indices.push(data.data.cellConnectivity[cellOffset + 3]);
            indices.push(data.data.cellConnectivity[cellOffset + 1]);
            indices.push(data.data.cellConnectivity[cellOffset + 2]);
            indices.push(data.data.cellConnectivity[cellOffset + 1]);
            indices.push(data.data.cellConnectivity[cellOffset + 3]);
            indices.push(data.data.cellConnectivity[cellOffset + 2]);
            indices.push(data.data.cellConnectivity[cellOffset + 3]);
        }

        var renderable = webGPU.meshRenderableFromArrays(
            data.data.positions, 
            new Float32Array(data.data.positions.length), 
            Uint32Array.from(indices), 
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderable.serialisedMaterials = webGPU.serialiseMaterials(defaultMaterial, defaultMaterial);

        data.renderables.push(renderable);
    }

    this.setupAxesSceneObject = async function(axes) {
        // make x axis
        var renderableX = webGPU.meshRenderableFromArrays(
            new Float32Array([
                0, 0, 0,
                axes.scale, 0, 0
            ]), 
            new Float32Array(2 * 3), 
            new Uint32Array([0, 1]), 
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderableX.serialisedMaterials = webGPU.serialiseMaterials({diffuseCol: [1, 0, 0]}, {diffuseCol: [1, 0, 0]});
        renderableX.highPriority = true;
        
        // make y axis
        var renderableY = webGPU.meshRenderableFromArrays(
            new Float32Array([
                0, 0, 0,
                0, axes.scale, 0
            ]), 
            new Float32Array(2 * 3), 
            new Uint32Array([0, 1]), 
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderableY.serialisedMaterials = webGPU.serialiseMaterials({diffuseCol: [0, 1, 0]}, {diffuseCol: [0, 1, 0]});
        renderableY.highPriority = true;

        // make z axis
        var renderableZ = webGPU.meshRenderableFromArrays(
            new Float32Array([
                0, 0, 0,
                0, 0, axes.scale
            ]), 
            new Float32Array(2 * 3), 
            new Uint32Array([0, 1]), 
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderableZ.serialisedMaterials = webGPU.serialiseMaterials({diffuseCol: [0, 0, 1]}, {diffuseCol: [0, 0, 1]});
        renderableZ.highPriority = true;

        axes.renderables.push(renderableX);
        axes.renderables.push(renderableY);
        axes.renderables.push(renderableZ);
    }

    this.setupVectorObject = function(vector) {
        var renderable = webGPU.meshRenderableFromArrays(
            new Float32Array([
                0, 0, 0,
                ...vector.endPoint
            ]), 
            new Float32Array([2]), 
            new Uint32Array([0, 1]), 
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderable.serialisedMaterials = webGPU.serialiseMaterials({diffuseCol: vector.color}, {diffuseCol: vector.color});

        vector.renderables.push(renderable);
    }

    // sorts a list of renderables, primarily by distance from camera
    // the sorted list will look like:
    // [high priority se (sorted), high priority sd (unsorted), sort enabled (sorted), sort disabled (unsorted)]
    this.sortRenderables = function(renderables, camera) {
        var camPos = camera.getEyePos();
        var renderablesSortFunc = (a, b) => {
            // first check if either is one is high and other normal priority
            if (a.highPriority && !b.highPriority) return -1;
            if (!a.highPriority && b.highPriority) return 1;
            // check if sorting is enabled
            if (a.depthSort && !b.depthSort) return -1;
            if (!a.depthSort && !b.depthSort) return 0;
            if (!a.depthSort && b.depthSort) return 1;
            
            // get worldspace a and b
            var aObj = vec4.fromValues(...a.objectSpaceMidPoint, 1);
            var aWorld = vec4.create();
            vec4.transformMat4(aWorld, aObj, a.transform);
            var aDist = vec3.distance([aWorld[0], aWorld[1], aWorld[2]],  camPos);

            var bObj = vec4.fromValues(...b.objectSpaceMidPoint, 1);
            var bWorld = vec4.create();
            vec4.transformMat4(bWorld, bObj, b.transform);
            var bDist = vec3.distance([bWorld[0], bWorld[1], bWorld[2]],  camPos);

            return aDist - bDist;
        };

        return renderables.sort(renderablesSortFunc);
    }
}

