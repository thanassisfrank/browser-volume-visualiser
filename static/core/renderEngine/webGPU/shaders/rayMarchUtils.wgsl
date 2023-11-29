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
    fixedCamera : bool,
    randStart : bool,
    showSurface : bool,
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
        (flagUint & 32u) == 32u,
        (flagUint & 64u) == 64u,
    );
};

// adds the contribution of this segment to the previous absorption amount
// to get the attenuation factor, a base is raised to this power
fn accumulateSampleCol(sample : f32, length : f32, prevCol : vec3<f32>, lowLimit : f32, highLimit : f32, threshold : f32) -> vec3<f32> {
    var normalisedSample = (sample - lowLimit)/(highLimit - lowLimit);
    var normalisedThreshold = (threshold - lowLimit)/(highLimit - lowLimit);
    var absorptionCoeff = pow(normalisedSample/2, 1.2);
    var sampleCol = absorptionCoeff * vec3<f32>(1.0) * length; // transfer function
    
    return prevCol + sampleCol;
}

fn attenuateCol(inCol : vec4<f32>, absorptionCol : vec3<f32>) -> vec4<f32> {
    var absorption = vec3<f32>(
        exp2(-absorptionCol.r),
        exp2(-absorptionCol.g),
        exp2(-absorptionCol.b),
    );
    return vec4<f32>(
        inCol.r * absorption.r,
        inCol.g * absorption.g,
        inCol.b * absorption.b,
        max(inCol.a, max(1-absorption.r, max(1-absorption.g, 1-absorption.b)))
    );
}


