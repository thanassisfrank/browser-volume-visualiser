struct Uniform {
    pMat : mat4x4<f32>,  // perspective projection
    mvMat : mat4x4<f32>, // camera view matrix
    @size(16) cameraPos : vec3<f32>, // camera position in world space
};

// specific info for this object
struct ObjectInfo {
    otMat : mat4x4<f32>, // object transform matrix
    frontMaterial : Material,
    backMaterial : Material
}

struct VertexOut {
    @builtin(position) position : vec4<f32>,
    @location(0) normal : vec3<f32>,
    @location(1) eye : vec3<f32>,
    @location(2) worldPos : vec3<f32>,
};

struct DirectionalLight {
    colour : vec3<f32>,
    direction : vec3<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniform;

@group(0) @binding(1) var<uniform> objectInfo : ObjectInfo;

struct Material {
    @size(16) diffuseCol : vec3<f32>,
    @size(16) specularCol : vec3<f32>,
    shininess : f32,
};

fn phong (material: Material, normal: vec3<f32>, eye: vec3<f32>, light: DirectionalLight) -> vec3<f32> {
    var diffuseFac = max(dot(normal, light.direction), 0.0);
    
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


@vertex
fn vertex_main(
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>
) -> VertexOut
{
    var out : VertexOut;
    var vert : vec4<f32> = u.mvMat * vec4<f32>(position, 1.0);
    
    out.position = u.pMat * vert;
    out.normal = normal;
    out.eye = -vec3<f32>(vert.xyz);
    out.worldPos = vert.xyz;

    return out;
}

@fragment
fn fragment_main(
    @builtin(front_facing) frontFacing : bool, 
    data: VertexOut
) 
    -> @location(0) vec4<f32>
{
    var phongShading = false;
    var light1 : DirectionalLight;
    light1.direction = vec3<f32>(0.0, 0.0, -1.0);
    light1.colour = vec3<f32>(1.0);

    // extract the normal from the view-space orientation
    // normal is in view space coordinates
    var N = -normalize(cross(dpdx(data.eye), dpdy(data.eye)));
    var E = normalize(data.eye);

    if (frontFacing) {
        if (phongShading) {
            return vec4<f32>(phong(objectInfo.frontMaterial, N, E, light1), 1);
        } else {
            return vec4<f32>(objectInfo.frontMaterial.diffuseCol, 1);
        }
    } else {
        if (phongShading) {
            return vec4<f32>(phong(objectInfo.backMaterial, N, E, light1), 1);
        } else {
            return vec4<f32>(objectInfo.backMaterial.diffuseCol, 1);
        }
    }


    // var diffuseColor = objectInfo.backCol.rgb; //vec3<f32>(0.1, 0.7, 0.6);
    // let specularColor = vec3<f32>(1.0);
    // let shininess : f32 = 50.0;

    
    // //var N = normalize(data.normal);
    
    // // var N = vec3<f32>(.0,.0,.0);

    // if (frontFacing) {
    //     diffuseColor = objectInfo.frontCol.rgb; //vec3<f32>(0.7, 0.2, 0.2);
    //     //N = -N;
    // }
    
    // var diffuseFac = max(dot(-N, light1.dir), 0.0);
    
    // var diffuse : vec3<f32>;
    // var specular : vec3<f32>;
    // var ambient : vec3<f32> = diffuseColor*0.3;
    
    // var reflected : vec3<f32>;

    // if (diffuseFac > 0.0) {
    //     diffuse = diffuseColor*light1.color*diffuseFac;

    //     reflected = reflect(light1.dir, N);
    //     var specularFac : f32 = pow(max(dot(reflected, E), 0.0), shininess);
    //     specular = specularColor*light1.color*specularFac;
    // }
    // var matCol = diffuse + specular + ambient;
    // var fogCol = vec3<f32>(0.9, 0.9, 0.9);
    // return vec4<f32>(mix(fogCol, matCol, data.position.z), 1.0);
    // //return vec4<f32>(N, 1.0);
}   