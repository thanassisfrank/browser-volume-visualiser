# browser-volume-visualiser

This project is a web-based visualisation tool, leveraging the power of the WebGPU API to display volumetric data interactively.

## Quick Start

If you would like to run the program, download the repository and run the web server with the following command. *(python 3 with numpy, h5py and aiohttp libraries required)*

```console
$ python app.py
```
Everything within the `static/` folder will then be available at `http://localhost:8080/` by default.

*The Chrome web browser is recommended as this is where the majority of testing has been carried out*


## Project structure

* [`ingest/`](ingest/README.md) python scripts for converting datasets into the split mesh-tree files for dynamic loading

* [`static/`](static/README.md) all of the client code and dataset files
