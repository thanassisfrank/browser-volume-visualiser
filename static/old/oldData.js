setupDataObj: async function(newData) {
    if (newData.multiBlock) {
        var results = [];
        for (let i = 0; i < newData.pieces.length; i++) {
            results.push(this.marchEngine.setupMarch(newData.pieces[i]));
        }
        await Promise.all(results);
        
    } else {
        // await this.marchEngine.setupMarch(newData);
    }
},

this.createSimple = async function(config) {
    if (config.f) {
        this.generateData(config);
    } else if (config.type == "raw") {
        const responseBuffer = await fetch(config.path).then(resp => resp.arrayBuffer());
        this.data.values = new DATA_TYPES[config.dataType](responseBuffer);
        this.limits = config.limits;
        this.initialise(config);
        console.log("init")
    } else if (config.type == "structuredGrid") {
        this.structuredGrid = true;

        var totalPieces = 0;

        var extents = [];
        var limits = [];

        var fileDOMs = [];
        var numPiecesList = [];
        // go through all the files that make up this dataset and get total piece num
        for (let i = 0; i < config.originalFiles.length; i++) {
            fileDOMs.push(
                await fetch(config.path + config.originalFiles[i])
                .then(res => res.text())
                .then(text => parseXML(text))
            )
            
            const numPieces = getNumPiecesFromVTS(fileDOMs[i]);
            totalPieces += numPieces;
            numPiecesList.push(numPieces);
            console.log(numPieces);
        }

        var currPieceIndex = 0;
        // go through all pieces and initialise them
        for (let i = 0; i < fileDOMs.length; i++) {
            // go through any pieces each file may have
            for (let j = 0; j < numPiecesList[i]; j++) {
                var p;
                if (totalPieces == 1) {
                    p = this;
                } else {
                    this.pieces.push(await dataManager.createData({name: this.dataName + " " + String(i)}));
                    var index = this.pieces.length - 1;
                    // register as a new user of this data
                    dataManager.addUser(this.pieces[index]);
                    this.pieces[index].structuredGrid = true;
                    var p = this.pieces[index];
                    this.multiBlock = true;
                }
                
                p.points = getPointsFromVTS(fileDOMs[i], j);
                // get the first dataset
                var pointDataNames = getDataNamesFromVTS(fileDOMs[i], j);
                p.data = getPointDataFromVTS(fileDOMs[i], j, pointDataNames[0]);

                extents.push(getExtentFromVTS(fileDOMs[i], j));
                limits.push(getDataLimitsFromVTS(fileDOMs[i], j, getDataNamesFromVTS(fileDOMs[i], j)[0]));
                
                // set limits and initialise piece
                p.limits = config.data[pointDataNames[0]].limits;
                p.initialise(config, 1, currPieceIndex);

                currPieceIndex++;
            }
        }
        // set limits and origin on main
        this.limits = config.data[pointDataNames[0]].limits;
        this.initialise(config, 1, -1);
        
        console.log(extents, limits)
        // this.initialiseVTS(totalPieces, extents, limits);
        
    }
};



this.createComplex = async function(config) {
    // first, save the config object
    this.config = config;
    this.complex = true;
    const pointsTarget = 200000;

    if (config.type == "raw") {
        // extract information from it
        this.blocksSize = xyzToA(config.blocksSize);
        this.blocksVol = volume(this.blocksSize);

        this.limits = config.limits;
        console.log(this.limits)

        // assess what resolution the coarse representation should be
        const totalPoints = this.config.size.x*this.config.size.y*this.config.size.z;
        // const scale = Math.ceil(Math.pow(totalPoints/pointsTarget, 1/3));
        const scale = 1;
        console.log("scale:", scale);
        
        const request = {
            name: config.id,
            mode: "whole",
            // will be determined by benchmarking
            cellScale: scale
        }

        // console.log(request);

        // wait for the response
        const responseBuffer = await fetch("/data", {
            method: "POST",
            body: JSON.stringify(request)
        }).then((resp) => resp.arrayBuffer());

        // create an array of correct type and store in this.data
        this.data = new DATA_TYPES[config.dataType](responseBuffer);

        // get the block limits data from the server
        var pathSplit = config.path.split(".");
        const limitsResponse = await fetch(pathSplit[0] + "_limits." + pathSplit[1]);
        const limitsBuffer = await limitsResponse.arrayBuffer();
        this.blockLimits = new DATA_TYPES[config.dataType](limitsBuffer)

        // this.logBlockDensity(32);

        this.limits = config.limits;
        this.initialise(config, scale);
    } else if (config.type == "structuredGrid") {
        this.structuredGrid = true;
        const totalPieces = config.pieces.length;

        var totalPoints = 0;
        for (let i = 0; i < totalPieces; i++) {
            totalPoints += config.pieces[i].size.x*config.pieces[i].size.y*config.pieces[i].size.z;
        }
        const scale = Math.ceil(Math.pow(totalPoints/pointsTarget, 1/3));
        console.log("scale:", scale);

        const chosenAttributeName = Object.keys(config.data)[0];

        for (let i = 0; i < totalPieces; i++) {
            var p;
            if (totalPieces == 1) {this
                p = this;
            } else {
                this.pieces.push(await dataManager.createData({name: this.dataName + " " + String(i)}));
                var index = this.pieces.length - 1;
                // register as a new user of this data
                dataManager.addUser(this.pieces[index]);
                this.pieces[index].structuredGrid = true;
                this.pieces[index].fileName = config.pieces[i].fileName;
                this.pieces[index].attributeName = chosenAttributeName;
                this.pieces[index].config = config;
                p = this.pieces[index];
                this.multiBlock = true;
            }

            // request the points data
            const pointsRequest = {
                name: config.id,
                fileName: config.pieces[i].fileName,
                points: true,
                mode: "whole",
                // will be determined by benchmarking
                cellScale: scale
            }

            p.points = await fetch("/data", {
                method: "POST",
                body: JSON.stringify(pointsRequest)
            })
            .then((resp) => resp.arrayBuffer())
            .then(buff => new Float32Array(buff));


            // request data
            const dataRequest = {
                name: config.id,
                fileName: config.pieces[i].fileName,
                data: p.attributeName,
                mode: "whole",
                // will be determined by benchmarking
                cellScale: scale
            }

            p.data = await fetch("/data", {
                method: "POST",
                body: JSON.stringify(dataRequest)
            })
                .then((resp) => resp.arrayBuffer())
                .then(buff => new DATA_TYPES[config.data[p.attributeName].dataType](buff));

            // get the block limits data from the server
            const limPath = config.path + config.pieces[i].fileName + "_" +  p.attributeName + "_limits.raw";
            p.blockLimits = await fetch(limPath)
                .then((resp) => resp.arrayBuffer())
                .then(buff => new DATA_TYPES[config.data[p.attributeName].dataType](buff));

            // console.log(p.data);
            // console.log(p.points);
            // console.log(p.blockLimits);
            // this.logBlockDensity(32);
            p.complex = true;
            p.structuredGrid = true;
            p.blocksSize = xyzToA(config.pieces[i].blocksSize);
            p.blockVol = volume(this.blocksSize);

            p.limits = config.data[p.attributeName].limits;
            p.initialise(config, scale, i);
        }
        this.complex = true;
        // init the main object too
        this.structuredGrid = true;
        this.attributeName = chosenAttributeName;
        this.limits = config.data[p.attributeName].limits;
        this.initialise(config, scale, -1);
    }
};


