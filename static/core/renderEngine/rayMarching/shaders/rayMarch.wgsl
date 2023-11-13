struct VertexOut {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) worldPosition : vec4<f32>,
    @location(1) eye : vec3<f32>,    
};

// common to all passes
struct GlobalUniform {
    pMat : mat4x4<f32>,  // camera perspective matrix (viewport transform)
    mvMat : mat4x4<f32>, // camera view matrix
    @size(16) cameraPos : vec3<f32>,
};

// specific info for this object
struct ObjectInfo {
    otMat : mat4x4<f32>, // object transform matrix
    frontMaterial : Material,
    backMaterial : Material,
    time : u32, // time in ms
    // frontCol : vec4<f32>,
    // backCol : vec4<f32>
};

struct PassInfo {
    flags : u32,
    threshold : f32,
    dataLowLimit : f32,
    dataHighLimit : f32,
    stepSize : f32,
    maxLength : f32,
    @align(16) dMatInv : mat4x4<f32>, // from world space -> data space
};


// data common to all rendering
// camera mats, position
@group(0) @binding(0) var<uniform> globalInfo : GlobalUniform;
//  object matrix, colours
@group(0) @binding(1) var<uniform> objectInfo : ObjectInfo;

// ray marching data
// threshold, data matrix, march parameters
@group(1) @binding(0) var<uniform> passInfo : PassInfo;
//  data texture
@group(1) @binding(1) var data : texture_3d<f32>;

struct PassFlags {
    phong : bool,
    backStep : bool,
    showNormals : bool,
    showVolume : bool,
    fixedCamera : bool
};

struct Ray {
    tip : vec3<f32>,
    direction : vec3<f32>,
    length : f32,
};

struct Material {
    @size(16) diffuseCol : vec3<f32>,
    @size(16) specularCol : vec3<f32>,
    shininess : f32,
};

struct DirectionalLight {
    colour : vec3<f32>,
    direction : vec3<f32>,
};

fn normalFlagSet(flagUint : u32) -> bool {
    return (flagUint & 1u) == 1u;
}

fn getFlags(flagUint : u32) -> PassFlags {
    return PassFlags(
        (flagUint & 1u) == 1u,
        (flagUint & 2u) == 2u,
        (flagUint & 4u) == 4u,
        (flagUint & 8u) == 8u,
        (flagUint & 16u) == 16u,
    );
}

// load a specific value
fn getDataValue(x : u32, y : u32, z : u32) -> f32 {
    return textureLoad(data, vec3<u32>(x, y, z), 0)[0];
}

// sampler not available for f32 -> do own lerp
fn sampleDataValue(x : f32, y: f32, z : f32) -> f32 {
    var flr = vec3<u32>(u32(floor(x)), u32(floor(y)), u32(floor(z)));
    var cel = vec3<u32>(u32(ceil(x)), u32(ceil(y)), u32(ceil(z)));
    // lerp in z direction
    var zFac = z - floor(z);
    var zLerped = array(
        mix(getDataValue(flr.x, flr.y, flr.z), getDataValue(flr.x, flr.y, cel.z), zFac), // 00
        mix(getDataValue(flr.x, cel.y, flr.z), getDataValue(flr.x, cel.y, cel.z), zFac), // 01
        mix(getDataValue(cel.x, flr.y, flr.z), getDataValue(cel.x, flr.y, cel.z), zFac), // 10
        mix(getDataValue(cel.x, cel.y, flr.z), getDataValue(cel.x, cel.y, cel.z), zFac), // 11
    );
    // lerp in y direction
    var yFac = y - floor(y);
    var yLerped = array(
        mix(zLerped[0], zLerped[1], yFac),
        mix(zLerped[2], zLerped[3], yFac)
    );
    // lerp in x direction
    var xFac = x - floor(x);

    return mix(yLerped[0], yLerped[1], xFac);

}

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

fn phong (material: Material, normal: vec3<f32>, eye: vec3<f32>, light: DirectionalLight) -> vec3<f32> {
    var diffuseFac = max(dot(normal, -light.direction), 0.0);
    
    var diffuse : vec3<f32>;
    var specular : vec3<f32>;
    var ambient : vec3<f32> = material.diffuseCol*0.1;
    
    var reflected : vec3<f32>;

    if (diffuseFac > 0.0) {
        // facing towards the light
        diffuse = material.diffuseCol * light.colour * diffuseFac;

        reflected = reflect(light.direction, normal);
        var specularFac : f32 = pow(max(dot(reflected, eye), 0.0), material.shininess);
        specular = material.specularCol * light.colour * specularFac;
    }
    return diffuse + specular + ambient;
}

fn extendRay (ray : Ray, step : f32) -> Ray {
    var newRay = ray;
    newRay.length += step;
    newRay.tip += newRay.direction*step;
    return newRay;
}

