// meshCache.js

import { frameInfoStore, StopWatch } from "../utils.js";
import { AssociativeCache, ScoredCacheManager } from "./cache.js";
import { getMeshExtentBox, NODE_BYTE_LENGTH, readNodeFromBuffer, writeNodeToBuffer } from "./cellTreeUtils.js";
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
        const worstScore = this.#cache.getWorstScore();
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

    #loadNodeMeshesTreelet(nodesToRequest, meshData, nodeBufferCount) {
        // process received data and write into cache
        for (let [fullPtr, node] of nodesToRequest) {
            const nodePtrOffset = nodeBufferCount + node.meshCacheSlot * this.#treeletNodesPerSlot;

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

    #linkNodeMeshes(nodesToLink, dynamicNodeCache, writeNodes, useFullPtr) {
        for (let [fullPtr, node] of nodesToLink) {
            // link tree node directly to cells
            dynamicNodeCache.updateBlockAt(node.thisPtr, {
                "nodes": {cellCount: node.fullCellCount, leftPtr: node.meshCacheSlot}
            });
            if (useFullPtr) {
                writeNodeToBuffer(writeNodes, fullPtr * NODE_BYTE_LENGTH, null, node.fullCellCount, null, node.meshCacheSlot, null);
            } else {
                writeNodeToBuffer(writeNodes, node.thisPtr * NODE_BYTE_LENGTH, null, node.fullCellCount, null, node.meshCacheSlot, null);
            }
        }
    }

    #linkNodeMeshesTreelet(nodesToLink, dynamicNodeCache, writeNodes, useFullPtr) {
        for (let [fullPtr, node] of nodesToLink) {
            const splitVal = this.#cache.readBuffSlotAt("treeletRootSplit", node.meshCacheSlot)[0];
            // link tree node to the treelet in dynamic nodes
            const nodePtrOffset = dynamicNodeCache.slotCount + node.meshCacheSlot * this.#treeletNodesPerSlot;
            const leftPtr = nodePtrOffset + InternalTreeletTopLeftPtr;
            const rightPtr = nodePtrOffset + InternalTreeletTopRightPtr;

            // get the treelet root split val from the mesh cache

            dynamicNodeCache.updateBlockAt(node.thisPtr, {
                "nodes": {
                    splitVal,
                    cellCount: 0, 
                    leftPtr, 
                    rightPtr,
                }
            });

            // link render node to treelet
            const renderNodePtrOffset = writeNodes.byteLength/NODE_BYTE_LENGTH + node.meshCacheSlot * this.#treeletNodesPerSlot;
            const renderLeftPtr = renderNodePtrOffset + InternalTreeletTopLeftPtr;
            const renderRightPtr = renderNodePtrOffset + InternalTreeletTopRightPtr;
            if (useFullPtr) {
                writeNodeToBuffer(writeNodes, fullPtr * NODE_BYTE_LENGTH, splitVal, 0, null, renderLeftPtr, renderRightPtr);
            } else {
                writeNodeToBuffer(writeNodes, node.thisPtr * NODE_BYTE_LENGTH, splitVal, 0, null, renderLeftPtr, renderRightPtr);
            }
        }
    }


    /**
     * Updates the dynamic mesh cache to contain the mesh corresponding to the true leaf nodes with the highest scores
     * @param {AssociativeCache} nodeCache 
     * @param {ArrayBuffer} renderNodes 
     * @param {(ptrList : Number[], geometry : Boolean, scalarList : String[])=>Promise<Map<Number,Object>>} getMeshBlocksFunc 
     * @param {ArrayBuffer} fullNodes 
     * @param {Object[]} scores A list of leaf nodes within the dynamic tree
     * @param {String[]} scalarNames 
     * @param {StopWatch} sw 
     * @returns 
     */
    async updateLoadedBlocks(nodeCache, renderNodes, getMeshBlocksFunc, fullNodes, scores, scalarNames, sw) {
        // map of fullptr -> node obj for nodes that will be linked with their mesh
        let nodesToLink = new Map();
        // map of fullPtr -> node obj for nodes that will be requested from server
        let nodesToRequest = new Map();

        // the number of nodes in the tree that is being modified,
        // this is either the node buffer in nodeCache or a separate full node buffer supplied in renderNodes
        let writeNodesCount;
        if (renderNodes) {
            writeNodesCount = renderNodes.byteLength/NODE_BYTE_LENGTH;
        } else {
            writeNodesCount = nodeCache.slotCount;
        }
        const writeNodes = renderNodes ?? nodeCache.getBuffers()["nodes"];

        let currInUseMeshBlocks = 0;
        
        // collect a list of all blocks that need to be requested
        for (let node of scores) {
            const fullNode = readNodeFromBuffer(fullNodes, node.thisFullPtr * NODE_BYTE_LENGTH);
            if (fullNode.rightPtr != 0) continue;
            // this is a true leaf
    
            if (
                this.#treeletDepth > 0 && node.rightPtr > 0 || 
                this.#treeletDepth == 0 && node.cellCount > 0
            ) {
                currInUseMeshBlocks++;
                continue;
            }
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
            
            // if a block was evicted that was to be added this iteration, don't
            nodesToLink.delete(loadResult.evicted);
            nodesToRequest.delete(loadResult.evicted);

            
            // update dynamic nodes if needed
            const evictedTagNodeSlot = nodeCache.getTagSlotNum(loadResult.evicted);
            if (renderNodes !== undefined) {
                // update render nodes is needed
                writeNodeToBuffer(renderNodes, NODE_BYTE_LENGTH * loadResult.evicted, null, 0, null, 0, 0);
            }
            if (-1 == evictedTagNodeSlot) continue;
            // it is loaded, make sure that it becomes a pruned leaf with no cells
            // have to make sure the ptrs are set to indicate a leaf node too
            nodeCache.updateBlockAt(evictedTagNodeSlot, {"nodes": {
                cellCount: 0,
                leftPtr: 0,
                rightPtr: 0,
            }});
        }

        frameInfoStore.add("in_use_blocks", currInUseMeshBlocks);

        if (nodesToRequest.size > 0) {
            if (sw) sw.stop();
            const reqSW = new StopWatch()
            const meshData = await getMeshBlocksFunc(Array.from(nodesToRequest.keys()), true, scalarNames);
            frameInfoStore.add("new_blocks", nodesToRequest.size);
            frameInfoStore.add("server", reqSW.stop());
            if (sw) sw.start();

            const loadMeshesSW = new StopWatch();
            if (this.#treeletDepth > 0) {
                this.#loadNodeMeshesTreelet(nodesToRequest, meshData, writeNodesCount);
            } else {
                this.#loadNodeMeshes(nodesToRequest, meshData);
            }
            frameInfoStore.add("load_meshes", loadMeshesSW.stop());
        }
        
        const linkMeshesSW = new StopWatch();
        if (nodesToLink.size > 0) {
            if (this.#treeletDepth > 0) {
                this.#linkNodeMeshesTreelet(nodesToLink, nodeCache, writeNodes, renderNodes != undefined);
            } else {
                this.#linkNodeMeshes(nodesToLink, nodeCache, writeNodes, renderNodes != undefined);
            }
        }
        frameInfoStore.add("link_meshes", linkMeshesSW.stop());
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
            buffName, (fullPtr) => meshData[fullPtr]?.[scalarName]
        );
        
        return this.#cache.getBuffers()[buffName];
    }

    getBuffers() {
        return this.#cache.getBuffers();
    }
}