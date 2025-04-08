// dataSource.js
// contains classes for handling different types of data sources, backing data objects
import {mat4} from "../../gl-matrix.js";
import { DATA_TYPES, FetchSocket } from "../../utils.js";
import * as cgns from "./cgns/cgns_hdf5.js";
import { DataFormats, DataArrayTypes } from "../dataConstants.js";
import { buildUnstructuredTree, getLeafMeshBuffers, getLeafMeshBuffersAnalyse, loadUnstructuredTree, UnstructuredTree } from "../cellTree.js";
import { CornerValTypes, createNodeCornerValuesBuffer, loadCornerValues } from "../treeNodeValues.js";
import { processLeafMeshDataInfo } from "../cellTreeUtils.js";


const DEFAULT_ARRAY_NAME = "Default";


// base data sources

class EmptyDataSource {
    name = "";
    format = DataFormats.EMPTY;
    extentBox = {min: [0, 0, 0], max: [0, 0, 0]};
    dataTransformMat = mat4.create();
    
    constructor() {}

    // initialises the dataset, fetching information from the server if required
    init() {}

    // returns a list of descriptors of all the scalar data arrays that are
    // a part of this dataset
    getAvailableDataArrays() {}

    // returns the data for whole dataset for the given descriptor that is available
    // > could return the vertex-centred data buffer is this is available as one
    // > could return the corner values if available/required
    // > also retreives/calculates the min/max (limits) of this set of scalar data
    getDataArray(desc) {}
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
        const f = await cgns.fetchCGNS(this.path, this.name);

        const CGNSBaseNode = cgns.getChildrenWithLabel(f, "CGNSBase_t")[0]; // get first base node
        const CGNSZoneNode = cgns.getChildrenWithLabel(CGNSBaseNode, "Zone_t")[0]; // get first zone node in base node
        const zoneTypeNode = cgns.getChildrenWithLabel(CGNSZoneNode, "ZoneType_t")[0]; // get zone type node
        
        // only unstructured zones are currently supported
        const zoneTypeStr = String.fromCharCode(...zoneTypeNode.get(" data").value);
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

// provides an interface to a partial CGNS dataset
export class PartialCGNSDataSource extends EmptyDataSource {
    format = DataFormats.BLOCK_UNSTRUCTURED;
    tree = null;
    
    extentBox = {
        min: [0, 0, 0],
        max: [0, 0, 0]
    };

    #valuesCache = {}

    nodeCount;
    leafCount;

    maxCellCount;
    maxVertCount;

    #cornerFlowSolution;
    #flowSolutionLimits;
    #flowSolutionRanges;

    // all cells are tetrahedra
    vertsPerCell = 4;

    // TODO: extract from cgns file
    totalCellCount = 0;

    #socket;

    #maxBlocksPerRequest = 1000;



    constructor(name, path, meshPath) {
        super();
        this.name = name;
        this.path = path;
        this.meshPath = meshPath;

        this.#socket = new FetchSocket("/data-blocks");
    }

