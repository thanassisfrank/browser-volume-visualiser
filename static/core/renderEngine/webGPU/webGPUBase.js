// webGPUBase.js
// holds utility functions for webgpu, common to both rendering and compute passes

import { stringFormat, clampBox, floorBox } from "../../utils.js";
import { RenderableObject, RenderableObjectTypes } from "../sceneObjects.js";


// class for 
export function WebGPUBase (verbose) {
    this.adapter;
    this.device;
    this.buffers
    this.verbose = verbose;

    this.maxStorageBufferBindingSize;

    this.vertexLayouts = {
        // the layout for only a position buffer, f32
        justPosition: [
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
    }

    this.bindGroupLayouts = {};

    this.PassTypes = {
        RENDER: 1,
        COMPUTE: 2,
    }

    this.wgslLibs = {};

    this.getNewBufferId = function(){
        var id = Object.keys(buffers).length;
            while (buffers.hasOwnProperty(String(id))) {
                id++;
            };
            return String(id);
    }

    this.setupWebGPU = async function() {
        console.log(navigator.gpu.wgslLanguageFeatures);
        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: "high-performance"
        });
        console.log(await this.adapter.requestAdapterInfo());
        console.log(this.adapter.limits);
        if (!this.adapter.features.has("float32-filterable")) {
            console.warn("Filterable 32-bit float textures support is not available");
        }
        this.device = await this.adapter.requestDevice({
            requiredLimits:{
                maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize,
                maxBufferSize: this.adapter.limits.maxBufferSize
            }
        });
        console.log(this.device.limits);
        this.maxStorageBufferBindingSize = this.device.limits.maxStorageBufferBindingSize;

        this.bindGroupLayouts = {
            render0 : this.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {type: "uniform"}
                },
                {
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {type: "uniform"}
                }
            ], "render0"),
        }

        // load utils.wgsl as a string
        this.wgslLibs["utils.wgsl"] =  await this.fetchShader("core/renderEngine/webGPU/shaders/utils.wgsl");
        this.wgslLibs["rayMarchUtils.wgsl"] =  await this.fetchShader("core/renderEngine/webGPU/shaders/rayMarchUtils.wgsl");
    }

    this.fetchShader = function(name) {
        return fetch(name).then(response => response.text());
    }
    

    // generates a BGLayout from the input string
    // " " separates bindings
    // stages/visibility:
    // c   compute
    // v   vertex
    // f   fragment
    // binding types:
    // b   buffer
    // s   sampler
    // t   texture
    // in order [stage][binding type][binding info...]

    this.generateBGLayout = function(desc, label = "") {
        const entriesStr = desc.split(" ");
        var entries = [];
        for (let i = 0; i < entriesStr.length; i++) {
            var entry = {binding: i}

            entry.visibility = {
                c: GPUShaderStage.COMPUTE,
                v: GPUShaderStage.VERTEX,
                f: GPUShaderStage.FRAGMENT
            }[entriesStr[i][0]];

            switch (entriesStr[i][1]) {
                case "b":
                    entry.buffer = {};
                    entry.buffer.type = {
                        s: "storage",
                        r: "read-only-storage",
                        u: "uniform"
                    }[entriesStr[i][2]];
                    break;
                case "s":
                    entry.sampler = {};
                    entry.sampler.type = {
                        f: "filtering",
                        n: "non-filtering",
                        c: "comparison"
                    }[entriesStr[i][2]];
                    break;
                case "t":
                    entry.texture = {};
                    entry.texture.sampleType = {
                        f: "float",
                        n: "unfilterable-float",
                        d: "depth",
                        s: "sint",
                        u: "uint"
                    }[entriesStr[i][2]];
                    entry.texture.viewDimension = {
                        "1d": "1d",
                        "2d": "2d",
                        "2a": "2d-array",
                        "cu": "cube",
                        "ca": "cube-array",
                        "3d": "3d"
                    }[entriesStr[i].slice(3, 3+2)];
                    entry.texture.multiSampled = {
                        "t": true,
                        "f": false
                    }[entriesStr[i][5]];
                    break;
                case "w":
                    entry.storageTexture = {
                        access: "write-only"
                    };
                    entry.storageTexture.viewDimension = {
                        "1d": "1d",
                        "2d": "2d",
                        "2a": "2d-array",
                        "cu": "cube",
                        "ca": "cube-array",
                        "3d": "3d"
                    }[entriesStr[i].slice(2, 2+2)];
                    entry.storageTexture.format = entriesStr[i].slice(4);
                    break;
            }

            entries.push(entry);
        }
        // console.log(entries)
        return this.device.createBindGroupLayout({label: label, entries: entries});
    }


    // simple wrapper that puts the correct binding number in the entries
    this.createBindGroupLayout = function(entries, label = "") {
        var finalEntries = []
        for (let i = 0; i < entries.length; i++) {
            finalEntries.push({
                binding: i,
                ...entries[i],
            })
        }
        return this.device.createBindGroupLayout({entries:finalEntries, label: label})

    }

    this.generateBG = function(layout, resources, label = "") {
        var entries = [];
        for (let i = 0; i < resources.length; i++) {
            if (resources[i].constructor == GPUBuffer) {
                entries.push({
                    binding: i,
                    resource: {
                        buffer: resources[i]
                    }
                })
            } else if (resources[i].constructor == GPUTexture){
                entries.push({
                    binding: i,
                    resource: resources[i].createView()
                })
            } else {
                entries.push({
                    binding: i,
                    resource: resources[i]
                })
            }
        }
        return this.device.createBindGroup({
            layout: layout,
            label: label,
            entries: entries
        })
    }

    this.generateComputePipeline = function(codeStr, formatObj, bgLayouts) {
        const module = this.createFormattedShaderModule(codeStr, formatObj);

        var pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: bgLayouts
        });

        return this.device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: module,
                entryPoint: "main"
            }
        });
    }

    this.createFormattedShaderModule = function(codeStr, formatObj) {
        // format any constants and imports
        const codeFormatted = stringFormat(
            codeStr, 
            {
                ...formatObj,     // constants
                ...this.wgslLibs, // wgsl code imports
            }
        );

        return this.device.createShaderModule({
            code: codeFormatted
        });
    }

    // generates a buffer with the information and returns it
    // size is in bytes
    this.makeBuffer = function(size, usage, label = "", mappedAtCreation = false) {
        var usageInt = 0;
        const usageDict = {
            "mr": GPUBufferUsage.MAP_READ,
            "mw": GPUBufferUsage.MAP_WRITE,
            "cs": GPUBufferUsage.COPY_SRC,
            "cd": GPUBufferUsage.COPY_DST,
            "i": GPUBufferUsage.INDEX,
            "v": GPUBufferUsage.VERTEX,
            "u": GPUBufferUsage.UNIFORM,
            "s": GPUBufferUsage.STORAGE,
            "id": GPUBufferUsage.INDIRECT,
            "qr": GPUBufferUsage.QUERY_RESOLVE
        }
        for (let usageStr of usage.split(" ")) {
            usageInt |= usageDict[usageStr];
        }
        var bufferSize = size;
        if (usageInt & GPUBuffer.STORAGE) {
            bufferSize = Math.max(64, bufferSize);
        }
        return this.device.createBuffer({
            label: label,
            size: bufferSize,
            usage: usageInt,
            mappedAtCreation: mappedAtCreation
        });
    }

    this.deleteBuffers = function(meshObj) {
        meshObj.buffers?.vertex?.destroy();
        meshObj.buffers?.normal?.destroy();
        meshObj.buffers?.index?.destroy();
    };

    // works for any usage, doesnt have to include mapwrite
    this.createFilledBuffer = function(type, data, usage) {
        const byteLength = data.byteLength;
        var buffer = this.device.createBuffer({
            size: byteLength,
            usage: usage,
            mappedAtCreation: true
        });
        if (type == "f32") {
            new Float32Array(buffer.getMappedRange()).set(data);
        } else if (type == "u32") {
            new Uint32Array(buffer.getMappedRange()).set(data);
        } else if (type = "u8") {
            new Uint8Array(buffer.getMappedRange()).set(data);
        }
        
        buffer.unmap();
        return buffer;
    }

    // put data into a buffer that cannot be mapped
    this.fillBuffer = function(targetBuffer, dataBuffer) {
        // create temp buffer to copy into
    }

    // fills a texture from a buffer
    // for now, works with float32 buffer -> float32 texture
    this.fillTexture = async function(targetTexture, textureSize, bytesPerTexel, typedArrayBuffer) {
        // get the buffer size limit
        var maxBufferSize = this.device.limits.maxBufferSize;
        console.log("max buffer size:", maxBufferSize);
        console.log("this buffer size:", typedArrayBuffer.byteLength);
        if (typedArrayBuffer.byteLength > maxBufferSize) {
            console.log("split up")
            // have to split up writing the texture into chunks
            // split up on different image planes (z axis)
            // this approach limits us to textures where each layer is < maxBufferSize

            // size of a layer in 
            var textureImageSize = textureSize.width * textureSize.height * bytesPerTexel;
            var imagesInChunk = Math.floor(maxBufferSize/textureImageSize);
            
            var chunks = Math.ceil(textureSize.depthOrArrayLayers/imagesInChunk);
            
            var totalImages = textureSize.depthOrArrayLayers;
            console.log(chunks, totalImages);


            var currentImage = 0;
            for (let i = 0; i < chunks.length; i++) {
                var thisImages = Math.min(imagesInChunk, totalImages - currentImage);
                console.log("writing", thisImages, "layers");

                // create a command encoder
                var commandEncoder = await this.device.createCommandEncoder();
                var chunkBuffer = this.createFilledBuffer("f32", 
                    typedArrayBuffer.subarray(
                        currentImage * imagesInChunk * textureImageSize/4, 
                        (currentImage + thisImages) * imagesInChunk * textureImageSize/4
                    ),
                    GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
                );

                commandEncoder.copyBufferToTexture(
                    {
                        buffer: chunkBuffer
                    },
                    {
                        texture: targetTexture,
                        origin: {
                            x: 0,
                            y: 0,
                            z: currentImage
                        }
                    },
                    {
                        width: textureSize.width,
                        height: textureSize.height,
                        depthOrArrayLayers: 5, 
                    }
                )

                this.device.queue.submit([commandEncoder.finish()]);
                await this.waitForDone();

                // this.device.queue.writeTexture(
                //     {
                //         texture: targetTexture,
                //         origin: {
                //             x: 0,
                //             y: 0,
                //             z: currentImage
                //         }
                //     },
                //     typedArrayBuffer.subarray(
                //         currentImage * imagesInChunk * textureImageSize/4, 
                //         (currentImage + thisImages) * imagesInChunk * textureImageSize/4
                //     ),
                //     {
                //         offset: 0,
                //         bytesPerRow: textureSize.width * bytesPerTexel,
                //         rowsPerImage: textureSize.height
                //     },
                //     {
                //         width: textureSize.width,
                //         height: textureSize.height,
                //         depthOrArrayLayers: 256, 
                //     }
                // )

            }

        } else {
            // write the buffer into the texture
            this.device.queue.writeTexture(
                {
                    texture: targetTexture
                },
                typedArrayBuffer,
                {
                    offset: 0,
                    bytesPerRow: textureSize.width * bytesPerTexel,
                    rowsPerImage: textureSize.height
                },
                textureSize
            );
        }

        await this.waitForDone();
        
    }

    this.waitForDone = async function() {
        await this.device.queue.onSubmittedWorkDone();
        return;
    }
    // enqueues operations on the given buffer to write the typed arrays
    this.writeDataToBuffer = function(buffer, dataArrays, offset = 0) {
        var currOffset = offset;
        for (let i = 0; i < dataArrays.length; i++) {
            this.device.queue.writeBuffer(
                buffer, 
                currOffset, 
                dataArrays[i]
            );
            currOffset += dataArrays[i].byteLength;
        }
    }
    // copy a buffer to CPU side and return the contents as array buffer
    this.readBuffer = async function(buffer, start, byteLength) {
        if (!buffer) return;
        var readBuffer = this.makeBuffer(byteLength, "cd mr", "read buffer");

        var commandEncoder = await this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(buffer, start, readBuffer, 0, byteLength);
        this.device.queue.submit([commandEncoder.finish()]);

        await this.waitForDone();
        // this.device.queue.onSubmittedWorkDone();
    
        await readBuffer.mapAsync(GPUMapMode.READ);
        
        // map to main memory
        var mappedArrayBuffer = readBuffer.getMappedRange();
        // copy to persistent location
        var readArrayBuffer = mappedArrayBuffer.slice();
        // clean up the temporary read buffer
        readBuffer.unmap();
        readBuffer.destroy();

        return readArrayBuffer;
    }

    // creates a pass descriptor object
    this.createPassDescriptor = function(passType, passOptions, bindGroupLayouts, code) {
        // console.log(bindGroupLayouts);
        var pipelineLayout = this.device.createPipelineLayout({bindGroupLayouts: bindGroupLayouts});
        var shaderModule = this.createFormattedShaderModule(code.str, code.formatObj);
        if (passType = this.PassTypes.RENDER) {
            // create a render pass
            var pipelineDescriptor = {
                layout: pipelineLayout,
                vertex: {
                    module: shaderModule,
                    entryPoint: "vertex_main",
                    buffers: passOptions.vertexLayout
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: "fragment_main",
                    targets: [{
                        format: "bgra8unorm",
                        blend: {
                            color: {
                                operation: "add",
                                srcFactor: "src-alpha", 
                                dstFactor: "one-minus-src-alpha"
                            },
                            alpha: {
                                operation: "add",
                                srcFactor: "one",
                                dstFactor: "zero"
                            }
                        }
                    }]
                },
                primitive: {
                    topology: passOptions.topology,
                },
                depthStencil: {
                    format: "depth32float",
                    depthWriteEnabled : true,
                    depthCompare: "less"
                }
            };
            // create the render pass object
            return {
                passType: this.PassTypes.RENDER,
                indexed: passOptions.indexed || false,
                bindGroupLayouts: bindGroupLayouts,
                pipeline: this.device.createRenderPipeline(pipelineDescriptor),
            }
        } else if (passType == this.PassTypes.COMPUTE) {
            // create a compute pass
            var pipelineDescriptor = {
                layout: pipelineLayout,
                compute: {
                    module: shaderModule,
                    entryPoint: "main"
                }
            }
            // create the compute pass object
            return {
                passType: this.PassTypes.COMPUTE,
                bindGroupLayouts: bindGroupLayouts,
                pipeline: this.device.createComputePipeline(pipelineDescriptor),
            }
        } else {
            // not a valid pass type
            return;
        }
    }

    // encodes a GPU pass onto the command encoder
    this.encodeGPUPass = function(commandEncoder, passObj) {
        var bindGroups = [];
        for (let i = 0; i < passObj.resources.length; i++) {
            bindGroups.push(this.generateBG(passObj.bindGroupLayouts[i], passObj.resources[i]));
        }
        if (passObj.passType == this.PassTypes.RENDER) {
            const passEncoder = commandEncoder.beginRenderPass(passObj.renderDescriptor);
            var box = passObj.box;
            var bounds = passObj.boundingBox;
            passEncoder.setViewport(
                Math.floor(box.left - bounds.left), 
                Math.floor(box.top - bounds.top), 
                Math.floor(box.width), 
                Math.floor(box.height), 
                0, 1
            );

            box = clampBox(box, bounds);
            box = floorBox(box);
            
            // console.log(clampedBox);
            // console.log(box, passObj.boundingBox)
            // will support rect outside the attachment size for V1 of webgpu
            // https://github.com/gpuweb/gpuweb/issues/373 
            passEncoder.setScissorRect(box.left, box.top, box.width, box.height);
            passEncoder.setPipeline(passObj.pipeline);

            for (let i = 0; i < passObj.vertexBuffers.length; i++) {
                passEncoder.setVertexBuffer(i, passObj.vertexBuffers[i]);
            }
            for (let i = 0; i < bindGroups.length; i++) {
                passEncoder.setBindGroup(i, bindGroups[i]);
            }
            if (passObj.indexed) {
                passEncoder.setIndexBuffer(passObj.indexBuffer, "uint32");
                passEncoder.drawIndexed(passObj.indicesCount);
            } else {
                passEncoder.draw(passObj.vertCount);
            }
            passEncoder.end();
        } else if (passObj.passType == this.PassTypes.COMPUTE) {
            passEncoder.setPipeline(dataObj.marchData.pipelines.march);
            for (let i = 0; i < bindGroups.length; i++) {
                passEncoder.setBindGroup(i, bindGroups[i]);
            }
            passEncoder.dispatchWorkgroups(...passObj.workGroups);
            passEncoder.end();
        }

        return commandEncoder; 
    }

    // TO ADD:
    // create filled texture
}