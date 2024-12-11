# tree.py
import numpy as np
from modules.utils import *


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
    def __init__(self, root, node_count, leaf_count, max_cells, total_cell_count):
        self.root = root
        self.node_count = node_count
        self.leaf_count = leaf_count
        self.max_cells = max_cells
        self.total_cell_count = total_cell_count

    # creates a packed buffer representation of the tree
    def serialise(self):
        # create the node buffer
        node_buffer = np.empty(self.node_count, dtype=self.node_dtype)
        cells_buffer = np.empty(self.total_cell_count, dtype=np.uint32)

        node_queue = [self.root]

        curr_ptr = 0
        curr_cells_ptr = 0

        while len(node_queue) > 0:
            node = node_queue.pop()
            node["this_ptr"] = curr_ptr

            node_buffer[curr_ptr]["split_val"] = node["split_val"]
            node_buffer[curr_ptr]["left_ptr"] = 0
            node_buffer[curr_ptr]["right_ptr"] = 0
            
            # write node to the buffer
            if node["cells"] is not None:
                node_buffer[curr_ptr]["cell_count"] = len(node["cells"])

                # write the cells data to that buffer
                cells_buffer[curr_cells_ptr : curr_cells_ptr + len(node["cells"])] = node["cells"]
                node_buffer[curr_ptr]["left_ptr"] = curr_cells_ptr
                curr_cells_ptr += len(node["cells"])
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
        
        return (node_buffer, cells_buffer)
            
            

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

        return Tree(root, processed, leaves_count, max_cell_count, cells_count_sum)
        
