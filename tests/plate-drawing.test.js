// The print plate drawn on Home and in the Track Planner.
import assert from 'node:assert/strict';
import test from 'node:test';
import { plateDrawing } from '../src/plate-drawing.js';

const box = (svg) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);

test('the plate is drawn to its proportions, with its two sizes', () => {
  const square = plateDrawing({ width: 200, depth: 200, margin: 0 });
  const wide = plateDrawing({ width: 400, depth: 200, margin: 0 });
  const [sw, sh] = box(square),
    [ww, wh] = box(wide);
  // A wider plate gives a wider drawing for its height.
  assert.ok(ww / wh > sw / sh);
  assert.match(wide, />400</);
  assert.match(wide, />200</);
  assert.match(wide, /aria-label="Print plate 400 by 200 mm"/);
});

test('the margin is drawn only when there is one, and never past the middle', () => {
  assert.doesNotMatch(plateDrawing({ width: 240, depth: 220, margin: 0 }), /plate-margin/);
  assert.match(plateDrawing({ width: 240, depth: 220, margin: 5 }), /plate-margin/);
  const huge = plateDrawing({ width: 100, depth: 100, margin: 500 });
  assert.doesNotMatch(huge, /NaN|-\d/);
  // Four levelling screws.
  assert.equal(plateDrawing({ width: 240, depth: 220, margin: 5 }).match(/<circle/g).length, 4);
});
