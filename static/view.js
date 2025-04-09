// view.js
// handles the creation of view objects, their management and deletion

import { get, show, hide, newId, hexStringToRGBArray } from "./core/utils.js";
import { VecMath } from "./core/VecMath.js";

import { ResolutionModes } from "./core/data/dataConstants.js";
import { dataManager, Data } from "./core/data/data.js";

import { AxesWidget, ClipElemHandler, CloseBtnHandler, ColScaleHandler, DataSrcSelectElemHandler, EnabledGeometryHandler, FrameElemHandler, ThresholdSliderHandler, TransferFunctionHandler } from "./viewElems.js";

import { DataSrcTypes, RenderableTypes } from "./core/renderEngine/renderEngine.js";
import { ColourScales, DataSrcUses } from "./core/renderEngine/webGPU/rayMarching/webGPURayMarching.js";
import { Camera } from "./core/renderEngine/sceneObjects.js";



export var viewManager = {
    
    maxViews: 1,
    // an object to hold all views that have been created
    views: {},

    getFirst: function() {
        return Object.values(this.views)[0];
    },

    moreViewsAllowed: function() {
        return Object.keys(this.views).length < this.maxViews;
    },

    newContainer: function(id) {
        // clone the proto node
        const viewContainer = get("view-container-template").content.cloneNode(true).children[0];
        viewContainer.id = id;

        return viewContainer;
    },

    createView: async function(config, renderEngine) {    
        //check to see if there is already the max amount of views
        if (!this.moreViewsAllowed()) {
            console.log("sorry, max views reached");
            return false;
        }
        
        const id = newId(this.views);
        const container = this.newContainer(id);

        const newView = new View(id, container, config.camera, config.data, config.renderMode, renderEngine);
        this.appendDOM(container);
        this.views[id] = newView;
        return newView;
    },

    appendDOM: function(container) {
        get("view-container-container").appendChild(container);
        show(container);
    },

    update: function(dt, renderEngine, cameraFollowPath) {
        for (let key in this.views) {
            this.views[key].update(dt, renderEngine, cameraFollowPath);
        }
    }
};

class View {
    id;
    scene;
    /** @type {Camera} */
    camera;
    /** @type {Data} */
    data;

    // an estimate of where the viewer is actually focusing
    adjustedFocusPoint;
    timeSinceFocusAdjusted = 0;

    renderMode;

    updateDynamicTree = true;

    // handlers for all of the DOM elements that make up this view's UI
    #elemHandlers = {};


    constructor(id, containerElem, camera, data, renderMode, renderEngine) {
        this.id = id;
        this.camera = camera;
        this.data = data;
        this.renderMode = renderMode;

        this.#createDOM(containerElem);
        this.#init(renderEngine);
    }

    #createDOM(container) {
        // look through the DOM to find the functional elements
        const dataName      = container.querySelector(".view-dataset-name");
        const dataSize      = container.querySelector(".view-dataset-size");
        // const densityGraph  = container.querySelector(".view-value-density");

        // populate dataset info
        if (dataName) dataName.innerText = this.data.getName();
        if (dataSize) dataSize.innerText = this.data.getDataSizeString();


        const dataArrays = this.data.getAvailableDataArrays();

