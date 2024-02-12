// cellTree.js
// allows creating a kd based cell tree

const NODE_BYTE_LENGTH = 8*4;

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
            
        // var nodeQueue = [tree];
        // while (nodeQueue.length > 0) {
        //     var currNode = nodeQueue.pop()
        //     treeValueLength += nodeValueLength;
        //     if (currNode.left == null) {
        //         // this is a leaf node, add its cells
        //         treeValueLength += currNode.cells.length;
        //     } else {
        //         // continue down the tree
        //         nodeQueue.push(currNode.left, currNode.right);
        //     }
        // }
    }
    // writes the node to the given array buffer at the offset position
    // tied to the definition of the nodes in the shader
    this.writeNodeToBuffer = function(buffer, byteOffset, node) {
        // struct KDTreeNode {
        //     splitDimension : u32,
        //     splitVal : f32,
        //     cellCount: u32,
        //     cellsPtr : u32,           
        //     leftPtr : u32,
        //     rightPtr : u32,
        // };
        var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
        u32View[0] = node.splitDimension;
        var loc = node.cells ? node.cells.length : 0;
        u32View[2] = loc;
        var f32View = new Float32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
        f32View[1] = node.splitVal;
    }
    this.writeChildLocation = function(buffer, byteOffset, childLocation, isLeft) {
        var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
        if (isLeft) {
            u32View[4] = childLocation;
        } else {
            u32View[5] = childLocation;
        }
    }
    this.writeCellsLocation = function(buffer, byteOffset, cellsLocation) {
        var u32View = new Uint32Array(buffer, byteOffset, NODE_BYTE_LENGTH/4);
        u32View[3] = cellsLocation;
    }
    // returns the tree as a buffer
    this.serialise = function() {
        // tree has not been built
        if (!this.tree) return;
        var byteLength = this.getTreeByteLength();
        console.log("tree buffer byte length: ", byteLength);
        // create a buffer to store the tree
        var treeBuffer = new ArrayBuffer(byteLength);
        // take the tree and pack it into a buffer representation
        var nextByteOffset = 0;
        forEachBreadth(
            this.tree,
            // run for every node
            (node) => {
                node.byteLocation = nextByteOffset;
                this.writeNodeToBuffer(treeBuffer, node.byteLocation, node);
                // write location at the parent node
                var parent = node.parent;
                if (parent) {
                    if (parent.left == node) {
                        this.writeChildLocation(treeBuffer, parent.byteLocation, node.byteLocation/4, true);
                    } else {
                        this.writeChildLocation(treeBuffer, parent.byteLocation, node.byteLocation/4, false);
                    }
                }
                nextByteOffset += NODE_BYTE_LENGTH;
            }, 
            // run only for leaf nodex
            (node) => {
                node.cellsByteLocation = nextByteOffset;
                new Uint32Array(treeBuffer, nextByteOffset, node.cells.length).set(node.cells);
                this.writeCellsLocation(treeBuffer, node.byteLocation, node.cellsByteLocation/4);
                nextByteOffset += node.cells.length*4;
            }, 
            // run only for branch nodes
            (node) => {}
        );

        return treeBuffer;
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