// cache.js
// implements a prototypes for handling caches

// fixed-size, fully associative cache
export function AssociativeCache(slotCount) {
    this.buffers = {};
    this.blockSizes = {};
    this.slotCount = slotCount;
    this.directory = new Map(); // tag -> slotNum
    this.tags = new Array(slotCount); // slotNum -> tag

    // functions to read/write to the buffers
    // TODO: add different functions per buffer
    this.readFuncs = {
        default: (buff, slotNum, blockSize) => {
            buff.slice(slotNum * blockSize, (slotNum + 1) * blockSize);
        }
    }
    this.writeFuncs = {
        default: (buff, data, slotNum, blockSize) => {
            buff.set(data, blockSize * slotNum);
        }
    }

    // these allow setting custom behaviour when reading/writing data to the underlying data store
    // can be specified per buffer
    this.setReadFunc = function(name, readFunc) {
        this.readFuncs[name] = readFunc;
    }

    this.setWriteFunc = function(name, writeFunc) {
        this.writeFuncs[name] = writeFunc;
    }

    // create a new buffer
    this.createBuffer = function(name, prototype, blockSize) {
        this.setBuffer(name, new prototype(blockSize * this.slotCount), blockSize);
    };

    // set an already created buffer
    this.setBuffer = function(name, buffer, blockSize=1) {
        this.buffers[name] = buffer;
        this.blockSizes[name] = blockSize;
    }

    // synchronises the named buffer with the state of this.tags
    this.syncBuffer = function(name, getDataFunc) {
        if (!this.buffers[name]) throw ReferenceError(`Buffer of name '${name}' does not exist`);
        for (let i = 0; i < this.slotCount; i++) {
            if (!this.tags[i]) continue; // skip emtpy slots
            (this.writeFuncs[name] ?? this.writeFuncs.default)(
                this.buffers[name], getDataFunc(this.tags[i]), i, this.blockSizes[name]
            );
        }
    };

    // search for the slot containing the data with this tag
    // if not slot contains the data for this, return -1
    this.getTagSlotNum = function(tag) {
        return this.directory.get(tag) ?? -1;
    }

    this.updateBlockAt = function(slot, newData={}) {
        for (const name in newData) {
            if (!this.buffers[name]) continue;
            // TODO: only allow writing of data up to block size
            (this.writeFuncs[name] ?? this.writeFuncs.default)(
                this.buffers[name], newData[name], slot, this.blockSizes[name]
            );
        };
    }

    // updates the block that matches the supplied tag
    this.updateBlockWithTag = function(tag, newData={}) {
        if (!this.directory.get(tag)) return;
        for (const name in newData) {
            if (!this.buffers[name]) continue;
            // TODO: only allow writing of data up to block size
            (this.writeFuncs[name] ?? this.writeFuncs.default)(
                this.buffers[name], newData[name], slot, this.blockSizes[name]
            );
        };
    }

    // insert new block at given position
    this.insertNewBlockAt = function(newSlot, newTag, newData = {}) {
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
    this.insertNewBlockRand = function(newTag, newData = {}) {
        const newSlot = Math.floor(Math.random()*this.slotCount);
        return this.insertNewBlockAt(newSlot, newTag, newData);        
    }

    // insert new block using LRU eviction
    this.insertNewBlockLRU = function(newTag, newData = {}) {

    }

    this.readBuffSlotAt = function(name, slotNum) {
        if (!this.buffers[name]) throw ReferenceError(`Buffer of name '${name}' does not exist`);
        return (this.readFuncs[name] ?? this.readFuncs.default)(
            this.buffers[name], slotNum, this.blockSizes[name]
        );
    }

    this.getBuffers = function() {
        return this.buffers;
    }
}