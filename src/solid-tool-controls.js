import { choice, esc, field, details, fmt } from './ui.js';
import { textOutline } from './text-outline.js';

export function solidToolControls(tab, op, part) {
  if (tab === 'hollow')
    return (
      field('wallThickness', 'Wall thickness', op.thickness ?? 2, 'mm', {
        min: 0.001,
      }) +
      '<p class="hint">The picked face becomes the opening. Walls extend inward. Use Section view to inspect the cavity.</p>'
    );
  if (tab === 'simplify')
    return (
      field('maxDeviation', 'Maximum deviation', op.deviation ?? 0.25, 'mm', {
        min: 0.0001,
      }) +
      field('triangleTarget', 'Triangle target', op.triangleTarget ?? '', '', {
        optional: true,
        min: 4,
        step: 1,
        placeholder: 'Optional',
      }) +
      '<figure class="silhouette-comparison"><figcaption>Silhouette comparison</figcaption>' +
      '<label>View <select data-silhouette-view><option value="top">Top</option><option value="front">Front</option><option value="side">Side</option></select></label>' +
      '<canvas width="280" height="140" aria-label="Original outline overlaid on proposed silhouette"></canvas>' +
      '<small><b>Green</b> · result &nbsp; <b>Dark outline</b> · original</small></figure>' +
      '<output data-triangle-count>' +
      fmt((part?.indices?.length ?? 0) / 3) +
      ' original triangles</output>'
    );
  return (
    '<label class="field"><span>Text</span><input type="text" name="labelText" maxlength="128" required value="' +
    esc(op.text ?? 'Label') +
    '"></label>' +
    choice('textMethod', 'Lettering', op.type === 'cut' ? 'cut' : 'add', [
      ['add', 'Raised'],
      ['cut', 'Engraved'],
    ]) +
    field('textHeight', 'Capital height', op.textHeight ?? 5, 'mm', {
      min: 0.01,
    }) +
    field('depth', 'Relief depth', op.depth ?? 1, 'mm', { min: 0.01 }) +
    details(
      'Placement',
      field('rotation', 'Rotation', op.rotation ?? 0, '°') +
        field('dx', 'Horizontal offset', op.userOffset?.[0] ?? 0) +
        field('dy', 'Vertical offset', op.userOffset?.[1] ?? 0),
    ) +
    '<p class="hint">Drag the text handle on the model to position the label.</p>'
  );
}

export function solidToolOperation(tab, fields, base, region, old) {
  if (tab === 'simplify')
    return {
      ...base,
      type: tab,
      label: 'Simplify mesh',
      deviation: fields.maxDeviation,
      ...(Number.isFinite(fields.triangleTarget)
        ? { triangleTarget: fields.triangleTarget }
        : {}),
    };
  const face = region ?? old?.frame;
  if (!face)
    throw Error(
      tab === 'hollow'
        ? 'Select a flat opening face.'
        : 'Select a surface for the text.',
    );
  const frame = {
    origin: face.origin,
    normal: face.normal,
    u: face.u,
    v: face.v,
  };
  if (tab === 'hollow') {
    if (face.planar === false || !(region?.loops ?? old?.loops)?.length)
      throw Error('Choose a flat face with a closed outline for the opening.');
    return {
      ...base,
      type: tab,
      label: 'Hollow part',
      thickness: fields.wallThickness,
      frame,
      loops: region?.loops ?? old.loops,
    };
  }
  const baseOffset = region?.anchor ?? old?.baseOffset ?? [0, 0];
  return {
    ...base,
    type: fields.textMethod,
    label:
      (fields.textMethod === 'cut' ? 'Engrave ' : 'Raise ') + fields.labelText,
    tool: 'text',
    profileKind: 'text',
    separate: fields.textMethod === 'add' && !!fields.separate,
    text: fields.labelText,
    textHeight: fields.textHeight,
    frame,
    loops: textOutline(fields.labelText, fields.textHeight, old),
    depth: fields.depth,
    rotation: fields.rotation,
    baseOffset,
    userOffset: [fields.dx, fields.dy],
    offset: [baseOffset[0] + fields.dx, baseOffset[1] + fields.dy],
    ...(region?.planar === false || (!region && old?.textPatch)
      ? {
          textPatch: region?.seed
            ? {
                triangle: region.seed.triangle,
                point: region.seed.point,
                tolerance: region.boundaryAngle,
              }
            : old.textPatch,
        }
      : {}),
  };
}

