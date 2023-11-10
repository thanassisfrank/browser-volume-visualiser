// bg0
// tables buffer (int32)

// bg1
// buffer containing list of active block ids (uint32)
// buffer containing the block data in the same order as the ids (depends)
//     also contains threshold vars buffer for threshold (float32)
// buffer containing a list of the locations of all blocks in fine data (int32)

// bg2
// vertex buffer (float32)
// index buffer (uint32)

// bg3
// per-block vertex offsets (uint32)
// per-block index offsets (uint32)

struct Tables {
    vertCoord : array<array<u32, 3>, 8>,
    edge : array<array<i32, 12>, 256>,
    edgeToVerts : array<array<i32, 2>, 12>,
    tri : array<array<i32, 15>, 256>,
    requiredNeighbours : array<array<i32, 7>, 8>,
};

struct DataInfo {
    @size(4) threshold : f32,         // threshold value
    @size(12) blockOffset : u32,      // block offset
    @size(16) blocksSize : vec3<u32>, // size in blocks
    @size(16) size : vec3<u32>,       // size of dataset in points
    structuredGrid : u32,
};

struct U32Buffer {
    buffer : array<u32>,
};

struct I32Buffer {
    buffer : array<i32>,
};

struct F32Buffer {
    buffer : array<f32>,
};

@group(0) @binding(0) var<storage, read> tables : Tables;

@group(1) @binding(0) var<storage, read> dataInfo : DataInfo;
@group(1) @binding(1) var data : texture_3d<f32>;
@group(1) @binding(2) var<storage, read> activeBlocks : U32Buffer;
@group(1) @binding(3) var<storage, read> locations : I32Buffer;

@group(2) @binding(0) var vertTexture : texture_storage_3d<r32float, write>;
@group(2) @binding(1) var normalTexture : texture_storage_3d<r32float, write>;
@group(2) @binding(2) var indexTexture : texture_storage_3d<r32uint, write>;
// @group(2) @binding(0) var<storage, read_write> verts : F32Buffer;
// @group(2) @binding(1) var<storage, read_write> indices : U32Buffer;

@group(3) @binding(0) var<storage, read_write> WGVertOffsets : U32Buffer;
@group(3) @binding(1) var<storage, read_write> WGIndexOffsets : U32Buffer;

// used to get the total #verts and #indices for this block
var<workgroup> localVertOffsets : array<u32, {{WGVol}}>;
var<workgroup> localIndexOffsets : array<u32, {{WGVol}}>;

// holds index (1d) of current WG
var<workgroup> WGIndex : u32;

// 5x5x5 grid to store all the data potentially needed to generate the cells
var<workgroup> blockData : array<array<array<f32, 5>, 5>, 5>;
var<workgroup> blockPoints : array<array<array<vec3<f32>, 5>, 5>, 5>;

// the grid of cells that will be marched
// starts as WGSize - 1 and expanded if neighbours on the correct side exist
var<workgroup> cellsSize : vec3<u32>;

// keeps a track of which neighbour cells are present in the data
var<workgroup> neighboursPresent : array<bool, 8>;


fn getIndex(x : u32, y : u32, z : u32, size : vec3<u32>) -> u32 {
    return size.y * size.z * x + size.z * y + z;
}

// get index but takes vector position input
fn getIndexV(pos : vec3<u32>, size : vec3<u32>) -> u32 {
    return getIndex(pos.x, pos.y, pos.z, size);
}

fn unpack(val: u32, i : u32, packing : u32) -> f32{
    if (packing == 4u){
        return unpack4x8unorm(val)[i];
    }
    return bitcast<f32>(val);
}

// different from other getVal as x, y, z are local to block and uses
// the number of the current wg(block) too
fn getVal(x : u32, y : u32, z : u32, WGSize : vec3<u32>, blockIndex : u32, packing : u32) -> f32 {
    // linear index of texel
    var i = blockIndex * {{WGVol}}u + getIndex(x, y, z, WGSize);
    var coords = vec3<i32>(posFromIndex(i, vec3<u32>(textureDimensions(data, 0).zyx)).zyx);
    return f32(textureLoad(
        data,
        coords,
        0
    ).x);
}

