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
    @size(4)  cornerValType : u32,
    @size(64) transferFunction : array<TransferFunctionPoint, 4>,
    @size(24) blockSizes : MeshBlockSizes,
    @size(4)  @align(16) cellsPtrType : u32,
};

struct CombinedPassInfo {
    @size(208) globalInfo : GlobalUniform,
    @size(160) objectInfo : ObjectInfo,
    passInfo : RayMarchPassInfo,
};

struct MeshBlockSizes {
    positions: u32,
    cellOffsets: u32,
    cellConnectivity: u32,
    valueA: u32,
    valueB: u32,
    treeletCells: u32,
};

struct TransferFunctionPoint {
    col: vec3<f32>,
    opacity : f32,
};

// a set of flags for settings within the pass
struct RayMarchPassFlags {
    phong               : bool,
    backStep            : bool,
    showNormals         : bool,
    showVolume          : bool,
    fixedCamera         : bool,
    randStart           : bool,
    showSurface         : bool,
    showRayDirs         : bool,
    showRayLength       : bool,
    optimiseOffset      : bool,
    showOffset          : bool,
    showDeviceCoords    : bool,
    sampleNearest       : bool,
    showCells           : bool,
    showNodeVals        : bool,
    showNodeLoc         : bool,
    showNodeDepth       : bool,
    secantRoot          : bool,
    renderNodeVals      : bool,
    useBestDepth        : bool,
    showTestedCells     : bool,
    showSurfNodeDepth   : bool,
    showSurfLeafCells   : bool,
    contCornerVals      : bool,
    showSurfNodeIndex   : bool,
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

const DATA_SRC_NONE    = 0u;
const DATA_SRC_VALUE_A = 1u;
const DATA_SRC_VALUE_B = 2u;
const DATA_SRC_AXIS_X  = 3u;
const DATA_SRC_AXIS_Y  = 4u;
const DATA_SRC_AXIS_Z  = 5u;

const COL_SCALE_B_W = 0u;
const COL_SCALE_BL_W_R = 1u;
const COL_SCALE_BL_C_G_Y_R = 2u;

const CORNER_VAL_SAMPLE = 1u;
const CORNER_VAL_POLYNOMIAL = 2u;

// placeholder value to indicate a sample is outside of the cells of the dataset
const F32_OUTSIDE_CELLS : f32 = -exp2(32);

// types of cells pointer
const CELLS_PTR_NORMAL = 0u;
const CELLS_PTR_BLOCK = 1u;
const CELLS_PTR_TREELET_BLOCK = 2u;


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
        (flagUint & (1u << 21)) != 0,
        (flagUint & (1u << 22)) != 0,
        (flagUint & (1u << 23)) != 0,
        (flagUint & (1u << 24)) != 0,
    );
};


