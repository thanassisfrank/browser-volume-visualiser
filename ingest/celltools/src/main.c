// celltools.c
// defines fast functions callable from python for mesh cells

// define min/max macros
#define MAX(x, y) (((x) > (y)) ? (x) : (y))
#define MIN(x, y) (((x) < (y)) ? (x) : (y))

#include <stdint.h>

#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include "numpy/ndarrayobject.h"


#define CELL_LEFT 1;
#define CELL_RIGHT 2;
#define CELL_BOTH CELL_LEFT | CELL_RIGHT;


static PyObject* helloWorld(PyObject *self, PyObject *args)
{
    return PyUnicode_FromString("Hello world!");
}

static inline float getCellVal(int pIndex, int dim, int cellID, PyArrayObject* con, PyArrayObject* pos)
{
    uint32_t fullPointIndex = *((uint32_t*)PyArray_GETPTR2(con, cellID, pIndex));
    return *((float*)PyArray_GETPTR2(pos, fullPointIndex, dim));
}

// args:
// 1) point : (3) shape array
// 2) cell id
// 3) positions : (n, 3)
// 4) connectivity : (n, 4)
static PyObject* pointInCellBounds4(PyObject *self, PyObject *const *args, Py_ssize_t nargs)
{
    // TODO: check nargs is correct

    PyArrayObject* pointArr = PyArray_GETCONTIGUOUS(args[0]);
    int cellID = PyLong_AsInt(args[1]);
    PyArrayObject* pos = (PyArrayObject*)args[2];
    PyArrayObject* con = (PyArrayObject*)args[3];

    float minCell[] = {
        getCellVal(0, 0, cellID, con, pos),
        getCellVal(0, 1, cellID, con, pos),
        getCellVal(0, 2, cellID, con, pos),
    };

    float maxCell[] = {
        getCellVal(0, 0, cellID, con, pos),
        getCellVal(0, 1, cellID, con, pos),
        getCellVal(0, 2, cellID, con, pos),
    };

    float val;
    for (int i = 1; i < 4; i++) {
        for (int j = 0; j < 3; j++) {
            // val = *((float*)PyArray_GETPTR2(cellArr, i, j));
            val = getCellVal(i, j, cellID, con, pos);

            minCell[j] = MIN(minCell[j], val);
            maxCell[j] = MAX(maxCell[j], val);
        }
    }

    float point[] = {
        *((float*)PyArray_GETPTR1(pointArr, 0)),
        *((float*)PyArray_GETPTR1(pointArr, 1)),
        *((float*)PyArray_GETPTR1(pointArr, 2)),
    };
    
    if (point[0] < minCell[0] || point[1] < minCell[1] || point[2] < minCell[2]) return Py_False;
    if (point[0] > maxCell[0] || point[1] > maxCell[1] || point[2] > maxCell[2]) return Py_False;

    return Py_True;
}

static PyObject* cellPlaneCheck4(PyObject *self, PyObject *const *args, Py_ssize_t nargs)
{
    // TODO: check nargs is correct

    int dim = PyLong_AsInt(args[0]);
    float plane = PyFloat_AsDouble(args[1]);
    int cellID = PyLong_AsInt(args[2]);
    PyArrayObject* pos = (PyArrayObject*)args[3];
    PyArrayObject* con = (PyArrayObject*)args[4];


    long check = 0;

    if (getCellVal(0, dim, cellID, con, pos) > plane) {
        check |= CELL_RIGHT;
        if (
            getCellVal(1, dim, cellID, con, pos) <= plane || 
            getCellVal(2, dim, cellID, con, pos) <= plane || 
            getCellVal(3, dim, cellID, con, pos) <= plane
        ) {
                check |= CELL_LEFT;
            }
    } else {
        check |= CELL_LEFT;
        if (
            getCellVal(1, dim, cellID, con, pos) > plane || 
            getCellVal(2, dim, cellID, con, pos) > plane || 
            getCellVal(3, dim, cellID, con, pos) > plane
        ) {
                check |= CELL_RIGHT;
            }
    }
    return PyLong_FromLong(check);
}


static PyMethodDef methods[] = {
    {"hello_world", helloWorld, METH_VARARGS, NULL},
    {"point_in_cell_bounds4", pointInCellBounds4, METH_FASTCALL, NULL},
    {"cell_plane_check4", cellPlaneCheck4, METH_FASTCALL, NULL},
    {NULL, NULL, 0, NULL}
};

static PyModuleDef module = {
    PyModuleDef_HEAD_INIT,
    "celltools",
    NULL,
    -1,
    methods,
    NULL,
    NULL,
    NULL,
    NULL
};



PyMODINIT_FUNC PyInit_celltools(void)
{
    if (PyArray_ImportNumPyAPI() < 0) {
        return NULL;
    }
    import_array();
    return PyModule_Create(&module);
}