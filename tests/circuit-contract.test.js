// Contract test against SlotForge Circuit's live CAD exporter. Runs when the
// Circuit sources sit beside Foundry (or SLOT_FORGE_CIRCUIT points at them),
// so a change to either side of the hand-off fails here instead of in a user's
// import. Elsewhere, such as CI, it is skipped and the static fixtures in
// tests/drawings/ still cover the format.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrawing } from '../src/imports.js';
import { profileWarnings } from '../src/import-profile.js';
import { inspectFlatImport } from '../src/drawings/flat-import.js';
import { defaultTrack } from '../src/track.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const circuitRoot = resolve(
  process.env.SLOT_FORGE_CIRCUIT || join(here, '..', '..', 'Circuit'),
);
const exporterPath = join(circuitRoot, 'app', 'cad-export.js');
const examples = join(
  circuitRoot,
  'integration',
  'slotforge-timing',
  'routed-examples',
);
const available = existsSync(exporterPath) && existsSync(examples);
const skip = available ? false : 'Circuit sources not found at ' + circuitRoot;
const require = createRequire(import.meta.url);
const cad = () => require(exporterPath);
const layout = (name) =>
  structuredClone(require(join(examples, name + '.slotforge.json')));
const everything = {
  slots: true,
  slotEdges: true,
  conductors: true,
  surfaces: true,
  table: true,
  timing: false,
  scale: false,
};
const routedSpec = (l) =>
  Object.values(l.definitions).find((d) => d.parameters.routed).parameters
    .routed;
const roadWidth = (l) =>
  Object.values(l.definitions).find((d) => d.parameters.routed).parameters
    .widthMm;
const current = { slotWidth: 3, braidWidth: 5, braidGap: 0 };
// A track tall enough for Circuit's routed slot depth.
const roomy = {
  ...current,
  height: 12,
  slotDepth: 7,
  braidDepth: 0.5,
  hollow: true,
  wall: 2,
  deck: 2.5,
};
// The sizes Foundry can measure from the drawn edges alone.
const measuredOnly = (w) => ({
  slotWidth: w.slotWidth,
  braidWidth: w.braidWidth,
  braidGap: w.braidGap,
});
const stripMetadata = (svg) => svg.replace(/<metadata>.*?<\/metadata>/s, '');
const near = (a, b, tol = 1e-4) =>
  assert.ok(Math.abs(a - b) <= tol, a + ' is not within ' + tol + ' of ' + b);

test('Circuit closed oval with all layers imports its full routed profile', { skip }, () => {
  const oval = layout('closed-routed-oval'),
    spec = routedSpec(oval);
  for (const [text, ext] of [
    [cad().svg(oval, everything, 'compact'), 'svg'],
    [cad().svg(oval, everything, 1), 'svg'],
    [cad().dxf(oval, everything), 'dxf'],
  ]) {
    const drawing = parseDrawing(text, ext);
    assert.equal(drawing.profileSource.circuit, true, ext);
    assert.equal(drawing.profileSource.slot, 'metadata', ext);
    assert.equal(drawing.lanes.length, spec.laneCount);
    assert.deepEqual(drawing.inferredWidths, {
      width: roadWidth(oval),
      slotWidth: spec.slotWidthMm,
      slotDepth: spec.slotDepthMm,
      braidWidth: spec.conductorWidthMm,
      braidGap: spec.conductorGapMm,
      braidDepth: spec.recessDepthMm,
    });
    assert.equal(drawing.profileSource.conductorType, 'braid');
    // The drawn edges and the metadata agree, so nothing to report.
    assert.deepEqual(drawing.warnings.filter((w) => /differ/.test(w)), []);
    assert.deepEqual(profileWarnings(drawing, roomy), [], ext);
  }
});

test('the measured edges match Circuit’s profile without the metadata', { skip }, () => {
  const oval = layout('closed-routed-oval'),
    spec = routedSpec(oval);
  const drawing = parseDrawing(
    stripMetadata(cad().svg(oval, everything, 1)),
    'svg',
  );
  assert.deepEqual(measuredOnly(drawing.inferredWidths), {
    slotWidth: spec.slotWidthMm,
    braidWidth: spec.conductorWidthMm,
    braidGap: spec.conductorGapMm,
  });
});

test('compact SVG, full-size SVG and DXF from Circuit land on the same coordinates', { skip }, () => {
  const oval = layout('closed-routed-oval');
  const compact = parseDrawing(cad().svg(oval, everything, 'compact'), 'svg');
  const full = parseDrawing(cad().svg(oval, everything, 1), 'svg');
  const dxf = parseDrawing(cad().dxf(oval, everything), 'dxf');
  for (const other of [full, dxf]) {
    assert.equal(other.lanes.length, compact.lanes.length);
    compact.lanes.forEach((lane, i) => {
      assert.equal(lane.length, other.lanes[i].length);
      lane.forEach((p, j) => {
        near(p[0], other.lanes[i][j][0]);
        near(p[1], other.lanes[i][j][1]);
      });
    });
  }
});

