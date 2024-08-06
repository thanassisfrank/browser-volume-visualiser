//cgns_hdf5.js
// library to handle interface with the cgns dataset standard

export const ELEMENT_TYPES = [
    "ElementTypeNull", 
    "ElementTypeUserDefined", 
    "NODE", 
    "BAR_2", 
    "BAR_3",
    "TRI_3", 
    "TRI_6", 
    "QUAD_4", 
    "QUAD_8", 
    "QUAD_9",
    "TETRA_4", 
    "TETRA_10", 
    "PYRA_5", 
    "PYRA_14",
    "PENTA_6", 
    "PENTA_15", 
    "PENTA_18", 
    "HEXA_8", 
    "HEXA_20", 
    "HEXA_27",
    "MIXED", 
    "PYRA_13", 
    "NGON_n", 
    "NFACE_n",
    "BAR_4", 
    "TRI_9", 
    "TRI_10", 
    "QUAD_12", 
    "QUAD_16",
    "TETRA_16", 
    "TETRA_20", 
    "PYRA_21", 
    "PYRA_29", 
    "PYRA_30",
    "PENTA_24", 
    "PENTA_38", 
    "PENTA_40", 
    "HEXA_32", 
    "HEXA_56", 
    "HEXA_64"
];

export const ELEMENT_VERTICES_COUNT = {
    "ElementTypeNull": undefined, 
    "ElementTypeUserDefined": undefined, 
    "NODE": 1, 
    "BAR_2": 2, 
    "BAR_3": 3,
    "TRI_3" : 3, 
    "TRI_6" : 6, 
    "QUAD_4": 4, 
    "QUAD_8": 8, 
    "QUAD_9": 9,
    "TETRA_4": 4, 
    "TETRA_10": 10, 
    "PYRA_5": 5, 
    "PYRA_14": 14,
    "PENTA_6": 6, 
    "PENTA_15": 15, 
    "PENTA_18": 18, 
    "HEXA_8": 8, 
    "HEXA_20": 20, 
    "HEXA_27": 27,
    "MIXED": undefined, 
    "PYRA_13": 13, 
    "NGON_n": undefined, 
    "NFACE_n": undefined,
    "BAR_4": 4, 
    "TRI_9": 9, 
    "TRI_10": 10, 
    "QUAD_12": 12, 
    "QUAD_16": 16,
    "TETRA_16": 16, 
    "TETRA_20": 20, 
    "PYRA_21": 21, 
    "PYRA_29": 29, 
    "PYRA_30": 30,
    "PENTA_24": 24, 
    "PENTA_38": 38, 
    "PENTA_40": 40, 
    "HEXA_32": 32, 
    "HEXA_56": 56, 
    "HEXA_64": 64
};

// num edges for each element
export const ELEMENT_EDGE_COUNT = [
    0, // ElementTypeNull
    0, // ElementTypeUserDefined
    0, // NODE
    0, // BAR_2
    0, // BAR_3
    0, // TRI_3
    0, // TRI_6
    0, // QUAD_4
    0, // QUAD_8
    0, // QUAD_9
    6, // TETRA_4
]



// labels are not necessarily unique among children
export var getChildrenWithLabel = (parent, label) => {
    var children = [];
    for (let link of parent.keys()) {
        var node = parent.get(link)
        if (node?.attrs?.label?.value == label) children.push(node);
    }
    return children;
}

//
export var getGridCoordinatePositionsCart3D = (gridCoordsNode) => {
    
    var coordsXNode = gridCoordsNode.get("CoordinateX");
    var coordsYNode = gridCoordsNode.get("CoordinateY");
    var coordsZNode = gridCoordsNode.get("CoordinateZ");

    if (!coordsXNode || !coordsYNode || !coordsZNode) {
        throw "Unable to find 3D cartesian coordinate data nodes";
    }

    const pointsCount = coordsXNode.get(" data").shape[0];

    var coordsX = coordsXNode.get(" data").value;
    var coordsY = coordsYNode.get(" data").value;
    var coordsZ = coordsZNode.get(" data").value;

    // console.log(coordsX);

    var min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    var max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

    var positions = new Float32Array(pointsCount * 3);
    for (let i = 0; i < pointsCount; i++) {
        positions[3*i + 0] = coordsX[i];
        positions[3*i + 1] = coordsY[i];
        positions[3*i + 2] = coordsZ[i];

        min = [Math.min(min[0], coordsX[i]), Math.min(min[1], coordsY[i]), Math.min(min[2], coordsZ[i])];
        max = [Math.max(max[0], coordsX[i]), Math.max(max[1], coordsY[i]), Math.max(max[2], coordsZ[i])];
    }

    return {
        positions: positions,
        extentBox: {
            min: min,
            max: max
        }
    };
}