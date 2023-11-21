// view.js
// handles the creation of view objects, their management and deletion

import { get, show, isVisible, toRads, newId, timer } from "./core/utils.js";
import { VecMath } from "./core/VecMath.js";
import {mat4} from 'https://cdn.skypack.dev/gl-matrix';

import { cameraManager, RenderableObject, RenderableObjectTypes } from "./core/renderEngine/sceneObjects.js";
import { marcherManager } from "./core/renderEngine/webGL/marcher.js";

import {renderModes} from "./core/renderEngine/renderEngine.js";



export var viewManager = {
    
    maxViews: 30,
    // an object to hold all views that have been created
    views: {},
    initialThreshold: 10,
    moreViewsAllowed: function() {
        return Object.keys(this.views).length < this.maxViews;
    },
    createView: async function(config) {    
        // some linking is working
    
        //check to see if there is already the max amount of views
        if (!this.moreViewsAllowed()) {
            console.log("sorry, max views reached");
            return false;
        }
    
        // check if the mesh, data and camera objects are supplied
        var camera = config.camera;
        var data = config.data;

        // var marcher = await marcherManager.create(data); // FOR NOW CREATE NEW FOR EACH VIEW
        var marcher;
        

        const modelMat = mat4.create();
        // mat4.rotateX(modelMat, modelMat, toRads(-90));
        // mat4.translate(modelMat, modelMat, VecMath.scalMult(-1, data.midPoint));

        // camera.setModelMat(modelMat);
        camera.setProjMat();
        camera.setDist(1*data.getMaxLength());
        camera.setTarget(data.getMidPoint());

        // register a new user of the used objects
        cameraManager.addUser(camera);
        // marcherManager.addUser(marcher);


        // generate id
        const id = newId(this.views);
        var newView = new this.View(id, camera, data, config.renderMode || renderModes.ISO_SURFACE, (data.limits[0] + data.limits[1])/2);
        this.createViewDOM(id, newView);
        this.views[id] = newView;
        return newView;
    },
    createViewDOM: function(id, view) {
        // clone the proto node
        var viewContainer = get("view-container-proto").cloneNode(true);
        viewContainer.id = id;

        var slider = viewContainer.getElementsByTagName("INPUT")[0];
        var frame = viewContainer.getElementsByTagName("DIV")[0];
        var closeBtn = viewContainer.getElementsByTagName("BUTTON")[0];

        slider.min = view.data.limits[0]; // Math.max(view.data.limits[0], 0);
        slider.max = view.data.limits[1];
        slider.step = (view.data.limits[1] - view.data.limits[0]) / 200;

        slider.value = (view.data.limits[0] + view.data.limits[1]) / 2;

        closeBtn.onclick = () => {
            this.deleteView(view);
        }

        // set event listeners for the elements
        const shiftFac = 0.5;
        frame.onmousedown = function(e) {
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
        };
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
        slider.oninput = function() {
            view.updateThreshold(parseFloat(this.value), false);
        };
        slider.onmouseup = function() {
            view.updateThreshold(parseFloat(this.value), true);
        }


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
    // render: function(gl) {
    //     // clear the whole screen at the start
    //     clearScreen(gl);
    //     // call the render functions of all currently active views
    //     for (let key in this.views) {
    //         this.views[key].render(gl);
    //     }
    //     if (Object.keys(this.views).length == 0) {
    //         clearScreen(gl);
    //     }
    // },

    update: function(dt, marchingCubesEngine) {
        for (let key in this.views) {
            this.views[key].update(dt, marchingCubesEngine);
        }
    },
    View: function(id, camera, data, renderMode, threshold) {
        this.id = id;

        this.scene = [];
        this.dataRenderObj;


        this.camera = camera;

        this.data = data;

        this.threshold = threshold;
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
        this.init = function() {
            // setup the scene
            var cameraRenderObj = new RenderableObject(RenderableObjectTypes.CAMERA, this.camera);
            this.dataRenderObj = new RenderableObject(RenderableObjectTypes.DATA, this.data);
            var axesRenderObj = new RenderableObject(RenderableObjectTypes.MESH);

            // set the render mode, default is iso surface
            this.dataRenderObj.renderMode = renderModes.RAY_SURFACE;
            
            this.scene.push(cameraRenderObj, this.dataRenderObj);

            console.log(this.scene)
            
            // do the correct type of initialisation based upon the rendering mode
            if (this.renderMode == renderModes.DATA_POINTS) {
                // transfer the points from the data object to the mesh
                this.marcher.transferPointsToMesh();
            } else if (this.renderMode == renderModes.ISO_SURFACE ||this.renderMode == renderModes.ISO_POINTS) {
                this.updateThreshold(this.threshold, true);
            }            
        }     
        this.updateThreshold = async function(val, fine) {
            this.threshold = val;
        }
        this.update = async function (dt, marchingCubesEngine) {
            // only update the mesh if marching is needed
            if (this.dataRenderObj.renderMode == renderModes.DATA_POINTS) return;

            this.dataRenderObj.renderData.threshold = this.threshold;

            

            // if (this.)
            // if (this.marchedThreshold != this.threshold) {
            //     this.marchedThreshold = this.threshold;
            //     // march if threshold has changed
            //     //var meshObj = this.marcher.march(this.threshold, marchingCubesEngine);
                
            // }
            
            // if (fine && this.marcher.complex) {
            //     console.log("fine")
            //     this.marcher.marchFine(this.threshold);
            // } else {
            //     this.marcher.march(this.threshold);
            // }
        }
        this.getFrameElem = function() {
            return get(this.id).children[0];
        }
        this.getViewContainer = function() {
            return get(this.id);
        }
        this.getBox = function() {
            // find the box corresponding to the associated frame element
            // the box is relative to the canvas element
            var rect = this.getFrameElem().getBoundingClientRect();
            var canvasRect = get("c").getBoundingClientRect();
            this.box.left = rect.left - canvasRect.left;// + window.scrollX;
            this.box.top = rect.top - canvasRect.top;
            this.box.right = window.innerWidth + canvasRect.left - rect.right;
            this.box.bottom = window.innerHeight + canvasRect.top - rect.bottom// - window.scrollY;
            this.box.width = rect.width;
            this.box.height = rect.width;

            return this.box;
        }
        // this.render = function(gl) {
        //     this.marcher.renderMesh(gl, this.camera.projMat, this.camera.getModelViewMat(), this.getBox(), this.renderMode);
        // }
        this.delete = function() {
            // remove dom
            this.getViewContainer().remove();
            // deregister from camera
            cameraManager.removeUser(this.camera);
            // deregister from marcher
            marcherManager.removeUser(this.marcher);
        }

        // call the init function
        this.init();
    }
}