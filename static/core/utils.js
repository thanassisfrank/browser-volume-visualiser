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
    elem.classList.add("hidden");
    // elem.style.display = "none";
}

export var show = (elem) => {
    elem.classList.remove("hidden");
    // elem.style.display = "block";
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

export var setupCanvasDims = (canvas) => {
    let style = getComputedStyle(canvas)
    canvas.width = parseInt(style.getPropertyValue("width"));
    canvas.height = parseInt(style.getPropertyValue("height"));
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
        out[input.name] = input;
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

// returns the ranges that need to be added/removed to convert range1 -> range2
export var getRangeDeltas = (range1, range2) => {
    var add = [];
    var remove = [];
    
    // check if there is any overlap between the ranges
    if (rangesOverlap(range1, range2)) {
        if (range1[0] < range2[0]) {
            // left end needs to be cut
            remove.push({
                range: [range1[0], range2[0]],
                exclusive: [false, true]
            })
        } else if (range1[0] > range2[0]) {
            // left end needs to be added
            add.push({
                range: [range2[0], range1[0]],
                exclusive: [false, true]
            })
        }
        if (range1[1] > range2[1]) {
            // right end needs to be cut
            remove.push({
                range: [range2[1], range1[1]],
                exclusive: [true, false]
            })
        } else if (range1[1] < range2[1]) {
            // right end needs to be added
            add.push({
                range: [range1[1], range2[1]],
                exclusive: [true, false]
            })
        }
    } else {
        // if (range1[0] < range2[0]) {
        //     // range 1 is entirely to left
        //     add.push({range: range2, exclusive: [false, false]});
        //     remove.push({range: [range1[0], range2[0]], exclusive: [false, true]});
        // } else {
        //     // range 1 is entirely to the right
        //     add.push({range: range2, exclusive: [false, false]});
        //     remove.push({range: [range2[1], range1[1]], exclusive: [true, false]});
        // }
        add.push({range: range2, exclusive: [false, false]});
        remove.push({range: range1, exclusive: [false, false]});
        
    }
    return {add: add, remove: remove}; 
}

const child = {
    LEFT: 0, 
    RIGHT: 1
}

// interval tree data structure
export function OldIntervalTree(range) {
    this.range = range;
    // the tree consists of connected nodes each of form
    // {
    //     parent: node            reference to its parent node
    //     childType: child enum   if this node is l or r child
    //     val: float              the value that all the ranges within contain
    //     al: [ranges]            the ranges sorted by ascending left value
    //     dr: [ranges]            the ranges sorted by descending right value
    //     left: node              the left child node
    //     right: node             the right child node
    // }
    this.tree = {
        parent: null,
        childType: null,
        val: (range[0] + range[1])/2,
        al: [],
        dr: [],
        left: null,
        right: null,
    };
    this.insert = function(range, data) {
        // start at root node
        // if val intersects the range
        //   sort into al and dr
        // else if val < left of range
        //   move to right child (create if you have to)
        // else
        //   move to left child (create if you have to)

        let currNode = this.tree;
        var inserted = false;
        while (!inserted) {
            const val = currNode.val;
            if (val > range[0] && val < range[1]) {
                // found correct node
                const payload = [range[0], range[1], data];
                // simple linear insertion for now
                // sort into al
                if (currNode.al.length == 0) {
                    currNode.al.push(payload);
                } else {
                    for (let i = 0; i < currNode.al.length; i++) {
                        if (currNode.al[i][0] > payload[0]) {
                            currNode.al.splice(i, 0, payload);
                            break;
                        } else if (i == currNode.al.length - 1) {
                            currNode.al.push(payload);
                            break;
                        }
                    }
                }
                // sort into dr
                if (currNode.dr.length == 0) {
                    currNode.dr.push(payload);
                } else {
                    for (let i = 0; i < currNode.dr.length; i++) {
                        if (currNode.dr[i][1] < payload[1]) {
                            currNode.dr.splice(i, 0, payload);
                            break;
                        } else if (i == currNode.dr.length - 1) {
                            currNode.dr.push(payload);
                            break;
                        }
                    }
                }
                inserted = true;
            } else if (val < range[0]) {
                // move to right child
                currNode = this.getOrCreateRightChild(currNode);
            } else {
                // move to left child
                currNode = this.getOrCreateLeftChild(currNode);
            }
        }
    }
    this.queryVal = function(qVal) {
        let out = [];
        let currNode = this.tree;
        var complete = false;
        while (!complete) {
            if (qVal == currNode.val) {
                out.push(...currNode.al.map((v, i, a) => v[2]));
                complete = true;
            } else if (qVal > currNode.val) {
                // look through dr list
                for (let i = 0; i < currNode.dr.length; i++) {
                    if (currNode.dr[i][1] >= qVal) {
                        out.push(currNode.dr[i][2]);
                    } else {
                        break;
                    }
                }
                if (currNode.right != null) {
                    // move to right child
                    currNode = currNode.right;
                } else {
                    // no right child, done
                    complete = true;
                }
            } else {
                // look through al list
                for (let i = 0; i < currNode.al.length; i++) {
                    if (currNode.al[i][0] <= qVal) {
                        out.push(currNode.al[i][2]);
                    } else {
                        break;
                    }
                }
                if (currNode.left != null) {
                    // move to left child
                    currNode = currNode.left;
                } else {
                    // no left child, done
                    complete = true;
                }
            }
        }
        return out;
    }
    this.queryRange =  function(range) {
        let out = {};
        var addToOut = (val) => {
            if (!out[val]) {
                out[val] = true;
                return true;
            } 
            return false;
        };
        var completeLeft = false;
        var completeRight = false;

        // find all the intervals where:
        // > left >= query left or right <= query right
        // i.e.
        // > has to contain one of the endpoints or be in-between
        
        // look for intervals that intersect with the left end
        let currNode = this.tree;
        var qVal = range[0];
        while (!completeLeft) {
            if (qVal == currNode.val) {
                for (let entry of currNode.al.map((v, i, a) => v[2])) {
                    addToOut(entry);
                }
                completeLeft = true;
            } else if (qVal > currNode.val) {
                // look through dr list
                for (let i = 0; i < currNode.dr.length; i++) {
                    if (currNode.dr[i][1] >= qVal) {
                        addToOut(currNode.dr[i][2]);
                    } else {
                        break;
                    }
                }
                if (currNode.right != null) {
                    // move to right child
                    currNode = currNode.right;
                } else {
                    // no right child, done
                    completeLeft = true;
                }
            } else {
                // look through al list
                for (let i = 0; i < currNode.al.length; i++) {
                    if (currNode.al[i][0] <= qVal) {
                        addToOut(currNode.al[i][2]);
                    } else {
                        break;
                    }
                }
                if (currNode.left != null) {
                    // move to left child
                    currNode = currNode.left;
                } else {
                    // no left child, done
                    completeLeft = true;
                }
            }
        }
        // look for intervals that intersect the right end
        currNode = this.tree;
        qVal = range[1];
        while (!completeRight) {
            if (qVal == currNode.val) {
                for (let entry of currNode.al.map((v, i, a) => v[2])) {
                    addToOut(entry);
                }
                completeRight = true;
            } else if (qVal > currNode.val) {
                // look through dr list
                for (let i = 0; i < currNode.dr.length; i++) {
                    if (currNode.dr[i][1] >= qVal) {
                        addToOut(currNode.dr[i][2]);
                    } else {
                        break;
                    }
                }
                if (currNode.right != null) {
                    // move to right child
                    currNode = currNode.right;
                } else {
                    // no right child, done
                    completeRight = true;
                }
            } else {
                // look through al list
                for (let i = 0; i < currNode.al.length; i++) {
                    if (currNode.al[i][0] <= qVal) {
                        addToOut(currNode.al[i][2]);
                    } else {
                        break;
                    }
                }
                if (currNode.left != null) {
                    // move to left child
                    currNode = currNode.left;
                } else {
                    // no left child, done
                    completeRight = true;
                }
            }
        }
        // add all the ones inbetween


        return Object.keys(out);
    }
    this.getOrCreateLeftChild = function(node) {
        if (node.left) return node.left;
        // create a left child
        // find the range its value should be the median of
        var range = [undefined, node.val];
        let currNode = node;
        var found = false;
        while (!found) {
            if (currNode.childType == child.RIGHT && currNode.parent) {
                found = true;
                range[0] = currNode.parent.val;
            } else if (currNode.parent === null) {
                range[0] = this.range[0];
                found = true;
            } else {
                currNode = currNode.parent;
            }
        }
        node.left = {
            parent: node,
            childType: child.LEFT,
            val: (range[0] + range[1])/2,
            al: [],
            dr: [],
            left: null,
            right: null,
        }

        return node.left;

    }
    this.getOrCreateRightChild = function(node) {
        if (node.right) return node.right;
        // create a left child
        // find the range its value should be the median of
        var range = [node.val, undefined];
        let currNode = node;
        var found = false;
        while (!found) {
            if (currNode.childType == child.LEFT && currNode.parent) {
                found = true;
                range[1] = currNode.parent.val;
            } else if (currNode.parent === null) {
                range[1] = this.range[1];
                found = true;
            } else {
                currNode = currNode.parent;
            }
        }
        node.right = {
            parent: node,
            childType: child.RIGHT,
            val: (range[0] + range[1])/2,
            al: [],
            dr: [],
            left: null,
            right: null,
        }
        
        return node.right;
    }
}

// implementation modified from https://www.geeksforgeeks.org/interval-tree/
// and https://www.geeksforgeeks.org/avl-tree-set-1-insertion/
export function IntervalTree() {
    // the tree consists of connected nodes each of form
    // {
    //     parent: node             reference to its parent node
    //     range: [Number, Number]  the interval of this node
    //     min: Number              the min low value in this node's subtree
    //     max: Number              the max high value in this node's subtree
    //     data: Any                stored data for this node
    //     left: node               the left child node
    //     right: node              the right child node
    // }
    this.tree = null;
    this.leaf = (parent, range, data) => {
        return {
            parent: parent,
            range: range,
            min: range[0],
            max: range[1],
            data: data,
            left: null,
            right: null,
            height: 1
        }
    }
    this.getHeight = (node) => {
        if (node) return node.height;
        return 0;
    }
    this.getBalance = function(node) {
        if (!node) return 0;
        return this.getHeight(node.left) - this.getHeight(node.right);
    }

    this.rightRotate = function(y) {
        var x = y.left;
        var T2 = x.right;
    
        // Perform rotation
        x.right = y;
        y.left = T2;
    
        // Update heights
        y.height = Math.max(this.getHeight(y.left), this.getHeight(y.right)) + 1;
        x.height = Math.max(this.getHeight(x.left), this.getHeight(x.right)) + 1;

        //update the min/max too
        y.max = Math.max(y.max, y.left?.max | 0, y.right?.max | 0);
        y.min = Math.min(y.min, y.left?.min | 0, y.right?.min | 0);
        x.max = Math.max(x.max, x.left?.max | 0, x.right?.max | 0);
        x.min = Math.min(x.min, x.left?.min | 0, x.right?.min | 0);
    
        // Return new root
        return x;
    }
    this.leftRotate = function(x) {
        var y = x.right;
        var T2;
        try {
            T2 = y.left;
        } catch (e) {
            console.log(x);
        }
    
        // Perform rotation
        y.left = x;
        x.right = T2;
    
        // Update heights
        x.height = Math.max(this.getHeight(x.left), this.getHeight(x.right)) + 1;
        y.height = Math.max(this.getHeight(y.left), this.getHeight(y.right)) + 1;

        //update the min/max too
        y.max = Math.max(y.max, y.left?.max | 0, y.right?.max | 0);
        y.min = Math.min(y.min, y.left?.min | 0, y.right?.min | 0);
        x.max = Math.max(x.max, x.left?.max | 0, x.right?.max | 0);
        x.min = Math.min(x.min, x.left?.min | 0, x.right?.min | 0);
    
        // Return new root
        return y;
    }
    // currently this is just a bst insertion
    // could be converted to an avl tree to maintain balance
    this.insertOld = function(range, data) {
        if (this.tree == null) {
            // first node in tree
            this.tree = this.leaf(null, range, data);
            return;
        }

        // insert node in correct place
        let currentNode = this.tree;
        var inserted = false;
        while (!inserted) {
            // update max of currentNode
            currentNode.max = Math.max(currentNode.max, range[1]);
            currentNode.min = Math.min(currentNode.min, range[0]);
            if (currentNode.range[0] > range[0]) {
                // go to left child
                if (currentNode.left != null) {
                    currentNode = currentNode.left;
                } else {
                    currentNode.left = this.leaf(currentNode, range, data);
                    inserted = true;
                }
            } else {
                // go to right child
                if (currentNode.right != null) {
                    currentNode = currentNode.right;
                } else {
                    currentNode.right = this.leaf(currentNode, range, data);
                    inserted = true;
                }
            }
        }
    }

    this.insert = function(range, data) {
        this.tree = this.insertNode(this.tree, this.leaf(null, range, data));
    }

    // insert the given new node into the subtree of the node somewhere
    this.insertNode = function(node, newNode) {
        /* 1. Perform the normal BST insertion */
        if (!node) return newNode;
        
        node.max = Math.max(node.max, newNode.range[1]);
        node.min = Math.min(node.min, newNode.range[0]);
    
        if (newNode.range[0] < node.range[0]) {
            node.left = this.insertNode(node.left, newNode);
        } else {
            node.right = this.insertNode(node.right, newNode);
        }
    
        /* 2. Update height of this ancestor node */
        node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));
    
        /* 3. Get the balance factor of this ancestor
            node to check whether this node became
            unbalanced */
        const balance = this.getBalance(node);
    
        // If this node becomes unbalanced, then
        // there are 4 cases
    
        // Left Left Case
        if (balance > 1 && newNode.range[0] < node.left.range[0]) {
            return this.rightRotate(node);
        }
    
        // Right Right Case
        if (balance < -1 && newNode.range[0] >= node.right.range[0]){
            return this.leftRotate(node);
        }
        // Left Right Case
        if (balance > 1 && newNode.range[0] >= node.left.range[0]) {
            node.left = this.leftRotate(node.left);
            return this.rightRotate(node);
        }
    
        // Right Left Case
        if (balance < -1 && newNode.range[0] < node.right.range[0]) {
            node.right = this.rightRotate(node.right);
            return this.leftRotate(node);
        }
    
        /* return the (unchanged) node pointer */
        return node;
    }

    // checks whether there is overlap between two ranges
    // exclusive applies to the endpoints of range 1
    // if exclusive is true in either slot, overlap will be false if range2 contains that endpoint
    // of range 1
    this.overlap = (range1, range2, exclusive) => {
        // this is the base case that all overlaps satisfy
        if (range1[0] <= range2[1] && range2[0] <= range1[1]) {
            var satisfies = [true, true];
            if (exclusive[0] && range2[0] <= range1[0]) satisfies[0] = false;
            if (exclusive[1] && range2[1] >= range1[1]) satisfies[1] = false;

            return satisfies[0] && satisfies[1];
        }
        return false;
    }
    //
    this.queryRange = function(range, exclusive = [false, false]) {
        var out = [];
        if (this.tree == null) {
            return out;
        }
        this.findOverlaps(this.tree, range, exclusive, out);
        return out;
    }
    // traverse tree, finding all the ranges that fit (recursive)
    this.findOverlaps = function(currentNode, range, exclusive, out) {
        if (this.overlap(range, currentNode.range, exclusive)) {
            out.push(currentNode.data);
        }
        // go to left if can
        if (currentNode.left != null && currentNode.left.max >= range[0]) {
            this.findOverlaps(currentNode.left, range, exclusive, out);
        }
        // then go right if you can
        if (currentNode.right != null && currentNode.right.min <= range[1]) {
            this.findOverlaps(currentNode.right, range, exclusive, out);
            
        }
    }
    this.queryVal = function(val) {
        return this.queryRange([val, val], [false, false]);
    }

    // returns string like
    // `
    // A [0.3, 2.4] + B [0.4, 0.6] + E [1.2, 4.5]
    //                             + F [0.3, 3.2]
    //              + C [4.0, 10.] + D [3.1, 7.2] 
    // `                           
    this.toString = function() {
        var out = [];
        var valLength = 1; // in chars
        var rangeLength = 2*valLength + 4; // in chars
        var currNode = this.tree;
        var currLine = 0;
        var currDepth = 0;
        // go 
        this.addNodeToString(this.tree, out, currDepth, valLength, rangeLength, true);
        

        return out.join("");
    }
    this.addNodeToString = function(node, out, currDepth, valLength, rangeLength, isRight) {
        // add the current node
        var thisString = node.data.toString()[0] + " " + this.stringRange(node.range, valLength);
        if (currDepth > 0) {
            thisString = " + " + thisString;
        }
        if (!isRight) {
            // add padding and pipes
            for (let i = 0; i < currDepth; i++) {
                if (i > 0) thisString = "   " + thisString;
                thisString = " ".repeat(rangeLength + 2) + thisString;
            }
            // as newline
            thisString = "\n" + thisString;
        }
        out.push(thisString);

        // go right if you can
        if (node.right != null) {
            this.addNodeToString(node.right, out, currDepth + 1, valLength, rangeLength, true);
            
        }
        // then go left
        if (node.left != null) {
            this.addNodeToString(node.left, out, currDepth + 1, valLength, rangeLength, false);
        }

    }
    this.stringRange = function(range, valLength) {
        return "[" 
            + range[0].toString().slice(0, valLength)
            + ", "
            + range[1].toString().slice(0, valLength)
            + "]";
            
    }
}

export function SimpleList() {}

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
    // make a root node with the whols dataset
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

export function buildCellKDTreeArray(points, dimensions, depth, cellConnectivity, cellOffsets, cellTypes) {
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
    // make a root node with the whols dataset
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