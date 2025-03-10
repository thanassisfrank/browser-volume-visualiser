from setuptools import Extension, setup
import numpy as np

setup(
    ext_modules=[
        Extension(
            name="celltools",
            sources=["src/main.c"],
            include_dirs=[np.get_include()]
        ),
    ]
)