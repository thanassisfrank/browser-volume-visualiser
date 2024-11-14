// sceneObjects.js
// this file contains prototypes and functions for handling the scene and renderable management
// a scenegraph 

import {mat4, vec3} from "../gl-matrix.js";
import {toRads, newId} from "../utils.js";
import { VecMath } from "../VecMath.js";

// Scene graph ==================================================================================
// this is how relative transforms are controlled and managed

// keeps track of the objects in a scene in a renderable context
// doesn't have the authority to allocate/free resources like buffers
export class SceneGraph {
    // the scenegraph consisting of scene objects or derivatives
    graph = [];
    // a reference
    activeCamera = null;
    constructor() {}

    // adds a new child to the given parent node (or the root) and can set the active camera
    insertChild(newSceneObject, parent, makeCameraActive) {
        if (parent) {
            newSceneObject.sceneParent = parent;
            parent.sceneChildren.push(newSceneObject);
        } else {
            this.graph.push(newSceneObject);
        }
        if (makeCameraActive) this.activeCamera = newSceneObject;
    };
    
    // deletes the given branch and all its internal connections
    deleteBranch(sceneObjectToRemove) {
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
    };
    
    // bottom up, depth first tree traversal
    traverseSceneObjects = function* (scene = this.graph) {
        for (let obj of scene) {
            // do children first
            if (obj.sceneChildren.length > 0) {
                yield* this.traverseSceneObjects(obj.sceneChildren);
            }
            // then yield the object
            yield obj;
        }
    };
    
    // get all the renderables from the scene graph
    getRenderables() {
        var renderables = [];
        for (let obj of this.traverseSceneObjects()) {
            var objTransform = obj.getTotalTransform();
            for (let renderable of obj.renderables) {
                renderable.transform = objTransform;
                renderables.push(renderable);
            }
        }
        return renderables;
    };
    
    // returns the active camera for the scene (null if not present)
    getActiveCamera() {
        return this.activeCamera;
    };
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
};

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
    DATA_MESH_GEOMETRY:   512,
};

export const defaultMaterial = {
    diffuseCol: [0, 0, 0],
    specularCol: [1, 1, 1],
    shininess: 100,
};

export class SceneObject {
    sceneParent = null;
    sceneChildren = [];
    // the list of objects passed to the render engine to render this object fully
    renderables = [];
    // this scene object's transform relative to parent object
    transform = mat4.create();
    constructor(objectType = SceneObjectTypes.EMPTY, renderMode = SceneObjectRenderModes.NONE) {
        // what kind of scene object this is
        this.objectType = objectType;
        // how it should be rendered
        this.renderMode = renderMode;
    }

    getTotalTransform() {
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
    getBoundaryPoints() { };
}



export class Mesh extends SceneObject {
    verts = [];
    indices = [];
    normals = [];
    indicesNum = 0;
    vertsNum = 0;
    users = 0;
    forceCPUSide = false;
    marchNormals = false;

    frontMaterial = { ...defaultMaterial };
    backMaterial = { ...defaultMaterial };
    buffers = {};

    constructor() {
        super(SceneObjectTypes.MESH, SceneObjectRenderModes.MESH_SURFACE)
    }

    clear() {
        this.verts = [];
        this.indices = [];
        this.normals = [];
    };
}

export class Axes extends SceneObject {
    constructor(scale) {
        super(SceneObjectTypes.AXES, SceneObjectRenderModes.MESH_WIREFRAME);
        this.scale = scale;
    }
}

export class Vector extends SceneObject {
    constructor(endPoint = [0, 0, 0], color = [0, 0, 0]) {
        super(SceneObjectTypes.VECTOR, SceneObjectRenderModes.MESH_WIREFRAME);

        this.endPoint = endPoint;
        this.color = color;
    }
}

export class Camera extends SceneObject {
    // horizontal angle
    th = 0;
    // vertical angle
    phi = 0;

    initialPosition = {
        dist: 0,
        th: 0,
        phi: 0,
        target: [0, 0, 0]
    };

    // field of view
    aspect = 1;
    fovY = 70;
    fovX = this.fovY * this.aspect;

    // near/far planes
    zNear = 1;
    zFar = 2000;

    viewMat;
    projMat;
    viewMatValid = false;
    mouseStart = [0, 0, 0];
    startTh = 0;
    startPhi = 0;
    mouseDown = false;
    // the world position the camera is focussed on
    target = [0, 0, 0];
    startTarget = this.target;
    // tracks the current movement mode
    // can be : pan, orbit or undefined when not moving
    mode;

    constructor() {
        super(SceneObjectTypes.CAMERA);
    }

    // x and y are mapped as 0 at centre, +1 is right and bottom edge
    getWorldSpaceFromClipAndDist(x, y, d) {
        const viewMat = this.getViewMat();

        const fwd = this.getForwardVec();
        const up = VecMath.normalise(this.getUpVecFromViewMat(viewMat));
        const right = VecMath.normalise(this.getRightVecFromViewMat(viewMat));

        // calculate the ray direction
        const aspect = this.fovX / this.fovY;
        const unormRay = VecMath.vecAdd(
            fwd,
            VecMath.scalMult(x * Math.tan(this.fovY / 2) * aspect, right),
            VecMath.scalMult(-y * Math.tan(this.fovY / 2), up)
        );

        const eyeToPoint =  VecMath.scalMult(d, VecMath.normalise(unormRay));

        return VecMath.vecAdd(this.getEyePos(), eyeToPoint);
    }

