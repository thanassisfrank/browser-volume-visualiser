# app.py 
# the http server written in python
from fileinput import filename
import os
import sys
import json
import threading
import socketserver
import socket
import numpy as np
from http.server import *
import time

HOST_ADDRESS = "localhost"

static_path = "static/"
file_types = None
datasets = None

file_manager = None

# deals with loading and unloading files, managing the total memory available
# opening/closing files will be dine through this
class loadedFileManager:

    access_modes = ["r", "rb"]

    def __init__(self, allowed_bytes):
        # a directory of every file loaded by path and mode
        self.files = {}
        # a queue of files in order to be removed
        # last item is first to be removed
        # only contains files that are currently cached
        # an LRU scheme is used
        self.file_queue = []
        self.queue_lock = threading.Lock()

        # total allowed storage space
        self.allowed_bytes = allowed_bytes
        self.loaded_bytes = 0
        self.loaded_bytes_lock = threading.Lock()

    
    # creates a new blank entry for a file
    def createEntry(self):
        # the entry kept for each file 
        # file:           cached contents of the file
        # users:          current amount of users reading from the cached file
        # being_modified: a lock which indicates if user count if being modified or file loaded
        # in_use:         lock to indicate if file is being read from, released when users = 0
        return {
            "file": None,
            "users": 0,
            "bytes_size": 0,
            "being_modified": threading.Lock(),
            "in_use": threading.Lock()
        }


    def __getQueueKey(self, path, mode):
        return path + " " + mode


    def __exists(self, path, mode):
        return path in self.files and mode in self.files[path]


    def __addUser(self, path, mode):
        if self.files[path][mode]["users"] == 0:
            self.files[path][mode]["in_use"].acquire()
        self.files[path][mode]["users"] += 1
    

    def __removeUser(self, path, mode):
        self.files[path][mode]["users"] -= 1
        if self.files[path][mode]["users"] == 0:
            self.files[path][mode]["in_use"].release()


    def __loadFile(self, path, mode):
        # get the size of the file to load
        try:
            self.files[path][mode]["bytes_size"] = os.path.getsize(path)
        except:
            print("path '" + path + "' not found")
            return None
        # check if it fits in total space
        if self.files[path][mode]["bytes_size"] > self.allowed_bytes:
            print("file too large to load")
            return None
        # unload files until enough space has been freed
        self.loaded_bytes_lock.acquire()
        self.queue_lock.acquire()

        while True:
            if self.files[path][mode]["bytes_size"] + self.loaded_bytes < self.allowed_bytes:
                # enough free space, load the file
                file = open(path, mode)
                newFile = file.read()
                file.close()
                # add to the currently loaded bytes total
                self.loaded_bytes += self.files[path][mode]["bytes_size"]
                break
            # pop the last file from the file queue
            try:
                unload_path, unload_mode = self.file_queue.pop().split(" ")
                self.__unloadFile(unload_path, unload_mode)
                self.loaded_bytes -= self.files[unload_path][unload_mode]["bytes_size"]
            except:
                # likely, file queue is empty
                print("error freeing file space")
                newFile = None
                break

        if newFile is not None:
            # add a new entry to the queue
            self.file_queue.insert(0, self.__getQueueKey(path, mode))
        self.loaded_bytes_lock.release()
        self.queue_lock.release()

        return newFile

        

    def __unloadFile(self, path, mode):
        if not self.__exists(path, mode):
            return None
        
        entry = self.files[path][mode]
        # wait for the file to not be in use
        entry["in_use"].acquire()
        # clear cached file contents
        entry["file"] = None
        entry["in_use"].release()


    def getFile(self, path, mode):
        # check if entry exists
        if path not in self.files:
            self.files[path] = {}
        # check if required mode is there
        if mode not in self.files[path]:
            self.files[path][mode] = self.createEntry()

        # add another user to this file
        self.files[path][mode]["being_modified"].acquire()
        
        if self.files[path][mode]["file"] is None:
            # file not loaded, load
            newFile = self.__loadFile(path, mode)
            if newFile is None:
                print("error loading file " + path + " " + mode)
                # delete the entry for this path + mode
                del self.files[path][mode]
            else:
                # cache the result
                self.__addUser(path, mode)
                self.files[path][mode]["file"] = newFile
                self.files[path][mode]["being_modified"].release()
            return newFile
        else:
            # file is already loaded
            self.__addUser(path, mode)
            self.files[path][mode]["being_modified"].release()
            return self.files[path][mode]["file"]


    # called when the file is no longer in use by a thread
    def releaseFile(self, path, mode):
        # check if file is managed
        if path not in self.files or mode not in self.files[path]:
            print("file not stored")
            return None

        self.files[path][mode]["being_modified"].acquire()
        self.__removeUser(path, mode)
        self.files[path][mode]["being_modified"].release()


