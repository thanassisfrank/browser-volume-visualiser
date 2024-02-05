// rayMarchUtils.wgsl
// contains struct definitions and functions that are common to ray marching shaders

// structs ========================================================================================

// information needed for the ray marching pass
struct RayMarchPassInfo {
    flags : u32,
    threshold : f32,
    dataLowLimit : f32,
    dataHighLimit : f32,
    dataSize : vec3<f32>,
    stepSize : f32,
    maxLength : f32,
    cellsInLeaves : u32,
    dMatInv : mat4x4<f32>, // from world space -> data space
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
        (flagUint & 128u) == 128u,
        (flagUint & 256u) == 256u,
    );
};

// recovers the normal (gradient) of the data at the given point
fn getDataNormal (x : f32, y : f32, z : f32) -> vec3<f32> {
    var epsilon : f32 = 0.1;
    var gradient : vec3<f32>;
    var p0 = sampleDataValue(x, y, z);
    if (x > epsilon) {
        gradient.x = -(p0 - sampleDataValue(x - epsilon, y, z))/epsilon;
    } else {
        gradient.x = (p0 - sampleDataValue(x + epsilon, y, z))/epsilon;
    }
    if (y > epsilon) {
        gradient.y = -(p0 - sampleDataValue(x, y - epsilon, z))/epsilon;
    } else {
        gradient.y = (p0 - sampleDataValue(x, y + epsilon, z))/epsilon;
    }
    if (z > epsilon) {
        gradient.z = -(p0 - sampleDataValue(x, y, z - epsilon))/epsilon;
    } else {
        gradient.z = (p0 - sampleDataValue(x, y, z + epsilon))/epsilon;
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
    var transmission = vec3<f32>(
        exp2(-absorptionCol.r),
        exp2(-absorptionCol.g),
        exp2(-absorptionCol.b),
    );
    return vec4<f32>(
        inCol.r * transmission.r,
        inCol.g * transmission.g,
        inCol.b * transmission.b,
        max(inCol.a, max(1-transmission.r, max(1-transmission.g, 1-transmission.b)))
    );
}

// marches a ray through a dataset volume, starting from the stub supplied
// returns the colour from that ray
fn marchRay(
    passFlags : RayMarchPassFlags, 
    passInfo : RayMarchPassInfo, 
    rayStub : Ray, 
    dataSize : vec3<f32>,
    startInDataset : bool, 
    randVal : f32
) -> vec4<f32> {
    var ray = rayStub;
    var enteredDataset = startInDataset;

    var fragCol = vec4<f32>(1, 1, 1, 0);    

    var light = DirectionalLight(vec3<f32>(1), ray.direction);

    // accumulated ray casting colour from samples
    var volCol = vec3<f32>(0, 0, 0);

    // march the ray
    var lastAbove = false;
    var lastSampleVal : f32;
    var lastStepSize : f32 = 0;
    var sampleVal : f32;
    var thisAbove = false;
    var stepsInside = 0u;
    var i = 0u;
    loop {
        if (ray.length > passInfo.maxLength) {
            break;
        }
        var tipDataPos = toDataSpace(ray.tip); // the tip in data space
        // check if tip has left data
        if (
            tipDataPos.x > dataSize.x - 1 || tipDataPos.x < 0 ||
            tipDataPos.y > dataSize.y - 1 || tipDataPos.y < 0 ||
            tipDataPos.z > dataSize.z - 1 || tipDataPos.z < 0
        ) {
            // have gone all the way through the dataset
            if (enteredDataset) {
                break;
            }
        } else {
            enteredDataset = true;
            stepsInside++;
            // extend by a random amount
            if (stepsInside == 1u && passFlags.randStart) {
                ray = extendRay(ray, randVal * passInfo.stepSize);
            }

            sampleVal = sampleDataValue(tipDataPos.x, tipDataPos.y, tipDataPos.z);
            if (sampleVal > passInfo.threshold) {
                thisAbove = true;
            } else {
                thisAbove = false;
            }
            if (i > 0u) {
                // check if the threshold has been crossed
                if (thisAbove != lastAbove && passFlags.showSurface && stepsInside > 1u) {
                    // has been crossed
                    if (passFlags.backStep) {
                        // find where exactly by lerp
                        var backStep = lastStepSize/(sampleVal-lastSampleVal) * (sampleVal - passInfo.threshold);
                        ray = extendRay(ray, -backStep);
                        tipDataPos = toDataSpace(ray.tip);
                    }

                    // set the material
                    var material : Material;
                    var normalFac = 1.0;
                    if (thisAbove && !lastAbove) {
                        // crossed going up the values
                        material = objectInfo.frontMaterial;
                    } else if (!thisAbove && lastAbove) {
                        // crossed going down the values
                        material = objectInfo.backMaterial;
                        normalFac = -1.0;
                    }

                    if (passFlags.showNormals) {
                        fragCol = vec4<f32>(getDataNormal(tipDataPos.x, tipDataPos.y, tipDataPos.z), 1.0);
                        // fragCol = vec4<f32>(1, 0, 0, 1.0);
                    } else if (passFlags.phong) {
                        var normal = getDataNormal(tipDataPos.x, tipDataPos.y, tipDataPos.z);
                        fragCol = vec4<f32>(phong(material, normalFac * normal, -ray.direction, light), 1.0);
                    } else {
                        fragCol = vec4<f32>(material.diffuseCol*ray.length/1000, 1.0);
                    }
                    break;
                }

                if (passFlags.showVolume) {
                    // acumulate colour
                    volCol = accumulateSampleCol(sampleVal, lastStepSize, volCol, passInfo.dataLowLimit, passInfo.dataHighLimit, passInfo.threshold);
                }
            }
        }
        
        continuing {
            var thisStepSize = passInfo.stepSize*ray.length/10;
            ray = extendRay(ray, passInfo.stepSize);
            lastAbove = thisAbove;
            lastSampleVal = sampleVal;
            lastStepSize = passInfo.stepSize;
            i += 1u;
        }
    }

    if (passFlags.showVolume) {
        // attenuate col by the volume colour
        fragCol = attenuateCol(fragCol, volCol);
    }

    if (passFlags.showRayLength) {
        fragCol = vec4<f32>(ray.length/100, 0, 0, 1);  
    }

    return fragCol;
}


