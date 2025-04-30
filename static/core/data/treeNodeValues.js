// treeNodeValues.js
// contains functions to manage values associated with cell tree nodes for partial resolution rendering

import { copyBox } from "../utils/boxUtils.js";
import { VecMath } from "../utils/VecMath.js";

import { 
    NODE_BYTE_LENGTH, 
    ChildTypes, 
    getNodeBox, 
    getLeafAverage, 
    readNodeFromBuffer, 
    sampleLeafRandom, 
    randomInsideBox, 
    sampleDataArrayWithCell
} from "./cellTreeUtils.js";

// Node values are 1 value per node and are written into the tree nodes buffer
// Corner values are 8 values per node and are written into their own buffer
// > samples represent the values at the corners
// > poly are coefficients of cubic polynomial



// utility functions ==================================================================================

const smoothStep = (x) => {
    return (6*x**2 - 15*x**1 + 10)*x**3
}

export const readCornerVals = (cornerValBuffer, nodePtr) => {
    return cornerValBuffer.slice(nodePtr * 8, (nodePtr + 1)* 8)
};


export const writeCornerVals = (cornerValBuffer, nodePtr, cornerVals) => {
    cornerValBuffer.set(cornerVals, nodePtr*8);
};


// corner values ======================================================================================
// eight values for each node stored in separate buffer
// > sample: values at node corners
// > poly: coefficients of polynomial within bounds f(x,y,z) = a + bx + cy + dz + exy + fxz + gyz + hxyz

export const CornerValTypes = {
    SAMPLE: 1,
    POLYNOMIAL: 2,
};


//           z   y   x
// 0 -> 000  min min min
// 1 -> 001  min min max
// 2 -> 010  min max min
// 3 -> 011  min max max
// 4 -> 100  max min min
// 5 -> 101  max min max
// 6 -> 110  max max min
// 7 -> 111  max max max

const getLeafSampleCornerVals = (dataBuff, tree, leafNode, leafBox) => {
    var cornerVals = new Float32Array(8);

    const points = [
        leafBox.min,
        [leafBox.max[0], leafBox.min[1], leafBox.min[2]],
        [leafBox.min[0], leafBox.max[1], leafBox.min[2]],
        [leafBox.max[0], leafBox.max[1], leafBox.min[2]],
        [leafBox.min[0], leafBox.min[1], leafBox.max[2]],
        [leafBox.max[0], leafBox.min[1], leafBox.max[2]],
        [leafBox.min[0], leafBox.max[1], leafBox.max[2]],
        leafBox.max,
    ];
    for (let i = 0; i < points.length; i++) {
        const cell = tree.getContainingCell(points[i], leafNode);
        if (cell) {
            cornerVals[i] = sampleDataArrayWithCell(dataBuff, cell);
            continue;
        }

        // use the nearest vertex instead
        const vert = tree.getClosestVertexInLeaf(points[i], leafNode);
        if (vert.index !== undefined) {
            cornerVals[i] = dataBuff[vert.index];
            continue;
        }

        // leaf likely has no cells, default to 0
        cornerVals[i] = 0;
    }
    
    return cornerVals;
};


const getSampleCornerValsFromChildren = (cornerValBuffer, splitDim, leftPtr, rightPtr) => {
    var leftCorners = cornerValBuffer.slice(leftPtr*8, (leftPtr + 1)*8);
    var rightCorners = cornerValBuffer.slice(rightPtr*8, (rightPtr + 1)*8);
    var thisCorners = new Float32Array(8);

    // select which is coincident with the parent node's corners
    for (let i = 0; i < 8; i++) {
        if ((i >> splitDim & 1) == 1) {
            thisCorners[i] = rightCorners[i];
        } else {
            thisCorners[i] = leftCorners[i];
        }
    }
    return thisCorners;
};


