// cellTree.js
// allows creating a kd based cell tree
// manages

import { VecMath } from "../VecMath.js";
import { mat4, vec4, vec3 } from "https://cdn.skypack.dev/gl-matrix";
import { pivotMedians } from "../utils.js";


const NODE_BYTE_LENGTH = 5 * 4;

const ChildTypes = {
    LEFT: 0,
    RIGHT: 1,
}

// goes through each node, depth first
// callBacks receive the current node
var forEachDepth = (tree, alwaysFunc, leafFunc, branchFunc) => {
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
var forEachBreadth = (tree, alwaysFunc, leafFunc, branchFunc) => {
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

var pivotFull = (a) => {
    var sorted = a.sort((a, b) => {
        if (a < b) return -1;
        return 1;
    });
    // console.log(sorted);
    return sorted[Math.floor(a.length/2) - 1];
}

// estimate the median from a random sample
var pivotRandom = (a) => {
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

var pivot = (a) => {
    if (a.length < 500) {
        return pivotFull(a);
    } else {
        return pivotRandom(a);
    }
}




// struct KDTreeNode {
//     splitVal : f32,
//     cellCount : u32,
//     parentPtr : u32,
//     leftPtr : u32,
//     rightPtr : u32,
// };
var writeNodeToBuffer = (buffer, byteOffset, splitVal, cellCount, parentPtr, leftPtr, rightPtr) => {
    var f32View = new Float32Array(buffer, byteOffset, 1);
    if (splitVal != null) f32View[0] = splitVal;
    var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
    if (cellCount != null) u32View[1] = cellCount;
    if (parentPtr != null) u32View[2] = parentPtr;
    if (leftPtr != null) u32View[3] = leftPtr;
    if (rightPtr != null) u32View[4] = rightPtr;
}

// be careful as the elements of the node still reference the underlying buffer
var readNodeFromBuffer = (buffer, byteOffset) => {
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

var depthFirstTreeBufferTraverse = (
    nodeBuffer,
    leafFunc,
    branchDownFunc,
    branchUpFunc,
) => {
    var nodeCount = Math.floor(nodeBuffer.byteLength/NODE_BYTE_LENGTH);
    var nodes = [readNodeFromBuffer(nodeBuffer, 0)];
    var currDepth = 0; // depth of node currently being processed
    var parentCount = 0;
    var processed = 0;
    while (nodes.length > 0 && processed < nodeCount * 3) {
        processed++;
        var str = "";
        for (let node of nodes) {
            str += node.thisPtr + " ";
        }
        // console.log(str);
        // console.log("depth: ", currDepth);
        // console.log("parentCount: ", parentCount);
        var currNode = nodes.pop();
        // console.log(currNode);
        if (currNode.rightPtr == 0) {
            // this is a leaf
            // console.log("leaf")
            leafFunc(currDepth, currNode);
            // right is done after left, going back up the tree now  
            if (currNode.childType == ChildTypes.RIGHT) currDepth--;       
        } else {
            // this is a branch
            if (currDepth == parentCount) {
                // going down
                // console.log("down")
                // push itself to handle going back up the tree
                nodes.push(currNode);

                // add its children to the next nodes
                var leftNode = readNodeFromBuffer(nodeBuffer, currNode.leftPtr * NODE_BYTE_LENGTH);
                var rightNode = readNodeFromBuffer(nodeBuffer, currNode.rightPtr * NODE_BYTE_LENGTH);

                var childInfo = branchDownFunc(currDepth, currNode, leftNode, rightNode);
                
                nodes.push({
                    ...rightNode, 
                    ...childInfo.right
                });
                nodes.push({
                    ...leftNode, 
                    ...childInfo.left
                });

                currDepth++;
                parentCount++;
            } else {
                // going back up
                // console.log("up")
                branchUpFunc(currDepth, currNode);
                parentCount--;
                if (currNode.childType == ChildTypes.RIGHT) currDepth--;  
            }
        }
    }
}


// generates the cell tree for fast lookups in unstructured data
// returns two buffers:
//   the nodes of the tree (leaves store indices into second buffer)
//   the lists of cells present in each leaf node 
export var getCellTreeBuffers = (dataObj, leafCells) => {
    var maxDepth = 25;
    var tree = new CellTree(leafCells);
    // dimensions, depth, points, cellConnectivity, cellOffsets, cellTypes
    var t0 = performance.now();
    tree.build(
        3, 
        maxDepth, 
        dataObj.data.positions, 
        dataObj.data.cellConnectivity,
        dataObj.data.cellOffsets,
        dataObj.data.cellTypes
    );
    var t1 = performance.now();
    console.log("tree build took:", (t1 - t0)/1000, "s");
    var treeBuffers = tree.serialise();
    tree.tree = null; // clear the unused tree
    var t2 = performance.now();
    console.log("tree serialise took:", (t2 - t1)/1000, "s");
    return treeBuffers;
}


// returns the box covering this node from the direct parent node's box
// takes parent box, if its left and split dimension
var getNodeBox = (parentBox, childType, splitDimension, splitVal) => {
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


// calculates a score for the box
// high score -> too big -> split
// low score -> too small -> merge
// box size/distance from focus point
// modified by distance of camera -> focus point
// > closer -> 
var calcBoxScore = (box, focusCoords, camCoords) => {
    // get corner-to-corner length of the box
    var length = VecMath.magnitude(VecMath.vecMinus(box.max, box.min));
    var lMax = Math.abs(Math.max(...VecMath.vecMinus(box.max, box.min)));
    var mid = VecMath.scalMult(0.5, VecMath.vecAdd(box.min, box.max));
    // distance of box from camera
    var distToCam = VecMath.magnitude(VecMath.vecMinus(camCoords, mid));
    // distance of box from focus
    var distToFoc = VecMath.magnitude(VecMath.vecMinus(focusCoords, mid));
    // distance of camera from focus
    var camtoFoc = VecMath.magnitude(VecMath.vecMinus(focusCoords, camCoords));

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
    return lMax - Math.max(0, (Math.abs(distToFoc)-10)/camtoFoc*10 + 5);


    
}


// calculate the scores for the current leaf nodes, true leaf or pruned
// returns a list of high and low scoring nodes, count long
// each node also contains the ptr to themselves in the full tree buffer
// threshold if the min score (size) that will be considered for splitting
// assumes camera coords is in the dataset coordinate space
var getNodeScores = (dataObj, threshold, focusCoords, camCoords, count) => {
    // console.log(threshold);
    var dynamicNodes = dataObj.data.dynamicTreeNodes;
    var fullNodes = dataObj.data.treeNodes;
    var nodeCount = Math.floor(dynamicNodes.byteLength/NODE_BYTE_LENGTH);
    // higher score, big box -> split
    var highScores = [];
    // lower score, small box -> merge
    var lowScores = [];

    var insertScore = (arr, elem, comp) => {
        var added = false;
        for (let i = 0; i < arr.length; i++) {
            if (comp(elem, arr[i])) {
                arr.splice(i, 0, elem);
                added = true;
                break;
            }
        }
        if (!added && arr.length < count) arr.push(elem);

        if (arr.length > count) arr.pop();
    }
    // figure out the box of the current node
    var getThisBox = (currNode) => {
        // console.log(currNode);
        if (currNode.parentPtr == currNode.thisPtr) {
            // root node
            return {min: [0, 0, 0], max: dataObj.getDataSize(), uses: 0};
        }
        var parentBox = currBoxes[currBoxes.length - 1];
        return getNodeBox(parentBox, currNode.childType, (currDepth - 1) % 3, currNode.parentSplit);
    }

    // the boxes of all of the parents of the current node
    var currBoxes = [];
    // the next nodes to process
    var nodes = [readNodeFromBuffer(dynamicNodes, 0)];
    var currDepth = 0; // depth of node currently being processed
    var processed = 0;
    while (nodes.length > 0 && processed < nodeCount * 3) {
        processed++;
        var str = "";
        for (let node of nodes) {
            str += node.thisPtr + " ";
        }
        // console.log(str);
        // console.log("depth: ", currDepth);
        // console.log(currBoxes.slice());
        var currNode = nodes.pop();
        if (currNode.rightPtr == 0) {
            // this is a leaf node, get its score
            // console.log("leaf")
            // console.log(getThisBox(currNode));
            var score = calcBoxScore(getThisBox(currNode), focusCoords, camCoords);
            currNode.score = score;
            // console.log(score);
            if (score > threshold) insertScore(highScores, currNode, (a, b) => a.score > b.score);
            if (currNode.bothSiblingsLeaves) insertScore(lowScores, currNode, (a, b) => a.score < b.score);   
            // write score into node for now
            writeNodeToBuffer(dynamicNodes, currNode.thisPtr * NODE_BYTE_LENGTH, score, null, null, null, null);
            // right is done after left, going back up the tree now  
            if (currNode.childType == ChildTypes.RIGHT) currDepth--;       
        } else {
            // this is a branch
            // console.log("branch")
            if (currDepth == currBoxes.length) {
                // console.log("down")
                // going down, depth
                currBoxes.push(getThisBox(currNode));
                currDepth++;

                // push itself to handle going back up the tree
                nodes.push(currNode);

                // get the ptr to the children in the full buffer
                var currFullNode = readNodeFromBuffer(fullNodes, (currNode.thisFullPtr ?? 0) * NODE_BYTE_LENGTH);
                // add its children to the next nodes
                var rightNode = readNodeFromBuffer(dynamicNodes, currNode.rightPtr * NODE_BYTE_LENGTH);
                var leftNode = readNodeFromBuffer(dynamicNodes, currNode.leftPtr * NODE_BYTE_LENGTH);
                var bothLeaves = leftNode.rightPtr == 0 && rightNode.rightPtr == 0;
                nodes.push({
                    ...rightNode, 
                    thisFullPtr: currFullNode.rightPtr,
                    childType: ChildTypes.RIGHT,
                    parentSplit: currNode.splitVal,
                    bothSiblingsLeaves: bothLeaves,
                });
                nodes.push({
                    ...leftNode, 
                    thisFullPtr: currFullNode.leftPtr,
                    childType: ChildTypes.LEFT,
                    parentSplit: currNode.splitVal,
                    bothSiblingsLeaves: bothLeaves,
                });
            } else {
                // console.log("up")
                // going back up
                currBoxes.pop();
                if (currNode.childType == ChildTypes.RIGHT) currDepth--;  
            }
        }
    }

    return {
        high: highScores,
        low: lowScores
    }
}

var getNodeScoresNew = (dataObj, threshold, cameraCoords, count) => {
    // console.log(threshold);
    var dynamicNodes = dataObj.data.dynamicTreeNodes;
    var fullNodes = dataObj.data.treeNodes;
    // higher score, big box -> split
    var highScores = [];
    // lower score, small box -> merge
    var lowScores = [];

    var insertScore = (arr, elem, comp) => {
        var added = false;
        for (let i = 0; i < arr.length; i++) {
            if (comp(elem, arr[i])) {
                arr.splice(i, 0, elem);
                added = true;
                break;
            }
        }
        if (!added && arr.length < count) arr.push(elem);

        if (arr.length > count) arr.pop();
    }
    // figure out the box of the current node
    var getThisBox = (currDepth, currNode) => {
        // console.log(currNode);
        if (currNode.parentPtr == currNode.thisPtr) {
            // root node
            return {min: [0, 0, 0], max: dataObj.getDataSize(), uses: 0};
        }
        var parentBox = currBoxes[currBoxes.length - 1];
        return getNodeBox(parentBox, currNode.childType, (currDepth - 1) % 3, currNode.parentSplit);
    }

    // boxes of parent nodes
    var currBoxes = [];

    depthFirstTreeBufferTraverse(
        dynamicNodes,
        (currDepth, currNode) => {
            var score = calcBoxScore(getThisBox(currDepth, currNode), cameraCoords);
            currNode.score = score;
            if (score > threshold) insertScore(highScores, currNode, (a, b) => a.score > b.score);
            if (currNode.bothSiblingsLeaves) insertScore(lowScores, currNode, (a, b) => a.score < b.score);
        },
        (currDepth, currNode, leftNode, rightNode) => {
            currBoxes.push(getThisBox(currDepth, currNode));

            // get the ptr to the children in the full buffer
            var currFullNode = readNodeFromBuffer(fullNodes, (currNode.thisFullPtr ?? 0) * NODE_BYTE_LENGTH);
            var bothLeaves = leftNode.rightPtr == 0 && rightNode.rightPtr == 0;

            return {
                right: {
                    thisFullPtr: currFullNode.rightPtr,
                    childType: ChildTypes.RIGHT,
                    parentSplit: currNode.splitVal,
                    bothSiblingsLeaves: bothLeaves,
                },
                left: {
                    thisFullPtr: currFullNode.leftPtr,
                    childType: ChildTypes.LEFT,
                    parentSplit: currNode.splitVal,
                    bothSiblingsLeaves: bothLeaves,
                }
            }
        },
        (currDepth, currNode) => {}
    );

    return {
        high: highScores,
        low: lowScores
    }
}


// make sure there are no nodes in both high and low
// make sure those in high can be split
// make sure low doesn't have any full sibling sets
var sanitiseNodeScores = (fullNodes, scores) => {
    // make sure the lowest and highest lists don't intersect by not sharing parents
    // this ensures there isn't duplicte nodes or siblings split across
    // remove from high scores lists if there is
    for (let i = scores.high.length - 1; i > -1; i--) {
        let j;
        let removed = false;
        for (j = 0; j < scores.low.length; j++) {
            if (scores.high[i].parentPtr == scores.low[j].parentPtr) {
                // duplicate found
                scores.high.splice(i, 1);
                removed = true;
                break;
            }
        }

        // check if extra resolution available
        if (!removed) {
            var fullNode = readNodeFromBuffer(fullNodes, scores.high[i].thisFullPtr * NODE_BYTE_LENGTH);
            if (fullNode.rightPtr == 0) {
                // is a true leaf
                scores.high.splice(i, 1);
            }
        }
    }
    // console.log(scores);

    for (let i = scores.low.length - 1; i > -1; i--) {
        var siblingIsLeaf = false;

        // make sure only one out of each sibling pair is in low score lost
        for (let j = i - 1; j > -1; j--) {
            // console.log(scores.low.map(x => x.parentPtr), i, j);
            if (i != j && scores.low[i].parentPtr == scores.low[j].parentPtr) {
                // siblings found
                scores.low.splice(i, 1); // i >= j
                siblingIsLeaf = true;
                break;
            }
        }
    }

    return scores;
}


var changeNodeBufferContents = (dynamicNodes, fullNodes, nodeVals, dynamicCornerValues, fullCornerValues, scores) => {
    // find the amount of changes we can now make
    var changeCount = Math.min(scores.high.length, Math.floor(scores.low.length/2) * 2);
    // cap this at 1
    //changeCount = Math.min(1, changeCount);
    // console.log(changeCount);

    // merge the leaves with the highest scores with their siblings (delete 2 per change)
    var freePtrs = [];
    for (let i = 0; i < changeCount; i++) {
        // console.log("pruning", scores.low[i].parentPtr);
        var parentNode = readNodeFromBuffer(dynamicNodes, scores.low[i].parentPtr * NODE_BYTE_LENGTH);
        var parentFullPtr = readNodeFromBuffer(fullNodes, scores.low[i]).parentPtr;
        freePtrs.push(parentNode.leftPtr, parentNode.rightPtr);
        // convert the parentNode to a pruned leaf
        writeNodeToBuffer(
            dynamicNodes, 
            scores.low[i].parentPtr * NODE_BYTE_LENGTH,
            nodeVals[parentFullPtr],//null,
            null,
            null,
            0,
            0,
        );

        // console.log(readNodeFromBuffer(dynamicNodes, scores.low[i].parentPtr * NODE_BYTE_LENGTH));
    }

    // console.log(freePtrs);

    // split the leaves with the lowest scores (write 2 per change)
    for (let i = 0; i < freePtrs.length/2; i++) {
        var thisNode = scores.high[i];
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
            nodeVals[leftNode.thisPtr], 
            leftNode.cellCount,
            thisNode.thisPtr, 
            leftNode.leftPtr, 
            0
        );
        writeCornerVals(
            dynamicCornerValues,
            freePtrs[2*i],
            fullCornerValues.slice(leftNode.thisPtr * 8, (leftNode.thisPtr + 1)* 8)
        )

        // console.log(readNodeFromBuffer(dynamicNodes, freePtrs[2*i] * NODE_BYTE_LENGTH));
        // fetch the right node from the full buffer and write to dynamic as pruned leaf
        var rightNode = readNodeFromBuffer(fullNodes, thisNodeFull.rightPtr * NODE_BYTE_LENGTH);
        writeNodeToBuffer(
            dynamicNodes, 
            freePtrs[2*i + 1] * NODE_BYTE_LENGTH, 
            nodeVals[rightNode.thisPtr], 
            rightNode.cellCount,
            thisNode.thisPtr, 
            rightNode.leftPtr, 
            0
        );
        writeCornerVals(
            dynamicCornerValues,
            freePtrs[2*i + 1],
            fullCornerValues.slice(rightNode.thisPtr * 8, (rightNode.thisPtr + 1)* 8)
        )

        // console.log(readNodeFromBuffer(dynamicNodes, freePtrs[2*i + 1] * NODE_BYTE_LENGTH));
    }
}


// updates the dynamic tree buffers based on camera location
// split nodes that are too large
// merge nodes that are too small
// if a node is 
export var updateDynamicTreeBuffers = (dataObj, threshold, focusCoords, camCoords) => {
    // get the node scores, n lowest highest
    var scores = getNodeScores(dataObj, threshold, focusCoords, camCoords, 10);
    scores = sanitiseNodeScores(dataObj.data.treeNodes, scores);
    // console.log(scores);
    // update the dynamic buffer contents
    changeNodeBufferContents(
        dataObj.data.dynamicTreeNodes, 
        dataObj.data.treeNodes, 
        dataObj.data.nodeVals, 
        dataObj.data.dynamicCornerValues, 
        dataObj.data.cornerValues, 
        scores
    );    
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

var getContainingCell = (dataObj, queryPoint, leafNode) => {
    var cell = {
        points : [
            vec3.create(), vec3.create(), vec3.create(), vec3.create(),
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
        cell.values[0] = dataObj.data.values[dataObj.data.cellConnectivity[pointsOffset + 0]];
        cell.values[1] = dataObj.data.values[dataObj.data.cellConnectivity[pointsOffset + 1]];
        cell.values[2] = dataObj.data.values[dataObj.data.cellConnectivity[pointsOffset + 2]];
        cell.values[3] = dataObj.data.values[dataObj.data.cellConnectivity[pointsOffset + 3]];

        cell.factors = tetFactors;
        break;
    }
    return cell;
}

// samples a given leaf at the given position
var sampleLeaf = (dataObj, leafNode, queryPoint) => {
    // true leaf, sample the cells within
    var cell = getContainingCell(dataObj, queryPoint, leafNode);
    // interpolate value
    if (vec4.length(cell.factors) == 0) {
        return 0;
    };
    return vec4.dot(cell.values, cell.factors);
}

var getLeafAverage = (dataObj, leafNode, leafBox) => {
    var newQueryPoint = () => {
        return [
            Math.random() * (leafBox.max[0] - leafBox.min[0]) + leafBox.min[0],
            Math.random() * (leafBox.max[1] - leafBox.min[1]) + leafBox.min[1],
            Math.random() * (leafBox.max[2] - leafBox.min[2]) + leafBox.min[2],
        ]
    }
    var sampleCount = 10;
    var averageVal = 0;
    for (let i = 0; i < sampleCount; i++) {
        // sample the leaf node at random positions to find its average value
        averageVal += sampleLeaf(dataObj, leafNode, newQueryPoint())/sampleCount;
    }

    return averageVal;
}


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
}

//           z   y   x
// 0 -> 000  min min min
// 1 -> 001  min min max
// 2 -> 010  min max min
// 3 -> 011  min max max
// 4 -> 100  max min min
// 5 -> 101  max min max
// 6 -> 110  max max min
// 7 -> 111  max max max

var getCornerVals = (dataObj, leafNode, leafBox) => {
    var cornerVals = new Float32Array(8);

    cornerVals[0] = sampleLeaf(dataObj, leafNode, leafBox.min);
    cornerVals[1] = sampleLeaf(dataObj, leafNode, [leafBox.max[0], leafBox.min[1], leafBox.min[2]]);
    cornerVals[2] = sampleLeaf(dataObj, leafNode, [leafBox.min[0], leafBox.max[1], leafBox.min[2]]);
    cornerVals[3] = sampleLeaf(dataObj, leafNode, [leafBox.max[0], leafBox.max[1], leafBox.min[2]]);
    cornerVals[4] = sampleLeaf(dataObj, leafNode, [leafBox.min[0], leafBox.min[1], leafBox.max[2]]);
    cornerVals[5] = sampleLeaf(dataObj, leafNode, [leafBox.max[0], leafBox.min[1], leafBox.max[2]]);
    cornerVals[6] = sampleLeaf(dataObj, leafNode, [leafBox.min[0], leafBox.max[1], leafBox.max[2]]);
    cornerVals[7] = sampleLeaf(dataObj, leafNode, leafBox.max);
    

    return cornerVals;
}

var getCornerValsFromChildren = (cornerValBuffer, splitDim, leftPtr, rightPtr) => {
    var leftCorners = cornerValBuffer.slice(leftPtr*8, (leftPtr + 1)*8);
    var rightCorners = cornerValBuffer.slice(rightPtr*8, (rightPtr + 1)*8);
    var thisCorners = new Float32Array(8);

    for (let i = 0; i < 8; i++) {
        if ((i >> splitDim & 1) == 1) {
            thisCorners[i] = rightCorners[i];
        } else {
            thisCorners[i] = leftCorners[i];
        }
    }
    return thisCorners;
}

var readCornerVals = (cornerValBuffer, nodePtr) => {
    return cornerValBuffer.slice(nodePtr * 8, (nodePtr + 1)* 8)
}

var writeCornerVals = (cornerValBuffer, nodePtr, cornerVals) => {
    cornerValBuffer.set(cornerVals, nodePtr*8);
}

// creates an f32 buffer containg 8 values per node
// these are the values at the vertices where the split plane intersects the node bounding box edges
// there are not values for true leaves as these don't have a split plane
export var createNodeCornerValuesBuffer = (dataObj) => {
    var start = performance.now();
    var treeNodes = dataObj.data.treeNodes;
    var nodeCount = Math.floor(dataObj.data.treeNodes.byteLength/NODE_BYTE_LENGTH);
    var nodeCornerVals = new Float32Array(8 * nodeCount);

    // figure out the box of the current node
    var getThisBox = (currNode) => {
        // console.log(currNode);
        if (currNode.parentPtr == currNode.thisPtr) {
            // root node
            return {min: [0, 0, 0], max: dataObj.getDataSize(), uses: 0};
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
            writeCornerVals(nodeCornerVals, currNode.thisPtr, getCornerVals(dataObj, currNode, getThisBox(currNode)));

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

                var cornerVals = getCornerValsFromChildren(
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
}

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
}


// create the buffers used for dynamic data resolution
// for the first iteration, this only modifies the treenodes buffer
export var createDynamicTreeBuffers = (dataObj, maxNodes) => {
    var fullNodes = dataObj.data.treeNodes;
    // create the empty cache buffers at the given maximum size
    var dynamicNodes = new ArrayBuffer(maxNodes * NODE_BYTE_LENGTH);
    var dynamicCornerValues = new Float32Array(8 * maxNodes);
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
                        dataObj.data.nodeVals[leftNode.thisPtr],//leftNode.splitVal, 
                        0,
                        parentLoc/NODE_BYTE_LENGTH, 
                        0, 
                        0
                    );
                    writeCornerVals(
                        dynamicCornerValues,
                        currNodeIndex,
                        dataObj.data.cornerValues.slice(leftNode.thisPtr * 8, (leftNode.thisPtr + 1)* 8)
                    );
                    // fetch the right node from the full buffer and write to dynamic as pruned leaf
                    var rightNode = readNodeFromBuffer(fullNodes, currParentFull.rightPtr * NODE_BYTE_LENGTH);
                    writeNodeToBuffer(
                        dynamicNodes, 
                        (currNodeIndex + 1) * NODE_BYTE_LENGTH, 
                        dataObj.data.nodeVals[rightNode.thisPtr],//rightNode.splitVal, 
                        0, 
                        parentLoc/NODE_BYTE_LENGTH, 
                        0, 
                        0
                    )
                    writeCornerVals( 
                        dynamicCornerValues,
                        (currNodeIndex + 1),
                        dataObj.data.cornerValues.slice(rightNode.thisPtr * 8, (rightNode.thisPtr + 1)* 8)
                    );
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
    return {
        nodes: dynamicNodes,
        cornerValues: dynamicCornerValues,
    }
}
   

export function CellTree(leafCells) {
    this.tree = null;
    this.maxLeafCells = leafCells;

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
    this.build = function(dimensions, depth, points, cellConnectivity, cellOffsets, cellTypes) {
        // console.log(points);
        var cellsTree = false;
        if (cellConnectivity) cellsTree = true;
        // checks whether the cell of the given id is lte, gt the split val in checked dimension or both
        var checkCellPosition = (id, checkDimension, splitVal) => {
            // first get the points in the cell
            var pointsLength = 0;
            switch (cellTypes[id]) {
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
            var pointsOffset = cellOffsets[id];
            var results = [false, false];
            var thisPointValue;
            for (let i = 0; i < pointsLength; i++) {
                // the position of this point in the dimension that is being checked
                thisPointValue = points[cellConnectivity[pointsOffset + i]*dimensions + checkDimension];
                if (thisPointValue <= splitVal) results[0] = true;
                if (thisPointValue > splitVal)  results[1] = true;
            }
            return results;
        }
    
        var nodeQueue = [];
        var cellsCountSum = 0;
        var leavesCount = 0;
        // make a root node with the whols dataset
        var root = this.createNode(0, 0, points);

        if (cellsTree) {
            for (let i = 0; i < cellOffsets.length; i++) {
                root.cells.push(i);
            }
        }
        nodeQueue.push(root);
    
        while (nodeQueue.length > 0) {
            var parentNode = nodeQueue.pop();
            var currentDepth = parentNode.depth + 1;
            // stop the expansion of this node if the tree is deep enough
            // or stop if the # cells is already low enough
            if (currentDepth > depth || parentNode.cells.length <= this.maxLeafCells) {
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
                    var cellSides = checkCellPosition(cellID, currentDimension, parentNode.splitVal);
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
    
    this.buildIntoBuffer = function(dimensions, depth, points, cellConnectivity, cellOffsets, cellTypes) {

    }
    // builds a tree by iteratively inserting cells until a node has > the limit
    // can pick cells randomly
    this.buildIterative = function(dimensions, maxLeafSize, cellConnectivity, cellOffsets, cellTypes, random = false) {
    }
    // UNUSED
    this.getTreeByteLength = function() {
        // work out how long the tree is in values (4 bytes each)
        var treeByteLength = 0;

        forEachDepth(this.tree,
            () => {treeByteLength += NODE_BYTE_LENGTH},
            (node) => {treeByteLength += node.cells.length * 4},
            () => {}
        );
        
        return treeByteLength;
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