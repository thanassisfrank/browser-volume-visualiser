// dynamicTree.js
// contains functions to create, update and manage dynamic tree nodes and dynamic unstructured mesh data

import { ResolutionModes } from "./dataConstants.js";

import { NODE_BYTE_LENGTH, writeNodeToBuffer, readNodeFromBuffer, processLeafMeshDataInfo } from "./cellTreeUtils.js";
import { writeCornerVals, readCornerVals } from "./treeNodeValues.js";
import { VecMath } from "../VecMath.js";
import { AssociativeCache, ScoredCacheManager } from "./cache.js";
import { generateTreelet } from "./treelet.js";
import { MeshCache } from "./meshCache.js";
import { boxVolume, copyBox } from "../boxUtils.js";
import { vec4 } from "../gl-matrix.js";
import { frameTimeStore, StopWatch } from "../utils.js";


const NodeStates = {
    NONE: 0,
    MERGED: 1,
    SPLIT: 2,
};


// checks if the given node is a leaf
const isDynamicLeaf = (node, nodeCount) => {
    if (node.rightPtr == 0) return true;
    if (node.rightPtr >= nodeCount) return true;

    return false;
}



// calculates a score for the box
// high score -> too big -> split
// low score -> too small -> merge
// box size/distance from focus point
// modified by distance of camera -> focus point
// > closer -> 
const calcBoxScore = (box, focusCoords, camToFocDist) => {
    // get max axis=aligned dimension of box
    var lMax = Math.abs(Math.max(...VecMath.vecMinus(box.max, box.min)));
    var mid = VecMath.scalMult(0.5, VecMath.vecAdd(box.min, box.max));
    // distance of box from camera
    // distance of box from focus
    var distToFoc = VecMath.magnitude(VecMath.vecMinus(focusCoords, mid));
    // target length approach
    return lMax - Math.max(0, (Math.abs(distToFoc)-10)/camToFocDist*10 + 5);
};

const calcBoxScoreFrustrum = (box, camPos, camMat, camToFocDist) => {
    // check if box is inside the view frustrum
    const mid = [
        (box.min[0] + box.max[0]) * 0.5,
        (box.min[1] + box.max[1]) * 0.5,
        (box.min[2] + box.max[2]) * 0.5
    ];
    const clipPos = vec4.create();
    vec4.transformMat4(clipPos, [mid[0], mid[1], mid[2], 1], camMat);
    const ndc = [
        clipPos[0]/clipPos[3],
        clipPos[1]/clipPos[3],
        clipPos[2]/clipPos[3],
    ];
    if (ndc[0] < -1 || ndc[0] > 1 || ndc[1] < -1 || ndc[1] > 1 ||ndc[2] < 0) {
        // outside frustrum
        return 0;
    }
    const distToCam =  VecMath.magnitude(VecMath.vecMinus(camPos, mid));
    if (distToCam > 2*camToFocDist) {
        // too far away
        return 0;
    }
    // calculate box effective pixel area
    const lMax = Math.abs(Math.max(...VecMath.vecMinus(box.max, box.min)));
    // a more accurate estimate of the pixel area would be (lMax/dist)^2
    // since ^2 is monotonic on [0, inf), this is skipped since only relative score is important
    return lMax/distToCam;
}


