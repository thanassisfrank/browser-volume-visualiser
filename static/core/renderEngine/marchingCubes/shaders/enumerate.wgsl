struct Data {
    @size(16) size :  vec3<u32>,
    // @size(16) WGNum : vec3<u32>,
    @size(16) cellSize : vec3<f32>,
    data :  array<u32>,
};
struct DataInfo {
    @size(16) cellSize : vec3<f32>,  // the dimensions of the virtual cells being marched
    structuredGrid : u32           // whether the 
}
struct Arr {
    data : array<i32>,
};
struct Vars {
    threshold : f32,
    vertCount : atomic<u32>,
    indexCount : atomic<u32>,
    cellScale : u32,
};
struct Tables {
    vertCoord : array<array<u32, 3>, 8>,
    edge : array<array<i32, 12>, 256>,
    edgeToVerts : array<array<i32, 2>, 12>,
    tri : array<array<i32, 15>, 256>,
};
struct U32Buffer {
    buffer : array<u32>,
};
struct TotalsBuffer {
    val : atomic<u32>,
    buffer : array<u32>,
};

@group(0) @binding(0) var<storage, read> dataInfo : DataInfo;
@group(0) @binding(1) var data : texture_3d<f32>; // type is what comes out of sampler
@group(0) @binding(2) var<storage, read> tables : Tables;

@group(1) @binding(0) var<storage, read_write> vars : Vars;

@group(2) @binding(0) var<storage, read_write> WGVertOffsets : U32Buffer;
@group(2) @binding(1) var<storage, read_write> WGVertOffsetsTotals : TotalsBuffer;

@group(3) @binding(0) var<storage, read_write> WGIndexOffsets : U32Buffer;
@group(3) @binding(1) var<storage, read_write> WGIndexOffsetsTotals : TotalsBuffer;

var<workgroup> localVertOffsets : array<u32, {{WGVol}}>;
var<workgroup> localIndexOffsets : array<u32, {{WGVol}}>;



fn getIndex3d(x : u32, y : u32, z : u32, size : vec3<u32>) -> u32 {
    return size.y * size.z * x + size.z * y + z;
}

fn getVertCount(code : u32) -> u32 {
    var i = 0u;
    loop {
        if (i == 12u || tables.edge[code][i] == -1) {
            break;
        }
        i = i + 1u;
    }
    return i;
}
fn getIndexCount(code : u32) -> u32 {
    var i = 0u;
    loop {
        if (i == 15u || tables.tri[code][i] == -1) {
            break;
        }
        i = i + 1u;
    }
    return i;
}

fn getVal(x : u32, y : u32, z : u32, cellScale : u32) -> f32 {
    return bitcast<f32>(textureLoad(
        data,
        vec3<i32>(vec3<u32>(z, y, x)*cellScale),
        0
    )[0]);
}


@compute @workgroup_size({{WGSizeX}}, {{WGSizeY}}, {{WGSizeZ}})
fn main(
    @builtin(global_invocation_id) id : vec3<u32>, 
    @builtin(local_invocation_index) localIndex : u32,
    @builtin(workgroup_id) WGId : vec3<u32>,
    @builtin(num_workgroups) wgnum : vec3<u32>
) {      
    const TRUE = 1u;
    const FALSE = 0u;

    var cellScale = vars.cellScale;
    var packing = {{packing}}u;
    var code = 0u;
    var thisVertCount = 0u;
    var thisIndexCount = 0u;
    var WGSize = {{WGVol}}u;

    var dataSize = vec3<u32>(textureDimensions(data, 0).zyx);
    //var WGNum = vec3<u32>(wgnum.z, wgnum.y, wgnum.x);

    // if outside of data, return
    var cells : vec3<u32> = vec3<u32>(dataSize.x - 1u, dataSize.y - 1u, dataSize.z - 1u);      
    // needs changing
    if (
        (id.x + 1u)*cellScale < dataSize.x && 
        (id.y + 1u)*cellScale < dataSize.y && 
        (id.z + 1u)*cellScale < dataSize.z
    ) {        
        var c : array<u32, 3>;
        var i = 0u;
        loop {
            if (i == 8u) {
                break;
            }
            // the coordinate of the vert being looked at
            c = tables.vertCoord[i];


            var val : f32 = getVal(id.x + c[0], id.y + c[1], id.z + c[2], cellScale);


            if (val > vars.threshold) {
                code = code | (1u << i);
            }
            continuing {
                i = i + 1u;
            }
        }
        thisVertCount = getVertCount(code);
        thisIndexCount = getIndexCount(code);

    }

    localVertOffsets[localIndex] = thisVertCount;
    localIndexOffsets[localIndex] = thisIndexCount;

    var halfl = WGSize >> 1u;
    var r = halfl;
    var offset = 1u;
    var left = 0u;
    var right = 0u;

    loop {
        if (r == 0u) {
            break;
        }
        workgroupBarrier();
        if (localIndex < halfl) {
            // if in the first half, sort the vert counts
            if (localIndex < r) {
                left = offset * (2u * localIndex + 1u) - 1u;
                right = offset * (2u * localIndex + 2u) - 1u;
                localVertOffsets[right] = localVertOffsets[left] + localVertOffsets[right];
            }
        } else {
            if (localIndex - halfl < r) {
                left = offset * (2u * (localIndex - halfl) + 1u) - 1u;
                right = offset * (2u * (localIndex - halfl) + 2u) - 1u;
                localIndexOffsets[right] = localIndexOffsets[left] + localIndexOffsets[right];
            }
        }
        
        continuing {
            r = r >> 1u;
            offset = offset << 1u;
        }
    }
    workgroupBarrier();
    storageBarrier();
    if (localIndex == 0u) {
        WGVertOffsets.buffer[getIndex3d(WGId.x, WGId.y, WGId.z, wgnum)] = localVertOffsets[WGSize - 1u];
    }
    if (localIndex == 1u) {
        WGIndexOffsets.buffer[getIndex3d(WGId.x, WGId.y, WGId.z, wgnum)] = localIndexOffsets[WGSize - 1u];
    }
}