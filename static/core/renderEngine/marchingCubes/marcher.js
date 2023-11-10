// marcher.js

// a marcher object handles the marching of a set of data
// has links to 1 data object and 1 tmesh object
// fundamentally converts data -> mesh

import { dataManager } from "../../data/data.js";
import { meshManager } from "../sceneObjects.js";
import { renderModes } from "../renderEngine.js";
import { newId, volume, getRangeDeltas, rangesOverlap } from "../../utils.js";

export {marcherManager}

var marcherManager = {
    // # bytes that a marcher is allowed to store in its own memory
    // used for fine data
    storageBudget: 268435456, // 256 MB
    marchers: {},
    create: async function(data) {
        const id = newId(this.marchers);
        var newMarcher = new this.Marcher(id, data);
        this.marchers[id] = newMarcher;
        await newMarcher.init(data);
        return newMarcher;
    },
    addUser: function(marcher) {
        this.marchers[marcher.id].users++;
        return  this.marchers[marcher.id].users;
    },
    removeUser: function(marcher) {
        this.marchers[marcher.id].users--;
        if (this.marchers[marcher.id].users == 0) {
            // no users, cleanup the object
            this.delete(marcher)
        }
    },
    delete: function(marcher) {
        if (marcher.multiBlock) {
            for (let subMarcher of marcher.pieces) {
                this.removeUser(subMarcher);
            }
        }
        marcher.delete();
        delete this.marchers[marcher.id];
    },
    Marcher: function(id, data) {
        this.id = id;
        this.users = 0;
        // stores a reference to an instance of data object
        this.data = data;
        this.structuredGrid = data.structuredGrid;
        this.complex = data.complex;
        this.size = data.size;
        this.fullSize = data.fullSize;
        // flag for if the marcher is for a multiblock dataset and so is also multiblock
        this.multiBlock = false;

        this.mesh;

        this.dataType = data.getDataType();
        this.pointsDataType = data.pointsDataType;

        // stores other marcher objects if data is multiblock
        this.pieces = [];

        // flag to tell if marching is currently going on
        this.busy = false;

        this.setupComplete = false;

        this.setBusy = function(val) {
            this.busy = val;
        }

        // does marching cubes using the connected dataset
        // a whole data pass will use the whole data/whole data buffers from the dataObj
        this.init = async function(data, marchingCubesEngine) {
            this.mesh = meshManager.createMesh();
            meshManager.addUser(this.mesh);
            dataManager.addUser(this.data);
            if (data.multiBlock) {
                this.multiBlock = true;
                for (let i = 0; i < data.pieces.length; i++) {
                    this.pieces.push(await marcherManager.create(data.pieces[i]));
                    marcherManager.addUser(this.pieces[i]);
                }
            } else if (data.complex) {

                // storage for the fine data (main storage)
                this.fineData;
                this.finePoints;
                this.limits = data.limits; // [min, max]
                this.blocksSize = data.blocksSize; // size of a block
                this.blocksVol = volume(data.blocksSize); // total number of blocks in the dataset
                this.blockVol = volume(data.blockSize); // the number of points in a block
                console.log(this.blockVol)
                this.activeBlocks; // temp storage for pulling the immediately needed blocks through from server
                this.blockLocations;  // a directory of the blocks loaded into the marcher's store
                this.emptyLocations = []; // list of all locations currently unoccupied or holding redundant data

                this.firstTime = true;
                
                // holds the data for marching the fine blocks
                this.marchData = {};

                // setup the fine marching for complex datasets
                await marchingCubesEngine.setupMarchFine(this);
                this.marchData.loadedRange = [data.limits[0]-1, data.limits[0]-1];;
                // the maximum number of blocks that can be loaded here
                const maxBytesPerBlock = Math.max(data.bytesPerBlockData(), data.bytesPerBlockPoints())
                this.marchData.blocksBudget = Math.min(1048576, volume(data.blocksSize))/2;
                console.log("march module budget:", this.marchData.blocksBudget);
            }
            this.setupComplete = true;
        }
        
        this.march = async function(threshold, marchingCubesEngine) {
            if (this.data.initialised && !this.busy && this.setupComplete){
                this.setBusy(true);
                console.log("march normal")
                if (this.multiBlock) {
                    for (let i = 0; i < this.pieces.length; i++) {
                        this.pieces[i].march(threshold);
                    }
                } else {
                    await marchingCubesEngine.march(this.data, this.mesh, threshold);
                } 
                // if (buffersUpdateNeeded()) this.updateBuffers();
                this.setBusy(false);
                return this.mesh;
            }
        }
        // a fine marching pass will use the fine data that it manages
        this.marchFine = async function(threshold, marchingCubesEngine) {
            console.log(this.setupComplete, this.data.initialised, this.busy);
            if (this.data.initialised && !this.busy && this.setupComplete){
                if (this.data.complex) {
                    this.setBusy(true);
                    if (this.multiBlock) {
                        for (let i = 0; i < this.pieces.length; i++) {
                            this.pieces[i].marchFine(threshold);
                        }
                    } else {
                        // transfer the active blocks # to the march module
                        console.log(threshold)
                        this.activeBlocks = this.data.queryBlocks([threshold, threshold])
                        if (this.activeBlocks.length > this.blocksBudget) {
                            console.log("not enough space for active blocks")
                        }
                        await marchingCubesEngine.updateActiveBlocks(this, this.data.queryBlocks([threshold, threshold]));

                        const [newMarchDataRange, newMarchBlocksCount] = this.expandRangeToFill(
                            this.data, 
                            this.marchData.blocksBudget, 
                            this.marchData.activeBlocksCount, 
                            [threshold, threshold]
                        )

                        if (newMarchBlocksCount < this.activeBlocks.length) {
                            console.log("NOT ENOUGH BLOCKS!");
                            console.log("active blocks:", this.activeBlocks.length);
                            console.log("to be stored:", newMarchBlocksCount);
                        }

                        const blockDeltaIDs = data.queryDeltaBlocks(this.marchData.loadedRange, newMarchDataRange);
                        
                        // check if blocks are right
                        if (!this.loadedBlocks) {
                            this.loadedBlocks = new Set(blockDeltaIDs.add);
                        } else {
                            // update loaded block #
                            for (let i = 0; i < blockDeltaIDs.remove.length; i++) {
                                this.loadedBlocks.delete(blockDeltaIDs.remove[i])
                            }
                            for (let i = 0; i < blockDeltaIDs.add.length; i++) {
                                this.loadedBlocks.add(blockDeltaIDs.add[i])
                            }
                        }
                        var wrong = 0;
                        for (let i = 0; i < this.activeBlocks.length; i++) {
                            if (this.loadedBlocks.has(this.activeBlocks[i])) continue;
                            wrong++
                        }
                        console.log(wrong, "blocks missing")


                        // update the data stored here
                        // await marchFine(this, this.mesh, threshold);
                        if (data.structuredGrid) {
                            await marchingCubesEngine.updateMarchFineData(
                                this, 
                                blockDeltaIDs.add, 
                                blockDeltaIDs.remove,
                                await this.data.fetchBlocks(blockDeltaIDs.add),
                                await this.data.fetchBlocks(blockDeltaIDs.add, true)
                            );
                        } else {
                            await marchingCubesEngine.updateMarchFineData(
                                this, 
                                blockDeltaIDs.add, 
                                blockDeltaIDs.remove,
                                await this.data.fetchBlocks(blockDeltaIDs.add)
                            );
                        }
                        await marchingCubesEngine.marchFine(this, this.mesh, threshold);
                        
                        this.marchData.loadedRange = newMarchDataRange;
                    };
                    if (marchingCubesEngine.buffersUpdateNeeded()) this.updateBuffers(marchingCubesEngine);
                    console.log("done")
                    this.setBusy(false);
                }
            }
        }

        this.expandRangeToFill = function (data, budgetCount, loadedCount, loadedRange) {
            var getNextConst = (err) => {
                const kp = 0.08;
                const kd = 0.045;
                const ki = 0.09;
                const p = err[0];
                const d = err[1] ? err[0] - err[1] : 0;
                const i = err.reduce((p, c) => p + c);
                //console.log("p:", p, "d:", d, "i:", i);
                return kp*p + kd*d + ki*i;
            }
            var valRange = data.limits[1] - data.limits[0];
            var newLimits, rangeDelta, newBlocksCount;

            // set the target to be lower  so that convergence below the maximum is faster
            var targetBlocksCount = 0.95*budgetCount;
            // error - number of empty block spaces in the buffer
            // positve - more blocks can be added   negative - too many blocks
            var err = [(targetBlocksCount - loadedCount)/targetBlocksCount];
            
            do {
                
                // the range of values for the new blocks to load
                rangeDelta = valRange*getNextConst(err);
                newLimits = [
                    Math.max(loadedRange[0] - rangeDelta, data.limits[0]), 
                    Math.min(loadedRange[1] + rangeDelta, data.limits[1])
                ];
                //console.log(newLimits);
                // total # of new blocks to add
                newBlocksCount = 0;
                // new blocks from left
                newBlocksCount += data.queryBlocksCount([newLimits[0], loadedRange[0]], [false, true]);
                // new blocks from right
                newBlocksCount += data.queryBlocksCount([loadedRange[1], newLimits[1]], [true, false]);

                // may want to bias this so that we tend towards a small positive value
                err.unshift((targetBlocksCount - loadedCount - newBlocksCount)/targetBlocksCount);

                //console.log(err[0]);

                // keep going if less than 5% blocks empty and less than 20 passes have been done or if too many blocks are selected
                
            } while ((err[0] > 0.05 && err.length < 20) || err[0] < -budgetCount/targetBlocksCount);

            return [newLimits, newBlocksCount];
        }
        // returns the data corresponding to the blocks input in same order as input
        this.getFineData = function(blocks) {
            var out = new this.fineData.constructor(blocks.length*this.blockVol);
            for (let i = 0; i < blocks.length; i++) {
                const blockLoc = this.blockLocations[blocks[i]]*this.blockVol;
                const blockData = this.fineData.slice(blockLoc, blockLoc + this.blockVol);
                out.set(blockData, i*this.blockVol);
            }
            // console.log(blocks);
            //console.log(out);
            return out;
        }
        this.updateBuffers = function(marchingCubesEngine) {
            marchingCubesEngine.updateMeshBuffers(this.mesh);
        }
        this.getTotalVerts = function() {
            var total = 0;
            if (this.multiBlock) {
                for (let i = 0; i < this.pieces.length; i++) {
                    total += this.pieces[i].mesh.vertsNum;
                }
            } else {
                total += this.mesh.vertsNum;
            }
            return total;
        }
        // this.renderMesh = function(gl, projMat, modelMat, box, mode) {
        //     var meshes = []
        //     if (this.multiBlock) {
        //         for (let i = 0; i < this.pieces.length; i++) {
        //             meshes.push(this.pieces[i].mesh)
        //         }
        //     } else {
        //         meshes.push(this.mesh);
        //     }
        //     renderView(gl, projMat, modelMat, box, meshes, mode != renderModes.ISO_SURFACE);
        // }
        this.getMeshes = function() {
            var out = []
            if (this.multiBlock) {
                for (let i = 0; i < this.pieces.length; i++) {
                    out.push(this.pieces[i].mesh);
                }
            } else {
                out.push(this.mesh);
            }
            return out;
        }
        this.setMarchIntoMesh = function(bool) {
            if (this.multiBlock) {
                for (let i = 0; i < this.pieces.length; i++) {
                    this.pieces[i].mesh.forceCPUSide = bool;
                }
            } else {
                this.mesh.forceCPUSide = bool;
            }
        }
        this.delete = function() {
            meshManager.removeUser(this.mesh);
            dataManager.removeUser(this.data);
        };
    }
}


