# limits.py
# this program is used to create binary files for a dataset that encodes the range of values each block contains

import numpy as np
import json
import sys
import time

# path = "data\silicium_98x34x34_uint8"
# ext = ".raw"

data_types = {
    "uint8": np.uint8,
    "float32": np.float32,
    "int16": np.int16
}


blockSize = {
    "x": 4,
    "y": 4,
    "z": 4
}


def getIndex(x, y, z, size):
    return x * size["y"] * size["z"] + y * size["z"] + z


def main(data_name):
    # load data info from dataset name
    datasets = json.loads(open("static/data/datasets.json", "r").read())
    try:
        data_info = datasets[data_name]
        size = data_info["size"]
        data_type_str = data_info["dataType"]
        data_type = data_types[data_type_str]
        path, ext = data_info["path"].split(".")
    except KeyError:
        # exit if something is wrong
        print("sorry, dataset does not exist in datsets.json or is malformed")
        return

    blocks = {
        "x": size["x"]//blockSize["x"],
        "y": size["y"]//blockSize["y"],
        "z": size["z"]//blockSize["z"]
    }

    # load data in buffer
    try:
        file_path = "static/" + path + "." + ext
        print("file path: " + file_path)
        data = np.frombuffer(open(file_path, "rb").read(), dtype=data_type)
    except OSError:
        print("could not find file")
        return

    # create output buffer
    output = np.empty([blocks["x"] * blocks["y"] * blocks["z"], 2], dtype=data_type)

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
    with open("static/" + path + "_limits" + "." + ext, "wb") as file:
        file.write(output.data)

    print("limits file generation successful")


if __name__ == "__main__":
    args = sys.argv
    if args[0] == "limits.py":
        main(args[1])
    else:
        main(args[0])
    input("...press any key to exit...")
