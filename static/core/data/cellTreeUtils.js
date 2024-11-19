// cellTreeUtils.js

import { mat4, vec4 } from "../gl-matrix.js";
import { VecMath } from "../VecMath.js";


// these act as bit masks to create the full resolution mode
export const ResolutionModes = {
    FULL:              0b00, // resolution is fixed at the maximum 
    DYNAMIC_NODES_BIT: 0b01, // the resolution is variable
    DYNAMIC_CELLS_BIT: 0b10, // cell and vertex data are arranged per-leaf
};

export const NODE_BYTE_LENGTH = 5 * 4;

export const ChildTypes = {
    LEFT: 0,
    RIGHT: 1,
}


// struct KDTreeNode {
//     splitVal : f32,
//     cellCount : u32,
//     parentPtr : u32,
//     leftPtr : u32,
//     rightPtr : u32,
// };


export var writeNodeToBuffer = (buffer, byteOffset, splitVal, cellCount, parentPtr, leftPtr, rightPtr) => {
    var f32View = new Float32Array(buffer, byteOffset, 1);
    if (splitVal != null) f32View[0] = splitVal;
    var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
    if (cellCount != null) u32View[1] = cellCount;
    if (parentPtr != null) u32View[2] = parentPtr;
    if (leftPtr != null) u32View[3] = leftPtr;
    if (rightPtr != null) u32View[4] = rightPtr;
};


// be careful as the elements of the node still reference the underlying buffer
export var readNodeFromBuffer = (buffer, byteOffset) => {
    var f32View = new Float32Array(buffer, byteOffset, 1);
    var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
    return {
        thisPtr: byteOffset/NODE_BYTE_LENGTH,
        splitVal:  f32View[0],
        cellCount: u32View[1],
        parentPtr: u32View[2],
        leftPtr:   u32View[3],
        rightPtr:  u32View[4],
    };
};


// goes through each node, depth first
// callBacks receive the current node
export var forEachDepth = (tree, alwaysFunc, leafFunc, branchFunc) => {
    var nodeQueue = [tree];
    while (nodeQueue.length > 0) {
        var currNode = nodeQueue.pop()
        alwaysFunc(currNode);
        if (currNode.left == null) {
            // got to leaf
            leafFunc(currNode);
        } else {
            // continue down the tree
            branchFunc(currNode);
            nodeQueue.push(currNode.left, currNode.right);
        }
    }
};


// same as above but breadth first
export var forEachBreadth = (tree, alwaysFunc, leafFunc, branchFunc) => {
    var nodeQueue = [tree];
    while (nodeQueue.length > 0) {
        var currNode = nodeQueue.pop()
        alwaysFunc(currNode);
        if (currNode.left == null) {
            // got to leaf
            leafFunc(currNode);
        } else {
            // continue down the tree
            branchFunc(currNode);
            nodeQueue.unshift(currNode.left, currNode.right);
        }
    }
};


// function to allow simple traversal through a node buffer
export const traverseNodeBufferDepth = (buff, alwaysFunc, leafFunc, branchFunc) => {
    var nodeQueue = [readNodeFromBuffer(buff, 0)];
    while (nodeQueue.length > 0) {
        var currNode = nodeQueue.pop();
        alwaysFunc(currNode);
        if (0 == currNode.rightPtr) {
            // got to leaf
            leafFunc(currNode);
        } else {
            // continue down the tree
            branchFunc(currNode);
            nodeQueue.push(
                readNodeFromBuffer(buff, currNode.leftPtr * NODE_BYTE_LENGTH), 
                readNodeFromBuffer(buff, currNode.rightPtr * NODE_BYTE_LENGTH),
            );
        }
    }
};

// same as above but finds the box for each node too
export const traverseNodeBufferDepthBox = (buff, fullBox, alwaysFunc, leafFunc, branchFunc) => {
    let nodeQueue = [readNodeFromBuffer(buff, 0)];
    let depthQueue = [0];
    let boxQueue = [fullBox];
    while (nodeQueue.length > 0) {
        const currNode = nodeQueue.pop();
        const currDepth = depthQueue.pop();
        const currBox = boxQueue.pop();
        alwaysFunc(currNode, currBox, currDepth);
        if (0 == currNode.rightPtr) {
            // got to leaf
            leafFunc(currNode, currBox, currDepth);
        } else {
            // continue down the tree
            branchFunc(currNode, currBox, currDepth);
            nodeQueue.push(
                readNodeFromBuffer(buff, currNode.leftPtr * NODE_BYTE_LENGTH), 
                readNodeFromBuffer(buff, currNode.rightPtr * NODE_BYTE_LENGTH),
            );
            depthQueue.push(currDepth + 1, currDepth + 1);
            const leftBox = {min: [...currBox.min], max: [...currBox.max]};
            leftBox.max[currDepth % 3] = currNode.splitVal;
            const rightBox = {min: [...currBox.min], max: [...currBox.max]};
            rightBox.min[currDepth % 3] = currNode.splitVal;

            boxQueue.push(leftBox, rightBox);
        }
    }
};


