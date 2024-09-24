// rayMarchUtils.wgsl
// contains struct definitions and functions that are common to ray marching shaders

// structs ========================================================================================

// information needed for the ray marching pass
// 180 bytes in total
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
    @size(4)  colourScale : u32,
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
    showTestedCells: bool,
};

// the return value of the ray-march function
struct RayMarchResult {
    foundSurface : bool,
    ray : Ray,
    volCol : vec4<f32>,
    normalFac : f32,
    cellsTested : f32,
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

struct RayIntersectionResult {
    tNear : f32,
    tFar : f32
};

// constants ======================================================================================

const DATA_SRC_NONE    = 0;
const DATA_SRC_VALUE_A = 1;
const DATA_SRC_VALUE_B = 2;
const DATA_SRC_AXIS_X  = 3;
const DATA_SRC_AXIS_Y  = 4;
const DATA_SRC_AXIS_Z  = 5;

const COL_SCALE_B_W = 0;
const COL_SCALE_BL_W_R = 1;
const COL_SCALE_BL_C_G_Y_R = 2;

// placeholder value to indicate a sample is outside of the cells of the dataset
const F32_OUTSIDE_CELLS : f32 = -exp2(32);

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
        (flagUint & (1u << 20)) != 0,
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

// https://tavianator.com/2011/ray_box.html
// https://medium.com/@bromanz/another-view-on-the-classic-ray-aabb-intersection-algorithm-for-bvh-traversal-41125138b525
// https://github.com/codedhead/webrtx/blob/master/src/glsl/intersect.glsl
// https://gist.github.com/DomNomNom/46bb1ce47f68d255fd5d
// returns tNear, tFar
fn intersectAABB(ray : Ray, box : AABB) -> RayIntersectionResult {
    var rayStart = ray.tip - ray.direction * ray.length;
    var rayDirInv : vec3<f32> = 1/ray.direction;
    var tMin : vec3<f32> = (box.min - rayStart) * rayDirInv;
    var tMax : vec3<f32> = (box.max - rayStart) * rayDirInv;
    var t1 : vec3<f32> = min(tMin, tMax);
    var t2 : vec3<f32> = max(tMin, tMax);
    return RayIntersectionResult(
        max(max(t1.x, t1.y), t1.z), 
        min(min(t2.x, t2.y), t2.z)
    );
}

// test if a given point is within an AABB
fn pointInAABB(p : vec3<f32>, box : AABB) -> bool {
    return !(p.x < box.min.x || p.y < box.min.y || p.z < box.min.z || p.x > box.max.x || p.y > box.max.y || p.z > box.max.z);
};

// fn intersectPlane(ray : Ray, normal : vec3<f32>, p0 : vec3<f32>) -> RayIntersectionResult {
//     p0-
// }

// recovers the gradient of the data at the given point
fn getDataGrad (x : f32, y : f32, z : f32, dataSrc : u32) -> vec3<f32> {
    var epsilon : f32 = 0.5;
    var gradient : vec3<f32>;
    var p0 = sampleDataValue(x, y, z, dataSrc);
    // gradient.x = select(
    //     (p0 - sampleDataValue(x + epsilon, y, z, dataSrc))/epsilon, 
    //     -(p0 - sampleDataValue(x - epsilon, y, z, dataSrc))/epsilon, 
    //     x > epsilon
    // );
    // gradient.y = select(
    //     (p0 - sampleDataValue(x, y + epsilon, z, dataSrc))/epsilon, 
    //     -(p0 - sampleDataValue(x, y - epsilon, z, dataSrc))/epsilon, 
    //     y > epsilon
    // );
    // gradient.z = select(
    //     (p0 - sampleDataValue(x, y, z + epsilon, dataSrc))/epsilon, 
    //     -(p0 - sampleDataValue(x, y, z - epsilon, dataSrc))/epsilon, 
    //     z > epsilon
    // );

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
    return gradient;
}

// converts from world space -> data space relative
fn toDataSpace(pos : vec3<f32>) -> vec3<f32> {
    return (vec4<f32>(pos, 1) * transpose(passInfo.dMatInv)).xyz;
}

// implements the transfer function from sample value and gradient to emission and absorption coeff
// emission is rgb, attenuation is a
fn getSampleVolCol(sample : f32, grad : vec3<f32>) -> vec4<f32> {

    var absorptionCoeff = select(0, 0.1, sample < 1);
    var emission = select(vec3<f32>(0.1, 0.05, 0), vec3<f32>(0, 0.05, 0.1), sample < 0.2) * 10;

    // var absorptionCoeff = select(0, 0.1, sample % 20.0 < 2);
    // var emission = vec3<f32>(0, 0.05, 0.1) * absorptionCoeff * 100;

    return vec4<f32>(emission, absorptionCoeff);
}

// calculates the resulting rgb emission strength and attentuation for a sample added behind another
fn accumulateVolumeColourBehind(sampleVolCol : vec4<f32>, stepLength : f32, frontVolCol : vec4<f32>) -> vec4<f32> {
    let k = 1.0;

    var dT : f32 = exp2(-stepLength * sampleVolCol.a * k);
    
    var newCol = frontVolCol;
    newCol.a *= dT;
    newCol.r += sampleVolCol.r * (1-dT) * frontVolCol.a / k;
    newCol.g += sampleVolCol.g * (1-dT) * frontVolCol.a / k;
    newCol.b += sampleVolCol.b * (1-dT) * frontVolCol.a / k;

    
    return newCol;
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
    offset : f32,
    maxLength : f32
) -> RayMarchResult {
    var ray = rayStub;
    var enteredDataset = startInDataset;

    var fragCol = vec4<f32>(1, 1, 1, 0);    

    // accumulated ray casting colour from samples
    var sampleVolCol : vec4<f32>;
    var volCol = vec4<f32>(0, 0, 0, 1);

    // march the ray
    var lastAbove = false;
    var lastSampleVal : f32;
    var lastLastSampleVal : f32;
    var lastStepSize : f32 = 0;
    var sampleVal : f32;
    var thisAbove = false;
    var tipDataPos : vec3<f32>;

    var grad : vec3<f32>;

    var foundSurface = false;
    var stepsInside = 0u;
    var i = 0u;

    var normalFac : f32 = 1.0;

    var cellsTested : f32 = 0.0;
    

    // march the actual datasets
    while (ray.length < maxLength) {
        tipDataPos = toDataSpace(ray.tip); // the tip in data space
        // check if tip is inside dataset
        if (!pointInAABB(tipDataPos, dataBox)) {
            // have gone all the way through the dataset
            if (enteredDataset) {
                break;
            }
        } else {
            enteredDataset = true;
            stepsInside++;

            // sample the dataset, this is an external function 
            sampleVal = sampleDataValue(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc);
            cellsTested += sampleVal;
            if (!passFlags.showTestedCells) {
                thisAbove = sampleVal > passInfo.threshold;
                if (stepsInside > 1) {
                    // check if the threshold has been crossed
                    foundSurface = thisAbove != lastAbove && passFlags.showSurface;

                    if (passFlags.showVolume) {
                        // acumulate colour
                        grad = getDataGrad(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc);
                        sampleVolCol = getSampleVolCol(sampleVal, grad);
                        volCol = accumulateVolumeColourBehind(sampleVolCol, lastStepSize, volCol);
                        // check if the volume is too opaque
                        if (volCol.a < 0.005) {
                            break;
                        }
                    }
                }

                if (foundSurface) {
                    normalFac = select(1.0, -1.0, !thisAbove && lastAbove);
                    break;
                }
            }
        }

        var thisStepSize = passInfo.stepSize;//*ray.length/10;

        thisStepSize *= select(1.0, offset, stepsInside == 1u);

        ray = extendRay(ray, thisStepSize);
        lastAbove = thisAbove;
        lastLastSampleVal = lastSampleVal;
        lastSampleVal = sampleVal;
        lastStepSize = thisStepSize;
    }

    // handle surface intersection
    if (foundSurface && passFlags.backStep) {
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

    return RayMarchResult(foundSurface, ray, volCol, normalFac, cellsTested);
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

            // var cols = array<vec3<f32>, 3>(vec3<f32>(0, 0, 1))
            switch (passInfo.colourScale) {
                case COL_SCALE_B_W, default {
                    material.diffuseCol = mix(
                        vec3<f32>(0, 0, 0),
                        vec3<f32>(1, 1, 1),
                        normalisedSampleVal
                    );
                }
                case COL_SCALE_BL_W_R {
                    // blue -> white -> red
                    material.diffuseCol = mix3(
                        vec3<f32>(0, 0, 1),
                        vec3<f32>(1, 1, 1),
                        vec3<f32>(1, 0, 0),
                        normalisedSampleVal
                    );
                }
                case COL_SCALE_BL_C_G_Y_R {
                    // blue -> cyan -> green -> yellow -> red
                    material.diffuseCol = mix5(
                        vec3<f32>(0, 0, 1),
                        vec3<f32>(0, 1, 1),
                        vec3<f32>(0, 1, 0),
                        vec3<f32>(1, 1, 0),
                        vec3<f32>(1, 0, 0),
                        normalisedSampleVal
                    );
                }
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
            fragCol = vec4<f32>(normalize(getDataGrad(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc)), 1.0);
        } else if (passFlags.phong) {
            var normal = normalize(getDataGrad(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc));
            fragCol = vec4<f32>(phong(material, rayMarchResult.normalFac * normal, -rayMarchResult.ray.direction, light), 1.0);
        } else {
            fragCol = vec4<f32>(material.diffuseCol, 1.0);
        }                
    }

    if (passFlags.showVolume) {
        // add in the iso-surface as if it were a volume colour sample of very high attentuation (opaque)
        fragCol = accumulateVolumeColourBehind(vec4<f32>(fragCol.rgb, exp2(32)), 1, rayMarchResult.volCol);
        fragCol.a = 1 - fragCol.a;
    }

    if (passFlags.showRayLength) {
        fragCol = vec4<f32>(vec3<f32>(log(rayMarchResult.ray.length))/10, 1);  
    }

    return fragCol;
}


