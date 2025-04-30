// boxUtils.js
// A collection of utility functions that all operate on boxes i.e. objects of form:
// box : {
//   min : [Number, Number, Number],
//   max : [Number, Number, Number],
// }

export const boxesEqual = (box1, box2) => {
    if (!box1 || !box2) return false;
    return box1.min[0] == box2.min[0] && 
           box1.min[1] == box2.min[1] && 
           box1.min[2] == box2.min[2] && 
           box1.max[0] == box2.max[0] && 
           box1.max[1] == box2.max[1] && 
           box1.max[2] == box2.max[2];
}

export const boxesOverlap = (box1, box2) => {
    return box1.max[0] >= box2.min[0] && box2.max[0] >= box1.min[0] &&
           box1.max[1] >= box2.min[1] && box2.max[1] >= box1.min[1] &&
           box1.max[2] >= box2.min[2] && box2.max[2] >= box1.min[2];
}

export const boxVolume = (box) => {
    return (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * (box.max[2] - box.min[2]); 
}

export const copyBox = (box) => {
    return {
        min: [box.min[0], box.min[1], box.min[2]],
        max: [box.max[0], box.max[1], box.max[2]]
    };
}

export const boxSize = (box) => {
    return [
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
    ];
}