// do we keep a fine and a coarse mesh around simultaneously?
// just one mesh for now


// flow for marching fine data:

// the threshold value is chosen                                             written
// check if the fine data at the threshold is loaded in march instance          x
// if not:
//      check if it is loaded in the [[fine data storage]]                      x
//      if not:
//          load the data at the threshold value from the server                x
// continue to march the data ####                                              x
//
// the [[fine data]] instance manage the data it contains so that
// when the march completes:
//      expand the data that is loaded in the march instance


// block memory management:

// need to remain within budget at all times
// budget for march instance can be ascertained at init
// budget for fine data shared among all of the fine data users
// always keep a track of the range/ranges of data loaded
//      in terms of threshold values
// assumes system block storage > march instance block storage

// to expand blocks stored:
// work from the threshold value always
// gradually increase the size of the range until the number of blocks fills the allocated memory
//      start by increasing range by small amount (~1% of total value range)
//      increase is symmetric either side of 
//      query datastructure so see how many blocks lie exclusively in this new range
//      gradually expand the search - the velocity (Δ window size) given by a pid loop
//      the amount of space left is input to pid
//      stop when total > allowed and use prev
//      also keep a track of when the range is 

// look for any intercept with the range that is currently stored
// can keep the blocks that are still part of this new range
// request the new blocks 
// can go through and for each block that is being removed, replace with another that is being added


// ISSUE:
// where to put the active blocks if not in memory?
// > perhaps could work out the whole of the new range and add in all data before marching?
//   then skip the expansion step afterwards


// simpler fine march process:

// threshold comes in
// expand in both to get the new range of data
// get block numbers of needed blocks
// fetch new blocks needed for here and insert/replace existing blocks
// 


// transferring fine data to GPU:
//
// the issue is can't just map any buffer
// > could create a buffer thats a copy of the finedata just for reading/writing
// > could use queue.writebuffer to transfer data and a read buffer to read data -> likely very slow
// > just create new one each time
//   > could only update all the data when the threshold value leaves the stored values



// bugs:
// over time blocks getting deleted? mem leak? - FIXED: need main mem > march mem, blocks added+removed NOT YET
// > no longer overlapping
// > at start is fine
// > change threshold to outside range -> still fine
// > change to get outside of range -> goes wrong
// > seems to be not removing blocks when it should and adding when not needed