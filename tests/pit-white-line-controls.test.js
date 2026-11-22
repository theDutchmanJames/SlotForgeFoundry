import test from 'node:test';
import assert from 'node:assert/strict';
import { roadMarkings, borderMarkings, syncPaintControls } from '../src/paint-controls.js';
import { specialPreview, specialTrackParams } from '../src/special-pieces.js';
import { defaultTrack } from '../src/track.js';
import { readTrackShapeFields } from '../src/track-shape-controls.js';
import { toolGuides } from '../src/guide-geometry.js';
import { piecePreview } from '../src/track-piece-preview.js';

const pit = () => specialTrackParams('pit', { ...defaultTrack(), width: 200, laneSpacing: 100 });

test('a pit road offers its divider independently from road edge and border white lines', () => {
  const params = pit();
  const track = { params };
  delete params.special.pitWhiteLine;
  assert.match(roadMarkings(params), /White lines on the road[\s\S]*whiteLineRoad[\s\S]*spPitWhiteLine" >Pit lane divider/);
  assert.doesNotMatch(roadMarkings(defaultTrack()), /spPitWhiteLine/);
  assert.doesNotMatch(piecePreview(params).marks, /ct-pit-divider/);
  assert.doesNotMatch(borderMarkings(params), /spPitWhiteLine/);

  params.whiteLineRoad = 'none';
  params.whiteLineBorder = 'outer';
  params.roadLineGroove = true;
  params.borderLineGroove = false;
  assert.deepEqual(readTrackShapeFields({ spPitWhiteLine: true }, track), {});
  const saved = JSON.parse(JSON.stringify(track)).params;
  assert.match(roadMarkings(saved), /spPitWhiteLine" checked/);
  assert.equal(saved.special.pitWhiteLine, true);
  assert.equal(saved.whiteLineRoad, 'none');
  assert.equal(saved.whiteLineBorder, 'outer');
  assert.equal(saved.borderLineGroove, false);
  const layout = {};
  const form = {
    elements: { spPitWhiteLine: {} },
    querySelector: key => key === '[data-line-layout]' ? layout : null,
  };
  syncPaintControls(form, saved);
  assert.match(roadMarkings(saved), /Recess road markings/);
  assert.match(layout.innerHTML, /Pit divider · 3 mm wide\. A groove follows both edges and closes around each painted end/);
  readTrackShapeFields({ spPitWhiteLine: false }, { params: saved });
  assert.equal(saved.special.pitWhiteLine, false);
  assert.equal(saved.whiteLineBorder, 'outer');
});

test('the focused pit stripe and groove outlines follow both physical branches on the correct levels', () => {
  const p = pit();
  p.special.side = 'both';
  p.special.pitWhiteLine = true;
  p.roadLineGroove = true;
  p.whiteLineWidth = 4;
  const plan = specialPreview(p);
  const guides = field => toolGuides({ mode: 'track', tab: 'geometry', field, track: { params: p } });
  assert.equal((piecePreview(p).marks.match(/class="ct-pit-divider"/g) ?? []).length, plan.pitWhiteLines.length);
  for (const [field, id, outlines, z] of [
    ['spPitWhiteLine', 'pit-white-line', plan.pitWhiteLines, p.height],
    ['whiteLineWidth', 'pit-white-line', plan.pitWhiteLines, p.height],
    ['grooveDepth', 'pit-white-line-groove', plan.pitWhiteLineGrooves, p.height - p.grooveDepth],
  ]) {
    const guide = guides(field).find(g => g.id === id);
    assert.ok(guide, id);
    assert.ok(outlines.length > 2, 'the divider has separate runs across the through lanes');
    assert.equal(guide.paths.length, outlines.length);
    assert.equal(guide.anchor[0], 0, 'the guide labels the stripe beside the pit box');
    guide.paths.forEach((path, i) => {
      assert.deepEqual(path[0], path.at(-1));
      assert.deepEqual(path.slice(0, -1), outlines[i].map(([x, y]) => [x, y, z]));
    });
  }
  p.special.pitWhiteLine = false;
  assert.ok(!guides('spPitWhiteLine').some(g => g.id === 'pit-white-line'));
});
