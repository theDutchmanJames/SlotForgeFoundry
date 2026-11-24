import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { starterPack } from '../src/library-profile.js';
import { newProject } from '../src/project.js';
import {
  groupTrackParts,
  groupVisibility,
  toggleGroupVisibility,
  trackPartsMarkup,
} from '../src/track-parts.js';

test('the R4 assembly counts generated hardware after a live clip change', async (t) => {
  const wasm = await init();
  wasm.setup();
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  project.track = starterPack().pieces.find(
    (piece) => piece.name === 'R4 corner',
  ).track;
  // The recipe starts whole; cut it in six as for a 200 mm plate.
  assert.equal(project.track.params.segments, 1);
  project.track.params.segments = 6;
  const countGroups = (parts) =>
    groupTrackParts(parts).map((g) => [g.label, g.parts.length]);
  assert.deepEqual(countGroups(engine.build(project)), [
    ['Road sections', 6],
    ['Dovetail keys', 6],
    ['Quarter-turn keepers', 6],
  ]);
  project.track.params.clipType = 'carrera-retained';
  assert.deepEqual(countGroups(engine.preview(project)), [
    ['Road sections', 6],
    ['Carrera clips', 6],
    ['Quarter-turn keepers', 12],
  ]);
});

test('group visibility shows a mixed group and hides a fully visible group independently', () => {
  const parts = ['1', '2', '3'].map((id) => ({
    id,
    name: 'Road ' + id,
    role: 'road',
  }));
  parts.push({ id: 'border', role: 'border', name: 'Outer border' });
  const [group] = groupTrackParts(parts);
  const hidden = new Set(['2', 'border']);
  assert.equal(groupVisibility(group, hidden), 'mixed');
  toggleGroupVisibility(group, hidden);
  assert.deepEqual(hidden, new Set(['border']));
  assert.equal(groupVisibility(group, hidden), 'true');
  toggleGroupVisibility(group, hidden);
  assert.deepEqual(hidden, new Set(['border', '1', '2', '3']));
  assert.equal(groupVisibility(group, hidden), 'false');
});

test('different printable keys stay distinct while repeated instances keep their own selection and visibility', () => {
  const parts = [6.2, 4.2, 6.2].map((height, index) => ({
    id: 'clip-' + (index + 1),
    name: 'Draw key',
    role: 'clip',
    clipType: 'draw-key',
    fabricationKey: 'double-dovetail/v2/' + height,
  }));
  const [first, second] = groupTrackParts(parts);
  assert.deepEqual(
    first.parts.map((part) => part.id),
    ['clip-1', 'clip-3'],
  );
  assert.deepEqual(
    second.parts.map((part) => part.id),
    ['clip-2'],
  );
  assert.notEqual(first.id, second.id);
  assert.match(first.label, /6\.2 mm/);
  assert.match(second.label, /4\.2 mm/);
  const html = trackPartsMarkup(
    [first, second],
    new Set([first.id]),
    new Set(['clip-1']),
    'clip-3',
  );
  assert.match(html, /data-part="clip-3"[^>]*aria-current="true"/);
  assert.match(html, /data-visible="clip-1" aria-pressed="false"/);
  assert.match(html, /aria-pressed="mixed"/);
  assert.match(html, /aria-expanded="false"/);
  assert.equal((html.match(/ data-part="/g) ?? []).length, 3);
});
