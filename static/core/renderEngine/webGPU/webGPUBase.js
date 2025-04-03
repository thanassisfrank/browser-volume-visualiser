// webGPUBase.js
// holds utility functions for webgpu, common to both rendering and compute passes

import { stringFormat, clampBox, floorBox, aToXYZ } from "../../utils.js";
import { Renderable, RenderableTypes, RenderableRenderModes } from "../renderEngine.js";

export const GPUTexelByteLength = {
    "depth32float": 4,
    "r32float": 4,
    "rg32float": 8,
    "bgra8unorm" : 4
}

// when copying texture->buffer bytesPerRow must be multiple of 256
export const BYTES_PER_ROW_ALIGN = 256;

// creates a JS-accessible texture-like object to wrap a buffer returned from a GPUTexture
// the origin will always remain in the same place but the width of the copy region may different from supplied
// value to adhere to the bytesPerRow restriction
// creates a JS-accessible texture-like object to wrap a buffer returned from a GPUTexture
// the origin will always remain in the same place but the width of the copy region may different from supplied
// value to adhere to the bytesPerRow restriction
export class GPUTextureMapped {
    #data;
    #stride;
    #width;
    #height;

    constructor(buffer, width, height, depthOrArrayLayers, format) {
        if (format.includes("32float")) {
            this.#data = new Float32Array(buffer);
        }

        if (format.slice(0, 3) == "rgb") {
            this.#stride = 3;
        } else if (format.slice(0, 2) == "rg") {
            this.#stride = 2;
        } else {
            this.#stride = 1;
        }
        this.#width = width;
        this.#height = height;
    }

    readTexel(x = 0, y = 0, z = 0) {
        if (!this.#data) return;

        const index = this.#stride * (z * this.#width * this.#height + y * this.#width + x);

        return this.#data.slice(index, index + this.#stride);
    };
}


// class for 
// class for 
export class WebGPUBase {
    // public ====================
    verbose;

    vertexLayouts = {
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

    // private ===================
    #adapter;
    #device;

    // a record of currently alive resources with bound gpu-memory
    // keys are the unique labels of the resources and values are size in bytes
    #GPUResourceBytes = {};

    #requiredDeviceLimits = {
        maxStorageBuffersPerShaderStage: 9,
    };

    bindGroupLayouts = {};

    PassTypes = {
        RENDER: 1,
        COMPUTE: 2,
    };

    wgslLibs = {};
    constructor(verbose = false) {
        this.verbose = verbose;
    }

    log(...data) {
        if (this.verbose) console.log(...data);
    };

    async setupWebGPU() {
        this.log(navigator.gpu.wgslLanguageFeatures);
        // gpu
        this.#adapter = await navigator.gpu.requestAdapter({
            powerPreference: "high-performance"
        });
        this.log(navigator.gpu.wgslLanguageFeatures);

        // adapter
        this.log(this.#adapter.info);
        this.log(this.#adapter.limits);
        var features = [];
        for (let feature of this.#adapter.features.values()) {
            features.push(feature);
        }
        this.log("adapter features: ", features);

        for (let key in this.#requiredDeviceLimits) {
            if (this.#adapter.limits[key] <= this.#requiredDeviceLimits[key]) {
                throw key + " of " + this.#adapter.limits[key] + " is below " + this.#requiredDeviceLimits[key] + " required";
            }
        }

        // device
        this.#device = await this.#adapter.requestDevice({
            requiredLimits: {
                maxStorageBufferBindingSize: this.#adapter.limits.maxStorageBufferBindingSize,
                maxBufferSize: this.#adapter.limits.maxBufferSize,
                maxStorageBuffersPerShaderStage: this.#adapter.limits.maxStorageBuffersPerShaderStage
            },
            requiredFeatures: ["bgra8unorm-storage", "timestamp-query"]
        });
        this.log(this.#device.limits);

        // load utils.wgsl as a string
        this.wgslLibs["utils.wgsl"] = await this.fetchShader("core/renderEngine/webGPU/shaders/utils.wgsl");
        this.wgslLibs["rayMarchUtils.wgsl"] = await this.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/rayMarchUtils.wgsl");
    };

    async fetchShader(name) {
        const res = await fetch(name);
        return await res.text();
    };