// returns the box covering this node from the direct parent node's box
// takes parent box, if its left and split dimension
export var getNodeBox = (parentBox, childType, splitDimension, splitVal) => {
    var thisBox = {
        min: [parentBox.min[0], parentBox.min[1], parentBox.min[2]], 
        max: [parentBox.max[0], parentBox.max[1], parentBox.max[2]], 
    };

    if (childType == ChildTypes.LEFT) {
        thisBox.max[splitDimension] = splitVal;
    } else {
        thisBox.min[splitDimension] = splitVal;
    }
    return thisBox;
};


export var pivotFull = (a) => {
    var sorted = a.sort((a, b) => {
        if (a < b) return -1;
        return 1;
    });
    // console.log(sorted);
    return sorted[Math.floor(a.length/2) - 1];
};


// estimate the median from a random sample
export var pivotRandom = (a) => {
    var sampleCount = Math.min(500, a.length);
    var samples = [];
    for (let i = 0; i < sampleCount; i++) {
        samples.push(a[Math.floor(Math.random()*a.length)]);
    }
    const median = samples.sort()[Math.floor(samples.length/2) - 1];
    if (median == undefined) {
        console.log(median);
        console.log(samples);
        console.log(a);
    }
    return median;
};


export var pivot = (a) => {
    if (a.length < 500) {
        return pivotFull(a);
    } else {
        return pivotRandom(a);
    }
};


// test if a given point is within an AABB
export const pointInAABB = (p, box) => {
    if (p[0] < box.min[0] || p[1] < box.min[1] || p[2] < box.min[2]) {
        return false;
    }
    if (p[0] > box.max[0] || p[1] > box.max[1] || p[2] > box.max[2]) {
        return false;
    }
    return true;
};


// point in tet functions returns the barycentric coords if inside and all 0 if outside
// this implementation uses the determinates of matrices - slightly faster
var pointInTetDet = (queryPoint, cell) => {
    var x = queryPoint[0];
    var y = queryPoint[1];
    var z = queryPoint[2];
    var p = cell.points;
    // compute the barycentric coords for the point
    var lambda1 = mat4.determinant(mat4.fromValues(
        1,       x,       y,       z,
        1, p[1][0], p[1][1], p[1][2],
        1, p[2][0], p[2][1], p[2][2],
        1, p[3][0], p[3][1], p[3][2],
    ));

    var lambda2 = mat4.determinant(mat4.fromValues(
        1, p[0][0], p[0][1], p[0][2],      
        1,       x,       y,       z,      
        1, p[2][0], p[2][1], p[2][2],      
        1, p[3][0], p[3][1], p[3][2],      
    ));

    var lambda3 = mat4.determinant(mat4.fromValues(
        1, p[0][0], p[0][1], p[0][2],      
        1, p[1][0], p[1][1], p[1][2],      
        1,       x,       y,       z,      
        1, p[3][0], p[3][1], p[3][2],      
    ));

    var lambda4 = mat4.determinant(mat4.fromValues(
        1, p[0][0], p[0][1], p[0][2],      
        1, p[1][0], p[1][1], p[1][2],      
        1, p[2][0], p[2][1], p[2][2],      
        1,       x,       y,       z,      
    ));

    var vol = mat4.determinant(mat4.fromValues(
        1, p[0][0], p[0][1], p[0][2],      
        1, p[1][0], p[1][1], p[1][2],      
        1, p[2][0], p[2][1], p[2][2],      
        1, p[3][0], p[3][1], p[3][2],      
    ));

    if (lambda1 <= 0 && lambda2 <= 0 && lambda3 <= 0 && lambda4 <= 0) {
        return [-lambda1/vol, -lambda2/vol, -lambda3/vol, -lambda4/vol];
    } else if (lambda1 >= 0 && lambda2 >= 0 && lambda3 >= 0 && lambda4 >= 0) {
        return [lambda1/vol, lambda2/vol, lambda3/vol, lambda4/vol];
    } else {
        // not in this cell
        return [0, 0, 0, 0];
    }
};