// Rasterise exact orthographic silhouettes in short batches. A large imported
// model should still respond to typing, orbit and cancellation during comparison.
function silhouette(part, axis, bounds, width, height, active) {
  const [a, b] = axis,
    spanX = bounds.max[a] - bounds.min[a],
    spanY = bounds.max[b] - bounds.min[b];
  const scale = Math.min(
    (width - 14) / Math.max(1e-9, spanX),
    (height - 14) / Math.max(1e-9, spanY),
  );
  const ox = (width - spanX * scale) / 2 - bounds.min[a] * scale;
  const oy = (height + spanY * scale) / 2 + bounds.min[b] * scale;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { indices, positions } = part;
  let i = 0;
  return new Promise((resolve) => {
    function build() {
      if (!active()) return resolve(null);
      const deadline = performance.now() + 7;
      do {
        ctx.beginPath();
        const stop = Math.min(indices.length, i + 3 * 512);
        for (; i < stop; i += 3) {
          const s = 3 * indices[i],
            t = 3 * indices[i + 1],
            u = 3 * indices[i + 2];
          const x = positions[s + a],
            y = positions[s + b];
          const dx = positions[t + a] - x,
            dy = positions[t + b] - y;
          const ex = positions[u + a] - x,
            ey = positions[u + b] - y;
          if (dx * ey - dy * ex <= 0) continue;
          ctx.moveTo(ox + scale * x, oy - scale * y);
          ctx.lineTo(ox + scale * (x + dx), oy - scale * (y + dy));
          ctx.lineTo(ox + scale * (x + ex), oy - scale * (y + ey));
          ctx.closePath();
        }
        ctx.fill();
      } while (i < indices.length && performance.now() < deadline);
      if (i < indices.length) return requestAnimationFrame(build);
      resolve(ctx.getImageData(0, 0, width, height).data);
    }
    requestAnimationFrame(build);
  });
}
const comparisons = new WeakMap();
export async function updateSilhouette(form, part, result) {
  const canvas = form?.querySelector('.silhouette-comparison canvas');
  if (!canvas || !part) return;
  const select = form.querySelector('[data-silhouette-view]');
  const existing = comparisons.get(canvas);
  result ??= part;
  if (
    existing?.part === part &&
    existing.result === result &&
    existing.view === select.value
  )
    return;
  const job = { part, result, view: select.value };
  comparisons.set(canvas, job);
  const active = () => canvas.isConnected && comparisons.get(canvas) === job;
  const axis = { top: [0, 1], front: [0, 2], side: [1, 2] }[job.view];
  const w = canvas.width,
    h = canvas.height;
  const before = part.indices.length / 3,
    after = result.indices.length / 3;
  const output = form.querySelector('[data-triangle-count]');
  output.textContent = fmt(before) + ' → ' + fmt(after) + ' triangles';
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  canvas.dataset.ready = 'false';
  const original = await silhouette(part, axis, part.bounds, w, h, active);
  if (!original || !active()) return;
  const edited =
    result === part
      ? original
      : await silhouette(result, axis, part.bounds, w, h, active);
  if (!edited || !active()) return;
  const image = ctx.createImageData(w, h);
  for (let i = w + 1; i < w * (h - 1) - 1; i++) {
    const k = i * 4;
    const edge =
      original[k + 3] > 120 &&
      [i - 1, i + 1, i - w, i + w].some((j) => original[4 * j + 3] <= 120);
    if (edge) image.data.set([44, 63, 63, 255], k);
    else if (edited[k + 3] > 120) image.data.set([109, 187, 170, 255], k);
  }
  ctx.putImageData(image, 0, 0);
  canvas.dataset.ready = 'true';
}
