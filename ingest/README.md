This contains the tools used to convert datasets into the split cgns format used for dynamic streaming. A k-d tree is generated over the dataset volume and the mesh is split at the tree leaf nodes. A guide describing how to use the tools is available [here](CONVERSION.md).

## `generate_block_mesh.py`

Offers a command line interface to convert a single dataset. Supports raw structured, unstructured tetrahedral cgns and unstructured fun3d files (ugrid + fun3d vertex values).

## `create_tree_infos.py`

An easier way to convert multiple datasets or generate files with different configurations. Arguments for generation are passed in a json file as in `treeJobs.json`.

## Sub-directories

* `celltools/` Contains a C implementation of some of the most-used functions within the python conversion scripts to improve performance.