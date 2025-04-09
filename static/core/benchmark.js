// benchmark.js
import { downloadCanvas, frameInfoStore, pause } from "./utils.js";
import { CornerValTypes } from "./data/treeNodeValues.js";
import { VecMath } from "./VecMath.js";


let globalRender;


const BENCHMARKS = {};

BENCHMARKS["test"] = {
    duration: 8000,
    setState: (t, view) => {
        const cameraPos = [
            (t-4000)/10, 
            100, 
            100
        ];
        view.camera.setEyePos(cameraPos);
    }
};

BENCHMARKS["points"] = {
    duration: 10000, // benchmark suration in ms
    screenshots: [ // timestamps to take screenshots in ms since start
        1000,
        4500
    ],
    setState: (t, view) => {
        const mid = view.data.getMidPoint();
        const maxLen = view.data.getMaxLength();
        let relEye;
        if (t < 2000) {
            relEye = VecMath.fromSphericalVals({r: maxLen, el: Math.PI*0.1, az: Math.PI*1.7});
        } else if (t < 4000) {
            relEye = VecMath.fromSphericalVals({r: maxLen*0.5, el: Math.PI*0.2, az: Math.PI*0.3});
        } else if (t < 6000) {
            relEye = VecMath.fromSphericalVals({r: maxLen*1.2, el: Math.PI*-0.3, az: Math.PI*1.3});
        } else {
            relEye = VecMath.fromSphericalVals({r: maxLen*0.3, el: Math.PI*-0.4, az: Math.PI*1.5});
        }
        const cameraPos = VecMath.vecAdd(mid, relEye);
        const currPos = view.camera.getEyePos();
        if (VecMath.magnitude(VecMath.vecMinus(currPos, cameraPos)) > 0.1) {
            view.camera.setEyePos(cameraPos);
        }
    }
};

BENCHMARKS["pointsTurb"] = {
    duration: 30000, // benchmark suration in ms
    setState: (t, view) => {
        let newEye;
        let newTarg;
        if (t < 10000) {
            newEye = [270, 177, 190];
            newTarg = [243, 167, 170];
        } else if (t < 20000) {
            newEye = [7, 303, 365];
            newTarg = [56, 218, 264];
        } else if (t < 25000) {
            newEye = [-17, 138, 12.5];
            newTarg = [26, 132, 29];
        } else {
            newEye = [180, 123, 152];
            newTarg = [136, 124, 136];
        }
        const currPos = view.camera.getEyePos();
        if (VecMath.magnitude(VecMath.vecMinus(newEye, currPos)) > 0.1) {
            view.camera.setEyePos(newEye);
            view.camera.setTarget(newTarg);
        }
    }
};

BENCHMARKS["pointsMag"] = {
    duration: 20000, // benchmark suration in ms
    screenshots: [ // timestamps to take screenshots in ms since start
        1000,
        4500
    ],
    setState: (t, view) => {
        let newEye;
        if (t < 5000) {
            newEye = [300, 300, 800];
        } else if (t < 10000) {
            newEye = [230, 265, 331];
        } else if (t < 15000) {
            newEye = [-25, 270, 162];
        } else {
            newEye = [202, -16, 198];
        }
        const cameraPos = newEye;
        const currPos = view.camera.getEyePos();
        if (VecMath.magnitude(VecMath.vecMinus(currPos, cameraPos)) > 0.1) {
            view.camera.setEyePos(cameraPos);
        }
    }
}

BENCHMARKS["pointsMagSlow"] = {
    duration: 40000, // benchmark suration in ms
    screenshots: [ // timestamps to take screenshots in ms since start
        1000,
        4500
    ],
    setState: (t, view) => {
        let newEye;
        if (t < 20000) {
            newEye = [300, 300, 800];
        } else {
            newEye = [-25, 270, 162];
        }
        const cameraPos = newEye;
        const currPos = view.camera.getEyePos();
        if (VecMath.magnitude(VecMath.vecMinus(currPos, cameraPos)) > 0.1) {
            view.camera.setEyePos(cameraPos);
        }
    }
}

BENCHMARKS["magPicTeaser"] = {
    duration: 125_000,
    screenshots: [118_000, 119_000, 123_000],
    setState: (t, view) => {
        if (t < 1000) {
            globalRender.rayMarcher.setPassFlag("showSurfNodeDepth", false);
            view.camera.setEyePos([270, -35, 327]);
            view.camera.setTarget([236, 42, 273]);
        }


        if (t < 116_000) {
            globalRender.rayMarcher.globalPassInfo.framesSinceMove = 0;
        }

        if (t > 118_500) {
            globalRender.rayMarcher.setPassFlag("showSurfNodeDepth", true);
            globalRender.rayMarcher.noDataUpdates = true
        } else {
            globalRender.rayMarcher.noDataUpdates = false
        }

        // move to far
        if (t > 120_000 && t < 121_000) {
            view.camera.setEyePos([288, 269, 807]);
            view.camera.setTarget([249, 206, 233]);
        }
    }
}

