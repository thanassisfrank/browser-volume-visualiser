// downloadUtils.js
// provides utilties for downloading objects as files

// converts a 2D array into a csv formatted string
export function toCSVStr(data, sep=",", endl="\r\n") {
    let str = "";
    for (let row of data) {
        str += row.join(sep) + endl;
    }
    return str;
}


export function objToCSVStr(data, sep=",", endl="\r\n") {
    let str = "";
    // header row
    str += Object.keys(data).join(sep) + endl;
    
    // main body
    const maxLength = Math.max(...Object.values(data).map(v => v.length))
    for (let i = 0; i < maxLength; i++) {
        str += Object.values(data).map(v => v[i] ?? "").join(sep) + endl;
    }

    return str;
}

export function downloadCanvas(canvas, fileName, mimeType) {
    try {
        let dlElem = document.createElement('a');
        
        dlElem.download = fileName;
        const image = canvas.toDataURL(mimeType);
        dlElem.href = image;
        dlElem.click();
    
        dlElem.remove();

    } catch (e) {
        console.error(`Unable to download canvas as ${fileName}: ${e}`);
    }
}

export function downloadObject(obj, fileName, mimeType) {
    try {
        let dlElem = document.createElement('a');
        
        dlElem.download = fileName;
        let blob = new Blob([obj], {type: mimeType});
        dlElem.href = window.URL.createObjectURL(blob);
        dlElem.click();
    
        dlElem.remove();
    } catch (e) {
        console.error(`Unable to download ${fileName}: ${e}`);
    }
}