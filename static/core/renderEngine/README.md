This contains all client code pertaining to rendering images of the datasets onto the screen including GPU resource, scene and camera management.

## `renderEngine.js`

Exposes a function `createRenderEngine(...)` that is called when creating a new `App`. In the current state, this checks if WebGPU is available in the current context before creating a new `WebGPURenderEngine` but there is the flexibility to implement rendering engines using different backends such as WebGL.

This also exposes the `Renderable` class which is used to create objects that the render engine uses to manage scene state and resources.

## `camera.js`

Defines the `Camera` class which generates projection and view matrices based on its parameters and current position and orientation.

## Sub-directories

* [`webGPU/`](webGPU/README.md) A WebGPU-based render engine implementation