var pointInTetBounds = (queryPoint, cell) => {
    var minVec = [
        Math.min(cell.points[0][0], Math.min(cell.points[1][0], Math.min(cell.points[2][0], cell.points[3][0]))),
        Math.min(cell.points[0][1], Math.min(cell.points[1][1], Math.min(cell.points[2][1], cell.points[3][1]))),
        Math.min(cell.points[0][2], Math.min(cell.points[1][2], Math.min(cell.points[2][2], cell.points[3][2]))),
    ];

    var maxVec = [
        Math.max(cell.points[0][0], Math.max(cell.points[1][0], Math.max(cell.points[2][0], cell.points[3][0]))),
        Math.max(cell.points[0][1], Math.max(cell.points[1][1], Math.max(cell.points[2][1], cell.points[3][1]))),
        Math.max(cell.points[0][2], Math.max(cell.points[1][2], Math.max(cell.points[2][2], cell.points[3][2]))),
    ];

    return pointInAABB(queryPoint, {min: minVec, max: maxVec});
};


const getCellAtIndex = (dataObj, leafNode, index, slotNum) => {
    var cell = {
        points : [
            [0, 0, 0], 
            [0, 0, 0], 
            [0, 0, 0], 
            [0, 0, 0],
        ],
        values : [0, 0, 0, 0],
        pointsIndices: [0, 0, 0, 0]
    };
    
    var cellsPtr = leafNode.leftPtr; // go to where cells are stored
    var cellID = dataObj.data.treeCells[cellsPtr + index];
    var pointsOffset = dataObj.data.cellOffsets[cellID];
    // read all the point positions
    for (let j = 0; j < 4; j++) {
        // get the coords of the point as an array 3
        const thisPointIndex = dataObj.data.cellConnectivity[pointsOffset + j];
        cell.pointsIndices[j] = thisPointIndex;
        cell.points[j][0] = dataObj.data.positions[3 * thisPointIndex + 0];
        cell.points[j][1] = dataObj.data.positions[3 * thisPointIndex + 1];
        cell.points[j][2] = dataObj.data.positions[3 * thisPointIndex + 2];
    }
    if (slotNum != undefined) {
        cell.values[0] = dataObj.getFullValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 0]];
        cell.values[1] = dataObj.getFullValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 1]];
        cell.values[2] = dataObj.getFullValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 2]];
        cell.values[3] = dataObj.getFullValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 3]];
    }

    return cell;
};


const getCellAtIndexBlockMesh = (dataObj, leafNode, index, slotNum) => {
    var cell = {
        points : [
            [0, 0, 0], 
            [0, 0, 0], 
            [0, 0, 0], 
            [0, 0, 0],
        ],
        values : [0, 0, 0, 0],
        pointsIndices: [0, 0, 0, 0]
    };
    
    // check the cells in the leaf node found
    const blockPtr = leafNode.leftPtr; // the index of the mesh block
    const offPtr = dataObj.meshBlockSizes.cellOffsets * blockPtr;
    const posPtr = dataObj.meshBlockSizes.positions * blockPtr;
    const conPtr = dataObj.meshBlockSizes.cellConnectivity * blockPtr;
    const valPtr = posPtr/3;

    var pointsOffset = dataObj.data.cellOffsets[offPtr + index];
    // read all the point positions
    for (let j = 0; j < 4; j++) {
        // get the coords of the point as an array 3
        const thisPointIndex = dataObj.data.cellConnectivity[conPtr + pointsOffset + j];
        cell.pointsIndices[j] = thisPointIndex;
        cell.points[j][0] = dataObj.data.positions[posPtr + 3 * thisPointIndex + 0];
        cell.points[j][1] = dataObj.data.positions[posPtr + 3 * thisPointIndex + 1];
        cell.points[j][2] = dataObj.data.positions[posPtr + 3 * thisPointIndex + 2];
        if (slotNum != undefined) {
            cell.values[j] = dataObj.getFullValues(slotNum)[valPtr + thisPointIndex];
        }
    }

    return cell;
};


function* iterateLeafCells(dataObj, leafNode, slotNum) {
    // check the cells in the leaf node found
    for (let i = 0; i < leafNode.cellCount; i++) {
        // go through and check all the contained cells
        if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
            yield getCellAtIndexBlockMesh(dataObj, leafNode, i, slotNum);
        } else {
            yield getCellAtIndex(dataObj, leafNode, i, slotNum);
        }
    }
    return;
};


