// index.js
// the main js file for index.html
import {get, getClass, getInputClassAsObj, isVisible, show, hide, setupCanvasDims, downloadObject, downloadCanvas, frameInfoStore} from "./core/utils.js";

import { DataFormats } from "./core/data/dataConstants.js";
import { dataManager } from "./core/data/data.js";
import { createRenderEngine } from "./core/renderEngine/renderEngine.js";
import { viewManager } from "./view.js";
import { Camera, SceneObjectRenderModes } from "./core/renderEngine/sceneObjects.js";
import { FrameTimeGraph } from "./widgets.js";
import { KDTreeSplitTypes } from "./core/data/cellTree.js";
import { CornerValTypes } from "./core/data/treeNodeValues.js";

import { VecMath } from "./core/VecMath.js"
import { JobRunner } from "./benchmark.js";


const setUpRayMarchOptions = (rayMarcher) => {
    for (let elem of getClass("ray-march-opt")) {
        elem.checked = rayMarcher.getPassFlag(elem.name);
        elem.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            return false;
        });
        elem.addEventListener("click", (e) => {
            rayMarcher.setPassFlag(elem.name, elem.checked);
        });
    }
};


const populateDataOptions = (dataManager) => {
    var dataOptions = get("data-select");
    for (let id in dataManager.configSet) {
        var elem = document.createElement("OPTION");
        elem.value = id;                
        elem.innerText = dataManager.configSet[id].name;
        dataOptions.appendChild(elem);
    }
};


const populateKDTreeOptions = () => {
    var kdTreeOptions = get("kd-tree-type-select");
    for (let type in KDTreeSplitTypes) {
        var elem = document.createElement("OPTION");
        elem.value = KDTreeSplitTypes[type];                
        elem.innerText = type;
        kdTreeOptions.appendChild(elem);
    }
};


const populateCornerValOptions = () => {
    var cornerValOptions = get("corner-val-type-select");
    for (let type in CornerValTypes) {
        var elem = document.createElement("OPTION");
        elem.value = CornerValTypes[type];                
        elem.innerText = type;
        cornerValOptions.appendChild(elem);
    }
};


// viewOpts : {
//     dataID   : string,
//     dataOpts : {
//         leafCells             : int,
//         downSample            : int,
//         forceUnstruct         : bool,
//         dynamicNodes          : bool,
//         dynamicMesh           : bool,
//         dynamicNodeCount      : int,
//         dynamicMeshBlockCount : int,
//         maxTreeDepth          : int,
//         kdTreeType            : string,
//         cornerValType         : int,
//         treeletDepth          : int
//     },
//     renderOpts : {
//         DATA_POINTS        : bool,
//         DATA_RAY_VOLUME    : bool, 
//         DATA_WIREFRAME     : bool, 
//         BOUNDING_WIREFRAME : bool, 
//         GEOMETRY           : bool, 
//     },
// }

const viewOptsFromInputElems = (dataSelect, opts) => {
    return {
        dataID: dataSelect.options[dataSelect.selectedIndex].value,
        dataOpts: {
            leafCells: parseInt(opts.leafCells?.value),
            downSample: parseInt(opts?.downsample?.value ?? 1),
            forceUnstruct: opts.createUnstructured?.checked,
            dynamicNodes: opts.dynamicNodes?.checked,
            dynamicMesh: opts.dynamicMesh?.checked,
            dynamicNodeCount: parseInt(opts.dynamicNodeCount?.value),
            dynamicMeshBlockCount: parseInt(opts.dynamicMeshBlockCount?.value),
            maxTreeDepth: parseInt(opts.maxDepth.value),
            kdTreeType: opts.kdTreeType.value,
            cornerValType: parseInt(opts.cornerValType.value),
            treeletDepth: parseInt(opts.treeletDepth?.value)
        },
        renderOpts: {
            DATA_POINTS: opts.DATA_POINTS.checked,
            DATA_RAY_VOLUME: opts.DATA_RAY_VOLUME.checked,
            DATA_WIREFRAME: opts.DATA_WIREFRAME.checked,
            BOUNDING_WIREFRAME: opts.BOUNDING_WIREFRAME.checked,
            GEOMETRY: opts.GEOMETRY.checked
        }
    };
}

