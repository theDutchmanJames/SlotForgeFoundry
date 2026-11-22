import test from 'node:test';
import assert from 'node:assert/strict';
import { borderDrag } from '../src/border-handles.js';
import { defaultTrack } from '../src/track.js';

test('outer apex radial and tangential drags recover the intended width and station', () => {
  const p = {
    ...defaultTrack(),
    kind: 'curve',
    radius: 200,
    width: 120,
    angle: 90,
    borderSide: 'both',
  };
  const t = 0.75,
    angle = ((t - 0.5) * Math.PI) / 2,
    radialDistance = 200 + 60 + 28.5;
  const at = [
    radialDistance * Math.sin(angle),
    radialDistance * Math.cos(angle) - 200,
  ];
  assert.deepEqual(borderDrag(p, 'borderApex', 1, at), {
    outerApexWidth: 28.5,
    outerApexPercent: 75,
  });
});

test('entry width projects on the fixed normal and inside width cannot cross the curve centre', () => {
  const p = {
    ...defaultTrack(),
    radius: 100,
    width: 100,
    angle: 90,
    borderSide: 'inner',
  };
  // Take an inside point at 12 mm width and slide it 20 mm along the tangent.
  const angle = -Math.PI / 4,
    r = 100 - 50 - 12;
  const at = [
    r * Math.sin(angle) + 20 * Math.cos(angle),
    r * Math.cos(angle) - 100 - 20 * Math.sin(angle),
  ];
  assert.deepEqual(borderDrag(p, 'borderEntry', -1, at), { borderEntry: 12 });
  assert.deepEqual(borderDrag(p, 'borderEntry', -1, [0, -100]), {
    borderEntry: 49.9,
  });
});

test('the outside apex can widen past the inside radius with both borders active', () => {
  const p = {
    ...defaultTrack(),
    radius: 100,
    width: 100,
    angle: 90,
    borderSide: 'both',
  };
  assert.deepEqual(borderDrag(p, 'borderApex', 1, [0, 125]), {
    outerApexWidth: 75,
    outerApexPercent: 50,
  });
});

test('straight and straightened imported profiles constrain zero widths and percent extremes', () => {
  for (const kind of ['straight', 'import']) {
    const p = {
      ...defaultTrack(),
      kind,
      length: 200,
      width: 100,
      borderSide: 'both',
    };
    assert.deepEqual(borderDrag(p, 'borderApex', -1, [-60, -62]), {
      innerApexWidth: 12,
      innerApexPercent: 20,
    });
    assert.deepEqual(borderDrag(p, 'borderApex', 1, [150, 40]), {
      outerApexWidth: 0,
      outerApexPercent: 99,
    });
  }
});
