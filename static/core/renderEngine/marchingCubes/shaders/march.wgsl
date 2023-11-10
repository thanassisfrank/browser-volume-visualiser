struct Data {
    @size(16) size : vec3<u32>,      // can be gotten from texture
    // @size(16) WGNum : vec3<u32>,  // not needed
    @size(16) cellSize : vec3<f32>,  // needs to be supplied
    data : array<u32>,
};
struct DataInfo {
    @size(16) cellSize : vec3<f32>,  // the dimensions cells in space compared to normal size (scaling factor)
    structuredGrid : u32             // whether the 
}
struct Vars {
    threshold : f32,
    currVert : atomic<u32>,
    currIndex : atomic<u32>,
    cellScale : u32,                // the scaling of a cell in terms of real cells covered
};
struct Tables {
    vertCoord : array<array<u32, 3>, 8>,
    edge : array<array<i32, 12>, 256>,
    edgeToVerts : array<array<i32, 2>, 12>,
    tri : array<array<i32, 15>, 256>,
};
struct F32Buff {
    buffer : array<f32>,
};
struct U32Buff {
    buffer : array<u32>,
};
struct Atoms {
    vert : atomic<u32>,
    index : atomic<u32>,
};

// 0 is data info buffer
// 1 is data texture
// 2 is sampler
// 3 is tables

@group(0) @binding(0) var<storage, read> dataInfo : DataInfo; // contains information about dataset
@group(0) @binding(1) var data : texture_3d<f32>; // type is what comes out of sampler
@group(0) @binding(2) var<storage, read> tables : Tables;

@group(1) @binding(0) var<storage, read_write> vars : Vars;

@group(2) @binding(0) var vertTexture : texture_storage_3d<r32float, write>;
@group(2) @binding(1) var normalTexture : texture_storage_3d<r32float, write>;
@group(2) @binding(2) var indexTexture : texture_storage_3d<r32uint, write>;

// @group(2) @binding(0) var<storage, read_write> verts : F32Buff;
// @group(2) @binding(1) var<storage, read_write> normals : F32Buff;
// @group(2) @binding(2) var<storage, read_write> indices : U32Buff;

@group(3) @binding(0) var<storage, read_write> WGVertOffsets : U32Buff;
@group(3) @binding(1) var<storage, read_write> WGIndexOffsets : U32Buff;

var<workgroup> localVertOffsets : array<u32, {{WGVol}}>;
var<workgroup> localIndexOffsets : array<u32, {{WGVol}}>;
var<workgroup> localVertOffsetsAtom : atomic<u32>;
var<workgroup> localIndexOffsetsAtom : atomic<u32>;

fn getIndex3d(x : u32, y : u32, z : u32, size : vec3<u32>) -> u32 {
    return size.y * size.z * x + size.z * y + z;
}

fn getVal(x : u32, y : u32, z : u32, cellScale : u32) -> f32 {
    return textureLoad(
        data,
        vec3<i32>(vec3<u32>(z, y, x)*cellScale),
        0
    )[0];
}

fn getPointPos(x : u32, y : u32, z : u32, cellScale : u32) -> vec3<f32> {
    return textureLoad(
        data,
        vec3<i32>(vec3<u32>(z, y, x)*cellScale),
        0
    ).yzw;
}

// fn samplePointPos(x: f32, y: f32, z: f32, cellScale : u32) -> vec3<f32> {
//     var uvw = vec3<f32>(z, y, x)*f32(cellScale)/(vec3<f32>(textureDimensions(data, 0).zyx) - vec3<f32>(1));
//     return textureSample(
//         data,
//         dataSampler,
//         uvw
//     ).yzw;
// }

fn posFromIndex(i : u32, size : vec3<u32>) -> vec3<u32> {
    return vec3<u32>(i/(size.y*size.z), (i/size.z)%size.y, i%size.z);
}


