// Tests added from the coverage map: the project-file checks on Library and
// STL part links and on the embedded model, and the import notices for a
// drawing whose slot or conductor could not be measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProject, newProject } from '../src/project.js';
import { profileWarnings } from '../src/import-profile.js';

const editor = (extra = {}) => ({ ...newProject(), mode: 'editor', ...extra });
const id = 'pack-1';

test('a Library piece link must name its pack, its piece and a revision', () => {
  const ok = checkProject({ ...newProject(), libraryPiece: { collectionId: id, pieceId: 'p1', revision: 3 } });
  assert.deepEqual(ok.libraryPiece, { collectionId: id, pieceId: 'p1', revision: 3 });
  for (const libraryPiece of [
    null,
    'pack-1',
    { collectionId: id, pieceId: 'p1' },
    { collectionId: id, pieceId: 'p1', revision: 0 },
    { collectionId: id, pieceId: 'p1', revision: 1.5 },
    { collectionId: 'bad id!', pieceId: 'p1', revision: 1 },
    { collectionId: id, pieceId: '', revision: 1 },
  ])
    assert.throws(() => checkProject({ ...newProject(), libraryPiece }), /invalid library piece reference/, JSON.stringify(libraryPiece));
});

test('an STL part link keeps its own id, the part it is based on and the pack piece it came from', () => {
  const source = { collectionId: id, pieceId: 'p1', part: 'road-1', revision: 2, label: 'Full straight · Road' };
  const ok = checkProject(editor({ stlPart: { id: 's1', basedOn: 's0', source } }));
  assert.deepEqual(ok.stlPart, { id: 's1', basedOn: 's0', source });
  assert.ok(checkProject(editor({ stlPart: {} })), 'a part not yet saved has no links');
  for (const stlPart of [
    'part',
    { id: 'no spaces allowed' },
    { basedOn: '../x' },
    { source: { ...source, part: 7 } },
    { source: { ...source, part: 'x'.repeat(201) } },
    { source: { ...source, revision: 'two' } },
    { source: { ...source, label: 'x'.repeat(401) } },
    { source: { ...source, collectionId: '' } },
  ])
    assert.throws(() => checkProject(editor({ stlPart })), /invalid STL part reference/, JSON.stringify(stlPart));
});

test('the embedded model must be text within the size limit, and an empty design has none', () => {
  const base = editor();
  const withSource = (source) => ({ ...base, editor: { ...base.editor, source: { label: 'Part', ...source } } });
  assert.ok(checkProject(withSource({ data: 'AAAA' })));
  assert.throws(() => checkProject(withSource({ data: '' })), /empty or exceeds/);
  assert.throws(() => checkProject(withSource({ data: 42 })), /empty or exceeds/);
  assert.throws(() => checkProject(withSource({ empty: true, data: 'AAAA' })), /empty design or an embedded/);
  assert.throws(() => checkProject(withSource({ empty: 'yes' })), /empty design or an embedded/);
  assert.throws(() => checkProject(withSource({ demoVersion: 3 })), /Unknown version/);
});

test('a print plate needs room inside its margins', () => {
  for (const plate of [
    { width: 0, depth: 200, margin: 5 },
    { width: 200, depth: 200, margin: -1 },
    { width: 200, depth: 200, margin: 100 },
    { width: 200, depth: NaN, margin: 5 },
  ])
    assert.throws(() => checkProject({ ...newProject(), plate }), /positive usable width/, JSON.stringify(plate));
});

test('switched-off steps must be readable, unique and point at real steps', () => {
  const base = editor();
  const withOps = (ops, off) => ({ ...base, editor: { ...base.editor, ops, off } });
  assert.throws(() => checkProject(withOps([null], [])), /unreadable edit/);
  assert.throws(() => checkProject(withOps([{ id: 'a', type: 'x' }, { id: 'a', type: 'x' }], [])), /same id/);
  assert.throws(() => checkProject(withOps([], ['ghost'])), /do not exist/);
  assert.throws(() => checkProject(withOps([], 'a')), /do not exist/);
});

const measured = { slotWidth: 3, braidWidth: 5, braidGap: 1, height: 10, slotDepth: 7, braidDepth: 0.5, hollow: true, wall: 2, deck: 2 };
const drawing = (profileSource, inferredWidths) => ({ lanes: [{}], profileSource, inferredWidths });

test('import notices name what could not be measured and how to bring it across', () => {
  const circuit = (extra) => drawing({ circuit: true, ...extra });
  assert.match(profileWarnings(circuit({ slot: 'missing', exportOptions: { conductors: false } }), measured)[0], /Slot edges and Braid\/tape edges/);
  assert.match(profileWarnings(circuit({ slot: 'missing' }), measured)[0], /turn on Slot edges to carry/);
  assert.match(profileWarnings(drawing({ slot: 'missing' }), measured)[0], /Add a SLOT_EDGES layer/);
  assert.match(profileWarnings(drawing({ slot: 'inconsistent' }), measured)[0], /varies along this drawing.*3 mm/);
  assert.match(profileWarnings(drawing({ slot: 'unmeasured' }), measured)[0], /could not be measured/);
  assert.match(profileWarnings(drawing({ slot: 'too-many' }), measured)[0], /too many lanes/);
  assert.match(profileWarnings(drawing({ slot: 'inferred', conductor: 'missing' }), measured)[0], /BRAID_EDGES or TAPE_EDGES/);
  assert.match(profileWarnings(circuit({ slot: 'inferred', conductor: 'missing' }), measured)[0], /Braid\/tape edges to carry/);
  assert.match(profileWarnings(drawing({ slot: 'inferred', conductor: 'unmeasured', conductorType: 'tape' }), measured)[0], /copper tape size varies/);
  assert.match(profileWarnings(drawing({ slot: 'inferred', conductor: 'inconsistent' }), measured)[0], /braid size varies/);
  assert.deepEqual(profileWarnings(drawing({ slot: 'inferred', conductor: 'inferred' }), measured), []);
  assert.deepEqual(profileWarnings({ lanes: [], profileSource: { slot: 'missing' } }, measured), [], 'nothing to import, nothing to say');
});

test('imported depths that would make the track unprintable are dropped, with a reason', () => {
  const deep = drawing({ slot: 'inferred', conductor: 'inferred' }, { slotDepth: 9.5, braidDepth: 3 });
  const notes = profileWarnings(deep, measured);
  assert.equal(deep.inferredWidths.slotDepth, undefined, 'slot depth past the floor is dropped');
  assert.equal(deep.inferredWidths.braidDepth, undefined, 'a recess through the deck is dropped');
  assert.match(notes[0], /9\.5 mm slot depth does not fit the current 10 mm/);
  assert.match(notes[1], /3 mm conductor recess is too deep/);
  const solid = drawing({ slot: 'inferred', conductor: 'inferred' }, { slotDepth: 6, braidDepth: 1 });
  assert.deepEqual(profileWarnings(solid, { ...measured, hollow: false }), []);
  assert.deepEqual(solid.inferredWidths, { slotDepth: 6, braidDepth: 1 }, 'depths that fit are kept');
});
