// sceneObjects.js
// this file contains prototypes and functions for handling the scene and renderable management
// a scenegraph 

import {mat4, vec3} from "https://cdn.skypack.dev/gl-matrix";
import {toRads, newId} from "../utils.js";
import { VecMath } from "../VecMath.js";

// Scene graph ==================================================================================
// this is how relative transforms are controlled and managed

// keeps track of the objects in a scene in a renderable context
// doesn't have the authority to allocate/free resources like buffers
export function SceneGraph() {
    // the scenegraph consisting of scene objects or derivatives
    this.graph = [];
    // a reference
    this.activeCamera = null;

    // adds a new child to the given parent node (or the root) and can set the active camera
    this.insertChild = function(newSceneObject, parent, makeCameraActive) {
        if (parent) {
            newSceneObject.sceneParent = parent;
            parent.sceneChildren.push(newSceneObject);
        } else {
            this.graph.push(newSceneObject);
        }
        if (makeCameraActive) this.activeCamera = newSceneObject
    }

    // deletes the given branch and all its internal connections
    this.deleteBranch = function(sceneObjectToRemove) {
        // get rid of its children connections
        for (let obj of this.traverseSceneObjects(sceneObjectToRemove.sceneChildren)) {
            if (obj == this.activeCamera) this.activeCamera = null;
            obj.sceneChildren = [];
            obj.sceneParent = null;
        }

        if (sceneObjectToRemove == this.activeCamera) this.activeCamera = null;

        // remove the reference to it from its parent
        var thisParent = sceneObjectToRemove.sceneParent;
        if (thisParent) {
            var indexToRemove = thisParent.sceneChildren.findIndex((elem) => elem == sceneObjectToRemove);
            if (indexToRemove > -1) {
                thisParent.sceneChildren = thisParent.sceneChildren.toSpliced(indexToRemove, 1);
            } else {
                throw new Error("Scene object is not part of the scene graph");
            }
        }
    }

    // bottom up, depth first tree traversal
    this.traverseSceneObjects = function*(scene = this.graph) {
        for (let obj of scene) {
            // do children first
            if (obj.sceneChildren.length > 0) {
                yield* this.traverseSceneObjects(obj.sceneChildren);
            }
            // then yield the object
            yield obj;
        }
    }

    // get all the renderables from the scene graph
    this.getRenderables = function() {
        var renderables = [];
        for (let obj of this.traverseSceneObjects()) {
            var objTransform = obj.getTotalTransform();
            for (let renderable of obj.renderables) {
                renderable.transform = objTransform;
                renderables.push(renderable);
            }
        }
        return renderables;
    }

    // returns the active camera for the scene (null if not present)
    this.getActiveCamera = function() {
        return this.activeCamera;
    }
}


// Some Basic Scene Objects =======================================================================
// scene objects are the nodes in the scene graph
// they can have multiple renderables linked

// what kind of scene object this is
export const SceneObjectTypes = {
    EMPTY:      0,
    MESH:       1,
    DATA:       2,
    CAMERA:     4,
    LIGHT:      8,
    VECTOR:    16,
    AXES:      32,
}

// informs render engine how to set it up and create its needed renderables
export const SceneObjectRenderModes = {
    NONE:                   0,
    MESH_SURFACE:           1,
    MESH_WIREFRAME:         2,
    MESH_POINTS:            4,
    DATA_POINTS:            8,
    DATA_MARCH_SURFACE:    16,
    DATA_MARCH_POINTS:     32,
    DATA_RAY_VOLUME:       64,
    BOUNDING_WIREFRAME:   128,
    DATA_WIREFRAME:       256,
}

export function SceneObject(objectType = SceneObjectTypes.EMPTY, renderMode = SceneObjectRenderModes.NONE) {
    this.sceneParent = null;
    this.sceneChildren = [];

    // what kind of scene object this is
    this.objectType = objectType;
    // how it should be rendered
    this.renderMode = renderMode;
    // the list of objects passed to the render engine to render this object fully
    this.renderables = [];

    // this scene object's transform relative to parent object
    this.transform = mat4.create();
    this.getTotalTransform = () => {
        // need to get the transform of object it i.e. rotation and scale as mat4
        var transform = this.transform;
        var parent = this.parent;
        while (parent) {
            mat4.multiply(transform, parent.transform, transform);
            parent = parent.parent;
        }
    
        return transform;
    }
    // implemented in derivative scene objects
    this.getBoundaryPoints = () => {}
}

export const defaultMaterial = {
    diffuseCol: [0, 0, 0],
    specularCol: [1, 1, 1],
    shininess: 100,
};

export function Mesh() {
    SceneObject.call(this, SceneObjectTypes.MESH, SceneObjectRenderModes.MESH_SURFACE);

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
    this.frontMaterial = {...defaultMaterial};
    this.backMaterial = {...defaultMaterial};
    this.buffers = {};
}

export function Axes(scale) {
    SceneObject.call(this, SceneObjectTypes.AXES, SceneObjectRenderModes.MESH_WIREFRAME);
    this.scale = scale;
}

export function Vector(endPoint = [0, 0, 0], color = [0, 0, 0]) {
    SceneObject.call(this, SceneObjectTypes.VECTOR, SceneObjectRenderModes.MESH_WIREFRAME);

    this.endPoint = endPoint
    this.color = color;
}

export function Camera(id) {
    SceneObject.call(this, SceneObjectTypes.CAMERA);

    this.id = id;
    // horizontal angle
    this.th = 0;
    // vertical angle
    this.phi = 0;

    this.initialPosition = {
        dist: 0,
        th: 0,
        phi: 0,
        target: [0, 0, 0]
    }

    // field of view
    this.aspect = 1;
    this.fovY = 70;
    this.fovX = this.fovY*this.aspect

    // near/far planes
    this.zNear = 1;
    this.zFar = 2000;

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
            toRads(this.fovY), toRads(this.fovX), 0, 0 // fovs
        ])
    }
    // sets the aspect ratio for the camera, recalc proj mat
    this.setAspectRatio = function(aspect) {
        this.aspect = aspect;
        this.fovX = this.fovY*this.aspect;
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
            const diffX = x; // - this.mouseStart[0];
            const diffY = y; // - this.mouseStart[1];
            const diffZ = z; // - this.mouseStart[2];
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
    this.moveToStart = function() {
        this.endMove();
        this.setTarget(this.initialPosition.target);
        this.setDist(this.initialPosition.dist);
        this.setTh(this.initialPosition.th);
        this.setPhi(this.initialPosition.phi);
        this.endMove();
    }

    this.setStartPosition = function(target, dist, th, phi) {
        this.initialPosition = {
            target: target,
            dist: dist,
            th: th,
            phi: phi
        }
    }

    // returns a bool indicating if camera moved since last time this was called
    this.didThisMove = function() {
        var moved = !this.viewMatValid;
        this.viewMatValid = true;
        return moved;
    }

    this.printVals = function() {
        console.log("th", this.th);
        console.log("phi", this.phi);
        console.log("dist", this.dist);
        console.log("target", this.target);
    }
}



