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
// data texture
@group(1) @binding(1) var data : texture_3d<f32>;

// best optimisation 
@group(2) @binding(0) var offsetOptimisationTextureOld : texture_2d<f32>;

struct VertexOut {
    @builtin(position) outPosition : vec4<f32>,
    @location(0) inPosition : vec3<f32>,
    @location(1) worldPosition : vec4<f32>,
    @location(2) eye : vec3<f32>,
    @location(3) @interpolate(perspective, center) clipPosition : vec4<f32>
};

struct FragmentOut {
    @location(0) fragCol : vec4<f32>,
    @location(1) optimiseOut : vec4<f32>
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

fn sampleNearestDataValue(x : f32, y : f32, z : f32) -> f32 {
    return getDataValue(u32(round(x)), u32(round(y)), u32(round(z)));
}

// takes device coords (-1 to 1)
fn getPrevOptimisationSample(x : f32, y : f32) -> OptimisationSample {
    var textureDims : vec2<u32> = textureDimensions(offsetOptimisationTextureOld);
    var texCoords = vec2<u32>(vec2<f32>(textureDims) * 0.5 * vec2<f32>(x + 1, -y + 1));
    var texel = textureLoad(offsetOptimisationTextureOld, texCoords, 0);
    return OptimisationSample(texel[0], texel[1]);
}

// generate a new random f32 value [0, 1]
fn getRandF32(seed : u32) -> f32 {
    var randU32 = randomU32(globalInfo.time ^ seed);
    return f32(randU32)/exp2(32);
}


@vertex
fn vertex_main(@location(0) position: vec3<f32>) -> VertexOut
{
    var out : VertexOut;
    var vert : vec4<f32> = globalInfo.camera.mvMat * vec4<f32>(position, 1.0);
    out.inPosition = position;
    out.worldPosition = objectInfo.otMat * vec4<f32>(position, 1.0);
    out.eye = vert.xyz;
    out.outPosition = globalInfo.camera.pMat * globalInfo.camera.mvMat * out.worldPosition;
    out.clipPosition = out.outPosition;

    return out;
}

@fragment
fn fragment_main(
    fragInfo: VertexOut,
    @builtin(front_facing) front_facing : bool
) -> FragmentOut
{   
    // get the flags governing this pass
    var passFlags : RayMarchPassFlags = getFlags(passInfo.flags);
    // get the dimensions of the dataset in data coordinates as a vec3<f32>
    var dataSize : vec3<f32> = passInfo.dataSize;
    // initialise the fragment colour to the background
    var fragCol = vec4<f32>(1, 1, 1, 0);

    var deviceCoords = fragInfo.clipPosition.xy / fragInfo.clipPosition.w;

    // set the camera pos to be fixed id that flag is set
    var cameraPos : vec3<f32>;
    if (passFlags.fixedCamera) {
        cameraPos = vec3<f32>(600, 600, 600); 
    } else {
        cameraPos = globalInfo.camera.position;
    }

    // create the ray stub used for marching
    var raySegment = fragInfo.worldPosition.xyz - cameraPos;
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
        // guess that we started outside to prevent issues with the near clipping plane
        enteredDataset = false;
        // return vec4<f32>(0, 0, 1, 0.5);
    }

    var offsetSample : OptimisationSample = getPrevOptimisationSample(deviceCoords.x, deviceCoords.y);

    if (passFlags.showCells) {
        var dataPos = toDataSpace(ray.tip);
        var cellIndex : u32 = u32(floor(dataPos.x) + floor(dataPos.y) * dataSize.x + floor(dataPos.z) * dataSize.x * dataSize.y);
        return FragmentOut(
            vec4<f32>(u32ToCol(randomU32(cellIndex)), 1), 
            vec4<f32>(offsetSample.offset, offsetSample.depth, 0, 0)
        );
    }


    if (passFlags.showRayDirs) {
        // return vec4<f32>(ray.direction, 1);
        return FragmentOut(vec4<f32>(ray.direction, 1), vec4<f32>(offsetSample.offset, offsetSample.depth, 0, 0));
    } else if (passFlags.showDeviceCoords) {
        return FragmentOut(vec4<f32>(deviceCoords, 0, 1), vec4<f32>(offsetSample.offset, offsetSample.depth, 0, 0));
    }

    var seed : u32 = bitcast<u32>(fragInfo.worldPosition.x) ^ bitcast<u32>(fragInfo.worldPosition.y) ^ bitcast<u32>(fragInfo.worldPosition.z);

    var randomVal : f32;
    var marchResult : RayMarchResult;
    var prevOffsetSample = offsetSample;

    var offset : f32;

    if(passFlags.optimiseOffset) {
        // get the previous value
        // if sampling threshold < t
        
        // exponential
        // var t : f32 = exp2(-f32(passInfo.framesSinceMove)/10.0);

        // linear
        //20 was used before
        var t : f32 = 1 - f32(passInfo.framesSinceMove)/30.0;

        // square
        // var t : f32 = 1;
        // if (passInfo.framesSinceMove > 20) {
        //     t = 0;
        // }

        if (t > 0) {
            // generate a new sampling threshold
            randomVal = getRandF32(seed);
        }
        
        if (randomVal < t) {
            // generate new offset
            var newOffset = getRandF32(seed ^ 782035u);
            // march with the new offset
            marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataSize, enteredDataset, newOffset);
            offset = newOffset;
            if (marchResult.surfaceDepth < prevOffsetSample.depth || prevOffsetSample.depth == 0) {
                // if the surface is closer
                // store the new offset and depth
                offsetSample = OptimisationSample(newOffset, marchResult.surfaceDepth);
            }
        } else {
            // march with existing offset
            marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataSize, enteredDataset, prevOffsetSample.offset);
            // store depth into texture
            offsetSample = OptimisationSample(prevOffsetSample.offset, marchResult.surfaceDepth);

            offset = prevOffsetSample.offset;
        }
        offset = prevOffsetSample.offset;
    } else if (passFlags.randStart) {
        // generate a random value
        randomVal = getRandF32(seed);
        marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataSize, enteredDataset, randomVal);
        offset = randomVal;
    } else {
        marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataSize, enteredDataset, 0);
        offset = 0;
    }

    if (passFlags.showOffset) {
        return FragmentOut(vec4<f32>(offset, offset, offset, 1), vec4<f32>(offsetSample.offset, offsetSample.depth, 0, 0));
    }

    return FragmentOut(marchResult.fragCol, vec4<f32>(offsetSample.offset, offsetSample.depth, 0, 0));
}   