# app.py 
# the http server written in python
import json
import h5py
import numpy as np
import argparse
from aiohttp import web, WSMsgType


STATIC_PATH = "./static/"

# returns the buffer for a given mesh block request
def get_mesh_block_resp(request):
    # start_time = time.time()

    block_count = len(request["blocks"])

    # get the h5py file object
    with h5py.File(STATIC_PATH + request["path"]) as file:
        base_grp = file["Base"]
        # load info about max verts and cells per mesh block
        (max_cells, max_verts) = base_grp["MaxPrimitives/ data"]

        # create the buffers to hold all the response data
        if request["geometry"]:
            # vert position information
            block_vert_pos_buff = np.empty((block_count, max_verts, 3), dtype=np.float32)
            # cell connectivity information
            block_cell_con_buff = np.empty((block_count, 4 * max_cells), dtype=np.uint32)
        
        scalar_buffs = {}
        for name in request["scalars"]:
            scalar_buffs[name] = np.empty((block_count, max_verts), dtype=np.float32)

        # iterate through all the blocks requested
        for i, block_index in enumerate(request["blocks"]):
            # get the zone node for this block
            block_grp = base_grp["Zone%i" % block_index]
            if request["geometry"]:
                # write geometry information
                coord_grp = block_grp["GridCoordinates"]
                coord_arr = np.array([
                    coord_grp["CoordinateX/ data"], 
                    coord_grp["CoordinateY/ data"], 
                    coord_grp["CoordinateZ/ data"]
                ]).transpose()
                block_vert_pos_buff[i][:len(coord_arr)] = coord_arr 

                con_arr = block_grp["GridElements/ElementConnectivity/ data"]
                block_cell_con_buff[i][:len(con_arr)] = con_arr
            # write scalar data
            for j, name in enumerate(request["scalars"]):
                scal_arr = block_grp["FlowSolution/%s/ data" % name]
                scalar_buffs[name][i][:len(scal_arr)] = scal_arr
        
        
        # combine buffers into one response
        resp = bytes()
        
        if request["geometry"]:
            resp += block_vert_pos_buff.data
            resp += block_cell_con_buff.data
        
        for name in request["scalars"]:
            resp += scalar_buffs[name].data

        # print("took " + "%.3f" % (time.time()-start_time) + "s")

        return resp


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            try:
                req = json.loads(msg.data)
                if req["mode"] == "meshblocks":
                    await ws.send_bytes(get_mesh_block_resp(req))
                else:
                    await ws.send_bytes(bytearray(1))
            except Exception:
                await ws.send_bytes(bytearray(1))
        elif msg.type == WSMsgType.ERROR:
            print("ws connection closed with exception %s" % ws.exception())

    return ws


def create_app():
    app = web.Application()
    app.router.add_get("/data-blocks", websocket_handler)
    app.router.add_static("/", STATIC_PATH)
    return app


def main():
    parser = argparse.ArgumentParser(prog="app_asyncio")
    parser.add_argument("address", default="localhost:8080", nargs="?", help="<HOSTNAME>:<PORT> to run server at")
    args = vars(parser.parse_args())

    host = args["address"].split(":")
    HOSTNAME = host[0]
    PORT = int(host[1])

    web.run_app(create_app(), host=HOSTNAME, port=PORT)

    print("server closed")


if __name__ == "__main__":
    main()