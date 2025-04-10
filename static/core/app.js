// app.js
// provides a single, unified class to handle the program
import {get, getClass, getInputClassAsObj, isVisible, show, hide, setupCanvasDims, downloadObject, downloadCanvas, frameInfoStore, newId} from "./utils.js";

import { DataFormats } from "./data/dataConstants.js";
import { dataManager } from "./data/data.js";
import { createRenderEngine } from "./renderEngine/renderEngine.js";
import { createView } from "./view/view.js";
import { Camera, SceneObjectRenderModes } from "./renderEngine/sceneObjects.js";
import { FrameTimeGraph } from "./widgets.js";
import { KDTreeSplitTypes } from "./data/cellTree.js";
import { CornerValTypes } from "./data/treeNodeValues.js";

import { VecMath } from "./VecMath.js"
import { JobRunner } from "./benchmark.js";


export class App {
    #canvas;

    /** @type {View[]} */
    #views = [];
    #renderEngine;
    #jobRunner;

    #frameTimeGraph;

    #lastFrameStart = 0;


    // options
    #maxViews;
    #verbose;

    constructor(canvas, opts) {
        const {maxViews=1, frametimeCanvas=null, verbose=false} = opts;
        this.#canvas = canvas;
        this.#maxViews = maxViews;
        this.#verbose = verbose;

        if (frametimeCanvas) {
            this.#frameTimeGraph = new FrameTimeGraph(frametimeCanvas, 100);
        }
    }

    async init() {
        async function setupDataManager() {
            let datasetsJSON;
    
            try {
                const res = await fetch("./data/datasets.json");
                datasetsJSON = await res.json();
                dataManager.setConfigSet(datasetsJSON);
            } catch (e) {
                console.error("Could not get datasets: " + reason);
                datasetsJSON = null;
            }
            
            return datasetsJSON
        }
    
        let datasets;
        [this.#renderEngine, datasets] = await Promise.all([
            createRenderEngine(this.#canvas, this.#verbose), 
            setupDataManager()
        ]);
    
        if (!this.#renderEngine || !datasets) throw Error("Could not initialise program");
        // created necessary objects

        this.#setupRayMarchOpts();
    }

    
    #setupRayMarchOpts() {
        for (let elem of getClass("ray-march-opt")) {
            elem.checked = this.#renderEngine.rayMarcher.getPassFlag(elem.name);
            elem.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                return false;
            });
            elem.addEventListener("click", (e) => {
                this.#renderEngine.rayMarcher.setPassFlag(elem.name, elem.checked);
            });
        }
    }

    get dataConfigs() {
        return dataManager.configSet;
    }

    get viewCount() {
        return this.#views.length;
    }

    getViewStates() {
        let states = [];
        for (let view of this.#views) {
            states.push({
                camera: view.camera.getVals(),
                threshold: view.getThreshold()
            });
        }

        return states;
    }

    getGPUResourcesString() {
        return this.#renderEngine.getWebGPU().getResourcesString();
    }

    resetCameras() {
        this.#views.forEach(view => view.camera.moveToStart());
    }

    toggleDynamicDatasetUpdates() {
        this.#views.forEach(view => view.updateDynamicTree = !view.updateDynamicTree);
    }

    viewFocusToMouse() {
        for (let view of this.#views) {
            if (!view.focussed) return;
            // TODO re-implement this
            // view.targetToMouse();
            // const d = await renderEngine.rayMarcher.getRayLengthAt(mousePos.x, mousePos.y);
            // if (!d) return;
            // const tex = renderEngine.rayMarcher.offsetOptimisationTextureOld;
            // const camCoords = {x: mousePos.x/tex.width * 2 - 1, y: mousePos.y/tex.height * 2 - 1};
            // const camera = Object.values(viewManager.views)[0].camera;
            // const newTarget = camera.getWorldSpaceFromClipAndDist(camCoords.x, camCoords.y, d);
    
            // camera.setTarget(newTarget);

        }
    }


    async createView(opts) {
        if (this.#views.length >= this.#maxViews) {
            throw Error("Unable to create view, max vount reached");
        }

        const id = Math.round(Math.random()*1024);
        
        const view = createView(
            id,
            {
                camera: new Camera(),
                data: await dataManager.getDataObj(opts.dataID, opts.dataOpts),
                renderMode: opts.renderMode
            },
            this.#renderEngine
        );

        this.#views.push(view);

        return view;
    }

    #removeDeletedViews() {
        const aliveViews = [];
        for (let view of this.#views) {
            if (true === view.deleted) continue;

            aliveViews.push(view);
        }

        this.#views = aliveViews;
    }

    startJobs() {
        this.#jobRunner.start(performance.now())
    }

    async update() {
        const thisFrameStart = performance.now();
        const dt = thisFrameStart - this.#lastFrameStart;
        this.#lastFrameStart = thisFrameStart;

        // update widgets
        this.#frameTimeGraph?.update(dt);

        // remove any deleted views
        this.#removeDeletedViews();
        
        // update views
        for (let view of this.#views) {
            await view.update(dt, this.#renderEngine);
        }
        
        // render views
        if (this.#views.length == 0) {
           this.#renderEngine.clearScreen();
        }

        for (let view of this.#views) {
            await this.#renderEngine.renderView(view)
        }
        
        frameInfoStore.nextFrame();
    }
}