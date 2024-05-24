// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import {mat4} from "https://cdn.skypack.dev/gl-matrix";
import { DataFormats, ResolutionModes } from "../../../data/data.js";
import { clampBox } from "../../../utils.js";
import { Renderable, RenderableRenderModes, RenderableTypes } from "../../renderEngine.js";

export function WebGPURayMarchingEngine(webGPUBase) {
    var webGPU = webGPUBase;
    var device = webGPU.device;

    var constsBuffer;
    this.depthTexture;
    this.offsetOptimisationTextureOld;
    this.offsetOptimisationTextureNew;

    this.rayMarchPassDescriptor;
    this.depthRenderPassDescriptor;

    // required: x*y*z <= 256 
    // optimal seems to be 8x8
    this.WGSize = {x: 8, y: 8};

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
        // sent to gpu
        phong: true,
        backStep: true,
        showNormals: false,
        showVolume: true,
        fixedCamera: false,
        randStart: true,
        showSurface: true,
        showRayDirs: false,
        showRayLength: false,
        optimiseOffset: true,
        showOffset: false,
        showDeviceCoords: false,
        sampleNearest: false,
        showCells: false,
        showNodeVals: false,
        showNodeLoc: false,
        showNodeDepth: false,
        quadraticBackStep: false,
        renderNodeVals: false,

        // not sent to gpu
        cheapMove: false,
    };

    this.globalPassInfo = {
        stepSize: 2,
        maxRayLength: 2000,
        framesSinceMove: 0,
    };

    this.getPassFlag = function(name) {
        return this.passFlags[name];
    }

    this.setPassFlag = function(name, state) {
        if (
            name == "optimiseOffset" || 
            name == "showSurface" || 
            name == "backStep" || 
            name == "cheapMove"
        ) {
            this.globalPassInfo.framesSinceMove = 0;
        }
        this.passFlags[name] = state;
    }

    this.getPassFlagsUint = function() {
        var flags = 0;
        flags |= this.passFlags.phong             << 0  & 0b1 << 0;
        flags |= this.passFlags.backStep          << 1  & 0b1 << 1;
        flags |= this.passFlags.showNormals       << 2  & 0b1 << 2;
        flags |= this.passFlags.showVolume        << 3  & 0b1 << 3;
        flags |= this.passFlags.fixedCamera       << 4  & 0b1 << 4;
        flags |= this.passFlags.randStart         << 5  & 0b1 << 5;
        flags |= this.passFlags.showSurface       << 6  & 0b1 << 6;
        flags |= this.passFlags.showRayDirs       << 7  & 0b1 << 7;
        flags |= this.passFlags.showRayLength     << 8  & 0b1 << 8;
        flags |= this.passFlags.optimiseOffset    << 9  & 0b1 << 9;
        flags |= this.passFlags.showOffset        << 10 & 0b1 << 10;
        flags |= this.passFlags.showDeviceCoords  << 11 & 0b1 << 11;
        flags |= this.passFlags.sampleNearest     << 12 & 0b1 << 12;
        flags |= this.passFlags.showCells         << 13 & 0b1 << 13;
        flags |= this.passFlags.showNodeVals      << 14 & 0b1 << 14;
        flags |= this.passFlags.showNodeLoc       << 15 & 0b1 << 15;
        flags |= this.passFlags.showNodeDepth     << 16 & 0b1 << 16;
        flags |= this.passFlags.secantRoot        << 17 & 0b1 << 17;
        flags |= this.passFlags.renderNodeVals    << 18 & 0b1 << 18;
        return flags;
    }

    this.calculateStepSize = function() {
        var falloffFrames = 3;
        if (this.passFlags.cheapMove && this.globalPassInfo.framesSinceMove < falloffFrames) {
            var stepMaxScale = 3;
            // linearly interpolate between max and 1 scales
            return this.globalPassInfo.stepSize * (1 + (stepMaxScale - 1) * (1 - this.globalPassInfo.framesSinceMove/falloffFrames))
        }
        return this.globalPassInfo.stepSize;
    }
    this.getStepSize = function() {
        return this.globalPassInfo.stepSize;
    }
    this.setStepSize = function(step) {
        this.globalPassInfo.stepSize = step;
        this.globalPassInfo.framesSinceMove = 0;
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
            ], "ray1"),
            webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: "unfilterable-float",
                        viewDimension: "2d",
                        multiSampled: "false"
                    }
                }
            ], "ray2"),
        ];
        
        var computeRayMarchBindGroupLayouts = [
            webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
            ], "computeRay0"),
            webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
            ], "computeRay1"),
            webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: "unfilterable-float",
                        viewDimension: "2d",
                        multiSampled: "false"
                    }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    texture: {
                        sampleType: "unfilterable-float",
                        viewDimension: "2d",
                        multiSampled: "false"
                    }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: "write-only",
                        format: "rg32float",
                        viewDimension: "2d"
                    }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: "write-only",
                        format: "bgra8unorm",
                        viewDimension: "2d"
                    }
                }
            ], "computeRay2")
        ]

        // create all the global buffers and bind groups common to all
        constsBuffer = webGPU.makeBuffer(256, "u cs cd", "ray consts", true);
        new Float32Array(constsBuffer.getMappedRange()).set([5]);
        constsBuffer.unmap();

        // create code
        var rayMarchCode = await webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/rayMarch.wgsl");
        
        this.rayMarchPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {
                vertexLayout: webGPU.vertexLayouts.justPosition, 
                colorAttachmentFormats: ["bgra8unorm", "rg32float"],
                topology: "triangle-list", 
                indexed: true
            },
            rayMarchBindGroupLayouts,
            {str: rayMarchCode, formatObj: {}},
            "ray march pass (vert-frag)"
        );

        var depthPassCode = await webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/depthPass.wgsl");
        this.depthRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER,
            {
                vertexLayout: webGPU.vertexLayouts.justPosition, 
                colorAttachmentFormats: ["r32float"],
                topology: "triangle-list", 
                indexed: true,
            },
            [webGPU.bindGroupLayouts.render0],
            {str: depthPassCode, formatObj: {}},
            "depth pass"
        );
            
        var computeRayMarchCode = await webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/rayMarchCompute.wgsl");
        this.computeRayMarchPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.COMPUTE,
            {},
            computeRayMarchBindGroupLayouts,
            {str: computeRayMarchCode, formatObj: {WGSizeX: this.WGSize.x, WGSizeY: this.WGSize.y, WGVol: this.WGSize.x * this.WGSize.y}},
            "ray march pass (compute)"
        )

    };

    this.createStructuredDataRenderable = async function(dataObj) {
        var renderable = new Renderable(RenderableTypes.DATA, RenderableRenderModes.NONE);
        var renderData = renderable.renderData;
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

            return renderable;
    }

    this.createUnstructuredDataRenderable = async function(dataObj) {
        var renderable = new Renderable(RenderableTypes.UNSTRUCTURED_DATA, RenderableRenderModes.NONE);
        var renderData = renderable.renderData;

        var usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
        // console.log(dataObj.data.values.byteLength, dataObj.data.values);
        renderData.buffers.values = webGPU.createFilledBuffer("f32", new Float32Array(dataObj.data.values), usage);
        renderData.buffers.positions = webGPU.createFilledBuffer("f32", dataObj.data.positions, usage);
        renderData.buffers.cellConnectivity = webGPU.createFilledBuffer("u32", dataObj.data.cellConnectivity, usage);
        renderData.buffers.cellOffsets = webGPU.createFilledBuffer("u32", dataObj.data.cellOffsets, usage);
        // only handle tetrahedra for now
        // renderData.buffers.cellTypes = webGPU.createFilledBuffer("u32", dataObj.data.cellTypes, usage);
        // write the tree buffer
        if (dataObj.resolutionMode == ResolutionModes.FULL) {
            renderData.buffers.treeNodes = webGPU.createFilledBuffer("u8", new Uint8Array(dataObj.data.treeNodes), usage);
            renderData.buffers.cornerValues = webGPU.createFilledBuffer("f32", dataObj.data.cornerValues, usage);
            renderData.buffers.treeCells = webGPU.createFilledBuffer("u32", dataObj.data.treeCells, usage);
        } else if (dataObj.resolutionMode == ResolutionModes.DYNAMIC) {
            renderData.buffers.treeNodes = webGPU.createFilledBuffer("u8", new Uint8Array(dataObj.data.dynamicTreeNodes), usage);
            renderData.buffers.cornerValues = webGPU.createFilledBuffer("f32", dataObj.data.dynamicCornerValues, usage);
            // TEMP
            renderData.buffers.treeCells = webGPU.createFilledBuffer("u32", dataObj.data.treeCells, usage);
        }
        


        //renderData.buffers.passInfo = webGPU.makeBuffer(256, "s cs cd", "ray pass info");

        return renderable;
    }

    this.createDataMeshRenderables = function(dataObj, dataRenderable) {
        if (dataObj.dataFormat == DataFormats.STRUCTURED) {
            var faceRenderMode = RenderableRenderModes.DATA_RAY_VOLUME;
        } else if (dataObj.dataFormat == DataFormats.UNSTRUCTURED) {
            var faceRenderMode = RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME;
        } else {
            return;
        }
        
        // create the mesh information renderable(s)
        // get the bounding points first
        var points = dataObj.getBoundaryPoints();

        // check if points were generated properly
        if (!points || points.length != 8 * 3) return;

        var faceIndices = [
            [2, 1, 0, 1, 2, 3],
            [4, 5, 6, 7, 6, 5],
            [1, 3, 5, 7, 5, 3],
            [4, 2, 0, 2, 4, 6],
            [0, 1, 4, 5, 4, 1],
            [6, 3, 2, 3, 6, 7]
        ]

        var meshRenderables = [];
        for (let i = 0; i < faceIndices.length; i++) {
            var faceRenderable = webGPU.meshRenderableFromArrays(
                points,
                new Float32Array(points.length * 3), 
                new Uint32Array(faceIndices[i]),
                faceRenderMode,
                faceRenderMode == RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME
            );
            faceRenderable.serialisedMaterials = webGPU.serialiseMaterials(this.materials.frontMaterial, this.materials.backMaterial);
            // calculate the midpoint
            var midPoint = [0, 0, 0];
            for (let j = 0; j < faceIndices.length; j++) {
                midPoint[0] += points[3*faceIndices[i][j] + 0];
                midPoint[1] += points[3*faceIndices[i][j] + 1];
                midPoint[2] += points[3*faceIndices[i][j] + 2];
            }
            midPoint[0] /= faceIndices.length;
            midPoint[1] /= faceIndices.length;
            midPoint[2] /= faceIndices.length;

            faceRenderable.objectSpaceMidPoint = midPoint;
            faceRenderable.depthSort = true;

            faceRenderable.passData.threshold = dataObj.threshold;
            faceRenderable.passData.limits = dataObj.limits;
            faceRenderable.passData.dataSize = dataObj.getDataSize();
            faceRenderable.passData.dMatInv = dataObj.getdMatInv();

            // console.log(faceRenderable.passData.dMatInv)

            // add the shared data
            if (faceRenderMode == RenderableRenderModes.DATA_RAY_VOLUME) {
                // structured
                faceRenderable.sharedData.textures.data = dataRenderable.renderData.textures.data;
                faceRenderable.sharedData.buffers.passInfo = dataRenderable.renderData.buffers.passInfo;

                faceRenderable.renderData.bindGroups.rayMarch0 = webGPU.generateBG(
                    this.rayMarchPassDescriptor.bindGroupLayouts[0],
                    [constsBuffer, faceRenderable.renderData.buffers.objectInfo],
                );
                faceRenderable.renderData.bindGroups.rayMarch1 =  webGPU.generateBG(
                    this.rayMarchPassDescriptor.bindGroupLayouts[1],
                    [faceRenderable.sharedData.buffers.passInfo, faceRenderable.sharedData.textures.data.createView()],
                );
            } else {
                // unstructured
                faceRenderable.sharedData.buffers.values = dataRenderable.renderData.buffers.values;
                faceRenderable.sharedData.buffers.positions = dataRenderable.renderData.buffers.positions;
                faceRenderable.sharedData.buffers.cellConnectivity = dataRenderable.renderData.buffers.cellConnectivity;
                faceRenderable.sharedData.buffers.cellOffsets = dataRenderable.renderData.buffers.cellOffsets;                
                faceRenderable.sharedData.buffers.treeNodes = dataRenderable.renderData.buffers.treeNodes;
                faceRenderable.sharedData.buffers.treeCells = dataRenderable.renderData.buffers.treeCells;
                faceRenderable.sharedData.buffers.cornerValues = dataRenderable.renderData.buffers.cornerValues;

                // setup buffers for compute ray march pass
                faceRenderable.renderData.buffers.consts = webGPU.makeBuffer(256, "s cs cd", "face mesh consts");
                faceRenderable.renderData.buffers.objectInfoStorage = webGPU.makeBuffer(256, "s cs cd", "object info buffer s");
                faceRenderable.sharedData.buffers.passInfo = dataRenderable.renderData.buffers.passInfo;

                faceRenderable.renderData.buffers.combinedPassInfo = webGPU.makeBuffer(512, "s cs cd", "combined ray march pass info");

                
                faceRenderable.renderData.bindGroups.depth0 = webGPU.generateBG(
                    this.depthRenderPassDescriptor.bindGroupLayouts[0],
                    [
                        constsBuffer, 
                        faceRenderable.renderData.buffers.objectInfo
                    ]
                );
                
                faceRenderable.renderData.bindGroups.compute0 = webGPU.generateBG(
                    this.computeRayMarchPassDescriptor.bindGroupLayouts[0],
                    [
                        faceRenderable.renderData.buffers.combinedPassInfo, 
                    ],
                );

                faceRenderable.renderData.bindGroups.compute1 = webGPU.generateBG(
                    this.computeRayMarchPassDescriptor.bindGroupLayouts[1],
                    [
                        faceRenderable.sharedData.buffers.treeNodes,
                        faceRenderable.sharedData.buffers.treeCells,
                        faceRenderable.sharedData.buffers.positions,
                        faceRenderable.sharedData.buffers.cellConnectivity,
                        faceRenderable.sharedData.buffers.cellOffsets,
                        faceRenderable.sharedData.buffers.values,
                        faceRenderable.sharedData.buffers.cornerValues,
                    ]
                );
            }


            // webGPU.readBuffer(faceRenderable.sharedData.buffers.tree, 0, 256).then(buff => console.log(new Uint32Array(buff)));
            meshRenderables.push(faceRenderable);
        }

        return meshRenderables;
    }

    // setup the data sceneObj with the correct renderables 
    // one that contains the data
    // six face meshes that are actually rendered
    this.setupRayMarch = async function(dataObj) {
        // create the renderable that contains the data
        if (dataObj.dataFormat == DataFormats.STRUCTURED) {
            var dataRenderable = await this.createStructuredDataRenderable(dataObj);
        } else if (dataObj.dataFormat == DataFormats.UNSTRUCTURED) {
            var dataRenderable = await this.createUnstructuredDataRenderable(dataObj);
        }

        // webGPU.readBuffer(dataRenderable.renderData.buffers.tree, 0, 256)
        //     .then(buff => console.log(new Uint32Array(buff)));


        // add the data renderable
        dataObj.renderables.push(dataRenderable);
        // create and add the mesh renderables
        dataObj.renderables.push(...this.createDataMeshRenderables(dataObj, dataRenderable));
        
        console.log("setup data for ray marching");
    }


    //updates the renderables
    this.updateDynamicDataObj = function(dataObj) {
        for (let renderable of dataObj.renderables) {
            if (renderable.type == RenderableTypes.UNSTRUCTURED_DATA) {
                // update the dynamic tree buffer
                // console.log("written");
                webGPU.writeDataToBuffer(renderable.renderData.buffers.treeNodes, [new Uint8Array(dataObj.data.dynamicTreeNodes)]);
                webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValues, [dataObj.data.dynamicCornerValues]);
            }
        }
    }


    this.beginFrame = function(ctx, resized, cameraMoved, thresholdChanged) {
        if (cameraMoved || thresholdChanged) {
            this.globalPassInfo.framesSinceMove = 0;
        }
        // check if the size of the canvas is the same as what is was previously
        if (resized) {
            this.depthTexture?.destroy();
            // create the texture that the mesh depth will be drawn onto
            this.depthTexture = device.createTexture({
                label: "depth texture",
                size: {
                    width: ctx.canvas.width,
                    height: ctx.canvas.height,
                    depthOrArrayLayers: 1
                },
                dimension: "2d",
                format: "r32float",
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            })

            this.offsetOptimisationTextureOld?.destroy();
            // create texture for offset optimisation
            this.offsetOptimisationTextureOld = device.createTexture({
                label: "optimisation texture current best",
                size: {
                    width: ctx.canvas.width,
                    height: ctx.canvas.height,
                    depthOrArrayLayers: 1
                },
                dimension: "2d",
                format: "rg32float",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            })

            this.offsetOptimisationTextureNew?.destroy();
            // create texture for offset optimisation
            this.offsetOptimisationTextureNew = device.createTexture({
                label: "optimisation texture new best",
                size: {
                    width: ctx.canvas.width,
                    height: ctx.canvas.height,
                    depthOrArrayLayers: 1
                },
                dimension: "2d",
                format: "rg32float",
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
            })
        }
    }

    this.endFrame = function(ctx) {
        this.globalPassInfo.framesSinceMove++;
        // copy the new found or carried across offsets to be used in the next pass
        webGPU.copyTextureToTexture(
            this.offsetOptimisationTextureNew,
            this.offsetOptimisationTextureOld,
            {
                width: ctx.canvas.width,
                height: ctx.canvas.height,
                depthOrArrayLayers: 1
            }
        );

        
    }

    // do ray marching on the data
    this.march = async function(renderable, camera, outputColourAttachment, outputDepthAttachment, box, canvas) {
        var commandEncoder = await device.createCommandEncoder();
        
        var rayMarchRenderPass = {
            ...this.rayMarchPassDescriptor,
            renderDescriptor: {
                colorAttachments: [
                    outputColourAttachment,
                    {
                        clearValue: {r: 0, g: 0, b: 0, a: 0},
                        loadOp: "load",
                        storeOp: "store",
                        view: this.offsetOptimisationTextureNew.createView()
                    }
                ],
                depthStencilAttachment: outputDepthAttachment
            },
            bindGroups: {
                0: renderable.renderData.bindGroups.rayMarch0,
                1: renderable.renderData.bindGroups.rayMarch1,
                2: webGPU.generateBG(
                    this.rayMarchPassDescriptor.bindGroupLayouts[2],
                    [this.offsetOptimisationTextureOld.createView()]
                ),
            },
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
            renderable.sharedData.buffers.passInfo, 
            [
                new Uint32Array([
                    this.getPassFlagsUint(),
                    this.globalPassInfo.framesSinceMove,
                ]), 
                new Float32Array([
                    renderable.passData.threshold, 
                    renderable.passData.limits[0],
                    renderable.passData.limits[1],
                    0, 0, 0,
                    ...renderable.passData.dataSize, 0,
                    this.calculateStepSize(),
                    this.globalPassInfo.maxRayLength,
                    0, 0, // padding
                    ...renderable.passData.dMatInv,
                ])
            ]
        );

        device.queue.submit([commandEncoder.finish()]);
    }

    this.marchUnstructured = async function(renderable, camera, outputColourAttachment, outputDepthAttachment, box, ctx) {
        var commandEncoder = await device.createCommandEncoder();

        var attachments = {
            colorAttachments: [{
                clearValue: {r: 0, g: 0, b: 0, a: 0},
                loadOp: "clear",
                storeOp: "store",
                view: this.depthTexture.createView()
            }],
            depthStencilAttachment: outputDepthAttachment
        }

        // draw the mesh into the texture
        var depthPass = {
            ...this.depthRenderPassDescriptor,
            renderDescriptor: attachments,
            bindGroups: {
                0: renderable.renderData.bindGroups.depth0
            },
            box: box,
            boundingBox: ctx.canvas.getBoundingClientRect(),
            vertexBuffers: [renderable.renderData.buffers.vertex],
            indexBuffer: renderable.renderData.buffers.index,
            indicesCount: renderable.indexCount,
        }

        // encode the depth pass
        webGPU.encodeGPUPass(commandEncoder, depthPass);


        // do a full ray march pass
        var WGs = [
            Math.ceil(ctx.canvas.width/this.WGSize.x), 
            Math.ceil(ctx.canvas.height/this.WGSize.y)
        ];
        
        var rayMarchComputePass = {
            ...this.computeRayMarchPassDescriptor,
            bindGroups: {
                0: renderable.renderData.bindGroups.compute0,
                1: renderable.renderData.bindGroups.compute1,
                2: webGPU.generateBG(
                    this.computeRayMarchPassDescriptor.bindGroupLayouts[2],
                    [
                        this.depthTexture.createView(),
                        this.offsetOptimisationTextureOld.createView(),
                        this.offsetOptimisationTextureNew.createView(),
                        outputColourAttachment.view
                    ]
                ),
            },
            workGroups: WGs
        }

        // encode the render pass
        webGPU.encodeGPUPass(commandEncoder, rayMarchComputePass);

        // write buffers
        // global info buffer for depth pass
        webGPU.writeDataToBuffer(
            constsBuffer,
            [camera.serialise(), new Uint32Array([performance.now()])]
        );
        // object info for depth pass
        webGPU.writeDataToBuffer(
            renderable.renderData.buffers.objectInfo, 
            [new Float32Array(renderable.transform), renderable.serialisedMaterials]
        );
        

        // global info buffer for compute
        webGPU.writeDataToBuffer(
            renderable.renderData.buffers.combinedPassInfo,
            [
                // global info
                camera.serialise(),
                new Uint32Array([
                    performance.now(),
                    0, 0, 0
                ]),
                
                // object info
                new Float32Array(renderable.transform), 
                renderable.serialisedMaterials,

                // pass info
                new Uint32Array([
                    this.getPassFlagsUint(),
                    this.globalPassInfo.framesSinceMove,
                ]), 
                new Float32Array([
                    renderable.passData.threshold, 
                    renderable.passData.limits[0],
                    renderable.passData.limits[1],
                    0, 0, 0,
                    ...renderable.passData.dataSize, 0,
                    this.calculateStepSize(),
                    this.globalPassInfo.maxRayLength,
                    0, 0, // padding
                    ...renderable.passData.dMatInv,
                ]),
            ]
        )

        device.queue.submit([commandEncoder.finish()]);
    }
}