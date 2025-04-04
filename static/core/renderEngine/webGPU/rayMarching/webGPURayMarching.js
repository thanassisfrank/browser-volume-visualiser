// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import { DataFormats, ResolutionModes } from "../../../data/dataConstants.js";
import { clamp, frameInfoStore } from "../../../utils.js";
import { boxesEqual, copyBox } from "../../../boxUtils.js";
import { DataSrcTypes, DataSrcUints, GPUResourceTypes, Renderable, RenderableRenderModes, RenderableTypes } from "../../renderEngine.js";
import { BYTES_PER_ROW_ALIGN, GPUTexelByteLength, GPUTextureMapped, WebGPUBase } from "../webGPUBase.js";

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


// how a leaf node's cells location can be specified
export const CellsPtrTypes = {
    NORMAL: 0,
    BLOCK: 1,
    TREELET_BLOCK: 2,
};


export class WebGPURayMarchingEngine {
    // public ===============================
    // materials used as the defaults for the ray-marched iso-surface
    material = {
        front: {
            diffuseCol: [0.7, 0.2, 0.2],
            specularCol: [0.9, 0.4, 0.4],
            shininess: 1000
        },
        back: {
            diffuseCol: [0.5, 0.2, 0.2],
            specularCol: [0.4, 0.4, 0.4],
            shininess: 1000
        }
    };

    passFlags = {
        // sent to gpu
        phong: true, // shade the iso-surface using the phong model
        backStep: true, // enable intersection estimation
        showNormals: false, // indicate the normals on the iso-surface
        showVolume: true, // render the accumulated transparent volume data
        fixedCamera: false, // renders dataset from a fixed viewpoint (structured only)
        randStart: true, // randomise the offset applied to each ray
        showSurface: true, // render the iso-surface
        showRayDirs: false, // render the direction vector of each pixel ray as an rgb value
        showRayLength: false, // display the total length of every ray
        optimiseOffset: true, // reduce the amount of randmoness in the offset over time
        showOffset: false, // display the ray offsets
        showDeviceCoords: false, // display the coordinates of each pixel as an rg value
        sampleNearest: false, // sample the dataset without interpolation (unused)
        showCells: false, // displays each cell on the dataset surface (structured only)
        showNodeVals: false, // display the value stored in the pruned leaves on dataset surface
        showNodeLoc: false, // display the index (location) of each node on the datset surface
        showNodeDepth: false, // show the depth of the tree pruned leaf nodes on the dataset surface
        quadraticBackStep: false, // estimate iso-surface intersection using
        renderNodeVals: false, // use the node values for rendering
        useBestDepth: true, // always display the current best surface depth when optimising
        showTestedCells: false, // shows the amount of cells that have been checked for each ray 
        showSurfNodeDepth: false, // shows the depth of the node on the iso-surface
        showSurfNodeIndex: false, // shows the index of the node on the iso-surface
        showSurfLeafCells: false, // shows the number of cells in the leaf nodes on the iso-surface
        contCornerVals: false,

        // not sent to gpu
        cheapMove: false,
    };

    globalPassInfo = {
        stepSize: 2,
        maxRayLength: 2000,
        framesSinceMove: 0,
        colourScale: ColourScales.B_W
    };

    noDataUpdates = false;

    // private ==============================
    /** @type {WebGPUBase} */
    #webGPU;

    #offsetOptimisationTextureOld;
    #offsetOptimisationTextureNew;
    #colorCopyDstTexture;

    #passes = {};

    // required: x*y*z <= 256 
    // optimal seems to be 8x8
    // > 8x8 corresponds to 64 threads which is the size of 1 or 2 waves on Nvidia or AMD hardware
    #WGSize = { x: 8, y: 8 };

    
    constructor(webGPUBase) {
        this.#webGPU = webGPUBase;
    }

