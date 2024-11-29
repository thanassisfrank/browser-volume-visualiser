// meshCache.js

import { boxesOverlap, boxVolume } from "../utils.js";
import { AssociativeCache, ScoredCacheManager } from "./cache.js";
import { getMeshExtentBox, NODE_BYTE_LENGTH, readNodeFromBuffer } from "./cellTreeUtils.js";
import { generateTreelet, treeletNodeCountFromDepth } from "./treelet.js";

// implements a cache object for storing mesh data in block format
export class MeshCache {
    #cache;
    #treeletDepth = 4;

    constructor(blockSizes, blockCount) {
        const cacheObj = new AssociativeCache(blockCount);
    
        // mesh buffers
        cacheObj.createBuffer("positions", Float32Array, blockSizes.positions);
        cacheObj.createBuffer("cellOffsets", Uint32Array, blockSizes.cellOffsets);
        cacheObj.createBuffer("cellConnectivity", Uint32Array, blockSizes.cellConnectivity);

        // treelet buffers
        cacheObj.createBuffer("treeletNodes", Uint8Array, treeletNodeCountFromDepth(this.#treeletDepth) * NODE_BYTE_LENGTH);
        
        this.#cache = new ScoredCacheManager(cacheObj);
    }

    #shouldScoreBeLoaded(score) {
        const worstScore = this.#cache.getWorstScore().val;
        // score too low, dont load
        return worstScore < score
    }

    #loadNodeMesh(nodeCache, node, fullNode, mesh) {
        
        // load new mesh data
        const loadResult = this.#cache.insertNewBlock(node.score, node.thisFullPtr, mesh);
    
        // generate the treelet for this mesh
        // TODO: calculate the node pointer offset
        const nodePtrOffset = 0;
        // debugger;
        const treelet = generateTreelet(mesh, fullNode.cellCount, node.box, node.depth, 4, nodePtrOffset, loadResult.slot);
        this.#cache.updateBlockAt(loadResult.slot, {
            "treeletNodes": new Uint8Array(treelet.nodes)
        });

        if (fullNode.cellCount == treelet.cells.length) {
            console.log("wrong");
            console.log(fullNode.thisPtr, treelet.cells.length);
            const meshBox = getMeshExtentBox(mesh);
            console.log(node.box, meshBox);
            console.log(boxesOverlap(node.box, meshBox), boxVolume(node.box), boxVolume(meshBox));
        } else {
            console.log("fine");
        }

        // check if the evicted block is currently loaded in the dynamic node cache
        if (undefined != loadResult.evicted) {
            const evictedTagNodeSlot = nodeCache.getTagSlotNum(loadResult.evicted);
            if (-1 != evictedTagNodeSlot) {
                // it is loaded, make sure that if it is currently a leaf, it becomes a pruned leaf with no cells
                nodeCache.updateBlockAt(evictedTagNodeSlot, {"nodes": {cellCount: 0}});
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
    
            // update node in the dynamic cache
            nodeCache.updateBlockAt(node.thisPtr, {
                "nodes": {cellCount: fullNode.cellCount, leftPtr: blockIndex}
            });
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