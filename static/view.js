// view.js
// handles the creation of view objects, their management and deletion

import { get, show, isVisible, toRads, newId, timer } from "./core/utils.js";
import { VecMath } from "./core/VecMath.js";
import {mat4} from 'https://cdn.skypack.dev/gl-matrix';

import { Axes, SceneGraph } from "./core/renderEngine/sceneObjects.js";
// import { marcherManager } from "./core/renderEngine/webGL/marcher.js";

import { SceneObjectRenderModes } from "./core/renderEngine/sceneObjects.js";
import { RenderableTypes } from "./core/renderEngine/renderEngine.js";
import { DataFormats, dataManager } from "./core/data/data.js";



export var viewManager = {
    
    maxViews: 30,
    // an object to hold all views that have been created
    views: {},
    moreViewsAllowed: function() {
        return Object.keys(this.views).length < this.maxViews;
    },
    createView: async function(config, renderEngine) {    
        // some linking is working
    
        //check to see if there is already the max amount of views
        if (!this.moreViewsAllowed()) {
            console.log("sorry, max views reached");
            return false;
        }
    
        // check if the mesh, data and camera objects are supplied
        var camera = config.camera;
        var data = config.data;
        dataManager.addUser(data);    

        // generate id
        const id = newId(this.views);
        var newView = new View(id, camera, data, config.renderMode, (data.limits[0] + data.limits[1])/2);
        this.createViewDOM(id, newView);
        this.setupDOMEventHandlers(newView, renderEngine);
        this.appendDOM(newView);
        newView.init(renderEngine);
        this.views[id] = newView;
        return newView;
    },
    createViewDOM: function(id, view) {
        // clone the proto node
        var viewContainer = get("view-container-proto").cloneNode(true);
        viewContainer.id = id;

        // look through the DOM to find the functional elements
        var slider =    viewContainer.getElementsByClassName("view-threshold")?.[0];
        var frame =     viewContainer.getElementsByClassName("view-frame")?.[0];
        var closeBtn =  viewContainer.getElementsByClassName("view-close")?.[0];
        var dataName =  viewContainer.getElementsByClassName("view-dataset-name")?.[0];
        var dataSize =  viewContainer.getElementsByClassName("view-dataset-size")?.[0];
        var threshVal = viewContainer.getElementsByClassName("view-threshold-value")?.[0];

        // add references to these in the view
        view.elems.container = viewContainer;
        view.elems.slider = slider;
        view.elems.frame = frame;
        view.elems.closeBtn = closeBtn;
        view.elems.dataName = dataName;
        view.elems.dataSize = dataSize;
        view.elems.threshVal = threshVal;

        // populate dataset info
        dataName.innerText = view.data.getName();
        var datasetSize = view.data.getDataSize();
        if (datasetSize && dataSize) dataSize.innerText = datasetSize[0] + "x" + datasetSize[1] + "x" + datasetSize[2];

        if (view.data.dataFormat == DataFormats.UNSTRUCTURED) dataSize.innerText += "u";

        slider.min = view.data.limits[0]; // Math.max(view.data.limits[0], 0);
        slider.max = view.data.limits[1];
        slider.step = (view.data.limits[1] - view.data.limits[0]) / 200;

        slider.value = (view.data.limits[0] + view.data.limits[1]) / 2;
    }, 
    setupDOMEventHandlers: function(view, renderEngine) {
        if (view.elems.closeBtn) {
            view.elems.closeBtn.addEventListener("click", (e) => {
                this.deleteView(view, renderEngine);
            });
            view.elems.closeBtn.addEventListener("mousedown", (e) => {
                e.stopPropagation();
            });
        }
        

        // set event listeners for the elements
        const shiftFac = 0.5;
        view.elems.frame.addEventListener("mousedown", (e) => {
            if (view.elems.frame.requestPointerLock) {
                view.elems.frame.requestPointerLock();
            }
            if (e.ctrlKey) {
                // pan
                view.camera.startMove(e.movementX, e.movementY, 0, "pan");
            } else if (e.altKey) {
                // dolly forward/back
                view.camera.startMove(0, 0, e.movementY, "dolly");
            } else {
                // rotate
                view.camera.startMove(e.movementX, e.movementY, 0, "orbit");
            }
        });
        view.elems.frame.addEventListener("mousemove", (e) => {
            var x = e.movementX;
            var y = e.movementY;
            if (e.shiftKey) {
                x *= shiftFac;
                y *= shiftFac;
            }
            if (e.ctrlKey) {
                // pan
                view.camera.move(x, y, 0, "pan");
            } else if (e.altKey) {
                // dolly forward/back
                view.camera.move(0, 0, y, "dolly");
            } else {
                // rotate
                view.camera.move(x, y, 0, "orbit");
            }
        });
        view.elems.frame.addEventListener("mouseup", (e) => {
            if (document.exitPointerLock) {
                document.exitPointerLock();
            }
            view.camera.endMove();
        });
        view.elems.frame.addEventListener("mouseleave", (e) => {
            view.camera.endMove();
        });
        view.elems.frame.addEventListener("wheel", (e) => {
            e.preventDefault();
            view.camera.changeDist(e.deltaY);
        });
        view.elems.slider.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        })
        view.elems.slider.addEventListener("input", (e) => {
            view.updateThreshold(parseFloat(e.target.value), false);
        });

        // might want another event listener for when the frame element is moved or resized 
        // to update view.box        
    },
    appendDOM: function(view) {
        get("view-container-container").appendChild(view.elems.container);
        show(view.elems.container);
    },

    deleteView: function(view, renderEngine) {
        this.views?.[view.id].delete(renderEngine);

        delete this.views[view.id];
        if(get("add-view-container")) show(get("add-view-container"));
    },

    update: function(dt, marchingCubesEngine) {
        for (let key in this.views) {
            this.views[key].update(dt, marchingCubesEngine);
        }
    },
    
}

