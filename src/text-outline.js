// Trace the half-alpha contour of locally rendered glyphs. Subpixel crossings
// avoid a pixel staircase. Outlines are stored in the project alongside the
// editable text, so opening it on another OS reproduces the printed geometry.
export function traceGlyphs(alpha, width, height) {
  const nodes = new Map();
  const edge = (x, y, vertical) => {
    const i = y * width + x,
      id = i * 2 + Number(vertical);
    if (!nodes.has(id)) {
      const t =
        (127.5 - alpha[i]) / (alpha[i + (vertical ? width : 1)] - alpha[i]);
      nodes.set(id, {
        point: [x + (vertical ? 0 : t), y + (vertical ? t : 0)],
        others: [],
      });
    }
    return id;
  };
  function link(a, b) {
    nodes.get(a).others.push(b);
    nodes.get(b).others.push(a);
  }
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x,
        a = alpha[i],
        b = alpha[i + 1],
        c = alpha[i + width + 1],
        d = alpha[i + width];
      const A = a > 127,
        B = b > 127,
        C = c > 127,
        D = d > 127;
      if (A === B && A === C && A === D) continue;
      const edges = [];
      if (A !== B) edges.push(edge(x, y, false));
      if (B !== C) edges.push(edge(x + 1, y, true));
      if (C !== D) edges.push(edge(x, y + 1, false));
      if (D !== A) edges.push(edge(x, y, true));
      if (edges.length === 2) link(edges[0], edges[1]);
      else if (a + b + c + d > 510 === A) {
        link(edges[0], edges[1]);
        link(edges[2], edges[3]);
      } else {
        link(edges[0], edges[3]);
        link(edges[1], edges[2]);
      }
    }
  const loops = [];
  for (const first of nodes.keys()) {
    const loop = [];
    let id = first,
      previous = -1;
    do {
      const node = nodes.get(id);
      if (!node || node.others.length !== 2)
        throw Error('Could not trace this character. Try a different label.');
      loop.push(node.point);
      nodes.delete(id);
      const next =
        node.others[0] === previous ? node.others[1] : node.others[0];
      previous = id;
      id = next;
    } while (id !== first);
    const reduced = simplifyLoop(loop);
    if (reduced.length >= 3) loops.push(reduced);
  }
  return loops;
}

function simplifyLoop(loop) {
  // Two open Ramer–Douglas–Peucker chains share their endpoints.
  const last = loop.length,
    middle = Math.floor(last / 2);
  const pts = [...loop, loop[0]],
    keep = new Uint8Array(last + 1);
  keep[0] = keep[middle] = keep[last] = 1;
  const stack = [
    [0, middle],
    [middle, last],
  ];
  while (stack.length) {
    const [a, b] = stack.pop(),
      [x, y] = pts[a];
    const dx = pts[b][0] - x,
      dy = pts[b][1] - y,
      len = dx * dx + dy * dy;
    let worst = -1,
      max = 0.22 * 0.22;
    for (let i = a + 1; i < b; i++) {
      const vx = pts[i][0] - x,
        vy = pts[i][1] - y;
      const along = len
        ? Math.max(0, Math.min(1, (vx * dx + vy * dy) / len))
        : 0;
      const d = (vx - along * dx) ** 2 + (vy - along * dy) ** 2;
      if (d > max) {
        worst = i;
        max = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return loop.filter((_, i) => keep[i]);
}

let cached;
export function textOutline(text, height, saved) {
  if (typeof text !== 'string' || !text.trim() || text.length > 128)
    throw Error('Enter a label of 1 to 128 characters.');
  if (!(height > 0) || !Number.isFinite(height))
    throw Error('Enter a positive letter height.');
  if (saved?.text === text && saved.textHeight > 0 && saved.loops?.length) {
    if (saved.textHeight === height) return saved.loops;
    return saved.loops.map((loop) =>
      loop.map(([x, y]) => [
        (x * height) / saved.textHeight,
        (y * height) / saved.textHeight,
      ]),
    );
  }
  if (cached?.text !== text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const font = '600 96px sans-serif';
    ctx.font = font;
    const metrics = ctx.measureText(text),
      cap = ctx.measureText('H').actualBoundingBoxAscent;
    const left = Math.ceil(metrics.actualBoundingBoxLeft),
      ascent = Math.ceil(metrics.actualBoundingBoxAscent);
    canvas.width = Math.max(
      4,
      left + Math.ceil(metrics.actualBoundingBoxRight) + 6,
    );
    canvas.height = Math.max(
      4,
      ascent + Math.ceil(metrics.actualBoundingBoxDescent) + 6,
    );
    ctx.font = font;
    ctx.fillText(text, left + 3, ascent + 3);
    const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8Array(bytes.length / 4);
    for (let i = 0; i < alpha.length; i++) alpha[i] = bytes[4 * i + 3];
    const loops = traceGlyphs(alpha, canvas.width, canvas.height);
    if (!loops.length || !(cap > 0))
      throw Error('This text has no printable outlines.');
    cached = {
      text,
      loops: loops.map((loop) =>
        loop.map(([x, y]) => [
          (x + 0.5 - canvas.width / 2) / cap,
          (canvas.height / 2 - y - 0.5) / cap,
        ]),
      ),
    };
  }
  return cached.loops.map((loop) =>
    loop.map(([x, y]) => [x * height, y * height]),
  );
}
