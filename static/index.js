// index.js
// the main js file for index.html
import {get, getClass, getInputClassAsObj, isVisible, show, hide, downloadCanvas, frameInfoStore} from "./core/utils.js";

import { App, RenderModes } from "./core/app.js";

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
    let renderMode = RenderModes.NONE;
    if (opts.DATA_POINTS) renderMode |= RenderModes.POINTS;
    if (opts.DATA_RAY_VOLUME) renderMode |= RenderModes.RAY_VOLUME;
    if (opts.DATA_WIREFRAME) renderMode |= RenderModes.WIREFRAME;
    if (opts.BOUNDING_WIREFRAME) renderMode |= RenderModes.BOUNDING_BOX;
    if (opts.GEOMETRY) renderMode |= RenderModes.GEOMETRY;

    return renderMode;
}


// define the main function
async function main() {
    const app = new App(get("c"), {frametimeCanvas: get("frame-time-graph")});
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


    // shortcuts
    const shortcuts = {
        " ": {
            description: "Print the camera position and threshold val",
            f: function (e) {
                console.log(app.getViewStates());
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
                console.log(app.getGPUResourcesString());
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
                app.toggleDynamicDatasetUpdates()
            }
        },
        "r": {
            description: "Move camera to initial position",
            f: function (e) {
                app.resetCameras();
            }
        },
        "s": {
            description: "Save image on main canvas",
            f: function (e) {
                downloadCanvas(get("c"), "canvas_image.png", "image/png");
            }
        },
        "t": {
            description: "move focus point",
            f: async function (e) {
                app.viewFocusToMouse()
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