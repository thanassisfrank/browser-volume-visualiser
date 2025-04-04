// dataSampler.js
import { DataFormats, DataModifiers } from "../dataConstants.js";
import { pointInAABB, sampleDataArrayWithCell } from "../cellTreeUtils.js";

const EPSILON_DER = 2**-6;

class StructuredDataSampler {
    #dataSource;
    constructor(dataSource) {
        this.#dataSource = dataSource;
    }
    #getPointVal(x, y, z, dataArray) {
        return dataArray[x + this.#dataSource.size[0] * y + this.#dataSource.size[0] * this.#dataSource.size[1] * z];
    }

    // gets the val at a general position in the dataset
    // returns undefined if outside of dataset
    // ASSUMES CELLSIZE = 1,1,1
    getValAt(pos, dataArray) {
        if (!pointInAABB(pos, this.#dataSource.extentBox)) return;
        // do trilinear interpolation to find the value
        var flr = [
            Math.floor(pos[0]),
            Math.floor(pos[1]),
            Math.floor(pos[2])
        ];
        var cel = [
            Math.ceil(pos[0]),
            Math.ceil(pos[1]),
            Math.ceil(pos[2])
        ];
        // lerp in z direction
        var fac = [
            pos[0] - flr[0],
            pos[1] - flr[1],
            pos[2] - flr[2]
        ];
        return  this.#getPointVal(flr[0], flr[1], flr[2], dataArray) * (1-fac[0]) * (1-fac[1]) * (1-fac[2]) +
                this.#getPointVal(flr[0], flr[1], cel[2], dataArray) * (1-fac[0]) * (1-fac[1]) * fac[2]     +
                this.#getPointVal(flr[0], cel[1], flr[2], dataArray) * (1-fac[0]) * fac[1]     * (1-fac[2]) +
                this.#getPointVal(flr[0], cel[1], cel[2], dataArray) * (1-fac[0]) * fac[1]     * fac[2]     +
                this.#getPointVal(cel[0], flr[1], flr[2], dataArray) * fac[0]     * (1-fac[1]) * (1-fac[2]) +
                this.#getPointVal(cel[0], flr[1], cel[2], dataArray) * fac[0]     * (1-fac[1]) * fac[2]     +
                this.#getPointVal(cel[0], cel[1], flr[2], dataArray) * fac[0]     * fac[1]     * (1-fac[2]) +
                this.#getPointVal(cel[0], cel[1], cel[2], dataArray) * fac[0]     * fac[1]     * fac[2]     ;
    }
}

class UnstructuredDataSampler {
    #dataSource;
    #tree;
    constructor(dataSource, tree) {
        this.#dataSource = dataSource;
        this.#tree = dataSource.tree;
    }

    // gets the val at a general position in the dataset
    // returns undefined if outside of dataset
    getValAt(pos, dataArray) {
        // find the containing leaf node
        const leafNode = this.#tree.getContainingLeafNode(pos);
        if (!leafNode) return;
        
        // find the containing cell
        const cell = this.#tree.getContainingCell(pos, leafNode);
        if (!cell) return;

        return sampleDataArrayWithCell(dataArray, cell);
    }
}

export class DataSourceSampler {
    #sampler;
    constructor(dataSource) {
        if (DataFormats.STRUCTURED == dataSource.format) {
            this.#sampler = new StructuredDataSampler(dataSource);
        } else if (DataFormats.UNSTRUCTURED == dataSource.format) {
            this.#sampler = new UnstructuredDataSampler(dataSource);
        }
    }
    #samplePlain(vert, dataArray) {
        if (vert.index !== undefined) {
            // this is a point in the dataset
            return dataArray[vert.index];
        }

        return this.#sampler.getValAt(vert.pos, dataArray);
    }

    // perform finite difference to find derivative
    #sampleDer(vert, dataArray, dim) {
        const v0 = this.#samplePlain(vert, dataArray);

        const pp = [...vert.pos];
        pp[dim] += EPSILON_DER;
        const vp = this.#sampler.getValAt(pp, dataArray);

        if (vp !== undefined) {
            return (vp - v0)/EPSILON_DER
        } else {
            const pm = [...vert.pos];
            pm[dim] -= EPSILON_DER;
            const vm = this.#sampler.getValAt(pm, dataArray) ?? v0;
            return (v0 - vm)/EPSILON_DER
        }
    }
    

    sample(vert, dataArray, modifier = DataModifiers.NONE) {
        let val;
        switch (modifier) {
            case DataModifiers.NONE:
                val = this.#samplePlain(vert, dataArray);
                break;
            case DataModifiers.DERIVATIVE_X:
                val = this.#sampleDer(vert, dataArray, 0);
                break;
            case DataModifiers.DERIVATIVE_Y:
                val = this.#sampleDer(vert, dataArray, 1);
                break;
            case DataModifiers.DERIVATIVE_Z:
                val = this.#sampleDer(vert, dataArray, 2);
                break;
        }

        return val;
    }
}