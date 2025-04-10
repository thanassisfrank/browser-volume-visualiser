// view.js
// handles the creation of view objects, their management and deletion

import { get, show, hide, newId, hexStringToRGBArray, DOMRectEqual } from "../utils.js";
import { VecMath } from "../VecMath.js";

import { ResolutionModes } from "../data/dataConstants.js";
import { Data } from "../data/data.js";

import { AxesWidget, ClipElemHandler, CloseBtnHandler, ColScaleHandler, DataInfoWidget, DataSrcSelectElemHandler, EnabledGeometryHandler, FrameElemHandler, ThresholdSliderHandler, TransferFunctionHandler } from "./viewElems.js";

import { DataSrcTypes, RenderableTypes } from "../renderEngine/renderEngine.js";
import { ColourScales, DataSrcUses } from "../renderEngine/webGPU/rayMarching/webGPURayMarching.js";
import { Camera } from "../renderEngine/sceneObjects.js";



export function createView(id, config, renderEngine) {    
    const container = get("view-container-template").content.cloneNode(true).children[0];
    container.id = id;

    const newView = new View(id, container, config.camera, config.data, config.renderMode, renderEngine);
    get("view-container-container").appendChild(container);
    show(container);
    return newView;
}


class View {
    id;
    container;
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

    // indicates if the mouse is over this view
    // extracted from the frame element
    focussed = false;

    deleted = false;

    // handlers for output DOM elements (widgets)
    #outElems = {};

    // inputs =======================================
    #currInputs = {};
    // a place for programmatic inputs to be written
    #inExternal = {};
    // handlers for all of the input DOM elements
    #inElems = {};
    


    constructor(id, containerElem, camera, data, renderMode, renderEngine) {
        this.id = id;
        this.container = containerElem;
        this.camera = camera;
        this.data = data;
        this.renderMode = renderMode;

        this.#createDOM(containerElem);
        
        // setup camera 
        this.camera.setStartPosition(this.data.getMidPoint(), this.data.getMaxLength(), 0, 0);
        this.camera.moveToStart();

        // create scene
        this.scene = renderEngine.createScene();
        this.scene.addData(this.data, this.renderMode);
    }

    #createDOM(container) {
        // create the input handlers
        const dataArrays = this.data.getAvailableDataArrays();

