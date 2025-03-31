// cache.js
// implements a prototypes for handling caches

// fixed-size, fully associative cache
export class AssociativeCache {
    #tags;
    #slotCount;
    #buffers = {};
    #resizable = {};
    #blockSizes = {};
    #directory = new Map(); // tag -> slotNum

    // functions to read/write to the buffers
    #readFuncs = {
        default: (buff, slotNum, blockSize) => {
            return buff.slice(slotNum * blockSize, (slotNum + 1) * blockSize);
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
    get directory() {
        return this.#directory;
    }

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
    createBuffer(name, prototype, blockSize, resizable = false) {
        this.setBuffer(name, new prototype(blockSize * this.#slotCount), blockSize, resizable);

    }

    // set an already created buffer
    setBuffer(name, buffer, blockSize = 1, resizable = false) {
        this.#buffers[name] = buffer;
        this.#blockSizes[name] = blockSize;
        this.#resizable[name] = resizable;
    }

    // synchronises the named buffer with the state of this.tags
    syncBuffer(name, getDataFunc) {
        if (!this.#buffers[name]) throw ReferenceError(`Buffer of name '${name}' does not exist`);
        for (let i = 0; i < this.#slotCount; i++) {
            if (!this.#tags[i]) continue; // skip empty slots
            const newData = getDataFunc(this.#tags[i]);
            if (newData === undefined) continue
            (this.#writeFuncs[name] ?? this.#writeFuncs.default)(
                this.#buffers[name], newData, i, this.#blockSizes[name]
            );
        }
    }

    #expandBuffer(name, minNewSize) {
        const oldBuff = this.#buffers[name];
        const oldBlockSize = this.blockSizes[name];
        const newBlockSize = Math.round(Math.max(1.5 * oldBlockSize, minNewSize));
        const newBuff = new oldBuff.constructor(newBlockSize * this.#slotCount);

        this.setBuffer(name, newBuff, newBlockSize, true);

        // copy data over
        for (let i = 0; i < this.#slotCount; i++) {
            newBuff.set(oldBuff.slice(i * oldBlockSize, (i + 1) * oldBlockSize), i * newBlockSize);
        }
    }

    // search for the slot containing the data with this tag
    // if not slot contains the data for this, return -1
    getTagSlotNum(tag) {
        return this.#directory.get(tag) ?? -1;
    }

    updateBlockAt(slot, newData={}) {
        if (slot == undefined || slot >= this.#slotCount || slot < 0) return;

        let info = {}

        for (const name in newData) {
            if (!this.#buffers[name]) continue;
            // TODO: only allow writing of data up to block size

            if (this.#resizable[name] && newData[name].length > this.blockSizes[name]) {
                // too large, re-write buffer
                this.#expandBuffer(name, newData[name].length);
            }

            info[name] = (this.#writeFuncs[name] ?? this.#writeFuncs.default)(
                this.#buffers[name], newData[name], slot, this.#blockSizes[name]
            );
        };

        return info;
    }

    // insert new block at given position
    insertNewBlockAt(newSlot, newTag, newData = {}) {
        // invalidate the data of the leaf node that was stored at that location before
        const evictedTag = this.#tags[newSlot];
        if (evictedTag) this.#directory.delete(evictedTag);
    
        // update cache information
        this.#tags[newSlot] = newTag;
        this.#directory.set(newTag, newSlot);

        const info = this.updateBlockAt(newSlot, newData);

        // let info = {}
    
        // // write the new data into this slot
        // for (const name in newData) {
        //     if (!this.#buffers[name]) continue;
        //     // TODO: only allow writing of data up to block size
        //     info[name] = (this.#writeFuncs[name] ?? this.#writeFuncs.default)(
        //         this.#buffers[name], newData[name], newSlot, this.#blockSizes[name]
        //     );
        // };

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


// cache managers which control how blocks are inserted
class EmptyCacheManager {
    #cache;
    constructor(cache) {
        this.#cache = cache;
    }

    get cache() {
        return this.#cache;
    }

    get blockSizes() {
        return this.#cache.blockSizes;
    }

    // TODO: create better structure within the cache objects to avoid this

    getTagSlotNum(...args) {
        return this.#cache.getTagSlotNum(...args);
    }

    createBuffer(...args) {
        return this.#cache.createBuffer(...args);
    }

    syncBuffer(...args) {
        return this.#cache.syncBuffer(...args);
    }

    getBuffers(...args) {
        return this.#cache.getBuffers(...args);
    }
    readBuffSlotAt(...args) {
        return this.#cache.readBuffSlotAt(...args);
    }
}


// extends the associative cache with support for random block
export class RandCacheManager extends EmptyCacheManager {
    // insert new block into random position
    insertNewBlock(newTag, newData = {}) {
        const newSlot = Math.floor(Math.random()*this.cache.slotCount);
        return this.cache.insertNewBlockAt(newSlot, newTag, newData);        
    }
}

// a cache which maintains 
export class ScoredCacheManager extends EmptyCacheManager {
    #scores;
    #worstScore;
    #bestScore;

    #currentWorstScore = {
        valid: false
    };

    // the indices of the slots in descending score order
    #sortedIndices;

    constructor(cache) {
        super(cache);
        this.#scores = Array(cache.slotCount);
        this.#sortedIndices = Array(cache.slotCount);
        for (let i = 0; i < this.#sortedIndices.length; i++) {
            this.#sortedIndices[i] = i;
        }

        this.#worstScore = Number.NEGATIVE_INFINITY;
        this.#bestScore = Number.POSITIVE_INFINITY;
    }

    get directory() {
        return this.cache.directory;
    }

    syncScores(getScoresFunc) {
        for (let i = 0; i < this.#scores.length; i++) {
            if (!this.cache.tags[i]) {
                // empty slots
                this.#scores[i] = this.#worstScore;
            } else {
                this.#scores[i] = getScoresFunc(this.cache.tags[i])
            }
        }

        this.#getSortedindices();
    }

    // recalculate the correct order of indices
    #getSortedindices() {
        // sort in descending order
        // this.#sortedIndices.sort((a, b) => this.#scores[b] - this.#scores[a])

        for (let i = 0; i < this.#sortedIndices.length; i++) {
            let highestVal = this.#worstScore;
            let highestValIndex = i;
            // find the next highest val
            for (let j = i; j < this.#sortedIndices.length; j++) {
                const thisVal = this.#scores[this.#sortedIndices[j]];
                if (thisVal > highestVal) {
                    highestVal = thisVal;
                    highestValIndex = j;
                }
            }
            // swap values in i and j
            const temp = this.#sortedIndices[i];
            this.#sortedIndices[i] = this.#sortedIndices[highestValIndex]; 
            this.#sortedIndices[highestValIndex] = temp;
        }
    }

    // find what the worst score is in the cache at the moment
    // used externally to decide whether to write to cache
    // used internally to decide where to write to cache
    getWorstScore() {
        const worstIndex = this.#sortedIndices.at(-1);
        return this.#scores[worstIndex];
    }

    // insert new block to replace
    insertNewBlock(newScore, newTag, newData = {}) {
        // get the index of the block with the current worst score
        // removes its entry from the sorted list
        let newSlot = this.#sortedIndices.pop();

        // insert the block back into the sorted list at the correct location
        let spliceIndex = 0;
        while (spliceIndex < this.#sortedIndices.length && this.#sortedIndices[spliceIndex] > newScore) spliceIndex++;
        this.#sortedIndices.splice(spliceIndex, 0, newSlot);

        // update the cache
        return this.#insertNewBlockAt(newSlot, newScore, newTag, newData);
    }

    #insertNewBlockAt(newSlot, newScore, newTag, newData = {}) {
        if (undefined == newSlot) return;
        if (newSlot >= this.slotCount || newSlot < 0) return;
        // update score
        this.#scores[newSlot] = newScore;
        // update data
        return this.cache.insertNewBlockAt(newSlot, newTag, newData);
    }

    updateBlockAt(slot, newData={}) {
        return this.cache.updateBlockAt(slot, newData);
    }
}