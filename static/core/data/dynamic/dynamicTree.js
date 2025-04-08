// dynamicTree.js
// contains functions to create, update and manage dynamic tree nodes and dynamic unstructured mesh data

import { NODE_BYTE_LENGTH, writeNodeToBuffer, readNodeFromBuffer, processLeafMeshDataInfo } from "../cellTreeUtils.js";
import { writeCornerVals, readCornerVals } from "../treeNodeValues.js";
import { AssociativeCache, ScoredCacheManager } from "../cache/cache.js";
import { downloadObject, frameInfoStore, StopWatch } from "../../utils.js";


const NodeStates = {
    NONE: 0,
    MERGED: 1,
    SPLIT: 2,
};


export class DynamicTree {
    /** @type {AssociativeCache} */
    nodeCache;
    /** @type {ArrayBuffer} */
    fullNodes;
    /** @type {ArrayBuffer} */
    renderNodes;

    #dataSource;

    // max number of nodes to attempt to merge/split in one iteration
    #modifyListLength = 20;
    #modifyListLengthFact = 0.005;

    #hysteresis;

    constructor(dataSource, dynamicNodeCount, opts) {
        this.#dataSource = dataSource;
        const { depthFirst=false, hysteresis=true } = opts;
        this.#hysteresis = hysteresis;
        
        this.#createDynamicNodeCache(dataSource.tree.nodes, dynamicNodeCount, depthFirst);
    }

    // create the buffers used for dynamic data resolution
    // fills dynamic nodes from full nodes breadth first
    #createDynamicNodeCache(fullNodes, maxNodes, depthFirst=false) {
        this.fullNodes = fullNodes
        this.#modifyListLength = maxNodes * this.#modifyListLengthFact;
        // set up the cache object for the dynamic nodes
        this.nodeCache = new AssociativeCache(maxNodes);
        this.nodeCache.createBuffer("state", Uint8Array, 1);
        this.nodeCache.createBuffer("nodes", ArrayBuffer, NODE_BYTE_LENGTH);
        this.nodeCache.setReadFunc("nodes", (buff, slotNum, blockSize) => {
            return readNodeFromBuffer(buff, slotNum * blockSize);
        });
        this.nodeCache.setWriteFunc("nodes", (buff, data, slotNum, blockSize) => {
            writeNodeToBuffer(
                buff, 
                slotNum * blockSize, 
                data.splitVal ?? null,
                data.cellCount ?? null,
                data.parentPtr ?? null,
                data.leftPtr ?? null,
                data.rightPtr ?? null
            );
        });


        // fill the dynamic buffer from the full tree buffer, breadth first
        let i = 0; // where to write the next node

        const rootNode = readNodeFromBuffer(fullNodes, 0);

        this.nodeCache.insertNewBlockAt(0, rootNode.thisPtr, {
            "nodes": {splitVal: rootNode.splitVal, cellCount: 0, parentPtr: 0, leftPtr: 0, rightPtr: 0}
        });

        i += 1;

        // current leaves in the dynamic tree that have children in the full tree
        let nodePtrs = [{full: 0, dynamic: 0}];