fn getPointPos(x : u32, y : u32, z : u32, WGSize : vec3<u32>, blockIndex : u32, packing : u32) -> vec3<f32> {
    // linear index of texel
    var i = blockIndex * {{WGVol}}u + getIndex(x, y, z, WGSize);
    var coords = vec3<i32>(posFromIndex(i, vec3<u32>(textureDimensions(data, 0).zyx)).zyx);
    return textureLoad(
        data,
        coords,
        0
    ).yzw;
}

fn posFromIndex(i : u32, size : vec3<u32>) -> vec3<u32> {
    return vec3<u32>(i/(size.y*size.z), (i/size.z)%size.y, i%size.z);
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

fn cellPresent(neighbours : vec3<u32>) -> bool {
    if (all(neighbours == vec3<u32>(0u))) {
        return true;
    }
    var code = neighbours.z | (neighbours.y << 1u) | (neighbours.x << 2u);

    var i = 0u;
    loop {
        if (i == 7u || tables.requiredNeighbours[code][i] == -1) {
            // checked though all required neighbours
            // if still in loop then it has passed
            break;
        }
        if (neighboursPresent[tables.requiredNeighbours[code][i]] == false) {
            return false;
        }

        continuing {i = i + 1u;}
    }
    return true;
}

@compute @workgroup_size({{WGSizeX}}, {{WGSizeY}}, {{WGSizeZ}})
fn main(
    @builtin(global_invocation_id) gid : vec3<u32>, 
    @builtin(local_invocation_id) lid : vec3<u32>,
    @builtin(local_invocation_index) localIndex : u32, 
    @builtin(workgroup_id) WGId : vec3<u32>
) {
    const TRUE = 1u;
    const FALSE = 0u;
    var WGSize = vec3<u32>({{WGSizeX}}u, {{WGSizeY}}u, {{WGSizeZ}}u);
    var WGVol = {{WGVol}}u;
    if (all(lid == vec3<u32>(0u))) {
        cellsSize = WGSize - vec3<u32>(1u);
        // max workgroups per dimension is 65535 so need to wrap 3d
        // coords to 1d if there is more than that
        WGIndex = WGId.x + dataInfo.blockOffset;
    }

    workgroupBarrier();

    var packing = {{packing}}u;

    // get the index in dataset and position of current block
    var thisIndex = activeBlocks.buffer[WGIndex];
    var thisBlockPos = posFromIndex(thisIndex, dataInfo.blocksSize);
    var thisBlockLoc = u32(locations.buffer[thisIndex]);
    var globalPointPos = thisBlockPos*WGSize + lid;


    // first load all the required data into workgroup memory ===========================================================
    var val = getVal(lid.x, lid.y, lid.z, WGSize, thisBlockLoc, packing);
    blockData[lid.x][lid.y][lid.z] = val;
    if (dataInfo.structuredGrid == TRUE) {
        var thisPoint = getPointPos(lid.x, lid.y, lid.z, WGSize, thisBlockLoc, packing);
        blockPoints[lid.x][lid.y][lid.z] = thisPoint;
    }

    // a vector that describes on what sides this thread has neighbouring blocks (if they exist)
    // corner(fwd): (1, 1, 1), edge(fwd): (1, 1, 0), face(fwd): (1, 0, 0), body: (0, 0, 0,)
    var neighbours = vec3<u32>(max(vec3<i32>(0), vec3<i32>(lid) - vec3<i32>(WGSize) + vec3<i32>(2)));
    
    if (
        lid.x == WGSize.x - 1u || 
        lid.y == WGSize.y - 1u || 
        lid.z == WGSize.z - 1u
    ) {
        // the threads on the +ve faces of the block need to check is they have to
        // load data from the neighbouring block(s) on that side
        // the thread on the forward corner will load data from 7 adjacent blocks
        // the threads on the leading edges will load data from 3 adjacent blocks
        // the threads on the leading faces will load data from 1 adjacent block

        var neighbourConfigs = array<vec3<u32>, 8>(
            vec3<u32>(0u, 0u, 0u), // body point
            vec3<u32>(0u, 0u, 1u), // z+ face neighbour
            vec3<u32>(0u, 1u, 0u), // y+ face neighbour
            vec3<u32>(0u, 1u, 1u), // x+ edge neighbour
            vec3<u32>(1u, 0u, 0u), // x+ face neighbour
            vec3<u32>(1u, 0u, 1u), // y+ edge neighbour
            vec3<u32>(1u, 1u, 0u), // z+ edge neighbour
            vec3<u32>(1u, 1u, 1u)  // corner neighbour 
        );

        

        // check if the block's neighbours are loaded (or exist)
        // and make cellsSize the full size in that dimension if so
        // at the same time, load the data from the shared faces
        var i = 0u;
        loop {
            if (i == 8u) {break;};
            if (all(neighbours == neighbourConfigs[i])) {
                var neighbourPos = thisBlockPos + neighbours;
                if (all(neighbourPos < dataInfo.blocksSize)) {
                    //neighbour is within boundary
                    var neighbourIndex = getIndexV(neighbourPos, dataInfo.blocksSize);
                    if (locations.buffer[neighbourIndex] > -1) {
                        // the face neighbour is part of the loaded dataset
                        // now increment the correct dimenson of cellsSize
                        neighboursPresent[i] = true;
                        // if (neighbourConfigs[i].x == 1u) {cellsSize.x = WGSize.x;}
                        // else if (neighbourConfigs[i].y == 1u) {cellsSize.y = WGSize.y;}
                        // else if (neighbourConfigs[i].z == 1u) {cellsSize.z = WGSize.z;}
                    }
                }
            }
            continuing {i = i + 1u;}
        }

        // load extra data if it is allowed
        i = 1u;
        loop {
            if (i==8u) {break;}
            if (neighboursPresent[i]) {
                var allowed = true;
                var j = 0u;
                
                loop {
                    if (j==3u) {break;}
                    if (neighbourConfigs[i][j] == 1u && neighbours[j] == 0u) {
                        allowed = false;
                        break;
                    }
                    continuing{j=j+1u;}
                }
                if (allowed) {
                    var neighbourIndex = u32(locations.buffer[thisIndex + getIndexV(neighbourConfigs[i], dataInfo.blocksSize)]);
                    var src = lid*(vec3<u32>(1u) - neighbourConfigs[i]);
                    var dst = lid + neighbourConfigs[i];
                    blockData[dst.x][dst.y][dst.z] = getVal(src.x, src.y, src.z, WGSize, neighbourIndex, packing);
                    if (dataInfo.structuredGrid == TRUE) {
                        blockPoints[dst.x][dst.y][dst.z] = getPointPos(src.x, src.y, src.z, WGSize, neighbourIndex, packing);
                    }
                }
            }
            continuing{i=i+1u;}
        }
    }

    // now all data from external blocks has been loaded synchronise threads
    workgroupBarrier();
    storageBarrier();



    // march the cells in the block that are active =================================================================================
    var cellScale = 1u;
    var code = 0u;

    var vertNum : u32 = 0u;
    var indexNum : u32 = 0u;

    //var gridNormals : array<array<f32, 3>, 8>;

    var thisVerts : array<f32, 36>;
    var thisNormals : array<f32, 36>;
    var thisIndices : array<u32, 15>;

    //var globalIndex : u32 = getIndex3d(id.x, id.y, id.z, dataInfo.size);

    if (
        cellPresent(neighbours) &&                   // check if this cell is present if on the edge
        (globalPointPos.x + 1u) < dataInfo.size.x && // and fully in the dataset
        (globalPointPos.y + 1u) < dataInfo.size.y && // and fully in the dataset
        (globalPointPos.z + 1u) < dataInfo.size.z    // and fully in the dataset
    ){
        // calculate the code   
        var coord : array<u32, 3>;
        var i = 0u;
        loop {
            if (i == 8u) {break;}

            // the coordinate of the vert being looked at
            coord = tables.vertCoord[i];
            val = blockData[lid.x + coord[0]][lid.y + coord[1]][lid.z + coord[2]];;
            if (val > dataInfo.threshold) {
                code |= (1u << i);
            }

            continuing {i = i + 1u;}
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
            if (i == 12u || edges[i] == -1) {break;}

            var c : array<i32, 2> = tables.edgeToVerts[edges[i]];
            var a : array<u32, 3> = tables.vertCoord[c[0]];
            var b : array<u32, 3> = tables.vertCoord[c[1]];
            var va : f32 = blockData[lid.x + a[0]][lid.y + a[1]][lid.z + a[2]];
            var vb : f32 = blockData[lid.x + b[0]][lid.y + b[1]][lid.z + b[2]];
            var fac : f32 = (dataInfo.threshold - va)/(vb - va);
            // fill vertices
            if (dataInfo.structuredGrid == TRUE) {
                var pa = blockPoints[lid.x + a[0]][lid.y + a[1]][lid.z + a[2]];
                var pb = blockPoints[lid.x + b[0]][lid.y + b[1]][lid.z + b[2]];

                var p = mix(pa, pb, fac);

                thisVerts[3u*i + 0u] = p.x;
                thisVerts[3u*i + 1u] = p.y;
                thisVerts[3u*i + 2u] = p.z;
            } else {
                thisVerts[3u*i + 0u] = mix(f32(a[0]), f32(b[0]), fac) + f32(lid.x + thisBlockPos.x * WGSize.x);// * f32(cellScale) * dataInfo.cellSize.x;
                thisVerts[3u*i + 1u] = mix(f32(a[1]), f32(b[1]), fac) + f32(lid.y + thisBlockPos.y * WGSize.y);// * f32(cellScale) * dataInfo.cellSize.y;
                thisVerts[3u*i + 2u] = mix(f32(a[2]), f32(b[2]), fac) + f32(lid.z + thisBlockPos.z * WGSize.z);// * f32(cellScale) * dataInfo.cellSize.z;
            }

            continuing {i = i + 1u;}
        }
        vertNum = i;

        // get count of indices
        i = 0u;
        loop {
            if (i == 15u || tables.tri[code][i] == -1) {
                break;
            }

            continuing {i = i + 1u;}
        }

        indexNum = i;

        localVertOffsets[localIndex] = vertNum;
        localIndexOffsets[localIndex] = indexNum;
    }

    // perform prefix sum of offsets for workgroup
    var halfl = WGVol >> 1u;
    var r = halfl;
    var offset = 1u;
    var left = 0u;
    var right = 0u;

    loop {
        if (r == 0u) {break;}

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
    if (localIndex == 0u) {
        localVertOffsets[WGVol - 1u] = 0u;
        
    } else if (localIndex == halfl) {
        localIndexOffsets[WGVol - 1u] = 0u;
    }
    
    r = 1u;
    var t : u32;
    loop {
        if (r == WGVol) {
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
        var vertOffset : u32 = WGVertOffsets.buffer[WGIndex] + localVertOffsets[localIndex];
        var indexOffset : u32 = WGIndexOffsets.buffer[WGIndex] + localIndexOffsets[localIndex];

        // var i = 0u;
        // loop {
        //     if (i == vertNum*3u) {break;}

        //     verts.buffer[3u*(vertOffset) + i] = thisVerts[i];

        //     continuing {i = i + 1u;}
        // }

        // i = 0u;
        // loop {
        //     if (i == indexNum) {break;}

        //     indices.buffer[indexOffset + i] = u32(tables.tri[code][i]) + vertOffset;
            
        //     continuing {i = i + 1u;}
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
};