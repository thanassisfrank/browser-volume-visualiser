// dynamicTree.js
// contains functions to create, update and manage dynamic tree nodes and dynamic unstructured mesh data

import { NODE_BYTE_LENGTH, writeNodeToBuffer, readNodeFromBuffer, processLeafMeshDataInfo } from "./cellTreeUtils.js";
import { writeCornerVals, readCornerVals } from "./treeNodeValues.js";
import { VecMath } from "../VecMath.js";
import { AssociativeCache, ScoredCacheManager } from "./cache.js";
import { ResolutionModes } from "./cellTreeUtils.js";


const NodeStates = {
    NONE: 0,
    MERGED: 1,
    SPLIT: 2,
};



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


// calculate the scores for the current leaf nodes, true leaf or pruned
// returns a list of leaf node objects containing their score
// assumes camera coords is in the dataset coordinate space
function getNodeScores (nodeCache, fullNodes, extentBox, focusCoords, camCoords) {
    var dynamicNodes = nodeCache.getBuffers()["nodes"];
    var nodeCount = Math.floor(dynamicNodes.byteLength/NODE_BYTE_LENGTH);

    const camToFocDist = VecMath.magnitude(VecMath.vecMinus(focusCoords, camCoords));;

    var scores = [];

    var rootNode = readNodeFromBuffer(dynamicNodes, 0);
    rootNode.depth = 0;
    var rootBox = {
        max: [...extentBox.max],
        min: [...extentBox.min],
    };

    // the next nodes to process
    var nodes = [rootNode];
    var boxes = [rootBox];
    var processed = 0;
    while (nodes.length > 0 && processed < nodeCount * 3) {
        processed++;
        const currNode = nodes.pop();
        const currBox = boxes.pop();
        if (currNode.rightPtr == 0) {
            // this is a leaf node, get its score
            currNode.score = calcBoxScore(currBox, focusCoords, camToFocDist);
            currNode.state = nodeCache.readBuffSlotAt("state", currNode.thisPtr)[0];
            scores.push(currNode);
        } else {
            // get the ptr to the children in the full buffer
            const currFullNode = readNodeFromBuffer(fullNodes, (currNode.thisFullPtr ?? 0) * NODE_BYTE_LENGTH);
            // add its children to the next nodes
            const rightNode = readNodeFromBuffer(dynamicNodes, currNode.rightPtr * NODE_BYTE_LENGTH);
            const leftNode = readNodeFromBuffer(dynamicNodes, currNode.leftPtr * NODE_BYTE_LENGTH);
            const bothLeaves = leftNode.rightPtr == 0 && rightNode.rightPtr == 0;

            rightNode.thisFullPtr = currFullNode.rightPtr;
            rightNode.bothSiblingsLeaves = bothLeaves;
            rightNode.depth = currNode.depth + 1;
            nodes.push(rightNode);
            
            const rightBox = {
                min: [currBox.min[0], currBox.min[1], currBox.min[2]],
                max: [currBox.max[0], currBox.max[1], currBox.max[2]],
            };
            rightBox.min[currNode.depth % 3] = currNode.splitVal;
            boxes.push(rightBox);


            leftNode.thisFullPtr = currFullNode.leftPtr;
            leftNode.bothSiblingsLeaves = bothLeaves;
            leftNode.depth = currNode.depth + 1;
            nodes.push(leftNode);

            const leftBox = {
                min: [currBox.min[0], currBox.min[1], currBox.min[2]],
                max: [currBox.max[0], currBox.max[1], currBox.max[2]],
            };
            leftBox.max[currNode.depth % 3] = currNode.splitVal;
            boxes.push(leftBox);
        }
    }

    // return the unsorted scores 
    return scores;
};


function updateMeshCacheScores(meshCache, scores) {
    // create a map from full pointer -> node score
    const fullPtrScoreMap = new Map();
    for (let node of scores) {
        fullPtrScoreMap.set(node.thisFullPtr, node.score);
    }
    // update the mesh cache with the node scores
    // if a node is not in the dynamic tree and thus the scores list, the score is set to -inf
    meshCache.syncScores(fullPtr => 
        fullPtrScoreMap.get(fullPtr) ?? Number.NEGATIVE_INFINITY
    );
}