// calculate the scores for the current leaf nodes, true leaf or pruned
// returns a list of leaf node objects containing their score
// assumes camera coords is in the dataset coordinate space
function getNodeScores (nodeCache, fullNodes, extentBox, scoreFn) {
    var dynamicNodes = nodeCache.getBuffers()["nodes"];
    var nodeCount = Math.floor(dynamicNodes.byteLength/NODE_BYTE_LENGTH);

    var scores = [];

    var rootNode = readNodeFromBuffer(dynamicNodes, 0);
    rootNode.depth = 0;
    rootNode.box = copyBox(extentBox);
    // rootNode.box = {
    //     min: [...extentBox.min],
    //     max: [...extentBox.max],
    // };

    // the next nodes to process
    var nodes = [rootNode];

    var processed = 0;
    while (nodes.length > 0 && processed < nodeCount * 3) {
        processed++;
        const currNode = nodes.pop();
        const currBox = currNode.box;

        if (isDynamicLeaf(currNode, nodeCount)) {
            // this is a leaf node, get its score
            currNode.score = scoreFn(currBox);
            currNode.state = nodeCache.readBuffSlotAt("state", currNode.thisPtr)[0];
            scores.push(currNode);
            // if (currNode.thisPtr == 511) console.log(structuredClone(currNode));
        } else {
            // get the ptr to the children in the full buffer
            const currFullNode = readNodeFromBuffer(fullNodes, (currNode.thisFullPtr ?? 0) * NODE_BYTE_LENGTH);
            // add its children to the next nodes
            const rightNode = readNodeFromBuffer(dynamicNodes, currNode.rightPtr * NODE_BYTE_LENGTH);
            const leftNode = readNodeFromBuffer(dynamicNodes, currNode.leftPtr * NODE_BYTE_LENGTH);
            const bothLeaves = isDynamicLeaf(leftNode, nodeCount) && isDynamicLeaf(rightNode, nodeCount);

            rightNode.thisFullPtr = currFullNode.rightPtr;
            rightNode.bothSiblingsLeaves = bothLeaves;
            rightNode.depth = currNode.depth + 1;

            const rightBox = {
                min: [currBox.min[0], currBox.min[1], currBox.min[2]],
                max: [currBox.max[0], currBox.max[1], currBox.max[2]],
            };
            rightBox.min[currNode.depth % 3] = currNode.splitVal;
            rightNode.box = rightBox;

            nodes.push(rightNode);


            leftNode.thisFullPtr = currFullNode.leftPtr;
            leftNode.bothSiblingsLeaves = bothLeaves;
            leftNode.depth = currNode.depth + 1;
            
            const leftBox = {
                min: [currBox.min[0], currBox.min[1], currBox.min[2]],
                max: [currBox.max[0], currBox.max[1], currBox.max[2]],
            };
            leftBox.max[currNode.depth % 3] = currNode.splitVal;
            leftNode.box = leftBox;

            nodes.push(leftNode);

            if (boxVolume(leftBox) < 0 || boxVolume(rightBox) < 0) {
                // debugger;
            }
        }
    }

    // return the unsorted scores 
    return scores;
};

// takes the full scores list and returns a list of nodes to split and a list to merge
// these will have length equal to count
// the split list contains pruned leaves that should be split
// the merge list contains leaves that should be merged with their siblings
const createMergeSplitLists = (fullNodes, scores, maxCount) => {
    // proportion of the scores to search for nodes to split and merge
    // combats flickering 
    const searchProp = 1;
    var mergeList = [];
    var splitList = [];

    // dual thresholding for hysteresis
    const splitThreshold = Number.NEGATIVE_INFINITY;
    const mergeThreshold = Number.POSITIVE_INFINITY;

    let currNode, currFullNode;

    let lowestSplitIndex = scores.length - 1;
    // create the split list first
    for (let i = scores.length - 1; i >= Math.max(0, scores.length * (1 - searchProp)); i--) {
        if (splitList.length >= maxCount) break;
        currNode = scores[i];
        if (currNode.score < splitThreshold) break;
        currFullNode = readNodeFromBuffer(fullNodes, (currNode.thisFullPtr ?? 0) * NODE_BYTE_LENGTH);
        // can't be split if its a true leaf
        if (currFullNode.rightPtr == 0) continue;
        // can't be split if previously merged
        if (NodeStates.MERGED == currNode.state) continue;

        // passed all checks
        splitList.push(currNode);
        lowestSplitIndex = i;
    }

    // create merge list
    // only go up to the lowest split index to prevent nodes included in both
    let highestMergeIndex = 0;
    for (let i = 0; i < Math.min(lowestSplitIndex, scores.length * searchProp); i++) {
        // check if we have enough
        if (mergeList.length >= maxCount) break;
        currNode = scores[i];
        if (currNode.score > mergeThreshold) break;
        // can't be merged if sibling not a leaf
        if (!currNode.bothSiblingsLeaves) continue;
        // check if sibling is in split list
        // check if the same parent appears there
        if (splitList.some(x => x.parentPtr == currNode.parentPtr)) continue;
        // check if sibling is already in merge list
        if (mergeList.some(x => x.parentPtr == currNode.parentPtr)) continue;
        // can't be merged if previously split
        if (NodeStates.SPLIT == currNode.state) continue;

        // passed all checks
        mergeList.push(currNode);
        highestMergeIndex = i;
    }

    return {
        merge: mergeList,
        split: splitList
    };
};


