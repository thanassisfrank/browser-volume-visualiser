// dynamicTree.js
// contains functions to create, update and manage dynamic tree nodes and dynamic unstructured mesh data

import { NODE_BYTE_LENGTH, writeNodeToBuffer, readNodeFromBuffer, processLeafMeshDataInfo } from "./cellTreeUtils.js";
import { writeCornerVals, readCornerVals } from "./treeNodeValues.js";
import { VecMath } from "../VecMath.js";
import { AssociativeCache } from "./cache.js";
import { ResolutionModes } from "./data.js";



// calculates a score for the box
// high score -> too big -> split
// low score -> too small -> merge
// box size/distance from focus point
// modified by distance of camera -> focus point
// > closer -> 
var calcBoxScore = (box, focusCoords, camToFocDist) => {
    // get max axis=aligned dimension of box
    var lMax = Math.abs(Math.max(...VecMath.vecMinus(box.max, box.min)));
    var mid = VecMath.scalMult(0.5, VecMath.vecAdd(box.min, box.max));
    // distance of box from camera
    // distance of box from focus
    var distToFoc = VecMath.magnitude(VecMath.vecMinus(focusCoords, mid));
    // target length approach
    return lMax - Math.max(0, (Math.abs(distToFoc)-10)/camToFocDist*10 + 5);
}


