// main.js

import {get, isVisible, show, hide, removeAllChildren, setupCanvasDims, repositionCanvas, parseXML, IntervalTree, OldIntervalTree, timer} from "./core/utils.js";

import {dataManager} from "./core/data/data.js";
import { createRenderEngine } from "./core/renderEngine/renderEngine.js";
import {cameraManager, meshManager} from "./core/renderEngine/sceneObjects.js";
import { marcherManager } from "./core/renderEngine/webGL/marcher.js";
import { viewManager } from "./view.js";
import { renderModes } from "./core/renderEngine/renderEngine.js";

// autoSetMarchModule();
// autoSetRenderModule();

const BLOCKS = 10;
const functionalDatasets = {
    ripple: {
        name: "Ripple",
        size: {
            x:221,
            y:221,
            z:100,
        },
        cellSize: {
            x: 1,
            y: 1,
            z: 1
        }, 
        type: "raw",       
        f: (i, j, k) => {
            const dist = Math.sqrt(Math.pow((i-110)/3, 2) + Math.pow((j-110)/3, 2));
            return 250-(k-Math.cos(dist/2)*0.5*k*Math.pow(1.03, -dist));
        }
    },
    cylinder: {
        name: "Generated Cylinder",
        type: "structuredGrid",
        blocks: BLOCKS,
        
        f: (block) => {
            let limits = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
            const size = {
                th: 60, // around cylinder
                y: 100, // down cylinder axis
                r: 60, // outwards from centre
            };
            // make list of positions
            var points = [];
            var data = [];
            let x, y, z, v;
            for (let i = 0; i < size.th/BLOCKS + 1; i++) {
                for (let j = 0; j < size.y; j++) {
                    for (let k = 0; k < size.r; k++) {
                        x = (k+3)*Math.sin(2*Math.PI * (i/size.th + block/BLOCKS));
                        y = (k+3)*Math.cos(2*Math.PI * (i/size.th + block/BLOCKS));
                        z = j;
                        v = k + 3*Math.cos(j/2);
                        points.push(x, y, z);
                        data.push(v);
                        limits[0] = Math.min(limits[0], v);
                        limits[1] = Math.max(limits[1], v);
                    }
                }
            }

            return {
                size: [size.th/BLOCKS + 1, size.y, size.r],
                data: Float32Array.from(data),
                points: Float32Array.from(points),
                limits: limits
            }

        }
    }
}

document.body.onload = main;

async function main() {
    var canvas = get("c");
    setupCanvasDims(canvas);

    // create a new rendering engine
    var renderEngine = await createRenderEngine(canvas);
    await renderEngine.setup();
    await renderEngine.marchingCubes.setupMarchModule();
    await renderEngine.rayMarcher.setupEngine();


    const datasets = await fetch("/data/datasets.json")
        .then((res) => res.json())
        .then(d => {return {...d, ...functionalDatasets}});
    // setup data manager with these
    dataManager.setConfigSet(datasets);
    // dataManager.setMarchEngine(renderEngine.marchingCubes);

    // await setupMarchModule();
    // var ctx = await setupRenderer(canvas); 
    

    document.body.onresize = function() {
        setupCanvasDims(canvas);
        renderEngine.resizeRenderingContext();
    }
    var waiting = false;
    document.body.onscroll = function() {
        if (!waiting) {
            waiting = true;
            setTimeout(() => {
                repositionCanvas(canvas);
                waiting = false;
            }, 50);
        }
    }

    // setup the view creation window button
    get("add-view").onclick = function() {
        var addViewPopup = get("add-view-popup");
        var dataOptions = get("data-select");
        var cameraOptions = get("camera-select");
        var thresholdOptions = get("threshold-select");

        if (isVisible(addViewPopup)) {
            // hide if its shown
            console.log("hiding...");
            hide(addViewPopup);
            get("add-view").innerText = "+";

            // remove all the options from within each
            removeAllChildren(dataOptions);
            removeAllChildren(cameraOptions);
            removeAllChildren(thresholdOptions);

        } else {
            console.log("showing...");
            get("add-view").innerText = "X";
            
            // pull the current options from the camera manager
            var currentCameras = cameraManager.cameras;
            for (let id in currentCameras) {
                var elem = document.createElement("OPTION");
                elem.value = id;
                elem.innerText = id;
                cameraOptions.appendChild(elem);
            }

            for (let id in dataManager.configSet) {
                var elem = document.createElement("OPTION");
                elem.value = id;                
                elem.innerText = dataManager.configSet[id].name;
                dataOptions.appendChild(elem);
            }
            
            show(addViewPopup);
        }
    }

    get("create-view-btn").onclick = async function() {
        var d = get("data-select");
        var c = get("camera-select");
        //var thresholdOptions = get("threshold-select");

        const selectedDataElem = d.options[d.selectedIndex];
        const selectedCameraElem = c.options[c.selectedIndex];

        var newData = await dataManager.getDataObj(selectedDataElem.value);

        var newView = await viewManager.createView({
            camera: cameraManager.createCamera(),
            data: newData,
            renderMode: renderModes.ISO_SURFACE
        });

        // make wireframe
        newView.dataRenderObj.children.push(renderEngine.createWireframeBox(newData.getDatasetBoundaryPoints()));
        newView.scene.unshift(renderEngine.createAxes(20));

        // hide the window
        if (isVisible(get("add-view-popup"))) get("add-view").click();
    }

    document.body.addEventListener("keydown", function(e) {
        switch (e.key) {
            case " ":
                // centre the camera on all views
                
                break;
            case "Alt":
                e.preventDefault();
                break;
        }
    });
    
    var renderLoop = async (lastFrameEnd) => {
        const dt = performance.now() - lastFrameEnd;

        // update the objects
        // does stuff like propagating threshold value, fetching required data
        viewManager.update(dt, renderEngine.marchingCubes);

        // render the scenes
        // includes doing marching cubes/ray marching if required by object
        // renderEngine.clearScreen();
        for (let view of Object.values(viewManager.views)) {
            await renderEngine.renderView(view);
        }

        // next frame
        requestAnimationFrame(renderLoop);
        // setTimeout(() => {requestAnimationFrame(renderLoop)}, 3000);
    };
    renderLoop();
}