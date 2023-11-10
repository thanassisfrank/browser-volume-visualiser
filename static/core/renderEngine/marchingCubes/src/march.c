#include <emscripten.h>
#include <stdlib.h>

// build command:
// emcc -O2 -s STANDALONE_WASM=1 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s MALLOC=”dlmalloc” -s INITIAL_MEMORY=134217728 --no-entry -o march.wasm march.c


#define blockSizeX 4
#define blockSizeY 4
#define blockSizeZ 4
#define blockDataLength 125

typedef float vert[3];
typedef int bool; 
enum {false = 0, true = 1};

typedef unsigned int uint;
// typedef float Block[(blockSizeX+1)*(blockSizeY+1)*(blockSizeZ+1)];


struct Vec3Int {
    int x;
    int y;
    int z;
};

struct Vec3Float {
    float x;
    float y;
    float z;
};

struct Counts {
    int verts;
    int indices;
};

extern void console_log_float(float);
extern void console_log_int(int);
extern void console_log_bin(int);

int vertCoordTable[8][3] = {
    {0, 0, 0}, // 0
    {1, 0, 0}, // 1
    {1, 1, 0}, // 2
    {0, 1, 0}, // 3
    {0, 0, 1}, // 4
    {1, 0, 1}, // 5
    {1, 1, 1}, // 6
    {0, 1, 1}, // 7
};

