// widgets.js
// defines a set of prototypes for creating different widgets
// each is drawn to their own canvas which they manage

import { setupCanvasDims } from "./core/utils.js";
import { mat4 } from "./core/gl-matrix.js"



export function FrameTimeGraph(canvas, max = 100, noLines = false, scale = [1, 1]) {
    this.canvas = canvas;
    this.noLines = noLines;
    // the ms at the top of the plot
    this.max = max;
    this.historyLength = 100;
    this.lastSamples = [];
    
    // colours
    this.bgCol = [0, 0, 0, 0];
    this.sampleCol = [200, 200, 200, 255];
    this.init = function () {
        setupCanvasDims(this.canvas, scale);
        this.ctx = canvas.getContext("2d", {willReadFrequently: true});
        this.ctx.fillStyle = "rgba(" + this.bgCol[0] + "," + this.bgCol[1] + "," + this.bgCol[2] + "," + this.bgCol[3] + ")";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.storeSample = function(newSample) {
        this.lastSamples.unshift(newSample);
        if (this.lastSamples.length > this.historyLength) {
            this.lastSamples.pop()
        }
    }
    // adds a new sample to the graph (ms)
    this.update = function(newSample) {
        this.storeSample(newSample);
        // shift old values one pixel to the left
        var oldImg = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.putImageData(oldImg, -1, 0);
        // create new image data for new row
        var newImgData = new Uint8ClampedArray(4*this.canvas.height);
        var msPerPixel = this.max/(this.canvas.height + 1);
        for (let i = 0; i < newImgData.length/4; i++) {
            var msThisPixel = (newImgData.length/4 - (i + 1))*msPerPixel;
            if (!this.noLines && 17 <= msThisPixel && 17 > msThisPixel - msPerPixel ) {
                // draw 60fps (17ms) line
                newImgData[4*i + 0] = 0;
                newImgData[4*i + 1] = 255;
                newImgData[4*i + 2] = 0;
                newImgData[4*i + 3] = 255;
            } else if (!this.noLines && 33 <= msThisPixel && 33 > msThisPixel - msPerPixel) {
                // draw 30fps (33ms) line
                newImgData[4*i + 0] = 200;
                newImgData[4*i + 1] = 150;
                newImgData[4*i + 2] = 0;
                newImgData[4*i + 3] = 255;
            } else if (newSample >= msThisPixel) {
                newImgData[4*i + 0] = this.sampleCol[0];
                newImgData[4*i + 1] = this.sampleCol[1];
                newImgData[4*i + 2] = this.sampleCol[2];
                newImgData[4*i + 3] = this.sampleCol[3];
            } else {
                newImgData[4*i + 0] = this.bgCol[0];
                newImgData[4*i + 1] = this.bgCol[1];
                newImgData[4*i + 2] = this.bgCol[2];
                newImgData[4*i + 3] = this.bgCol[3];
            }
        }
        var newImg = new ImageData(newImgData, 1);
        this.ctx.putImageData(newImg, this.canvas.width - 1, 0);
    }

    this.getAverage = function() {
        var total = 0;
        for (let i = 0; i < this.lastSamples.length; i++) {
            total += this.lastSamples[i];
        }
        return total/this.lastSamples.length;
    }

    this.copySamples = function() {
        var str = "";
        for (let sample of this.lastSamples) {
            str += sample + "\n";
        }
        navigator.clipboard.writeText(str);
    }

    this.init();
}

export function AxesWidget(canvas, scale) {
    this.canvas = canvas;
    this.ctx;
    // initialise the canvas
    this.init = function() {
        setupCanvasDims(this.canvas, scale);
        this.ctx = this.canvas.getContext("2d");
    }
    // update the axes display
    this.update = function(viewMat) {
        // use mat4 to calculate the positions of the vectors of the widget
    }
}