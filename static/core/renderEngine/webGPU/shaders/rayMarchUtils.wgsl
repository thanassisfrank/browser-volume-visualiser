// rayMarchUtils.wgsl
// contains struct definitions and functions that are common to ray marching shaders

// structs ========================================================================================

// information needed for the ray marching pass
struct RayMarchPassInfo {
    flags : u32,
    threshold : f32,
    dataLowLimit : f32,
    dataHighLimit : f32,
    stepSize : f32,
    maxLength : f32,
    cellsInLeaves : u32,
    @align(16) dMatInv : mat4x4<f32>, // from world space -> data space
};

// a set of flags for settings within the pass
struct RayMarchPassFlags {
    phong : bool,
    backStep : bool,
    showNormals : bool,
    showVolume : bool,
    fixedCamera : bool
};

// functions ======================================================================================

// create a flags struct from the u32
fn getFlags(flagUint : u32) -> RayMarchPassFlags {
    return RayMarchPassFlags(
        (flagUint & 1u) == 1u,
        (flagUint & 2u) == 2u,
        (flagUint & 4u) == 4u,
        (flagUint & 8u) == 8u,
        (flagUint & 16u) == 16u,
    );
};