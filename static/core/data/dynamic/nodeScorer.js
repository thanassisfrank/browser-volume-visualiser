// nodeScorer.js
// evaluates the scores of the supplied tree

import { ResolutionModes } from "../dataConstants.js";

import { NODE_BYTE_LENGTH, readNodeFromBuffer} from "../cellTreeUtils.js";
import { VecMath } from "../../VecMath.js";
import { boxVolume, copyBox } from "../../boxUtils.js";
import { vec4 } from "../../gl-matrix.js";
import { downloadObject, frameInfoStore, StopWatch } from "../../utils.js";
import { DataSrcTypes } from "../../renderEngine/renderEngine.js";
import { toCSVStr } from "../../utils.js";

// checks if the given node is a leaf
const isDynamicLeaf = (node, nodeCount) => {
    if (node.rightPtr == 0) return true;
    if (node.rightPtr >= nodeCount) return true;

    return false;
};

// range -> [min, max]
// limits -> [min, max]
const getBoxIsoScore = (range, limits, isoVal) => {
    // how much to reduce the score by if range doesn't overlap iso
    const penaltyMult = 0.1;
    if (range[0] <= isoVal) {
        if (range[1] >= isoVal) {
            return 1;
        } else {
            // range entirely below isoval
            return (range[1] - limits[0])/(isoVal - limits[0]) * penaltyMult;
        }
    } else {
        // range entirely above isoval
        return (limits[1] - range[0])/(limits[1] - isoVal) * penaltyMult;
    }
};

const pointInsideFrustrum = (x, y, z, mat) => {
    const clipPos = vec4.create();
    vec4.transformMat4(clipPos, [x, y, z, 1], mat);
    const ndc = [
        clipPos[0]/clipPos[3],
        clipPos[1]/clipPos[3],
        clipPos[2]/clipPos[3],
    ];
    if (ndc[0] < -1 || ndc[0] > 1 || ndc[1] < -1 || ndc[1] > 1 ||ndc[2] < 0) {
        // outside frustrum
        return 0;
    }

    return 1;
};

// calculates a score for the box
// high score -> too big -> split
// low score -> too small -> merge
const calcBoxScore = (box, camInfo) => {
    let score = 1;

    // check if box is inside the view frustrum
    const mid = [
        (box.min[0] + box.max[0]) * 0.5,
        (box.min[1] + box.max[1]) * 0.5,
        (box.min[2] + box.max[2]) * 0.5
    ];

    if (
        pointInsideFrustrum(box.min[0], box.min[1], box.min[2], camInfo.mat) == 0 &&
        pointInsideFrustrum(box.min[0], box.min[1], box.max[2], camInfo.mat) == 0 &&
        pointInsideFrustrum(box.min[0], box.max[1], box.min[2], camInfo.mat) == 0 &&
        pointInsideFrustrum(box.min[0], box.max[1], box.max[2], camInfo.mat) == 0 &&
        pointInsideFrustrum(box.max[0], box.min[1], box.min[2], camInfo.mat) == 0 &&
        pointInsideFrustrum(box.max[0], box.min[1], box.max[2], camInfo.mat) == 0 &&
        pointInsideFrustrum(box.max[0], box.max[1], box.min[2], camInfo.mat) == 0 &&
        pointInsideFrustrum(box.max[0], box.max[1], box.max[2], camInfo.mat) == 0
    ) return 0;

    const distToCam = VecMath.magnitude(VecMath.vecMinus(camInfo.pos, mid));
    // const distToFoc = VecMath.magnitude(VecMath.vecMinus(camInfo.focusPos, mid));

    // if (distToFoc < camInfo.camToFocus/4) {
    //     score *= 2;
    // }
    
    // estimate box effective pixel area
    const lMax = Math.abs(Math.max(...VecMath.vecMinus(box.max, box.min)));
    return (lMax/distToCam)**2;
};


// set the score function o creation
export class NodeScorer {
    #extentBox;
    #scoresLog = [];

    #dataSource;

    constructor(dataSource, extentBox) {
        this.#dataSource = dataSource;
        this.#extentBox = extentBox;
    }

