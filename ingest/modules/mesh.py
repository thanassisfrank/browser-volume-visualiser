from modules.utils import *
import numpy as np

class Mesh:
    box = {
        "min": [0, 0, 0],
        "max": [0, 0, 0]
    }

    limits = {}

    def __init__(self, positions, connectivity, values=None, id=0):
        self.positions = positions
        self.connectivity = connectivity
        self.values = values
        self.id = id

        # assume fully tetrahedral mesh
        self.cell_count = len(connectivity)//4

    def __str__(self):
        s = "".join([
            "Mesh object\n",
            f" {self.positions.shape}\n"
            f" {len(self.positions)} points\n",
            f" {self.cell_count} cells\n",
            f" {len(self.values.keys())} val arrays\n",
            f" box min: {self.box["min"]}\n"
            f" box max: {self.box["max"]}\n"
        ])

        return s
    
    def calculate_box(self):
        self.box["min"] = self.positions[0]
        self.box["max"] = self.positions[0]

        for point in self.positions:
            self.box["min"] = np.minimum(self.box["min"], point)
            self.box["max"] = np.maximum(self.box["max"], point)
    
    def calculate_limits(self):
        for name, buff in self.values.items():
            self.limits[name] = {
                "min": np.min(buff), 
                "max": np.max(buff)
            } 
    
    # fills the supplied hdf5 zone group
    def create_zone_subgroup(self, base_grp, zone_grp_name):
        zone_data = np.array((len(self.positions), len(self.connectivity)//4, 0), dtype=np.int32)
        zone_grp = create_cgns_subgroup(base_grp, zone_grp_name, "Zone_t", "I4", zone_data)

        create_cgns_subgroup(zone_grp, "ZoneType", "ZoneType_t", "C1", string_to_np_char("Unstructured"))

        # write the positions of the vertices
        coords_grp = create_cgns_subgroup(zone_grp, "GridCoordinates", "GridCoordinates_t", "MT")
        create_cgns_subgroup(coords_grp, "CoordinateX", "DataArray_t", "R4", self.positions.T[0])
        create_cgns_subgroup(coords_grp, "CoordinateY", "DataArray_t", "R4", self.positions.T[1])
        create_cgns_subgroup(coords_grp, "CoordinateZ", "DataArray_t", "R4", self.positions.T[2])

        # 10 -> tet
        elem_grp = create_cgns_subgroup(zone_grp, "GridElements", "Elements_t", "I4", np.array([10, 0], dtype=np.int32))
        elem_range_data = np.array([1, len(self.connectivity)], dtype=np.int32)
        create_cgns_subgroup(elem_grp, "ElementRange", "IndexRange_t", "I4", elem_range_data)
        # write connectivity
        # TODO: determine if this can be 1 based as per the spec
        one_based_con = self.connectivity + 1
        create_cgns_subgroup(elem_grp, "ElementConnectivity", "DataArray_t", "I4", one_based_con)

        # write vertex values
        sol_grp = create_cgns_subgroup(zone_grp, "FlowSolution", "FlowSolution_t", "MT")
        for name, buff in self.values.items():
            create_cgns_subgroup(sol_grp, name, "DataArray_t", "R4", buff)

        
    
    @staticmethod
    def from_zone_group(zone_grp, val_names):
        zone_type_node = zone_grp["ZoneType"]
        # check if this is unstructured
        if charcodes_to_string(zone_type_node[" data"]) != "Unstructured":
            raise TypeError("Dataset mesh is not unstructured")
        
        coords_node = zone_grp["GridCoordinates"]
        # print(list(coords_node.keys()))
        x_dset = coords_node["CoordinateX/ data"]
        x_pos = np.empty(x_dset.shape, dtype=x_dset.dtype)
        x_dset.read_direct(x_pos)
        
        y_dset = coords_node["CoordinateY/ data"]
        y_pos = np.empty(y_dset.shape, dtype=y_dset.dtype)
        y_dset.read_direct(y_pos)
        
        z_dset = coords_node["CoordinateZ/ data"]
        z_pos = np.empty(z_dset.shape, dtype=z_dset.dtype)
        z_dset.read_direct(z_pos)

        positions = np.array([x_pos, y_pos, z_pos]).transpose()

        # get the connectivity information, correcting for one based indexing
        con_dset = zone_grp["GridElements/ElementConnectivity/ data"]
        connectivity = np.empty(con_dset.shape, dtype=con_dset.dtype)
        con_dset.read_direct(connectivity)
        connectivity -= 1

        values = {}
        for name in val_names:
            try:
                values[name] = np.array(zone_grp["FlowSolution"][name][" data"], copy=True)
            except:
                print("Couldn't load array", name)

        return Mesh(positions, connectivity, values)
    
    

