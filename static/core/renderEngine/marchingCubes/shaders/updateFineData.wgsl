struct F32Buff {
    buffer : array<f32>,
};

struct U32Buff {
    buffer : array<u32>,
};

struct I32Buff {
    buffer : array<i32>,
};

struct UpdateInfo {
    add : u32,
    remove : u32,
    emptyLocations : u32,
    blockVol : u32
}

@group(0) @binding(0) var fineDataStorage : texture_storage_3d<{{StorageTexFormat}}, write>;
@group(0) @binding(1) var newFineData : texture_3d<f32>;
@group(0) @binding(2) var<storage, read> addBlocks : U32Buff;
@group(0) @binding(3) var<storage, read> removeBlocks : U32Buff;
@group(0) @binding(4) var<storage, read> updateInfo : UpdateInfo; // tells if there are blocks to add/remove

@group(1) @binding(0) var<storage, read_write> blockLocations : I32Buff;
@group(1) @binding(1) var<storage, read> emptyLocations : U32Buff;
@group(1) @binding(2) var<storage, read_write> locationsOccupied : U32Buff;


fn getIndex3d(x : u32, y : u32, z : u32, size : vec3<u32>) -> u32 {
    return size.y * size.z * x + size.z * y + z;
}

fn posFromIndex(i : u32, size : vec3<u32>) -> vec3<u32> {
    return vec3<u32>(i/(size.y*size.z), (i/size.z)%size.y, i%size.z);
}

// fn getVal(localIndex : u32, blockIndex : u32) -> f32 {
//     // linear index of texel
//     var i = blockIndex * {{WGVol}}u + localIndex;
//     var coords = vec3<i32>(posFromIndex(i, vec3<u32>(textureDimensions(newFineData, 0).zyx)).zyx);
//     return f32(textureLoad(
//         newFineData,
//         coords,
//         0
//     ).x);
// }

// fn writeVal(localIndex : u32, blockIndex : u32, val : f32) {
//     // linear index of texel
//     var i = blockIndex * {{WGVol}}u + localIndex;
//     var coords = vec3<i32>(posFromIndex(i, vec3<u32>(textureDimensions(fineDataStorage).zyx)).zyx);
//     textureStore(
//         fineDataStorage,
//         coords,
//         vec4<f32>(val, 0, 0, 0)
//     );
// }
fn getVal(localIndex : u32, blockIndex : u32) -> vec4<f32> {
    // linear index of texel
    var i = blockIndex * {{WGVol}}u + localIndex;
    var coords = vec3<i32>(posFromIndex(i, vec3<u32>(textureDimensions(newFineData, 0).zyx)).zyx);
    return textureLoad(
        newFineData,
        coords,
        0
    );
}

fn writeVal(localIndex : u32, blockIndex : u32, val : vec4<f32>) {
    // linear index of texel
    var i = blockIndex * {{WGVol}}u + localIndex;
    var coords = vec3<i32>(posFromIndex(i, vec3<u32>(textureDimensions(fineDataStorage).zyx)).zyx);
    textureStore(
        fineDataStorage,
        coords,
        val
    );
}

@compute @workgroup_size({{MaxWGSize}}, 1, 1)
fn main(
    @builtin(global_invocation_id) id : vec3<u32>,
    @builtin(local_invocation_index) localIndex : u32,
    @builtin(workgroup_id) wgid : vec3<u32>,
    @builtin(num_workgroups) wgnum : vec3<u32>
) {  
    const TRUE = 1u;
    const FALSE = 0u;
    var WGSize = {{MaxWGSize}}u;
    var globalIndex = wgid.x*WGSize + localIndex;
    
    if (
        globalIndex < arrayLength(&addBlocks.buffer) && 
        globalIndex < arrayLength(&removeBlocks.buffer) &&
        updateInfo.add == TRUE &&
        updateInfo.remove == TRUE
    ) {
        // swap a block
        var oldBlockLocation = u32(blockLocations.buffer[removeBlocks.buffer[globalIndex]]);
        blockLocations.buffer[removeBlocks.buffer[globalIndex]] = -1;
        // write the new block into this location now
        var i = 0u;
        loop {
            if (i == updateInfo.blockVol) {
                break;
            }
            writeVal(i, oldBlockLocation, getVal(i, globalIndex));
            continuing {
                i = i + 1u;
            }
        }
        blockLocations.buffer[addBlocks.buffer[globalIndex]] = i32(oldBlockLocation);

    } else if (globalIndex < arrayLength(&removeBlocks.buffer) && updateInfo.remove == TRUE) {
        // remove block
        var oldBlockLocation = removeBlocks.buffer[globalIndex];
        blockLocations.buffer[oldBlockLocation] = -1;
        locationsOccupied.buffer[oldBlockLocation] = 0;

    } else if (globalIndex < arrayLength(&addBlocks.buffer) && 
        updateInfo.add == TRUE && updateInfo.emptyLocations == TRUE
    ) {
        // add block
        // get the index into addblocks that will be used for this thread
        var newBlockLocIndex : u32;
        if (updateInfo.remove == TRUE) {
            newBlockLocIndex = globalIndex - arrayLength(&removeBlocks.buffer);
        } else {
            newBlockLocIndex = globalIndex;
        }
        
        // find an empty slot for this block
        var newBlockLocation = emptyLocations.buffer[newBlockLocIndex];
        // write the new block into this location now
        var i = 0u;
        loop {
            if (i == updateInfo.blockVol) {
                break;
            }
            writeVal(i, newBlockLocation, getVal(i, globalIndex));
            continuing {
                i = i + 1u;
            }
        }
        blockLocations.buffer[addBlocks.buffer[globalIndex]] = i32(newBlockLocation);
        locationsOccupied.buffer[newBlockLocation] = 1;
    }
}