// rayMarchCompute.wgsl
// performs ray marching but in a compute shader

// imports
{{utils.wgsl}}
{{rayMarchUtils.wgsl}}

struct CombinedPassInfo {
    @size(208) globalInfo : GlobalUniform,
    @size(160) objectInfo : ObjectInfo,
    @size(180) passInfo : RayMarchPassInfo,
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

// mesh geometry information
@group(1) @binding(0) var<storage, read> treeNodes : TreeNodesBuff;
@group(1) @binding(1) var<storage, read> treeCells : U32Buff; 
// positions of each of the vertices in the mesh
@group(1) @binding(2) var<storage, read> vertexPositions : PointsBuff;
// what verts make up each cell, indexes into vertexPositions 
@group(1) @binding(3) var<storage, read> cellConnectivity : U32Buff;
// where the vert index list starts for each cell, indexes into cellConnectivity
@group(1) @binding(4) var<storage, read> cellOffsets : U32Buff;
// the types of each cell i.e. how many verts it has
// @group(1) @binding(6) var<storage> cellTypes : U32Buff;

// data values
// vertex centred data arrays
@group(2) @binding(0) var<storage, read> vertexDataA : F32Buff;
@group(2) @binding(1) var<storage, read> vertexDataB : F32Buff;
// sampled values for the corners of the node bounding boxes in the tree
@group(2) @binding(2) var<storage, read> cornerValuesA : CornerValuesBuff;
@group(2) @binding(3) var<storage, read> cornerValuesB : CornerValuesBuff;



// images
// input image f32, the distance to suface from the camera position, if outside, depth is 0
// if the depth is to the backside of a tri (viewing from inside) depth is negative
@group(3) @binding(0) var boundingVolDepthImage : texture_2d<f32>;
// two textures used to hold the last best result and write the new best result too
// previous best results
@group(3) @binding(1) var offsetOptimisationTextureOld : texture_2d<f32>;
// a texture to write the best results too
@group(3) @binding(2) var offsetOptimisationTextureNew : texture_storage_2d<rg32float, write>;
// output image after ray marching into volume
@group(3) @binding(3) var outputImage : texture_storage_2d<bgra8unorm, write>;


struct KDTreeResult {
    node : KDTreeNode,
    box : AABB,
    depth : u32,
}

struct InterpolationCell {
    points : array<array<f32, 3>, 4>,
    values : vec4<f32>,
    factors : vec4<f32>,
    valid : bool, // wether the sample actually found a cell or not
};

struct Sample {
    value : f32,
    valid : bool
};

struct CellTestResult {
    factors : vec4<f32>,
    inside : bool
}

// used to keep a track of the last leaves sampled
var<workgroup> lastLeafNodes : array<KDTreeNode, {{WGVol}}>;
var<workgroup> lastLeafBoxes : array<AABB, {{WGVol}}>;

var<workgroup> datasetBox : AABB;
var<workgroup> passInfo : RayMarchPassInfo;
var<workgroup> passFlags : RayMarchPassFlags;

var<private> threadIndex : u32;
var<private> globalInfo : GlobalUniform;
var<private> objectInfo : ObjectInfo;

// cached results between sample points
// var<private> lastLeafNode : KDTreeNode;
// var<private> lastLeafBox : AABB;


// returns the lowest node in the tree which contains the query point
fn getContainingLeafNode(queryPoint : vec3<f32>) -> KDTreeResult {
    // traverse the data tree (kdtree) to find the correct leaf node
    var depth : u32 = 0u;
    var splitDimension : u32 = 0u;
    var currNodePtr : u32 = 0u;
    var currNode : KDTreeNode = treeNodes.buffer[0];
    var box : AABB = datasetBox;

    while (currNode.rightPtr != 0) {
        if (queryPoint[splitDimension] <= currNode.splitVal) {
            box.max[splitDimension] = currNode.splitVal;
            currNodePtr = currNode.leftPtr;
        } else {
            box.min[splitDimension] = currNode.splitVal;
            currNodePtr = currNode.rightPtr;
        }
        currNode = treeNodes.buffer[currNodePtr];
        box.val = currNodePtr;
        depth++;
        splitDimension = depth % 3;
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
fn pointInTetDet(queryPoint : vec3<f32>, cell : InterpolationCell) -> CellTestResult {
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

    return CellTestResult(
        vec4<f32>(lambda1, lambda2, lambda3, lambda4)/vol,
        (lambda1 <= 0 && lambda2 <= 0 && lambda3 <= 0 && lambda4 <= 0) || (lambda1 >= 0 && lambda2 >= 0 && lambda3 >= 0 && lambda4 >= 0)
    );
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


fn getContainingCell(queryPoint : vec3<f32>, leafNode : KDTreeNode, dataSrc : u32) -> InterpolationCell {
    var cell : InterpolationCell;

    var cellTest : CellTestResult;

    // check the cells in the leaf node found
    var cellsPtr = leafNode.leftPtr; // go to where cells are stored
    var foundCell = false;
    var cellID : u32;
    var pointsOffset : u32;
    for (var i = 0u; i < leafNode.cellCount; i++) {

        // go through and check all the contained cells
        cellID = treeCells.buffer[cellsPtr + i];

        // figure out if cell is inside using barycentric coords
        pointsOffset = cellOffsets.buffer[cellID];
        cell.points[0] = vertexPositions.buffer[cellConnectivity.buffer[pointsOffset + 0]];
        cell.points[1] = vertexPositions.buffer[cellConnectivity.buffer[pointsOffset + 1]];
        cell.points[2] = vertexPositions.buffer[cellConnectivity.buffer[pointsOffset + 2]];
        cell.points[3] = vertexPositions.buffer[cellConnectivity.buffer[pointsOffset + 3]];

        // check cell bounding box
        if (pointInTetBounds(queryPoint, cell)) {
            cellTest = pointInTetDet(queryPoint, cell);
            cell.factors = cellTest.factors;
            cell.valid = cellTest.inside;
        }

        if (cell.valid) {break;}
    }

    if (cell.valid) {
        switch (dataSrc) {
            case DATA_SRC_VALUE_A, default {
                cell.values[0] = vertexDataA.buffer[cellConnectivity.buffer[pointsOffset + 0]];
                cell.values[1] = vertexDataA.buffer[cellConnectivity.buffer[pointsOffset + 1]];
                cell.values[2] = vertexDataA.buffer[cellConnectivity.buffer[pointsOffset + 2]];
                cell.values[3] = vertexDataA.buffer[cellConnectivity.buffer[pointsOffset + 3]];
            }
            case DATA_SRC_VALUE_B {
                cell.values[0] = vertexDataB.buffer[cellConnectivity.buffer[pointsOffset + 0]];
                cell.values[1] = vertexDataB.buffer[cellConnectivity.buffer[pointsOffset + 1]];
                cell.values[2] = vertexDataB.buffer[cellConnectivity.buffer[pointsOffset + 2]];
                cell.values[3] = vertexDataB.buffer[cellConnectivity.buffer[pointsOffset + 3]];
            }
        }
    }

    return cell;
}



// interpolate inside of a node as a hex cell
// id of the leaf node is stored in the val of the box
fn interpolateinNode(p : vec3<f32>, leafBox : AABB, dataSrc : u32) -> f32 {
    var vals : array<f32, 8>;
    switch (dataSrc) {
        case DATA_SRC_VALUE_A, default {
            vals = cornerValuesA.buffer[leafBox.val];
        }
        case DATA_SRC_VALUE_B {
            vals = cornerValuesB.buffer[leafBox.val];
        }
    }
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
fn sampleDataValue(x : f32, y: f32, z : f32, dataSrc : u32) -> f32 {
    switch (dataSrc) {
        case DATA_SRC_AXIS_X {return x;}
        case DATA_SRC_AXIS_Y {return y;}
        case DATA_SRC_AXIS_Z {return z;}
        default {}
    }

    var queryPoint = vec3<f32>(x, y, z);

    var currLeafNode : KDTreeNode;
    var currLeafBox : AABB;

    // look at the previous leaf nodes found
    if (pointInAABB(queryPoint, lastLeafBoxes[threadIndex])) {
        currLeafNode = lastLeafNodes[threadIndex];
        currLeafBox = lastLeafBoxes[threadIndex];
    } else {
        // gone to new leaf
        var result = getContainingLeafNode(queryPoint);
        currLeafNode = result.node;
        currLeafBox = result.box;
        // cache the leaf node for the next sample along the ray
        lastLeafNodes[threadIndex] = result.node;
        lastLeafBoxes[threadIndex] = result.box;
    }

    var sampleVal : f32;

    if (passFlags.showTestedCells) {
        sampleVal =  f32(currLeafNode.cellCount);
    } else if (currLeafNode.cellCount > 0) {
        // sample the leaf depending on what type it is
        // true leaf, sample the cells within
        var cell : InterpolationCell = getContainingCell(queryPoint, currLeafNode, dataSrc);
        // interpolate value
        if (!cell.valid) {
            sampleVal = F32_OUTSIDE_CELLS;
        } else {
            sampleVal =  dot(cell.values, cell.factors);
        }
    } else if (passFlags.renderNodeVals) {
        // pruned leaf, sample the node as a cell from its corner values
        sampleVal = currLeafNode.splitVal;
    } else {
        sampleVal = interpolateinNode(queryPoint, currLeafBox, dataSrc);
    }

    return sampleVal;
    
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
    return pixVal > 0;
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
    ray.length = 0.0;
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
    passFlags = getFlags(passInfo.flags);

    datasetBox = passInfo.dataBox;
    threadIndex = localIndex;
    workgroupBarrier();

    // A NEW ==========================================================

    // var imageSize : vec2<u32> = textureDimensions(outputImage);
    // // check if this thread is within the input image and on the mesh
    // if (id.x > imageSize.x - 1 || id.y > imageSize.y - 1) {
    //     // outside the image
    //     return;
    // }

    // // calculate the world position of the starting fragment
    // var ray = getRay(id.x, id.y, globalInfo.camera);

    // var dataIntersect : RayIntersectionResult = intersectAABB(ray, datasetBox);

    // if (dataIntersect.tNear > dataIntersect.tFar) {
    //     // ray doesnt intersect dataset bounding box
    //     return;
    // }

    // // extend to the closest touch of bounding box
    // // extendRay(ray, max(0, dataIntersect.tNear + 0.1));
    // var startInside = true;

    // B OLD ===========================================================

    var imageSize : vec2<u32> = textureDimensions(outputImage);
    // check if this thread is within the input image and on the mesh
    if (id.x > imageSize.x - 1 || id.y > imageSize.y - 1 || !pixelOnVolume(id.x, id.y)) {
        // outside the image
        return;
    }

    // calculate the world position of the starting fragment
    var ray = getRay(id.x, id.y, globalInfo.camera);

    var startInside = false;

    if (isFrontFacing(id.x, id.y)) {
        var depthVal : f32 = textureLoad(boundingVolDepthImage, id.xy, 0)[0];
        ray = extendRay(ray, depthVal + 0.01); // nudge the start just inside
        startInside = true;
    }

    // ===========================================================================



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
    



    var seed : u32 = (wgid.x << 12) ^ (wgid.y << 8) ^ (id.x << 4) ^ (id.y) ^ 782035u;

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

    // do ray-marching step
    if (passInfo.isoSurfaceSrc != DATA_SRC_NONE) {
        marchResult = marchRay(passFlags, passInfo, ray, passInfo.dataBox, startInside, offset);
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
    } else {
        setPixel(id.xy, outCol);
    }
}