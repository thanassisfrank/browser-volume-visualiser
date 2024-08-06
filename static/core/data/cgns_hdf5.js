//cgns_hdf5.js
// library to handle interface with the cgns dataset standard

export var getChildWithLabel = (parent, label) => {
    var child;
    for (let link of parent.keys()) {
        var node = parent.get(link)
        if (node?.attrs?.label?.value == label) child = node;
    }
    return child
}

export var getChildWithName = (parent, label) => {
    var child;
    for (let link of parent.keys()) {
        var node = parent.get(link)
        if (node?.attrs?.name?.value == label) child = node;
    }
    return child
}