    // returns the camera variables in a float32array
    // consistent with the Camera struct in WGSL
    serialise() {
        // get the forward and up vectors from the view matrix
        // assumes the projection matrix is axis aligned
        const viewMat = this.getViewMat();
        
        return new Float32Array([
            ...this.projMat, // projection matrix
            ...viewMat, // view matrix
            ...this.getEyePos(), 0, // camera location
            ...this.getUpVecFromViewMat(viewMat), 0, // up vector
            ...this.getRightVecFromViewMat(viewMat), 0, // right vector
            toRads(this.fovY), toRads(this.fovX), 0, 0 // fovs
        ]);
    };
    getForwardVec() {
        return VecMath.normalise(VecMath.vecMinus(this.target, this.getEyePos()));
    };

    getUpVecFromViewMat(viewMat) {
        return [viewMat[1], viewMat[5], viewMat[9]];
    }

    getRightVecFromViewMat(viewMat) {
        return [viewMat[0], viewMat[4], viewMat[8]];
    }

    // sets the aspect ratio for the camera, recalc proj mat
    setAspectRatio(aspect) {
        this.aspect = aspect;
        this.fovX = this.fovY * this.aspect;
        this.setProjMat();
    };
    setProjMat() {
        let projMat = mat4.create();

        mat4.perspective(projMat, toRads(this.fovY), this.aspect, this.zNear, this.zFar);
        this.projMat = projMat;
    };
    getEyePos() {
        var vec = [0, 0, this.dist];
        vec3.rotateX(vec, vec, [0, 0, 0], toRads(this.phi));
        vec3.rotateY(vec, vec, [0, 0, 0], toRads(-this.th));
        vec = VecMath.vecAdd(this.target, vec);
        return vec;
    };
    getTarget() {
        return this.target;
    };
    getViewMat() {
        this.viewMat = mat4.create();
        mat4.lookAt(this.viewMat, this.getEyePos(), this.target, [0, 1, 0]);
        return this.viewMat;
    };
    setDist(dist) {
        this.dist = Math.min(dist, this.zFar);
        this.viewMatValid = false;
    };
    getDist() {
        return this.dist;
    };
    addToDist(dist) {
        this.setDist(this.dist + dist);
        this.viewMatValid = false;
    };
    setTh(th) {
        this.th = th;
        this.viewMatValid = false;
    };
    addToTh(th) {
        this.th += th;
        this.viewMatValid = false;
    };
    setPhi(phi) {
        this.phi = phi;
        this.viewMatValid = false;
    };
    addToPhi(phi) {
        this.phi = Math.max(Math.min(this.phi + phi, 89), -89);
        this.viewMatValid = false;
    };
    startMove(x, y, z, mode) {
        this.mouseStart = [x, y, z];
        this.mouseDown = true;
        this.startTh = this.th;
        this.startPhi = this.phi;
        this.startTarget = this.target;
        this.mode = mode;
    };
    // x, y and z are change in mouse position
    move(x, y, z, mode) {
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
                var vec = [-diffX / 10, diffY / 10, diffZ / 10];
                vec3.rotateX(vec, vec, [0, 0, 0], toRads(this.phi));
                vec3.rotateY(vec, vec, [0, 0, 0], toRads(-this.th));
                this.addToTarget(vec);
            } else if (mode == "orbit") {
                this.addToTh(diffX / 4);
                this.addToPhi(-diffY / 4);
            }
        }
    };
    // translates the camera in the direction of vec
    // vec is relative to the camera's current facing direction
    setTarget(vec) {
        this.target = vec;
        this.viewMatValid = false;
    };
    addToTarget(vec) {
        this.target = VecMath.vecAdd(this.target, vec);
        this.viewMatValid = false;
    };
    endMove() {
        this.mouseDown = false;
        this.mode = undefined;
    };
    changeDist(d) {
        this.setDist(Math.max(0.1, this.dist + (d) / 10));
    };
    moveToStart() {
        this.endMove();
        this.setTarget(this.initialPosition.target);
        this.setDist(this.initialPosition.dist);
        this.setTh(this.initialPosition.th);
        this.setPhi(this.initialPosition.phi);
        this.endMove();
    };

    setStartPosition(target, dist, th, phi) {
        this.initialPosition = {
            target: target,
            dist: dist,
            th: th,
            phi: phi
        };
    };

    // returns a bool indicating if camera moved since last time this was called
    didThisMove() {
        var moved = !this.viewMatValid;
        this.viewMatValid = true;
        return moved;
    };

    printVals() {
        console.log("th", this.th);
        console.log("phi", this.phi);
        console.log("dist", this.dist);
        console.log("target", this.target);
    };
}