const updateDynamicNodeCache = (nodeCache, getCornerValsFunc, fullNodes, activeValueNames, mergeSplit, noCells) => {
    // find the amount of changes we can now make
    const changeCount = Math.min(mergeSplit.merge.length, mergeSplit.split.length);


    // merge the leaves with the highest scores with their siblings (delete 2 per change)
    var freePtrs = [];
    for (let i = 0; i < changeCount; i++) {
        var parentNode = nodeCache.readBuffSlotAt("nodes", mergeSplit.merge[i].parentPtr);
        freePtrs.push(parentNode.leftPtr, parentNode.rightPtr);
        // convert the parentNode to a pruned leaf
        nodeCache.updateBlockAt(mergeSplit.merge[i].parentPtr, {
            "nodes": {leftPtr: 0, rightPtr: 0},
            "state": [NodeStates.MERGED]
        });
    }

    // split the leaves with the lowest scores (write 2 per change)
    for (let i = 0; i < freePtrs.length/2; i++) {
        var thisNode = mergeSplit.split[i];
        var thisNodeFull = readNodeFromBuffer(fullNodes, thisNode.thisFullPtr * NODE_BYTE_LENGTH);
        // update node to branch
        nodeCache.updateBlockAt(thisNode.thisPtr, {
            "nodes": {splitVal: thisNodeFull.splitVal, cellCount: 0, leftPtr: freePtrs[2*i], rightPtr: freePtrs[2*i + 1]}
        });

        const childPtrs = [thisNodeFull.leftPtr, thisNodeFull.rightPtr];
        for (let j = 0; j < 2; j++) {
            const childNode = readNodeFromBuffer(fullNodes, childPtrs[j] * NODE_BYTE_LENGTH);
            // write in as a pruned leaf
            const newData = {
                "nodes": {
                    splitVal: childNode.splitVal, 
                    cellCount: noCells ? 0 : childNode.cellCount, 
                    parentPtr: thisNode.thisPtr, 
                    leftPtr: noCells ? 0 : childNode.leftPtr, 
                    rightPtr: 0
                },
                "state": NodeStates.SPLIT
            };
            
            for (let valueName of activeValueNames) {
                newData["corners" + valueName] = getCornerValsFunc(childNode.thisPtr, valueName);
            }

            nodeCache.insertNewBlockAt(freePtrs[2*i + j], childNode.thisPtr, newData);
        }
    }
};



export class DynamicTree {
    /** @type {AssociativeCache} */
    nodeCache;
    /** @type {MeshCache} */
    meshCache;
    /** @type {ArrayBuffer} */
    fullNodes;
    /** @type {ArrayBuffer} */
    renderNodes;

    constructor(resolutionMode, treeletDepth) {
        this.resolutionMode = resolutionMode;
        this.treeletDepth = treeletDepth;
        this.usesTreelets = treeletDepth > 0;
    }

    // create the buffers used for dynamic data resolution
    // fills dynamic nodes from full nodes breadth first
    #createDynamicNodeCache(fullNodes, maxNodes) {
        this.fullNodes = fullNodes
        // set up the cache object for the dynamic nodes
        this.nodeCache = new AssociativeCache(maxNodes);
        this.nodeCache.createBuffer("state", Uint8Array, 1);
        this.nodeCache.createBuffer("nodes", ArrayBuffer, NODE_BYTE_LENGTH);
        this.nodeCache.setReadFunc("nodes", (buff, slotNum, blockSize) => {
            return readNodeFromBuffer(buff, slotNum * blockSize);
        });
        this.nodeCache.setWriteFunc("nodes", (buff, data, slotNum, blockSize) => {
            writeNodeToBuffer(
                buff, 
                slotNum * blockSize, 
                data.splitVal ?? null,
                data.cellCount ?? null,
                data.parentPtr ?? null,
                data.leftPtr ?? null,
                data.rightPtr ?? null
            );
        });


        // fill the dynamic buffer from the full tree buffer, breadth first
        let i = 0; // where to write the next node

