struct VertexOut {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) worldPosition : vec4<f32>,
    @location(1) eye : vec3<f32>,    
};

struct Camera {
    pMat : mat4x4<f32>,  // camera perspective matrix (viewport transform)
    mvMat : mat4x4<f32>, // camera view matrix
    @size(16) position : vec3<f32>,
    @size(16) upDirection : vec3<f32>,
    @size(16) rightDirection : vec3<f32>,
    verticalFOV : f32,
    horizontalFOV : f32,
};

// common to all passes
struct GlobalUniform {
    camera : Camera,
    time : u32, // time in ms
};

// specific info for this object
struct ObjectInfo {
    otMat : mat4x4<f32>,      // object transform matrix
    frontMaterial : Material,
    backMaterial : Material,
};

struct PassInfo {
    flags : u32,
    threshold : f32,
    dataLowLimit : f32,
    dataHighLimit : f32,
    stepSize : f32,
    maxLength : f32,
    cellsInLeaves : u32,
    @align(16) dMatInv : mat4x4<f32>, // from world space -> data space
};

// struct 
struct PointsBuff {
    buffer: array<array<3, f32>>,
};

struct F32Buff {
    buffer : array<f32>,
};
struct U32Buff {
    buffer : array<u32>,
};

struct KDTreeNode {
    splitDimension : u32,
    splitVal : f32,
    leaf : i32,           // -1 if not a leaf node
    leftPtr : u32,
    rightPtr : u32,
}


// data common to all rendering
// camera mats, position
@group(0) @binding(0) var<storage> globalInfo : GlobalUniform;
//  object matrix, colours
@group(0) @binding(1) var<storage> objectInfo : ObjectInfo;

// ray marching data
// threshold, data matrix, march parameters
@group(1) @binding(0) var<storage> passInfo : PassInfo;
// data tree, leaves contain a list of intersecting cells
@group(1) @binding(1) var<storage> dataTree : U32Buff; 
// positions of each of the vertices in the mesh
@group(1) @binding(2) var<storage> vertexPositions : PointsBuff;
// what verts make up each cell, indexes into vertexPositions 
@group(1) @binding(3) var<storage> cellConnectivity : U32Buff;
// where the vert index list starts for each cell, indexes into cellConnectivity
@group(1) @binding(4) var<storage> cellOffsets : U32Buff;
// the types of each cell i.e. how many verts it has
@group(1) @binding(5) var<storage> cellTypes : U32Buff;
// the data values associated with each vertex
@group(1) @binding(6) var<storage> vertexData : F32Buff;

// images
// input image f32, the distance to suface from the camera position, if outside, depth is -1
@group(2) @binding(0) var boundingVolDepthImage : texture_2d<f32>;
// output image after ray marching into volume
@group(2) @binding(1) var outputImage : texture_storage_2d<rgba32float, write>;


struct PassFlags {
    phong : bool,
    backStep : bool,
    showNormals : bool,
    showVolume : bool,
    fixedCamera : bool
};

struct Ray {
    tip : vec3<f32>,
    direction : vec3<f32>,
    length : f32,
};

struct Material {
    @size(16) diffuseCol : vec3<f32>,
    @size(16) specularCol : vec3<f32>,
    shininess : f32,
};

struct DirectionalLight {
    colour : vec3<f32>,
    direction : vec3<f32>,
};

fn allZero8(a : array<8, f32>) -> bool {
    if (
        a[0] == 0 &&
        a[1] == 0 &&
        a[2] == 0 &&
        a[3] == 0 &&
        a[4] == 0 &&
        a[5] == 0 &&
        a[6] == 0 &&
        a[7] == 0
    ) {
        return true;
    } else {
        return false;
    }
}

fn normalFlagSet(flagUint : u32) -> bool {
    return (flagUint & 1u) == 1u;
}

fn getFlags(flagUint : u32) -> PassFlags {
    return PassFlags(
        (flagUint & 1u) == 1u,
        (flagUint & 2u) == 2u,
        (flagUint & 4u) == 4u,
        (flagUint & 8u) == 8u,
        (flagUint & 16u) == 16u,
    );
}

