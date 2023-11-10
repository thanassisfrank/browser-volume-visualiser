//VecMath.js

import {sin30, cos30, toRads} from "./utils.js";
export {VecMath};

const VecMath = {
	
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
	matrixVecMult: function(matrix, vec) {
		var newX = vec[0] * matrix[0][0] + vec[1] * matrix[0][1] + vec[2] * matrix[0][2];
		var newY = vec[0] * matrix[1][0] + vec[1] * matrix[1][1] + vec[2] * matrix[1][2];
		var newZ = vec[0] * matrix[2][0] + vec[1] * matrix[2][1] + vec[2] * matrix[2][2];
		
		return [newX, newY, newZ];
	},
	dot: function(vec, vec1) {
		return vec[0] * vec1[0] + vec[1] * vec1[1] + vec[2] * vec1[2];
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
	}
};
