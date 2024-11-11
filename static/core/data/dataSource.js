// dataSource.js
// contains classes for handling different types of data sources, backing data objects
import {mat4} from "../gl-matrix.js";
import { DATA_TYPES } from "../utils.js";
import h5wasm from "../h5wasm/hdf5_hl.js";
import * as cgns from "./cgns_hdf5.js";


const DEFAULT_ARRAY_NAME = "Default";


export const DataFormats = {
    EMPTY:           "empty",  // undefined/empty
    STRUCTURED:      "structured",  // data points are arranged as a contiguous texture
    STRUCTURED_GRID: "structured grid",  // data is arranged as a contiguous 3d texture, each point has a sumplemental position
    UNSTRUCTURED:    "unstructured",  // data points have a value and position, supplemental connectivity information
};

export class EmptyDataSource {
    name = "";
    format = DataFormats.EMPTY;
    extentBox = {min: [0, 0, 0], max: [0, 0, 0]};
    dataTransformMat = mat4.create();
    
    constructor() {}
    init() {}
    getAvailableDataArrays() {}
    getDataArray(name) {}
}

export class FunctionDataSource extends EmptyDataSource {
    format = DataFormats.STRUCTURED;
    // any initialisation
    constructor(f, size, cellSize) {
        super();
        this.f = f;
        this.size = size;
        this.extentBox = {
            min: [0, 0, 0],
            max: [...size]
        };
        this.dataTransformMat = mat4.fromScaling(
            mat4.create(), [cellSize.z || 1, cellSize.y || 1, cellSize.x || 1]
        );
    }

    // get the available data array desciptors
    getAvailableDataArrays() {
        return [DEFAULT_ARRAY_NAME]
    }

    // load the data array
    getDataArray(name) {
        if (name != DEFAULT_ARRAY_NAME) return;

        let v = 0.0;
        var data = new Float32Array(x * y * z);
        var limits = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
        for (let i = 0; i < x; i++) {
            for (let j = 0; j < y; j++) {
                for (let k = 0; k < z; k++) {
                    // values are clamped to >= 0
                    v = Math.max(0, this.f(i, j, k));
                    limits = [Math.min(limits[0], v), Math.max(limits[1], v)];
                    data[i * y * z + j * z + k] = v;
                }
            }
        }
        return {name: DEFAULT_ARRAY_NAME, data, limits};
    }
}

export class RawDataSource extends EmptyDataSource {
    format = DataFormats.STRUCTURED;
    constructor(name, path, dataType, limits, size, cellSize) {
        super();
        this.name = name;
        this.path = path;
        this.dataType = dataType;
        this.limits = limits;
        this.size = size;
        this.extentBox = {
            min: [0, 0, 0],
            max: [...size]
        };
        this.dataTransformMat = mat4.fromScaling(
            mat4.create(), 
            [cellSize.z || 1, cellSize.y || 1, cellSize.x || 1]
        );
    }

    getAvailableDataArrays() {
        return [DEFAULT_ARRAY_NAME];
    }

    async getDataArray(name) {
        if (name != DEFAULT_ARRAY_NAME) return;
        const responseBuffer = await fetch(this.path).then(resp => resp.arrayBuffer());

        // load data
        return {
            name: DEFAULT_ARRAY_NAME,
            data: new DATA_TYPES[this.dataType](responseBuffer),
            limits: this.limits,
        };
    }
}

export class CGNSDataSource extends EmptyDataSource {
    // public attributes
    format = DataFormats.UNSTRUCTURED;
    mesh = {
        positions: null,
        cellOffsets: null,
        cellConnectivity: null,
        cellTypes: null,
    };
    geometry = {};
    flowSolutionNode;
    
    constructor(name, path) {
        super();
        this.name = name;
        this.path = path;
    }

    #loadMeshBuffers(CGNSZoneNode) {
        // get vertex positions
        var coordsNode = cgns.getChildrenWithLabel(CGNSZoneNode, "GridCoordinates_t")[0];
        var coords = cgns.getGridCoordinatePositionsCart3D(coordsNode);
        
        // get connectivity information for an element node of this zone
        var gridElementsNode = CGNSZoneNode.get("GridElements");

        var elementTypeInt = gridElementsNode.get(" data").value[0];
        var elementRange = gridElementsNode.get("ElementRange/ data").value;
        var connectivityNode = gridElementsNode.get("ElementConnectivity");
        
        var elementCount = elementRange[1] - elementRange[0] + 1;
        
        // create cell type array
        const cellTypes = new Uint32Array(elementCount).fill(elementTypeInt);
        console.log("elemenent type:", cgns.ELEMENT_TYPES[elementTypeInt]);

