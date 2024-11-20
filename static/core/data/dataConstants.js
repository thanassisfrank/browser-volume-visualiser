// dataConstants.js


export const DataFormats = {
    EMPTY:              "empty",  // undefined/empty
    STRUCTURED:         "structured",  // data points are arranged as a contiguous texture
    STRUCTURED_GRID:    "structured grid",  // data is arranged as a contiguous 3d texture, each vert has a position
    UNSTRUCTURED:       "unstructured",  // data points have a value and position, supplemental connectivity information
    BLOCK_UNSTRUCTURED: "block unstruct" // unstructured data split into blocks
};

export const DataArrayTypes = {
    NONE: "none",
    DATA: "data",
    CALC: "calculated"
};

export const DataModifiers = {
    NONE:         "none",
    DERIVATIVE_X: "derivative x",
    DERIVATIVE_Y: "derivative y",
    DERIVATIVE_Z: "derivative z",
};

// these act as bit masks to create the full resolution mode
export const ResolutionModes = {
    FULL:              0b00, // resolution is fixed at the maximum 
    DYNAMIC_NODES_BIT: 0b01, // the resolution is variable
    DYNAMIC_CELLS_BIT: 0b10, // cell and vertex data are arranged per-leaf
};