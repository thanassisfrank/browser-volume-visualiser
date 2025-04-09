// index.js
// the main js file for index.html
import {get, getClass, getInputClassAsObj, isVisible, show, hide, setupCanvasDims, downloadObject, downloadCanvas, frameInfoStore} from "./core/utils.js";

import { App } from "./core/app.js";

import { SceneObjectRenderModes } from "./core/renderEngine/sceneObjects.js";
import { VecMath } from "./core/VecMath.js"
import { KDTreeSplitTypes } from "./core/data/cellTree.js";
import { CornerValTypes } from "./core/data/treeNodeValues.js";


function setupKDTreeOpts() {
    const kdTreeOptions = get("kd-tree-type-select");
    for (let type in KDTreeSplitTypes) {
        const elem = document.createElement("OPTION");
        elem.value = KDTreeSplitTypes[type];                
        elem.innerText = type;
        kdTreeOptions.appendChild(elem);
    }
}


function setupDataOpts(dataConfigs) {
    const dataOptions = get("data-select");
    for (let id in dataConfigs) {
        const elem = document.createElement("OPTION");
        elem.value = id;                
        elem.innerText = dataConfigs[id].name;
        dataOptions.appendChild(elem);
    }
}


function setupCornerOpts() {
    const cornerValOptions = get("corner-val-type-select");
    for (let type in CornerValTypes) {
        var elem = document.createElement("OPTION");
        elem.value = CornerValTypes[type];                
        elem.innerText = type;
        cornerValOptions.appendChild(elem);
    }
}


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


const renderModeFromOpts = (opts) => {
    let renderMode = SceneObjectRenderModes.NONE;
    if (opts.DATA_POINTS) renderMode |= SceneObjectRenderModes.DATA_POINTS;
    if (opts.DATA_RAY_VOLUME) renderMode |= SceneObjectRenderModes.DATA_RAY_VOLUME;
    if (opts.DATA_WIREFRAME) renderMode |= SceneObjectRenderModes.DATA_WIREFRAME;
    if (opts.BOUNDING_WIREFRAME) renderMode |= SceneObjectRenderModes.BOUNDING_WIREFRAME;
    if (opts.GEOMETRY) renderMode |= SceneObjectRenderModes.DATA_MESH_GEOMETRY;

    return renderMode;
}


// define the main function
async function main() {
    const app = new App(get("c"), 1);
    await app.init();

    // setup the options elements
    setupKDTreeOpts();
    setupDataOpts(app.dataConfigs);
    setupCornerOpts();
    
    get("create-view-btn").addEventListener("click", (e) => {
        const d = get("data-select");
        const optsRaw = getInputClassAsObj("dataset-opt");
        const { renderOpts, dataID, dataOpts } = viewOptsFromInputElems(d, optsRaw);
        const renderMode = renderModeFromOpts(renderOpts);
        app.createView({dataID, dataOpts, renderMode});
    });

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
                        var cam = currView.camera;
                        currView.adjustedFocusPoint = VecMath.vecAdd(cam.getEyePos(), VecMath.scalMult(depth, cam.getForwardVec()));
                    }
                })
                .catch(e => {
                    console.warn("Couldn't read ray length tex");
                    console.error(e);
                });
            }
        },
        "e": {
            description: "export scores log",
            f: (e) => {
                const view = viewManager.getFirst();
                const dynamicTree = view.data.dynamicTree;
                dynamicTree.exportScoreLog();
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
                app.startJobs()
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
                if (currView.updateDynamicTree) {
                    // turn update off
                    currView.updateDynamicTree = false;
                    // stop streaming data to ray marcher
                    renderEngine.rayMarcher.noDataUpdates = true;
                } else {
                    // turn update on
                    currView.updateDynamicTree = true;
                    currView.data.dynamicTree.clearScoreLog();
                    renderEngine.rayMarcher.noDataUpdates = false;
                }
                // currView.updateDynamicTree = !currView.updateDynamicTree;
            }
        },
        "r": {
            description: "Move camera to initial position",
            f: function (e) {
                viewManager.getFirst()?.camera.moveToStart();
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


    const renderLoop = async () => {
        await app.update();

        if (0 === app.viewCount) {
            show(get("add-view-container"))
        } else {
            hide(get("add-view-container")); 
        }
        requestAnimationFrame(renderLoop);
    };
    
    renderLoop();
}

document.body.onload = main;