    // initialises the dataset with the partial CGNS file
    // > requests the partial CGNS file from the server
    // > extracts information about the node tree and mesh block sizes
    // > keeps a reference to the corner value flow solution node for pulling data arrays from
    async init() {
        const f = await cgns.fetchCGNS(this.path, this.name);

        const CGNSBaseNode = cgns.getChildrenWithLabel(f, "CGNSBase_t")[0]; // get first base node
        const CGNSZoneNode = cgns.getChildrenWithLabel(CGNSBaseNode, "Zone_t")[0]; // get first zone node in base node
        const zoneTypeNode = cgns.getChildrenWithLabel(CGNSZoneNode, "ZoneType_t")[0]; // get zone type node
        
        // only unstructured zones are currently supported
        var zoneTypeStr = String.fromCharCode(...zoneTypeNode.get(" data").value);
        const testZoneType = "ZoneTypeUserDefined";
        if (zoneTypeStr != testZoneType) {
            throw "Unsupported ZoneType of '" + zoneTypeStr + "', expected '" + testZoneType + "'";
        }

        // get the physical extent of the dataset
        const extentBuff = CGNSZoneNode.get("ZoneBounds/ data").value;
        this.extentBox.min = [extentBuff[0], extentBuff[1], extentBuff[2]];
        this.extentBox.max = [extentBuff[3], extentBuff[4], extentBuff[5]];

        // extract node count information
        const nodeCountBuff = CGNSZoneNode.get("TreeData/ data").value;
        this.nodeCount = nodeCountBuff[0];
        this.leafCount = nodeCountBuff[1];

        // extract the node tree from the file
        // create empty tree object
        this.tree = new UnstructuredTree(this.splitType, this.maxDepth, this.maxCells, this.extentBox);
        // load the node tree as an array buffer
        const nodesBuff = CGNSZoneNode.get("NodeTree/ data").value.buffer;
        console.log(CGNSZoneNode.get("NodeTree/ data"));
        // set the buffers in the tree object
        this.tree.setBuffers(nodesBuff, null, this.nodeCount);

        // get corner val type
        const cornTypeStr = String.fromCharCode(...CGNSZoneNode.get("CornerValueType/ data").value);

        if ("Sample" == cornTypeStr) {
            this.cornerValType = CornerValTypes.SAMPLE;
        } else {
            console.warn(`Unsupported corner value type found: ${cornTypeStr}`);
        }

        // get the corner value flow solutions
        this.#cornerFlowSolution = CGNSZoneNode.get("FlowSolution");
        // ...and limits
        this.#flowSolutionLimits = CGNSZoneNode.get("FlowSolutionLimits");
        // ...and ranges
        this.#flowSolutionRanges = CGNSZoneNode.get("FlowSolutionRanges");


        // extract leaf mesh max vert and cell info
        const primCountBuff = CGNSZoneNode.get("MaxPrimitives/ data").value;
        this.maxCellCount = primCountBuff[0];
        this.maxVertCount = primCountBuff[1];

        // convert to block sizes
        this.meshBlockSizes = {
            positions: this.maxVertCount * 3,
            values: this.maxVertCount,
            cellOffsets: this.maxCellCount,
            cellConnectivity: this.maxCellCount * this.vertsPerCell
        };
    }

    // takes the monolithic buffer returned by the server and splits it
    // returns an object with geometry and scala buffers broken out
    parseRespBuffer(buff, parsed, indices, geometry, scalarNames) {
        let bytesExpected = 0;
        if (geometry) {
            bytesExpected += indices.length * this.maxVertCount * 3 * 4;
            bytesExpected += indices.length * this.maxCellCount * this.vertsPerCell * 4;
        }
        bytesExpected += indices.length * this.maxVertCount * scalarNames.length * 4;

        const bytesDiff = bytesExpected - buff.byteLength;
        if (bytesDiff !== 0) {
            throw Error("Could not extract data from received buffer; Bytes Difference: " + bytesDiff);
        }


        for (let i = 0; i < indices.length; i++) {
            parsed[indices[i]] = {};
        }
        // debugger;
        
        let byteOffset = 0;
        const extractSection = (name, type, elementCount) => {
            if ("cellConnectivity" == name) {
                // take 1 from every entry to go from 1-based -> 0-based
                const conn = new type(buff, byteOffset, elementCount * indices.length)
                for (let i = 0; i < conn.length; i++) {
                    conn[i]--;
                }
            }

            for (let i = 0; i < indices.length; i++) {
                parsed[indices[i]][name] = new type(buff, byteOffset, elementCount);
                
                byteOffset += elementCount * type.BYTES_PER_ELEMENT;
            }
        }

        // split the buffer into the different semantic parts
        if (geometry) {
            // extract vertex positions and connectivity
            extractSection("positions", Float32Array, this.maxVertCount * 3);
            extractSection("cellConnectivity", Uint32Array, this.maxCellCount * this.vertsPerCell);
        }

        for (let i = 0; i < scalarNames.length; i++) {
            extractSection(scalarNames[i], Float32Array, this.maxVertCount);
        }

        return parsed;
    }