    getDevice() {
        return this.#device;
    };


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
    generateBGLayout(desc, label = "") {
        const entriesStr = desc.split(" ");
        var entries = [];
        for (let i = 0; i < entriesStr.length; i++) {
            var entry = { binding: i };

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
                    }[entriesStr[i].slice(3, 3 + 2)];
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
                    }[entriesStr[i].slice(2, 2 + 2)];
                    entry.storageTexture.format = entriesStr[i].slice(4);
                    break;
            }

            entries.push(entry);
        }
        return this.#device.createBindGroupLayout({ label: label, entries: entries });
    };

    // simple wrapper that puts the correct binding number in the entries
    createBindGroupLayout(entries, label = "") {
        var finalEntries = [];
        for (let i = 0; i < entries.length; i++) {
            finalEntries.push({
                binding: i,
                ...entries[i],
            });
        }
        return this.#device.createBindGroupLayout({ entries: finalEntries, label: label });
    };

    generateBG(layout, resources, label = "") {
        var entries = [];
        for (let i = 0; i < resources.length; i++) {
            // skip empty slots
            if (!resources[i]) continue;
            if (resources[i].constructor == GPUBuffer) {
                entries.push({
                    binding: i,
                    resource: {
                        buffer: resources[i]
                    }
                });
            } else if (resources[i].constructor == GPUTexture) {
                entries.push({
                    binding: i,
                    resource: resources[i]
                });
            } else {
                entries.push({
                    binding: i,
                    resource: resources[i]
                });
            }
        }
        return this.#device.createBindGroup({
            layout: layout,
            label: label,
            entries: entries
        });
    };

    generateComputePipeline(codeStr, formatObj, bgLayouts) {
        const module = this.createFormattedShaderModule(codeStr, formatObj);

        var pipelineLayout = this.#device.createPipelineLayout({
            bindGroupLayouts: bgLayouts
        });

        return this.#device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: module,
                entryPoint: "main"
            }
        });
    };

    createShader(codeStr, formatObj={}) {
        // format any constants and imports
        const codeFormatted = stringFormat(
            codeStr,
            {
                ...formatObj, // constants
                ...this.wgslLibs, // wgsl code imports
            }
        );

        return this.#device.createShaderModule({
            code: codeFormatted
        });
    };

    // serialises a set of 2 materials in the format expected by the shader
    serialiseMaterial(material) {
        const frontDiff = material?.front.diffuseCol ?? [0, 0, 0];
        const frontSpec = material?.front.specularCol ?? [0, 0, 0];
        const frontShiny = material?.front.shininess ?? 0;
        const backDiff = material?.back.diffuseCol ?? [0, 0, 0];
        const backSpec = material?.back.specularCol ?? [0, 0, 0];
        const backShiny = material?.back.shininess ?? 0;
        return new Float32Array([
            ...frontDiff, 1,
            ...frontSpec, 1,
            frontShiny, 0, 0, 0,
            ...backDiff, 1,
            ...backSpec, 1,
            backShiny, 0, 0, 0
        ]);
    };

    getResourcesString() {
        var str = "Resources\n";
        var entries = [];
        var maxLabelLength = 0;
        for (let label in this.#GPUResourceBytes) {
            maxLabelLength = Math.max(maxLabelLength, label.length);
            entries.push([label, this.#GPUResourceBytes[label]]);
        }
        entries.sort((a, b) => b[1] - a[1]);
        for (let entry of entries) {
            var bytes = entry[1];
            var thousands = Math.floor(Math.log10(bytes) / 3);
            var unit = (["B", "KB", "MB", "GB"])[thousands];
            var sizeStr = (bytes / Math.pow(1000, thousands)).toPrecision(4) + " " + unit;
            str += entry[0] + " ".repeat(maxLabelLength - entry[0].length) + "\t" + sizeStr + "\n";
        }
        return str;
    };


    // Buffer management ====================================================================================
    // generates a buffer with the information and returns it
    // size is in bytes
    makeBuffer(byteLength, usage, label = "", mappedAtCreation = false) {
        var bufferSize = Math.max(byteLength, 64);

        var uniqueLabel = "BUF: " + (label || "0");
        while (this.#GPUResourceBytes[uniqueLabel]) uniqueLabel += "0";
        this.#GPUResourceBytes[uniqueLabel] = bufferSize;

        return this.#device.createBuffer({
            label: uniqueLabel,
            size: bufferSize,
            usage: usage,
            mappedAtCreation: mappedAtCreation
        });
    };

    // works for any usage, doesnt have to include mapwrite
    createFilledBuffer(type, data, usage, label = "") {
        const byteLength = Math.max(32, data.byteLength);
        var buffer = this.makeBuffer(byteLength, usage, label, true);
        if (type == "f32") {
            new Float32Array(buffer.getMappedRange()).set(data);
        } else if (type == "u32") {
            new Uint32Array(buffer.getMappedRange()).set(data);
        } else if (type = "u8") {
            new Uint8Array(buffer.getMappedRange()).set(data);
        } else {
            // can't do this
            console.warn("can't create filled buffer of this type");
            buffer.unmap();
            this.deleteBuffer(buffer);
            return;
        }

        buffer.unmap();
        return buffer;
    };

    // enqueues operations on the given buffer to write the typed arrays
    writeDataToBuffer(buffer, dataArrays, offset = 0) {
        var currOffset = offset;
        for (let i = 0; i < dataArrays.length; i++) {
            this.#device.queue.writeBuffer(
                buffer,
                currOffset,
                dataArrays[i]
            );
            currOffset += dataArrays[i].byteLength;
        }
    };

    // attempts to write into the supplied buffer, if it is too small, returns new buffer
    // accepts a typed array for data and uses its arrayBuffer
    writeOrCreateNewBuffer(buffer, data, usage, label = "") {
        let resultBuffer = buffer;
        let created = false;
        if (buffer.size < data.byteLength) {
            this.log("create " + label);
            // create new buffer in this slot
            this.deleteBuffer(buffer);
            resultBuffer = this.createFilledBuffer(
                "u8",
                new Uint8Array(data.buffer),
                usage,
                label
            );
            created = true;
        } else {
            this.log("write " + label);
            this.writeDataToBuffer(buffer, [data]);
            resultBuffer = buffer;
        }
        return {
            created: created,
            buffer: resultBuffer
        };
    };

    // copy a buffer to CPU side and return the contents as array buffer
    async readBuffer(buffer, start, byteLength) {
        if (!buffer) return;
        var readBuffer = this.makeBuffer(byteLength, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, "read buffer"); //"cd mr"

        var commandEncoder = await this.#device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(buffer, start, readBuffer, 0, byteLength);
        this.#device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);

        // map to main memory
        var mappedArrayBuffer = readBuffer.getMappedRange();
        // copy to persistent location
        var readArrayBuffer = mappedArrayBuffer.slice();
        // clean up the temporary read buffer
        readBuffer.unmap();
        this.deleteBuffer(readBuffer);

        return readArrayBuffer;
    };

    deleteBuffer(buffer) {
        if (buffer) {
            buffer.destroy();
            delete this.#GPUResourceBytes[buffer.label];
        }
    };

    // Texture management ===================================================================================
    makeTexture(config) {
        // TODO: correctly calculate texel count of cubemap textures
        config.size.width ??= 1;
        config.size.height ??= 1;
        config.size.depthOrArrayLayers ??= 1;
        var texelCount = (config.size.width) * (config.size.height) * (config.size.depthOrArrayLayers);
        var byteLength = texelCount * GPUTexelByteLength?.[config.format];

        var uniqueLabel = "TEX: " + (config.label || "0");
        while (this.#GPUResourceBytes[uniqueLabel]) uniqueLabel += "0";
        this.#GPUResourceBytes[uniqueLabel] = byteLength;

        var finalConfig = config;
        finalConfig.label = uniqueLabel;

        return this.#device.createTexture(config);
    };

    async duplicateTexture(texture, usage) {
        const texExtent = {
            width: texture.width,
            height: texture.height,
            depthOrArrayLayers: texture.depthOrArrayLayers
        };

        var newTex = this.makeTexture({
            size: texExtent,
            usage: usage,
            format: texture.format,
            dimension: texture.dimension,
            label: "Copy of: " + texture.label
        });

        await this.copyTextureToTexture(texture, newTex, texExtent);

        return newTex;
    };

    // fills a texture from a buffer
    // for now, works with float32 buffer -> float32 texture
    async fillTexture(targetTexture, textureSize, bytesPerTexel, typedArrayBuffer) {
        // get the buffer size limit
        var maxBufferSize = this.#device.limits.maxBufferSize;
        this.log("max buffer size:", maxBufferSize);
        this.log("this buffer size:", typedArrayBuffer.byteLength);
        if (typedArrayBuffer.byteLength > maxBufferSize) {
            // have to split up writing the texture into chunks
            // split up on different image planes (z axis)
            // this approach limits us to textures where each layer is < maxBufferSize
            // size of a layer in 
            var textureImageSize = textureSize.width * textureSize.height * bytesPerTexel;
            var imagesInChunk = Math.floor(maxBufferSize / textureImageSize);

            var chunks = Math.ceil(textureSize.depthOrArrayLayers / imagesInChunk);

            var totalImages = textureSize.depthOrArrayLayers;

            var currentImage = 0;
            for (let i = 0; i < chunks.length; i++) {
                var thisImages = Math.min(imagesInChunk, totalImages - currentImage);

                // create a command encoder
                var commandEncoder = await this.#device.createCommandEncoder();
                var chunkBuffer = this.createFilledBuffer("f32",
                    typedArrayBuffer.subarray(
                        currentImage * imagesInChunk * textureImageSize / 4,
                        (currentImage + thisImages) * imagesInChunk * textureImageSize / 4
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
                );

                this.#device.queue.submit([commandEncoder.finish()]);
                await this.waitForDone();
            }
        } else {
            // write the buffer into the texture
            this.#device.queue.writeTexture(
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
    };

    writeOrCreateNewTexture(texture, data, dimensions, usage, label = "") {
        let created = false;
        let resultTexture = texture;

        const textureSize = {
            width: dimensions[0],
            height: dimensions[1],
            depthOrArrayLayers: dimensions[2]
        };

        if (texture.width != textureSize.width ||
            texture.height != textureSize.height ||
            texture.depthOrArrayLayers != textureSize.depthOrArrayLayers) {
            this.deleteTexture(texture);

            resultTexture = this.makeTexture({
                label: label,
                size: textureSize,
                dimension: "3d",
                format: "r32float",
                usage: usage
            });
            created = true;
        } else {
            this.log("write" + valuesBufferName);
        }

        this.fillTexture(resultTexture, textureSize, 4, Float32Array.from(data).buffer);
        return {
            created: created,
            texture: resultTexture
        };
    };

    // TODO: allow copying from arbitrary origins within both images
    async copyTextureToTexture(srcTexture, dstTexture, extent) {
        var commandEncoder = await this.#device.createCommandEncoder();
        this.encodeCopyTextureToTexture(commandEncoder, srcTexture, dstTexture, extent);
        this.#device.queue.submit([commandEncoder.finish()]);
    };

    // copies the supplied texture to a temporary read buffer and maps this to the cpu
    // if box is supplied, copies the texture only between the min and max bounds of the box
    // box region is not inclusive of the max 
    async readTexture(texture, box) {
        var requestedSize, origin;

        if (box) {
            // read only a portion of the texture
            if (box.min[0] < 0 || box.max[0] > texture.width ||
                box.min[1] < 0 || box.max[1] > texture.height ||
                box.min[2] < 0 || box.max[2] > texture.depthOrArrayLayers) {
                throw Error("Requested copy region is out of texture bounds");
            }

            origin = aToXYZ(box.min);
            requestedSize = {
                width: box.max[0] - box.min[0],
                height: box.max[1] - box.min[1],
                depthOrArrayLayers: box.max[2] - box.min[2],
            };
        } else {
            origin = {};
            requestedSize = {
                width: texture.width,
                height: texture.height,
                depthOrArrayLayers: texture.depthOrArrayLayers
            };
        }

        // bytesPerRow has to be a multiple of 256
        const fullBytesPerRow = requestedSize.width * GPUTexelByteLength?.[texture.format];
        // go down in width such that the bytesPerRow is n*256
        const bytesPerRowClipped = Math.floor(fullBytesPerRow / BYTES_PER_ROW_ALIGN) * BYTES_PER_ROW_ALIGN;

        const widthClipped = bytesPerRowClipped / GPUTexelByteLength?.[texture.format];

        const texelCount = widthClipped * requestedSize.height * requestedSize.depthOrArrayLayers;
        const textureByteLength = texelCount * GPUTexelByteLength?.[texture.format];
        var readBuffer = this.makeBuffer(
            textureByteLength,
            GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            "texture read buffer for " + texture.label
        );
        var commandEncoder = await this.#device.createCommandEncoder();

        commandEncoder.copyTextureToBuffer(
            {
                texture: texture,
                origin: origin
            },
            {
                buffer: readBuffer,
                bytesPerRow: bytesPerRowClipped,
                rowsPerImage: requestedSize.height
            },
            {
                height: requestedSize.height,
                width: widthClipped,
                depthOrArrayLayers: requestedSize.depthOrArrayLayers
            }
        );

        this.#device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);

        // map to main memory
        var mappedArrayBuffer = readBuffer.getMappedRange();
        // copy to persistent data
        var readArrayBuffer = mappedArrayBuffer.slice();
        // clean up the temporary read buffer
        readBuffer.unmap();
        this.deleteBuffer(readBuffer);

        return {
            width: widthClipped,
            height: texture.height,
            depthOrArrayLayers: texture.depthOrArrayLayers,
            buffer: readArrayBuffer,
        };
    };

    deleteTexture(texture) {
        if (texture) {
            texture?.destroy();
            delete this.#GPUResourceBytes[texture.label];
        }
    };

    // Timing ===============================================================================================
    async waitForDone() {
        await this.#device.queue.onSubmittedWorkDone();
        return;
    };

    createTimingQueryPair() {
        return this.#device.createQuerySet({
            type: "timestamp",
            count: 2
        });
    };

    // returns the duration encoded by a timing query set in ns
    async getPassTimingInfo(passObj) {
        if (!passObj.timingQuerySet) return;

        for (let readBuff of passObj.timingReadBuffers) {
            if (readBuff.mapState !== "unmapped") continue;

            await readBuff.mapAsync(GPUMapMode.READ);
            const times = new BigInt64Array(readBuff.getMappedRange());
            const duration = Number(times[1] - times[0]);
            readBuff.unmap();
            return { duration };
        }
        console.log("couldn't read");
    };

    // Pass and command encoder management ========================================================

    #getPassTimingMixins() {
        const querySet = this.createTimingQueryPair();
        // write timestamps to here from query set
        const resolveBuffer = this.#device.createBuffer({
            size: querySet.count * 8,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
        });

        // copy from resolveBuffer to here for mapping
        // start with one
        const timingReadBuffers = [
            this.#device.createBuffer({
                size: resolveBuffer.size,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
            })
        ];

        return {
            encoder: {
                timestampWrites: {
                    querySet,
                    beginningOfPassWriteIndex: 0,
                    endOfPassWriteIndex: 1,
                }
            },
            pass: {
                timingQuerySet: querySet,
                timingResolveBuffer: resolveBuffer,
                timingReadBuffers
            }
        }
    }

    createRenderPass(bindGroupLayouts, shader, options, label="") {
        let pipelineLayout = this.#device.createPipelineLayout({ bindGroupLayouts: bindGroupLayouts });

        // input to create*passEncoder()
        let passEncoderDescriptor = {};
        // input to create*pipeline()
        let pipelineDescriptor = {};

        // return value
        let passDescriptor = {};

        if (options.timing) {
            const {pass, encoder} = this.#getPassTimingMixins();
            passDescriptor = {...pass};
            passEncoderDescriptor = {...encoder};
        }
        
        // create a render pass
        pipelineDescriptor = {
            ...pipelineDescriptor,
            label: label,
            layout: pipelineLayout,
            vertex: {
                module: shader,
                entryPoint: "vertex_main",
                buffers: options.vertexLayout
            },
            fragment: {
                module: shader,
                entryPoint: "fragment_main",
                targets: []
            },
            primitive: {
                topology: options.topology,
            },
        };

        for (let colorAttachmentFormat of options.colorAttachmentFormats) {
            var colorTarget = {
                format: colorAttachmentFormat,
            };
            // add blend if
            if (colorAttachmentFormat == "bgra8unorm") {
                colorTarget.blend = {
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
                };
            }

            pipelineDescriptor.fragment.targets.push(colorTarget);
        }

        if (!options.excludeDepth) {
            pipelineDescriptor.depthStencil = {
                format: "depth32float",
                depthWriteEnabled: true,
                depthCompare: "less"
            };
        }

        // create the render pass object
        return {
            ...passDescriptor,
            passEncoderDescriptor,
            passType: this.PassTypes.RENDER,
            indexed: options.indexed || false,
            bindGroupLayouts: bindGroupLayouts,
            pipeline: this.#device.createRenderPipeline(pipelineDescriptor),
        };
    }

    createComputePass(bindGroupLayouts, shader, options, label="") {
        let pipelineLayout = this.#device.createPipelineLayout({ bindGroupLayouts: bindGroupLayouts });

        // input to create*passEncoder()
        let passEncoderDescriptor = {};

        let passDescriptor = {};

        if (options.timing) {
            const {pass, encoder} = this.#getPassTimingMixins();
            passDescriptor = {...pass};
            passEncoderDescriptor = {...encoder};
        }

        const pipelineDescriptor = {
            layout: pipelineLayout,
            compute: {
                module: shader,
                entryPoint: "main"
            },
            label
        };
        // create the compute pass object
        return {
            ...passDescriptor,
            passEncoderDescriptor,
            passType: this.PassTypes.COMPUTE,
            bindGroupLayouts: bindGroupLayouts,
            pipeline: this.#device.createComputePipeline(pipelineDescriptor),
        };
    }

    
    // encode passes ==============================================================================
    async createCommandEncoder() {
        return await this.#device.createCommandEncoder();
    };
    
    #encodeRenderPass(commandEncoder, pass) {
        const passEncoder = commandEncoder.beginRenderPass(pass.passEncoderDescriptor);
        var box = pass.box;
        var bounds = pass.boundingBox;
        passEncoder.setViewport(
            Math.floor(box.left - bounds.left),
            Math.floor(box.top - bounds.top),
            Math.floor(box.width),
            Math.floor(box.height),
            0, 1
        );

        box = clampBox(box, bounds);
        box = floorBox(box);

        // will support rect outside the attachment size for V1 of webgpu
        // https://github.com/gpuweb/gpuweb/issues/373 
        passEncoder.setScissorRect(box.left, box.top, box.width, box.height);
        passEncoder.setPipeline(pass.pipeline);

        for (let i = 0; i < pass.vertexBuffers.length; i++) {
            passEncoder.setVertexBuffer(i, pass.vertexBuffers[i]);
        }
        for (let i in pass.bindGroups) {
            passEncoder.setBindGroup(i, pass.bindGroups[i]);
        }
        if (pass.indexed) {
            passEncoder.setIndexBuffer(pass.indexBuffer, "uint32");
            passEncoder.drawIndexed(pass.indicesCount);
        } else {
            passEncoder.draw(pass.vertexCount);
        }
        passEncoder.end();
    }

    #encodeComputePass(commandEncoder, pass) {
        const passEncoder = commandEncoder.beginComputePass(pass.passEncoderDescriptor);
        passEncoder.setPipeline(pass.pipeline);
        for (let i in pass.bindGroups) {
            passEncoder.setBindGroup(i, pass.bindGroups[i]);
        }
        passEncoder.dispatchWorkgroups(...pass.workGroups);
        passEncoder.end();
    }

    #encodeReadPassTiming(commandEncoder, pass) {
        commandEncoder.resolveQuerySet(
            pass.timingQuerySet,
            0,
            pass.timingQuerySet.count,
            pass.timingResolveBuffer,
            0
        );
        let thisReadBuff;

        for (let readBuff of pass.timingReadBuffers) {
            if (readBuff.mapState !== "unmapped") continue;
            thisReadBuff = readBuff;
            break;
        }

        if (!thisReadBuff) {
            const newBuff = this.#device.createBuffer({
                size: pass.timingResolveBuffer.size,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
            });
            pass.timingReadBuffers.push(newBuff);
            thisReadBuff = newBuff;
        }

        commandEncoder.copyBufferToBuffer(
            pass.timingResolveBuffer, 0, thisReadBuff, 0, thisReadBuff.size
        );
    }

    // encodes a GPU pass onto the command encoder
    encodeGPUPass(commandEncoder, pass) {
        if (pass.passType == this.PassTypes.RENDER) {
            this.#encodeRenderPass(commandEncoder, pass);
        } else if (pass.passType == this.PassTypes.COMPUTE) {
            this.#encodeComputePass(commandEncoder, pass);
        }

        // encode the timing reading
        if (pass.passEncoderDescriptor.timestampWrites) {
            this.#encodeReadPassTiming(commandEncoder, pass);
        }

        return commandEncoder;
    };

    // encodes a texture copy operation on the supplied command encode
    encodeCopyTextureToTexture(commandEncoder, srcTexture, dstTexture, extent) {
        var copyExtent = extent ?? {
            width: Math.min(srcTexture.width, dstTexture.width),
            height: Math.min(srcTexture.height, dstTexture.height),
            depthOrArrayLayers: Math.min(srcTexture.depthOrArrayLayers, dstTexture.depthOrArrayLayers)
        };

        commandEncoder.copyTextureToTexture(
            {
                texture: srcTexture,
                origin: {}
            },
            {
                texture: dstTexture,
                origin: {}
            },
            copyExtent
        );
    };

    submitCommandEncoder(commandEncoder) {
        this.#device.queue.submit([commandEncoder.finish()]);
    };
}