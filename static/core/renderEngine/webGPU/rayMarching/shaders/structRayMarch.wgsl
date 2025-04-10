// structRayMarch.wgsl
// performs compute-shader ray marching on structured data

// imports
{{utils.wgsl}}
{{rayMarchUtils.wgsl}}


@group(0) @binding(0) var<storage, read> combinedPassInfo : CombinedPassInfo;

// data values
// vertex centered data arrays (3d textures)
@group(1) @binding(0) var dataA : texture_3d<f32>;
@group(1) @binding(1) var dataB : texture_3d<f32>;

// images
// the depth of the rest of the scene geometry (ray-marching performed last)
// facilitates combined rendering with the volume and iso-surface
@group(2) @binding(0) var sceneDepthTexture : texture_depth_2d;
// two textures used to hold the last best result and write the new best result too
// previous best results
@group(2) @binding(1) var offsetOptimisationTextureOld : texture_2d<f32>;
// a texture to write the best results too
@group(2) @binding(2) var offsetOptimisationTextureNew : texture_storage_2d<rg32float, write>;
// the frame buffer before this pass for writing transparent pixels correctly
@group(2) @binding(3) var inputImage : texture_2d<f32>;
// output image after ray marching into volume
@group(2) @binding(4) var outputImage : texture_storage_2d<bgra8unorm, write>;


var<workgroup> datasetBox : AABB;
var<workgroup> passInfo : RayMarchPassInfo;
var<workgroup> passFlags : RayMarchPassFlags;

var<private> threadIndex : u32;
var<private> globalInfo : GlobalUniform;
var<private> objectInfo : ObjectInfo;


fn sampleDataTexture(x : f32, y : f32, z : f32, dataSrc : u32) -> f32 {
    var vals : array<f32, 8>;
    switch (dataSrc) {
        case DATA_SRC_VALUE_A, default {
            vals = array(
                textureLoad(dataA, vec3<u32>(vec3<f32>(floor(x), floor(y), floor(z))), 0)[0],
                textureLoad(dataA, vec3<u32>(vec3<f32>( ceil(x), floor(y), floor(z))), 0)[0],
                textureLoad(dataA, vec3<u32>(vec3<f32>(floor(x),  ceil(y), floor(z))), 0)[0],
                textureLoad(dataA, vec3<u32>(vec3<f32>( ceil(x),  ceil(y), floor(z))), 0)[0],
                textureLoad(dataA, vec3<u32>(vec3<f32>(floor(x), floor(y),  ceil(z))), 0)[0],
                textureLoad(dataA, vec3<u32>(vec3<f32>( ceil(x), floor(y),  ceil(z))), 0)[0],
                textureLoad(dataA, vec3<u32>(vec3<f32>(floor(x),  ceil(y),  ceil(z))), 0)[0],
                textureLoad(dataA, vec3<u32>(vec3<f32>( ceil(x),  ceil(y),  ceil(z))), 0)[0],
            );
        }
        case DATA_SRC_VALUE_B {
            vals = array(
                textureLoad(dataB, vec3<u32>(vec3<f32>(floor(x), floor(y), floor(z))), 0)[0],
                textureLoad(dataB, vec3<u32>(vec3<f32>( ceil(x), floor(y), floor(z))), 0)[0],
                textureLoad(dataB, vec3<u32>(vec3<f32>(floor(x),  ceil(y), floor(z))), 0)[0],
                textureLoad(dataB, vec3<u32>(vec3<f32>( ceil(x),  ceil(y), floor(z))), 0)[0],
                textureLoad(dataB, vec3<u32>(vec3<f32>(floor(x), floor(y),  ceil(z))), 0)[0],
                textureLoad(dataB, vec3<u32>(vec3<f32>( ceil(x), floor(y),  ceil(z))), 0)[0],
                textureLoad(dataB, vec3<u32>(vec3<f32>(floor(x),  ceil(y),  ceil(z))), 0)[0],
                textureLoad(dataB, vec3<u32>(vec3<f32>( ceil(x),  ceil(y),  ceil(z))), 0)[0],
            );
        }
    }

    let xf : f32 = x - floor(x);
    let xc : f32 = ceil(x) - x;
    let yf : f32 = y - floor(y);
    let yc : f32 = ceil(y) - y;
    let zf : f32 = z - floor(z);
    let zc : f32 = ceil(z) - z;

    return vals[0] * xc * yc * zc + 
           vals[1] * xf * yc * zc + 
           vals[2] * xc * yf * zc + 
           vals[3] * xf * yf * zc + 
           vals[4] * xc * yc * zf + 
           vals[5] * xf * yc * zf + 
           vals[6] * xc * yf * zf + 
           vals[7] * xf * yf * zf;
}

