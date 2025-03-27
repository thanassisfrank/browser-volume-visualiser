// data.js
// handles the storing of the data object, normals etc

import { DataFormats, DataArrayTypes, ResolutionModes } from "./dataConstants.js";
import { FunctionDataSource, RawDataSource, CGNSDataSource, DownsampleStructDataSource, UnstructFromStructDataSource, TreeUnstructDataSource, BlockFromUnstructDataSource, PartialCGNSDataSource } from "./dataSource.js";

import { xyzToA } from "../utils.js";
import {vec3, vec4, mat4} from "../gl-matrix.js";
import { newId } from "../utils.js";
import { DynamicTree } from "./dynamicTree.js";

import { SceneObject, SceneObjectTypes, SceneObjectRenderModes } from "../renderEngine/sceneObjects.js";
import { DataSrcTypes } from "../renderEngine/renderEngine.js";
import { VectorMappingHandler } from "./vectorDataArray.js";

export {dataManager};


const getAsAbsolute = (x, max) => {
    if (typeof x == 'string' || myVar instanceof String) {
        // treat as a percentage of total nodes
        if (!x.includes("%")) throw Error("Value is string but not percentage");

        const proportion = parseFloat(x)/100;
        
        return Math.round(max * proportion);
    } else {
        return x;
    }
};


