// cellTree.js
// allows creating a kd based cell tree
// manages
import { NODE_BYTE_LENGTH, ChildTypes, writeNodeToBuffer, readNodeFromBuffer, getNodeBox, pivotFull, forEachDepth } from "./cellTreeUtils.js";
import { writeCornerVals, readCornerVals } from "./treeNodeValues.js";
import { VecMath } from "../VecMath.js";

export const KDTreeSplitTypes = {
    VERT_MEDIAN:    1,
    VERT_AVERAGE:   2,
    NODE_MEDIAN:    3,
    SURF_AREA_HEUR: 4,
    VOLUME_HEUR:    5
}

// finds the sizes of the buffers required for each leaf to store its part of the mesh
// logs this to the console
export const logLeafMeshBufferSizes = (dataObj) => {
    const bufferBytes = {
        // 4B per vert
        values: [],
        // positions is 12B per vert

        // 4B per cell
        offsets: [],
        // connectivity is 16B per cell as the mesh is tetrahedral for now
    };

    const treeNodes = dataObj.data.treeNodes;
    // iterate through all leaves
    var nodes = [readNodeFromBuffer(treeNodes, 0)];
    while (nodes.length > 0) {
        const currNode = nodes.pop();
        if (currNode.rightPtr == 0) {
            // this is a leaf node, work out its buffer sizes
            bufferBytes.offsets.push(4 * currNode.cellCount);

            // iterate through all cells and get unique vertex count
            const uniqueVerts = new Set();

            var cellsPtr = currNode.leftPtr; // go to where cells are stored
            for (let i = 0; i < currNode.cellCount; i++) {
                // go through and check all the contained cells
                var cellID = dataObj.data.treeCells[cellsPtr + i];

                // figure out if cell is inside using barycentric coords
                var pointsOffset = dataObj.data.cellOffsets[cellID];
                // read all the point positions and check each
                for (let j = 0; j < 4; j++) {
                    var thisPointIndex = dataObj.data.cellConnectivity[pointsOffset + j];

                    if (uniqueVerts.has(thisPointIndex)) continue;
                    uniqueVerts.add(thisPointIndex);
                }  
            }

            bufferBytes.values.push(4 * uniqueVerts.size);

        } else {
            // add its children to the next nodes
            nodes.push(readNodeFromBuffer(treeNodes, currNode.rightPtr * NODE_BYTE_LENGTH));
            nodes.push(readNodeFromBuffer(treeNodes, currNode.leftPtr * NODE_BYTE_LENGTH));
        }
    }

    bufferBytes.values.sort((a, b) => a - b);
    bufferBytes.offsets.sort((a, b) => a - b);

    var str = ""

    for (let name of ["values", "offsets"]) {
        const minVal = bufferBytes[name][0];
        const maxVal = bufferBytes[name].at(-1);
        console.log("min " + name + " size " + minVal.toString() + "B");
        console.log("max " + name + " size " + maxVal.toString() + "B");
    }
    str += "values\toffsets\n";

    str += bufferBytes.values.map((e, i) => e.toString() + "\t" + bufferBytes.offsets[i].toString()).join("\n");

    navigator.clipboard.writeText(str);

    console.log("samples copied to clipboard!")
}


