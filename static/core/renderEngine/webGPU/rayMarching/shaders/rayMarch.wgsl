// rayMarch.wgsl
// this is a vertex + fragment shader combo that will perform ray marching

// import structs/functions
{{utils.wgsl}}
{{rayMarchUtils.wgsl}}

// data common to all rendering
// camera mats, position
@group(0) @binding(0) var<uniform> globalInfo : GlobalUniform;
//  object matrix, colours
@group(0) @binding(1) var<uniform> objectInfo : ObjectInfo;

// ray marching data
// threshold, data matrix, march parameters
@group(1) @binding(0) var<uniform> passInfo : RayMarchPassInfo;
//  data texture
@group(1) @binding(1) var data : texture_3d<f32>;

struct VertexOut {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) inPosition : vec3<f32>,
    @location(1) worldPosition : vec4<f32>,
    @location(2) eye : vec3<f32>,    
};

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

fn toDataSpace(pos : vec3<f32>) -> vec3<f32> {
    return (vec4<f32>(pos, 1) * transpose(passInfo.dMatInv)).xyz;
}


@vertex
fn vertex_main(@location(0) position: vec3<f32>) -> VertexOut
{
    var out : VertexOut;
    var vert : vec4<f32> = globalInfo.camera.mvMat * vec4<f32>(position, 1.0);
    out.inPosition = position;
    out.worldPosition = objectInfo.otMat * vec4<f32>(position, 1.0);
    out.eye = vert.xyz;
    out.clipPosition = globalInfo.camera.pMat * globalInfo.camera.mvMat * out.worldPosition;

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

    // compute a random f32 value between 0 and 1
    var randU32 = randomU32(
        bitcast<u32>(fragInfo.worldPosition.x) ^ 
        bitcast<u32>(fragInfo.worldPosition.y) ^
        bitcast<u32>(fragInfo.worldPosition.z) ^
        globalInfo.time
    );
    var randVal = f32(randU32)/exp2(32);

    
    var dataSize = vec3<f32>(textureDimensions(data, 0));

    var fragCol = vec4<f32>(1, 1, 1, 0);

    var cameraPos : vec3<f32>;
    if (passFlags.fixedCamera) {
        cameraPos = vec3<f32>(600, 600, 600); 
    } else {
        cameraPos = globalInfo.camera.position;
    }

    var raySegment = fragInfo.inPosition.xyz - cameraPos;
    var ray : Ray;
    ray.direction = normalize(raySegment);
    var enteredDataset : bool;
    if (front_facing) {
        // marching from the outside
        ray.tip = fragInfo.worldPosition.xyz;
        ray.length = length(raySegment);
        enteredDataset = true;
        // return vec4<f32>(1, 0, 0, 0.5);
    } else {
        // marching from the inside
        ray.tip = cameraPos;
        ray.length = 0;
        // ray = extendRay(ray, nearPlaneDist);
        // guess that we started outside to prevent issues with the near clipping plane
        enteredDataset = false;
        // return vec4<f32>(0, 0, 1, 0.5);
    }   

    // extend by a random amount
    if (passFlags.randStart) {ray = extendRay(ray, randVal);}

    var light = DirectionalLight(vec3<f32>(1), ray.direction);

    // accumulated ray casting colour from samples
    var volCol = vec3<f32>(0, 0, 0);

    // march the ray
    var lastAbove = false;
    var lastSampleVal : f32;
    var lastStepSize : f32 = 0;
    var sampleVal : f32;
    var thisAbove = false;
    var i = 0u;
    loop {
        if (ray.length > passInfo.maxLength) {
            break;
        }
        var tipDataPos = toDataSpace(ray.tip);//(passInfo.dMatInv * vec4<f32>(ray.tip, 1.0)).xyz; // the tip in data space
        // check if tip has left data
        if (
            tipDataPos.x > dataSize.x || tipDataPos.x < 0 ||
            tipDataPos.y > dataSize.y || tipDataPos.y < 0 ||
            tipDataPos.z > dataSize.z || tipDataPos.z < 0
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
                if (thisAbove != lastAbove && passFlags.showSurface) {
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


    // output the updated frag depth too
    return fragCol;
}   