// dynamicMesh.js
// class for handling a mesh that is updated with leaf scores

import { MeshCache } from "../cache/meshCache.js";

import { downloadObject, frameInfoStore, StopWatch } from "../../utils.js";


export class DynamicMesh {
    /** @type {MeshCache} */
    #meshCache;

    #busy = false;

    treeletDepth;
    usesTreelets;

    constructor(blockSizes, leafBlockCount, treeletDepth) {
        this.treeletDepth = treeletDepth;
        this.usesTreelets = treeletDepth > 0;

        this.#meshCache = new MeshCache(blockSizes, leafBlockCount, this.treeletDepth);
    }
    // run when a new data array is selected
    // creates a version of the dynamic mesh value array with the same blocks loaded in the same positions as the
    // dynamic mesh buffers for the mesh geometry
    // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
    createValueArray(getMeshBlockFuncExt, scalarName) {
        return this.#meshCache.updateValuesBuff(getMeshBlockFuncExt, scalarName);
    }

    // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
    async update(leafScores, nodeCache, fullNodes, getMeshBlockFuncExt, activeValueNames) {
        if (this.#busy) return;
        this.#busy = true;
        const meshUpdateSW = new StopWatch();
        // const meshCacheTimeStart = performance.now();
        this.#meshCache.updateScores(leafScores);
        // update the mesh blocks that are loaded in the cache
        await this.#meshCache.updateLoadedBlocks(
            nodeCache, 
            undefined,
            getMeshBlockFuncExt, 
            fullNodes, 
            leafScores, 
            activeValueNames, 
            meshUpdateSW
        )
        
        frameInfoStore.add("mesh_update", meshUpdateSW.stop());
        this.#busy = false;
    }

    getBuffers() {
        return this.#meshCache.getBuffers();
    }

    getBlockSizes() {
        return this.#meshCache.blockSizes;
    }

    getTreeCells() {
        return this.#meshCache.getBuffers()["treeletCells"];
    }

    getTreeletBuffer() {
        return this.#meshCache.getBuffers()["treeletNodes"];
    }
}