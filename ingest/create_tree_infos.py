import subprocess
import os
import argparse
import json
import time

def print_t_end(msg, start_t):
    print(msg % (time.time() - start_t))

def run_job(job, prog, force=False, verbose=False):

    job_cmd_parts = [prog, "./generate_block_mesh.py", job["file"], "-e"] 

    if job.get("decimate"): 
        job_cmd_parts.extend(["--decimate", str(job["decimate"])])
    if job.get("size"): 
        job_cmd_parts.extend(["--size-x", str(job["size"][0])])
        job_cmd_parts.extend(["--size-y", str(job["size"][1])])
        job_cmd_parts.extend(["--size-z", str(job["size"][2])])
    if job.get("type"):
        job_cmd_parts.extend(["--data-type", job["type"]])
    if job.get("noFiles"):
        job_cmd_parts.extend(["-n"])
    if job.get("verbose"):
        job_cmd_parts.extend(["-v"])
    if job.get("scalars"):
        job_cmd_parts.extend(["-s", *job["scalars"]])
        
    
    for i, cells in enumerate(job["cells"]):
        start_task = time.time()
        out_dir = job["out"] + "_" + str(cells)
        print("running task %i/%i" % (i + 1, len(job["cells"])))
        try:
            os.mkdir(out_dir)
        except FileExistsError:
            if not force:
                print("%s exists, skipping..." % out_dir)
                continue
        
        print("processing %s..." % out_dir)
        out_path = out_dir + "/"

        this_job_cmd_parts = job_cmd_parts[:]
        this_job_cmd_parts.extend(["-o", out_path])
        this_job_cmd_parts.extend(["-c", str(cells)])

        cmd =  " ".join(this_job_cmd_parts)

        if verbose: print("cmd: " + cmd)

        subprocess.run(cmd, shell=True)

        if verbose: print_t_end("Task done, took %fs", start_task)
    
    if verbose: print_t_end("Job done, took %fs", start_job)


def main():
    parser = argparse.ArgumentParser(prog="generate_block_mesh")
    parser.add_argument("--file", help="path to the cgns file to process")
    parser.add_argument("--out", help="path to the cgns file to process")
    parser.add_argument("--json", default=None, help="path to json job file")
    parser.add_argument("-v", action="store_true", help="verbose switch")
    parser.add_argument("-f", action="store_true", help="run task even if output folder exists")

    args = vars(parser.parse_args())

    try:
        subprocess.run("python3 --version")
        prog = "python3"
    except:
        subprocess.run("python --version")
        prog = "python"


    start_tot = time.time()
    # create the jobs
    if args["json"] is not None:
        # get jobs from json
        with open(args["json"]) as file:
            jobs = json.loads(file.read())
    else:
        # construct a default job from the input
        jobs = [{
            file: args["file"],
            out: args["out"],
            cells: [2048, 1024, 512, 256, 128]
        }]

    for i, job in enumerate(jobs):
        print("running job %i/%i" % (i + 1, len(jobs)))
        run_job(job, prog, args["f"], args["v"])
    
    if args["v"]: print_t_end("All jobs done, took %fs", start_tot)


if __name__ == "__main__":
    main()