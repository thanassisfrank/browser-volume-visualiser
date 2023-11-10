struct PipelineConsts {
    stepSize : <f32>,
    maxLength : <f32>
};
struct PassInfo {
    dataTransform : mat4x4<f32>,
    @size(16) threshold : <f32>,
    @size(16) cameraPos : vec3<f32>,
    cameraMat : mat4x4<f32>
};

// global data
//  ray step
@group(0) @binding(0) var<storage, read> pipelineConsts : PipelineConsts;

// data specific to this march
//  data texture
@group(1) @binding(0) var data : texture_3d<f32>;
@group(1) @binding(1) var dataSampler : sampler;
//  data transformation matrix
//  threshold
//  camera position, fov
@group(2) @binding(0) var<storage, read> passInfo : PassInfo;
//  output texture (inc dimensions)
@group(2) @binding(1) var outputTexture : texture_2d<rgba32float, write>;

// sample using texturesamplelevel

@compute @workgroup_size({{WGSizeX}}, {{WGSizeY}}, {{WGSizeZ}})
fn main(
    @builtin(global_invocation_id) globalThreadPos : vec3<u32>,
    @builtin(local_invocation_index) localIndex : u32,
    @builtin(workgroup_id) wgid : vec3<u32>,
    @builtin(num_workgroups) wgnum : vec3<u32>
) {  
    // check if this thread should march a ray i.e within the texture
    // each thread is assigned a single pixel
    var outputSize = textureDimensions(outputTexture);
    if (globalThreadPos.x >= outputSize.x || globalThreadPos.y >= outputSize.y) {
        // this thread is not in the output texture
        return;
    }

    // get the equation of the ray from camera pos


    // check if the ray intersects with data volume
    

}