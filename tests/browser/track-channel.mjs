import { selectTrackPart } from './part-outline.mjs';
import assert from 'node:assert/strict';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';
import { nativePath } from '../../src/track.js';

export async function checkTrackChannel({
  page,
  wasm,
  openProject,
  openSection,
  tab,
  input,
  action,
  live,
  waitText,
  download,
  downloadSelected,
}) {
  const project = newProject();
  await openProject(Buffer.from(JSON.stringify(project)), 'club-bend.slotfab');
  await selectTrackPart(page.locator('#parts [data-part="road-1"]'));
  await tab('profile').click();
  await openSection('Braid recess');
  await input('braidGap').fill('2');
  await input('braidDepth').fill('0.65');
  await live();
  await waitText('[data-guide="channel-profile"]', '0.65 mm');
  const profile = page.locator('[data-guide="channel-profile"] .guide-line');
  const outline = await profile.getAttribute('d');
  assert.equal(
    outline.match(/M/g)?.length,
    2,
    'both braid recesses have their own outline',
  );
  const trackSTL = (await downloadSelected()).bytes;
  await action('edit-part').click();
  await waitText('#model-title', 'Road 1');
  const editorSTL = (await downloadSelected()).bytes;
  const saved = JSON.parse((await download(action('save'))).bytes);
  assert.equal(saved.mode, 'editor');
  assert.equal(saved.track.params.braidDepth, 0.65);
  assert.equal(saved.track.params.braidGap, 2);

  const parts = [];
  function read(bytes) {
    const solid = parseSTL(wasm, bytes);
    parts.push(solid);
    return solid;
  }
  try {
    // A transferred road uses assembly coordinates. Printable downloads are
    // centred on the plate. Probe the same physical mouth in each file.
    const source = read(Buffer.from(saved.editor.source.data, 'base64'));
    const origin = source.boundingBox().min;
    const p = saved.track.params,
      path = nativePath(p);
    const slotEdge = p.slotWidth / 2, recessEdge = slotEdge + p.braidGap;
    const probes = [[0, p.slotDepth]];
    for (const side of [-1, 1]) {
      probes.push([side * (slotEdge + p.braidGap / 2), 0],
        [side * (recessEdge + p.braidWidth / 2), p.braidDepth],
        [side * (recessEdge + p.braidWidth + 0.5), 0]);
    }
    for (const solid of [source, read(trackSTL), read(editorSTL)]) {
      const shift = solid.boundingBox().min.map((v, i) => v - origin[i]);
      for (const end of [0, 1]) {
        const [tx, ty] = path.tangent(end);
        const direction = end ? -1 : 1;
        for (const lane of [-p.laneSpacing / 2, p.laneSpacing / 2]) {
          for (const [offset, depth] of probes) {
            const [x, y] = path.point(end, lane + offset);
            const floor = p.height - depth;
            const point = (d, z) => [
              x + shift[0] + d * direction * tx,
              y + shift[1] + d * direction * ty,
              z + shift[2],
            ];
            if (depth > 0) {
              const z = (p.height + floor) / 2;
              assert.equal(solid.rayCast(point(-0.1, z), point(0.1, z)).length, 0);
            }
            const top = solid.rayCast(
              point(0.1, p.height + 1),
              point(0.1, 0),
            )[0];
            assert.ok(Math.abs(top.position[2] - floor - shift[2]) < 0.001);
          }
        }
      }
    }
  } finally {
    parts.forEach((part) => part.delete());
  }
  console.log(
    '✓ Raised braid dividers and open channel ends survive the track export and STL editor round trip',
  );
}
