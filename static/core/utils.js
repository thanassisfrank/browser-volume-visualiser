// utils.js

export var get = (id) => {
    return document.getElementById(id)
}

export var getClass = (className) => {
    return document.getElementsByClassName(className);
}

export var isVisible = (elem) => {
    return getComputedStyle(elem).display.toLowerCase() != "none";
}

export var hide = (elem) => {
    elem.hidden = true;
}

export var show = (elem) => {
    elem.hidden = false;
}

export var getCtx = (canvas, type) => {
    return canvas.getContext(type);
}

export var create = (type) => {
    return document.createElement(type);
}

export var removeAllChildren = (elem) => {
    while (elem.firstChild) {
        elem.removeChild(elem.firstChild);
    }
}

export var setupCanvasDims = (canvas, scale = [1, 1]) => {
    let style = getComputedStyle(canvas)
    canvas.width = Math.round(parseInt(style.getPropertyValue("width"))/scale[0]);
    canvas.height = Math.round(parseInt(style.getPropertyValue("height"))/scale[1]);
    // console.log(canvas.width, canvas.height)
    return [canvas.width, canvas.height];
}

export var repositionCanvas = (canvas) => {
    canvas.style.top = window.scrollY + "px";
    //canvas.style.left = window.scrollX + "px";
    //console.log(window.scrollX)
}

export var getFirstOfClass = (className) => {
    return document.getElementsByClassName(className)[0];
}

export var getInputClassAsObj = (className) => {
    var out = {};
    for (let input of getClass(className)) {
        if ("radio" != input.type || ("radio" == input.type && input.checked)) {
            out[input.name] = input;
        }
    }
    return out;
}

export const sin30 = Math.sin(Math.PI/6);
export const cos30 = Math.cos(Math.PI/6);

export const isoMatrix = [[-cos30, cos30, 0 ],
                   [sin30,  sin30, -1],
				   [0,      0,     0 ]];

export var toRads = (deg) => {
	return deg*Math.PI/180
};

export const clamp = (x, min, max) => {
    return Math.min(Math.max(x, min), max);
};

// takes 1d array and its 3d dimensions and returns 3d array
export var to3dArray = (a, d) => {
    let a3 = []
    for (let i = 0; i < d[0]; i++) {
        a3[i] = [];
        for (let j = 0; j < d[1]; j++) {
            a3[i][j] = [];
            for (let k = 0; k < d[2]; k++) {
                a3[i][j].push(f(i, j, k));
            }
        }
    }
    return a3
}

export function unZipVerts(verts) {
    let vertsOut = [];
    for (let i = 0; i < verts.length; i++) {
        vertsOut.push(verts[i][0])
        vertsOut.push(verts[i][1])
        vertsOut.push(verts[i][2])
    }

    return vertsOut;
}

// return a new id that is not one of the 
export var newId = (obj) => {
    var count = 0;
    let id;
    do {
        id = Math.round(Math.random()*512).toString(16);
        count++;
    } while (obj[id] && count < 1000);
    return id;
}

// replaces every {{key}} in s with replace[key]
export function stringFormat(s, replace) {
    for (const key in replace) {
        s = s.replaceAll("{{"+key+"}}", replace[key])   
    }
    return s;
}

export var stringifyMatrix = (mat, row) => {
    var str = "";
    for (let i = 0; i < mat.length; i++) {
        if (i%row == 0 && i > 0) str += "\n";
        str += mat[i].toPrecision(3) + " ";
    }
    return str;
}

export var hexStringToRGBArray = (hex) => {
    var col = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        col[i] = parseInt(hex.substring(1 + i*2, 3 + i*2), 16)/255;
    }
    return col;
}

export var boxesEqual = (box1, box2) => {
    if (!box1 || !box2) return false;
    return box1.min[0] == box2.min[0] && 
           box1.min[1] == box2.min[1] && 
           box1.min[2] == box2.min[2] && 
           box1.max[0] == box2.max[0] && 
           box1.max[1] == box2.max[1] && 
           box1.max[2] == box2.max[2];
}