test('Circuit’s default export has no edge layers but still carries its profile', { skip }, () => {
  const oval = layout('closed-routed-oval'),
    spec = routedSpec(oval);
  for (const [text, ext] of [
    [cad().svg(oval), 'svg'],
    [cad().dxf(oval), 'dxf'],
  ]) {
    const drawing = parseDrawing(text, ext);
    assert.equal(drawing.slotEdges.length, 0, ext);
    assert.equal(drawing.profileSource.slot, 'metadata', ext);
    assert.equal(drawing.inferredWidths.slotWidth, spec.slotWidthMm);
    assert.equal(drawing.inferredWidths.braidWidth, spec.conductorWidthMm);
    assert.deepEqual(profileWarnings(drawing, roomy), [], ext);
  }
});

test('without metadata or edge layers Foundry keeps its sizes and says so', { skip }, () => {
  const drawing = parseDrawing(
    stripMetadata(cad().svg(layout('closed-routed-oval'))),
    'svg',
  );
  assert.deepEqual(drawing.inferredWidths, {});
  const [note] = profileWarnings(drawing, current);
  assert.match(note, /no slot edges/);
  assert.match(note, /3 mm/);
});

test('copper tape tracks get their size but no recess', { skip }, () => {
  const oval = layout('closed-routed-oval');
  for (const d of Object.values(oval.definitions))
    if (d.parameters.routed) d.parameters.routed.conductor = 'tape';
  const spec = routedSpec(oval);
  for (const [text, ext] of [
    [cad().dxf(oval, everything), 'dxf'],
    [cad().svg(oval), 'svg'],
  ]) {
    const drawing = parseDrawing(text, ext);
    assert.equal(drawing.braidEdges.length, 0);
    assert.deepEqual(measuredOnly(drawing.inferredWidths), {
      slotWidth: spec.slotWidthMm,
      braidWidth: spec.conductorWidthMm,
      braidGap: spec.conductorGapMm,
    });
    assert.equal(drawing.inferredWidths.braidDepth, 0, ext);
    assert.equal(drawing.profileSource.conductorType, 'tape', ext);
    assert.match(profileWarnings(drawing, roomy).join(' '), /copper tape/);
  }
});

test('a Circuit SVG that lost its metadata in another editor still imports full size', { skip }, () => {
  const svg = cad().svg(layout('closed-routed-oval'), everything, 'compact');
  assert.match(svg, /scale 1:\d+/);
  const reference = parseDrawing(svg, 'svg');
  for (const stripped of [
    stripMetadata(svg),
    // Title and description gone too: the reduced page and layer names remain.
    stripMetadata(svg)
      .replace(/<title>.*?<\/title>/s, '')
      .replace(/<desc>.*?<\/desc>/s, ''),
  ]) {
    const drawing = parseDrawing(stripped, 'svg');
    assert.match(drawing.warnings.join(' '), /lost its SlotForge metadata/);
    near(drawing.lanes[0][0][0], reference.lanes[0][0][0]);
    near(drawing.lanes[0][0][1], reference.lanes[0][0][1]);
    assert.deepEqual(
      drawing.inferredWidths,
      measuredOnly(reference.inferredWidths),
    );
  }
});

test('an unknown Circuit coordinate convention is refused instead of mirrored', { skip }, () => {
  const svg = cad()
    .svg(layout('closed-routed-oval'))
    .replace('builder-world-positive-y-down', 'builder-world-positive-y-up');
  assert.throws(() => parseDrawing(svg, 'svg'), /coordinate convention/);
});

test('the Circuit figure eight carries its slot size and puts the bridge pass on top', { skip }, () => {
  const eight = layout('figure-eight-with-bridge'),
    spec = routedSpec(eight);
  for (const [text, ext] of [
    [cad().dxf(eight, everything), 'dxf'],
    [cad().svg(eight), 'svg'],
  ]) {
    const drawing = parseDrawing(text, ext);
    assert.ok(drawing.lanes.length >= 1);
    assert.equal(drawing.inferredWidths.slotWidth, spec.slotWidthMm);
    // Older Circuit builds exported no heights; newer ones must.
    if (!drawing.heights) continue;
    // Circuit's road width must be enough on its own: no manual entry.
    const profile = { ...defaultTrack(), ...drawing.inferredWidths };
    assert.ok(drawing.inferredWidths.width > 0, ext + ': no road width');
    const result = inspectFlatImport(drawing, profile.width, profile);
    assert.ok(result?.flatCrossing, result?.warning || ext);
    assert.ok(result.heightNote, ext + ': heights did not choose a pass');
    for (const c of result.flatCrossing.crossings)
      assert.ok(c.circuitHeightDifference >= 1);
  }
});
