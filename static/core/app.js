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

    #views = [];
    #renderEngine;
    #jobRunner;

    #frameTimeGraph;

    #lastFrameStart = 0;


    // options
    #maxViews;

    constructor(maxViews) {
        this.#maxViews = maxViews;

        this.#canvas = get("c");
        this.#frameTimeGraph = new FrameTimeGraph(get("frame-time-graph"), 100);
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
    
        async function createJobRunner() {
            // let jobJSON;
            // try {
            //     const res = await fetch("./clientJobs.json")
            //     jobJSON = await res.json();
            // } catch (e) {
            //     console.error("Could not get job file: " + e);
            //     jobJSON = null;
            // }
            // return JobRunner(jobJSON, this.createView, this.deleteView, this.#renderEngine);
        }
        let datasets;
        [this.#renderEngine, datasets, this.#jobRunner] = await Promise.all([
            createRenderEngine(this.#canvas), 
            setupDataManager(), 
            createJobRunner()
        ]);
    
        if (!this.#renderEngine || !datasets) throw Error("Could not initialise program");
        
        // successfully created all objects

        window.addEventListener("resize", this.#resizeCanvas);
        this.#resizeCanvas();

        // set up the available UI
        this.#setUpRayMarchOptions();
        this.#populateDataOptions();
        this.#populateKDTreeOptions();
        this.#populateCornerValOptions();
    }

    #setUpRayMarchOptions = () => {
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
    };

    #populateDataOptions() {
        var dataOptions = get("data-select");
        for (let id in dataManager.configSet) {
            var elem = document.createElement("OPTION");
            elem.value = id;                
            elem.innerText = dataManager.configSet[id].name;
            dataOptions.appendChild(elem);
        }
    };
    
    
    #populateKDTreeOptions() {
        var kdTreeOptions = get("kd-tree-type-select");
        for (let type in KDTreeSplitTypes) {
            var elem = document.createElement("OPTION");
            elem.value = KDTreeSplitTypes[type];                
            elem.innerText = type;
            kdTreeOptions.appendChild(elem);
        }
    };

    #populateCornerValOptions () {
        var cornerValOptions = get("corner-val-type-select");
        for (let type in CornerValTypes) {
            var elem = document.createElement("OPTION");
            elem.value = CornerValTypes[type];                
            elem.innerText = type;
            cornerValOptions.appendChild(elem);
        }
    };

    async createView(opts) {
        if (this.#views.length >= this.#maxViews) {
            throw Error("Unable to create view, max vount reached");
        }

        const id = Math.round(Math.random()*1024);
        
        const view = createView(
            id,
            {
                camera: new Camera(this.#canvas.width/this.#canvas.height),
                data: await dataManager.getDataObj(opts.dataID, opts.dataOpts),
                renderMode: opts.renderMode
            },
            this.#renderEngine
        );

        this.#views.push(view);

        return view;
    }

    deleteView(view) {
        const index = this.#views.findIndex(v => v.id == view.id);
        if (index == -1) return;

        view.delete();
        this.#views.splice(index, 1);
    }

    #resizeCanvas() {
        const canvasDims = setupCanvasDims(this.#canvas);
        // change camera aspect ratio
        this.#views[0]?.camera.setAspectRatio(canvasDims[0]/canvasDims[1]);
        this.#renderEngine.resizeRenderingContext();
    }

    async update() {
        const thisFrameStart = performance.now();
        const dt = thisFrameStart - this.#lastFrameStart;
        this.#lastFrameStart = thisFrameStart;
        
        this.#jobRunner?.update(thisFrameStart);

        // update widgets
        this.#frameTimeGraph.update(dt);
        
        // update views
        this.#views.forEach(view => view.update(dt, this.#renderEngine));
        
        // render views
        if (this.#views.length == 0) {
           this.#renderEngine.clearScreen();
        }
        this.#views.forEach(view => this.#renderEngine.renderView(view));
        
        frameInfoStore.nextFrame();
    }
}