int edgeTable[256][12] = {
    {-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,8,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,9,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,3,8,9,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,2,10,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,8,10,-1,-1,-1,-1,-1,-1},
    {0,2,9,10,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,3,8,9,10,-1,-1,-1,-1,-1,-1,-1},
    {2,3,11,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,2,8,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,9,11,-1,-1,-1,-1,-1,-1},
    {1,2,8,9,11,-1,-1,-1,-1,-1,-1,-1},
    {1,3,10,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,8,10,11,-1,-1,-1,-1,-1,-1,-1},
    {0,3,9,10,11,-1,-1,-1,-1,-1,-1,-1},
    {8,9,10,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,4,7,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,4,7,8,9,-1,-1,-1,-1,-1,-1},
    {1,3,4,7,9,-1,-1,-1,-1,-1,-1,-1},
    {1,2,4,7,8,10,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,4,7,10,-1,-1,-1,-1,-1},
    {0,2,4,7,8,9,10,-1,-1,-1,-1,-1},
    {2,3,4,7,9,10,-1,-1,-1,-1,-1,-1},
    {2,3,4,7,8,11,-1,-1,-1,-1,-1,-1},
    {0,2,4,7,11,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,4,7,8,9,11,-1,-1,-1},
    {1,2,4,7,9,11,-1,-1,-1,-1,-1,-1},
    {1,3,4,7,8,10,11,-1,-1,-1,-1,-1},
    {0,1,4,7,10,11,-1,-1,-1,-1,-1,-1},
    {0,3,4,7,8,9,10,11,-1,-1,-1,-1},
    {4,7,9,10,11,-1,-1,-1,-1,-1,-1,-1},
    {4,5,9,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,4,5,8,9,-1,-1,-1,-1,-1,-1},
    {0,1,4,5,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,3,4,5,8,-1,-1,-1,-1,-1,-1,-1},
    {1,2,4,5,9,10,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,4,5,8,9,10,-1,-1,-1},
    {0,2,4,5,10,-1,-1,-1,-1,-1,-1,-1},
    {2,3,4,5,8,10,-1,-1,-1,-1,-1,-1},
    {2,3,4,5,9,11,-1,-1,-1,-1,-1,-1},
    {0,2,4,5,8,9,11,-1,-1,-1,-1,-1},
    {0,1,2,3,4,5,11,-1,-1,-1,-1,-1},
    {1,2,4,5,8,11,-1,-1,-1,-1,-1,-1},
    {1,3,4,5,9,10,11,-1,-1,-1,-1,-1},
    {0,1,4,5,8,9,10,11,-1,-1,-1,-1},
    {0,3,4,5,10,11,-1,-1,-1,-1,-1,-1},
    {4,5,8,10,11,-1,-1,-1,-1,-1,-1,-1},
    {5,7,8,9,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,5,7,9,-1,-1,-1,-1,-1,-1,-1},
    {0,1,5,7,8,-1,-1,-1,-1,-1,-1,-1},
    {1,3,5,7,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,2,5,7,8,9,10,-1,-1,-1,-1,-1},
    {0,1,2,3,5,7,9,10,-1,-1,-1,-1},
    {0,2,5,7,8,10,-1,-1,-1,-1,-1,-1},
    {2,3,5,7,10,-1,-1,-1,-1,-1,-1,-1},
    {2,3,5,7,8,9,11,-1,-1,-1,-1,-1},
    {0,2,5,7,9,11,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,5,7,8,11,-1,-1,-1,-1},
    {1,2,5,7,11,-1,-1,-1,-1,-1,-1,-1},
    {1,3,5,7,8,9,10,11,-1,-1,-1,-1},
    {0,1,5,7,9,10,11,-1,-1,-1,-1,-1},
    {0,3,5,7,8,10,11,-1,-1,-1,-1,-1},
    {5,7,10,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {5,6,10,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,5,6,8,10,-1,-1,-1,-1,-1,-1},
    {0,1,5,6,9,10,-1,-1,-1,-1,-1,-1},
    {1,3,5,6,8,9,10,-1,-1,-1,-1,-1},
    {1,2,5,6,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,5,6,8,-1,-1,-1,-1,-1},
    {0,2,5,6,9,-1,-1,-1,-1,-1,-1,-1},
    {2,3,5,6,8,9,-1,-1,-1,-1,-1,-1},
    {2,3,5,6,10,11,-1,-1,-1,-1,-1,-1},
    {0,2,5,6,8,10,11,-1,-1,-1,-1,-1},
    {0,1,2,3,5,6,9,10,11,-1,-1,-1},
    {1,2,5,6,8,9,10,11,-1,-1,-1,-1},
    {1,3,5,6,11,-1,-1,-1,-1,-1,-1,-1},
    {0,1,5,6,8,11,-1,-1,-1,-1,-1,-1},
    {0,3,5,6,9,11,-1,-1,-1,-1,-1,-1},
    {5,6,8,9,11,-1,-1,-1,-1,-1,-1,-1},
    {4,5,6,7,8,10,-1,-1,-1,-1,-1,-1},
    {0,3,4,5,6,7,10,-1,-1,-1,-1,-1},
    {0,1,4,5,6,7,8,9,10,-1,-1,-1},
    {1,3,4,5,6,7,9,10,-1,-1,-1,-1},
    {1,2,4,5,6,7,8,-1,-1,-1,-1,-1},
    {0,1,2,3,4,5,6,7,-1,-1,-1,-1},
    {0,2,4,5,6,7,8,9,-1,-1,-1,-1},
    {2,3,4,5,6,7,9,-1,-1,-1,-1,-1},
    {2,3,4,5,6,7,8,10,11,-1,-1,-1},
    {0,2,4,5,6,7,10,11,-1,-1,-1,-1},
    {0,1,2,3,4,5,6,7,8,9,10,11},
    {1,2,4,5,6,7,9,10,11,-1,-1,-1},
    {1,3,4,5,6,7,8,11,-1,-1,-1,-1},
    {0,1,4,5,6,7,11,-1,-1,-1,-1,-1},
    {0,3,4,5,6,7,8,9,11,-1,-1,-1},
    {4,5,6,7,9,11,-1,-1,-1,-1,-1,-1},
    {4,6,9,10,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,4,6,8,9,10,-1,-1,-1,-1,-1},
    {0,1,4,6,10,-1,-1,-1,-1,-1,-1,-1},
    {1,3,4,6,8,10,-1,-1,-1,-1,-1,-1},
    {1,2,4,6,9,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,4,6,8,9,-1,-1,-1,-1},
    {0,2,4,6,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,3,4,6,8,-1,-1,-1,-1,-1,-1,-1},
    {2,3,4,6,9,10,11,-1,-1,-1,-1,-1},
    {0,2,4,6,8,9,10,11,-1,-1,-1,-1},
    {0,1,2,3,4,6,10,11,-1,-1,-1,-1},
    {1,2,4,6,8,10,11,-1,-1,-1,-1,-1},
    {1,3,4,6,9,11,-1,-1,-1,-1,-1,-1},
    {0,1,4,6,8,9,11,-1,-1,-1,-1,-1},
    {0,3,4,6,11,-1,-1,-1,-1,-1,-1,-1},
    {4,6,8,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {6,7,8,9,10,-1,-1,-1,-1,-1,-1,-1},
    {0,3,6,7,9,10,-1,-1,-1,-1,-1,-1},
    {0,1,6,7,8,10,-1,-1,-1,-1,-1,-1},
    {1,3,6,7,10,-1,-1,-1,-1,-1,-1,-1},
    {1,2,6,7,8,9,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,6,7,9,-1,-1,-1,-1,-1},
    {0,2,6,7,8,-1,-1,-1,-1,-1,-1,-1},
    {2,3,6,7,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,3,6,7,8,9,10,11,-1,-1,-1,-1},
    {0,2,6,7,9,10,11,-1,-1,-1,-1,-1},
    {0,1,2,3,6,7,8,10,11,-1,-1,-1},
    {1,2,6,7,10,11,-1,-1,-1,-1,-1,-1},
    {1,3,6,7,8,9,11,-1,-1,-1,-1,-1},
    {0,1,6,7,9,11,-1,-1,-1,-1,-1,-1},
    {0,3,6,7,8,11,-1,-1,-1,-1,-1,-1},
    {6,7,11,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {6,7,11,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,6,7,8,11,-1,-1,-1,-1,-1,-1},
    {0,1,6,7,9,11,-1,-1,-1,-1,-1,-1},
    {1,3,6,7,8,9,11,-1,-1,-1,-1,-1},
    {1,2,6,7,10,11,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,6,7,8,10,11,-1,-1,-1},
    {0,2,6,7,9,10,11,-1,-1,-1,-1,-1},
    {2,3,6,7,8,9,10,11,-1,-1,-1,-1},
    {2,3,6,7,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,2,6,7,8,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,6,7,9,-1,-1,-1,-1,-1},
    {1,2,6,7,8,9,-1,-1,-1,-1,-1,-1},
    {1,3,6,7,10,-1,-1,-1,-1,-1,-1,-1},
    {0,1,6,7,8,10,-1,-1,-1,-1,-1,-1},
    {0,3,6,7,9,10,-1,-1,-1,-1,-1,-1},
    {6,7,8,9,10,-1,-1,-1,-1,-1,-1,-1},
    {4,6,8,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,4,6,11,-1,-1,-1,-1,-1,-1,-1},
    {0,1,4,6,8,9,11,-1,-1,-1,-1,-1},
    {1,3,4,6,9,11,-1,-1,-1,-1,-1,-1},
    {1,2,4,6,8,10,11,-1,-1,-1,-1,-1},
    {0,1,2,3,4,6,10,11,-1,-1,-1,-1},
    {0,2,4,6,8,9,10,11,-1,-1,-1,-1},
    {2,3,4,6,9,10,11,-1,-1,-1,-1,-1},
    {2,3,4,6,8,-1,-1,-1,-1,-1,-1,-1},
    {0,2,4,6,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,4,6,8,9,-1,-1,-1,-1},
    {1,2,4,6,9,-1,-1,-1,-1,-1,-1,-1},
    {1,3,4,6,8,10,-1,-1,-1,-1,-1,-1},
    {0,1,4,6,10,-1,-1,-1,-1,-1,-1,-1},
    {0,3,4,6,8,9,10,-1,-1,-1,-1,-1},
    {4,6,9,10,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,5,6,7,9,11,-1,-1,-1,-1,-1,-1},
    {0,3,4,5,6,7,8,9,11,-1,-1,-1},
    {0,1,4,5,6,7,11,-1,-1,-1,-1,-1},
    {1,3,4,5,6,7,8,11,-1,-1,-1,-1},
    {1,2,4,5,6,7,9,10,11,-1,-1,-1},
    {0,1,2,3,4,5,6,7,8,9,10,11},
    {0,2,4,5,6,7,10,11,-1,-1,-1,-1},
    {2,3,4,5,6,7,8,10,11,-1,-1,-1},
    {2,3,4,5,6,7,9,-1,-1,-1,-1,-1},
    {0,2,4,5,6,7,8,9,-1,-1,-1,-1},
    {0,1,2,3,4,5,6,7,-1,-1,-1,-1},
    {1,2,4,5,6,7,8,-1,-1,-1,-1,-1},
    {1,3,4,5,6,7,9,10,-1,-1,-1,-1},
    {0,1,4,5,6,7,8,9,10,-1,-1,-1},
    {0,3,4,5,6,7,10,-1,-1,-1,-1,-1},
    {4,5,6,7,8,10,-1,-1,-1,-1,-1,-1},
    {5,6,8,9,11,-1,-1,-1,-1,-1,-1,-1},
    {0,3,5,6,9,11,-1,-1,-1,-1,-1,-1},
    {0,1,5,6,8,11,-1,-1,-1,-1,-1,-1},
    {1,3,5,6,11,-1,-1,-1,-1,-1,-1,-1},
    {1,2,5,6,8,9,10,11,-1,-1,-1,-1},
    {0,1,2,3,5,6,9,10,11,-1,-1,-1},
    {0,2,5,6,8,10,11,-1,-1,-1,-1,-1},
    {2,3,5,6,10,11,-1,-1,-1,-1,-1,-1},
    {2,3,5,6,8,9,-1,-1,-1,-1,-1,-1},
    {0,2,5,6,9,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,5,6,8,-1,-1,-1,-1,-1},
    {1,2,5,6,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,3,5,6,8,9,10,-1,-1,-1,-1,-1},
    {0,1,5,6,9,10,-1,-1,-1,-1,-1,-1},
    {0,3,5,6,8,10,-1,-1,-1,-1,-1,-1},
    {5,6,10,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {5,7,10,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,5,7,8,10,11,-1,-1,-1,-1,-1},
    {0,1,5,7,9,10,11,-1,-1,-1,-1,-1},
    {1,3,5,7,8,9,10,11,-1,-1,-1,-1},
    {1,2,5,7,11,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,5,7,8,11,-1,-1,-1,-1},
    {0,2,5,7,9,11,-1,-1,-1,-1,-1,-1},
    {2,3,5,7,8,9,11,-1,-1,-1,-1,-1},
    {2,3,5,7,10,-1,-1,-1,-1,-1,-1,-1},
    {0,2,5,7,8,10,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,5,7,9,10,-1,-1,-1,-1},
    {1,2,5,7,8,9,10,-1,-1,-1,-1,-1},
    {1,3,5,7,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,5,7,8,-1,-1,-1,-1,-1,-1,-1},
    {0,3,5,7,9,-1,-1,-1,-1,-1,-1,-1},
    {5,7,8,9,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,5,8,10,11,-1,-1,-1,-1,-1,-1,-1},
    {0,3,4,5,10,11,-1,-1,-1,-1,-1,-1},
    {0,1,4,5,8,9,10,11,-1,-1,-1,-1},
    {1,3,4,5,9,10,11,-1,-1,-1,-1,-1},
    {1,2,4,5,8,11,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,4,5,11,-1,-1,-1,-1,-1},
    {0,2,4,5,8,9,11,-1,-1,-1,-1,-1},
    {2,3,4,5,9,11,-1,-1,-1,-1,-1,-1},
    {2,3,4,5,8,10,-1,-1,-1,-1,-1,-1},
    {0,2,4,5,10,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,4,5,8,9,10,-1,-1,-1},
    {1,2,4,5,9,10,-1,-1,-1,-1,-1,-1},
    {1,3,4,5,8,-1,-1,-1,-1,-1,-1,-1},
    {0,1,4,5,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,4,5,8,9,-1,-1,-1,-1,-1,-1},
    {4,5,9,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,7,9,10,11,-1,-1,-1,-1,-1,-1,-1},
    {0,3,4,7,8,9,10,11,-1,-1,-1,-1},
    {0,1,4,7,10,11,-1,-1,-1,-1,-1,-1},
    {1,3,4,7,8,10,11,-1,-1,-1,-1,-1},
    {1,2,4,7,9,11,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,4,7,8,9,11,-1,-1,-1},
    {0,2,4,7,11,-1,-1,-1,-1,-1,-1,-1},
    {2,3,4,7,8,11,-1,-1,-1,-1,-1,-1},
    {2,3,4,7,9,10,-1,-1,-1,-1,-1,-1},
    {0,2,4,7,8,9,10,-1,-1,-1,-1,-1},
    {0,1,2,3,4,7,10,-1,-1,-1,-1,-1},
    {1,2,4,7,8,10,-1,-1,-1,-1,-1,-1},
    {1,3,4,7,9,-1,-1,-1,-1,-1,-1,-1},
    {0,1,4,7,8,9,-1,-1,-1,-1,-1,-1},
    {0,3,4,7,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {8,9,10,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,9,10,11,-1,-1,-1,-1,-1,-1,-1},
    {0,1,8,10,11,-1,-1,-1,-1,-1,-1,-1},
    {1,3,10,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,2,8,9,11,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,9,11,-1,-1,-1,-1,-1,-1},
    {0,2,8,11,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,3,11,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,3,8,9,10,-1,-1,-1,-1,-1,-1,-1},
    {0,2,9,10,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,8,10,-1,-1,-1,-1,-1,-1},
    {1,2,10,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,3,8,9,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,9,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,8,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1}
};

int edgeToVertsTable[12][2] = {
    {0, 1}, // 0
    {1, 2}, // 1
    {2, 3}, // 2
    {0, 3}, // 3
    {4, 5}, // 4
    {5, 6}, // 5
    {6, 7}, // 6
    {4, 7}, // 7
    {0, 4}, // 8
    {1, 5}, // 9
    {2, 6}, // 10
    {3, 7}, // 11
};

int triTable[256][15] = {
    {-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,2,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,2,1,3,2,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,4,3,1,2,5,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,1,3,0,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,2,1,0,4,2,4,3,2,-1,-1,-1,-1,-1,-1},
    {1,2,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,1,2,3,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,4,0,2,3,5,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,4,1,0,3,4,3,2,4,-1,-1,-1,-1,-1,-1},
    {1,2,0,3,2,1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,1,0,2,3,2,4,3,-1,-1,-1,-1,-1,-1},
    {1,2,0,1,4,2,4,3,2,-1,-1,-1,-1,-1,-1},
    {1,0,2,2,0,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,1,0,3,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,5,4,2,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,0,4,2,3,0,3,1,0,-1,-1,-1,-1,-1,-1},
    {0,1,5,4,2,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {3,4,5,3,0,4,1,2,6,-1,-1,-1,-1,-1,-1},
    {5,1,6,5,0,1,4,2,3,-1,-1,-1,-1,-1,-1},
    {0,5,4,0,4,3,0,3,1,3,4,2,-1,-1,-1},
    {4,2,3,1,5,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,2,3,4,1,2,1,0,2,-1,-1,-1,-1,-1,-1},
    {7,0,1,6,4,5,2,3,8,-1,-1,-1,-1,-1,-1},
    {2,3,5,4,2,5,4,5,1,4,1,0,-1,-1,-1},
    {1,5,0,1,6,5,3,4,2,-1,-1,-1,-1,-1,-1},
    {1,5,4,1,2,5,1,0,2,3,5,2,-1,-1,-1},
    {2,3,4,5,0,7,5,7,6,7,0,1,-1,-1,-1},
    {0,1,4,0,4,2,2,4,3,-1,-1,-1,-1,-1,-1},
    {2,1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {5,3,2,0,4,1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,2,1,3,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,3,2,4,1,3,1,0,3,-1,-1,-1,-1,-1,-1},
    {0,1,5,4,3,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {3,0,6,1,2,8,4,7,5,-1,-1,-1,-1,-1,-1},
    {3,1,4,3,2,1,2,0,1,-1,-1,-1,-1,-1,-1},
    {0,5,3,1,0,3,1,3,2,1,2,4,-1,-1,-1},
    {4,3,2,0,1,5,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,6,1,0,4,6,2,5,3,-1,-1,-1,-1,-1,-1},
    {0,5,4,0,1,5,2,3,6,-1,-1,-1,-1,-1,-1},
    {1,0,3,1,3,4,1,4,5,2,4,3,-1,-1,-1},
    {5,1,6,5,0,1,4,3,2,-1,-1,-1,-1,-1,-1},
    {2,5,3,0,4,1,4,6,1,4,7,6,-1,-1,-1},
    {3,2,0,3,0,5,3,5,4,5,0,1,-1,-1,-1},
    {1,0,2,1,2,3,3,2,4,-1,-1,-1,-1,-1,-1},
    {3,1,2,0,1,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,1,0,4,2,1,2,3,1,-1,-1,-1,-1,-1,-1},
    {0,3,4,0,1,3,1,2,3,-1,-1,-1,-1,-1,-1},
    {0,2,1,1,2,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {5,3,4,5,2,3,6,0,1,-1,-1,-1,-1,-1,-1},
    {7,1,2,6,4,0,4,3,0,4,5,3,-1,-1,-1},
    {4,0,1,4,1,2,4,2,3,5,2,1,-1,-1,-1},
    {0,4,2,0,2,1,1,2,3,-1,-1,-1,-1,-1,-1},
    {3,5,2,3,4,5,1,6,0,-1,-1,-1,-1,-1,-1},
    {4,2,3,4,3,1,4,1,0,1,3,5,-1,-1,-1},
    {2,3,7,0,1,6,1,5,6,1,4,5,-1,-1,-1},
    {4,1,0,4,0,3,3,0,2,-1,-1,-1,-1,-1,-1},
    {5,2,4,4,2,3,6,0,1,6,1,7,-1,-1,-1},
    {2,3,0,2,0,4,3,6,0,1,0,5,6,5,0},
    {6,5,0,6,0,1,5,2,0,4,0,3,2,3,0},
    {3,2,0,1,3,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,4,1,2,5,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,0,1,2,5,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,4,1,0,5,4,2,6,3,-1,-1,-1,-1,-1,-1},
    {0,3,2,1,3,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,5,4,1,2,5,3,0,6,-1,-1,-1,-1,-1,-1},
    {4,3,2,4,0,3,0,1,3,-1,-1,-1,-1,-1,-1},
    {2,5,4,2,4,0,2,0,3,1,0,4,-1,-1,-1},
    {0,1,5,4,3,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {6,0,4,6,1,0,5,3,2,-1,-1,-1,-1,-1,-1},
    {0,1,6,2,3,8,4,7,5,-1,-1,-1,-1,-1,-1},
    {2,6,3,0,5,1,5,7,1,5,4,7,-1,-1,-1},
    {3,1,4,3,2,1,2,0,1,-1,-1,-1,-1,-1,-1},
    {0,4,5,0,5,2,0,2,1,2,5,3,-1,-1,-1},
    {1,5,3,0,1,3,0,3,2,0,2,4,-1,-1,-1},
    {1,0,3,1,3,4,4,3,2,-1,-1,-1,-1,-1,-1},
    {1,5,2,0,3,4,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,1,0,2,5,1,4,3,6,-1,-1,-1,-1,-1,-1},
    {1,7,0,3,8,4,6,2,5,-1,-1,-1,-1,-1,-1},
    {7,4,3,0,6,5,0,5,1,5,6,2,-1,-1,-1},
    {4,0,1,4,3,0,2,5,6,-1,-1,-1,-1,-1,-1},
    {1,2,5,5,2,6,3,0,4,3,4,7,-1,-1,-1},
    {6,2,5,7,0,3,0,4,3,0,1,4,-1,-1,-1},
    {5,1,6,5,6,2,1,0,6,3,6,4,0,4,6},
    {1,8,0,5,6,2,7,4,3,-1,-1,-1,-1,-1,-1},
    {3,6,4,2,5,1,2,1,0,1,5,7,-1,-1,-1},
    {0,1,9,4,7,8,2,3,11,5,10,6,-1,-1,-1},
    {6,1,0,6,8,1,6,2,8,5,8,2,3,7,4},
    {6,2,5,1,7,3,1,3,0,3,7,4,-1,-1,-1},
    {3,1,6,3,6,4,1,0,6,5,6,2,0,2,6},
    {0,3,7,0,4,3,0,1,4,8,4,1,6,2,5},
    {2,1,4,2,4,5,0,3,4,3,5,4,-1,-1,-1},
    {3,0,2,1,0,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,6,3,2,5,6,0,4,1,-1,-1,-1,-1,-1,-1},
    {4,0,1,4,3,0,3,2,0,-1,-1,-1,-1,-1,-1},
    {4,1,0,4,0,3,4,3,2,3,0,5,-1,-1,-1},
    {0,2,4,0,1,2,1,3,2,-1,-1,-1,-1,-1,-1},
    {3,0,6,1,2,7,2,4,7,2,5,4,-1,-1,-1},
    {0,1,2,2,1,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,1,0,4,0,2,2,0,3,-1,-1,-1,-1,-1,-1},
    {5,2,4,5,3,2,6,0,1,-1,-1,-1,-1,-1,-1},
    {0,4,1,1,4,7,2,5,6,2,6,3,-1,-1,-1},
    {3,7,2,0,1,5,0,5,4,5,1,6,-1,-1,-1},
    {3,2,0,3,0,5,2,4,0,1,0,6,4,6,0},
    {4,3,2,4,1,3,4,0,1,5,3,1,-1,-1,-1},
    {4,6,1,4,1,0,6,3,1,5,1,2,3,2,1},
    {1,4,3,1,3,0,0,3,2,-1,-1,-1,-1,-1,-1},
    {1,0,2,3,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,4,0,1,2,4,2,3,4,-1,-1,-1,-1,-1,-1},
    {0,3,1,0,5,3,0,4,5,2,3,5,-1,-1,-1},
    {5,2,3,1,5,3,1,3,4,1,4,0,-1,-1,-1},
    {4,2,3,4,3,0,0,3,1,-1,-1,-1,-1,-1,-1},
    {0,1,2,0,2,4,0,4,5,4,2,3,-1,-1,-1},
    {2,4,6,2,6,1,4,5,6,0,6,3,5,3,6},
    {3,4,0,3,0,2,2,0,1,-1,-1,-1,-1,-1,-1},
    {3,1,0,2,3,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,7,6,2,4,6,4,5,4,2,3,-1,-1,-1},
    {1,0,3,1,3,6,0,4,3,2,3,5,4,5,3},
    {1,6,0,1,5,6,1,7,5,4,5,7,2,3,8},
    {5,1,0,5,0,3,4,2,0,2,3,0,-1,-1,-1},
    {4,5,2,4,2,3,5,0,2,6,2,1,0,1,2},
    {0,4,1,5,2,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {3,4,0,3,0,2,1,5,0,5,2,0,-1,-1,-1},
    {1,2,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,0,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,0,4,5,3,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,4,5,3,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,0,5,4,1,0,6,3,2,-1,-1,-1,-1,-1,-1},
    {4,0,1,2,5,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,2,7,3,0,6,4,8,5,-1,-1,-1,-1,-1,-1},
    {1,4,0,1,5,4,2,6,3,-1,-1,-1,-1,-1,-1},
    {2,7,3,0,6,1,6,4,1,6,5,4,-1,-1,-1},
    {3,0,1,2,0,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {3,0,4,3,2,0,2,1,0,-1,-1,-1,-1,-1,-1},
    {2,5,4,2,3,5,0,1,6,-1,-1,-1,-1,-1,-1},
    {0,2,1,0,4,2,0,5,4,4,3,2,-1,-1,-1},
    {4,3,2,4,0,3,0,1,3,-1,-1,-1,-1,-1,-1},
    {5,3,2,1,3,5,1,4,3,1,0,4,-1,-1,-1},
    {0,1,3,0,3,5,0,5,4,2,5,3,-1,-1,-1},
    {1,0,4,1,4,2,2,4,3,-1,-1,-1,-1,-1,-1},
    {1,2,0,3,2,1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,3,4,1,0,3,0,2,3,-1,-1,-1,-1,-1,-1},
    {4,3,6,4,2,3,5,0,1,-1,-1,-1,-1,-1,-1},
    {4,2,3,4,3,1,4,1,0,5,1,3,-1,-1,-1},
    {3,4,2,3,6,4,1,5,0,-1,-1,-1,-1,-1,-1},
    {1,2,6,3,0,7,0,5,7,0,4,5,-1,-1,-1},
    {2,7,4,2,3,7,0,1,5,1,6,5,-1,-1,-1},
    {5,4,1,5,1,0,4,2,1,6,1,3,2,3,1},
    {4,0,1,4,2,0,2,3,0,-1,-1,-1,-1,-1,-1},
    {0,2,1,2,3,1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,7,0,2,3,4,2,4,5,4,3,6,-1,-1,-1},
    {0,4,2,0,2,1,1,2,3,-1,-1,-1,-1,-1,-1},
    {4,0,1,4,3,0,4,2,3,3,5,0,-1,-1,-1},
    {4,1,0,4,0,3,3,0,2,-1,-1,-1,-1,-1,-1},
    {2,3,1,2,1,4,3,6,1,0,1,5,6,5,1},
    {3,2,0,1,3,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,4,1,3,2,5,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,6,1,2,7,3,8,5,4,-1,-1,-1,-1,-1,-1},
    {3,0,1,3,2,0,5,4,6,-1,-1,-1,-1,-1,-1},
    {7,5,4,6,1,2,1,3,2,1,0,3,-1,-1,-1},
    {6,3,2,7,0,1,5,4,8,-1,-1,-1,-1,-1,-1},
    {6,11,7,1,2,10,0,8,3,4,9,5,-1,-1,-1},
    {5,4,7,3,2,6,2,1,6,2,0,1,-1,-1,-1},
    {1,2,6,1,3,2,1,0,3,7,3,0,8,5,4},
    {5,0,1,5,4,0,3,2,6,-1,-1,-1,-1,-1,-1},
    {7,3,2,0,6,4,0,4,1,4,6,5,-1,-1,-1},
    {3,6,2,3,7,6,1,5,0,5,4,0,-1,-1,-1},
    {4,1,6,4,6,5,1,0,6,2,6,3,0,3,6},
    {6,3,2,7,0,4,0,5,4,0,1,5,-1,-1,-1},
    {1,4,8,1,5,4,1,0,5,6,5,0,7,3,2},
    {2,0,6,2,6,3,0,1,6,4,6,5,1,5,6},
    {3,2,5,3,5,4,1,0,5,0,4,5,-1,-1,-1},
    {1,3,0,1,4,3,4,2,3,-1,-1,-1,-1,-1,-1},
    {1,3,5,0,3,1,0,2,3,0,4,2,-1,-1,-1},
    {0,5,4,0,2,5,0,1,2,2,3,5,-1,-1,-1},
    {3,4,1,3,1,2,2,1,0,-1,-1,-1,-1,-1,-1},
    {0,1,6,5,2,7,5,7,4,7,2,3,-1,-1,-1},
    {0,8,3,0,5,8,0,6,5,4,5,6,1,2,7},
    {6,4,2,6,2,3,4,0,2,5,2,1,0,1,2},
    {3,5,1,3,1,2,0,4,1,4,2,1,-1,-1,-1},
    {2,4,5,2,0,4,2,3,0,1,4,0,-1,-1,-1},
    {4,2,3,4,3,0,0,3,1,-1,-1,-1,-1,-1,-1},
    {1,4,6,1,6,0,4,5,6,3,6,2,5,2,6},
    {0,2,3,1,0,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,3,0,3,6,1,4,3,2,3,5,4,5,3},
    {5,1,0,5,0,3,4,2,0,2,3,0,-1,-1,-1},
    {0,1,4,2,3,5,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,0,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {3,0,2,1,0,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {6,2,5,6,3,2,4,1,0,-1,-1,-1,-1,-1,-1},
    {2,6,3,2,5,6,1,4,0,-1,-1,-1,-1,-1,-1},
    {6,3,2,6,7,3,5,4,0,4,1,0,-1,-1,-1},
    {4,0,1,4,3,0,3,2,0,-1,-1,-1,-1,-1,-1},
    {0,6,3,1,2,5,1,5,4,5,2,7,-1,-1,-1},
    {4,3,2,4,1,3,4,0,1,1,5,3,-1,-1,-1},
    {3,2,0,3,0,6,2,5,0,1,0,4,5,4,0},
    {0,2,4,0,1,2,1,3,2,-1,-1,-1,-1,-1,-1},
    {4,1,0,4,2,1,4,3,2,5,1,2,-1,-1,-1},
    {6,0,1,4,7,3,4,3,5,3,7,2,-1,-1,-1},
    {5,4,1,5,1,0,4,3,1,6,1,2,3,2,1},
    {0,1,2,1,3,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,4,3,0,3,1,1,3,2,-1,-1,-1,-1,-1,-1},
    {4,0,1,4,1,2,2,1,3,-1,-1,-1,-1,-1,-1},
    {3,2,1,0,3,1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,2,0,1,3,2,3,4,2,-1,-1,-1,-1,-1,-1},
    {3,0,2,3,5,0,3,4,5,5,1,0,-1,-1,-1},
    {0,1,5,4,2,6,4,6,7,6,2,3,-1,-1,-1},
    {5,6,2,5,2,3,6,1,2,4,2,0,1,0,2},
    {1,3,0,1,4,3,1,5,4,2,3,4,-1,-1,-1},
    {0,4,6,0,6,3,4,5,6,2,6,1,5,1,6},
    {0,1,3,0,3,5,1,6,3,2,3,4,6,4,3},
    {4,2,3,0,5,1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,3,5,1,3,0,1,2,3,1,4,2,-1,-1,-1},
    {3,4,1,3,1,2,2,1,0,-1,-1,-1,-1,-1,-1},
    {3,8,2,3,5,8,3,6,5,4,5,6,0,1,7},
    {3,5,1,3,1,2,0,4,1,4,2,1,-1,-1,-1},
    {4,2,3,4,3,1,1,3,0,-1,-1,-1,-1,-1,-1},
    {0,2,3,1,0,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {4,2,3,4,3,1,5,0,3,0,1,3,-1,-1,-1},
    {2,0,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,4,1,0,2,4,2,3,4,-1,-1,-1,-1,-1,-1},
    {0,4,1,2,5,3,5,7,3,5,6,7,-1,-1,-1},
    {1,4,5,1,5,2,1,2,0,3,2,5,-1,-1,-1},
    {1,0,2,1,2,4,0,5,2,3,2,6,5,6,2},
    {2,5,3,4,5,2,4,1,5,4,0,1,-1,-1,-1},
    {7,5,4,7,8,5,7,1,8,2,8,1,0,6,3},
    {4,3,2,4,2,1,1,2,0,-1,-1,-1,-1,-1,-1},
    {5,3,2,5,2,0,4,1,2,1,0,2,-1,-1,-1},
    {0,4,5,0,3,4,0,1,3,3,2,4,-1,-1,-1},
    {5,6,3,5,3,2,6,1,3,4,3,0,1,0,3},
    {3,5,6,3,6,2,5,4,6,1,6,0,4,0,6},
    {0,5,1,4,3,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,4,0,2,0,3,3,0,1,-1,-1,-1,-1,-1,-1},
    {2,5,1,2,1,3,0,4,1,4,3,1,-1,-1,-1},
    {2,0,1,3,2,1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,2,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,2,0,2,3,0,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,0,2,1,2,4,4,2,3,-1,-1,-1,-1,-1,-1},
    {0,1,3,0,3,2,2,3,4,-1,-1,-1,-1,-1,-1},
    {1,0,2,3,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,4,0,4,3,3,4,2,-1,-1,-1,-1,-1,-1},
    {3,0,4,3,4,5,1,2,4,2,5,4,-1,-1,-1},
    {0,1,3,2,0,3,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {1,0,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,0,2,4,4,2,3,-1,-1,-1,-1,-1,-1},
    {2,3,1,0,2,1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {2,3,4,2,4,5,0,1,4,1,5,4,-1,-1,-1},
    {0,2,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,3,0,2,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,2,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {0,1,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1},
    {-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1}
};

struct Vec3Int neighbourConfigs[8] = {
    {0, 0, 0}, // body point
    {0, 0, 1}, // z+ face neighbour
    {0, 1, 0}, // y+ face neighbour
    {0, 1, 1}, // x+ edge neighbour
    {1, 0, 0}, // x+ face neighbour
    {1, 0, 1}, // y+ edge neighbour
    {1, 1, 0}, // z+ edge neighbour
    {1, 1, 1}  // corner neighbour 
};

int requiredNeighbours[8][7] = {
    {-1, -1, -1, -1, -1, -1, -1}, // the cell itself
    { 1, -1, -1, -1, -1, -1, -1}, // z+ face neighbour
    { 2, -1, -1, -1, -1, -1, -1}, // y+ face neighbour
    { 1,  2,  3, -1, -1, -1, -1}, // x+ edge neighbour
    { 4, -1, -1, -1, -1, -1, -1}, // x+ face neighbour
    { 1,  4,  5, -1, -1, -1, -1}, // y+ edge neighbour
    { 2,  4,  6, -1, -1, -1, -1}, // z+ edge neighbour
    { 1,  2,  3,  4,  5,  6,  7}  // corner neighbour 
};

struct Vec3Int blockDimensions = {blockSizeX, blockSizeY, blockSizeZ};
int blockVol = blockSizeX*blockSizeY*blockSizeZ;


// float* data;
// int dataLength;
float* points;
int pointsLength;
int* codes;
int codesCount;

// struct Vec3Int size;

float* verts;
int vertsNum;
uint* indices;
int indicesNum;


int* EMSCRIPTEN_KEEPALIVE allocateBuffer(int byteLength) {
    return malloc(byteLength);
}

void EMSCRIPTEN_KEEPALIVE freeBuffer(int* location) {
    free(location);
}

// data length is the number of dataPoints
// float* EMSCRIPTEN_KEEPALIVE assignDataLocation(int x, int y, int z) {
//     //console_log(6421);
//     dataLength = x*y*z;
//     size.x = x;
//     size.y = y;
//     size.z = z;
//     data = malloc(dataLength * sizeof(float));
//     return data;
// }

struct Vec3Int EMSCRIPTEN_KEEPALIVE posFromIndex(int i, struct Vec3Int size) {
    return (struct Vec3Int){i/(size.y*size.z), (i/size.z)%size.y, i%size.z};
}

uint EMSCRIPTEN_KEEPALIVE indexFromPos(struct Vec3Int pos, struct Vec3Int size) {
    return (uint)(size.z * size.y * pos.x + size.z * pos.y + pos.z);
}

float* EMSCRIPTEN_KEEPALIVE assignPointsLocation(int x, int y, int z) {
    pointsLength = x*y*z;
    points = malloc(pointsLength * 3 * sizeof(float));
    return points;
}

// calculate the codes
void calculateCodes(float* data, struct Vec3Int size, float threshold) {
    int index;
    //console_log((float)dataLength);
    struct Vec3Int cellsSize;
    cellsSize.x = size.x - 1;
    cellsSize.y = size.y - 1;
    cellsSize.z = size.z - 1;
    codesCount = cellsSize.x*cellsSize.y*cellsSize.z;
    int count = 0;
    bool shown = false;
    //console_log(sizeX);
    for (int i = 0; i < cellsSize.x; i++) {
        for (int j = 0; j < cellsSize.y; j++) {
            for (int k = 0; k < cellsSize.z; k++) {
                codes[cellsSize.y * cellsSize.z * i + cellsSize.z * j + k] = 0;
                for (int l = 0; l < 8; l++) {
                    
                    int* c = vertCoordTable[l];
                    // indexing data needs full dimensions
                    index = size.y * size.z * (i + c[0]) + size.z * (j + c[1]) + k + c[2];
                    float val = data[index];
                    // indexing codes uses X Y Z (dim - 1)
                    codes[cellsSize.y * cellsSize.z * i + cellsSize.z * j + k] |= (val > threshold) << l;

                    count++;
                    // if (sizeX == 0 && shown == false) {
                    //     shown = true;
                    //     console_log(count);
                    //     console_log((float)(Y * Z * i + Z * j + k));
                    // }
                }
            }
        }
    }
    //console_log(sizeX);
}

float* EMSCRIPTEN_KEEPALIVE getVertsLocation() {
    return verts;
}

uint* EMSCRIPTEN_KEEPALIVE getIndicesLocation() {
    return indices;
}

int EMSCRIPTEN_KEEPALIVE getVertsCount() {
    return vertsNum;
}
int EMSCRIPTEN_KEEPALIVE getIndicesCount() {
    return indicesNum;
}

// enumeration to see how many verts/indicies are generated
int EMSCRIPTEN_KEEPALIVE calcVertsCount() {
    int total = 0;
    for (int i = 0; i < codesCount; i++) {
        // loop through each code
        for (int j = 0; j < 12; j++) {
            if (edgeTable[codes[i]][j] != -1) {
                total++;
            } else {
                break;
            }
        }
    }    
    return total;
}

int EMSCRIPTEN_KEEPALIVE calcIndicesCount() {
    int total = 0;
    for (int i = 0; i < codesCount; i++) {
        // loop through each code
        for (int j = 0; j < 15; j++) {
            if (triTable[codes[i]][j] != -1) {
                total++;
            } else {
                break;
            }
        }
    }    
    return total;
}

void EMSCRIPTEN_KEEPALIVE addIndices(uint* indices, uint* currInd, uint currVert, int code) { 
    int* tri = triTable[code];
    for (int i = 0; i < 15; i++) {
        if (tri[i] != -1) {
            indices[*currInd + i] = tri[i] + currVert;
        } else {
            *currInd += i;
            break;
        }
    }
}

// get the positions of the verts for a cell
void EMSCRIPTEN_KEEPALIVE addVerts(
    float* verts,
    uint* curr, 
    int code, 
    struct Vec3Int pointPos,
    float* data, 
    float* points,
    struct Vec3Int size,
    struct Vec3Float scale,
    float threshold, 
    bool pointsBool
) {
    int* edges = edgeTable[code];
    for (int i = 0; i < 12; i++) {
        if (edges[i] != -1) {
            // add vertex position to vertex list
            int connected[2] = {
                edgeToVertsTable[edges[i]][0],
                edgeToVertsTable[edges[i]][1],
            };

            int a[3] = {
                vertCoordTable[connected[0]][0],
                vertCoordTable[connected[0]][1],
                vertCoordTable[connected[0]][2]
            };
            int b[3] = {
                vertCoordTable[connected[1]][0],
                vertCoordTable[connected[1]][1],
                vertCoordTable[connected[1]][2]
            };

            int aInd = size.y*size.z*(a[0] + pointPos.x) + size.z*(a[1] + pointPos.y) + a[2] + pointPos.z;
            int bInd = size.y*size.z*(b[0] + pointPos.x) + size.z*(b[1] + pointPos.y) + b[2] + pointPos.z;
            // the values at the endpoints of the edge
            float va = data[aInd];
            float vb = data[bInd];
            
            float fac = (threshold-va)/(vb-va);

            if (pointsBool == true) {
                // if the points are defined explicitly
                float pa[3] = {
                    points[3*aInd + 0],
                    points[3*aInd + 1],
                    points[3*aInd + 2]
                };
                float pb[3] = {
                    points[3*bInd + 0],
                    points[3*bInd + 1],
                    points[3*bInd + 2]
                };
                verts[3*(*curr) + 0] = pa[0]*(1.0-fac) + pb[0]*fac;
                verts[3*(*curr) + 1] = pa[1]*(1.0-fac) + pb[1]*fac;
                verts[3*(*curr) + 2] = pa[2]*(1.0-fac) + pb[2]*fac;
            } else {
                verts[3*(*curr) + 0] = ((float)a[0]*(1-fac) + (float)b[0]*fac + (float)pointPos.x)*scale.x;
                verts[3*(*curr) + 1] = ((float)a[1]*(1-fac) + (float)b[1]*fac + (float)pointPos.y)*scale.y;
                verts[3*(*curr) + 2] = ((float)a[2]*(1-fac) + (float)b[2]*fac + (float)pointPos.z)*scale.z;
            }

            (*curr)++;
        } else {
            break;
        }
    }
}

// extract isosurface 
int EMSCRIPTEN_KEEPALIVE generateMesh(
    float* data,
    float* points,
    int dataSizeX,
    int dataSizeY,
    int dataSizeZ,
    float scaleX,   // controls scaling, doesn't affect how many cells a virtual cell is
    float scaleY,   // controls scaling, doesn't affect how many cells a virtual cell is
    float scaleZ,   // controls scaling, doesn't affect how many cells a virtual cell is
    float threshold, 
    bool pointsBool
) {
    //console_log(123);
    struct Vec3Int size;
    size.x = dataSizeX;
    size.y = dataSizeY;
    size.z = dataSizeZ;

    struct Vec3Float scale = {scaleX, scaleY, scaleZ};

    // console_log_int(dataSizeX);
    // console_log_int(dataSizeY);
    // console_log_int(dataSizeZ);
    // console_log_float(data[70]);

    int codesCount = (size.x - 1) * (size.y - 1) * (size.z - 1);  
    codes = (int*) malloc(codesCount * sizeof(int));
    calculateCodes(data, size, threshold);

    //console_log(1234);
    vertsNum = calcVertsCount();
    verts = (float*) malloc(vertsNum * 3 * sizeof(float));
    
    indicesNum = calcIndicesCount();
    indices = (uint*) malloc(indicesNum * sizeof(uint));
    
    struct Vec3Int cellsSize;
    cellsSize.x = size.x - 1;
    cellsSize.y = size.y - 1;
    cellsSize.z = size.z - 1;

    // int X = sizeX-1;
    // int Y = sizeY-1;
    // int Z = sizeZ-1;
    // holds current vertex number in array
    uint currVert = 0;
    uint currInd = 0;
    uint codeIndex = 0;

    // console_log_bin(pointsBool);

    for (int i = 0; i < cellsSize.x; i++) {
        for (int j = 0; j < cellsSize.y; j++) {
            for (int k = 0; k < cellsSize.z; k++) {
                codeIndex = cellsSize.y * cellsSize.z * i + cellsSize.z * j + k;
                // loop throught all generated codes
                if (codes[codeIndex] == 0 || codes[codeIndex] == 255) {
                    continue;
                }
                addIndices(indices, &currInd, currVert, codes[codeIndex]);
                struct Vec3Int pointPos = {i, j, k};
                // pointPos.x = i;
                // pointPos.y = j;
                // pointPos.z = k;
                addVerts(verts, &currVert, codes[codeIndex], pointPos, data, points, size, scale, threshold, pointsBool);
                // calculate indices values
            }
        }
    }
    //console_log(12345);
    free(codes);
    return vertsNum;
}




// fine marching portion ===============================================================================================================================================


//
float getFineDataValue(float* fineData, uint slotNum, struct Vec3Int pos) {
    return fineData[slotNum*blockVol + blockDimensions.y * blockDimensions.z * pos.x + blockDimensions.z * pos.y + pos.z];
}

struct Vec3Float getFinePoint(float* finePoints, uint slotNum, struct Vec3Int pos) {
    return (struct Vec3Float){
        finePoints[3*(slotNum*blockVol + blockDimensions.y * blockDimensions.z * pos.x + blockDimensions.z * pos.y + pos.z) + 0],
        finePoints[3*(slotNum*blockVol + blockDimensions.y * blockDimensions.z * pos.x + blockDimensions.z * pos.y + pos.z) + 1],
        finePoints[3*(slotNum*blockVol + blockDimensions.y * blockDimensions.z * pos.x + blockDimensions.z * pos.y + pos.z) + 2],
    };
}

void getNeighboursPresent(bool* out, int* neighbourSlots, struct Vec3Int blockPos, int* blockLocations, struct Vec3Int blocksSize) {
    out[0] = true;
    for (int i = 1; i < 8; i++) {
        struct Vec3Int neighbourPos = {
            blockPos.x + neighbourConfigs[i].x,
            blockPos.y + neighbourConfigs[i].y,
            blockPos.z + neighbourConfigs[i].z
        };
        if (neighbourPos.x < blocksSize.x && neighbourPos.y < blocksSize.y && neighbourPos.z < blocksSize.z) {
            //neighbour is within boundary
            uint neighbourIndex = indexFromPos(neighbourPos, blocksSize);
            neighbourSlots[i] = blockLocations[neighbourIndex];
            if (neighbourSlots[i] != -1) {
                // the face neighbour is part of the loaded dataset
                // now increment the correct dimenson of cellsSize
                out[i] = true;
            } else {
                out[i] = false;
            }
        }
    }
}

bool neededNeighboursPresent(struct Vec3Int cellPos, bool* neighboursPresent) {
    int code = (cellPos.z == blockDimensions.z - 1) | 
               ((cellPos.y == blockDimensions.y - 1) << 1) | 
               ((cellPos.x == blockDimensions.x - 1) << 2);
    if (code == 0) {
        // cell doesn't need any neighbours
        return true;
    }
    for (int i = 0; i < 7; i++) {
        if (requiredNeighbours[code][i] == -1) {
            break;
        } else if (neighboursPresent[requiredNeighbours[code][i]] == false) {
            return false;
        }
    }
    return true;
}

// struct Counts getCountsForBlock(uint blockID, int* blockLocations, float* fineData, float threshold, struct Vec3Int blocksSize) {
    
// }

void populateBlockData(float* fineData, float* finePoints, float blockData[5][5][5], struct Vec3Float blockPoints[5][5][5], int* slotNums, bool points) {
    for (int i = 0; i < blockSizeX; i++) {
        for (int j = 0; j < blockSizeY; j++) {
            for (int k = 0; k < blockSizeZ; k++) {
                // calc a vector that says on what sides this point needs data from neighbour cells
                struct Vec3Int neighboursNeeded = {
                    i == blockSizeX - 1,
                    j == blockSizeY - 1,
                    k == blockSizeZ - 1,
                };
                // loop through each of the neighbour blocks
                for (int x = 0; x < 8; x++) {
                    // check if this point needs data from this neighbour
                    if (neighbourConfigs[x].x == true && neighboursNeeded.x == false) continue;
                    if (neighbourConfigs[x].y == true && neighboursNeeded.y == false) continue;
                    if (neighbourConfigs[x].z == true && neighboursNeeded.z == false) continue;

                    // load the data needed from this cell
                    struct Vec3Int src = {
                        i * (1 - neighbourConfigs[x].x),
                        j * (1 - neighbourConfigs[x].y),
                        k * (1 - neighbourConfigs[x].z)
                    };
                    struct Vec3Int dst = {
                        i + neighbourConfigs[x].x, 
                        j + neighbourConfigs[x].y, 
                        k + neighbourConfigs[x].z
                    };
                    blockData[dst.x][dst.y][dst.z] = getFineDataValue(fineData, slotNums[x], src);
                    if (points) {
                        blockPoints[dst.x][dst.y][dst.z] = getFinePoint(finePoints, slotNums[x], src);
                    }
                }
            }
        }
    }
}

float blockSum(float blockData[5][5][5]) {
    float total = 0;
    for (int i = 0; i < blockSizeX; i++) {
        for (int j = 0; j < blockSizeY; j++) {
            for (int k = 0; k < blockSizeZ; k++) {
                total += blockData[i][j][k];
            }
        }
    }
    return total;
}

// adds verts for a particular cell
void addVertsFine(
    float* verts,
    uint* curr, 
    int code, 
    struct Vec3Int cellPos,
    struct Vec3Int blockPos,
    float blockData[5][5][5],
    struct Vec3Float blockPoints[5][5][5],
    struct Vec3Float scale,
    float threshold, 
    bool pointsBool
) {
    int* edges = edgeTable[code];
    for (int i = 0; i < 12; i++) {
        if (edges[i] != -1) {
            // add vertex position to vertex list
            int connected[2] = {
                edgeToVertsTable[edges[i]][0],
                edgeToVertsTable[edges[i]][1],
            };

            int a[3] = {
                vertCoordTable[connected[0]][0],
                vertCoordTable[connected[0]][1],
                vertCoordTable[connected[0]][2]
            };
            int b[3] = {
                vertCoordTable[connected[1]][0],
                vertCoordTable[connected[1]][1],
                vertCoordTable[connected[1]][2]
            };

            // int aInd = size.y*size.z*(a[0] + pointPos.x) + size.z*(a[1] + pointPos.y) + a[2] + pointPos.z;
            // int bInd = size.y*size.z*(b[0] + pointPos.x) + size.z*(b[1] + pointPos.y) + b[2] + pointPos.z;
            // the values at the endpoints of the edge
            float va = blockData[cellPos.x + a[0]][cellPos.y + a[1]][cellPos.z + a[2]];
            float vb = blockData[cellPos.x + b[0]][cellPos.y + b[1]][cellPos.z + b[2]];
            
            float fac = (threshold-va)/(vb-va);

            if (pointsBool == true) {
                // if the points are defined explicitly
                struct Vec3Float pa = blockPoints[cellPos.x + a[0]][cellPos.y + a[1]][cellPos.z + a[2]];
                struct Vec3Float pb = blockPoints[cellPos.x + b[0]][cellPos.y + b[1]][cellPos.z + b[2]];

                verts[3*(*curr) + 0] = pa.x*(1.0-fac) + pb.x*fac;
                verts[3*(*curr) + 1] = pa.y*(1.0-fac) + pb.y*fac;
                verts[3*(*curr) + 2] = pa.z*(1.0-fac) + pb.z*fac;
            } else {
                verts[3*(*curr) + 0] = ((float)a[0]*(1-fac) + (float)b[0]*fac + (float)cellPos.x + (float)blockPos.x*blockSizeX)*scale.x;
                verts[3*(*curr) + 1] = ((float)a[1]*(1-fac) + (float)b[1]*fac + (float)cellPos.y + (float)blockPos.y*blockSizeY)*scale.y;
                verts[3*(*curr) + 2] = ((float)a[2]*(1-fac) + (float)b[2]*fac + (float)cellPos.z + (float)blockPos.z*blockSizeZ)*scale.z;
            }

            (*curr)++;
        } else {
            break;
        }
    }
}

// extract isosurface from fine data
int EMSCRIPTEN_KEEPALIVE generateMeshFine(
    float* fineData,
    float* finePoints,
    int blocksSizeX, // size of dataset in blocks
    int blocksSizeY, // size of dataset in blocks
    int blocksSizeZ, // size of dataset in blocks
    int dataSizeX,
    int dataSizeY,
    int dataSizeZ,
    uint* activeBlocks,
    uint activeBlocksCount, 
    int* blockLocations,
    float scaleX,    // controls scaling, doesn't affect how many cells a virtual cell is
    float scaleY,    // controls scaling, doesn't affect how many cells a virtual cell is
    float scaleZ,    // controls scaling, doesn't affect how many cells a virtual cell is
    float threshold, 
    bool pointsBool
) {
    struct Vec3Int dataSize = {dataSizeX, dataSizeY, dataSizeZ};
    struct Vec3Int blocksSize = {blocksSizeX, blocksSizeY, blocksSizeZ};
    struct Vec3Float scale = {scaleX, scaleY, scaleZ};
    // go through each block in activeBlocks sequentially

    vertsNum = 0;
    indicesNum = 0;


    // console_log_int(activeBlocksCount);
    // enumeration step
    for (uint x = 0; x < activeBlocksCount; x++) {
        // figure out if this point has a valid cell associated with it
        // i.e. fully within the bounds of the dataset and the requisite neighbour is loaded if on a forward face
        uint blockID = activeBlocks[x];
        // console_log_int(blockID);

        int slotNum = blockLocations[blockID];
        // console_log_int(slotNum);
        // get the position of the block in the overall block stucture
        struct Vec3Int blockPos = posFromIndex(blockID, blocksSize);


        // figure out which neighbour blocks are present
        bool neighboursPresent[8];
        int neighbourSlotNums[8];
        neighbourSlotNums[0] = slotNum; // set the slot number of this block
        getNeighboursPresent(neighboursPresent, neighbourSlotNums, blockPos, blockLocations, blocksSize);
        // grab all needed data
        float blockData[blockSizeX + 1][blockSizeX + 1][blockSizeX + 1];
        struct Vec3Float blockPoints[blockSizeX + 1][blockSizeX + 1][blockSizeX + 1];
        populateBlockData(fineData, finePoints, blockData, blockPoints, neighbourSlotNums, false);

        for (int i = 0; i < blockDimensions.x; i++) {
            for (int j = 0; j < blockDimensions.y; j++) {
                for (int k = 0; k < blockDimensions.z; k++) {
                    if (!neededNeighboursPresent((struct Vec3Int){i, j, k}, neighboursPresent)) {
                        continue;
                    }
                    // get the code for this cell


                    int code = 0;
                    for (int l = 0; l < 8; l++) {
                        // struct Vec3Int thisBlockPos = blockPos;
                        int* c = vertCoordTable[l];
                        struct Vec3Int pos = {i + c[0], j + c[1], k + c[2]};
                        
                        // int thisSlotNum = blockLocations[indexFromPos(thisBlockPos, blocksSize)];
                        float val = blockData[pos.x][pos.y][pos.z];//getFineDataValue(fineData, thisSlotNum, pos);
                        code |= (val > threshold) << l;
                    }

                    // and how many indices and vertices it will generate, adding to totals
                    for (int l = 0; l < 12; l++) {
                        if (edgeTable[code][l] != -1) {
                            vertsNum++;
                        } else {
                            break;
                        }
                    }

                    for (int l = 0; l < 15; l++) {
                        if (triTable[code][l] != -1) {
                            indicesNum++;
                        } else {
                            break;
                        }
                    }
                }
            }
        }
    }

    // allocate memory for vert and indices arrays
    verts = (float*) malloc(vertsNum * 3 * sizeof(float));
    indices = (uint*) malloc(indicesNum * sizeof(uint));

    // console_log_int(vertsNum);
    // console_log_int(indicesNum);

    uint currVert = 0;
    uint currInd = 0;
    uint codeIndex = 0;

    // vert generation step
    for (uint x = 0; x < activeBlocksCount; x++) {
        // figure out if this point has a valid cell associated with it
        // i.e. fully within the bounds of the dataset and the requisite neighbour is loaded if on a forward face
        uint blockID = activeBlocks[x];

        int slotNum = blockLocations[blockID];
        // get the position of the block in the overall block stucture
        struct Vec3Int blockPos = posFromIndex(blockID, blocksSize);


        // figure out which neighbour blocks are present
        bool neighboursPresent[8];
        int neighbourSlotNums[8];
        neighbourSlotNums[0] = slotNum; // set the slot number of this block
        getNeighboursPresent(neighboursPresent, neighbourSlotNums, blockPos, blockLocations, blocksSize);
        // grab all needed data
        float blockData[blockSizeX + 1][blockSizeX + 1][blockSizeX + 1];
        struct Vec3Float blockPoints[blockSizeX + 1][blockSizeX + 1][blockSizeX + 1];
        populateBlockData(fineData, finePoints, blockData, blockPoints, neighbourSlotNums, pointsBool);

        for (int i = 0; i < blockDimensions.x; i++) {
            for (int j = 0; j < blockDimensions.y; j++) {
                for (int k = 0; k < blockDimensions.z; k++) {
                    if (!neededNeighboursPresent((struct Vec3Int){i, j, k}, neighboursPresent)){
                        continue;
                    }
                    // get the code for this cell
                    int code = 0;
                    for (int l = 0; l < 8; l++) {
                        int* c = vertCoordTable[l];
                        struct Vec3Int pos = {i + c[0], j + c[1], k + c[2]};
                        
                        // int thisSlotNum = blockLocations[indexFromPos(thisBlockPos, blocksSize)];
                        float val = blockData[pos.x][pos.y][pos.z];//getFineDataValue(fineData, thisSlotNum, pos);
                        code |= (val > threshold) << l;
                    }

                    // skip if empty
                    if (code == 0 || code == 255) {
                        continue;
                    }

                    // add indices for this cell
                    addIndices(indices, &currInd, currVert, code);

                    // add vertices for this cell
                    addVertsFine(verts, &currVert, code, (struct Vec3Int){i, j, k}, blockPos, blockData, blockPoints, scale, threshold, pointsBool);
                }
            }
        }
    }

    return vertsNum;
}

// free the memory used for this isosurface
void EMSCRIPTEN_KEEPALIVE freeMem () {
    free(verts);
    free(indices);
}

// setup (static):
// > data Buffer is created
// > data is set in buffer

// marching (static):
// > call generate mesh
//   > pass in data buffer, length
//   > pass in data dimensions
//   > needs to free codes as end
// > get the length of indicies and verticies
// > make index buffer (uint32) don't allocate
// > make

// setup (fine):
// > fine data buffer is created (float32)
// > block locations buffer is created (uint32)
// > locations occupied types array (uint8) (js side)

// update active:
// > delete activeBlocks buffer if exists
// > create new active blocks of right length
// > fill with active block#s

// update fine data:
// > dataObj, addBlocks, removeBlocks, fineData
// > try on js side first (probably fast)
// > do same procedure as others in js
// > manipulate 

// march (fine):
// > call the march fine function
// >



// codes doesn't need to be read so it can remain just within WASM instance
// codes take up a lot of space!
// data can be created as a buffer