This directory contains client JS code for managing datasets. This includes loading from the server, dynamically updating data based on the current view and outputting data for the rendering engine.

The class `Data` contained in `data.js` provides the API for this section and an instance is held by every `View` object.

## Sub-directories

* [`cache/`](cache/README.md) Caching management objects including the mesh cache.

* [`dataSource/`](dataSource/README.md) Handles communication with the server to pull data as well as mapping operations on the retrieved data.

* [`dynamic/`](dynamic/README.md) Logic for managing the dynamically-loaded sections of a dataset.