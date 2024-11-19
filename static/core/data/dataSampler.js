// dataSampler.js
import { VecMath } from "../VecMath.js";
import { DataModifiers } from "./vectorDataArray.js";
import { DataFormats } from "./dataSource.js";

class StructuredDataSampler {
    #dataSource;
    constructor(dataSource) {
        this.#dataSource = dataSource;
    }

    // gets the val at a general position in the dataset
    // returns undefined if outside of dataset
    getValAt(pos, dataArray) {
        // do trilinear interpolation to find the value

    }
}

class UnstructuredDataSampler {
    #dataSource;
    #tree;
    constructor(dataSource, tree) {
        this.#dataSource = dataSource;
        this.#tree = tree;
    }

    // gets the val at a general position in the dataset
    // returns undefined if outside of dataset
    getValAt(pos, dataArray) {
        // find the containing leaf node
        const leafNode = this.#tree.getContainingLeafNode(pos);
        // find the containing cell
        const cell = this.#tree.getContainingCell(pos, leafNode);
        if (!cell) return;

        const cellVals = cell.pointsIndices.map(i => dataArray[i]);

        return VecMath.dot(cellVals, cell.factors);
    }
}

export class DataSourceSampler {
    #sampler;
    constructor(dataSource, tree = null) {
        if (DataFormats.STRUCTURED == dataSource.format) {
            this.#sampler = new StructuredDataSampler(dataSource);
        } else if (DataFormats.UNSTRUCTURED == dataSource.format) {
            this.#sampler = new UnstructuredDataSampler(dataSource, tree);
        }
    }
    #samplePlain(vert, dataArray) {
        if (vert.index !== undefined) {
            // this is a point in the dataset
            return dataArray[vert.index];
        }

        return this.#sampler.getValAt(vert.pos, dataArray);
    }

    #sampleDer(vert, dataArray, modifier) {
        // perform central differencing to find the derivative
    }

    sample(vert, dataArray, modifier = DataModifiers.NONE) {
        let val;
        switch (modifier) {
            case DataModifiers.NONE:
                val = this.#samplePlain(vert, dataArray);
                break;
            case DataModifiers.DERIVATIVE_X:
            case DataModifiers.DERIVATIVE_Y:
            case DataModifiers.DERIVATIVE_Z:
                val = this.#sampleDer(vert.pos, dataArray,modifier);
                break;
        }

        return val;
    }
}