// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import {mat4} from "https://cdn.skypack.dev/gl-matrix";
import { RenderableObjectTypes, RenderableObjectUsage, checkForChild, getTotalObjectTransform } from "../../sceneObjects.js";
import { clampBox } from "../../../utils.js";

export function WebGPURayMarchingEngine(webGPUBase) {
    var webGPU = webGPUBase;
    var device = webGPU.device;

    var constsBuffer;
    var rayMarchBindGroupLayouts;

    this.rayMarchPassDescriptor;

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
        rayMarchBindGroupLayouts = [
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

    this.setupRayMarch = async function(renderableDataObj) {
        var renderData = renderableDataObj.renderData;
        var dataObj = renderableDataObj.object;
        if(!renderData.textures) renderData.textures = {};
        if(!renderData.buffers) renderData.buffers = {};
        if(!renderData.samplers) renderData.samplers = {};

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

        //create sampler for data texture
        renderData.samplers.data = device.createSampler({
            label: "ray data sampler",
            magFilter: "linear",
            minFilter: "linear"
        });

        renderData.buffers.passInfo = webGPU.makeBuffer(256, "u cs cd", "ray pass info");
        renderData.buffers.objectInfo = webGPU.makeBuffer(256, "u cs cd", "object info");
        renderableDataObj.renderData.rayMarchingReady = true;
    }

    // do ray marching on the data
    // renders to a texture which will then be composited onto the final view
    this.march = async function(renderableDataObj, camera, renderPassDescriptor, box, canvas) {
        // load the data to the GPU if its not already there
        if (!renderableDataObj.renderData.rayMarchingReady) {
            this.setupRayMarch(renderableDataObj);
        }

        var meshObj = checkForChild(renderableDataObj, RenderableObjectTypes.MESH, RenderableObjectUsage.BOUNDING_BOX)?.object;

        var transform = getTotalObjectTransform(renderableDataObj);

        var commandEncoder = await device.createCommandEncoder();
        
        var rayMarchRenderPass = {
            ...this.rayMarchPassDescriptor,
            renderDescriptor: renderPassDescriptor,
            resources: [
                [constsBuffer, renderableDataObj.renderData.buffers.objectInfo],
                [renderableDataObj.renderData.buffers.passInfo, renderableDataObj.renderData.textures.data]
            ],
            box: box,
            boundingBox: canvas.getBoundingClientRect(),
            vertexBuffers: [meshObj.buffers.vertex],
            indexBuffer: meshObj.buffers.index,
            indicesCount: meshObj.indicesNum,
        }

        // encode the render pass
        webGPU.encodeGPUPass(commandEncoder, rayMarchRenderPass);

        // write buffers
        webGPU.writeDataToBuffer(
            constsBuffer,
            [camera.serialise(), new Uint32Array([performance.now()])]
        );
        webGPU.writeDataToBuffer(
            renderableDataObj.renderData.buffers.objectInfo, 
            [new Float32Array(transform), meshObj.serialiseMaterials()]
        );
        webGPU.writeDataToBuffer(
            renderableDataObj.renderData.buffers.passInfo, 
            [
                new Uint32Array([this.getPassFlagsUint()]), 
                new Float32Array([
                    renderableDataObj.renderData.threshold, 
                    renderableDataObj.object.limits[0],
                    renderableDataObj.object.limits[1],
                    1, 
                    2000,
                    0, 0,
                    ...renderableDataObj.object.getdMatInv(),
                ])
            ]
        );

        device.queue.submit([commandEncoder.finish()]);
    }
}