        while (nodePtrs.length > 0 && i < maxNodes - 2) {
            const ptrs = nodePtrs.pop();
            const fullNode = readNodeFromBuffer(fullNodes, ptrs.full * NODE_BYTE_LENGTH);

            const leftNode = readNodeFromBuffer(fullNodes, fullNode.leftPtr * NODE_BYTE_LENGTH);
            const rightNode = readNodeFromBuffer(fullNodes, fullNode.rightPtr * NODE_BYTE_LENGTH);

            const leftPtr = i;
            const rightPtr = i + 1;

            // update i
            i += 2;
            
            // update parent with pointers to children
            this.nodeCache.updateBlockAt(ptrs.dynamic, {
                "nodes": {leftPtr, rightPtr}
            });
            
            // write left to dynamic as pruned leaf
            this.nodeCache.insertNewBlockAt(leftPtr, leftNode.thisPtr, {
                "nodes": {splitVal: leftNode.splitVal, cellCount: 0, parentPtr: ptrs.dynamic, leftPtr: 0, rightPtr: 0}
            });

            // write right to dynamic as pruned leaf
            this.nodeCache.insertNewBlockAt(rightPtr, rightNode.thisPtr, {
                "nodes": {splitVal: rightNode.splitVal, cellCount: 0, parentPtr: ptrs.dynamic, leftPtr: 0, rightPtr: 0}
            });
            
            // check if left and right have children
            if (depthFirst) {
                if (leftNode.rightPtr != 0) nodePtrs.push({full: leftNode.thisPtr, dynamic: leftPtr});
                if (rightNode.rightPtr != 0) nodePtrs.push({full: rightNode.thisPtr, dynamic: rightPtr});
            } else {
                if (leftNode.rightPtr != 0) nodePtrs.unshift({full: leftNode.thisPtr, dynamic: leftPtr});
                if (rightNode.rightPtr != 0) nodePtrs.unshift({full: rightNode.thisPtr, dynamic: rightPtr});
            }
        }

