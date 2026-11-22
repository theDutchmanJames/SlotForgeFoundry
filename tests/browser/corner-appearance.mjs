import assert from 'node:assert/strict';

// Inspect the middle of the printed bevel. The original rim guide supplies
// screen coordinates, so the check follows the model through pan and zoom.
export async function checkCornerAppearance(page, canvas, guide) {
  const box = await canvas.boundingBox();
  const { points, width } = await guide.evaluate((path, box) => {
    const transform = path.getScreenCTM();
    const length = path.getTotalLength();
    const width = path.getBoundingClientRect().width;
    const points = [];
    for (let t = 0.09 * length; t <= 0.91 * length; t += 1) {
      const p = path.getPointAtLength(t).matrixTransform(transform);
      points.push([p.x - box.x, p.y - box.y]);
    }
    return { points, width };
  }, box);
  assert.ok(width > 90, 'the chamfer needs enough visible pixels to inspect');

  const image = await canvas.screenshot({ scale: 'css' });
  const jumps = await page.evaluate(
    async ({ png, points, width }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const buffer = document.createElement('canvas');
      buffer.width = image.width;
      buffer.height = image.height;
      const ctx = buffer.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, buffer.width, buffer.height);
      // The lower lip is 2 mm below the original edge, about 22% of the
      // projected corner width in this isometric view. Sample well inside it,
      // avoiding its proper outline, end caps, guide and label.
      return [0.06, 0.1, 0.14].map((depth) => {
        let count = 0,
          previous;
        for (const [x, y] of points) {
          const pixel =
            4 * (Math.round(y + depth * width) * buffer.width + Math.round(x));
          const level = data[pixel + 1];
          if (Math.abs(level - previous) > 16) count++;
          previous = level;
        }
        return count;
      });
    },
    { png: image.toString('base64'), points, width },
  );

  // A change in local curvature where the post joins the wall can make a
  // small shading step. Residual vertical faces give repeated bright/dark
  // transitions on every row across the sloping band.
  assert.ok(
    jumps.every((n) => n <= 2),
    'Dark stripes across the bevel: ' + jumps.join(', '),
  );
}
