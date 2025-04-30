# CGNS File Conversion Guide

To effectively visualise large unstructured CGNS files with this project it is recommended to convert them with the included tools.

## Single conversion

To convert a single dataset, the `generate_block_mesh.py` tool can be used.

### Tool arguments

Here, a selection of the most important command-line arguments are re-produced. For a full list of all available arguments, run the tool with the `-h` flag.

* `file-path`

    The only positional argument, this specifies the relative path to the file to be converted by the tool

* `-c` or `--max-cells`

    The maximum amount of cells allowable in each leaf node before it is split no more, the default value is `2048`. `-d` takes precedence where these conflict.

* `-d` or `--depth`

    The maximum depth the tree will be generated to, the default value is 40.

* `--data-type`

    The data type of scalar values as a string; only needed for raw structured files. Must be a numpy recognised format, see the [numpy documentation](https://numpy.org/doc/stable/reference/arrays.dtypes.html) for valid values.

* `--decimate`

    The proportion of cells to remove from the input mesh as a float from 0 to 1, default is 0. Only used for raw structured datasets.

* `-o` or `--output`

    The prefix of the output files generated, default is `out` which will result in `out_partial.cgns` and `out_block_mesh.cgns`

* `-s` or `--scalars`

    A space separated list of names of the scalar datasets to include in the converted file e.g. `-s Density Pressure Mach`. This also accepts a few special values 

    * `all` takes all datasets
    * `first` takes only the first encountered
    * `none` takes none (result files will only contain the mesh geometry)
    * `pick` *(default)* starts interactive prompt to allow picking individual datasets

* `--size-{a}`

    Where `{a}` is one of `x`, `y`, or `z`. The number of points in the respective axis, only needed for raw structured files.

* `-v` or `--verbose`

    If this flag is present, the tool will run in verbose mode with diagnostic and progress information printed to the console. This is off by default.




## Multiple conversions

To generate multiple output files, the simplest method is using `create_tree_infos.py` with a json job file specified as `--json {path to file}`. By default, this will run the tool for each configuration requested, extracting the command-line arguments that need to be passed to `generate_block_mesh.py`. By default, the tool is called with the `-e` flag to generate and output information about the generated tree.

### Options

* `-f`

    Force a job to be run even if its output directory already exists.

* `--file`

    The file path to a single dataset to convert.

* `--json`

    Supply a job file in json format.

* `--out`

    The output name for the conversion of a single dataset.

* `-v`

    Turn on verbose output for this tool.


### Job options

* `cells`

    An array of the numbers of cells to generate trees with, each is passed to `-c` in turn.

* `decimate`

    Passed to `--decimate`

* `file`

    Passed to `file-path`.

* `noFiles`

    Sets the `-n` flag if truthy.

* `out`

    Used in combination with the cell count for this run to name the output directory. Passed to `-o` as `{out}_{cells}/`.

* `scalars`

    An array of values to pass to `-s`.

* `size`

    Array of extents for structured raw datasets, passed to `--size-{a}`.

* `type`

    Passed to `-t`.

* `verbose`

    Sets the `-v` flag if truthy.



For an example of a json job file, see `treeJobs.json`.