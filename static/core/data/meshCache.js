// meshCache.js

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
            cacheObj.createBuffer("treeletCells", Uint32Array, Math.round(blockSizes.cellOffsets), true); // initial guess
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

    #loadNodeMeshes(nodesToRequest, meshData) {
        // process received data and write into cache
        for (let [fullPtr, node] of nodesToRequest) {
            // load the mesh data into the cache
            this.#cache.updateBlockAt(node.meshCacheSlot, meshData[fullPtr]);
        }
    }

    #loadNodeMeshesTreelet(nodesToRequest, meshData, nodeCacheSlotCount) {
        // process received data and write into cache
        for (let [fullPtr, node] of nodesToRequest) {
            const nodePtrOffset = nodeCacheSlotCount + node.meshCacheSlot * this.#treeletNodesPerSlot;

            const treelet = generateTreelet(
                meshData[fullPtr], 
                node.fullCellCount, 
                node.box, 
                node.depth, 
                this.#treeletDepth, 
                nodePtrOffset, 
                node.meshCacheSlot
            );

            this.#cache.updateBlockAt(node.meshCacheSlot, {
                ...(meshData[fullPtr]),
                "treeletNodes": new Uint8Array(treelet.nodes),
                "treeletCells": treelet.cells,
                "treeletRootSplit": [treelet.rootSplitVal]
            });  
        }
    }

    #linkNodeMeshes(nodesToLink, nodeCache) {
        for (let [fullPtr, node] of nodesToLink) {
            // link tree node directly to cells
            nodeCache.updateBlockAt(node.thisPtr, {
                "nodes": {cellCount: node.fullCellCount, leftPtr: node.meshCacheSlot}
            });
        }
    }

    #linkNodeMeshesTreelet(nodesToLink, nodeCache) {
        for (let [fullPtr, node] of nodesToLink) {
            // link tree node to the treelet
            const nodePtrOffset = nodeCache.slotCount + node.meshCacheSlot * this.#treeletNodesPerSlot;
            const leftPtr = nodePtrOffset + InternalTreeletTopLeftPtr;
            const rightPtr = nodePtrOffset + InternalTreeletTopRightPtr;

            // get the treelet root split val from the mesh cache
            const splitVal = this.#cache.readBuffSlotAt("treeletRootSplit", node.meshCacheSlot)[0];

            nodeCache.updateBlockAt(node.thisPtr, {
                "nodes": {
                    splitVal,
                    cellCount: 0, 
                    leftPtr, 
                    rightPtr,
                }
            });
        }
    }


    /**
     * Updates the dynamic mesh cache to contain the mesh corresponding to the true leaf nodes with the highest scores
     * @param {AssociativeCache} nodeCache 
     * @param {(ptrList : Number[], geometry : Boolean, scalarList : String[])=>Promise<Map<Number,Object>>} getMeshBlocksFunc 
     * @param {ArrayBuffer} fullNodes 
     * @param {Object[]} scores A list of leaf nodes within the dynamic tree
     * @param {String[]} scalarNames 
     * @returns 
     */
    async updateLoadedBlocks(nodeCache, getMeshBlocksFunc, fullNodes, scores, scalarNames) {
        // map of fullptr -> node obj for nodes that will be linked with their mesh
        let nodesToLink = new Map();
        // map of fullPtr -> node obj for nodes that will be requested from server
        let nodesToRequest = new Map();

        // collect a list of all blocks that need to be requested
        for (let node of scores) {
            const fullNode = readNodeFromBuffer(fullNodes, node.thisFullPtr * NODE_BYTE_LENGTH);
            if (fullNode.rightPtr != 0) continue;
            // this is a true leaf
    
            if (
                this.#treeletDepth > 0 && node.rightPtr > 0 || 
                this.#treeletDepth == 0 && node.cellCount > 0
            ) continue;
            // node is not connected with its mesh block

            // cache the full cell count for later loading
            node.fullCellCount = fullNode.cellCount;

            let blockIndex = this.#cache.getTagSlotNum(node.thisFullPtr);
            if (-1 != blockIndex) {
                node.meshCacheSlot = blockIndex;
                nodesToLink.set(node.thisFullPtr, node);
                continue;
            }
            // not already loaded

            if (!this.#shouldScoreBeLoaded(node.score)) continue;
            // score high enough to load

            // write score and node index into the mesh cache (empty record)
            const loadResult = this.#cache.insertNewBlock(node.score, node.thisFullPtr, {});

            if (-1 == loadResult.slot) continue;
            // node successfully put into cache
            
            // remember node for later
            node.meshCacheSlot = loadResult.slot;
            nodesToLink.set(node.thisFullPtr, node);
            nodesToRequest.set(node.thisFullPtr, node);

            if (undefined === loadResult.evicted) continue;
            // there was a mesh block replaced
            
            // if a block was evicted and remembered, forget it
            nodesToLink.delete(loadResult.evicted);
            nodesToRequest.delete(loadResult.evicted);

            const evictedTagNodeSlot = nodeCache.getTagSlotNum(loadResult.evicted);
            if (-1 == evictedTagNodeSlot) continue;
            // it is loaded, make sure that it becomes a pruned leaf with no cells
            // have to make sure the ptrs are set to indicate a leaf node too
            nodeCache.updateBlockAt(evictedTagNodeSlot, {"nodes": {
                cellCount: 0,
                leftPtr: 0,
                rightPtr: 0,
            }});
        }

        if (nodesToRequest.size > 0) {
            const meshData = await getMeshBlocksFunc(Array.from(nodesToRequest.keys()), true, scalarNames);
            if (this.#treeletDepth > 0) {
                this.#loadNodeMeshesTreelet(nodesToRequest, meshData, nodeCache.slotCount);
            } else {
                this.#loadNodeMeshes(nodesToRequest, meshData);
            }
        }
        
        if (nodesToLink.size > 0) {
            if (this.#treeletDepth > 0) {
                this.#linkNodeMeshesTreelet(nodesToLink, nodeCache);
            } else {
                this.#linkNodeMeshes(nodesToLink, nodeCache);
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

    async updateValuesBuff(getMeshBlocksFunc, scalarName) {
        const buffName = scalarName; 
        if (!this.#cache.getBuffers()[buffName] ) {
            // create if not present
            this.#cache.createBuffer(buffName, Float32Array, this.#cache.blockSizes.positions/3);
        }

        // request the scalar data for all of the blocks 
        const nodeIndices = Array.from(this.#cache.directory.keys());
        const meshData = await getMeshBlocksFunc(nodeIndices, false, [scalarName]);

        // make sure that the corner buffer is synchronised to the currently loaded nodes
        this.#cache.syncBuffer(
            buffName, (fullPtr) => meshData[fullPtr][scalarName]
        );
        
        return this.#cache.getBuffers()[buffName];
    }

    getBuffers() {
        return this.#cache.getBuffers();
    }
}