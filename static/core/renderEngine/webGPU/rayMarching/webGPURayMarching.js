// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import {mat4} from "https://cdn.skypack.dev/gl-matrix";
import { DataFormats } from "../../../data/data.js";
import { clampBox } from "../../../utils.js";
import { Renderable, RenderableRenderModes, RenderableTypes } from "../../renderEngine.js";

export function WebGPURayMarchingEngine(webGPUBase) {
    var webGPU = webGPUBase;
    var device = webGPU.device;

    var constsBuffer;

    this.rayMarchPassDescriptor;

    this.materials = {
        frontMaterial: {
            diffuseCol: [0.7, 0.2, 0.2],
            specularCol: [0.9, 0.4, 0.4],
            shininess: 1000
        },
        backMaterial: {
            diffuseCol: [0.2, 0.2, 0.7],
            specularCol: [0.4, 0.4, 0.9],
            shininess: 1000
        }
    }

    this.passFlags = {
        phong: true,
        backStep: true,
        showNormals: false,
        showVolume: true,
        fixedCamera: false,
        randStart: true,
        showSurface: true,
    }

    this.getPassFlagsUint = function() {
        var flags = 0;
        flags |= this.passFlags.phong            & 0b0000001;
        flags |= this.passFlags.backStep    << 1 & 0b0000010;
        flags |= this.passFlags.showNormals << 2 & 0b0000100;
        flags |= this.passFlags.showVolume  << 3 & 0b0001000;
        flags |= this.passFlags.fixedCamera << 4 & 0b0010000;
        flags |= this.passFlags.randStart   << 5 & 0b0100000;
        flags |= this.passFlags.showSurface   << 6 & 0b1000000;
        return flags;
    }

    this.setupEngine = async function() {
        // make bind group layouts
        var rayMarchBindGroupLayouts = [
            webGPU.bindGroupLayouts.render0,
            webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {type: "uniform"}
                },
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: "unfilterable-float",
                        viewDimension: "3d",
                        multiSampled: "false"
                    }
                }
            ], "ray1")
        ];
        console.log(rayMarchBindGroupLayouts);

        // create all the global buffers and bind groups common to all
        constsBuffer = webGPU.makeBuffer(256, "u cs cd", "ray consts", true);
        new Float32Array(constsBuffer.getMappedRange()).set([5]);
        constsBuffer.unmap();

        // create code
        var rayMarchCode = await webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/rayMarch.wgsl");

        this.rayMarchPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {vertexLayout: webGPU.vertexLayouts.justPosition, topology: "triangle-list", indexed: true},
            rayMarchBindGroupLayouts,
            {str: rayMarchCode, formatObj: {}}
        );
        
        // var depthPassCode = await webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/rayMarch.wgsl");
        // this.depthRenderPass = webGPU.createPassDescriptor(
        //     webGPU.PassTypes.RENDER,
        //     {vertexLayout: webGPU.vertexLayouts.justPosition, topology: "triangle-list", indexed: true},
        //     [webGPU.bindGroupLayouts.render0],
        //     {str: rayMarchCode, formatObj: {}}
        // );

    };

    // OLD
    /*
    this.setupRayMarch = async function(renderableDataObj) {
        var renderData = renderableDataObj.renderData;
        var dataObj = renderableDataObj.object;
        if(!renderData.textures) renderData.textures = {};
        if(!renderData.buffers) renderData.buffers = {};
        if(!renderData.samplers) renderData.samplers = {};

        if (dataObj.dataFormat == DataFormats.STRUCTURED) {
            var datasetSize = dataObj.getDataSize();
            // copy the data to a texture
            const textureSize = {
                width: datasetSize[0],
                height: datasetSize[1],
                depthOrArrayLayers: datasetSize[2]
            }

            renderData.textures.data = device.createTexture({
                label: "whole data texture",
                size: textureSize,
                dimension: "3d",
                format: "r32float",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });

            await webGPU.fillTexture(renderData.textures.data, textureSize, 4, Float32Array.from(dataObj.getValues()).buffer);

            // create sampler for data texture
            // doesn't work for float32 data
            renderData.samplers.data = device.createSampler({
                label: "ray data sampler",
                magFilter: "linear",
                minFilter: "linear"
            });

            renderData.buffers.passInfo = webGPU.makeBuffer(256, "u cs cd", "ray pass info");
            renderData.buffers.objectInfo = webGPU.makeBuffer(256, "u cs cd", "object info");

            renderableDataObj.renderData.rayMarchingReady = true;

        } else if (dataObj.dataFormat == DataFormats.UNSTRUCTURED) {
            renderableDataObj.renderData.setupFailed = true;
            var usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
            console.log(dataObj.data.values.byteLength, dataObj.data.values);
            renderData.buffers.values = webGPU.createFilledBuffer("f32", dataObj.data.values, usage);
            renderData.buffers.positions = webGPU.createFilledBuffer("f32", dataObj.data.positions, usage);
            renderData.buffers.cellConnectivity = webGPU.createFilledBuffer("u32", dataObj.data.cellConnectivity, usage);
            renderData.buffers.cellOffsets = webGPU.createFilledBuffer("u32", dataObj.data.cellOffsets, usage);
            // only handle tetrahedra for now
            // renderData.buffers.cellTypes = webGPU.createFilledBuffer("u32", dataObj.data.cellTypes, usage);
            
            // generate the tree
            var cellTreeBuffer = dataObj.getCellTreeBuffer();

            console.log(new Float32Array(cellTreeBuffer));

            renderableDataObj.renderData.setupFailed = true;
        }
    }
    */

    // setup the data sceneObj with the renderable for its bounding volume
    // this will be drawn using ray marching
    this.setupRayMarch = async function(dataObj) {
        // add the mesh information to the renderable
        // get the bounding points first
        var points = dataObj.getBoundaryPoints();

        // check if points were generated properly
        if (!points || points.length != 8 * 3) return;

        var renderable = webGPU.meshRenderableFromArrays(
            points,
            new Float32Array(points.length * 3), 
            new Uint32Array([
                // bottom face
                2, 1, 0,
                1, 2, 3,
                // top face
                4, 5, 6,
                7, 6, 5,
                // side 1
                1, 3, 5,
                7, 5, 3,
                // side 2
                4, 2, 0,
                2, 4, 6,
                // side 3
                0, 1, 4,
                5, 4, 1,
                // side 4
                6, 3, 2,
                3, 6, 7
            ]),
            RenderableRenderModes.DATA_RAY_VOLUME
        );
        renderable.type = RenderableTypes.DATA;
        renderable.serialisedMaterials = webGPU.serialiseMaterials(this.materials.frontMaterial, this.materials.backMaterial);

        var renderData = renderable.renderData;

        // add the data information to the renderable
        if (dataObj.dataFormat == DataFormats.STRUCTURED) {
            var datasetSize = dataObj.getDataSize();
            // copy the data to a texture
            const textureSize = {
                width: datasetSize[0],
                height: datasetSize[1],
                depthOrArrayLayers: datasetSize[2]
            }

            renderData.textures.data = device.createTexture({
                label: "whole data texture",
                size: textureSize,
                dimension: "3d",
                format: "r32float",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });

            await webGPU.fillTexture(renderData.textures.data, textureSize, 4, Float32Array.from(dataObj.getValues()).buffer);

            // create sampler for data texture
            // doesn't work for float32 data
            renderData.samplers.data = device.createSampler({
                label: "ray data sampler",
                magFilter: "linear",
                minFilter: "linear"
            });

            renderData.buffers.passInfo = webGPU.makeBuffer(256, "u cs cd", "ray pass info");
            renderData.buffers.objectInfo = webGPU.makeBuffer(256, "u cs cd", "object info");
        } else if (dataObj.dataFormat == DataFormats.UNSTRUCTURED) {
            renderableDataObj.renderData.setupFailed = true;
            var usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
            console.log(dataObj.data.values.byteLength, dataObj.data.values);
            renderData.buffers.values = webGPU.createFilledBuffer("f32", dataObj.data.values, usage);
            renderData.buffers.positions = webGPU.createFilledBuffer("f32", dataObj.data.positions, usage);
            renderData.buffers.cellConnectivity = webGPU.createFilledBuffer("u32", dataObj.data.cellConnectivity, usage);
            renderData.buffers.cellOffsets = webGPU.createFilledBuffer("u32", dataObj.data.cellOffsets, usage);
            // only handle tetrahedra for now
            // renderData.buffers.cellTypes = webGPU.createFilledBuffer("u32", dataObj.data.cellTypes, usage);
            
            // generate the tree
            var cellTreeBuffer = dataObj.getCellTreeBuffer();

            console.log(new Float32Array(cellTreeBuffer));
        }

        // add additional data
        renderable.passData.threshold = dataObj.threshold;
        renderable.passData.limits = dataObj.limits;
        renderable.passData.dMatInv = dataObj.getdMatInv();

        dataObj.renderables.push(renderable);
        console.log("setup data for ray marching");
        console.log(renderable);
        console.log(dataObj);
    }

    // do ray marching on the data
    // renders to a texture which will then be composited onto the final view
    this.march = async function(renderable, camera, renderPassDescriptor, box, canvas) {
        var commandEncoder = await device.createCommandEncoder();
        
        var rayMarchRenderPass = {
            ...this.rayMarchPassDescriptor,
            renderDescriptor: renderPassDescriptor,
            resources: [
                [constsBuffer, renderable.renderData.buffers.objectInfo],
                [renderable.renderData.buffers.passInfo, renderable.renderData.textures.data]
            ],
            box: box,
            boundingBox: canvas.getBoundingClientRect(),
            vertexBuffers: [renderable.renderData.buffers.vertex],
            indexBuffer: renderable.renderData.buffers.index,
            indicesCount: renderable.indexCount,
        }

        // encode the render pass
        webGPU.encodeGPUPass(commandEncoder, rayMarchRenderPass);

        // write buffers
        webGPU.writeDataToBuffer(
            constsBuffer,
            [camera.serialise(), new Uint32Array([performance.now()])]
        );
        webGPU.writeDataToBuffer(
            renderable.renderData.buffers.objectInfo, 
            [new Float32Array(renderable.transform), renderable.serialisedMaterials]
        );
        webGPU.writeDataToBuffer(
            renderable.renderData.buffers.passInfo, 
            [
                new Uint32Array([this.getPassFlagsUint()]), 
                new Float32Array([
                    renderable.passData.threshold, 
                    renderable.passData.limits[0],
                    renderable.passData.limits[1],
                    1, 
                    2000,
                    0, 0,
                    ...renderable.passData.dMatInv,
                ])
            ]
        );

        device.queue.submit([commandEncoder.finish()]);
    }
}