export const boxesOverlap = (box1, box2) => {
    return box1.max[0] >= box2.min[0] && box2.max[0] >= box1.min[0] &&
           box1.max[1] >= box2.min[1] && box2.max[1] >= box1.min[1] &&
           box1.max[2] >= box2.min[2] && box2.max[2] >= box1.min[2];
}

export const boxVolume = (box) => {
    return (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * (box.max[2] - box.min[2]); 
}

export var smoothStep = (x) => {
    return (6*x**2 - 15*x**1 + 10)*x**3
}

export const DATA_TYPES = {
    "uint8": Uint8Array,
    "int32": Int32Array,
    "uint32": Uint32Array,
    "int64": BigInt64Array,
    "uint64": BigUint64Array,
    "float32": Float32Array,
    "int16": Int16Array
}

export var clampBetween = (low, val, high) => {
    return Math.max(low, Math.min(val, high));
}
export var clampBox = (box, clampBox) => {
    var newBox = {};
    newBox.left =  clampBetween(clampBox.left,    box.left,   clampBox.right);
    newBox.top =   clampBetween(clampBox.top,     box.top,    clampBox.bottom);
    newBox.right = clampBetween(clampBox.left,   box.right,  clampBox.right);
    newBox.bottom = clampBetween(clampBox.top, box.bottom, clampBox.bottom);
    newBox.width = newBox.right - newBox.left;
    newBox.height = newBox.bottom - newBox.top;

    return newBox;
}
export var floorBox = (box) => {
    var newBox = {};
    newBox.left =   Math.floor(box.left);
    newBox.top =    Math.floor(box.top);
    newBox.right =  Math.floor(box.right);
    newBox.bottom = Math.floor(box.bottom);
    newBox.width = newBox.right - newBox.left;
    newBox.height = newBox.bottom - newBox.top;

    return newBox;
}

// turns file string into an xml dom
export var parseXML = (xmlStr) => {
    var parser = new DOMParser();
    return parser.parseFromString(xmlStr, "text/xml");
}

export var xyzToA = (obj) => {
    return [obj.x, obj.y, obj.z];
}

export var aToXYZ = (a) => {
    return {x: a[0], y:a[1], z:a[2]};
}

export var volume = (arr) => {
    return arr[0]*arr[1]*arr[2];
}

export var getXMLContent = (node) => {
    return node.firstChild.nodeValue;
}

export var rangesOverlap = (range1, range2) => {
    return range1[0] <= range2[1] && range2[0] <= range1[1];
}

// class for keeping a track of times (for benchmarking)
function Timer() {
    this.maxSamples = 600;
    // contains entries of form
    // {
    //     avg: Number,       the mean time
    //     var: Number,       the variance of the samples
    //     stdDev: Number,    the standard deviation
    //     running: Boolean,  if timer is currently running
    //     startTime: Number  time in
    //     samples: [Sample]  past samples
    // }
    //
    // the samples are in the form
    // [Number, Number]       time, data (vert#)
    this.times = {}
    this.start = function(key) {
        if (!this.times[key]) {
            this.times[key] = {
                avg: null, 
                var: null,
                stdDev: null,
                running: false, 
                startTime: null, 
                samples: []
            };
        }
        if (this.times[key].running) {
            this.stop(key);
        }
        this.times[key].startTime = performance.now();
        this.times[key].running = true;
    };
    this.stop = function(key, data) {
        if (this.times[key].running) {
            const t = performance.now() - this.times[key].startTime
            const l = this.times[key].samples.unshift([t, data | "empty"]);
            if (l > this.maxSamples) {
                this.times[key].samples.pop();
            }
            this.times[key].running = false;
        }
    };
    this.calculateAvg = function() {
        for (let key in this.times) {
            const num = this.times[key].samples.length
            if (num == 1) {
                this.times[key].avg = this.times[key].samples[0][0];
            } else {
                const total = this.times[key].samples.reduce((a,b) => a+b[0], 0);
                this.times[key].avg = total/num;
            }
        }
    };
    this.calculateVar = function() {
        for (let key in this.times) {
            const num = this.times[key].samples.length;
            if (num == 1) {
                this.times[key].var = 0;
                this.times[key].stdDev = 0;
                continue;
            }
            const m = this.times[key].avg;
            const sum = this.times[key].samples.reduce((a,b)=> a + Math.pow(b[0] - m, 2), 0);
            this.times[key].var = sum/num;
            this.times[key].stdDev = Math.pow(sum/num, 0.5);

        }
    };
    this.log = function() {
        this.calculateAvg();
        this.calculateVar();
        console.table({...this.times, empty: {avg:undefined}}, ["avg", "stdDev"]);
    }
    this.logSamples = function(key) {
        if (!this.times[key]) return false;
        console.table(this.times[key].samples);
        return this.times[key].samples.length;
    }
    this.copySamples = function(key) {
        if (!this.times[key]) return false;
        let str = "";
        for (let sample of this.times[key].samples) {
            str += sample[1] + "\t" + sample[0] + "\n";
        }
        navigator.clipboard.writeText(str);
        return this.times[key].samples.length;
    }
}

export var timer = new Timer();



// implements the median of medians algorithm to get an approx pivot
// a is the list of elements, k is the approx pivot position
export var pivotMedians = (a) => {
    if (a.length <= 5) {
        return a.sort()[Math.floor(a.length/2) - 1];
    }

    // longer than 5, have to do more steps
    // split into groups of 5 and get the medians of those
    var medians = [];
    for (let i = 0; i < Math.ceil(a.length/5); i++) {
        medians.push(pivotMedians(a.slice(5*i, 5*(i+1))));
    }

    return pivotMedians(medians);
}

// estimate the median from a random sample
export var pivotRandom = (a) => {
    var sampleCount = Math.min(500, a.length);
    var samples = [];
    for (let i = 0; i < sampleCount; i++) {
        samples.push(a[Math.floor(Math.random()*a.length)]);
    }
    return samples.sort()[Math.floor(samples.length/2) - 1];
}

// expects typed array
export var pivotFull = (a) => {
    var sorted = a.sort();
    // console.log(sorted);
    return sorted[Math.floor(a.length/2) - 1];
}
function testPivot() {
    var test = [];
    for (let i = 0; i < 5; i++) {
        test.push(Math.round(Math.random()*1000));
    }

    var median = pivotMedians(test);

    var below = 0;
    var above = 0;
    for (let i = 0; i < test.length; i++) {
        if (test[i] < median) below++;
        if (test[i] > median) above++;
    }
    console.log(below, median, above);
}

// VTK cell types
// Linear cells
// VTK_EMPTY_CELL = 0,
// VTK_VERTEX = 1,
// VTK_POLY_VERTEX = 2,
// VTK_LINE = 3,
// VTK_POLY_LINE = 4,
// VTK_TRIANGLE = 5,
// VTK_TRIANGLE_STRIP = 6,
// VTK_POLYGON = 7,
// VTK_PIXEL = 8,
// VTK_QUAD = 9,
// VTK_TETRA = 10,
// VTK_VOXEL = 11,
// VTK_HEXAHEDRON = 12,
// VTK_WEDGE = 13,
// VTK_PYRAMID = 14,
// VTK_PENTAGONAL_PRISM = 15,
// VTK_HEXAGONAL_PRISM = 16,

// builds a kd tree from a set of cells
// points               a set of d dimensional points (positions)
// cellConnectivity     a set of offsets into points, defining each cell
// cellOffsets          a set of offsets into cellConnectivity, where the point list for each starts; one entry per cell
// cellTypes            a set of values that determines the types each cell(i.e. how many points it has); one entry per cell
// outputs a contiguous binary tree of nodes of the 
export function buildCellKDTree(points, dimensions, depth, cellConnectivity, cellOffsets, cellTypes) {
    var cellsTree = false;
    if (cellConnectivity) cellsTree = true;
    // checks whether the cell of the given id is lte, gt the split val in checked dimension or both
    var checkCellPosition = (id, checkDimension, splitVal) => {
        // first get the points in the cell
        var pointsLength = 0;
        switch (cellTypes[id]) {
            case 10: // tet
                pointsLength = 4;
                break;
            case 12: // hexa
                pointsLength = 8;
                break;
            case 5:  // tri
                pointsLength = 3;
                break;
        }
        var pointsOffset = cellOffsets[id];
        var results = [false, false];
        for (let i = 0; i < pointsLength; i++) {
            // index into the points array
            var thisIndex = cellConnectivity[pointsOffset + i];
            // the position of this point in the dimension that is being checked
            var thisPointValue = points[thisIndex*dimensions + checkDimension];
            if (thisPointValue <= splitVal) results[0] = true;
            if (thisPointValue > splitVal)  results[1] = true;
        }
        return results;
    }

    var nodeQueue = [];
    // make a root node with the whole dataset
    var root = {
        depth: 0,
        splitDimension: 0,
        splitVal: null,
        left: null,
        right: null,
        points: points,
        cells: []
    }
    if (cellsTree) {
        for (let i = 0; i < cellOffsets.length; i++) {
            root.cells.push(i);
        }
    }
    nodeQueue.push(root);

    while (nodeQueue.length > 0) {
        var parentNode = nodeQueue.pop();
        var currentDepth = parentNode.depth + 1;
        // stop the expansion of this node if the tree is deep enough
        if (currentDepth > depth) continue;

        var currentDimension = parentNode.splitDimension;
        var currentPoints = parentNode.points;

        // make a set of points that is just the values in the current dimension
        var thisDimValues = [];
        for (let i = currentDimension; i < currentPoints.length; i += dimensions) {
            // console.log(i);
            thisDimValues.push(currentPoints[i]);
        }
        
        // find the pivot 
        parentNode.splitVal = pivotFull(thisDimValues);
        // console.log(parentNode.splitVal);

        // split the points into left and right
        var leftPoints = [];
        var rightPoints = [];
        for (let i = 0; i < currentPoints.length; i+= dimensions) {
            if (currentPoints[i + currentDimension] <= parentNode.splitVal) {
                // point goes in left
                for (let j = 0; j < dimensions; j++) {
                    leftPoints.push(currentPoints[i + j]);
                }
            } else {
                // point goes in right
                for (let j = 0; j < dimensions; j++) {
                    rightPoints.push(currentPoints[i + j]);
                }
            }
        }

        // split the cells into left and right
        var leftCells = [];
        var rightCells = [];

        if (cellsTree) {
            for (let cellID of parentNode.cells) {
                // see if cell is <= pivot, > pivot or both
                var cellSides = checkCellPosition(cellID, currentDimension, parentNode.splitVal);
                if (cellSides[0]) leftCells.push(cellID);
                if (cellSides[1]) rightCells.push(cellID);
            }
        }

        // create the new left and right nodes
        var nextDimension = (currentDimension + 1) % dimensions;
        var leftNode = {
            depth: currentDepth,
            splitDimension: nextDimension,
            splitVal: null,
            left: null,
            right: null,
            points: leftPoints,
            cells: leftCells
        }
        var rightNode = {
            depth: currentDepth,
            splitDimension: nextDimension,
            splitVal: null,
            left: null,
            right: null,
            points: rightPoints,
            cells: rightCells
        }

        // make sure the parent is properly closed out
        parentNode.cells = null;
        parentNode.points = null;
        parentNode.left = leftNode;
        parentNode.right = rightNode;

        // add children to the queue
        nodeQueue.push(leftNode, rightNode);
    }

    // return the tree object
    return root;
}

// converts a 2D array into a csv formatted string
export function toCSVStr(data, sep=",", endl="\r\n") {
    let str = "";
    for (let row of data) {
        str += row.join(sep) + endl;
    }
    return str;
}

export function downloadCanvas(canvas, fileName, mimeType) {
    try {
        var dlElem = document.createElement('a');
        
        dlElem.download = fileName;
        const image = canvas.toDataURL(mimeType);
        dlElem.href = image;
        dlElem.click();
    
        dlElem.remove();

    } catch (e) {
        console.error(`Unable to download canvas as ${fileName}: ${e}`);
    }
}

export function downloadObject(obj, fileName, mimeType) {
    try {
        var dlElem = document.createElement('a');
        
        dlElem.download = fileName;
        var blob = new Blob([obj], {type: mimeType});
        dlElem.href = window.URL.createObjectURL(blob);
        dlElem.click();
    
        dlElem.remove();
    } catch (e) {
        console.error(`Unable to download ${fileName}: ${e}`);
    }
}