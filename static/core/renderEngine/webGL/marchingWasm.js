// marchingWasm.js
// implemetation of marching cubes using c compiled to wasm

export {setupWasm, setupData, generateMeshWasm, setupMarchFine, updateActiveBlocks, updateMarchFineData, generateMeshFineWASM};

const totalMemory = 1073741824;
const maxMemRatio = 0.9;

var WASMModule;

function Buffer(marchData, dataType, length) {
    this.marchData
    this.location;
    this.byteLength = length*dataType.BYTES_PER_ELEMENT;
    this.dataType = dataType;
    this.elementsLength = length;

    this.allocateMem = marchData.functions.allocateBuffer;
    this.freeMem = marchData.functions.freeBuffer;
    this.memory = marchData.memory;
    this.allocated = false;
    // create with given length
    this.allocate = function() {
        this.location = this.allocateMem(this.byteLength);
        this.allocated = true;
    }
    // set location for a buffer created by WASM instance
    this.setLocation = function(location) {
        this.location = location;
        this.allocated = true;
    }
    // write data into it
    this.write = function(data, offset = 0) {
        const dataArray = new this.dataType(marchData.memory.buffer, this.location + offset * this.dataType.BYTES_PER_ELEMENT, data.length);
        dataArray.set(data);
    }
    // read data out of it
    this.read = function(offset = 0, length = this.elementsLength) {
        if (offset >= this.byteLength) {
            return []
        }
        return new this.dataType(this.memory.buffer, this.location + offset * this.dataType.BYTES_PER_ELEMENT, length);
    }
    this.fill = function(x) {
        const dataArray = new this.dataType(marchData.memory.buffer, this.location, this.elementsLength);
        dataArray.fill(x);
    }
    // clear it
    this.free = function() {
        if (this.allocated) this.freeMem(this.location);
        this.allocated = false;
    }

}

const imports = {
    env: {
        console_log_int: function(n) {
            console.log(n);
        },
        console_log_float: function(n) {
            console.log(n);
        },
        console_log_bin: function(n) {
            console.log(n.toString(2));
        }
    }
}  

async function setupWasm() {
    WASMModule = await fetch("core/src/march.wasm")
        .then(response => response.arrayBuffer())
        .then(bytes => WebAssembly.compile(bytes));
};

async function instatiateModule() {
    var marchData = {
        buffers: {},
        arrays: {},
        functions: {}
    };

    var obj = await WebAssembly.instantiate(WASMModule, imports);
    //console.log(obj);
    
    marchData.memory = obj.exports.memory;
    marchData.functions.generateMesh = obj.exports.generateMesh;
    marchData.functions.generateMeshFine = obj.exports.generateMeshFine;
    marchData.functions.getCode = obj.exports.getCode;
    marchData.functions.assignDataLocation = obj.exports.assignDataLocation;
    marchData.functions.assignPointsLocation = obj.exports.assignPointsLocation;
    marchData.functions.getVertsLocation = obj.exports.getVertsLocation;
    marchData.functions.getIndicesLocation = obj.exports.getIndicesLocation;
    marchData.functions.getIndicesCount = obj.exports.getIndicesCount;
    marchData.functions.freeMem = obj.exports.freeMem;

    // memory management functions
    marchData.functions.allocateBuffer = obj.exports.allocateBuffer;
    marchData.functions.freeBuffer = obj.exports.freeBuffer;

    return marchData;

}

async function setupData(dataObj) {
    dataObj.marchData = await instatiateModule();
    // check if there is enough room to store the data (+points)
    var bytesNeeded = dataObj.volume*4;
    if (dataObj.structuredGrid) {
        bytesNeeded *= 4
    }
    if (bytesNeeded/totalMemory > maxMemRatio) {
        // not enough room to store the data and codes on theor own
        console.error("Data setting failed, not enough memory in wasm instance");
        
    } else {
    //send data to wasm object
        
        dataObj.marchData.buffers.data = new Buffer(dataObj.marchData, Float32Array, dataObj.volume);
        dataObj.marchData.buffers.data.allocate();
        dataObj.marchData.buffers.data.write(dataObj.data);


        if (dataObj.structuredGrid) {
            dataObj.marchData.buffers.points = new Buffer(dataObj.marchData, Float32Array, dataObj.volume*3);
            dataObj.marchData.buffers.points.allocate();
            dataObj.marchData.buffers.points.write(dataObj.points);
        }
    };
}

