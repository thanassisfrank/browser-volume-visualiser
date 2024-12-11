import h5py
import argparse
import numpy as np
import cProfile
import dis
from collections import namedtuple



def charcodes_to_string(charcodes):
    return "".join(map(chr, charcodes))


class Mesh:
    box = {
        "min": [0, 0, 0],
        "max": [0, 0, 0]
    }

    def __init__(self, positions, connectivity, values):
        self.positions = positions
        self.connectivity = connectivity
        self.values = values

        # assume fully tetrahedral mesh
        self.cell_count = len(connectivity)//4

    def __str__(self):
        s = "".join([
            "Mesh object\n",
            f" {self.positions.shape}\n"
            f" {len(self.positions)} points\n",
            f" {self.cell_count} cells\n",
            f" {len(self.values.keys())} val arrays\n",
            f" box min: {self.box["min"]}\n"
            f" box max: {self.box["max"]}\n"
        ])

        return s
    
    @staticmethod
    def from_zone_node(zone_node, val_names):
        # print(list(zone_node.keys()))

        zone_type_node = zone_node["ZoneType"]
        # check if this is unstructured
        if charcodes_to_string(zone_type_node[" data"]) != "Unstructured":
            raise TypeError("Dataset mesh is not unstructured")
        
        coords_node = zone_node["GridCoordinates"]
        # print(list(coords_node.keys()))
        x_dset = coords_node["CoordinateX/ data"]
        x_pos = np.empty(x_dset.shape, dtype=x_dset.dtype)
        x_dset.read_direct(x_pos)
        
        y_dset = coords_node["CoordinateY/ data"]
        y_pos = np.empty(y_dset.shape, dtype=y_dset.dtype)
        y_dset.read_direct(y_pos)
        
        z_dset = coords_node["CoordinateZ/ data"]
        z_pos = np.empty(z_dset.shape, dtype=z_dset.dtype)
        z_dset.read_direct(z_pos)

        print(len(x_pos), len(y_pos), len(z_pos))

        positions = np.array([x_pos, y_pos, z_pos]).transpose()
        # positions = np.array([
        #     coords_node["CoordinateX/ data"],
        #     coords_node["CoordinateY/ data"],
        #     coords_node["CoordinateZ/ data"],
        # ], copy=True).transpose()

        # get the connectivity information, correcting for one based indexing
        con_dset = zone_node["GridElements/ElementConnectivity/ data"]
        connectivity = np.empty(con_dset.shape, dtype=con_dset.dtype)
        con_dset.read_direct(connectivity)
        connectivity -= 1

        values = {}
        for name in val_names:
            try:
                values[name] = np.array(zone_node["FlowSolution"][name][" data"], copy=True)
            except:
                print("Couldn't load array", name)

        return Mesh(positions, connectivity, values)
    
    def calculate_box(self):
        self.box["min"] = self.positions[0]
        self.box["max"] = self.positions[0]

        for point in self.positions:
            self.box["min"] = np.minimum(self.box["min"], point)
            self.box["max"] = np.maximum(self.box["max"], point)
    
    def to_zone_node(self):
        pass


def copy_box(box):
    return {
        "min": [box["min"][0], box["min"][1], box["min"][2]],
        "max": [box["max"][0], box["max"][1], box["max"][2]],
    }


def split_cells(node, pos_part, mesh_con):
    # split the cells into left and right
    left_cells = []
    right_cells = []
    l_app = left_cells.append
    r_app = right_cells.append
    s_val = np.float32(node["split_val"])
    cells = node["cells"]

    # points_offset = 0
    # left_side = False
    # right_side = False

    for cell_id in cells:
        # see if cell is <= pivot, > pivot or both
        # only tets for now
        points_offset = cell_id * 4

        if pos_part[mesh_con[points_offset + 0]] > s_val:
            r_app(cell_id)

            if (pos_part[mesh_con[points_offset + 1]] <= s_val or 
                pos_part[mesh_con[points_offset + 2]] <= s_val or 
                pos_part[mesh_con[points_offset + 3]] <= s_val):
                l_app(cell_id)
        else:
            l_app(cell_id)

            if (pos_part[mesh_con[points_offset + 1]] > s_val or 
                pos_part[mesh_con[points_offset + 2]] > s_val or 
                pos_part[mesh_con[points_offset + 3]] > s_val):
                r_app(cell_id)
    
    return (left_cells, right_cells)