        return this.nodeCache;
    }

    // creates or modifies the dynamic corner values buffer 
    // agnostic to samples vs poly
    // extends the cache object used for dynamic nodes
    createMatchedDynamicCornerValues(scalarName) {
        const fullCornerValues = this.#dataSource.getDataArray({name: scalarName})?.cornerValues;
        // return;
        if (!fullCornerValues) {
            throw Error("Unable to generate dynamic corner values, full corner values does not exist for scalar " + scalarName);
        }
            
        const buffName = scalarName; 
        if (!this.nodeCache.getBuffers()[buffName] ) {
            // create if not present
            this.nodeCache.createBuffer(buffName, Float32Array, 8);
        }

        // make sure that the corner buffer is synchronised to the currently loaded nodes
        // dataObj.dynamicNodeCache.syncBuffer(buffName, (fullPtr) => readCornerVals(fullCornerValues, fullPtr));
        this.nodeCache.syncBuffer(buffName, (fullPtr) => readCornerVals(fullCornerValues, fullPtr));
        
        return this.nodeCache.getBuffers()[buffName];
    }

    // takes the full scores list and returns a list of nodes to split and a list to merge
    // these will have length equal to count
    // the split list contains pruned leaves that should be split
    // the merge list contains leaves that should be merged with their siblings
    #createMergeSplitLists(scores) {
        // proportion of the scores to search for nodes to split and merge
        // combats flickering 
        const searchProp = 1;
        var mergeList = [];
        var splitList = [];

        // dual thresholding for hysteresis
        const splitThreshold = Number.NEGATIVE_INFINITY;
        const mergeThreshold = Number.POSITIVE_INFINITY;

        let currNode, currFullNode;

        let lowestSplitIndex = scores.length - 1;
        // create the split list first
        for (let i = scores.length - 1; i >= Math.max(0, scores.length * (1 - searchProp)); i--) {
            if (splitList.length >= this.#modifyListLength) break;
            currNode = scores[i];
            if (currNode.score < splitThreshold) break;
            currFullNode = readNodeFromBuffer(this.fullNodes, (currNode.thisFullPtr ?? 0) * NODE_BYTE_LENGTH);
            // can't be split if its a true leaf
            if (currFullNode.rightPtr == 0) continue;
            // can't be split if previously merged
            if (this.#hysteresis && NodeStates.MERGED == currNode.state) continue;

            // passed all checks
            splitList.push(currNode);
            lowestSplitIndex = i;
        }

        // create merge list
        // only go up to the lowest split index to prevent nodes included in both
        let highestMergeIndex = 0;
        for (let i = 0; i < Math.min(lowestSplitIndex, scores.length * searchProp); i++) {
            // check if we have enough
            if (mergeList.length >= this.#modifyListLength) break;
            currNode = scores[i];
            if (currNode.score > mergeThreshold) break;
            // can't be merged if sibling not a leaf
            if (!currNode.bothSiblingsLeaves) continue;
            // check if sibling is in split list
            // check if the same parent appears there
            if (splitList.some(x => x.parentPtr == currNode.parentPtr)) continue;
            // check if sibling is already in merge list
            if (mergeList.some(x => x.parentPtr == currNode.parentPtr)) continue;
            // can't be merged if previously split
            if (this.#hysteresis && NodeStates.SPLIT == currNode.state) continue;

            // passed all checks
            mergeList.push(currNode);
            highestMergeIndex = i;
        }

        return {
            merge: mergeList,
            split: splitList
        };
    };
    
    #updateDynamicNodeCache(cornerVals, mergeSplit, noCells) {
        // find the amount of changes we can now make
        const changeCount = Math.min(mergeSplit.merge.length, mergeSplit.split.length);
    
        // merge the leaves with the highest scores with their siblings (delete 2 per change)
        var freePtrs = [];
        for (let i = 0; i < changeCount; i++) {
            var parentNode = this.nodeCache.readBuffSlotAt("nodes", mergeSplit.merge[i].parentPtr);
            freePtrs.push(parentNode.leftPtr, parentNode.rightPtr);
            // convert the parentNode to a pruned leaf
            this.nodeCache.updateBlockAt(mergeSplit.merge[i].parentPtr, {
                "nodes": {leftPtr: 0, rightPtr: 0},
                "state": [NodeStates.MERGED]
            });
        }
    
        // split the leaves with the lowest scores (write 2 per change)
        for (let i = 0; i < freePtrs.length/2; i++) {
            var thisNode = mergeSplit.split[i];
            var thisNodeFull = readNodeFromBuffer(this.fullNodes, thisNode.thisFullPtr * NODE_BYTE_LENGTH);
            // update node to branch
            this.nodeCache.updateBlockAt(thisNode.thisPtr, {
                "nodes": {splitVal: thisNodeFull.splitVal, cellCount: 0, leftPtr: freePtrs[2*i], rightPtr: freePtrs[2*i + 1]}
            });
    
            const childPtrs = [thisNodeFull.leftPtr, thisNodeFull.rightPtr];
            for (let j = 0; j < 2; j++) {
                const childNode = readNodeFromBuffer(this.fullNodes, childPtrs[j] * NODE_BYTE_LENGTH);
                // write in as a pruned leaf
                const newData = {
                    "nodes": {
                        splitVal: childNode.splitVal, 
                        cellCount: noCells ? 0 : childNode.cellCount, 
                        parentPtr: thisNode.thisPtr, 
                        leftPtr: noCells ? 0 : childNode.leftPtr, 
                        rightPtr: 0
                    },
                    "state": NodeStates.SPLIT
                };
                
                for (let name in cornerVals) {
                    newData[name] = readCornerVals(cornerVals[name], childNode.thisPtr)
                }
    
                this.nodeCache.insertNewBlockAt(freePtrs[2*i + j], childNode.thisPtr, newData);
            }
        }
    };


    resetUpdateStates() {
        this.nodeCache.syncBuffer("state", tag => {return [NodeStates.NONE]});
    }

    // this handles updating the dynamic nodes
    update(leafScores, activeValueNames, dynamicCells) {     
        const nodeUpdateSW = new StopWatch();

        // update node cache
        const mergeSplitLists = this.#createMergeSplitLists(leafScores);

        const nodeModifications = Math.min(
            mergeSplitLists.merge.length, 
            mergeSplitLists.split.length
        );

        const cornerVals = {};

        for (let name of activeValueNames) {
            cornerVals[name] = this.#dataSource.getDataArray({name}).cornerValues;
        }
        
        // update the dynamic buffer contents
        this.#updateDynamicNodeCache(cornerVals, mergeSplitLists, dynamicCells);  

        frameInfoStore.add("nodes_modified", nodeModifications);
        frameInfoStore.add("node_update", nodeUpdateSW.stop());
    }

    // concatenate the render nodes and treelet nodes buffers
    getNodeBuffer() {
        return this.nodeCache.getBuffers()["nodes"];
    }

    getCornerValues(scalarName) {
        return this.nodeCache.getBuffers()[scalarName];
    }
}