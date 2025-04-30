// dynamicMesh.js
// class for handling a mesh that is updated with leaf scores

import { MeshCache } from "../cache/meshCache.js";

import { frameInfoStore, StopWatch } from "../../utils/frameInfo.js";


export class DynamicMesh {
    /** @type {MeshCache} */
    #meshCache;

    #dataSource;

    #busy = false;

    treeletDepth;
    usesTreelets;

    constructor(dataSource, leafBlockCount, treeletDepth) {
        this.#dataSource = dataSource;
        this.treeletDepth = treeletDepth;
        this.usesTreelets = treeletDepth > 0;

        this.#meshCache = new MeshCache(this.#dataSource.meshBlockSizes, leafBlockCount, this.treeletDepth);
    }
    // run when a new data array is selected
    // creates a version of the dynamic mesh value array with the same blocks loaded in the same positions as the
    // dynamic mesh buffers for the mesh geometry
    createValueArray(scalarName) {
        return this.#meshCache.updateValuesBuff(
            this.#dataSource.getMeshBlocks.bind(this.#dataSource), 
            scalarName
        );
    }

    // getMeshBlockFuncExt -> dataObj.getNodeMeshBlock
    async update(leafScores, nodeCache, activeValueNames) {
        if (this.#busy) return;
        this.#busy = true;
        const meshUpdateSW = new StopWatch();
        // const meshCacheTimeStart = performance.now();
        this.#meshCache.updateScores(leafScores);
        // update the mesh blocks that are loaded in the cache
        await this.#meshCache.updateLoadedBlocks(
            nodeCache, 
            undefined,
            this.#dataSource.getMeshBlocks.bind(this.#dataSource), 
            this.#dataSource.tree.nodes, 
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