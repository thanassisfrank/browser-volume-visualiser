struct VertexOut {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) worldPosition : vec4<f32>,
    @location(1) eye : vec3<f32>,    
};

// common to all passes
struct GlobalUniform {
    pMat : mat4x4<f32>,  // camera perspective matrix (viewport transform)
    mvMat : mat4x4<f32>, // camera view matrix
    @size(16) cameraPos : vec3<f32>,
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
@group(1) @binding(2) var<storage> vertexPositions : F32Buff;
// what verts make up each cell, indexes into vertexPositions 
@group(1) @binding(3) var<storage> cellConnectivity : U32Buff;
// where the vert index list starts for each cell, indexes into cellConnectivity
@group(1) @binding(4) var<storage> cellOffsets : U32Buff;
// the types of each cell i.e. how many verts it has
@group(1) @binding(5) var<storage> cellTypes : U8Buff;

// images
// input image, rgb encodes xyz of fragment, a indicates if the dataset is missed
@group(2) @binding(0) var fragmentPositions : texture_2d<f32>;
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

// sampler not available for f32 -> do own lerp
fn sampleDataValue(x : f32, y: f32, z : f32) -> f32 {
    var queryPoint = vec3<f32>(x, y, z);
    var treeBuffer = dataTree.buffer;


    // traverse the data tree (kdtree) to find the correct leaf node
    var currNodePtr = 0;
    var currNode = KDTreeNode();
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
    var cellsPtr = currNodePtr + 5;
    var i = 0u;
    loop {
        // go through and check all the contained cells
        
        i++;
        if (i > passInfo.cellsInLeaves) {break;}
    }

    // interpolate value
    var val = 0;
    return val;

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


// workgroups work on 2d tiles of the input image
@compute @workgroup_size({{WGSizeX}}, {{WGSizeY}}, 1)
fn main(
    @builtin(global_invocation_id) id : vec3<u32>,
    @builtin(local_invocation_index) localIndex : u32,
    @builtin(workgroup_id) wgid : vec3<u32>,
    @builtin(num_workgroups) wgnum : vec3<u32>
) {  
    var imageSize = textureDimensions(fragmentPositions);
    // check if this thread is within the data or not

}