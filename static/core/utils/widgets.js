// widgets.js
// defines visual widgets, drawn to their own canvas which they manage

import { setupCanvasDims } from "./domUtils.js";


export class FrameTimeGraph {
    #canvas;
    #ctx;
    #noLines;
    // the ms at the top of the plot
    #max;
    #historyLength = 100;
    #lastSamples = [];

    // colours
    #bgCol = [0, 0, 0, 0];
    #sampleCol = [200, 200, 200, 255];

    constructor(canvas, max = 100, noLines = false, scale = [1, 1]) {
        this.#canvas = canvas;
        this.#max = max;
        this.#noLines = noLines;
        
        setupCanvasDims(this.#canvas, scale);
        this.#ctx = this.#canvas.getContext("2d", { willReadFrequently: true });
        this.#ctx.fillStyle = "rgba(" + this.#bgCol[0] + "," + this.#bgCol[1] + "," + this.#bgCol[2] + "," + this.#bgCol[3] + ")";
        this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
    }

    storeSample(newSample) {
        this.#lastSamples.unshift(newSample);
        if (this.#lastSamples.length > this.#historyLength) {
            this.#lastSamples.pop();
        }
    }

    // adds a new sample to the graph (ms)
    update(newSample) {
        this.storeSample(newSample);
        // shift old values one pixel to the left
        const oldImg = this.#ctx.getImageData(0, 0, this.#canvas.width, this.#canvas.height);
        this.#ctx.putImageData(oldImg, -1, 0);
        // create new image data for new row
        let newImgData = new Uint8ClampedArray(4 * this.#canvas.height);
        const msPerPixel = this.#max / (this.#canvas.height + 1);
        for (let i = 0; i < newImgData.length / 4; i++) {
            var msThisPixel = (newImgData.length / 4 - (i + 1)) * msPerPixel;
            if (!this.#noLines && 17 <= msThisPixel && 17 > msThisPixel - msPerPixel) {
                // draw 60fps (17ms) line
                newImgData[4 * i + 0] = 0;
                newImgData[4 * i + 1] = 255;
                newImgData[4 * i + 2] = 0;
                newImgData[4 * i + 3] = 255;
            } else if (!this.#noLines && 33 <= msThisPixel && 33 > msThisPixel - msPerPixel) {
                // draw 30fps (33ms) line
                newImgData[4 * i + 0] = 200;
                newImgData[4 * i + 1] = 150;
                newImgData[4 * i + 2] = 0;
                newImgData[4 * i + 3] = 255;
            } else if (newSample >= msThisPixel) {
                newImgData[4 * i + 0] = this.#sampleCol[0];
                newImgData[4 * i + 1] = this.#sampleCol[1];
                newImgData[4 * i + 2] = this.#sampleCol[2];
                newImgData[4 * i + 3] = this.#sampleCol[3];
            } else {
                newImgData[4 * i + 0] = this.#bgCol[0];
                newImgData[4 * i + 1] = this.#bgCol[1];
                newImgData[4 * i + 2] = this.#bgCol[2];
                newImgData[4 * i + 3] = this.#bgCol[3];
            }
        }
        const newImg = new ImageData(newImgData, 1);
        this.#ctx.putImageData(newImg, this.#canvas.width - 1, 0);
    }

    getAverage() {
        let total = 0;
        for (let i = 0; i < this.#lastSamples.length; i++) {
            total += this.#lastSamples[i];
        }
        return total / this.#lastSamples.length;
    }

    copySamples() {
        let str = "";
        for (let sample of this.#lastSamples) {
            str += sample + "\n";
        }
        navigator.clipboard.writeText(str);
    }
}