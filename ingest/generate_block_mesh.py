import argparse
import numpy as np

import h5py

import csv

from modules.cgns import *
from modules.utils import *
from modules.mesh import Mesh
from modules.tree import Tree
from modules.leaf_mesh import *
from modules.load_mesh import load_mesh_from_file
 


def add_test_data(mesh):
    with open("test.raw", "rb") as file:
        data = np.frombuffer(file.read(), dtype=np.uint8)
        mesh.create_values_from_raw("test", data, (302, 302, 302))


def export_overview_info(prefix, orig_verts, orig_cells, target_leaf_cells, meshes):
    total_verts = sum((len(mesh.positions) for mesh in meshes))
    total_cells = sum((mesh.get_cell_count() for mesh in meshes))

    with open(prefix + "overview.csv", "w", newline="") as file:
        writer = csv.writer(file, dialect="excel")
        writer.writerow([
            "Total Verts", 
            "Total Cells",
            "Original Verts",
            "Original Cells",
            "Total Leaves",
            "Target Leaf Cells"
        ])
        writer.writerow([
            total_verts,
            total_cells,
            orig_verts,
            orig_cells,
            len(meshes),
            target_leaf_cells 
        ])


def export_meshes_info(prefix, meshes):
    with open(prefix + "filled_slots.csv", "w", newline="") as file:
        writer = csv.writer(file, dialect="excel")
        writer.writerow(["Full Vertices", "Full Cells"])
        for mesh in meshes:
            writer.writerow([len(mesh.positions), mesh.get_cell_count()])


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
    parser.add_argument("-e", "--export", action="store_true", help="export tree and mesh data as csv")
    parser.add_argument("-n", "--no-files", action="store_true", help="don't generate output files")
    parser.add_argument("--transfer", action="store_true", help="creates additional scalar array with test-data transferred onto the mesh")
    parser.add_argument("--data-type", default="f32", help="specify data type of raw data")
    parser.add_argument("--size-x", type=int, help="specify x size of raw data")
    parser.add_argument("--size-y", type=int, help="specify y size of raw data")
    parser.add_argument("--size-z", type=int, help="specify z size of raw data")
    parser.add_argument("--mirror-x", type=float, default=None, help="position of optional x mirror")
    parser.add_argument("--mirror-y", type=float, default=None, help="position of optional y mirror")
    parser.add_argument("--mirror-z", type=float, default=None, help="position of optional z mirror")
    parser.add_argument("--decimate", type=float, default=0, help="proportion of cells to remove from input mesh")


    args = vars(parser.parse_args())

    if args["verbose"]: print(args)

    mesh = load_mesh_from_file(
        args["file-path"], 
        args["scalars"], 
        args["data_type"], 
        args["size_x"],
        args["size_y"],
        args["size_z"],
        args["decimate"],
        args["verbose"]
    )
    if mesh is None: 
        print("Could not load mesh, exiting...")
        return

    # if any mirrors are supplied with -m*, calculate their effect
    mirror_arr = [args["mirror_x"], args["mirror_y"], args["mirror_z"]]
    if args["mirror_x"] is not None and args["mirror_y"] is not None and args["mirror_z"] is not None:
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

    original_verts = len(mesh.positions)
    original_cells = mesh.get_cell_count()

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

    # export the tree info as csv files
    if args["export"]:
        if args["verbose"]: print("Exporting info...")
        export_meshes_info(args["output"], leaf_meshes)
        export_overview_info(args["output"], original_verts, original_cells, args["max_cells"], leaf_meshes)

    if not args["no_files"]:
        # create partial cgns file for client to load
        if args["verbose"]: print("Creating partial out file...")
        save_partial_data(args["output"], tree, max_verts, corner_values, mesh.limits)

        # create mesh cgns file for server to serve blocks from
        if args["verbose"]: print("Creating full mesh out file...")
        save_block_mesh_data(args["output"], leaf_meshes, tree, max_verts)



if __name__ == "__main__":
    main()