// load a specific value
fn getDataValue(x : u32, y : u32, z : u32) -> f32 {
    return textureLoad(data, vec3<u32>(x, y, z), 0)[0];
}

fn getCellPointsCount(cellType : u32) -> u32 {
    switch cellType {
        case 10u {return 4u} // tet
        case 12u {return 8u} // hexa
        case 5u  {return 3u} // tri
        default  {return 4u}
    }
}

// returns the barycentric coords if inside and all 0 if outside
fn pointInTet(x : f32, y : f32, z : f32, cellID : i32) -> vec4<f32> {
    // figure out if cell is inside using barycentric coords
    var pointsOffset : u32 = cellOffsets[cellID];
    var cellPoints : array<4, array<3, f32>>;
    var i = 0u;
    // read all the point positions
    loop {
        // get the coords of the point as an array 3
        var thisPointIndex = cellConnectivity.buffer[pointsOffset + i];
        cellPoints[i] = vertexPositions[thisPointIndex];
        i++;
        if (i > 4u) {break;}
    }
    // compute the barycentric coords for the point
    var p = cellPoints;
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

    if (lambda1 <= 0 && lambda2 <= 0 && lambda3 <= 0 ) {
        return -1.0*vec4<f32>(lambda1, lambda2, lambda3, lambda4);
    } else if (lambda1 >= 0 && lambda2 >= 0 && lambda3 >= 0) {
        return vec4<f32>(lambda1, lambda2, lambda3, lambda4);
    } else {
        // not in this cell
        return vec4<f32>(0);
    }

}

fn interpolateInCell(sampleFactors : array<8, f32>, cellID : i32) -> f32 {
    var lerpValue = 0u;
    // figure out if cell is inside using barycentric coords
    var pointsOffset : u32 = cellOffsets[cellID];
    var cellPoints : array<4, array<3, f32>>;
    var i = 0u;
    // read all the point positions
    loop {
        // get the coords of the point as an array 3
        var thisPointIndex = cellConnectivity.buffer[pointsOffset + i];
        lerpValue += vertexData[thisPointIndex] * sampleFactors[i];
        i++;
        if (i > 8u) {break;}
    }
}



