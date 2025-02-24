import argparse
import numpy as np
import cProfile

import h5py
import modules.fun3d_data as f3d
import modules.ugrid as ugrid

import csv

from modules.cgns import *
from modules.utils import *
from modules.mesh import Mesh
from modules.tree import Tree
from modules.leaf_mesh import *



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


def load_mesh_from_raw(path, d_type_str, size_x, size_y, size_z, verbose = False):
    if verbose: print("Opening RAW file...")
    file = open(path, "rb")
    
    # treat this as a raw 3d volumetric structured data file
    size = np.array((size_x, size_y, size_z), dtype=np.uint32)

    # read scalar values
    raw_data = np.frombuffer(file.read(), dtype=np.dtype(d_type_str))
    values = {
        "Default": np.astype(raw_data, np.float32)
    }

    print("%i data values" % len(values["Default"]))

    # create positions array
    positions = np.empty((size[0] * size[1] * size[2], 3), dtype=np.float32)

    positions.T[0] = np.tile(np.arange(size[0], dtype=np.float32), size[1] * size[2])
    positions.T[1] = np.tile(np.repeat(np.arange(size[1], dtype=np.float32), size[0]), size[2])
    positions.T[2] = np.repeat(np.arange(size[2], dtype=np.float32), size[0] * size[1])

    if verbose: print("creating %i tets..." % (6 * (size[0] - 1) * (size[1] - 1) * (size[2] - 1)))

    # rip the intrinsic hexahedra into 6 explicit tetrahedra
    connectivity = np.empty(4 * 6 * (size[0] - 1) * (size[1] - 1) * (size[2] - 1), dtype=np.uint32)
    wrapped_con = np.reshape(connectivity, (size[2] - 1, size[1] - 1, size[0] - 1, 6, 4))
    p_index = lambda x, y, z: x + y * size[0] + z * size[0] * size[1]

    k_range = np.arange(size[2] - 1)
    j_range = np.arange(size[1] - 1)
    i_range = np.arange(size[0] - 1)
    for k in k_range:
        for j in j_range:
            for i in i_range:
                wrapped_con[k][j][i][0][0] = p_index(i,     j,     k) 
                wrapped_con[k][j][i][0][1] = p_index(i + 1, j,     k) 
                wrapped_con[k][j][i][0][2] = p_index(i + 1, j + 1, k + 1)
                wrapped_con[k][j][i][0][3] = p_index(i + 1, j,     k + 1)

                wrapped_con[k][j][i][1][0] = p_index(i,     j,     k) 
                wrapped_con[k][j][i][1][1] = p_index(i + 1, j,     k + 1) 
                wrapped_con[k][j][i][1][2] = p_index(i + 1, j + 1, k + 1)
                wrapped_con[k][j][i][1][3] = p_index(i,     j,     k + 1)

                wrapped_con[k][j][i][2][0] = p_index(i,     j,     k) 
                wrapped_con[k][j][i][2][1] = p_index(i + 1, j + 1, k + 1)
                wrapped_con[k][j][i][2][2] = p_index(i,     j + 1, k + 1) 
                wrapped_con[k][j][i][2][3] = p_index(i,     j,     k + 1)

                wrapped_con[k][j][i][3][0] = p_index(i,     j,     k) 
                wrapped_con[k][j][i][3][1] = p_index(i + 1, j + 1, k + 1)
                wrapped_con[k][j][i][3][2] = p_index(i,     j + 1, k) 
                wrapped_con[k][j][i][3][3] = p_index(i,     j + 1, k + 1)

                wrapped_con[k][j][i][4][0] = p_index(i,     j,     k) 
                wrapped_con[k][j][i][4][1] = p_index(i + 1, j + 1, k) 
                wrapped_con[k][j][i][4][2] = p_index(i,     j + 1, k)
                wrapped_con[k][j][i][4][3] = p_index(i + 1, j + 1, k + 1)
                
                wrapped_con[k][j][i][5][0] = p_index(i,     j,     k) 
                wrapped_con[k][j][i][5][1] = p_index(i + 1, j,     k) 
                wrapped_con[k][j][i][5][2] = p_index(i + 1, j + 1, k)
                wrapped_con[k][j][i][5][3] = p_index(i + 1, j + 1, k + 1)

    # print(positions[5000:5200])
    file.close()

    return Mesh(positions, connectivity, values)