async function setupMarchFine(dataObj) {
    dataObj.marchData = await instatiateModule();
    const fineDataBlockCount = Math.min(dataObj.blocksVol, 2097152)
    dataObj.marchData.fineDataBlockCount = fineDataBlockCount;
    // make fine data
    dataObj.marchData.buffers.fineData = new Buffer(dataObj.marchData, Float32Array, fineDataBlockCount*dataObj.blockVol);
    console.log(dataObj.blockVol);
    dataObj.marchData.buffers.fineData.allocate();
    // make block locations
    dataObj.marchData.buffers.blockLocations = new Buffer(dataObj.marchData, Int32Array, dataObj.blocksVol);
    dataObj.marchData.buffers.blockLocations.allocate();
    dataObj.marchData.buffers.blockLocations.fill(-1);
    console.log(dataObj.marchData.buffers.blockLocations.read());
    // make locations occupied
    dataObj.marchData.arrays.locationsOccupied = new Uint8Array(fineDataBlockCount); // not in WASM instance

    if (dataObj.structuredGrid) {
        dataObj.marchData.buffers.finePoints = new Buffer(dataObj.marchData, Float32Array, fineDataBlockCount*dataObj.blockVol*3);
        dataObj.marchData.buffers.finePoints.allocate();
    }
}

var generateMeshWasm = function(dataObj, meshObj, threshold) {
    var funcs = dataObj.marchData.functions;
    // get the length of the vertices and indices to estimate whether the memory
    const vertsNumber = funcs.generateMesh(
        dataObj.marchData.buffers.data.location,
        dataObj.marchData.buffers?.points?.location,
        ...dataObj.size,
        ...dataObj.cellSize,
        threshold, 
        dataObj.structuredGrid
    );
    const indicesNumber = funcs.getIndicesCount();
    console.log("verts:", vertsNumber);

    var vertBuffer = new Buffer(dataObj.marchData, Float32Array, 3*vertsNumber)
    var indBuffer  = new Buffer(dataObj.marchData, Uint32Array, indicesNumber)
    vertBuffer.setLocation(funcs.getVertsLocation());
    indBuffer.setLocation(funcs.getIndicesLocation());
    meshObj.verts = vertBuffer.read();
    meshObj.indices = indBuffer.read();
    meshObj.vertNum = vertsNumber;
    meshObj.indicesNum = indicesNumber;

    vertBuffer.free();
    indBuffer.free();
}

function updateActiveBlocks(dataObj, activeBlocks) {
    dataObj.marchData.activeBlocksCount = activeBlocks.length;
    console.log("updating active");
    dataObj.marchData.buffers.activeBlocks?.free();

    var activeBuff = new Buffer(dataObj.marchData, Uint32Array, activeBlocks.length);
    activeBuff.allocate();
    activeBuff.write(activeBlocks);

    dataObj.marchData.buffers.activeBlocks = activeBuff;
    console.log("updated active");
    // console.log(dataObj.marchData.buffers.activeBlocks.read());
}

