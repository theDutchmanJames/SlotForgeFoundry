import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { newProject } from '../../src/project.js';

// Measure the car's rendered silhouette on the same road with a fixed camera.
// Browser screenshots work with either WebGL or the software depth buffer.
async function changedPixels(page, baseline, photo) {
  return page.evaluate(async (images) => {
    const [before, after] = await Promise.all(images.map(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    }));
    let pixels = 0;
    let minX = before.width;
    let maxX = -1;
    for (let j = 0; j < before.data.length; j += 4) {
      const difference = Math.max(
        Math.abs(before.data[j] - after.data[j]),
        Math.abs(before.data[j + 1] - after.data[j + 1]),
        Math.abs(before.data[j + 2] - after.data[j + 2]),
      );
      if (difference <= 15) continue;
      const x = (j / 4) % before.width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      pixels++;
    }
    return { pixels, width: pixels ? maxX - minX + 1 : 0 };
  }, [baseline, photo].map(image => image.toString('base64')));
}

function projectedRoadPoint({ t, side }) {
  const at = (id, fraction) => {
    const path = document.querySelector('[data-guide="' + id + '"] .guide-line');
    return path.getPointAtLength(path.getTotalLength() * fraction);
  };
  const center = at('road-centre', t);
  const right = at('road-width', 0);
  const left = at('road-width', 1);
  // Slightly beside the guide slot on real track stock.
  return {
    x: center.x + side * 0.24 * (left.x - right.x),
    y: center.y + side * 0.24 * (left.y - right.y),
  };
}

export async function checkScaleCar({
  page, action, tab, openProject, download, downloadSelected, snap,
}) {
  const project = newProject();
  project.name = 'Scale car straight';
  Object.assign(project.track.params, {
    kind: 'straight', length: 420, width: 200, laneSpacing: 90, lanes: 2,
    borderSide: 'none', joint: 'none', jointStart: 'none', jointEnd: 'none', segments: 1,
  });
  await openProject(Buffer.from(JSON.stringify(project)), 'scale-car.slotfab');
  await tab('geometry').click();
  await action('top').click();
  await action('fit').click();
  const canvas = page.locator('#viewport canvas').first();
  const toggle = action('scale-car');
  const panel = page.locator('#scale-car-panel');
  const scale = panel.locator('[name="carScale"]');
  const lane = panel.locator('[name="carLane"]');
  const station = panel.locator('[name="carStation"]');
  const photo = () => canvas.screenshot({
    scale: 'css',
    style: '#canvas-wrap *:not(canvas){visibility:hidden!important} #canvas-wrap canvas{visibility:visible!important}',
  });
  const kit = async () => {
    await action('export-menu').click();
    return unzipSync((await download(action('export-kit'))).bytes);
  };

  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  const partCount = await page.locator('#parts [data-part]').count();
  const selected = await downloadSelected();
  const partsBefore = await kit();
  const original = await photo();
  await toggle.click();
  await panel.waitFor();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await scale.locator('option').allTextContents(), ['1:64', '1:43', '1:32', '1:24']);
  const size = panel.locator('[data-car-size]');
  for (const denominator of [64, 43, 32, 24]) {
    await scale.selectOption(String(denominator));
    const measured = (await size.textContent()).match(/\d+(?:\.\d+)?/g).map(Number);
    const expected = [4600, 1900, 1200].map(mm => Number((mm / denominator).toFixed(1)));
    assert.deepEqual(measured, expected, 'displayed model dimensions at 1:' + denominator);
  }
  await scale.selectOption({ label: '1:64' });
  const small = await changedPixels(page, original, await photo());
  await scale.selectOption({ label: '1:24' });
  const large = await changedPixels(page, original, await photo());
  assert.ok(small.pixels > 400, 'the small car should appear on the road');
  assert.ok(
    Math.abs(large.width / small.width - 64 / 24) < 0.2,
    'the rendered car length must match the chosen scale (' +
      small.width + ' px at 1:64 and ' + large.width + ' px at 1:24)',
  );
  assert.equal(await lane.locator('option').count(), 2);
  const clickedLanes = [];
  for (const [t, side] of [[0.72, 1], [0.35, -1]]) {
    const target = await page.evaluate(projectedRoadPoint, { t, side });
    await canvas.click({ position: target });
    assert.ok(Math.abs(Number(await station.inputValue()) - t * 100) < 2);
    clickedLanes.push(await lane.inputValue());
  }
  assert.notEqual(clickedLanes[0], clickedLanes[1],
    'clicking the other lane must move the guide across the road');
  await lane.press('Home');
  if (await lane.inputValue() === clickedLanes[1]) await lane.press('End');
  assert.equal(await lane.inputValue(), clickedLanes[0]);
  const priorStation = Number(await station.inputValue());
  await station.press('ArrowRight');
  assert.ok(Number(await station.inputValue()) > priorStation);
  await snap('scale-car-on-track');
  assert.equal(await page.locator('#parts [data-part]').count(), partCount);
  assert.deepEqual((await downloadSelected()).bytes, selected.bytes);
  const partsAfter = await kit();
  assert.deepEqual(Object.keys(partsAfter).sort(), Object.keys(partsBefore).sort());
  for (const [name, bytes] of Object.entries(partsBefore))
    assert.deepEqual(partsAfter[name], bytes, name);
  await toggle.click();
  assert.ok(await panel.isHidden());
  const restored = await changedPixels(page, original, await photo());
  assert.equal(restored.pixels, 0, 'hiding the car restores the same road and camera');
  await toggle.click();
  await action('mode-editor').click();
  await page.locator('#workspace-nav:visible').waitFor();
  assert.ok(await toggle.isHidden());
  assert.ok(await panel.isHidden());
  await action('mode-track').click();
  await toggle.waitFor();
  if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
  console.log('✓ Scale car follows lane clicks and keyboard placement at true scale in the viewport; printable parts and saved kit are identical');
}