// define the main function
async function main() {
    const canvas = get("c");
    
    const frameTimeGraph = new FrameTimeGraph(get("frame-time-graph"), 100);

    let benchmarker;

    const renderEnginePromise = createRenderEngine(canvas)
        .then((renderEngine) => renderEngine.setup())
        .then((renderEngine) => {
            setUpRayMarchOptions(renderEngine.rayMarcher);
            return renderEngine;
        })
        .catch((reason) => {
            console.error("Could not create rendering engine: " + reason);
            return null;
        });

    
    const serverDatasetsPromise = fetch("./data/datasets.json")
        .then((res) => res.json())
        .then((serverDatasets) => {
            return {
                ...serverDatasets,
                test: {
                    name: "Small Test",
                    type: "function",
                    size: {
                        x: 4,
                        y: 4,
                        z: 4
                    },
                    cellSize: {
                        x: 1,
                        y: 1,
                        z: 1
                    },
                    f: (x, y, z) => Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2) + Math.pow(z, 2))
                }
            }
        })
        .then((allDatasets) => {
            dataManager.setConfigSet(allDatasets);
            populateDataOptions(dataManager);
            populateKDTreeOptions();
            populateCornerValOptions();
            return allDatasets
        })
        .catch((reason) => {
            console.error("Could not get datasets: " + reason);
            return null;
        });
    
    const jobsFilePromise = fetch("./clientJobs.json")
        .then((res) => res.json());
    
    const [renderEngine, allDatasets, jobs] = await Promise.all([renderEnginePromise, serverDatasetsPromise, jobsFilePromise]);

    if (!renderEngine || !allDatasets) {
        console.error("Could not initialise program");
        return;
    }
    
    // set the max views
    viewManager.maxViews = 1;
    
    async function createView(opts) {
        var newData = await dataManager.getDataObj(opts.dataID, opts.dataOpts);

        var renderMode = SceneObjectRenderModes.NONE;
        if (opts.renderOpts.DATA_POINTS) renderMode |= SceneObjectRenderModes.DATA_POINTS;
        if (opts.renderOpts.DATA_RAY_VOLUME) renderMode |= SceneObjectRenderModes.DATA_RAY_VOLUME;
        if (opts.renderOpts.DATA_WIREFRAME) renderMode |= SceneObjectRenderModes.DATA_WIREFRAME;
        if (opts.renderOpts.BOUNDING_WIREFRAME) renderMode |= SceneObjectRenderModes.BOUNDING_WIREFRAME;
        if (opts.renderOpts.GEOMETRY) renderMode |= SceneObjectRenderModes.DATA_MESH_GEOMETRY;
        
        return await viewManager.createView({
            camera: new Camera(canvas.width/canvas.height),
            data: newData,
            renderMode: renderMode
        }, renderEngine);
    }

    async function deleteView(view) {
        viewManager.deleteView(view, renderEngine);
    }

    
    get("create-view-btn").addEventListener("click", async (e) => {
        const d = get("data-select");
        const optsRaw = getInputClassAsObj("dataset-opt");
        const viewOpts = viewOptsFromInputElems(d, optsRaw);
        createView(viewOpts);
        hide(get("add-view-container")); 
    });



    // create job runner object
    const jobRunner = new JobRunner(jobs, createView, deleteView, renderEngine);

    const mousePos = {
        x: 0, y: 0
    };
    document.body.addEventListener("mousemove", (e) => {
        mousePos.x = e.clientX; 
        mousePos.y = e.clientY;
    });

    // shortcuts
    const shortcuts = {
        " ": {
            description: "Print the camera position and threshold val",
            f: function (e) {
                const view = viewManager.getFirst();
                if (!view) return;
                view.camera.printVals();
                console.log("threshold", view.threshold);
            }
        },
        "a": {
            description: "Save generated corner values in slot 0",
            f: function (e) {
                var currView = Object.values(viewManager.views)[0];
                if (!currView) {
                    console.warn("no view loaded");
                    return;
                }

                if (currView.data.dataFormat != DataFormats.UNSTRUCTURED) {
                    console.warn("dataset not unstructured");
                    return;
                }

                if (currView.data.data.values.length < 1) {
                    console.warn("no data array loaded");
                    return;
                }

                const dataObj = currView.data;
                var kdTreeTypeStr;
                for (let type in KDTreeSplitTypes) {
                    if (KDTreeSplitTypes[type] != dataObj.opts.kdTreeType) continue;
                    kdTreeTypeStr = type;
                    break;
                }

                var cornerValTypeStr
                for (let type in CornerValTypes) {
                    if (CornerValTypes[type] != dataObj.cornerValType) continue;
                    cornerValTypeStr = type;
                    break;
                }

                let cornerVals = dataObj.getFullCornerValues(0);
                if (!cornerVals) {
                    console.warn("no corner values present in slot 0");
                    return;
                }

                // download the buffers
                const filePrefix = [
                    dataObj.config.path.split("/")[1].split(".")[0],
                    kdTreeTypeStr,
                    dataObj.opts.leafCells,
                    dataObj.opts.maxTreeDepth,
                    dataObj.data.values[0].name,
                    cornerValTypeStr
                ].join("_");

                const fileName = filePrefix + "_cornerVals.raw";

                downloadObject(cornerVals, fileName, "application/octet-stream");

                // print the required json entry
                var jsonEntry = {
                    "dataArray": dataObj.data.values[0].name,
                    "type": cornerValTypeStr,
                    "path": "data/" + fileName
                };
                console.log(JSON.stringify(jsonEntry, undefined, 4));

            }
        },
        "b": {
            description: "Save generated unstructured tree",
            f: function (e) {
                var currView = Object.values(viewManager.views)[0];
                if (!currView) {
                    console.warn("no view loaded");
                    return;
                }

                if (currView.data.dataFormat != DataFormats.UNSTRUCTURED) {
                    console.warn("dataset not unstructured");
                    return;
                }

                const dataObj = currView.data;
                var kdTreeTypeStr;
                for (let type in KDTreeSplitTypes) {
                    if (KDTreeSplitTypes[type] != dataObj.opts.kdTreeType) continue;
                    kdTreeTypeStr = type;
                    break;
                }

                // download the buffers
                const filePrefix = [
                    dataObj.config.path.split("/")[1].split(".")[0],
                    kdTreeTypeStr,
                    dataObj.opts.leafCells,
                    dataObj.opts.maxTreeDepth
                ].join("_");

                const treeNodesName = filePrefix + "_treeNodes.raw";
                const treeCellsName = filePrefix + "_treeCells.raw";

                downloadObject(dataObj.data.treeNodes, treeNodesName, "application/octet-stream");
                downloadObject(dataObj.data.treeCells, treeCellsName, "application/octet-stream");

                // print the required json entry
                var jsonEntry = {
                    "kdTreeType": kdTreeTypeStr,
                    "leafCells": dataObj.opts.leafCells,
                    "maxTreeDepth": dataObj.opts.maxTreeDepth,
                    "treeNodeCount": dataObj.data.treeNodeCount,
                    "nodesPath": "data/" + treeNodesName,
                    "cellsPath": "data/" + treeCellsName,
                    "cornerValues": []
                };
                console.log(JSON.stringify(jsonEntry, undefined, 4));
            }
        },
        "c": {
            description: "Copy frametime samples to clipboard",
            f: function (e) {
                frameTimeGraph.copySamples();
                console.log("Samples copied");
            }
        },
        "d": {
            description: "Get the current ray length texture from the ray marcher",
            f: function (e) {
                renderEngine.rayMarcher.getCenterRayLength()
                .then(depth => {
                    console.log(depth);
                    var currView = Object.values(viewManager.views)[0];
                    if (!currView) return;
                    
                    if (!depth) {
                        currView.adjustedFocusPoint = null;
                    } else {
                        var cam = currView.sceneGraph.activeCamera;
                        currView.adjustedFocusPoint = VecMath.vecAdd(cam.getEyePos(), VecMath.scalMult(depth, cam.getForwardVec()));
                    }
                })
                .catch(e => {
                    console.warn("Couldn't read ray length tex");
                    console.error(e);
                });
            }
        },
        "f": {
            description: "Export frame times",
            f: function (e) {
                frameInfoStore.export();
            }
        },
        "g": {
            description: "Display GPU memory usage",
            f: function (e) {
                console.log(renderEngine.getWebGPU().getResourcesString());
            }
        },
        "h": {
            description: "Help",
            f: function (e) {
                for (let key in shortcuts) {
                    if (shortcuts[key].description) console.log("'" + key + "'\t" + shortcuts[key].description);
                }
            }
        },
        "j": {
            description: "Run client jobs",
            f: function (e) {
                jobRunner.start(performance.now())
            }
        },
        "l": {
            description: "Print last frametime sample",
            f: function (e) {
                console.log(frameTimeGraph.lastSamples[0]);
            }
        },
        "o": {
            description: "Reset offset optimisation",
            f: function (e) {
                renderEngine.canvasResized = true;
                renderEngine.rayMarcher.globalPassInfo.framesSinceMove = 0;
            }
        },
        "p": {
            description: "Toggle dynamic tree updates",
            f: (e) => {
                const currView = Object.values(viewManager.views)[0];
                currView.updateDynamicTree = !currView.updateDynamicTree;
            }
        },
        "r": {
            description: "Move camera to initial position",
            f: function (e) {
                camera.moveToStart();
            }
        },
        "s": {
            description: "Save image on main canvas",
            f: function (e) {
                downloadCanvas(canvas, "canvas_image.png", "image/png");
            }
        },
        "t": {
            description: "move focus point",
            f: async function (e) {
                const d = await renderEngine.rayMarcher.getRayLengthAt(mousePos.x, mousePos.y);
                if (!d) return;
                const tex = renderEngine.rayMarcher.offsetOptimisationTextureOld;
                const camCoords = {x: mousePos.x/tex.width * 2 - 1, y: mousePos.y/tex.height * 2 - 1};
                const camera = Object.values(viewManager.views)[0].camera;
                const newTarget = camera.getWorldSpaceFromClipAndDist(camCoords.x, camCoords.y, d);

                camera.setTarget(newTarget);
            }
        },
        "u": {
            description: "Update view",
            f: function (e) {
                Object.values(viewManager.views)?.[0].update(0, renderEngine);
            }
        },
        "v": {
            description: "Toggle visiblity of overlay elements",
            f: function (e) {
                for (let elem of [...getClass("view-bottom-bar"), get("ray-march-opts-container"), get("frame-info")]) {
                    if (isVisible(elem)) {
                        hide(elem);
                    } else {
                        show(elem);
                    }
                }
            }
        },
        "Alt": {
            f: function (e) {
                e.preventDefault();
            }
        },
        "ArrowUp": {
            description: "Increase ray-marching step size",
            f: function (e) {
                var oldStep = renderEngine.rayMarcher.getStepSize();
                var newStep = oldStep * 2;
                console.log("inc step size:", newStep);
                renderEngine.rayMarcher.setStepSize(newStep);
            }
        },
        "ArrowDown": {
            description: "Decrease ray-marchng step size",
            f: function (e) {
                var oldStep = renderEngine.rayMarcher.getStepSize();
                var newStep = oldStep * 0.5;
                console.log("dec step size:", newStep);
                renderEngine.rayMarcher.setStepSize(newStep);
            }
        }
    };

    document.body.addEventListener("keydown", function(e) {
        shortcuts[e.key.toLowerCase()]?.f(e);
    });

    console.info("Press 'h' for a list of shortcuts");

    var resize = () => {
        var canvasDims = setupCanvasDims(canvas);
        // change camera aspect ratio
        viewManager.getFirst()?.camera.setAspectRatio(canvasDims[0]/canvasDims[1]);
        renderEngine.resizeRenderingContext();
    }
    resize();

    window.addEventListener("resize", resize);

    var lastFrameStart = performance.now();
    var renderLoop = async (timeGap) => {
        
        var thisFrameStart = performance.now();
        const dt = thisFrameStart - lastFrameStart;
        lastFrameStart = thisFrameStart;
        
        jobRunner.update(thisFrameStart);

        // update widgets
        frameTimeGraph.update(dt);
        
        // update the scene
        viewManager.update(dt, renderEngine);
        
        // render the scenes
        // includes doing marching cubes/ray marching if required by object
        var viewList = Object.values(viewManager.views);
        if (viewList.length == 0) {
            renderEngine.clearScreen();
        } else {
            for (let view of viewList) {
                // await renderEngine.renderView(view);
                renderEngine.renderView(view);
            }
        }
        frameInfoStore.nextFrame();
        // next frame
        requestAnimationFrame(renderLoop);
    };
    
    renderLoop();
}

document.body.onload = main;
