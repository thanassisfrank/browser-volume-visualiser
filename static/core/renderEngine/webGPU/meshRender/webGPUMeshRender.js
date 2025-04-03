import { Renderable, RenderableRenderModes, RenderableTypes } from "../../renderEngine.js";
import { WebGPUBase } from "../webGPUBase.js";

export class WebGPUMeshRenderer {
    /** @type {WebGPUBase} */
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
        const shader = this.#webGPU.createShader(shaderCode);
        const bindGroupLayouts =  [this.#webGPU.createBindGroupLayout([
            {
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: "uniform" }
            },
            {
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: "uniform" }
            }
        ], "render0")];

        
        this.#surfaceRenderPassDescriptor = this.#webGPU.createRenderPass(
            bindGroupLayouts,
            shader,
            {
                vertexLayout: this.#webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "triangle-list",
                indexed: true
            },
            "surface render pass"
        );
        this.#pointsRenderPassDescriptor = this.#webGPU.createRenderPass(
            bindGroupLayouts,
            shader,
            {
                vertexLayout: this.#webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "point-list",
                indexed: false
            },
            "points render pass"
        );
        this.#linesRenderPassDescriptor = this.#webGPU.createRenderPass(
            bindGroupLayouts,
            shader,
            {
                vertexLayout: this.#webGPU.vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "line-list",
                indexed: true
            },
            "lines render pass"
        );
    }
    
    createMeshRenderable = function(points, indices, renderMode, material) {
        const renderable = new Renderable(RenderableTypes.MESH, renderMode);
        // move vertex data to the gpu
        renderable.renderData.buffers.vertex = this.#webGPU.createFilledBuffer("f32", points, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC, "mesh vert");
        renderable.renderData.buffers.index = this.#webGPU.createFilledBuffer("u32", indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC, "mesh index");
        // make the uniform to store the constant data
        renderable.renderData.buffers.objectInfo = this.#webGPU.makeBuffer(
            256, 
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, 
            "mesh info uniform"
        );
        renderable.serialisedMaterials = this.#webGPU.serialiseMaterial(material);
        
        // set the number of verts
        renderable.vertexCount = points.length/3;
        renderable.indexCount = indices.length;

        return renderable;
    };

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