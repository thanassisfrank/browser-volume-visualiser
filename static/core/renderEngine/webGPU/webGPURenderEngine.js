// webGPURender.js
// contains the main rendering object
import { Renderable, RenderableTypes, RenderableRenderModes} from "../renderEngine.js";

// renderable manager
import { WebGPUScene } from "./webGPUScene.js";

// extension modules for more complex rendering operations
import { WebGPURayMarchingEngine } from "./rayMarching/webGPURayMarching.js";
import { WebGPUMeshRenderer } from "./meshRender/webGPUMeshRender.js";
import { WebGPUBase } from "./webGPUBase.js";

// the main rendering object that handles interacting with the GPU
// when drawing, takes a scene object (view) as input and draws it
// inhertis from the empty render engine base class
// the main rendering object that handles interacting with the GPU
// when drawing, takes a scene object (view) as input and draws it
// inhertis from the empty render engine base class
export class WebGPURenderEngine {
    /** @type {WebGPUBase} */
    webGPU;
    rayMarcher;
    meshRenderer;

    // stores a reference to the canvas element
    canvas;
    ctx;
    canvasResized = true;

    // this.clearColor = { r: 0.1, g: 0.1, b: 0.1, a: 1.0 };
    #clearColor = { r: 1, g: 1, b: 1, a: 1.0 };

    #renderDepthTexture = null;
    #renderColorTexture = null;

    constructor(webGPUBase, canvas) {
        this.webGPU = webGPUBase;

        this.rayMarcher = new WebGPURayMarchingEngine(webGPUBase);
        this.meshRenderer = new WebGPUMeshRenderer(webGPUBase);
        // stores a reference to the canvas element
        this.canvas = canvas;
    }

    getWebGPU() {
        return this.webGPU;
    }

    async setup() {
        // begin setting up modules
        const rayMarcherSetup = this.rayMarcher.setupEngine();
        const meshRenderSetup = this.meshRenderer.setup();
        // setup the canvas for drawing to
        this.ctx = this.canvas.getContext("webgpu");

        this.resizeRenderingContext();

        await Promise.all([
            this.webGPU.waitForDone(), 
            rayMarcherSetup,
            meshRenderSetup
        ]);
    }

    // returns a new scene object 
    createScene() {
        return new WebGPUScene(this.webGPU, this.rayMarcher, this.meshRenderer);
    }

    #createRenderTextures(width, height) {
        const depthTexture = this.webGPU.makeTexture({
            label: "render depth texture",
            size: {
                width: width,
                height: height,
                depthOrArrayLayers: 1
            },
            dimension: "2d",
            format: "depth32float",
            usage: this.webGPU.textureUsage.RA_TB
        });

        const colorTexture = this.webGPU.makeTexture({
            label: "render color texture",
            size: {
                width: width,
                height: height,
                depthOrArrayLayers: 1
            },
            dimension: "2d",
            format: "bgra8unorm",
            usage: this.webGPU.textureUsage.RA_TB_SB_CD_CS
        });

        return { depth: depthTexture, color: colorTexture };
    }

    #beginFrame(cameraMoved, thresholdChanged) {
        this.rayMarcher.beginFrame(this.ctx, this.canvasResized, cameraMoved, thresholdChanged);
    }

    #endFrame() {
        this.rayMarcher.endFrame(this.ctx);
    }

    // clears the screen and creates the empty depth texture
    async #getClearedRenderAttachments() {
        // provide details of load and store part of pass
        // here there is one color output that will be cleared on load

        const renderPassDescriptor = {
            colorAttachments: [{
                clearValue: this.#clearColor,
                loadOp: "clear",
                storeOp: "store",
                view: this.#renderColorTexture.createView()
            }],
            depthStencilAttachment: {
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                view: this.#renderDepthTexture.createView()
            }
        };

        var commandEncoder = await this.webGPU.createCommandEncoder();

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        passEncoder.end();

        this.webGPU.submitCommandEncoder(commandEncoder);

        return {
            color: this.#renderColorTexture,
            depth: this.#renderDepthTexture
        };
    }

    async clearScreen() {
        var clearedAttachments = await this.#getClearedRenderAttachments();

        this.webGPU.copyTextureToTexture(clearedAttachments.color, this.ctx.getCurrentTexture());
    }
    // renders a view object, datasets
    // for now, all share a canvas
    async renderView(view) {

        // create the render attachments (color and depth textures) that will be used to create the final view
        // these are initialised to a cleared state
        // the colour attachment is from the output canvas
        var outputRenderAttachments = await this.#getClearedRenderAttachments();

        var box = view.getBox();

        var scene = view.scene;

        // first check if there is a camera in the scene
        var camera = view.camera;
        if (!camera) {
            console.warn("no camera in scene");
            return;
        }
        this.#beginFrame(camera.didThisMove(), view.didThresholdChange());
        this.canvasResized = false;

        // get the renderables from the scene
        var renderables = scene.getRenderables();
        // this.#renderableManager.sortRenderables(renderables, camera);


        for (let renderable of renderables) {
            var outputColourAttachment = {
                clearValue: this.#clearColor,
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
                this.meshRenderer.render(renderable, camera, outputColourAttachment, outputDepthAttachment, box, this.ctx);
            } else if (renderable.type == RenderableTypes.UNSTRUCTURED_DATA) {
                if (renderable.renderMode & RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME) {
                    this.rayMarcher.marchUnstructured(renderable, camera, outputColourAttachment, outputDepthAttachment, box, this.ctx);
                }
            } else if (renderable.type == RenderableTypes.DATA) {
                this.rayMarcher.marchStructured(renderable, camera, outputColourAttachment, outputDepthAttachment, box, this.ctx);
            }
        }

        // copy the working colour texture to the canvas
        await this.webGPU.waitForDone();
        this.webGPU.copyTextureToTexture(outputRenderAttachments.color, this.ctx.getCurrentTexture());

        // await this.webGPU.waitForDone();
        // end the frame
        this.#endFrame();
    }

    resizeRenderingContext() {
        this.ctx.configure({
            device: this.webGPU.getDevice(),
            format: "bgra8unorm",
            alphaMode: "opaque",
            usage: this.webGPU.textureUsage.CD
        });

        this.webGPU.deleteTexture(this.#renderDepthTexture);
        this.webGPU.deleteTexture(this.#renderColorTexture);

        const renderTextures = this.#createRenderTextures(this.canvas.width, this.canvas.height);
        this.#renderDepthTexture = renderTextures.depth;
        this.#renderColorTexture = renderTextures.color;

        this.canvasResized = true;
    }
}