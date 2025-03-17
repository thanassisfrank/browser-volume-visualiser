# leaf_mesh.py
import cProfile
from modules.utils import *
from modules.mesh import Mesh
import celltools


def get_containing_cell(pos, node, mesh, tree):
    m_con = np.reshape(mesh.connectivity, (-1, 4))
    m_pos = mesh.positions
    cell = {}

    cells = tree.cell_buffer[node["left_ptr"] : node["left_ptr"] + node["cell_count"]]
    for cell_id in cells:        
        if not celltools.point_in_cell_bounds4(pos, cell_id, m_pos, m_con): continue

        cell["points_indices"] = m_con[cell_id]
        cell["points"] = m_pos[cell["points_indices"]]

        cell["factors"] = point_in_tet_det(pos, cell)
        if not any(cell["factors"]) : continue

        return cell
    
    # no containing cell found
    return None


def sample_vals_with_cell(vals, cell):
    return np.dot(vals[cell["points_indices"]], cell["factors"])


def get_leaf_corner_vals(mesh, vals, node, box, tree):
    corner_vals = np.empty(8, dtype=np.float32)

    points = [
        np.array(box["min"], np.float32),
        np.array([box["max"][0], box["min"][1], box["min"][2]], dtype=np.float32),
        np.array([box["min"][0], box["max"][1], box["min"][2]], dtype=np.float32),
        np.array([box["max"][0], box["max"][1], box["min"][2]], dtype=np.float32),
        np.array([box["min"][0], box["min"][1], box["max"][2]], dtype=np.float32),
        np.array([box["max"][0], box["min"][1], box["max"][2]], dtype=np.float32),
        np.array([box["min"][0], box["max"][1], box["max"][2]], dtype=np.float32),
        np.array(box["max"], np.float32),
    ]
    for i, point in enumerate(points):
        cell = get_containing_cell(point, node, mesh, tree)
        if cell is not None:
            corner_vals[i] = sample_vals_with_cell(vals, cell)
            continue
        

        # // use the nearest vertex instead
        # const vert = tree.getClosestVertexInLeaf(point, leafNode);
        # if (vert.index !== undefined) {
        #     cornerVals[i] = dataBuff[vert.index];
        #     continue;
        # }

        # leaf likely has no cells, default to 0
        corner_vals[i] = 0
    
    return corner_vals


def merge_corner_vals(corner_vals, split_dim, left_ptr, right_ptr):
    left_corners = corner_vals[left_ptr]
    right_corners = corner_vals[right_ptr]
    this_corners = np.empty(8, dtype=np.float32)

    # select which is coincident with the parent node's corners
    for i in range(8):
        if (i >> split_dim & 1) == 1:
            this_corners[i] = right_corners[i]
        else:
            this_corners[i] = left_corners[i]
    
    return this_corners


# generates corner values for a single values buffer
def generate_corner_values_buffer(mesh, vals, tree):
    node_buffer = tree.node_buffer
    corner_vals = np.empty((tree.node_count, 8), dtype=np.float32)

    # the next nodes to process
    queue = [ 
        {
            "node": node_buffer[0],
            "index": 0,
            "box": copy_box(mesh.box),
            "depth": 0,
            "merge": False
        }
    ]
    processed = 0
    while len(queue) > 0:
        processed += 1
        item = queue.pop()

        if item["node"]["right_ptr"] == 0:
            # get the corner values for this box and write to buffer
            # cProfile.runctx("get_leaf_corner_vals(mesh, vals, item['node'], item['box'], tree)", globals(), locals())
            # input()
            corner_vals[item["index"]] = get_leaf_corner_vals(
                mesh, 
                vals, 
                item["node"], 
                item["box"], 
                tree
            )
            
        elif not item["merge"]:
            # going down
            # push itself to handle going back up the tree
            queue.append({
                "node": item["node"],
                "index": item["index"],
                "box": item["box"],
                "depth": item["depth"],
                "merge": True
            })

            # add its children to the next nodes
            left_node  = node_buffer[item["node"]["left_ptr"]]
            left_box = copy_box(item["box"])
            left_box["max"][item["depth"]%3] = item["node"]["split_val"]
            queue.append({
                "node": left_node,
                "index": item["node"]["left_ptr"],
                "box": left_box,
                "depth": item["depth"] + 1,
                "merge": False
            })

            right_node = node_buffer[item["node"]["right_ptr"]]
            right_box = copy_box(item["box"])
            right_box["min"][item["depth"]%3] = item["node"]["split_val"]
            queue.append({
                "node": right_node,
                "index": item["node"]["right_ptr"],
                "box": right_box,
                "depth": item["depth"] + 1,
                "merge": False
            })

        else:
            # going back up
            # calculate the node corners from its children
            split_dim = item["depth"] % 3

            corner_vals[item["index"]] = merge_corner_vals(
                corner_vals, 
                split_dim, 
                item["node"]["left_ptr"],
                item["node"]["right_ptr"]
            )

    return corner_vals

