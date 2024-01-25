// rayMarchCompute.wgsl
// performs ray marching but in a compute shader

// imports
{{utils.wgsl}}
{{rayMarchUtils.wgsl}}

// data common to all rendering
// camera mats, position
@group(0) @binding(0) var<storage, read> globalInfo : GlobalUniform;
//  object matrix, colours
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
// output image after ray marching into volume
@group(2) @binding(1) var outputImage : texture_storage_2d<bgra8unorm, write>;


struct KDTreeNode {
    splitDimension : u32,
    splitVal : f32,
    cellCount: u32,
    leaf : u32,           // -1 if not a leaf node
    leftPtr : u32,
    rightPtr : u32,
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
        if (currNode.cellCount == 0) {
            // have to carry on down the tree
            if (queryPoint[currNode.splitDimension] <= currNode.splitVal) {
                currNodePtr = currNode.leftPtr;
            } else {
                currNodePtr = currNode.rightPtr;
            }
        } else {
            // got to the bottom
            break;
        }
    }

    return currNode;
}

// returns the barycentric coords if inside and all 0 if outside
fn pointInTet(queryPoint : vec3<f32>, cell : InterpolationCell) -> vec4<f32> {
    var x = queryPoint.x;
    var y = queryPoint.y;
    var z = queryPoint.z;
    var p = cell.points;
    // compute the barycentric coords for the point
    var lambda1 = 1/6*determinant(mat4x4<f32>(
        1,       1,       1,       1,
        p[0][0], p[1][0], p[2][0], x,
        p[0][1], p[1][1], p[2][1], y,
        p[0][2], p[1][2], p[2][2], z,
    ));

    var lambda2 = 1/6*determinant(mat4x4<f32>(
        1,       1,       1,      1,
        p[0][0], p[1][0], x,      p[3][0],
        p[0][1], p[1][1], y,      p[3][1],
        p[0][2], p[1][2], z,      p[3][2],
    ));

    var lambda3 = 1/6*determinant(mat4x4<f32>(
        1,       1,       1,      1,
        p[0][0], x,       p[2][0], p[3][0],
        p[0][1], y,       p[2][1], p[3][1],
        p[0][2], z,       p[2][2], p[3][2],
    ));

    var lambda4 = 1/6*determinant(mat4x4<f32>(
        1,       1,       1,      1,
        x,       p[1][0], p[2][0], p[3][0],
        y,       p[1][1], p[2][1], p[3][1],
        z,       p[1][2], p[2][2], p[3][2],
    ));

    if (lambda1 <= 0 && lambda2 <= 0 && lambda3 <= 0 && lambda4 <= 0) {
        return -1.0*vec4<f32>(lambda1, lambda2, lambda3, lambda4);
    } else if (lambda1 > 0 && lambda2 > 0 && lambda3 > 0 && lambda4 > 0) {
        return vec4<f32>(lambda1, lambda2, lambda3, lambda4);
    } else {
        // not in this cell
        return vec4<f32>(0);
    }

}

fn getContainingCell(queryPoint : vec3<f32>, leafNode : KDTreeNode) -> InterpolationCell {
    var cell : InterpolationCell;

    // check the cells in the leaf node found
    var cellsPtr = leafNode.leaf; // go to where cells are stored
    var foundCell = false;
    var cellID : i32;
    var i = 0u;
    loop {
        if (i >= leafNode.cellCount) {break;}
        // go through and check all the contained cells
        cellID = bitcast<i32>(dataTree.buffer[cellsPtr + i]);
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
            if (j > 4u) {break;}
        }

        // cell is a tetrahedron
        var tetFactors = pointInTet(queryPoint, cell);
        
        if (length(tetFactors) != 0) {
            // found the correct cell
            // extract the cell values
            cell.values[0] = vertexData.buffer[cellConnectivity.buffer[pointsOffset + 0]];
            cell.values[1] = vertexData.buffer[cellConnectivity.buffer[pointsOffset + 1]];
            cell.values[2] = vertexData.buffer[cellConnectivity.buffer[pointsOffset + 2]];
            cell.values[3] = vertexData.buffer[cellConnectivity.buffer[pointsOffset + 3]];

            cell.factors = tetFactors;
            break;
        }
        i++;
    }
    return cell;
}


// sampling unstructred mesh data
// have to traverse tree and interpolate within the cell
// returns -1 if point is not in a cell
fn sampleDataValue(x : f32, y: f32, z : f32) -> f32 {
    return 5;
    var queryPoint = vec3<f32>(x, y, z);


    var leafNode : KDTreeNode = getContainingLeafNode(queryPoint);

    var cell : InterpolationCell = getContainingCell(queryPoint, leafNode);

    // interpolate value
    if (length(cell.factors) == 0) {
        return 0;
    };
    return dot(cell.values, cell.factors);
}


fn setPixel(coords : vec2<u32>, col : vec4<f32>) {
    textureStore(outputImage, coords, col);
}

fn pixelOnVolume(x : u32, y : u32) -> bool {
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
    var aspect = camera.fovx/camera.fovy;
    var unormRay = fwd 
        + xProp*tan(camera.fovy/2)*aspect*normalize(camera.rightDirection) 
        - yProp*tan(camera.fovy/2)*normalize(camera.upDirection);
    ray.direction = normalize(unormRay);
    ray.tip = camera.position;
    ray.length = 0;
    return ray;
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
    if (id.x > imageSize.x - 1 || id.y > imageSize.y - 1 ){//|| !pixelOnVolume(id.x, id.y)) {
        // outside the image
        return;
    }

    var depthVal : f32 = textureLoad(boundingVolDepthImage, id.xy, 0)[0];

    // setPixel(id.xy, vec4<f32>(depthVal, 0, 0, 1));

    // get the flags governing this pass
    var passFlags : RayMarchPassFlags = getFlags(passInfo.flags);
    // calculate the world position of the starting fragment
    var ray = getRay(id.x, id.y, globalInfo.camera);

    // ray = extendRay(ray, depthVal);
    if (passFlags.showRayDirs) {
        setPixel(id.xy, vec4<f32>(ray.direction, 1));
        return;
    }

    // march the ray through the volume
    var fragCol = marchRay(passFlags, passInfo, ray, passInfo.dataSize, false, 0);

    setPixel(id.xy, fragCol);
}