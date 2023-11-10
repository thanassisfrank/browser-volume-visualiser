struct U32Buffer {
    buffer : array<u32>,
};
struct TotalsBuffer {
    val : u32,
    carry : u32,
    buffer : array<u32>,
};
struct U32Val {
    val : u32,
}

@group(0) @binding(0) var<storage, read_write> buffer : U32Buffer;
@group(0) @binding(1) var<storage, read_write> totals : TotalsBuffer;

@group(1) @binding(0) var<storage> bufferOffset : U32Val;

var<workgroup> blockOffset : u32;

// credit to : https://graphics.stanford.edu/~seander/bithacks.html#RoundUpPowerOf2
fn nextPowerOf2(a : u32) -> u32 {
    var v : u32 = a;
    v = v - 1u;
    v |= v >> 1u;
    v |= v >> 2u;
    v |= v >> 4u;
    v |= v >> 8u;
    v |= v >> 16u;
    v = v + 1u;
    return v;
}

@compute @workgroup_size({{WGPrefixSumCount}})
fn main(
    @builtin(global_invocation_id) gid : vec3<u32>, 
    @builtin(local_invocation_id) lid : vec3<u32>,
    @builtin(workgroup_id) wid : vec3<u32>
) {                    
    if(lid.x == 0u) {
        blockOffset = 2u*gid.x;
    }
    
    var blockLength = 2u*{{WGPrefixSumCount}}u;
    // set to 512 for now, will make dynamic later
    var numBlocks = blockLength;//arrayLength(&buffer.buffer)/blockLength;
    
    // only need to consider this section
    var length : u32 = min(blockLength, nextPowerOf2(numBlocks));
    
    var d = length >> 1u;
    var offset = 1u;
    var left = 0u;
    var right = 0u;

    // scan the block totals (only 1 WG)

    loop {
        if (d == 0u) {
            break;
        }
        workgroupBarrier();
        storageBarrier();
        if (gid.x < d) {
            left = offset * (2u * gid.x + 1u) - 1u;
            right = offset * (2u * gid.x + 2u) - 1u;
            totals.buffer[right] = totals.buffer[left] + totals.buffer[right];
        }
        continuing {
            d = d >> 1u;
            offset = offset << 1u;
        }
    }
    if (gid.x == 0u) {
        totals.val = totals.buffer[length - 1u];
        totals.buffer[length - 1u] = 0u;
    }

    d = 1u;
    var t : u32;
    loop {
        if (d == length) {
            break;
        }
        offset = offset >> 1u;
        workgroupBarrier();
        storageBarrier();

        if (gid.x < d) {
            left = offset * (2u * gid.x + 1u) - 1u;
            right = offset * (2u * gid.x + 2u) - 1u;
            t = totals.buffer[left];
            totals.buffer[left] = totals.buffer[right];
            // this line is problematic when numblocks > 64 (i.e. 128)
            totals.buffer[right] = totals.buffer[right] + t;
        }
        
        continuing {
            d = 2u * d;
        }
    }
    workgroupBarrier();
    storageBarrier();
    if (lid.x < numBlocks) {
        var i = 0u;
        loop {
            if (i == blockLength) {
                break;
            }
            buffer.buffer[i + (2u*lid.x + bufferOffset.val)*blockLength] = totals.buffer[2u*lid.x] + buffer.buffer[i + (2u*lid.x + bufferOffset.val)*blockLength] + totals.carry;
            buffer.buffer[i + (2u*lid.x+1u + bufferOffset.val)*blockLength] = totals.buffer[2u*lid.x + 1u] + buffer.buffer[i + (2u*lid.x+1u + bufferOffset.val)*blockLength] + totals.carry;
            continuing {
                i = i + 1u;
            }
        }
    }   
    if (gid.x == 0u) {
        totals.carry = totals.carry + totals.val;
    }                 
}