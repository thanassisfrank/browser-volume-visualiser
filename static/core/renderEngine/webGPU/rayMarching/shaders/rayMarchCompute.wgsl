// rayMarchCompute.wgsl
// performs ray marching but in a compute shader

// imports
{{utils.wgsl}}
{{rayMarchUtils.wgsl}}

// data common to all rendering
// camera mats, position
@group(0) @binding(0) var<storage, read> globalInfo : GlobalUniform;
// object matrix, colours
@group(0) @binding(1) var<storage, read> objectInfo : ObjectInfo;

// ray marching data
// threshold, data matrix, march parameters
@group(1) @binding(0) var<storage, read> passInfo : RayMarchPassInfo;
// data tree, leaves contain a list of intersecting cell ids
@group(1) @binding(1) var<storage, read> dataTree : U32Buff; 
// positions of each of the vertices in the mesh
@group(1) @binding(2) var<storage, read> vertexPositions : PointsBuff;
// what verts make up each cell, indexes into vertexPositions 
@group(1) @binding(3) var<storage, read> cellConnectivity : U32Buff;
// where the vert index list starts for each cell, indexes into cellConnectivity
@group(1) @binding(4) var<storage, read> cellOffsets : U32Buff;
// the data values associated with each vertex
@group(1) @binding(5) var<storage, read> vertexData : F32Buff;
// the types of each cell i.e. how many verts it has
// @group(1) @binding(6) var<storage> cellTypes : U32Buff;

// images
// input image f32, the distance to suface from the camera position, if outside, depth is 0
// if the depth is to the backside of a tri (viewing from inside) depth is negative
@group(2) @binding(0) var boundingVolDepthImage : texture_2d<f32>;
// two textures used to hold the last best result and write the new best result too
// previous best results
@group(2) @binding(1) var offsetOptimisationTextureOld : texture_2d<f32>;
// a texture to write the best results too
@group(2) @binding(2) var offsetOptimisationTextureNew : texture_storage_2d<rg32float, write>;
// output image after ray marching into volume
@group(2) @binding(3) var outputImage : texture_storage_2d<bgra8unorm, write>;


struct KDTreeNode {
    splitDimension : u32, // the dimensions of the split
    splitVal : f32,       // the value this node is split at into left and right
    cellCount: u32,       // # cells within this node
    leaf : u32,           // location of cells start in buffer
    leftPtr : u32,        // where the left child is
    rightPtr : u32,       // where the right child is
};

struct InterpolationCell {
    points : array<array<f32, 3>, 4>,
    values : vec4<f32>,
    factors : vec4<f32>,
};

struct Sample {
    value : f32,
    valid : bool
};



fn getContainingLeafNode(queryPoint : vec3<f32>) -> KDTreeNode {
    // traverse the data tree (kdtree) to find the correct leaf node
    var depth = 0;
    var currNodePtr : u32 = 0u;
    var currNode : KDTreeNode;
    loop {
        // make a node at the current position
        currNode = KDTreeNode(
                         dataTree.buffer[currNodePtr + 0],
            bitcast<f32>(dataTree.buffer[currNodePtr + 1]),
                         dataTree.buffer[currNodePtr + 2],
                         dataTree.buffer[currNodePtr + 3],
                         dataTree.buffer[currNodePtr + 4],
                         dataTree.buffer[currNodePtr + 5],

        );
        // break;
        if (currNode.cellCount == 0) {
            // have to carry on down the tree
            if (queryPoint[currNode.splitDimension] <= currNode.splitVal) {
                currNodePtr = currNode.leftPtr;
            } else {
                currNodePtr = currNode.rightPtr;
            }
            depth++;
        } else {
            // got to the bottom
            break;
        }

    }

    return currNode;
}