// returns the index of this mesh block
// if it is not in the cache and wasnt loaded, returns -1
function tryLoadTrueLeafNodeMesh(nodeCache, meshCache, getMeshBlockFunc, childNode, activeValueSlots) {
    let meshBlockIndex = meshCache.getTagSlotNum(childNode.thisFullPtr);
    if (-1 != meshBlockIndex) return meshBlockIndex;

    // the mesh data for this leaf is not currently loaded
    // see if the score is high enough to load
    const worstScore = meshCache.getWorstScore().val;
    // score too low, dont load
    if (worstScore > childNode.score) return -1;

    // get mesh data
    const leafMesh = getMeshBlockFunc(childNode.thisFullPtr, activeValueSlots);
    // const leafMesh = dataObj.getNodeMeshBlock(childNode.thisFullPtr, activeValueSlots);

    // load new mesh data
    const loadResult = meshCache.insertNewBlock(childNode.score, childNode.thisFullPtr, leafMesh);
    meshBlockIndex = loadResult.slot;
    // check if the evicted block is currently loaded in the dynamic node cache
    if (undefined != loadResult.evicted) {
        const evictedTagNodeSlot = nodeCache.getTagSlotNum(loadResult.evicted);
        if (-1 != evictedTagNodeSlot) {
            // it is loaded, make sure that if it is currently a leaf, it becomes a pruned leaf with no cells
            nodeCache.updateBlockAt(evictedTagNodeSlot, {"nodes": {cellCount: 0}});
        }
    }

    return meshBlockIndex;        
}

function updateDynamicMeshCache(nodeCache, meshCache, getMeshBlockFunc, fullNodes, scores, activeValueSlots) {
    for (let node of scores) {
        if (node.rightPtr != 0) continue;
        // node is a leaf in dynamic tree
        const fullNode = readNodeFromBuffer(fullNodes, node.thisFullPtr * NODE_BYTE_LENGTH);
        if (fullNode.rightPtr != 0) continue;
        // this is a true leaf

        if (node.cellCount > 0) continue;
        // node is not connected with its mesh block

        // try to load the mesh data, evict if necessary
        const blockIndex = tryLoadTrueLeafNodeMesh(nodeCache, meshCache, getMeshBlockFunc, node, activeValueSlots);
        if (-1 == blockIndex) continue;
        // node's mesh is now present in the dynamic mesh cache

        // update node in the dynamic cache
        nodeCache.updateBlockAt(node.thisPtr, {
            "nodes": {cellCount: fullNode.cellCount, leftPtr: blockIndex}
        });
    }
}

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
    const splitThreshold = 0;
    const mergeThreshold = -0;

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


const updateDynamicNodeCache = (nodeCache, getCornerValsFunc, fullNodes, activeValueSlots, mergeSplit, noCells) => {
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
            
            for (let slotNum of activeValueSlots) {
                newData["corners" + slotNum] = getCornerValsFunc(childNode.thisPtr, slotNum);
            }

            nodeCache.insertNewBlockAt(freePtrs[2*i + j], childNode.thisPtr, newData);
        }
    }
};



export class DynamicTree {
    nodeCache;
    meshCache;

    fullNodes;

