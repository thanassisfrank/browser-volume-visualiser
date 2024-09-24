// cellTreeUtils.js

import { mat4, vec4 } from "https://cdn.skypack.dev/gl-matrix";

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
}

// be careful as the elements of the node still reference the underlying buffer
export var readNodeFromBuffer = (buffer, byteOffset) => {
    var f32View = new Float32Array(buffer, byteOffset, 1);
    var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
    return {
        thisPtr: byteOffset/NODE_BYTE_LENGTH,
        splitVal:  f32View.slice(0, 1)[0],
        cellCount: u32View.slice(1, 2)[0],
        parentPtr: u32View.slice(2, 3)[0],
        leftPtr:   u32View.slice(3, 4)[0],
        rightPtr:  u32View.slice(4, 5)[0],
    }
}

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
}

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
}


// returns the box covering this node from the direct parent node's box
// takes parent box, if its left and split dimension
export var getNodeBox = (parentBox, childType, splitDimension, splitVal) => {
    var thisBox = {
        min: [parentBox.min[0], parentBox.min[1], parentBox.min[2]], 
        max: [parentBox.max[0], parentBox.max[1], parentBox.max[2]], 
    };

    // var thisBox = {min: parentBox.min, max: parentBox.max};

    if (childType == ChildTypes.LEFT) {
        thisBox.max[splitDimension] = splitVal;
    } else {
        thisBox.min[splitDimension] = splitVal;
    }
    return thisBox;
}

export var pivotFull = (a) => {
    var sorted = a.sort((a, b) => {
        if (a < b) return -1;
        return 1;
    });
    // console.log(sorted);
    return sorted[Math.floor(a.length/2) - 1];
}

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
}

export var pivot = (a) => {
    if (a.length < 500) {
        return pivotFull(a);
    } else {
        return pivotRandom(a);
    }
}




// test if a given point is within an AABB
var pointInAABB = (p, box) => {
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

}

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
}


export const getContainingCell = (dataObj, slotNum, queryPoint, leafNode) => {
    var cell = {
        points : [
            [], [], [], [],
        ],
        values : [0, 0, 0, 0],
        factors : [0, 0, 0, 0]
    };

    // check the cells in the leaf node found
    var cellsPtr = leafNode.leftPtr; // go to where cells are stored
    for (let i = 0; i < leafNode.cellCount; i++) {
        // go through and check all the contained cells
        var cellID = dataObj.data.treeCells[cellsPtr + i];
        // create a cell from the data

        // figure out if cell is inside using barycentric coords
        var pointsOffset = dataObj.data.cellOffsets[cellID];
        // read all the point positions
        for (let j = 0; j < 4; j++) {
            // get the coords of the point as an array 3
            var thisPointIndex = dataObj.data.cellConnectivity[pointsOffset + j];
            cell.points[j][0] = dataObj.data.positions[3 * thisPointIndex + 0];
            cell.points[j][1] = dataObj.data.positions[3 * thisPointIndex + 1];
            cell.points[j][2] = dataObj.data.positions[3 * thisPointIndex + 2];
        }
            

        // check cell bounding box
        if(!pointInTetBounds(queryPoint, cell)) continue;
        var tetFactors = pointInTetDet(queryPoint, cell);
        if (
            tetFactors[0] == 0 && 
            tetFactors[1] == 0 && 
            tetFactors[2] == 0 && 
            tetFactors[3] == 0
        ) continue;
        cell.values[0] = dataObj.getValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 0]];
        cell.values[1] = dataObj.getValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 1]];
        cell.values[2] = dataObj.getValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 2]];
        cell.values[3] = dataObj.getValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 3]];

        cell.factors = tetFactors;
        break;
    }
    return cell;
}

// samples a given leaf at the given position
export const sampleLeaf = (dataObj, slotNum, leafNode, queryPoint) => {
    // true leaf, sample the cells within
    var cell = getContainingCell(dataObj, slotNum, queryPoint, leafNode);
    // interpolate value
    if (vec4.length(cell.factors) == 0) {
        return 0;
    };
    return vec4.dot(cell.values, cell.factors);
}

// returns a random point inside the given leaf node
export const sampleLeafRandom = (dataObj, slotNum, leafNode, leafBox) => {
    var position = [
        Math.random() * (leafBox.max[0] - leafBox.min[0]) + leafBox.min[0],
        Math.random() * (leafBox.max[1] - leafBox.min[1]) + leafBox.min[1],
        Math.random() * (leafBox.max[2] - leafBox.min[2]) + leafBox.min[2],
    ];

    return {
        position: position,
        value: sampleLeaf(dataObj, slotNum, leafNode, position)
    };
}

export const getLeafAverage = (dataObj, slotNum, leafNode, leafBox) => {
    var sampleCount = 10;
    var averageVal = 0;
    for (let i = 0; i < sampleCount; i++) {
        // sample the leaf node at random positions to find its average value
        averageVal += sampleLeafRandom(dataObj, slotNum, leafNode, leafBox)/sampleCount;
    }

    return averageVal;
}

// returns a random vertex from the given leaf node
export const getRandVertInLeafNode = (dataObj, slotNum, leafNode) => {
    // console.log(leafNode.thisPtr);
    const cellIndex = Math.floor(Math.random()*leafNode.cellCount);
    const cellID = dataObj.data.treeCells[leafNode.leftPtr + cellIndex];
    var pointsOffset = dataObj.data.cellOffsets[cellID];

    // always choose the first point in the cell
    const thisPointIndex = dataObj.data.cellConnectivity[pointsOffset + 0];
    const position = [
        dataObj.data.positions[3 * thisPointIndex + 0],
        dataObj.data.positions[3 * thisPointIndex + 1],
        dataObj.data.positions[3 * thisPointIndex + 2]
    ];

    const value = dataObj.getValues(slotNum)[dataObj.data.cellConnectivity[pointsOffset + 0]]
    
    return {
        position: position,
        value: value
    }
}