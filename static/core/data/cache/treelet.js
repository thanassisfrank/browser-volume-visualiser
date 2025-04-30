// treelet.js
// handles the generation of treelets

import { copyBox } from "../../utils/boxUtils.js";
import { checkCellPosition, NODE_BYTE_LENGTH, writeNodeToBuffer } from "../cellTreeUtils.js";

// where the top left and right nodes will be written inside every treelet
export const InternalTreeletTopLeftPtr = 0;
export const InternalTreeletTopRightPtr = 1;

// calculates how many nodes will be in a tree of the specified depth
export const treeletNodeCountFromDepth = (depth) => {
    return 2**(depth + 1) - 2;
}

// generates a treelet of fixed depth
// returns the nodes and cells buffers for this treelet
export function generateTreelet(mesh, cellCount, box, treeletRootDepth, treeletDepth, nodePtrOffset, slotNum) {
    const meshRename = {
        cellConnectivity: mesh.cellConnectivity,
        cellOffsets: mesh.cellOffsets,
        points: mesh.positions,
    };

    const nodeCount = treeletNodeCountFromDepth(treeletDepth);
    const nodesBuff = new ArrayBuffer(nodeCount * NODE_BYTE_LENGTH);

    let rootSplitVal;
    let topLeftPtr;
    let topRightPtr;

    let cells = [];
    for (let i = 0; i < cellCount; i++) {
        cells.push(i);
    }

    const nodes = [{
        depth: treeletRootDepth,
        splitVal: null,
        thisPtr: null,
        cells: cells,
        box: box
    }];

    const leafNodes = [];

    let index = nodePtrOffset;

    while (nodes.length > 0) {
        const currNode = nodes.pop();
        if (treeletDepth + treeletRootDepth == currNode.depth) {
            // tree shouldn't go any deeper here
            leafNodes.push(currNode);
            continue;
        }

        // find the split
        currNode.splitVal = (currNode.box.min[currNode.depth%3] + currNode.box.max[currNode.depth%3])/2;

        // separate cells into left and right nodes
        let leftCells = [];
        let rightCells = [];
        for (let cellID of currNode.cells) {
            const [leftCheck, rightCheck] = checkCellPosition(meshRename, cellID, currNode.depth%3, currNode.splitVal);
            if (leftCheck) leftCells.push(cellID);
            if (rightCheck) rightCells.push(cellID);
        }

        currNode.cells = null;

        const leftPtr = index++;
        const rightPtr = index++;

        
        if (currNode.thisPtr === null) {
            // this is the root node, save the calculated split val
            rootSplitVal = currNode.splitVal;
            topLeftPtr = leftPtr;
            topRightPtr = rightPtr;
        } else {
            // write the new split val into node and set cellCount to 0
            writeNodeToBuffer(
                nodesBuff, 
                (currNode.thisPtr - nodePtrOffset) * NODE_BYTE_LENGTH, 
                currNode.splitVal,
                0, 
                null, 
                leftPtr, 
                rightPtr
            );
        }

        // write left and right nodes
        // const leftBox = {
        //     min: [...currNode.box.min],
        //     max: [...currNode.box.max],
        // };
        const leftBox = copyBox(currNode.box);
        leftBox.max[currNode.depth%3] = currNode.splitVal;
        const leftNode = {
            box: leftBox,
            depth: currNode.depth + 1,
            thisPtr: leftPtr,
            cells: leftCells,
        }
        // write in as a leaf node and increment i
        writeNodeToBuffer(nodesBuff, (leftPtr - nodePtrOffset) * NODE_BYTE_LENGTH, 0, leftNode.cells.length, slotNum, 0, 0);
        nodes.unshift(leftNode);
        
        // const rightBox = {
        //     min: [...currNode.box.min],
        //     max: [...currNode.box.max],
        // };
        const rightBox = copyBox(currNode.box);
        rightBox.min[currNode.depth%3] = currNode.splitVal;
        const rightNode = {
            box: rightBox,
            depth: currNode.depth + 1,
            thisPtr: rightPtr,
            cells: rightCells
        }
        // write in as a leaf node and increment i
        writeNodeToBuffer(nodesBuff, (rightPtr - nodePtrOffset) * NODE_BYTE_LENGTH, 0, rightNode.cells.length, slotNum, 0, 0);
        nodes.unshift(rightNode);
    }

    // pack the cell numbers for the treelets leaf nodes into a new buffer
    // write the locations of these cell number sections into these nodes
    // leftPtr -> location within this slot
    // parentPtr -> slotNum
    const cellsArr = [];
    for (let node of leafNodes) {
        writeNodeToBuffer(
            nodesBuff, 
            (node.thisPtr - nodePtrOffset) * NODE_BYTE_LENGTH, 
            null, 
            node.cells.length, 
            slotNum, 
            cellsArr.length, 
            0
        );
        cellsArr.push(...node.cells);
    }

    const cellsBuff = new Uint32Array(cellsArr);

    
    // return the split value that should be written 
    return {
        nodes: nodesBuff,
        cells: cellsBuff,
        rootSplitVal
    }
}