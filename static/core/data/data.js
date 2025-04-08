// data.js
// handles the storing of the data object, normals etc

import { DataFormats, DataArrayTypes, ResolutionModes } from "./dataConstants.js";
import { 
    FunctionDataSource, 
    RawDataSource, 
    CGNSDataSource, 
    DownsampleStructDataSource, 
    UnstructFromStructDataSource, 
    TreeUnstructDataSource, 
    BlockFromUnstructDataSource, 
    PartialCGNSDataSource 
} from "./dataSource/dataSource.js";

import { xyzToA } from "../utils.js";
import {vec3, vec4, mat4} from "../gl-matrix.js";
import { DynamicTree } from "./dynamic/dynamicTree.js";

import { DataSrcTypes } from "../renderEngine/renderEngine.js";
import { VectorMappingHandler } from "./dataSource/vectorDataArray.js";
import { NodeScorer } from "./dynamic/nodeScorer.js";
import { DynamicMesh } from "./dynamic/dynamicMesh.js";
import { VecMath } from "../VecMath.js";


const getAsAbsolute = (x, max) => {
    let val;
    if (typeof x == 'string' || x instanceof String) {
        // treat as a percentage of total nodes
        if (!x.includes("%")) throw Error("Value is string but not percentage");

        const proportion = parseFloat(x)/100;
        
        val =  Math.round(max * proportion);
    } else {
        val =  x;
    }

    return Math.max(0, Math.min(val, max));
};


// object in charge of creating, transforming and deleting data objects
export const dataManager = {
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
        
        let resolutionMode = ResolutionModes.FULL;
        if (opts.dynamicNodes) resolutionMode |= ResolutionModes.DYNAMIC_NODES_BIT;
        if (opts.dynamicMesh) resolutionMode |= ResolutionModes.DYNAMIC_CELLS_BIT;

        const dataOpts = {
            dynamicNodeCount: getAsAbsolute(opts.dynamicNodeCount, dataSource.tree.nodeCount),
            dynamicMeshCount: getAsAbsolute(opts.dynamicMeshBlockCount, dataSource.leafCount),
            nodeHysteresis: opts.nodeHysteresis,
            treeletDepth: opts.treeletDepth,
        };

        const newData = new Data(dataSource, resolutionMode, dataOpts);

        return newData;
    },
}


export class Data {
    // the source of all data
    dataSource;
    // how the data will be presented to the user
    resolutionMode = ResolutionModes.FULL;    

    /** @type {NodeScorer} */
    #nodeScorer;
    /** @type {DynamicTree} */
    #dynamicTree;
    /** @type {DynamicMesh} */
    #dynamicMesh;

    usesTreelets;

    cornerValType;


    // the actual data store of the object
    // all entries should be typedarray objects
    data = {
        // the data values
        values: [
            // {name: null, data: null, cornerValues: null, limits: [null, null]},
        ]
    };

    // mapping from value name -> slot number
    valueDirectory = {};

    valueCounts = [];

    // matrix that captures data space -> object space
    // includes scaling of the grid
    dataTransformMat = mat4.create();
    
    // source must be initialised first
    constructor(dataSource, resolutionMode, opts) {
        // where data to be stored here is pulled from
        this.dataSource = dataSource;
        // if this dataset has dynamic nodes and/or mesh
        this.resolutionMode = resolutionMode;

        // what format of mesh this represents
        this.dataFormat = dataSource.format;
        // the display name
        this.dataName = dataSource.name;
        // for calculation of new data arrays
        this.mappingHandler = new VectorMappingHandler(dataSource);;

        // axis aligned (data space) maximum extent
        this.extentBox = this.dataSource.extentBox;
        
        if (this.dataSource.tree) {            
            this.cornerValType = dataSource.cornerValType;
            if (opts.treeletDepth > 0) {
                this.usesTreelets = true;
            }
        }

        if (this.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            // the lengths of the blocks in the mesh buffers if a block mesh is being used
            this.meshBlockSizes = this.dataSource.meshBlockSizes
        }

        if (resolutionMode != ResolutionModes.FULL) {
            // create a node scorer
            this.#nodeScorer = new NodeScorer(this.dataSource, this.extentBox);
        }

        if (this.resolutionMode & ResolutionModes.DYNAMIC_NODES_BIT) {
            this.#dynamicTree = new DynamicTree(
                this.dataSource,
                opts.dynamicNodeCount,
                {
                    hysteresis: opts.nodeHysteresis
                }
            );
        }

