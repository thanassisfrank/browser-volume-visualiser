// sceneObjects.js
// this file contains prototypes and functions for handling the scene and renderable management

import {mat4, vec3} from "../gl-matrix.js";
import {toRads, newId, clamp} from "../utils.js";
import { VecMath } from "../VecMath.js";

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
    eye = [0, 0, 0];

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

    #viewMat;
    projMat;
    #viewMatValid = false;
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

    #moveTrackers = {
        "default": true,
    }

    constructor(aspect) {
        super(SceneObjectTypes.CAMERA);
        this.setAspectRatio(aspect);
    }

    get viewMat() {
        if (!this.#viewMatValid) {
            this.#viewMat = mat4.create();
            mat4.lookAt(this.#viewMat, this.eye, this.target, [0, 1, 0]);
            this.#viewMatValid = true;
        }
        return this.#viewMat;
    }

    get cameraMat() {
        const camMat = mat4.create();
        mat4.mul(camMat, this.projMat, this.viewMat);
        return camMat;
    }

    // these two functions actually move the camera and invalidate the view matrix
    setEyePos(vec) {
        this.eye = vec;
        this.#viewMatValid = false;
        for (let id in this.#moveTrackers) {
            this.#moveTrackers[id] = true;
        }
    }

    // only moves the 
    setTarget(vec) {
        this.target = vec;
        this.#viewMatValid = false;
        for (let id in this.#moveTrackers) {
            this.#moveTrackers[id] = true;
        }
    };

    // sets the aspect ratio for the camera, recalc proj mat
    setAspectRatio(aspect) {
        this.aspect = aspect;
        this.fovX = this.fovY * this.aspect;
        let projMat = mat4.create();

        mat4.perspective(projMat, toRads(this.fovY), this.aspect, this.zNear, this.zFar);
        this.projMat = projMat;
    };

    // x and y are mapped as 0 at centre, +1 is right and bottom edge
    getWorldSpaceFromClipAndDist(x, y, d) {
        const fwd = this.getForwardVec();
        const up = this.getUpVec();
        const right = this.getRightVec();

        // calculate the ray direction
        const aspect = this.fovX / this.fovY;
        const unormRay = VecMath.vecAdd(
            fwd,
            VecMath.scalMult(x * Math.tan(this.fovY / 2) * aspect, right),
            VecMath.scalMult(-y * Math.tan(this.fovY / 2), up)
        );

        const eyeToPoint =  VecMath.scalMult(d, VecMath.normalise(unormRay));

        return VecMath.vecAdd(this.getEyePos(), eyeToPoint);
    };

    // returns the camera variables in a float32array
    // consistent with the Camera struct in WGSL
    serialise() {
        // get the forward and up vectors from the view matrix
        // assumes the projection matrix is axis aligned
        return new Float32Array([
            ...this.projMat, // projection matrix
            ...this.viewMat, // view matrix
            ...this.getEyePos(), 0, // camera location
            ...this.getUpVec(), 0, // up vector
            ...this.getRightVec(), 0, // right vector
            toRads(this.fovY), toRads(this.fovX), 0, 0 // fovs
        ]);
    };

    getForwardVec() {
        return VecMath.normalise(VecMath.vecMinus(this.target, this.eye));
    };

    getUpVec() {
        return [this.viewMat[1], this.viewMat[5], this.viewMat[9]];
    }
    
    getRightVec() {
        return [this.viewMat[0], this.viewMat[4], this.viewMat[8]];
    }
    moveAboutTargetSph(dr, del, daz) {
        const currSph = VecMath.getSphericalVals(VecMath.vecMinus(this.eye, this.target));
        const newRelEye = VecMath.fromSphericalVals({
            r: Math.max(0.1, currSph.r + dr),
            el: clamp(currSph.el + del, -Math.PI*0.45, Math.PI*0.45),
            az: currSph.az + daz
        });
        this.setEyePos(VecMath.vecAdd(newRelEye, this.target));
    }
    

    getEyePos() {
        return this.eye;
    }

    getTarget() {
        return this.target;
    }
    
    startMove(x, y, z, mode) {
        this.mouseStart = [x, y, z];
        this.mouseDown = true;
        this.startEye = this.eye;
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
            if (mode == "pan" || mode == "dolly") {
                const transVec = VecMath.vecAdd(
                    VecMath.scalMult(-x/10, this.getRightVec()),
                    VecMath.scalMult(y/10, this.getUpVec()),
                    VecMath.scalMult(z/10, this.getForwardVec())
                );
                // var vec = [-x / 10, y / 10, z / 10];
                // vec3.rotateX(vec, vec, [0, 0, 0], toRads(this.phi));
                // vec3.rotateY(vec, vec, [0, 0, 0], toRads(-this.th));
                this.translateEyeAndTarget(transVec);

            } else if (mode == "orbit") {
                this.moveAboutTargetSph(z/10, y/(4*60), -x/(4*60));
            }
        }
    };
    
    translateEyeAndTarget(vec) {
        this.setTarget(VecMath.vecAdd(this.target, vec));
        this.setEyePos(VecMath.vecAdd(this.eye, vec));
    };
    endMove() {
        this.mouseDown = false;
        this.mode = undefined;
    };
    moveToStart() {
        this.endMove();
        this.setTarget(this.initialPosition.target);
        this.setEyePos(this.initialPosition.eye);
        this.endMove();
    };

    setStartPosition(target, dist, el, az) {
        this.initialPosition = {
            target: target,
            eye: VecMath.vecAdd(target, VecMath.fromSphericalVals({r: dist, el: toRads(el), az: toRads(az)}))
        };
    };

    setStartPositionAbs(target, eye) {
        this.initialPosition = {target, eye};
    }

    // returns a bool indicating if camera moved since last time this was called with this id
    didThisMove(id = "default") {
        var moveresult = this.#moveTrackers[id] ?? true;
        this.#moveTrackers[id] = false;
        return moveresult;
    };

    printVals() {
        const {r, el, az} = VecMath.getSphericalVals(this.eye);
        console.log("th", el);
        console.log("phi", az);
        console.log("dist", r);
        console.log("eye", this.eye);
        console.log("target", this.target);
    };
}