// calculate the scores for the current leaf nodes, true leaf or pruned
// returns a list of leaf node objects containing their score
// assumes camera coords is in the dataset coordinate space
function getNodeScores (dataObj, focusCoords, camCoords) {
    // console.log(threshold);
    var dynamicNodes = dataObj.data.dynamicTreeNodes;
    var fullNodes = dataObj.data.treeNodes;
    var nodeCount = Math.floor(dynamicNodes.byteLength/NODE_BYTE_LENGTH);

    const camToFocDist = VecMath.magnitude(VecMath.vecMinus(focusCoords, camCoords));;

    var scores = [];

    var rootNode = readNodeFromBuffer(dynamicNodes, 0);
    rootNode.depth = 0;
    var rootBox = {
        max: [...dataObj.extentBox.max],
        min: [...dataObj.extentBox.min],
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
}

// takes the full scores list and returns a list of nodes to split and a list to merge
// these will have length equal to count
// the split list contains pruned leaves that should be split
// the merge list contains leaves that should be merged with their siblings
var createMergeSplitLists = (fullNodes, scores, maxCount) => {
    // proportion of the scores to search for nodes to split and merge
    // combats flickering 
    const searchProp = 1;
    var mergeList = [];
    var splitList = [];

    let currNode, currFullNode;

    let lowestSplitIndex = scores.length - 1;
    // create the split list first
    for (let i = scores.length - 1; i >= Math.max(0, scores.length * (1 - searchProp)); i--) {
        if (splitList.length >= maxCount) break;
        currNode = scores[i];
        if (currNode.score < 0) break;
        currFullNode = readNodeFromBuffer(fullNodes, (currNode.thisFullPtr ?? 0) * NODE_BYTE_LENGTH);
        // can't be split if its a true leaf
        if (currFullNode.rightPtr == 0) continue;

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
        if (currNode.score > 0) break;
        // can't be merged if sibling not a leaf
        if (!currNode.bothSiblingsLeaves) continue;
        // check if sibling is in split list
        // check if the same parent appears there
        if (!splitList.every(x => x.parentPtr != currNode.parentPtr)) continue;
        // check if sibling is already in merge list
        if (!mergeList.every(x => x.parentPtr != currNode.parentPtr)) continue;

        // passed all checks
        mergeList.push(currNode);
        highestMergeIndex = i;
    }

    // console.log("lowest split index:", lowestSplitIndex);
    // console.log("highest merge index:", highestMergeIndex);

    return {
        merge: mergeList,
        split: splitList
    }
}


var updateDynamicNodeCache = (dataObj, fullNodes, activeValueSlots, scores) => {
    // find the amount of changes we can now make
    // var changeCount = Math.min(scores.high.length, Math.floor(scores.low.length/2) * 2);
    const changeCount = Math.min(scores.merge.length, scores.split.length);
    // cap this at 1
    // changeCount = Math.min(1, changeCount);
    // console.log(changeCount);

    // merge the leaves with the highest scores with their siblings (delete 2 per change)
    var freePtrs = [];
    for (let i = 0; i < changeCount; i++) {
        var parentNode = dataObj.dynamicNodeCache.readBuffSlotAt("nodes", scores.merge[i].parentPtr);
        freePtrs.push(parentNode.leftPtr, parentNode.rightPtr);
        // convert the parentNode to a pruned leaf
        dataObj.dynamicNodeCache.updateBlockAt(scores.merge[i].parentPtr, {
            "nodes": {leftPtr: 0, rightPtr: 0}
        });
    }

    // split the leaves with the lowest scores (write 2 per change)
    for (let i = 0; i < freePtrs.length/2; i++) {
        var thisNode = scores.split[i];
        var thisNodeFull = readNodeFromBuffer(fullNodes, thisNode.thisFullPtr * NODE_BYTE_LENGTH);
        // update node to branch
        dataObj.dynamicNodeCache.updateBlockAt(thisNode.thisPtr, {
            "nodes": {splitVal: thisNodeFull.splitVal, cellCount: 0, leftPtr: freePtrs[2*i], rightPtr: freePtrs[2*i + 1]}
        })

        const childPtrs = [thisNodeFull.leftPtr, thisNodeFull.rightPtr];
        for (let j = 0; j < 2; j++) {
            let childNode = readNodeFromBuffer(fullNodes, childPtrs[j] * NODE_BYTE_LENGTH);
            let newData = {
                "nodes": {
                    splitVal: childNode.splitVal, 
                    cellCount: 0,//childNode.cellCount, 
                    parentPtr: thisNode.thisPtr, 
                    leftPtr: childNode.leftPtr, 
                    rightPtr: 0
                }
            };

            if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS && 0 == childNode.rightPtr) {
                // this new node is a true leaf, check if the mesh data is already cached
                console.log("new leaf");
                var meshBlockIndex = dataObj.dynamicMeshCache.getTagSlotNum(childNode.thisPtr);
                if (-1 == meshBlockIndex) {
                    // the mesh data for this leaf is not currently loaded, load it
                    const leafMesh = dataObj.getNodeMeshBlock(childNode.thisPtr, activeValueSlots);
                    const loadResult = dataObj.dynamicMeshCache.insertNewBlockRand(childNode.thisPtr, leafMesh);
                    meshBlockIndex = loadResult.slot;
                    // check if the evicted block is currently loaded in the dynamic node cache
                    if (undefined != loadResult.evicted) {
                        const evictedTagNodeSlot = dataObj.dynamicNodeCache.getTagSlotNum(loadResult.evicted);
                        if (-1 != evictedTagNodeSlot) {
                            // it is loaded, make sure that if it is currently a leaf, it becomes a pruned leaf with no cells
                            dataObj.dynamicNodeCache.updateBlockAt(evictedTagNodeSlot, {"nodes": {cellCount: 0}});
                        }
                    }
                }

                // mark as a full leaf
                newData["nodes"].leftPtr = meshBlockIndex;
            }

            for (let slotNum of activeValueSlots) {
                newData["corners" + slotNum] = readCornerVals(dataObj.getFullCornerValues(slotNum), childNode.thisPtr);
            }

            dataObj.dynamicNodeCache.insertNewBlockAt(freePtrs[2*i + j], childNode.thisPtr, newData);
        }
    }
}


// updates the dynamic dataset based on camera location
// this handles updating the dynamic nodes and dynamic mesh
export var updateDynamicDataset = (dataObj, threshold, focusCoords, camCoords, activeValueSlots) => {
    
    if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_NODES) {
        // get the node scores, n lowest highest
        const scores = getNodeScores(dataObj, focusCoords, camCoords);
        scores.sort((a, b) => a.score - b.score);
        const mergeSplitLists = createMergeSplitLists(dataObj.data.treeNodes, scores, 20);
        
        // update the dynamic buffer contents
        updateDynamicNodeCache(
            dataObj,
            dataObj.data.treeNodes, 
            activeValueSlots,
            mergeSplitLists
        );   
    }
}