// sampling unstructred mesh data
// have to traverse tree and interpolate within the cell
// returns -1 if point is not in a cell
fn sampleDataValue(x : f32, y: f32, z : f32, dataSrc : u32) -> f32 {
    var sampleVal : f32;
    switch (dataSrc) {
        case DATA_SRC_AXIS_X {
            sampleVal = x;
        }
        case DATA_SRC_AXIS_Y {
            sampleVal = y;
        }
        case DATA_SRC_AXIS_Z {
            sampleVal = z;
        }
        default {
            sampleVal = sampleDataTexture(x, y, z, dataSrc);
        }
    }

    return sampleVal;
}

// p is in dataset space
fn getNodeDepthAtPoint(p : vec3<f32>) -> u32 {
    return 0;
}

fn getNodeIndexAtPoint(p : vec3<f32>) -> u32 {
    return 0;
}

fn getNodeCellCountAtPoint(p : vec3<f32>) -> u32 {
    return 0;
}


// workgroups work on 2d tiles of the input image
@compute @workgroup_size({{WGSizeX}}, {{WGSizeY}}, 1)
fn main(
    @builtin(global_invocation_id) id : vec3<u32>,
    @builtin(local_invocation_index) localIndex : u32,
    @builtin(workgroup_id) wgid : vec3<u32>,
    @builtin(num_workgroups) wgnum : vec3<u32>
) {  

    passInfo = combinedPassInfo.passInfo;
    objectInfo = combinedPassInfo.objectInfo;
    globalInfo = combinedPassInfo.globalInfo;
    passFlags = getFlags(passInfo.flags);

    datasetBox = passInfo.dataBox;
    threadIndex = localIndex;


    var imageSize : vec2<u32> = textureDimensions(outputImage);
    // check if this thread is within the input image and on the mesh
    if (id.x > imageSize.x - 1 || id.y > imageSize.y - 1) {
        // outside the image
        return;
    }

    // calculate the ray from the camera to this pixel
    var ray = getRay(id.x, id.y, globalInfo.camera);
    
    if (!pointInAABB(toDataSpace(globalInfo.camera.position), datasetBox)) {
        // camera point is outside bounding box
        var dataIntersect : RayIntersectionResult = intersectAABB(ray, datasetBox);
        if (dataIntersect.tNear > dataIntersect.tFar || dataIntersect.tNear < 0) {
            // ray does not intersect bounding box
            return;
        }
        // extend to the closest touch of bounding box
        ray = extendRay(ray, max(0, dataIntersect.tNear + 0.01));
    }

    // workgroupBarrier();


    if (passFlags.showRayDirs) {
        setPixel(id.xy, vec4<f32>(ray.direction, 1));
        return;
    }
    

    let startInside = true;


    let seed : u32 = (wgid.x << 12) ^ (wgid.y << 8) ^ (id.x << 4) ^ (id.y) ^ 782035u;

    var marchResult : RayMarchResult;
    var prevOffsetSample = getPrevOptimisationSample(id.x, id.y);
    if (passInfo.framesSinceMove == 0) {
        prevOffsetSample.depth = 0;
    }
    var bestSample = prevOffsetSample;

    var offset : f32 = 0;

    // get the offset to be used for ray-marching
    if (passFlags.optimiseOffset) {
        offset = getOptimisationOffset(f32(passInfo.framesSinceMove), prevOffsetSample.offset, seed);
    } else if (passFlags.randStart) {
        offset = getRandF32(seed);
    }

    if (passInfo.isoSurfaceSrc == DATA_SRC_NONE) {
        return;
    }
    // do ray-marching step
    if (passFlags.showSurface && !passFlags.showVolume) {
        var maxLength = min(passInfo.maxLength, getWorldSpaceSceneDistance(id.x, id.y));
        if (prevOffsetSample.depth != 0) {
            maxLength = min(maxLength, prevOffsetSample.depth);
        }
        marchResult = marchRaySurfOnly(passInfo, ray, passInfo.dataBox, seed, maxLength);
    } else {
        marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataBox, startInside, offset, min(passInfo.maxLength, getWorldSpaceSceneDistance(id.x, id.y)));
    }

    if (passFlags.showTestedCells) {
        var count = marchResult.cellsTested;
        var limit = 5000.0;
        if (count < limit) {
            setPixel(id.xy, vec4<f32>(mix(vec3<f32>(1, 1, 1), vec3<f32>(1, 0, 0), count/limit), 1));
        } else {
            setPixel(id.xy, vec4<f32>(0,0,0,1));
        }
        return;
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

    // shade the pixel
    var outCol = shadeRayMarchResult(marchResult, passFlags);


    storeOptimisationSample(id.xy, bestSample);

    if (passFlags.showOffset) {
        setPixel(id.xy, vec4<f32>(vec3<f32>(bestSample.offset), 1));
    } else  if (outCol.a > 0) {
        drawPixel(id.xy, outCol);
    }
}