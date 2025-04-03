// shader.wgsl
// used for rendering simple meshes with phong shading

// import the utils structs/functions
{{utils.wgsl}}

// data common to all rendering
// camera mats, position
@group(0) @binding(0) var<uniform> globalInfo : GlobalUniform;

@group(0) @binding(1) var<uniform> objectInfo : ObjectInfo;

struct VertexOut {
    @builtin(position) position : vec4<f32>,
    @location(0) eye : vec3<f32>,
    @location(1) worldPos : vec3<f32>,
};


@vertex
fn vertex_main(
    @location(0) position: vec3<f32>
) -> VertexOut
{
    var out : VertexOut;
    var vert : vec4<f32> = globalInfo.camera.mvMat * vec4<f32>(position, 1.0);
    
    out.position = globalInfo.camera.pMat * vert;
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
    var phongShading = true;
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
}   