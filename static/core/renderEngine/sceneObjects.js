// sceneObjects.js
// a scene object contains the canvas, camera and renderable objects for a plot
//camera.js

import {mat4, vec3} from "https://cdn.skypack.dev/gl-matrix";
import {toRads, newId} from "../utils.js";
import { VecMath } from "../VecMath.js";
import { renderModes } from "./renderEngine.js";

export const RenderableObjectTypes = {
    EMPTY: 0,
    POINT_LIGHT: 1,
    CAMERA: 2,
    MESH: 4,
    DATA: 8
};

export const RenderableObjectUsage = {
    DATA_POINTS: 1,
    ISO_SURFACE: 2,
    BOUNDING_BOX: 4,
};

// base renderable object
export function RenderableObject(type, object) {
    this.transform = mat4.create();
    // type is the class of object
    this.type = type || RenderableObjectTypes.EMPTY;
    // usage is what the object is used for
    // this is used to keep track of iso-surface and data point meshes
    this.usage = undefined;
    this.renderMode = renderModes.NONE;
    this.visible = true;
    this.activeCamera = true; // for camera
    this.object = object;
    // renderData is what is held by the render engine
    // this needs to be explicitly deleted when an object is deleted
    this.renderData = {
        bindGroups: {},
        buffers: {},
        textures: {},
        samplers: {},
    };
    this.parent = undefined;
    this.children = [];
}

// keeps track of the objects in a scene in a renderable context
// doesn't have the authority to allocate/free resources like buffers
export function SceneGraph() {
    this.graph = [];
    this.camera = [];
    this.insertChild = function(renderableObject, parent) {
        if (parent) {
            renderableObject.parent = parent;
            parent.children.push(renderableObject);
        } else {
            this.graph.push(renderableObject);
        }
    }
    this.remove = function(renderableObject) {

    }
    this.traverse = function*() {
        for (let obj of scene) {
            // do children first
            if (obj.children.length > 0) {
                yield* traverseSceneGraph(obj.children);
            }
            // then yield the object
            yield obj;
        }
    }
}

// recursive function for depth first traversal of scene graph
export function* traverseSceneGraph (scene) {
    for (let obj of scene) {
        // do children first
        if (obj.children.length > 0) {
            yield* traverseSceneGraph(obj.children);
        }
        // then yield the object
        yield obj;
    }
}

export var checkForChild = (RenderableObject, childType, childUsage) => {
    for (let child of RenderableObject.children) {
        if (child.type == childType && child.usage == childUsage) {
            // the required mesh has already been created, can return safetly
            return child;
        }
    }
    return false;
}

export var removeNode = (renderableObject) => {
    var parent = renderableObject.parent;

}

export var getTotalObjectTransform = (renderableObject) => {
    // need to get the transform of object it i.e. rotation and scale as mat4
    var transform = mat4.create();
    mat4.multiply(transform, renderableObject.transform, transform);
    var parent = renderableObject.parent;
    while (parent) {
        mat4.multiply(transform, parent.transform, transform);
        parent = parent.parent;
    }

    return transform;
}

export var meshManager = {
    meshes: {},
    createMesh: function() {
        const id = newId(this.meshes);
        var newMesh = new this.Mesh(id)
        this.meshes[id] = newMesh;
        return newMesh;
    },
    addUser: function(mesh) {
        this.meshes[mesh.id].users++;
        return  this.meshes[mesh.id].users;
    },
    removeUser: function(mesh, renderEngine) {
        this.meshes[mesh.id].users--;
        if (this.meshes[mesh.id].users == 0) {
            // no users, cleanup the object
            this.deleteMesh(mesh, renderEngine)
        }
    },
    deleteMesh: function(mesh, renderEngine) {
        renderEngine.deleteBuffers(mesh);
        delete this.meshes[mesh.id];
    },
    Mesh: function(id) {
        this.id = id;
        this.verts = [];
        this.indices = [];
        this.normals = [];
        this.indicesNum = 0;
        this.vertsNum = 0;
        this.users = 0;
        this.forceCPUSide = false;
        this.marchNormals = false

        this.clear = function() {
            this.verts = [];
            this.indices = [];
            this.normals = [];
        };
        this.frontMaterial = {
            diffuseCol: [0, 0, 0],
            specularCol: [1, 1, 1],
            shininess: 100,
        }
        this.backMaterial = {
            diffuseCol: [0, 0, 0],
            specularCol: [1, 1, 1],
            shininess: 100,
        }
        this.serialiseMaterials = function() {
            return new Float32Array([
                ...this.frontMaterial.diffuseCol, 1,
                ...this.frontMaterial.specularCol, 1,
                this.frontMaterial.shininess, 0, 0, 0,
                ...this.backMaterial.diffuseCol, 1,
                ...this.backMaterial.specularCol, 1,
                this.backMaterial.shininess, 0, 0, 0
            ])
        }
        this.buffers = {};
    }
}

