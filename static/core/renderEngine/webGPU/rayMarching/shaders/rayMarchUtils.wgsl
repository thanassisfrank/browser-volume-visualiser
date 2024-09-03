// rayMarchUtils.wgsl
// contains struct definitions and functions that are common to ray marching shaders

// structs ========================================================================================

// information needed for the ray marching pass
// 176 bytes in total
struct RayMarchPassInfo {
    @size(4)  flags : u32,
    @size(4)  framesSinceMove : u32,
    @size(4)  threshold : f32,
    @size(4)  dataLowLimit : f32,
    @size(4)  dataHighLimit : f32,
    @size(4)  dataBLowLimit : f32,
    @size(8)  dataBHighLimit : f32,
    @size(48) dataBox : AABB,
    @size(4)  stepSize : f32,
    @size(12) maxLength : f32,
    @size(64) dMatInv : mat4x4<f32>, // from world space -> data space
    @size(4)  isoSurfaceSrc : u32,
    @size(4)  surfaceColSrc : u32,
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
    showRayDirs: bool,
    showRayLength: bool,
    optimiseOffset: bool,
    showOffset: bool,
    showDeviceCoords: bool,
    sampleNearest: bool,
    showCells: bool,
    showNodeVals: bool,
    showNodeLoc: bool,
    showNodeDepth: bool,
    secantRoot: bool,
    renderNodeVals: bool,
    useBestDepth: bool,
};

// the return value of the ray-march function
struct RayMarchResult {
    foundSurface : bool,
    ray : Ray,
    volCol : vec3<f32>,
    normalFac : f32,
};

// offset optimisation sample
struct OptimisationSample {
    offset: f32,
    depth: f32,
};

// axis aligned bounding box with a value slot
struct AABB {
    min : vec3<f32>,
    max : vec3<f32>,
    val : u32,
};

// constants ======================================================================================

const DATA_SRC_NONE    = 0;
const DATA_SRC_VALUE_A = 1;
const DATA_SRC_VALUE_B = 2;
const DATA_SRC_AXIS_X  = 3;
const DATA_SRC_AXIS_Y  = 4;
const DATA_SRC_AXIS_Z  = 5;

// functions ======================================================================================

// create a flags struct from the u32
fn getFlags(flagUint : u32) -> RayMarchPassFlags {
    return RayMarchPassFlags(
        (flagUint & (1u << 0 )) != 0,
        (flagUint & (1u << 1 )) != 0,
        (flagUint & (1u << 2 )) != 0,
        (flagUint & (1u << 3 )) != 0,
        (flagUint & (1u << 4 )) != 0,
        (flagUint & (1u << 5 )) != 0,
        (flagUint & (1u << 6 )) != 0,
        (flagUint & (1u << 7 )) != 0,
        (flagUint & (1u << 8 )) != 0,
        (flagUint & (1u << 9 )) != 0,
        (flagUint & (1u << 10)) != 0,
        (flagUint & (1u << 11)) != 0,
        (flagUint & (1u << 12)) != 0,
        (flagUint & (1u << 13)) != 0,
        (flagUint & (1u << 14)) != 0,
        (flagUint & (1u << 15)) != 0,
        (flagUint & (1u << 16)) != 0,
        (flagUint & (1u << 17)) != 0,
        (flagUint & (1u << 18)) != 0,
        (flagUint & (1u << 19)) != 0,
    );
};


// returns the t value for progrssive offset optimisation
fn getTVal(x : f32) -> f32 {
    // exponential
        // var t : f32 = exp2(-f32(passInfo.framesSinceMove)/10.0);

    // linear
    //20 was used before
    // var t : f32 = 1 - x/300.0;

    // square
    var t : f32 = 1;
    if (passInfo.framesSinceMove > 400) {
        t = 0;
    }

    return t;
}


