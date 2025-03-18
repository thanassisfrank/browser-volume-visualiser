// view.js
// handles the creation of view objects, their management and deletion

import { get, show, hide, newId, hexStringToRGBArray } from "./core/utils.js";
import { VecMath } from "./core/VecMath.js";

import { ResolutionModes } from "./core/data/dataConstants.js";
import { dataManager } from "./core/data/data.js";

import { DataSrcSelectElem } from "./viewElems.js";

import { AxesWidget, FrameTimeGraph } from "./widgets.js";

import { DataSrcTypes } from "./core/renderEngine/renderEngine.js";
import { SceneGraph } from "./core/renderEngine/sceneObjects.js";
import { ColourScales, DataSrcUses } from "./core/renderEngine/webGPU/rayMarching/webGPURayMarching.js";

const BINCOUNT = 100;

export var viewManager = {
    
    maxViews: 30,
    // an object to hold all views that have been created
    views: {},

    getFirst: function() {
        return Object.values(this.views)[0];
    },

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
        var viewContainer = get("view-container-template").content.cloneNode(true).children[0];
        console.log(viewContainer);
        viewContainer.id = id;

        // look through the DOM to find the functional elements
        var slider =        viewContainer.querySelector(".view-threshold");
        var frame =         viewContainer.querySelector(".view-frame");
        var closeBtn =      viewContainer.querySelector(".view-close");
        var dataName =      viewContainer.querySelector(".view-dataset-name");
        var dataSize =      viewContainer.querySelector(".view-dataset-size");
        var threshVal =     viewContainer.querySelector(".view-threshold-value");
        var densityGraph =  viewContainer.querySelector(".view-value-density");
        var isoSurfaceSrc = viewContainer.querySelector(".view-iso-surface-src-select");
        var surfaceColSrc = viewContainer.querySelector(".view-surface-col-src-select");
        var colScale =      viewContainer.querySelector(".view-surface-col-scale-select");
        var clipMinX =      viewContainer.querySelector(".view-clip-min-x");
        var clipMaxX =      viewContainer.querySelector(".view-clip-max-x");
        var clipMinY =      viewContainer.querySelector(".view-clip-min-y");
        var clipMaxY =      viewContainer.querySelector(".view-clip-max-y");
        var clipMinZ =      viewContainer.querySelector(".view-clip-min-z");
        var clipMaxZ =      viewContainer.querySelector(".view-clip-max-z");
        var volCols =       viewContainer.querySelectorAll(".view-vol-col");
        var volOps =        viewContainer.querySelectorAll(".view-vol-op");
        var axesWidget =    viewContainer.querySelector(".view-axes-widget");

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
        view.elems.colScale = colScale;
        view.elems.clip = {
            min: [clipMinX, clipMinY, clipMinZ],
            max: [clipMaxX, clipMaxY, clipMaxZ],
        };
        view.elems.volCol = volCols;
        view.elems.volOp = volOps;
        view.elems.axesWidget = axesWidget;
        view.elems.geometryCheck = [];

        const dataArrays = view.data.getAvailableDataArrays();

        view.elemHandlers = {
            isoSurfaceSrc: new DataSrcSelectElem(isoSurfaceSrc, view, dataArrays, DataSrcUses.ISO_SURFACE),
            surfaceColSrc: new DataSrcSelectElem(surfaceColSrc, view, dataArrays, DataSrcUses.SURFACE_COL),
        }

        // populate dataset info
        if (dataName) dataName.innerText = view.data.getName();
        if (dataSize) dataSize.innerText = view.data.getDataSizeString();

        if (slider) {
            slider.style.width = "210px";
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


        // initialise the geometry enable checkboxes
        const geomEnableCont = viewContainer.querySelector(".view-geometry-enable-container");
        for (let meshName in view.data.geometry) {
            let meshEnableDocFrag = get("geometry-enable-template").content.cloneNode(true);
            meshEnableDocFrag.querySelector("label").innerText = meshName;
            const checkbox = meshEnableDocFrag.querySelector(".view-enable-geometry");
            checkbox.dataset.geometryName = meshName;
            checkbox.checked = view.data.geometry[meshName].showByDefault;

            view.enabledGeometry[meshName] = view.data.geometry[meshName].showByDefault;

            view.elems.geometryCheck.push(checkbox);
            // create the event listener
            geomEnableCont.appendChild(meshEnableDocFrag);
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

        view.elems.frame.onclick = async (e) => {
            console.log("click");
        }

        // set event listeners for the elements
        const shiftFac = 0.5;
        view.elems.frame.addEventListener("mousedown", async (e) => {
            
            if (view.elems.frame.requestPointerLock) {
                view.elems.frame.requestPointerLock()
                    .catch(e => console.log("couldn't lock pointer"));
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
            view.camera.startMove(0, 0, 0, "orbit");
            view.camera.move(0, 0, e.deltaY, "orbit");
            view.camera.endMove();
        });

        view.elems.slider.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        });

        view.elems.slider.addEventListener("input", (e) => {
            view.updateThreshold(parseFloat(e.target.value), false);
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
            });
        }
        
        for (let elem of view.elems.volOp) {
            elem.addEventListener("change", (e) => {
                view.volumeTransferFunction.opacity[e.target.dataset["transferIndex"]] = e.target.value;
            });
        }   
        
        for (let elem of view.elems.geometryCheck) {
            elem.addEventListener("change", (e) => {
                view.updateEnabledGeometry(e.target.dataset["geometryName"], e.target.checked);
            })
        }
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
    }
};

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
    this.timeSinceFocusAdjusted = 0;

    this.isoSurfaceSrc = {type: DataSrcTypes.NONE, limits: [0, 0], slotNum: null};
    this.surfaceColSrc = {type: DataSrcTypes.NONE, limits: [0, 0], slotNum: null};

    this.clippedDataExtentBox = structuredClone(this.data.extentBox);

    this.volumeTransferFunction = {
        colour:[],
        opacity:[]
    };

    this.enabledGeometry = {};

    this.renderMode = renderMode;

    this.updateDynamicTree = true;

    // holds all the important DOM elements for this view
    this.elems = {}
    this.box = {};

    this.axesWidget;

    this.init = function(renderEngine) {
        // setup camera position
        camera.setStartPosition(data.getMidPoint(), data.getMaxLength(), 0, 0);

        this.updateIsoSurfaceSrc(this.isoSurfaceSrc.type, this.isoSurfaceSrc.name);
        this.updateSurfaceColSrc(this.surfaceColSrc.type, this.surfaceColSrc.name);

        switch (data.dataName) {
            case "YF17":
                // camera.setStartPosition([-0.0066020588241111604, 2.85478458601422, 0.5043313350465203], 14.7, 180.75, -89);
                break;
        }

        camera.moveToStart();
        // define what rendering type will be performed on dataset object
        this.data.renderMode = this.renderMode;
        // setup the scene
        this.sceneGraph.insertChild(this.camera, undefined, true);
        this.sceneGraph.insertChild(this.data);
        
        // setup the renderables
        const setupObj = {enabledGeometry: this.enabledGeometry};
        console.log(setupObj);
        for (let sceneObj of this.sceneGraph.traverseSceneObjects()) {
            renderEngine.setupSceneObject(sceneObj, setupObj);
        }
        console.log(this.sceneGraph.activeCamera.getEyePos());
        this.update(0, renderEngine);

        this.axesWidget = new AxesWidget(this.elems.axesWidget);
    };

    this.updateThreshold = async function(val) {
        this.elems.slider.value = val;
        this.threshold = val;
        this.thresholdChanged = true;
        if (this.elems.threshVal) this.elems.threshVal.innerText = val.toPrecision(3);
    };

    this.updateSlider = function(limits) {
        this.elems.slider.min = limits[0];
        this.elems.slider.max = limits[1];
        this.elems.slider.step = (limits[1] - limits[0]) / 5000;

        this.updateThreshold((limits[0] + limits[1]) / 2);
    };

    this.updateDensityGraph = function(slotNum) {
        if (this.elems.densityGraph) {
            this.elems.densityGraph.width = BINCOUNT;
            this.elems.densityGraph.height = 20;
            var {counts, max} = this.data.getValueCounts(slotNum, BINCOUNT);
            var densityPlotter = new FrameTimeGraph(this.elems.densityGraph, Math.log10(max), true, [2, 1]);
            for (let val of counts) {
                densityPlotter.update(Math.log10(val));
            }
        }
    };

    // called when
    this.updateIsoSurfaceSrc = async function(desc) {
        console.log("iso " + desc.type + " " + desc.name);
        let limits = [0, 0];
        let slotNum = undefined;
        switch (desc.type) {
            case DataSrcTypes.AXIS:
                if (desc.name == "x") limits = [this.data.extentBox.min[0], this.data.extentBox.max[0]];
                if (desc.name == "y") limits = [this.data.extentBox.min[1], this.data.extentBox.max[1]];
                if (desc.name == "z") limits = [this.data.extentBox.min[2], this.data.extentBox.max[2]];
                hide(this.elems.densityGraph);
                break;
            case DataSrcTypes.ARRAY:
                // load data
                slotNum = await this.data.loadDataArray(desc, BINCOUNT);
                console.log("slotnum is " + slotNum);
                if (slotNum == -1) return;
                // update the limits of slider
                limits = this.data.getLimits(slotNum);
                show(this.elems.densityGraph);
                // this.updateDensityGraph(slotNum);
                break;
            default:
                hide(this.elems.densityGraph);
                break;
        }
        this.updateSlider(limits);
        if (desc.name == "Pressure") this.updateThreshold(101353.322975);
        // change the source
        this.isoSurfaceSrc = {type: desc.type, name: desc.name, limits, slotNum};
    };
    
    this.updateSurfaceColSrc = async function(desc) {
        console.log("col " + desc.type + " " + desc.name);
        // load the data array
        let limits = [0, 0];
        let slotNum = undefined;
        switch (desc.type) {
            case DataSrcTypes.AXIS:
                if (desc.name == "x") limits = [this.data.extentBox.min[0], this.data.extentBox.max[0]];
                if (desc.name == "y") limits = [this.data.extentBox.min[1], this.data.extentBox.max[1]];
                if (desc.name == "z") limits = [this.data.extentBox.min[2], this.data.extentBox.max[2]];
                break;
            case DataSrcTypes.ARRAY:
                // load data
                slotNum = await this.data.loadDataArray(desc, BINCOUNT);
                // update the limits of slider
                limits = this.data.getLimits(slotNum);
        }
        // change the source
        this.surfaceColSrc = {type: desc.type, name: desc.name, limits, slotNum};
    };

    this.updateDataSrc = async function(use, desc) {
        if (DataSrcUses.ISO_SURFACE == use) {
            return await this.updateIsoSurfaceSrc(desc);
        } else if (DataSrcUses.SURFACE_COL == use) {
            return await this.updateSurfaceColSrc(desc);
        } else {
            console.warn("unrecognised data source use")
            return;
        }
    }

    this.updateEnabledGeometry = function(name, enable) {
        this.enabledGeometry[name] = enable;
    };

    this.didThresholdChange = function() {
        var changed = this.thresholdChanged;
        this.thresholdChanged = false;
        return changed;
    };

    this.update = async function (dt, renderEngine) {
        this.axesWidget?.update(this.camera.viewMat);

        var activeValueSlots = [];
        if (this.isoSurfaceSrc.slotNum != null) activeValueSlots.push(this.isoSurfaceSrc.slotNum);
        if (this.surfaceColSrc.slotNum != null) activeValueSlots.push(this.surfaceColSrc.slotNum);

        // calculate the estimated actual focus point every 100ms
        var cam = this.sceneGraph.activeCamera;
        let focusPoint = this.adjustedFocusPoint ?? cam.getTarget();
        let focusMoveDist = 0;
        if ((this.timeSinceFocusAdjusted += dt) > 500) {
            this.timeSinceFocusAdjusted = 0;
            const depth = await renderEngine.rayMarcher.getCenterRayLength();
            if (!depth) {
                this.adjustedFocusPoint = null;
            } else {
                this.adjustedFocusPoint = VecMath.vecAdd(cam.getEyePos(), VecMath.scalMult(depth, cam.getForwardVec()));
            }
            let newFocusPoint = this.adjustedFocusPoint ?? cam.getTarget();
            focusMoveDist = VecMath.magnitude(VecMath.vecMinus(newFocusPoint, focusPoint));
            focusPoint = newFocusPoint;
        }

        // tracks if the camera or adjusted focus point moved to restart the tree modifications
        const cameraChanged = cam.didThisMove("dynamic nodes") || focusMoveDist > 1;
        const camCoords = this.sceneGraph.activeCamera.getEyePos();

        // need to find the camera position in world space
        if (this.data.resolutionMode != ResolutionModes.FULL && this.updateDynamicTree) {
            this.data.updateDynamicTree(
                {
                    changed: cameraChanged,
                    pos: camCoords,
                    focusPos: focusPoint,
                    distToFoc: VecMath.magnitude(VecMath.vecMinus(focusPoint, camCoords)),
                    mat: this.sceneGraph.activeCamera.cameraMat
                },
                {
                    source: this.isoSurfaceSrc,
                    value: this.threshold
                },
                activeValueSlots,
            );
        }

        // object which holds all the updates for the render engine
        const updateObj = {
            threshold: this.threshold,
            isoSurfaceSrc: this.isoSurfaceSrc,
            surfaceColSrc: this.surfaceColSrc,
            clippedDataBox: this.clippedDataExtentBox,
            volumeTransferFunction: this.volumeTransferFunction,
            enabledGeometry: this.enabledGeometry,
        };

        // update the renderables for the objects in the scene
        for (let sceneObj of this.sceneGraph.traverseSceneObjects()) {
            renderEngine.updateSceneObject(dt, sceneObj, updateObj);
        }
    };

    this.getFrameElem = function() {
        return this.elems.frame;
    };

    this.getBox = function() {
        // find the box corresponding to the associated frame element
        // the box is relative to the window
        var rect = this.getFrameElem().getBoundingClientRect();
        this.box = rect;
        return rect;
    };

    this.delete = function(renderEngine) {
        // remove dom
        this.elems.container.remove();
        // clean up gpu data referenced in scene objects
        for (let sceneObj of this.sceneGraph.traverseSceneObjects()) {
            renderEngine.cleanupSceneObj(sceneObj);
        }
        // data object does not need to be cleaned up
    };
}