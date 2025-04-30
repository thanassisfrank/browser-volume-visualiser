// app.js
// provides a single, unified class to handle the program
import {getClass, frameInfoStore, downloadCanvas} from "./utils.js";

import { DataManager } from "./data/data.js";
import { createRenderEngine } from "./renderEngine/renderEngine.js";
import { createView, View } from "./view/view.js";
import { Camera } from "./renderEngine/camera.js";
import { FrameTimeGraph } from "./widgets.js";

// expose view render modes from here
export { RenderModes } from "./view/view.js";
// expose data source types from here
export { DataSrcTypes } from "./renderEngine/renderEngine.js";


/** Class representing the application */
export class App {
    /** @type {HTMLCanvasElement} */
    #canvas;

    /** @type {View[]} */
    #views = [];
    #renderEngine;
    /** @type {DataManager} */
    #dataManager;
    /** @type {FrameTimeGraph} */
    #frameTimeGraph;
    /** @type {Number} */
    #lastFrameStart = 0;


    // Options
    /** @type {Number} */
    #maxViews;
    /** @type {Boolean} */
    #verbose;

    /**
     * Creates an App
     * @param {HTMLCanvasElement} canvas The canvas used for drawing
     * @param {*} opts Options object for setting other features
     */
    constructor(canvas, opts={}) {
        const {maxViews=1, frametimeCanvas=null, verbose=false} = opts;
        this.#canvas = canvas;
        this.#maxViews = maxViews;
        this.#verbose = verbose;

        if (frametimeCanvas) {
            this.#frameTimeGraph = new FrameTimeGraph(frametimeCanvas, 100);
        }
    }

    /**
     * Initialises the app including creating necessary objects. 
     * @throws Will throw if initialisation could not be completed
     */
    async init() {
        async function createDataManager() {
            try {
                const res = await fetch("./data/datasets.json");
                return new DataManager(await res.json());
            } catch (e) {
                console.error("Could not get datasets: " + reason);
            }
        }
    
        [this.#renderEngine, this.#dataManager] = await Promise.all([
            createRenderEngine(this.#canvas, this.#verbose), 
            createDataManager()
        ]);
    
        if (!this.#renderEngine || !this.#dataManager) throw Error("Could not initialise program");
        // created necessary objects

        this.#setupRayMarchOpts();
    }

    /**
     * Sets up any checkboxes on the page with class `ray-march-opt` to affect ray marcher 
     */
    #setupRayMarchOpts() {
        for (let elem of getClass("ray-march-opt")) {
            elem.checked = this.#renderEngine.rayMarcher.getPassFlag(elem.name);
            elem.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                return false;
            });
            elem.addEventListener("click", (e) => {
                this.setRenderFlag(elem.name, elem.checked);
            });
        }
    }
    
    /**
     * Retrieves the datasets currently available to load
     */
    get dataConfigs() {
        return this.#dataManager.getConfigs();
    }

    /**
     * Retrieves the current number of views
     */
    get viewCount() {
        return this.#views.length;
    }

    /**
     * Gets the camera and threshold states of all views
     * @returns The current camera position and threshold value for all views
     */
    getViewStates() {
        let states = [];
        for (let view of this.#views) {
            states.push({
                camera: view.camera.getVals(),
                threshold: view.getInput("threshold")
            });
        }

        return states;
    }

    /**
     * Sets the value of a flag within the render engine
     * @param {String} name The flag identifier
     * @param {Boolean} val The flag value
     */
    setRenderFlag(name, val) {
        this.#renderEngine.rayMarcher.setPassFlag(name, val);
    }

    /**
     * Gets a representation of the resource use on the GPU as a printable string
     * @returns {String} Resource info string pretty-formatted
     */
    getGPUResourcesString() {
        return this.#renderEngine.getWebGPU().getResourcesString();
    }

    /**
     * Download the canvas as a PNG
     * @param {String} filename Filename for saved image
     */
    saveCanvasImagePNG(filename) {
        let fullFilename = filename;
        if (!fullFilename.endsWith(".png")) {
            fullFilename += ".png";
        }
        downloadCanvas(this.#canvas, fullFilename, "image/png")
    }

    /**
     * Moves the camera for each view back to its starting point
     */
    resetCameras() {
        this.#views.forEach(view => view.camera.moveToStart());
    }

    /**
     * Toggles the updating of dynamic datasets for all views
     */
    toggleDynamicDatasetUpdates() {
        this.#views.forEach(view => view.updateDynamicTree = !view.updateDynamicTree);
    }

    /**
     * Moves the camera target of the currently focussed view to the mouse position
     * @todo Implement functionality
     */
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

    /**
     * Creates and returns a new view object, tracking it internally
     * @async
     * @param {*} opts Options for the new view object
     * @returns {View} The new view object
     */
    async createView(opts) {
        if (this.#views.length >= this.#maxViews) {
            throw Error("Unable to create view, max view count reached");
        }

        const id = Math.round(Math.random()*1024);
        
        const view = await createView(
            id,
            {
                camera: new Camera(),
                data: await this.#dataManager.createData(opts.dataID, opts.dataOpts),
                renderMode: opts.renderMode
            },
            this.#renderEngine
        );

        this.#views.push(view);

        return view;
    }

    /**
     * Removes the views marked internally as deleted from the record
     */
    #removeDeletedViews() {
        const aliveViews = [];
        for (let view of this.#views) {
            if (view.deleted) continue;

            aliveViews.push(view);
        }

        this.#views = aliveViews;
    }

    /**
     * Updates and renders all of the current views
     */
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
            await this.#renderEngine.renderScene(view.scene, view.camera, view.getBox());
        }
        
        frameInfoStore.nextFrame();
    }
}