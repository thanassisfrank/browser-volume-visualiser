// data.js
// handles the storing of the data object, normals etc

import { FunctionDataSource, RawDataSource, CGNSDataSource, EmptyDataSource, DataFormats } from "./dataSource.js";

import { xyzToA } from "../utils.js";
import {vec3, vec4, mat4} from "../gl-matrix.js";
import { newId } from "../utils.js";
import { getCellTreeBuffers, getLeafMeshBuffers, getLeafMeshBuffersAnalyse, KDTreeSplitTypes } from "./cellTree.js";
import { createDynamicNodeCache, createDynamicMeshCache, createMatchedDynamicMeshValueArray } from "./dynamicTree.js";
import { createNodeCornerValuesBuffer, createMatchedDynamicCornerValues, CornerValTypes } from "./treeNodeValues.js";

import { SceneObject, SceneObjectTypes, SceneObjectRenderModes } from "../renderEngine/sceneObjects.js";
import { processLeafMeshDataInfo } from "./cellTreeUtils.js";

export {dataManager};

// these act as bit masks to create the full resolution mode
export const ResolutionModes = {
    FULL:          0b00, // resolution is fixed at the maximum 
    DYNAMIC_NODES: 0b01, // the resolution is variable
    DYNAMIC_CELLS: 0b10, // cell and vertex data are arranged per-leaf
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

    createData: async function(config, opts) {
        // create the data source object
        let dataSource;
        let newDataFormat;
        switch (config.type) {
            case "function":
                dataSource = new FunctionDataSource(config.name, config.f, xyzToA(config.size), xyzToA(config.cellSize));
                newDataFormat = DataFormats.STRUCTURED;
                break;
            case "raw":
                dataSource = new RawDataSource(config.name, config.path, config.dataType, config.limits, xyzToA(config.size), xyzToA(config.cellSize));
                newDataFormat = DataFormats.STRUCTURED;
                break;
            case "cgns":
                dataSource = new CGNSDataSource(config.name, config.path);
                newDataFormat = DataFormats.UNSTRUCTURED;
                break;
        }

        const id = newId(this.datas);
        var newData = new Data(id, dataSource, newDataFormat);
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

        // downsample if required and possible
        if (opts.downSample > 1 && newData.dataFormat == DataFormats.STRUCTURED) {
            this.downsampleStructured(newData, opts.downSample);
        }

        // convert scruct -> unstruct if needed
        if (opts.forceUnstruct) {
            this.convertToUnstructured(newData);
        }

        console.log(newData.extentBox);

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
                newData.resolutionMode |= ResolutionModes.DYNAMIC_NODES;
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
                newData.resolutionMode |= ResolutionModes.DYNAMIC_CELLS;
                console.log("Created dynamic mesh dataset");
            } catch (e) {
                console.error("Could not create dataset with dynamic cells data:", e)
            }
        }

        this.datas[id] = newData;
        return newData;
    },

    downsampleStructured: function(dataObj, scale) {
        var fullDataSize = dataObj.getDataSize(); // the size in data points
        var dataSize = [
            Math.floor((fullDataSize[0] - 1)/scale), 
            Math.floor((fullDataSize[1] - 1)/scale), 
            Math.floor((fullDataSize[2] - 1)/scale), 
        ];
        dataObj.setDataSize(dataSize);
        
        var temp = new Float32Array(dataSize[0]*dataSize[1]*dataSize[2]);
        // write values
        let thisIndex;
        let thisFullIndex;
        for (let k = 0; k < dataSize[2]; k++) { // loop z
            for (let j = 0; j < dataSize[1]; j++) { // loop y
                for (let i = 0; i < dataSize[0]; i++) { // loop x
                    thisIndex = k * dataSize[0] * dataSize[1] + j * dataSize[0] + i;
                    thisFullIndex = (k * fullDataSize[0] * fullDataSize[1] + j * fullDataSize[0] + i) * scale;
                    temp[thisIndex] = dataObj.data.values[thisFullIndex];
                }
            }
        }
        dataObj.data.values = temp;
    },

    convertToUnstructured: function(dataObj) {
        if (dataObj.dataFormat != DataFormats.STRUCTURED) {
            console.warn("Could not convert dataset to unstructured, dataFormat is not Dataformats.STRUCTURED");
            return;
        }

        // change type and resolution mode
        dataObj.dataFormat = DataFormats.UNSTRUCTURED;

        // build the cell data
        var dataSize = dataObj.getDataSize(); // the size in data points

        var pointCount = dataSize[0] * dataSize[1] * dataSize[2];
        var cubesCount = (dataSize[0] - 1)*(dataSize[1] - 1)*(dataSize[2] - 1);
        var tetsCount = cubesCount * 5;
        

        dataObj.data.positions = new Float32Array(pointCount * 3);
        dataObj.data.cellConnectivity = new Uint32Array(tetsCount * 4); // 5 tet per hex, 4 points per tet
        dataObj.data.cellOffsets = new Uint32Array(tetsCount); // 5 tet per hex, 4 points per tet
        dataObj.data.cellTypes = new Uint32Array(tetsCount); // 5 tet per hex, 4 points per tet
        dataObj.data.cellTypes.fill(10); // all tets

        var getIndex = (i, j, k) => {
            return k * dataSize[0] * dataSize[1] + j * dataSize[0] + i;
        }
        var getHexCellIndex = (i, j, k) => {
            return k * (dataSize[0] - 1) * (dataSize[1] - 1) + j * (dataSize[0] - 1) + i;
        }
        var writeTet = (cellIndex, coords) => {
            var cellOffset = cellIndex * 4;
            dataObj.data.cellOffsets[cellIndex] = cellOffset;
            dataObj.data.cellConnectivity[cellOffset    ] = getIndex(...(coords[0]));
            dataObj.data.cellConnectivity[cellOffset + 1] = getIndex(...(coords[1]));
            dataObj.data.cellConnectivity[cellOffset + 2] = getIndex(...(coords[2]));
            dataObj.data.cellConnectivity[cellOffset + 3] = getIndex(...(coords[3]));
        }

        var writePoint = (pointIndex, x, y, z) => {
            dataObj.data.positions[3 * pointIndex    ] = x;
            dataObj.data.positions[3 * pointIndex + 1] = y;
            dataObj.data.positions[3 * pointIndex + 2] = z;
        }
        
        // rip hexahedra
        for (let k = 0; k < dataSize[2] - 1; k++) { // loop z
            for (let j = 0; j < dataSize[1] - 1; j++) { // loop y
                for (let i = 0; i < dataSize[0] - 1; i++) { // loop x
                    var thisIndex = getHexCellIndex(i, j, k);        
                    // tet 1
                    writeTet(5 * thisIndex + 0, 
                        [
                            [i,     j,     k    ], 
                            [i + 1, j,     k    ],
                            [i,     j + 1, k    ],
                            [i,     j,     k + 1],
                        ]
                    );

                    // tet 2
                    writeTet(5 * thisIndex + 1, 
                        [
                            [i + 1, j,     k    ],
                            [i + 1, j + 1, k    ], 
                            [i,     j + 1, k    ],
                            [i + 1, j + 1, k + 1],
                        ]
                    );
                        
                    // tet 3
                    writeTet(5 * thisIndex + 2, 
                        [
                            [i,     j,     k + 1],
                            [i + 1, j + 1, k + 1],
                            [i + 1, j,     k + 1],
                            [i + 1, j,     k    ],
                        ]
                    );

                    // tet 4
                    writeTet(5 * thisIndex + 3, 
                        [
                            [i,     j,     k + 1],
                            [i + 1, j + 1, k + 1],
                            [i,     j + 1, k    ],
                            [i,     j + 1, k + 1],
                        ]
                    );

                    // tet 5
                    writeTet(5 * thisIndex + 4, 
                        [
                            [i + 1, j,     k    ],
                            [i,     j + 1, k    ],
                            [i,     j,     k + 1],
                            [i + 1, j + 1, k + 1], 
                        ]
                    );
                }
            }
        }
        
        // write point positions
        for (let k = 0; k < dataSize[2]; k++) { // loop z
            for (let j = 0; j < dataSize[1]; j++) { // loop y
                for (let i = 0; i < dataSize[0]; i++) { // loop x
                    // write the position
                    var thisIndex = getIndex(i, j, k);
                    writePoint(thisIndex, i, j, k);
                }
            }
        }
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
        const leafMeshBuffers = getLeafMeshBuffersAnalyse(dataObj, blockSizes, leafCount);
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

function Data(id, dataSource, dataFormat) {
    SceneObject.call(this, SceneObjectTypes.DATA, SceneObjectRenderModes.DATA_RAY_VOLUME);
    this.id = id;
    this.users = 0;
    this.config;
    this.opts;

    // what format of mesh this represents
    this.dataFormat = dataFormat
    // how the data will be presented to the user
    this.resolutionMode = ResolutionModes.FULL;

    // what this.data represents
    this.dataName = dataSource.name;
    
    // where any extra data that is needed is pulled from
    this.dataSource = dataSource;

    // the actual data store of the object
    // all entries should be typedarray objects
    this.data = {
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
    this.dynamicNodeCache;
    this.dynamicMeshCache;

    // the lengths of the blocks in the mesh buffers if a block mesh is being used
    this.meshBlockSizes;

    // any additional mesh geometry that is part of the dataset but not part of the mesh
    this.geometry = {};

    // information about the data files that have been pre-generated and are available to be laoded from the server
    this.preGeneratedInfo = {};

    this.cornerValType = null;

    this.valueCounts = [];

    // supplemental attributes
    // the dimensions in data space
    this.size = [0, 0, 0];
    // axis aligned (data space) maximum extent
    this.extentBox = {
        min: [0, 0, 0],
        max: [0, 0, 0]
    };

    // matrix that captures data space -> object space
    // includes scaling of the grid
    this.dataTransformMat = mat4.create();

    this.createFromSource = async function() {
        // source must be initialised first
        await this.dataSource.init();
        this.size = this.dataSource.size;
        this.extentBox = this.dataSource.extentBox;

        if (
            this.dataFormat == DataFormats.UNSTRUCTURED && 
            this.dataSource.format == DataFormats.UNSTRUCTURED
        ) {
            // get the mesh buffers
            this.data.positions         = this.dataSource.mesh.positions;
            this.data.cellOffsets       = this.dataSource.mesh.cellOffsets;
            this.data.cellConnectivity  = this.dataSource.mesh.cellConnectivity;
            this.data.cellTypes         = this.dataSource.mesh.cellTypes;

            this.geometry = this.dataSource.geometry;
        }
    };

    this.getAvailableDataArrays = function() {
        // all the arrays that come straight from the data source
        const sourceArrayNames = this.dataSource.getAvailableDataArrays();

        // all arrays that could be selected, including vec->scal mapped
        let dataArrayNames = [];
        let potentialVecs = {};
        for (let name of sourceArrayNames) {
            dataArrayNames.push(name);
            // detect vector data quantities
            if (!["X", "Y", "Z"].includes(name.at(-1))) continue;
            const vecName = name.substring(0, name.length - 1);
            const thisDir = name.at(-1);
            if (!potentialVecs[vecName]) {
                potentialVecs[vecName] = {};
            } 
    
            potentialVecs[vecName][thisDir] = true;
    
            if (potentialVecs[vecName]["X"] && potentialVecs[vecName]["Y"] && potentialVecs[vecName]["Z"]){
                dataArrayNames.push(vecName)
            }       
        }

        return dataArrayNames;
    };

    // returns the slot number that was written to
    // if it already is loaded, return its slot number
    this.loadDataArray = async function(name, binCount) {
        // check if already loaded
        let loadedIndex = this.data.values.findIndex(elem => elem.name == name);
        if (loadedIndex != -1) return loadedIndex;

        let newSlotNum;
        try {
            this.data.values.push(await this.dataSource.getDataArray(name));
            newSlotNum = this.data.values.length - 1;   
        } catch (e) {
            console.warn("Unable to load data array " + name + ": " + e);
            return -1;
        }
        // get the histogram if required
        if (binCount) {
            this.valueCounts[newSlotNum] = this.getValueCounts(newSlotNum, binCount);
        }

        if (ResolutionModes.DYNAMIC_CELLS & this.resolutionMode) {
            // if the data is in the normal mesh format, reformat to block mesh
            this.convertValuesToBlockMesh(newSlotNum);
            console.log("converted values");
            // create new entry in the dynamic mesh cache object
            this.createDynamicBlockValues(newSlotNum);
            console.log("created dynamic values")
        }

        // if this is dynamic, load corner values too
        if (ResolutionModes.FULL != this.resolutionMode) {
            await this.createCornerValues(newSlotNum)
            console.log("created corner vals");
        }
        // initialise the dynamic corner values buffer to match dynamic nodes
        if (ResolutionModes.DYNAMIC_NODES & this.resolutionMode) {
            this.createDynamicCornerValues(newSlotNum);
            console.log("created dynamic corners")
        }


        return newSlotNum;
    };

    // gets the data describing the mesh geometry and values for the mesh of this node
    // if this node is not a leaf, returns undefined
    this.getNodeMeshBlock = function(nodeIndex, valueSlots) {
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
                leafIndex * this.meshBlockSizes.positions/3, (leafIndex + 1) * this.meshBlockSizes.positions/3
            );
        }

        // return the buffers together
        return buffers;
    };

    this.setCornerValType = function(type) {
        this.cornerValType = type;
    };

    // creates the full corner values buffer for the full tree, using the data in the specified value slot
    this.createCornerValues = async function(slotNum) {
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
    this.createDynamicCornerValues = function(slotNum) {
        this.data.values[slotNum].dynamicCornerValues = createMatchedDynamicCornerValues(this, slotNum);
    };

    this.convertValuesToBlockMesh = function(slotNum) {
        // create new buffer to re-write values into
        // if vert count < block length, value of vert 0 will be written
        const blockVals = new Float32Array(this.data.leafVerts.length);
        this.data.leafVerts.forEach((e, i) => blockVals[i] = this.getFullValues(slotNum)[e]);

        this.data.values[slotNum].data = blockVals;
    };

    this.createDynamicBlockValues = function(slotNum) {
        this.data.values[slotNum].dynamicData = createMatchedDynamicMeshValueArray(this, slotNum);
    };

    // returns the byte length of the values array
    this.getValuesByteLength = function(slotNum) {
        return this.getValues(slotNum).byteLength;
    };

    this.getLimits = function(slotNum) {
        return this.data.values[slotNum]?.limits;
    };

    // returns the positions of the boundary points
    this.getBoundaryPoints = function() {
        if (this.dataFormat == DataFormats.STRUCTURED) {
            var size = this.getDataSize();
            // extent is size -1
            var e = [size[0] - 1, size[1] - 1, size[2] - 1];
            var points = new Float32Array([
                0,    0,    0,    // 0
                e[0], 0,    0,    // 1
                0,    e[1], 0,    // 2
                e[0], e[1], 0,    // 3
                0,    0,    e[2], // 4
                e[0], 0,    e[2], // 5
                0,    e[1], e[2], // 6
                e[0], e[1], e[2]  // 7
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
                b[0], b[1], b[2]  // 7
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
            )
            points.set([
                transformedPoint[0],
                transformedPoint[1],
                transformedPoint[2]
            ], i);
        } 

        return points;
    };

    this.getMidPoint = function() {
        var points = this.getBoundaryPoints();
        var min = points.slice(0, 3);
        var max = points.slice(21, 24);

        return [
            (min[0] + max[0])/2,
            (min[1] + max[1])/2,
            (min[2] + max[2])/2,
        ];
    };

    this.getMaxLength = function() {
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
    this.getDataSize = function() {
        return this.size ?? [0, 0, 0];
    };

    // returns a string which indicates the size of the dataset for the user
    this.getDataSizeString = function() {
        if (this.dataFormat == DataFormats.STRUCTURED) {
            return this.getDataSize().join("x");
        } else if (this.dataFormat == DataFormats.UNSTRUCTURED) {
            if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS) {
                return this.data.totalCellCount.toLocaleString() + "u";
            } else {
                return this.data.cellOffsets.length.toLocaleString() + "u";
            }
        }
        return "";
    };

    this.setDataSize = function(size) {
        this.extentBox.max = size;
        this.size = size;
    };

    this.getDynamicNodeCount = function() {
        return this.data.dynamicNodeCount;
    };


    this.getValues = function(slotNum) {
        if (ResolutionModes.DYNAMIC_CELLS & this.resolutionMode) return this.getDynamicValues(slotNum);
        return this.getFullValues(slotNum);
    };

    this.getFullValues = function(slotNum) {
        return this.data.values?.[slotNum]?.data;
    };

    this.getDynamicValues = function(slotNum) {
        return this.data.values?.[slotNum]?.dynamicData;
    };

    // fetching the corner values buffers
    this.getCornerValues = function(slotNum) {
        if (ResolutionModes.DYNAMIC_NODES & this.resolutionMode) return this.getDynamicCornerValues(slotNum);
        return this.getFullCornerValues(slotNum);
    };

    this.getFullCornerValues = function(slotNum) {
        return this.data.values?.[slotNum]?.cornerValues;
    };

    this.getDynamicCornerValues = function(slotNum) {
        return this.data.values?.[slotNum]?.dynamicCornerValues;
    };
    
    this.getName = function() {
        return this.dataName ?? "Unnamed data";
    };

    // returns a mat4 encoding object space -> data space
    // includes 
    this.getdMatInv = function() {
        var dMatInv = mat4.create();
        mat4.invert(dMatInv, this.dataTransformMat);
        return dMatInv;
    };

    // returns the number of values within this.data.values that fall into a number of bins
    // bins are in the range this.limits and there are binCount number
    this.getValueCounts = function(slotNum, binCount) {
        if (this.valueCounts?.[slotNum]?.counts.length == binCount) return this.valueCounts[slotNum];
        var counts = new Uint32Array(binCount);
        var max = 0;
        var index;
        var limits = this.getLimits(slotNum);
        for (let val of this.getFullValues(slotNum)) {
            index = Math.floor((val - limits[0]) * (binCount-1)/(limits[1] - limits[0]));
            max = Math.max(max, ++counts[Math.max(0, Math.min(index, binCount-1))]);
        }
        return {
            counts: counts,
            max: max
        };
    };
}