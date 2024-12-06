import h5py
import argparse
import numpy as np


def charcodes_to_string(charcodes):
    return "".join(map(chr, charcodes))

class Mesh:
    box = {
        min: [0, 0, 0],
        max: [0, 0, 0]
    }

    def __init__(self, positions, connectivity, values):
        self.positions = positions
        self.connectivity = connectivity
        self.values = values

    def __str__(self):
        s = "Mesh object\n"
        s += f" {len(self.positions)} points\n"
        s += f" {len(self.connectivity)/4} cells\n"
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

        positions = np.array([
            coords_node["CoordinateX/ data"],
            coords_node["CoordinateY/ data"],
            coords_node["CoordinateZ/ data"],
        ]).transpose()

        # get the connectivity information, correcting for one based indexing
        connectivity = np.array(zone_node["GridElements/ElementConnectivity/ data"]) - 1

        values = {}
        for name in val_names:
            try:
                values[name] = np.array(zone_node["FlowSolution"][name][" data"])
            except:
                print("Couldn't load array", name)

        return Mesh(positions, connectivity, values)
    
    def calculate_box(self):
        self.box.min = self.positions[0]
        self.box.max = self.positions[0]

        for point in self.positions:
            self.box.min = np.minimum(self.box.min, point)
            self.box.max = np.maximum(self.box.max, point)
    
    def to_zone_node(self):
        pass



class Tree:
    def __init__(self, ):
        pass

    @staticmethod
    def generate_node_median(mesh, depth, max_cells):

        pass



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
    tree = Tree.generate_node_median(mesh, args["depth"], args["max_cells"])
    return

    # split the mesh into blocks using the tree
    leaf_meshes = split_mesh_at_leaves(mesh, tree)

    # create new hdf5 file
    new_file = h5py.File(args["output"], "w")
    # write a new zone for each leaf block


if __name__ == "__main__":
    main()