        this.#elemHandlers = {
            isoSurfaceSrc   : new DataSrcSelectElemHandler(container, dataArrays, DataSrcUses.ISO_SURFACE),
            surfaceColSrc   : new DataSrcSelectElemHandler(container, dataArrays, DataSrcUses.SURFACE_COL),
            frame           : new FrameElemHandler(container, this.camera, 0.5),
            close           : new CloseBtnHandler(container),
            slider          : new ThresholdSliderHandler(container, "210px"),
            colScale        : new ColScaleHandler(container),
            clip            : new ClipElemHandler(container, this.data.extentBox),
            axesWidget      : new AxesWidget(container),
            enabledGeometry : new EnabledGeometryHandler(container, this.data),
            transferFunction: new TransferFunctionHandler(container)
        }
    }

    #init(renderEngine) {
        // setup camera position
        this.camera.setStartPosition(this.data.getMidPoint(), this.data.getMaxLength(), 0, 0);

        this.camera.moveToStart();

        // create scene
        this.scene = renderEngine.createScene();
        this.scene.addData(this.data, this.renderMode);

        this.update(0, renderEngine);
    };

    async getSrcLimits(desc) {
        if (DataSrcTypes.AXIS == desc.type) {
            if (desc.name == "x") return [this.data.extentBox.min[0], this.data.extentBox.max[0]];
            if (desc.name == "y") return [this.data.extentBox.min[1], this.data.extentBox.max[1]];
            if (desc.name == "z") return [this.data.extentBox.min[2], this.data.extentBox.max[2]];
        } else if (DataSrcTypes.ARRAY == desc.type) {
            return (await this.data.loadDataArray(desc)).limits;
        } else {
            return [0, 1];
        }
    }

    async update(dt, renderEngine) {
        // check if this should close
        if (this.#elemHandlers.close.pressed) {
            this.delete();
            return;
        }

        renderEngine.rayMarcher.setColourScale(this.#elemHandlers.colScale.getValue());

        // read the iso surface and surface colour sources
        let isoSrc = this.#elemHandlers.isoSurfaceSrc.getSrc();
        isoSrc.limits = await this.getSrcLimits(isoSrc);
        let colSrc = this.#elemHandlers.surfaceColSrc.getSrc();
        colSrc.limits = await this.getSrcLimits(colSrc);

        if (this.#elemHandlers.isoSurfaceSrc.getChanged()) {
            this.#elemHandlers.slider.setLimits(isoSrc.limits);
            if (isoSrc.name == "Pressure") {
                this.#elemHandlers.slider.setValue(101353.322975);
            }
        }

        this.#elemHandlers.axesWidget.update(this.camera.viewMat);

        const activeValueNames = [];
        if (isoSrc.type == DataSrcTypes.ARRAY) activeValueNames.push(isoSrc.name);
        if (colSrc.type == DataSrcTypes.ARRAY) activeValueNames.push(colSrc.name);

        // calculate the estimated actual focus point every 100ms
        const cam = this.camera;
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
        const camCoords = cam.getEyePos();

        // need to find the camera position in world space
        if (this.data.resolutionMode != ResolutionModes.FULL && this.updateDynamicTree && !this.data.noUpdates) {
            this.data.updateDynamicTree(
                {
                    changed: cameraChanged,
                    pos: camCoords,
                    focusPos: focusPoint,
                    camToFocus: VecMath.magnitude(VecMath.vecMinus(focusPoint, camCoords)),
                    mat: cam.cameraMat
                },
                {
                    changed: this.#elemHandlers.slider.didThresholdChange("dynamic nodes"),
                    source: isoSrc,
                    value: this.#elemHandlers.slider.getValue()
                },
                activeValueNames
            );
        }

        // object which holds all the updates for the render engine
        const updates = {
            threshold: this.#elemHandlers.slider.getValue(),
            isoSurfaceSrc: isoSrc,
            surfaceColSrc: colSrc,
            clippedDataBox: this.#elemHandlers.clip.getClipBox(),
            volumeTransferFunction: this.#elemHandlers.transferFunction.getTransferFunction(),

            nodeData: this.data.getNodeBuffer(),
            meshData: this.data.getMesh(),
            valuesData: {},
            cornerValsData: {},
            treeletCellsData: this.data.getTreeCells(),
            blockSizes: this.data.getBufferBlockSizes(),

            enabledGeometry: this.#elemHandlers.enabledGeometry.getEnabledGeometry(),
        };

        
        if (isoSrc.type == DataSrcTypes.ARRAY) {
            updates.valuesData[isoSrc.name] = this.data.getValues(isoSrc.name);
            updates.cornerValsData[isoSrc.name] = this.data.getCornerValues(isoSrc.name);
        }
        if (colSrc.type == DataSrcTypes.ARRAY) {
            updates.valuesData[colSrc.name] = this.data.getValues(colSrc.name);
            updates.cornerValsData[colSrc.name] = this.data.getCornerValues(colSrc.name);
        }

        // update the data renderable
        const dataRenderables = this.scene.getRenderablesOfType(RenderableTypes.UNSTRUCTURED_DATA);
        if (dataRenderables.length > 0) {
            this.scene.updateRenderable(dataRenderables[0], updates);
        }
    };

    getBox() {
        return this.#elemHandlers.frame.getBox();
    };

    didThresholdChange(id="Default") {
        return this.#elemHandlers.slider.didThresholdChange(id);
    }

    delete() {
        // remove all of the event listeners
        for (let key in this.#elemHandlers) {
            this.#elemHandlers[key].removeListeners?.();
        }
        // remove dom
        this.elems.container.remove();
        // clean up gpu data referenced in renderables
        this.scene.clear();
    };
}