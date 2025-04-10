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
// import { VectorMappingHandler } from "./dataSource/vectorDataArray.js";
import { NodeScorer } from "./dynamic/nodeScorer.js";
import { DynamicMesh } from "./dynamic/dynamicMesh.js";
import { boxSize } from "../boxUtils.js";


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
            dynamicNodeCount: getAsAbsolute(opts.dynamicNodeCount, dataSource.tree?.nodeCount),
            dynamicMeshCount: getAsAbsolute(opts.dynamicMeshBlockCount, dataSource?.leafCount),
            nodeHysteresis: opts.nodeHysteresis,
            treeletDepth: opts.treeletDepth,
        };

        return new Data(dataSource, resolutionMode, dataOpts);
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
        // this.mappingHandler = new VectorMappingHandler(dataSource);;

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
        return this.dataSource.tree?.nodes;
    }

    getTreeCells() {
        if (this.#dynamicMesh) return this.#dynamicMesh.getTreeCells();

        // just dynamic nodes or full resolution
        return this.dataSource.tree?.cells;
    }

    async updateDynamicTree(camInfo, isoInfo, activeValueNames) {
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
        // const mappingOutputNames = this.mappingHandler.getPossibleMappings(sourceArrayDescriptors);
        // const calcArrayDescriptors = mappingOutputNames.map(v => {
        //     return {name: v, arrayType: DataArrayTypes.CALC}
        // });

        const allArrayDescriptors = [
            ...sourceArrayDescriptors,
            // ...calcArrayDescriptors
        ];

        return allArrayDescriptors.map(v => {
            return {...v, type: DataSrcTypes.ARRAY}
        });
    };

    // returns the slot number that was written to
    // if it is already is loaded, return its slot number
    async loadDataArray(desc) {
        const { name } = desc;
 
        const { limits } = await this.dataSource.getDataArray(desc);

        if (!limits) return;

        await this.#dynamicMesh?.createValueArray(name);
        this.#dynamicTree?.createMatchedDynamicCornerValues(name);

        return {limits};
    };

    setCornerValType(type) {
        this.cornerValType = type;
    };

    getLimits(name) {
        return this.dataSource.getDataArray({name}).limits;
    };

    // returns the extent of the values in datapoints
    // only useful for structured data
    getDataSize() {
        return this.dataSource.size;
    }

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

    // returns a string which indicates the size of the dataset for the user
    getDataSizeString() {
        if (this.dataFormat == DataFormats.STRUCTURED) {
            return boxSize(this.extentBox).join("x");
        } else if (this.dataFormat == DataFormats.UNSTRUCTURED) {
            return this.data.cellOffsets.length.toLocaleString() + "u";
        } else if (this.dataFormat == DataFormats.BLOCK_UNSTRUCTURED) {
            return this.dataSource.totalCellCount.toLocaleString() + "u";
        }
        return "";
    };

    async getValues(name) {
        if (ResolutionModes.DYNAMIC_CELLS_BIT & this.resolutionMode) {
            return this.#dynamicMesh.getBuffers()[name];
        } else {
            return (await this.dataSource.getDataArray({name})).values;
        }
    };

    // fetching the corner values buffers
    getCornerValues(name) {
        if (ResolutionModes.DYNAMIC_NODES_BIT & this.resolutionMode) {
            return this.#dynamicTree.getCornerValues(name);
        } else {
            return this.dataSource.getDataArray({name}).cornerValues;
        }
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
}