        // get cell connectivity
        const cellConnectivity = connectivityNode.get(" data").value;
        // convert to zero based indexing
        for (let i = 0; i < cellConnectivity.length; i++) {
            cellConnectivity[i]--;
        }

        // build the cell offsets array
        var pointsPerElement = cgns.ELEMENT_VERTICES_COUNT[cgns.ELEMENT_TYPES[elementTypeInt]];
        const cellOffsets = new Uint32Array(elementCount);
        for (let i = 0; i < elementCount; i++) {
            cellOffsets[i] = i * pointsPerElement;
        }

        this.extentBox = coords.extentBox;

        this.mesh = {
            positions: coords.positions,
            cellTypes,
            cellConnectivity,
            cellOffsets
        };
    }

    #loadGeometry(CGNSZoneNode) {
        // extract any mesh elements for structures/boundaries etc
        // look for element nodes where the type is TRI_3 = 5
        // the indices all reference this.geometry.positions
        var elementNodes = cgns.getChildrenWithLabel(CGNSZoneNode, "Elements_t");
        // keeps a track of the vertices already pulled in to the geometry positions buffer
        let uniqueVerts = new Map();
        let currVertIndex = 0;
        for (let node of elementNodes) {
            if (cgns.ELEMENT_TYPES[node.get(" data").value[0]] != "TRI_3") continue
            var meshName = node.attrs.name.value;
            // don't show boundary planes by default
            let showByDefault = true;
            if (["symmetry", "downstream", "upstream", "side", "lower", "upper"].includes(meshName)) showByDefault = false;

            // we have a triangular mesh element node
            var indices = node.get("ElementConnectivity/ data").value;
            for (let i = 0; i < indices.length; i++) {
                indices[i]--; // convert from 1-based -> 0-based
                // check if this vertex has already been seen
                if (uniqueVerts.has(indices[i])) {
                    indices[i] = uniqueVerts.get(indices[i]);
                } else {
                    uniqueVerts.set(indices[i], currVertIndex);
                    indices[i] = currVertIndex++;
                }
            }

            this.geometry[node.attrs.name.value] = {
                indices: indices,
                showByDefault: showByDefault
            };
        }

        // get the extracted positions buffer
        // a reference is kept in each geometry object
        const pos = new Float32Array(currVertIndex * 3);
        uniqueVerts.forEach((v, k) => {
            pos[3 * v + 0] = this.mesh.positions[3 * k + 0];
            pos[3 * v + 1] = this.mesh.positions[3 * k + 1];
            pos[3 * v + 2] = this.mesh.positions[3 * k + 2];
        });
        for (let meshName in this.geometry) {
            this.geometry[meshName].positions = pos;
        }
    }

    async init() {
        const { FS } = await h5wasm.ready;

        const responseBuffer = await fetch(this.path).then(resp => resp.arrayBuffer());

        FS.writeFile("yf17_hdf5.cgns", new Uint8Array(responseBuffer));
        // use mode "r" for reading.  All modes can be found in h5wasm.ACCESS_MODES
        let f = new h5wasm.File("yf17_hdf5.cgns", "r");

        var CGNSBaseNode = cgns.getChildrenWithLabel(f, "CGNSBase_t")[0]; // get first base node
        var CGNSZoneNode = cgns.getChildrenWithLabel(CGNSBaseNode, "Zone_t")[0]; // get first zone node in base node
        var zoneTypeNode = cgns.getChildrenWithLabel(CGNSZoneNode, "ZoneType_t")[0]; // get zone type node
        
        // only unstructured zones are currently supported
        var zoneTypeStr = String.fromCharCode(...zoneTypeNode.get(" data").value);
        if (zoneTypeStr != "Unstructured") {
            throw "Unsupported ZoneType of '" + zoneTypeStr + "'";
        }

        // get the mesh buffers
        this.#loadMeshBuffers(CGNSZoneNode);  
        
        // get any dataset geometry
        this.#loadGeometry(CGNSZoneNode);

        // track the flow solution node for loading data arrays later
        this.flowSolutionNode = cgns.getChildrenWithLabel(CGNSZoneNode, "FlowSolution_t")[0];
    }

    getAvailableDataArrays() {
        var dataNodes = cgns.getChildrenWithLabel(this.flowSolutionNode, "DataArray_t");

        return dataNodes.map(node => node.attrs.name.value);
    }

    getDataArray(name) {
        const data = this.flowSolutionNode.get(name + "/ data").value;
        let limits = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
        for (let i = 0; i < data.length; i++) {
            limits = [Math.min(limits[0], data[i]), Math.max(limits[1], data[i])];
        }

        return {
            name,
            data,
            limits,
        };
    }
}