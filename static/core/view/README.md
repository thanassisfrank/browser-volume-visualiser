This directory contains the client code for handling views which manage the interaction between the user, a dataset and the rendering engine.

## `view.js`

Provides a class `View` that can be created externally by calling the `createView(...)` function. This will create a new view object and a new instance of the view template in the HTML page, attaching any input/output element handlers.

## `viewElems.js`

Provides utility classes for the `View` objects that handle any input/output elements present in the view HTML template. These handlers all look for elements within the template that have specific classes.

### Input handlers

* **Close button** Marks the view for closing when a button with class `view-close` is pressed.

* **Iso-surface source selection** Fills a select element with class `view-iso-surface-src-select` with the iso-surface source options for the loaded dataset.

* **Surface colour source selection** Fills a select element with class `view-surface-col-src-select` with the surface colour source options for the loaded dataset.

* **Dataset volume clipping** Gets the bounds of the dataset volume clip box from sliders with classes `view-clip-{a}-{b}` where `{a}` is one of `min` or `max` and `{b}` is one of `x`, `y` or `z`; not all elements need to be present.

* **Iso-value slider** Gets the iso-value (threshold) as the value of the element with class `view-threshold`.

* **Viewing frame** Monitors user mouse interaction within an element with class `view-frame` for camera movement. This element also provides the DOMRect for rendering the view into.

* **Volume transfer function** Gets colour and opacity points from elements with classes `view-vol-col` and `view-vol-op` respectively.

* **Embedded mesh rendering** TODO

* **Colour scale selector** Fills a select element with class `view-surface-col-scale-select` with options for setting the colour scale.

### Output handlers

* **Iso value** Sets the text of element with class `view-threshold-value` to the current iso-value.

* **Axes widget** Draws the current axes orientation to a canvas with class `view-axes-widget`. The x, y, z axes are red, green and blue respectively.

* **Dataset name** Shows the display name of the dataset in an element with class `view-dataset-name`.

* **Dataset size** Shows a string representing the size of the dataset in an element with class `view-dataset-size`.