// creates an f32 buffer containg 8 values per node
// these are the values at the vertices where the split plane intersects the node bounding box edges
// there are not values for true leaves as these don't have a split plane
var createNodeSampleCornerValuesBuffer = (dataBuff, tree) => {
    var start = performance.now();
    var treeNodes = tree.nodes;
    var nodeCount = tree.nodeCount;
    var nodeCornerVals = new Float32Array(8 * nodeCount);

    // figure out the box of the current node
    var getThisBox = (currNode) => {
        // console.log(currNode);
        if (currNode.parentPtr == currNode.thisPtr) {
            // root node
            return {...copyBox(tree.extentBox), uses: 0};
        }
        var parentBox = currBoxes[currBoxes.length - 1];
        return getNodeBox(parentBox, currNode.childType, (currDepth - 1) % 3, currNode.parentSplit);
    };

    // the boxes of all of the parents of the current node
    var currBoxes = [];
    // the next nodes to process
    var nodes = [readNodeFromBuffer(treeNodes, 0)];
    var currDepth = 0; // depth of node currently being processed
    var processed = 0;
    while (nodes.length > 0 && processed < nodeCount * 3) {
        processed++;
        var currNode = nodes.pop();
        if (currNode.rightPtr == 0) {
            // get the corner values for this box and write to buffer
            const thisBox = getThisBox(currNode);
            const thisCornerVals = getLeafSampleCornerVals(dataBuff, tree, currNode, thisBox);
            
            writeCornerVals(nodeCornerVals, currNode.thisPtr, thisCornerVals);

            if (currNode.childType == ChildTypes.RIGHT) currDepth--;       
        } else {
            // this is a branch
            if (currDepth == currBoxes.length) {
                // going down, depth
                currBoxes.push(getThisBox(currNode));
                currDepth++;

                // push itself to handle going back up the tree
                nodes.push(currNode);

                // add its children to the next nodes
                var leftNode = readNodeFromBuffer(treeNodes, currNode.rightPtr * NODE_BYTE_LENGTH);
                var rightNode = readNodeFromBuffer(treeNodes, currNode.leftPtr * NODE_BYTE_LENGTH);
                nodes.push({
                    ...leftNode, 
                    childType: ChildTypes.RIGHT,
                    parentSplit: currNode.splitVal,
                });
                nodes.push({
                    ...rightNode, 
                    childType: ChildTypes.LEFT,
                    parentSplit: currNode.splitVal,
                });
            } else {
                // going back up
                // calculate the node corners from its children
                var splitDim = currDepth % 3;

                var cornerVals = getSampleCornerValsFromChildren(
                    nodeCornerVals,
                    splitDim,
                    currNode.leftPtr,
                    currNode.rightPtr,
                )
                
                writeCornerVals(nodeCornerVals, currNode.thisPtr, cornerVals);

                currBoxes.pop();
                if (currNode.childType == ChildTypes.RIGHT) currDepth--;  
            }
        }
    }

    console.log("generating corner values took:", (performance.now() - start), "ms");

    return nodeCornerVals;
};


// performs linear regression to fit cubic to a selection of the leafNode's verts
const getLeafPolyCornerVals = (dataObj, slotNum, leafNode, leafBox, sampleCount) => {
    const pointCount = sampleCount;
    // matrix of inputs
    // 1 x y z xy xz yz xyz
    var X = [];
    // vector of outputs
    var Y = [];

    // sample inside the leaf node
    for (let i = 0; i < pointCount; i++) {
        // sample at unique location
        let point = sampleLeafRandom(dataObj, slotNum, leafNode, leafBox, smoothStep);

        X[i] = [
            1, 
            point.position[0], 
            point.position[1],
            point.position[2],
            point.position[0] * point.position[1],
            point.position[0] * point.position[2],
            point.position[1] * point.position[2],
            point.position[0] * point.position[1] * point.position[2]
        ];

        Y[i] = point.value;
    }

    if (!Y.every(v => v == 0)) {
        // solve the linear regression to get the coefficients matrix
        var pseudoInv = VecMath.pseudoInverse(X)

        if (pseudoInv) {
            // found linear regression
            // console.log("solved");
            return VecMath.matrixVecMult(pseudoInv, Y);
        }
    }

    // all Y vals = 0 or couldn't find linear reg
    return [0, 0, 0, 0, 0, 0, 0, 0];  
};


const evaluatePolynomial = (vals, p) => {
    return vals[0] + 
        vals[1] * p[0] + vals[2] * p[1] + vals[3] * p[2] + 
        vals[4] * p[0] * p[1] + vals[5] * p[0] * p[2] + vals[6] * p[1] * p[2] + 
        vals[7] * p[0] * p[1] * p[2];
};
  

