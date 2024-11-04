// cellTree.js
// provides functions to create and manage full resolution trees generated on unstructured meshes
import { NODE_BYTE_LENGTH, writeNodeToBuffer, pivotFull, forEachDepth, processLeafMeshDataInfo, readNodeFromBuffer } from "./cellTreeUtils.js";

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
    const leafInfo = [];

    processLeafMeshDataInfo(dataObj, d => leafInfo.push(d));

    var str = ""
    str += "cells\tverts\tdepth\n";
    str += leafInfo.map((e, i) => 
        e.cells.toString() + "\t" + e.verts.toString() + "\t" + e.depth.toString()
    ).join("\n");

    navigator.clipboard.writeText(str);

    console.log("samples copied to clipboard!");
};


export const getLeafMeshBuffers = (dataObj, blockSizes, leafCount) => {
    var leafPositions = new Float32Array(blockSizes.positions * leafCount);
    var leafCellOffsets = new Float32Array(blockSizes.cellOffsets * leafCount);
    var leafCellConnectivity = new Float32Array(blockSizes.cellConnectivity * leafCount);

    var leafVerts = new Uint32Array(blockSizes.positions/3 * leafCount);

    var fullToLeafIndexMap = new Map();

    var currLeafIndex = 0;

    // iterate through nodes, check for leaf
    for (let i = 0; i < dataObj.data.treeNodeCount; i++) {
        let currNode = readNodeFromBuffer(dataObj.data.treeNodes, i * NODE_BYTE_LENGTH);
        if (0 != currNode.rightPtr) continue;

        // This is needed to be able to properly address a leaf node's cells
        writeNodeToBuffer(dataObj.data.treeNodes, i * NODE_BYTE_LENGTH, null, null, null, currLeafIndex, null);

        // this is a leaf node, generate the mesh segments for it
        let currOffsetIndex = 0;
        let currConnectivityIndex = 0;
        let currVertIndex = 0;
        const uniqueVerts = new Map();
        var cellsPtr = currNode.leftPtr;

        // iterate through all cells in this leaf node
        for (let i = 0; i < currNode.cellCount; i++) {
            // go through and check all the contained cells
            var cellID = dataObj.data.treeCells[cellsPtr + i];
            var pointsOffset = dataObj.data.cellOffsets[cellID];
            // add a new entry into cell offsets (4 more than last as all tets)
            leafCellOffsets[currLeafIndex * blockSizes.cellOffsets + currOffsetIndex++] = currConnectivityIndex;

            // iterate through the cell vertices
            for (let j = 0; j < 4; j++) {
                let thisPointIndex = dataObj.data.cellConnectivity[pointsOffset + j];
                let thisPointBlockIndex;
                // check if the offset points to a vert already pulled in
                if (uniqueVerts.has(thisPointIndex)) {
                    // get the local block-level position
                    thisPointBlockIndex = uniqueVerts.get(thisPointIndex);
                } else {
                    // its position is the next free space
                    thisPointBlockIndex = currVertIndex;
                    // add to list of verts in this leaf
                    leafVerts[currLeafIndex * blockSizes.positions/3 + currVertIndex] = thisPointIndex;
                    // pull in vert into next free vert slot
                    leafPositions[currLeafIndex * blockSizes.positions + 3 * currVertIndex + 0] = dataObj.data.positions[3 * thisPointIndex + 0];
                    leafPositions[currLeafIndex * blockSizes.positions + 3 * currVertIndex + 1] = dataObj.data.positions[3 * thisPointIndex + 1];
                    leafPositions[currLeafIndex * blockSizes.positions + 3 * currVertIndex + 2] = dataObj.data.positions[3 * thisPointIndex + 2];
                    // add to unique verts list
                    uniqueVerts.set(thisPointIndex, currVertIndex++);
                }
                // add connectivity entry for vert position within the block
                leafCellConnectivity[currLeafIndex * blockSizes.cellConnectivity + currConnectivityIndex++] = thisPointBlockIndex;
            }  
        }

        // update index map to allow full node index -> leaf node index
        fullToLeafIndexMap.set(i, currLeafIndex++);
    }

    return {
        positions: leafPositions,
        cellOffsets: leafCellOffsets,
        cellConnectivity: leafCellConnectivity,
        leafVerts: leafVerts,
        indexMap: fullToLeafIndexMap
    };
};


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
};


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
    };

    this.setExtentBox = function(box) {
        this.extentBox = box;
    };

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
    };

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
        };
    };

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
    };

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
    };

    // builds a tree by splitting nodes at their centre
    this.buildNodeMedian = function(maxLeafCells, maxDepth) {
        // console.log(points);
        var cellsTree = false;
        if (this.cellConnectivity) cellsTree = true;
        // checks whether the cell of the given id is lte, gt the split val in checked dimension or both
    
        var nodeQueue = [];
        var cellsCountSum = 0;
        var leavesCount = 0;

        var maxCellCount = 0;
        var maxLeafDepth = 0;
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
            var currentDepth = parentNode.depth + 1;
            // stop the expansion of this node if the tree is deep enough
            // or stop if the # cells is already low enough
            if (currentDepth > maxDepth || parentNode.cells.length <= maxLeafCells) {
                // console.log(parentNode.points.length);
                maxCellCount = Math.max(maxCellCount, parentNode.cells.length);
                maxLeafDepth = Math.max(maxLeafDepth, parentNode.depth);
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
        console.log("max cells in leaves:", maxCellCount);
        console.log("max tree depth:", maxLeafDepth);
    
        // return the tree object
        this.tree = root;
        return this.tree;
    };

    // builds a tree by splitting nodes at their centre
    this.buildSAH = function(maxLeafCells, maxDepth) {
        var calcBoxSA = (box) => {
            const x = box.max[0] - box.min[0];
            const y = box.max[1] - box.min[1];
            const z = box.max[2] - box.min[2];
            return 2*(x*y + x*z + y*z);
        };

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
        };

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
    };

    // builds a tree by splitting nodes at their centre
    this.buildVolH = function(maxLeafCells, maxDepth) {
        var calcBoxVol = (box) => {
            const x = box.max[0] - box.min[0];
            const y = box.max[1] - box.min[1];
            const z = box.max[2] - box.min[2];
            return x*y*z;
        };

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
    };

    this.getTreeNodeCount = function() {
        var count = 0;
        forEachDepth(this.tree,
            () => {count++},
            () => {},
            () => {}
        ); 
        return count;
    };

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
    };

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
    };

    // print the tree node info
    // if full, prints more info
    // if not full, prints only info sent to gpu
    this.printNodes = function() {
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
    };
}