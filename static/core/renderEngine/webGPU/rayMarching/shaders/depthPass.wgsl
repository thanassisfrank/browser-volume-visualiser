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
    @location(1) worldPosition : vec4<f32>,
};


@vertex
fn vertex_main(
    @location(0) position: vec3<f32>
) -> VertexOut
{
    var out : VertexOut;
    var vert : vec4<f32> = globalInfo.camera.mvMat * vec4<f32>(position, 1.0);
    out.worldPosition = objectInfo.otMat * vec4<f32>(position, 1.0);
    
    out.position = globalInfo.camera.pMat * vert;
    out.eye = -vec3<f32>(vert.xyz);

    return out;
}

@fragment
fn fragment_main(
    @builtin(front_facing) frontFacing : bool, 
    data: VertexOut
) -> @location(0) vec4<f32>
{
    var dist : f32 = length(data.worldPosition.xyz - globalInfo.camera.position);
    if (frontFacing) {
        return vec4<f32>(dist, 0, 0, 0);
    } else {
        return vec4<f32>(-1*dist, 0, 0, 0); // depth is negative if this is the back face
    }
}   