// webGPURender.js
// contains the main rendering object
// import { setupWebGPU, createFilledBuffer } from "./webGPUBase.js";
import { clampBox, stringifyMatrix} from "../../utils.js";
import { EmptyRenderEngine, Renderable, RenderableTypes, RenderableRenderModes} from "../renderEngine.js";
import {mat4, vec4, vec3} from 'https://cdn.skypack.dev/gl-matrix';
import { SceneObjectTypes, SceneObjectRenderModes } from "../sceneObjects.js";

// extension modules for more complex rendering operations
import { WebGPUMarchingCubesEngine } from "./marchingCubes/webGPUMarchingCubes.js";
import { WebGPURayMarchingEngine } from "./rayMarching/webGPURayMarching.js";

// the main rendering object that handles interacting with the GPU
// when drawing, takes a scene object (view) as input and draws it
// inhertis from the empty render engine base class
export function WebGPURenderEngine(webGPUBase, canvas) {
    EmptyRenderEngine.call(this);
    var webGPU = webGPUBase;

    this.marchingCubes = new WebGPUMarchingCubesEngine(webGPUBase);
    this.rayMarcher = new WebGPURayMarchingEngine(webGPUBase);
    // stores a reference to the canvas element
    this.canvas = canvas;
    this.ctx;

    this.clearColor = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };

    this.meshRenderPipeline;
    this.pointsRenderPipeline;
    this.linesRenderPipeline;

    this.uniformBuffer;

    var shaderCode = webGPU.fetchShader("core/renderEngine/webGPU/shaders/shader.wgsl");

    this.setup = async function() {        
        this.ctx = this.canvas.getContext("webgpu");

        // setup swapchain
        this.ctx.configure({
            device: webGPU.device,
            format: "bgra8unorm",
            alphaMode: "opaque"
        });

        this.uniformBuffer = webGPU.makeBuffer(256, "u cd cs");

        shaderCode = await shaderCode;

        this.surfaceRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {vertexLayout: webGPU.vertexLayouts.positionAndNormal, topology: "triangle-list", indexed: true},
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}}
        );
        this.pointsRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {vertexLayout: webGPU.vertexLayouts.positionAndNormal, topology: "point-list", indexed: false},
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}}
        );
        this.linesRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {vertexLayout: webGPU.vertexLayouts.positionAndNormal, topology: "line-list", indexed: true},
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}}
        );

        return this.ctx;
    }

    this.createBuffers = function() {
        const id = getNewBufferId()
        buffers[id] = {
            vertex: {
                buffer: null,
                byteLength: 0
            },
            normal: {
                buffer: null,
                byteLength: 0
            },
            index: {
                buffer: null,
                byteLength: 0
            }
        }
        return id;
    }

    this.updateBuffers = function(mesh) {
        webGPU.deleteBuffers(mesh);
        console.log("u")

        if (mesh.verts.length > 0) {
            mesh.buffers.vertex = createFilledBuffer("f32", mesh.verts, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
        }
        if (mesh.normals.length > 0) {
            mesh.buffers.normal = createFilledBuffer("f32", mesh.normals, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
        }
        if (mesh.indices.length > 0) {
            mesh.buffers.index = createFilledBuffer("u32", mesh.indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
        }
    }

    // clears the screen and creates the empty depth texture
    this.getClearedRenderAttachments = async function() {
        
        // provide details of load and store part of pass
        // here there is one color output that will be cleared on load

        var depthStencilTexture = webGPU.device.createTexture({
            label: "depth texture",
            size: {
            width: this.canvas.width,
            height: this.canvas.height,
            depthOrArrayLayers: 1
            },
            dimension: "2d",
            format: "depth32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        const renderPassDescriptor = {
            colorAttachments: [{
                clearValue: this.clearColor,
                loadOp: "clear",
                storeOp: "store",
                view: this.ctx.getCurrentTexture().createView()
            }],
            depthStencilAttachment: {
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                view: depthStencilTexture.createView()
            }
        };

        var commandEncoder = await webGPU.device.createCommandEncoder();

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        
        passEncoder.end();

        webGPU.device.queue.submit([commandEncoder.finish()]);

        return {
            color: this.ctx.getCurrentTexture(),
            depth: depthStencilTexture
        }
    };

    // setup scene object for rendering ===========================================================
    // create the needed renderables for a scene object to be displayed as desired
    
    // take a scene object as input and creates its needed renderables
    this.setupSceneObject = async function(sceneObj) {
        // get rid of any renderables already present
        for (let renderable of sceneObj.renderables) {
            this.destroyRenderable(renderable);
        }

        if (sceneObj.renderMode == SceneObjectRenderModes.NONE) return;

        if (sceneObj.renderMode & SceneObjectRenderModes.BOUNDING_WIREFRAME) {
            // create a bounding wireframe for the object
            this.addBoundingWireFrameToSceneObject(sceneObj);
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
                break;
        }
    }

    this.destroyRenderable = function(renderable) {
        // the important data is stored within renderData
        var textures = renderable.renderData.textures;
        for (let textureName in textures) {
            textures[textureName].destroy();
        }
        var buffers = renderable.renderData.buffers;
        for (let bufferName in buffers) {
            buffers[bufferName].destroy();
        }
    }

    this.addBoundingWireFrameToSceneObject = function(sceneObj) {
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

        sceneObj.renderables.push(renderable);
    }

    this.addFloorWireFrameToSceneObject = function(sceneObj) {
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

        sceneObj.renderables.push(renderable);
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
            // move data points to a new mesh renderable
            console.log("sorry, this data render mode is not supported yet");
        }
        if (data.renderMode & SceneObjectRenderModes.DATA_MARCH_SURFACE ||
            data.renderMode & SceneObjectRenderModes.DATA_MARCH_POINTS
        ) {
            // interface with marching cubes engine to move data to GPU
            console.log("sorry, this data render mode is not supported yet");
        }
        if (data.renderMode & SceneObjectRenderModes.DATA_RAY_VOLUME) {
            this.rayMarcher.setupRayMarch(data);
        }
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

    // ============================================================================================

    this.renderMesh = async function(renderable, camera, renderPassDescriptor, box) {        
        if (renderable.indexCount == 0 && renderable.vertexCount == 0) {
            return;
        }

        var commandEncoder = webGPU.device.createCommandEncoder();     

        await commandEncoder;

        if (renderable.renderMode == RenderableRenderModes.MESH_POINTS) {
            var thisPassDescriptor = this.pointsRenderPassDescriptor;
        } else if (renderable.renderMode == RenderableRenderModes.MESH_WIREFRAME) {
            var thisPassDescriptor = this.linesRenderPassDescriptor;
        } else if (renderable.renderMode == RenderableRenderModes.MESH_SURFACE){
            var thisPassDescriptor = this.surfaceRenderPassDescriptor;
        }
        var renderPass = {
            ...thisPassDescriptor,
            vertsNum: renderable.vertexCount,
            indicesCount: renderable.indexCount,
            vertexBuffers: [renderable.renderData.buffers.vertex, renderable.renderData.buffers.normal],
            indexBuffer: renderable.renderData.buffers.index,
            resources: [
                [this.uniformBuffer, renderable.renderData.buffers.objectInfo]
            ],
            renderDescriptor: renderPassDescriptor,
            box: box,
            boundingBox: this.ctx.canvas.getBoundingClientRect(),
        }

        webGPU.encodeGPUPass(commandEncoder, renderPass);

        // write buffers
        webGPU.writeDataToBuffer(
            this.uniformBuffer,
            [camera.serialise(), new Uint32Array([performance.now()])]
        );
        webGPU.writeDataToBuffer(
            renderable.renderData.buffers.objectInfo, 
            [new Float32Array(renderable.transform), renderable.serialisedMaterials]
        );
        webGPU.device.queue.submit([commandEncoder.finish()]);
    };

    this.renderData = async function(renderable, camera, renderPassDescriptor, box) {
        switch (renderable.renderMode) {
            case RenderableRenderModes.DATA_RAY_VOLUME:
                // do ray marching to extract surface
                this.rayMarcher.march(renderable, camera, renderPassDescriptor, box, this.canvas);
            default:
                // do nothing
                break;
        }
    }

    // renders a view object, datasets
    // for now, all share a canvas
    this.renderView = async function (view) {
        var renderAttachments = await this.getClearedRenderAttachments();
        
        var box = view.getBox();

        var scene = view.sceneGraph;

        // first check if there is a camera in the scene
        var camera = scene.activeCamera;
        if (!camera) {
            console.warn("no camera in scene");
            return;
        }

        // get the renderables from the scene
        var renderables = scene.getRenderables();
        this.sortRenderables(renderables, camera);

        for (let renderable of renderables) {
            var renderPassDescriptor = {
                colorAttachments: [{
                    clearValue: this.clearColor,
                    loadOp: "load",
                    storeOp: "store",
                    view: renderAttachments.color.createView()
                }],
                depthStencilAttachment: {
                    depthClearValue: 1.0,
                    depthLoadOp: "load",
                    depthStoreOp: "store",
                    view: renderAttachments.depth.createView()
                }
            };
            if (renderable.renderMode == RenderableRenderModes.NONE) continue;
            if (renderable.type == RenderableTypes.MESH) {
                // we got a mesh, render it
                this.renderMesh(renderable, camera, renderPassDescriptor, box);
            } else if (renderable.type == RenderableTypes.DATA) {
                // reached a data object, got to decide how to render it
                this.renderData(renderable, camera, renderPassDescriptor, box);
            }
        }
        await webGPU.waitForDone();
        renderAttachments.depth.destroy();     
    }

    this.resizeRenderingContext = function() {
        this.ctx.configure({
            device: webGPU.device,
            format: "bgra8unorm",
            alphaMode: "opaque"
        });
    }
}