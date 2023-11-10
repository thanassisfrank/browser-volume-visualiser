// dataUnpacker.js
// deals with complex file types such as .vts

// pako is for decompressing zlib compressed data
import { pako } from "./pako.js";
import Base64 from "./base64.js";
import { DATA_TYPES, getXMLContent } from "../utils.js";

export { decompressB64Str, getNumPiecesFromVTS, getDataNamesFromVTS, getPointsFromVTS, getExtentFromVTS, getPointDataFromVTS, getDataLimitsFromVTS};

// base64 zlib string in -> data array out
// credit to: https://stackoverflow.com/questions/4507316/zlib-decompression-client-side
var decompressB64Str = (b64Str, type) => {
    if (b64Str[0] == "_") {
        b64Str = b64Str.substring(1);
        //b64Str += "=";
    }
    console.log(b64Str.length%4);
    const binStr = atob(b64Str);
    var charData = binStr.split('').map(function(x){return x.charCodeAt(0);});
    var compData = new Uint8Array(charData);
    var data = pako.inflate(compData);

    if (DATA_TYPES[type]) {
        return new DATA_TYPES[type](data);
    } else {
        return undefined;
    }
}

// gets the number of pieces in the file
var getNumPiecesFromVTS = (fileDOM) => {
    return fileDOM.getElementsByTagName("Piece").length;
}

// gets the names of the 
var getDataNamesFromVTS = (fileDOM, pieceNum) => {
    const pointData = fileDOM.getElementsByTagName("Piece")[pieceNum].getElementsByTagName("PointData")[0];
    var dataNames = [];
    for (let data of pointData.getElementsByTagName("DataArray")) {
        dataNames.push(data.getAttribute("Name"));
    }
    return dataNames;
}

var getPointsFromVTS = (fileDOM, pieceNum) => {
    var pointsDataArrayElem = fileDOM.getElementsByTagName("Points")[pieceNum].getElementsByTagName("DataArray")[0];
    const pointsType = DATA_TYPES[pointsDataArrayElem.getAttribute("type").toLowerCase()];
    var VTKElem = fileDOM.getElementsByTagName("VTKFile")[0];
    const compressor = VTKElem.getAttribute("compressor");

    // NOTE: appended data sets are not currently functional
    var binaryBuffer;
    if (pointsDataArrayElem.getAttribute("format") == "appended") {
        var compB64Str = getXMLContent(fileDOM.getElementsByTagName("AppendedData")[0]).substring(1);
        const toAdd = 4 - (compB64Str.length % 4);
        for (let i = 0; i < toAdd; i++) {
            compB64Str += "=";
        }
        //console.log(compB64Str.length);
        const bufferSize = 1.5*compB64Str.length  - (1.5*compB64Str.length) % 4; // an estimate of the exanded size
        binaryBuffer = getDataBuffer(
            compB64Str,
            bufferSize,
            compressor            
        );
    }
    var data = processDataArray(
        undefined,
        pointsDataArrayElem,
        compressor,
        VTKElem.getAttribute("byte_order"),
        VTKElem.getAttribute("header_type")?.toLowerCase() || "uint32",
        binaryBuffer
    )
    return data.values;
}

var getPointDataFromVTS = (fileDOM, pieceNum, name) => {
    var pointDataElem = fileDOM.getElementsByTagName("PointData")[pieceNum];
    var dataArrayElem;
    for (let i = 0; i < pointDataElem.children.length; i++) {
        if (pointDataElem.children[i]?.getAttribute("Name") == name) {
            dataArrayElem = pointDataElem.children[i];
        }
    }
    if (!dataArrayElem) return;
    
    const pointsType = DATA_TYPES[dataArrayElem.getAttribute("type").toLowerCase()];
    var VTKElem = fileDOM.getElementsByTagName("VTKFile")[0];
    const compressor = VTKElem.getAttribute("compressor");

    // NOTE: appended data sets are not currently functional
    var binaryBuffer;
    if (dataArrayElem.getAttribute("format") == "appended") {
        var compB64Str = getXMLContent(fileDOM.getElementsByTagName("AppendedData")[0]).substring(1);
        const toAdd = 4 - (compB64Str.length % 4);
        for (let i = 0; i < toAdd; i++) {
            compB64Str += "=";
        }
        //console.log(compB64Str.length);
        const bufferSize = 1.5*compB64Str.length  - (1.5*compB64Str.length) % 4; // an estimate of the exanded size
        binaryBuffer = getDataBuffer(
            compB64Str,
            bufferSize,
            compressor            
        );
    }
    var data = processDataArray(
        undefined,
        dataArrayElem,
        compressor,
        VTKElem.getAttribute("byte_order"),
        VTKElem.getAttribute("header_type")?.toLowerCase() || "uint32",
        binaryBuffer
    )
    return data.values;
}