        const rootNode = readNodeFromBuffer(fullNodes, 0);

        this.nodeCache.insertNewBlockAt(0, rootNode.thisPtr, {
            "nodes": {splitVal: rootNode.splitVal, cellCount: 0, parentPtr: 0, leftPtr: 0, rightPtr: 0}
        });

        i += 1;

        // current leaves in the dynamic tree that have children in the full tree
        let nodePtrs = [{full: 0, dynamic: 0}];

        while (nodePtrs.length > 0 && i < maxNodes - 2) {
            const ptrs = nodePtrs.pop();
            const fullNode = readNodeFromBuffer(fullNodes, ptrs.full * NODE_BYTE_LENGTH);

            const leftNode = readNodeFromBuffer(fullNodes, fullNode.leftPtr * NODE_BYTE_LENGTH);
            const rightNode = readNodeFromBuffer(fullNodes, fullNode.rightPtr * NODE_BYTE_LENGTH);

            const leftPtr = i;
            const rightPtr = i + 1;

            // update i
            i += 2;
            
            // update parent with pointers to children
            this.nodeCache.updateBlockAt(ptrs.dynamic, {
                "nodes": {leftPtr, rightPtr}
            });
            
            // write left to dynamic as pruned leaf
            this.nodeCache.insertNewBlockAt(leftPtr, leftNode.thisPtr, {
                "nodes": {splitVal: leftNode.splitVal, cellCount: 0, parentPtr: ptrs.dynamic, leftPtr: 0, rightPtr: 0}
            });

            // write right to dynamic as pruned leaf
            this.nodeCache.insertNewBlockAt(rightPtr, rightNode.thisPtr, {
                "nodes": {splitVal: rightNode.splitVal, cellCount: 0, parentPtr: ptrs.dynamic, leftPtr: 0, rightPtr: 0}
            });
            
            // check if left and right have children
            if (leftNode.rightPtr != 0) nodePtrs.unshift({full: leftNode.thisPtr, dynamic: leftPtr});
            if (rightNode.rightPtr != 0) nodePtrs.unshift({full: rightNode.thisPtr, dynamic: rightPtr});
        }

