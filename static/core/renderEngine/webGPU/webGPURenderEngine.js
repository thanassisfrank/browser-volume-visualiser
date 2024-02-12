// webGPURender.js
// contains the main rendering object
// import { setupWebGPU, createFilledBuffer } from "./webGPUBase.js";
import { clampBox, stringifyMatrix} from "../../utils.js";
import { EmptyRenderEngine, Renderable, RenderableTypes, RenderableRenderModes} from "../renderEngine.js";
import {mat4, vec4, vec3} from 'https://cdn.skypack.dev/gl-matrix';

// renderable manager
import { WebGPURenderableManager } from "./webGPURenderableManager.js";

// extension modules for more complex rendering operations
import { WebGPUMarchingCubesEngine } from "./marchingCubes/webGPUMarchingCubes.js";
import { WebGPURayMarchingEngine } from "./rayMarching/webGPURayMarching.js";

// the main rendering object that handles interacting with the GPU
// when drawing, takes a scene object (view) as input and draws it
// inhertis from the empty render engine base class
export function WebGPURenderEngine(webGPUBase, canvas) {
    EmptyRenderEngine.call(this);
    var webGPU = webGPUBase;

    // this.marchingCubes = new WebGPUMarchingCubesEngine(webGPUBase);
    this.rayMarcher = new WebGPURayMarchingEngine(webGPUBase);
    this.renderableManager = new WebGPURenderableManager(webGPUBase, this.rayMarcher);
    // stores a reference to the canvas element
    this.canvas = canvas;
    this.ctx;
    this.canvasResized = true;

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
            {
                vertexLayout: webGPU.vertexLayouts.positionAndNormal,
                colorAttachmentFormats: ["bgra8unorm"], 
                topology: "triangle-list", 
                indexed: true
            },
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}},
            "surface render pass"
        );
        this.pointsRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {
                vertexLayout: webGPU.vertexLayouts.positionAndNormal, 
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "point-list", 
                indexed: false
            },
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}},
            "points render pass"
        );
        this.linesRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {
                vertexLayout: webGPU.vertexLayouts.positionAndNormal, 
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "line-list", 
                indexed: true
            },
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}},
            "lines render pass"
        );

        return this.ctx;
    }

    this.beginFrame = function(cameraMoved, thresholdChanged) {
        this.rayMarcher.beginFrame(this.ctx, this.canvasResized, cameraMoved, thresholdChanged);
    }

    this.endFrame = function() {
        this.rayMarcher.endFrame(this.ctx);
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

    // calls the same function from the renderable manager to create the renderables needed
    this.setupSceneObject = function(sceneObj) {
        this.renderableManager.setupSceneObject(sceneObj);
    };
    
    this.cleanupSceneObj = function(sceneObj) {
        this.renderableManager.clearRenderables(sceneObj);
    }

    // used for rendering basic meshes with phong shading
    // supports point, line and mesh rendering
    this.renderMesh = async function(renderable, camera, outputColourAttachment, outputDepthAttachment, box) {        
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
            bindGroups: {
                0: webGPU.generateBG(
                    thisPassDescriptor.bindGroupLayouts[0],
                    [this.uniformBuffer, renderable.renderData.buffers.objectInfo]
                ),
            },
            renderDescriptor: {
                colorAttachments: [outputColourAttachment],
                depthStencilAttachment: outputDepthAttachment
            },
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

    this.clearScreen = async function () {
        await this.getClearedRenderAttachments();
    }
    // renders a view object, datasets
    // for now, all share a canvas
    this.renderView = async function (view) {

        // create the render attachments (color and depth textures) that will be used to create the final view
        // these are initialised to a cleared state
        // the colour attachment is from the output canvas
        var outputRenderAttachments = await this.getClearedRenderAttachments();

        var box = view.getBox();

        var scene = view.sceneGraph;

        // first check if there is a camera in the scene
        var camera = scene.activeCamera;
        if (!camera) {
            console.warn("no camera in scene");
            return;
        }
        this.beginFrame(camera.didThisMove(), view.didThresholdChange());
        this.canvasResized = false;

        // get the renderables from the scene
        var renderables = scene.getRenderables();
        this.renderableManager.sortRenderables(renderables, camera);

        // console.log(renderables);

        for (let renderable of renderables) {
            var outputColourAttachment = {
                clearValue: this.clearColor,
                loadOp: "load",
                storeOp: "store",
                view: outputRenderAttachments.color.createView()
            }
            var outputDepthAttachment = {
                depthClearValue: 1.0,
                depthLoadOp: "load",
                depthStoreOp: "store",
                view: outputRenderAttachments.depth.createView()
            }
            if (renderable.renderMode == RenderableRenderModes.NONE) continue;

            if (renderable.type == RenderableTypes.MESH) {
                // we got a mesh, render it
                if (renderable.renderMode & RenderableRenderModes.DATA_RAY_VOLUME) {
                    this.rayMarcher.march(renderable, camera, outputColourAttachment, outputDepthAttachment, box, this.canvas);
                } else if (renderable.renderMode & RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME) {
                    this.rayMarcher.marchUnstructured(renderable, camera, outputColourAttachment, outputDepthAttachment, box, this.ctx);
                } else {
                    this.renderMesh(renderable, camera, outputColourAttachment, outputDepthAttachment, box);
                }
            }
        }
        await webGPU.waitForDone();
        this.endFrame();
        outputRenderAttachments.depth.destroy(); 
    }

    this.resizeRenderingContext = function() {
        this.ctx.configure({
            device: webGPU.device,
            format: "bgra8unorm",
            alphaMode: "opaque",
            usage: 
                GPUTextureUsage.RENDER_ATTACHMENT | 
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.STORAGE_BINDING
        });
        this.canvasResized = true;
    }
}