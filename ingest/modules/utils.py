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


EPSILON_CELL_TEST = 0.005


def point_in_box(p, box):
    if p[0] < box["min"][0] or p[1] < box["min"][1] or p[2] < box["min"][2]:
        return False
    if p[0] > box["max"][0] or p[1] > box["max"][1] or p[2] > box["max"][2]:
        return False
    return True


def point_in_tet_bounds(point, cell):
    cell_p = cell["points"]
    bound = {
        "min": np.minimum(
            np.minimum(cell_p[0], cell_p[1]),
            np.minimum(cell_p[2], cell_p[3])
        ),
        "max": np.maximum(
            np.maximum(cell_p[0], cell_p[1]),
            np.maximum(cell_p[2], cell_p[3])
        ),
    }

    return point_in_box(point, bound)


def point_in_tet_det(point, cell):
    x = point[0]
    y = point[1]
    z = point[2]
    p = cell["points"]

    # compute the barycentric coords for the point
    lambda1 = np.linalg.det([
        [1,       x,       y,       z],
        [1, p[1][0], p[1][1], p[1][2]],
        [1, p[2][0], p[2][1], p[2][2]],
        [1, p[3][0], p[3][1], p[3][2]],
    ])

    lambda2 = np.linalg.det([
        [1, p[0][0], p[0][1], p[0][2]],
        [1,       x,       y,       z],
        [1, p[2][0], p[2][1], p[2][2]],
        [1, p[3][0], p[3][1], p[3][2]],
    ])

    lambda3 = np.linalg.det([
        [1, p[0][0], p[0][1], p[0][2]],      
        [1, p[1][0], p[1][1], p[1][2]],      
        [1,       x,       y,       z],      
        [1, p[3][0], p[3][1], p[3][2]],      
    ])

    lambda4 = np.linalg.det([
        [1, p[0][0], p[0][1], p[0][2]],      
        [1, p[1][0], p[1][1], p[1][2]],      
        [1, p[2][0], p[2][1], p[2][2]],      
        [1,       x,       y,       z],      
    ])

    vol = np.linalg.det([
        [1, p[0][0], p[0][1], p[0][2]],      
        [1, p[1][0], p[1][1], p[1][2]],      
        [1, p[2][0], p[2][1], p[2][2]],      
        [1, p[3][0], p[3][1], p[3][2]],      
    ])

    if (
        lambda1 <= EPSILON_CELL_TEST and 
        lambda2 <= EPSILON_CELL_TEST and 
        lambda3 <= EPSILON_CELL_TEST and 
        lambda4 <= EPSILON_CELL_TEST
    ):
        return [-lambda1/vol, -lambda2/vol, -lambda3/vol, -lambda4/vol];
    elif (
        lambda1 >= -EPSILON_CELL_TEST and
        lambda2 >= -EPSILON_CELL_TEST and
        lambda3 >= -EPSILON_CELL_TEST and
        lambda4 >= -EPSILON_CELL_TEST
    ):
        return [lambda1/vol, lambda2/vol, lambda3/vol, lambda4/vol];
    else:
        # not in this cell
        return [0, 0, 0, 0]