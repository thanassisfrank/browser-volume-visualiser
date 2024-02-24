// data.js
// handles the storing of the data object, normals etc

import {VecMath} from "../VecMath.js";
import {vec3, vec4, mat4} from "https://cdn.skypack.dev/gl-matrix";
import { newId, DATA_TYPES, xyzToA, volume, parseXML, rangesOverlap, IntervalTree, timer, buildCellKDTree,  } from "../utils.js";
import { decompressB64Str, getNumPiecesFromVTS, getDataNamesFromVTS, getPointsFromVTS, getExtentFromVTS, getPointDataFromVTS, getDataLimitsFromVTS} from "./dataUnpacker.js"
import { createDynamicTreeBuffers, getCellTreeBuffers } from "./cellTree.js";

import { SceneObject, SceneObjectTypes, SceneObjectRenderModes } from "../renderEngine/sceneObjects.js";

export {dataManager};

const blockSize = [4, 4, 4];

export const DataFormats = {
    EMPTY:           0,  // undefined/empty
    STRUCTURED:      1,  // data points are arranged as a contiguous texture
    STRUCTURED_GRID: 2,  // data is arranged as a contiguous 3d texture, each point has a sumplemental position
    UNSTRUCTURED:    4,  // data points have a value and position, supplemental connectivity information
}

export const ResolutionModes = {
    FULL:    0, // resolution is fixed at the maximum 
    DYNAMIC: 1, // the resolution is variable
}

// object that manages data object instances
// types of data object creatable:
// - from a function
//   a function is supplied as well as dimensions and the full dataset is generated on creation
// - from a file (simple)
//   a source path is specified and the whole dataset is loaded on creation

