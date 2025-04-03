import { RenderableRenderModes } from "../../renderEngine.js";

export class WebGPUMeshRenderer {
    #webGPU;

    #uniformBuffer;
    
    #surfaceRenderPassDescriptor;
    #pointsRenderPassDescriptor;
    #linesRenderPassDescriptor;

    constructor(webGPUBase) {
        this.#webGPU = webGPUBase;
    }
    async setup() {
        this.#uniformBuffer = this.#webGPU.makeBuffer(256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, "Render uniform buffer"); //"u cd cs"

        const shaderCode = await this.#webGPU.fetchShader("core/renderEngine/webGPU/meshRender/shaders/shader.wgsl");

        this.#surfaceRenderPassDescriptor = this.#webGPU.createPassDescriptor(
            this.#webGPU.PassTypes.RENDER,
            {
                vertexLayout: this.#webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "triangle-list",
                indexed: true
            },
            [this.#webGPU.bindGroupLayouts.render0],
            { str: shaderCode, formatObj: {} },
            "surface render pass"
        );
        this.#pointsRenderPassDescriptor = this.#webGPU.createPassDescriptor(
            this.#webGPU.PassTypes.RENDER,
            {
                vertexLayout: this.#webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "point-list",
                indexed: false
            },
            [this.#webGPU.bindGroupLayouts.render0],
            { str: shaderCode, formatObj: {} },
            "points render pass"
        );
        this.#linesRenderPassDescriptor = this.#webGPU.createPassDescriptor(
            this.#webGPU.PassTypes.RENDER,
            {
                vertexLayout: this.#webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "line-list",
                indexed: true
            },
            [this.#webGPU.bindGroupLayouts.render0],
            { str: shaderCode, formatObj: {} },
            "lines render pass"
        );
    }
    // used for rendering basic meshes with phong shading
    // supports point, line and mesh rendering
    async render(renderable, camera, outputColourAttachment, outputDepthAttachment, box, ctx) {
        if (renderable.indexCount == 0 && renderable.vertexCount == 0) {
            return;
        }

        var commandEncoder = await this.#webGPU.createCommandEncoder();

        if (renderable.renderMode == RenderableRenderModes.MESH_POINTS) {
            var thisPassDescriptor = this.#pointsRenderPassDescriptor;
        } else if (renderable.renderMode == RenderableRenderModes.MESH_WIREFRAME) {
            var thisPassDescriptor = this.#linesRenderPassDescriptor;
        } else if (renderable.renderMode == RenderableRenderModes.MESH_SURFACE) {
            var thisPassDescriptor = this.#surfaceRenderPassDescriptor;
        }
        var renderPass = {
            ...thisPassDescriptor,
            vertexCount: renderable.vertexCount,
            indicesCount: renderable.indexCount,
            vertexBuffers: [renderable.renderData.buffers.vertex],
            indexBuffer: renderable.renderData.buffers?.index,
            bindGroups: {
                0: this.#webGPU.generateBG(
                    thisPassDescriptor.bindGroupLayouts[0],
                    [this.#uniformBuffer, renderable.renderData.buffers.objectInfo]
                ),
            },
            passEncoderDescriptor: {
                colorAttachments: [outputColourAttachment],
                depthStencilAttachment: outputDepthAttachment
            },
            box: box,
            boundingBox: ctx.canvas.getBoundingClientRect(),
        };

        this.#webGPU.encodeGPUPass(commandEncoder, renderPass);

        // write buffers
        this.#webGPU.writeDataToBuffer(
            this.#uniformBuffer,
            [camera.serialise(), new Uint32Array([performance.now()])]
        );
        this.#webGPU.writeDataToBuffer(
            renderable.renderData.buffers.objectInfo,
            [new Float32Array(renderable.transform), renderable.serialisedMaterials]
        );
        this.#webGPU.submitCommandEncoder(commandEncoder);
    }
}