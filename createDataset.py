# createDataset.py
# creates a dataset using the function f
import numpy as np
import math

# name of output file
name = "sphere"

size = {
    "x": 16,
    "y": 16,
    "z": 16
}
data_type = np.uint8


# the function the dataset will created from
def f(x, y, z):
    return math.sqrt((x-8)**2 + (y-8)**2 + (z-8)**2)


# generate data
ext = ".raw"
folder = "data/"


def generate():
    out = np.empty(size["x"]*size["y"]*size["z"], dtype=data_type)
    for i in range(size["x"]):
        for j in range(size["y"]):
            for k in range(size["z"]):
                out[i * size["y"]*size["z"] + j * size["z"] + k] = f(i, j, k)

    with open(folder + name + ext, "wb") as file:
        file.write(out.data)


if __name__ == "__main__":
    generate()