var dataManager = {
    datas: {},
    // directory of data objects corresponding to each dataset
    directory: {},
    // keep the config set too
    configSet: {},
    // called by outside code to generate a new data object
    // config object form:
    // {
    //     "name": "engine",
    //     "path": "engine_256x256x128_uint8.raw",
    //     "type": "raw",
    //     "size": {
    //         "x": 128,
    //         "y": 256,
    //         "z": 256
    //     },
    //     "cellSize": {
    //         "x": 1,
    //         "y": 1,
    //         "z": 1
    //     },
    //     "dataType": "uint8"
    //     "f": some function
    //     "accessType": "whole"/"complex"
    // }
    setConfigSet: function(configSet) {
        this.configSet = configSet;
        for (let id in configSet) {
            this.configSet[id].id = id;
            this.directory[id] = null;
        }
    },
    getDataObj: async function(configId) {
        // returns already created data object if it exists
        if (this.directory[configId]) {
            return this.directory[configId];
        }
        // else, creates a new one
        var newDataObj = await this.createData(this.configSet[configId]);
        this.directory[configId] = newDataObj;
        // await this.setupDataObj(newDataObj);
        return newDataObj; 
    },
    createData: async function(config) {
        const id = newId(this.datas);
        var newData = new Data(id);
        console.log(config);
        
        // create dataset that isnt complex
        if (config) {
            newData.dataName = config.name;
            await newData.createSimple(config);
        }

        this.datas[id] = newData;

        return newData;
    },
    // takes a data object with format STRUCTURED and converts to UNSTRUCTRED with tetrahedral cells
    convertStructuredToUnstructured: function(dataObj, resolutionMode) {
        if (dataObj.dataFormat != DataFormats.STRUCTURED) return;

        // change type and resolution mode
        dataObj.dataFormat = DataFormats.UNSTRUCTURED;
        dataObj.resolutionMode = resolutionMode;
        
        // build the cell data
        var pointCount = dataObj.data.values.length;
        var dataSize = dataObj.getDataSize(); // the size in data points
        console.log(dataSize);
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
        
        // looks like only last tet is being written/read
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

                    // // tet 2
                    writeTet(5 * thisIndex + 1, 
                        [
                            [i + 1, j,     k    ],
                            [i + 1, j + 1, k    ], 
                            [i,     j + 1, k    ],
                            [i + 1, j + 1, k + 1],
                        ]
                    );
                        
                    // // tet 3
                    writeTet(5 * thisIndex + 2, 
                        [
                            [i,     j,     k + 1],
                            [i + 1, j + 1, k + 1],
                            [i + 1, j,     k + 1],
                            [i + 1, j,     k    ],
                        ]
                    );

                    // // tet 4
                    writeTet(5 * thisIndex + 3, 
                        [
                            [i,     j,     k + 1],
                            [i + 1, j + 1, k + 1],
                            [i,     j + 1, k    ],
                            [i,     j + 1, k + 1],
                        ]
                    );

                    // // tet 5
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

        // create the cell tree
        const treeBuffers = getCellTreeBuffers(dataObj);
        dataObj.data.treeNodes = treeBuffers.nodes;
        dataObj.data.treeCells = treeBuffers.cells;
        if (resolutionMode == ResolutionModes.DYNAMIC) {
            dataObj.data.dynamicTreeNodes = createDynamicTreeBuffers(dataObj, 500);
        }
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


function Data(id) {
    SceneObject.call(this, SceneObjectTypes.DATA, SceneObjectRenderModes.DATA_RAY_VOLUME);
    this.id = id;
    this.users = 0;
    this.config;

    // what kind of data file this contains
    this.dataFormat = DataFormats.EMPTY;
    // how the data will be presented to the user
    this.resolutionMode = ResolutionModes.FULL;

    // what this.data represents
    this.dataName = "";
    
    // the actual data store of the object
    // all entries should be typedarray objects
    this.data = {
        // only 1 time step supported for now
        values: null,
        positions: null,
        cellConnectivity: null,
        cellOffsets: null,
        cellTypes: null,
        // spatial acceleration structure
        treeNodes: null,
        treeCells: null,
        dynamicTreeNodes: null,
        dynamicTreeCells: null,
    };

    // supplemental attributes
    // the dimensions in data space
    this.size = [];
    // min, max of all data values
    this.limits = [undefined, undefined];

    // matrix that captures data space -> object space
    // includes scaling of the grid
    this.dataTransformMat = mat4.create();

    this.createSimple = async function(config) {
        this.config = config;
        if (config.f) {
            this.dataFormat = DataFormats.STRUCTURED;
            this.generateData(config);
        } else if (config.type == "raw") {
            this.dataFormat = DataFormats.STRUCTURED;
            const responseBuffer = await fetch(config.path).then(resp => resp.arrayBuffer());
            this.data.values = new DATA_TYPES[config.dataType](responseBuffer);
            this.limits = config.limits;

            console.log("made structured data obj")

            
        } else if (config.type == "structuredGrid") {
            this.dataFormat = DataFormats.STRUCTURED_GRID;
        } else if (config.type == "unstructured") {
            this.dataFormat = DataFormats.UNSTRUCTURED;
        }

        this.size = [config.size.z, config.size.y, config.size.x];
        this.dataTransformMat = mat4.fromScaling(mat4.create(), [config.cellSize.z, config.cellSize.y, config.cellSize.x])
        this.dataTransformMat = mat4.fromValues(
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        )
        
        this.initialised = true;
    };

    this.generateData = async function(config) {
        const x = config.size.x;
        const y = config.size.y;
        const z = config.size.z;
        const f = config.f;
        let v = 0.0;
        this.data.values = new Float32Array(x * y * z);
        for (let i = 0; i < x; i++) {
            for (let j = 0; j < y; j++) {
                for (let k = 0; k < z; k++) {
                    // values are clamped to >= 0
                    v = Math.max(0, f(i, j, k));
                    if (!this.limits[0] || v < this.limits[0]) {
                        this.limits[0] = v;
                    } else if (!this.limits[1] || v > this.limits[1]) {
                        this.limits[1] = v;
                    }
                    this.data.values[i * y * z + j * z + k] = v;
                }
            }
        }
    };
    this.getLimits = function() {
        this.limits[undefined, undefined];
        for(let i = 0; i < this.data.length; i++) {
            let v = this.data[i];
            if (!this.limits[0] || v < this.limits[0]) {
                this.limits[0] = v;
            } else if (!this.limits[1] || v > this.limits[1]) {
                this.limits[1] = v;
            }
        }
        console.log(this.limits);
    };
    // returns the byte length of the values array
    this.getValuesByteLength = function() {
        return this.data.values.byteLength;
    }
    // returns the positions of the boundary points
    this.getBoundaryPoints = function() {
        var size = this.getDataSize();
        // extent is size -1
        var e = [size[0] - 1, size[1] - 1, size[2] - 1];
        var points = new Float32Array([
            0,       0,       0,       // 0
            e[0], 0,       0,       // 1
            0,       e[1], 0,       // 2
            e[0], e[1], 0,       // 3
            0,       0,       e[2], // 4
            e[0], 0,       e[2], // 5
            0,       e[1], e[2], // 6
            e[0], e[1], e[2]  // 7
        ])
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
    }
    this.getMidPoint = function() {
        var points = this.getBoundaryPoints();
        var min = points.slice(0, 3);
        var max = points.slice(21, 24);

        return [
            (min[0] + max[0])/2,
            (min[1] + max[1])/2,
            (min[2] + max[2])/2,
        ]
    }
    this.getMaxLength = function() {
        var points = this.getBoundaryPoints();
        var min = points.slice(0, 3);
        var max = points.slice(21, 24);

        return vec3.length([
            min[0] - max[0],
            min[1] - max[1],
            min[2] - max[2],
        ])
    }
    // for structured formats, this returns the dimensions of the data grid in # data points
    this.getDataSize = function() {
        return this.size;
    }
    this.getValues = function() {
        return this.data.values;
    }
    this.getName = function() {
        return this.config.name || "Unnamed data";
    }

    // returns a mat4 encoding object space -> data space
    // includes 
    this.getdMatInv = function() {
        var dMatInv = mat4.create();
        mat4.invert(dMatInv, this.dataTransformMat);
        return dMatInv;
    }
}