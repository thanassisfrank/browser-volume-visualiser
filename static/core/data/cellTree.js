// cellTree.js
// allows creating a kd based cell tree
// manages


const NODE_BYTE_LENGTH = 4 * 4;

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




// struct KDTreeNode {
//     splitVal : f32,
//     cellCount: u32,
//     leftPtr : u32,
//     rightPtr : u32,
// };
var writeNodeToBuffer = (buffer, byteOffset, splitVal, cellCount, leftPtr, rightPtr) => {
    var f32View = new Float32Array(buffer, byteOffset, 1);
    if (splitVal !== null) f32View[0] = splitVal;
    var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
    if (cellCount !== null) u32View[1] = cellCount;
    if (leftPtr !== null) u32View[2] = leftPtr;
    if (rightPtr !== null) u32View[3] = rightPtr;
}

var writeNodeObjToBuffer = (buffer, byteOffset, node) => {
    writeNodeToBuffer(buffer, byteOffset, node.splitVal, node.cellCount, node.leftPtr, node.rightPtr)
}

var readNodeFromBuffer = (buffer, byteOffset) => {
    var f32View = new Float32Array(buffer, byteOffset, 1);
    var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
    return {
        splitVal: f32View[0],
        cellCount: u32View[1],
        leftPtr: u32View[2],
        rightPtr: u32View[3],
    }
}


