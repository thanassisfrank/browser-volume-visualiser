//VecMath.js

import {sin30, cos30, toRads} from "./utils.js";

export const VecMath = {
	
	// All of these functions expect vectors of three dimensions and
	// three by three matricies
	// [[0, 1, 2],     [0,
	//  [3, 4, 5], and  1,
	//  [6, 7, 8]]      2]

	vecAdd: function(vec, vec1) {
		var newX = vec[0] + vec1[0];
		var newY = vec[1] + vec1[1];
		var newZ = vec[2] + vec1[2];
		
		return [newX, newY, newZ];
	},
	vecMinus: function(vec, vec1) {
		var newX = vec[0] - vec1[0];
		var newY = vec[1] - vec1[1];
		var newZ = vec[2] - vec1[2];
		
		return [newX, newY, newZ];
	},
	vecMult: function(vec, vec1) {
		return [vec[0]*vec1[0], vec[1]*vec1[1], vec[2]*vec1[2]]
	},
	scalMult: function(scal, vec) {
		const newX = vec[0] * scal;
		const newY = vec[1] * scal;
		const newZ = vec[2] * scal;
		
		return [newX, newY, newZ];
	},
	// multiply a matrix and column vector
	matrixVecMult: function(matrix, vec) {
		if (matrix[0].length != vec.length) return;
		var result = [];

		for (let i = 0; i < matrix.length; i++) {
			result[i] = 0;
			for (let j = 0; j < vec.length; j++) {
				result[i] += vec[j] * matrix[i][j];
			} 
		}

		return result;

		// var newX = vec[0] * matrix[0][0] + vec[1] * matrix[0][1] + vec[2] * matrix[0][2];
		// var newY = vec[0] * matrix[1][0] + vec[1] * matrix[1][1] + vec[2] * matrix[1][2];
		// var newZ = vec[0] * matrix[2][0] + vec[1] * matrix[2][1] + vec[2] * matrix[2][2];
		
		// return [newX, newY, newZ];
	},
	dot: function(vec, vec1) {
		if (vec.length != vec1.length) return;
		var total = 0;
		for (let i = 0; i < vec.length; i++) {
			total += vec[i] * vec1[i];
		}
		return total;
	},
	cross: function(vec1, vec2) {
		const newX = vec1[1]*vec2[2] - vec1[2]*vec2[1];
		const newY = vec1[2]*vec2[0] - vec1[0]*vec2[2];
		const newZ = vec1[0]*vec2[1] - vec1[1]*vec2[0];
		
		return [newX, newY, newZ];
	},
	translate: function(vec, matrix) {
		var newMatrix = matrix;
		for(var i = 0; i < 3; i++) {
			for(var j = 0; j < 3; j++) {
				newMatrix[i][j] += vec[i];
			};
		};
		
		return newMatrix;
	},
	getRotatedIso: function(ang) {
		switch(ang) {
			// case 0:
			// 	return isoMatrix;
			// 	break;
			// case 90:
			// 	return [[cos30, cos30,  0 ],
			// 	        [sin30, -sin30, -1],
			// 			[0,     0,      0 ]];
			// 	break;
			// case 180:
			// 	return [[cos30,  -cos30, 0 ],
			// 	        [-sin30, -sin30, -1],
			// 			[0,     0,       0 ]];
			// 	break;
			// case 270:
			// 	return [[-cos30, -cos30,  0 ],
			// 	        [-sin30, sin30, -1],
			// 			[0,      0,      0 ]];
			// 	break;
			default:
				var newMatrix = [[0, 0, 0], [0, 0, -1], [0, 0, 0]];
				var cosA = Math.cos(toRads(ang));
				var sinA = Math.sin(toRads(ang));
				newMatrix[0][0] = cos30*(sinA - cosA);
				newMatrix[0][1] = cos30*(cosA + sinA);
				newMatrix[1][0] = sin30*(cosA + sinA);
				newMatrix[1][1] = sin30*(cosA - sinA);
				newMatrix[2][0] = -cos30*(Math.sin(toRads(ang+45)));
				newMatrix[2][1] = -cos30*(Math.cos(toRads(ang+45)));
				newMatrix[2][2] = -sin30;
				
				return newMatrix;
				break;
				
		};
	},
	magnitude: function(vec) {
		return Math.sqrt(Math.pow(vec[0], 2) + Math.pow(vec[1], 2) + Math.pow(vec[2], 2));
	},
	normalise: function(vec) {
		return this.scalMult(1/this.magnitude(vec) || 0, vec)
	},
	// returns nxn identity matrix
	createIdenMat: function(order) {
	},
	// calculates the inverse of an arbitrary nxn matrix
	// based on Gauss-Jordan elimination
	// src hhttps://gist.github.com/mqnc/bef8d090fdb7e531398ef68342ffe177
	matInverse: function(M) {
		// I use Guassian Elimination to calculate the inverse:
		// (1) 'augment' the matrix (left) by the identity (on the right)
		// (2) Turn the matrix on the left into the identity by elemetry row ops
		// (3) The matrix on the right is the inverse (was the identity matrix)
		// There are 3 elemtary row ops: (I combine b and c in my code)
		// (a) Swap 2 rows
		// (b) Multiply a row by a scalar
		// (c) Add 2 rows

		//if the matrix isn't square: exit (error)
		if (M.length !== M[0].length) { return; }

		//create the identity matrix (I), and a copy (C) of the original
		var i = 0, ii = 0, j = 0, dim = M.length, e = 0, t = 0;
		var I = [], C = [];
		for (i = 0; i < dim; i += 1) {
			// Create the row
			I[I.length] = [];
			C[C.length] = [];
			for (j = 0; j < dim; j += 1) {

				//if we're on the diagonal, put a 1 (for identity)
				if (i == j) { I[i][j] = 1; }
				else { I[i][j] = 0; }

				// Also, make the copy of the original
				C[i][j] = M[i][j];
			}
		}

		// Perform elementary row operations
		for (i = 0; i < dim; i += 1) {
			// get the element e on the diagonal
			e = C[i][i];

			// if we have a 0 on the diagonal (we'll need to swap with a lower row)
			if (e == 0) {
				//look through every row below the i'th row
				for (ii = i + 1; ii < dim; ii += 1) {
					//if the ii'th row has a non-0 in the i'th col
					if (C[ii][i] != 0) {
						//it would make the diagonal have a non-0 so swap it
						for (j = 0; j < dim; j++) {
							e = C[i][j];       //temp store i'th row
							C[i][j] = C[ii][j];//replace i'th row by ii'th
							C[ii][j] = e;      //repace ii'th by temp
							e = I[i][j];       //temp store i'th row
							I[i][j] = I[ii][j];//replace i'th row by ii'th
							I[ii][j] = e;      //repace ii'th by temp
						}
						//don't bother checking other rows since we've swapped
						break;
					}
				}
				//get the new diagonal
				e = C[i][i];
				//if it's still 0, not invertable (error)
				if (e == 0) { 
					// console.log("noninvertible"); 
					// console.log(C, I);
					return;
				}
			}

			// Scale this row down by e (so we have a 1 on the diagonal)
			for (j = 0; j < dim; j++) {
				C[i][j] = C[i][j] / e; //apply to original matrix
				I[i][j] = I[i][j] / e; //apply to identity
			}

			// Subtract this row (scaled appropriately for each row) from ALL of
			// the other rows so that there will be 0's in this column in the
			// rows above and below this one
			for (ii = 0; ii < dim; ii++) {
				// Only apply to other rows (we want a 1 on the diagonal)
				if (ii == i) { continue; }

				// We want to change this element to 0
				e = C[ii][i];

				// Subtract (the row above(or below) scaled by e) from (the
				// current row) but start at the i'th column and assume all the
				// stuff left of diagonal is 0 (which it should be if we made this
				// algorithm correctly)
				for (j = 0; j < dim; j++) {
					C[ii][j] -= e * C[i][j]; //apply to original matrix
					I[ii][j] -= e * I[i][j]; //apply to identity
				}
			}
		}

		//we've done all operations, C should be the identity
		//matrix I should be the inverse:
		return I;
	},
	matTranspose: function(mat) {
		var result = [];
		for (let i = 0; i < mat[0].length; i++) {
			result[i] = [];
			for (let j = 0; j < mat.length; j++) {
				result[i][j] = mat[j][i];
			}
		}

		return result;
	},
	matMult: function(mat1, mat2) {
		// check cols of mat1 == rows of mat2
		if (mat1[0].length != mat2.length) return;
		var result = [];

		// for each row of mat1
		for (let i = 0; i < mat1.length; i++) {
			result[i] = [];
			// for each col of mat2
			for (let j = 0; j < mat2[0].length; j++) {
				result[i][j] = 0;
				for (let k = 0; k < mat2.length; k++) {
					result[i][j] += mat1[i][k] * mat2[k][j];
				}

			}
		}

		return result;
	},
	// finds (MT M)-1 MT
	pseudoInverse: function(mat) {
		var matT = this.matTranspose(mat);
		if (!matT) return;
		const mult = this.matMult(matT, mat)
		if (!mult) return;
		const inv = this.matInverse(mult);
		if (!inv) return;

		return this.matMult(inv, matT);
	},
	matStringify: function(mat) {
		var str = "";
		for (let row of mat) {
			str += row.join(" ") + "\n"
		}
		return str;
	}
};