// point in tet functions returns the barycentric coords if inside and all 0 if outside
// this implementation uses the determinates of matrices - slightly faster
fn pointInTetFast(queryPoint : vec3<f32>, cell : InterpolationCell) -> vec4<f32> {
    var x = queryPoint.x;
    var y = queryPoint.y;
    var z = queryPoint.z;
    var p = cell.points;
    // compute the barycentric coords for the point
    var lambda1 = determinant(mat4x4<f32>(
        1,       x,       y,       z,
        1, p[1][0], p[1][1], p[1][2],
        1, p[2][0], p[2][1], p[2][2],
        1, p[3][0], p[3][1], p[3][2],
    ));

    var lambda2 = determinant(mat4x4<f32>(
        1, p[0][0], p[0][1], p[0][2],      
        1,       x,       y,       z,      
        1, p[2][0], p[2][1], p[2][2],      
        1, p[3][0], p[3][1], p[3][2],      
    ));

    var lambda3 = determinant(mat4x4<f32>(
        1, p[0][0], p[0][1], p[0][2],      
        1, p[1][0], p[1][1], p[1][2],      
        1,       x,       y,       z,      
        1, p[3][0], p[3][1], p[3][2],      
    ));

    var lambda4 = determinant(mat4x4<f32>(
        1, p[0][0], p[0][1], p[0][2],      
        1, p[1][0], p[1][1], p[1][2],      
        1, p[2][0], p[2][1], p[2][2],      
        1,       x,       y,       z,      
    ));

    var vol = determinant(mat4x4<f32>(
        1, p[0][0], p[0][1], p[0][2],      
        1, p[1][0], p[1][1], p[1][2],      
        1, p[2][0], p[2][1], p[2][2],      
        1, p[3][0], p[3][1], p[3][2],      
    ));

    if (lambda1 <= 0 && lambda2 <= 0 && lambda3 <= 0 && lambda4 <= 0) {
        return vec4<f32>(lambda1, lambda2, lambda3, lambda4)/vol;
    } else if (lambda1 >= 0 && lambda2 >= 0 && lambda3 >= 0 && lambda4 >= 0) {
        return vec4<f32>(lambda1, lambda2, lambda3, lambda4)/vol;
    } else {
        // not in this cell
        return vec4<f32>(0);
    }

}

// this implementation uses the scalar triple product
fn pointInTet(queryPoint : vec3<f32>, cell : InterpolationCell) -> vec4<f32> {
    var p = queryPoint;
    var a = vec3<f32>(cell.points[0][0], cell.points[0][1], cell.points[0][2]);
    var b = vec3<f32>(cell.points[1][0], cell.points[1][1], cell.points[1][2]);
    var c = vec3<f32>(cell.points[2][0], cell.points[2][1], cell.points[2][2]);
    var d = vec3<f32>(cell.points[3][0], cell.points[3][1], cell.points[3][2]);

    var vap : vec3<f32> = p - a;
    var vbp : vec3<f32> = p - b;

    var vab : vec3<f32> = b - a;
    var vac : vec3<f32> = c - a;
    var vad : vec3<f32> = d - a;
    var vbc : vec3<f32> = c - b;
    var vbd : vec3<f32> = d - b;
    
    var lambda1 : f32 = scalarTriple(vbp, vbd, vbc);
    var lambda2 : f32 = scalarTriple(vap, vac, vad);
    var lambda3 : f32 = scalarTriple(vap, vad, vab);
    var lambda4 : f32 = scalarTriple(vap, vab, vac);
    var v : f32 = scalarTriple(vab, vac, vad);

    if (lambda1 <= 0 && lambda2 <= 0 && lambda3 <= 0 && lambda4 <= 0) {
        return vec4<f32>(lambda1, lambda2, lambda3, lambda4)/v;
    } else if (lambda1 > 0 && lambda2 > 0 && lambda3 > 0 && lambda4 > 0) {
        return vec4<f32>(lambda1, lambda2, lambda3, lambda4)/v;
    } else {
        // not in this cell
        return vec4<f32>(0);
    }
}

fn pointInTetBounds(queryPoint : vec3<f32>, cell : InterpolationCell) -> vec4<f32> {
    var xMax = max(cell.points[0][0], max(cell.points[1][0], max(cell.points[2][0], cell.points[3][0])));
    var xMin = min(cell.points[0][0], min(cell.points[1][0], min(cell.points[2][0], cell.points[3][0])));

    if (queryPoint.x < xMin || queryPoint.x >= xMax) {return vec4<f32>(0);};

    var yMax = max(cell.points[0][1], max(cell.points[1][1], max(cell.points[2][1], cell.points[3][1])));
    var yMin = min(cell.points[0][1], min(cell.points[1][1], min(cell.points[2][1], cell.points[3][1])));

    if (queryPoint.y < yMin || queryPoint.y >= yMax) {return vec4<f32>(0);};

    var zMax = max(cell.points[0][2], max(cell.points[1][2], max(cell.points[2][2], cell.points[3][2])));
    var zMin = min(cell.points[0][2], min(cell.points[1][2], min(cell.points[2][2], cell.points[3][2])));

    if (queryPoint.z < zMin || queryPoint.z >= zMax) {return vec4<f32>(0);};

    return vec4<f32>(1);
}