// returns the t value for progrssive offset optimisation
fn getTVal(x : f32) -> f32 {
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

fn opacityToAbsorptionCoeff(opacity : f32) -> f32 {
    return pow(opacity/64, 4);
}

// implements the transfer function from normalised sample value and gradient to emission and absorption coeff
// emission is rgb, attenuation is a
fn getSampleVolCol(normalSample : f32, grad : vec3<f32>) -> vec4<f32> {
    var emission = mix4(
        passInfo.transferFunction[0].col,
        passInfo.transferFunction[1].col,
        passInfo.transferFunction[2].col,
        passInfo.transferFunction[3].col,
        normalSample
    );

    var absorptionCoeff = opacityToAbsorptionCoeff(
        mix4float(
            passInfo.transferFunction[0].opacity,
            passInfo.transferFunction[1].opacity,
            passInfo.transferFunction[2].opacity,
            passInfo.transferFunction[3].opacity,
            normalSample
        )
    );

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
) -> RayMarchResult 
{
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
                        grad = vec3<f32>(1.0, 0.0, 0.0);//getDataGrad(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc);
                        sampleVolCol = getSampleVolCol(normaliseSample(sampleVal, passInfo.isoSurfaceSrc), grad);
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

        var thisStepSize = passInfo.stepSize;

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

// performs a simplified version of ray marching that samples the 
fn marchRaySurfOnly(
    passInfo : RayMarchPassInfo, 
    ray : Ray, 
    dataBox : AABB,
    randSeed : u32,
    maxLength : f32
) -> RayMarchResult 
{
    // sample at the ray entrypoint
    var tipDataPos : vec3<f32> = toDataSpace(ray.tip);
    let entryVal : f32 = sampleDataValue(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc);
    // get the distance from ray entrypoint to dataset back face
    let backFaceDist : f32 = intersectAABB(ray, dataBox).tFar;
    let distRange : f32 = min(maxLength, backFaceDist) - ray.length;
    // sample at a random point on this line
    let t : f32 = getRandF32(randSeed);
    let newRay = extendRay(ray, distRange * t);
    tipDataPos = toDataSpace(newRay.tip);
    let sampleVal : f32 = sampleDataValue(tipDataPos.x, tipDataPos.y, tipDataPos.z, passInfo.isoSurfaceSrc);
    // get cells tested
    let cellsTested : f32 = entryVal + sampleVal;
    // determine if the threshold was crossed in this range
    if (entryVal > passInfo.threshold) {
        if (sampleVal > passInfo.threshold) {
            return RayMarchResult(false, newRay, vec4<f32>(1), -1.0, cellsTested);
        } else {
            return RayMarchResult(true, newRay, vec4<f32>(1), -1.0, cellsTested);
        }
    } else {
        if (sampleVal > passInfo.threshold) {
            return RayMarchResult(true, newRay, vec4<f32>(1), 1.0, cellsTested);
        } else {
            return RayMarchResult(false, newRay, vec4<f32>(1), 1.0, cellsTested);
        }
    }
}


fn normaliseSample(sample : f32, dataSrc : u32) -> f32 {
    var val : f32;
    switch (dataSrc) {
        case DATA_SRC_VALUE_A {
            val = (sample - passInfo.dataLowLimit)/(passInfo.dataHighLimit - passInfo.dataLowLimit);
        }
        case DATA_SRC_VALUE_B {
            val = (sample - passInfo.dataBLowLimit)/(passInfo.dataBHighLimit - passInfo.dataBLowLimit);
        }
        case DATA_SRC_AXIS_X {
            val = (sample - passInfo.dataBox.min.x)/(passInfo.dataBox.max.x - passInfo.dataBox.min.x);
        }
        case DATA_SRC_AXIS_Y {
            val = (sample - passInfo.dataBox.min.y)/(passInfo.dataBox.max.y - passInfo.dataBox.min.y);
        }
        case DATA_SRC_AXIS_Z {
            val = (sample - passInfo.dataBox.min.z)/(passInfo.dataBox.max.z - passInfo.dataBox.min.z);
        }
        case default {
            val = sample;
        }
    }

    return clamp(val, 0.0, 1.0);
}


fn getIsoSurfaceMaterial(dataSrc : u32, tipDataPos : vec3<f32>, normalFac : f32, passFlags : RayMarchPassFlags) -> Material {
    var material : Material;
    // first check if the node depth is to be shown on the surface
    if (passFlags.showSurfNodeDepth) {
        var depth : u32 = getNodeDepthAtPoint(tipDataPos);
        material.diffuseCol = u32ToCol(randomU32(depth));
        material.specularCol = material.diffuseCol * 1.05;
        material.shininess = 50;

        return material;
    }

    if (passFlags.showSurfNodeIndex) {
        var index : u32 = getNodeIndexAtPoint(tipDataPos);
        material.diffuseCol = u32ToCol(randomU32(index));
        material.specularCol = material.diffuseCol * 1.05;
        material.shininess = 50;

        return material;
    }

    if (passFlags.showSurfLeafCells) {
        var cellCount : u32 = getNodeCellCountAtPoint(tipDataPos);
        let threshold : u32 = 128;
        
        if (0u == cellCount) {
            material.diffuseCol = vec3<f32>(0, 0, 1);
        } else if (cellCount > threshold) {
            material.diffuseCol = vec3<f32>(1, 0, 0);
        } else {
            material.diffuseCol = vec3<f32>(f32(cellCount)/f32(threshold));
        }
        material.specularCol = material.diffuseCol * 1.05;
        material.shininess = 50;

        return material;
    }


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

            switch (passInfo.colourScale) {
                case COL_SCALE_B_W, default {
                    // black -> white
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
        var material : Material = getIsoSurfaceMaterial(passInfo.surfaceColSrc, tipDataPos, rayMarchResult.normalFac, passFlags);

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
        // if there is no surface found then the default alpha of 0 will mean this has no effect
        fragCol = accumulateVolumeColourBehind(vec4<f32>(fragCol.rgb, fragCol.a * exp2(16)), 1, rayMarchResult.volCol);
        fragCol.a = 1 - fragCol.a;
    }

    if (passFlags.showRayLength) {
        fragCol = vec4<f32>(vec3<f32>(log(rayMarchResult.ray.length))/10, 1);  
    }

    return fragCol;
}


// sets the pixel the the supplied colour
fn setPixel(coords : vec2<u32>, col : vec4<f32>) {
    var outCol = vec4<f32>(vec3<f32>(1-col.a), 0) + vec4<f32>(col.a*col.rgb, col.a);
    textureStore(outputImage, coords, outCol);
}

// calculates the correct pixel colour using the over operation with the previous image
// adds this correct colour to the output image
fn drawPixel(coords : vec2<u32>, newCol : vec4<f32>) {
    var oldCol : vec4<f32> = textureLoad(inputImage, coords, 0);
    var outCol : vec4<f32> = over(newCol, oldCol);
    // var outCol : vec4<f32> = vec4<f32>(newCol.a, newCol.a, newCol.a, 1);
    textureStore(outputImage, coords, outCol);
}


// takes camera and x
fn getRay(x : u32, y : u32, camera : Camera) -> Ray {
    // get the forward vector
    var fwd = normalize(cross(camera.upDirection, camera.rightDirection));
    // get the x and y as proportions of the image Size
    // 0 is centre, +1 is right and bottom edge
    var imageDims = textureDimensions(outputImage);
    var xProp : f32 = 2*(f32(x) + 0.5)/f32(imageDims.x) - 1;
    var yProp : f32 = 2*(f32(y) + 0.5)/f32(imageDims.y) - 1;

    // calculate the ray direction
    var ray : Ray;
    var aspect = camera.fovx / camera.fovy;
    var unormRay = fwd 
        + xProp*tan(camera.fovy/2)*aspect*normalize(camera.rightDirection) 
        - yProp*tan(camera.fovy/2)*normalize(camera.upDirection);
    ray.direction = normalize(unormRay);
    ray.tip = camera.position;
    ray.length = 0.0;
    return ray;
}


fn getPrevOptimisationSample(x : u32, y : u32) -> OptimisationSample {
    var texel = textureLoad(offsetOptimisationTextureOld, vec2<u32>(x, y), 0);
    return OptimisationSample(texel[0], texel[1]);
}


fn storeOptimisationSample(coords : vec2<u32>, sample : OptimisationSample) {
    textureStore(offsetOptimisationTextureNew, coords, vec4<f32>(sample.offset, sample.depth, 0, 0));
}


// generate a new random f32 value [0, 1]
fn getRandF32(seed : u32) -> f32 {
    var randU32 = randomU32(globalInfo.time ^ seed);
    return f32(randU32)/exp2(32);
}

// https://learnopengl.com/Advanced-OpenGL/Depth-testing
fn getWorldSpaceSceneDepth(x : u32, y : u32) -> f32 {
    var ndc : f32 =  textureLoad(sceneDepthTexture, vec2<u32>(x, y), 0);
    // var ndc = depth * 2.0 - 1.0;
    // TODO: read near/far planes from projection matrix
    var near : f32 = globalInfo.camera.pMat[3][2]/(globalInfo.camera.pMat[2][2] + globalInfo.camera.pMat[2][3]);
    var far : f32 = globalInfo.camera.pMat[3][2]/(globalInfo.camera.pMat[2][2] - globalInfo.camera.pMat[2][3]);
    // var far : f32 = 2000;
    return (2.0 * near * far) / (far + near - ndc * (far - near));
}

fn getWorldSpaceSceneDistance(x : u32, y : u32) -> f32 {
    var d : f32 = getWorldSpaceSceneDepth(x, y);

    var imageDims = textureDimensions(outputImage);
    var xProp : f32 = 2*(f32(x) + 0.5)/f32(imageDims.x) - 1;
    var yProp : f32 = 2*(f32(y) + 0.5)/f32(imageDims.y) - 1;

    var th = globalInfo.camera.fovx/2 * xProp;
    var phi = globalInfo.camera.fovy/2 * yProp;

    return d/(cos(th) * cos(phi));
}
