// cache.js
// implements a prototypes for handling caches

// fixed-size, fully associative cache
export class AssociativeCache {
    buffers = {};
    blockSizes = {};
    directory = new Map(); // tag -> slotNum

    // functions to read/write to the buffers
    readFuncs = {
        default: (buff, slotNum, blockSize) => {
            buff.slice(slotNum * blockSize, (slotNum + 1) * blockSize);
        }
    }
    writeFuncs = {
        default: (buff, data, slotNum, blockSize) => {
            buff.set(data, blockSize * slotNum);
        }
    };

    constructor(slotCount) {
        this.slotCount = slotCount;
        this.tags = new Array(slotCount); // slotNum -> tag
    }


    // these allow setting custom behaviour when reading/writing data to the underlying data store
    // can be specified per buffer
    setReadFunc(name, readFunc) {
        this.readFuncs[name] = readFunc;
    }

    setWriteFunc(name, writeFunc) {
        this.writeFuncs[name] = writeFunc;
    }

    // create a new buffer
    createBuffer(name, prototype, blockSize) {
        this.setBuffer(name, new prototype(blockSize * this.slotCount), blockSize);
    }

    // set an already created buffer
    setBuffer(name, buffer, blockSize=1) {
        this.buffers[name] = buffer;
        this.blockSizes[name] = blockSize;
    }

    // synchronises the named buffer with the state of this.tags
    syncBuffer(name, getDataFunc) {
        if (!this.buffers[name]) throw ReferenceError(`Buffer of name '${name}' does not exist`);
        for (let i = 0; i < this.slotCount; i++) {
            if (!this.tags[i]) continue; // skip empty slots
            (this.writeFuncs[name] ?? this.writeFuncs.default)(
                this.buffers[name], getDataFunc(this.tags[i]), i, this.blockSizes[name]
            );
        }
    }

    // search for the slot containing the data with this tag
    // if not slot contains the data for this, return -1
    getTagSlotNum(tag) {
        return this.directory.get(tag) ?? -1;
    }

    updateBlockAt(slot, newData={}) {
        for (const name in newData) {
            if (!this.buffers[name]) continue;
            // TODO: only allow writing of data up to block size
            (this.writeFuncs[name] ?? this.writeFuncs.default)(
                this.buffers[name], newData[name], slot, this.blockSizes[name]
            );
        };
    }

    // updates the block that matches the supplied tag
    updateBlockWithTag(tag, newData={}) {
        const slot = this.directory.get(tag)
        if (slot == undefined) return;
        for (const name in newData) {
            if (!this.buffers[name]) continue;
            // TODO: only allow writing of data up to block size
            (this.writeFuncs[name] ?? this.writeFuncs.default)(
                this.buffers[name], newData[name], slot, this.blockSizes[name]
            );
        };
    }

    // insert new block at given position
    insertNewBlockAt(newSlot, newTag, newData = {}) {
        // invalidate the data of the leaf node that was stored at that location before
        const evictedTag = this.tags[newSlot];
        if (evictedTag) this.directory.delete(evictedTag);
    
        // update cache information
        this.tags[newSlot] = newTag;
        this.directory.set(newTag, newSlot);

        let info = {}
    
        // write the new data into this slot
        for (const name in newData) {
            if (!this.buffers[name]) continue;
            // TODO: only allow writing of data up to block size
            info[name] = (this.writeFuncs[name] ?? this.writeFuncs.default)(
                this.buffers[name], newData[name], newSlot, this.blockSizes[name]
            );
        };

        return {
            slot: newSlot,
            evicted: evictedTag,
            info: info
        }
    }

    // insert new block into random position
    insertNewBlockRand(newTag, newData = {}) {
        const newSlot = Math.floor(Math.random()*this.slotCount);
        return this.insertNewBlockAt(newSlot, newTag, newData);        
    }

    // insert new block using LRU eviction
    insertNewBlockLRU(newTag, newData = {}) {

    }

    readBuffSlotAt(name, slotNum) {
        if (!this.buffers[name]) throw ReferenceError(`Buffer of name '${name}' does not exist`);
        return (this.readFuncs[name] ?? this.readFuncs.default)(
            this.buffers[name], slotNum, this.blockSizes[name]
        );
    }

    getBuffers(){
        return this.buffers;
    }
}