// cache.js
// implements a prototypes for handling caches

// fixed-size, fully associative cache
export class AssociativeCache {
    #tags;
    #slotCount;
    #buffers = {};
    #blockSizes = {};
    #directory = new Map(); // tag -> slotNum

    // functions to read/write to the buffers
    #readFuncs = {
        default: (buff, slotNum, blockSize) => {
            buff.slice(slotNum * blockSize, (slotNum + 1) * blockSize);
        }
    }
    #writeFuncs = {
        default: (buff, data, slotNum, blockSize) => {
            buff.set(data, blockSize * slotNum);
        }
    };

    constructor(slotCount) {
        this.#slotCount = slotCount;
        this.#tags = new Array(slotCount); // slotNum -> tag
    }

    // getters
    get tags() {
        return this.#tags;
    }

    get slotCount() {
        return this.#slotCount;
    }

    get blockSizes() {
        return this.#blockSizes;
    }


    // these allow setting custom behaviour when reading/writing data to the underlying data store
    // can be specified per buffer
    setReadFunc(name, readFunc) {
        this.#readFuncs[name] = readFunc;
    }

    setWriteFunc(name, writeFunc) {
        this.#writeFuncs[name] = writeFunc;
    }

    // create a new buffer
    createBuffer(name, prototype, blockSize) {
        this.setBuffer(name, new prototype(blockSize * this.#slotCount), blockSize);
    }

    // set an already created buffer
    setBuffer(name, buffer, blockSize=1) {
        this.#buffers[name] = buffer;
        this.#blockSizes[name] = blockSize;
    }

    // synchronises the named buffer with the state of this.tags
    syncBuffer(name, getDataFunc) {
        if (!this.#buffers[name]) throw ReferenceError(`Buffer of name '${name}' does not exist`);
        for (let i = 0; i < this.#slotCount; i++) {
            if (!this.#tags[i]) continue; // skip empty slots
            (this.#writeFuncs[name] ?? this.#writeFuncs.default)(
                this.#buffers[name], getDataFunc(this.#tags[i]), i, this.#blockSizes[name]
            );
        }
    }

    // search for the slot containing the data with this tag
    // if not slot contains the data for this, return -1
    getTagSlotNum(tag) {
        return this.#directory.get(tag) ?? -1;
    }

    updateBlockAt(slot, newData={}) {
        if (slot == undefined || slot >= this.#slotCount || slot < 0) return;
        for (const name in newData) {
            if (!this.#buffers[name]) continue;
            // TODO: only allow writing of data up to block size
            (this.#writeFuncs[name] ?? this.#writeFuncs.default)(
                this.#buffers[name], newData[name], slot, this.#blockSizes[name]
            );
        };
    }

    // insert new block at given position
    insertNewBlockAt(newSlot, newTag, newData = {}) {
        // invalidate the data of the leaf node that was stored at that location before
        const evictedTag = this.#tags[newSlot];
        if (evictedTag) this.#directory.delete(evictedTag);
    
        // update cache information
        this.#tags[newSlot] = newTag;
        this.#directory.set(newTag, newSlot);

        let info = {}
    
        // write the new data into this slot
        for (const name in newData) {
            if (!this.#buffers[name]) continue;
            // TODO: only allow writing of data up to block size
            info[name] = (this.#writeFuncs[name] ?? this.#writeFuncs.default)(
                this.#buffers[name], newData[name], newSlot, this.#blockSizes[name]
            );
        };

        return {
            slot: newSlot,
            evicted: evictedTag,
            info: info
        }
    }

    readBuffSlotAt(name, slotNum) {
        if (!this.#buffers[name]) throw ReferenceError(`Buffer of name '${name}' does not exist`);
        return (this.#readFuncs[name] ?? this.#readFuncs.default)(
            this.#buffers[name], slotNum, this.#blockSizes[name]
        );
    }

    getBuffers(){
        return this.#buffers;
    }
}


// extends the associative cache with support for random block
export class RandAssociativeCache extends AssociativeCache{
    // insert new block into random position
    insertNewBlock(newTag, newData = {}) {
        const newSlot = Math.floor(Math.random()*this.slotCount);
        return this.insertNewBlockAt(newSlot, newTag, newData);        
    }
}

// a cache which maintains 
export class ScoredAssociativeCache extends AssociativeCache {
    #scores;
    #worstScore;
    #bestScore;
    #reversed;
    constructor(slotNum, reversed = false) {
        super(slotNum);
        this.#scores = Array(slotNum);
        this.#reversed = reversed;
        if (!reversed) {
            this.#worstScore = Number.NEGATIVE_INFINITY;
            this.#bestScore = Number.POSITIVE_INFINITY;
        } else {
            this.#worstScore = Number.POSITIVE_INFINITY;
            this.#bestScore = Number.NEGATIVE_INFINITY;

        }
    }

    // returns true is a is a better score that b
    better(a, b) {
        if (!this.#reversed) return a > b;
        return a < b;
    }

    syncScores(getScoresFunc) {
        for (let i = 0; i < this.#scores.length; i++) {
            if (!this.tags[i]) {
                // empty slots
                this.#scores[i] = this.#worstScore;
            } else {
                this.#scores[i] = getScoresFunc(this.tags[i])
            }
        }
    }

    // insert new block to replace
    insertNewBlock(newScore, newTag, newData = {}) {
        debugger;
        // find the block to replace
        // search through blocks until -inf 
        let newSlot = -1;

        const worstScoreFound = {
            val: this.#bestScore,
            index: 0
        };

        for (let i = 0; i < this.#scores.length; i++) {
            if (this.#scores[i] == this.#worstScore) {
                newSlot = i;
                break;
            }
            if (this.better(worstScoreFound.val, this.#scores[i])) {
                // found a new worse score
                worstScoreFound.val = this.#scores[i];
                worstScoreFound.index = i;
            }
        }
        // fallback to the worst scoring slot found
        if (newSlot == -1) newSlot = worstScoreFound.index

        // update the cache
        return this.insertNewBlockAt(newSlot, newScore, newTag, newData);
    }

    insertNewBlockAt(newSlot, newScore, newTag, newData = {}) {
        if (undefined == newSlot) return;
        if (newSlot >= this.slotCount || newSlot < 0) return;
        // update score
        this.#scores[newSlot] = newScore;
        // update data
        return super.insertNewBlockAt(newSlot, newTag, newData);
    }
}