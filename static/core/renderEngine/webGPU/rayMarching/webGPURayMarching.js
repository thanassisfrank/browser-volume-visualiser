// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import {mat4} from "https://cdn.skypack.dev/gl-matrix";
import { DataFormats, ResolutionModes } from "../../../data/data.js";
import { clampBox } from "../../../utils.js";
import { DataSrcTypes, DataSrcUints, GPUResourceTypes, Renderable, RenderableRenderModes, RenderableTypes } from "../../renderEngine.js";

export const DataSrcUses = {
    NONE: 0,
    ISO_SURFACE: 1,
    SURFACE_COL: 2,
}

export const ColourScales = {
    B_W: 0,
    BL_W_R: 1,
    BL_C_G_Y_R: 2
}

export function WebGPURayMarchingEngine(webGPUBase) {
    var webGPU = webGPUBase;
    var device = webGPU.device;

    var constsBuffer;
    this.depthTexture;
    this.offsetOptimisationTextureOld;
    this.offsetOptimisationTextureNew;

    this.rayMarchPassDescriptor;
    this.depthRenderPassDescriptor;
    this.computeRayMarchPassDescriptor;

    // required: x*y*z <= 256 
    // optimal seems to be 8x8
    // > 8x8 corresponds to 64 threads which is the size of 1 or 2 waves on Nvidia or AMD hardware
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
        useBestDepth: true,
        showTestedCells: false,

        // not sent to gpu
        cheapMove: false,
    };

    this.globalPassInfo = {
        stepSize: 2,
        maxRayLength: 2000,
        framesSinceMove: 0,
        colourScale: ColourScales.B_W
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
        flags |= this.passFlags.useBestDepth      << 19 & 0b1 << 19;
        flags |= this.passFlags.showTestedCells   << 20 & 0b1 << 20;
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

    this.setColourScale = function(colourScale) {
        this.globalPassInfo.colourScale = colourScale;
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
                },
                // {
                //     visibility: GPUShaderStage.FRAGMENT,
                //     texture: {
                //         sampleType: "unfilterable-float",
                //         viewDimension: "2d",
                //         multiSampled: "false"
                //     }
                // }
            ], "ray2"),
        ];
        
        var computeRayMarchBindGroupLayouts = [
            webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {type: "read-only-storage"}
                },
            ], "Compute ray-march constants"),
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
            ], "Compute ray march geometry"),
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
            ], "Compute ray-march data"),
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
            ], "Compute ray-march images")
        ]

        // create all the global buffers and bind groups common to all
        constsBuffer = webGPU.makeBuffer(256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "ray consts", true); //"u cs cd"
        new Float32Array(constsBuffer.getMappedRange()).set([5]);
        constsBuffer.unmap();

        var t0 = performance.now();

        // create code
        var rayMarchPromise = webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/rayMarch.wgsl")
            .then((rayMarchCode) => {
                return webGPU.createPassDescriptor(
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
            });

        var depthPassPromise = webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/depthPass.wgsl")
            .then((depthPassCode) => {
                return webGPU.createPassDescriptor(
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
            })
        
            
        var computeRayMarchPromise = webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/rayMarchCompute.wgsl")
            .then((computeRayMarchCode) => {
                return webGPU.createPassDescriptor(
                    webGPU.PassTypes.COMPUTE,
                    {},
                    computeRayMarchBindGroupLayouts,
                    {str: computeRayMarchCode, formatObj: {WGSizeX: this.WGSize.x, WGSizeY: this.WGSize.y, WGVol: this.WGSize.x * this.WGSize.y}},
                    "ray march pass (compute)"
                );
            });
        
        var passDescriptors = await Promise.all([rayMarchPromise, depthPassPromise, computeRayMarchPromise]);
        this.rayMarchPassDescriptor = passDescriptors[0];
        this.depthRenderPassDescriptor = passDescriptors[1];
        this.computeRayMarchPassDescriptor = passDescriptors[2];

        console.log(performance.now() - t0, "ms for ray pipeline creation");

    };

    this.createStructuredDataRenderable = async function(dataObj) {
        var renderable = new Renderable(RenderableTypes.DATA, RenderableRenderModes.NONE);
        var renderData = renderable.renderData;
        var datasetSize = dataObj.getDataSize();
        // copy the data to a texture
        // const textureSize = {
        //     width: datasetSize[0],
        //     height: datasetSize[1],
        //     depthOrArrayLayers: datasetSize[2]
        // }

        renderData.textures.valuesA = webGPU.makeTexture({
            label: "empty values A texture",
            size: {},
            dimension: "3d",
            format: "r32float",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });

        renderData.textures.valuesB = webGPU.makeTexture({
            label: "empty values B texture",
            size: {},
            dimension: "3d",
            format: "r32float",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        })

        // renderData.textures.data = webGPU.makeTexture({
        //     label: "whole data texture",
        //     size: textureSize,
        //     dimension: "3d",
        //     format: "r32float",
        //     usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        // });

        // await webGPU.fillTexture(renderData.textures.data, textureSize, 4, Float32Array.from(dataObj.getValues(0)).buffer);

        // create sampler for data texture
        // doesn't work for float32 data
        renderData.samplers.data = device.createSampler({
            label: "ray data sampler",
            magFilter: "linear",
            minFilter: "linear"
        });

        renderData.buffers.passInfo = webGPU.makeBuffer(512, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "ray pass info");

        return renderable;
    }

    this.createUnstructuredDataRenderable = async function(dataObj) {
        var renderable = new Renderable(RenderableTypes.UNSTRUCTURED_DATA, RenderableRenderModes.NONE);
        var renderData = renderable.renderData;

        var usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
        // console.log(dataObj.data.values.byteLength, dataObj.data.values);
        renderData.buffers.valuesA = webGPU.makeBuffer(0, usage, "empty data vert A values");
        renderData.buffers.valuesB = webGPU.makeBuffer(0, usage, "empty data vert B values");

        renderData.buffers.cornerValuesA = webGPU.makeBuffer(0, usage, "empty corner values A");
        renderData.buffers.cornerValuesB = webGPU.makeBuffer(0, usage, "empty corner values B");

        renderable.passData.isoSurfaceSrc = {type: DataSrcTypes.NONE, name: "", limits: [0, 1]};
        renderable.passData.isoSurfaceSrcUint = DataSrcUints.NONE;
        renderable.passData.surfaceColSrc = {type: DataSrcTypes.NONE, name: "", limits: [0, 1]};;
        renderable.passData.surfaceColSrcUint = DataSrcUints.NONE;

        renderData.buffers.positions = webGPU.createFilledBuffer("f32", dataObj.data.positions, usage, "data vert positions");
        renderData.buffers.cellConnectivity = webGPU.createFilledBuffer("u32", dataObj.data.cellConnectivity, usage, "data cell connectivity");
        renderData.buffers.cellOffsets = webGPU.createFilledBuffer("u32", dataObj.data.cellOffsets, usage, "data cell offsets");
        // only handle tetrahedra for now
        // renderData.buffers.cellTypes = webGPU.createFilledBuffer("u32", dataObj.data.cellTypes, usage);
        // write the tree buffer
        if (dataObj.resolutionMode == ResolutionModes.FULL) {
            renderData.buffers.treeNodes = webGPU.createFilledBuffer("u8", new Uint8Array(dataObj.data.treeNodes), usage, "data tree nodes");
            renderData.buffers.treeCells = webGPU.createFilledBuffer("u32", dataObj.data.treeCells, usage, "data tree cells");
        } else if (dataObj.resolutionMode == ResolutionModes.DYNAMIC) {
            renderData.buffers.treeNodes = webGPU.createFilledBuffer("u8", new Uint8Array(dataObj.data.dynamicTreeNodes), usage, "data dynamic tree nodes");
            // TEMP
            renderData.buffers.treeCells = webGPU.createFilledBuffer("u32", dataObj.data.treeCells, usage, "data dynamic tree cells");
        } else {
            throw "Unstructured dataset unsupported resolution mode '" + dataObj.resolutionMode?.toString() + "'";
        }
        
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

            // faceRenderable.passData.threshold = dataObj.threshold;
            // faceRenderable.passData.limits = dataObj.getLimits(0);
            // faceRenderable.passData.dataSize = dataObj.getDataSize();
            faceRenderable.passData.dataBoxMin = dataObj.extentBox.min;
            faceRenderable.passData.dataBoxMax = dataObj.extentBox.max;
            faceRenderable.passData.dMatInv = dataObj.getdMatInv();

            faceRenderable.passData.isoSurfaceSrcUint = DataSrcUints.NONE;
            faceRenderable.passData.surfaceColSrcUint = DataSrcUints.NONE;

            // console.log(faceRenderable.passData.dMatInv)

            // add the shared data
            if (faceRenderMode == RenderableRenderModes.DATA_RAY_VOLUME) {
                // structured
                // faceRenderable.sharedData.textures.data = dataRenderable.renderData.textures.data;
                faceRenderable.sharedData.buffers.passInfo = dataRenderable.renderData.buffers.passInfo;

                faceRenderable.renderData.bindGroups.rayMarch0 = webGPU.generateBG(
                    this.rayMarchPassDescriptor.bindGroupLayouts[0],
                    [constsBuffer, faceRenderable.renderData.buffers.objectInfo],
                );
                faceRenderable.renderData.bindGroups.rayMarch1 =  webGPU.generateBG(
                    this.rayMarchPassDescriptor.bindGroupLayouts[1],
                    [
                        faceRenderable.sharedData.buffers.passInfo, 
                        dataRenderable.renderData.textures.valuesA.createView(),
                        dataRenderable.renderData.textures.valuesB.createView(),
                    ],
                );
            } else {
                // unstructured
                // setup buffers for compute ray march pass
                faceRenderable.renderData.buffers.consts = webGPU.makeBuffer(256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "face mesh consts"); //"s cs cd"
                faceRenderable.renderData.buffers.objectInfoStorage = webGPU.makeBuffer(256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "object info buffer s");
                faceRenderable.sharedData.buffers.passInfo = dataRenderable.renderData.buffers.passInfo;

                faceRenderable.renderData.buffers.combinedPassInfo = webGPU.makeBuffer(1024, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "combined ray march pass info");
                
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
                        dataRenderable.renderData.buffers.treeNodes,
                        dataRenderable.renderData.buffers.treeCells,
                        dataRenderable.renderData.buffers.positions,
                        dataRenderable.renderData.buffers.cellConnectivity,
                        dataRenderable.renderData.buffers.cellOffsets,
                        
                    ]
                );
                faceRenderable.renderData.bindGroups.compute2 = webGPU.generateBG(
                    this.computeRayMarchPassDescriptor.bindGroupLayouts[2],
                    [
                        dataRenderable.renderData.buffers.valuesA,
                        dataRenderable.renderData.buffers.valuesB,
                        dataRenderable.renderData.buffers.cornerValuesA,
                        dataRenderable.renderData.buffers.cornerValuesB,
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
        } else {
            throw "Unsupported dataset dataFormat '" + dataObj.dataFormat + "'";
        }

        dataRenderable.passData.valuesA = {
            name: "None",
            limits: [0, 1]
        }

        dataRenderable.passData.valuesB = {
            name: "None",
            limits: [0, 1]
        }

        // webGPU.readBuffer(dataRenderable.renderData.buffers.tree, 0, 256)
        //     .then(buff => console.log(new Uint32Array(buff)));


        // add the data renderable
        dataObj.renderables.push(dataRenderable);
        // create and add the mesh renderables
        dataObj.renderables.push(...this.createDataMeshRenderables(dataObj, dataRenderable));
        
        console.log("setup data for ray marching");
    }



    this.getDataSrcUint = function(type, name) {        
        // catch the simple cases
        switch (type) {
            case DataSrcTypes.AXIS:
                if (name == "x") return DataSrcUints.AXIS_X;
                if (name == "y") return DataSrcUints.AXIS_Y;
                if (name == "z") return DataSrcUints.AXIS_Z;
                break;
            case DataSrcTypes.NONE:
                return DataSrcUints.NONE;
        }
        return null;
    }

    this.writeDataIntoValuesStorageBuffer = function(data, renderData, valuesBufferName) {
        var created = false;
        if (renderData.buffers[valuesBufferName].size < data.byteLength) {
            console.log("create " + valuesBufferName)
            // create new buffer in this slot
            webGPU.deleteBuffer(renderData.buffers[valuesBufferName]);
            renderData.buffers[valuesBufferName] = webGPU.createFilledBuffer(
                "f32",
                new Float32Array(data),
                GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
                valuesBufferName
            );
            created = true;
        } else {
            console.log("write " + valuesBufferName);
            webGPU.writeDataToBuffer(renderData.buffers[valuesBufferName], [new Float32Array(data)])
        }
        return created
    }

    this.writeDataIntoValuesTexture = function(data, dimensions, renderData, valuesBufferName) {
        var created = false;
        console.log(renderData.textures[valuesBufferName]);

        const textureSize = {
            width: dimensions[0],
            height: dimensions[1],
            depthOrArrayLayers: dimensions[2]
        }

        if (
            renderData.textures[valuesBufferName].width != textureSize.width || 
            renderData.textures[valuesBufferName].height != textureSize.height ||
            renderData.textures[valuesBufferName].depthOrArrayLayers != textureSize.depthOrArrayLayers
        ) {
            webGPU.deleteTexture(renderData.textures[valuesBufferName]);

            renderData.textures[valuesBufferName] = webGPU.makeTexture({
                label: valuesBufferName,
                size: textureSize,
                dimension: "3d",
                format: "r32float",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });
            created = true;
        } else {
            console.log("write" + valuesBufferName);
        }

        webGPU.fillTexture(renderData.textures[valuesBufferName], textureSize, 4, Float32Array.from(data).buffer);
        return created;
    }

    // returns the new uint and if buffer(s) have been re-created
    this.loadDataIntoValues = function(dataObj, dataSlotNum, dimensions, dataSrc, dataSrcUse, passData, renderData, resourceType, writeCornerVals) {
        // check if its already loaded
        if (dataSrc.name == passData.valuesA.name) return {uint: DataSrcUints.VALUE_A, created: false};
        if (dataSrc.name == passData.valuesB.name) return {uint: DataSrcUints.VALUE_B, created: false};

        // check to see what other data src is referencing
        if (dataSrcUse == DataSrcUses.ISO_SURFACE) {
            console.log("writing iso")
            var otherUint = passData.surfaceColSrcUint;
        } else {
            console.log("writing surf col")
            var otherUint = passData.isoSurfaceSrcUint;
        }
        
        if (otherUint != DataSrcUints.VALUE_A) {
            // write into values a
            var newUint = DataSrcUints.VALUE_A;
            var valuesSlotName = "valuesA";
            var cornerValuesSlotname = "cornerValuesA"
        } else {
            // write into values b
            var newUint = DataSrcUints.VALUE_B;
            var valuesSlotName = "valuesB";
            var cornerValuesSlotname = "cornerValuesB"
        }

        var created = false;
        if (resourceType == GPUResourceTypes.BUFFER) 
            created |= this.writeDataIntoValuesStorageBuffer(dataObj.getValues(dataSlotNum), renderData, valuesSlotName);
        if (resourceType == GPUResourceTypes.TEXTURE) 
            created |= this.writeDataIntoValuesTexture(dataObj.getValues(dataSlotNum), dimensions, renderData, valuesSlotName);
        // write corner values if needed
        if (writeCornerVals)
            created |= this.writeDataIntoValuesStorageBuffer(dataObj.getDynamicCornerValues(dataSlotNum), renderData, cornerValuesSlotname);
        
        passData[valuesSlotName].name = dataSrc.name;
        passData[valuesSlotName].limits = dataSrc.limits;

        return {uint: newUint, created: created};
    }


    //updates the renderables for a data object
    this.updateDataObj = async function(dataObj) {
        // update the data renderable first 
        var dataRenderable;
        var valueBufferCreated;

        for (let renderable of dataObj.renderables) {
            
            if (renderable.type == RenderableTypes.UNSTRUCTURED_DATA || renderable.type == RenderableTypes.DATA) {
                dataRenderable = renderable
                var passData = dataRenderable.passData; 
                if (dataObj.isoSurfaceSrc.type != DataSrcTypes.DATA) {
                    passData.isoSurfaceSrcUint = this.getDataSrcUint(dataObj.isoSurfaceSrc.type, dataObj.isoSurfaceSrc.name);
                } else {
                    // deal with data
                    // var slotNum = await dataObj.loadDataArray(dataObj.isoSurfaceSrc.name)
                    var isoLoadResult = this.loadDataIntoValues(
                        dataObj,
                        dataObj.isoSurfaceSrc.slotNum, 
                        dataObj.getDataSize(),
                        dataObj.isoSurfaceSrc, 
                        DataSrcUses.ISO_SURFACE,
                        passData,
                        renderable.renderData,
                        renderable.type == RenderableTypes.UNSTRUCTURED_DATA ? GPUResourceTypes.BUFFER : GPUResourceTypes.TEXTURE,
                        dataObj.resolutionMode == ResolutionModes.DYNAMIC
                    );
                    passData.isoSurfaceSrcUint = isoLoadResult.uint;
                    var valueBufferCreatedIso = isoLoadResult.created;
                }

                if (dataObj.surfaceColSrc.type != DataSrcTypes.DATA) {
                    passData.surfaceColSrcUint = this.getDataSrcUint(dataObj.surfaceColSrc.type, dataObj.surfaceColSrc.name);
                } else {
                    // deal with data
                    // var slotNum = await dataObj.loadDataArray(dataObj.surfaceColSrc.name);
                    var colLoadResult = this.loadDataIntoValues(
                        dataObj,
                        dataObj.surfaceColSrc.slotNum, 
                        dataObj.getDataSize(),
                        dataObj.surfaceColSrc, 
                        DataSrcUses.SURFACE_COL,
                        passData,
                        renderable.renderData,
                        renderable.type == RenderableTypes.UNSTRUCTURED_DATA ? GPUResourceTypes.BUFFER : GPUResourceTypes.TEXTURE,
                        dataObj.resolutionMode == ResolutionModes.DYNAMIC
                    );
                    passData.surfaceColSrcUint = colLoadResult.uint;
                    var valueBufferCreatedCol = colLoadResult.created;
                }

                // true if a buffer was created for either
                valueBufferCreated = valueBufferCreatedIso || valueBufferCreatedCol;

                // update unstructured data renderables
                // update the dynamic tree nodes buffer
                if (dataObj.resolutionMode == ResolutionModes.DYNAMIC) {
                    webGPU.writeDataToBuffer(renderable.renderData.buffers.treeNodes, [new Uint8Array(dataObj.data.dynamicTreeNodes)]);
                    if (dataRenderable.passData.isoSurfaceSrcUint == DataSrcUints.VALUE_A) {
                        webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValuesA, [dataObj.getDynamicCornerValues(dataObj.isoSurfaceSrc.slotNum)]);
                    }
                    if (dataRenderable.passData.isoSurfaceSrcUint == DataSrcUints.VALUE_B) {
                        webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValuesB, [dataObj.getDynamicCornerValues(dataObj.isoSurfaceSrc.slotNum)]);
                    }
                    if (dataRenderable.passData.surfaceColSrcUint == DataSrcUints.VALUE_A) {
                        webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValuesA, [dataObj.getDynamicCornerValues(dataObj.surfaceColSrc.slotNum)]);
                    }
                    if (dataRenderable.passData.surfaceColSrcUint == DataSrcUints.VALUE_B) {
                        webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValuesB, [dataObj.getDynamicCornerValues(dataObj.surfaceColSrc.slotNum)]);
                    }
                }

            }
        }

        if (!dataRenderable) return;
        
        // update the face renderables
        for (let renderable of dataObj.renderables) {
            if (renderable.type != RenderableTypes.MESH) continue;
            if (valueBufferCreated) {
                if(dataRenderable.type == RenderableTypes.UNSTRUCTURED_DATA) {
                    // recreate bindgroup 2 from the compute pass
                    renderable.renderData.bindGroups.compute2 = webGPU.generateBG(
                        this.computeRayMarchPassDescriptor.bindGroupLayouts[2],
                        [
                            dataRenderable.renderData.buffers.valuesA,
                            dataRenderable.renderData.buffers.valuesB,
                            dataRenderable.renderData.buffers.cornerValuesA,
                            dataRenderable.renderData.buffers.cornerValuesB,
                        ]
                    );
                } else if (dataRenderable.type == RenderableTypes.DATA) {
                    renderable.renderData.bindGroups.rayMarch1 =  webGPU.generateBG(
                        this.rayMarchPassDescriptor.bindGroupLayouts[1],
                        [
                            renderable.sharedData.buffers.passInfo, 
                            dataRenderable.renderData.textures.valuesA.createView(),
                            dataRenderable.renderData.textures.valuesB.createView(),
                        ],
                    );
                }
            }
            // update the information about values A and values B
            renderable.passData.valuesA = dataRenderable.passData.valuesA;
            renderable.passData.valuesB = dataRenderable.passData.valuesB;

            renderable.passData.isoSurfaceSrcUint = dataRenderable.passData.isoSurfaceSrcUint;
            renderable.passData.surfaceColSrcUint = dataRenderable.passData.surfaceColSrcUint;
            
        }
    }


    this.beginFrame = function(ctx, resized, cameraMoved, thresholdChanged) {
        if (cameraMoved || thresholdChanged) {
            this.globalPassInfo.framesSinceMove = 0;
        }
        // check if the size of the canvas is the same as what is was previously
        if (resized) {
            webGPU.deleteTexture(this.depthTexture);
            // create the texture that the mesh depth will be drawn onto
            this.depthTexture = webGPU.makeTexture({
                label: "march depth texture",
                size: {
                    width: ctx.canvas.width,
                    height: ctx.canvas.height,
                    depthOrArrayLayers: 1
                },
                dimension: "2d",
                format: "r32float",
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            })

            webGPU.deleteTexture(this.offsetOptimisationTextureOld);
            // create texture for offset optimisation
            this.offsetOptimisationTextureOld = webGPU.makeTexture({
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

            webGPU.deleteTexture(this.offsetOptimisationTextureNew);
            // create texture for offset optimisation
            this.offsetOptimisationTextureNew = webGPU.makeTexture({
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
                    renderable.passData.valuesA.limits[0],
                    renderable.passData.valuesA.limits[1],
                    renderable.passData.valuesB.limits[0],
                    renderable.passData.valuesB.limits[1],
                    0,
                    ...renderable.passData.dataBoxMin, 0,
                    ...renderable.passData.dataBoxMax, 0,
                    0, 0, 0, 0,
                    this.calculateStepSize(),
                    this.globalPassInfo.maxRayLength,
                    0, 0, // padding
                    ...renderable.passData.dMatInv,
                ]),
                new Uint32Array([
                    renderable.passData.isoSurfaceSrcUint,
                    renderable.passData.surfaceColSrcUint,
                    this.globalPassInfo.colourScale,
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
                2: renderable.renderData.bindGroups.compute2,
                3: webGPU.generateBG(
                    this.computeRayMarchPassDescriptor.bindGroupLayouts[3],
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
                    renderable.passData.valuesA.limits[0],
                    renderable.passData.valuesA.limits[1],
                    renderable.passData.valuesB.limits[0],
                    renderable.passData.valuesB.limits[1],
                    0,
                    ...renderable.passData.dataBoxMin, 0,
                    ...renderable.passData.dataBoxMax, 0,
                    0, 0, 0, 0,
                    this.calculateStepSize(),
                    this.globalPassInfo.maxRayLength,
                    0, 0, // padding
                    ...renderable.passData.dMatInv,
                ]),
                new Uint32Array([
                    renderable.passData.isoSurfaceSrcUint,
                    renderable.passData.surfaceColSrcUint,
                    this.globalPassInfo.colourScale,
                ])
            ]
        )

        device.queue.submit([commandEncoder.finish()]);
    }
}