// searches through all points specified in the leaf node to find the closest to the sample point
export const getClosestVertexInLeaf = (dataObj, slotNum, queryPoint, leafNode) => {
    let bestPoint = [0, 0, 0];
    let bestDist = Number.POSITIVE_INFINITY;
    let dist, val;

    const checked = new Set();
    for (let cell of iterateLeafCells(dataObj, leafNode, slotNum)) {
        for (let i = 0; i < cell.points.length; i++) {
            if (checked.has(cell.pointsIndices[i])) continue;
            checked.add(cell.pointsIndices[i]);
            dist = VecMath.magnitude(VecMath.vecMinus(cell.points[i], queryPoint));
            if (dist < bestDist) {
                bestPoint = [...cell.points[i]];
                bestDist = dist;
                val = cell.values[i];
            }
        }
    }

    return {
        position: bestPoint,
        value: val
    };
};


export const getContainingCell = (dataObj, slotNum, queryPoint, leafNode) => {
    // improved version
    for (let cell of iterateLeafCells(dataObj, leafNode, slotNum)) {
        // check if
        if(!pointInTetBounds(queryPoint, cell)) continue;
        var tetFactors = pointInTetDet(queryPoint, cell);
        if (tetFactors.every(v => v == 0)) continue;
        cell.factors = tetFactors;
        return cell;
    }
};


// samples a given leaf at the given position by interpolating within mesh
export const sampleLeaf = (dataObj, slotNum, leafNode, queryPoint) => {
    // true leaf, sample the cells within
    const cell = getContainingCell(dataObj, slotNum, queryPoint, leafNode);
    // interpolate value
    if (!cell) {
        // if not inside any cell, return null
        return null;
    };
    const val = vec4.dot(cell.values, cell.factors);
    return val;
};


// returns a random position inside the supplied box
export const randomInsideBox = (box, map = x => x) => {
    return [
        map(Math.random()) * (box.max[0] - box.min[0]) + box.min[0],
        map(Math.random()) * (box.max[1] - box.min[1]) + box.min[1],
        map(Math.random()) * (box.max[2] - box.min[2]) + box.min[2],
    ];
};


// returns a random point inside the given leaf node
export const sampleLeafRandom = (dataObj, slotNum, leafNode, leafBox, map) => {
    var position = randomInsideBox(leafBox, map);

    return {
        position: position,
        value: sampleLeaf(dataObj, slotNum, leafNode, position) ?? getClosestVertexInLeaf(dataObj, slotNum, position, leafNode).value
    };
};


export const getLeafAverage = (dataObj, slotNum, leafNode, leafBox) => {
    var sampleCount = 10;
    var averageVal = 0;
    for (let i = 0; i < sampleCount; i++) {
        // sample the leaf node at random positions to find its average value
        averageVal += sampleLeafRandom(dataObj, slotNum, leafNode, leafBox)/sampleCount;
    }

    return averageVal;
};


// returns a random vertex from the given leaf node
export const getRandVertInLeafNode = (dataObj, slotNum, leafNode) => {
    // console.log(leafNode.thisPtr);
    const cellIndex = Math.floor(Math.random()*leafNode.cellCount);
    let cell;
    if (dataObj.resolutionMode & ResolutionModes.DYNAMIC_CELLS_BIT) {
        cell = getCellAtIndexBlockMesh(dataObj, leafNode, index, slotNum);
    } else {
        cell = getCellAtIndex(dataObj, leafNode, cellIndex, slotNum);
    }
    
    return {
        position: cell.points[0],
        value: cell.values[0]
    }
};


// interate through all of the leaves in the data objects tree nodes buffer
// perform callback with the information of each
export const processLeafMeshDataInfo = (dataObj, callback) => {
    const treeNodes = dataObj.data.treeNodes;
    if (!dataObj.data.treeNodes) throw TypeError("Data object does not contain a node buffer");
    // iterate through all leaves
    var rootNode = readNodeFromBuffer(treeNodes, 0);
    rootNode.depth = 0;
    var nodes = [rootNode];
    while (nodes.length > 0) {
        const currNode = nodes.pop();
        if (currNode.rightPtr == 0) {
            // this is a leaf node, work out its buffer sizes
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

            callback({
                cells: currNode.cellCount,
                verts: uniqueVerts.size,
                depth: currNode.depth
            });
        } else {
            // add its children to the next nodes
            var leftNode = readNodeFromBuffer(treeNodes, currNode.leftPtr * NODE_BYTE_LENGTH);
            var rightNode = readNodeFromBuffer(treeNodes, currNode.rightPtr * NODE_BYTE_LENGTH);

            leftNode.depth = currNode.depth + 1;
            rightNode.depth = currNode.depth + 1;

            nodes.push(leftNode);
            nodes.push(rightNode);
        }
    }
};