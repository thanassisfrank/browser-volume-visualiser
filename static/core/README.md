# Core

This directory contains the core library behind the volumetric visualiser and is all that is needed to add functionality to your own projects.

## app.js

This file provides the `App` class which is the main entrypoint into the functionality of this tool.

Views can be created using the `.createView(...)` instance method with a specific dataset and camera specified.

## benchmark.js

This provides functionality for benchmarking through the `JobRunner` class. This takes an already created `App` object and runs a series of tests using it defined in a JSON file. For an example of how to use this, see the `benchmark.html` example page.

## Utilities

The other files in this directory act as repositories of utilities.

## Sub-directories

* [`data/`](data/README.md) Implementation of dataset handling code, operating on the CPU

* [`renderEngine/`](renderEngine/README.md) Implementation of the rendering engine, generating frames using the GPU

* [`view/`](view/README.md)