    #getScoreFunc(camInfo, isoInfo) {
        let scoreFunc;
        let nodeRangeBuff;
        // empty cam and isoInfo, return dummy score function
        if (camInfo.pos === undefined && isoInfo.source === undefined) {
            scoreFunc = (box, nodeFullPtr) => {
                return Math.random();
            }
        } else if (DataSrcTypes.AXIS == isoInfo.source.type) {
            // deal with x, y, z isovalue
            switch (isoInfo.source.name) {
                case "x":
                    scoreFunc =  function (box, nodeFullPtr) {
                        // debugger;
                        const isoScore = getBoxIsoScore([box.min[0], box.max[0]], isoInfo.source.limits, isoInfo.value);
                        return calcBoxScore(box, camInfo) * isoScore;
                    }
                    break;
                case "y":
                    scoreFunc =  function (box, nodeFullPtr) {
                        const isoScore = getBoxIsoScore([box.min[1], box.max[1]], isoInfo.source.limits, isoInfo.value);
                        return calcBoxScore(box, camInfo) * isoScore;
                    }
                    break;
                case "z":
                default:
                    scoreFunc =  function (box, nodeFullPtr) {
                        const isoScore = getBoxIsoScore([box.min[2], box.max[2]], isoInfo.source.limits, isoInfo.value);
                        return calcBoxScore(box, camInfo) * isoScore;
                    }
                    break;

            }
        } else {
            // data
            nodeRangeBuff = this.#dataSource.getDataArray({name: isoInfo.source.name})?.ranges;
            if (nodeRangeBuff) {
                scoreFunc =  function (box, nodeFullPtr) {
                    const isoRange = nodeRangeBuff.slice(2 * nodeFullPtr, 2 * (nodeFullPtr + 1));
                    const isoScore = getBoxIsoScore(isoRange, isoInfo.source.limits, isoInfo.value);
                    // debugger;
                    return calcBoxScore(box, camInfo) * isoScore;
                }
            } else {
                scoreFunc =  function (box, nodeFullPtr) {
                    return calcBoxScore(box, camInfo);
                }
            }
        }

        return scoreFunc.bind(this);
    }

    // update functions ================================================================
    // calculate the scores for the current leaf nodes, true leaf or pruned
    // returns a list of leaf node objects containing their score
    // assumes camera coords is in the dataset coordinate space
    #calcNodeScores(nodeCache, scoreFn) {
        const fullNodes = this.#dataSource.tree.nodes;
        const dynamicNodes = nodeCache.getBuffers()["nodes"];
        const nodeCount = Math.floor(dynamicNodes.byteLength/NODE_BYTE_LENGTH);

        const scores = [];

        const rootNode = readNodeFromBuffer(dynamicNodes, 0);
        rootNode.depth = 0;
        rootNode.box = copyBox(this.#extentBox);

        // the next nodes to process
        const nodes = [rootNode];

        let processed = 0;
        while (nodes.length > 0 && processed < nodeCount * 3) {
            processed++;
            const currNode = nodes.pop();
            const currBox = currNode.box;

            if (isDynamicLeaf(currNode, nodeCount)) {
                // this is a leaf node, get its score
                currNode.score = scoreFn(currBox, currNode.thisFullPtr);
                currNode.state = nodeCache.readBuffSlotAt("state", currNode.thisPtr)[0];
                scores.push(currNode);
            } else {
                // get the ptr to the children in the full buffer
                const currFullNode = readNodeFromBuffer(fullNodes, (currNode.thisFullPtr ?? 0) * NODE_BYTE_LENGTH);
                // add its children to the next nodes
                const rightNode = readNodeFromBuffer(dynamicNodes, currNode.rightPtr * NODE_BYTE_LENGTH);
                const leftNode = readNodeFromBuffer(dynamicNodes, currNode.leftPtr * NODE_BYTE_LENGTH);
                const bothLeaves = isDynamicLeaf(leftNode, nodeCount) && isDynamicLeaf(rightNode, nodeCount);

                rightNode.thisFullPtr = currFullNode.rightPtr;
                rightNode.bothSiblingsLeaves = bothLeaves;
                rightNode.depth = currNode.depth + 1;

                const rightBox = {
                    min: [currBox.min[0], currBox.min[1], currBox.min[2]],
                    max: [currBox.max[0], currBox.max[1], currBox.max[2]],
                };
                rightBox.min[currNode.depth % 3] = currNode.splitVal;
                rightNode.box = rightBox;

                nodes.push(rightNode);


                leftNode.thisFullPtr = currFullNode.leftPtr;
                leftNode.bothSiblingsLeaves = bothLeaves;
                leftNode.depth = currNode.depth + 1;
                
                const leftBox = {
                    min: [currBox.min[0], currBox.min[1], currBox.min[2]],
                    max: [currBox.max[0], currBox.max[1], currBox.max[2]],
                };
                leftBox.max[currNode.depth % 3] = currNode.splitVal;
                leftNode.box = leftBox;

                nodes.push(leftNode);
            }
        }

        // return the unsorted scores 
        return scores;
    };

    getNodeScores(nodeCache, camInfo, isoInfo) {
        const scoreFunc = this.#getScoreFunc(camInfo, isoInfo);
        const leafScores = this.#calcNodeScores(nodeCache, scoreFunc);

        // this.#logScores(leafScores);
        leafScores.sort((a, b) => a.score - b.score);

        return leafScores;
    }

    clearScoreLog() {
        this.#scoresLog = []
    }

    #logScores(scores) {
        if (this.#scoresLog.length > 10) return
        this.#scoresLog.push(scores.map(n => n.score))
    }

    exportScoreLog() {
        const str = toCSVStr(this.#scoresLog);
        downloadObject(str, "scores_log.csv", "text/csv");
    }
}