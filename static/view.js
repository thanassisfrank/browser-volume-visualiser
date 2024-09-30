// view.js
// handles the creation of view objects, their management and deletion

import { get, show, hide, isVisible, toRads, newId, timer, hexStringToRGBArray } from "./core/utils.js";

import { VecMath } from "./core/VecMath.js";

import { DataSrcTypes } from "./core/renderEngine/renderEngine.js";
import { Axes, SceneGraph } from "./core/renderEngine/sceneObjects.js";

import { DataFormats, dataManager, ResolutionModes } from "./core/data/data.js";
import { updateDynamicTreeBuffers } from "./core/data/cellTree.js";

import { FrameTimeGraph } from "./frameTimeGraph.js";
import { ColourScales } from "./core/renderEngine/webGPU/rayMarching/webGPURayMarching.js";



export var viewManager = {
    
    maxViews: 30,
    // an object to hold all views that have been created
    views: {},
    moreViewsAllowed: function() {
        return Object.keys(this.views).length < this.maxViews;
    },
    createView: async function(config, renderEngine) {    
        //check to see if there is already the max amount of views
        if (!this.moreViewsAllowed()) {
            console.log("sorry, max views reached");
            return false;
        }
    
        // check if the data and camera objects are supplied
        var camera = config.camera;
        var data = config.data;
        dataManager.addUser(data); 
        
        console.log(data);

        // generate id
        const id = newId(this.views);
        var newView = new View(id, camera, data, config.renderMode);
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
        var slider =       viewContainer.getElementsByClassName("view-threshold")?.[0];
        var frame =        viewContainer.getElementsByClassName("view-frame")?.[0];
        var closeBtn =     viewContainer.getElementsByClassName("view-close")?.[0];
        var dataName =     viewContainer.getElementsByClassName("view-dataset-name")?.[0];
        var dataSize =     viewContainer.getElementsByClassName("view-dataset-size")?.[0];
        var threshVal =    viewContainer.getElementsByClassName("view-threshold-value")?.[0];
        var densityGraph = viewContainer.getElementsByClassName("view-value-density")?.[0];
        // var nodeScores =   viewContainer.getElementsByClassName("view-node-scores")?.[0];
        var isoSurfaceSrc = viewContainer.getElementsByClassName("view-iso-surface-src-select")?.[0];
        var surfaceColSrc = viewContainer.getElementsByClassName("view-surface-col-src-select")?.[0];
        var colScale = viewContainer.getElementsByClassName("view-surface-col-scale-select")?.[0];

        var clipMinX = viewContainer.getElementsByClassName("view-clip-min-x")?.[0];
        var clipMaxX = viewContainer.getElementsByClassName("view-clip-max-x")?.[0];
        var clipMinY = viewContainer.getElementsByClassName("view-clip-min-y")?.[0];
        var clipMaxY = viewContainer.getElementsByClassName("view-clip-max-y")?.[0];
        var clipMinZ = viewContainer.getElementsByClassName("view-clip-min-z")?.[0];
        var clipMaxZ = viewContainer.getElementsByClassName("view-clip-max-z")?.[0];

        var volCols = viewContainer.getElementsByClassName("view-vol-col");
        var volOps = viewContainer.getElementsByClassName("view-vol-op");

        // add references to these in the view
        view.elems.container = viewContainer;
        view.elems.slider = slider;
        view.elems.frame = frame;
        view.elems.closeBtn = closeBtn;
        view.elems.dataName = dataName;
        view.elems.dataSize = dataSize;
        view.elems.threshVal = threshVal;
        view.elems.densityGraph = densityGraph;
        // view.elems.nodeScores = nodeScores;
        view.elems.isoSurfaceSrc = isoSurfaceSrc;
        view.elems.surfaceColSrc = surfaceColSrc;
        view.elems.colScale = colScale;
        view.elems.clip = {
            min: [clipMinX, clipMinY, clipMinZ],
            max: [clipMaxX, clipMaxY, clipMaxZ],
        };
        view.elems.volCol = volCols;
        view.elems.volOp = volOps;

        // populate dataset info
        if (dataName) dataName.innerText = view.data.getName();
        if (dataSize) dataSize.innerText = view.data.getDataSizeString();

        if (slider) {
            slider.style.width = "210px";
        } 

        for (let dataSrcType of Object.values(DataSrcTypes)) {
            var names = [""];
            if (dataSrcType == "Axis") names = ["x", "y", "z"];
            if (dataSrcType == "Data") names = view.data.getAvailableDataArrays();
            for (let dataSrcName of names) {
                var elem = document.createElement("OPTION");
                elem.dataset.dataSrcType = dataSrcType;     
                elem.dataset.dataSrcName = dataSrcName;   
                elem.innerText = dataSrcType + " " + dataSrcName;
                if (isoSurfaceSrc) isoSurfaceSrc.appendChild(elem.cloneNode(true));
                if (surfaceColSrc) surfaceColSrc.appendChild(elem);
            }
        }

        if (colScale) {
            for (let scale in ColourScales) {
                var elem = document.createElement("OPTION");
                elem.innerText = scale;
                elem.value = ColourScales[scale];     
                colScale.appendChild(elem);
            }
        }

        var dataExtent = view.data.extentBox;

        for (let i = 0; i < view.elems.clip.min.length; i++) {
            var elem = view.elems.clip.min[i];
            if (!elem) continue;
            elem.min = dataExtent.min[i];
            elem.max = dataExtent.max[i];
            elem.step = (dataExtent.max[i] - dataExtent.min[i])/1000;
            elem.value = dataExtent.min[i];
        }

        for (let i = 0; i < view.elems.clip.max.length; i++) {
            var elem = view.elems.clip.max[i];
            if (!elem) continue;
            elem.min = -dataExtent.max[i];
            elem.max = -dataExtent.min[i];
            elem.step = -(dataExtent.max[i] - dataExtent.min[i])/1000;
            elem.value = -dataExtent.max[i];
        }

        // initialise the volume transfer function
        for (let elem of view.elems.volCol) {
            view.volumeTransferFunction.colour[elem.dataset["transferIndex"]] = hexStringToRGBArray(elem.value);
        }

        for (let elem of view.elems.volOp) {
            view.volumeTransferFunction.opacity[elem.dataset["transferIndex"]] = elem.value;
        }
    }, 
    updateColScale: function(val, renderEngine) {
        renderEngine.rayMarcher.setColourScale(val);
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

        view.elems.isoSurfaceSrc.addEventListener("change", (e) => {
            var elem = e.target;
            var selected = elem.options[elem.selectedIndex];
            view.updateIsoSurfaceSrc(selected.dataset.dataSrcType, selected.dataset.dataSrcName);
        });
        view.elems.surfaceColSrc.addEventListener("change", (e) => {
            var elem = e.target;
            var selected = elem.options[elem.selectedIndex];
            view.updateSurfaceColSrc(selected.dataset.dataSrcType, selected.dataset.dataSrcName);
        });
        view.elems.colScale.addEventListener("change", (e) => {
            this.updateColScale(e.target.value, renderEngine);
        });


        // add event listeners for changing all the clip planes
        for (let i = 0; i < view.elems.clip.min.length; i++) {
            var elem = view.elems.clip.min[i];
            if (!elem) continue;
            elem.addEventListener("input", (e) => {
                view.clippedDataExtentBox.min[i] = e.target.value;
            });
        }

        for (let i = 0; i < view.elems.clip.max.length; i++) {
            var elem = view.elems.clip.max[i];
            if (!elem) continue;
            elem.addEventListener("input", (e) => {
                view.clippedDataExtentBox.max[i] = -1 * e.target.value;
            });
        }

        for (let elem of view.elems.volCol) {
            elem.addEventListener("change", (e) => {
                view.volumeTransferFunction.colour[e.target.dataset["transferIndex"]] = hexStringToRGBArray(e.target.value);
                console.log(view.volumeTransferFunction);
            });
        }
        
        for (let elem of view.elems.volOp) {
            elem.addEventListener("change", (e) => {
                view.volumeTransferFunction.opacity[e.target.dataset["transferIndex"]] = e.target.value;
            });
        }

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

    update: function(dt, renderEngine, cameraFollowPath) {
        for (let key in this.views) {
            this.views[key].update(dt, renderEngine, cameraFollowPath);
        }
    },
    
}

function View(id, camera, data, renderMode) {
    this.id = id;

    this.sceneGraph = new SceneGraph();
    this.camera = camera;
    this.data = data;

    this.threshold = undefined;
    this.thresholdChanged = true;
    this.marchedThreshold = undefined;

    // an estimate of where the viewer is actually focusing on
    this.adjustedFocusPoint = null;

    this.isoSurfaceSrc = {type: DataSrcTypes.NONE, limits: [0, 0], slotNum: null};
    this.surfaceColSrc = {type: DataSrcTypes.NONE, limits: [0, 0], slotNum: null};

    this.clippedDataExtentBox = structuredClone(this.data.extentBox);

    this.volumeTransferFunction = {
        colour:[],
        opacity:[]
    };

    this.renderMode = renderMode;

    this.updateDynamicTree = true;

    // holds all the important DOM elements for this view
    this.elems = {}
    this.box = {};



    this.init = function(renderEngine) {
        // setup camera position
        camera.setProjMat();
        camera.setStartPosition(data.getMidPoint(), data.getMaxLength(), 0, 0);

        this.updateIsoSurfaceSrc(this.isoSurfaceSrc.type, this.isoSurfaceSrc.name);
        this.updateSurfaceColSrc(this.surfaceColSrc.type, this.surfaceColSrc.name);

        switch (data.dataName) {
            case "Silicium":
                // camera.setStartPosition(data.getMidPoint(), 0.7*data.getMaxLength(), 0, 0);
                break;
            case "Turbulence":
                // camera.setStartPosition(data.getMidPoint(), 108, 0, -34.5);
                // camera.setTarget([0, 20.68874256329051, 0]);
                break;
            case "Engine":
                // camera.setStartPosition(data.getMidPoint(), 207, 48.5, -15);
                break;
            case "Magnetic":
                // camera.setStartPosition(data.getMidPoint(), 460, 0, 0);
                // camera.setStartPosition(data.getMidPoint(), 103, 180, 0);
                this.updateThreshold(1);
                break;
            case "YF17":
                camera.setStartPosition([-0.0066020588241111604, 2.85478458601422, 0.5043313350465203], 14.7, 180.75, -89);
                // this.updateThreshold(102022.3);
                break;
        }
        camera.moveToStart();
        // define what rendering type will be performed on dataset object
        this.data.renderMode = this.renderMode;
        //this.data.renderMode |= SceneObjectRenderModes.BOUNDING_WIREFRAME;
        // setup the scene
        this.sceneGraph.insertChild(this.camera, undefined, true);
        this.sceneGraph.insertChild(this.data);
        // this.sceneGraph.insertChild(new Axes(10));
        
        // setup the renderables
        for (let sceneObj of this.sceneGraph.traverseSceneObjects()) {
            renderEngine.setupSceneObject(sceneObj);
        }
        // updateDynamicTreeBuffers(this.data, 30, this.sceneGraph.activeCamera.getEyePos());
        console.log(this.sceneGraph.activeCamera.getEyePos());
        this.update(0, renderEngine);
        
    }     
    this.updateThreshold = async function(val) {
        this.elems.slider.value = val;
        this.threshold = val;
        this.thresholdChanged = true;
        if (this.elems.threshVal) this.elems.threshVal.innerText = val.toPrecision(3);
    }

    this.updateSlider = function(limits) {
        this.elems.slider.min = limits[0]; // Math.max(view.data.limits[0], 0);
        this.elems.slider.max = limits[1];
        this.elems.slider.step = (limits[1] - limits[0]) / 1000;

        this.updateThreshold((limits[0] + limits[1]) / 2);
    }

    this.updateDensityGraph = function(slotNum) {
        if (this.elems.densityGraph) {
            const binCount = 100;
            this.elems.densityGraph.width = binCount;
            this.elems.densityGraph.height = 20;
            var {counts, max} = this.data.getValueCounts(slotNum, binCount);
            var densityPlotter = new FrameTimeGraph(this.elems.densityGraph, Math.log10(max), true, true);
            for (let val of counts) {
                densityPlotter.update(Math.log10(val));
            }
        }
    }

    // called when
    this.updateIsoSurfaceSrc = async function(type, name) {
        console.log("iso " + type + " " + name);
        var limits = [0, 0];
        var slotNum = null;
        switch (type) {
            case DataSrcTypes.AXIS:
                if (name == "x") limits = [this.data.extentBox.min[0], this.data.extentBox.max[0]];
                if (name == "y") limits = [this.data.extentBox.min[1], this.data.extentBox.max[1]];
                if (name == "z") limits = [this.data.extentBox.min[2], this.data.extentBox.max[2]];
                hide(this.elems.densityGraph);
                break;
            case DataSrcTypes.DATA:
                // load data
                slotNum = await this.data.loadDataArray(name);
                if (slotNum == -1) return;
                // update the limits of slider
                limits = this.data.getLimits(slotNum);
                show(this.elems.densityGraph);
                this.updateDensityGraph(slotNum);
                // this.data.updateCornerValues(slotNum);
                break;
            default:
                hide(this.elems.densityGraph);
                break;
        }
        this.updateSlider(limits);
        // change the source
        this.isoSurfaceSrc = {type: type, name: name, limits: limits, slotNum: slotNum};
    }
    
    this.updateSurfaceColSrc = async function(type, name) {
        console.log("col " + type + " " + name);
        // load the data array
        var limits = [0, 0];
        var slotNum = null;
        switch (type) {
            case DataSrcTypes.AXIS:
                if (name == "x") limits = [this.data.extentBox.min[0], this.data.extentBox.max[0]];
                if (name == "y") limits = [this.data.extentBox.min[1], this.data.extentBox.max[1]];
                if (name == "z") limits = [this.data.extentBox.min[2], this.data.extentBox.max[2]];
                break;
            case DataSrcTypes.DATA:
                // load data
                slotNum = await this.data.loadDataArray(name);
                // update the limits of slider
                limits = this.data.getLimits(slotNum);
        }
        // change the source
        this.surfaceColSrc = {type: type, name: name, limits: limits, slotNum: slotNum};
    }


    this.didThresholdChange = function() {
        var changed = this.thresholdChanged;
        this.thresholdChanged = false;
        return changed;
    }


    this.update = async function (dt, renderEngine, cameraFollowPath) {
        // console.log(cameraFollowPath)
        if (cameraFollowPath) {
            if (this.camera.th < 720) {
                const degPerSec = 90;
                this.camera.addToTh(dt*degPerSec/1000);
            }
        }
        
        


        this.data.threshold = this.threshold;
        this.data.isoSurfaceSrc = this.isoSurfaceSrc;
        this.data.surfaceColSrc = this.surfaceColSrc;

        var activeValueSlots = [];
        if (this.isoSurfaceSrc.slotNum != null) activeValueSlots.push(this.isoSurfaceSrc.slotNum);
        if (this.surfaceColSrc.slotNum != null) activeValueSlots.push(this.surfaceColSrc.slotNum);

        // calculate the estimated actual focus point
        var cam = this.sceneGraph.activeCamera;
        var focusPoint = this.adjustedFocusPoint ?? cam.getTarget();

        // need to find the camera position in world space
        if (this.data.resolutionMode == ResolutionModes.DYNAMIC && this.updateDynamicTree) {
            updateDynamicTreeBuffers(
                this.data, 
                0, 
                focusPoint,  
                this.sceneGraph.activeCamera.getEyePos(),
                activeValueSlots
            );
        }

        // object which holds all the updates for the render engine
        const updateObj = {
            threshold: this.threshold,
            isoSurfaceSrc: this.isoSurfaceSrc,
            surfaceColSrc: this.surfaceColSrc,
            clippedDataBox: this.clippedDataExtentBox,
            volumeTransferFunction: this.volumeTransferFunction,
        };

        // update the renderables for the objects in the scene
        for (let sceneObj of this.sceneGraph.traverseSceneObjects()) {
            renderEngine.updateSceneObject(dt, sceneObj, updateObj);
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