# files = json.loads(open("files.json", "r").read())
struct_data_formats = {
    "float32": "f",
    "uint8": "c",
    "int16": "a"
}

np_data_formats = {
    "uint8": np.uint8,
    "float32": np.float32,
    "int16": np.int16
}


files_loaded = {
    
}


def get_index(x, y, z, size):
    return x * size["y"] * size["z"] + y * size["z"] + z


def get_pos(i, size):
    return (
        i//(size["y"]*size["z"]),
        (i//size["z"]) % size["y"],
        i % size["z"]
    )




# this is a simple http request handler class using the http.server interface
class requestHandler(BaseHTTPRequestHandler):
    # method to handle requests for static files
    # the paths in the url directly translate to files under the static_path attribute
    def do_GET(self):
        # file_name = self.path[1:]
        # try:
        # get the extension from the file
        extension = self.path.split(".")[1]
        file_desc = file_types[extension]
        full_path = static_path + self.path[1:]
        print(full_path)
        # if not file_desc:
        #     raise OSError("file not in directory")
        try:
            if file_desc["encoding"]:
                file = open(full_path, "r")
                self.send_response(200)
                self.send_header("content-type", file_desc["contentType"])
                self.end_headers()
                print(file_desc["encoding"])
                self.wfile.write(bytes(file.read(), file_desc["encoding"]))
                print("done")
                file.close()
            else:
                file = open(full_path, "rb")
                self.send_response(200)
                self.send_header("content-type", file_desc["contentType"])
                self.end_headers()
                self.wfile.write(file.read())
                file.close()
        except:
            self.send_response(404)
            self.end_headers()

    # POST is used to transfer data to the client
    # requests are only valid to the /data path
    # the body of data requests is in JSON form:
    # {
    #   *name: {dataset name},
    #   *mode: "whole"/"threshold"/£blocks,
    #   cellScale: int,
    #   threshold: float,
    #   blocks: array<int>
    # }
    def do_POST(self):
        if self.path == "/data":
            # the POST query is to the correct path
            # gets the size of the POST body
            content_length = int(self.headers['Content-Length'])
            if content_length > 0:
                # reads POST body to a dict
                start_time = time.time()
                request = json.loads(self.rfile.read(content_length))
                print("json took " + "%.3f" % (time.time()-start_time) + "s")
                # check if the name given corresponds to a dataset
                if request["name"] in datasets:
                    if request["mode"] == "whole":
                        # a version of the whole dataset is required
                        self.handleWholeDataRequest(request)
                        return
                    # elif request["mode"] == "threshold":
                    #     # just data around the threshold
                    #     self.handleThresholdDataRequest(request)
                    #     return
                    elif request["mode"] == "blocks":
                        # just data around the threshold
                        self.handleBlocksDataRequest(request)
                        return
        # if failed at any point, its a bad request (400)
        self.send_response(400)
        self.end_headers()

    # method called when the client sends a POST request for the whole data at a
    # particular resolution (cellScale)
    def handleWholeDataRequest(self, request):
        # get dataset info
        data_info = datasets[request["name"]]

        stride = 1
        # check if its point data
        if ("fileName" in request) and ("points" in request) and request["points"]:
            # if it is, set stride = 3
            stride = 3
            file_name = request["fileName"]

            for piece in data_info["pieces"]:
                if piece["fileName"] == request["fileName"]:
                    size = piece["size"]
            
            data_type = np.float32  # points always float for now ================================

            path = static_path + data_info["path"] + file_name + "_positions.raw"
        # check for filename and data
        elif ("fileName" in request) and ("data" in request):
            # is from a sg dataset
            file_name = request["fileName"]
            data_name = request["data"]
            stride = data_info["data"][data_name]["components"]

            for piece in data_info["pieces"]:
                if piece["fileName"] == request["fileName"]:
                    size = piece["size"]

            data_type = np_data_formats[data_info["data"][data_name]["dataType"]]
            path = static_path + data_info["path"] + file_name + "_" + data_name + ".raw"
        else:
            path = static_path + data_info["path"]
            size = data_info["size"]
            data_type = np_data_formats[data_info["dataType"]]

        print(path)
        # load the dataset TODO: load chunks at a time
        file = open(path, "rb")
        if request["cellScale"] == 1:
            self.send_response(200)
            self.send_header("content-type", "applcation/octet-stream")
            self.end_headers()
            # if the cell scale is 1, the whole data is needed
            self.wfile.write(file.read())
            file.close()
        else:
            # else need to send only requested bytes
            cs = request["cellScale"]
            
            # get size of reduced data
            size_red = {
                "x": int(np.floor(size["x"]/request["cellScale"])),
                "y": int(np.floor(size["y"]/request["cellScale"])),
                "z": int(np.floor(size["z"]/request["cellScale"]))
            }
            vol_red = int(size_red["x"]*size_red["y"]*size_red["z"]*stride)

            # load bytes into an array of the correct type
            
            data = np.frombuffer(file.read(), dtype=data_type)
            output = np.empty(vol_red, dtype=data_type)

            # if data_info["dataType"] == "float32":
            #     data = np.frombuffer(file.read(), dtype=np.float32)
            #     output = np.empty(vol_red, dtype=np.float32)
            # elif data_info["dataType"] == "uint8":
            #     data = np.frombuffer(file.read(), dtype=np.uint8)
            #     output = np.empty(vol_red, dtype=np.uint8)
            
            file.close()

            # extract the correct values and package into the output
            for i in range(size_red["x"]):
                for j in range(size_red["y"]):
                    for k in range(size_red["z"]):
                        for x in range(stride):
                            val = data[(i*cs * size["y"] * size["z"] + j*cs * size["z"] + k*cs)*stride + x]
                            output[int(i * size_red["y"] * size_red["z"] + j * size_red["z"] + k)*stride + x] = val
            
            self.send_response(200)
            self.send_header("content-type", "applcation/octet-stream")
            self.end_headers()
            
            # write to the output stream
            self.wfile.write(output.data)

    def handleThresholdDataRequest(self, request):
        data_info = datasets[request["name"]]
        # load the dataset TODO: load chunks at a time
        data_file = open(static_path + data_info["path"], "rb")
        path = static_path + data_info["path"].split(".")[0] + "_limits.raw"
        limits_file = open(path, "rb")


        # load bytes into am array of the correct type
        data_type = np_data_formats[data_info["dataType"]]
        # if data_info["dataType"] == "float32":
        #     data_type = np.float32
        # elif data_info["dataType"] == "uint8":
        #     data_type = np.uint8

        data = np.frombuffer(data_file.read(), dtype=data_type)
        limits = np.frombuffer(limits_file.read(), dtype=data_type)

        blockSize = {
            "x": 4,
            "y": 4,
            "z": 4
        }

        blocks = {
            "x": data_info["size"]["x"]//blockSize["x"],
            "y": data_info["size"]["y"]//blockSize["y"],
            "z": data_info["size"]["z"]//blockSize["z"]
        }

        limits.shape = (blocks["x"]*blocks["y"]*blocks["z"], 2)

        # active_ids = []
        fine_data = []

        l = 0
        r = 0
        for i_b in range(blocks["x"]):
            for j_b in range(blocks["y"]):
                for k_b in range(blocks["z"]):
                    # get index of current block in the limits list
                    index_b = get_index(i_b, j_b, k_b, blocks)
                    # extract the left and right values of the interval
                    # for that block
                    l = limits[index_b][0]
                    r = limits[index_b][1]
                    # if the threshold is not within the limits for this block
                    # continue onto the next block
                    if l > request["threshold"] or r < request["threshold"]:
                        continue
                    # loop through datapoints local to each block that is
                    # active and add to fine_data
                    for i_l in range(blockSize["x"]):
                        for j_l in range(blockSize["y"]):
                            for k_l in range(blockSize["z"]):
                                i = i_l + i_b * blockSize["x"]
                                j = j_l + j_b * blockSize["y"]
                                k = k_l + k_b * blockSize["z"]
                                index = get_index(i, j, k, data_info["size"])
                                fine_data.append(data[index])

        self.send_response(200)
        self.send_header("content-type", "applcation/octet-stream")
        self.end_headers()
        
        self.wfile.write(np.array(fine_data, dtype=data_type).data)
        data_file.close()
        limits_file.close()


    def handleBlocksDataRequest(self, request):
        start_time = time.time()
        data_info = datasets[request["name"]]
        # load the dataset TODO: load chunks at a time
        
        stride = 1
        # check if its point data
        if ("fileName" in request) and ("points" in request) and request["points"]:
            # if it is, set stride = 3
            stride = 3
            file_name = request["fileName"]
            path = static_path + data_info["path"] + file_name + "_positions_blocks.raw"
            data_type = np.float32
        # check for filename and data
        elif ("fileName" in request) and ("data" in request):
            # is from a sg dataset
            file_name = request["fileName"]
            data_name = request["data"]
            stride = data_info["data"][data_name]["components"]
            path = static_path + data_info["path"] + file_name + "_" + data_name + "_blocks.raw"
            data_type = np_data_formats[data_info["data"][data_name]["dataType"]]
        else:
            path = static_path + data_info["path"].split(".")[0] + "_blocks.raw"
            data_type = np_data_formats[data_info["dataType"]]


        # data_file = open(path, "rb")
        data_file = file_manager.getFile(path, "rb")

        data = np.frombuffer(data_file, dtype=data_type)

        blockSize = {
            "x": 4,
            "y": 4,
            "z": 4
        }
        block_vol = blockSize["x"] * blockSize["y"] * blockSize["z"]

        # active_ids = []
        fine_data = np.empty(len(request["blocks"])*blockSize["x"]*blockSize["y"]*blockSize["z"]*stride, dtype=data_type)

        
        for i in range(len(request["blocks"])):
            id = request["blocks"][i]
            if type(id) is not int:
                print(type(id))
                continue
            fine_data[i*block_vol*stride:(i+1)*block_vol*stride] = data[id*block_vol*stride:(id+1)*block_vol*stride]

        
        print("for", len(request["blocks"]), "blocks")
        self.send_response(200)
        self.send_header("content-type", "applcation/octet-stream")
        self.end_headers()
        
        #print(fine_data[:40])
        self.wfile.write(fine_data.data)

        # data_file.close()
        file_manager.releaseFile(path, "rb")
        print("took " + "%.3f" % (time.time()-start_time) + "s")

def main():
    global file_types, datasets, file_manager
    file_types = json.loads(open("fileTypes.json", "r").read())
    datasets = json.loads(open(static_path + "data/datasets.json", "r").read())
    # create manager for all the files that will be loaded
    file_manager = loadedFileManager(1e9)
    # create a server object and tell it to listen on current local ip at port 
    # uses the request handler class defined above
    port = 8080
    # server = socketserver.ThreadingTCPServer(("localhost", port), requestHandler)
    server = ThreadingHTTPServer((HOST_ADDRESS, port), requestHandler)
    try:
        # print where the server is listening on
        print("server listening on: %s:%s" % (server.server_address[0], server.server_port))
        # run the server
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        server.server_close()
        print("server closed")
        sys.exit()


if __name__ == "__main__":
    main()

# HTTP server
#   will serve the static files
#   will handle the connection upgrade to WS
#
# WS server
#   send information about datasets (stored in JSON)
#       overall size
#       cell dimensions
#       dataType
#   purpose is to send data or parts of the dataset needed by the client
#   able to send the whole dataset at a given grid resolution
#   able to send small bits too in one form or another
#
# Data management
#   way to map threshold values to specific cells or blocks of data
#   create optimised datastructures to search through
#       span space
#       interval table
#       octree

# Program flow
#   setup:
#      client joins and gets the correct static files
#      sets up environment
#      user selects a dataset to use
#      sends a request to the server for a coarse view of the whole dataset
#          dataset name
#          required cell scale (calculated on client based on availale space)
#              maybe just dedicate one buffer to coarse and one for fine part
#      server responds and data is stored in a coarse dataset buffer
#   marching:
#       coarse grid is marched using dynamic resolution
#       when slider stops moving of dthreshold/dt < val:
#           if cell scale of coarse grid > 1:
#               request the missing values in the region of the threshold 
#                   server traverses its representation of the data
#                   gets the blocks that are active (4^3)
#               fill another buffer with the fine grid around the isosurface
#               march the fine buffer
#                   need altered marching cubes algorithm





# # the socket object the server will listen on for both http and ws
    # s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    # # binds the socket to a particular ip and port#
    # s.bind((socket.gethostname(), port))

    # # queue up 5 connections max before refusing more
    # s.listen(5)

    # try:
    #     while True:
    #         # accept connections from outside
    #         # returns the client socket object and the client's address
    #         (clientSocket, address) = s.accept()
    #         # spawn new thread to handle the connection
    #         _thread.start_new_thread(handler, (clientSocket,address))
    # except KeyboardInterrupt:
    #     s.close()
    #     print("server closed")
    #     sys.exit()



# File management:
    # file.read() will load data into memory
    # read function is the way data is accessed from class
        # if file is already loaded
            # return the contents
        # else have to load file
            # throw error if the file is too big
            # if there is enough free space for it
                # load and return the contents
            # else will have to remove others
                # unload enough to make it fit
                # load and return contents
    
    # making space for new files
        # go through the queue of the most recently accessed files
        # 