# externally called to generate all needed from the values that are in the mesh
def generate_corner_values(mesh, tree):
    return {
        name: generate_corner_values_buffer(mesh, mesh.values[name], tree)
        for name in mesh.values
    }




# node value ranges =============================================================
def get_leaf_node_range(mesh, vals, node, tree):
    range_vals = np.empty(2, dtype=np.float32)
    m_con = np.reshape(mesh.connectivity, (-1, 4))

    cells = tree.cell_buffer[node["left_ptr"] : node["left_ptr"] + node["cell_count"]]
    # initialise range
    first_val = vals[m_con[cells[0]][0]]
    range_vals[0] = first_val
    range_vals[1] = first_val

    for cell_id in cells:        
        indices = m_con[cell_id]
        cell_vals = vals[indices]
        for val in cell_vals:
            if range_vals[0] > val: range_vals[0] = val
            if range_vals[1] < val: range_vals[1] = val

    return range_vals


def merge_node_range_vals(range_vals, left_ptr, right_ptr):
    left_range = range_vals[left_ptr]
    right_range = range_vals[right_ptr]

    return np.array([
        min(left_range[0], right_range[0]),
        max(left_range[1], right_range[1]),
    ], dtype=np.float32)


def generate_node_val_range_buffer(mesh, vals, tree):
    node_buffer = tree.node_buffer
    node_range_vals = np.empty((tree.node_count, 2), dtype=np.float32)

    # the next nodes to process
    queue = [ 
        {
            "node": node_buffer[0],
            "index": 0,
            "depth": 0,
            "merge": False
        }
    ]
    processed = 0
    while len(queue) > 0:
        processed += 1
        item = queue.pop()

        if item["node"]["right_ptr"] == 0:
            # get the range for this leaf
            node_range_vals[item["index"]] = get_leaf_node_range(mesh, vals, item["node"], tree)
            
        elif not item["merge"]:
            # going down
            # push itself to handle going back up the tree
            queue.append({
                "node": item["node"],
                "index": item["index"],
                "depth": item["depth"],
                "merge": True
            })

            # add its children to the next nodes
            left_node  = node_buffer[item["node"]["left_ptr"]]
            queue.append({
                "node": left_node,
                "index": item["node"]["left_ptr"],
                "depth": item["depth"] + 1,
                "merge": False
            })

            right_node = node_buffer[item["node"]["right_ptr"]]
            queue.append({
                "node": right_node,
                "index": item["node"]["right_ptr"],
                "depth": item["depth"] + 1,
                "merge": False
            })

        else:
            # going back up
            # calculate the node corners from its children
            split_dim = item["depth"] % 3

            node_range_vals[item["index"]] = merge_node_range_vals(
                node_range_vals, 
                item["node"]["left_ptr"],
                item["node"]["right_ptr"]
            )

    return node_range_vals

def generate_node_val_ranges(mesh, tree):
    return {
        name: generate_node_val_range_buffer(mesh, mesh.values[name], tree)
        for name in mesh.values
    }
    

# splits the given mesh into the blocks for each leaf node
def split_mesh_at_leaves(mesh, tree):
    block_meshes = []

    block_node_buff = np.array(tree.node_buffer, copy=True)

    curr_leaf_index = 0

    # iterate through nodes, check for leaf
    for i in range(tree.node_count):
        node = tree.node_buffer[i]
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

        this_cells = tree.cell_buffer[cells_ptr : cells_ptr + node["cell_count"]]


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

        
        block_meshes.append(Mesh(block_pos_buff, block_con_buff, block_values, id=i))

    return block_meshes