def load_mesh_from_file(path, scalars, d_type_str, size_x, size_y, size_z, verbose = False):
    if path.split(".")[-1].lower() == "cgns":
        return load_mesh_from_cgns(path, scalars, verbose)

    elif ".lb4" in path:
        return load_mesh_from_fun3d(path, scalars, verbose)
    
    elif ".raw" in path:
        # cProfile.runcall(load_mesh_from_raw, path, d_type_str, size_x, size_y, size_z, verbose)
        # cProfile.runctx("load_mesh_from_raw(path, d_type_str, size_x, size_y, size_z, verbose)", globals(), locals())
        return load_mesh_from_raw(path, d_type_str, size_x, size_y, size_z, verbose)
    else:
        print("Could not open this file type, try a file with .cgns, .lb4 or .raw extension")
        return
    
    


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


def add_test_data(mesh):
    with open("test.raw", "rb") as file:
        data = np.frombuffer(file.read(), dtype=np.uint8)
        mesh.create_values_from_raw("test", data, (302, 302, 302))


def export_meshes_info(meshes):
    with open("filled_slots.csv", "w", newline="") as file:
        writer = csv.writer(file, dialect="excel")
        writer.writerow(["Full Vertices", "Full Cells"])
        for mesh in meshes:
            writer.writerow([len(mesh.positions), len(mesh.connectivity)//4])


# write the node and corner value information
def create_node_zone_group(base_grp, tree, node_buff, corner_values, limits):
    # indicate that there are no verts inside this
    node_zone_grp = create_cgns_subgroup(base_grp, "NodeZone", "Zone_t", "I4", np.array([0, 0, 0], dtype=np.int32))
    create_cgns_subgroup(node_zone_grp, "ZoneType", "ZoneType_t", "C1", string_to_np_char("ZoneTypeUserDefined"))

    # write node tree to this new zone
    create_cgns_subgroup(node_zone_grp, "NodeTree", "UserDefinedData_t", "C1", node_buff)

    # write node tree information
    # node count, leaf count
    tree_data = np.array([tree.node_count, tree.leaf_count], dtype=np.int32)
    create_cgns_subgroup(node_zone_grp, "TreeData", "UserDefinedData_t", "I4", tree_data)

    # write corner value type information
    create_cgns_subgroup(node_zone_grp, "CornerValueType", "UserDefinedData_t", "C1", string_to_np_char("Sample"))

    # write the corner values and limits
    flow_sol_grp = create_cgns_subgroup(node_zone_grp, "FlowSolution", "FlowSolution_t", "MT")

    for name, buff in corner_values.items():
        create_cgns_subgroup(flow_sol_grp, name, "DataArray_t", "R4", buff)
    
    # write the limits
    limits_grp = create_cgns_subgroup(node_zone_grp, "FlowSolutionLimits", "UserDefinedData_t", "MT")

    for name, val in limits.items():
        create_cgns_subgroup(limits_grp, name, "DataArray_t", "R4", np.array(
            [val["min"], val["max"]], dtype=np.float32
        ))

    return node_zone_grp


# writes the data that the client will access directly to a file
# contains the node and corner buffers as well as what sizes to expect for the mesh
def save_partial_data(out_name, tree, max_verts, corner_values, limits):
    with h5py.File(f"{out_name}_partial.cgns", "w") as file:
        create_cgns_subgroup(file, "CGNSLibraryVersion", "CGNSLibraryVersion_t", "R4", np.array(3.3, dtype=np.float32))
        
        base_grp = create_cgns_subgroup(file, "Base", "CGNSBase_t", "I4", np.array([3, 3], dtype=np.int32))

        # create zone for partial information
        zone_grp = create_node_zone_group(base_grp, tree, tree.node_buffer.view(np.uint8), corner_values, limits)

        # write information about max verts and max cells in all zones
        prim_data = np.array([tree.max_cells, max_verts], dtype=np.uint32)
        create_cgns_subgroup(zone_grp, "MaxPrimitives", "UserDefinedData_t", "I4", prim_data)

        # write dataset box information
        box_data = np.array(tree.box["min"] + tree.box["max"], dtype=np.float32)
        create_cgns_subgroup(zone_grp, "ZoneBounds", "UserDefinedData_t", "R4", box_data)


# writes the data that the server will read from to a file
# contains the mesh data for each of the tree leaf nodes
def save_block_mesh_data(out_name, meshes, tree, max_verts):
    with h5py.File(f"{out_name}_block_mesh.cgns", "w") as file:
        file.create_dataset("format", data=string_to_np_char("IEEE_LITTLE_32\0"))
        file.create_dataset("hdf5version", data=string_to_np_char("HDF5 Version 1.10.4" + "\0"*14))
        create_cgns_subgroup(file, "CGNSLibraryVersion", "CGNSLibraryVersion_t", "R4", np.array([3.3], dtype=np.float32))
    
        base_grp = create_cgns_subgroup(file, "Base", "CGNSBase_t", "I4", np.array([3, 3], dtype=np.int32))

        # write information about max verts and max cells across all zones
        prim_data = np.array([tree.max_cells, max_verts], dtype=np.uint32)
        create_cgns_subgroup(base_grp, "MaxPrimitives", "UserDefinedData_t", "I4", prim_data)

        # create the zones for each mesh
        for mesh in meshes:
            # name each after its node index rather than mesh (leaf) index
            mesh.create_zone_subgroup(base_grp, "Zone%i" % mesh.id)


def main():
    parser = argparse.ArgumentParser(prog="generate_block_mesh")
    parser.add_argument("file-path", help="path to the cgns file to process")
    parser.add_argument("-s", "--scalars", nargs="*", default=["pick"], help="flow solution scalar datasets to include")
    parser.add_argument("-d", "--depth", type=int, default=40, help="max depth of the tree")
    parser.add_argument("-c", "--max-cells", type=int, default=1024, help="max cells in the leaf nodes")
    parser.add_argument("-o", "--output", default="out", help="output file prefix")
    parser.add_argument("-v", "--verbose", action="store_true", help="enable verbose output")
    parser.add_argument("--transfer", action="store_true", help="creates additional scalar array with test-data transferred onto the mesh")
    parser.add_argument("--data-type", default="f32", help="specify data type of raw data")
    parser.add_argument("--size-x", type=int, help="specify x size of raw data")
    parser.add_argument("--size-y", type=int, help="specify y size of raw data")
    parser.add_argument("--size-z", type=int, help="specify z size of raw data")
    parser.add_argument("--mirror-x", type=float, default=None, help="position of optional x mirror")
    parser.add_argument("--mirror-y", type=float, default=None, help="position of optional y mirror")
    parser.add_argument("--mirror-z", type=float, default=None, help="position of optional z mirror")

    args = vars(parser.parse_args())

    if args["verbose"]: print(args)

    mesh = load_mesh_from_file(
        args["file-path"], 
        args["scalars"], 
        args["data_type"], 
        args["size_x"],
        args["size_y"],
        args["size_z"],
        args["verbose"]
    )
    if mesh is None: 
        print("Could not load mesh, exiting...")
        return

    # if any mirrors are supplied with -m*, calculate their effect
    mirror_arr = [args["mirror_x"], args["mirror_y"], args["mirror_z"]]
    if mirror_arr is not [None, None, None]:
        if args["verbose"]: print("Mirroring mesh..")
        mesh.mirror(mirror_arr, args["verbose"])

    mesh.calculate_box()
    if args["verbose"]: print(mesh.box)

    # if -t is set, transfer the test data onto the mesh too
    if args["transfer"]:
        if args["verbose"]: print("Transferring test data to mesh...")
        add_test_data(mesh)
    

    mesh.calculate_limits()
    if args["verbose"]: print(mesh)

    # generate the tree
    # dis.dis(split_cells)
    # cProfile.runctx("Tree.generate_node_median(mesh, 12, args['max_cells'])", globals(), locals())
    if args["verbose"]: print("Generating tree...")
    tree = Tree.generate_node_median(mesh, args["depth"], args["max_cells"], args["verbose"])
    # tree = Tree.generate_node_median(mesh, 3, args["max_cells"])

    if args["verbose"]: print("Serialising tree...")
    node_buffer, cells_buffer = tree.convert_to_buffers()
    # print(node_buffer)

    # generate the corner values
    if args["verbose"]: print("Generating corner values...")
    # cProfile.runctx("corner_values = generate_corner_values(mesh, tree)", globals(), locals())
    # return
    corner_values = generate_corner_values(mesh, tree)

    # split the mesh into blocks using the tree
    if args["verbose"]: print("Splitting mesh...")
    leaf_meshes = split_mesh_at_leaves(mesh, tree)
    max_verts = max(map(lambda m : len(m.positions), leaf_meshes))
    # export_meshes_info(leaf_meshes)


    # create partial cgns file for client to load
    if args["verbose"]: print("Creating partial out file...")
    save_partial_data(args["output"], tree, max_verts, corner_values, mesh.limits)

    # create mesh cgns file for server to serve blocks from
    if args["verbose"]: print("Creating full mesh out file...")
    save_block_mesh_data(args["output"], leaf_meshes, tree, max_verts)



if __name__ == "__main__":
    main()