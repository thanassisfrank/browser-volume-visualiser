# CGNS File Conversion Guide

To effectively visualise large unstructured meshes within a CGNS file with this project it is recommended to convert them with the included python utility `ingest/generate_block_mesh.py`.


Simple usage: 

```console
$ python generate_block_mesh.py {file-path}
```

## Tool arguments

### `file-path`

The only positional argument, this specifies the relative path to the file to be converted by the tool

### `-s` or `--scalars`

A space separated list of names of the scalar datasets to include in the converted file e.g. `-s Density Pressure Mach`. This also accepts a few special values 

* `all` takes all datasets
* `first` takes only the first encountered
* `none` takes none (result files will only contain the mesh geometry)
* `pick` *(default)* starts interactive prompt to allow picking individual datasets

### `-d` or `--depth`

The maximum depth the tree will be generated to, the default value is 40.

### `-c` or `--max-cells`

The maximum amount of cells allowable in each leaf node before it is split no more, the default value is `2048`. `-d` takes precedence where these conflict.

### `-o` or `--output`

The prefix of the output files generated, default is `out` which will result in `out_partial.cgns` and `out_block_mesh.cgns`

### `-v` or `--verbose`

If this flag is present, the tool will run in verbose mode with diagnostic and progress information printed to the console. This is off by default.