    constructor(resolutionMode) {
        this.resolutionMode = resolutionMode;
    }
    // create the buffers used for dynamic data resolution
    // for the first iteration, this only modifies the treenodes buffer
    createDynamicNodeCache (fullNodes, maxNodes) {
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
        })

        // create the empty cache buffers at the given maximum size
        // var dynamicNodes = new ArrayBuffer(maxNodes * NODE_BYTE_LENGTH);
        // fill the dynamic buffer from the full tree buffer, breadth first
        var currNodeIndex = 0; // where to write the next node

        var rootNode = readNodeFromBuffer(fullNodes, 0);

        this.nodeCache.insertNewBlockAt(0, rootNode.thisPtr, {
            "nodes": {splitVal: rootNode.splitVal, cellCount: 0, parentPtr: 0, leftPtr: 0, rightPtr: 0}
        });
        currNodeIndex++;
        
        var currDepth = 0;
        while (currNodeIndex < maxNodes) {
            // loop through all the nodes at this level of the tree 
            // try to add both their children
            addLayer: {
                for (let i = 0; i < Math.pow(2, currDepth); i++) {
                    // the parent node as it currently is in dynamic nodes
                    // var currParent = readNodeFromBuffer(dynamicNodes, 0);
                    var currParent = this.nodeCache.readBuffSlotAt("nodes", 0);

                    // the parent node in the full tree buffer
                    var currParentFull = rootNode;
                    var parentLoc = 0;
                    var parentLocFull = 0;

                    // navigate to the next node to add children too
                    for (let j = 0; j < currDepth; j++) {
                        // i acts as the route to get to the node (0 bit -> left, 1 bit -> right)
                        if ((i >> (currDepth - j - 1)) & 1 != 0) {
                            // go right
                            parentLoc = currParent.rightPtr;
                            parentLocFull = currParentFull.rightPtr;
                        } else {
                            // go left
                            parentLoc = currParent.leftPtr;
                            parentLocFull = currParentFull.leftPtr;
                        }
                        currParent = this.nodeCache.readBuffSlotAt("nodes", parentLoc);
                        currParentFull = readNodeFromBuffer(fullNodes, parentLocFull * NODE_BYTE_LENGTH);
                    }
                    // got to the node we want to add children to
                    // check if there is room to add the children
                    if (currNodeIndex < maxNodes - 2) {
                        // update parent so it is not a pruned leaf node
                        this.nodeCache.updateBlockAt(parentLoc, {
                            "nodes": {splitVal: currParentFull.splitVal, cellCount: 0, leftPtr: currNodeIndex, rightPtr: currNodeIndex + 1}
                        });
                        
                        // fetch the left node from the full buffer and write to dynamic as pruned leaf
                        var leftNode = readNodeFromBuffer(fullNodes, currParentFull.leftPtr * NODE_BYTE_LENGTH);
                        this.nodeCache.insertNewBlockAt(currNodeIndex, leftNode.thisPtr, {
                            "nodes": {splitVal: leftNode.splitVal, cellCount: 0, parentPtr: parentLoc, leftPtr: 0, rightPtr: 0}
                        });

                        // fetch the right node from the full buffer and write to dynamic as pruned leaf
                        var rightNode = readNodeFromBuffer(fullNodes, currParentFull.rightPtr * NODE_BYTE_LENGTH);
                        this.nodeCache.insertNewBlockAt(currNodeIndex + 1, rightNode.thisPtr, {
                            "nodes": {splitVal: rightNode.splitVal, cellCount: 0, parentPtr: parentLoc, leftPtr: 0, rightPtr: 0}
                        });
                    }
                    currNodeIndex += 2;
                    if (currNodeIndex >= maxNodes) break addLayer;
                }
            } 
            currDepth++;
        }
        console.log("written up to depth of", currDepth);
        console.log("written", currNodeIndex - 1, "nodes");
        console.log("made dynamic tree node buffer");
        return this.nodeCache;
    }

    // creates or modifies the dynamic corner values buffer 
    // agnostic to samples vs poly
    // extends the cache object used for dynamic nodes
    createMatchedDynamicCornerValues(fullCornerValues, slotNum) {
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
    };

    createDynamicMeshCache (blockSizes, leafBlockCount) {
        const cacheObj = new AssociativeCache(leafBlockCount);
    
        console.log(blockSizes);
        // mesh buffers
        cacheObj.createBuffer("positions", Float32Array, blockSizes.positions);
        cacheObj.createBuffer("cellOffsets", Uint32Array, blockSizes.cellOffsets);
        cacheObj.createBuffer("cellConnectivity", Uint32Array, blockSizes.cellConnectivity);
        
        this.meshCache = new ScoredCacheManager(cacheObj);

        return this.meshCache;
    }

    // run when a new data array is selected
    // creates a version of the dynamic mesh value array with the same blocks loaded in the same positions as the
    // dynamic mesh buffers for the mesh geometry
    // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
    createMatchedDynamicMeshValueArray (getMeshBlockFuncExt, slotNum) {
        const buffName = "values" + slotNum; 
        if (!this.meshCache.getBuffers()[buffName] ) {
            // create if not present
            this.meshCache.createBuffer(buffName, Float32Array, this.meshCache.blockSizes.positions/3);
        }

        // make sure that the corner buffer is synchronised to the currently loaded nodes
        this.meshCache.syncBuffer(
            buffName, 
            (fullPtr) => {
                const meshBlock = getMeshBlockFuncExt(fullPtr, [slotNum]);
                return meshBlock[buffName];
            }
        );
        
        return this.meshCache.getBuffers()[buffName];
    };


    // updates the dynamic dataset based on camera location
    // this handles updating the dynamic nodes and dynamic mesh
    // getCornerValsFuncExt -> dataObj.getFullCornerValues
    // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
    update(cameraChanged, focusCoords, camCoords, extentBox, getCornerValsFuncExt, getMeshBlockFuncExt, activeValueSlots) {
        if (cameraChanged) {
            // reset the record of modifications to nodes
            this.nodeCache.syncBuffer("state", tag => {return [NodeStates.NONE]});
        }
    
        if (this.resolutionMode & ResolutionModes.DYNAMIC_NODES_BIT) {
            // get a list of all nodes in the dynamic node tree with their scores
            const scores = getNodeScores(this.nodeCache, this.fullNodes, extentBox, focusCoords, camCoords);
    
            if (this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
                updateMeshCacheScores(this.meshCache, scores);
    
                // update the mesh blocks that are loaded in the cache
                updateDynamicMeshCache(this.nodeCache, this.meshCache, getMeshBlockFuncExt, this.fullNodes, scores, activeValueSlots);
            }
    
            scores.sort((a, b) => a.score - b.score);
            const mergeSplitLists = createMergeSplitLists(this.fullNodes, scores, 20);
            
            const getCornerValsFunc = (index, slotNum) => {
                return readCornerVals(getCornerValsFuncExt(slotNum), index)
            };
            // update the dynamic buffer contents
            updateDynamicNodeCache(
                this.nodeCache,
                getCornerValsFunc,
                this.fullNodes, 
                activeValueSlots,
                mergeSplitLists,
                this.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT
            );   
        }
    }
}