BENCHMARKS["yf17Pic"] = {
    duration: 10_000,
    screenshots: [9_000],
    setState: (t, view) => {
        // move to the screenshot place
        globalRender.rayMarcher.setPassFlag("showSurfNodeDepth", true);
        if (t < 1_000) {
            view.camera.setEyePos([-77, 113, 81]);
            view.camera.setTarget([-13, 38, 15]);
        } else if (t < 5_000) {
            globalRender.rayMarcher.globalPassInfo.framesSinceMove = 0;
        }
    }
}

BENCHMARKS["turbPic"] = {
    duration: 20_000,
    screenshots: [19_000],
    setState: (t, view) => {
        // move to the screenshot place
        globalRender.rayMarcher.setPassFlag("showSurfNodeDepth", true);
        if (t < 1_000) {
            view.camera.setEyePos([174, 249, 168]);
            view.camera.setTarget([118, 190, 123]);
        } else if (t < 15_000) {
            globalRender.rayMarcher.globalPassInfo.framesSinceMove = 0;
        }
    }
}

BENCHMARKS["magPic"] = {
    duration: 103_000,
    screenshots: [98_000, 101_000],
    setState: (t, view) => {
        // move to the screenshot place
        globalRender.rayMarcher.setPassFlag("showSurfNodeDepth", false);
        if (t < 1_000) {
            // view.camera.setEyePos([320, 194, 313]);
            // view.camera.setTarget([297, 197, 289]);
            view.camera.setEyePos([336, 206, 420]);
            view.camera.setTarget([247, 208, 233]);
        } else if (t < 95_000) {
            globalRender.rayMarcher.globalPassInfo.framesSinceMove = 0;
        } 

        if (t > 98_500) {
            globalRender.rayMarcher.setPassFlag("showSurfNodeDepth", true);
        }

    }
}

// Class that handles automatic benchmarking of the program
// When started, takes control of the view, setting its state
export class Benchmarker {
    #frametimeStore;
    #view;
    #canvas;
    #startTime;
    #currBenchmark;
    #screenShotQueue;
    #running;
    #name;
    #noImages;

    constructor(frametimeStore, view, canvas, name="") {
        this.#frametimeStore = frametimeStore;
        this.#view = view;
        this.#canvas = canvas;
        this.#name = name;
    }
    
    start(t, benchmark, noImages=false) {
        this.#startTime = t;
        this.#frametimeStore.reset();
        this.#currBenchmark = benchmark;
        this.#screenShotQueue = benchmark.screenshots?.slice().sort((a, b) => a - b) ?? [];
        this.#noImages = noImages;
        console.log(`**BENCHMARK START FOR ${this.#currBenchmark.duration}MS**`)
        
        this.#running = true;
    }