fn getContainingCell(queryPoint : vec3<f32>, leafNode : KDTreeNode) -> InterpolationCell {
    var cell : InterpolationCell;

    // check the cells in the leaf node found
    var cellsPtr = leafNode.leaf; // go to where cells are stored
    var foundCell = false;
    var cellID : u32;
    var i = 0u;
    loop {
        if (i >= leafNode.cellCount) {break;}
        // go through and check all the contained cells
        cellID = dataTree.buffer[cellsPtr + i];
        // create a cell from the data

        // figure out if cell is inside using barycentric coords
        var pointsOffset : u32 = cellOffsets.buffer[cellID];
        var j = 0u;
        // read all the point positions
        loop {
            // get the coords of the point as an array 3
            var thisPointIndex = cellConnectivity.buffer[pointsOffset + j];
            cell.points[j] = vertexPositions.buffer[thisPointIndex];
            j++;
            if (j > 3u) {break;}
        }

        // check cell bounding box
        var boundFactors = pointInTetBounds(queryPoint, cell);
        if (length(boundFactors) == 0) {
            i++;
            continue;
        };
        var tetFactors = pointInTetFast(queryPoint, cell);
        if (length(tetFactors) == 0) {
            i++;
            continue;
        };
        cell.values[0] = vertexData.buffer[cellConnectivity.buffer[pointsOffset + 0]];
        cell.values[1] = vertexData.buffer[cellConnectivity.buffer[pointsOffset + 1]];
        cell.values[2] = vertexData.buffer[cellConnectivity.buffer[pointsOffset + 2]];
        cell.values[3] = vertexData.buffer[cellConnectivity.buffer[pointsOffset + 3]];

        cell.factors = tetFactors;
        break;
    }
    return cell;
}


// sampling unstructred mesh data
// have to traverse tree and interpolate within the cell
// returns -1 if point is not in a cell
fn sampleDataValue(x : f32, y: f32, z : f32) -> f32 {
    var queryPoint = vec3<f32>(x, y, z);

    var leafNode : KDTreeNode = getContainingLeafNode(queryPoint);
    // return f32(leafNode.leaf)/5000;

    var cell : InterpolationCell = getContainingCell(queryPoint, leafNode);
    // return cell.values[0];

    // interpolate value
    if (length(cell.factors) == 0) {
        return 0;
    };
    return dot(cell.values, cell.factors);
}


fn setPixel(coords : vec2<u32>, col : vec4<f32>) {
    var outCol = vec4<f32>(vec3<f32>(1-col.a), 0) + vec4<f32>(col.a*col.rgb, col.a);
    textureStore(outputImage, coords, outCol);
}

fn pixelOnVolume(x : u32, y : u32) -> bool {
    var pixVal : f32 = textureLoad(boundingVolDepthImage, vec2<u32>(x, y), 0)[0];
    return pixVal != 0;
}

fn isFrontFacing(x : u32, y : u32) -> bool {
    var pixVal : f32 = textureLoad(boundingVolDepthImage, vec2<u32>(x, y), 0)[0];
    if (pixVal > 0) {
        return true;
    } else {
        return false;
    }
}

// takes camera and x
fn getRay(x : u32, y : u32, camera : Camera) -> Ray {
    // get the forward vector
    var fwd = normalize(cross(camera.upDirection, camera.rightDirection));
    // get the x and y as proportions of the image Size
    // 0 is centre, +1 is right and bottom edge
    var imageDims = textureDimensions(outputImage);
    var xProp : f32 = 2*(f32(x) + 0.5)/f32(imageDims.x) - 1;
    var yProp : f32 = 2*(f32(y) + 0.5)/f32(imageDims.y) - 1;

    // calculate the ray direction
    var ray : Ray;
    var aspect = camera.fovx/camera.fovy;
    var unormRay = fwd 
        + xProp*tan(camera.fovy/2)*aspect*normalize(camera.rightDirection) 
        - yProp*tan(camera.fovy/2)*normalize(camera.upDirection);
    ray.direction = normalize(unormRay);
    ray.tip = camera.position;
    ray.length = 0;
    return ray;
}