        return this.nodeCache;
    }

    // create the render nodes buffer by pruning all of the leaf nodes
    #createRenderNodes(fullNodes) {
        // copy full nodes
        this.renderNodes = new ArrayBuffer(fullNodes.byteLength);
        new Uint8Array(this.renderNodes).set(new Uint8Array(fullNodes));

        // prune children
        let leavesPruned = 0;
        const rootNode = readNodeFromBuffer(fullNodes, 0);
        const nodeQueue = [rootNode];
        while (nodeQueue.length > 0) {
            const currNode = nodeQueue.pop();
            if (currNode.rightPtr === 0) {
                leavesPruned++;
                writeNodeToBuffer(
                    this.renderNodes, 
                    NODE_BYTE_LENGTH * currNode.thisPtr, 
                    currNode.splitVal,
                    0,
                    currNode.parentPtr,
                    0,
                    0
                );
            } else {
                nodeQueue.push(
                    readNodeFromBuffer(fullNodes, NODE_BYTE_LENGTH * currNode.leftPtr),
                    readNodeFromBuffer(fullNodes, NODE_BYTE_LENGTH * currNode.rightPtr),
                )
            }
        }

        console.log(`${leavesPruned} leaved pruned out of ${fullNodes.byteLength/NODE_BYTE_LENGTH} nodes`)
    }

    setFullNodes(fullNodes, dynamicNodeCount) {
        this.#createDynamicNodeCache(fullNodes, dynamicNodeCount);
        this.#createRenderNodes(fullNodes);
    }

    // creates or modifies the dynamic corner values buffer 
    // agnostic to samples vs poly
    // extends the cache object used for dynamic nodes
    createMatchedDynamicCornerValues(fullCornerValues, slotNum) {
        // return;
        if (!fullCornerValues) {
            throw Error("Unable to generate dynamic corner values, full corner values does not exist for slot " + slotNum);
        }
            
        const buffName = "corners" + slotNum; 
        if (!this.nodeCache.getBuffers()[buffName] ) {
            // create if not present
            this.nodeCache.createBuffer(buffName, Float32Array, 8);
        }

        // make sure that the corner buffer is synchronised to the currently loaded nodes
        // dataObj.dynamicNodeCache.syncBuffer(buffName, (fullPtr) => readCornerVals(fullCornerValues, fullPtr));
        this.nodeCache.syncBuffer(buffName, (fullPtr) => readCornerVals(fullCornerValues, fullPtr));
        
        return this.nodeCache.getBuffers()[buffName];
    }

    createDynamicMeshCache(blockSizes, leafBlockCount) {
        this.meshCache = new MeshCache(blockSizes, leafBlockCount, this.treeletDepth);
        return this.meshCache;
    }

    // run when a new data array is selected
    // creates a version of the dynamic mesh value array with the same blocks loaded in the same positions as the
    // dynamic mesh buffers for the mesh geometry
    // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
    createMatchedDynamicMeshValueArray(getMeshBlockFuncExt, scalarName) {
        return this.meshCache.updateValuesBuff(getMeshBlockFuncExt, scalarName);
    }


    // updates the dynamic dataset based on camera location
    // this handles updating the dynamic nodes and dynamic mesh
    // getCornerValsFuncExt -> dataObj.getFullCornerValues
    // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
    update(cameraChanged, focusCoords, camCoords, extentBox, getCornerValsFuncExt, getMeshBlockFuncExt, activeValueNames, camMat) {
        const nodeUpdateSW = new StopWatch();
        if (cameraChanged) {
            // reset the record of modifications to nodes
            this.nodeCache.syncBuffer("state", tag => {return [NodeStates.NONE]});
        }
    
        if (this.resolutionMode & ResolutionModes.DYNAMIC_NODES_BIT) {
            const camToFocDist = VecMath.magnitude(VecMath.vecMinus(focusCoords, camCoords));

            function scoreFn (box) {
                return calcBoxScoreFrustrum(box, camCoords, camMat, camToFocDist);
            }
            // get a list of all nodes in the dynamic node tree with their scores
            const scores = getNodeScores(this.nodeCache, this.fullNodes, extentBox, scoreFn);
    
            if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
                if (!this.meshCacheBusy) {
                    nodeUpdateSW.stop();
                    
                    const meshUpdateSW = new StopWatch();
                    // const meshCacheTimeStart = performance.now();
                    this.meshCacheBusy = true;
                    this.meshCache.updateScores(scores);
                    // update the mesh blocks that are loaded in the cache
                    this.meshCache.updateLoadedBlocks(
                        this.nodeCache, 
                        this.renderNodes,
                        getMeshBlockFuncExt, 
                        this.fullNodes, 
                        scores, 
                        activeValueNames, 
                        meshUpdateSW
                    )
                    .then(() => {
                        this.meshCacheBusy = false;
                        frameTimeStore.add("mesh_update", meshUpdateSW.stop());
                    });


                    nodeUpdateSW.start();
                }
            }
    
            scores.sort((a, b) => a.score - b.score);
            const mergeSplitLists = createMergeSplitLists(this.fullNodes, scores, 20);
            
            const getCornerValsFunc = (index, valueName) => {
                return readCornerVals(getCornerValsFuncExt(valueName), index)
            };
            // update the dynamic buffer contents
            updateDynamicNodeCache(
                this.nodeCache,
                getCornerValsFunc,
                this.fullNodes, 
                activeValueNames,
                mergeSplitLists,
                this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT
            );  
            
            frameTimeStore.add("node_update", nodeUpdateSW.stop());
        }
    }

    // concatenate the render nodes and treelet nodes buffers
    getNodeBuffer() {
        if (!this.usesTreelets) return this.renderNodes;

        // both uint8 typed arrays
        const renderNodes = new Uint8Array(this.renderNodes);
        const treeletNodes = this.meshCache.getBuffers()["treeletNodes"];

        const combinedNodes = new Uint8Array(renderNodes.length + treeletNodes.length);
        combinedNodes.set(renderNodes, 0);
        combinedNodes.set(treeletNodes, renderNodes.length);

        // return the array buffer
        return combinedNodes.buffer;
    }

    getTreeCells() {
        if (!this.usesTreelets) return new Uint32Array();
        return this.meshCache.getBuffers()["treeletCells"];
    }
}