// sampling unstructred mesh data
// have to traverse tree and interpolate within the cell
// returns -1 if point is not in a cell
fn sampleDataValue(x : f32, y: f32, z : f32) -> f32 {
    var queryPoint = vec3<f32>(x, y, z);
    var treeBuffer = dataTree.buffer;


    // traverse the data tree (kdtree) to find the correct leaf node
    var currNodePtr = 0;
    var currNode : KDTreeNode;
    loop {
        // make a node at the current position
        currNode = KDTreeNode(
                         treeBuffer[currNodePtr],
            bitcast<f32>(treeBuffer[currNodePtr + 1]),
            bitcast<i32>(treeBuffer[currNodePtr + 2]),
                         treeBuffer[currNodePtr + 3],
                         treeBuffer[currNodePtr + 4],

        );
        if (currNode.leaf == -1) {
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

    // check the cells in the leaf node found
    var cellsPtr = currNodePtr.leaf; // go to where cells are stored
    var sampleFactors : array<8, f32>(0);
    var foundCell = false;
    var cellID : i32;
    var i = 0u;
    loop {
        // go through and check all the contained cells
        cellID = bitcast<i32>(treeBuffer[cellsPtr + i]);
        if (cellID == -1) {break;} // there are less than the max # cells in this leaf
        var pointsCount : u32 = getCellPointsCount(cellTypes.buffer[cellID]);

        sampleFactors = array<8, f32>(0);
        switch pointsCount {
            case 4 {
                // cell is a tetrahedron
                var tetFactors = pointInTet(x, y, z, cellID);
                sampleFactors[0] = tetFactors[0];
                sampleFactors[1] = tetFactors[1];
                sampleFactors[2] = tetFactors[2];
                sampleFactors[3] = tetFactors[3];
            }
            default {
                // this kind of cell is not supported currently
            }
        }

        if (allZero8(sampleFactors)) {
            // found a cell that contains the sample point
            foundCell = true;
            break;
        }
        
        i++;
        if (i > passInfo.cellsInLeaves) {break;}
    }

    // interpolate value
    if (!foundCell) {return -1.0} 
    return interpolateInCell(sampleFactors, cellID);

}

// recovers the normal (gradient) of the data at the given point
fn getDataNormal (x : f32, y : f32, z : f32) -> vec3<f32> {
    var epsilon : f32 = 0.1;
    var gradient : vec3<f32>;
    var p0 = sampleDataValue(x, y, z);
    if (x > epsilon) {
        gradient.x = -(p0 - sampleDataValue(x - epsilon, y, z))/epsilon;
    } else {
        gradient.x = (p0 - sampleDataValue(x + epsilon, y, z))/epsilon;
    }
    if (y > epsilon) {
        gradient.y = -(p0 - sampleDataValue(x, y - epsilon, z))/epsilon;
    } else {
        gradient.y = (p0 - sampleDataValue(x, y + epsilon, z))/epsilon;
    }
    if (z > epsilon) {
        gradient.z = -(p0 - sampleDataValue(x, y, z - epsilon))/epsilon;
    } else {
        gradient.z = (p0 - sampleDataValue(x, y, z + epsilon))/epsilon;
    }
    return normalize(gradient);
}

fn phong (material: Material, normal: vec3<f32>, eye: vec3<f32>, light: DirectionalLight) -> vec3<f32> {
    var diffuseFac = max(dot(normal, -light.direction), 0.0);
    
    var diffuse : vec3<f32>;
    var specular : vec3<f32>;
    var ambient : vec3<f32> = material.diffuseCol*0.1;
    
    var reflected : vec3<f32>;

    if (diffuseFac > 0.0) {
        // facing towards the light
        diffuse = material.diffuseCol * light.colour * diffuseFac;

        reflected = reflect(light.direction, normal);
        var specularFac : f32 = pow(max(dot(reflected, eye), 0.0), material.shininess);
        specular = material.specularCol * light.colour * specularFac;
    }
    return diffuse + specular + ambient;
}

fn extendRay (ray : Ray, step : f32) -> Ray {
    var newRay = ray;
    newRay.length += step;
    newRay.tip += newRay.direction*step;
    return newRay;
}

fn over (colA : vec4<f32>, colB : vec4<f32>) -> vec4<f32> {
    var outCol : vec4<f32>;
    outCol.a = colA.a + colB.a * (1 - colA.a);
    outCol.r = (colA.r * colA.a + colB.r * colB.a * (1 - colA.a))/outCol.a;
    outCol.g = (colA.g * colA.a + colB.g * colB.a * (1 - colA.a))/outCol.a;
    outCol.b = (colA.b * colA.a + colB.b * colB.a * (1 - colA.a))/outCol.a;

    return outCol;
}

fn accumulateSampleCol(sample : f32, length : f32, prevCol : vec3<f32>, lowLimit : f32, highLimit : f32, threshold : f32) -> vec3<f32> {
    var normalisedSample = (sample - lowLimit)/(highLimit - lowLimit);
    var normalisedThreshold = (threshold - lowLimit)/(highLimit - lowLimit);
    var absorptionCoeff = pow(normalisedSample/3, 1.3);
    var sampleCol = absorptionCoeff * vec3<f32>(1.0) * length; // transfer function
    
    return prevCol + sampleCol;
}

fn setPixel(x : u32, y : u32, col : vec4<f32>) {

}

fn pixelOnVolume(x : u32, y : u32) -> bool {
    var pixVal :u32 = textureLoad(boundingVolMaskImage, vec2<u32>(x, y), 0)[0];
    return pixVal > 0u;
}

// takes camera and x
fn getRay(x : u32, y : u32, camera : Camera) -> Ray {
    // jobs petrol yee shugar treez glorious food hot sausage and mustard while were in the mood something in the custard.
    var raySegment = fragInfo.worldPosition.xyz - cameraPos;
    var ray : Ray;
    ray.direction = normalize(raySegment);
    ray.tip = cameraPos;
    ray.length = 0;

    return ray
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
    // check if this thread is within the input image
    if (id.x > imageSize.x - 1 || id.y > imageSize.y - 1) {
        // outside the image
        return;
    }
    // check if this fragment is on the bounding box
    if (!pixelOnVolume(id.x, id.y)) {
        // not on the bounding box, set blank pixel
        setPixel(id.x, id.y, vec4<f32>(0));
        return;
    }

    var passFlags = getFlags(passInfo.flags);

    var e = 2.71828;

    var fragCol = vec4<f32>(1, 1, 1, 0);

    var cameraPos : vec3<f32>;
    if (passFlags.fixedCamera) {
        cameraPos = vec3<f32>(600, 600, 600); 
    } else {
        cameraPos = globalInfo.cameraPos;
    }

    // calculate the world position of the starting fragment
    var ray = getRay()


    var light = DirectionalLight(vec3<f32>(1), ray.direction);

    // accumulated ray casting colour from samples
    var volCol : vec3<f32>;

    // march the ray
    var lastAbove = false;
    var lastSampleVal : f32;
    var lastStepSize : f32;
    var sampleVal : f32;
    var thisAbove = false;
    var i = 0u;
    loop {
        if (ray.length > passInfo.maxLength) {
            break;
        }
        var tipDataPos = ray.tip;//(passInfo.dMatInv * vec4<f32>(ray.tip, 1.0)).xyz; // the tip in data space
        // check if tip has left data
        if (
            ray.tip.x > dataSize.x || ray.tip.x < 0 ||
            ray.tip.y > dataSize.y || ray.tip.y < 0 ||
            ray.tip.z > dataSize.z || ray.tip.z < 0
        ) {
            // have gone all the way through the dataset
            if (enteredDataset) {
                break;
            }
        } else {
            enteredDataset = true;
            sampleVal = sampleDataValue(tipDataPos.x, tipDataPos.y, tipDataPos.z);
            if (sampleVal > passInfo.threshold) {
                thisAbove = true;
            } else {
                thisAbove = false;
            }
            if (i > 0u) {
                // check if the threshold has been crossed
                if (thisAbove != lastAbove) {
                    // has been crossed
                    if (passFlags.backStep) {
                        // find where exactly by lerp
                        var backStep = lastStepSize/(sampleVal-lastSampleVal) * (sampleVal - passInfo.threshold);
                        ray = extendRay(ray, -backStep);
                        tipDataPos = ray.tip;
                    }

                    // set the material
                    var material : Material;
                    var normalFac = 1.0;
                    if (thisAbove && !lastAbove) {
                        // crossed going up the values
                        material = objectInfo.frontMaterial;
                    } else if (!thisAbove && lastAbove) {
                        // crossed going down the values
                        material = objectInfo.backMaterial;
                        normalFac = -1.0;
                    }

                    if (passFlags.showNormals) {
                        fragCol = vec4<f32>(getDataNormal(tipDataPos.x, tipDataPos.y, tipDataPos.z), 1.0);
                        // fragCol = vec4<f32>(1, 0, 0, 1.0);
                    } else if (passFlags.phong) {
                        var normal = getDataNormal(tipDataPos.x, tipDataPos.y, tipDataPos.z);
                        fragCol = vec4<f32>(phong(material, normalFac * normal, -ray.direction, light), 1.0);
                    } else {
                        fragCol = vec4<f32>(material.diffuseCol*ray.length/1000, 1.0);
                    }
                    break;
                }

                if (passFlags.showVolume) {
                    // acumulate colour
                    volCol = accumulateSampleCol(sampleVal, lastStepSize, volCol, passInfo.dataLowLimit, passInfo.dataHighLimit, passInfo.threshold);
                }
            }
        }
        
        continuing {
            var thisStepSize = passInfo.stepSize;
            ray = extendRay(ray, passInfo.stepSize);
            lastAbove = thisAbove;
            lastSampleVal = sampleVal;
            lastStepSize = passInfo.stepSize;
            i += 1u;
        }
    }

    if (passFlags.showVolume) {
        // do the over operation
        var absorption = vec3<f32>(
            pow(e, -volCol.r),
            pow(e, -volCol.g),
            pow(e, -volCol.b),
        );
        fragCol = vec4<f32>(
            fragCol.r * absorption.r,
            fragCol.g * absorption.g,
            fragCol.b * absorption.b,
            max(fragCol.a, max(1-absorption.r, max(1-absorption.g, 1-absorption.b)))
        );
    }

    return fragCol;

}