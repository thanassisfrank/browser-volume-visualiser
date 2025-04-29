# Core

This directory contains the core library behind the volumetric visualiser and is all that is needed to add functionality to your own projects.

## app.js

This file provides the `App` class which is the main entrypoint into the functionality of this tool. A single `App` instance can be created to manage multiple views. Views can be created using the `.createView(...)` instance method with a specific dataset and camera specified.

Each app has a single rendering engine and must be updated regularly (e.g. using `requestAnimationFrame`) to handle state changes and render new frames.

## benchmark.js

This provides functionality for benchmarking through the `JobRunner` class. This takes an already created `App` object and runs a series of tests using it defined in a JSON file. For an example of how to use this, see the `benchmark.html` example page.

## Utilities

The other files in this directory act as repositories of utilities.

## Sub-directories

* [`data/`](data/README.md) Dataset handling code, operating on the CPU

* [`renderEngine/`](renderEngine/README.md) Rendering engine, generates and draws frames using the GPU

* [`view/`](view/README.md) Communication between dataset, rendering engine and user interaction