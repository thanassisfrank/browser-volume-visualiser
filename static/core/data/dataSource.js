// dataSource.js
// contains classes for handling different types of data sources, backing data objects
import {mat4} from "../gl-matrix.js";
import { DATA_TYPES } from "../utils.js";
import h5wasm from "../h5wasm/hdf5_hl.js";
import * as cgns from "./cgns_hdf5.js";
import { VectorMappingHandler } from "./vectorDataArray.js";
import { createVertexIterator } from "./vertexIterator.js";


const DEFAULT_ARRAY_NAME = "Default";


export const DataFormats = {
    EMPTY:           "empty",  // undefined/empty
    STRUCTURED:      "structured",  // data points are arranged as a contiguous texture
    STRUCTURED_GRID: "structured grid",  // data is arranged as a contiguous 3d texture, each point has a sumplemental position
    UNSTRUCTURED:    "unstructured",  // data points have a value and position, supplemental connectivity information
};

export const DataArrayTypes = {
    NONE:           "none",
    DATA:           "data",
    CALC:           "calculated"
};


// base data sources

class EmptyDataSource {
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
            max: size.map(v => v - 1)
        };
        this.dataTransformMat = mat4.fromScaling(
            mat4.create(), [cellSize.z || 1, cellSize.y || 1, cellSize.x || 1]
        );
    }

    // get the available data array desciptors
    getAvailableDataArrays() {
        return [{name: DEFAULT_ARRAY_NAME, arrayType: DataArrayTypes.DATA}]
    }

    // load the data array
    getDataArray(desc) {
        if (desc.name != DEFAULT_ARRAY_NAME) return;

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
            max: size.map(v => v - 1)
        };
        this.dataTransformMat = mat4.fromScaling(
            mat4.create(), 
            [cellSize.z || 1, cellSize.y || 1, cellSize.x || 1]
        );
    }

    getAvailableDataArrays() {
        return [{name: DEFAULT_ARRAY_NAME, arrayType: DataArrayTypes.DATA}];
    }

    async getDataArray(desc) {
        if (desc.name != DEFAULT_ARRAY_NAME) return;
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

        return dataNodes.map(node => {
            return {name: node.attrs.name.value, arrayType: DataArrayTypes.DATA};
        });
    }

    getDataArray(desc) {
        const data = this.flowSolutionNode.get(desc.name + "/ data")?.value;
        if (!data) return;
        let limits = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
        for (let i = 0; i < data.length; i++) {
            limits = [Math.min(limits[0], data[i]), Math.max(limits[1], data[i])];
        }

        return {
            name: desc.name,
            data,
            limits,
        };
    }
}


// transforming data sources

class EmptyTransformDataSource extends EmptyDataSource {
    constructor(dataSource) {
        super();
        this.dataSource = dataSource;
    }

    async init() {
        await this.dataSource.init();
        this.name = this.dataSource.name;
        this.size = this.dataSource.size;
        this.extentBox = this.dataSource.extentBox;
    }

    getAvailableDataArrays() {
        return this.dataSource.getAvailableDataArrays();
    }

    async getDataArray(name) {
        return this.dataSource.getDataArray(name);
    }
}


// simple downsampling transform
export class DownsampleStructDataSource extends EmptyTransformDataSource {
    constructor(dataSource, scale) {
        super(dataSource);
        this.scale = scale;
        this.size = this.dataSource.size.map(length => Math.floor(length/scale));
        this.extentBox = {
            min: this.dataSource.extentBox.min,
            max: this.size.map(v => v - 1)
        }
        this.format = DataFormats.STRUCTURED;
        this.name = dataSource.name;
    }

    init() {}

    async getDataArray(name) {
        const fullData = await this.dataSource.getDataArray(name);
        if (!fullData) return;
        
        const downSampData = new Float32Array(this.size[0]*this.size[1]*this.size[2]);
        // write values
        let thisIndex;
        let thisFullIndex;
        for (let k = 0; k < this.size[2]; k++) { // loop z
            for (let j = 0; j < this.size[1]; j++) { // loop y
                for (let i = 0; i < this.size[0]; i++) { // loop x
                    thisIndex = k * this.size[0] * this.size[1] + j * this.size[0] + i;
                    thisFullIndex = (k * this.dataSource.size[0] * this.dataSource.size[1] + j * this.dataSource.size[0] + i) * this.scale;
                    downSampData[thisIndex] = fullData.data[thisFullIndex];
                }
            }
        }

        return {
            name: fullData.name,
            data: downSampData,
            limits: fullData.limits,
        };
    }
}


// conversion from structured to unstructured
export class UnstructFromStructDataSource extends EmptyTransformDataSource {
    mesh = {
        positions: null,
        cellOffsets: null,
        cellConnectivity: null,
        cellTypes: null,
    };

    constructor(dataSource) {
        if (dataSource.format != DataFormats.STRUCTURED) throw TypeError("Source data is not STRUCTURED");
        super(dataSource);
        this.format = DataFormats.UNSTRUCTURED;
    }

