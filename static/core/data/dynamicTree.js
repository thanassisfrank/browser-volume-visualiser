// dynamicTree.js
// contains functions to create, update and manage dynamic tree nodes and dynamic unstructured mesh data

import { NODE_BYTE_LENGTH, writeNodeToBuffer, readNodeFromBuffer, processLeafMeshDataInfo } from "./cellTreeUtils.js";
import { writeCornerVals, readCornerVals } from "./treeNodeValues.js";
import { VecMath } from "../VecMath.js";



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


var changeNodeBufferContents = (dataObj, dynamicNodes, fullNodes, activeValueSlots, scores) => {
    // find the amount of changes we can now make
    // var changeCount = Math.min(scores.high.length, Math.floor(scores.low.length/2) * 2);
    const changeCount = Math.min(scores.merge.length, scores.split.length);
    // cap this at 1
    // changeCount = Math.min(1, changeCount);
    // console.log(changeCount);

    // merge the leaves with the highest scores with their siblings (delete 2 per change)
    var freePtrs = [];
    for (let i = 0; i < changeCount; i++) {
        // console.log("pruning", scores.low[i].parentPtr);
        var parentNode = readNodeFromBuffer(dynamicNodes, scores.merge[i].parentPtr * NODE_BYTE_LENGTH);
        // var parentFullPtr = readNodeFromBuffer(fullNodes, scores.merge[i]).parentPtr;
        freePtrs.push(parentNode.leftPtr, parentNode.rightPtr);
        // convert the parentNode to a pruned leaf
        writeNodeToBuffer(
            dynamicNodes, 
            scores.merge[i].parentPtr * NODE_BYTE_LENGTH,
            null,
            null,
            null,
            0,
            0,
        );
    }

    // console.log(freePtrs);

    // split the leaves with the lowest scores (write 2 per change)
    for (let i = 0; i < freePtrs.length/2; i++) {
        var thisNode = scores.split[i];
        // console.log("splitting", thisNode.thisPtr);
        var thisNodeFull = readNodeFromBuffer(fullNodes, thisNode.thisFullPtr * NODE_BYTE_LENGTH);
        // update node to branch
        writeNodeToBuffer(
            dynamicNodes,
            thisNode.thisPtr * NODE_BYTE_LENGTH,
            thisNodeFull.splitVal, // important to re-write the split val
            0,
            null,
            freePtrs[2*i],
            freePtrs[2*i + 1]
        );

        // console.log(readNodeFromBuffer(dynamicNodes, thisNode.thisPtr * NODE_BYTE_LENGTH));
        
        // fetch the left node from the full buffer and write to dynamic as pruned leaf
        var leftNode = readNodeFromBuffer(fullNodes, thisNodeFull.leftPtr * NODE_BYTE_LENGTH);
        writeNodeToBuffer(
            dynamicNodes, 
            freePtrs[2*i] * NODE_BYTE_LENGTH, 
            null, 
            leftNode.cellCount,
            thisNode.thisPtr, 
            leftNode.leftPtr, 
            0
        );

        // console.log(readNodeFromBuffer(dynamicNodes, freePtrs[2*i] * NODE_BYTE_LENGTH));
        // fetch the right node from the full buffer and write to dynamic as pruned leaf
        var rightNode = readNodeFromBuffer(fullNodes, thisNodeFull.rightPtr * NODE_BYTE_LENGTH);
        writeNodeToBuffer(
            dynamicNodes, 
            freePtrs[2*i + 1] * NODE_BYTE_LENGTH, 
            null, 
            rightNode.cellCount,
            thisNode.thisPtr, 
            rightNode.leftPtr, 
            0
        );

        for (let slotNum of activeValueSlots) {
            writeCornerVals(
                dataObj.getDynamicCornerValues(slotNum),
                freePtrs[2*i],
                readCornerVals(dataObj.getFullCornerValues(slotNum), leftNode.thisPtr)
            )
            writeCornerVals(
                dataObj.getDynamicCornerValues(slotNum),
                freePtrs[2*i + 1],
                readCornerVals(dataObj.getFullCornerValues(slotNum), rightNode.thisPtr)
            )
        }

        // console.log(readNodeFromBuffer(dynamicNodes, freePtrs[2*i + 1] * NODE_BYTE_LENGTH));
    }
}


// updates the dynamic tree buffers based on camera location
// split nodes that are too large
// merge nodes that are too small
// if a node is 
export var updateDynamicTreeBuffers = (dataObj, threshold, focusCoords, camCoords, activeValueSlots) => {
    // get the node scores, n lowest highest
    performance.mark("scoresStart");
    const scores = getNodeScores(dataObj, focusCoords, camCoords);
    performance.mark("scoresEnd");
    performance.measure("scoresDur", "scoresStart", "scoresEnd");

    performance.mark("sortStart");
    scores.sort((a, b) => a.score - b.score);
    performance.mark("sortEnd");
    performance.measure("sortDur", "sortStart", "sortEnd");

    // scores = sanitiseNodeScores(dataObj.data.treeNodes, scores);
    performance.mark("msStart");
    const mergeSplitLists = createMergeSplitLists(dataObj.data.treeNodes, scores, 20);
    performance.mark("msEnd");
    performance.measure("msDur", "msStart", "msEnd");
    
    // console.log(mergeSplitLists);
    // update the dynamic buffer contents
    performance.mark("buffStart");
    changeNodeBufferContents(
        dataObj,
        dataObj.data.dynamicTreeNodes, 
        dataObj.data.treeNodes, 
        activeValueSlots,
        mergeSplitLists
    );  
    performance.mark("buffEnd");
    performance.measure("buffDur", "buffStart", "buffEnd");

    // console.log("Scores", performance.measure("scoresDur", "scoresStart", "scoresEnd").duration);
    // console.log("Sort", performance.measure("sortDur", "sortStart", "sortEnd").duration);
    // console.log("MergeSplit", performance.measure("msDur", "msStart", "msEnd").duration);
    // console.log("Buff", performance.measure("buffDur", "buffStart", "buffEnd").duration);
    // console.log("updated");  
}



