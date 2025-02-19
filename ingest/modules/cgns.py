# cgns.py
# utilities for hdf5 cgns files

from modules.utils import *
import numpy as np
import math


def create_cgns_subgroup(group, name, label, type, data=None):
    sub_grp = group.create_group(name)
    sub_grp.attrs["name"] = name
    sub_grp.attrs["label"] = label
    sub_grp.attrs["type"] = type
    if data is not None:
        sub_grp.create_dataset(" data", data=data)
    
    return sub_grp


def get_zone_value_names(zone_node):
    flow_sol = zone_node["FlowSolution"]
    return list(flow_sol.keys())

def get_zone_positions(zone_grp):
      # check if this is unstructured
    if charcodes_to_string(zone_grp["ZoneType/ data"]) != "Unstructured":
        raise TypeError("Dataset mesh is not unstructured")
    
    coords_grp = zone_grp["GridCoordinates"]
    # print(list(coords_node.keys()))
    x_dset = coords_grp["CoordinateX/ data"]
    x_pos = np.empty(x_dset.shape, dtype=x_dset.dtype)
    x_dset.read_direct(x_pos)
    
    y_dset = coords_grp["CoordinateY/ data"]
    y_pos = np.empty(y_dset.shape, dtype=y_dset.dtype)
    y_dset.read_direct(y_pos)
    
    z_dset = coords_grp["CoordinateZ/ data"]
    z_pos = np.empty(z_dset.shape, dtype=z_dset.dtype)
    z_dset.read_direct(z_pos)

    return np.array([x_pos, y_pos, z_pos]).transpose()

def get_zone_values(zone_grp, val_names):
    # check if this is unstructured
    if charcodes_to_string(zone_grp["ZoneType/ data"]) != "Unstructured":
        raise TypeError("Dataset mesh is not unstructured")
    
    # retrieve vertex scalar data
    values = {}
    for name in val_names:
        try:
            values[name] = np.array(zone_grp["FlowSolution"][name][" data"], copy=True)
        except:
            print("Couldn't load array", name)
    
    return values

def get_zone_tet_conn(zone_grp):
    # check if this is unstructured
    if charcodes_to_string(zone_grp["ZoneType/ data"]) != "Unstructured":
        raise TypeError("Dataset mesh is not unstructured")
    
    elements_groups = []
    conn_len = 0

    # get the total connectivity array length
    for child in zone_grp.values():
        if type(child) != type(zone_grp): continue
        # child is group
        if child.attrs["label"] != b'Elements_t': continue
        # group is elements group
        if child[" data"][0] != CGNS_ELEMENT_INTS["tet"]: continue
        # group contains tets
        
        elements_groups.append(child)
        conn_len += len(child["ElementConnectivity/ data"])

    

    connectivity = np.empty(conn_len, dtype=np.uint32)
    curr_offset = 0

    for group in elements_groups:
        # read connectivity information
        con_dset = group["ElementConnectivity/ data"]
        con_dset.read_direct(connectivity, np.s_[:], np.s_[curr_offset:curr_offset + len(con_dset)])
        curr_offset += len(con_dset)

    # correct for 1-based indexing
    # connectivity -= 1

    return connectivity