import subprocess
import os
import argparse

cell_counts = [64, 128, 256, 512, 1024, 2048]

def main():
    parser = argparse.ArgumentParser(prog="generate_block_mesh")
    parser.add_argument("file-path", help="path to the cgns file to process")
    parser.add_argument("out", help="path to the cgns file to process")

    args = vars(parser.parse_args())

    for i, cells in enumerate(cell_counts):
        out_dir = args["out"] + "_" + str(cells)
        print("running %i/%i" % (i + 1, len(cell_counts)))
        try:
            os.mkdir(out_dir)
        except FileExistsError:
            print("%s exists, skipping..." % out_dir)
            continue
        
        print("processing %s..." % out_dir)
        out_path = out_dir + "/"
        subprocess.run(
            "python generate_block_mesh.py %s -e -n -s none -o %s -c %s" % 
            (args["file-path"], out_path, cells)
        )

if __name__ == "__main__":
    main()