// meshCache.js

import { boxesOverlap, boxVolume } from "../utils.js";
import { AssociativeCache, ScoredCacheManager } from "./cache.js";
import { getMeshExtentBox, NODE_BYTE_LENGTH, readNodeFromBuffer } from "./cellTreeUtils.js";
import { generateTreelet, InternalTreeletTopLeftPtr, InternalTreeletTopRightPtr, treeletNodeCountFromDepth } from "./treelet.js";

// implements a cache object for storing mesh data in block format
export class MeshCache {
    #cache;
    #treeletDepth;

    #treeletNodesPerSlot;

    constructor(blockSizes, blockCount, treeletDepth = 4) {
        this.#treeletDepth = treeletDepth;
        const cacheObj = new AssociativeCache(blockCount);
    
        // mesh buffers
        cacheObj.createBuffer("positions", Float32Array, blockSizes.positions);
        cacheObj.createBuffer("cellOffsets", Uint32Array, blockSizes.cellOffsets);
        cacheObj.createBuffer("cellConnectivity", Uint32Array, blockSizes.cellConnectivity);

        if (this.#treeletDepth > 0) {
            // treelet buffers
            this.#treeletNodesPerSlot = treeletNodeCountFromDepth(this.#treeletDepth);
            cacheObj.createBuffer("treeletNodes", Uint8Array, this.#treeletNodesPerSlot * NODE_BYTE_LENGTH);
            cacheObj.createBuffer("treeletCells", Uint32Array, Math.round(blockSizes.cellOffsets), true); // initial guess at 1.5x
            cacheObj.createBuffer("treeletRootSplit", Float32Array, 1); // track where the treelet parent nodes should split
        }
        
        this.#cache = new ScoredCacheManager(cacheObj);
    }

    get blockSizes() {
        return this.#cache.blockSizes;
    }

    #shouldScoreBeLoaded(score) {
        const worstScore = this.#cache.getWorstScore().val;
        // score too low, dont load
        return worstScore < score
    }

    #loadNodeMesh(nodeCache, node, fullNode, mesh) {
        // load new mesh data
        const loadResult = this.#cache.insertNewBlock(node.score, node.thisFullPtr, mesh);
    
        if (this.#treeletDepth > 0) {
            // generate the treelet for this mesh
            const nodePtrOffset = nodeCache.slotCount + loadResult.slot * this.#treeletNodesPerSlot;
            // debugger;
            const treelet = generateTreelet(
                mesh, 
                fullNode.cellCount, 
                node.box, 
                node.depth, 
                this.#treeletDepth, 
                nodePtrOffset, 
                loadResult.slot
            );
            this.#cache.updateBlockAt(loadResult.slot, {
                "treeletNodes": new Uint8Array(treelet.nodes),
                "treeletCells": treelet.cells,
                "treeletRootSplit": [treelet.rootSplitVal]
            });
            // debugger;
        }

        // check if the evicted block is currently loaded in the dynamic node cache
        if (undefined != loadResult.evicted) {
            const evictedTagNodeSlot = nodeCache.getTagSlotNum(loadResult.evicted);
            if (-1 != evictedTagNodeSlot) {
                // it is loaded, make sure that it becomes a pruned leaf with no cells
                // have to make sure the ptrs are set to indicate a leaf node too
                nodeCache.updateBlockAt(evictedTagNodeSlot, {"nodes": {
                    cellCount: 0,
                    leftPtr: 0,
                    rightPtr: 0,
                }});
            }
        }
    
        return loadResult.slot;     
    }

    updateLoadedBlocks(nodeCache, getMeshBlockFunc, fullNodes, scores, activeValueSlots) {
        for (let node of scores) {
            if (node.rightPtr != 0) continue;
            // node is a leaf in dynamic tree
            const fullNode = readNodeFromBuffer(fullNodes, node.thisFullPtr * NODE_BYTE_LENGTH);
            if (fullNode.rightPtr != 0) continue;
            // this is a true leaf
    
            if (node.cellCount > 0) continue;
            // node is not connected with its mesh block

            let blockIndex = this.#cache.getTagSlotNum(node.thisFullPtr);
            if (-1 == blockIndex) {
                // not already loaded

                if (!this.#shouldScoreBeLoaded(node.score)) continue;
                // score high enough to load

                // load the mesh data, evict if necessary
                const mesh = getMeshBlockFunc(node.thisFullPtr, activeValueSlots);
                blockIndex = this.#loadNodeMesh(nodeCache, node, fullNode, mesh);

                if (-1 == blockIndex) continue;
                // node's mesh is now present in the dynamic mesh cache
            }

            if (this.#treeletDepth > 0) {
                // link tree node to the treelet
                // const nodePtrOffset = nodeCache.blockSizes["nodes"]/NODE_BYTE_LENGTH + blockIndex * this.#treeletNodesPerSlot
                const nodePtrOffset = nodeCache.slotCount + blockIndex * this.#treeletNodesPerSlot
                const treeletLeftPtr = nodePtrOffset + InternalTreeletTopLeftPtr;
                const treeletRightPtr = nodePtrOffset + InternalTreeletTopRightPtr;

                // retrieve the treelet root split val
                const rootSplitVal = this.#cache.readBuffSlotAt("treeletRootSplit", blockIndex)[0];
                nodeCache.updateBlockAt(node.thisPtr, {
                    "nodes": {
                        splitVal: rootSplitVal,
                        cellCount: 0, 
                        leftPtr: treeletLeftPtr, 
                        rightPtr: treeletRightPtr
                    }
                });
                // debugger;
                console.log("loaded node treelet");
            } else {
                // link tree node directly to cells
                nodeCache.updateBlockAt(node.thisPtr, {
                    "nodes": {cellCount: fullNode.cellCount, leftPtr: blockIndex}
                });

            }
    
        }
    }

    updateScores(scores) {
        // create a map from full pointer -> node score
        const fullPtrScoreMap = new Map();
        for (let node of scores) {
            fullPtrScoreMap.set(node.thisFullPtr, node.score);
        }
        // update the mesh cache with the node scores
        // if a node is not in the dynamic tree and thus the scores list, the score is set to -inf
        this.#cache.syncScores(fullPtr => 
            fullPtrScoreMap.get(fullPtr) ?? Number.NEGATIVE_INFINITY
        );
    }

    updateValuesBuff(getMeshBlockFuncExt, slotNum) {
        const buffName = "values" + slotNum; 
        if (!this.#cache.getBuffers()[buffName] ) {
            // create if not present
            this.#cache.createBuffer(buffName, Float32Array, this.#cache.blockSizes.positions/3);
        }

        // make sure that the corner buffer is synchronised to the currently loaded nodes
        this.#cache.syncBuffer(
            buffName, 
            (fullPtr) => {
                const meshBlock = getMeshBlockFuncExt(fullPtr, [slotNum]);
                return meshBlock[buffName];
            }
        );
        
        return this.#cache.getBuffers()[buffName];
    }

    getBuffers() {
        return this.#cache.getBuffers();
    }
}