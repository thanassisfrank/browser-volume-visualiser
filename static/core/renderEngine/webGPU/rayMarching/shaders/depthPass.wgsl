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
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) worldPosition : vec4<f32>,
    @location(1) eye : vec3<f32>,    
};

@group(0) @binding(0) var<uniform> u : Uniform;
@group(0) @binding(1) var<uniform> objectInfo : ObjectInfo;


@vertex
fn vertex_main(
    @location(0) position: vec3<f32>
) 
    -> VertexOut
{
    var out : VertexOut;
    var vert : vec4<f32> = globalInfo.mvMat * vec4<f32>(position, 1.0);

    out.worldPosition = objectInfo.otMat * vec4<f32>(position, 1.0);
    out.eye = vert.xyz;
    out.clipPosition = globalInfo.pMat * globalInfo.mvMat * out.worldPosition;

    return out;
}

@fragment
fn fragment_main(
    @builtin(front_facing) frontFacing : bool, 
    data: VertexOut
) 
    -> @location(0) vec4<f32>
{
    return vec4<length(out.eye), 0, 0, 0>;

}   