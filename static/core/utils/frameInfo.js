// frameInfo.js
// Exposes an instance of FrameInfoStore to be used by the program for storing diagnostic information about each frame

// a class to store info generate about each frame
class FrameInfoStore {
    #samples = {};
    #currFrameNum = 0;
    #maxSamples;
    fileName;

    constructor(fileName, max) {
        this.fileName = fileName;
        this.#maxSamples = max;
        this.#samples["frame_num"] = new Array(this.#maxSamples);
    }

    #getWriteIndex(num) {
        return num % this.#maxSamples;
    }

    add(name, value) {
        this.addAt(this.#currFrameNum, name, value)
    }

    addAt(num, name, value) {
        if (this.#samples[name] === undefined) {
            this.#samples[name] = new Array(this.#maxSamples)
        }

        this.#samples[name][this.#getWriteIndex(num)] = value;
    }

    // must be called periodically to advance the internal frame that is written to
    nextFrame() {
        this.#currFrameNum++;
        for (let name in this.#samples) {
            this.#samples[name][this.#getWriteIndex()] = undefined;
        }
        this.#samples["frame_num"][this.#getWriteIndex(this.#currFrameNum)] = this.#currFrameNum;
    }

    getFrameNum() {
        return this.#currFrameNum;
    }

    reset() {
        this.#currFrameNum = 0;
        for (let key in this.#samples) {
            this.#samples[key] = new Array(this.#maxSamples);
        }
    }

    export(prefix="") {
        let exportName = this.fileName;
        if (prefix.length > 0) exportName = prefix + "_" + exportName;
        downloadObject(objToCSVStr(this.#samples), exportName, "text/csv");
    }
}

// create instance and export
export const frameInfoStore = new FrameInfoStore("frameInfo.csv", 2000);

// simple class for timing operations
// > can be started and stopped arbitrarily many times
// > will keep a track of the total time spent running
export class StopWatch {
    #elapsed;
    #currStart;
    constructor() {
        this.#elapsed = 0
        this.start()
    }
    start() {
        this.#currStart = performance.now();
    }
    stop() {
        return this.#elapsed += performance.now() - this.#currStart;
    }
}