// viewElems.js
// defines a set of classes that handle setup of the various possible elements within a view

import { DataArrayTypes } from "./core/data/dataSource.js";
import { DataSrcTypes } from "./core/renderEngine/renderEngine.js";

export class DataSrcSelectElem {
    listeners = {
        "change": (e) => {
            const elem = e.target;
            const selected = elem.options[elem.selectedIndex];
            this.view.updateDataSrc(this.dataSrcUse, {
                name: selected.dataset.name,
                type: selected.dataset.type,
                arrayType: selected.dataset.arrayType
            });
        }
    }
    constructor(elem, view, dataArrays, dataSrcUse) {
        this.elem = elem;
        this.view = view;
        this.dataSrcUse = dataSrcUse;

        const sources = [
            {name: "None", type: DataSrcTypes.NONE},
            {name: "x", type: DataSrcTypes.AXIS},
            {name: "y", type: DataSrcTypes.AXIS},
            {name: "z", type: DataSrcTypes.AXIS},
            ...dataArrays
        ];

        const axisGroup = document.createElement("optgroup");
        axisGroup.label = "Axis";

        const dataGroup = document.createElement("optgroup");
        dataGroup.label = "Data";

        const calcGroup = document.createElement("optgroup");
        calcGroup.label = "Calc";

        // setup the elem
        for (let srcDesc of sources) {
            const optElem = document.createElement("OPTION");
            optElem.dataset.type = srcDesc.type;  
            optElem.dataset.arrayType = srcDesc.arrayType;
            optElem.dataset.name = srcDesc.name;   
            optElem.innerText = srcDesc.name;

            if (srcDesc.type == DataSrcTypes.AXIS) {
                axisGroup.appendChild(optElem);
                continue;
            }
            if (srcDesc.type == DataSrcTypes.ARRAY) {
                if (srcDesc.arrayType == DataArrayTypes.DATA) {
                    dataGroup.appendChild(optElem);
                    continue;
                } else if (srcDesc.arrayType == DataArrayTypes.CALC) {
                    calcGroup.appendChild(optElem);
                    continue;
                }
            }
            elem.appendChild(optElem);
        }

        if (axisGroup.childElementCount > 0) elem.appendChild(axisGroup);
        if (dataGroup.childElementCount > 0) elem.appendChild(dataGroup);
        if (calcGroup.childElementCount > 0) elem.appendChild(calcGroup);

        // add event listener
        for (let type in this.listeners) {
            elem.addEventListener(type, this.listeners[type]);
        }
    }

    removeListeners() {
        for (let type in this.listeners) {
            this.elem.removeEventListener(type, this.listeners[type]);
        }
    }
}