    // calculate the mesh
    init() {
        super.init();
        const dataSize = this.dataSource.size;

        const pointCount = dataSize[0] * dataSize[1] * dataSize[2];
        const cubesCount = (dataSize[0] - 1)*(dataSize[1] - 1)*(dataSize[2] - 1);
        const tetsCount = cubesCount * 5;
        

        this.mesh.positions = new Float32Array(pointCount * 3);
        this.mesh.cellConnectivity = new Uint32Array(tetsCount * 4); // 5 tet per hex, 4 points per tet
        this.mesh.cellOffsets = new Uint32Array(tetsCount); // 5 tet per hex, 4 points per tet
        this.mesh.cellTypes = new Uint32Array(tetsCount); // 5 tet per hex, 4 points per tet
        this.mesh.cellTypes.fill(10); // all tets

        var getIndex = (i, j, k) => {
            return k * dataSize[0] * dataSize[1] + j * dataSize[0] + i;
        }
        var getHexCellIndex = (i, j, k) => {
            return k * (dataSize[0] - 1) * (dataSize[1] - 1) + j * (dataSize[0] - 1) + i;
        }
        var writeTet = (cellIndex, coords) => {
            var cellOffset = cellIndex * 4;
            this.mesh.cellOffsets[cellIndex] = cellOffset;
            this.mesh.cellConnectivity[cellOffset    ] = getIndex(...(coords[0]));
            this.mesh.cellConnectivity[cellOffset + 1] = getIndex(...(coords[1]));
            this.mesh.cellConnectivity[cellOffset + 2] = getIndex(...(coords[2]));
            this.mesh.cellConnectivity[cellOffset + 3] = getIndex(...(coords[3]));
        }

        var writePoint = (pointIndex, x, y, z) => {
            this.mesh.positions[3 * pointIndex    ] = x;
            this.mesh.positions[3 * pointIndex + 1] = y;
            this.mesh.positions[3 * pointIndex + 2] = z;
        }
        
        // rip hexahedra
        for (let k = 0; k < dataSize[2] - 1; k++) { // loop z
            for (let j = 0; j < dataSize[1] - 1; j++) { // loop y
                for (let i = 0; i < dataSize[0] - 1; i++) { // loop x
                    var thisIndex = getHexCellIndex(i, j, k);        
                    // tet 1
                    writeTet(5 * thisIndex + 0, 
                        [
                            [i,     j,     k    ], 
                            [i + 1, j,     k    ],
                            [i,     j + 1, k    ],
                            [i,     j,     k + 1],
                        ]
                    );

                    // tet 2
                    writeTet(5 * thisIndex + 1, 
                        [
                            [i + 1, j,     k    ],
                            [i + 1, j + 1, k    ], 
                            [i,     j + 1, k    ],
                            [i + 1, j + 1, k + 1],
                        ]
                    );
                        
                    // tet 3
                    writeTet(5 * thisIndex + 2, 
                        [
                            [i,     j,     k + 1],
                            [i + 1, j + 1, k + 1],
                            [i + 1, j,     k + 1],
                            [i + 1, j,     k    ],
                        ]
                    );

                    // tet 4
                    writeTet(5 * thisIndex + 3, 
                        [
                            [i,     j,     k + 1],
                            [i + 1, j + 1, k + 1],
                            [i,     j + 1, k    ],
                            [i,     j + 1, k + 1],
                        ]
                    );

                    // tet 5
                    writeTet(5 * thisIndex + 4, 
                        [
                            [i + 1, j,     k    ],
                            [i,     j + 1, k    ],
                            [i,     j,     k + 1],
                            [i + 1, j + 1, k + 1], 
                        ]
                    );
                }
            }
        }
        
        // write point positions
        for (let k = 0; k < dataSize[2]; k++) { // loop z
            for (let j = 0; j < dataSize[1]; j++) { // loop y
                for (let i = 0; i < dataSize[0]; i++) { // loop x
                    // write the position
                    var thisIndex = getIndex(i, j, k);
                    writePoint(thisIndex, i, j, k);
                }
            }
        }
    }
}


// tiling transformation that copies data the required number of times in the x, y and z directions


// handles the calculations of mappings from a vector of data arrays to a single scalar
// e.g. vector magnitude, q criterion, mach number
export class CalcVectArraysDataSource extends EmptyTransformDataSource {
    #mappingHandler;
    #vertexIterator;

    constructor(dataSource) {
        super(dataSource)
        this.#mappingHandler = new VectorMappingHandler();
        this.#vertexIterator = createVertexIterator(dataSource);
    }

    async init() {
        await super.init()
        this.format = this.dataSource.format;
        if (DataFormats.UNSTRUCTURED == this.format) {
            this.mesh = this.dataSource.mesh;
            this.geometry = this.dataSource.geometry;
        }
    }

    getAvailableDataArrays() {
        const sourceArrayDescriptors = this.dataSource.getAvailableDataArrays();

        // if this doesn't have a valid vert iterator, can't access the mapped arrays
        if (!this.#vertexIterator) return sourceArrayDescriptors;

        // find the possible calculable data arrays given the source data
        const mappingOutputNames = this.#mappingHandler.getPossibleMappings(sourceArrayDescriptors);
        const calcArrayDescriptors = mappingOutputNames.map(v => {
            return {name: v, arrayType: DataArrayTypes.CALC}
        });

        // return the combination of the two
        return [
            ...sourceArrayDescriptors,
            ...calcArrayDescriptors
        ];
    }

    getDataArray(desc) {
        // debugger;
        if (DataArrayTypes.CALC != desc.arrayType) {
            return this.dataSource.getDataArray(desc);
        }
        
        // check if the vertex iterator was created properly
        if (!this.#vertexIterator) return;
        
        // check if this is a valid mapping output
        const inputs = this.#mappingHandler.getRequiredInputs(desc.name);
        if (!inputs) return;
        const mapFunc = this.#mappingHandler.getMappingFunction(desc.name);
        if (!mapFunc) return;
        
        // try to load all of the input arrays
        // these are not modified with derivatives at this point
        const inputArrays = inputs.map(v => this.dataSource.getDataArray({name: v.name}));
        
        // check if they could all be loaded
        if (!inputArrays.every(a => a)) return;
        
        // create output array of same size as input
        const outputArray = new Float32Array(inputArrays[0].data.length);
        const limits = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

        for (let vert of this.#vertexIterator.iterate()) {
            const val = mapFunc(...inputArrays.map(a => a.data[vert.index]));
            
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