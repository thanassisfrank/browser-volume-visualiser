import h5py
import argparse
import numpy as np
import cProfile
import dis
from collections import namedtuple
import csv

from modules.utils import *
from modules.mesh import Mesh
from modules.tree import Tree


def get_value_names(zone_node):
    flow_sol = zone_node["FlowSolution"]
    return list(flow_sol.keys())


def filter_value_names(value_names):
    chosen = []
    print("Choose which value arrays to include")
    print("y - yes, include")
    print("n - no, don't include")
    print("e - dont include this and end choice dialog")
    for name in value_names:
        choice = input(name + "\t").lower()
        if  choice == "y":
            chosen.append(name)
        elif choice == "e":
            break
    
    return chosen


# splits the given mesh into the blocks for each leaf node
def split_mesh_at_leaves(mesh, tree, node_buff, cells_buff):
    block_meshes = []

    block_node_buff = np.array(node_buff, copy=True)

    curr_leaf_index = 0

    # iterate through nodes, check for leaf
    for i in range(tree.node_count):
        node = node_buff[i];
        if 0 != node["right_ptr"]: continue
        
        # this is a leaf node

        # This is needed to be able to properly address a leaf node's cells
        block_node_buff[i]["left_ptr"] = curr_leaf_index

        # create the buffers for this mesh segment
        block_con_buff = np.empty(node["cell_count"] * 4, np.uint32)
        curr_con_index = 0
        next_vert_index = 0
        unique_verts = {}
        cells_ptr = node["left_ptr"]

        this_cells = cells_buff[cells_ptr : cells_ptr + node["cell_count"]]


        # iterate through all cells in this leaf node
        for cell_id in this_cells:
            # iterate through the cell vertices
            for j in range(4):
                point_full_index = mesh.connectivity[cell_id * 4 + j]
                # check if the offset points to a vert already pulled in
                if point_full_index in unique_verts:
                    # get the local block-level position
                    point_block_index = unique_verts[point_full_index]
                else:
                    # its position is the next free space
                    point_block_index = next_vert_index
                    # add to unique verts
                    unique_verts[point_full_index] = next_vert_index
                    next_vert_index += 1
                
                # add connectivity entry for vert position within the block
                block_con_buff[curr_con_index] = point_block_index
                curr_con_index += 1
        

        # write the verts and values using unique vert mapping
        block_pos_buff = np.empty((next_vert_index, 3), dtype=np.float32)
        block_values = {name: np.empty(next_vert_index, dtype=np.float32) for name in mesh.values.keys()}
        for full_index, block_index in unique_verts.items():
            block_pos_buff[block_index] = mesh.positions[full_index]
            for val_name, buff in block_values.items():
                buff[block_index] = mesh.values[val_name][full_index]

        
        block_meshes.append(Mesh(block_pos_buff, block_con_buff, block_values))

    return block_meshes


def export_meshes_info(meshes):
    with open("filled_slots.csv", "w", newline="") as file:
        writer = csv.writer(file, dialect="excel")
        writer.writerow(["Full Vertices", "Full Cells"])
        for mesh in meshes:
            writer.writerow([len(mesh.positions), len(mesh.connectivity)//4])


# writes each of the given meshes to the hdf5 file as separate zones
# also writes the node buffer
def write_block_mesh_data(file, meshes, node_buff):
    create_cgns_subgroup(file, "CGNSLibraryVersion", "CGNSLibraryVersion_t", "R4", np.array(3.3, dtype=np.float32))

    base_grp = create_cgns_subgroup(file, "Base", "CGNSBase_t", "I4")

    create_cgns_subgroup(file, "NodeTree", "UserDefinedData_t", "", node_buff)

    for i, mesh in enumerate(meshes):
        mesh.create_zone_subgroup(base_grp, "Zone %i" % i)


def main():
    parser = argparse.ArgumentParser(prog="generate_block_mesh")
    parser.add_argument("file-path", help="path to the cgns file to process")
    parser.add_argument("-d", "--depth", type=int, default=40, help="max depth of the tree")
    parser.add_argument("-c", "--max-cells", type=int, default=1024, help="max cells in the leaf nodes")
    parser.add_argument("-o", "--output", default="out.cgns", help="output file path")

    args = vars(parser.parse_args())

    # load the cgns file
    file = h5py.File(args["file-path"], "r")
    # print(list(file.keys()))

    print("CGNS Version", file["CGNSLibraryVersion"][" data"][0])
    # print(str(file[" hdf5version"][:]))
    print(charcodes_to_string(file[" hdf5version"][:]))

    # get the zone node to be used
    zone_node = file["Base"]["Zone1"]
    # print(list(zone_node.keys()))

    # extract the names of the data arrays
    value_names = get_value_names(zone_node)

    selected_value_names = filter_value_names(value_names)

    # extract mesh
    mesh = Mesh.from_zone_node(zone_node, selected_value_names)
    mesh.calculate_box()
    print(mesh)

    # close original file
    file.close()

    # generate the tree
    # dis.dis(split_cells)
    # cProfile.runctx("Tree.generate_node_median(mesh, 12, args['max_cells'])", globals(), locals())
    tree = Tree.generate_node_median(mesh, args["depth"], args["max_cells"])
    # tree = Tree.generate_node_median(mesh, 3, args["max_cells"])

    node_buffer, cells_buffer = tree.serialise()
    # print(node_buffer)

    # split the mesh into blocks using the tree
    print("Splitting mesh at leaf nodes...")
    leaf_meshes = split_mesh_at_leaves(mesh, tree, node_buffer, cells_buffer)
    # export_meshes_info(leaf_meshes)

    # create new hdf5 file
    print("Creating block cgns file...")
    new_file = h5py.File(args["output"], "w")
    # write a new zone for each leaf block
    write_block_mesh_data(new_file, leaf_meshes, node_buffer)

    new_file.close()
    return


if __name__ == "__main__":
    main()