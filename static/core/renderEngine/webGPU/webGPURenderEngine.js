// webGPURender.js
// contains the main rendering object
import { EmptyRenderEngine, Renderable, RenderableTypes, RenderableRenderModes} from "../renderEngine.js";

// renderable manager
import { WebGPURenderableManager } from "./webGPURenderableManager.js";

// extension modules for more complex rendering operations
import { WebGPURayMarchingEngine } from "./rayMarching/webGPURayMarching.js";

// the main rendering object that handles interacting with the GPU
// when drawing, takes a scene object (view) as input and draws it
// inhertis from the empty render engine base class
// the main rendering object that handles interacting with the GPU
// when drawing, takes a scene object (view) as input and draws it
// inhertis from the empty render engine base class
export class WebGPURenderEngine {
    webGPU;
    rayMarcher;
    renderableManager;

    // stores a reference to the canvas element
    canvas;
    ctx;
    canvasResized = true;

    // this.clearColor = { r: 0.1, g: 0.1, b: 0.1, a: 1.0 };
    clearColor = { r: 1, g: 1, b: 1, a: 1.0 };

    meshRenderPipeline;
    pointsRenderPipeline;
    linesRenderPipeline;

    uniformBuffer;

    renderDepthTexture = null;
    renderColorTexture = null;

    constructor(webGPUBase, canvas) {
        this.webGPU = webGPUBase;

        this.rayMarcher = new WebGPURayMarchingEngine(webGPUBase);
        this.renderableManager = new WebGPURenderableManager(webGPUBase, this.rayMarcher);
        // stores a reference to the canvas element
        this.canvas = canvas;
    }

    getWebGPU() {
        return this.webGPU;
    }

    async setup() {
        // begin setting up modules
        const rayMarcherSetupPromise = this.rayMarcher.setupEngine();
        // debugger;
        // setup the canvas for drawing to
        this.ctx = this.canvas.getContext("webgpu");
        this.ctx.configure({
            device: this.webGPU.getDevice(),
            format: "bgra8unorm",
            alphaMode: "opaque"
        });

        // create the textures used in the render pass; these will be copied to the canvas as the last step
        const renderTextures = this.createRenderTextures(this.canvas.wdith, this.canvas.height);
        this.renderDepthTexture = renderTextures.depth;
        this.renderColorTexture = renderTextures.color;

        this.uniformBuffer = this.webGPU.makeBuffer(256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, "Render uniform buffer"); //"u cd cs"

        const shaderCode = await this.webGPU.fetchShader("core/renderEngine/webGPU/shaders/shader.wgsl");

        const t0 = performance.now();

        this.surfaceRenderPassDescriptor = this.webGPU.createPassDescriptor(
            this.webGPU.PassTypes.RENDER,
            {
                vertexLayout: this.webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "triangle-list",
                indexed: true
            },
            [this.webGPU.bindGroupLayouts.render0],
            { str: shaderCode, formatObj: {} },
            "surface render pass"
        );
        this.pointsRenderPassDescriptor = this.webGPU.createPassDescriptor(
            this.webGPU.PassTypes.RENDER,
            {
                vertexLayout: this.webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "point-list",
                indexed: false
            },
            [this.webGPU.bindGroupLayouts.render0],
            { str: shaderCode, formatObj: {} },
            "points render pass"
        );
        this.linesRenderPassDescriptor = this.webGPU.createPassDescriptor(
            this.webGPU.PassTypes.RENDER,
            {
                vertexLayout: this.webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "line-list",
                indexed: true
            },
            [this.webGPU.bindGroupLayouts.render0],
            { str: shaderCode, formatObj: {} },
            "lines render pass"
        );

        await Promise.all([this.webGPU.waitForDone(), rayMarcherSetupPromise]);

        console.log(performance.now() - t0, "ms for pipeline creation");
    }

