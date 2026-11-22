import { applyHoleModify, validateHoleModify } from './hole-modify.js';
import {
  applyWallEdgeModify,
  validateWallEdgeModify,
} from './wall-edge-modify.js';
import { applyHealStretch, validateHealStretch } from './heal-stretch.js';

const operations = new Map([
  ['modifyHoles', [validateHoleModify, applyHoleModify]],
  ['edgeGroup', [validateWallEdgeModify, applyWallEdgeModify]],
  ['wallModify', [validateWallEdgeModify, applyWallEdgeModify]],
  ['healFeature', [validateHealStretch, applyHealStretch]],
  ['stretchSection', [validateHealStretch, applyHealStretch]],
]);

export const isModification = (type) => operations.has(type);
export const validateModification = (op) => operations.get(op.type)[0](op);
export const applyModification = (wasm, solid, op, own) =>
  operations.get(op.type)[1](wasm, solid, op, own);