fn getPrevOptimisationSample(x : u32, y : u32) -> OptimisationSample {
    var texel = textureLoad(offsetOptimisationTextureOld, vec2<u32>(x, y), 0);
    return OptimisationSample(texel[0], texel[1]);
}

fn storeOptimisationSample(coords : vec2<u32>, sample : OptimisationSample) {
    textureStore(offsetOptimisationTextureNew, coords, vec4<f32>(sample.offset, sample.depth, 0, 0));
}

// generate a new random f32 value [0, 1]
fn getRandF32(seed : u32) -> f32 {
    var randU32 = randomU32(globalInfo.time ^ seed);
    return f32(randU32)/exp2(32);
}


// workgroups work on 2d tiles of the input image
@compute @workgroup_size({{WGSizeX}}, {{WGSizeY}}, 1)
fn main(
    @builtin(global_invocation_id) id : vec3<u32>,
    @builtin(local_invocation_index) localIndex : u32,
    @builtin(workgroup_id) wgid : vec3<u32>,
    @builtin(num_workgroups) wgnum : vec3<u32>
) {  
    var imageSize : vec2<u32> = textureDimensions(outputImage);
    // check if this thread is within the input image and on the mesh
    if (id.x > imageSize.x - 1 || id.y > imageSize.y - 1 || !pixelOnVolume(id.x, id.y)) {
        // outside the image
        return;
    }

    // get the flags governing this pass
    var passFlags : RayMarchPassFlags = getFlags(passInfo.flags);

    // calculate the world position of the starting fragment
    var ray = getRay(id.x, id.y, globalInfo.camera);

    var startInside = false;

    if (isFrontFacing(id.x, id.y)) {
        var depthVal : f32 = textureLoad(boundingVolDepthImage, id.xy, 0)[0];
        ray = extendRay(ray, depthVal + 0.01); // nudge the start just inside
        startInside = true;
    }
    if (passFlags.showRayDirs) {
        setPixel(id.xy, vec4<f32>(ray.direction, 1));
        return;
    }

    
    var marchResult : RayMarchResult;
    // generate a new sampling threshold
    var randomVal = getRandF32(id.x ^ id.y);
    var prevOffsetSample = getPrevOptimisationSample(id.x, id.y);

    var offset : f32;

    if(passFlags.optimiseOffset) {
        // get the previous value
        // if sampling threshold < t
        var t : f32 = 1 - f32(passInfo.framesSinceMove)/20.0;
        // var t : f32 = exp2(-f32(passInfo.framesSinceMove)/10.0);
        if (randomVal < t) {
            // generate new offset
            var newOffset = getRandF32(id.x ^ id.y ^ 782035u);
            // march with the new offset
            marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataSize, startInside, newOffset);
            offset = newOffset;
            if (marchResult.surfaceDepth < prevOffsetSample.depth || prevOffsetSample.depth == 0) {
                // if the surface is closer
                // store the new offset and depth
                storeOptimisationSample(id.xy, OptimisationSample(newOffset, marchResult.surfaceDepth));
            }
        } else {
            // march with existing offset
            marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataSize, startInside, prevOffsetSample.offset);
            // store depth into texture
            storeOptimisationSample(id.xy, OptimisationSample(prevOffsetSample.offset, marchResult.surfaceDepth));
            offset = prevOffsetSample.offset;
        }
    } else if (passFlags.randStart) {
        marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataSize, startInside, randomVal);
        offset = randomVal;
    } else {
        marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataSize, startInside, 0);
        offset = 0;
    }

    // march the ray through the volume
    if (passFlags.showOffset) {
        setPixel(id.xy, vec4<f32>(offset, 0, 0, 1));
    } else {
        setPixel(id.xy, marchResult.fragCol);
    }
}