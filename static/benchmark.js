// benchmark.js
import { downloadCanvas, frameInfoStore, pause } from "./core/utils.js";
import { CornerValTypes } from "./core/data/treeNodeValues.js";
import { VecMath } from "./core/VecMath.js";

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
    #name = "";
    constructor(frametimeStore, view, canvas, name="") {
        this.#frametimeStore = frametimeStore;
        this.#view = view;
        this.#canvas = canvas;
        this.#name = name;
    }

    start(t, benchmark) {
        this.#startTime = t;
        this.#frametimeStore.reset();
        this.#currBenchmark = benchmark;
        this.#screenShotQueue = benchmark.screenshots.slice().sort((a, b) => a - b)
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

        if (this.#screenShotQueue.length > 0 && benchTime > this.#screenShotQueue[0]) {
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
        },
        renderOpts: {
            DATA_RAY_VOLUME: true,
            BOUNDING_WIREFRAME: true,
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
        jobNameParts.push(benchmarkID);

        const jobName = jobNameParts.join("_");

        // create view
        this.#currView = await this.#createViewFn(viewOpts);

        await pause(this.#pauseMS);
        
        // set the iso data array
        await this.#currView.updateIsoSurfaceSrc({
            name: job.isoSrc ?? "Default",
            type: "array",
            arrayType: "data"
        });
        // set the iso-value
        this.#currView.updateThreshold(job.isoVal ?? 0);
        
        // run benchmark
        this.#currBenchmarker = new Benchmarker(
            frameInfoStore, 
            this.#currView, 
            this.#renderEngine.canvas, 
            jobName
        );

        // pause to allow system to settle
        await pause(this.#pauseMS);
        this.#currBenchmarker.start(performance.now(), BENCHMARKS[benchmarkID]);
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