import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';
import { nativeTrackPoint } from '../../src/track.js';

// The SVG width and centreline guides contain three known points on the
// driving surface. Use them to project both braid lips onto the screenshot
// after each camera move, without exposing the renderer to the test.
function roadProjector(model, screen) {
  const subtract = ([x, y], [a, b]) => [x - a, y - b];
  const cross = ([x, y], [a, b]) => x * b - y * a;
  const u = subtract(model[1], model[0]),
    v = subtract(model[2], model[0]);
  const det = cross(u, v);
  const a = subtract(screen[1], screen[0]),
    b = subtract(screen[2], screen[0]);
  return (point) => {
    const d = subtract(point, model[0]);
    const m = cross(d, v) / det,
      n = cross(u, d) / det;
    return screen[0].map((x, i) => x + m * a[i] + n * b[i]);
  };
}

async function sampleLips(page, canvas, p) {
  const screen = await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const path = (id) =>
      document.querySelector('[data-guide="' + id + '"] .guide-line');
    const at = (path, end) => {
      const { x, y } = path.getPointAtLength(end ? path.getTotalLength() : 0);
      return [x, y];
    };
    return [
      at(path('road-width'), false),
      at(path('road-width'), true),
      at(path('road-centre'), true),
    ];
  });
  const point = (t, offset) => nativeTrackPoint(p, t, offset);
  const project = roadProjector(
    [point(0, -p.width / 2), point(0, p.width / 2), point(1, 0)],
    screen,
  );
  const samples = [];
  for (let segment = 0; segment < p.segments; segment++) {
    const group = [];
    for (const t of [0.18, 0.32, 0.46, 0.6, 0.74, 0.88]) {
      const station = (segment + t) / p.segments;
      for (const lane of [-p.laneSpacing / 2, p.laneSpacing / 2]) {
        for (const sign of [-1, 1]) {
          const lip =
            lane + sign * (p.slotWidth / 2 + p.braidGap + p.braidWidth);
          group.push([
            project(point(station, lip)),
            project(point(station, lip + 5 * sign)),
          ]);
        }
      }
    }
    samples.push(group);
  }

  const png = await canvas.screenshot({
    scale: 'css',
    style: '.model-guides { visibility: hidden !important; }',
  });
  return page.evaluate(
    async ({ png, samples }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const buffer = document.createElement('canvas');
      buffer.width = image.width;
      buffer.height = image.height;
      const ctx = buffer.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      const intensity = (x, y) => {
        const i = 4 * (Math.floor(x) + Math.floor(y) * image.width);
        return (data[i] + data[i + 1] + data[i + 2]) / 3;
      };
      return samples.map(
        (group) =>
          group.filter(([[x, y], [bx, by]]) => {
            const length = Math.hypot(bx - x, by - y);
            const nx = (bx - x) / length,
              ny = (by - y) / length;
            // Compare the lip with the adjacent flat road on this same segment.
            // A single antialiased pixel suffices even where a wall faces away.
            // The selected part's edges are light (focus blue), the others
            // dark: a lip is visible when it stands out either way.
            const along = [-0.8, -0.4, 0, 0.4, 0.8].map((d) =>
              intensity(x + nx * d, y + ny * d),
            );
            const road = intensity(bx, by);
            return road - Math.min(...along) > 7 || Math.max(...along) - road > 7;
          }).length / group.length,
      );
    },
    { png: png.toString('base64'), samples },
  );
}

export async function checkTrackProfileEdges({
  page,
  openProject,
  tab,
  action,
  snap,
}) {
  const project = newProject();
  project.name = 'Five-piece bend';
  const p = Object.assign(project.track.params, {
    radius: 450,
    angle: 95,
    width: 200,
    laneSpacing: 100,
    segments: 5,
    borderSide: 'both',
    borderSegments: 5,
    borderEntry: 40,
    borderExit: 40,
    borderApex: 50,
    kerbEdge: 'free',
    kerbSide: 'both',
    kerbGroove: true,
    kerbLength: 13,
  });
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'five-piece-bend.slotfab',
  );
  await tab('geometry').click();
  await page.locator('[data-guide="road-width"] path[d]').first().waitFor();
  await action('top').click();
  await action('fit').click();
  const canvas = page.locator('#viewport canvas').first();
  for (const pose of ['top', 'tilted']) {
    if (pose === 'tilted') {
      const r = await canvas.boundingBox();
      const x = r.x + 0.36 * r.width,
        y = r.y + 0.18 * r.height;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 7, y + 28, { steps: 5 });
      await page.mouse.up();
    }
    const ratios = await sampleLips(page, canvas, p);
    assert.ok(
      ratios.every((fraction) => fraction >= 0.8),
      pose +
        ' braid lips visible on each segment: ' +
        ratios.map((n) => Math.round(n * 100) + '%').join(', '),
    );
  }
  await snap('five-piece-bend-profile-edges');
  // With a solid underside, looking up at the deck must hide those same lips.
  p.hollow = false;
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'solid-five-piece-bend.slotfab',
  );
  await tab('geometry').click();
  await action('bottom').click();
  await action('fit').click();
  const underside = await sampleLips(page, canvas, p);
  assert.ok(
    underside.every((fraction) => fraction < 0.1),
    'top edges visible through solid underside: ' + underside.join(', '),
  );
  console.log(
    '✓ Both braid shoulders are outlined across five segments from above and after orbiting, and hidden by the solid underside',
  );
}