    async setupEngine() {
        // make bind group layouts
        const unstructRayMarchBindGroupLayouts = [
            this.#webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
            ], "Compute ray-march constants"),
            this.#webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
            ], "Compute ray march geometry"),
            this.#webGPU.createBindGroupLayout([
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
            ], "Compute ray-march data"),
            this.#webGPU.createBindGroupLayout([
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

        const t0 = performance.now();

        // register the lib file
        const rayMarchLib = await this.#webGPU.fetchShaderText("core/renderEngine/webGPU/rayMarching/shaders/rayMarchUtils.wgsl");
        this.#webGPU.registerWGSLLib("rayMarchUtils.wgsl", rayMarchLib);

        const createUnstructPass = async () => {
            const shaderStr = await this.#webGPU.fetchShaderText("core/renderEngine/webGPU/rayMarching/shaders/unstructRayMarch.wgsl");
            const shader = this.#webGPU.createShader(
                shaderStr, 
                { WGSizeX: this.#WGSize.x, WGSizeY: this.#WGSize.y, WGVol: this.#WGSize.x * this.#WGSize.y }
            );
            
            return this.#webGPU.createComputePass(
                unstructRayMarchBindGroupLayouts,
                shader,
                { timing: true },
                "unstruct ray march pass"
            );
        }

        const passes = await Promise.all([createUnstructPass()]);

        this.#passes.unstruct = passes[0];

        this.#webGPU.log(performance.now() - t0, "ms for ray pipeline creation");
    }

    getPassFlag(name) {
        return this.passFlags[name];
    }

    setPassFlag(name, state) {
        if (name == "optimiseOffset" ||
            name == "showSurface" ||
            name == "backStep" ||
            name == "cheapMove") {
            this.globalPassInfo.framesSinceMove = 0;
        }
        this.passFlags[name] = state;
    }

    getPassFlagsUint() {
        var flags = 0;
        flags |= this.passFlags.phong << 0 & 0b1 << 0;
        flags |= this.passFlags.backStep << 1 & 0b1 << 1;
        flags |= this.passFlags.showNormals << 2 & 0b1 << 2;
        flags |= this.passFlags.showVolume << 3 & 0b1 << 3;
        flags |= this.passFlags.fixedCamera << 4 & 0b1 << 4;
        flags |= this.passFlags.randStart << 5 & 0b1 << 5;
        flags |= this.passFlags.showSurface << 6 & 0b1 << 6;
        flags |= this.passFlags.showRayDirs << 7 & 0b1 << 7;
        flags |= this.passFlags.showRayLength << 8 & 0b1 << 8;
        flags |= this.passFlags.optimiseOffset << 9 & 0b1 << 9;
        flags |= this.passFlags.showOffset << 10 & 0b1 << 10;
        flags |= this.passFlags.showDeviceCoords << 11 & 0b1 << 11;
        flags |= this.passFlags.sampleNearest << 12 & 0b1 << 12;
        flags |= this.passFlags.showCells << 13 & 0b1 << 13;
        flags |= this.passFlags.showNodeVals << 14 & 0b1 << 14;
        flags |= this.passFlags.showNodeLoc << 15 & 0b1 << 15;
        flags |= this.passFlags.showNodeDepth << 16 & 0b1 << 16;
        flags |= this.passFlags.secantRoot << 17 & 0b1 << 17;
        flags |= this.passFlags.renderNodeVals << 18 & 0b1 << 18;
        flags |= this.passFlags.useBestDepth << 19 & 0b1 << 19;
        flags |= this.passFlags.showTestedCells << 20 & 0b1 << 20;
        flags |= this.passFlags.showSurfNodeDepth << 21 & 0b1 << 21;
        flags |= this.passFlags.showSurfLeafCells << 22 & 0b1 << 22;
        flags |= this.passFlags.contCornerVals << 23 & 0b1 << 23;
        flags |= this.passFlags.showSurfNodeIndex << 24 & 0b1 << 24;
        return flags;
    }

    #calculateStepSize() {
        var falloffFrames = 3;
        if (this.passFlags.cheapMove && this.globalPassInfo.framesSinceMove < falloffFrames) {
            var stepMaxScale = 3;
            // linearly interpolate between max and 1 scales
            return this.globalPassInfo.stepSize * (1 + (stepMaxScale - 1) * (1 - this.globalPassInfo.framesSinceMove / falloffFrames));
        }
        return this.globalPassInfo.stepSize;
    }

    getStepSize() {
        return this.globalPassInfo.stepSize;
    }

    setStepSize(step) {
        this.globalPassInfo.stepSize = step;
        this.globalPassInfo.framesSinceMove = 0;
    }

    setColourScale(colourScale) {
        this.globalPassInfo.colourScale = colourScale;
    }

    async #createUnstructuredDataRenderable(dataObj) {
        const renderable = new Renderable(RenderableTypes.UNSTRUCTURED_DATA, RenderableRenderModes.UNSTRUCTURED_DATA_RAY_VOLUME);
        const { passData, renderData } = renderable;

        passData.clippedDataBox = copyBox(dataObj.extentBox);

        passData.volumeTransferFunction = {
            colour: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
            opacity: [0, 0, 0, 0]
        };

        // information about the data being sent
        passData.isoSurfaceSrc = { type: DataSrcTypes.NONE, name: "", limits: [0, 1], uint: DataSrcUints.NONE };
        passData.surfaceColSrc = { type: DataSrcTypes.NONE, name: "", limits: [0, 1], uint: DataSrcUints.NONE };;

        passData.dMatInv = dataObj.getdMatInv();
        passData.cornerValType = dataObj.cornerValType;

        // passData.usesBlockMesh = dataObj.dataFormat == DataFormats.BLOCK_UNSTRUCTURED;
        if (dataObj.usesTreelets) {
            passData.cellsPtrType = CellsPtrTypes.TREELET_BLOCK;
            this.#webGPU.log("LEAF TYPE: treelet block");
        } else if (dataObj.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            passData.cellsPtrType = CellsPtrTypes.BLOCK;
            this.#webGPU.log("LEAF TYPE: block");
        } else {
            passData.cellsPtrType = CellsPtrTypes.NORMAL;
            this.#webGPU.log("LEAF TYPE: normal");
        }

        const dataBlockSizes = dataObj.getBufferBlockSizes();

        passData.blockSizes = {
            ...dataBlockSizes,
            valuesA: dataBlockSizes?.positions / 3,
            valuesB: dataBlockSizes?.positions / 3,
        };
        // what buffer is in each slot
        passData.values = [
            { name: "None", limits: [0, 1] },
            { name: "None", limits: [0, 1] },
        ];
        renderable.serialisedMaterials = this.#webGPU.serialiseMaterial(this.material);

        // buffers and other data 
        let { buffers } = renderData;
        buffers.placeholder = this.#webGPU.makeBuffer(0, this.#webGPU.bufferUsage.S_CD_CS, "placeholder");

        // write the tree buffer
        buffers.treeNodes = this.#webGPU.createFilledBuffer(
            new Uint8Array(dataObj.getNodeBuffer()), 
            this.#webGPU.bufferUsage.S_CD_CS, 
            "data tree nodes"
        );
        buffers.treeCells = this.#webGPU.createFilledBuffer(
            dataObj.getTreeCells(), 
            this.#webGPU.bufferUsage.S_CD_CS, 
            "data tree cells"
        );

        if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            buffers.positions = this.#webGPU.createFilledBuffer(
                dataObj.data.dynamicPositions, 
                this.#webGPU.bufferUsage.S_CD_CS, 
                "data dynamic vert positions"
            );
            buffers.cellConnectivity = this.#webGPU.createFilledBuffer(
                dataObj.data.dynamicCellConnectivity, 
                this.#webGPU.bufferUsage.S_CD_CS, 
                "data dynamic cell connectivity"
            );
            buffers.cellOffsets = this.#webGPU.createFilledBuffer(
                dataObj.data.dynamicCellOffsets, 
                this.#webGPU.bufferUsage.S_CD_CS, 
                "data dynamic cell offsets"
            );
        } else {
            buffers.positions = this.#webGPU.createFilledBuffer(
                dataObj.data.positions, 
                this.#webGPU.bufferUsage.S_CD_CS, 
                "data vert positions"
            );
            buffers.cellConnectivity = this.#webGPU.createFilledBuffer(
                dataObj.data.cellConnectivity, 
                this.#webGPU.bufferUsage.S_CD_CS, 
                "data cell connectivity"
            );
            buffers.cellOffsets = this.#webGPU.createFilledBuffer(
                dataObj.data.cellOffsets, 
                this.#webGPU.bufferUsage.S_CD_CS, 
                "data cell offsets"
            );
        }

        buffers.consts = this.#webGPU.makeBuffer(256, this.#webGPU.bufferUsage.S_CD_CS, "face mesh consts");
        buffers.objectInfo = this.#webGPU.makeBuffer(256, this.#webGPU.bufferUsage.S_CD_CS, "object info buffer s");

        buffers.combinedPassInfo = this.#webGPU.makeBuffer(1024, this.#webGPU.bufferUsage.S_CD_CS, "combined ray march pass info");


        renderData.bindGroups.compute0 = this.#webGPU.generateBG(
            this.#passes.unstruct.bindGroupLayouts[0],
            [buffers.combinedPassInfo],
            "compute 0"
        );

        renderData.bindGroups.compute1 = this.#webGPU.generateBG(
            this.#passes.unstruct.bindGroupLayouts[1],
            [
                buffers.treeNodes,
                buffers.treeCells,
                buffers.positions,
                buffers.cellConnectivity,
                buffers.cellOffsets,
            ],
            "initial compute 1"
        );
        renderData.bindGroups.compute2 = this.#webGPU.generateBG(
            this.#passes.unstruct.bindGroupLayouts[2],
            [buffers.placeholder, buffers.placeholder, buffers.placeholder, buffers.placeholder],
            "empty compute 2"
        );

        return renderable;
    }

    // create the data renderable for ray marching
    async createRenderable(dataObj) {
        // create the renderable for the data
        if (dataObj.dataFormat == DataFormats.UNSTRUCTURED || dataObj.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            return await this.#createUnstructuredDataRenderable(dataObj);
        } else {
            throw "Unsupported dataset dataFormat '" + dataObj.dataFormat + "'";
        }
    }

    #getDataSrcUint(src, slot) {
        const { type, name } = src;

        switch (type) {
            case DataSrcTypes.AXIS:
                if (name == "x") return DataSrcUints.AXIS_X;
                if (name == "y") return DataSrcUints.AXIS_Y;
                if (name == "z") return DataSrcUints.AXIS_Z;
                break;
            case DataSrcTypes.ARRAY:
                if (slot == 0) return DataSrcUints.VALUE_A;
                if (slot == 1) return DataSrcUints.VALUE_B;
                break;
            case DataSrcTypes.NONE:
                return DataSrcUints.NONE;
        }
        return null;
    }

    async updateUnstructuredDataRenderable(renderable, updates) {
        const { nodeData, valuesData, cornerValsData, meshData, treeletCellsData, blockSizes } = updates;
        const { passData, renderData } = renderable;
        
        passData.clippedDataBox = copyBox(updates.clippedDataBox);
        passData.threshold = updates.threshold;
        passData.volumeTransferFunction = {
            colour: [...updates.volumeTransferFunction.colour],
            opacity: [...updates.volumeTransferFunction.opacity]
        };
        Object.assign(passData.blockSizes, blockSizes);

        if (valuesData) {
            // update the corner values buffer(s)
            for (let name in valuesData) {
                renderData.buffers["values " + name] = this.#webGPU.writeOrCreateNewBuffer(
                    renderData.buffers["values " + name],
                    valuesData[name], 
                    this.#webGPU.bufferUsage.S_CD_CS, 
                    `values: ${name}`
                ).buffer;
            }
        }

        if (cornerValsData) {
            // update the corner values buffer(s)
            for (let name in cornerValsData) {
                renderData.buffers["corner vals " + name] = this.#webGPU.writeOrCreateNewBuffer(
                    renderData.buffers["corner vals " + name],
                    cornerValsData[name], 
                    this.#webGPU.bufferUsage.S_CD_CS, 
                    `corner vals: ${name}`
                ).buffer;
            }
        }

        if (updates.isoSurfaceSrc || updates.surfaceColSrc) {
            // update the iso surface source info
            passData.isoSurfaceSrcUint = this.#getDataSrcUint(updates.isoSurfaceSrc, 0);
            passData.surfaceColSrcUint = this.#getDataSrcUint(updates.surfaceColSrc, 1);
    
            
            if (passData.values[0].name !== updates.isoSurfaceSrc.name || passData.values[1].name !== updates.surfaceColSrc.name) {
                // recreate bindgroup 2 from the compute pass
                let isoBuffer = renderData.buffers["values " + updates.isoSurfaceSrc.name] ?? renderData.buffers.placeholder;
                let isoCornBuffer = renderData.buffers["corner vals " + updates.isoSurfaceSrc.name] ?? renderData.buffers.placeholder;
                
                let colBuffer = renderData.buffers["values " + updates.surfaceColSrc.name] ?? renderData.buffers.placeholder;
                let colCornBuffer = renderData.buffers["corner vals " + updates.surfaceColSrc.name] ?? renderData.buffers.placeholder;
    
                renderData.bindGroups.compute2 = this.#webGPU.generateBG(
                    this.#passes.unstruct.bindGroupLayouts[2],
                    [isoBuffer, colBuffer, isoCornBuffer, colCornBuffer],
                    "filled compute 2"
                );
            }
    
            // update the information about each value buffer
            passData.values[0] = { name: updates.isoSurfaceSrc.name, limits: updates.isoSurfaceSrc.limits };
            passData.values[1] = { name: updates.surfaceColSrc.name, limits: updates.surfaceColSrc.limits }
        }

        // write updated mesh data to the GPU
        if (meshData?.positions) this.#webGPU.writeDataToBuffer(renderData.buffers.positions, [meshData.positions]);
        if (meshData?.cellOffsets) this.#webGPU.writeDataToBuffer(renderData.buffers.cellOffsets, [meshData.cellOffsets]);
        if (meshData?.cellConnectivity) this.#webGPU.writeDataToBuffer(renderData.buffers.cellConnectivity, [meshData.cellConnectivity]);

        if (treeletCellsData) {
            // update tree cells (resizable)
            const loadResult = this.#webGPU.writeOrCreateNewBuffer(
                renderData.buffers.treeCells,
                treeletCellsData,
                this.#webGPU.bufferUsage.S_CD_CS,
                "data tree cells"
            );

            renderData.buffers.treeCells = loadResult.buffer;

            // recreate bindgroup
            if (loadResult.created) {
                debugger;
                renderData.bindGroups.compute1 = this.#webGPU.generateBG(
                    this.#passes.unstruct.bindGroupLayouts[1],
                    [
                        renderData.buffers.treeNodes,
                        renderData.buffers.treeCells,
                        renderData.buffers.positions,
                        renderData.buffers.cellConnectivity,
                        renderData.buffers.cellOffsets,
                    ],
                    "compute 1"
                );
            }
        }

        if (nodeData) {
            // update the nodes buffer
            this.#webGPU.writeDataToBuffer(renderData.buffers.treeNodes, [new Uint8Array(nodeData)]);
        }
    }

    beginFrame(ctx, resized, cameraMoved, thresholdChanged) {
        if (cameraMoved || thresholdChanged) {
            this.globalPassInfo.framesSinceMove = 0;
        }
        // check if the size of the canvas is the same as what is was previously
        if (resized) {
            this.#webGPU.deleteTexture(this.#offsetOptimisationTextureOld);
            // create texture for offset optimisation
            this.#offsetOptimisationTextureOld = this.#webGPU.makeTexture({
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

            this.#webGPU.deleteTexture(this.#offsetOptimisationTextureNew);
            // create texture for offset optimisation
            this.#offsetOptimisationTextureNew = this.#webGPU.makeTexture({
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

            this.#webGPU.deleteTexture(this.#colorCopyDstTexture);

            this.#colorCopyDstTexture = this.#webGPU.makeTexture({
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

    endFrame(ctx) {
        this.globalPassInfo.framesSinceMove++;
        // copy the new found or carried across offsets to be used in the next pass
        this.#webGPU.copyTextureToTexture(
            this.#offsetOptimisationTextureNew,
            this.#offsetOptimisationTextureOld,
            {
                width: ctx.canvas.width,
                height: ctx.canvas.height,
                depthOrArrayLayers: 1
            }
        );
    }

    // this is run for every face of the bounding box
    async marchUnstructured(renderable, camera, outputColourAttachment, outputDepthAttachment, box, ctx) {
        const thisFrameNum = frameInfoStore.getFrameNum();
        const commandEncoder = await this.#webGPU.createCommandEncoder();

        const { renderData, passData } = renderable;

        // make a copy of the current colour frame buffer
        this.#webGPU.encodeCopyTextureToTexture(commandEncoder, outputColourAttachment.texture, this.#colorCopyDstTexture);

        // do a full ray march pass
        const workGroups = [
            Math.ceil(ctx.canvas.width / this.#WGSize.x),
            Math.ceil(ctx.canvas.height / this.#WGSize.y)
        ];

        const passOptions = {
            bindGroups: {
                0: renderData.bindGroups.compute0,
                1: renderData.bindGroups.compute1,
                2: renderData.bindGroups.compute2,
                3: this.#webGPU.generateBG(
                    this.#passes.unstruct.bindGroupLayouts[3],
                    [
                        outputDepthAttachment.view,
                        this.#offsetOptimisationTextureOld.createView(),
                        this.#offsetOptimisationTextureNew.createView(),
                        this.#colorCopyDstTexture.createView(),
                        outputColourAttachment.view
                    ]
                ),
            },
            workGroups
        };

        // encode the render pass
        this.#webGPU.encodeGPUPass(commandEncoder, this.#passes.unstruct, passOptions);

        // global info buffer for compute
        this.#webGPU.writeDataToBuffer(
            renderData.buffers.combinedPassInfo,
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
                    passData.threshold,
                    passData.values[0].limits[0],
                    passData.values[0].limits[1],
                    passData.values[1].limits[0],
                    passData.values[1].limits[1],
                    0,
                    ...passData.clippedDataBox.min, 0,
                    ...passData.clippedDataBox.max, 0,
                    0, 0, 0, 0,
                    this.#calculateStepSize(),
                    this.globalPassInfo.maxRayLength,
                    0, 0,
                    ...passData.dMatInv,
                ]),
                new Uint32Array([
                    passData.isoSurfaceSrcUint,
                    passData.surfaceColSrcUint,
                    this.globalPassInfo.colourScale,
                    passData.cornerValType,
                ]),
                new Float32Array([
                    ...passData.volumeTransferFunction.colour[0],
                    passData.volumeTransferFunction.opacity[0],
                    ...passData.volumeTransferFunction.colour[1],
                    passData.volumeTransferFunction.opacity[1],
                    ...passData.volumeTransferFunction.colour[2],
                    passData.volumeTransferFunction.opacity[2],
                    ...passData.volumeTransferFunction.colour[3],
                    passData.volumeTransferFunction.opacity[3],
                ]),
                new Uint32Array([
                    passData.blockSizes.positions,
                    passData.blockSizes.cellOffsets,
                    passData.blockSizes.cellConnectivity,
                    passData.blockSizes.valuesA,
                    passData.blockSizes.valuesB,
                    passData.blockSizes.treeletCells,
                    0, 0,
                    passData.cellsPtrType,
                ]),
            ]
        );

        this.#webGPU.submitCommandEncoder(commandEncoder);

        // map timing information
        const timing = await this.#webGPU.getPassTimingInfo(this.#passes.unstruct);
        if (timing?.duration !== undefined) {
            const durMS = timing.duration / 10 ** 6;
            frameInfoStore.addAt(thisFrameNum, "gpu", durMS);
        }
    }

    // reads the texture corresponding to the best found ray depth
    // returns the length of the ray at the center of the image
    async getCenterRayLength() {
        const texSrc = this.#offsetOptimisationTextureOld;
        if (!texSrc) return;

        // find where the center pixel is in the image
        return await this.getRayLengthAt(Math.round(texSrc.width / 2), Math.round(texSrc.height / 2));
    }

    async getRayLengthAt(x, y) {
        const texSrc = this.#offsetOptimisationTextureOld;
        if (!texSrc) return;

        const rounded = {
            x: Math.round(x),
            y: Math.round(y),
        };

        // ensure x, y are inside image
        if (rounded.x < 0 || rounded.x >= texSrc.width) return;
        if (rounded.y < 0 || rounded.y >= texSrc.height) return;


        // the target width and height of the region to get from the depth texture
        const targetRegionSize = 8;

        // work out the smallest box around the centre of the image that can be taken
        // the restriction is bytesPerRow must be multiple of 256
        const widthAlign = BYTES_PER_ROW_ALIGN / GPUTexelByteLength[texSrc.format];
        const regionWidth = widthAlign * Math.ceil(targetRegionSize / widthAlign);
        const regionHeight = targetRegionSize;

        const minCorner = [
            clamp(rounded.x - targetRegionSize / 2, 0, texSrc.width - regionWidth),
            clamp(rounded.y - targetRegionSize / 2, 0, texSrc.height - regionHeight),
            0
        ];
        const clipBox = {
            min: minCorner,
            max: [
                minCorner[0] + regionWidth,
                minCorner[1] + regionHeight,
                1
            ]
        };
        const mappedTexData = await this.#webGPU.readTexture(texSrc, clipBox);

        var tex = new GPUTextureMapped(
            mappedTexData.buffer,
            mappedTexData.width,
            mappedTexData.height,
            mappedTexData.depthOrArrayLayers,
            "rg32float"
        );


        const centerDepth = tex.readTexel(rounded.x - clipBox.min[0], rounded.y - clipBox.min[1])[1];

        return centerDepth;
    }
}