    // updates the state of the view
    // -> true if still running
    // -> false if ended
    updateState(t) {
        if (!this.#running || this.#currBenchmark === undefined) return true;

        const benchTime = t - this.#startTime;
        if (benchTime > this.#currBenchmark.duration) {
            this.end();
            return;
        }
        if (!this.#noImages && this.#screenShotQueue.length > 0 && benchTime > this.#screenShotQueue[0]) {
            // take a screenshot
            downloadCanvas(this.#canvas, `${this.#name}_t${this.#screenShotQueue[0]}.png`, "image/png")
            this.#screenShotQueue.shift();
        }

        // set view state according to benchmark
        this.#currBenchmark.setState(benchTime, this.#view)
    }

    end() {
        this.#running = false;
        this.#currBenchmark = undefined;
        this.#frametimeStore.export(this.#name);
        console.log("**BENCHMARK OVER**")
    }
}

// the defaults assume that the dataset is a partial cgns
function viewOptsFromJob(job) {
    return {
        dataID: job.data,
        dataOpts: {
            dynamicNodes: job.dynamicNodes ?? false,
            dynamicMesh: job.dynamicMesh ?? true,
            dynamicNodeCount: job.nodes ?? 1000,
            dynamicMeshBlockCount: job.meshes ?? 100,
            cornerValType: job.cornerValType ?? CornerValTypes.SAMPLE,
            treeletDepth: job.treelet ?? 4,
            // node update options
            nodeItersPerFrame: job.nodeIters ?? 1,
            nodeHysteresis: job.nodeHyst ?? true
        },
        renderOpts: {
            DATA_RAY_VOLUME: true,
            BOUNDING_WIREFRAME: false,
        }
    };
}


export class JobRunner {
    // the queue of the generated jobs
    #jobQueue = [];
    #currJobIndex;

    #startTime = 0;

    #currView;
    #currBenchmarker;

    #createViewFn;
    #deleteViewFn;

    #renderEngine;

    #pauseMS;

    #advancing = false;
    #started = false;

    constructor(jobs, createViewFn, deleteViewFn, renderEngine, pauseMS=3000) {
        this.#createViewFn = createViewFn;
        this.#deleteViewFn = deleteViewFn;

        this.#renderEngine = renderEngine;
        //TEMP:
        globalRender = renderEngine;

        this.#pauseMS = pauseMS;

        // expand all of the jobs into individual tasks
        this.#jobQueue = this.#expandJobs(jobs);
        console.log(this.#jobQueue);
    }

    #expandJobs(jobs) {
        let queue = [];
        for (let job of jobs) {
            if (job.ignore) continue;
            let thisTasks = [];
            thisTasks.push({});
            // find which entries have arrays specified
            for (let [key, val] of Object.entries(job)) {
                if (Array.isArray(val)) {
                    // multiply tasks to create one for each option
                    const multTasks = thisTasks.flatMap(origTask => {
                        // have to fill this with some value to be able to use map
                        const newEmptyArr =  Array(val.length).fill(null);
                        const newArr = newEmptyArr.map(() => structuredClone(origTask));
                        newArr.forEach((cloned, index) => cloned[key] = val[index]);
                        return newArr;
                    })
                    thisTasks = multTasks;
                } else {
                    // add as a property of each task
                    thisTasks.forEach(task => task[key] = val)
                }
            }
            queue.push(...thisTasks);
        }
        return queue;
    }

    // begins execution of jobs from beginning
    start(t) {
        console.log("***JOBS STARTED***")
        this.#startTime = t;
        this.#currJobIndex = -1;

        // set render engine parameters
        this.#renderEngine.rayMarcher.setStepSize(2);

        this.#started = true;
    }

    async #startJob(job) {
        const viewOpts = viewOptsFromJob(job);
        // create a name for the output file
        const benchmarkID = job.test ?? "points";
        const jobNameParts = [];
        jobNameParts.push(viewOpts.dataID);
        jobNameParts.push(viewOpts.dataOpts.dynamicNodeCount);
        jobNameParts.push(viewOpts.dataOpts.dynamicMeshBlockCount);
        jobNameParts.push(viewOpts.dataOpts.treeletDepth);
        jobNameParts.push(viewOpts.dataOpts.nodeItersPerFrame);
        jobNameParts.push(viewOpts.dataOpts.nodeHysteresis);
        jobNameParts.push(benchmarkID);

        const jobName = jobNameParts.join("_");



        // create view
        this.#renderEngine.rayMarcher.noDataUpdates = false;
        this.#currView = await this.#createViewFn(viewOpts);
        // this.#currView.camera.setEyePos(this.#currView.data.getMidPoint());

        await pause(this.#pauseMS);
        this.#renderEngine.rayMarcher.noDataUpdates = true;
        
        // set the iso data array
        await this.#currView.updateIsoSurfaceSrc({
            name: job.isoSrc ?? "Default",
            type: "array",
            arrayType: "data"
        });
        // set the iso-value
        this.#currView.updateThreshold(job.isoVal ?? 0);

        // set global render options
        this.#renderEngine.rayMarcher.setPassFlag("contCornerVals", job.contCorn ?? false);
        this.#renderEngine.rayMarcher.setPassFlag("backStep", job.backStep ?? true);
        // initialise camera to centre
        
        // run benchmark
        this.#currBenchmarker = new Benchmarker(
            frameInfoStore, 
            this.#currView, 
            this.#renderEngine.canvas, 
            jobName
        );

        // pause to allow system to settle
        this.#renderEngine.rayMarcher.noDataUpdates = false;
        await pause(this.#pauseMS);
        this.#renderEngine.rayMarcher.noDataUpdates = job.noGPUUpdates ?? false;
        this.#renderEngine.rayMarcher.globalPassInfo.framesSinceMove = 0;
        this.#currBenchmarker.start(performance.now(), BENCHMARKS[benchmarkID], job.noImages);
    }

    async #advanceJob() {
        if (this.#currView !== undefined) {
            // advancing from another job, end old one
            this.#deleteViewFn(this.#currView);
            this.#currView = undefined;
            await pause(this.#pauseMS);
        }
        
        // get next job
        this.#currJobIndex++;
        const newJob = this.#jobQueue[this.#currJobIndex]
        if (this.#currJobIndex >= this.#jobQueue.length) {
            // finished all jobs
            return true;
        }
            

        console.log(`starting job ${this.#currJobIndex}`);
        
        await this.#startJob(newJob)
    }

    async update(t) {
        if (!this.#started) return;
        if (this.#currBenchmarker) {
            // there is a job running, update it
            const benchFinished = this.#currBenchmarker.updateState(t);
            if (!benchFinished) return;
        }
        
        // current benchmark job finished, advance to next
        let finishedJobs = false;
        if (!this.#advancing) {
            this.#advancing = true;
            finishedJobs = await this.#advanceJob(t);
            this.#advancing = false;
        }

        if (!finishedJobs) return;
        
        this.#end(t);
    }

    #end(t) {
        this.#currBenchmarker = undefined;
        this.#started = false;
        console.log("***ALL TASKS DONE***");
        console.log(`Jobs took ${t - this.#startTime}`)
    }
}