        if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            this.#dynamicMesh = new DynamicMesh(
                this.dataSource, 
                opts.dynamicMeshCount, 
                opts.treeletDepth
            );
        }

    }

    getMesh() {
        if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            return this.#dynamicMesh.getBuffers();
        } else {
            return this.dataSource.mesh;
        }
    }

    // returns the block sizes of all the buffers which are blocked
    getBufferBlockSizes() {
        if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            return this.#dynamicMesh.getBlockSizes();
        }
        return this.dataSource.meshBlockSizes
    }

    // returns either the correct node buffer given resolution mode
    getNodeBuffer() {
        if (this.resolutionMode !== ResolutionModes.FULL) {
            const dynamicNodes = this.#dynamicTree.getNodeBuffer();
            const treeletNodes = this.#dynamicMesh.getTreeletBuffer();

            if (!treeletNodes) return dynamicNodes;

            const combinedNodes = new Uint8Array(dynamicNodes.byteLength + treeletNodes.length);
            combinedNodes.set(new Uint8Array(dynamicNodes), 0);
            combinedNodes.set(treeletNodes, dynamicNodes.byteLength);

            // return the array buffer
            return combinedNodes.buffer;
        }
        
        // full unstructured tree
        return this.data.treeNodes;
    }

    getTreeCells() {
        if (this.#dynamicMesh) return this.#dynamicMesh.getTreeCells();

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

    async updateDynamicTree(camInfo, isoInfo, activeValueSlots) {
        const activeValueNames = activeValueSlots.map(i => this.data.values[i].name);

        // get the scores
        const scores = this.#nodeScorer.getNodeScores(
            this.#dynamicTree.nodeCache, 
            camInfo, 
            isoInfo
        );

        if (this.#dynamicTree) {
            if (camInfo.changed || isoInfo.changed) {
                // reset the record of modifications to nodes
                this.#dynamicTree.resetUpdateStates();
            }
            // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
            this.#dynamicTree.update(
                scores,
                activeValueNames,
                this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT
            );
        }

        if (this.#dynamicMesh) {
            this.#dynamicMesh.update(
                scores,
                this.#dynamicTree.nodeCache,
                activeValueNames
            );
        }
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
    async loadDataArray(desc) {
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

        await this.#dynamicMesh?.createValueArray(desc.name);

        this.#dynamicTree?.createMatchedDynamicCornerValues(desc.name);

        return newSlotNum;
    };

    setCornerValType(type) {
        this.cornerValType = type;
    };

    getLimits(slotNum) {
        return this.data.values[slotNum]?.limits;
    };

    getMidPoint() {
        const { min, max } = this.extentBox;

        return [
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2,
        ];
    };

    getMaxLength() {
        const { min, max } = this.extentBox;

        return vec3.length([
            min[0] - max[0],
            min[1] - max[1],
            min[2] - max[2],
        ]);
    };

    // for structured formats, this returns the dimensions of the data grid in # data points
    getDataSize() {
        return VecMath.vecMinus(this.extentBox.max, this.extentBox.min);
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

    getValues(slotNum) {
        if (ResolutionModes.DYNAMIC_CELLS_BIT & this.resolutionMode) return this.getDynamicValues(slotNum);
        return this.getFullValues(slotNum);
    };

    getFullValues(slotNum) {
        return this.data.values?.[slotNum]?.data;
    };

    getDynamicValues(slotNum) {
        const scalarName = this.data.values[slotNum].name;
        return this.#dynamicMesh.getBuffers()[scalarName];
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
        const scalarName = this.data.values[slotNum].name;
        return this.#dynamicTree.getCornerValues(scalarName);
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