// gets the offset to be used
fn getOptimisationOffset(x : f32, prevOffset : f32, seed : u32) -> f32 {
    var randomVal : f32;
    var t : f32 = getTVal(f32(passInfo.framesSinceMove));

    if (t > 0) {
        // generate a new sampling threshold
        if (getRandF32(seed) < t) {
            // generate new offset
            return getRandF32(seed ^ 782035u);
        }
    }
    // otherwise, return the previous
    return prevOffset;
}

// test if a given point is within an AABB
fn pointInAABB(p : vec3<f32>, box : AABB) -> bool {
    if (
        p.x < box.min.x || p.y < box.min.y || p.z < box.min.z ||
        p.x > box.max.x || p.y > box.max.y || p.z > box.max.z
    ) {
        return false;
    } else {
        return true;
    }
};

// recovers the normal (gradient) of the data at the given point
fn getDataNormal (x : f32, y : f32, z : f32, dataSrc : u32) -> vec3<f32> {
    var epsilon : f32 = 0.5;
    var gradient : vec3<f32>;
    var p0 = sampleDataValue(x, y, z, dataSrc);
    if (x > epsilon) {
        gradient.x = -(p0 - sampleDataValue(x - epsilon, y, z, dataSrc))/epsilon;
    } else {
        gradient.x = (p0 - sampleDataValue(x + epsilon, y, z, dataSrc))/epsilon;
    }
    if (y > epsilon) {
        gradient.y = -(p0 - sampleDataValue(x, y - epsilon, z, dataSrc))/epsilon;
    } else {
        gradient.y = (p0 - sampleDataValue(x, y + epsilon, z, dataSrc))/epsilon;
    }
    if (z > epsilon) {
        gradient.z = -(p0 - sampleDataValue(x, y, z - epsilon, dataSrc))/epsilon;
    } else {
        gradient.z = (p0 - sampleDataValue(x, y, z + epsilon, dataSrc))/epsilon;
    }
    return normalize(gradient);
}

// converts from world space -> data space relative
fn toDataSpace(pos : vec3<f32>) -> vec3<f32> {
    return (vec4<f32>(pos, 1) * transpose(passInfo.dMatInv)).xyz;
}

// adds the contribution of this segment to the previous absorption amount
// to get the attenuation factor, a base is raised to this power
// implements the transfer function
fn accumulateSampleCol(sample : f32, length : f32, prevCol : vec3<f32>, lowLimit : f32, highLimit : f32, threshold : f32) -> vec3<f32> {
    var normalisedSample = max(0, (sample - lowLimit)/(highLimit - lowLimit));
    var normalisedThreshold = (threshold - lowLimit)/(highLimit - lowLimit);
    var absorptionCoeff = pow(normalisedSample/1.8, 1.1);
    // var absorptionCoeff = pow(normalisedSample/0.7, 1.2);
    var sampleCol = absorptionCoeff * vec3<f32>(1.0) * length;
    
    return prevCol + sampleCol;
}

// attenuates a background colour by a medium colour
// takes the absorption coefficients as input and converts into transmission factors
fn attenuateCol(inCol : vec4<f32>, absorptionCol : vec3<f32>) -> vec4<f32> {
    var transmission = exp2(-absorptionCol);
    return vec4<f32>(
        inCol.r * transmission.r,
        inCol.g * transmission.g,
        inCol.b * transmission.b,
        max(inCol.a, max(1-transmission.r, max(1-transmission.g, 1-transmission.b)))
    );
}

// do linear interpolation to find the intersection point
// returns a value between 0, 1
// n0 is last, n1 is second to last
fn linearBackStep(n0 : f32, n1 : f32) -> f32{
    return n0/(n1-n0);
}

fn quadraticBackStep(n0 : f32, n1 : f32, n2 :f32) -> f32{
    var c = n0;
    var a = 0.5 * n0 + 3 * n1 + 0.5 * n2;
    var b = 1.5 * n0 + 2 * n1 + 0.5 * n2;

    var x0 = (-b - sqrt(pow(b, 2) - 4*a*c))/(2*a);
    if (x0 > 0 || x0 < -1) {
        x0 = (-b + sqrt(pow(b, 2) - 4*a*c))/(2*a);
    }
    return x0;
}