// generates the cell tree for fast lookups in unstructured data
// returns two buffers:
//   the nodes of the tree (leaves store indices into second buffer)
//   the lists of cells present in each leaf node 
export var getCellTreeBuffers = (dataObj) => {
    var maxDepth = 16;
    var tree = new CellTree();
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
// updates the dynamic tree buffers based on camera location
// cameraCoords is dataset-relative
export var updateDynamicTreeBuffers = (dataObj, cameraCoords) => {
    // the # nodes in the dynamic buffer
    var nodeCount = dataObj.data.dynamicNodes.byteLength/NODE_BYTE_LENGTH;
    // calculate the scores for the current leaf nodes, true leaf or pruned
    // score is the visual size/ideal visual size
    // higher score -> split
    // lower score  -> merge
    var scores = new Float32Array();
    var nodes = [];
    while (nodes.length > 0) {

    }

    // select the n leaves with the highest score to split

    // select the n leaves with the lowest scores to merge
    // make sure only one out of each sibling pair is in this list

    // make sure the lowest and highest lists don't share any leaves
    
    // merge the leaves with the highest scores with their siblings (delete 2)

    // split the leaves with the lowest scores (write 2)
    // these go into the left-over locations from deleted nodes

}

// creates an f32 buffer which contains an average value for each node
// stored breadth first
export var createNodeValuesBuffer = (dataObj) => {
    var nodeCount = Math.floor(dataObj.data.treeNodes.byteLength/NODE_BYTE_LENGTH);
    var nodeVals
}

// create the buffers used for dynamic data resolution
// for the first iteration, this only modifies the treenodes buffer
export var createDynamicTreeBuffers = (dataObj, maxNodes) => {
    var fullNodes = dataObj.data.treeNodes;
    // create the empty cache buffers at the given maximum size
    var dynamicNodes = new ArrayBuffer(maxNodes * NODE_BYTE_LENGTH);
    // find the depth of the tree 
    // fill the dynamic buffer from the full tree buffer, breadth first
    var currNodeIndex = 0; // where to write the next node

    var rootNode = readNodeFromBuffer(fullNodes, 0);
    console.log(rootNode);
    writeNodeToBuffer(dynamicNodes, 0, rootNode.splitVal, 0, 0, 0);
    currNodeIndex++;
    
    // var dynamicRootNode = readNodeFromBuffer(dynamicNodes, 0);
    // console.log(dynamicRootNode);
    
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

                // console.log(currParent);
                // navigate to the next node to add children too
                for (let j = 0; j < currDepth; j++) {
                    // i acts as the route to get to the node (0 bit -> left, 1 bit -> right)
                    if ((i >> (currDepth - j - 1)) & 1 != 0) {
                        // go right
                        parentLoc = currParent.rightPtr * NODE_BYTE_LENGTH;
                        parentLocFull = currParentFull.rightPtr * NODE_BYTE_LENGTH;
                        // console.log("r");
                    } else {
                        // go left
                        parentLoc = currParent.leftPtr * NODE_BYTE_LENGTH;
                        parentLocFull = currParentFull.leftPtr * NODE_BYTE_LENGTH;
                        // console.log("l");
                        
                    }
                    currParent = readNodeFromBuffer(dynamicNodes, parentLoc);
                    currParentFull = readNodeFromBuffer(fullNodes, parentLocFull);
                    // console.log(currParentFull);
                    // console.log(currParent);
                }
                // console.log(parentLoc);
                // got to the node we want to add children to
                // check if there is room to add the children
                if (currNodeIndex < maxNodes - 2) {
                    // update parent so it is not a pruned leaf node
                    writeNodeToBuffer(
                        dynamicNodes, 
                        parentLoc, 
                        currParent.splitVal, 
                        0, 
                        currNodeIndex, 
                        currNodeIndex + 1
                    )
                    
                    // fetch the left node from the full buffer and write to dynamic as pruned leaf
                    var leftNode = readNodeFromBuffer(fullNodes, currParentFull.leftPtr * NODE_BYTE_LENGTH);
                    writeNodeToBuffer(
                        dynamicNodes, 
                        currNodeIndex * NODE_BYTE_LENGTH, 
                        leftNode.splitVal, 
                        0, 
                        0, 
                        0
                    );
                    // fetch the right node from the full buffer and write to dynamic as pruned leaf
                    var rightNode = readNodeFromBuffer(fullNodes, currParentFull.rightPtr * NODE_BYTE_LENGTH);
                    writeNodeToBuffer(
                        dynamicNodes, 
                        (currNodeIndex + 1)* NODE_BYTE_LENGTH, 
                        rightNode.splitVal, 
                        0, 
                        0, 
                        0
                    )
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

export var estimateLeafAvg = (dataObj) => {
    
}
   

export function CellTree() {
    this.tree = null;
    this.minLeafCells = 128;

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
            for (let i = 0; i < pointsLength; i++) {
                // index into the points array
                var thisIndex = cellConnectivity[pointsOffset + i];
                // the position of this point in the dimension that is being checked
                var thisPointValue = points[thisIndex*dimensions + checkDimension];
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
            if (currentDepth > depth || parentNode.cells.length <= this.minLeafCells) {
                cellsCountSum += parentNode.cells.length;
                leavesCount++;
                continue;
            }
    
            var currentDimension = parentNode.splitDimension;
            var currentPoints = parentNode.points;
    
            // make a set of points that is just the values in the current dimension
            var thisDimValues = [];
            for (let i = currentDimension; i < currentPoints.length; i += dimensions) {
                // console.log(i);
                thisDimValues.push(currentPoints[i]);
            }
            
            // find the pivot 
            parentNode.splitVal = pivotFull(thisDimValues);
            // console.log(thisDimValues);
    
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
        forEachDepth(this.tree,
            () => {},
            (node) => {count += node.cells.length},
            () => {}
        );
        return count;
    }
    // returns the tree as a buffer
    this.serialise = function() {
        // tree has not been built
        if (!this.tree) return;
        // var byteLength = this.getTreeByteLength();
        var totalNodeCount = this.getTreeNodeCount();
        var totalCellsCount = this.getTreeCellsCount();
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
                writeNodeToBuffer(nodesBuffer, node.byteLocation, node.splitVal, node.cells?.length ?? 0, null, null);
                // write location at the parent node
                var parent = node.parent;
                if (parent) {
                    if (parent.left == node) {
                        writeNodeToBuffer(nodesBuffer, parent.byteLocation, null, null, node.byteLocation/NODE_BYTE_LENGTH, null);
                    } else {
                        writeNodeToBuffer(nodesBuffer, parent.byteLocation, null, null, null, node.byteLocation/NODE_BYTE_LENGTH);
                    }
                }
                nextNodeByteOffset += NODE_BYTE_LENGTH;
            }, 
            // run only for leaf nodex
            (node) => {
                node.cellsByteLocation = nextCellsByteOffset;
                new Uint32Array(cellsBuffer.buffer, node.cellsByteLocation, node.cells.length).set(node.cells);
                writeNodeToBuffer(nodesBuffer, node.byteLocation, null, null, node.cellsByteLocation/4, 0);
                nextCellsByteOffset += node.cells.length*4;
            }, 
            // run only for branch nodes
            (node) => {}
        );

        return {
            nodes: nodesBuffer,
            cells: cellsBuffer
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