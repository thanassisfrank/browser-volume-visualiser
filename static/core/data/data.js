// data.js
// handles the storing of the data object, normals etc

import { FunctionDataSource, RawDataSource, CGNSDataSource, DataFormats, DownsampleStructDataSource, UnstructFromStructDataSource, CalcVectArraysDataSource } from "./dataSource.js";

import { xyzToA } from "../utils.js";
import {vec3, vec4, mat4} from "../gl-matrix.js";
import { newId } from "../utils.js";
import { getCellTreeBuffers, getLeafMeshBuffers, getLeafMeshBuffersAnalyse, KDTreeSplitTypes } from "./cellTree.js";
import { createDynamicNodeCache, createDynamicMeshCache, createMatchedDynamicMeshValueArray } from "./dynamicTree.js";
import { createNodeCornerValuesBuffer, createMatchedDynamicCornerValues, CornerValTypes } from "./treeNodeValues.js";

import { SceneObject, SceneObjectTypes, SceneObjectRenderModes } from "../renderEngine/sceneObjects.js";
import { processLeafMeshDataInfo } from "./cellTreeUtils.js";
import { DataSrcTypes } from "../renderEngine/renderEngine.js";

export {dataManager};

// these act as bit masks to create the full resolution mode
export const ResolutionModes = {
    FULL:              0b00, // resolution is fixed at the maximum 
    DYNAMIC_NODES_BIT: 0b01, // the resolution is variable
    DYNAMIC_CELLS_BIT: 0b10, // cell and vertex data are arranged per-leaf
};


