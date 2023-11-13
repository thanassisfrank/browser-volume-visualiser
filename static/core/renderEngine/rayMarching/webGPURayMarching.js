// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import {mat4} from "https://cdn.skypack.dev/gl-matrix";
import { RenderableObjectTypes, RenderableObjectUsage, checkForChild } from "../sceneObjects.js";
import { clampBox } from "../../utils.js";

export function WebGPURayMarchingEngine(webGPUBase) {
    var webGPU = webGPUBase;
    var device = webGPU.device;

    var constsBuffer;
    var constsBindGroup;
    var rayMarchBindGroupLayouts;

    var rayMarchPass;

    this.passFlags = {
        phong: true,
        backStep: true,
        showNormals: false,
        showVolume: true,
        fixedCamera: false,
    }

    this.getPassFlagsUint = function() {
        var flags = 0;
        flags |= this.passFlags.phong            & 0b00001;
        flags |= this.passFlags.backStep    << 1 & 0b00010;
        flags |= this.passFlags.showNormals << 2 & 0b00100;
        flags |= this.passFlags.showVolume  << 3 & 0b01000;
        flags |= this.passFlags.fixedCamera << 4 & 0b10000;
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
        var rayMarchCode = await webGPU.fetchShader("core/renderEngine/rayMarching/shaders/rayMarch.wgsl");

        rayMarchPass = webGPU.createPass(
            webGPU.PassTypes.RENDER, 
            {vertexLayout: webGPU.vertexLayouts.justPosition, topology: "triangle-list", indexed: true},
            rayMarchBindGroupLayouts,
            {str: rayMarchCode, formatObj: {}}
        );

    };

    this.setupRayMarch = async function(renderableDataObj) {
        var renderData = renderableDataObj.renderData;
        var dataObj = renderableDataObj.object;
        if(!renderData.textures) renderData.textures = {};
        if(!renderData.buffers) renderData.buffers = {};
        if(!renderData.samplers) renderData.samplers = {};

        // copy the data to a texture
        const textureSize = {
            width: dataObj.size[2],
            height: dataObj.size[1],
            depthOrArrayLayers: dataObj.size[0]
        }

        renderData.textures.data = device.createTexture({
            label: "whole data texture",
            size: textureSize,
            dimension: "3d",
            format: "r32float",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });

        await webGPU.fillTexture(renderData.textures.data, textureSize, 4, Float32Array.from(dataObj.data).buffer);

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

        // need to get the transform of object it i.e. rotation and scale as mat4
        var transform = mat4.create();
        // mat4.scale(transform, transform, renderableDataObj.object.cellSize);
        mat4.multiply(transform, renderableDataObj.transform, transform);
        var parent = renderableDataObj.parent;
        while (parent) {
            mat4.multiply(transform, parent.transform, transform);
            parent = parent.parent;
        }
        
        // create bind groups
        constsBindGroup = webGPU.generateBG(rayMarchBindGroupLayouts[0], [
            constsBuffer,
            renderableDataObj.renderData.buffers.objectInfo
        ]);
        // var passBindGroup = webGPU.generateBG(rayMarchBindGroupLayouts[1], [
        //     renderableDataObj.renderData.buffers.passInfo,
        //     renderableDataObj.renderData.textures.data
        // ]);
        var passBindGroup = device.createBindGroup({
            layout: rayMarchBindGroupLayouts[1],
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: renderableDataObj.renderData.buffers.passInfo
                    }
                },
                {
                    binding: 1,
                    resource: renderableDataObj.renderData.textures.data.createView()
                }
            ]
        })
        


        var commandEncoder = await device.createCommandEncoder();
        
        var renderPass = rayMarchPass;
        renderPass.descriptor = renderPassDescriptor;
        renderPass.bindGroups = [constsBindGroup, passBindGroup];
        renderPass.box = box;
        renderPass.boundingBox = canvas.getBoundingClientRect();
        
        var meshObj = checkForChild(renderableDataObj, RenderableObjectTypes.MESH, RenderableObjectUsage.BOUNDING_BOX)?.object;
        renderPass.vertexBuffers[0] = meshObj.buffers.vertex;
        renderPass.indexBuffer = meshObj.buffers.index;
        renderPass.indicesCount = meshObj.indicesNum;

        // encode the render pass
        webGPU.encodeGPUPass(commandEncoder, rayMarchPass);

        // write global info buffer
        device.queue.writeBuffer(
            constsBuffer, 
            0, 
            new Float32Array([
                ...camera.projMat, 
                ...camera.getModelViewMat(), 
                ...camera.getEyePos(), 0,
            ])
        );

        // write obect info buffer
        device.queue.writeBuffer(
            renderableDataObj.renderData.buffers.objectInfo,
            0,
            new Float32Array([
                ...transform, 
                ...meshObj.serialiseMaterials()
            ])
        );
        // write pass info buffer
        device.queue.writeBuffer(
            renderableDataObj.renderData.buffers.passInfo,
            0,
            new Uint32Array([
                this.getPassFlagsUint(),
            ])
        );
        device.queue.writeBuffer(
            renderableDataObj.renderData.buffers.passInfo,
            4,
            new Float32Array([
                renderableDataObj.renderData.threshold, 
                renderableDataObj.object.limits[0],
                renderableDataObj.object.limits[1],
                1, 
                1000,
                0, 0,
                ...renderableDataObj.object.getdMatInv(),
            ])
        );

        device.queue.submit([commandEncoder.finish()]);
    }
}