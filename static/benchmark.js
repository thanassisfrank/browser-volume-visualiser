// benchmark.js

export const TEST_BENCHMARK = {
    duration: 4000,
    setState: (t, view) => {
        const cameraPos = [
            t/10 - 200, 
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
    constructor(frametimeStore, view) {
        this.#frametimeStore = frametimeStore;
        this.#view = view;
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
        if (!this.#running || this.#currBenchmark === undefined) {
            return false
        }

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
        this.#frametimeStore.export();
        console.log("**BENCHMARK OVER**")
    }
}