import h5py
import argparse
import numpy as np
import cProfile

# for cell-split plane checks
LEFT_BIT  = 0b01
RIGHT_BIT = 0b10



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
        s = "Mesh object\n"
        s += f" {len(self.positions)} points\n"
        s += f" {self.cell_count} cells\n"
        s += f" {len(self.values.keys())} val arrays"
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
        x_pos = np.array(coords_node["CoordinateX/ data"], copy=True)
        y_pos = np.array(coords_node["CoordinateY/ data"], copy=True)
        z_pos = np.array(coords_node["CoordinateZ/ data"], copy=True)
        positions = np.array([x_pos, y_pos, z_pos]).transpose()
        # positions = np.array([
        #     coords_node["CoordinateX/ data"],
        #     coords_node["CoordinateY/ data"],
        #     coords_node["CoordinateZ/ data"],
        # ], copy=True).transpose()

        # get the connectivity information, correcting for one based indexing
        connectivity = np.array(zone_node["GridElements/ElementConnectivity/ data"], copy=True) - 1

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

def get_vert(pos, con, offset):
    return pos[con[offset]]

def check_cell_positions(pos, con, cell_id, dim, val):
    # only tetra for now
    points_length = 4

    points_offset = cell_id * points_length
    result = 0
    # this_point_value = 0
    for i in range(points_length):
        # the position of this point in the dimension that is being checked
        # this_point_value = mesh.positions[mesh.connectivity[points_offset + i]][dim]
        if pos[con[points_offset + i]][dim] <= val:
            result |= LEFT_BIT
        else:
            result |= RIGHT_BIT

    return result


def split_cells(node, curr_dim, mesh_pos, mesh_con):
    # split the cells into left and right
    left_cells = []
    right_cells = []
    l_app = left_cells.append
    r_app = right_cells.append
    s_val = node["split_val"]

    for cell_id in node["cells"]:
        # see if cell is <= pivot, > pivot or both
        # only tets for now
        points_length = 4

        points_offset = cell_id * points_length

        left_side = False
        right_side = False

        if mesh_pos[mesh_con[points_offset + 0]][curr_dim] <= s_val:
            left_side = True
        else:
            right_side = True

        if mesh_pos[mesh_con[points_offset + 1]][curr_dim] <= s_val:
            left_side = True
        else:
            right_side = True

        if mesh_pos[mesh_con[points_offset + 2]][curr_dim] <= s_val:
            left_side = True    
        else:
            right_side = True

        if mesh_pos[mesh_con[points_offset + 3]][curr_dim] <= s_val:
            left_side = True
        else:
            right_side = True

        if left_side:
            l_app(cell_id)
        if right_side:
            r_app(cell_id)
    
    return (left_cells, right_cells)

class Tree:
    def __init__(self, root):
        self.root = root

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
            "split_val": 0, 
            "depth": 0,
            "box": copy_box(mesh.box),
            "cells": [],
            "left": None,
            "right": None,
        }

        root["cells"] = [i for i in range(mesh.cell_count)]

        n_app(root)
        processed = 0

        mesh_pos = mesh.positions
        mesh_con = mesh.connectivity

        while len(node_queue) > 0:
            # progress indicator
            processed += 1
            if processed % 100 == 0:
                print(processed, "nodes processed", processed/mesh.cell_count * 100, "%")

            parent_node = node_queue.pop()
            current_depth = parent_node["depth"] + 1
            # stop the expansion of this node if the tree is deep enough
            # or stop if the # cells is already low enough
            if current_depth > max_depth or len(parent_node["cells"]) <= max_cells:
                # console.log(parentNode.points.length);
                max_cell_count = max(max_cell_count, len(parent_node["cells"]))
                max_leaf_depth = max(max_leaf_depth, parent_node["depth"])
                cells_count_sum += len(parent_node["cells"])
                leaves_count += 1
                continue
            

            curr_dim = parent_node["depth"] % 3

            # find the pivot 
            parent_node["split_val"] = 0.5 * (parent_node["box"]["min"][curr_dim] + parent_node["box"]["max"][curr_dim])

            left_box = copy_box(parent_node["box"])
            left_box["max"][curr_dim] = parent_node["split_val"]
            right_box = copy_box(parent_node["box"])
            right_box["min"][curr_dim] = parent_node["split_val"]


            # split the cells into left and right
            (left_cells, right_cells) = split_cells(parent_node, curr_dim, mesh_pos, mesh_con)

            # create the new left and right nodes
            left_node = {
                "split_val": 0, 
                "depth": parent_node["depth"] + 1,
                "box": left_box,
                "cells": left_cells,
                "parent": parent_node,
                "left": None,
                "right": None,
            }

            right_node = {
                "split_val": 0, 
                "depth": parent_node["depth"] + 1,
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

        return Tree(root)
        




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


# generates a node median KD tree over the mesh domain
def generate_tree(mesh, depth, max_cells):
    return Tree()


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
    print(mesh)

    # generate the tree
    # cProfile.runctx("Tree.generate_node_median(mesh, 3, args['max_cells'])", globals(), locals())
    tree = Tree.generate_node_median(mesh, args["depth"], args["max_cells"])
    return

    # split the mesh into blocks using the tree
    leaf_meshes = split_mesh_at_leaves(mesh, tree)

    # create new hdf5 file
    new_file = h5py.File(args["output"], "w")
    # write a new zone for each leaf block


if __name__ == "__main__":
    main()