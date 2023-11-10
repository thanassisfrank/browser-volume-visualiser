# blocks.py
# this program is used to create a file where blocks of data are more easily accessed

import numpy as np
import json
import sys
import time
import os
from vtkmodules.vtkIOXML import vtkXMLStructuredGridReader
from vtk.util import numpy_support as VN
# from vtk import vtkStructuredPointsReader
# from vtk.util import numpy_support as VN

# path = "data\silicium_98x34x34_uint8"
# ext = ".raw"

data_types = {
    "uint8": np.uint8,
    "float32": np.float32,
    "int16": np.int16
}
#define VTK_VOID            0
#define VTK_BIT             1
#define VTK_CHAR            2
#define VTK_SIGNED_CHAR    15
#define VTK_UNSIGNED_CHAR   3
#define VTK_SHORT           4
#define VTK_UNSIGNED_SHORT  5
#define VTK_INT             6
#define VTK_UNSIGNED_INT    7
#define VTK_LONG            8
#define VTK_UNSIGNED_LONG   9
#define VTK_FLOAT          10
#define VTK_DOUBLE         11
#define VTK_ID_TYPE        12
#define VTK_STRING         13
#define VTK_OPAQUE         14
#define VTK_LONG_LONG          16
#define VTK_UNSIGNED_LONG_LONG 17
#define VTK___INT64            18
#define VTK_UNSIGNED___INT64   19
vtk_to_str = {
    10: "float32",
    2: "uint8",
    4: "int16"
}

blockSize = {
    "x": 4,
    "y": 4,
    "z": 4
}

block_vol = blockSize["x"] * blockSize["y"] * blockSize["z"]


def getIndex(x, y, z, size):
    return x * size["y"] * size["z"] + y * size["z"] + z


# size is the dimensions of the dataset, blocksSize in blocks
# stride is number of commponents per element
def create_blocks_file(data, size, blocks, stride, name):
    # get size in blocks
    

    # create output buffer
    output = np.empty(
        blocks["x"] * blocks["y"] * blocks["z"] * block_vol * stride,
        dtype=data.dtype
    )
    print("starting blocks translation process")
    start_time = time.time()
    # keeps a track of the index in the output
    out_ind = 0
    # loop through each block and get its limits
    for i_b in range(blocks["x"]):
        for j_b in range(blocks["y"]):
            for k_b in range(blocks["z"]):
                # loop through all cells in each block
                for i_l in range(blockSize["x"]):
                    for j_l in range(blockSize["y"]):
                        for k_l in range(blockSize["z"]):
                            i = i_l + i_b * blockSize["x"]
                            j = j_l + j_b * blockSize["y"]
                            k = k_l + k_b * blockSize["z"]
                            index = getIndex(
                                min(i, size["x"] - 1), 
                                min(j, size["y"] - 1), 
                                min(k, size["z"] - 1),
                                size
                            )

                            for x in range(stride):
                                output[stride*out_ind + x] = data[stride*index + x]

                            out_ind += 1
        print("\r" + "%.1f" % (i_b/(size["x"]-1)*100) + "% complete", end="")

    print("\nwriting to file")
    print("took " + "%.1f" % (time.time()-start_time) + "s")
    # save to binary file
    with open(name, "wb") as file:
        file.write(output.data)

    print("blocks file generation complete")


def create_limits_file(data, size, blocks, name, get_limits=False):
    # create output buffer
    output = np.empty([blocks["x"] * blocks["y"] * blocks["z"], 2], dtype=data.dtype)

    print("starting limits generation")
    start_time = time.time()
    # loop through each block and get its limits
    for i_b in range(blocks["x"]):
        for j_b in range(blocks["y"]):
            for k_b in range(blocks["z"]):
                limits = [None, None]
                index_b = getIndex(i_b, j_b, k_b, blocks)
                # loop through datapoints local to each block
                # goes through all points contained within that block
                # and also the points on the outside of the block as if the
                # threshold is crossed at the boundary then this block will
                # be needed
                for i_l in range(-1, blockSize["x"] + 1):
                    for j_l in range(-1, blockSize["y"] + 1):
                        for k_l in range(-1, blockSize["z"] + 1):
                            i = i_l + i_b * blockSize["x"]
                            j = j_l + j_b * blockSize["y"]
                            k = k_l + k_b * blockSize["z"]
                            if i < 0 or j < 0 or k < 0:
                                continue
                            elif i >= size["x"] or j >= size["y"] or k >= size["z"]:
                                continue
                            index = getIndex(i, j, k, size)
                            val = data[index]
                            # if (index_b == 16 + 24*8):
                            #     print(val)
                            if limits[0] is None or val < limits[0]:
                                limits[0] = val
                            if limits[1] is None or val > limits[1]:
                                limits[1] = val
                if not limits[1]:
                    limits[1] = limits[0]
                output[index_b] = limits
        print("\r" + "%.1f" % (i_b/(blocks["x"]-1)*100) + "% complete", end="")

    print()
    print("complete")
    print("took " + "%.1f" % (time.time()-start_time) + "s")

    # get overall limits for file
    overall_limits = [None, None]
    if get_limits:
        for i in range(blocks["x"] * blocks["y"] * blocks["z"]):
            low = output[i][0]
            high = output[i][1]
            if overall_limits[0] is None or low < overall_limits[0]:
                overall_limits[0] = low
            if overall_limits[1] is None or high > overall_limits[1]:
                overall_limits[1] = high

        print("low limit:", overall_limits[0])
        print("high limit:", overall_limits[1])

    # save to binary file
    with open(name, "wb") as file:
        file.write(output.data)

    print("limits file generation successful")
    return overall_limits