fn over (colA : vec4<f32>, colB : vec4<f32>) -> vec4<f32> {
    var outCol : vec4<f32>;
    outCol.a = colA.a + colB.a * (1 - colA.a);
    outCol.r = (colA.r * colA.a + colB.r * colB.a * (1 - colA.a))/outCol.a;
    outCol.g = (colA.g * colA.a + colB.g * colB.a * (1 - colA.a))/outCol.a;
    outCol.b = (colA.b * colA.a + colB.b * colB.a * (1 - colA.a))/outCol.a;

    return outCol;
}

fn accumulateSampleCol(sample : f32, length : f32, prevCol : vec3<f32>, lowLimit : f32, highLimit : f32, threshold : f32) -> vec3<f32> {
    var normalisedSample = (sample - lowLimit)/(highLimit - lowLimit);
    var normalisedThreshold = (threshold - lowLimit)/(highLimit - lowLimit);
    var absorptionCoeff = pow(normalisedSample/3, 1.3);
    var sampleCol = absorptionCoeff * vec3<f32>(1.0) * length; // transfer function
    
    return prevCol + sampleCol;
}







@vertex
fn vertex_main(@location(0) position: vec3<f32>) -> VertexOut
{
    var out : VertexOut;
    var vert : vec4<f32> = globalInfo.mvMat * vec4<f32>(position, 1.0);

    out.worldPosition = objectInfo.otMat * vec4<f32>(position, 1.0);
    out.eye = vert.xyz;
    out.clipPosition = globalInfo.pMat * globalInfo.mvMat * out.worldPosition;

    return out;
}

@fragment
fn fragment_main(
    fragInfo: VertexOut,
    @builtin(front_facing) front_facing : bool
) -> @location(0) vec4<f32>
{   
    var passFlags = getFlags(passInfo.flags);
    var nearPlaneDist = 0.0;

    var e = 2.71828;
    
    var dataSize = vec3<f32>(textureDimensions(data, 0));

    var fragCol = vec4<f32>(1, 1, 1, 0);

    var cameraPos : vec3<f32>;
    if (passFlags.fixedCamera) {
        cameraPos = vec3<f32>(600, 600, 600); 
    } else {
        cameraPos = globalInfo.cameraPos;
    }

    var raySegment = fragInfo.worldPosition.xyz - cameraPos;
    var ray : Ray;
    ray.direction = normalize(raySegment);
    var enteredDataset : bool;
    if (front_facing) {
        // marching from the outside
        ray.tip = fragInfo.worldPosition.xyz;
        ray.length = length(raySegment);
        enteredDataset = true;
        // return vec4<f32>(1, 0, 0, 1);
    } else {
        // marching from the inside
        ray.tip = cameraPos;
        ray.length = 0;
        // ray = extendRay(ray, nearPlaneDist);
        // guess that we started outside to prevent issues with the near clipping plane
        enteredDataset = false;
        // return vec4<f32>(0, 1, 0, 1);
    }    

    var light = DirectionalLight(vec3<f32>(1), ray.direction);

    // accumulated ray casting colour from samples
    var volCol : vec3<f32>;

    // march the ray
    var lastAbove = false;
    var lastSampleVal : f32;
    var lastStepSize : f32;
    var sampleVal : f32;
    var thisAbove = false;
    var i = 0u;
    loop {
        if (ray.length > passInfo.maxLength) {
            break;
        }
        var tipDataPos = ray.tip;//(passInfo.dMatInv * vec4<f32>(ray.tip, 1.0)).xyz; // the tip in data space
        // check if tip has left data
        if (
            ray.tip.x > dataSize.x || ray.tip.x < 0 ||
            ray.tip.y > dataSize.y || ray.tip.y < 0 ||
            ray.tip.z > dataSize.z || ray.tip.z < 0
        ) {
            // have gone all the way through the dataset
            if (enteredDataset) {
                break;
            }
        } else {
            enteredDataset = true;
            sampleVal = sampleDataValue(tipDataPos.x, tipDataPos.y, tipDataPos.z);
            if (sampleVal > passInfo.threshold) {
                thisAbove = true;
            } else {
                thisAbove = false;
            }
            if (i > 0u) {
                // check if the threshold has been crossed
                if (thisAbove != lastAbove) {
                    // has been crossed
                    if (passFlags.backStep) {
                        // find where exactly by lerp
                        var backStep = lastStepSize/(sampleVal-lastSampleVal) * (sampleVal - passInfo.threshold);
                        ray = extendRay(ray, -backStep);
                        tipDataPos = ray.tip;
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
            var thisStepSize = passInfo.stepSize;
            ray = extendRay(ray, passInfo.stepSize);
            lastAbove = thisAbove;
            lastSampleVal = sampleVal;
            lastStepSize = passInfo.stepSize;
            i += 1u;
        }
    }

    if (passFlags.showVolume) {
        // do the over operation
        var absorption = vec3<f32>(
            pow(e, -volCol.r),
            pow(e, -volCol.g),
            pow(e, -volCol.b),
        );
        fragCol = vec4<f32>(
            fragCol.r * absorption.r,
            fragCol.g * absorption.g,
            fragCol.b * absorption.b,
            max(fragCol.a, max(1-absorption.r, max(1-absorption.g, 1-absorption.b)))
        );
    }

    return fragCol;
}   