        this.#inElems = {
            isoSurfaceSrc   : new DataSrcSelectElemHandler(container, dataArrays, DataSrcUses.ISO_SURFACE),
            surfaceColSrc   : new DataSrcSelectElemHandler(container, dataArrays, DataSrcUses.SURFACE_COL),
            frame           : new FrameElemHandler(container, this.camera, 0.5),
            close           : new CloseBtnHandler(container),
            slider          : new ThresholdSliderHandler(container, "210px"),
            colScale        : new ColScaleHandler(container),
            clip            : new ClipElemHandler(container, this.data.extentBox),
            enabledGeometry : new EnabledGeometryHandler(container, this.data),
            transferFunction: new TransferFunctionHandler(container)
        };

        // create output handlers
        this.#outElems = {
            axes    : new AxesWidget(container),
            dataInfo: new DataInfoWidget(container, this.data),
        };
    }


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

    // queries all of the input element handlers for current state
    #getElementInputs() {
        return {
            closed: this.#inElems.close.pressed,
            mouseOn: this.#inElems.frame.isMouseOver(),
            box: this.#inElems.frame.getBox(),
            colScale: this.#inElems.colScale.getValue(),
            isoSrc: this.#inElems.isoSurfaceSrc.getSrc(),
            colSrc: this.#inElems.surfaceColSrc.getSrc(),
            threshold: this.#inElems.slider.getValue(),
            enabledGeometry: this.#inElems.enabledGeometry.getEnabledGeometry(),
            clippedBox: this.#inElems.clip.getClipBox(),
            transferFunction: this.#inElems.transferFunction.getTransferFunction()
        }
    }

    // returns the current input state as well as what has changed
    #getInputs() {
        const elemIn = this.#getElementInputs();

        // combine inputs with preference given to external inputs
        const inputs = {...elemIn, ...this.#inExternal};
        
        // track important changes
        const changed = {
            box: DOMRectEqual(inputs.box, this.#currInputs.box),
            isoSrc: inputs.isoSrc?.name !== this.#currInputs.isoSrc?.name,
            colSrc: inputs.colSrc?.name !== this.#currInputs.colSrc?.name,
            threshold: inputs.threshold !== this.#currInputs.threshold
        };

        this.#currInputs = inputs;

        return {inputs, changed};
    }

    async update(dt, renderEngine) {
        // get the inputs from the input elements
        const { inputs, changed } = this.#getInputs();

        // check if this should close
        if (inputs.closed) {
            this.delete();
            return;
        }

        this.focussed = inputs.mouseOn;
        if (changed.box) {
            this.camera.setAspectRatio(inputs.box.width/inputs.box.height);
        }

        renderEngine.rayMarcher.setColourScale(inputs.colScale);

        
        const isoLimits = await this.getSrcLimits(inputs.isoSrc);
        const colLimits = await this.getSrcLimits(inputs.isoSrc);
        let fullIsoSrc = {name: inputs.isoSrc.name, type: inputs.isoSrc.type, limits: isoLimits};
        let fullColSrc = {name: inputs.colSrc.name, type: inputs.colSrc.type, limits: colLimits};
        
        if (changed.isoSrc) this.#inElems.slider.setLimits(isoLimits);
        this.#outElems.axes.update(this.camera.viewMat);

        const activeValueNames = [];
        if (inputs.isoSrc.type == DataSrcTypes.ARRAY) activeValueNames.push(inputs.isoSrc.name);
        if (inputs.colSrc.type == DataSrcTypes.ARRAY) activeValueNames.push(inputs.colSrc.name);

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

        // update the dataset if it is dynamic
        if (this.data.resolutionMode != ResolutionModes.FULL && this.updateDynamicTree) {
            this.data.updateDynamicTree(
                {
                    changed: cameraChanged,
                    pos: camCoords,
                    focusPos: focusPoint,
                    camToFocus: VecMath.magnitude(VecMath.vecMinus(focusPoint, camCoords)),
                    mat: cam.cameraMat
                },
                {
                    changed: changed.threshold,
                    source: fullIsoSrc,
                    value: inputs.threshold
                },
                activeValueNames
            );
        }

        // object which holds all the updates for the render engine
        const updates = {
            threshold: inputs.threshold,
            isoSurfaceSrc: fullIsoSrc,
            surfaceColSrc: fullColSrc,
            clippedDataBox: inputs.clippedBox,
            volumeTransferFunction: inputs.transferFunction,

            nodeData: this.data.getNodeBuffer(),
            meshData: this.data.getMesh(),
            valuesData: {},
            cornerValsData: {},
            treeletCellsData: this.data.getTreeCells(),
            blockSizes: this.data.getBufferBlockSizes(),

            enabledGeometry: inputs.enabledGeometry,
        };

        if (fullIsoSrc.type == DataSrcTypes.ARRAY && (changed.isoSrc || this.data.resolutionMode != ResolutionModes.FULL)) {
            updates.valuesData[fullIsoSrc.name] = await this.data.getValues(fullIsoSrc.name);
            updates.cornerValsData[fullIsoSrc.name] = this.data.getCornerValues(fullIsoSrc.name);
        }
        if (fullColSrc.type == DataSrcTypes.ARRAY && (changed.colSrc || this.data.resolutionMode != ResolutionModes.FULL)) {
            updates.valuesData[fullColSrc.name] = await this.data.getValues(fullColSrc.name);
            updates.cornerValsData[fullColSrc.name] = this.data.getCornerValues(fullColSrc.name);
        }

        // update the data renderable
        const dataRenderables = this.scene.getRenderablesOfType(RenderableTypes.UNSTRUCTURED_DATA | RenderableTypes.DATA);
        if (dataRenderables.length > 0) {
            this.scene.updateRenderable(dataRenderables[0], updates);
        }
    };

    // can be used externally to set an input value
    // useful values are those also supplied by input elements
    setInput(name, value) {
        this.#inExternal[name] = value;
    }

    getBox() {
        return this.#inElems.frame.getBox();
    };

    getThreshold() {
        return this.#inElems.slider.getValue();
    }

    delete() {
        this.deleted = true;
        // remove all of the event listeners
        for (let key in this.#inElems) {
            this.#inElems[key].removeListeners?.();
        }
        // remove dom
        this.container.remove();
        // clean up gpu data referenced in renderables
        this.scene.clear();
    };
}