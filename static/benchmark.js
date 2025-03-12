// benchmark.js
import { frameInfoStore } from "./core/utils.js";
import { CornerValTypes } from "./core/data/treeNodeValues.js";

export const TEST_BENCHMARK = {
    duration: 8000,
    setState: (t, view) => {
        const cameraPos = [
            (t-4000)/10, 
            100, 
            100
        ];
        view.camera.setEyePos(cameraPos);
    }
}

// Class that handles automatic benchmarking of the program
// When started, takes control of the view, setting its state
export class Benchmarker {
    #frametimeStore;
    #view;
    #startTime;
    #currBenchmark;
    #running;
    #name = "";
    constructor(frametimeStore, view, name="") {
        this.#frametimeStore = frametimeStore;
        this.#view = view;
        this.#name = name;
    }

    start(t, benchmark) {
        this.#startTime = t;
        this.#frametimeStore.reset();
        this.#currBenchmark = benchmark;

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
        } else {
            this.#currBenchmark.setState(benchTime, this.#view)
        }
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
        dataID: job.dataID,
        dataOpts: {
            dynamicNodes: job.dynamicNodes ?? true,
            dynamicMesh: job.dynamicMesh ?? true,
            dynamicNodeCount: job.dynamicNodeCount ?? 500,
            dynamicMeshBlockCount: job.dynamicMeshBlockCount ?? 100,
            cornerValType: job.cornerValType ?? CornerValTypes.SAMPLE,
            treeletDepth: job.treeletDepth ?? 4,
        },
        renderOpts: {
            DATA_RAY_VOLUME: true,
            BOUNDING_WIREFRAME: true,
        }
    };
}


export class JobRunner {
    #jobs = []
    #currJobIndex = -1;

    #startTime = 0;

    #currView;
    #currBenchmarker;

    #createViewFn;
    #deleteViewFn;

    #renderEngine;

    constructor(jobs, createViewFn, deleteViewFn, renderEngine) {
        this.#jobs = jobs;
        this.#createViewFn = createViewFn;
        this.#deleteViewFn = deleteViewFn;

        this.#renderEngine = renderEngine;
    }

    // begins execution of jobs from beginning
    start(t) {
        console.log("***JOBS STARTED***")
        this.#currJobIndex = -1;
        this.#startTime = t;

        // set render engine parameters
        this.#renderEngine.rayMarcher.setStepSize(2);

        // advance to first job
        this.#advanceJob(t);
    }

    async #advanceJob(t) {
        if (this.#currView !== undefined) {
            // advancing from another job, end old one
            this.#deleteViewFn(this.#currView)
            this.#currView = undefined;
        }
        
        // get next job
        this.#currJobIndex++;
        if (this.#currJobIndex >= this.#jobs.length) {
            // finished all jobs
            return true;
        }

        const job = this.#jobs[this.#currJobIndex];

        const viewOpts = viewOptsFromJob(job);
        // create a name for the output file
        const jobName = `${viewOpts.dataID}_${viewOpts.dataOpts.dynamicNodeCount}_${viewOpts.dataOpts.dynamicMeshBlockCount}`;
        // create view
        this.#currView = await this.#createViewFn(viewOpts);
        console.log(this.#currView)

        // set the iso data array
        
        // set the iso-value

        // run benchmark
        this.#currBenchmarker = new Benchmarker(frameInfoStore, this.#currView, jobName);
        this.#currBenchmarker.start(t, TEST_BENCHMARK);
    }

    async update(t) {
        if (this.#currBenchmarker === undefined) return;
        // there is a benchmarker, continue
        const benchFinished = this.#currBenchmarker.updateState(t);
        if (!benchFinished) return;

        // current benchmark job finished, advance to next
        const finishedJobs = await this.#advanceJob(t);

        if (!finishedJobs) return;
        
        this.#end(t);
    }

    #end(t) {
        this.#currBenchmarker = undefined;
        console.log("***ALL JOBS DONE***");
        console.log(`Jobs took ${t - this.#startTime}`)
    }
}