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
    // get the flags governing this pass
    var passFlags : RayMarchPassFlags = getFlags(passInfo.flags);
    // get the dimensions of the dataset in data coordinates as a vec3<f32>
    var dataSize : vec3<f32> = passInfo.dataSize;
    // initialise the fragment colour to the background
    var fragCol = vec4<f32>(1, 1, 1, 0);

    // set the camera pos to be fixed id that flag is set
    var cameraPos : vec3<f32>;
    if (passFlags.fixedCamera) {
        cameraPos = vec3<f32>(600, 600, 600); 
    } else {
        cameraPos = globalInfo.camera.position;
    }

    // create the ray stub used for marching
    var raySegment = fragInfo.inPosition.xyz - cameraPos;
    var ray : Ray;
    ray.direction = normalize(raySegment);
    var enteredDataset : bool;
    if (front_facing) {
        // marching from the outside
        ray.tip = cameraPos;//fragInfo.worldPosition.xyz;
        ray.length = 0;//length(raySegment);
        enteredDataset = false;
        // return vec4<f32>(1, 0, 0, 0.5);
    } else {
        // marching from the inside
        ray.tip = cameraPos;
        ray.length = 0;
        // guess that we started outside to prevent issues with the near clipping plane
        enteredDataset = false;
        // return vec4<f32>(0, 0, 1, 0.5);
    }

    if (passFlags.showRayDirs) {
        return vec4<f32>(ray.direction, 1);
    }

    // generate a random f32 value if needed
    var randVal : f32;
    if (passFlags.randStart) {
        // compute a random f32 value between 0 and 1
        var randU32 = randomU32(
            bitcast<u32>(fragInfo.worldPosition.x) ^ 
            bitcast<u32>(fragInfo.worldPosition.y) ^
            bitcast<u32>(fragInfo.worldPosition.z) ^
            globalInfo.time
        );
        randVal = f32(randU32)/exp2(32);
    }


    // march the ray through the volume
    fragCol = marchRay(passFlags, passInfo, ray, passInfo.dataSize, enteredDataset, randVal);

    return fragCol;
}   