// computes the polynomial fit of a node given the polynomial fit of the children
const getPolyCornerValsFromChildren = (cornerValBuffer, currBox, splitDim, currNode, sampleCount) => {
    var leftCorners = readCornerVals(cornerValBuffer, currNode.leftPtr);
    var rightCorners = readCornerVals(cornerValBuffer, currNode.rightPtr);

    // resample and fit approach
    // get the bounding boxes of the two children nodes
    const leftBox = structuredClone(currBox);
    leftBox.max[splitDim] = currNode.splitVal;
    const rightBox = structuredClone(currBox);
    rightBox.min[splitDim] = currNode.splitVal;
    // sample n times within each
    const pointCountTotal = sampleCount;
    var X = [];
    var Y = [];

    var pos;
    // sample inside the left child
    for (let i = 0; i < pointCountTotal; i++) {
        // sample at unique location
        if (i < pointCountTotal/2) {
            // sample inside left child
            pos = randomInsideBox(leftBox, smoothStep);
            Y[i] = evaluatePolynomial(leftCorners, pos);
        } else {
            // sample inside right child
            pos = randomInsideBox(rightBox, smoothStep);
            Y[i] = evaluatePolynomial(rightCorners, pos);
        }

        X[i] = [
            1, 
            pos[0], 
            pos[1],
            pos[2],
            pos[0] * pos[1],
            pos[0] * pos[2],
            pos[1] * pos[2],
            pos[0] * pos[1] * pos[2]
        ];

        
    }

    if (!Y.every(v => v == 0)) {
        // solve the linear regression to get the coefficients matrix
        var pseudoInv = VecMath.pseudoInverse(X)

        if (pseudoInv) {
            // found linear regression
            // console.log("solved");
            return VecMath.matrixVecMult(pseudoInv, Y);
        }
    }

    // all Y vals = 0 or couldn't find linear reg
    return [0, 0, 0, 0, 0, 0, 0, 0];
};


var createNodePolyCornerValuesBuffer = (dataArray, tree) => {
    const sampleCount = 16;
    var start = performance.now();
    var treeNodes = tree.nodes;
    var nodeCount = tree.nodeCount;
    var nodeCornerVals = new Float32Array(8 * nodeCount);

    // figure out the box of the current node
    var getThisBox = (currNode) => {
        if (currNode.parentPtr == currNode.thisPtr) {
            // root node
            return {...copyBox(tree.extentBox), uses: 0};
        }
        var parentBox = currBoxes[currBoxes.length - 1];
        return getNodeBox(parentBox, currNode.childType, (currDepth - 1) % 3, currNode.parentSplit);
    }

    // the boxes of all of the parents of the current node
    var currBoxes = [];
    // the next nodes to process
    var nodes = [readNodeFromBuffer(treeNodes, 0)];
    var currDepth = 0; // depth of node currently being processed
    var processed = 0;
    while (nodes.length > 0 && processed < nodeCount * 3) {
        processed++;
        var currNode = nodes.pop();
        if (currNode.rightPtr == 0) {
            // get the corner values for this box and write to buffer
            const thisBox = getThisBox(currNode);
            const thisCornerVals = getLeafPolyCornerVals(dataArray, tree, currNode, thisBox, sampleCount);
            writeCornerVals(nodeCornerVals, currNode.thisPtr, thisCornerVals);

            if (currNode.childType == ChildTypes.RIGHT) currDepth--;       
        } else {
            // this is a branch
            if (currDepth == currBoxes.length) {
                // going down, depth
                currBoxes.push(getThisBox(currNode));
                currDepth++;

                // push itself to handle going back up the tree
                nodes.push(currNode);

                // add its children to the next nodes
                var leftNode = readNodeFromBuffer(treeNodes, currNode.rightPtr * NODE_BYTE_LENGTH);
                var rightNode = readNodeFromBuffer(treeNodes, currNode.leftPtr * NODE_BYTE_LENGTH);
                nodes.push({
                    ...leftNode, 
                    childType: ChildTypes.RIGHT,
                    parentSplit: currNode.splitVal,
                });
                nodes.push({
                    ...rightNode, 
                    childType: ChildTypes.LEFT,
                    parentSplit: currNode.splitVal,
                });
            } else {
                // going back up
                // calculate the node corners from its children
                var splitDim = currDepth % 3;

                var thisBox = currBoxes.pop();

                var cornerVals = getPolyCornerValsFromChildren(
                    nodeCornerVals,
                    thisBox,
                    splitDim,
                    currNode,
                    Math.round(sampleCount * 2)
                )
                
                writeCornerVals(nodeCornerVals, currNode.thisPtr, cornerVals);

                
                if (currNode.childType == ChildTypes.RIGHT) currDepth--;  
            }
        }
    }

    console.log("generating poly corner values took:", (performance.now() - start), "ms");

    return nodeCornerVals;
};


// loads the described corner values buffer if present on the server
export async function loadCornerValues (dataSrcDesc, treeInfo, cornerValType) {
    if (!treeInfo) return;

    for (let preGenCornerVal of treeInfo?.cornerValues ?? []) {
        if (preGenCornerVal.dataArray != dataSrcDesc.name) continue;
        if (CornerValTypes[preGenCornerVal.type] != cornerValType) continue;
        // this matches what has been requested, load these files
        console.log("loading pre generated corner vals...");
        try {
            const resp = await fetch(preGenCornerVal.path);
            if (!resp.ok) throw Error("File not found");
            const buff = await resp.arrayBuffer();
            return new Float32Array(buff);
        } catch (e) {
            console.warn("unable to load pre-generated corner val");
        }
    }

    return;
}


