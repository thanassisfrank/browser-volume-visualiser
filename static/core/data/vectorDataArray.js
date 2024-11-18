// vectorDataArray.js
// provides information about mappings from a vector of 

export const DataModifiers = {
    NONE: "none",
    DERIVATIVE_X: "derivative x",
    DERIVATIVE_Y: "derivative y",
    DERIVATIVE_Z: "derivative z",
};


class MagnitudeMap {
    constructor(vecName) {
        this.inputs = [
            {name: vecName + "X"},
            {name: vecName + "Y"},
            {name: vecName + "Z"},
        ];
        this.output = vecName + "Mag";
    }
    calculate(vecx, vecy, vecz) {
        return Math.sqrt(vecx**2 + vecy**2 + vecz**2);
    }
}

class MachNumberMap {
    constructor() {
        this.inputs = [
            {name: "VelocityX"},
            {name: "VelocityY"},
            {name: "VelocityZ"},
            {name: "VelocitySoundSquared"},
        ];
        this.output = "MachNumber";
    }
    calculate(vecx, vecy, vecz, vss) {
        return Math.sqrt((vecx**2 + vecy**2 + vecz**2)/vss);
    }
}

class DivergenceMap {
    constructor(vecName) {
        this.inputs = [
            {
                name: vecName + "X",
                modifier: DataModifiers.DERIVATIVE_X
            },
            {
                name: vecName + "Y",
                modifier: DataModifiers.DERIVATIVE_Y
            },
            {
                name: vecName + "Z",
                modifier: DataModifiers.DERIVATIVE_Z
            },
        ];

        this.output = vecName + "Div";
    }

    calculate(vecxdx, vecydy, veczdz) {
        return vecxdx + vecydy + veczdz;
    }
}

export class VectorMappingHandler {
    constructor() {
        this.mappings = [
            new MagnitudeMap("Velocity"),
            new MachNumberMap(),
            // new DivergenceMap("Velocity")
        ];
    }
    // returns an array of output array names that can be calculated from the inputs
    getPossibleMappings(dataArrayDescriptors) {
        let possibleOutputNames = [];
        for (let mapping of this.mappings) {
            let satisfied = mapping.inputs.map(v => false);

            // search through all input array descriptors
            for (let srcDesc of dataArrayDescriptors) {
                const index = mapping.inputs.findIndex(v => v.name == srcDesc.name);
                if (-1 == index) continue;
                // array name is one of the inputs for this mapping
                satisfied[index] = true;
                if (!satisfied.every(v => v)) continue;
                // all inputs found
                possibleOutputNames.push(mapping.output);
                break;
            }
        }
        return possibleOutputNames;
    }

    // returns the required input descriptors for the supplied calculable value if it exists
    getRequiredInputs(outputName) {
        const thisMapping = this.mappings.find(m => outputName == m.output);
        if (!thisMapping) return;
        // the mapping exists
        return thisMapping.inputs;
    }

    // returns a reference to the mapping function that can be used to map a value vector -> scalar
    getMappingFunction(outputName) {
        const thisMapping = this.mappings.find(m => outputName == m.output);
        if (!thisMapping) return;
        // the mapping exists
        return thisMapping.calculate;
    }
}