fn setVertValue(x : f32, y : f32, z : f32, index : u32) {
    var coords : vec3<i32>;
    coords = vec3<i32>(posFromIndex(index*3, vec3<u32>(textureDimensions(vertTexture).zyx)).zyx);
    textureStore(
        vertTexture,
        coords,
        vec4<f32>(x, 0, 0, 0)
    );
    coords = vec3<i32>(posFromIndex(index*3 + 1, vec3<u32>(textureDimensions(vertTexture).zyx)).zyx);
    textureStore(
        vertTexture,
        coords,
        vec4<f32>(y, 0, 0, 0)
    );
    coords = vec3<i32>(posFromIndex(index*3 + 2, vec3<u32>(textureDimensions(vertTexture).zyx)).zyx);
    textureStore(
        vertTexture,
        coords,
        vec4<f32>(z, 0, 0, 0)
    );
}

fn setindexValue(val : u32, index : u32) {
    var coords = vec3<i32>(posFromIndex(index, vec3<u32>(textureDimensions(indexTexture).zyx)).zyx);
    textureStore(
        indexTexture,
        coords,
        vec4<u32>(val, 0, 0, 0)
    );
}


@compute @workgroup_size({{WGSizeX}}, {{WGSizeY}}, {{WGSizeZ}})
fn main(
    @builtin(global_invocation_id) id : vec3<u32>,
    @builtin(local_invocation_index) localIndex : u32,
    @builtin(workgroup_id) wgid : vec3<u32>,
    @builtin(num_workgroups) wgnum : vec3<u32>
) {         
    const TRUE = 1u;
    const FALSE = 0u;

    var WGSize = {{WGVol}}u;
    var dataSize = vec3<u32>(textureDimensions(data, 0).zyx);
    //var WGNum = vec3<u32>(wgnum.z, wgnum.y, wgnum.x);
    
    var cellScale = vars.cellScale;
    var packing = {{packing}}u;
    var code = 0u;

    var vertNum : u32 = 0u;
    var indexNum : u32 = 0u;

    var gridNormals : array<array<f32, 3>, 8>;

    var thisVerts : array<f32, 36>;
    var thisNormals : array<f32, 36>;
    var thisIndices : array<u32, 15>;

    var globalIndex : u32 = getIndex3d(id.x, id.y, id.z, dataSize);

    // if outside of data, return
    var cells : vec3<u32> = vec3<u32>(dataSize.x - 1u, dataSize.y - 1u, dataSize.z - 1u);
    if (
        (id.x + 1u)*cellScale >= dataSize.x ||
        (id.y + 1u)*cellScale >= dataSize.y || 
        (id.z + 1u)*cellScale >= dataSize.z
    ) {
        // code remains 0
        code = 0u;
    } else {
        // calculate the code   
        var coord : array<u32, 3>;
        var i = 0u;
        loop {
            if (i == 8u) {
                break;
            }
            // the coordinate of the vert being looked at
            coord = tables.vertCoord[i];
            var val : f32 = getVal(id.x + coord[0], id.y + coord[1], id.z + coord[2], cellScale);
            if (val > vars.threshold) {
                code |= (1u << i);
            }
            continuing {
                i = i + 1u;
            }
        }
    }

    
    if (code > 0u && code < 255u) {
        // get a code for the active vertices
        var edges : array<i32, 12> = tables.edge[code];
        var activeVerts = 0u;
        var i = 0u;
        loop {
            if (i == 12u || edges[i] == -1){
                break;
            }
            var c : array<i32, 2> = tables.edgeToVerts[edges[i]];
            activeVerts |= 1u << u32(c[0]);
            activeVerts |= 1u << u32(c[1]);
            continuing {
                i = i + 1u;
            }
        }
        // get vertices
        
        i = 0u;
        loop {
            if (i == 12u || edges[i] == -1) {
                break;
            }
            var c : array<i32, 2> = tables.edgeToVerts[edges[i]];
            var a : array<u32, 3> = tables.vertCoord[c[0]];
            var b : array<u32, 3> = tables.vertCoord[c[1]];
            var va : f32 = getVal(id.x + a[0], id.y + a[1], id.z + a[2], cellScale);
            var vb : f32 = getVal(id.x + b[0], id.y + b[1], id.z + b[2], cellScale);
            var fac : f32 = (vars.threshold - va)/(vb - va);

            if (dataInfo.structuredGrid == TRUE) {
                var pa = getPointPos(id.x + a[0], id.y + a[1], id.z + a[2], cellScale);
                var pb = getPointPos(id.x + b[0], id.y + b[1], id.z + b[2], cellScale);

                var p = mix(pa, pb, fac);

                thisVerts[3u*i + 0u] = p.x;
                thisVerts[3u*i + 1u] = p.y;
                thisVerts[3u*i + 2u] = p.z;

            } else {
                // fill vertices
                thisVerts[3u*i + 0u] = (mix(f32(a[0]), f32(b[0]), fac) + f32(id.x)) * f32(cellScale) * dataInfo.cellSize.x;
                thisVerts[3u*i + 1u] = (mix(f32(a[1]), f32(b[1]), fac) + f32(id.y)) * f32(cellScale) * dataInfo.cellSize.y;
                thisVerts[3u*i + 2u] = (mix(f32(a[2]), f32(b[2]), fac) + f32(id.z)) * f32(cellScale) * dataInfo.cellSize.z;
            }

            continuing {
                i = i + 1u;
            }
        }
        vertNum = i;

        // get count of indices
        i = 0u;
        loop {
            if (i == 15u || tables.tri[code][i] == -1) {
                break;
            }
            continuing {
                i = i + 1u;
            }
        }

        indexNum = i;

        localVertOffsets[localIndex] = vertNum;
        localIndexOffsets[localIndex] = indexNum;
    }

    // perform prefix sum of offsets for workgroup
    var halfl = WGSize/2u;
    var r = halfl;
    var offset = 1u;
    var left = 0u;
    var right = 0u;

    loop {
        if (r == 0u) {
            break;
        }
        workgroupBarrier();
        storageBarrier();
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
    var last = WGSize - 1u;
    if (localIndex == 0u) {
        localVertOffsets[last] = 0u;
        
    } else if (localIndex == halfl) {
        localIndexOffsets[last] = 0u;
    }
    
    r = 1u;
    var t : u32;
    loop {
        if (r == WGSize) {
            break;
        }
        offset = offset >> 1u;
        workgroupBarrier();
        storageBarrier();
        if (localIndex < halfl) {
            if (localIndex < r) {
                left = offset * (2u * localIndex + 1u) - 1u;
                right = offset * (2u * localIndex + 2u) - 1u;
                t = localVertOffsets[left];
                localVertOffsets[left] = localVertOffsets[right];
                localVertOffsets[right] = localVertOffsets[right] + t;
            }
        } else {
            if (localIndex - halfl < r) {
                left = offset * (2u * (localIndex - halfl) + 1u) - 1u;
                right = offset * (2u * (localIndex - halfl) + 2u) - 1u;
                t = localIndexOffsets[left];
                localIndexOffsets[left] = localIndexOffsets[right];
                localIndexOffsets[right] = localIndexOffsets[right] + t;
            }
        }
        
        continuing {
            r = 2u * r;
        }
    }

    workgroupBarrier();
    storageBarrier();

    if (vertNum > 0u && indexNum > 0u) {
        var vertOffset : u32 = WGVertOffsets.buffer[getIndex3d(wgid.x, wgid.y, wgid.z, wgnum)] + localVertOffsets[localIndex];
        var indexOffset : u32 = WGIndexOffsets.buffer[getIndex3d(wgid.x, wgid.y, wgid.z, wgnum)] + localIndexOffsets[localIndex];

        // var i = 0u;
        // loop {
        //     if (i == vertNum*3u) {
        //         break;
        //     }
        //     verts.buffer[3u*(vertOffset) + i] = thisVerts[i];
        //     continuing {
        //         i = i + 1u;
        //     }
        // }
        var i = 0u;
        loop {
            if (i == vertNum) {break;}
            setVertValue(thisVerts[3*i], thisVerts[3*i + 1], thisVerts[3*i + 2], vertOffset + i);
            continuing {i = i + 1u;}
        }

        i = 0u;
        loop {
            if (i == indexNum) {break;}
            // indices.buffer[indexOffset + i] = u32(tables.tri[code][i]) + vertOffset;//indexNum;//localIndexOffsets[localIndex] + i;//
            setindexValue(u32(tables.tri[code][i]) + vertOffset, indexOffset + i);
            continuing {i = i + 1u;}
        }
    }
}