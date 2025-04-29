// camera.js

import {mat4, vec3} from "../gl-matrix.js";
import {toRads, newId, clamp} from "../utils.js";
import { VecMath } from "../VecMath.js";


export class Camera {
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

    constructor(aspect=1) {
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

    getVals() {
        const {r, el, az} = VecMath.getSphericalVals(this.eye);
        return {
            r,
            el,
            az,
            eye: this.eye,
            target: this.target
        }
    };
}