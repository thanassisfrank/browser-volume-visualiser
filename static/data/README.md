# Adding Data Files Guide

There are a number of example datasets included with this project that showcase the range of formats that are capable of being loaded. If you want to include your own datasets to visualise them with this project then this file provides a guide to doing this.

## RAW 3D image files

These are the simplest types of dataset supported and consist of an array of binary data specifying the values at regularly spaces points within a volume.

1. **Add the file to `static/data/`**
2. **Add an entry in `static/data/datasets.json`**

    Create an entry which matches the format of the following where each entry is replaced with the correct values for the dataset.

    ```json5
    // unique identifier
    "magnetic": {
        // display name
		"name": "Magnetic",
        // path to file relative to static/
		"path": "data/magnetic_reconnection_512x512x512_float32.raw",
		// number of data points in each dimension
        "size": {
			"x": 512,
			"y": 512,
			"z": 512
		},
        // size of the cells 
		"cellSize": {
			"x": 1,
			"y": 1,
			"z": 1
		},
        // the lowest and highest value within the dataset
		"limits": [
			0,
			24.195253
		],
        // datatype of scalar values
        // for allowed strings see DATA_TYPES in static/core/utils.js
		"dataType": "float32",
		"type": "raw"
	}
    ```

## Unstructured CGNS files

The client support loading static CGNS files which contain an unstructured mesh. *Please node only single zone files with a tetrahedral mesh are supported currently*

1. **Add the file to `static/data/`**
2. **Add an entry in `static/data/datasets.json`**

    Create an entry which matches the format of the following where each entry is replaced with the correct values for the dataset.

    ```json5
    // unique identifier
    "yf17_hdf5": {
        // display name
		"name": "YF17",
        // path to file relative to static/
		"path": "data/yf17_hdf5.cgns",
		"type": "cgns"
	},
    ```


## Large Unstructured CGNS file

If your CGNS file is large then you'll want to take advantage of the dynamic loading mechanism built into the system. *Please node only single zone files with a tetrahedral mesh are supported currently*

1. **Run the file through the conversion tool**

    *For more information, see `ingest/README.md`*

2. **Add the output files to `static/data/`**
3. **Add an entry in `static/data/datasets.json`**

    Create an entry which matches the format of the following where each entry is replaced with the correct values for the dataset.

    ```json5
    // unique identifier
    "yf17_1024": {
		// dataset display name
        "name": "YF17p 1024",
        // path to the full tree file relative to static/
		"path": "data/local/yf17_1024/_partial.cgns",
        // path to the mesh file relative to static/
		"meshPath": "data/local/yf17_1024/_block_mesh.cgns", 
		"type": "cgns-partial"
	}
    ```


