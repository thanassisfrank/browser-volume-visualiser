# utils.py
import numpy as np

def charcodes_to_string(charcodes):
    return "".join(map(chr, charcodes))

def string_to_np_char(string):
    return np.array([ord(c) for c in string], dtype=np.uint8)

def copy_box(box):
    return {
        "min": [box["min"][0], box["min"][1], box["min"][2]],
        "max": [box["max"][0], box["max"][1], box["max"][2]],
    }

def create_cgns_subgroup(group, name, label, type, data=None):
    sub_grp = group.create_group(name)
    sub_grp.attrs["name"] = name
    sub_grp.attrs["label"] = label
    sub_grp.attrs["type"] = type
    if data is not None:
        sub_grp.create_dataset(" data", data=data)
    
    return sub_grp