// create the buffers used for dynamic data resolution
// for the first iteration, this only modifies the treenodes buffer
export var createDynamicTreeNodes = (dataObj, maxNodes) => {
    var fullNodes = dataObj.data.treeNodes;
    // create the empty cache buffers at the given maximum size
    var dynamicNodes = new ArrayBuffer(maxNodes * NODE_BYTE_LENGTH);
    // var dynamicCornerValues = new Float32Array(8 * maxNodes);
    // find the depth of the tree 
    // fill the dynamic buffer from the full tree buffer, breadth first
    var currNodeIndex = 0; // where to write the next node

    var rootNode = readNodeFromBuffer(fullNodes, 0);
    // console.log(rootNode);
    writeNodeToBuffer(dynamicNodes, 0, rootNode.splitVal, 0, 0, 0, 0);
    currNodeIndex++;
        
    var currDepth = 0;
    while (currNodeIndex < maxNodes) {
        // loop through all the nodes at this level of the tree 
        // try to add both their children
        addLayer: {
            for (let i = 0; i < Math.pow(2, currDepth); i++) {
                // the parent node as it currently is in dynamic nodes
                var currParent = readNodeFromBuffer(dynamicNodes, 0);
                // the parent node in the full tree buffer
                var currParentFull = rootNode;
                var parentLoc = 0;
                var parentLocFull = 0;

                // navigate to the next node to add children too
                for (let j = 0; j < currDepth; j++) {
                    // i acts as the route to get to the node (0 bit -> left, 1 bit -> right)
                    if ((i >> (currDepth - j - 1)) & 1 != 0) {
                        // go right
                        parentLoc = currParent.rightPtr * NODE_BYTE_LENGTH;
                        parentLocFull = currParentFull.rightPtr * NODE_BYTE_LENGTH;
                    } else {
                        // go left
                        parentLoc = currParent.leftPtr * NODE_BYTE_LENGTH;
                        parentLocFull = currParentFull.leftPtr * NODE_BYTE_LENGTH;
                    }
                    currParent = readNodeFromBuffer(dynamicNodes, parentLoc);
                    currParentFull = readNodeFromBuffer(fullNodes, parentLocFull);
                }
                // got to the node we want to add children to
                // check if there is room to add the children
                if (currNodeIndex < maxNodes - 2) {
                    // update parent so it is not a pruned leaf node
                    writeNodeToBuffer(
                        dynamicNodes, 
                        parentLoc, 
                        currParentFull.splitVal, 
                        0, 
                        null,
                        currNodeIndex, 
                        currNodeIndex + 1
                    )
                    
                    // fetch the left node from the full buffer and write to dynamic as pruned leaf
                    // console.log(currParentFull.leftPtr);
                    var leftNode = readNodeFromBuffer(fullNodes, currParentFull.leftPtr * NODE_BYTE_LENGTH);
                    writeNodeToBuffer(
                        dynamicNodes, 
                        currNodeIndex * NODE_BYTE_LENGTH, 
                        leftNode.splitVal, 
                        0,
                        parentLoc/NODE_BYTE_LENGTH, 
                        0, 
                        0
                    );
                    // writeCornerVals(
                    //     dynamicCornerValues,
                    //     currNodeIndex,
                    //     dataObj.data.cornerValues.slice(leftNode.thisPtr * 8, (leftNode.thisPtr + 1)* 8)
                    // );
                    // fetch the right node from the full buffer and write to dynamic as pruned leaf
                    var rightNode = readNodeFromBuffer(fullNodes, currParentFull.rightPtr * NODE_BYTE_LENGTH);
                    writeNodeToBuffer(
                        dynamicNodes, 
                        (currNodeIndex + 1) * NODE_BYTE_LENGTH, 
                        rightNode.splitVal, 
                        0, 
                        parentLoc/NODE_BYTE_LENGTH, 
                        0, 
                        0
                    )
                    // writeCornerVals( 
                    //     dynamicCornerValues,
                    //     (currNodeIndex + 1),
                    //     dataObj.data.cornerValues.slice(rightNode.thisPtr * 8, (rightNode.thisPtr + 1)* 8)
                    // );
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
    for (let i = 0; i < dynamicNodes.byteLength/NODE_BYTE_LENGTH; i++) {
        // console.log(readNodeFromBuffer(dynamicNodes, i * NODE_BYTE_LENGTH));
    }
    return dynamicNodes;
}



// dynamic mesh data ======================================================================================

export const createDynamicMeshData = (dataObj, maxLeafBlocks) => {
    var maxCells = 0; // max number of cells found within the leaf nodes
    var maxVerts = 0; // max number of unique verts found in the leaf nodes
    processLeafMeshDataInfo(dataObj, l => {
        maxCells = Math.max(maxCells, l.cells);
        maxVerts = Math.max(maxVerts, l.verts);
    });

    console.log(maxCells, maxVerts);

    return {
        positions: new Float32Array(3 * maxVerts * maxLeafBlocks),
        cellOffsets: new Float32Array(maxCells * maxLeafBlocks),
        cellConnectivity: new Uint32Array(4 * maxCells * maxLeafBlocks),
    }
}