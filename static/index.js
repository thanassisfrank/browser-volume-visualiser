// index.js
// the main js file for index.html
import {get, getClass, getInputClassAsObj, isVisible, show, hide, setupCanvasDims, downloadObject, downloadCanvas} from "./core/utils.js";

import { dataManager, DataFormats } from "./core/data/data.js";
import { createRenderEngine } from "./core/renderEngine/renderEngine.js";
import { viewManager } from "./view.js";
import { Camera, SceneObjectRenderModes } from "./core/renderEngine/sceneObjects.js";
import { FrameTimeGraph } from "./widgets.js";
import { KDTreeSplitTypes } from "./core/data/cellTree.js";
import { CornerValTypes } from "./core/data/treeNodeValues.js";

import { VecMath } from "./core/VecMath.js"


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

// define the main function
async function main() {
    var canvas = get("c");
    
    var frameTimeGraph = new FrameTimeGraph(get("frame-time-graph"), 100);

    var renderEnginePromise = createRenderEngine(canvas)
        .then((renderEngine) => renderEngine.setup())
        .then((renderEngine) => {
            setUpRayMarchOptions(renderEngine.rayMarcher);
            return renderEngine;
        })
        .catch((reason) => {
            console.error("Could not create rendering engine: " + reason);
            return null;
        });

    
    var serverDatasetsPromise = fetch("/data/datasets.json")
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
    
    var [renderEngine, allDatasets] = await Promise.all([renderEnginePromise, serverDatasetsPromise]);
    if (!renderEngine || !allDatasets) {
        console.error("Could not initialise program");
        return;
    }
    
    var camera = new Camera();
    // set the max views
    viewManager.maxViews = 1;

    get("create-view-btn").addEventListener("click", async (e) => {
        var d = get("data-select");
        var opts = getInputClassAsObj("dataset-opt");

        console.log(opts.resolutionMode?.value);

        var newData = await dataManager.getDataObj(
            d.options[d.selectedIndex].value,
            {
                leafCells: parseInt(opts.leafCells?.value),
                downSample: parseInt(opts?.downsample?.value ?? 1),
                forceUnstruct: opts.createUnstructured?.checked,
                resolutionMode: opts.resolutionMode?.value,
                dynamicNodes: opts.dynamicNodes?.checked,
                dynamicMesh: opts.dynamicMesh?.checked,
                dynamicNodeCount: parseInt(opts.dynamicNodeCount?.value),
                dynamicMeshBlockCount: parseInt(opts.dynamicMeshBlockCount?.value),
                maxTreeDepth: parseInt(opts.maxDepth.value),
                kdTreeType: parseInt(opts.kdTreeType.value),
                cornerValType: parseInt(opts.cornerValType.value),
            }
        );

        var renderMode = SceneObjectRenderModes.NONE;
        if (opts.DATA_POINTS.checked) renderMode |= SceneObjectRenderModes.DATA_POINTS;
        if (opts.DATA_RAY_VOLUME.checked) renderMode |= SceneObjectRenderModes.DATA_RAY_VOLUME;
        if (opts.DATA_WIREFRAME.checked) renderMode |= SceneObjectRenderModes.DATA_WIREFRAME;
        if (opts.BOUNDING_WIREFRAME.checked) renderMode |= SceneObjectRenderModes.BOUNDING_WIREFRAME;
        if (opts.GEOMETRY.checked) renderMode |= SceneObjectRenderModes.DATA_MESH_GEOMETRY;
        
        var newView = await viewManager.createView({
            camera: camera,
            data: newData,
            renderMode: renderMode
        }, renderEngine);

        // hide the window
        hide(get("add-view-container")); 
    });

    var cameraFollowPath = false;

    // shortcuts
    const shortcuts = {
        " ": {
            description: "Print the camera position and threshold val",
            f: function(e) {
                camera.printVals();
                console.log("threshold", Object.values(viewManager.views)[0].threshold);
            }
        },
        "a": {
            description: "Save generated corner values in slot 0",
            f: function(e) {
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
            f: function(e) {
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
            f: function(e) {
                frameTimeGraph.copySamples();
                console.log("Samples copied");
            }
        },
        "d": {
            description: "Get the current ray length texture from the ray marcher",
            f: function(e) {
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
            description: "Print average frametime",
            f: function(e) {
                const avg = frameTimeGraph.getAverage();
                console.log("avg ft ", frameTimeGraph.historyLength, "samples:", avg, "ms");
                alert(avg + "ms");
            }
        },
        "g": {
            description: "Display GPU memory usage",
            f: function(e) {
                console.log(renderEngine.getWebGPU().getResourcesString());
            }
        },
        "h": {
            description: "Help",
            f: function(e) {
                for (let key in shortcuts) {
                    if (shortcuts[key].description) console.log("'" + key + "'\t" + shortcuts[key].description);
                }
            }
        },
        "l": {
            description: "Print last frametime sample",
            f: function(e) {
                console.log(frameTimeGraph.lastSamples[0]);
            }
        },
        "m": {
            description: "Toggle camera auto-move",
            f: function(e) {
                cameraFollowPath = !cameraFollowPath;
            }
        },
        "o": {
            description: "Reset offset optimisation",
            f: function(e) {
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
            f: function(e) {
                camera.moveToStart();
            }
        },
        "s": {
            description: "Save image on main canvas",
            f: function(e) {
                downloadCanvas(canvas, "canvas_image.png", "image/png");
            }
        },
        "u": {
            description: "Update view",
            f: function(e) {
                Object.values(viewManager.views)?.[0].update(0, renderEngine);
            }
        },
        "v": {
            description: "Toggle visiblity of overlay elements",
            f: function(e) {
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
            f: function(e) {
                e.preventDefault();
            }
        },
        "ArrowUp": {
            description: "Increase ray-marching step size",
            f: function(e) {
                var oldStep = renderEngine.rayMarcher.getStepSize();
                var newStep = oldStep * 2;
                console.log("inc step size:", newStep);
                renderEngine.rayMarcher.setStepSize(newStep);
            }
        },
        "ArrowDown": {
            description: "Decrease ray-marchng step size",
            f: function(e) {
                var oldStep = renderEngine.rayMarcher.getStepSize();
                var newStep = oldStep * 0.5;
                console.log("dec step size:", newStep);
                renderEngine.rayMarcher.setStepSize(newStep);
            }
        }
    };

    document.body.addEventListener("keydown", function(e) {
        shortcuts[e.key]?.f(e);
    });

    console.info("Press 'h' for a list of shortcuts");

    var resize = () => {
        var canvasDims = setupCanvasDims(canvas);
        // change camera aspect ratio
        camera.setAspectRatio(canvasDims[0]/canvasDims[1]);
        renderEngine.resizeRenderingContext();
    }
    resize();

    window.addEventListener("resize", resize);

    var lastFrameStart = performance.now();
    var renderLoop = async (timeGap) => {
        var thisFrameStart = performance.now();
        const dt = thisFrameStart - lastFrameStart;
        lastFrameStart = thisFrameStart;

        // update widgets
        frameTimeGraph.update(dt);
        // update the scene
        viewManager.update(dt, renderEngine, cameraFollowPath);

        
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
        
        // next frame
        requestAnimationFrame(renderLoop);
    };
    
    renderLoop();
}

document.body.onload = main;