class Tree:
    def __init__(self, root, node_count):
        self.root = root
        self.node_count = node_count

    # creates a packed buffer representation of the tree
    def serialise(self):
        # create the node buffer
        node_buffer = np.empty(self.node_count, dtype=self.node_dtype)

        node_queue = [self.root]

        curr_ptr = 0

        while len(node_queue) > 0:
            node = node_queue.pop()
            node["this_ptr"] = curr_ptr

            node_buffer[curr_ptr]["split_val"] = node["split_val"]
            node_buffer[curr_ptr]["left_ptr"] = 0
            node_buffer[curr_ptr]["right_ptr"] = 0
            
            # write node to the buffer
            if node["cells"] is not None:
                node_buffer[curr_ptr]["cell_count"] = len(node["cells"])
            else:
                node_buffer[curr_ptr]["cell_count"] = 0
            
            
            if node["parent"] is not None:
                node_buffer[curr_ptr]["parent_ptr"] = node["parent"]["this_ptr"]
                # update the node's parent
                if node["parent"]["left"] == node:
                    node_buffer[node["parent"]["this_ptr"]]["left_ptr"] = curr_ptr
                else:
                    node_buffer[node["parent"]["this_ptr"]]["right_ptr"] = curr_ptr
            else:
               node_buffer[curr_ptr]["parent_ptr"] = 0                 

            if node["left"] is not None:
                node_queue.append(node["left"])
            if node["right"] is not None:
                node_queue.append(node["right"])
            curr_ptr += 1
        
        return node_buffer
            
            

    # definition of the datatype for a single node
    # struct KDTreeNode {
    #     splitVal : f32,
    #     cellCount : u32,
    #     parentPtr : u32,
    #     leftPtr : u32,
    #     rightPtr : u32,
    # };
    node_dtype = np.dtype([
        ("split_val", np.float32),
        ("cell_count", np.uint32),
        ("parent_ptr", np.uint32),
        ("left_ptr", np.uint32),
        ("right_ptr", np.uint32),
    ])

    # Node = namedtuple("Node", (node_dtype[0][0]))

    @staticmethod
    def generate_node_median(mesh, max_depth, max_cells):
        node_queue = []
        n_app = node_queue.append
        cells_count_sum = 0
        leaves_count = 0

        max_cell_count = 0
        max_leaf_depth = 0
        # make a root node with the whole dataset
        root = {
            "this_ptr": 0,
            "split_val": 0, 
            "depth": 0,
            "box": copy_box(mesh.box),
            "cells": [],
            "parent": None,
            "left": None,
            "right": None,
        }

        root["cells"] = [i for i in range(mesh.cell_count)]

        n_app(root)
        processed = 0

        mesh_pos = mesh.positions
        mesh_con = mesh.connectivity

        print("Starting tree build, target cells: %i" % max_cells)
        cells_est = []

        while len(node_queue) > 0:
            parent_node = node_queue.pop()

            # print(parent_node["box"])

            # progress indicator
            # cells_est.insert(0, len(parent_node["cells"]))
            # if len(cells_est) > 10: cells_est.pop()
            if processed % 500 == 0:
                # print("nodes processed %i, cells est: %i" % (processed, sum(cells_est)/len(cells_est)))
                avg_queue_depth = sum([node["depth"] for node in node_queue])/max(1, len(node_queue))
                # print(" ".join([str(len(node["cells"])) for node in node_queue]))
                print(
                    "nodes done: %i, leaves found: %i, in queue: %i, queue depth: %i" % 
                    (processed, leaves_count, len(node_queue), avg_queue_depth)
                )
            processed += 1

            curr_depth = parent_node["depth"]
            # stop the expansion of this node if the tree is deep enough
            # or stop if the # cells is already low enough
            if curr_depth + 1 > max_depth or len(parent_node["cells"]) <= max_cells:
                # console.log(parentNode.points.length);
                max_cell_count = max(max_cell_count, len(parent_node["cells"]))
                max_leaf_depth = max(max_leaf_depth, parent_node["depth"])
                cells_count_sum += len(parent_node["cells"])
                leaves_count += 1
                continue
            

            curr_dim = parent_node["depth"] % 3

            # find the pivot 
            parent_node["split_val"] = np.float32(0.5 * (parent_node["box"]["min"][curr_dim] + parent_node["box"]["max"][curr_dim]))


            # split the cells into left and right
            left_cells, right_cells = split_cells(parent_node, mesh_pos[:, curr_dim], mesh_con)

            # print(len(left_cells), len(right_cells))
            # print(parent_node["split_val"], curr_dim, curr_depth)

            left_box = copy_box(parent_node["box"])
            left_box["max"][curr_dim] = parent_node["split_val"]
            right_box = copy_box(parent_node["box"])
            right_box["min"][curr_dim] = parent_node["split_val"]

            # print(left_box, right_box)
            
            # create the new left and right nodes
            left_node = {
                "this_ptr": 0,
                "split_val": 0, 
                "depth": curr_depth + 1,
                "box": left_box,
                "cells": left_cells,
                "parent": parent_node,
                "left": None,
                "right": None,
            }

            right_node = {
                "this_ptr": 0,
                "split_val": 0, 
                "depth": curr_depth + 1,
                "box": right_box,
                "cells": right_cells,
                "parent": parent_node,
                "left": None,
                "right": None,
            }

            # make sure the parent is properly closed out
            parent_node["cells"] = None
            parent_node["left"] = left_node
            parent_node["right"] = right_node

            # add children to the queue
            n_app(left_node)
            n_app(right_node)
        

        print("avg cells in leaves:", cells_count_sum / leaves_count)
        print("max cells in leaves:", max_cell_count)
        print("max tree depth:", max_leaf_depth)
        print("nodes created: %i" % processed)
        print("leaves created: %i" % leaves_count)

        return Tree(root, processed)
        

def get_vert(pos, con, offset):
    return pos[con[offset]]




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
def split_mesh_at_leaves(mesh, tree):
    return [Mesh()]

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
    print(list(zone_node.keys()))

    # extract the names of the data arrays
    value_names = get_value_names(zone_node)

    selected_value_names = filter_value_names(value_names)

    # extract mesh
    mesh = Mesh.from_zone_node(zone_node, selected_value_names)
    mesh.calculate_box()
    print(mesh)

    # generate the tree
    # dis.dis(split_cells)
    # cProfile.runctx("Tree.generate_node_median(mesh, 12, args['max_cells'])", globals(), locals())
    tree = Tree.generate_node_median(mesh, args["depth"], args["max_cells"])
    # tree = Tree.generate_node_median(mesh, 3, args["max_cells"])

    node_buffer = tree.serialise()
    # print(node_buffer)
    return

    # split the mesh into blocks using the tree
    leaf_meshes = split_mesh_at_leaves(mesh, tree)

    # create new hdf5 file
    new_file = h5py.File(args["output"], "w")
    # write a new zone for each leaf block


if __name__ == "__main__":
    main()