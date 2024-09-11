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
@group(1) @binding(2) var dataB : texture_3d<f32>;

// best optimisation 
@group(2) @binding(0) var offsetOptimisationTextureOld : texture_2d<f32>;
// best corresponding pixel colours
// @group(2) @binding(1) var offsetOptimisationBestCol : texture_2d<f32>;

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
fn getDataValue(x : u32, y : u32, z : u32, dataSrc : u32) -> f32 {
    if (dataSrc == DATA_SRC_VALUE_A) {
        return textureLoad(data, vec3<u32>(x, y, z), 0)[0];
    } else {
        return textureLoad(dataB, vec3<u32>(x, y, z), 0)[0];
    }
}

// sampler not available for f32 -> do own lerp
fn sampleDataValue(x : f32, y: f32, z : f32, dataSrc : u32) -> f32 {
    switch (dataSrc) {
        case DATA_SRC_AXIS_X {return x;}
        case DATA_SRC_AXIS_Y {return y;}
        case DATA_SRC_AXIS_Z {return z;}
        default {}
    }
    var flr = vec3<u32>(u32(floor(x)), u32(floor(y)), u32(floor(z)));
    var cel = vec3<u32>(u32(ceil(x)), u32(ceil(y)), u32(ceil(z)));
    // lerp in z direction
    var zFac = z - floor(z);
    var zLerped = array(
        mix(getDataValue(flr.x, flr.y, flr.z, dataSrc), getDataValue(flr.x, flr.y, cel.z, dataSrc), zFac), // 00
        mix(getDataValue(flr.x, cel.y, flr.z, dataSrc), getDataValue(flr.x, cel.y, cel.z, dataSrc), zFac), // 01
        mix(getDataValue(cel.x, flr.y, flr.z, dataSrc), getDataValue(cel.x, flr.y, cel.z, dataSrc), zFac), // 10
        mix(getDataValue(cel.x, cel.y, flr.z, dataSrc), getDataValue(cel.x, cel.y, cel.z, dataSrc), zFac), // 11
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

// takes device coords (-1 to 1)
fn getPrevOptimisationSample(x : f32, y : f32) -> OptimisationSample {
    var textureDims : vec2<u32> = textureDimensions(offsetOptimisationTextureOld);
    var texCoords = vec2<u32>(vec2<f32>(textureDims) * 0.5 * vec2<f32>(x + 1, -y + 1));
    var texel = textureLoad(offsetOptimisationTextureOld, texCoords, 0);
    return OptimisationSample(texel[0], texel[1]);
}

// fn getPrevOptimisationCol(x : f32, y : f32) -> vec3<f32> {
//     var textureDims : vec2<u32> = textureDimensions(offsetOptimisationBestCol);
//     var texCoords = vec2<u32>(vec2<f32>(textureDims) * 0.5 * vec2<f32>(x + 1, -y + 1));
//     return textureLoad(offsetOptimisationBestCol, texCoords, 0).xyz;
// }

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
    var dataSize : vec3<f32> = passInfo.dataBox.max - passInfo.dataBox.min;
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
    var startInside : bool;
    if (front_facing) {
        // marching from the outside
        ray.tip = fragInfo.worldPosition.xyz;
        ray.length = length(raySegment);
        startInside = true;
        // return vec4<f32>(1, 0, 0, 0.5);
    } else {
        // marching from the inside
        ray.tip = cameraPos;
        ray.length = 0;
        // guess that we started outside to prevent issues with the near clipping plane
        startInside = false;
        // return vec4<f32>(0, 0, 1, 0.5);
    }

    // get the best depth, offset sample so far
    var prevOffsetSample : OptimisationSample = getPrevOptimisationSample(deviceCoords.x, deviceCoords.y);
    if (passInfo.framesSinceMove == 0) {
        prevOffsetSample.depth = 0;
    }
    // var prevBestCol : vec3<f32> = getPrevOptimisationCol(deviceCoords.x, deviceCoords.y);

    if (passFlags.showCells) {
        var dataPos = toDataSpace(ray.tip);
        var cellIndex : u32 = u32(floor(dataPos.x) + floor(dataPos.y) * dataSize.x + floor(dataPos.z) * dataSize.x * dataSize.y);
        return FragmentOut(
            vec4<f32>(u32ToCol(randomU32(cellIndex)), 1), 
            vec4<f32>(prevOffsetSample.offset, prevOffsetSample.depth, 0, 0)
        );
    }

    if (passFlags.showRayDirs) {
        // return vec4<f32>(ray.direction, 1);
        return FragmentOut(
            vec4<f32>(ray.direction, 1), 
            vec4<f32>(prevOffsetSample.offset, prevOffsetSample.depth, 0, 0)
        );
    }
    
    if (passFlags.showDeviceCoords) {
        return FragmentOut(
            // vec4<f32>(deviceCoords, 0, 1), 
            vec4<f32>(fragInfo.outPosition.z, 0, 0, 1), 
            vec4<f32>(prevOffsetSample.offset, prevOffsetSample.depth, 0, 0)
        );
    }



    var seed : u32 = bitcast<u32>(fragInfo.worldPosition.x) ^ bitcast<u32>(fragInfo.worldPosition.y) ^ bitcast<u32>(fragInfo.worldPosition.z);

    var marchResult : RayMarchResult;
    var outCol : vec4<f32>;
    var bestSample = prevOffsetSample;

    var offset : f32 = 0;

    // get the offset to be used for ray-marching
    if (passFlags.optimiseOffset) {
        offset = getOptimisationOffset(f32(passInfo.framesSinceMove), prevOffsetSample.offset, seed);
    } else if (passFlags.randStart) {
        offset = getRandF32(seed);
    }

    // do ray-marching step
    if (passInfo.isoSurfaceSrc != DATA_SRC_NONE) {
        marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataBox, startInside, offset);
    }

    if (marchResult.foundSurface && (marchResult.ray.length < prevOffsetSample.depth || prevOffsetSample.depth == 0)) {
        // new best depth/best uninitialised (surface not previously found)
        bestSample = OptimisationSample(offset, marchResult.ray.length);
    } else if (prevOffsetSample.depth != 0 && passFlags.useBestDepth){
        // no surface found this time and surface has previously been found at this depth
        // use previous best offset, depth for shading
        marchResult.ray = extendRay(marchResult.ray, prevOffsetSample.depth - marchResult.ray.length);
        marchResult.foundSurface = true;
    }

    if (passFlags.showOffset) {
        return FragmentOut(
            vec4<f32>(vec3<f32>(bestSample.offset), 1), 
            vec4<f32>(bestSample.offset, bestSample.depth, 0, 0)
        );
    }

    // shade the pixel
    outCol = shadeRayMarchResult(marchResult, passFlags);

    return FragmentOut(
        outCol, 
        vec4<f32>(bestSample.offset, bestSample.depth, 0, 0)
    );
}   