// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import {mat4} from "https://cdn.skypack.dev/gl-matrix";
import { DataFormats, ResolutionModes } from "../../../data/data.js";
import { boxesEqual, clampBox } from "../../../utils.js";
import { DataSrcTypes, DataSrcUints, GPUResourceTypes, Renderable, RenderableRenderModes, RenderableTypes } from "../../renderEngine.js";
import { BYTES_PER_ROW_ALIGN, GPUTexelByteLength, GPUTextureMapped } from "../webGPUBase.js";

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

    var constsBuffer;
    this.offsetOptimisationTextureOld;
    this.offsetOptimisationTextureNew;
    this.colorCopyDstTexture;

    this.rayMarchPassDescriptor;
    this.depthRenderPassDescriptor;
    this.computeRayMarchPassDescriptor;

    // required: x*y*z <= 256 
    // optimal seems to be 8x8
    // > 8x8 corresponds to 64 threads which is the size of 1 or 2 waves on Nvidia or AMD hardware
    this.WGSize = {x: 8, y: 8};


    // materials used as the defaults for the ray-marched iso-surface
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
        phong: true,                // shade the iso-surface using the phong model
        backStep: true,             // enable intersection estimation
        showNormals: false,         // indicate the normals on the iso-surface
        showVolume: true,           // render the accumulated transparent volume data
        fixedCamera: false,         // renders dataset from a fixed viewpoint (structured only)
        randStart: true,            // randomise the offset applied to each ray
        showSurface: true,          // render the iso-surface
        showRayDirs: false,         // render the direction vector of each pixel ray as an rgb value
        showRayLength: false,       // display the total length of every ray
        optimiseOffset: true,       // reduce the amount of randmoness in the offset over time
        showOffset: false,          // display the ray offsets
        showDeviceCoords: false,    // display the coordinates of each pixel as an rg value
        sampleNearest: false,       // sample the dataset without interpolation (unused)
        showCells: false,           // displays each cell on the dataset surface (structured only)
        showNodeVals: false,        // display the value stored in the pruned leaves on dataset surface
        showNodeLoc: false,         // display the index (location) of each node on the datset surface
        showNodeDepth: false,       // show the depth of the tree pruned leaf nodes on the dataset surface
        quadraticBackStep: false,   // estimate iso-surface intersection using
        renderNodeVals: false,      // use the node values for rendering
        useBestDepth: true,         // always display the current best surface depth when optimising
        showTestedCells: false,     // shows the amount of cells that have been checked for each ray 
        showSurfNodeDepth: false,   // shows the depth of the node on the iso-surface

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
        flags |= this.passFlags.showSurfNodeDepth << 21 & 0b1 << 21;
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
                        sampleType: "depth",
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
                    texture: {
                        sampleType: "float",
                        viewDimension: "2d",
                        multiSampled: "false"
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
                        vertexLayout: webGPU.vertexLayouts.position, 
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
                        vertexLayout: webGPU.vertexLayouts.position, 
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
        });

        renderData.buffers.passInfo = webGPU.makeBuffer(512, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "ray pass info");

        return renderable;
    }

    this.createUnstructuredDataRenderable = async function(dataObj) {
        var renderable = new Renderable(RenderableTypes.UNSTRUCTURED_DATA, RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME);
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

        renderable.passData.dataBoxMin = dataObj.extentBox.min;
        renderable.passData.dataBoxMax = dataObj.extentBox.max;
        renderable.passData.dMatInv = dataObj.getdMatInv();

        renderable.serialisedMaterials = webGPU.serialiseMaterials(this.materials.frontMaterial, this.materials.backMaterial);

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

        renderable.renderData.buffers.consts = webGPU.makeBuffer(256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "face mesh consts"); //"s cs cd"
        renderable.renderData.buffers.objectInfo = webGPU.makeBuffer(256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "object info buffer s");

        renderable.renderData.buffers.combinedPassInfo = webGPU.makeBuffer(1024, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "combined ray march pass info");
        
        
        renderable.renderData.bindGroups.compute0 = webGPU.generateBG(
            this.computeRayMarchPassDescriptor.bindGroupLayouts[0],
            [
                renderable.renderData.buffers.combinedPassInfo, 
            ],
        );

        renderable.renderData.bindGroups.compute1 = webGPU.generateBG(
            this.computeRayMarchPassDescriptor.bindGroupLayouts[1],
            [
                renderable.renderData.buffers.treeNodes,
                renderable.renderData.buffers.treeCells,
                renderable.renderData.buffers.positions,
                renderable.renderData.buffers.cellConnectivity,
                renderable.renderData.buffers.cellOffsets,
                
            ]
        );
        renderable.renderData.bindGroups.compute2 = webGPU.generateBG(
            this.computeRayMarchPassDescriptor.bindGroupLayouts[2],
            [
                renderable.renderData.buffers.valuesA,
                renderable.renderData.buffers.valuesB,
                renderable.renderData.buffers.cornerValuesA,
                renderable.renderData.buffers.cornerValuesB,
            ]
        );
        
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
            faceRenderable.passData.faceIndex = i;


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
            faceRenderable.highPriority = true;

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
            // create and add the mesh renderables
            dataObj.renderables.push(...this.createDataMeshRenderables(dataObj, dataRenderable));
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
    this.updateDataObj = async function(dataObj, updateObj) {
        // update the data renderable first 
        var dataRenderable;
        var valueBufferCreated;

        for (let renderable of dataObj.renderables) {

            // reset offset optimisation if bounding box has changed
            if (!boxesEqual(renderable.passData.clippedDataBox, updateObj.clippedDataBox)) this.globalPassInfo.framesSinceMove = 0;
            renderable.passData.clippedDataBox = structuredClone(updateObj.clippedDataBox);
            renderable.passData.volumeTransferFunction = structuredClone(updateObj.volumeTransferFunction);
            
            if (renderable.type == RenderableTypes.UNSTRUCTURED_DATA || renderable.type == RenderableTypes.DATA) {
                dataRenderable = renderable
                var passData = dataRenderable.passData; 
                if (updateObj.isoSurfaceSrc.type != DataSrcTypes.DATA) {
                    passData.isoSurfaceSrcUint = this.getDataSrcUint(updateObj.isoSurfaceSrc.type, updateObj.isoSurfaceSrc.name);
                } else {
                    // deal with data
                    // var slotNum = await dataObj.loadDataArray(dataObj.isoSurfaceSrc.name)
                    var isoLoadResult = this.loadDataIntoValues(
                        dataObj,
                        dataObj.isoSurfaceSrc.slotNum, 
                        dataObj.getDataSize(),
                        updateObj.isoSurfaceSrc, 
                        DataSrcUses.ISO_SURFACE,
                        passData,
                        renderable.renderData,
                        renderable.type == RenderableTypes.UNSTRUCTURED_DATA ? GPUResourceTypes.BUFFER : GPUResourceTypes.TEXTURE,
                        dataObj.resolutionMode == ResolutionModes.DYNAMIC
                    );
                    passData.isoSurfaceSrcUint = isoLoadResult.uint;
                    var valueBufferCreatedIso = isoLoadResult.created;
                }

                if (updateObj.surfaceColSrc.type != DataSrcTypes.DATA) {
                    passData.surfaceColSrcUint = this.getDataSrcUint(updateObj.surfaceColSrc.type, updateObj.surfaceColSrc.name);
                } else {
                    // deal with data
                    // var slotNum = await dataObj.loadDataArray(dataObj.surfaceColSrc.name);
                    var colLoadResult = this.loadDataIntoValues(
                        dataObj,
                        updateObj.surfaceColSrc.slotNum, 
                        dataObj.getDataSize(),
                        updateObj.surfaceColSrc, 
                        DataSrcUses.SURFACE_COL,
                        passData,
                        renderable.renderData,
                        renderable.type == RenderableTypes.UNSTRUCTURED_DATA ? GPUResourceTypes.BUFFER : GPUResourceTypes.TEXTURE,
                        dataObj.resolutionMode == ResolutionModes.DYNAMIC
                    );
                    passData.surfaceColSrcUint = colLoadResult.uint;
                    var valueBufferCreatedCol = colLoadResult.created;
                }

                passData.isoSurfaceSrc = updateObj.isoSurfaceSrc;
                passData.surfaceColSrc = updateObj.surfaceColSrc;

                // true if a buffer was created for either
                valueBufferCreated = valueBufferCreatedIso || valueBufferCreatedCol;

                // update unstructured data renderables
                // update the dynamic tree nodes buffer
                if (dataObj.resolutionMode == ResolutionModes.DYNAMIC) {
                    webGPU.writeDataToBuffer(renderable.renderData.buffers.treeNodes, [new Uint8Array(dataObj.data.dynamicTreeNodes)]);
                    if (dataRenderable.passData.isoSurfaceSrcUint == DataSrcUints.VALUE_A) {
                        webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValuesA, [dataObj.getDynamicCornerValues(updateObj.isoSurfaceSrc.slotNum)]);
                    }
                    if (dataRenderable.passData.isoSurfaceSrcUint == DataSrcUints.VALUE_B) {
                        webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValuesB, [dataObj.getDynamicCornerValues(updateObj.isoSurfaceSrc.slotNum)]);
                    }
                    if (dataRenderable.passData.surfaceColSrcUint == DataSrcUints.VALUE_A) {
                        webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValuesA, [dataObj.getDynamicCornerValues(updateObj.surfaceColSrc.slotNum)]);
                    }
                    if (dataRenderable.passData.surfaceColSrcUint == DataSrcUints.VALUE_B) {
                        webGPU.writeDataToBuffer(renderable.renderData.buffers.cornerValuesB, [dataObj.getDynamicCornerValues(updateObj.surfaceColSrc.slotNum)]);
                    }
                }

            }
        }



        if (!dataRenderable) return;

        if (dataRenderable.type == RenderableTypes.UNSTRUCTURED_DATA && valueBufferCreated) {
            // recreate bindgroup 2 from the compute pass
            dataRenderable.renderData.bindGroups.compute2 = webGPU.generateBG(
                this.computeRayMarchPassDescriptor.bindGroupLayouts[2],
                [
                    dataRenderable.renderData.buffers.valuesA,
                    dataRenderable.renderData.buffers.valuesB,
                    dataRenderable.renderData.buffers.cornerValuesA,
                    dataRenderable.renderData.buffers.cornerValuesB,
                ]
            );
        }

        
        // update the face renderables
        for (let renderable of dataObj.renderables) {
            if (renderable.type != RenderableTypes.MESH) continue;
            if (valueBufferCreated) {
                if (dataRenderable.type == RenderableTypes.DATA) {
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
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
            });

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
            });

            webGPU.deleteTexture(this.colorCopyDstTexture);

            this.colorCopyDstTexture = webGPU.makeTexture({
                label: "colour copy destination",
                size: {
                    width: ctx.canvas.width,
                    height: ctx.canvas.height,
                    depthOrArrayLayers: 1
                },
                dimension: "2d",
                format: "bgra8unorm",
                usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
            });
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
    // this is run for every face of the bounding box
    this.march = async function(renderable, camera, outputColourAttachment, outputDepthAttachment, box, canvas) {
        var commandEncoder = await webGPU.createCommandEncoder();
        
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
                    ...renderable.passData.clippedDataBox.min, 0,
                    ...renderable.passData.clippedDataBox.max, 0,
                    0, 0, 0, 0,
                    this.calculateStepSize(),
                    this.globalPassInfo.maxRayLength,
                    0, 0, // padding
                    ...renderable.passData.dMatInv,
                ]),
                new Uint32Array([
                    renderable.passData.isoSurfaceSrcUint,
                    renderable.passData.surfaceColSrcUint,
                    this.globalPassInfo.colourScale, 0,
                ]),
                new Float32Array([
                    ...renderable.passData.volumeTransferFunction.colour[0],
                    renderable.passData.volumeTransferFunction.opacity[0],
                    ...renderable.passData.volumeTransferFunction.colour[1],
                    renderable.passData.volumeTransferFunction.opacity[1],
                    ...renderable.passData.volumeTransferFunction.colour[2],
                    renderable.passData.volumeTransferFunction.opacity[2],
                    ...renderable.passData.volumeTransferFunction.colour[3],
                    renderable.passData.volumeTransferFunction.opacity[3],
                ])
            ]
        );

        webGPU.submitCommandEncoder(commandEncoder);
    }

    this.marchNew = async function(renderable, camera, outputColourAttachment, outputDepthAttachment, box, canvas) {
        
    }

    // this is run for every face of the bounding box
    this.marchUnstructured = async function(renderable, camera, outputColourAttachment, outputDepthAttachment, box, ctx) {
        var commandEncoder = await webGPU.createCommandEncoder();

        // make a copy of the current colour frame buffer
        webGPU.encodeCopyTextureToTexture(commandEncoder, outputColourAttachment.texture, this.colorCopyDstTexture);

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
                        outputDepthAttachment.view,
                        this.offsetOptimisationTextureOld.createView(),
                        this.offsetOptimisationTextureNew.createView(),
                        this.colorCopyDstTexture.createView(),
                        outputColourAttachment.view
                    ]
                ),
            },
            workGroups: WGs
        }

        // encode the render pass
        webGPU.encodeGPUPass(commandEncoder, rayMarchComputePass);

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
                    ...renderable.passData.clippedDataBox.min, 0,
                    ...renderable.passData.clippedDataBox.max, 0,
                    0, 0, 0, 0,
                    this.calculateStepSize(),
                    this.globalPassInfo.maxRayLength,
                    0, 0,
                    ...renderable.passData.dMatInv,
                ]),
                new Uint32Array([
                    renderable.passData.isoSurfaceSrcUint,
                    renderable.passData.surfaceColSrcUint,
                    this.globalPassInfo.colourScale, 0,
                ]),
                new Float32Array([
                    ...renderable.passData.volumeTransferFunction.colour[0],
                    renderable.passData.volumeTransferFunction.opacity[0],
                    ...renderable.passData.volumeTransferFunction.colour[1],
                    renderable.passData.volumeTransferFunction.opacity[1],
                    ...renderable.passData.volumeTransferFunction.colour[2],
                    renderable.passData.volumeTransferFunction.opacity[2],
                    ...renderable.passData.volumeTransferFunction.colour[3],
                    renderable.passData.volumeTransferFunction.opacity[3],
                ])
            ]
        );

        webGPU.submitCommandEncoder(commandEncoder);
    }

    // reads the texture corresponding to the best found ray depth
    // returns the length of the ray at the center of the image
    this.getCenterRayLength = async function() {
        const texSrc = this.offsetOptimisationTextureOld;
        if (!texSrc) return;

        const start = performance.now();


        // find where the center pixel is in the image
        const texSrcCenter = {
            x: Math.round(texSrc.width/2),
            y: Math.round(texSrc.height/2)
        }

        // the target width and height of the region to get from the depth texture
        const targetRegionSize = 8;

        // work out the smallest box around the centre of the image that can be taken
        // the restriction is bytesPerRow must be multiple of 256
        
        const widthAlign = BYTES_PER_ROW_ALIGN/GPUTexelByteLength[texSrc.format];
        const minCorner = [texSrcCenter.x - targetRegionSize/2, texSrcCenter.y - targetRegionSize/2, 0];
        const clipBox = {
            min: minCorner,
            max: [
                minCorner[0] + widthAlign * Math.ceil(targetRegionSize/widthAlign),
                minCorner[1] + targetRegionSize,
                1
            ]
        }
        const mappedTexData = await webGPU.readTexture(texSrc, clipBox);

        var tex =  new GPUTextureMapped(
            mappedTexData.buffer, 
            mappedTexData.width, 
            mappedTexData.height, 
            mappedTexData.depthOrArrayLayers, 
            "rg32float"
        );

        
        // debugger;
        const centerDepth = tex.readTexel(texSrcCenter.x - clipBox.min[0], texSrcCenter.y - clipBox.min[1])[1];

        console.log("reading centre depth took:", performance.now() - start, "ms");

        return centerDepth;
    }
}