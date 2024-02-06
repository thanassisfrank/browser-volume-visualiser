// view.js
// handles the creation of view objects, their management and deletion

import { get, show, isVisible, toRads, newId, timer } from "./core/utils.js";
import { VecMath } from "./core/VecMath.js";
import {mat4} from 'https://cdn.skypack.dev/gl-matrix';

import { Axes, SceneGraph } from "./core/renderEngine/sceneObjects.js";
// import { marcherManager } from "./core/renderEngine/webGL/marcher.js";

import { SceneObjectRenderModes } from "./core/renderEngine/sceneObjects.js";
import { RenderableTypes } from "./core/renderEngine/renderEngine.js";



export var viewManager = {
    
    maxViews: 30,
    // an object to hold all views that have been created
    views: {},
    initialThreshold: 10,
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

        // generate id
        const id = newId(this.views);
        var newView = new this.View(id, camera, data, config.renderMode, (data.limits[0] + data.limits[1])/2);
        newView.init(renderEngine);
        this.createViewDOM(id, newView);
        this.views[id] = newView;
        return newView;
    },
    createViewDOM: function(id, view) {
        // clone the proto node
        var viewContainer = get("view-container-proto").cloneNode(true);
        viewContainer.id = id;

        var slider = viewContainer.getElementsByClassName("threshold")[0];
        var frame = viewContainer.getElementsByClassName("frame")[0];
        var closeBtn = viewContainer.getElementsByClassName("close")?.[0];

        slider.min = view.data.limits[0]; // Math.max(view.data.limits[0], 0);
        slider.max = view.data.limits[1];
        slider.step = (view.data.limits[1] - view.data.limits[0]) / 200;

        slider.value = (view.data.limits[0] + view.data.limits[1]) / 2;

        if (closeBtn) {
            closeBtn.onclick = () => {
                this.deleteView(view);
            }
        }
        

        // set event listeners for the elements
        const shiftFac = 0.5;
        frame.addEventListener("mousedown", (e) => {
            if (frame.requestPointerLock) {
                frame.requestPointerLock();
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
        frame.onmousemove = function(e) {
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
        };
        frame.onmouseup = function(e) {
            if (document.exitPointerLock) {
                document.exitPointerLock();
            }
            view.camera.endMove();
        };
        frame.onmouseleave = function(e) {
            view.camera.endMove();
        };
        frame.onwheel = function(e) {
            e.preventDefault();
            view.camera.changeDist(e.deltaY);
        };
        slider.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        })
        slider.addEventListener("input", (e) => {
            view.updateThreshold(parseFloat(e.target.value), false);
        });


        // might want another event listener for when the frame element is moved or resized 
        // to update view.box

        get("view-container-container").appendChild(viewContainer);
        show(viewContainer);

    }, 
    deleteView: function(view) {
        // hide the window
        if (isVisible(get("add-view-popup"))) get("add-view").click();

        this.views?.[view.id].delete();

        delete this.views[view.id];
    },

    update: function(dt, marchingCubesEngine) {
        for (let key in this.views) {
            this.views[key].update(dt, marchingCubesEngine);
        }
    },
    View: function(id, camera, data, renderMode, threshold) {
        this.id = id;

        this.sceneGraph = new SceneGraph();
        this.camera = camera;
        this.data = data;

        this.threshold = threshold;
        this.thresholdChanged = true;
        this.marchedThreshold = undefined;
        this.renderMode = renderMode;
        // holds a timer that waits for a little while after the threshold has stopped changing
        // then generates a fine mesh
        this.fineTimer = {
            // timer itself
            timer: undefined,
            // time to fire in ms
            duration: 1000
        }
        this.box = {};
        this.init = function(renderEngine) {
            // setup camera position
            camera.setProjMat();
            camera.setStartPosition(data.getMidPoint(), 1*data.getMaxLength(), 0, 0);
            camera.moveToStart();

            // camera.setTh(9);
            // camera.setPhi(4)
            // camera.setDist(79);
            // camera.setTarget([126.45763133939798, 104.17004882299433, 59.497677321611484]);
            // this.updateThreshold(237.15);

            // camera.setTh(-88.75);
            // camera.setPhi(-41.75)
            // camera.setDist(31.499999999999932);
            // camera.setTarget([79.89939025552015, 114.19461663327571, 142.63685822729508]);
            // this.updateThreshold(7.7);

            // camera.setDist(150);
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

            
        }     
        this.updateThreshold = async function(val, fine) {
            this.threshold = val;
            this.thresholdChanged = true;
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
                // if (renderable.type == RenderableTypes.DATA) {
                // }
            }
        }
        this.getFrameElem = function() {
            return get(this.id).getElementsByClassName("frame")[0];
        }
        this.getViewContainer = function() {
            return get(this.id);
        }
        this.getBox = function() {
            // find the box corresponding to the associated frame element
            // the box is relative to the window
            var rect = this.getFrameElem().getBoundingClientRect();
            this.box = rect;
            return rect;
        }
        this.delete = function() {
            // remove dom
            this.getViewContainer().remove();
            // deregister from camera
            cameraManager.removeUser(this.camera);
            // deregister from marcher
            // marcherManager.removeUser(this.marcher);
        }
    }
}