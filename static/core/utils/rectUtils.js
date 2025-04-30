// rectUtils.js
// A collection of utility functions for manipulating objects that have the form:
// rect : {
//   left   : Number
//   top    : Number
//   right  : Number
//   bottom : Number
//   width  : Number
//   height : Number
// }

const clampBetween = (low, val, high) => Math.max(low, Math.min(val, high));

export const clampRect = (boundingRect, rect) => {
    let newRect = {};
    newRect.left   = clampBetween(rect.left, boundingRect.left, rect.right);
    newRect.top    = clampBetween(rect.top, boundingRect.top, rect.bottom);
    newRect.right  = clampBetween(rect.left, boundingRect.right, rect.right);
    newRect.bottom = clampBetween(rect.top, boundingRect.bottom, rect.bottom);
    newRect.width  = newRect.right - newRect.left;
    newRect.height = newRect.bottom - newRect.top;

    return newRect;
};

export const floorRect = (rect) => {
    let newRect = {};
    newRect.left =   Math.floor(rect.left);
    newRect.top =    Math.floor(rect.top);
    newRect.right =  Math.floor(rect.right);
    newRect.bottom = Math.floor(rect.bottom);
    newRect.width = newRect.right - newRect.left;
    newRect.height = newRect.bottom - newRect.top;

    return newRect;
};