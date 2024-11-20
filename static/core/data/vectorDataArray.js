// vectorDataArray.js
// provides information about mappings from a vector of 

import { DataArrayTypes, DataModifiers } from "./dataConstants.js";

import { VecMath } from "../VecMath.js";
import { DataSourceSampler } from "./dataSampler.js";
import { createVertexIterator } from "./vertexIterator.js";


class MagnitudeMap {
    constructor(vecName) {
        this.inputs = [
            {name: vecName + "X", modifier: DataModifiers.NONE},
            {name: vecName + "Y", modifier: DataModifiers.NONE},
            {name: vecName + "Z", modifier: DataModifiers.NONE},
        ];
        this.output = vecName + "Mag";
    }
    calculate(vecx, vecy, vecz) {
        return Math.sqrt(vecx**2 + vecy**2 + vecz**2);
    }
}

class GradientMagMap {
    constructor(name) {
        this.inputs = [
            {name: name, modifier: DataModifiers.DERIVATIVE_X},
            {name: name, modifier: DataModifiers.DERIVATIVE_Y},
            {name: name, modifier: DataModifiers.DERIVATIVE_Z},
        ];
        this.output = name + "GradientMag";
    }
    calculate(dx, dy, dz) {
        return Math.sqrt(dx**2 + dy**2 + dz**2);
    }
}

class MachNumberMap {
    constructor() {
        this.inputs = [
            {name: "VelocityX", modifier: DataModifiers.NONE},
            {name: "VelocityY", modifier: DataModifiers.NONE},
            {name: "VelocityZ", modifier: DataModifiers.NONE},
            {name: "VelocitySoundSquared", modifier: DataModifiers.NONE},
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
            {name: vecName + "X", modifier: DataModifiers.DERIVATIVE_X},
            {name: vecName + "Y", modifier: DataModifiers.DERIVATIVE_Y},
            {name: vecName + "Z", modifier: DataModifiers.DERIVATIVE_Z},
        ];

        this.output = vecName + "Div";
    }

    calculate(vecxdx, vecydy, veczdz) {
        return vecxdx + vecydy + veczdz;
    }
}

class VorticityMagMap {
    constructor() {
        this.inputs = [
            {name: "VelocityX", modifier: DataModifiers.DERIVATIVE_Y},
            {name: "VelocityX", modifier: DataModifiers.DERIVATIVE_Z},
            {name: "VelocityY", modifier: DataModifiers.DERIVATIVE_X},
            {name: "VelocityY", modifier: DataModifiers.DERIVATIVE_Z},
            {name: "VelocityZ", modifier: DataModifiers.DERIVATIVE_X},
            {name: "VelocityZ", modifier: DataModifiers.DERIVATIVE_Y},
        ];

        this.output = "VorticityMag";
    }
    // calculate the magnitude of the vorticity vector
    calculate(vxdy, vxdz, vydx, vydz, vzdx, vzdy) {
        return VecMath.magnitude([
            vzdy - vydz,
            vxdz - vzdx,
            vydx - vxdy
        ]);
    }
}

class QCriterionMap {
    constructor() {
        this.inputs = [
            {name: "VelocityX", modifier: DataModifiers.DERIVATIVE_X},
            {name: "VelocityY", modifier: DataModifiers.DERIVATIVE_X},
            {name: "VelocityZ", modifier: DataModifiers.DERIVATIVE_X},
            {name: "VelocityX", modifier: DataModifiers.DERIVATIVE_Y},
            {name: "VelocityY", modifier: DataModifiers.DERIVATIVE_Y},
            {name: "VelocityZ", modifier: DataModifiers.DERIVATIVE_Y},
            {name: "VelocityX", modifier: DataModifiers.DERIVATIVE_Z},
            {name: "VelocityY", modifier: DataModifiers.DERIVATIVE_Z},
            {name: "VelocityZ", modifier: DataModifiers.DERIVATIVE_Z},
        ];

        this.output = "QCriterion";
    }
    // calculate the second invariant of the velocity gradient tensor
    calculate(vxdx, vydx, vzdx, vxdy, vydy, vzdy, vxdz, vydz, vzdz) {
        const sym  = vxdx*vydy + vxdx*vzdz + vydy*vzdz;
        const asym = vxdy*vydx + vxdz*vzdx + vydz*vzdy;
        return sym - asym;
    }
}

export class VectorMappingHandler {
    #vertexIterator;
    #dataSampler;

    constructor(dataSource, tree) {
        this.dataSource = dataSource;
        this.tree = tree;
        this.mappings = [
            new GradientMagMap("Default"),
            new MagnitudeMap("Velocity"),
            new MachNumberMap(),
            new DivergenceMap("Velocity"),
            new VorticityMagMap(),
            new QCriterionMap()
        ];
        this.#vertexIterator = createVertexIterator(dataSource);
        this.#dataSampler = new DataSourceSampler(dataSource, tree);
    }
    // returns an array of output array names that can be calculated from the inputs
    getPossibleMappings() {
        if (!this.#vertexIterator) return [];
        const dataArrayDescriptors = this.dataSource.getAvailableDataArrays();
        let possibleOutputNames = [];
        for (let mapping of this.mappings) {
            // push it pre-emptively
            possibleOutputNames.push(mapping.output);
            for (let inDesc of mapping.inputs) {
                // check if each required input is present
                if (dataArrayDescriptors.find(v => v.name == inDesc.name)) continue;

                // remove it if one input cannot be found
                possibleOutputNames.pop();
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

    async getDataArray(desc) {
        if (DataArrayTypes.CALC != desc.arrayType) return;
        
        // check if the vertex iterator was created properly
        if (!this.#vertexIterator) return;
        
        // check if this is a valid mapping output
        const reqInputs = this.getRequiredInputs(desc.name);
        if (!reqInputs) return;
        const mapFunc = this.getMappingFunction(desc.name);
        if (!mapFunc) return;
        
        // get the data arrays needed from the data source
        const uniqueNames = new Set(reqInputs.map(v => v.name));
        // try to load all of the input arrays
        // these are not modified with derivatives at this point
        let inputArrays = {};
        for (let name of uniqueNames.values()) {
            inputArrays[name] = await this.dataSource.getDataArray({name});
        }
        
        // check if they could all be loaded
        if (!Object.values(inputArrays).every(a => a)) return;
        
        // create output array of same size as input
        const outputArray = new Float32Array(Object.values(inputArrays)[0].data.length);
        const limits = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

        for (let vert of this.#vertexIterator.iterate()) {
            const inputVals = [];
            for (let input of reqInputs) {
                const array = inputArrays[input.name].data;
                inputVals.push(this.#dataSampler.sample(vert, array, input.modifier));
            }

            // perform mapping
            const val = mapFunc(...inputVals);
            
            limits[0] = Math.min(limits[0], val);
            limits[1] = Math.max(limits[1], val);
            outputArray[vert.index] = val;
        }

        return {
            name: desc.name,
            data: outputArray,
            limits
        }
    }
}