    createRenderTextures(width, height) {
        var depthTexture = this.webGPU.makeTexture({
            label: "render depth texture",
            size: {
                width: width,
                height: height,
                depthOrArrayLayers: 1
            },
            dimension: "2d",
            format: "depth32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });

        var colorTexture = this.webGPU.makeTexture({
            label: "render color texture",
            size: {
                width: width,
                height: height,
                depthOrArrayLayers: 1
            },
            dimension: "2d",
            format: "bgra8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.STORAGE_BINDING |
                GPUTextureUsage.COPY_SRC |
                GPUTextureUsage.COPY_DST
        });

        return { depth: depthTexture, color: colorTexture };
    }

    beginFrame(cameraMoved, thresholdChanged) {
        this.rayMarcher.beginFrame(this.ctx, this.canvasResized, cameraMoved, thresholdChanged);
    }

    endFrame() {
        this.rayMarcher.endFrame(this.ctx);
    }

    // clears the screen and creates the empty depth texture
    async getClearedRenderAttachments() {
        // provide details of load and store part of pass
        // here there is one color output that will be cleared on load

        const renderPassDescriptor = {
            colorAttachments: [{
                clearValue: this.clearColor,
                loadOp: "clear",
                storeOp: "store",
                view: this.renderColorTexture.createView()
            }],
            depthStencilAttachment: {
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                view: this.renderDepthTexture.createView()
            }
        };

        var commandEncoder = await this.webGPU.createCommandEncoder();

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        passEncoder.end();

        this.webGPU.submitCommandEncoder(commandEncoder);

        return {
            color: this.renderColorTexture,
            depth: this.renderDepthTexture
        };
    }

    // calls the same function from the renderable manager to create the renderables needed
    setupSceneObject(...args) {
        this.renderableManager.setupSceneObject(...args);
    }

    updateSceneObject(...args) {
        this.renderableManager.updateSceneObject(...args);
    }

    cleanupSceneObj(sceneObj) {
        this.renderableManager.clearRenderables(sceneObj);
    }

    // used for rendering basic meshes with phong shading
    // supports point, line and mesh rendering
    async renderMesh(renderable, camera, outputColourAttachment, outputDepthAttachment, box) {
        if (renderable.indexCount == 0 && renderable.vertexCount == 0) {
            return;
        }

        var commandEncoder = await this.webGPU.createCommandEncoder();

        if (renderable.renderMode == RenderableRenderModes.MESH_POINTS) {
            var thisPassDescriptor = this.pointsRenderPassDescriptor;
        } else if (renderable.renderMode == RenderableRenderModes.MESH_WIREFRAME) {
            var thisPassDescriptor = this.linesRenderPassDescriptor;
        } else if (renderable.renderMode == RenderableRenderModes.MESH_SURFACE) {
            var thisPassDescriptor = this.surfaceRenderPassDescriptor;
        }
        var renderPass = {
            ...thisPassDescriptor,
            vertexCount: renderable.vertexCount,
            indicesCount: renderable.indexCount,
            vertexBuffers: [renderable.renderData.buffers.vertex],
            indexBuffer: renderable.renderData.buffers?.index,
            bindGroups: {
                0: this.webGPU.generateBG(
                    thisPassDescriptor.bindGroupLayouts[0],
                    [this.uniformBuffer, renderable.renderData.buffers.objectInfo]
                ),
            },
            passEncoderDescriptor: {
                colorAttachments: [outputColourAttachment],
                depthStencilAttachment: outputDepthAttachment
            },
            box: box,
            boundingBox: this.ctx.canvas.getBoundingClientRect(),
        };

        this.webGPU.encodeGPUPass(commandEncoder, renderPass);

        // write buffers
        this.webGPU.writeDataToBuffer(
            this.uniformBuffer,
            [camera.serialise(), new Uint32Array([performance.now()])]
        );
        this.webGPU.writeDataToBuffer(
            renderable.renderData.buffers.objectInfo,
            [new Float32Array(renderable.transform), renderable.serialisedMaterials]
        );
        this.webGPU.submitCommandEncoder(commandEncoder);
    }

    async clearScreen() {
        var clearedAttachments = await this.getClearedRenderAttachments();

        this.webGPU.copyTextureToTexture(clearedAttachments.color, this.ctx.getCurrentTexture());
    }
    // renders a view object, datasets
    // for now, all share a canvas
    async renderView(view) {

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


        for (let renderable of renderables) {
            var outputColourAttachment = {
                clearValue: this.clearColor,
                loadOp: "load",
                storeOp: "store",
                texture: outputRenderAttachments.color,
                view: outputRenderAttachments.color.createView()
            };
            var outputDepthAttachment = {
                depthClearValue: 1.0,
                depthLoadOp: "load",
                depthStoreOp: "store",
                texture: outputRenderAttachments.depth,
                view: outputRenderAttachments.depth.createView()
            };
            if (renderable.renderMode == RenderableRenderModes.NONE) continue;

            if (renderable.type == RenderableTypes.MESH) {
                // we got a mesh, render it
                if (renderable.renderMode & RenderableRenderModes.DATA_RAY_VOLUME) {
                    this.rayMarcher.march(renderable, camera, outputColourAttachment, outputDepthAttachment, box, this.canvas);
                } else if (renderable.renderMode & RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME) {
                    // nothing here
                } else {
                    this.renderMesh(renderable, camera, outputColourAttachment, outputDepthAttachment, box);
                }
            } else if (renderable.type == RenderableTypes.UNSTRUCTURED_DATA) {
                if (renderable.renderMode & RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME) {
                    this.rayMarcher.marchUnstructured(renderable, camera, outputColourAttachment, outputDepthAttachment, box, this.ctx);
                }
            }
        }

        // copy the working colour texture to the canvas
        await this.webGPU.waitForDone();
        this.webGPU.copyTextureToTexture(outputRenderAttachments.color, this.ctx.getCurrentTexture());

        // await this.webGPU.waitForDone();
        // end the frame
        this.endFrame();
    }

    resizeRenderingContext() {
        this.ctx.configure({
            device: this.webGPU.getDevice(),
            format: "bgra8unorm",
            alphaMode: "opaque",
            usage: GPUTextureUsage.COPY_DST
        });

        this.webGPU.deleteTexture(this.renderDepthTexture);
        this.webGPU.deleteTexture(this.renderColorTexture);

        const renderTextures = this.createRenderTextures(this.canvas.width, this.canvas.height);
        this.renderDepthTexture = renderTextures.depth;
        this.renderColorTexture = renderTextures.color;

        this.canvasResized = true;
    }
}