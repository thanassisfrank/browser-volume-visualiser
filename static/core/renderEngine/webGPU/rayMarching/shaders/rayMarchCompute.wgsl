// rayMarchCompute.wgsl
// performs ray marching but in a compute shader

// imports
{{utils.wgsl}}
{{rayMarchUtils.wgsl}}

struct CombinedPassInfo {
    @size(208) globalInfo : GlobalUniform,
    @size(160) objectInfo : ObjectInfo,
    @size(128) passInfo : RayMarchPassInfo,
};

// tree nodes can be in one of 3 states:
// (? => node signature  # => value info)
// > branch
//   > has a left and right child
//   > doesn't reference any cells
//   ? cellCount = 0; leftPtr != rightPtr
//   # no value info stored
// > true leaf
//   > the true bottom of the tree
//   > references a list of cells
//   ? cellCount > 0; rightPtr = 0
//   # associated cells contain values
// > pruned leaf
//   > a node at the base of the tree
//   > doesn't reference any cells
//   ? cellCount = 0; rightPtr = 0
//   # splitVal contains average node value
struct KDTreeNode {
    // the spatial coordinate to split into l/r or node sample value
    @size(4) splitVal : f32,
    // # cells within this node 
    @size(4) cellCount : u32,
    // where the parent node is
    @size(4) parentPtr : u32,
    // where the left child is or cells location
    @size(4) leftPtr : u32,
    // where the right child is
    @size(4) rightPtr : u32,
};

struct TreeNodesBuff {
    buffer : array<KDTreeNode>, 
};

struct CornerValuesBuff {
    buffer : array<array<f32, 8> >
}

// data important for drawing objects
// camera mats, position
// object matrix, colours
// threshold, data matrix, march parameters
@group(0) @binding(0) var<storage, read> combinedPassInfo : CombinedPassInfo;

// ray marching data
// data tree, leaves contain a list of intersecting cell ids
@group(1) @binding(0) var<storage, read> treeNodes : TreeNodesBuff;
@group(1) @binding(1) var<storage, read> treeCells : U32Buff; 
// positions of each of the vertices in the mesh
@group(1) @binding(2) var<storage, read> vertexPositions : PointsBuff;
// what verts make up each cell, indexes into vertexPositions 
@group(1) @binding(3) var<storage, read> cellConnectivity : U32Buff;
// where the vert index list starts for each cell, indexes into cellConnectivity
@group(1) @binding(4) var<storage, read> cellOffsets : U32Buff;
// the data values associated with each vertex
@group(1) @binding(5) var<storage, read> vertexData : F32Buff;
// sampled values for the corners of the node bounding boxes in the tree
@group(1) @binding(6) var<storage, read> cornerValues : CornerValuesBuff;

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


struct KDTreeResult {
    node : KDTreeNode,
    box : AABB,
    depth : u32,
}

struct InterpolationCell {
    points : array<array<f32, 3>, 4>,
    values : vec4<f32>,
    factors : vec4<f32>,
};

struct Sample {
    value : f32,
    valid : bool
};

// used to keep a track of the last leaves sampled
var<workgroup> lastLeavesBox : array<AABB, {{WGVol}}>;
var<workgroup> datasetBox : AABB;

var<private> threadIndex : u32;
var<private> globalInfo : GlobalUniform;
var<private> objectInfo : ObjectInfo;
var<private> passInfo : RayMarchPassInfo;
var<private> passFlags : RayMarchPassFlags;


// returns the lowest node in the tree which contains the query point
fn getContainingLeafNode(queryPoint : vec3<f32>) -> KDTreeResult {
    // traverse the data tree (kdtree) to find the correct leaf node
    var depth : u32 = 0u;
    var splitDimension : u32 = 0u;
    var currNodePtr : u32 = 0u;
    var currNode : KDTreeNode;
    var box : AABB = datasetBox;
    loop {
        // make a node at the current position
        currNode = treeNodes.buffer[currNodePtr];//makeNodeFrom(currNodePtr);
        box.val = currNodePtr;
        if (currNode.rightPtr != 0u) {
            // have to carry on down the tree
            if (queryPoint[splitDimension] <= currNode.splitVal) {
                currNodePtr = currNode.leftPtr;
                box.max[splitDimension] = currNode.splitVal;
            } else {
                currNodePtr = currNode.rightPtr;
                box.min[splitDimension] = currNode.splitVal;
            }
            depth++;
            splitDimension = depth % 3;
        } else {
            // got to the bottom
            break;
        }

    }

    return KDTreeResult(currNode, box, depth);
}


