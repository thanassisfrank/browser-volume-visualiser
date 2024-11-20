// vertexIterator.js
// provides functions for iterating through the vertices of a data source
import { DataFormats } from "./dataConstants.js"

class StructuredVertexIterator {
    #dataSource;
    constructor(dataSource) {
        this.#dataSource = dataSource;
    }

    // iterates all vertices
    iterate = function* () {
        for (let k = 0; k < this.#dataSource.size[2]; k++) {
            for (let j = 0; j < this.#dataSource.size[1]; j++) {
                for (let i = 0; i < this.#dataSource.size[0]; i++) {
                    yield {
                        index: i + this.#dataSource.size[0] * j + this.#dataSource.size[0] * this.#dataSource.size[1] * k,
                        pos: [i, j, k]
                    };
                }
            }
        }
    }
}

class UnstructuredVertexIterator {
    #dataSource;
    constructor(dataSource) {
        this.#dataSource = dataSource;
    }

    // iterates all vertices
    iterate = function* () {
        const positions = this.#dataSource.mesh.positions; 
        for (let i = 0; i < positions.length/3; i++) {
            yield {
                index: i,
                pos: [
                    positions[3 * i + 0],
                    positions[3 * i + 1],
                    positions[3 * i + 2],
                ]
            };
        }
    }
}


// creates a new iterator function
export function createVertexIterator(dataSource) {
    if (DataFormats.STRUCTURED == dataSource.format) {
        return new StructuredVertexIterator(dataSource);
    } else if (DataFormats.UNSTRUCTURED == dataSource.format) {
        return new UnstructuredVertexIterator(dataSource);
    }

    // else return nothing
    return;
}