export var cameraManager = {
    cameras: {},
    createCamera: function() {
        const id = newId(this.cameras);
        var newCamera = new this.Camera(id)
        this.cameras[id] = newCamera;
        return newCamera;
    },
    addUser: function(camera) {
        this.cameras[camera.id].users++;
        return  this.cameras[camera.id].users;
    },
    removeUser: function(camera) {
        this.cameras[camera.id].users--;
        if (this.cameras[camera.id].users == 0) {
            // no users, cleanup the object
            this.deleteCamera(camera)
        }
    },
    Camera: function(id) {
        this.id = id;
        this.users = 0;
        // horizontal angle
        this.th = 0;
        // vertical angle
        this.phi = 0;

        // field of view
        this.aspect = 1;
        this.fovY = 70;
        this.fovX = this.fovY/this.aspect

        // near/far planes
        this.zNear = 1;
        this.zFar = 1000;

        this.viewMat;
        this.projMat;
        this.viewMatValid = false;
        this.mouseStart = [0, 0, 0];
        this.startTh = 0;
        this.startPhi = 0;
        this.mouseDown = false;
        // the world position the camera is focussed on
        this.target = [0, 0, 0];
        this.startTarget = this.target;
        // tracks the current movement mode
        // can be : pan, orbit or undefined when not moving
        this.mode;

        // returns the camera variables in a float32array
        // consistent with the Camera struct in WGSL
        this.serialise = function() {
            // get the forward and up vectors from the view matrix
            // assumes the projection matrix is axis aligned
            var viewMat = this.getViewMat();
            var fwd = VecMath.normalise(VecMath.vecMinus(this.target, this.getEyePos()));
            
            var up = [viewMat[1], viewMat[5], viewMat[9]];
            var right = [viewMat[0], viewMat[4], viewMat[8]];
            // console.log(fwd, up);
            return new Float32Array([
                ...this.projMat,           // projection matrix
                ...this.getViewMat(),      // view matrix
                ...this.getEyePos(), 0,    // camera location
                ...up, 0,                  // up vector
                ...right, 0,               // right vector
                this.fovY, this.fovX, 0, 0 // fovs
            ])
        }
        // sets the aspect ratio for the camera, recalc proj mat
        this.setAspectRatio = function(aspect) {
            this.aspect = aspect;
            this.fovX = this.fovY/this.aspect;
            this.setProjMat();
        }
        this.setProjMat = function() {
            let projMat = mat4.create();
        
            mat4.perspective(projMat, toRads(this.fovY), this.aspect, this.zNear, this.zFar);
            this.projMat = projMat;
        }
        this.getEyePos = function() {
            var vec = [0, 0, this.dist];
            vec3.rotateX(vec, vec, [0, 0, 0], toRads(this.phi));
            vec3.rotateY(vec, vec, [0, 0, 0], toRads(-this.th));
            vec = VecMath.vecAdd(this.target, vec);
            //console.log(vec)
            return vec;
            
        }
        this.getViewMat = function() {
            this.viewMat = mat4.create();
            mat4.lookAt(this.viewMat, this.getEyePos(), this.target, [0, 1, 0]);

            // if (!this.modelViewMatValid) {
            //     let viewMat = mat4.create();
            
            //     // calculate eye position in world space from distance and angle values
                
                
            //     mat4.multiply(this.modelViewMat, viewMat, this.modelMat);
    
            //     this.modelViewMatValid = true;
            //     // console.log(this.modelViewMat);
            // };
        
            return this.viewMat;
        }
        this.setDist = function(dist) {
            this.dist = Math.min(dist, this.zFar/2);
            this.viewMatValid = false;
        }
        this.addToDist = function(dist) {
            this.setDist(this.dist + dist);
            this.viewMatValid = false;
        }
        this.setTh = function(th) {
            this.th = th;
            this.viewMatValid = false;
        }
        this.addToTh = function(th) {
            this.th += th;
            this.viewMatValid = false;
        }
        this.setPhi = function(phi) {
            this.phi = phi;
            this.viewMatValid = false;
        }
        this.addToPhi = function(phi) {
            this.phi = Math.max(Math.min(this.phi + phi, 89), -89);
            this.viewMatValid = false;
        }
        this.startMove = function(x, y, z, mode) {
            this.mouseStart = [x, y, z];
            this.mouseDown = true;
            this.startTh = this.th;
            this.startPhi = this.phi;
            this.startTarget = this.target;
            this.mode = mode;
        }
        // x, y and z are change in mouse position
        this.move = function(x, y, z, mode) {
            if (this.mouseDown) {
                if (mode != this.mode) {
                    // the mode has been changed (pressed or released control)
                    // reset start position
                    this.startMove(x, y, z, mode);
                }
                const diffX = x;// - this.mouseStart[0];
                const diffY = y;// - this.mouseStart[1];
                const diffZ = z;// - this.mouseStart[2];
                if (mode == "pan" || mode == "dolly") {
                    var vec = [-diffX/10, diffY/10, diffZ/10];
                    vec3.rotateX(vec, vec, [0, 0, 0], toRads(this.phi));
                    vec3.rotateY(vec, vec, [0, 0, 0], toRads(-this.th));
                    this.addToTarget(vec);
                } else if (mode == "orbit") {
                    this.addToTh(diffX/4);
                    this.addToPhi(-diffY/4);
                }
            }
        }
        // translates the camera in the direction of vec
        // vec is relative to the camera's current facing direction
        this.setTarget = function(vec) {
            this.target = vec;
            this.viewMatValid = false;
        }
        this.addToTarget = function(vec) {
            this.target = VecMath.vecAdd(this.target, vec);
            this.viewMatValid = false;
        }
        this.endMove = function() {
            this.mouseDown = false;
            this.mode = undefined;
        }
        this.changeDist = function(d) {
            this.setDist(Math.max(0.1, this.dist + (d)/10));
        }
        this.centre = function() {
            this.endMove();
            this.target = [0, 0, 0];
            this.viewMatValid = false;
            this.endMove();
        }
    },
    deleteCamera: function(camera) {
        delete this.cameras[camera.id];
    }
}



