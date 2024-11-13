// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import { AssociativeCache } from "../../../data/cache.js";
import { DataFormats } from "../../../data/dataSource.js";
import { ResolutionModes } from "../../../data/data.js";
import { boxesEqual, clampBox } from "../../../utils.js";
import { DataSrcTypes, DataSrcUints, GPUResourceTypes, Renderable, RenderableRenderModes, RenderableTypes } from "../../renderEngine.js";
import { BYTES_PER_ROW_ALIGN, GPUTexelByteLength, GPUTextureMapped } from "../webGPUBase.js";

export const DataSrcUses = {
    NONE: 0,
    ISO_SURFACE: 1,
    SURFACE_COL: 2,
};

export const ColourScales = {
    B_W: 0,
    BL_W_R: 1,
    BL_C_G_Y_R: 2
};

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
    };

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
        showSurfLeafCells: false,   // shows the number of cells in the leaf nodes on the iso-surface
        contCornerVals: false,

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
    };

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
    };

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
        flags |= this.passFlags.showSurfLeafCells << 22 & 0b1 << 22;
        flags |= this.passFlags.contCornerVals    << 23 & 0b1 << 23;
        return flags;
    };

    this.calculateStepSize = function() {
        var falloffFrames = 3;
        if (this.passFlags.cheapMove && this.globalPassInfo.framesSinceMove < falloffFrames) {
            var stepMaxScale = 3;
            // linearly interpolate between max and 1 scales
            return this.globalPassInfo.stepSize * (1 + (stepMaxScale - 1) * (1 - this.globalPassInfo.framesSinceMove/falloffFrames))
        }
        return this.globalPassInfo.stepSize;
    };
    
    this.getStepSize = function() {
        return this.globalPassInfo.stepSize;
    };

    this.setStepSize = function(step) {
        this.globalPassInfo.stepSize = step;
        this.globalPassInfo.framesSinceMove = 0;
    };

    this.setColourScale = function(colourScale) {
        this.globalPassInfo.colourScale = colourScale;
    };

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
                }
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
        ];

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
            });
        
            
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
        let renderable = new Renderable(RenderableTypes.DATA, RenderableRenderModes.NONE);
        let renderData = renderable.renderData;
        let passData = renderable.passData

        renderData.textures.values = [
            webGPU.makeTexture({
                label: "empty values A texture",
                size: {},
                dimension: "3d",
                format: "r32float",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            }),
            webGPU.makeTexture({
                label: "empty values B texture",
                size: {},
                dimension: "3d",
                format: "r32float",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            }),
        ];

        passData.values = [
            {name: "None", limits: [0, 1]},
            {name: "None", limits: [0, 1]},
        ];

        passData.dataCache = new AssociativeCache(2);
        passData.dataCache.setBuffer("info", passData.values);
        passData.dataCache.setBuffer("values", renderData.textures.values);

        // setup the writing function
        passData.dataCache.setWriteFunc("info", (buff, data, slot) => buff[slot] = data);
        passData.dataCache.setReadFunc("info", (buff, slot) => buff[slot]);
        passData.dataCache.setWriteFunc("values", (buff, data, slot) => {
            const result = webGPU.writeOrCreateNewTexture(
                buff[slot], 
                data.texture, 
                data.dimensions, 
                buff[slot].usage, 
                `values ${slot} texture`
            );
            buff[slot] = result.texture;
            return result;
        });

        renderData.buffers.passInfo = webGPU.makeBuffer(512, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "ray pass info");

        return renderable;
    };

    this.createUnstructuredDataRenderable = async function(dataObj) {
        var renderable = new Renderable(RenderableTypes.UNSTRUCTURED_DATA, RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME);
        var renderData = renderable.renderData;
        var passData = renderable.passData;

        // information about the data being sent
        passData.isoSurfaceSrc = {type: DataSrcTypes.NONE, name: "", limits: [0, 1], uint: DataSrcUints.NONE};
        passData.surfaceColSrc = {type: DataSrcTypes.NONE, name: "", limits: [0, 1], uint: DataSrcUints.NONE};;

        passData.dMatInv = dataObj.getdMatInv();
        passData.cornerValType = dataObj.cornerValType;

        passData.usesBlockMesh = dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT;
        passData.blockSizes = {
            positions: dataObj.meshBlockSizes?.positions ?? 0,
            cellOffsets: dataObj.meshBlockSizes?.cellOffsets ?? 0,
            cellConnectivity: dataObj.meshBlockSizes?.cellConnectivity ?? 0,
            valuesA: dataObj.meshBlockSizes?.positions/3 ?? 0,
            valuesB: dataObj.meshBlockSizes?.positions/3 ?? 0,
        };
        
        // buffers and other data 
        var usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

        // initialise the values cache
        renderData.buffers.values = [
            webGPU.makeBuffer(0, usage, "empty data vert A values"),
            webGPU.makeBuffer(0, usage, "empty data vert B values"),
        ];

        renderData.buffers.cornerValues = [
            webGPU.makeBuffer(0, usage, "empty corner values A"),
            webGPU.makeBuffer(0, usage, "empty corner values B")
        ];

        passData.values = [
            {name: "None", limits: [0, 1]},
            {name: "None", limits: [0, 1]},
        ];

        passData.dataCache = new AssociativeCache(2);
        passData.dataCache.setBuffer("info", passData.values);
        passData.dataCache.setBuffer("values", renderData.buffers.values);
        passData.dataCache.setBuffer("cornerValues", renderData.buffers.cornerValues);

        passData.dataCache.setWriteFunc("info", (buff, data, slot) => buff[slot] = data);
        passData.dataCache.setReadFunc("info", (buff, slot) => buff[slot]);
        passData.dataCache.setWriteFunc("values", (buff, data, slot) => {
            const result = webGPU.writeOrCreateNewBuffer(
                buff[slot], 
                data.buffer, 
                buff[slot].usage, 
                `values ${slot} buffer`
            );
            buff[slot] = result.buffer;
            return result;
        });
        passData.dataCache.setWriteFunc("cornerValues", (buff, data, slot) => {
            const result = webGPU.writeOrCreateNewBuffer(
                buff[slot], 
                data.buffer, 
                buff[slot].usage, 
                `corner values ${slot} buffer`
            );
            buff[slot] = result.buffer;
            return result;
        });

        renderable.serialisedMaterials = webGPU.serialiseMaterials(this.materials.frontMaterial, this.materials.backMaterial);

        // write the tree buffer
        if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_NODES_BIT) {
            renderData.buffers.treeNodes = webGPU.createFilledBuffer("u8", new Uint8Array(dataObj.data.dynamicTreeNodes), usage, "data dynamic tree nodes");
        } else {
            renderData.buffers.treeNodes = webGPU.createFilledBuffer("u8", new Uint8Array(dataObj.data.treeNodes), usage, "data tree nodes");
        }
        
        if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            renderData.buffers.treeCells = webGPU.makeBuffer(0, usage, "empty tree cells");
            renderData.buffers.positions = webGPU.createFilledBuffer("f32", dataObj.data.dynamicPositions, usage, "data dynamic vert positions");
            renderData.buffers.cellConnectivity = webGPU.createFilledBuffer("u32", dataObj.data.dynamicCellConnectivity, usage, "data dynamic cell connectivity");
            renderData.buffers.cellOffsets = webGPU.createFilledBuffer("u32", dataObj.data.dynamicCellOffsets, usage, "data dynamic cell offsets");
        } else {
            renderData.buffers.treeCells = webGPU.createFilledBuffer("u32", dataObj.data.treeCells, usage, "data tree cells");
            renderData.buffers.positions = webGPU.createFilledBuffer("f32", dataObj.data.positions, usage, "data vert positions");
            renderData.buffers.cellConnectivity = webGPU.createFilledBuffer("u32", dataObj.data.cellConnectivity, usage, "data cell connectivity");
            renderData.buffers.cellOffsets = webGPU.createFilledBuffer("u32", dataObj.data.cellOffsets, usage, "data cell offsets");
        }

        renderData.buffers.consts = webGPU.makeBuffer(256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "face mesh consts"); //"s cs cd"
        renderData.buffers.objectInfo = webGPU.makeBuffer(256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "object info buffer s");

        renderData.buffers.combinedPassInfo = webGPU.makeBuffer(1024, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "combined ray march pass info");
        
        
        renderData.bindGroups.compute0 = webGPU.generateBG(
            this.computeRayMarchPassDescriptor.bindGroupLayouts[0],
            [
                renderData.buffers.combinedPassInfo, 
            ],
        );

        renderData.bindGroups.compute1 = webGPU.generateBG(
            this.computeRayMarchPassDescriptor.bindGroupLayouts[1],
            [
                renderData.buffers.treeNodes,
                renderData.buffers.treeCells,
                renderData.buffers.positions,
                renderData.buffers.cellConnectivity,
                renderData.buffers.cellOffsets,
            ]
        );
        renderData.bindGroups.compute2 = webGPU.generateBG(
            this.computeRayMarchPassDescriptor.bindGroupLayouts[2],
            [
                renderData.buffers.values[0],
                renderData.buffers.values[1],
                renderData.buffers.cornerValues[0],
                renderData.buffers.cornerValues[1],
            ]
        );
        
        return renderable;
    };

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
        ];

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

            faceRenderable.passData.dMatInv = dataObj.getdMatInv();

            faceRenderable.passData.isoSurfaceSrcUint = DataSrcUints.NONE;
            faceRenderable.passData.surfaceColSrcUint = DataSrcUints.NONE;

            // add the shared data
            if (faceRenderMode == RenderableRenderModes.DATA_RAY_VOLUME) {
                // structured
                faceRenderable.sharedData.buffers.passInfo = dataRenderable.renderData.buffers.passInfo;
                faceRenderable.renderData.bindGroups.rayMarch0 = webGPU.generateBG(
                    this.rayMarchPassDescriptor.bindGroupLayouts[0],
                    [constsBuffer, faceRenderable.renderData.buffers.objectInfo],
                );
                faceRenderable.renderData.bindGroups.rayMarch1 =  webGPU.generateBG(
                    this.rayMarchPassDescriptor.bindGroupLayouts[1],
                    [
                        faceRenderable.sharedData.buffers.passInfo, 
                        dataRenderable.renderData.textures.values[0].createView(),
                        dataRenderable.renderData.textures.values[1].createView(),
                    ],
                );
            }

            meshRenderables.push(faceRenderable);
        }

        return meshRenderables;
    };

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

        // add the data renderable
        dataObj.renderables.push(dataRenderable);
        
        console.log("setup data for ray marching");
    };


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
    };
    
    this.loadDataArray = function(dataObj, renderable, thisSrc, otherSrc) {
        const dataUints = [DataSrcUints.VALUE_A, DataSrcUints.VALUE_B];
        let created = false;

        if (thisSrc.type != DataSrcTypes.DATA) {
            // not data, return the uint
            return {uint:this.getDataSrcUint(thisSrc.type, thisSrc.name), created: false};
        } 
        
        // if it is data
        // check if this data is already in cache
        let cacheSlot = renderable.passData.dataCache.getTagSlotNum(thisSrc.name);
        if (-1 == cacheSlot) {
            // not loaded
            let newData = {
                "info": {name: thisSrc.name, limits: thisSrc.limits}
            };
            if (renderable.type == RenderableTypes.UNSTRUCTURED_DATA) 
                newData["values"] = {buffer: dataObj.getValues(thisSrc.slotNum)};
            if (renderable.type == RenderableTypes.DATA) 
                newData["values"] = {texture: dataObj.getValues(thisSrc.slotNum), dimensions: dataObj.getDataSize()};
            if (dataObj.resolutionMode != ResolutionModes.FULL)
                newData["cornerValues"] = {buffer: dataObj.getCornerValues(thisSrc.slotNum)};
            
            // figure out where to write the new data
            let newCacheSlot;
            for (let i = 0; i < dataUints.length; i++) {
                if (dataUints[i] == otherSrc.uint) continue;
                newCacheSlot = i;
                break;
            }

            // write to the new slot
            const result = renderable.passData.dataCache.insertNewBlockAt(newCacheSlot, thisSrc.name, newData);
            cacheSlot = result.slot;
            // check if any value buffers were created
            for (const buffInfo in result.info) {
                created |= result.info[buffInfo].created;
            }
        }

        return {uint: dataUints[cacheSlot], created};
    };


    // updates the renderables for a data object
    this.updateDataObj = async function(dataObj, updateObj) {
        // update the data renderable first 
        let dataRenderable;
        let valueBufferCreated = false;

        for (let renderable of dataObj.renderables) {
            // reset offset optimisation if bounding box has changed
            if (!boxesEqual(renderable.passData.clippedDataBox, updateObj.clippedDataBox)) this.globalPassInfo.framesSinceMove = 0;
            renderable.passData.clippedDataBox = {
                min: [...updateObj.clippedDataBox.min],
                max: [...updateObj.clippedDataBox.max],
            };

            renderable.passData.volumeTransferFunction = {
                colour: [...updateObj.volumeTransferFunction.colour],
                opacity: [...updateObj.volumeTransferFunction.opacity]
            };
            
            if (renderable.type != RenderableTypes.UNSTRUCTURED_DATA && renderable.type != RenderableTypes.DATA) continue;

            dataRenderable = renderable
            let passData = renderable.passData; 

            // iso surface src
            const isoLoadResult = this.loadDataArray(
                dataObj, 
                renderable, 
                updateObj.isoSurfaceSrc,
                passData.surfaceColSrc,
            );
            
            passData.isoSurfaceSrc = updateObj.isoSurfaceSrc;
            // this has to be assigned after the previous line
            passData.isoSurfaceSrc.uint = isoLoadResult.uint;
            valueBufferCreated |= isoLoadResult.created;

            // surface col src
            const colLoadResult = this.loadDataArray(
                dataObj, 
                renderable, 
                updateObj.surfaceColSrc,
                passData.isoSurfaceSrc,
            );
            
            passData.surfaceColSrc = updateObj.surfaceColSrc;
            // this has to be assigned after the previous line
            passData.surfaceColSrc.uint = colLoadResult.uint;
            valueBufferCreated |= colLoadResult.created;

            // update any dynamic buffers
            if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
                // write updated mesh data to the GPU
                webGPU.writeDataToBuffer(renderable.renderData.buffers.positions, [dataObj.data.dynamicPositions]);
                webGPU.writeDataToBuffer(renderable.renderData.buffers.cellOffsets, [dataObj.data.dynamicCellOffsets]);
                webGPU.writeDataToBuffer(renderable.renderData.buffers.cellConnectivity, [dataObj.data.dynamicCellConnectivity]);
            }

            if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_NODES_BIT) {
                // update the nodes buffer
                webGPU.writeDataToBuffer(renderable.renderData.buffers.treeNodes, [new Uint8Array(dataObj.data.dynamicTreeNodes)]);
            }

            if (dataObj.resolutionMode != ResolutionModes.FULL) {
                // update the corner values buffer(s)
                const doneNames = new Set();
                
                for (const dataSrc of [passData.isoSurfaceSrc, passData.surfaceColSrc]) {
                    if (dataSrc.type != DataSrcTypes.DATA) continue;
                    if (doneNames.has(dataSrc.name)) continue;
                    doneNames.add(dataSrc.name);

                    let newData = {
                        "cornerValues": dataObj.getDynamicCornerValues(dataSrc.slotNum),
                    };
                    if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
                        newData["values"] = dataObj.getDynamicValues(dataSrc.slotNum);
                    }
                    
                    passData.dataCache.updateBlockWithTag(dataSrc.name, newData);
                }
            }
        }

        if (!dataRenderable) return;

        if (dataRenderable.type == RenderableTypes.UNSTRUCTURED_DATA && valueBufferCreated) {
            // recreate bindgroup 2 from the compute pass
            dataRenderable.renderData.bindGroups.compute2 = webGPU.generateBG(
                this.computeRayMarchPassDescriptor.bindGroupLayouts[2],
                [
                    dataRenderable.renderData.buffers.values[0],
                    dataRenderable.renderData.buffers.values[1],
                    dataRenderable.renderData.buffers.cornerValues[0],
                    dataRenderable.renderData.buffers.cornerValues[1],
                ]
            );
        }

        
        // update the face renderables
        for (let renderable of dataObj.renderables) {
            if (renderable.type != RenderableTypes.MESH) continue;
            if (!(renderable.renderMode & RenderableRenderModes.DATA_RAY_VOLUME)) continue;
            // update the information about values A and values B
            renderable.passData.values = dataRenderable.passData.values;

            renderable.passData.isoSurfaceSrc = dataRenderable.passData.isoSurfaceSrc;
            renderable.passData.surfaceColSrc = dataRenderable.passData.surfaceColSrc;

            if (!valueBufferCreated) continue;
            if (dataRenderable.type != RenderableTypes.DATA) continue;
            renderable.renderData.bindGroups.rayMarch1 =  webGPU.generateBG(
                this.rayMarchPassDescriptor.bindGroupLayouts[1],
                [
                    renderable.sharedData.buffers.passInfo, 
                    dataRenderable.renderData.textures.values[0].createView(),
                    dataRenderable.renderData.textures.values[1].createView(),
                ],
            );
        }
    };


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
    };

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
    };

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
        };

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
                    renderable.passData.values[0].limits[0],
                    renderable.passData.values[0].limits[1],
                    renderable.passData.values[1].limits[0],
                    renderable.passData.values[1].limits[1],
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
                    renderable.passData.isoSurfaceSrc.uint,
                    renderable.passData.surfaceColSrc.uint,
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
    };

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
                    renderable.passData.values[0].limits[0],
                    renderable.passData.values[0].limits[1],
                    renderable.passData.values[1].limits[0],
                    renderable.passData.values[1].limits[1],
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
                    renderable.passData.isoSurfaceSrc.uint,
                    renderable.passData.surfaceColSrc.uint,
                    this.globalPassInfo.colourScale, 
                    renderable.passData.cornerValType,
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
                ]),
                new Uint32Array([
                    renderable.passData.blockSizes.positions,
                    renderable.passData.blockSizes.cellOffsets,
                    renderable.passData.blockSizes.cellConnectivity,
                    renderable.passData.blockSizes.valuesA,
                    renderable.passData.blockSizes.valuesB,
                    0, 0, 0,
                    renderable.passData.usesBlockMesh,
                ]),
            ]
        );

        webGPU.submitCommandEncoder(commandEncoder);
    };

    // reads the texture corresponding to the best found ray depth
    // returns the length of the ray at the center of the image
    this.getCenterRayLength = async function() {
        const texSrc = this.offsetOptimisationTextureOld;
        if (!texSrc) return;

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
        };
        const mappedTexData = await webGPU.readTexture(texSrc, clipBox);

        var tex =  new GPUTextureMapped(
            mappedTexData.buffer, 
            mappedTexData.width, 
            mappedTexData.height, 
            mappedTexData.depthOrArrayLayers, 
            "rg32float"
        );

        
        const centerDepth = tex.readTexel(texSrcCenter.x - clipBox.min[0], texSrcCenter.y - clipBox.min[1])[1];

        return centerDepth;
    };
}