// marches a ray through a dataset volume, starting from the stub supplied
// returns the final ray length, accumulated volume colour and wether surface was intersected fwd or bwd
fn marchRay(
    passFlags : RayMarchPassFlags, 
    passInfo : RayMarchPassInfo, 
    rayStub : Ray, 
    dataBox : AABB,
    startInDataset : bool, 
    offset : f32
) -> RayMarchResult {
    var ray = rayStub;
    var enteredDataset = startInDataset;

    var fragCol = vec4<f32>(1, 1, 1, 0);    

    // accumulated ray casting colour from samples
    var volCol = vec3<f32>(0, 0, 0);

    // march the ray
    var lastAbove = false;
    var lastSampleVal : f32;
    var lastLastSampleVal : f32;
    var lastStepSize : f32 = 0;
    var sampleVal : f32;
    var thisAbove = false;
    var tipDataPos : vec3<f32>;

    var foundSurface = false;
    var stepsInside = 0u;
    var i = 0u;

    var normalFac = 1.0;



    // main march loop
    loop {
        if (ray.length > passInfo.maxLength) {
            break;
        }
        tipDataPos = toDataSpace(ray.tip); // the tip in data space
        // check if tip has left data
        if (!pointInAABB(tipDataPos, dataBox)) {
            // not inside dataset
            if (enteredDataset) {
                // have gone all the way through the dataset
                break;
            }
        } else {
            // within dataset
            enteredDataset = true;
            stepsInside++;

            // sample the dataset, this is an external function 
            sampleVal = sampleDataValue(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc);
            thisAbove = sampleVal > passInfo.threshold;
            if (i > 0u) {
                // check if the threshold has been crossed
                foundSurface = thisAbove != lastAbove && passFlags.showSurface && stepsInside > 1u;

                if (passFlags.showVolume) {
                    // acumulate colour
                    volCol = accumulateSampleCol(sampleVal, lastStepSize, volCol, passInfo.dataLowLimit, passInfo.dataHighLimit, passInfo.threshold);
                    // check if the volume is too opaque
                    var cutoff : f32 = 1000;
                    if (volCol.r > cutoff && volCol.g > cutoff && volCol.b > cutoff) {
                        break;
                    }
                }

                if (foundSurface) {
                    normalFac -= (2 * f32(!thisAbove && lastAbove)); // invert normal if surface is intersected from behind
                    break;
                }
            }
        }
        
        continuing {
            var thisStepSize = passInfo.stepSize;//*ray.length/10;

            if (stepsInside == 1u) {
                // extend by the offset amount
                thisStepSize *= offset;
            }
            ray = extendRay(ray, thisStepSize);
            lastAbove = thisAbove;
            lastLastSampleVal = lastSampleVal;
            lastSampleVal = sampleVal;
            lastStepSize = thisStepSize;
            i += 1u;
        }
    }

    // handle surface intersection
    if (foundSurface) {
        // look for intersection between last two sample points
        if (passFlags.backStep) {
            var iSec = 0u;

            var xn0 = 0.0;

            var xn1 = 0.0;
            var fn1 = sampleVal - passInfo.threshold;

            var xn2 = -lastStepSize;
            var fn2 = lastSampleVal - passInfo.threshold;
            loop {
                if (iSec >= 1u) {break;}
                if (iSec > 0u) {
                    xn2 = xn1;
                    fn2 = fn1;

                    xn1 = xn0;
                    var secRay = extendRay(ray, xn0);
                    var secDataPos = toDataSpace(secRay.tip);
                    fn1 = sampleDataValue(secDataPos.x, secDataPos.y, secDataPos.z, passInfo.isoSurfaceSrc) - passInfo.threshold;
                }
                xn0 = (xn2*fn1 - xn1*fn2)/(fn1 - fn2);
                iSec++;
            }
            // adjust last step for correct volume integration
            lastStepSize += min(0, max(-lastStepSize, xn0));
            ray = extendRay(ray, xn0);
            tipDataPos = toDataSpace(ray.tip);

        }
    }                    

    // return RayMarchResult(fragCol, ray.length);
    return RayMarchResult(foundSurface, ray, volCol, normalFac);
}


