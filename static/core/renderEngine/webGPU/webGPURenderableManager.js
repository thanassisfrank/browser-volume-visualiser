// webGPURenderableManager.js
// handles the creation of renderable objects for the various scene objects available

import { EmptyRenderEngine, Renderable, RenderableTypes, RenderableRenderModes} from "../renderEngine.js";
import {mat4, vec4, vec3} from '../../gl-matrix.js';
import { SceneObjectTypes, SceneObjectRenderModes, defaultMaterial} from "../sceneObjects.js";

export class WebGPURenderableManager {
    webGPU;
    rayMarcher;
    constructor(webGPUBase, rayMarcher) {
        this.webGPU = webGPUBase;
        this.rayMarcher = rayMarcher;
    }

    // setup scene object for rendering ===========================================================
    // create the needed renderables for a scene object to be displayed as desired
    // take a scene object as input and creates its needed renderables
    setupSceneObject(sceneObj, setupObj) {
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
                this.setupDataSceneObject(sceneObj, setupObj);
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

    updateSceneObject(dt, sceneObj, updateObj) {
        switch (sceneObj.objectType) {
            case SceneObjectTypes.DATA:
                // propogate the threshold to its renderables
                for (let renderable of sceneObj.renderables) {
                    renderable.passData.threshold = updateObj.threshold;
                    if (renderable.type != RenderableTypes.MESH) continue;
                    if (renderable.geometryName === undefined) continue;
                    const enabled = updateObj.enabledGeometry[renderable.geometryName];
                    if (enabled === undefined) continue;

                    // show/hide geometry
                    if (enabled) {
                        renderable.renderMode = RenderableRenderModes.MESH_SURFACE;
                    } else {
                        renderable.renderMode = RenderableRenderModes.NONE;
                    }
                }
                if (sceneObj.renderMode & SceneObjectRenderModes.DATA_RAY_VOLUME) {
                    this.rayMarcher.updateDataObj(sceneObj, updateObj);
                }
                break;
            default:
                break;
        }

    }

    clearRenderables(sceneObj) {
        for (let renderable of sceneObj.renderables) {
            this.destroyRenderable(renderable);
        }
    }

    destroyRenderable(renderable) {
        // the important data is stored within renderData
        var textures = renderable.renderData.textures;
        for (let textureName in textures) {
            this.webGPU.deleteTexture(textures[textureName]);
        }
        var buffers = renderable.renderData.buffers;
        for (let bufferName in buffers) {
            const entry = buffers[bufferName];
            if (Array.isArray(entry)) {
                for (let buff of entry) {
                    this.webGPU.deleteBuffer(buff);
                }
            } else {
                this.webGPU.deleteBuffer(entry);
            }
        }
    }

    createBoundingWireFrame(sceneObj) {
        // get the bounding points first
        var points = sceneObj.getBoundaryPoints();

        // check if points were generated properly
        if (!points || points.length != 8 * 3) return;

        var renderable = this.webGPU.meshRenderableFromArrays(
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
        renderable.serialisedMaterials = this.webGPU.serialiseMaterials({}, {});

        return renderable;
    }

    createFloorWireFrame(sceneObj) {
        // get the bounding points first
        var points = sceneObj.getDatasetBoundaryPoints();

        // check if points were generated properly
        if (!points || points.length != 8 * 3) return;

        var renderable = this.webGPU.meshRenderableFromArrays(
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
        renderable.serialisedMaterials = this.webGPU.serialiseMaterials({}, {});

        return renderable;
    }

    // move mesh data to renderable
    async setupMeshSceneObject(mesh) {
        var renderable = this.webGPU.meshRenderableFromArrays(mesh.verts, mesh.norms, mesh.indices, mesh.renderMode);

        // set the materials
        renderable.serialisedMaterials = this.webGPU.serialiseMaterials(mesh.frontMaterial, mesh.backMaterial);

        mesh.renderables.push(renderable);
    }

    // perform the setup needed depending on the data render mode
    async setupDataSceneObject(data, setupObj) {
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
            data.renderMode & SceneObjectRenderModes.DATA_MARCH_POINTS) {
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
        if (data.renderMode & SceneObjectRenderModes.DATA_MESH_GEOMETRY) {
            // setup the triangular geometry inside the dataset for rendering
            try {
                this.setupDatasetMeshGeometry(data, setupObj);
            } catch (e) {
                console.error("Unable to setup data object for DATA_MESH_GEOMETRY render mode:", e);
            }
        }
    }

    setupDatasetMeshGeometry(data, setupObj) {
        for (let meshName in data.geometry) {
            let renderMode = RenderableRenderModes.NONE;
            if (setupObj.enabledGeometry[meshName]) renderMode = RenderableRenderModes.MESH_SURFACE;
            var renderable = this.webGPU.meshRenderableFromArrays(
                data.geometry[meshName].positions,
                null,
                data.geometry[meshName].indices,
                renderMode
            );

            renderable.geometryName = meshName;

            var mag = 0.7;
            renderable.serialisedMaterials = this.webGPU.serialiseMaterials(
                {
                    diffuseCol: [mag, mag, mag],
                    specularCol: [mag, mag, mag],
                    shininess: 50
                },
                {
                    diffuseCol: [mag, mag, mag],
                    specularCol: [mag, mag, mag],
                    shininess: 50
                }
            );

            data.renderables.push(renderable);
        }
    }

    setupDataPointsMeshObject(data) {
        var renderable = this.webGPU.meshRenderableFromArrays(
            data.data.positions,
            new Float32Array(data.data.positions.length),
            new Uint32Array(64),
            RenderableRenderModes.MESH_POINTS
        );
        renderable.serialisedMaterials = this.webGPU.serialiseMaterials(defaultMaterial, defaultMaterial);

        data.renderables.push(renderable);
    }

    setupDataCellsWireframeMeshObject(data) {
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

        var renderable = this.webGPU.meshRenderableFromArrays(
            data.data.positions,
            new Float32Array(data.data.positions.length),
            Uint32Array.from(indices),
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderable.serialisedMaterials = this.webGPU.serialiseMaterials(defaultMaterial, defaultMaterial);

        data.renderables.push(renderable);
    }

    async setupAxesSceneObject(axes) {
        // make x axis
        var renderableX = this.webGPU.meshRenderableFromArrays(
            new Float32Array([
                0, 0, 0,
                axes.scale, 0, 0
            ]),
            new Float32Array(2 * 3),
            new Uint32Array([0, 1]),
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderableX.serialisedMaterials = this.webGPU.serialiseMaterials({ diffuseCol: [1, 0, 0] }, { diffuseCol: [1, 0, 0] });
        renderableX.highPriority = true;

        // make y axis
        var renderableY = this.webGPU.meshRenderableFromArrays(
            new Float32Array([
                0, 0, 0,
                0, axes.scale, 0
            ]),
            new Float32Array(2 * 3),
            new Uint32Array([0, 1]),
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderableY.serialisedMaterials = this.webGPU.serialiseMaterials({ diffuseCol: [0, 1, 0] }, { diffuseCol: [0, 1, 0] });
        renderableY.highPriority = true;

        // make z axis
        var renderableZ = this.webGPU.meshRenderableFromArrays(
            new Float32Array([
                0, 0, 0,
                0, 0, axes.scale
            ]),
            new Float32Array(2 * 3),
            new Uint32Array([0, 1]),
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderableZ.serialisedMaterials = this.webGPU.serialiseMaterials({ diffuseCol: [0, 0, 1] }, { diffuseCol: [0, 0, 1] });
        renderableZ.highPriority = true;

        axes.renderables.push(renderableX);
        axes.renderables.push(renderableY);
        axes.renderables.push(renderableZ);
    }

    setupVectorObject(vector) {
        var renderable = this.webGPU.meshRenderableFromArrays(
            new Float32Array([
                0, 0, 0,
                ...vector.endPoint
            ]),
            new Float32Array([2]),
            new Uint32Array([0, 1]),
            RenderableRenderModes.MESH_WIREFRAME
        );
        renderable.serialisedMaterials = this.webGPU.serialiseMaterials({ diffuseCol: vector.color }, { diffuseCol: vector.color });

        vector.renderables.push(renderable);
    }

    // sorts a list of renderables, primarily by distance from camera
    // -1 -> a before b, 0 -> either, 1 -> b before a
    // the sorted list will look like (in reverse):
    // [high priority se (sorted), high priority sd (unsorted), sort enabled (sorted), sort disabled (unsorted)]
    sortRenderables(renderables, camera) {
        var camPos = camera.getEyePos();
        var renderablesSortFunc = (a, b) => {
            // move ray march renderable last
            if (a.type == RenderableTypes.UNSTRUCTURED_DATA && b.type != RenderableTypes.UNSTRUCTURED_DATA) return 1;
            if (a.type != RenderableTypes.UNSTRUCTURED_DATA && b.type == RenderableTypes.UNSTRUCTURED_DATA) return -1;
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
            var aDist = vec3.distance([aWorld[0], aWorld[1], aWorld[2]], camPos);

            var bObj = vec4.fromValues(...b.objectSpaceMidPoint, 1);
            var bWorld = vec4.create();
            vec4.transformMat4(bWorld, bObj, b.transform);
            var bDist = vec3.distance([bWorld[0], bWorld[1], bWorld[2]], camPos);

            return aDist - bDist;
        };

        return renderables.sort(renderablesSortFunc);
    }
}

