// utils.wgsl
// contains struct definitions and functions that are common to multiple shaders

// structs ========================================================================================

// an automatically sized buffer of 3xf32 vals
struct PointsBuff {
    buffer: array<array<f32, 3>>,
};

// an automatically sized buffer of f32 vals
struct F32Buff {
    buffer : array<f32>,
};

// an automatically sized buffer of u32 vals
struct U32Buff {
    buffer : array<u32>,
};

// used for shading surfaces according to the phong model
struct Material {
    @size(16) diffuseCol : vec3<f32>,
    @size(16) specularCol : vec3<f32>,
    shininess : f32,
};

// a global light with colour and direction
struct DirectionalLight {
    colour : vec3<f32>,
    direction : vec3<f32>,
};

// information about the scene's camera
// 192 bytes in total
struct Camera {
    pMat : mat4x4<f32>,  // camera perspective matrix (viewport transform)
    mvMat : mat4x4<f32>, // camera view matrix
    @size(16) position : vec3<f32>,
    @size(16) upDirection : vec3<f32>,
    @size(16) rightDirection : vec3<f32>,
    fovy : f32,
    fovx : f32,
};

// common global information struct for all render passes
struct GlobalUniform {
    camera : Camera,
    time : u32, // time in ms
};

// specific info for the object being rendered
struct ObjectInfo {
    otMat : mat4x4<f32>, // object transform matrix
    frontMaterial : Material, // material for front facing frags
    backMaterial : Material // material for back facing frags
};

// general purpose ray struct
struct Ray {
    tip : vec3<f32>,
    direction : vec3<f32>,
    length : f32,
};


// functions ======================================================================================

// phong calculates the lighting for a fragment given a material and light according to the phong model
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
};

// returns a new Ray struct that has been extended by step in its direction
fn extendRay (ray : Ray, step : f32) -> Ray {
    var newRay = ray;
    newRay.length += step;
    newRay.tip += newRay.direction*step;
    return newRay;
}

// colour blending function rgba + rgba -> rgba
fn over (colA : vec4<f32>, colB : vec4<f32>) -> vec4<f32> {
    var outCol : vec4<f32>;
    outCol.a = colA.a + colB.a * (1 - colA.a);
    outCol.r = (colA.r * colA.a + colB.r * colB.a * (1 - colA.a))/outCol.a;
    outCol.g = (colA.g * colA.a + colB.g * colB.a * (1 - colA.a))/outCol.a;
    outCol.b = (colA.b * colA.a + colB.b * colB.a * (1 - colA.a))/outCol.a;

    return outCol;
}

// returns a random u32 starting from a seed value
fn randomU32(seed : u32) -> u32 {
    var x = seed;
    var i = 0u;
    // do xorshift 32 a few times on the seed
    loop {
        if (i > 2u) {break;}
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        i++;
    }
    return x;
}

fn scalarTriple(a : vec3<f32>, b : vec3<f32>, c : vec3<f32>) -> f32 {
    return dot(a, cross(b, c));
}