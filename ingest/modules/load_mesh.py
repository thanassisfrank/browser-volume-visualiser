import numpy as np
import random
import time
import cProfile

import h5py
import modules.fun3d_data as f3d
import modules.ugrid as ugrid

from modules.cgns import *
from modules.utils import *
from modules.mesh import Mesh
from modules.leaf_mesh import *


# generates a mapping to be used when building a mesh from structured data
def create_decimation_vert_map(size, dec_frac, verbose = False):
    nudges = [
        np.array([1, 0, 0], dtype=np.float32),
        np.array([0, 1, 0], dtype=np.float32),
        np.array([0, 0, 1], dtype=np.float32),
        np.array([-1, 0, 0], dtype=np.float32),
        np.array([0, -1, 0], dtype=np.float32),
        np.array([0, 0, -1], dtype=np.float32),
    ]

    def nudge_vert(pos):
        direction = random.randint(0, 5)
        return pos + nudges[direction]

    remove_target = round(size[0]*size[1]*size[2]*dec_frac)
    if verbose: print("Creating map to remove %i verts..." % remove_target)

    vert_map = {}

    p_index = lambda pos: pos[0] + pos[1] * size[0] + pos[2] * size[0] * size[1]

    l_bound = np.ones(3, dtype=np.uint32)
    h_bound = size - 1

    tries = 0
    while len(vert_map) < remove_target and tries < 10 * remove_target:
        tries += 1
        src_pos = np.random.randint(l_bound, h_bound)

        src_index = p_index(src_pos)

        # check if this has already been mapped
        if src_index in vert_map: continue

        dst_pos = nudge_vert(src_pos)
        dst_index = p_index(dst_pos)

        # check to prevent accidentally creating cycles
        if dst_index in vert_map: continue
        vert_map[src_index] = dst_index

        if len(vert_map) % (remove_target // 10) > 0: continue
        print("Done %i" % len(vert_map))

    if verbose: print("Created map that removes %i verts" % len(vert_map))
    return vert_map


def create_raw_tet_con_dec(size, dec_frac, verbose = False):
    # rip the intrinsic hexahedra into 6 explicit tetrahedra
    connectivity = np.empty(4 * 6 * (size[0] - 1) * (size[1] - 1) * (size[2] - 1), dtype=np.uint32)
    wrapped_con = np.reshape(connectivity, (-1, 4))
    p_index = lambda x, y, z: x + y * size[0] + z * size[0] * size[1]

    start = time.time()
    vert_map = create_decimation_vert_map(size, dec_frac, verbose)
    print("vert map took %fs" % (time.time() - start))

    start = time.time()
    
    cell_ptr = 0
    def add_cell(cell):
        nonlocal cell_ptr
        wrapped_con[cell_ptr] = cell
        cell_ptr += 1

    def translate_ind(index):
        nonlocal vert_map
        this_index = index
        while this_index in vert_map:
            this_index = vert_map[this_index]
        return this_index
    
    def is_degen(cell):
        if cell[0] == cell[1]: return True
        if cell[0] == cell[2]: return True
        if cell[0] == cell[3]: return True
        if cell[1] == cell[2]: return True
        if cell[1] == cell[3]: return True
        if cell[2] == cell[3]: return True

        return False

    def calc_cell(p1, p2, p3, p4):
        return [
            translate_ind(p1),
            translate_ind(p2),
            translate_ind(p3),
            translate_ind(p4)
        ]

    
    x_range = np.arange(size[0] - 1)
    y_range = np.arange(size[1] - 1)
    z_range = np.arange(size[2] - 1)

    ind_offsets = np.array([
        0, # 0
        1, # 1
        0 + size[0], # 2
        1 + size[0], # 3
        0 + 0       + size[0] * size[1], # 4
        1 + 0       + size[0] * size[1], # 5
        0 + size[0] + size[0] * size[1], # 6
        1 + size[0] + size[0] * size[1], # 7
    ], dtype=np.uint32)

    for z in z_range:
        for y in y_range:
            for x in x_range:
                # points = np.add([x, y, z], edges)
                p_indices = np.add(p_index(x, y, z), ind_offsets)

                cell1 = calc_cell(p_indices[1], p_indices[0], p_indices[5], p_indices[7])
                if not is_degen(cell1): add_cell(cell1)

                cell2 = calc_cell(p_indices[0], p_indices[5], p_indices[7], p_indices[4])
                if not is_degen(cell2): add_cell(cell2)

                cell3 = calc_cell(p_indices[0], p_indices[7], p_indices[6], p_indices[4])
                if not is_degen(cell3): add_cell(cell3)

                cell4 = calc_cell(p_indices[0], p_indices[7], p_indices[2], p_indices[6])
                if not is_degen(cell4): add_cell(cell4)

                cell5 = calc_cell(p_indices[0], p_indices[3], p_indices[2], p_indices[7])
                if not is_degen(cell5): add_cell(cell5)

                cell6 = calc_cell(p_indices[0], p_indices[1], p_indices[3], p_indices[7])
                if not is_degen(cell6): add_cell(cell6)


    removed_prop = 1 - cell_ptr/(6 * (size[0] - 1) * (size[1] - 1) * (size[2] - 1))
    if verbose: print("%.2f%% of cells removed" % (removed_prop * 100))

    print("make cells took %fs" % (time.time() - start))
    return connectivity[: cell_ptr * 4]


def create_raw_tet_con(size, verbose = False):
    # rip the intrinsic hexahedra into 6 explicit tetrahedra
    connectivity = np.empty(4 * 6 * (size[0] - 1) * (size[1] - 1) * (size[2] - 1), dtype=np.uint32)
    wrapped_con = np.reshape(connectivity, (-1, 4))
    p_index = lambda x, y, z: x + y * size[0] + z * size[0] * size[1]

    cell_ptr = 0    
    def add_cell(cell):
        nonlocal cell_ptr
        wrapped_con[cell_ptr] = cell
        cell_ptr += 1

    x_range = np.arange(size[0] - 1)
    y_range = np.arange(size[1] - 1)
    z_range = np.arange(size[2] - 1)

    ind_offsets = np.array([
        0, # 0
        1, # 1
        0 + size[0], # 2
        1 + size[0], # 3
        0 + 0       + size[0] * size[1], # 4
        1 + 0       + size[0] * size[1], # 5
        0 + size[0] + size[0] * size[1], # 6
        1 + size[0] + size[0] * size[1], # 7
    ], dtype=np.uint32)

    for z in z_range:
        for y in y_range:
            for x in x_range:
                # points = np.add([x, y, z], edges)
                p_indices = np.add(p_index(x, y, z), ind_offsets)

                add_cell([p_indices[1], p_indices[0], p_indices[5], p_indices[7]])
                add_cell([p_indices[0], p_indices[5], p_indices[7], p_indices[4]])
                add_cell([p_indices[0], p_indices[7], p_indices[6], p_indices[4]])
                add_cell([p_indices[0], p_indices[7], p_indices[2], p_indices[6]])
                add_cell([p_indices[0], p_indices[3], p_indices[2], p_indices[7]])
                add_cell([p_indices[0], p_indices[1], p_indices[3], p_indices[7]])
    
    return connectivity


# load from files ===============================================================================

def load_mesh_from_cgns(path, scalars, verbose = False):
    if verbose: print("Opening CGNS file...")
    try:
        file = h5py.File(path, "r")
    except OSError:
        print("Could not open file")
        return

    if verbose:
        print("File information:")
        print("CGNS Version", file["CGNSLibraryVersion"][" data"][0])
        print(charcodes_to_string(file[" hdf5version"][:]))

    # get the zone group to be used
    zone_grp = file["Base"]["Zone1"]

    # extract the names of the data arrays
    value_names = get_zone_value_names(zone_grp)
    selected_value_names = filter_value_names(value_names, scalars)

    # extract the buffers from the file
    positions = get_zone_positions(zone_grp)
    connectivity = get_zone_tet_conn(zone_grp) - 1
    values = get_zone_values(zone_grp, selected_value_names)
    
    # close original file
    file.close()

    return Mesh(positions, connectivity, values)


def load_mesh_from_fun3d(path, scalars, verbose = False):
    if verbose: print("Opening binary UGRID file...")

    # get mesh
    mesh_file = ugrid.File(path)
    positions = mesh_file.get_positions()
    connectivity = mesh_file.get_tet_con() - 1
    mesh_file.close()


    # get values
    val_path = path.replace("_mesh.lb4", "_volume_data")
    val_file = f3d.File(val_path)

    selected_value_names = filter_value_names(val_file.get_variable_names(), scalars)
    values = {name: val_file.get_value_array(name) for name in selected_value_names}

    return Mesh(positions, connectivity, values)


def load_mesh_from_raw(path, scalars, d_type_str, size_x, size_y, size_z, dec_frac, verbose = False):
    
    if verbose: print("Opening RAW file...")
    file = open(path, "rb")
    
    # treat this as a raw 3d volumetric structured data file
    size = np.array((size_x, size_y, size_z), dtype=np.uint32)

    # read scalar values
    values = {}
    if "Default" in filter_value_names(["Default"], scalars):
        raw_data = np.frombuffer(file.read(), dtype=np.dtype(d_type_str))
        values = {
            "Default": np.astype(raw_data, np.float32)
        }

    file.close()

    # create positions array
    positions = np.empty((size[0] * size[1] * size[2], 3), dtype=np.float32)

    positions.T[0] = np.tile(np.arange(size[0], dtype=np.float32), size[1] * size[2])
    positions.T[1] = np.tile(np.repeat(np.arange(size[1], dtype=np.float32), size[0]), size[2])
    positions.T[2] = np.repeat(np.arange(size[2], dtype=np.float32), size[0] * size[1])

    if verbose: print("Creating tets...")
    if dec_frac > 0:
        connectivity = create_raw_tet_con_dec(size, dec_frac, verbose)
        # connectivity = None
        # cProfile.runctx("connectivity = create_raw_tet_con_dec(size, dec_frac, verbose)", globals(), locals())
    else:
        connectivity = create_raw_tet_con(size, verbose)

    # trim the empty cell slots away
    return Mesh(positions, connectivity, values)


def filter_value_names(value_names, choices):
    chosen = []
    if "all" in choices:
        chosen = value_names
    elif "first" in choices:
        chosen.append(value_names[0])
    elif "none" in choices:
        pass
    elif "pick" in choices:
        # interactive pick prompt
        print("Pick which value arrays to include")
        print("y - yes, include")
        print("n - no, don't include")
        print("e - dont include this and end choice dialog")
        for name in value_names:
            choice = input(name + "\t").lower()
            if  choice == "y":
                chosen.append(name)
            elif choice == "e":
                break
    else:
        # pick the names that appear in choices if they exist in value_names
        # intersection of the two sets
        chosen = list(set(value_names) & set(choices))
    
    return chosen



def load_mesh_from_file(path, scalars, d_type_str, size_x, size_y, size_z, decimate, verbose = False):
    if path.split(".")[-1].lower() == "cgns":
        return load_mesh_from_cgns(path, scalars, verbose)
    elif ".lb4" in path:
        return load_mesh_from_fun3d(path, scalars, verbose)
    elif ".raw" in path:
        return load_mesh_from_raw(path, scalars, d_type_str, size_x, size_y, size_z, decimate, verbose)
    else:
        print("Could not open this file type, try a file with .cgns, .lb4 or .raw extension")
        return
    
   