    // requests the mesh block from the server with this node index
    // waits for the response from the server
    // can return the geometry (vert positions, connectivity)
    // returns the vert-centred data with the supplied identifiers
    async getMeshBlocks(indices, geometry, scalarNames) {
        // debugger;
        let parsed = {};
        const reqCount = Math.ceil(indices.length/this.#maxBlocksPerRequest);
        for (let i = 0; i < reqCount; i++) {
            const thisIndices = indices.slice(i * this.#maxBlocksPerRequest, (i + 1) * this.#maxBlocksPerRequest);
            // convert the node indices into leaf indices
            // create the json request
            const request = {
                mode: "meshblocks",
                path: this.meshPath,
                blocks: thisIndices,
                geometry: !!geometry,
                scalars: scalarNames ?? []
            }
    
            // send the request
            const resp = await this.#socket.fetch(JSON.stringify(request));
            const buff = await resp.arrayBuffer();
            // console.log(buff);

            this.parseRespBuffer(buff, parsed, thisIndices, geometry, scalarNames);
        }

        // pull out the different buffers

        return parsed;
    }

    getAvailableDataArrays() {
        const dataNodes = cgns.getChildrenWithLabel(this.#cornerFlowSolution, "DataArray_t");

        return dataNodes.map(node => {
            return {name: node.attrs.name.value, arrayType: DataArrayTypes.DATA};
        });
    }

    // returns only the corner value buffer for this data array name
    getDataArray(desc) {
        if (this.#valuesCache[desc.name]) return this.#valuesCache[desc.name];

        const data = this.#cornerFlowSolution.get(desc.name + "/ data")?.value;
        if (!data) return;
        const limits = this.#flowSolutionLimits?.get(desc.name + "/ data")?.value;
        const ranges = this.#flowSolutionRanges?.get(desc.name + "/ data")?.value;

        const result = {
            name: desc.name,
            cornerValues: data,
            limits,
            ranges,
        };

        this.#valuesCache[desc.name] = result;
        return result;
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

        if (DataFormats.UNSTRUCTURED == this.dataSource.format || DataFormats.BLOCK_UNSTRUCTURED == this.dataSource.format) {
            // get geometry data of UNSTRUCTURED meshes
            this.mesh = this.dataSource.mesh;
            this.geometry = this.dataSource.geometry;
        }
    }

    getAvailableDataArrays() {
        return this.dataSource.getAvailableDataArrays();
    }

    async getDataArray(desc) {
        return await this.dataSource.getDataArray(desc);
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

    async getDataArray(desc) {
        const fullData = await this.dataSource.getDataArray(desc);
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
    async init() {
        await super.init();
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

// creates an unstructured tree for its data source
export class TreeUnstructDataSource extends EmptyTransformDataSource {
    format = DataFormats.UNSTRUCTURED;
    tree;
    loadedTreeInfo;


    constructor(dataSource, availableTrees, splitType, maxDepth, maxCells, cornerValType) {
        if (DataFormats.UNSTRUCTURED != dataSource.format) throw TypeError("Source data is not UNSTRUCTURED");
        super(dataSource);
        this.availableTrees = availableTrees;
        
        this.splitType = splitType;
        this.maxDepth = maxDepth;
        this.maxCells = maxCells;

        this.cornerValType = cornerValType;
    }
    
    async init() {
        await super.init();

        // create the tree object
        this.tree = new UnstructuredTree(this.splitType, this.maxDepth, this.maxCells, this.dataSource.extentBox, this.dataSource.mesh);

        // load or build the tree
        this.loadedTreeInfo = await loadUnstructuredTree(this.tree, this.availableTrees);
        if (!this.loadedTreeInfo) {
            console.log("generating tree");
            const treeBuffers = buildUnstructuredTree(this.tree);
        }
    }

    // returns the vertex and node corner data
    async getDataArray(desc) {
        // get the vertex data from the data source
        let dataArray = await this.dataSource.getDataArray(desc);
        if (!dataArray) return;

        // try load corner values first
        let cornerValues = await loadCornerValues(desc, this.loadedTreeInfo, this.cornerValType);

        if (!cornerValues) {
            console.log("generating corner vals");
            cornerValues = createNodeCornerValuesBuffer(dataArray, this.tree, this.cornerValType);
        }

        return {
            ...dataArray,
            cornerValues
        };
    }
}


// converts an unstructured data source into a block unstructured one based on its tree
export class BlockFromUnstructDataSource extends EmptyTransformDataSource {
    format = DataFormats.BLOCK_UNSTRUCTURED;

    #valuesCache = {};

    leafVerts;
    fullToLeafIndexMap;

    totalCellCount;
    leafCount;

    meshBlockSizes;

    // special version of the nodes buffer with modified cells ptrs
    blockNodes;

    constructor(dataSource) {
        if (dataSource.format != DataFormats.UNSTRUCTURED) throw TypeError("Source data is not UNSTRUCTURED");
        super(dataSource);

        this.cornerValType = this.dataSource.cornerValType;
    }

    #calcMeshBlockSizes() {
        let maxCells = 0; // max number of cells found within the leaf nodes
        let maxVerts = 0; // max number of unique verts found in the leaf nodes
        let leafCount = 0;
        processLeafMeshDataInfo(this.dataSource.mesh, this.tree, l => {
            maxCells = Math.max(maxCells, l.cells);
            maxVerts = Math.max(maxVerts, l.verts);
            leafCount++;
        });

        console.log(maxCells, maxVerts);
        this.leafCount = leafCount;
        this.meshBlockSizes = {
            values: maxVerts,
            positions: 3 * maxVerts,
            cellOffsets: maxCells,
            cellConnectivity: 4 * maxCells,
        };
    }

    async init() {
        await super.init();
        this.tree = this.dataSource.tree;
        if (!this.tree) throw TypeError("Source data needs to expose a tree");

        this.totalCellCount = this.dataSource.mesh.cellOffsets.length;
        
        this.#calcMeshBlockSizes();

        // create the new buffers
        const leafMeshBuffers = getLeafMeshBuffers(this.dataSource.mesh, this.tree, this.meshBlockSizes, this.leafCount);
        // const leafMeshBuffers = getLeafMeshBuffersAnalyse(this.dataSource.mesh, this.tree, this.meshBlockSizes, this.leafCount);

        // over write the plain mesh buffers
        this.mesh.positions = leafMeshBuffers.positions;
        this.mesh.cellOffsets = leafMeshBuffers.cellOffsets;
        this.mesh.cellConnectivity = leafMeshBuffers.cellConnectivity;

        this.leafVerts = leafMeshBuffers.leafVerts;
        this.fullToLeafIndexMap = leafMeshBuffers.indexMap;

        this.blockNodes = leafMeshBuffers.nodes;

        console.log(leafMeshBuffers);
    }

    // for now, only return the section of the mesh, data is handled in data obj
    getNodeMeshBlock(nodeIndex) {
        if (!this.fullToLeafIndexMap.has(nodeIndex)) return;
        const leafIndex = this.fullToLeafIndexMap.get(nodeIndex);
        // slice the mesh geometry buffers
        let buffers = {
            positions: this.mesh.positions.slice(
                leafIndex * this.meshBlockSizes.positions, (leafIndex + 1) * this.meshBlockSizes.positions
            ),
            cellOffsets: this.mesh.cellOffsets.slice(
                leafIndex * this.meshBlockSizes.cellOffsets, (leafIndex + 1) * this.meshBlockSizes.cellOffsets
            ),
            cellConnectivity: this.mesh.cellConnectivity.slice(
                leafIndex * this.meshBlockSizes.cellConnectivity, (leafIndex + 1) * this.meshBlockSizes.cellConnectivity
            )
        };

        // return the buffers together
        return {
            buffers,
            valueSliceRange: [
                leafIndex * this.meshBlockSizes.values, 
                (leafIndex + 1) * this.meshBlockSizes.values
            ]
        };
    }

    async getDataArray(desc) {
        if (this.#valuesCache[desc.name]) return this.#valuesCache[desc.name];
        
        const dataArray = await this.dataSource.getDataArray(desc);
        if (!dataArray) return;
        // create new buffer to re-write values into
        // if vert count < block length, value of vert 0 will be written in empty space
        const blockVals = new Float32Array(this.leafVerts.length);
        this.leafVerts.forEach((e, i) => blockVals[i] = dataArray.data[e]);

        dataArray.data = blockVals;

        this.#valuesCache[desc.name] = result;
        return result;
    }

    // get multiple mesh blocks
    // mirrors behaviour of partial cgns
    async getMeshBlocks(indices, geometry, scalarNames) {
        
    }
}


// TODO: tiling transformation that copies data the required number of times in the x, y and z directions