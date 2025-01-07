# Adding Data Files Guide

There are a number of example datasets included with this project that showcase the range of formats that are capable of being loaded. If you want to include your own datasets to visualise them with this project then this file provides a guide to doing this.

## RAW 3D image files

These are the simplest types of dataset supported and consist of an array of binary data specifying the values at regularly spaces points within a volume.

1. **Add the file to `static/data/`**
2. **Add an entry in `static/data/datasets.json`**

    Create an entry which matches the format of the following where the `{snippet}` blocks are replaced with the correct values for the dataset.

    ```json
    "{unique identifier}": {
        "name": "{dataset name}",
        "path": "data/{file name}",
        "type": "raw",
        "size": {
            "x": {num points x},
            "y": {num points y},
            "z": {num points z}
        },
        "cellSize": {
            "x": {point spacing x},
            "y": {point spacing y},
            "z": {point spacing z}
        },
        "limits": [
            {min value},
            {max value}
        ],
    }
    ```

## Unstructured CGNS files

The client support loading static CGNS files which contain an unstructured mesh. *Please node only single zone files with a tetrahedral mesh are supported currently*

1. **Add the file to `static/data/`**
2. **Add an entry in `static/data/datasets.json`**

    Create an entry which matches the format of the following where the `{snippet}` blocks are replaced with the correct values for the dataset.

    ```json
    "{unique identifier}": {
		"name": "{dataset name}",
		"path": "data/{file name}",
		"type": "cgns"
	}
    ```


## Large Unstructured CGNS file

If your CGNS file is large then you'll want to take advantage of the dynamic loading mechanism built into the system. *Please node only single zone files with a tetrahedral mesh are supported currently*

1. **Run the file through the conversion tool**

    *For more information, see `ingest/README.md`*

2. **Add the output files to `static/data/`**
3. **Add an entry in `static/data/datasets.json`**

    Create an entry which matches the format of the following where the `{snippets}` are replaced with the correct values for the dataset.

    ```json
    "{unique identifier}": {
		"name": "{dataset name}",
		"path": "data/{partial file name}",
        "meshPath": "data/{block mesh file name}",
		"type": "cgns-partial"
	}
    ```


