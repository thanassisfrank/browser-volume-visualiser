// webGPURender.js
// contains the main rendering object
// import { setupWebGPU, createFilledBuffer } from "./webGPUBase.js";
import { clampBox } from "../../utils.js";
import { EmptyRenderEngine, renderModes} from "../renderEngine.js";
import { WebGPUMarchingCubesEngine } from "./marchingCubes/webGPUMarchingCubes.js";
import {mat4} from 'https://cdn.skypack.dev/gl-matrix';
import { RenderableObjectTypes, RenderableObjectUsage, RenderableObject, meshManager, traverseSceneGraph, checkForChild } from "../sceneObjects.js";
import { WebGPURayMarchingEngine } from "./rayMarching/webGPURayMarching.js";

// the main rendering object that handles interacting with the GPU
// when drawing, takes a scene object (view) as input and draws it
// inhertis from the empty render engine base class
export function WebGPURenderEngine(webGPUBase, canvas) {
    EmptyRenderEngine.call(this);
    var webGPU = webGPUBase;

    this.marchingCubes = new WebGPUMarchingCubesEngine(webGPUBase);
    this.rayMarcher = new WebGPURayMarchingEngine(webGPUBase);
    // stores a reference to the canvas element
    this.canvas = canvas;
    this.ctx;

    this.clearColor = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };

    this.meshRenderPipeline;
    this.pointsRenderPipeline;
    this.linesRenderPipeline;

    this.uniformBuffer;

    var shaderCode = webGPU.fetchShader("core/renderEngine/webGPU/shaders/shader.wgsl");

    this.setup = async function() {        
        this.ctx = this.canvas.getContext("webgpu");

        // setup swapchain
        this.ctx.configure({
            device: webGPU.device,
            format: "bgra8unorm",
            alphaMode: "opaque"
        });

        this.uniformBuffer = webGPU.makeBuffer(256, "u cd cs");

        shaderCode = await shaderCode;

        this.surfaceRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {vertexLayout: webGPU.vertexLayouts.positionAndNormal, topology: "triangle-list", indexed: true},
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}}
        );
        this.pointsRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {vertexLayout: webGPU.vertexLayouts.positionAndNormal, topology: "point-list", indexed: false},
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}}
        );
        this.linesRenderPassDescriptor = webGPU.createPassDescriptor(
            webGPU.PassTypes.RENDER, 
            {vertexLayout: webGPU.vertexLayouts.positionAndNormal, topology: "line-list", indexed: true},
            [webGPU.bindGroupLayouts.render0],
            {str: shaderCode, formatObj: {}}
        );

        return this.ctx;
    }

    this.createBuffers = function() {
        const id = getNewBufferId()
        buffers[id] = {
            vertex: {
                buffer: null,
                byteLength: 0
            },
            normal: {
                buffer: null,
                byteLength: 0
            },
            index: {
                buffer: null,
                byteLength: 0
            }
        }
        return id;
    }

    this.updateBuffers = function(mesh, id) {
        webGPU.deleteBuffers(mesh);
        console.log("u")

        if (mesh.verts.length > 0) {
            mesh.buffers.vertex = createFilledBuffer("f32", mesh.verts, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
            console.log("v")
        }
        if (mesh.normals.length > 0) {
            mesh.buffers.normal = createFilledBuffer("f32", mesh.normals, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
            console.log("n")
        }
        if (mesh.indices.length > 0) {
            mesh.buffers.index = createFilledBuffer("u32", mesh.indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
            console.log("i")
        }
    }

    // clears the screen and creates the empty depth texture
    this.clearScreen = async function() {
        
        // provide details of load and store part of pass
        // here there is one color output that will be cleared on load

        var depthStencilTexture = webGPU.device.createTexture({
            label: "depth texture",
            size: {
            width: this.canvas.width,
            height: this.canvas.height,
            depth: 1
            },
            dimension: "2d",
            format: "depth32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        const renderPassDescriptor = {
            colorAttachments: [{
                clearValue: this.clearColor,
                loadOp: "clear",
                storeOp: "store",
                view: this.ctx.getCurrentTexture().createView()
            }],
            depthStencilAttachment: {
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                view: depthStencilTexture.createView()
            }
        };

        var commandEncoder = await webGPU.device.createCommandEncoder();

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        
        passEncoder.end();

        webGPU.device.queue.submit([commandEncoder.finish()]);

        await webGPU.waitForDone();

        depthStencilTexture.destroy();
    };

   

    // OLD
    this.createMeshFromDataPoints = async function(renderableDataObj) {
        // first, search direct children for if the meshes have already been created
        for (let child of renderableDataObj.children) {
            if (child.type == RenderableObjectTypes.MESH && child.usage == RenderableObjectUsage.DATA_POINTS) {
                // the required mesh has already been created, can return safetly
                return;
            }
        }

        // the mesh does not exist yet
        var dataObj = renderableDataObj.object;
        
        // create a buffer with the points in
        var vertsBufferTemp = new Float32Array(dataObj.volume*3);
        var normBufferTemp = new Float32Array(dataObj.volume*3);
        var index = 0;
        for (let i = 0; i < dataObj.size[0]; i++) {
            for (let j = 0; j < dataObj.size[1]; j++) {
                for (let k = 0; k < dataObj.size[2]; k++) {
                    vertsBufferTemp[3*index + 0] = i;
                    vertsBufferTemp[3*index + 1] = j;
                    vertsBufferTemp[3*index + 2] = k;
                    index++;
                }
            }
        }

        var dataPointsMesh = meshManager.createMesh();
        // move vertex data to the gpu
        dataPointsMesh.buffers.vertex = webGPU.createFilledBuffer("f32", vertsBufferTemp, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC);
        dataPointsMesh.buffers.normal = webGPU.createFilledBuffer("f32", normBufferTemp, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC);
        
        // set the number of verts
        dataPointsMesh.vertsNum = dataObj.volume;

        // place mesh into scene heirarchy
        var renderableMeshObj = new RenderableObject(RenderableObjectTypes.MESH, dataPointsMesh);
        renderableMeshObj.usage = RenderableObjectUsage.DATA_POINTS;
        renderableMeshObj.renderMode = renderModes.POINTS;

        renderableDataObj.children.push(renderableMeshObj);

        // console.log(renderableMeshObj);
        webGPU.readBuffer(dataPointsMesh.buffers.vertex, 0, 100).then(
            (arrayBuffer) => {console.log(new Float32Array(arrayBuffer))}
        );


        // old code from marcher.js

        // if (this.multiBlock) {
        //     for (let i = 0; i < this.pieces.length; i++) {
        //         this.pieces[i].transferPointsToMesh();
        //     }
            
        // } else {
        //     if (data.structuredGrid) {
        //         this.mesh.verts = this.data.points;
        //     } else {
        //         this.mesh.verts = new Float32Array(this.data.volume*3);
        //         var index = 0;
        //         for (let i = 0; i < this.data.size[0]; i++) {
        //             for (let j = 0; j < this.data.size[1]; j++) {
        //                 for (let k = 0; k < this.data.size[2]; k++) {
        //                     this.mesh.verts[3*index + 0] = i;
        //                     this.mesh.verts[3*index + 1] = j;
        //                     this.mesh.verts[3*index + 2] = k;
        //                     index++;
        //                 }
        //             }
        //         }
        //         console.log("made points");
        //     }
        //     this.mesh.normals = new Float32Array(this.data.volume*3);
        //     this.mesh.vertsNum = this.data.volume;
        // }
        // this.updateBuffers();
        
    }

    this.meshFromArrays = function(points, norms, indices) {
        var mesh = meshManager.createMesh();
        // move vertex data to the gpu
        mesh.buffers.vertex = webGPU.createFilledBuffer("f32", points, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC);
        mesh.buffers.normal = webGPU.createFilledBuffer("f32", norms, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC);
        mesh.buffers.index = webGPU.createFilledBuffer("u32", indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC);
        
        // set the number of verts
        mesh.vertsNum = points.length/3;
        mesh.indicesNum = indices.length;

        return mesh;
    }

    this.createBoundingBox = function(renderableDataObj) {
        // check if bounding box if already generated
        if (checkForChild(renderableDataObj, RenderableObjectTypes.MESH, RenderableObjectUsage.BOUNDING_BOX)) return;
        // make points
        var size = renderableDataObj.object.size;
        var points = renderableDataObj.object.getDatasetBoundaryPoints();

        var norms = new Float32Array(points.length);
        var indices = new Uint32Array([
            // bottom face
            2, 1, 0,
            1, 2, 3,
            // top face
            4, 5, 6,
            7, 6, 5,
            // side 1
            1, 3, 5,
            7, 5, 3,
            // side 2
            4, 2, 0,
            2, 4, 6,
            // side 3
            0, 1, 4,
            5, 4, 1,
            // side 4
            6, 3, 2,
            3, 6, 7
        ]);

        var boundingBoxMesh = this.meshFromArrays(points, norms, indices);
        boundingBoxMesh.frontMaterial.diffuseCol  = [0.7, 0.2, 0.2]; // diffuse col front
        boundingBoxMesh.frontMaterial.specularCol = [0.9, 0.4, 0.4]; // specular col front
        boundingBoxMesh.frontMaterial.shininess = 1000;
        
        boundingBoxMesh.backMaterial.diffuseCol   = [0.2, 0.2, 0.7]; // diffuse col front
        boundingBoxMesh.backMaterial.specularCol  = [0.4, 0.4, 0.9]; // specular col front
        boundingBoxMesh.backMaterial.shininess = 1000;
        
        var renderableMesh = new RenderableObject(RenderableObjectTypes.MESH, boundingBoxMesh);
        renderableMesh.usage = RenderableObjectUsage.BOUNDING_BOX;
        renderableMesh.renderMode = renderModes.NONE;

        return renderableMesh;
    }

    this.createWireframeBox = function(points) {
        var norms = new Float32Array(points.length);
        var indices = new Uint32Array([
            0, 1,
            0, 2,
            0, 4,
            1, 3,
            1, 5,
            2, 3,
            2, 6,
            3, 7,
            4, 5,
            4, 6,
            5, 7,
            6, 7
        ]);

        var wireframeMesh = this.meshFromArrays(points, norms, indices);
        wireframeMesh.frontMaterial.diffuseCol = [0, 0, 0];
        wireframeMesh.backMaterial.diffuseCol = [0, 0, 0];

        var renderableMesh = new RenderableObject(RenderableObjectTypes.MESH, wireframeMesh);
        renderableMesh.renderMode = renderModes.WIREFRAME;

        return renderableMesh;
    }

    this.createAxes = function(scale) {
        // make x axis
        var pointsX = new Float32Array([
            0,     0, 0,
            scale, 0, 0
        ]);

        var axesMeshX = this.meshFromArrays(pointsX, new Float32Array(pointsX.length), new Uint32Array([0, 1]));
        axesMeshX.frontMaterial.diffuseCol = [1, 0, 0];
        axesMeshX.backMaterial.diffuseCol = [1, 0, 0];
        var renderableMeshX = new RenderableObject(RenderableObjectTypes.MESH, axesMeshX);
        renderableMeshX.renderMode = renderModes.WIREFRAME;

        // make y axis
        var pointsY = new Float32Array([
            0, 0,     0,
            0, scale, 0
        ]);

        var axesMeshY = this.meshFromArrays(pointsY, new Float32Array(pointsY.length), new Uint32Array([0, 1]));
        axesMeshY.frontMaterial.diffuseCol = [0, 1, 0];
        axesMeshY.backMaterial.diffuseCol = [0, 1, 0];
        var renderableMeshY = new RenderableObject(RenderableObjectTypes.MESH, axesMeshY);
        renderableMeshY.renderMode = renderModes.WIREFRAME;

        // make z axis
        var pointsZ = new Float32Array([
            0, 0, 0,
            0, 0, scale
        ]);

        var axesMeshZ = this.meshFromArrays(pointsZ, new Float32Array(pointsZ.length), new Uint32Array([0, 1]));
        axesMeshZ.frontMaterial.diffuseCol = [0, 0, 1];
        axesMeshZ.backMaterial.diffuseCol = [0, 0, 1];
        var renderableMeshZ = new RenderableObject(RenderableObjectTypes.MESH, axesMeshZ);
        renderableMeshZ.renderMode = renderModes.WIREFRAME;


        var renderableMesh = new RenderableObject(RenderableObjectTypes.EMPTY);
        renderableMesh.renderMode = renderModes.NONE;

        renderableMesh.children.push(renderableMeshX);
        renderableMesh.children.push(renderableMeshY);
        renderableMesh.children.push(renderableMeshZ);

        return renderableMesh;

    }

    this.renderMesh = async function(renderableMeshObj, camera, renderPassDescriptor, box) {
        if (renderableMeshObj.renderMode == renderModes.NONE) return;
        if (!renderableMeshObj.renderData?.buffers?.objectInfo) {
            renderableMeshObj.renderData.buffers.objectInfo = webGPU.makeBuffer(256, "u cs cd", "object info buffer");
        }
        
        var meshObj = renderableMeshObj.object;
        
        if (meshObj.indicesNum == 0 && meshObj.vertsNum == 0) {
            return;
        }


        var commandEncoder = webGPU.device.createCommandEncoder();     

        await commandEncoder;

        if (renderableMeshObj.renderMode == renderModes.POINTS) {
            var thisPassDescriptor = this.pointsRenderPassDescriptor;
        } else if (renderableMeshObj.renderMode == renderModes.WIREFRAME) {
            var thisPassDescriptor = this.linesRenderPassDescriptor;
        } else if (renderableMeshObj.renderMode == renderModes.SURFACE){
            var thisPassDescriptor = this.surfaceRenderPassDescriptor;
        }
        var renderPass = {
            ...thisPassDescriptor,
            vertsNum: meshObj.vertsNum,
            indicesCount: meshObj.indicesNum,
            vertexBuffers: [meshObj.buffers.vertex, meshObj.buffers.normal],
            indexBuffer: meshObj.buffers.index,
            resources: [
                [this.uniformBuffer, renderableMeshObj.renderData.buffers.objectInfo]
            ],
            renderDescriptor: renderPassDescriptor,
            box: box,
            boundingBox: this.ctx.canvas.getBoundingClientRect(),
        }

        webGPU.encodeGPUPass(commandEncoder, renderPass);

        // write global info buffer
        webGPU.device.queue.writeBuffer(this.uniformBuffer, 0, camera.serialise());
        // console.log(camera.serialise());

        // write object info buffer
        webGPU.device.queue.writeBuffer(
            renderableMeshObj.renderData.buffers.objectInfo,
            0,
            new Float32Array([
                ...mat4.create(), 
                ...renderableMeshObj.object.serialiseMaterials()
            ])
        );
        webGPU.device.queue.submit([commandEncoder.finish()]);
    };

    this.renderData = async function(renderableDataObj, camera, renderPassDescriptor, box) {
        // console.log(renderableDataObj);
        switch (renderableDataObj.renderMode) {
            
            case renderModes.ISO_POINTS:
            case renderModes.ISO_SURFACE:
                // have to do marching cubes to get an iso-surface
                // this will not actually draw the mesh but only generate it if needed
                // meshes will be generate as children elements
                // drawing of the mesh will be left to subsequent steps of the scenegraph traversal
                this.marchingCubes.march(renderableDataObj);
                break;
            case renderModes.DATA_POINTS:
                // create a new mesh with just points from the dataset
                // if it is already created, do nothing
                this.createMeshFromDataPoints(renderableDataObj);
                break;
            case renderModes.RAY_SURFACE:
                // need to render the bounding box to a depth stencil texture
                var renderableBoundingBoxMesh = this.createBoundingBox(renderableDataObj);
                if (renderableBoundingBoxMesh) renderableDataObj.children.push(renderableBoundingBoxMesh);
                
                // var boundingBoxDepthTexture = this.meshDepthPass(renderableBoundingBoxMesh);
                // do ray marching to extract surface
                this.rayMarcher.march(renderableDataObj, camera, renderPassDescriptor, box, this.canvas);
            default:
                // do nothing
                break;
        }
    }

    // renders a view object, datasets
    // for now, all share a canvas
    // TODO: transform accumulation
    this.renderView = async function (view) {
        this.clearScreen();

        var box = view.getBox();

        // make a common depth texture for the view frame
        var depthStencilTexture = webGPU.device.createTexture({
            size: {
                width: this.canvas.width,
                height: this.canvas.height,
                depth: 1
            },
            dimension: '2d',
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        var scene = view.scene;
        // console.log(scene);

        // first check if there is a camera in the scene
        var camera = this.findCamera(scene)?.object;
        if (!camera) {
            console.warn("no camera in scene");
            return;
        }

        // traverse the scenegraph to render all objects
        var i = 0;
        for (let obj of traverseSceneGraph(scene)) {
            var renderPassDescriptor;
            if (i == 0) {
                // for first mesh, need to clear the colour and depth images
                renderPassDescriptor = {
                    colorAttachments: [{
                        clearValue: this.clearColor,
                        loadOp: "load",
                        storeOp: "store",
                        view: this.ctx.getCurrentTexture().createView()
                    }],
                    depthStencilAttachment: {
                        depthClearValue: 1.0,
                        depthLoadOp: "clear",
                        depthStoreOp: "store",
                        view: depthStencilTexture.createView()
                    }
                };
            } else {
                renderPassDescriptor = {
                    colorAttachments: [{
                        clearValue: this.clearColor,
                        loadOp: "load",
                        storeOp: "store",
                        view: this.ctx.getCurrentTexture().createView()
                    }],
                    depthStencilAttachment: {
                        depthClearValue: 1.0,
                        depthLoadOp: "load",
                        depthStoreOp: "store",
                        view: depthStencilTexture.createView()
                    }
                };
            }
            if (!obj.visible) continue;
            if (obj.type == RenderableObjectTypes.MESH) {
                // we got a mesh, render it
                this.renderMesh(obj, camera, renderPassDescriptor, box);
                i++;
            } else if (obj.type == RenderableObjectTypes.DATA) {
                // reached a data object, got to decide how to render it
                this.renderData(obj, camera, renderPassDescriptor, box);
            }
        }
        await webGPU.waitForDone();
        depthStencilTexture.destroy();        
    }

    

    this.resizeRenderingContext = function() {
        this.ctx.configure({
            device: webGPU.device,
            format: "bgra8unorm",
            alphaMode: "opaque"
        });
    }
}