// allows a query of which blocks intersect with the given range
this.queryBlocks = function(range, exclusive = [false, false]) {
    var intersecting = [];
    // block locations is a list of all blocks and where they are in this.data if they are there
    var l, r;
    for (let i = 0; i < this.blockLimits.length/2; i++) {
        l = this.blockLimits[2*i];
        r = this.blockLimits[2*i + 1];
        if (l <= range[1] && range[0] <= r) {
            if (exclusive[0] && l <= range[0]) continue;
            if (exclusive[1] && r >= range[1]) continue;
            intersecting.push(i);
        }
    } 
    return intersecting;
}

this.queryDeltaBlocks = function(oldRange, newRange) {
    console.log(oldRange, newRange);
    var out = {add:[], remove:[]};
    var thisRange = [];
    for (let i = 0; i < this.blockLimits.length/2; i++) {
        thisRange[0] = this.blockLimits[2*i];
        thisRange[1] = this.blockLimits[2*i + 1];
        // four cases:
        // only in new range -> goes into add
        // only in old range -> goes into remove
        // in both ranges -> nothing
        // in neither ranges -> nothing
        
        if (rangesOverlap(thisRange, oldRange) && rangesOverlap(thisRange, newRange)) {
            // in both so don't do anything
            continue
        } else if (rangesOverlap(thisRange, newRange)) {
            // only in new range
            out.add.push(i);
        } else if (rangesOverlap(thisRange, oldRange)) {
            // only in old range
            out.remove.push(i);
        }
    }
    // console.log(out);
    return out;
}
// same as above but returns a number
this.queryBlocksCount = function(range, exclusive = [false, false]) {
    var num = 0;
    // block locations is a list of all blocks and where they are in this.data if they are there
    var l, r;
    for (let i = 0; i < this.blockLimits.length/2; i++) {
        l = this.blockLimits[2*i];
        r = this.blockLimits[2*i + 1];
        if (l <= range[1] && range[0] <= r) {
            if (exclusive[0] && l <= range[0]) continue;
            if (exclusive[1] && r >= range[1]) continue;
            num++;
        }
    } 
    return num;
}

// fetches the supplied blocks
this.fetchBlocks = function(blocks, points = false) {
    var request = {
        name: this.config.id,
        mode: "blocks",
        blocks: blocks
    }
    if (this.structuredGrid) {
        request.fileName = this.fileName;
        if (points) {
            request.points = true;
        } else {
            request.data = this.attributeName;
        }
    }
    console.log(request);

    var that = this;

    return fetch("/data", {
        method: "POST",
        body: JSON.stringify(request)
    })
    .then(response => response.arrayBuffer())
    .then(buffer => new (that.getDataType())(buffer))
}

this.bytesPerBlockData = function() {
    return volume(blockSize)*this.getDataType().BYTES_PER_ELEMENT;
}

this.getDataType = function() {
    // console.log(this.config, this.attributeName)
    if (this.structuredGrid) {
        return DATA_TYPES[this.config.data[this.attributeName].dataType];
    } else {
        return DATA_TYPES[this.config.dataType];
    }
}

this.bytesPerBlockPoints = function() {
    return volume(blockSize)*3*4; // assume positions are float32 for now
}


this.logBlockDensity = function(n) {
    const density = this.getBlockDensity(n);
    // console.log(density);
    // find the max to scale by
    var maxVal = 0;
    for (let i = 0; i < density.length; i++) {
        maxVal = Math.max(density[i], maxVal);
    }
    const rowLength = 32;
    var outStr = "";
    for (let i = 0; i < density.length; i++) {
        outStr += "#".repeat(Math.round(density[i]*rowLength/maxVal)) + "\n";
    }
    console.log(outStr);
}

this.getBlockDensity = function(n) {
    var density = [];
    for (let i = 0; i <= n; i++) {
        const val = i*(this.limits[1] - this.limits[0])/n + this.limits[0];
        density.push(this.queryBlocksCount([val, val]));
    }
    return density;
}