fn normaliseSample(sample : f32, dataSrc : u32) -> f32 {
    switch (dataSrc) {
        case DATA_SRC_VALUE_A {
            return (sample - passInfo.dataLowLimit)/(passInfo.dataHighLimit - passInfo.dataLowLimit);
        }
        case DATA_SRC_VALUE_B {
            return (sample - passInfo.dataBLowLimit)/(passInfo.dataBHighLimit - passInfo.dataBLowLimit);
        }
        case DATA_SRC_AXIS_X {
            return (sample - passInfo.dataBox.min.x)/(passInfo.dataBox.max.x - passInfo.dataBox.min.x);
        }
        case DATA_SRC_AXIS_Y {
            return (sample - passInfo.dataBox.min.y)/(passInfo.dataBox.max.y - passInfo.dataBox.min.y);
        }
        case DATA_SRC_AXIS_Z {
            return (sample - passInfo.dataBox.min.z)/(passInfo.dataBox.max.z - passInfo.dataBox.min.z);
        }
        case default {
            return sample;
        }
    }
}


fn getIsoSurfaceMaterial(dataSrc : u32, tipDataPos : vec3<f32>, normalFac : f32) -> Material {
    var material : Material;
    switch (dataSrc) {
        case DATA_SRC_NONE, default {
            if (normalFac == 1.0) {
                // crossed going up the values
                material = objectInfo.frontMaterial;
            } else {
                // crossed going down the values
                material = objectInfo.backMaterial;
            }
        }
        case DATA_SRC_VALUE_A, DATA_SRC_VALUE_B, DATA_SRC_AXIS_X, DATA_SRC_AXIS_Y, DATA_SRC_AXIS_Z {
            var sampleVal = sampleDataValue(tipDataPos.x, tipDataPos.y, tipDataPos.z, dataSrc);
            var normalisedSampleVal = clamp(normaliseSample(sampleVal, dataSrc), 0.0, 1.0);
            if (normalisedSampleVal < 0.5) {
                material.diffuseCol = mix(vec3<f32>(0, 0, 1), vec3<f32>(1, 1, 1), normalisedSampleVal * 2);  
            } else {
                material.diffuseCol = mix(vec3<f32>(1, 1, 1), vec3<f32>(1, 0, 0), normalisedSampleVal * 2 - 1);  
            }
            material.specularCol = material.diffuseCol * 1.05;
            material.shininess = 10;        
        }
    }

    return material;
}


fn shadeRayMarchResult(rayMarchResult : RayMarchResult, passFlags : RayMarchPassFlags) -> vec4<f32>{
    var tipDataPos = toDataSpace(rayMarchResult.ray.tip);

    var fragCol = vec4<f32>(1, 1, 1, 0);

    var light = DirectionalLight(vec3<f32>(1), rayMarchResult.ray.direction);

    if (rayMarchResult.foundSurface) {
        // set the material
        var material : Material = getIsoSurfaceMaterial(passInfo.surfaceColSrc, tipDataPos, rayMarchResult.normalFac);

        if (passFlags.showNormals) {
            fragCol = vec4<f32>(getDataNormal(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc), 1.0);
        } else if (passFlags.phong) {
            var normal = getDataNormal(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc);
            fragCol = vec4<f32>(phong(material, rayMarchResult.normalFac * normal, -rayMarchResult.ray.direction, light), 1.0);
        } else {
            fragCol = vec4<f32>(material.diffuseCol, 1.0);
        }                
    }

    if (passFlags.showVolume) {
        // attenuate col by the volume colour
        fragCol = attenuateCol(fragCol, rayMarchResult.volCol);
    }

    if (passFlags.showRayLength) {
        fragCol = vec4<f32>(vec3<f32>(log(rayMarchResult.ray.length))/10, 1);  
    }

    return fragCol;
}


