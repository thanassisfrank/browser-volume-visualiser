// webglRender.js
// implements a 3d engine using the webgl api

import {getCtx, timer, toRads} from "../../utils.js";
export {setupRenderer, renderFrame, createBuffers, updateBuffers, deleteBuffers, clearScreen, renderView};

var gl;
var vertShader;
var fragShader;
var buffers = {};
var indicesLength;
var shaderProgram;
var programInfo;

const clearColor = [1.0, 1.0, 1.0, 1.0];

const vsSource = `#version 300 es
    in vec3 aVertexPosition;
    in vec3 vertNormal;

    uniform mat4 uMVMat;
    uniform mat4 uPMat;

    out vec3 vNormal;
    out vec3 vEye;

    void main() {
        vec4 vertex = uMVMat * vec4(aVertexPosition, 1.0);
        vEye = -vec3(vertex.xyz);
        vNormal = vertNormal;
        gl_Position = uPMat * vertex;
        gl_PointSize = 2.0;
        
    }
`;

const fsSource =`#version 300 es
    precision mediump float;

    in vec3 vNormal;
    in vec3 vEye;
    out vec4 fragCol;

    struct Light {
        vec3 dir;
        vec3 color;
    };

    Light light1 = Light(normalize(vec3(0.0, 0.0, -1.0)), vec3(1.0));
    vec3 color = vec3(0.1, 0.7, 0.6);
    vec3 specColor = vec3(1.0);
    float shininess = 50.0;

    float quant(float val, float step) {
        return step*floor(val/step);
    }

    void main() {
        vec3 E = normalize(vEye);
        vec3 N = -normalize(cross(dFdx(vEye), dFdy(vEye)));

        // check if front facing
        if (gl_FrontFacing) {
            color = vec3(0.7, 0.2, 0.2);
        }
        
        // needs to be *-1 from wgsl version
        float diffuseFac = max(dot(N, light1.dir), 0.0);
        
        vec3 diffuse;
        vec3 specular;
        vec3 ambient = color*0.3;
        vec3 reflected;

        if (diffuseFac > 0.0) {
            diffuse = color*light1.color*diffuseFac;

            reflected = reflect(light1.dir, N);
            float specularFac = pow(max(dot(reflected, E), 0.0), shininess);
            specular = specColor*light1.color*specularFac;
        }

        
        fragCol = vec4(diffuse + specular + ambient, 1.0);
        //fragCol = vec4(reflected, 1.0);
    }
`;


var setupRenderer = function(canvas) {
    gl = getCtx(canvas, "webgl2");
    if (gl == null) {
        console.log("webgl not supported");
        return;
    }
    gl.hint(gl.FRAGMENT_SHADER_DERIVATIVE_HINT, gl.FASTEST);
    gl.clearColor(...clearColor);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);

    shaderProgram = initShaderProgram(gl, vsSource, fsSource)
    if (shaderProgram === null) {
        console.log("error when creating shaderProgram")
    }

    programInfo = {
        program: shaderProgram,
        attribLocations: {
          position: gl.getAttribLocation(shaderProgram, "aVertexPosition"),
          normal: gl.getAttribLocation(shaderProgram, "vertNormal")
        },
        uniformLocations: {
          projMat: gl.getUniformLocation(shaderProgram, "uPMat"),
          modelViewMat: gl.getUniformLocation(shaderProgram, "uMVMat"),
        },
    };

    gl.enableVertexAttribArray(programInfo.attribLocations.position);
	gl.enableVertexAttribArray(programInfo.attribLocations.normal);

    gl.useProgram(programInfo.program);  

    return gl;
}

var initShaderProgram = function(gl, vsSource, fsSource) {
    vertShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    fragShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertShader);
    gl.attachShader(shaderProgram, fragShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.log('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
        return null;
    }

    return shaderProgram;
}

var loadShader = function(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.log('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
    
      return shader;
}

var renderFrame = function(gl, projMat, modelMat) {         
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers["a"].indices); 
    
    gl.uniformMatrix4fv(
        programInfo.uniformLocations.projMat,
        false,
        projMat
    );

    gl.uniformMatrix4fv(
        programInfo.uniformLocations.modelMat,
        false,
        modelMat
    );

    gl.drawElements(gl.TRIANGLES, indicesLength, gl.UNSIGNED_SHORT, 0);
}

// for creating a set of buffers for a particular id
function createBuffers(meshObj) {
    meshObj.buffers =  {
      verts: gl.createBuffer(),
      indices: gl.createBuffer(),
      normals: gl.createBuffer()
    };
}

function updateBuffers(meshObj) {
    deleteBuffers(meshObj);
    createBuffers(meshObj);
    // console.log(meshObj);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshObj.buffers.verts);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(meshObj.verts), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, meshObj.buffers.normals);
    if (meshObj.normals.length == 0) {
        // if there are no normals, create blank
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(meshObj.vertsNum*3), gl.STATIC_DRAW);
    } else {
        gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(meshObj.normals), gl.STATIC_DRAW);
    }   

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshObj.buffers.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint32Array.from(meshObj.indices), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    //console.log("updated");
}

function deleteBuffers(meshObj) {
    if (meshObj.buffers) {
        if (meshObj.buffers.verts) gl.deleteBuffer(meshObj.buffers.verts);
        if (meshObj.buffers.normals) gl.deleteBuffer(meshObj.buffers.normals);
        if (meshObj.buffers.indices) gl.deleteBuffer(meshObj.buffers.indices);
    }
    meshObj.buffers = undefined;
}

function clearScreen(gl) {
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.scissor(0, 0, gl.canvas.width, gl.canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearColor(...clearColor);
}

// for rendering a particular set of meshes associated with a view
var renderView = function(gl, projMat, modelViewMat, box, meshes, points) {
    gl.viewport(box.left, box.bottom, box.width, box.height);
    gl.scissor(box.left, box.bottom, box.width, box.height);
    //gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.uniformMatrix4fv(
        programInfo.uniformLocations.projMat,
        false,
        projMat
    );
    gl.uniformMatrix4fv(
        programInfo.uniformLocations.modelViewMat,
        false,
        modelViewMat
    );
    //console.log(meshes);
    for (let i = 0; i < meshes.length; i++) {
        var meshObj = meshes[i];
        //console.log(meshObj);
        if (meshObj.indicesNum == 0 && meshObj.vertsNum == 0) {
            continue;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, meshObj.buffers.verts);
        gl.vertexAttribPointer(programInfo.attribLocations.position, 3, gl.FLOAT, gl.FALSE, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, meshObj.buffers.normals);
        gl.vertexAttribPointer(programInfo.attribLocations.normal, 3, gl.FLOAT, gl.FALSE, 0, 0);

        if (points) {
            gl.drawArrays(gl.POINTS, 0, meshObj.vertsNum);
        } else {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshObj.buffers.indices); 
            gl.drawElements(gl.TRIANGLES, meshObj.indicesNum, gl.UNSIGNED_INT, 0);
        }
        
        var sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.clientWaitSync(sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0);

        //gl.bindBuffer(gl.ARRAY_BUFFER, null);
        //gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }
}