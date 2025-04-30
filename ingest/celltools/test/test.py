import celltools
import numpy as np


assert celltools.hello_world() == "Hello world!", ".hello_world() incorrect"

point = np.array([1, 2, 3], dtype=np.float32)
pos = np.array([
    [0, 0, 0],
    [4, 4, 4],
    [0, 0, 0],
    [0, 0, 0],
], dtype=np.float32)
conn = np.array([
    [0, 1, 2, 3]
], dtype=np.uint32)

assert celltools.point_in_cell_bounds4(point, 0, pos, conn) == True, "point in bounds failed"

point = np.array([1, 2, 3], dtype=np.float32)
pos = np.array([
    [0, 0, 0],
    [0, 0, 4],
    [0, 4, 0],
    [4, 0, 0],
], dtype=np.float32)
conn = np.array([
    [0, 1, 2, 3]
], dtype=np.uint32)

assert celltools.point_in_cell_bounds4(point, 0, pos, conn) == True, "point in bounds 2 failed"

pos = np.array([
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
], dtype=np.float32)
conn = np.array([
    [0, 1, 2, 3]
], dtype=np.uint32)

assert celltools.cell_plane_check4(0, -1, 0, pos, conn) & 0b10 != 0, "cell plane check failed"

print("All tests passed!")