// generates the corner values for the full node tree of the data set
export const createNodeCornerValuesBuffer = (dataArray, tree, type) => {
    if (CornerValTypes.SAMPLE == type) {
        return createNodeSampleCornerValuesBuffer(dataArray.data, tree);
    } else if (CornerValTypes.POLYNOMIAL == type) {
        // TODO: update to support dataArray, tree instead of dataObj, slotNum
        // return createNodePolyCornerValuesBuffer(dataArray, tree);
        throw Error("Currently unsupported corner value type");
    } else {
        throw Error("Unrecognised corner value type");
    }
};


// node values ========================================================================================
// one value per node, can be written directly into the full tree

// creates an f32 buffer which contains an average value for each node
// the value for each node is at the same index in this buffer as it is in the tree buffer
export var createNodeValuesBuffer = (dataObj) => {
    var start = performance.now();
    var treeNodes = dataObj.data.treeNodes;
    var nodeCount = Math.floor(dataObj.data.treeNodes.byteLength/NODE_BYTE_LENGTH);
    var nodeVals = new Float32Array(nodeCount);

    // figure out the box of the current node
    var getThisBox = (currNode) => {
        // console.log(currNode);
        if (currNode.parentPtr == currNode.thisPtr) {
            // root node
            return {min: [0, 0, 0], max: dataObj.getDataSize(), uses: 0};
        }
        var parentBox = currBoxes[currBoxes.length - 1];
        return getNodeBox(parentBox, currNode.childType, (currDepth - 1) % 3, currNode.parentSplit);
    };

    // the boxes of all of the parents of the current node
    var currBoxes = [];
    // the next nodes to process
    var nodes = [readNodeFromBuffer(treeNodes, 0)];
    var currDepth = 0; // depth of node currently being processed
    var processed = 0;
    while (nodes.length > 0 && processed < nodeCount * 3) {
        processed++;
        var currNode = nodes.pop();
        if (currNode.rightPtr == 0) {
            // this is a leaf node, get its average value directly
            var averageVal = getLeafAverage(dataObj, currNode, getThisBox(currNode));
            // console.log(averageVal);
            // write into the nodeVals buffer
            nodeVals[currNode.thisPtr] = averageVal;
            if (currNode.childType == ChildTypes.RIGHT) currDepth--;       
        } else {
            // this is a branch
            if (currDepth == currBoxes.length) {
                // going down, depth
                currBoxes.push(getThisBox(currNode));
                currDepth++;

                // push itself to handle going back up the tree
                nodes.push(currNode);

                // add its children to the next nodes
                var rightNode = readNodeFromBuffer(treeNodes, currNode.rightPtr * NODE_BYTE_LENGTH);
                var leftNode = readNodeFromBuffer(treeNodes, currNode.leftPtr * NODE_BYTE_LENGTH);
                nodes.push({
                    ...rightNode, 
                    childType: ChildTypes.RIGHT,
                    parentSplit: currNode.splitVal,
                });
                nodes.push({
                    ...leftNode, 
                    childType: ChildTypes.LEFT,
                    parentSplit: currNode.splitVal,
                });
            } else {
                // going back up
                // calculate the node value from its childrens' values

                // calculate weighting to give to left and right children
                var splitDim = currDepth % 3;
                var thisBox = currBoxes[currBoxes.length - 1];
                var leftWeight = (currNode.splitVal - thisBox.min[splitDim]) / (thisBox.max[splitDim] - thisBox.min[splitDim]);
                // get the averages of its children
                var leftAvg = nodeVals[currNode.leftPtr];
                var rightAvg = nodeVals[currNode.rightPtr];

                // write this average to the buffer
                nodeVals[currNode.thisPtr] = leftAvg * leftWeight + rightAvg * (1 - leftWeight);
                // nodeVals[currNode.thisPtr] = Math.min(leftAvg, rightAvg);

                currBoxes.pop();
                if (currNode.childType == ChildTypes.RIGHT) currDepth--;  
            }
        }
    }
    console.log("generating node vals took:", (performance.now() - start), "ms");
    return nodeVals;
};


export var addNodeValsToFullTree = (treeNodes, nodeVals) => {
    var nodeCount = Math.floor(treeNodes.byteLength/NODE_BYTE_LENGTH);
    for (let i = 0; i < nodeCount; i++) {
        var currNode = readNodeFromBuffer(treeNodes, i * NODE_BYTE_LENGTH);
        if (currNode.rightPtr == 0) {
            // this is leaf, write the node value into it
            writeNodeToBuffer(
                treeNodes, 
                i * NODE_BYTE_LENGTH, 
                nodeVals[i], 
                null, 
                null, 
                null,
                null
            )
        }
    }
};