// calculates a score for the box
// high score -> too big -> split
// low score -> too small -> merge
// box size/distance from focus point
// modified by distance of camera -> focus point
// > closer -> 
var calcBoxScore = (box, focusCoords, camToFocDist) => {
    // get corner-to-corner length of the box
    // var length = VecMath.magnitude(VecMath.vecMinus(box.max, box.min));
    var lMax = Math.abs(Math.max(...VecMath.vecMinus(box.max, box.min)));
    var mid = VecMath.scalMult(0.5, VecMath.vecAdd(box.min, box.max));
    // distance of box from camera
    // var distToCam = VecMath.magnitude(VecMath.vecMinus(camCoords, mid));
    // distance of box from focus
    var distToFoc = VecMath.magnitude(VecMath.vecMinus(focusCoords, mid));
    // distance of camera from focus
    // var camtoFoc = VecMath.magnitude(VecMath.vecMinus(focusCoords, camCoords));

    // original
    // return lMax/Math.pow(dist, 0.8);

    // return Math.max(0, length - 0.01*(dist * (50 - camDist)));


    // var score = lMax/distToCam; // visual size estimate
    // if (camDist/dist > 2) score /= camDist; // focus spot bonus
    // score += Math.pow(camtoFoc/distToFoc, 1.5);
    // score += Math.pow(2, -Math.pow(camtoFoc/distToFoc, 2))/camtoFoc;

    // most successful so far
    // return lMax/distToCam * Math.max(0, (5-Math.abs(distToFoc)/camtoFoc)/camtoFoc);

    // score seems to be too focussed on centre
    // return  lMax + Math.min(5, Math.max(-1, (2-Math.abs(distToFoc/2)/(0.1*camtoFoc))/(0.1*camtoFoc)));

    // target length approach
    // return lMax - Math.max(0, Math.abs(distToFoc/2))
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


// generates the cell tree for fast lookups in unstructured data
// returns two buffers:
//   the nodes of the tree (leaves store indices into second buffer)
//   the lists of cells present in each leaf node 
export var getCellTreeBuffers = (dataObj, maxLeafCells, maxDepth, treeSplitType) => {
    var tree = new CellTree();
    // dimensions, depth, points, cellConnectivity, cellOffsets, cellTypes
    var t0 = performance.now();
    tree.setBuffers(
        dataObj.data.positions, 
        dataObj.data.cellConnectivity,
        dataObj.data.cellOffsets,
        dataObj.data.cellTypes
    );

    tree.setExtentBox(dataObj.extentBox);

    switch (treeSplitType) {
        case KDTreeSplitTypes.VERT_MEDIAN:
            console.log("vert median tree");
            tree.buildVertexMedian(maxLeafCells, maxDepth);
            break;
        case KDTreeSplitTypes.VERT_AVERAGE:
            console.log("vert average tree");
            tree.buildVertexAverage(maxLeafCells, maxDepth);
            break;
        case KDTreeSplitTypes.NODE_MEDIAN:
            tree.buildNodeMedian(maxLeafCells, maxDepth);
            break;
        case KDTreeSplitTypes.SURF_AREA_HEUR:
            tree.buildSAH(maxLeafCells, maxDepth);
            break;
        case KDTreeSplitTypes.VOLUME_HEUR:
            tree.buildVolH(maxLeafCells, maxDepth);
            break;
        default:
            throw Error("Tree split type not recognised");

    }
    var t1 = performance.now();
    console.log("tree build took:", (t1 - t0)/1000, "s");
    var treeBuffers = tree.serialise();
    tree.tree = null; // clear the unused tree
    var t2 = performance.now();
    console.log("tree serialise took:", (t2 - t1)/1000, "s");
    return treeBuffers;
}

export function CellTree() {
    this.tree = null;

    const dimensions = 3;

    this.points = null;
    this.cellConnectivity = null;
    this.cellOffsets = null;
    this.cellTypes = null;

    this.extentBox = null;

    this.setBuffers = function(points, cellConnectivity, cellOffsets, cellTypes) {
        this.points = points;
        this.cellConnectivity = cellConnectivity;
        this.cellOffsets = cellOffsets;
        this.cellTypes = cellTypes;
    }

    this.setExtentBox = function(box) {
        this.extentBox = box;
    }

    this.checkCellPosition = function(id, checkDimension, splitVal) {
        // first get the points in the cell
        var pointsLength = 0;
        switch (this.cellTypes[id]) {
            case 10: // tet
                pointsLength = 4;
                break;
            case 12: // hexa
                pointsLength = 8;
                break;
            case 5:  // tri
                pointsLength = 3;
                break;
        }
        var pointsOffset = this.cellOffsets[id];
        var results = [false, false];
        var thisPointValue;
        for (let i = 0; i < pointsLength; i++) {
            // the position of this point in the dimension that is being checked
            thisPointValue = this.points[this.cellConnectivity[pointsOffset + i]*dimensions + checkDimension];
            if (thisPointValue <= splitVal) results[0] = true;
            if (thisPointValue > splitVal)  results[1] = true;
        }
        return results;
    }

    this.createNode = function(depth = 0, splitDimension = 0, points = null, cells = [], parent = null) {
        return{
            depth: depth,
            splitDimension: splitDimension,
            splitVal: null,
            parent: parent,
            byteLocation: 0,
            left: null,
            right: null,
            points: points,
            cells: cells
        }
    }
    // builds a tree by splitting the whole data with median each time
    this.buildVertexMedian = function(maxLeafCells, maxDepth) {
        // console.log(points);
        var cellsTree = false;
        if (this.cellConnectivity) cellsTree = true;
        // checks whether the cell of the given id is lte, gt the split val in checked dimension or both
    
        var nodeQueue = [];
        var cellsCountSum = 0;
        var leavesCount = 0;
        // make a root node with the whole dataset
        var root = this.createNode(0, 0, this.points);

        if (cellsTree) {
            for (let i = 0; i < this.cellOffsets.length; i++) {
                root.cells.push(i);
            }
        }
        nodeQueue.push(root);
    
        while (nodeQueue.length > 0) {
            var parentNode = nodeQueue.pop();
            var currentDepth = parentNode.depth + 1;
            // stop the expansion of this node if the tree is deep enough
            // or stop if the # cells is already low enough
            if (currentDepth > maxDepth || parentNode.cells.length <= maxLeafCells) {
                // console.log(parentNode.points.length);
                cellsCountSum += parentNode.cells.length;
                leavesCount++;
                continue;
            }
    
            var currentDimension = parentNode.splitDimension;
            var currentPoints = parentNode.points;
    
            // make a set of points that is just the values in the current dimension
            var thisDimValues = new Float32Array(currentPoints.length/3);
            for (let i = currentDimension; i < currentPoints.length; i += dimensions) {
                // console.log(i);
                thisDimValues[(i - currentDimension)/dimensions] = currentPoints[i];
            }
            
            // find the pivot 
            parentNode.splitVal = pivotFull(thisDimValues);
    
            // split the points into left and right
            var leftPoints = [];
            var rightPoints = [];
            for (let i = 0; i < currentPoints.length; i+= dimensions) {
                if (currentPoints[i + currentDimension] <= parentNode.splitVal) {
                    // point goes in left
                    for (let j = 0; j < dimensions; j++) {
                        leftPoints.push(currentPoints[i + j]);
                    }
                } else {
                    // point goes in right
                    for (let j = 0; j < dimensions; j++) {
                        rightPoints.push(currentPoints[i + j]);
                    }
                }
            }
            
            if(leftPoints.length < 3 || rightPoints.length < 3) {
                // console.log(currentPoints.length);
                // didn't successfully split node, dont split to make degenerate node
                continue;
            }
    
            // split the cells into left and right
            var leftCells = [];
            var rightCells = [];
    
            if (cellsTree) {
                for (let cellID of parentNode.cells) {
                    // see if cell is <= pivot, > pivot or both
                    var cellSides = this.checkCellPosition(cellID, currentDimension, parentNode.splitVal);
                    if (cellSides[0]) leftCells.push(cellID);
                    if (cellSides[1]) rightCells.push(cellID);
                }
            }
    
            // create the new left and right nodes
            var nextDimension = (currentDimension + 1) % dimensions;
            var leftNode = this.createNode(currentDepth, nextDimension, leftPoints, leftCells, parentNode);
            var rightNode = this.createNode(currentDepth, nextDimension, rightPoints, rightCells, parentNode);
    
            // make sure the parent is properly closed out
            parentNode.cells = null;
            parentNode.points = null;
            parentNode.left = leftNode;
            parentNode.right = rightNode;
    
            // add children to the queue
            nodeQueue.push(leftNode, rightNode);
        }

        console.log("avg cells in leaves:", cellsCountSum/leavesCount);
    
        // return the tree object
        this.tree = root;
        return this.tree;
    }

    // builds a tree by splitting the whole data with median each time
    this.buildVertexAverage = function(maxLeafCells, maxDepth) {
        // console.log(points);
        var cellsTree = false;
        if (this.cellConnectivity) cellsTree = true;
    
        var nodeQueue = [];
        var cellsCountSum = 0;
        var leavesCount = 0;
        // make a root node with the whole dataset
        var root = this.createNode(0, 0, this.points);

        if (cellsTree) {
            for (let i = 0; i < this.cellOffsets.length; i++) {
                root.cells.push(i);
            }
        }
        nodeQueue.push(root);
    
        while (nodeQueue.length > 0) {
            var parentNode = nodeQueue.pop();
            var currentDepth = parentNode.depth + 1;
            // stop the expansion of this node if the tree is deep enough
            // or stop if the # cells is already low enough
            if (currentDepth > maxDepth || parentNode.cells.length <= maxLeafCells) {
                // console.log(parentNode.points.length);
                cellsCountSum += parentNode.cells.length;
                leavesCount++;
                continue;
            }
    
            var currentDimension = parentNode.splitDimension;
            var currentPoints = parentNode.points;
    
            // make a set of points that is just the values in the current dimension
            var thisDimMin = Number.POSITIVE_INFINITY;
            var thisDimMax = Number.NEGATIVE_INFINITY;
            for (let i = currentDimension; i < currentPoints.length; i += dimensions) {
                thisDimMin = Math.min(currentPoints[i], thisDimMin);
                thisDimMax = Math.max(currentPoints[i], thisDimMax);
            }
            
            // find the pivot 
            parentNode.splitVal = (thisDimMin + thisDimMax)/2;
    
            // split the points into left and right
            var leftPoints = [];
            var rightPoints = [];
            for (let i = 0; i < currentPoints.length; i+= dimensions) {
                if (currentPoints[i + currentDimension] <= parentNode.splitVal) {
                    // point goes in left
                    for (let j = 0; j < dimensions; j++) {
                        leftPoints.push(currentPoints[i + j]);
                    }
                } else {
                    // point goes in right
                    for (let j = 0; j < dimensions; j++) {
                        rightPoints.push(currentPoints[i + j]);
                    }
                }
            }
            
            if(leftPoints.length < 3 || rightPoints.length < 3) {
                // console.log(currentPoints.length);
                // didn't successfully split node, dont split to make degenerate node
                continue;
            }
    
            // split the cells into left and right
            var leftCells = [];
            var rightCells = [];
    
            if (cellsTree) {
                for (let cellID of parentNode.cells) {
                    // see if cell is <= pivot, > pivot or both
                    var cellSides = this.checkCellPosition(cellID, currentDimension, parentNode.splitVal);
                    if (cellSides[0]) leftCells.push(cellID);
                    if (cellSides[1]) rightCells.push(cellID);
                }
            }
    
            // create the new left and right nodes
            var nextDimension = (currentDimension + 1) % dimensions;
            var leftNode = this.createNode(currentDepth, nextDimension, leftPoints, leftCells, parentNode);
            var rightNode = this.createNode(currentDepth, nextDimension, rightPoints, rightCells, parentNode);
    
            // make sure the parent is properly closed out
            parentNode.cells = null;
            parentNode.points = null;
            parentNode.left = leftNode;
            parentNode.right = rightNode;
    
            // add children to the queue
            nodeQueue.push(leftNode, rightNode);
        }

        console.log("avg cells in leaves:", cellsCountSum/leavesCount);
    
        // return the tree object
        this.tree = root;
        return this.tree;
    }

    // builds a tree by splitting nodes at their centre
    this.buildNodeMedian = function(maxLeafCells, maxDepth) {
        // console.log(points);
        var cellsTree = false;
        if (this.cellConnectivity) cellsTree = true;
        // checks whether the cell of the given id is lte, gt the split val in checked dimension or both
    
        var nodeQueue = [];
        var cellsCountSum = 0;
        var leavesCount = 0;
        // make a root node with the whole dataset
        var root = {...this.createNode(), box: Object.assign({}, this.extentBox)};

        if (cellsTree) {
            for (let i = 0; i < this.cellOffsets.length; i++) {
                root.cells.push(i);
            }
        }
        nodeQueue.push(root);
    
        while (nodeQueue.length > 0) {
            var parentNode = nodeQueue.pop();
            // debugger;
            var currentDepth = parentNode.depth + 1;
            // stop the expansion of this node if the tree is deep enough
            // or stop if the # cells is already low enough
            if (currentDepth > maxDepth || parentNode.cells.length <= maxLeafCells) {
                // console.log(parentNode.points.length);
                cellsCountSum += parentNode.cells.length;
                leavesCount++;
                continue;
            }
    
            var currentDimension = parentNode.splitDimension;
            
            // find the pivot 
            parentNode.splitVal = 0.5 * (parentNode.box.min[currentDimension] + parentNode.box.max[currentDimension]);

            var leftBox = {
                min: [...parentNode.box.min],
                max: [...parentNode.box.max],
            };
            leftBox.max[currentDimension] = parentNode.splitVal;
            var rightBox = {
                min: [...parentNode.box.min],
                max: [...parentNode.box.max],
            };
            rightBox.min[currentDimension] = parentNode.splitVal;

    
            // split the cells into left and right
            var leftCells = [];
            var rightCells = [];
    
            if (cellsTree) {
                for (let cellID of parentNode.cells) {
                    // see if cell is <= pivot, > pivot or both
                    var cellSides = this.checkCellPosition(cellID, currentDimension, parentNode.splitVal);
                    if (cellSides[0]) leftCells.push(cellID);
                    if (cellSides[1]) rightCells.push(cellID);
                }
            }
    
            // create the new left and right nodes
            var nextDimension = (currentDimension + 1) % dimensions;
            var leftNode = this.createNode(currentDepth, nextDimension, [], leftCells, parentNode);
            leftNode.box = leftBox;
            var rightNode = this.createNode(currentDepth, nextDimension, [], rightCells, parentNode);
            rightNode.box = rightBox;
    
            // make sure the parent is properly closed out
            parentNode.cells = null;
            parentNode.points = null;
            parentNode.left = leftNode;
            parentNode.right = rightNode;
    
            // add children to the queue
            nodeQueue.push(leftNode, rightNode);
        }

        console.log("avg cells in leaves:", cellsCountSum/leavesCount);
    
        // return the tree object
        this.tree = root;
        return this.tree;
    }

    // builds a tree by splitting nodes at their centre
    this.buildSAH = function(maxLeafCells, maxDepth) {
        var calcBoxSA = (box) => {
            const x = box.max[0] - box.min[0];
            const y = box.max[1] - box.min[1];
            const z = box.max[2] - box.min[2];
            return 2*(x*y + x*z + y*z);
        }
        // estimates the cost to tree of splitting at this value using a surface area heuristic
        // C(A, B) = nodeCost + (pA * NA + pB * NB)
        var calcSplitCost = (node, dimension, splitVal) => {
            var NA = 0;
            var NB = 0;

            var boxA = {min:[...node.box.min], max:[...node.box.max]};
            boxA.max[dimension] = splitVal;

            var boxB = {min:[...node.box.min], max:[...node.box.max]};
            boxB.min[dimension] = splitVal;
            for (let cellID of node.cells) {
                // see if cell is <= pivot, > pivot or both
                var cellSides = this.checkCellPosition(cellID, dimension, splitVal);
                if (cellSides[0]) NA++;
                if (cellSides[1]) NB++;
            }

            return 1/16 + (calcBoxSA(boxA) * NA + calcBoxSA(boxB) * NB)/calcBoxSA(node.box);

        }


        // console.log(points);
        var cellsTree = false;
        if (this.cellConnectivity) cellsTree = true;
        // checks whether the cell of the given id is lte, gt the split val in checked dimension or both
    
        var nodeQueue = [];
        var cellsCountSum = 0;
        var leavesCount = 0;
        var criterionTerminatedCount = 0;

        // make a root node with the whole dataset
        var root = this.createNode();
        root.box = this.extentBox;

        if (cellsTree) {
            for (let i = 0; i < this.cellOffsets.length; i++) {
                root.cells.push(i);
            }
        }
        nodeQueue.push(root);
    
        while (nodeQueue.length > 0) {
            var parentNode = nodeQueue.pop();
            // debugger;
            var currentDepth = parentNode.depth + 1;
            // stop the expansion of this node if the tree is deep enough
            // or stop if the # cells is already low enough
            if (currentDepth > maxDepth || parentNode.cells.length < 4) {
                // console.log(parentNode.points.length);
                cellsCountSum += parentNode.cells.length;
                leavesCount++;
                continue;
            }
    
            var currentDimension = parentNode.splitDimension;

            // check a range of split values
            var minCost = Number.POSITIVE_INFINITY;
            let thisCost, thisSplitVal, minSplitVal;
            var trialCount = 5;
            var step = (parentNode.box.max[currentDimension] - parentNode.box.min[currentDimension]) / (trialCount + 1);
            for (let i = 1; i <= trialCount; i++) {
                thisSplitVal = parentNode.box.min[currentDimension] + step * i;
                thisCost = calcSplitCost(parentNode, currentDimension, thisSplitVal);
                if (thisCost < minCost) {
                    minCost = thisCost;
                    minSplitVal = thisSplitVal;
                }
            }

            // if min cost > parent cost, dont split any more
            if (minCost > parentNode.cells.length && parentNode.cells.length < maxLeafCells) {
                // console.log(parentNode.points.length);
                cellsCountSum += parentNode.cells.length;
                leavesCount++;
                criterionTerminatedCount++;
                continue;
            }
            
            // find the pivot 
            parentNode.splitVal = minSplitVal;

            var leftBox = structuredClone(parentNode.box);
            leftBox.max[currentDimension] = parentNode.splitVal;
            var rightBox = structuredClone(parentNode.box);
            rightBox.min[currentDimension] = parentNode.splitVal;

    
            // split the cells into left and right
            var leftCells = [];
            var rightCells = [];
    
            if (cellsTree) {
                for (let cellID of parentNode.cells) {
                    // see if cell is <= pivot, > pivot or both
                    var cellSides = this.checkCellPosition(cellID, currentDimension, parentNode.splitVal);
                    if (cellSides[0]) leftCells.push(cellID);
                    if (cellSides[1]) rightCells.push(cellID);
                }
            }
    
            // create the new left and right nodes
            var nextDimension = (currentDimension + 1) % dimensions;
            var leftNode = this.createNode(currentDepth, nextDimension, [], leftCells, parentNode);
            leftNode.box = leftBox;
            var rightNode = this.createNode(currentDepth, nextDimension, [], rightCells, parentNode);
            rightNode.box = rightBox;
    
            // make sure the parent is properly closed out
            parentNode.cells = null;
            parentNode.points = null;
            parentNode.left = leftNode;
            parentNode.right = rightNode;
    
            // add children to the queue
            nodeQueue.push(leftNode, rightNode);
        }

        console.log("avg cells in leaves:", cellsCountSum/leavesCount);
        console.log("amount terminated by criterion:", criterionTerminatedCount);
    
        // return the tree object
        this.tree = root;
        return this.tree;
    }

    // builds a tree by splitting nodes at their centre
    this.buildVolH = function(maxLeafCells, maxDepth) {
        var calcBoxVol = (box) => {
            const x = box.max[0] - box.min[0];
            const y = box.max[1] - box.min[1];
            const z = box.max[2] - box.min[2];
            return x*y*z;
        }
        // estimates the cost to tree of splitting at this value using a surface area heuristic
        // C(A, B) = nodeCost + (pA * NA + pB * NB)
        var calcSplitCost = (node, dimension, splitVal) => {
            var NA = 0;
            var NB = 0;

            var boxA = {min:[...node.box.min], max:[...node.box.max]};
            boxA.max[dimension] = splitVal;

            var boxB = {min:[...node.box.min], max:[...node.box.max]};
            boxB.min[dimension] = splitVal;
            for (let cellID of node.cells) {
                // see if cell is <= pivot, > pivot or both
                var cellSides = this.checkCellPosition(cellID, dimension, splitVal);
                if (cellSides[0]) NA++;
                if (cellSides[1]) NB++;
            }

            return 1/16 + (calcBoxVol(boxA) * NA + calcBoxVol(boxB) * NB)/calcBoxVol(node.box);

        }


        // console.log(points);
        var cellsTree = false;
        if (this.cellConnectivity) cellsTree = true;
        // checks whether the cell of the given id is lte, gt the split val in checked dimension or both
    
        var nodeQueue = [];
        var cellsCountSum = 0;
        var leavesCount = 0;
        var criterionTerminatedCount = 0;

        // make a root node with the whole dataset
        var root = this.createNode();
        root.box = this.extentBox;

        if (cellsTree) {
            for (let i = 0; i < this.cellOffsets.length; i++) {
                root.cells.push(i);
            }
        }
        nodeQueue.push(root);
    
        while (nodeQueue.length > 0) {
            var parentNode = nodeQueue.pop();
            // debugger;
            var currentDepth = parentNode.depth + 1;
            // stop the expansion of this node if the tree is deep enough
            // or stop if the # cells is already low enough
            if (currentDepth > maxDepth || parentNode.cells.length < maxLeafCells) {
                // console.log(parentNode.points.length);
                cellsCountSum += parentNode.cells.length;
                leavesCount++;
                continue;
            }
    
            var currentDimension = parentNode.splitDimension;

            // check a range of split values
            var minCost = Number.POSITIVE_INFINITY;
            let thisCost, thisSplitVal, minSplitVal;
            var trialCount = 1;
            var step = (parentNode.box.max[currentDimension] - parentNode.box.min[currentDimension]) / (trialCount + 1);
            for (let i = 1; i <= trialCount; i++) {
                thisSplitVal = parentNode.box.min[currentDimension] + step * i;
                thisCost = calcSplitCost(parentNode, currentDimension, thisSplitVal);
                if (thisCost < minCost) {
                    minCost = thisCost;
                    minSplitVal = thisSplitVal;
                }
            }

            // if min cost > parent cost, dont split any more
            if (minCost > parentNode.cells.length) {
                // console.log(parentNode.points.length);
                cellsCountSum += parentNode.cells.length;
                leavesCount++;
                criterionTerminatedCount++;
                continue;
            }
            
            // find the pivot 
            parentNode.splitVal = minSplitVal;

            var leftBox = structuredClone(parentNode.box);
            leftBox.max[currentDimension] = parentNode.splitVal;
            var rightBox = structuredClone(parentNode.box);
            rightBox.min[currentDimension] = parentNode.splitVal;

    
            // split the cells into left and right
            var leftCells = [];
            var rightCells = [];
    
            if (cellsTree) {
                for (let cellID of parentNode.cells) {
                    // see if cell is <= pivot, > pivot or both
                    var cellSides = this.checkCellPosition(cellID, currentDimension, parentNode.splitVal);
                    if (cellSides[0]) leftCells.push(cellID);
                    if (cellSides[1]) rightCells.push(cellID);
                }
            }
    
            // create the new left and right nodes
            var nextDimension = (currentDimension + 1) % dimensions;
            var leftNode = this.createNode(currentDepth, nextDimension, [], leftCells, parentNode);
            leftNode.box = leftBox;
            var rightNode = this.createNode(currentDepth, nextDimension, [], rightCells, parentNode);
            rightNode.box = rightBox;
    
            // make sure the parent is properly closed out
            parentNode.cells = null;
            parentNode.points = null;
            parentNode.left = leftNode;
            parentNode.right = rightNode;
    
            // add children to the queue
            nodeQueue.push(leftNode, rightNode);
        }

        console.log("avg cells in leaves:", cellsCountSum/leavesCount);
        console.log("amount terminated by criterion:", criterionTerminatedCount);
    
        // return the tree object
        this.tree = root;
        return this.tree;
    }

    this.getTreeNodeCount = function() {
        var count = 0;
        forEachDepth(this.tree,
            () => {count++},
            () => {},
            () => {}
        ); 
        return count;
    }
    this.getTreeCellsCount = function() {
        var count = 0;
        var under10 = 0;
        forEachDepth(this.tree,
            () => {},
            (node) => {
                count += node.cells.length
                if (node.cells.length < 10) under10++;
            },
            () => {}
        );
        console.log(under10 + " nodes with <10 cells");
        return count;
    }
    // returns the tree as a buffer
    this.serialise = function() {
        // tree has not been built
        if (!this.tree) return;
        // var byteLength = this.getTreeByteLength();
        var totalNodeCount = this.getTreeNodeCount();
        var totalCellsCount = this.getTreeCellsCount();
        console.log("total nodes: ", totalNodeCount);
        console.log("tree nodes buffer byte length: ", totalNodeCount * NODE_BYTE_LENGTH);
        console.log("tree cells buffer byte length: ", totalCellsCount * 4);
        // create a buffer to store the tree nodes
        var nodesBuffer = new ArrayBuffer(totalNodeCount*NODE_BYTE_LENGTH);
        // create a buffer to store
        var cellsBuffer = new Uint32Array(totalCellsCount);
        // take the tree and pack it into a buffer representation
        var nextNodeByteOffset = 0;
        var nextCellsByteOffset = 0;
        forEachDepth(
            this.tree,
            // run for every node
            (node) => {
                node.byteLocation = nextNodeByteOffset;
                var parent = node.parent;
                writeNodeToBuffer(
                    nodesBuffer, 
                    node.byteLocation, 
                    node.splitVal, 
                    node.cells?.length ?? 0, 
                    parent?.byteLocation/NODE_BYTE_LENGTH,
                    null, 
                    null
                );
                if (parent) {
                    // write location at the parent node
                    if (parent.left == node) {
                        writeNodeToBuffer(
                            nodesBuffer, 
                            parent.byteLocation, 
                            null, 
                            null, 
                            null,
                            node.byteLocation/NODE_BYTE_LENGTH, 
                            null
                        );
                    } else {
                        writeNodeToBuffer(
                            nodesBuffer, 
                            parent.byteLocation, 
                            null, 
                            null, 
                            null,
                            null, 
                            node.byteLocation/NODE_BYTE_LENGTH
                        );
                    }
                }
                nextNodeByteOffset += NODE_BYTE_LENGTH;
            }, 
            // run only for leaf nodex
            (node) => {
                node.cellsByteLocation = nextCellsByteOffset;
                new Uint32Array(cellsBuffer.buffer, node.cellsByteLocation, node.cells.length).set(node.cells);
                writeNodeToBuffer(
                    nodesBuffer, 
                    node.byteLocation, 
                    null, 
                    null, 
                    null,
                    node.cellsByteLocation/4, 
                    0
                );
                nextCellsByteOffset += node.cells.length*4;
            }, 
            // run only for branch nodes
            (node) => {}
        );

        return {
            nodes: nodesBuffer,
            cells: cellsBuffer,
            nodeCount: totalNodeCount,
        }
    }

    // print the tree node info
    // if full, prints more info
    // if not full, prints only info sent to gpu
    this.printNodes = function(full = false) {
        console.log("splitDim, splitVal, cellsLen, cellsLoc, leftLoc, rightLoc")
        forEachDepth(this.tree,
            (node) => {
               console.log(" ".repeat(node.depth),
                    node.splitDimension, 
                    node.splitVal,
                    node.cells?.length || 0,
                    node.cellsByteLocation/4 || 0,
                    node.left?.byteLocation/4,
                    node.right?.byteLocation/4,
                )
            },
            () => {},
            () => {}
        )
    }
}