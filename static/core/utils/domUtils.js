// domUtils.js
// A collection of utilities for interacting with the DOM

export const get = (id) => document.getElementById(id);

export const getClass = (className) => {
    return document.getElementsByClassName(className);
};

export const isVisible = (elem) => {
    return getComputedStyle(elem).display.toLowerCase() != "none";
};

export const hide = (elem) => {
    elem.hidden = true;
};

export const show = (elem) => {
    elem.hidden = false;
};


export const removeAllChildren = (elem) => {
    while (elem.firstChild) {
        elem.removeChild(elem.firstChild);
    }
}

export const setupCanvasDims = (canvas, scale = [1, 1]) => {
    let style = getComputedStyle(canvas)
    canvas.width = Math.round(parseInt(style.getPropertyValue("width"))/scale[0]);
    canvas.height = Math.round(parseInt(style.getPropertyValue("height"))/scale[1]);
    // console.log(canvas.width, canvas.height)
    return [canvas.width, canvas.height];
};


export const getInputClassAsObj = (className) => {
    let out = {};
    for (let input of getClass(className)) {
        if ("radio" != input.type || ("radio" == input.type && input.checked)) {
            out[input.name] = input;
        }
    }
    return out;
};

export const DOMRectEqual = (rect1, rect2) => {
    if (rect1 === undefined || rect2 === undefined) return false;
    return rect1.x === rect2.x && 
           rect1.y === rect2.y &&
           rect1.width === rect2.width &&
           rect1.height === rect2.height;
};


export const hexStringToRGBArray = (hex) => {
    var col = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        col[i] = parseInt(hex.substring(1 + i*2, 3 + i*2), 16)/255;
    }
    return col;
};