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
};

@group(0) @binding(0) var<storage, read_write> buffer : U32Buffer;
@group(0) @binding(1) var<storage, read_write> totals : TotalsBuffer;

@group(1) @binding(0) var<storage> bufferOffset : U32Val;

var<workgroup> blockOffset : u32;

@compute @workgroup_size({{WGPrefixSumCount}})
fn main(
    @builtin(global_invocation_id) gid : vec3<u32>, 
    @builtin(local_invocation_id) lid : vec3<u32>,
    @builtin(workgroup_id) wid : vec3<u32>
) {
    // algorithm:
    // 1. each WG performs prefix sum on their own block of the buffer (512 elements)
    //  a. sweep up the data
    //  b. extract the total value
    //  c. sweep down to complete for that block
    // 2. whole buffer is scanned
    //  a. block totals are transferred to totalsBuffer
    //  b. block totals are scanned by WG 0
    //   i. sweep up totals buffer
    //   ii. extract the total sum from last position (store)
    //   iii. sweep down to finish
    //  c. add scanned block total i to elements of block i by its WG 
    
    var blockLength = 2u*{{WGPrefixSumCount}}u;
    // calculate this value properly or receive in a buffer
    //                                  ^^^^^^^^^^^^^^^^^^^
    //var numBlocks = blockLength;//arrayLength(&buffer.buffer)/blockLength;
    var numBlocks = blockLength;//min(blockLength, (arrayLength(&buffer.buffer)-bufferOffset.val)/blockLength);

    
    if(lid.x == 0u) {
        blockOffset = (wid.x + bufferOffset.val) * blockLength ;
    }
    
    

    var d = blockLength >> 1u;
    var offset = 1u;
    var left = 0u;
    var right = 0u;

    loop {
        if (d == 0u) {
            break;
        }
        workgroupBarrier();
        storageBarrier();
        if (lid.x < d) {
            left = offset * (2u * lid.x + 1u) - 1u + blockOffset;
            right = offset * (2u * lid.x + 2u) - 1u + blockOffset;
            buffer.buffer[right] = buffer.buffer[left] + buffer.buffer[right];
        }
        continuing {
            d = d >> 1u;
            offset = offset << 1u;
        }
    }
    if (lid.x == 0u) {
        if (numBlocks == 1u) {
            totals.val = buffer.buffer[blockLength - 1u];
        } else {
            totals.buffer[wid.x] = buffer.buffer[blockLength - 1u + blockOffset];
        }
        buffer.buffer[blockLength - 1u + blockOffset] = 0u;
    }

    d = 1u;
    var t : u32;
    loop {
        if (d == blockLength) {
            break;
        }
        offset = offset >> 1u;
        workgroupBarrier();
        storageBarrier();

        if (lid.x < d) {
            left = offset * (2u * lid.x + 1u) - 1u + blockOffset;
            right = offset * (2u * lid.x + 2u) - 1u + blockOffset;
            t = buffer.buffer[left];
            buffer.buffer[left] = buffer.buffer[right];
            buffer.buffer[right] = buffer.buffer[right] + t;
        }
        
        continuing {
            d = 2u * d;
        }
    }
}