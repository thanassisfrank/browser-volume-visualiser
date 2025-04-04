import { Renderable, RenderableRenderModes, RenderableTypes } from "../../renderEngine.js";
import { WebGPUBase } from "../webGPUBase.js";

export class WebGPUMeshRenderer {
    /** @type {WebGPUBase} */
    #webGPU;

    #vertexLayouts = {
        // the layout for only a position buffer, f32
        position: [
            {
                // x y z location, 4 bytes each
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x3'
                }],
                arrayStride: 12,
                stepMode: 'vertex'
            }
        ],
        positionAndNormal: [
            {
                // x y z location, 4 bytes each
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x3'
                }],
                arrayStride: 12,
                stepMode: 'vertex'
            },
            {
                // x y z normal, 4 bytes each
                attributes: [{
                    shaderLocation: 1,
                    offset: 0,
                    format: 'float32x3'
                }],
                arrayStride: 12,
                stepMode: 'vertex'
            }
        ]
    };

    #uniformBuffer;

    #passes = {};

    constructor(webGPUBase) {
        this.#webGPU = webGPUBase;
    }

    async setup() {
        this.#uniformBuffer = this.#webGPU.makeBuffer(256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, "Render uniform buffer"); //"u cd cs"

        const shaderCode = await this.#webGPU.fetchShaderText("core/renderEngine/webGPU/meshRender/shaders/shader.wgsl");
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

        
        this.#passes.surface = this.#webGPU.createRenderPass(
            bindGroupLayouts,
            shader,
            {
                vertexLayout: this.#vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "triangle-list",
                indexed: true
            },
            "surface render pass"
        );
        this.#passes.points = this.#webGPU.createRenderPass(
            bindGroupLayouts,
            shader,
            {
                vertexLayout: this.#vertexLayouts.position,
                colorAttachmentFormats: ["bgra8unorm"],
                topology: "point-list",
                indexed: false
            },
            "points render pass"
        );
        this.#passes.lines = this.#webGPU.createRenderPass(
            bindGroupLayouts,
            shader,
            {
                vertexLayout: this.#vertexLayouts.position,
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
        renderable.renderData.buffers.vertex = this.#webGPU.createFilledBuffer(points, this.#webGPU.bufferUsage.V_CS, "mesh vert");
        renderable.renderData.buffers.index = this.#webGPU.createFilledBuffer(indices, this.#webGPU.bufferUsage.I_CS, "mesh index");
        // make the uniform to store the constant data
        renderable.renderData.buffers.objectInfo = this.#webGPU.makeBuffer(
            256, 
            this.#webGPU.bufferUsage.U_CD_CS, 
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
        if (renderable.indexCount == 0 && renderable.vertexCount == 0) return;

        const commandEncoder = await this.#webGPU.createCommandEncoder();
        const { renderData } = renderable;

        let pass;
        if (renderable.renderMode == RenderableRenderModes.MESH_POINTS) {
            pass = this.#passes.points;
        } else if (renderable.renderMode == RenderableRenderModes.MESH_WIREFRAME) {
            pass = this.#passes.lines;
        } else if (renderable.renderMode == RenderableRenderModes.MESH_SURFACE) {
            pass = this.#passes.surface;
        }

        const passOptions = {
            vertexCount: renderable.vertexCount,
            indicesCount: renderable.indexCount,
            vertexBuffers: [renderData.buffers.vertex],
            indexBuffer: renderData.buffers?.index,
            bindGroups: {
                0: this.#webGPU.generateBG(
                    pass.bindGroupLayouts[0],
                    [this.#uniformBuffer, renderData.buffers.objectInfo]
                ),
            },
            colorAttachments: [outputColourAttachment],
            depthStencilAttachment: outputDepthAttachment,
            box: box,
            boundingBox: ctx.canvas.getBoundingClientRect(),
        };

        this.#webGPU.encodeGPUPass(commandEncoder, pass, passOptions);

        // write buffers
        this.#webGPU.writeDataToBuffer(
            this.#uniformBuffer,
            [camera.serialise(), new Uint32Array([performance.now()])]
        );
        this.#webGPU.writeDataToBuffer(
            renderData.buffers.objectInfo,
            [new Float32Array(renderable.transform), renderable.serialisedMaterials]
        );
        this.#webGPU.submitCommandEncoder(commandEncoder);
    }
}