// webGPURayMarching.js
// implements the ray marching algorithm with webgpu

import { AssociativeCache } from "../../../data/cache.js";
import { DataFormats, ResolutionModes } from "../../../data/dataConstants.js";
import { clamp, frameInfoStore } from "../../../utils.js";
import { boxesEqual, copyBox } from "../../../boxUtils.js";
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
    #webGPU;

    #offsetOptimisationTextureOld;
    #offsetOptimisationTextureNew;
    #colorCopyDstTexture;

    #passDescriptors = {};

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

        const getUnstructPassDesc = async () => {
            const shader = await this.#webGPU.fetchShader("core/renderEngine/webGPU/rayMarching/shaders/unstructRayMarch.wgsl");
            
            return this.#webGPU.createPassDescriptor(
                this.#webGPU.PassTypes.COMPUTE,
                { timing: true },
                unstructRayMarchBindGroupLayouts,
                { str: shader, formatObj: { WGSizeX: this.#WGSize.x, WGSizeY: this.#WGSize.y, WGVol: this.#WGSize.x * this.#WGSize.y } },
                "ray march pass (compute)"
            );
        }

        const passDescriptors = await Promise.all([getUnstructPassDesc()]);

        this.#passDescriptors.unstruct = passDescriptors[0];

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
            console.log("LEAF TYPE: treelet block");
        } else if (dataObj.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            passData.cellsPtrType = CellsPtrTypes.BLOCK;
            console.log("LEAF TYPE: block");
        } else {
            passData.cellsPtrType = CellsPtrTypes.NORMAL;
            console.log("LEAF TYPE: normal");
        }

        const dataBlockSizes = dataObj.getBufferBlockSizes();

        passData.blockSizes = {
            ...dataBlockSizes,
            valuesA: dataBlockSizes?.positions / 3,
            valuesB: dataBlockSizes?.positions / 3,
        };

        console.log(passData.blockSizes);

        // buffers and other data 
        var usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

        // initialise the values cache
        renderData.buffers.values = [
            this.#webGPU.makeBuffer(0, usage, "empty data vert A values"),
            this.#webGPU.makeBuffer(0, usage, "empty data vert B values"),
        ];

        renderData.buffers.cornerValues = [
            this.#webGPU.makeBuffer(0, usage, "empty corner values A"),
            this.#webGPU.makeBuffer(0, usage, "empty corner values B")
        ];

        passData.values = [
            { name: "None", limits: [0, 1] },
            { name: "None", limits: [0, 1] },
        ];

        passData.dataCache = new AssociativeCache(2);
        passData.dataCache.setBuffer("info", passData.values);
        passData.dataCache.setBuffer("values", renderData.buffers.values);
        passData.dataCache.setBuffer("cornerValues", renderData.buffers.cornerValues);

        passData.dataCache.setWriteFunc("info", (buff, data, slot) => buff[slot] = data);
        passData.dataCache.setReadFunc("info", (buff, slot) => buff[slot]);
        passData.dataCache.setWriteFunc("values", (buff, data, slot) => {
            const result = this.#webGPU.writeOrCreateNewBuffer(
                buff[slot],
                data.buffer,
                buff[slot].usage,
                `values ${slot} buffer`
            );
            buff[slot] = result.buffer;
            return result;
        });
        passData.dataCache.setWriteFunc("cornerValues", (buff, data, slot) => {
            const result = this.#webGPU.writeOrCreateNewBuffer(
                buff[slot],
                data.buffer,
                buff[slot].usage,
                `corner values ${slot} buffer`
            );
            buff[slot] = result.buffer;
            return result;
        });

        renderable.serialisedMaterials = this.#webGPU.serialiseMaterial(this.material);

        // write the tree buffer
        renderData.buffers.treeNodes = this.#webGPU.createFilledBuffer("u8", new Uint8Array(dataObj.getNodeBuffer()), usage, "data tree nodes");
        renderData.buffers.treeCells = this.#webGPU.createFilledBuffer("u32", dataObj.getTreeCells(), usage, "data tree cells");

        if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            renderData.buffers.positions = this.#webGPU.createFilledBuffer("f32", dataObj.data.dynamicPositions, usage, "data dynamic vert positions");
            renderData.buffers.cellConnectivity = this.#webGPU.createFilledBuffer("u32", dataObj.data.dynamicCellConnectivity, usage, "data dynamic cell connectivity");
            renderData.buffers.cellOffsets = this.#webGPU.createFilledBuffer("u32", dataObj.data.dynamicCellOffsets, usage, "data dynamic cell offsets");
        } else {
            renderData.buffers.positions = this.#webGPU.createFilledBuffer("f32", dataObj.data.positions, usage, "data vert positions");
            renderData.buffers.cellConnectivity = this.#webGPU.createFilledBuffer("u32", dataObj.data.cellConnectivity, usage, "data cell connectivity");
            renderData.buffers.cellOffsets = this.#webGPU.createFilledBuffer("u32", dataObj.data.cellOffsets, usage, "data cell offsets");
        }

        renderData.buffers.consts = this.#webGPU.makeBuffer(256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "face mesh consts"); //"s cs cd"
        renderData.buffers.objectInfo = this.#webGPU.makeBuffer(256, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "object info buffer s");

        renderData.buffers.combinedPassInfo = this.#webGPU.makeBuffer(1024, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, "combined ray march pass info");


        renderData.bindGroups.compute0 = this.#webGPU.generateBG(
            this.#passDescriptors.unstruct.bindGroupLayouts[0],
            [
                renderData.buffers.combinedPassInfo,
            ],
            "compute 0"
        );

        renderData.bindGroups.compute1 = this.#webGPU.generateBG(
            this.#passDescriptors.unstruct.bindGroupLayouts[1],
            [
                renderData.buffers.treeNodes,
                renderData.buffers.treeCells,
                renderData.buffers.positions,
                renderData.buffers.cellConnectivity,
                renderData.buffers.cellOffsets,
            ],
            "initial compute 1"
        );
        renderData.bindGroups.compute2 = this.#webGPU.generateBG(
            this.#passDescriptors.unstruct.bindGroupLayouts[2],
            [
                renderData.buffers.values[0],
                renderData.buffers.values[1],
                renderData.buffers.cornerValues[0],
                renderData.buffers.cornerValues[1],
            ],
            "empty compute 2"
        );

        return renderable;
    }

    // setup the data sceneObj with the correct renderables 
    // one that contains the data
    // six face meshes that are actually rendered
    
    async createRenderable(dataObj) {
        // create the renderable for the data
        if (dataObj.dataFormat == DataFormats.UNSTRUCTURED || dataObj.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            return await this.#createUnstructuredDataRenderable(dataObj);
        } else {
            throw "Unsupported dataset dataFormat '" + dataObj.dataFormat + "'";
        }
    }

    #getDataSrcUint(type, name) {
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

    #loadDataArray(dataObj, renderable, thisSrc, otherSrc) {
        const dataUints = [DataSrcUints.VALUE_A, DataSrcUints.VALUE_B];
        let created = false;

        if (thisSrc.type != DataSrcTypes.ARRAY) {
            // not data, return the uint
            return { uint: this.#getDataSrcUint(thisSrc.type, thisSrc.name), created: false };
        }

        // if it is data
        // check if this data is already in cache
        let cacheSlot = renderable.passData.dataCache.getTagSlotNum(thisSrc.name);
        if (-1 == cacheSlot) {
            // not loaded
            let newData = {
                "info": { name: thisSrc.name, limits: thisSrc.limits }
            };
            if (renderable.type == RenderableTypes.UNSTRUCTURED_DATA)
                newData["values"] = { buffer: dataObj.getValues(thisSrc.slotNum) };
            if (renderable.type == RenderableTypes.DATA)
                newData["values"] = { texture: dataObj.getValues(thisSrc.slotNum), dimensions: dataObj.getDataSize() };
            if (dataObj.resolutionMode != ResolutionModes.FULL)
                newData["cornerValues"] = { buffer: dataObj.getCornerValues(thisSrc.slotNum) };

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

        return { uint: dataUints[cacheSlot], created };
    }

    async updateDataRenderable(renderable, updateObj) {
        if (this.noDataUpdates) return;

        const { data } = updateObj;
        const { passData, renderData } = renderable;
        
        let valueBufferCreated = false;
        let treeCellsResized = false;

        // reset offset optimisation if bounding box has changed
        if (!boxesEqual(passData.clippedDataBox, updateObj.clippedDataBox)) this.globalPassInfo.framesSinceMove = 0;
        passData.clippedDataBox = copyBox(updateObj.clippedDataBox);

        passData.threshold = updateObj.threshold;

        passData.volumeTransferFunction = {
            colour: [...updateObj.volumeTransferFunction.colour],
            opacity: [...updateObj.volumeTransferFunction.opacity]
        };


        // iso surface src
        const isoLoadResult = this.#loadDataArray(
            data,
            renderable,
            updateObj.isoSurfaceSrc,
            passData.surfaceColSrc
        );

        passData.isoSurfaceSrc = updateObj.isoSurfaceSrc;
        // this has to be assigned after the previous line
        passData.isoSurfaceSrc.uint = isoLoadResult.uint;
        valueBufferCreated |= isoLoadResult.created;

        // surface col src
        const colLoadResult = this.#loadDataArray(
            data,
            renderable,
            updateObj.surfaceColSrc,
            passData.isoSurfaceSrc
        );

        passData.surfaceColSrc = updateObj.surfaceColSrc;
        // this has to be assigned after the previous line
        passData.surfaceColSrc.uint = colLoadResult.uint;
        valueBufferCreated |= colLoadResult.created;

        // update any dynamic buffers
        if (data.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            // write updated mesh data to the GPU
            this.#webGPU.writeDataToBuffer(renderData.buffers.positions, [data.data.dynamicPositions]);
            this.#webGPU.writeDataToBuffer(renderData.buffers.cellOffsets, [data.data.dynamicCellOffsets]);
            this.#webGPU.writeDataToBuffer(renderData.buffers.cellConnectivity, [data.data.dynamicCellConnectivity]);

            if (data.usesTreelets) {

                // update tree cells block size
                const newVal = data.getBufferBlockSizes()["treeletCells"];
                passData.blockSizes["treeletCells"] = newVal;

                // update tree cells (resizable)
                const loadResult = this.#webGPU.writeOrCreateNewBuffer(
                    renderData.buffers.treeCells,
                    data.getTreeCells(),
                    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                    "data tree cells"
                );

                treeCellsResized = loadResult.created;
                renderData.buffers.treeCells = loadResult.buffer;
            }
        }

        if (data.resolutionMode & ResolutionModes.DYNAMIC_NODES_BIT ||
            data.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            // update the nodes buffer
            this.#webGPU.writeDataToBuffer(renderData.buffers.treeNodes, [new Uint8Array(data.getNodeBuffer())]);
        }

        if (data.resolutionMode != ResolutionModes.FULL) {
            // update the corner values buffer(s)
            const doneNames = new Set();

            for (const dataSrc of [passData.isoSurfaceSrc, passData.surfaceColSrc]) {
                if (dataSrc.type != DataSrcTypes.ARRAY) continue;
                if (doneNames.has(dataSrc.name)) continue;
                doneNames.add(dataSrc.name);

                let newData = {
                    "cornerValues": data.getCornerValues(dataSrc.slotNum),
                };
                if (data.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
                    newData["values"] = data.getDynamicValues(dataSrc.slotNum);
                }

                passData.dataCache.updateBlockAt(
                    passData.dataCache.getTagSlotNum(dataSrc.name), newData
                );
            }
        }


        if (renderable.type == RenderableTypes.UNSTRUCTURED_DATA) {
            if (treeCellsResized) {
                renderData.bindGroups.compute1 = this.#webGPU.generateBG(
                    this.#passDescriptors.unstruct.bindGroupLayouts[1],
                    [
                        renderData.buffers.treeNodes,
                        renderData.buffers.treeCells,
                        renderData.buffers.positions,
                        renderData.buffers.cellConnectivity,
                        renderData.buffers.cellOffsets,
                    ],
                    "filled compute 1"
                );
            }

            if (valueBufferCreated) {
                // recreate bindgroup 2 from the compute pass
                renderData.bindGroups.compute2 = this.#webGPU.generateBG(
                    this.#passDescriptors.unstruct.bindGroupLayouts[2],
                    [
                        renderData.buffers.values[0],
                        renderData.buffers.values[1],
                        renderData.buffers.cornerValues[0],
                        renderData.buffers.cornerValues[1],
                    ],
                    "filled compute 2"
                );
            }

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
        var commandEncoder = await this.#webGPU.createCommandEncoder();

        // make a copy of the current colour frame buffer
        this.#webGPU.encodeCopyTextureToTexture(commandEncoder, outputColourAttachment.texture, this.#colorCopyDstTexture);

        // do a full ray march pass
        var WGs = [
            Math.ceil(ctx.canvas.width / this.#WGSize.x),
            Math.ceil(ctx.canvas.height / this.#WGSize.y)
        ];

        var rayMarchComputePass = {
            ...this.#passDescriptors.unstruct,
            bindGroups: {
                0: renderable.renderData.bindGroups.compute0,
                1: renderable.renderData.bindGroups.compute1,
                2: renderable.renderData.bindGroups.compute2,
                3: this.#webGPU.generateBG(
                    this.#passDescriptors.unstruct.bindGroupLayouts[3],
                    [
                        outputDepthAttachment.view,
                        this.#offsetOptimisationTextureOld.createView(),
                        this.#offsetOptimisationTextureNew.createView(),
                        this.#colorCopyDstTexture.createView(),
                        outputColourAttachment.view
                    ]
                ),
            },
            workGroups: WGs
        };

        // encode the render pass
        this.#webGPU.encodeGPUPass(commandEncoder, rayMarchComputePass);

        // global info buffer for compute
        this.#webGPU.writeDataToBuffer(
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
                    this.#calculateStepSize(),
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
                    renderable.passData.blockSizes.treeletCells,
                    0, 0,
                    renderable.passData.cellsPtrType,
                ]),
            ]
        );

        this.#webGPU.submitCommandEncoder(commandEncoder);

        // map timing information
        const timing = await this.#webGPU.getPassTimingInfo(rayMarchComputePass);
        if (timing?.duration !== undefined) {
            const durMS = timing.duration / 10 ** 6;
            frameInfoStore.addAt(thisFrameNum, "gpu", durMS);
            // console.log(`GPU took ${(durMS).toPrecision(3)}ms`);
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