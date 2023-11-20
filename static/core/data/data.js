// data.js
// handles the storing of the data object, normals etc

import {VecMath} from "../VecMath.js";
import {vec3, vec4, mat4} from "https://cdn.skypack.dev/gl-matrix";
import { newId, DATA_TYPES, xyzToA, volume, parseXML, rangesOverlap, IntervalTree, timer } from "../utils.js";
import { decompressB64Str, getNumPiecesFromVTS, getDataNamesFromVTS, getPointsFromVTS, getExtentFromVTS, getPointDataFromVTS, getDataLimitsFromVTS} from "./dataUnpacker.js"

export {dataManager};

const blockSize = [4, 4, 4];

const DATA_FORMATS = {
    EMPTY:           0,  // undefined/empty
    STRUCTURED:      1,  // data points are arranged as a contiguous texture
    STRUCTURED_GRID: 2,  // data is arranged as a contiguous 3d texture, each point has a sumplemental position
    UNSTRUCTURED:    4,  // data points have a value and position, supplemental connectivity information
}

// object that manages data object instances
// types of data object creatable:
// - from a function
//   a function is supplied as well as dimensions and the full dataset is generated on creation
// - from a file (simple)
//   a source path is specified and the whole dataset is loaded on creation
// - from a file (complex)
//   a dataset name is specified and a coars global set of data is loaded on creation
//   when marching, a finer set of data for the threshold region can be requested
// - from a VTS file
//   structured grid is specified
//   if the file is multiblock, a separate data object will be stored for each

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
        var newData = new this.Data(id);
        console.log(config);
        newData.dataName = config.name;

        // create dataset that isnt complex
        await newData.createSimple(config);

        this.datas[id] = newData;

        return newData;
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
    Data: function(id) {
        this.id = id;
        this.users = 0;
        this.config;

        // what kind of data file this contains
        this.dataFormat = DATA_FORMATS.EMPTY;

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
                this.generateData(config);
            } else if (config.type == "raw") {
                this.dataFormat = DATA_FORMATS.STRUCTURED;
                const responseBuffer = await fetch(config.path).then(resp => resp.arrayBuffer());
                this.data.values = new DATA_TYPES[config.dataType](responseBuffer);
                this.limits = config.limits;

                this.size = xyzToA(config.size);
                if (config.cellSize) {
                    this.dataTransformMat = mat4.fromScaling(mat4.create(), xyzToA(config.cellSize))
                    this.dataTransformMat = mat4.fromValues(
                        1, 0, 0, 0,
                        0, 1, 0, 0,
                        0, 0, 1, 0,
                        0, 0, 0, 1,
                    )
                } else {
                    
                }
                console.log("made structured data obj")
    
                
            } else if (config.type == "structuredGrid") {
                this.dataFormat = DATA_FORMATS.STRUCTURED_GRID;
            } else if (config.type == "unstructured") {
                this.dataFormat = DATA_FORMATS.UNSTRUCTURED;
            }
            
            this.initialised = true;
        };

        this.generateData = async function(config) {
            if (config.type == "structuredGrid") {
                const numPieces = config.blocks;
                var extents = [];
                var limits = [];
                this.structuredGrid = true;
                for (let i = 0; i < numPieces; i++) {
                    var p;
                    if (numPieces == 1) {
                        p = this;
                    } else {
                        this.pieces[i] = await dataManager.createData({});
                        this.pieces[i].structuredGrid = true;
                        var p = this.pieces[i];
                        this.multiBlock = true;
                    }
                    
                    const result = config.f(i);
                    p.limits = result.limits;
                    limits.push(result.limits);
                    p.size = result.size;
                    extents.push(result.size);
                    p.data = result.data;
                    p.points = result.points;
                }
                this.initialiseVTS(numPieces, extents, limits);
                console.log(extents, limits);
                
            } else {
                const x = config.size.x;
                const y = config.size.y;
                const z = config.size.z;
                const f = config.f;
                let v = 0.0;
                this.data = new Float32Array(x * y * z);
                for (let i = 0; i < x; i++) {
                    for (let j = 0; j < y; j++) {
                        for (let k = 0; k < z; k++) {
                            // values are clamped to >= 0
                            v = Math.max(0, f(i, j, k));
                            if (!this.limits[0] || v < this.limits[0]) {
                                this.limits[0] = v;
                            } else if (!this.limits[1] || v > this.limits[1]) {
                                this.limits[1] = v;
                            }this.data[i * y * z + j * z + k] = v;
                            
                        }
                    }
                }
                console.log(this.limits);
            }
        };
        this.setCellSize = function(size) {
            this.cellSize = size;
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
        this.getDatasetBoundaryPoints = function() {
            var size = this.getDataSize();
            var points = new Float32Array([
                0,       0,       0,       // 0
                size[0], 0,       0,       // 1
                0,       size[1], 0,       // 2
                size[0], size[1], 0,       // 3
                0,       0,       size[2], // 4
                size[0], 0,       size[2], // 5
                0,       size[1], size[2], // 6
                size[0], size[1], size[2]  // 7
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
            var points = this.getDatasetBoundaryPoints();
            var min = points.slice(0, 3);
            var max = points.slice(21, 24);

            return [
                (min[0] + max[0])/2,
                (min[1] + max[1])/2,
                (min[2] + max[2])/2,
            ]
        }
        this.getMaxLength = function() {
            var points = this.getDatasetBoundaryPoints();
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
            if (this.dataFormat == DATA_FORMATS.STRUCTURED || this.dataFormat == DATA_FORMATS.STRUCTURED_GRID) {
                // swizel dimensions so they're accurate
                return [this.size[2], this.size[1], this.size[0]];
            } else {
                return [0, 0, 0];
            }
        }
        this.getValues = function() {
            return this.data.values;
        }

        // returns a mat4 encoding object space -> data space
        // includes 
        this.getdMatInv = function() {
            var dMatInv = mat4.create();
            mat4.invert(dMatInv, this.dataTransformMat);
            return dMatInv;
        }
    },
    deleteData: function(data) {
        // cleanup the data used by the march module
        if (data.multiBlock) {
            for (let subData of data.pieces) {
                this.removeUser(subData);
            }
        }
        for (let id in this.directory) {
            if (this.directory[id] == data) {
                this.directory[id] = null;
            }
        }
        this.marchEngine.cleanupMarchData(data);
        delete this.datas[data.id];
    }
}