// object in charge of creating, transforming and deleting data objects
const dataManager = {
    // keep the config set too
    configSet: {},

    setConfigSet: function(configSet) {
        this.configSet = configSet;
        for (let id in configSet) {
            this.configSet[id].id = id;
        }
    },

    getDataObj: async function(configId, opts) {
        return await this.createData(this.configSet[configId], opts);
    },

    getDataSource: async function(config, opts) {
        // create the data source object
        let dataSource;
        switch (config.type) {
            case "function":
                dataSource = new FunctionDataSource(config.name, config.f, xyzToA(config.size), xyzToA(config.cellSize));
                break;
            case "raw":
                dataSource = new RawDataSource(config.name, config.path, config.dataType, config.limits, xyzToA(config.size), xyzToA(config.cellSize));
                break;
            case "cgns":
                dataSource = new CGNSDataSource(config.name, config.path);
                break;
            case "cgns-partial":
                dataSource = new PartialCGNSDataSource(config.name, config.path, config.meshPath)
        }

        // add downsampling transform if required
        if (opts.downSample > 1 && dataSource.format == DataFormats.STRUCTURED) {
            dataSource = new DownsampleStructDataSource(dataSource, opts.downSample);
        }

        // convert struct -> unstruct if needed
        if (opts.forceUnstruct) {
            if (dataSource.format == DataFormats.STRUCTURED) {
                dataSource = new UnstructFromStructDataSource(dataSource);
            } else {
                console.warn("Could not convert dataset to unstructured, dataFormat is not Dataformats.STRUCTURED");
            }
        }

        if (dataSource.format == DataFormats.UNSTRUCTURED && !dataSource.tree) {
            // if unstructured here, create a tree
            dataSource = new TreeUnstructDataSource(
                dataSource, 
                config.availableUnstructuredTrees,
                opts.kdTreeType, 
                opts.maxTreeDepth, 
                opts.leafCells,
                opts.cornerValType
            );
        }

        if (opts.dynamicMesh && dataSource.format == DataFormats.UNSTRUCTURED) {
            dataSource = new BlockFromUnstructDataSource(dataSource);
        }

        await dataSource.init();
        console.log(dataSource);
        return dataSource;
    },

    createData: async function(config, opts) {
        const dataSource = await this.getDataSource(config, opts);

        let dynamicTree;
        
        let resolutionMode = ResolutionModes.FULL;
        if (opts.dynamicNodes) resolutionMode |= ResolutionModes.DYNAMIC_NODES_BIT;
        if (opts.dynamicMesh) resolutionMode |= ResolutionModes.DYNAMIC_CELLS_BIT;

        if (resolutionMode != ResolutionModes.FULL) {
            dynamicTree = new DynamicTree(resolutionMode, opts.treeletDepth, dataSource.extentBox);
        }

        const newData = new Data(0, dataSource, dynamicTree);
        newData.opts = opts;
        console.log(config);
        console.log(opts);

        
        // create dynamic mesh information
        if (opts.dynamicMesh) {
            try {
                // get the absolute sizes of node and mesh caches if supplied as percentages
                const absNodeCount = getAsAbsolute(opts.dynamicNodeCount, dataSource.leafCount * 2);
                const absMeshCount = getAsAbsolute(opts.dynamicMeshBlockCount, dataSource.leafCount);

                this.createDynamicMeshCache(
                    newData, 
                    dataSource.meshBlockSizes, 
                    dataSource.leafCount, 
                    absMeshCount,
                );
                this.createDynamicTree(newData, absNodeCount);
                newData.resolutionMode |= ResolutionModes.DYNAMIC_CELLS_BIT;
                console.log("Created dynamic mesh dataset");
            } catch (e) {
                console.error("Could not create dataset with dynamic cells data:", e)
            }
        }

        // create dynamic tree (nodes)
        if (opts.dynamicNodes) newData.resolutionMode |= ResolutionModes.DYNAMIC_NODES_BIT;

        return newData;
    },

    // create the unstructured tree with a varying subset of the nodes
    // fixed number of dynamic nodes
    createDynamicTree: function(dataObj, dynamicNodeCount) {
        if (!dataObj.data.treeNodes) throw "Could not create dynamic tree, dataset does not have a tree";
        
        if (dynamicNodeCount >= dataObj.data.treeNodeCount) {
            console.warn("Attempted to create dynamic tree that is too large, creating full tree instead");
            return;
        }

        dataObj.dynamicTree.setFullNodes(dataObj.data.treeNodes, dynamicNodeCount);
    },

    // create dynamic mesh buffers that contain a varying subset of the leaves cell data
    // fixed number of data slots
    createDynamicMeshCache: function(dataObj, blockSizes, fullLeafCount, dynamicLeafCount) {
        if (dataObj.dataFormat != DataFormats.BLOCK_UNSTRUCTURED) {
            throw new TypeError("Could not create dynamic cells, dataset not of dataFormat BLOCK_UNSTRUCTURED");
        }
        
        // the total number of leaves of a binary tree of node count n is n/2
        if (dynamicLeafCount >= fullLeafCount) {
            console.warn("Attempted to create dynamic mesh data that is too large, using full cell data instead");
            return;
        }

        const meshCache = dataObj.dynamicTree.createDynamicMeshCache(blockSizes, dynamicLeafCount);

        const buffers = meshCache.getBuffers();
        dataObj.data.dynamicPositions = buffers.positions;
        dataObj.data.dynamicCellOffsets = buffers.cellOffsets;
        dataObj.data.dynamicCellConnectivity = buffers.cellConnectivity;
    }
}






class Data extends SceneObject {
    users = 0;
    config;
    opts;

    // how the data will be presented to the user
    resolutionMode = ResolutionModes.FULL;    

    // the actual data store of the object
    // all entries should be typedarray objects
    data = {
        // the data values
        values: [
            // {name: null, data: null, cornerValues: null, limits: [null, null]},
        ],

        // the geometry
        positions: null,
        cellOffsets: null,
        cellConnectivity: null,
        cellTypes: null,

        dynamicPositions: null,
        dynamicCellOffsets: null,
        dynamicCellConnectivity: null,

        // 1-based indexing compatability
        zeroBased: true,
        // spatial acceleration structure
        treeNodeCount: 0,
        treeNodes: null,
        treeCells: null,
        fullLeafCount: 0,

        leafVerts: null,
    };

    // mapping from value name -> slot number
    valueDirectory = {};

    valueCounts = [];

    // matrix that captures data space -> object space
    // includes scaling of the grid
    dataTransformMat = mat4.create();
    
