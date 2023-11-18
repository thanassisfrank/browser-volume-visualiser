// data.js
// handles the storing of the data object, normals etc

import {VecMath} from "../VecMath.js";
import {vec3, mat4} from "https://cdn.skypack.dev/gl-matrix";
import { newId, DATA_TYPES, xyzToA, volume, parseXML, rangesOverlap, IntervalTree, timer } from "../utils.js";
import { decompressB64Str, getNumPiecesFromVTS, getDataNamesFromVTS, getPointsFromVTS, getExtentFromVTS, getPointDataFromVTS, getDataLimitsFromVTS} from "./dataUnpacker.js"

export {dataManager};

const blockSize = [4, 4, 4]

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
    marchEngine: undefined,
    setConfigSet: function(configSet) {
        this.configSet = configSet;
        for (let id in configSet) {
            this.configSet[id].id = id;
            this.directory[id] = null;
        }
    },
    setMarchEngine: function(marchEngine) {
        this.marchEngine = marchEngine;
    },
    getDataObj: async function(configId) {
        // returns already created data object if it exists
        if (this.directory[configId]) {
            return this.directory[configId];
        }
        // else, creates a new one
        var newDataObj = await this.createData(this.configSet[configId]);
        this.directory[configId] = newDataObj;
        await this.setupDataObj(newDataObj);
        return newDataObj; 
    },
    setupDataObj: async function(newData) {
        if (newData.multiBlock) {
            var results = [];
            for (let i = 0; i < newData.pieces.length; i++) {
                results.push(this.marchEngine.setupMarch(newData.pieces[i]));
            }
            await Promise.all(results);
            
        } else {
            // await this.marchEngine.setupMarch(newData);
        }
    },
    createData: async function(config) {
        const id = newId(this.datas);
        var newData = new this.Data(id);
        console.log(config.name);
        newData.dataName = config.name;

        if (false) {//config.complexAvailable) {
            // handle complex data setup
            await newData.createComplex(config);
        } else {
            // create dataset that isnt complex
            await newData.createSimple(config);
        }

        newData.config = config;
        newData.dataType = DATA_TYPES[config.dataType];
        newData.pointsDataType = Float32Array;
        
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
        // a set of data associated with points
        // complex:
        // - a low resolution of whole dataset for fast scrolling
        // simple:
        // - the whole dataset
        this.data = [];
        this.dataType;
        this.pointsDataType;
        // what this.data represents
        this.dataName = "";
        // used by the .vts format to place points in space
        this.points = [];
        // will contain new instances of data objects
        this.pieces = [];
        this.multiBlock = false;
        // used to store the limit values of each block if in complex mode
        this.blockLimits = [];
        // used to store fine data for complex mode
        this.fineData = [];
        // stores the dimensions of the dataset in blocks
        this.blocksSize = [];
        // flag for if this is a complex data object
        this.complex = false;
        // flag for if this is a structuredgrid object (.vts)
        this.structuredGrid = false;
        this.normals = [];
        this.normalsInitialised = false;
        this.normalsPopulated = false;

        // these following attributes apply to the data stored in this.data
        // simple:
        // - these reflect the values for the actual dataset
        // complex:
        // - these reflect the values for the coarse, whole view
        this.maxSize = 0;
        this.maxCellSize = 1;
        this.volume = 0;
        this.fullSize = [];
        this.fullVolume = 0;
        this.midPoint = [0, 0, 0];
        this.size = [];
        this.cellSize = [1, 1, 1];
        this.blockSize = blockSize;

        // min, max
        this.limits = [undefined, undefined];
        // holds any information the marching implementation needs e.g. the data buffer on gpu
        this.marchData = {};
        this.index = function(i, j, k) {
            return this.data[i * this.size[1] * this.size[2] + j * this.size[2] + k];
        };

        this.initialise = function(config, scale = 1, pieceNum = 0) {
            if (config.type == "structuredGrid") {
                if (pieceNum != -1) {
                    this.fullSize = xyzToA(config.pieces[pieceNum].size);
                    this.fullVolume = volume(this.fullSize);
                    this.size = [
                        Math.floor(config.pieces[pieceNum].size.x/scale), 
                        Math.floor(config.pieces[pieceNum].size.y/scale), 
                        Math.floor(config.pieces[pieceNum].size.z/scale)
                    ];
                    this.maxSize = Math.max(...this.size);
                    this.volume = volume(this.size);
                } else {
                    this.maxSize = Math.max(...xyzToA(config.pieces[0].size));
                    this.midPoint = config.origin;           // for now, set the origin of every 
                }
                this.initialised = true;
            } else {
                this.fullSize = xyzToA(config.size);
                this.fullVolume = volume(this.fullSize);
                this.size = [
                    Math.floor(config.size.x/scale), 
                    Math.floor(config.size.y/scale), 
                    Math.floor(config.size.z/scale)
                ];
                this.maxSize = Math.max(...this.size);
                this.volume = volume(xyzToA(config.size));
                if (config.cellScale) {
                    this.cellSize = [
                        scale*config.cellSize.x,
                        scale*config.cellSize.y,
                        scale*config.cellSize.z
                    ];
                } else {
                    this.cellSize = [scale, scale, scale];
                }
                
                this.maxCellSize = Math.max(...this.cellSize);
                this.midPoint = [
                    (this.size[0]-1)/2*this.cellSize[0], 
                    (this.size[1]-1)/2*this.cellSize[1], 
                    (this.size[2]-1)/2*this.cellSize[2]
                ]
                this.initialised = true;
            }
        }

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
                this.initialise(config);
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

        this.createSimple = async function(config) {
            if (config.f) {
                this.generateData(config);
            } else if (config.type == "raw") {
                const responseBuffer = await fetch(config.path).then(resp => resp.arrayBuffer());
                this.data = new DATA_TYPES[config.dataType](responseBuffer);
                this.limits = config.limits;
                this.initialise(config);
                console.log("init")
            } else if (config.type == "structuredGrid") {
                this.structuredGrid = true;

                var totalPieces = 0;

                var extents = [];
                var limits = [];

                var fileDOMs = [];
                var numPiecesList = [];
                // go through all the files that make up this dataset and get total piece num
                for (let i = 0; i < config.originalFiles.length; i++) {
                    fileDOMs.push(
                        await fetch(config.path + config.originalFiles[i])
                        .then(res => res.text())
                        .then(text => parseXML(text))
                    )
                    
                    const numPieces = getNumPiecesFromVTS(fileDOMs[i]);
                    totalPieces += numPieces;
                    numPiecesList.push(numPieces);
                    console.log(numPieces);
                }

                var currPieceIndex = 0;
                // go through all pieces and initialise them
                for (let i = 0; i < fileDOMs.length; i++) {
                    // go through any pieces each file may have
                    for (let j = 0; j < numPiecesList[i]; j++) {
                        var p;
                        if (totalPieces == 1) {
                            p = this;
                        } else {
                            this.pieces.push(await dataManager.createData({name: this.dataName + " " + String(i)}));
                            var index = this.pieces.length - 1;
                            // register as a new user of this data
                            dataManager.addUser(this.pieces[index]);
                            this.pieces[index].structuredGrid = true;
                            var p = this.pieces[index];
                            this.multiBlock = true;
                        }
                        
                        p.points = getPointsFromVTS(fileDOMs[i], j);
                        // get the first dataset
                        var pointDataNames = getDataNamesFromVTS(fileDOMs[i], j);
                        p.data = getPointDataFromVTS(fileDOMs[i], j, pointDataNames[0]);

                        extents.push(getExtentFromVTS(fileDOMs[i], j));
                        limits.push(getDataLimitsFromVTS(fileDOMs[i], j, getDataNamesFromVTS(fileDOMs[i], j)[0]));
                        
                        // set limits and initialise piece
                        p.limits = config.data[pointDataNames[0]].limits;
                        p.initialise(config, 1, currPieceIndex);

                        currPieceIndex++;
                    }
                }
                // set limits and origin on main
                this.limits = config.data[pointDataNames[0]].limits;
                this.initialise(config, 1, -1);
                
                console.log(extents, limits)
                // this.initialiseVTS(totalPieces, extents, limits);
                
            }
        };

        this.createComplex = async function(config) {
            // first, save the config object
            this.config = config;
            this.complex = true;
            const pointsTarget = 200000;

            if (config.type == "raw") {
                // extract information from it
                this.blocksSize = xyzToA(config.blocksSize);
                this.blocksVol = volume(this.blocksSize);

                this.limits = config.limits;
                console.log(this.limits)

                // assess what resolution the coarse representation should be
                const totalPoints = this.config.size.x*this.config.size.y*this.config.size.z;
                // const scale = Math.ceil(Math.pow(totalPoints/pointsTarget, 1/3));
                const scale = 1;
                console.log("scale:", scale);
                
                const request = {
                    name: config.id,
                    mode: "whole",
                    // will be determined by benchmarking
                    cellScale: scale
                }

                // console.log(request);

                // wait for the response
                const responseBuffer = await fetch("/data", {
                    method: "POST",
                    body: JSON.stringify(request)
                }).then((resp) => resp.arrayBuffer());

                // create an array of correct type and store in this.data
                this.data = new DATA_TYPES[config.dataType](responseBuffer);

                // get the block limits data from the server
                var pathSplit = config.path.split(".");
                const limitsResponse = await fetch(pathSplit[0] + "_limits." + pathSplit[1]);
                const limitsBuffer = await limitsResponse.arrayBuffer();
                this.blockLimits = new DATA_TYPES[config.dataType](limitsBuffer)

                // this.logBlockDensity(32);

                this.limits = config.limits;
                this.initialise(config, scale);
            } else if (config.type == "structuredGrid") {
                this.structuredGrid = true;
                const totalPieces = config.pieces.length;

                var totalPoints = 0;
                for (let i = 0; i < totalPieces; i++) {
                    totalPoints += config.pieces[i].size.x*config.pieces[i].size.y*config.pieces[i].size.z;
                }
                const scale = Math.ceil(Math.pow(totalPoints/pointsTarget, 1/3));
                console.log("scale:", scale);

                const chosenAttributeName = Object.keys(config.data)[0];

                for (let i = 0; i < totalPieces; i++) {
                    var p;
                    if (totalPieces == 1) {this
                        p = this;
                    } else {
                        this.pieces.push(await dataManager.createData({name: this.dataName + " " + String(i)}));
                        var index = this.pieces.length - 1;
                        // register as a new user of this data
                        dataManager.addUser(this.pieces[index]);
                        this.pieces[index].structuredGrid = true;
                        this.pieces[index].fileName = config.pieces[i].fileName;
                        this.pieces[index].attributeName = chosenAttributeName;
                        this.pieces[index].config = config;
                        p = this.pieces[index];
                        this.multiBlock = true;
                    }

                    // request the points data
                    const pointsRequest = {
                        name: config.id,
                        fileName: config.pieces[i].fileName,
                        points: true,
                        mode: "whole",
                        // will be determined by benchmarking
                        cellScale: scale
                    }

                    p.points = await fetch("/data", {
                        method: "POST",
                        body: JSON.stringify(pointsRequest)
                    })
                    .then((resp) => resp.arrayBuffer())
                    .then(buff => new Float32Array(buff));


                    // request data
                    const dataRequest = {
                        name: config.id,
                        fileName: config.pieces[i].fileName,
                        data: p.attributeName,
                        mode: "whole",
                        // will be determined by benchmarking
                        cellScale: scale
                    }

                    p.data = await fetch("/data", {
                        method: "POST",
                        body: JSON.stringify(dataRequest)
                    })
                        .then((resp) => resp.arrayBuffer())
                        .then(buff => new DATA_TYPES[config.data[p.attributeName].dataType](buff));

                    // get the block limits data from the server
                    const limPath = config.path + config.pieces[i].fileName + "_" +  p.attributeName + "_limits.raw";
                    p.blockLimits = await fetch(limPath)
                        .then((resp) => resp.arrayBuffer())
                        .then(buff => new DATA_TYPES[config.data[p.attributeName].dataType](buff));

                    // console.log(p.data);
                    // console.log(p.points);
                    // console.log(p.blockLimits);
                    // this.logBlockDensity(32);
                    p.complex = true;
                    p.structuredGrid = true;
                    p.blocksSize = xyzToA(config.pieces[i].blocksSize);
                    p.blockVol = volume(this.blocksSize);

                    p.limits = config.data[p.attributeName].limits;
                    p.initialise(config, scale, i);
                }
                this.complex = true;
                // init the main object too
                this.structuredGrid = true;
                this.attributeName = chosenAttributeName;
                this.limits = config.data[p.attributeName].limits;
                this.initialise(config, scale, -1);
            }
        };



        // allows a query of which blocks intersect with the given range
        this.queryBlocks = function(range, exclusive = [false, false]) {
            var intersecting = [];
            // block locations is a list of all blocks and where they are in this.data if they are there
            var l, r;
            for (let i = 0; i < this.blockLimits.length/2; i++) {
                l = this.blockLimits[2*i];
                r = this.blockLimits[2*i + 1];
                if (l <= range[1] && range[0] <= r) {
                    if (exclusive[0] && l <= range[0]) continue;
                    if (exclusive[1] && r >= range[1]) continue;
                    intersecting.push(i);
                }
            } 
            return intersecting;
        }
        this.queryDeltaBlocks = function(oldRange, newRange) {
            console.log(oldRange, newRange);
            var out = {add:[], remove:[]};
            var thisRange = [];
            for (let i = 0; i < this.blockLimits.length/2; i++) {
                thisRange[0] = this.blockLimits[2*i];
                thisRange[1] = this.blockLimits[2*i + 1];
                // four cases:
                // only in new range -> goes into add
                // only in old range -> goes into remove
                // in both ranges -> nothing
                // in neither ranges -> nothing
                
                if (rangesOverlap(thisRange, oldRange) && rangesOverlap(thisRange, newRange)) {
                    // in both so don't do anything
                    continue
                } else if (rangesOverlap(thisRange, newRange)) {
                    // only in new range
                    out.add.push(i);
                } else if (rangesOverlap(thisRange, oldRange)) {
                    // only in old range
                    out.remove.push(i);
                }
            }
            // console.log(out);
            return out;
        }
        // same as above but returns a number
        this.queryBlocksCount = function(range, exclusive = [false, false]) {
            var num = 0;
            // block locations is a list of all blocks and where they are in this.data if they are there
            var l, r;
            for (let i = 0; i < this.blockLimits.length/2; i++) {
                l = this.blockLimits[2*i];
                r = this.blockLimits[2*i + 1];
                if (l <= range[1] && range[0] <= r) {
                    if (exclusive[0] && l <= range[0]) continue;
                    if (exclusive[1] && r >= range[1]) continue;
                    num++;
                }
            } 
            return num;
        }

        // fetches the supplied blocks
        this.fetchBlocks = function(blocks, points = false) {
            var request = {
                name: this.config.id,
                mode: "blocks",
                blocks: blocks
            }
            if (this.structuredGrid) {
                request.fileName = this.fileName;
                if (points) {
                    request.points = true;
                } else {
                    request.data = this.attributeName;
                }
            }
            console.log(request);

            var that = this;

            return fetch("/data", {
                method: "POST",
                body: JSON.stringify(request)
            })
            .then(response => response.arrayBuffer())
            .then(buffer => new (that.getDataType())(buffer))
        }

        this.bytesPerBlockData = function() {
            return volume(blockSize)*this.getDataType().BYTES_PER_ELEMENT;
        }

        this.getDataType = function() {
            // console.log(this.config, this.attributeName)
            if (this.structuredGrid) {
                return DATA_TYPES[this.config.data[this.attributeName].dataType];
            } else {
                return DATA_TYPES[this.config.dataType];
            }
        }

        this.bytesPerBlockPoints = function() {
            return volume(blockSize)*3*4; // assume positions are float32 for now
        }
        

        this.logBlockDensity = function(n) {
            const density = this.getBlockDensity(n);
            // console.log(density);
            // find the max to scale by
            var maxVal = 0;
            for (let i = 0; i < density.length; i++) {
                maxVal = Math.max(density[i], maxVal);
            }
            const rowLength = 32;
            var outStr = "";
            for (let i = 0; i < density.length; i++) {
                outStr += "#".repeat(Math.round(density[i]*rowLength/maxVal)) + "\n";
            }
            console.log(outStr);
        }

        this.getBlockDensity = function(n) {
            var density = [];
            for (let i = 0; i <= n; i++) {
                const val = i*(this.limits[1] - this.limits[0])/n + this.limits[0];
                density.push(this.queryBlocksCount([val, val]));
            }
            return density;
        }

        // returns a mat4 encoding object space -> data space
        // includes 
        this.getdMatInv = function() {
            var dMat = mat4.fromScaling(mat4.create(), [1, 1, 1]);
            mat4.rotateY(dMat, dMat, Math.PI/2);
            // mat4.invert(dMat, dMat);
            return dMat;
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




// need to intialise the coarse, whole data in the march module as part of init
// then delete its copy of the data as it is only needed in the march module

// needs method for getting the block # to add and remove given an old and new value range