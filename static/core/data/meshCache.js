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
            const treelet = generateTreelet(
                mesh, 
                fullNode.cellCount, 
                node.box, 
                node.depth, 
                this.#treeletDepth, 
                nodePtrOffset, 
                loadResult.slot
            );

            // load treelet into the mesh cache
            this.#cache.updateBlockAt(loadResult.slot, {
                "treeletNodes": new Uint8Array(treelet.nodes),
                "treeletCells": treelet.cells,
                "treeletRootSplit": [treelet.rootSplitVal]
            });
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

    async updateLoadedBlocks(nodeCache, getMeshBlocksFunc, fullNodes, scores, scalarNames) {
        let neededMeshBlocks = new Set();

        // collect a list of all blocks that need to be requested
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

                // write score and node index into the mesh cache (empty mesh)
                const loadResult = this.#cache.insertNewBlock(node.score, node.thisFullPtr, {});

                // add node index to neededBlocks
                neededMeshBlocks.add(node.thisFullPtr);

                if (undefined === loadResult.evicted) continue;
                // there was a mesh block replaced
                
                // if a block was evicted and in neededBlocks, remove it
                neededMeshBlocks.delete(loadResult.evicted);

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
        }

        if (0 == neededMeshBlocks.size) return;
        // some blocks need to be requested

        const neededMeshBlocksArr = Array.from(neededMeshBlocks);

        // request the needed blocks using supplied function
        const meshData = await getMeshBlocksFunc(neededMeshBlocksArr, true, scalarNames);

        // process received data and write into cache
        for (let meshBlockIndex of neededMeshBlocksArr) {
            
            // extract the mesh data from the response
            // load the mesh data into the cache
            const blockMeshCacheSlot = this.#cache.getTagSlotNum(meshBlockIndex);
            this.#cache.updateBlockAt(blockMeshCacheSlot, meshData[meshBlockIndex]);

            const blockNodeCacheSlot = nodeCache.getTagSlotNum(meshBlockIndex);


            // build treelets if needed
            if (this.#treeletDepth > 0) {
                // link tree node to the treelet
                const nodePtrOffset = nodeCache.slotCount + blockMeshCacheSlot * this.#treeletNodesPerSlot
                const treeletLeftPtr = nodePtrOffset + InternalTreeletTopLeftPtr;
                const treeletRightPtr = nodePtrOffset + InternalTreeletTopRightPtr;

                // retrieve the treelet root split val
                const rootSplitVal = this.#cache.readBuffSlotAt("treeletRootSplit", blockMeshCacheSlot)[0];
                
                nodeCache.updateBlockAt(blockNodeCacheSlot, {
                    "nodes": {
                        splitVal: rootSplitVal,
                        cellCount: 0, 
                        leftPtr: treeletLeftPtr, 
                        rightPtr: treeletRightPtr
                    }
                });
            } else {
                const fullNode = readNodeFromBuffer(fullNodes, meshBlockIndex * NODE_BYTE_LENGTH);
                // link tree node directly to cells
                nodeCache.updateBlockAt(blockNodeCacheSlot, {
                    "nodes": {cellCount: fullNode.cellCount, leftPtr: blockMeshCacheSlot}
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