// data.js
// handles the storing of the data object, normals etc

import { DataFormats, DataArrayTypes, ResolutionModes } from "./dataConstants.js";
import { FunctionDataSource, RawDataSource, CGNSDataSource, DownsampleStructDataSource, UnstructFromStructDataSource, TreeUnstructDataSource, BlockFromUnstructDataSource } from "./dataSource.js";

import { xyzToA } from "../utils.js";
import {vec3, vec4, mat4} from "../gl-matrix.js";
import { newId } from "../utils.js";
import { DynamicTree } from "./dynamicTree.js";

import { SceneObject, SceneObjectTypes, SceneObjectRenderModes } from "../renderEngine/sceneObjects.js";
import { DataSrcTypes } from "../renderEngine/renderEngine.js";
import { VectorMappingHandler } from "./vectorDataArray.js";

export {dataManager};


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

        // convert struct -> unstruct if needed
        if (opts.forceUnstruct) {
            if (dataSource.format == DataFormats.STRUCTURED) {
                dataSource = new UnstructFromStructDataSource(dataSource);
            } else {
                console.warn("Could not convert dataset to unstructured, dataFormat is not Dataformats.STRUCTURED");
            }
        }

        if (dataSource.format == DataFormats.UNSTRUCTURED) {
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

        if (opts.dynamicMesh) {
            dataSource = new BlockFromUnstructDataSource(dataSource);
        }

        await dataSource.init();
        console.log(dataSource);
        return dataSource;
    },

    createData: async function(config, opts) {
        const id = newId(this.datas);

        const dataSource = await this.getDataSource(config, opts);

        let dynamicTree;
        
        let resolutionMode = ResolutionModes.FULL;
        if (opts.dynamicNodes) resolutionMode |= ResolutionModes.DYNAMIC_NODES_BIT;
        if (opts.dynamicMesh) resolutionMode |= ResolutionModes.DYNAMIC_CELLS_BIT;

        if (resolutionMode != ResolutionModes.FULL) {
            dynamicTree = new DynamicTree(resolutionMode, opts.treeletDepth);
        }

        const newData = new Data(id, dataSource, dynamicTree);
        newData.opts = opts;
        console.log(config);
        console.log(opts);

        // create dynamic mesh information
        if (opts.dynamicMesh) {
            try {
                this.createDynamicMeshCache(
                    newData, 
                    dataSource.meshBlockSizes, 
                    dataSource.leafCount, 
                    opts.dynamicMeshBlockCount,
                );
                newData.resolutionMode |= ResolutionModes.DYNAMIC_CELLS_BIT;
                console.log("Created dynamic mesh dataset");
            } catch (e) {
                console.error("Could not create dataset with dynamic cells data:", e)
            }
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

        this.datas[id] = newData;
        return newData;
    },

    // create the unstructured tree with a varying subset of the nodes
    // fixed number of dynamic nodes
    createDynamicTree: function(dataObj, dynamicNodeCount) {
        console.log(dataObj.data.treeNodes);
        if (!dataObj.data.treeNodes) throw "Could not create dynamic tree, dataset does not have a tree";
        
        if (dynamicNodeCount >= dataObj.data.treeNodeCount) {
            console.warn("Attempted to create dynamic tree that is too large, creating full tree instead");
            return;
        }

        const nodeCache = dataObj.dynamicTree.createDynamicNodeCache(
            dataObj.data.treeNodes, 
            dynamicNodeCount
        );
        dataObj.data.dynamicTreeNodes = nodeCache.getBuffers()["nodes"];
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

        dynamicTreeNodes: null,
        dynamicTreeCells: null,

        leafVerts: null,
    };

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

        if (this.dataFormat == DataFormats.UNSTRUCTURED || this.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            // get the mesh buffers
            this.data.positions = this.dataSource.mesh.positions;
            this.data.cellOffsets = this.dataSource.mesh.cellOffsets;
            this.data.cellConnectivity = this.dataSource.mesh.cellConnectivity;
            this.data.cellTypes = this.dataSource.mesh.cellTypes;
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

            // set the tree nodes to be the version for the block mesh
            this.data.treeNodes = this.dataSource.blockNodes;
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
        if (
            this.resolutionMode & ResolutionModes.DYNAMIC_NODES_BIT && 
            this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT
        ) {
            // dynamic mesh with treelets and dynamic nodes
            return this.dynamicTree.getTreeCells();
        }

        // just dynamic nodes or full resolution
        return this.data.treeCells;
    }

    getNodeBlock(nodeIndex, valueSlots) {
        let nodeBlock = this.dataSource.getNodeMeshBlock(nodeIndex);
        // slice the needed value buffers
        for (const slotNum of valueSlots) {
            const values = this.getFullValues(slotNum);
            if (!values) continue;
            nodeBlock.buffers["values" + slotNum] = values.slice(...nodeBlock.valueSliceRange);
        }

        return nodeBlock.buffers
    }

    updateDynamicTree(cameraChanged, focusCoords, camCoords, activeValueSlots) {
        // getCornerValsFuncExt -> dataObj.getFullCornerValues
        // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
        this.dynamicTree.update(
            cameraChanged, 
            focusCoords, 
            camCoords, 
            this.extentBox, 
            this.getFullCornerValues.bind(this), 
            this.getNodeBlock.bind(this), 
            activeValueSlots
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
        let loadedIndex = this.data.values.findIndex(elem => elem.name == desc.name);
        if (loadedIndex != -1) return loadedIndex;

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
        // get the histogram if required
        if (binCount) {
            this.valueCounts[newSlotNum] = this.getValueCounts(newSlotNum, binCount);
        }

        if (ResolutionModes.DYNAMIC_CELLS_BIT & this.resolutionMode) {
            // if the data is in the normal mesh format, reformat to block mesh
            // create new entry in the dynamic mesh cache object
            this.createDynamicBlockValues(newSlotNum);
            console.log("created dynamic values");
        }
        // initialise the dynamic corner values buffer to match dynamic nodes
        if (ResolutionModes.DYNAMIC_NODES_BIT & this.resolutionMode) {
            this.createDynamicCornerValues(newSlotNum);
            console.log("created dynamic corners");
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
        this.data.values[slotNum].dynamicCornerValues = this.dynamicTree.createMatchedDynamicCornerValues(fullCornerValues, slotNum);
    };

    createDynamicBlockValues(slotNum) {
        this.data.values[slotNum].dynamicData = this.dynamicTree.createMatchedDynamicMeshValueArray(
            this.getNodeBlock.bind(this), 
            slotNum
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