    // source must be initialised first
    constructor(id, dataSource, dynamicTree) {
        super(SceneObjectTypes.DATA, SceneObjectRenderModes.DATA_RAY_VOLUME);
        this.id = id;

        // where data to be stored here is pulled from
        this.dataSource = dataSource;
        // what format of mesh this represents
        this.dataFormat = dataSource.format;
        // the display name
        this.dataName = dataSource.name;
        // for calculation of new data arrays
        this.mappingHandler = new VectorMappingHandler(dataSource);;
        // dynamic tree object
        this.dynamicTree = dynamicTree;


        // the dimensions in data space
        this.size = this.dataSource.size;
        // axis aligned (data space) maximum extent
        this.extentBox = this.dataSource.extentBox;

        if (this.dataSource.mesh) {
            // get the mesh buffers
            this.data.positions = this.dataSource.mesh.positions;
            this.data.cellOffsets = this.dataSource.mesh.cellOffsets;
            this.data.cellConnectivity = this.dataSource.mesh.cellConnectivity;
            this.data.cellTypes = this.dataSource.mesh.cellTypes;
        }
        if (this.dataSource.mesh) {
            // any additional mesh geometry that is part of the dataset but not part of the mesh
            this.geometry = this.dataSource.geometry;
        }

        
        if (this.dataSource.tree) {
            this.data.treeNodes = dataSource.tree.nodes;
            this.data.treeCells = dataSource.tree.cells;
            this.data.treeNodeCount = dataSource.tree.nodeCount;
            
            this.cornerValType = dataSource.cornerValType;
        }

        if (this.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            // the lengths of the blocks in the mesh buffers if a block mesh is being used
            this.meshBlockSizes = this.dataSource.meshBlockSizes

            if (this.dataSource.constructor == BlockFromUnstructDataSource) {
                // set the tree nodes to be the version for the block mesh
                this.data.treeNodes = this.dataSource.blockNodes;
            }
        }

        this.usesTreelets = this.dynamicTree?.usesTreelets ?? false;
    }

