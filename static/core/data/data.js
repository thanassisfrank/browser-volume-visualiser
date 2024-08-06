// data.js
// handles the storing of the data object, normals etc

import {vec3, vec4, mat4} from "https://cdn.skypack.dev/gl-matrix";
import { newId, DATA_TYPES} from "../utils.js";
import { addNodeValsToFullTree, createDynamicTreeBuffers, createNodeValuesBuffer, createNodeCornerValuesBuffer, getCellTreeBuffers } from "./cellTree.js";
import h5wasm from "https://cdn.jsdelivr.net/npm/h5wasm@0.4.9/dist/esm/hdf5_hl.js";
import * as cgns from "./cgns_hdf5.js";

import { SceneObject, SceneObjectTypes, SceneObjectRenderModes } from "../renderEngine/sceneObjects.js";

export {dataManager};

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
        newData.dataName = config.name;
        console.log(config);
        
        // create the dataset from the config
        try {
            switch (config.type) {
                case "function":
                    newData.createFromFunction(config);
                    break;
                case "raw":
                    await newData.createFromRaw(config);
                    break;
                case "cgns":
                    await newData.createFromCGNS(config);
                    break;
            }
        } catch (e) {
            console.error("Unable to create dataset:", e);
            return undefined;
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
    // takes a data object with format STRUCTURED and converts to UNSTRUCTRED with tetrahedral cells
    // resolution specified the stride within which to create the unstructured cells
    convertStructuredToUnstructured: function(dataObj, resolutionMode, leafCells, dynamicNodeCount, nodeVals, cornerVals) {
        if (dataObj.dataFormat != DataFormats.STRUCTURED) return;

        // change type and resolution mode
        dataObj.dataFormat = DataFormats.UNSTRUCTURED;
        dataObj.resolutionMode = resolutionMode;

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
        const treeBuffers = getCellTreeBuffers(dataObj, leafCells);
        dataObj.data.treeNodes = treeBuffers.nodes;
        dataObj.data.treeCells = treeBuffers.cells;

        // need at least an empty buffer here, the render engine expects
        dataObj.data.cornerValues = new Float32Array(64);

        if (nodeVals) {
            dataObj.data.nodeVals = createNodeValuesBuffer(dataObj);
            addNodeValsToFullTree(dataObj.data.treeNodes, dataObj.data.nodeVals);
        }
        if (cornerVals) {
            dataObj.data.cornerValues = createNodeCornerValuesBuffer(dataObj);
        }

        if (resolutionMode == ResolutionModes.DYNAMIC) {
            var dynamicBuffers = createDynamicTreeBuffers(dataObj, dynamicNodeCount);
            dataObj.data.dynamicTreeNodes = dynamicBuffers.nodes;
            dataObj.data.dynamicCornerValues = dynamicBuffers.cornerValues;
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
    this.size = [0, 0, 0];
    // min, max of all data values
    this.limits = [undefined, undefined];

    // matrix that captures data space -> object space
    // includes scaling of the grid
    this.dataTransformMat = mat4.create();

    this.createFromFunction = function(config) {
        this.config = config;
        this.dataFormat = DataFormats.STRUCTURED;
        this.generateData(config);

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

    this.createFromRaw = async function(config) {
        this.config = config;
        this.dataFormat = DataFormats.STRUCTURED;
        const responseBuffer = await fetch(config.path).then(resp => resp.arrayBuffer());
        this.data.values = new DATA_TYPES[config.dataType](responseBuffer);
        this.limits = config.limits;

        this.size = [config.size.z, config.size.y, config.size.x];
        this.dataTransformMat = mat4.fromScaling(mat4.create(), [config.cellSize.z, config.cellSize.y, config.cellSize.x])
        this.dataTransformMat = mat4.fromValues(
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        );
        
        this.initialised = true;
    };

    this.createFromCGNS = async function(config) {
        this.config = config;
        // test hdf5
        // the WASM loads asychronously, and you can get the module like this:
        const { FS } = await h5wasm.ready;

        const responseBuffer = await fetch(config.path).then(resp => resp.arrayBuffer());

        FS.writeFile("yf17_hdf5.cgns", new Uint8Array(responseBuffer));
        // use mode "r" for reading.  All modes can be found in h5wasm.ACCESS_MODES
        let f = new h5wasm.File("yf17_hdf5.cgns", "r");

        var CGNSBaseNode = cgns.getChildWithLabel(f, "CGNSBase_t"); // get first base node
        var CGNSZoneNode = cgns.getChildWithLabel(CGNSBaseNode, "Zone_t"); // get first zone node in base node
        var zoneTypeNode = cgns.getChildWithLabel(CGNSZoneNode, "ZoneType_t"); // get zone type node
        
        // only unstructured zones are currently supported
        var zoneTypeStr = String.fromCharCode(...zoneTypeNode.get(" data").value);
        if (zoneTypeStr != "Unstructured") {
            throw "Unsupported ZoneType of '" + zoneTypeStr + "'";
        }

        var elementsNode = cgns.getChildWithLabel(CGNSZoneNode, "Elements_t"); // get zone type node
        var coordsNode = cgns.getChildWithLabel(CGNSZoneNode, "GridCoordinates_t");
        var coordsXNode = cgns.getChildWithName(coordsNode, "CoordinateX");
        var coordsYNode = cgns.getChildWithName(coordsNode, "CoordinateY");
        var coordsZNode = cgns.getChildWithName(coordsNode, "CoordinateZ");

        const pointsCount = coordsXNode.get(" data").shape[0];

        var coordsX = coordsXNode.get(" data").value;
        var coordsY = coordsYNode.get(" data").value;
        var coordsZ = coordsZNode.get(" data").value;

        // console.log(coordsX);

        var min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
        var max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

        this.data.positions = new Float32Array(pointsCount * 3);
        for (let i = 0; i < pointsCount; i++) {
            this.data.positions[3*i + 0] = coordsX[i];
            this.data.positions[3*i + 1] = coordsY[i];
            this.data.positions[3*i + 2] = coordsZ[i];

            min = [Math.min(min[0], coordsX[i]), Math.min(min[1], coordsY[i]), Math.min(min[2], coordsZ[i])];
            max = [Math.max(max[0], coordsX[i]), Math.max(max[1], coordsY[i]), Math.max(max[2], coordsZ[i])];
        }

        console.log("Spatial extent:", min, max);

        // console.log(this.data.positions);
    }

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
    // data limits
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
            0,    0,    0,    // 0
            e[0], 0,    0,    // 1
            0,    e[1], 0,    // 2
            e[0], e[1], 0,    // 3
            0,    0,    e[2], // 4
            e[0], 0,    e[2], // 5
            0,    e[1], e[2], // 6
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
        return this.size ?? [0, 0, 0];
    }
    this.setDataSize = function(size) {
        this.size = size;
    }
    this.getValues = function() {
        return this.data.values;
    }
    this.getName = function() {
        return this?.config?.name || "Unnamed data";
    }

    // returns a mat4 encoding object space -> data space
    // includes 
    this.getdMatInv = function() {
        var dMatInv = mat4.create();
        mat4.invert(dMatInv, this.dataTransformMat);
        return dMatInv;
    }
}