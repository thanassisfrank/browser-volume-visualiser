// transformVerts.wgsl
// takes the index-space vertex coordinates from the march stage and converts to real object space

struct F32PointBuff {
    points : array<array<f32, 3>>,
};

struct Data {
    @size(16) size : vec3<u32>,
    @size(16) cellSize : vec3<f32>,
    data : array<u32>,
};

// contains the dimensions of the dataset
@group(0) @binding(0) var<storage, read> data : Data;
// stores object-space position of all data points
@group(0) @binding(1) var<storage, read> pos : F32PointBuff;

// coordinates of mesh verts to transform
@group(1) @binding(0) var<storage, read_write> verts : F32PointBuff;


fn getIndex3d(x : u32, y : u32, z : u32, size : vec3<u32>) -> u32 {
    return size.y * size.z * x + size.z * y + z;
}



@compute @workgroup_size({{WGTransformVertsCount}})
fn main(
    @builtin(global_invocation_id) gid : vec3<u32>,
    @builtin(num_workgroups) wgnum : vec3<u32>
) {
    // each thread is tasked with transforming a single point
    
    // first check if there is a vertex associated with this thread
    var globalIndex : u32 = gid.x;
    if (arrayLength(&verts.points) < globalIndex + 1u) {
        return;
    }

    // extract the vert to transform
    var vert : vec3<f32> = vec3<f32>(
        verts.points[globalIndex][0],
        verts.points[globalIndex][1],
        verts.points[globalIndex][2]
    );
    
    // get the points in index-space on either side of edge
    var a : vec3<u32> = vec3<u32>(floor(vert));
    var b : vec3<u32> = vec3<u32>(ceil(vert));

    // extract the blend factor
    var fac = max(max(fract(vert.x), fract(vert.y)), fract(vert.z));

    // get the real, object-space positions of these data points
    var aInd = getIndex3d(a.x, a.y, a.z, data.size);
    var pa = vec3<f32>(
        pos.points[aInd][0],
        pos.points[aInd][1],
        pos.points[aInd][2]
    );
    var bInd = getIndex3d(b.x, b.y, b.z, data.size);
    var pb = vec3<f32>(
        pos.points[bInd][0],
        pos.points[bInd][1],
        pos.points[bInd][2]
    );

    var realVert : vec3<f32> = mix(pa, pb, fac);

    // change the vert in the buffer to match
    verts.points[globalIndex][0] = realVert.x;
    verts.points[globalIndex][1] = realVert.y;
    verts.points[globalIndex][2] = realVert.z;
} 