// create the buffers used for dynamic data resolution
// for the first iteration, this only modifies the treenodes buffer
export var createDynamicNodeCache = (dataObj, maxNodes) => {
    var fullNodes = dataObj.data.treeNodes;

    // set up the cache object for the dynamic nodes
    var dynamicNodeCache = new AssociativeCache(maxNodes);
    dynamicNodeCache.createBuffer("nodes", ArrayBuffer, NODE_BYTE_LENGTH);
    dynamicNodeCache.setReadFunc("nodes", (buff, slotNum, blockSize) => {
        // console.log("n");
        return readNodeFromBuffer(buff, slotNum * blockSize);
    });
    dynamicNodeCache.setWriteFunc("nodes", (buff, data, slotNum, blockSize) => {
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

    // writeNodeToBuffer(dynamicNodes, 0, rootNode.splitVal, 0, 0, 0, 0);
    dynamicNodeCache.insertNewBlockAt(0, rootNode.thisPtr, {
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
                var currParent = dynamicNodeCache.readBuffSlotAt("nodes", 0);

                // the parent node in the full tree buffer
                var currParentFull = rootNode;
                var parentLoc = 0;
                var parentLocFull = 0;

                // navigate to the next node to add children too
                for (let j = 0; j < currDepth; j++) {
                    // i acts as the route to get to the node (0 bit -> left, 1 bit -> right)
                    if ((i >> (currDepth - j - 1)) & 1 != 0) {
                        // go right
                        parentLoc = currParent.rightPtr //* NODE_BYTE_LENGTH;
                        parentLocFull = currParentFull.rightPtr //* NODE_BYTE_LENGTH;
                    } else {
                        // go left
                        parentLoc = currParent.leftPtr //* NODE_BYTE_LENGTH;
                        parentLocFull = currParentFull.leftPtr //* NODE_BYTE_LENGTH;
                    }
                    // currParent = readNodeFromBuffer(dynamicNodes, parentLoc);
                    currParent = dynamicNodeCache.readBuffSlotAt("nodes", parentLoc);
                    currParentFull = readNodeFromBuffer(fullNodes, parentLocFull * NODE_BYTE_LENGTH);
                }
                // got to the node we want to add children to
                // check if there is room to add the children
                if (currNodeIndex < maxNodes - 2) {
                    // update parent so it is not a pruned leaf node
                    dynamicNodeCache.updateBlockAt(parentLoc, {
                        "nodes": {splitVal: currParentFull.splitVal, cellCount: 0, leftPtr: currNodeIndex, rightPtr: currNodeIndex + 1}
                    });
                    
                    // fetch the left node from the full buffer and write to dynamic as pruned leaf
                    // console.log(currParentFull.leftPtr);
                    var leftNode = readNodeFromBuffer(fullNodes, currParentFull.leftPtr * NODE_BYTE_LENGTH);
                    dynamicNodeCache.insertNewBlockAt(currNodeIndex, leftNode.thisPtr, {
                        "nodes": {splitVal: leftNode.splitVal, cellCount: 0, parentPtr: parentLoc, leftPtr: 0, rightPtr: 0}
                    });

                    // fetch the right node from the full buffer and write to dynamic as pruned leaf
                    var rightNode = readNodeFromBuffer(fullNodes, currParentFull.rightPtr * NODE_BYTE_LENGTH);
                    dynamicNodeCache.insertNewBlockAt(currNodeIndex + 1, rightNode.thisPtr, {
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
    return dynamicNodeCache;
}



// dynamic mesh data ======================================================================================
export const createDynamicMeshCache = (blockSizes, leafBlockCount) => {
    const dynamicMeshCache = new AssociativeCache(leafBlockCount);
    dynamicMeshCache.createBuffer("positions", Float32Array, blockSizes.positions);
    dynamicMeshCache.createBuffer("cellOffsets", Uint32Array, blockSizes.cellOffsets);
    dynamicMeshCache.createBuffer("cellConnectivity", Uint32Array, blockSizes.cellConnectivity);

    return dynamicMeshCache;
}

// run when a new data array is selected
// creates a version of the dynamic mesh value array with the same blocks loaded in the same positions as the
// dynamic mesh buffers for the mesh geometry
export const createMatchedDynamicMeshValueArray = (dataObj, slotNum) => {
    const buffName = "values" + slotNum; 
    if (!dataObj.dynamicMeshCache.getBuffers()[buffName] ) {
        // create if not present
        dataObj.dynamicMeshCache.createBuffer(buffName, Float32Array, dataObj.dynamicMeshCache.blockSizes.positions/3);
    }

    console.log(dataObj.dynamicMeshCache);
    // make sure that the corner buffer is synchronised to the currently loaded nodes
    dataObj.dynamicMeshCache.syncBuffer(
        buffName, 
        (fullPtr) => dataObj.getNodeMeshBlock(fullPtr, [slotNum])[buffName]
    );
    
    return dataObj.dynamicMeshCache.getBuffers()[buffName];
}