function View(id, camera, data, renderMode, threshold) {
    this.id = id;

    this.sceneGraph = new SceneGraph();
    this.camera = camera;
    this.data = data;

    this.threshold = threshold;
    this.thresholdChanged = true;
    this.marchedThreshold = undefined;
    this.renderMode = renderMode;

    // holds all the important DOM elements for this view
    this.elems = {}
    this.box = {};
    this.init = function(renderEngine) {
        // setup camera position
        camera.setProjMat();
        camera.setStartPosition(data.getMidPoint(), 1*data.getMaxLength(), 0, 0);
        camera.moveToStart();
        // define what rendering type will be performed on dataset object
        this.data.renderMode |= SceneObjectRenderModes.DATA_RAY_VOLUME;
        this.data.renderMode |= SceneObjectRenderModes.BOUNDING_WIREFRAME;
        // setup the scene
        this.sceneGraph.insertChild(this.camera, undefined, true);
        this.sceneGraph.insertChild(this.data);
        this.sceneGraph.insertChild(new Axes(10));
        
        for (let sceneObj of this.sceneGraph.traverseSceneObjects()) {
            renderEngine.setupSceneObject(sceneObj);
        }

        this.updateThreshold(this.threshold);
        
    }     
    this.updateThreshold = async function(val) {
        this.threshold = val;
        this.thresholdChanged = true;
        if (this.elems.threshVal) this.elems.threshVal.innerText = val.toPrecision(3);
    }
    this.didThresholdChange = function() {
        var changed = this.thresholdChanged;
        this.thresholdChanged = false;
        return changed;
    }
    this.update = async function (dt, renderEngine) {
        // propagate the threshold to where is it needed
        this.data.threshold = this.threshold;

        for (let renderable of this.data.renderables) {
            renderable.passData.threshold = this.threshold;
        }
    }
    this.getFrameElem = function() {
        return this.elems.frame;
    }
    this.getBox = function() {
        // find the box corresponding to the associated frame element
        // the box is relative to the window
        var rect = this.getFrameElem().getBoundingClientRect();
        this.box = rect;
        return rect;
    }
    this.delete = function(renderEngine) {
        // remove dom
        this.elems.container.remove();
        // clean up gpu data referenced in scene objects
        for (let sceneObj of this.sceneGraph.traverseSceneObjects()) {
            renderEngine.cleanupSceneObj(sceneObj);
        }
        // delete data
        dataManager.removeUser(this.data);
    }
}