def create_raw_file(data, name):
    with open(name, "wb") as file:
        file.write(data)


def process_raw_file(data_info):
    try:
        size = data_info["size"]
        data_type_str = data_info["dataType"]
        data_type = data_types[data_type_str]
        path, ext = data_info["path"].split(".")
    except KeyError:
        print("Error: required dataset info not all supplied")
        return

    # load data in buffer
    try:
        file_path = "static/" + path + "." + ext
        print("file path: " + file_path)
        data = np.frombuffer(open(file_path, "rb").read(), dtype=data_type)
    except OSError:
        print("could not find file")
        return

    blocks = {
        "x": int(np.ceil(size["x"]/blockSize["x"])),
        "y": int(np.ceil(size["y"]/blockSize["y"])),
        "z": int(np.ceil(size["z"]/blockSize["z"]))
    }

    data_info["blocksSize"] = blocks

    create_blocks_file(data, size, blocks, 1, "static/" + path + "_blocks" + "." + ext)
    
    limits = create_limits_file(data, size, blocks, "static/" + path + "_limits" + "." + ext, get_limits=True)

    data_info["limits"] = [float(x) for x in limits]

    # set the origin
    if "cellSize" in data_info:
        cell_size = data_info["cellSize"]
    else:
        cell_size = [1, 1, 1]
        
    data_info["origin"] = [
        (size["x"]-1)/2*cell_size["x"], 
        (size["y"]-1)/2*cell_size["y"], 
        (size["z"]-1)/2*cell_size["z"]
    ]
    data_info["complexAvailable"] = True

    return data_info


def getArrayNames(point_data):
    i = 0
    names = []
    while True:
        try:
            attribute = point_data.GetAttribute(i)
            if attribute.GetNumberOfComponents() == 1:
                names.append(attribute.GetName())
        except:
            break

        i += 1

    return names
    
def process_structured_grid_file(data_info):
    # clear the complex data
    data_info["pieces"] = []
    data_info["data"] = {}

    print(data_info)

    # for now, each file assumed to contain one piece
    piece_count = len(data_info["originalFiles"])
    piece_num = 0

    chosen_attr_name = None
    # for each original file containing one block each
    for i in range(len(data_info["originalFiles"])):
        piece_num = i
        original_path, ext = ("static/" + data_info["path"] + data_info["originalFiles"][i]).split(".")
        reader = vtkXMLStructuredGridReader()

        reader.SetFileName(original_path + "." + ext)
        reader.Update()
        data = reader.GetOutput()

        # print(data)
        # points_info = data.GetPoints()

        size_list = data.GetDimensions()
        size = {
            "x": size_list[2],
            "y": size_list[1],
            "z": size_list[0]
        }

        blocks = {
            "x": int(np.ceil(size["x"]/blockSize["x"])),
            "y": int(np.ceil(size["y"]/blockSize["y"])),
            "z": int(np.ceil(size["z"]/blockSize["z"]))
        }

        positions = np.zeros(data.GetNumberOfPoints()*3, np.float32)
        for j in range(data.GetNumberOfPoints()):
            positions[3*j:3*j + 3] = data.GetPoint(j)
        
        # create the piece entry in json file
        data_info["pieces"].append({
            "fileName": data_info["originalFiles"][i].split(".")[0],
            "size": size,
            "blocksSize": blocks
        })     

        # convert the positions
        create_blocks_file(positions, size, blocks, 3, original_path + "_positions_blocks.raw")
        create_raw_file(positions, original_path + "_positions.raw")

        # convert point data
        # get the names of the attributes
        array_names = getArrayNames(data.GetPointData())

        # TODO: let attribute be chosen
        if chosen_attr_name is None:
            chosen_attr_name = array_names[0]
            array = data.GetPointData().GetArray(chosen_attr_name)
            data_info["data"][chosen_attr_name] = {
                "name": chosen_attr_name,
                "limits": array.GetRange(),
                "dataType": vtk_to_str[array.GetDataType()],
                "components": array.GetNumberOfComponents()
            }

        point_data = VN.vtk_to_numpy(data.GetPointData().GetArray(chosen_attr_name))
        # print(data.GetPointData().attributeNames)
        create_raw_file(point_data, original_path + "_" + chosen_attr_name + ".raw")
        create_blocks_file(point_data, size, blocks, 1, original_path + "_" + chosen_attr_name + "_blocks.raw")
        create_limits_file(point_data, size, blocks, original_path + "_" + chosen_attr_name + "_limits.raw")

    # update the json file

    # set the origin
    data_info["origin"] = [0, 0, 0]
    data_info["complexAvailable"] = True

    return data_info




def main(data_name):
    # load data info from dataset name
    with open("static/data/datasets.json", "r") as file:
        datasets = json.loads(file.read())

    data_info = None
    try:
        data_info = datasets[data_name]
    except KeyError:
        # exit if something is wrong
        print("sorry, dataset does not exist in datsets.json or is malformed")
        return

    dataset_type = data_info["type"]  # raw/structured grid

    new_data_info = None

    if dataset_type == "raw":
        new_data_info = process_raw_file(data_info)
    elif dataset_type == "structuredGrid":
        new_data_info = process_structured_grid_file(data_info)
    else:
        print("unsupported file type")
    if new_data_info is not None:
        print(new_data_info)
        # write updated entry into config file
        with open("static/data/datasets.json", "w") as file:
            file.write(json.dumps(datasets, indent="\t"))


if __name__ == "__main__":
    args = sys.argv
    if args[0] == os.path.basename(__file__):
        if len(args) == 1:
            print("run with dataset name as argument")
        else:
            main(args[1])
    else:
        main(args[0])
    input("...press any key to exit...")