// object in charge of creating, transforming and deleting data objects
const dataManager = {
    datas: {},
    // directory of data objects corresponding to each dataset
    directory: {},
    // keep the config set too
    configSet: {},

    setConfigSet: function(configSet) {
        this.configSet = configSet;
        for (let id in configSet) {
            this.configSet[id].id = id;
            this.directory[id] = null;
        }
    },

    getDataObj: async function(configId, opts) {
        // returns already created data object if it exists
        if (this.directory[configId]) {
            return this.directory[configId];
        }
        // else, creates a new one
        var newDataObj = await this.createData(this.configSet[configId], opts);
        this.directory[configId] = newDataObj;
        return newDataObj; 
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
        }

        // add downsampling transform if required
        if (opts.downSample > 1 && dataSource.format == DataFormats.STRUCTURED) {
            dataSource = new DownsampleStructDataSource(dataSource, opts.downSample);
        }

        // add a data source that will calculate additional data values
        dataSource = new CalcVectArraysDataSource(dataSource);

        // convert struct -> unstruct if needed
        if (opts.forceUnstruct) {
            if (dataSource.format == DataFormats.STRUCTURED) {
                dataSource = new UnstructFromStructDataSource(dataSource);
            } else {
                console.warn("Could not convert dataset to unstructured, dataFormat is not Dataformats.STRUCTURED");
            }
        }
        await dataSource.init();
        console.log(dataSource);
        return dataSource;
    },

    createData: async function(config, opts) {
        const id = newId(this.datas);
        var newData = new Data(id, await this.getDataSource(config, opts));
        newData.opts = opts;
        console.log(config);
        console.log(opts);
        
        // first, create the dataset from the config
        try {
            await newData.createFromSource();
        } catch (e) {
            console.error("Unable to create dataset:", e);
            return undefined;
        }

        // create tree if we have unstructured data
        if (newData.dataFormat == DataFormats.UNSTRUCTURED) {
            // check if the tree as-specified already exists on the server
            var found = false;
            for (let preGenTree of config.availableUnstructuredTrees ?? []) {
                if (found) break;
                if (KDTreeSplitTypes[preGenTree.kdTreeType] != opts.kdTreeType) continue;
                if (preGenTree.maxTreeDepth != opts.maxTreeDepth) continue;
                if (preGenTree.leafCells != opts.leafCells) continue;
                
                // this matches what has been requested, load these files
                found = true;
                console.log("loading pre generated tree...");
                try {
                    const nodesResp = await fetch(preGenTree.nodesPath);
                    if (!nodesResp.ok) throw Error("File not found");
                    newData.data.treeNodes = await nodesResp.arrayBuffer();
                                            
                    const cellsResp = await fetch(preGenTree.cellsPath);
                    if (!cellsResp.ok) throw Error("File not found");
                    const cellsBuff = await cellsResp.arrayBuffer();
                    newData.data.treeCells = new Uint32Array(cellsBuff);
                } catch (e) {
                    console.warn("unable to load pre-genenerated tree");
                    found = false;
                }
                newData.data.treeNodeCount = preGenTree.treeNodeCount;

                // store in the data object for future reference
                // used when generating corner values
                newData.preGeneratedInfo = preGenTree;
            }
            if (!found) {
                console.log("generating tree");
                this.createUnstructuredTree(newData, opts.leafCells, opts.maxTreeDepth, opts.kdTreeType);
            }

            newData.setCornerValType(opts.cornerValType);
        }

        // create dynamic tree (nodes)
        if (opts.dynamicNodes) {
            try {
                this.createDynamicTree(newData, opts.dynamicNodeCount);
                newData.resolutionMode |= ResolutionModes.DYNAMIC_NODES_BIT;
            } catch (e) {
                console.error("Could not create dataset with dynamic node set:", e)
            }
        }

        // create dynamic mesh information
        if (opts.dynamicMesh) {
            try {
                newData.data.totalCellCount = newData.data?.cellOffsets?.length;
                let maxCells = 0; // max number of cells found within the leaf nodes
                let maxVerts = 0; // max number of unique verts found in the leaf nodes
                let leafCount = 0;
                processLeafMeshDataInfo(newData, l => {
                    maxCells = Math.max(maxCells, l.cells);
                    maxVerts = Math.max(maxVerts, l.verts);
                    leafCount++;
                });

                console.log(maxCells, maxVerts);
                newData.data.fullLeafCount = leafCount;
                newData.meshBlockSizes = {
                    positions: 3 * maxVerts,
                    cellOffsets: maxCells,
                    cellConnectivity: 4 * maxCells,
                };
                this.createLeafMeshData(newData, newData.meshBlockSizes, leafCount);
                this.createDynamicMeshCache(newData, newData.meshBlockSizes, leafCount, opts.dynamicMeshBlockCount);
                newData.resolutionMode |= ResolutionModes.DYNAMIC_CELLS_BIT;
                console.log("Created dynamic mesh dataset");
            } catch (e) {
                console.error("Could not create dataset with dynamic cells data:", e)
            }
        }

        this.datas[id] = newData;
        return newData;
    },

    createUnstructuredTree: function(dataObj, cellsPerLeaf, maxDepth, treeType) {
        // generate the tree for rendering
        const treeBuffers = getCellTreeBuffers(dataObj, cellsPerLeaf, maxDepth, treeType);
        dataObj.data.treeNodes = treeBuffers.nodes;
        dataObj.data.treeCells = treeBuffers.cells;
        dataObj.data.treeNodeCount = treeBuffers.nodeCount;
    },

    // create the unstructured tree with a varying subset of the nodes
    // fixed number of dynamic nodes
    createDynamicTree: function(dataObj, dynamicNodeCount) {
        if (dataObj.dataFormat != DataFormats.UNSTRUCTURED) throw "Could not create dynamic tree, dataset not of dataFormat UNSTRUCTURED";
        
        if (dynamicNodeCount >= dataObj.data.treeNodeCount) {
            console.warn("Attempted to create dynamic tree that is too large, creating full tree instead");
            return;
        }
        dataObj.data.dynamicNodeCount = dynamicNodeCount;

        dataObj.dynamicNodeCache = createDynamicNodeCache(dataObj, dynamicNodeCount);
        console.log(dataObj.dynamicNodeCache);
        dataObj.data.dynamicTreeNodes = dataObj.dynamicNodeCache.getBuffers().nodes;
    },

    // converts the geometry buffers and generates a new buffer tracking the vertices for each leaf
    createLeafMeshData: function(dataObj, blockSizes, leafCount) {
        // create the new buffers
        // const leafMeshBuffers = getLeafMeshBuffers(dataObj, blockSizes, leafCount);
        const leafMeshBuffers = getLeafMeshBuffers(dataObj, blockSizes, leafCount);
        for (let name of ["positions", "cellOffsets", "cellConnectivity"]) {
            console.log("leaf mesh format " + name + " is " + Math.round(leafMeshBuffers[name].length/dataObj.data[name].length) + "x larger");
            console.log(Math.round(dataObj.data[name].byteLength/1_000_000) + " -> " +  Math.round(leafMeshBuffers[name].byteLength/1_000_000) + " MB");
        }

        // over write the plain mesh buffers
        dataObj.data.positions = leafMeshBuffers.positions;
        dataObj.data.cellOffsets = leafMeshBuffers.cellOffsets;
        dataObj.data.cellConnectivity = leafMeshBuffers.cellConnectivity;

        dataObj.data.leafVerts = leafMeshBuffers.leafVerts;
        dataObj.fullToLeafIndexMap = leafMeshBuffers.indexMap;

        console.log(leafMeshBuffers);
    },

    // create dynamic mesh buffers that contain a varying subset of the leaves cell data
    // fixed number of data slots
    createDynamicMeshCache: function(dataObj, blockSizes, fullLeafCount, dynamicLeafCount) {
        if (dataObj.dataFormat != DataFormats.UNSTRUCTURED) throw "Could not create dynamic cells, dataset not of dataFormat UNSTRUCTURED";
        
        // the total number of leaves of a binary tree of node count n is n/2
        if (dynamicLeafCount >= fullLeafCount) {
            console.warn("Attempted to create dynamic mesh data that is too large, using full cell data instead");
            return;
        }

        dataObj.dynamicMeshCache = createDynamicMeshCache(blockSizes, dynamicLeafCount);

        const buffers = dataObj.dynamicMeshCache.getBuffers();
        dataObj.data.dynamicPositions = buffers.positions;
        dataObj.data.dynamicCellOffsets = buffers.cellOffsets;
        dataObj.data.dynamicCellConnectivity = buffers.cellConnectivity;
    },
    
    addUser: function(data) {
        this.datas[data.id].users++;
        return  this.datas[data.id].users;
    },

    removeUser: function(data) {
        this.datas[data.id].users--;
        if (this.datas[data.id].users == 0) {
            // no users, cleanup the object
            this.deleteData(data)
        }
    },

    deleteData: function(data) {
        // cleanup the data used by the march module
        for (let id in this.directory) {
            if (this.directory[id] == data) {
                this.directory[id] = null;
            }
        }
        delete this.datas[data.id];
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

        dynamicNodeCount: 0,
        dynamicTreeNodes: null,
        dynamicTreeCells: null,

        leafVerts: null,
    };

    // objects that handle the state of the dynamic node, corner values and mesh buffers
    dynamicNodeCache;
    dynamicMeshCache;

    // the lengths of the blocks in the mesh buffers if a block mesh is being used
    meshBlockSizes;

    // any additional mesh geometry that is part of the dataset but not part of the mesh
    geometry = {};

    // information about the data files that have been pre-generated and are available to be laoded from the server
    preGeneratedInfo = {};

    cornerValType = null;

    valueCounts = [];

    // supplemental attributes
    // the dimensions in data space
    size = [0, 0, 0];
    // axis aligned (data space) maximum extent
    extentBox = {
        min: [0, 0, 0],
        max: [0, 0, 0]
    };

    // matrix that captures data space -> object space
    // includes scaling of the grid
    dataTransformMat = mat4.create();
    
    constructor(id, dataSource) {
        super(SceneObjectTypes.DATA, SceneObjectRenderModes.DATA_RAY_VOLUME);
        this.id = id;

        // where data to be stored here is pulled from
        this.dataSource = dataSource;
        // what format of mesh this represents
        this.dataFormat = dataSource.format;
        // what this.data represents
        this.dataName = dataSource.name;
    }

    async createFromSource() {
        // source must be initialised first
        this.size = this.dataSource.size;
        this.extentBox = this.dataSource.extentBox;

        if (this.dataFormat == DataFormats.UNSTRUCTURED) {
            // get the mesh buffers
            this.data.positions = this.dataSource.mesh.positions;
            this.data.cellOffsets = this.dataSource.mesh.cellOffsets;
            this.data.cellConnectivity = this.dataSource.mesh.cellConnectivity;
            this.data.cellTypes = this.dataSource.mesh.cellTypes;

            this.geometry = this.dataSource.geometry;
        }
    };

    getAvailableDataArrays() {
        return this.dataSource.getAvailableDataArrays().map(v => {
            return {...v, type: DataSrcTypes.ARRAY}
        })
    };

    // returns the slot number that was written to
    // if it already is loaded, return its slot number
    async loadDataArray(desc, binCount) {
        // check if already loaded
        let loadedIndex = this.data.values.findIndex(elem => elem.name == desc.name);
        if (loadedIndex != -1) return loadedIndex;

        let newSlotNum;
        try {
            this.data.values.push(await this.dataSource.getDataArray(desc));
            newSlotNum = this.data.values.length - 1;   
        } catch (e) {
            console.warn("Unable to load data array " + desc.name + ": " + e);
            return -1;
        }
        // get the histogram if required
        if (binCount) {
            this.valueCounts[newSlotNum] = this.getValueCounts(newSlotNum, binCount);
        }

        if (ResolutionModes.DYNAMIC_CELLS_BIT & this.resolutionMode) {
            // if the data is in the normal mesh format, reformat to block mesh
            this.convertValuesToBlockMesh(newSlotNum);
            console.log("converted values");
            // create new entry in the dynamic mesh cache object
            this.createDynamicBlockValues(newSlotNum);
            console.log("created dynamic values");
        }

        // if this is dynamic, load corner values too
        if (ResolutionModes.FULL != this.resolutionMode) {
            await this.createCornerValues(newSlotNum);
            console.log("created corner vals");
        }
        // initialise the dynamic corner values buffer to match dynamic nodes
        if (ResolutionModes.DYNAMIC_NODES_BIT & this.resolutionMode) {
            this.createDynamicCornerValues(newSlotNum);
            console.log("created dynamic corners");
        }


        return newSlotNum;
    };

    // gets the data describing the mesh geometry and values for the mesh of this node
    // if this node is not a leaf, returns undefined
    getNodeMeshBlock(nodeIndex, valueSlots) {
        if (!this.fullToLeafIndexMap.has(nodeIndex)) return;
        const leafIndex = this.fullToLeafIndexMap.get(nodeIndex);
        // slice the mesh geometry buffers
        let buffers = {
            positions: this.data.positions.slice(
                leafIndex * this.meshBlockSizes.positions, (leafIndex + 1) * this.meshBlockSizes.positions
            ),
            cellOffsets: this.data.cellOffsets.slice(
                leafIndex * this.meshBlockSizes.cellOffsets, (leafIndex + 1) * this.meshBlockSizes.cellOffsets
            ),
            cellConnectivity: this.data.cellConnectivity.slice(
                leafIndex * this.meshBlockSizes.cellConnectivity, (leafIndex + 1) * this.meshBlockSizes.cellConnectivity
            )
        };

        // slice the needed value buffers
        for (const slotNum of valueSlots) {
            const values = this.getFullValues(slotNum);
            if (!values) continue;
            buffers["values" + slotNum] = values.slice(
                leafIndex * this.meshBlockSizes.positions / 3, (leafIndex + 1) * this.meshBlockSizes.positions / 3
            );
        }

        // return the buffers together
        return buffers;
    };

    setCornerValType(type) {
        this.cornerValType = type;
    };

    // creates the full corner values buffer for the full tree, using the data in the specified value slot
    async createCornerValues(slotNum) {
        // first, check if the corner values are available on the server
        var found = false;

        for (let preGenCornerVal of this.preGeneratedInfo.cornerValues ?? []) {
            if (found) break;
            if (preGenCornerVal.dataArray != this.data.values[slotNum].name) continue;
            if (CornerValTypes[preGenCornerVal.type] != this.cornerValType) continue;
            // this matches what has been requested, load these files
            console.log("loading pre generated corner vals");
            found = true;
            try {
                const resp = await fetch(preGenCornerVal.path);
                if (!resp.ok) throw Error("File not found");
                const buff = await resp.arrayBuffer();
                this.data.values[slotNum].cornerValues = new Float32Array(buff);
            } catch (e) {
                console.warn("unable to load pre-generated corner val, generating instead...");
                found = false;
            }
        }
        if (found) return;
        console.log("generating corner vals");
        this.data.values[slotNum].cornerValues = createNodeCornerValuesBuffer(this, slotNum, this.cornerValType);
    };

    // creates the dynamic corner values buffer from scratch
    // matches the nodes currently loaded in dynamic tree
    createDynamicCornerValues(slotNum) {
        this.data.values[slotNum].dynamicCornerValues = createMatchedDynamicCornerValues(this, slotNum);
    };

    convertValuesToBlockMesh(slotNum) {
        // create new buffer to re-write values into
        // if vert count < block length, value of vert 0 will be written
        const blockVals = new Float32Array(this.data.leafVerts.length);
        this.data.leafVerts.forEach((e, i) => blockVals[i] = this.getFullValues(slotNum)[e]);

        this.data.values[slotNum].data = blockVals;
    };

    createDynamicBlockValues(slotNum) {
        this.data.values[slotNum].dynamicData = createMatchedDynamicMeshValueArray(this, slotNum);
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
        if (this.dataFormat == DataFormats.STRUCTURED) {
            var size = this.getDataSize();
            // extent is size -1
            var e = [size[0] - 1, size[1] - 1, size[2] - 1];
            var points = new Float32Array([
                0, 0, 0, // 0
                e[0], 0, 0, // 1
                0, e[1], 0, // 2
                e[0], e[1], 0, // 3
                0, 0, e[2], // 4
                e[0], 0, e[2], // 5
                0, e[1], e[2], // 6
                e[0], e[1], e[2] // 7
            ]);
        } else if (this.dataFormat == DataFormats.UNSTRUCTURED) {
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
        } else {
            var points = new Float32Array(24);
        }

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
            if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
                return this.data.totalCellCount.toLocaleString() + "u";
            } else {
                return this.data.cellOffsets.length.toLocaleString() + "u";
            }
        }
        return "";
    };

    setDataSize(size) {
        this.extentBox.max = size;
        this.size = size;
    };

    getDynamicNodeCount() {
        return this.data.dynamicNodeCount;
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