// this implementation uses the scalar triple product
fn pointInTetTriple(queryPoint : vec3<f32>, cell : InterpolationCell) -> vec4<f32> {
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

// point in tet functions returns the barycentric coords if inside and all 0 if outside
// this implementation uses the determinates of matrices - slightly faster
fn pointInTetDet(queryPoint : vec3<f32>, cell : InterpolationCell) -> vec4<f32> {
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

fn pointInTetBounds(queryPoint : vec3<f32>, cell : InterpolationCell) -> bool {
    var minVec = vec3<f32>(
        min(cell.points[0][0], min(cell.points[1][0], min(cell.points[2][0], cell.points[3][0]))),
        min(cell.points[0][1], min(cell.points[1][1], min(cell.points[2][1], cell.points[3][1]))),
        min(cell.points[0][2], min(cell.points[1][2], min(cell.points[2][2], cell.points[3][2]))),
    );
    var maxVec = vec3<f32>(
        max(cell.points[0][0], max(cell.points[1][0], max(cell.points[2][0], cell.points[3][0]))),
        max(cell.points[0][1], max(cell.points[1][1], max(cell.points[2][1], cell.points[3][1]))),
        max(cell.points[0][2], max(cell.points[1][2], max(cell.points[2][2], cell.points[3][2]))),
    );

    return pointInAABB(queryPoint, AABB(minVec, maxVec, 0u));
}

fn getContainingCell(queryPoint : vec3<f32>, leafNode : KDTreeNode) -> InterpolationCell {
    var cell : InterpolationCell;

    // check the cells in the leaf node found
    var cellsPtr = leafNode.leftPtr; // go to where cells are stored
    var foundCell = false;
    var cellID : u32;
    var i = 0u;
    loop {
        if (i >= leafNode.cellCount) {break;}
        // go through and check all the contained cells
        cellID = treeCells.buffer[cellsPtr + i];
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
        if(!pointInTetBounds(queryPoint, cell)) {
            i++;
            continue;
        }
        var tetFactors = pointInTetDet(queryPoint, cell);
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

fn getNearestDataValue(queryPoint : vec3<f32>, leafNode : KDTreeNode) -> f32 {
    var p0 = queryPoint;
    var cell : InterpolationCell;

    // check the cells in the leaf node found
    var cellsPtr = leafNode.leftPtr; // go to where cells are stored
    var cellID : u32;

    // minimum squared distance
    var minDistSq : f32;
    // value of closest point
    var closestVal : f32;

    var i = 0u;
    loop {
        if (i >= leafNode.cellCount) {break;}
        // go through and check all the contained cells
        cellID = treeCells.buffer[cellsPtr + i];
        // create a cell from the data

        // figure out if cell is inside using barycentric coords
        var pointsOffset : u32 = cellOffsets.buffer[cellID];
        var j = 0u;
        // read all the point positions
        loop {
            // get the coords of the point as an array 3
            var thisPointIndex = cellConnectivity.buffer[pointsOffset + j];
            cell.points[j] = vertexPositions.buffer[thisPointIndex];
            var p1 = cell.points[j];
            var dist = pow(p0[0] - p1[0], 2) + pow(p0[1] - p1[1], 2) + pow(p0[2] - p1[2], 2);
            if (
                (j == 0u && i == 0u) || 
                minDistSq > dist
            ) 
            {
                minDistSq = dist;
                closestVal = vertexData.buffer[cellConnectivity.buffer[pointsOffset + j]];
            }
            j++;
            if (j > 3u) {break;}
        }
        i++;
    }

    return closestVal;
}

// interpolate inside of a node as a hex cell
// id of the leaf node is stored in the val of the box
fn interpolateinNode(p : vec3<f32>, leafBox : AABB) -> f32 {
    var vals : array<f32, 8> = cornerValues.buffer[leafBox.val];
    // lerp in z direction
    var zFac = (p.z - leafBox.min.z)/(leafBox.max.z - leafBox.min.z);
    var zLerped = array(
        mix(vals[0], vals[4], zFac), // 00
        mix(vals[2], vals[6], zFac), // 01
        mix(vals[1], vals[5], zFac), // 10
        mix(vals[3], vals[7], zFac), // 11
    );
    // lerp in y direction
    var yFac = (p.y - leafBox.min.y)/(leafBox.max.y - leafBox.min.y);
    var yLerped = array(
        mix(zLerped[0], zLerped[1], yFac),
        mix(zLerped[2], zLerped[3], yFac)
    );
    // lerp in x direction
    var xFac = (p.x - leafBox.min.x)/(leafBox.max.x - leafBox.min.x);

    return mix(yLerped[0], yLerped[1], xFac);
}



// sampling unstructred mesh data
// have to traverse tree and interpolate within the cell
// returns -1 if point is not in a cell
fn sampleDataValue(x : f32, y: f32, z : f32) -> f32 {
    var queryPoint = vec3<f32>(x, y, z);

    var leafNode : KDTreeNode;
    var lastBox = lastLeavesBox[threadIndex];
    // look at the previous leaf node queried
    if (pointInAABB(queryPoint, lastBox)) {
        // still in last leaf
        var leafNode = treeNodes.buffer[lastBox.val];
    } else {
        // gone to new leaf
        var result = getContainingLeafNode(queryPoint);
        // cache the left node for the next sample along the ray
        leafNode = result.node;
        lastBox = result.box;
    }

    // sample the leaf depending on what type it is
    if (leafNode.cellCount > 0) {
        // true leaf, sample the cells within
        var cell : InterpolationCell = getContainingCell(queryPoint, leafNode);
        // interpolate value
        if (length(cell.factors) == 0) {
            return 0;
        };
        return dot(cell.values, cell.factors);
    } else {
        // pruned leaf, sample the node as a cell from its corner values
        if (passFlags.renderNodeVals) {
            return leafNode.splitVal;
        } else {
            return interpolateinNode(queryPoint, lastBox);
        }
    }

    
}

fn sampleNearestDataValue(x : f32, y : f32, z : f32) -> f32 {
    var queryPoint = vec3<f32>(x, y, z);

    var leafNode : KDTreeNode;
    var lastBox = lastLeavesBox[threadIndex];
    // look at the previous leaf node queried
    if (pointInAABB(queryPoint, lastBox)) {
        // still in last leaf
        var leafNode = treeNodes.buffer[lastBox.val];
    } else {
        // gone to new leaf
        var result = getContainingLeafNode(queryPoint);
        leafNode = result.node;
        lastBox = result.box;
    }

    return getNearestDataValue(queryPoint, leafNode);
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
    var aspect = camera.fovx / camera.fovy;
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

    passInfo = combinedPassInfo.passInfo;
    objectInfo = combinedPassInfo.objectInfo;
    globalInfo = combinedPassInfo.globalInfo;

    threadIndex = localIndex;
    if (threadIndex == 1u) {
        datasetBox = AABB(vec3<f32>(0), passInfo.dataSize, 0);
    }
    workgroupBarrier();

    var imageSize : vec2<u32> = textureDimensions(outputImage);
    // check if this thread is within the input image and on the mesh
    if (id.x > imageSize.x - 1 || id.y > imageSize.y - 1 || !pixelOnVolume(id.x, id.y)) {
        // outside the image
        return;
    }

    // get the flags governing this pass
    passFlags = getFlags(passInfo.flags);

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
    if (passFlags.showNodeVals) {
        // random from node location in buffer
        var dataPos : vec3<f32> = toDataSpace(ray.tip);
        var result : KDTreeResult = getContainingLeafNode(dataPos);
        // semi-random from node location
        setPixel(id.xy, vec4<f32>(vec3<f32>(result.node.splitVal/100), 1));
        return;
    }
    if (passFlags.showNodeLoc) {
        // random from node location in buffer
        var dataPos : vec3<f32> = toDataSpace(ray.tip);
        var result : KDTreeResult = getContainingLeafNode(dataPos);
        // semi-random col from node location
        setPixel(id.xy, vec4<f32>(u32ToCol(randomU32(result.box.val)), 1));
        return;
    }
    if (passFlags.showNodeDepth) {
        // random from node location in buffer
        var dataPos : vec3<f32> = toDataSpace(ray.tip);
        var result : KDTreeResult = getContainingLeafNode(dataPos);
        // semi-random from node location
        setPixel(id.xy, vec4<f32>(u32ToCol(randomU32(result.depth)), 1));
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
        // exponential
        // var t : f32 = exp2(-f32(passInfo.framesSinceMove)/10.0);

        // linear
        var t : f32 = 1 - f32(passInfo.framesSinceMove)/20.0;

        // square
        // var t : f32 = 1;
        // if (passInfo.framesSinceMove > 20) {
        //     t = 0;
        // }
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