// returns the gride size of the piece as [x, y, z]
var getExtentFromVTS = (fileDOM, pieceNum) => {
    // extentStr is in format x1 x2 y1 y2 z1 z2
    const extentStr = fileDOM.getElementsByTagName("Piece")[pieceNum].getAttribute("Extent").trim();
    const extentStrArr = extentStr.split(" ");
    const extentArr = extentStrArr.map((v, i, a) => parseInt(v));
    return [
        extentArr[5] - extentArr[4] + 1, 
        extentArr[3] - extentArr[2] + 1, 
        extentArr[1] - extentArr[0] + 1
    ]
}

var getDataLimitsFromVTS = (fileDOM, pieceNum, name) => {
    var pointDataElem = fileDOM.getElementsByTagName("PointData")[pieceNum];
    var dataArrayElem;
    for (let i = 0; i < pointDataElem.children.length; i++) {
        if (pointDataElem.children[i]?.getAttribute("Name") == name) {
            dataArrayElem = pointDataElem.children[i];
        }
    }
    if (!dataArrayElem) return;
    return [
        parseFloat(dataArrayElem.getAttribute("RangeMin")),
        parseFloat(dataArrayElem.getAttribute("RangeMax"))
    ]
}


// modified from the vtk.js project
// original file: https://github.com/Kitware/vtk-js/blob/master/Sources/IO/XML/XMLReader/index.js
function uncompressBlock(compressedUint8, output) {
    const uncompressedBlock = pako.inflate(compressedUint8);
    output.uint8.set(uncompressedBlock, output.offset);
    output.offset += uncompressedBlock.length;
}

// modified from the vtk.js project
// original file: https://github.com/Kitware/vtk-js/blob/master/Sources/IO/XML/XMLReader/index.js
function readerHeader(uint8, headerType) {
    // We do not handle endianness or if more than 32 bits are needed to encode the data
    if (headerType === 'uint64') {
        const offset = 8;
        let uint32 = new Uint32Array(uint8.buffer, 0, 6);
        const nbBlocks = uint32[0];
        const s1 = uint32[2];
        const s2 = uint32[4];
        const resultArray = [offset, nbBlocks, s1, s2];
        uint32 = new Uint32Array(uint8.buffer, 3 * 8, nbBlocks * 2);
        for (let i = 0; i < nbBlocks; i++) {
            resultArray.push(uint32[i * 2]);
        }
        return resultArray;
    }
    // UInt32
    let uint32 = new Uint32Array(uint8.buffer, 0, 3);
    const offset = 4;
    const nbBlocks = uint32[0];
    const s1 = uint32[1];
    const s2 = uint32[2];
    const resultArray = [offset, nbBlocks, s1, s2];
    uint32 = new Uint32Array(uint8.buffer, 3 * 4, nbBlocks);
    for (let i = 0; i < nbBlocks; i++) {
        resultArray.push(uint32[i]);
    }
    return resultArray;
}


function getDataBuffer(b64Str, bufferSizeBytes, compressor) {
    const uint8In = new Uint8Array(Base64.toArrayBuffer(b64Str));
    if (compressor === 'vtkZLibDataCompressor') {
        const outBuffer = new ArrayBuffer(bufferSizeBytes);
        //console.log(new Uint32Array(uint8In.buffer)); // read for headers
        const output = {
            offset: 0,
            uint8: new Uint8Array(outBuffer),
        };

        // Header reading
        const header = readerHeader(uint8In, "uint32");//headerType); // set to uint32 for now
        //console.log(header);
        const nbBlocks = header[1];
        let offset = uint8In.length - (header.reduce((a, b) => a + b, 0) - (header[0] + header[1] + header[2] + header[3]));

        for (let i = 0; i < nbBlocks; i++) {
            const blockSize = header[4 + i];
            const compressedBlock = new Uint8Array(uint8In.buffer, offset, blockSize);
            uncompressBlock(compressedBlock, output);
            offset += blockSize;
        }
        return output.uint8.buffer;
    } else {
        return uint8In.buffer;
    }
}

