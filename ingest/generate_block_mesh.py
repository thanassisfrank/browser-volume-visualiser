import h5py
import argparse
import numpy as np
import cProfile
import dis
from collections import namedtuple
import csv
import json

from modules.utils import *
from modules.mesh import Mesh
from modules.tree import Tree
from modules.leaf_mesh import *


def get_value_names(zone_node):
    flow_sol = zone_node["FlowSolution"]
    return list(flow_sol.keys())


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


def export_meshes_info(meshes):
    with open("filled_slots.csv", "w", newline="") as file:
        writer = csv.writer(file, dialect="excel")
        writer.writerow(["Full Vertices", "Full Cells"])
        for mesh in meshes:
            writer.writerow([len(mesh.positions), len(mesh.connectivity)//4])


# write the node and corner value information
def create_node_zone_group(base_grp, tree, node_buff, corner_values):
    # indicate that there are no verts inside this
    node_zone_grp = create_cgns_subgroup(base_grp, "NodeZone", "Zone_t", "I4", np.array([0, 0, 0], dtype=np.int32))
    create_cgns_subgroup(node_zone_grp, "ZoneType", "ZoneType_t", "C1", string_to_np_char("ZoneTypeNull"))

    # write node tree to this new zone
    create_cgns_subgroup(node_zone_grp, "NodeTree", "UserDefinedData_t", "C1", node_buff)

    # write node tree information
    # node count, leaf count
    tree_data = np.array([tree.node_count, tree.leaf_count], dtype=np.int32)
    create_cgns_subgroup(node_zone_grp, "TreeData", "UserDefinedData_t", "I4", tree_data)

    # write corner value type information
    create_cgns_subgroup(node_zone_grp, "CornerValueType", "UserDefinedData_t", "C1", string_to_np_char("Sample"))

    # write the corner values
    flow_sol_grp = create_cgns_subgroup(node_zone_grp, "FlowSolution", "FlowSolution_t", "MT")

    for name, buff in corner_values.items():
        create_cgns_subgroup(flow_sol_grp, name, "DataArray_t", "R4", buff)


# writes the data that the client will access directly to a file
# contains the node and corner buffers as well as what sizes to expect for the mesh
def save_partial_data():
    ...

# writes each of the given meshes to the hdf5 file as separate zones
# also writes the node buffer
def write_block_mesh_data(file, meshes, max_verts, tree, node_buff, corner_values):
    create_cgns_subgroup(file, "CGNSLibraryVersion", "CGNSLibraryVersion_t", "R4", np.array(3.3, dtype=np.float32))
    
    base_grp = create_cgns_subgroup(file, "Base", "CGNSBase_t", "I4", np.array([3, 3], dtype=np.int32))

    # create section for node information and corner vals in the file
    create_node_zone_group(base_grp, tree, node_buff, corner_values)

    # write information about max verts and max cells in all zones
    prim_data = np.array([tree.max_cells, max_verts], dtype=np.uint32)
    create_cgns_subgroup(base_grp, "MaxPrimitives", "UserDefinedData_t", "I4", prim_data)

    # create the zones for each mesh
    for i, mesh in enumerate(meshes):
        mesh.create_zone_subgroup(base_grp, "Zone%i" % i)


def main():
    parser = argparse.ArgumentParser(prog="generate_block_mesh")
    parser.add_argument("file-path", help="path to the cgns file to process")
    parser.add_argument("-s", "--scalars", nargs="*", default=["pick"], help="flow solution scalar datasets to include")
    parser.add_argument("-d", "--depth", type=int, default=40, help="max depth of the tree")
    parser.add_argument("-c", "--max-cells", type=int, default=1024, help="max cells in the leaf nodes")
    parser.add_argument("-o", "--output", default="out.cgns", help="output file path")
    parser.add_argument("-v", "--verbose", action="store_true", help="enable verbose output")

    args = vars(parser.parse_args())
    # load the cgns file
    file = h5py.File(args["file-path"], "r")
    # print(list(file.keys()))

    print("File information:")
    print("CGNS Version", file["CGNSLibraryVersion"][" data"][0])
    print(charcodes_to_string(file[" hdf5version"][:]))

    # get the zone group to be used
    zone_grp = file["Base"]["Zone1"]
    # print(list(zone_node.keys()))

    # extract the names of the data arrays
    value_names = get_value_names(zone_grp)

    selected_value_names = filter_value_names(value_names, args["scalars"])

    # extract mesh
    mesh = Mesh.from_zone_group(zone_grp, selected_value_names)
    mesh.calculate_box()
    if args["verbose"]: print(mesh)

    # close original file
    file.close()

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
    if args["verbose"]: print(corner_values["Density"][:10])

    # split the mesh into blocks using the tree
    if args["verbose"]: print("Splitting mesh...")
    leaf_meshes = split_mesh_at_leaves(mesh, tree)
    max_verts = max(map(lambda m : len(m.positions), leaf_meshes))
    # export_meshes_info(leaf_meshes)

    # create output cgns file
    if args["verbose"]: print("Creating output file...")
    new_file = h5py.File(args["output"], "w")
    # write a new zone for each leaf block
    write_block_mesh_data(new_file, leaf_meshes, max_verts, tree, node_buffer, corner_values)

    new_file.close()

    # generate and output the json required



if __name__ == "__main__":
    main()