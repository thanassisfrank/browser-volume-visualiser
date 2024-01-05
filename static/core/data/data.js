// data.js
// handles the storing of the data object, normals etc

import {VecMath} from "../VecMath.js";
import {vec3, vec4, mat4} from "https://cdn.skypack.dev/gl-matrix";
import { newId, DATA_TYPES, xyzToA, volume, parseXML, rangesOverlap, IntervalTree, timer, buildCellKDTree,  } from "../utils.js";
import { decompressB64Str, getNumPiecesFromVTS, getDataNamesFromVTS, getPointsFromVTS, getExtentFromVTS, getPointDataFromVTS, getDataLimitsFromVTS} from "./dataUnpacker.js"
import { CellTree } from "./cellTree.js";

import { SceneObject, SceneObjectTypes, SceneObjectRenderModes } from "../renderEngine/sceneObjects.js";

export {dataManager};

const blockSize = [4, 4, 4];

export const DataFormats = {
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
        
        // create dataset that isnt complex
        if (config) {
            newData.dataName = config.name;
            await newData.createSimple(config);
        }

        this.datas[id] = newData;

        return newData;
    },
    // takes a data object with format STRUCTURED and creates a new dataset with tetrahedral cells
    createUnstructuredFromStructured: async function(structuredData) {
        if (structuredData.dataFormat != DataFormats.STRUCTURED) return;
        // create blank
        var unstructuredData = await this.createData();
        unstructuredData.dataFormat = DataFormats.UNSTRUCTURED;
        console.log(unstructuredData, structuredData)
        // copy what is the same
        unstructuredData.size = structuredData.size;
        unstructuredData.limits = structuredData.limits;
        unstructuredData.dataTransformMat = structuredData.dataTransformMat;
        
        // build the cell data
        var pointCount = structuredData.data.values.length;
        var dataSize = structuredData.getDataSize();
        console.log(dataSize);
        var cubesCount = (dataSize[0] - 1)*(dataSize[1] - 1)*(dataSize[2] - 1);
        var tetsCount = cubesCount * 5;
        
        unstructuredData.data.values = new Float32Array(structuredData.data.values);
        unstructuredData.data.positions = new Float32Array(pointCount * 3);
        unstructuredData.data.cellConnectivity = new Uint32Array(tetsCount * 4); // 5 tet per hex, 4 points per tet
        unstructuredData.data.cellOffsets = new Uint32Array(tetsCount); // 5 tet per hex, 4 points per tet
        unstructuredData.data.cellTypes = new Uint32Array(tetsCount); // 5 tet per hex, 4 points per tet
        unstructuredData.data.cellTypes.fill(10); // all tets

        var getIndex = (i, j, k) => {
            return k * dataSize[0] * dataSize[1] + j * dataSize[0] + i;
        }
        var writeTet = (cellIndex, coords) => {
            var cellOffset = cellIndex * 4;
            unstructuredData.data.cellOffsets[cellIndex] = cellOffset;
            unstructuredData.data.cellConnectivity[cellOffset    ] = getIndex(...coords[0]);
            unstructuredData.data.cellConnectivity[cellOffset + 1] = getIndex(...coords[1]);
            unstructuredData.data.cellConnectivity[cellOffset + 2] = getIndex(...coords[2]);
            unstructuredData.data.cellConnectivity[cellOffset + 3] = getIndex(...coords[3]);
        }

        var writePoint = (pointIndex, x, y, z) => {
            unstructuredData.data.positions[3 * pointIndex    ] = x;
            unstructuredData.data.positions[3 * pointIndex + 1] = y;
            unstructuredData.data.positions[3 * pointIndex + 2] = z;
        }
        
        // rip hexahedra
        for (let k = 0; k < dataSize[2] - 1; k++) { // loop z
            for (let j = 0; j < dataSize[1] - 1; j++) { // loop y
                for (let i = 0; i < dataSize[0] - 1; i++) { // loop x
                    var thisIndex = getIndex(i, j, k);
                    // tet 1
                    writeTet(5 * thisIndex, 
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
                            [i,     j + 1, k    ],
                            [i + 1, j + 1, k    ], 
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
                            [i,     j + 1, k + 1],
                            [i,     j + 1, k    ],
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
                    writePoint(thisIndex, i, j, k);
                }
            }
        }

        return unstructuredData;

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
        SceneObject.call(this, SceneObjectTypes.DATA, SceneObjectRenderModes.DATA_RAY_VOLUME);
        this.id = id;
        this.users = 0;
        this.config;

        // what kind of data file this contains
        this.dataFormat = DataFormats.EMPTY;

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
                this.dataFormat = DataFormats.STRUCTURED;
                const responseBuffer = await fetch(config.path).then(resp => resp.arrayBuffer());
                this.data.values = new DATA_TYPES[config.dataType](responseBuffer);
                this.limits = config.limits;

                this.size = [config.size.z, config.size.y, config.size.x];
                if (config.cellSize) {
                    this.dataTransformMat = mat4.fromScaling(mat4.create(), [config.cellSize.z, config.cellSize.y, config.cellSize.x])
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
                this.dataFormat = DataFormats.STRUCTURED_GRID;
            } else if (config.type == "unstructured") {
                this.dataFormat = DataFormats.UNSTRUCTURED;
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
            if (this.dataFormat == DataFormats.STRUCTURED || this.dataFormat == DataFormats.STRUCTURED_GRID) {
                // swizel dimensions so they're accurate
                return this.size;
            } else {
                return [0, 0, 0];
            }
        }
        this.getValues = function() {
            return this.data.values;
        }

        // generates the cell tree for fast lookups in unstructured data
        this.getCellTreeBuffer = function() {
            var depth = 1;
            var tree = new CellTree();
            // dimensions, depth, points, cellConnectivity, cellOffsets, cellTypes
            tree.build(
                3, 
                depth, 
                this.data.positions, 
                this.data.cellConnectivity,
                this.data.cellOffsets,
                new Uint32Array(this.data.cellOffsets.length).fill(10)
            );
            console.log(this.data.positions);    
            console.log(tree);
            return tree.serialise();
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