    // returns the block sizes of all the buffers which are blocked
    getBufferBlockSizes() {
        if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            return this.dynamicTree.meshCache.blockSizes;
        }
        return this.dataSource.meshBlockSizes
    }

    // returns either the correct node buffer given resolution mode
    getNodeBuffer() {
        if (
            this.resolutionMode & ResolutionModes.DYNAMIC_NODES_BIT || 
            this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT
        ) {
            // get the node buffer from the dynamic tree
            return this.dynamicTree.getNodeBuffer();
        }
        
        // full unstructured tree
        return this.data.treeNodes;
    }

    getTreeCells() {
        if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            // dynamic mesh with treelets and dynamic nodes
            return this.dynamicTree.getTreeCells();
        }

        // just dynamic nodes or full resolution
        return this.data.treeCells;
    }

    // returns the correct function for requesting node mesh blocks
    // the returned function has expects (blockIndices, geometry, valueNames)
    getNodeBlockRequestFunc() {
        if (PartialCGNSDataSource == this.dataSource.constructor) {
            // get mesh information directly from the data source
            return this.dataSource.getMeshBlocks.bind(this.dataSource);
        } else {
            return function(blockIndices, geometry, valueNames) {
                let result = {};
                for (let index of blockIndices) {
                    // index is the full block index
                    let mesh = this.dataSource.getNodeMeshBlock(index);
                    if (!mesh) continue;
                    result[index] = {};

                    if (geometry) result[index] = mesh.buffers;

                    // slice the needed value buffers
                    const valueSlots = valueNames.map(s => this.valueDirectory[s]);
                    for (const slotNum of valueSlots) {
                        const scalarBuff = this.getFullValues(slotNum);
                        if (!scalarBuff) continue;

                        result[index][this.data.values[slotNum].name] = scalarBuff.slice(...mesh.valueSliceRange);
                    }
                }
        
                return result;
            };
        }
    }

    updateDynamicTree(camInfo, isoInfo, activeValueSlots) {
        // getCornerValsFuncExt -> dataObj.getFullCornerValues
        const getCornerVals = (valueName) => {
            // perform mapping from value name => slot num
            return this.data.values?.[this.valueDirectory?.[valueName]]?.cornerValues;
        }
        // getCornerValsFuncExt -> dataObj.getFullCornerValues
        const getRangeVals = (valueName) => {
            // perform mapping from value name => slot num
            return this.data.values?.[this.valueDirectory?.[valueName]]?.ranges;
        }
        // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
        this.dynamicTree.update(
            camInfo,
            isoInfo,
            getCornerVals,
            getRangeVals,
            this.getNodeBlockRequestFunc().bind(this), 
            activeValueSlots.map(i => this.data.values[i].name),
        );
    }

    getAvailableDataArrays() {
        const sourceArrayDescriptors = this.dataSource.getAvailableDataArrays();

        // find the possible calculable data arrays given the source data
        const mappingOutputNames = this.mappingHandler.getPossibleMappings(sourceArrayDescriptors);
        const calcArrayDescriptors = mappingOutputNames.map(v => {
            return {name: v, arrayType: DataArrayTypes.CALC}
        });

        const allArrayDescriptors = [
            ...sourceArrayDescriptors,
            ...calcArrayDescriptors
        ];

        return allArrayDescriptors.map(v => {
            return {...v, type: DataSrcTypes.ARRAY}
        });
    };

    // returns the slot number that was written to
    // if it is already is loaded, return its slot number
    async loadDataArray(desc, binCount) {
        // check if already loaded
        let loadedIndex = this.valueDirectory[desc.name];
        if (loadedIndex !== undefined) return loadedIndex;

        let newSlotNum;
        try {
            if (DataArrayTypes.DATA == desc.arrayType) {
                this.data.values.push(await this.dataSource.getDataArray(desc));
            } else if (DataArrayTypes.CALC == desc.arrayType) {
                this.data.values.push(await this.mappingHandler.getDataArray(desc));
            } else {
                throw Error("Invalid data array type");
            }
            newSlotNum = this.data.values.length - 1;   
        } catch (e) {
            console.warn("Unable to load data array " + desc.name);
            console.warn(e);
            return -1;
        }

        this.valueDirectory[desc.name] = newSlotNum;

        if (ResolutionModes.DYNAMIC_CELLS_BIT & this.resolutionMode) {
            // dynamic cells, need to 
            // create new entry in the dynamic mesh cache object
            await this.createDynamicBlockValues(newSlotNum);
            console.log("created dynamic values");
        } else {
            // not dynamic cells, need to have the whole scalar data set on hand here
        }
        // initialise the dynamic corner values buffer to match dynamic nodes
        if (ResolutionModes.DYNAMIC_NODES_BIT & this.resolutionMode) {
            this.createDynamicCornerValues(newSlotNum);
            console.log("created dynamic corners");
        } else {
            // not dynamic nodes, need to have the whole corner values buffer on hand here
        }

        return newSlotNum;
    };

    setCornerValType(type) {
        this.cornerValType = type;
    };

    // creates the dynamic corner values buffer from scratch
    // matches the nodes currently loaded in dynamic tree
    createDynamicCornerValues(slotNum) {
        const fullCornerValues = this.getFullCornerValues(slotNum);
        this.data.values[slotNum].dynamicCornerValues = this.dynamicTree.createMatchedDynamicCornerValues(
            fullCornerValues, 
            this.data.values[slotNum].name
        );
    };

    async createDynamicBlockValues(slotNum) {
        this.data.values[slotNum].dynamicData = await this.dynamicTree.createMatchedDynamicMeshValueArray(
            this.getNodeBlockRequestFunc().bind(this), 
            this.data.values[slotNum].name
        );
    };

    // returns the byte length of the values array
    getValuesByteLength(slotNum) {
        return this.getValues(slotNum).byteLength;
    };

    getLimits(slotNum) {
        return this.data.values[slotNum]?.limits;
    };

    // returns the positions of the boundary points
    getBoundaryPoints() {
        var a = this.extentBox.min;
        var b = this.extentBox.max;
        var points = new Float32Array([
            a[0], a[1], a[2], // 0
            b[0], a[1], a[2], // 1
            a[0], b[1], a[2], // 2
            b[0], b[1], a[2], // 3
            a[0], a[1], b[2], // 4
            b[0], a[1], b[2], // 5
            a[0], b[1], b[2], // 6
            b[0], b[1], b[2] // 7
        ]);

        var transformedPoint = [0, 0, 0, 0];
        for (let i = 0; i < points.length; i += 3) {
            vec4.transformMat4(
                transformedPoint,
                [points[i], points[i + 1], points[i + 2], 1],
                this.dataTransformMat
            );
            points.set([
                transformedPoint[0],
                transformedPoint[1],
                transformedPoint[2]
            ], i);
        }

        return points;
    };

    getMidPoint() {
        var points = this.getBoundaryPoints();
        var min = points.slice(0, 3);
        var max = points.slice(21, 24);

        return [
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2,
        ];
    };

    getMaxLength() {
        var points = this.getBoundaryPoints();
        var min = points.slice(0, 3);
        var max = points.slice(21, 24);

        return vec3.length([
            min[0] - max[0],
            min[1] - max[1],
            min[2] - max[2],
        ]);
    };

    // for structured formats, this returns the dimensions of the data grid in # data points
    getDataSize() {
        return this.size ?? [0, 0, 0];
    };

    // returns a string which indicates the size of the dataset for the user
    getDataSizeString() {
        if (this.dataFormat == DataFormats.STRUCTURED) {
            return this.getDataSize().join("x");
        } else if (this.dataFormat == DataFormats.UNSTRUCTURED) {
            return this.data.cellOffsets.length.toLocaleString() + "u";
        } else if (this.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            return this.dataSource.totalCellCount.toLocaleString() + "u";
        }
        return "";
    };

    setDataSize(size) {
        this.extentBox.max = size;
        this.size = size;
    };

    getValues(slotNum) {
        if (ResolutionModes.DYNAMIC_CELLS_BIT & this.resolutionMode) return this.getDynamicValues(slotNum);
        return this.getFullValues(slotNum);
    };

    getFullValues(slotNum) {
        return this.data.values?.[slotNum]?.data;
    };

    getDynamicValues(slotNum) {
        return this.data.values?.[slotNum]?.dynamicData;
    };

    // fetching the corner values buffers
    getCornerValues(slotNum) {
        if (ResolutionModes.DYNAMIC_NODES_BIT & this.resolutionMode) return this.getDynamicCornerValues(slotNum);
        return this.getFullCornerValues(slotNum);
    };

    getFullCornerValues(slotNum) {

        return this.data.values?.[slotNum]?.cornerValues;
    };

    getDynamicCornerValues(slotNum) {
        return this.data.values?.[slotNum]?.dynamicCornerValues;
    };

    getName() {
        return this.dataName ?? "Unnamed data";
    };

    // returns a mat4 encoding object space -> data space
    // includes 
    getdMatInv() {
        var dMatInv = mat4.create();
        mat4.invert(dMatInv, this.dataTransformMat);
        return dMatInv;
    };

    // returns the number of values within this.data.values that fall into a number of bins
    // bins are in the range this.limits and there are binCount number
    getValueCounts(slotNum, binCount) {
        if (this.valueCounts?.[slotNum]?.counts.length == binCount) return this.valueCounts[slotNum];
        var counts = new Uint32Array(binCount);
        var max = 0;
        var index;
        var limits = this.getLimits(slotNum);
        for (let val of this.getFullValues(slotNum)) {
            index = Math.floor((val - limits[0]) * (binCount - 1) / (limits[1] - limits[0]));
            max = Math.max(max, ++counts[Math.max(0, Math.min(index, binCount - 1))]);
        }
        return {
            counts: counts,
            max: max
        };
    };
}