function updateMarchFineData(dataObj, addBlockIDs, removeBlockIDs, newBlockData, newPoints) {
    console.log(addBlockIDs.length, "blocks to home");
    console.log(removeBlockIDs.length, "blocks to remove");
    // console.log(this.emptyLocations.length, "empty locations at start");
    var removed = 0;
    var added = 0;

    // buffer objects
    var fineData = dataObj.marchData.buffers.fineData; 
    var finePoints = dataObj.marchData.buffers.finePoints;
    var blockLocations = dataObj.marchData.buffers.blockLocations;
    // array object
    var locationsOccupied = dataObj.marchData.arrays.locationsOccupied;

    // replace the blocks now
    for (let i = 0; i < removeBlockIDs.length; i++) {
        const oldBlockLoc = blockLocations.read(removeBlockIDs[i], 1)[0];
        // if this block is not actually stored, skip removing it
        if (oldBlockLoc == -1) continue

        // show that this removed block is no longer stored here
        blockLocations.write([-1], removeBlockIDs[i]);

        if (i < addBlockIDs.length) {
            // can replace this old block with a new one
            // overwrite with new block
            for (let j = 0; j < dataObj.blockVol; j++) {

                const blockData = newBlockData.slice(i*dataObj.blockVol, (i+1)*dataObj.blockVol);
                fineData.write(blockData, oldBlockLoc*dataObj.blockVol);

                if (dataObj.structuredGrid) {
                    const blockPoints = newPoints.slice(3*i*dataObj.blockVol, 3*(i+1)*dataObj.blockVol);
                    finePoints.write(blockPoints, 3*oldBlockLoc*dataObj.blockVol);
                }
            }
            blockLocations.write([oldBlockLoc], addBlockIDs[i]);
            added++;
        } else {
            locationsOccupied[oldBlockLoc] = 0;
        }
        removed++;
    }
    
    // console.log(newBlockData);
    // add any extra new blocks
    var checkIndex = 0;
    var foundEmpty = false;
    for (let i = added; i < addBlockIDs.length; i++) {
        foundEmpty = false;
        // search for next empty slot in fine data buffer
        while (checkIndex < dataObj.marchData.fineDataBlockCount && !foundEmpty) {
            if (locationsOccupied[checkIndex] == 0) {
                foundEmpty = true;
            } else {
                checkIndex++;
            }
        }
        if (foundEmpty) {
            const newBlockLoc = checkIndex;

            const blockData = newBlockData.slice(i*dataObj.blockVol, (i+1)*dataObj.blockVol);
            fineData.write(blockData, newBlockLoc*dataObj.blockVol);

            if (dataObj.structuredGrid) {
                const blockPoints = newPoints.slice(3*i*dataObj.blockVol, 3*(i+1)*dataObj.blockVol);
                finePoints.write(blockPoints, 3*newBlockLoc*dataObj.blockVol);
            }

            blockLocations.write([newBlockLoc], addBlockIDs[i]);
            locationsOccupied[newBlockLoc] = 1;
            added++;
        } else {
            console.log(addBlockIDs.length - i, "blocks not homed");
            break;
        }
    }
    // console.log(this.blockVol);
    // console.log(this.fineData);
    // console.log(this.blockLocations);
    console.log(added, "blocks added");
    console.log(removed, "blocks removed");
    // console.log(this.emptyLocations.length, "empty locations at end");

    // console.log(dataObj.marchData.buffers.blockLocations.read());
}

function generateMeshFineWASM (dataObj, meshObj, threshold) {
    console.log("generating mesh");
    console.log(dataObj.blocksSize);
    var funcs = dataObj.marchData.functions;
    // get the length of the vertices and indices to estimate wether the memory
    const vertsNumber = funcs.generateMeshFine(
        dataObj.marchData.buffers.fineData.location,
        dataObj.marchData.buffers?.finePoints?.location,
        ...dataObj.blocksSize,
        ...dataObj.size,
        dataObj.marchData.buffers.activeBlocks.location,
        dataObj.marchData.buffers.activeBlocks.elementsLength,
        dataObj.marchData.buffers.blockLocations.location,
        ...[1, 1, 1],
        threshold, 
        dataObj.structuredGrid
    );

    const indicesNumber = funcs.getIndicesCount();
    console.log("verts:", vertsNumber);

    var vertBuffer = new Buffer(dataObj.marchData, Float32Array, 3*vertsNumber)
    var indBuffer  = new Buffer(dataObj.marchData, Uint32Array, indicesNumber)
    vertBuffer.setLocation(funcs.getVertsLocation());
    indBuffer.setLocation(funcs.getIndicesLocation());

    meshObj.verts = vertBuffer.read();
    meshObj.indices = indBuffer.read();
    meshObj.vertNum = vertsNumber;
    meshObj.indicesNum = indicesNumber;

    vertBuffer.free();
    indBuffer.free();
}