// modified from the vtk.js project
// original file: https://github.com/Kitware/vtk-js/blob/master/Sources/IO/XML/XMLReader/index.js
function processDataArray(
    size,
    dataArrayElem,
    compressor,
    byteOrder,
    headerType,
    binaryBuffer
) {
    const DataArrayType = DATA_TYPES[dataArrayElem.getAttribute('type').toLowerCase()];
    const name = dataArrayElem.getAttribute('Name');
    const format = dataArrayElem.getAttribute('format'); // binary, ascii, appended
    const numberOfComponents = Number(
        dataArrayElem.getAttribute('NumberOfComponents') || '1'
    );
    let values = null;

    if (format === 'ascii') {
        values = new DataArrayType(size * numberOfComponents);
        let offset = 0;
        dataArrayElem.firstChild.nodeValue.split(/[\\t \\n]+/).forEach((token) => {
            if (token.trim().length) {
                values[offset++] = Number(token);
            }
        });
    } else if (format === 'binary') {
        const uint8 = new Uint8Array(Base64.toArrayBuffer(getXMLContent(dataArrayElem).trim()));
        if (compressor === 'vtkZLibDataCompressor') {
            const buffer = new ArrayBuffer(
                DataArrayType.BYTES_PER_ELEMENT * size * numberOfComponents
            );
            values = new DataArrayType(buffer);
            const output = {
                offset: 0,
                uint8: new Uint8Array(buffer),
            };
            // ----------------------------------------------------------------------
            // Layout of the data
            // header[N, s1, s1, blockSize1, ..., blockSizeN], [padding???], block[compressedData], ..., block[compressedData]
            // [header] N, s1 and s2 are uint 32 or 64 (defined by header_type="UInt64" attribute on the root node)
            // [header] s1: uncompress size of each block except the last one
            // [header] s2: uncompress size of the last blocks
            // [header] blockSize: size of the block in compressed space that represent to bloc to inflate in zlib. (This also give the offset to the next block)
            // ----------------------------------------------------------------------

            // Header reading
            const header = readerHeader(uint8, headerType);
            const nbBlocks = header[1];
            let offset = uint8.length - (header.reduce((a, b) => a + b, 0) - (header[0] + header[1] + header[2] + header[3]));

            for (let i = 0; i < nbBlocks; i++) {
                const blockSize = header[4 + i];
                const compressedBlock = new Uint8Array(uint8.buffer, offset, blockSize);
                uncompressBlock(compressedBlock, output);
                offset += blockSize;
            }

            // // Handle (u)int64 hoping for no overflow...
            // if (dataType.indexOf('Int64') !== -1) {
            //   values = integer64to32(values);
            // }
        } else {
            values = new DataArrayType(uint8.buffer, DATA_TYPES[headerType].BYTES_PER_ELEMENT); // Skip the byte count
            // // Handle (u)int64 hoping no overflow...
            // if (dataType.indexOf('Int64') !== -1) {
            //   values = integer64to32(values);
            // }
        }
    } else if (format === 'appended') {
        let offset = Number(dataArrayElem.getAttribute('offset'));
        
        // extract the bytebuffer from the data
        
 
        // read header
        // NOTE: this will incorrectly read the size if headerType is (U)Int64 and
        // the value requires (U)Int64.
        let header;
        const HeaderArrayType = DATA_TYPES[headerType]
        if (offset % HeaderArrayType.BYTES_PER_ELEMENT === 0) {
            header = new HeaderArrayType(binaryBuffer, offset, 1);
        } else {
            header = new HeaderArrayType(
                binaryBuffer.slice(offset, offset + HeaderArrayType.BYTES_PER_ELEMENT)
            );
        }
        let arraySize = header[0] / DataArrayType.BYTES_PER_ELEMENT;

        // if we are dealing with Uint64, we need to get double the values since
        // TYPED_ARRAY[Uint64] is Uint32.
        //   if (dataType.indexOf('Int64') !== -1) {
        //     arraySize *= 2;
        //   }

        offset += HeaderArrayType.BYTES_PER_ELEMENT;

        // read values
        // if offset is aligned to dataType, use view. Otherwise, slice due to misalignment.
        if (offset % DataArrayType.BYTES_PER_ELEMENT === 0) {
            values = new DataArrayType(binaryBuffer, offset, arraySize);
        } else {
            values = new DataArrayType(binaryBuffer.slice(offset, offset + header[0]));
        }
        //   // remove higher order 32 bits assuming they're not used.
        //   if (dataType.indexOf('Int64') !== -1) {
        //     values = integer64to32(values);
        //   }
    } else {
        console.error('Format not supported', format);
    }

    return { name, values, numberOfComponents };
}