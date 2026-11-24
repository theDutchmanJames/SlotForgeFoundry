import { Viewport } from './viewport.js';
import { pitch, sourcePartMap, xyOf } from './planner-model.js';
import { esc } from './ui.js';
import { creaseLineIndices, isTrackSurface } from './surface-features.js';
import { slotTitle } from './slot-position.js';

const digits = (n) => Number(n.toFixed(3));
const points = (path) =>
  path.map(([x, y]) => digits(x) + ',' + digits(-y)).join(' ');
const pathD = (loops) =>
  loops.map((loop) => 'M' + points(loop) + 'Z').join(' ');
// Placed copies are kept while their section stays put, so the 3D view only
// builds meshes for what changed. Edge lines belong to the source part: every
// placement of a part shares the same triangles, so they are worked out once.
const placedCache = new Map();
function placedFor(part, node, def) {
  const key = node.id + '/' + part.id,
    pose = JSON.stringify([node.pose, node.h, def.track.params.height]);
  const hit = placedCache.get(key);
  if (hit?.part === part && hit.pose === pose) return hit.placed;
  if (isTrackSurface(part)) part.creaseLines ??= creaseLineIndices(part);
  const placed = placedMesh(part, node, def);
  placedCache.set(key, { part, pose, placed });
  return placed;
}
function placedMesh(part, node, def) {
  const pose = pitch(node, def),
    h = def.track.params.height,
    sec = Math.hypot(1, pose.slope);
  function point(x, y, z) {
    return [
      ...xyOf(node.pose, [x, y]),
      Math.max(
        0,
        z * sec +
          h * (1 - sec) +
          pose.start +
          pose.slope *
            ((x - pose.origin[0]) * pose.direction[0] +
              (y - pose.origin[1]) * pose.direction[1]),
      ),
    ];
  }
  const positions = new Float32Array(part.positions.length);
  for (let i = 0; i < positions.length; i += 3)
    positions.set(
      point(part.positions[i], part.positions[i + 1], part.positions[i + 2]),
      i,
    );
  const indices = node.pose.flip ? part.indices.slice() : part.indices;
  if (node.pose.flip)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return {
    ...part,
    id: node.id + '/' + part.id,
    positions,
    indices,
    bounds: undefined,
    kerbMarkings: part.kerbMarkings?.map((m) => ({
      ...m,
      points: m.points.map((p) => point(...p)),
    })),
  };
}
export function createPlanView(host, onPick) {
  const svg = host.querySelector('.planner-map'),
    solid = host.querySelector('.planner-solid');
  let viewport,
    current,
    mode = 'plan',
    box = [-250, -160, 500, 320],
    drag = null,
    fitted = false,
    markup = new Map();
  const update = () => svg.setAttribute('viewBox', box.join(' '));
  function fit() {
    if (!current) return;
    const { rows } = current,
      w = svg.clientWidth || host.clientWidth,
      h = svg.clientHeight || host.clientHeight;
    const [l, b, r, t] = rows.reduce(
      ([l, b, r, t], { bounds: v }) => [
        Math.min(l, v[0]),
        Math.min(b, v[1]),
        Math.max(r, v[2]),
        Math.max(t, v[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const aspect = Math.max(0.2, w / Math.max(1, h)),
      height = rows.length
        ? Math.max(140, (r - l) / aspect, t - b) * 1.26
        : 460;
    const width = height * aspect,
      cx = rows.length ? (l + r) / 2 : 0,
      cy = rows.length ? -(b + t) / 2 : 0;
    box = [cx - width / 2, cy - height / 2, width, height];
    update();
    fitted = true;
    if (mode === 'solid') viewport?.fit();
  }
  function draw(
    { rows, ends, chosen, selected, defs, blocks, blocked = [], marked = new Set() },
    refit = false,
  ) {
    current = { rows, ends, chosen, selected, defs, blocks, blocked, marked };
    if (mode === 'solid') {
      viewport ??= new Viewport(solid, (id) => onPick(id.split('/')[0]));
      const free = new Set(ends.map((e) => e.key));
      const parts = rows.flatMap(({ n, def }) =>
        def.sections[n.index].parts
          .filter(
            (id) =>
              !free.has(n.id + ':' + def.sections[n.index].hardwareEnds[id]),
          )
          .map((id) =>
            placedFor(
              ((n.pose.flip && def.mirroredParts) || sourcePartMap(def)).get(
                id,
              ),
              n,
              def,
            ),
          ),
      );
      viewport.setParts([...parts, ...blocks], refit || !fitted);
      // Forget placements that left the layout.
      const live = new Set(parts.map((p) => p.id));
      for (const key of placedCache.keys()) if (!live.has(key)) placedCache.delete(key);
      viewport.select(
        parts.find((p) => p.id.startsWith(selected + '/') && p.role === 'road')
          ?.id,
        new Set(),
      );
      fitted = true;
      return;
    }
    const elevation = (r) =>
      Math.max(...r.n.h) +
      Math.max(0, ...r.def.sections[r.n.index].ports.map((p) => p.baseZ || 0));
    const used = new Map();
    const body = rows
      .slice()
      .sort((a, b) => elevation(a) - elevation(b))
      .map(({ n, def, key }) => {
        // Unchanged sections reuse their markup from the last drawing.
        const id = n.id + '|' + key + '|' + (n.id === selected) + '|' + marked.has(n.id) + '|' + def.name;
        const known = markup.get(id);
        if (known !== undefined) {
          used.set(id, known);
          return known;
        }
        const s = def.sections[n.index],
          map = sourcePartMap(def),
          slot = slotTitle(def.track.params);
        const path = (id) =>
          pathD(
            (map.get(id).outline ?? []).map((loop) =>
              loop.map((p) => xyOf(n.pose, p)),
            ),
          );
        const piece = s.parts
          .filter((id) => map.get(id).outline)
          .sort(
            (a, b) =>
              Number(map.get(a).role === 'road') -
              Number(map.get(b).role === 'road'),
          )
          .map(
            (id) =>
              '<path class="pm-' +
              map.get(id).role +
              '" d="' +
              path(id) +
              '"/>',
          )
          .join('');
        const lanes = s.lanes
          .map(
            (line) =>
              '<polyline points="' +
              points(line.map((p) => xyOf(n.pose, p))) +
              '"/>',
          )
          .join('');
        const html =
          '<g data-node="' +
          n.id +
          '" class="pm-piece' +
          (n.id === selected ? ' selected' : '') +
          (marked.has(n.id) ? ' marked' : '') +
          (Math.max(...n.h) > 0 ? ' elevated' : '') +
          '"><title>' +
          esc(def.name) +
          ' · ' +
          esc(s.road) +
          (slot && !def.name.includes(slot) ? ' · ' + esc(slot) : '') +
          '</title>' +
          piece +
          lanes +
          '</g>';
        used.set(id, html);
        return html;
      })
      .join('');
    markup = used;
    const radius = Math.max(
      2,
      Math.min(22, (box[2] / Math.max(200, svg.clientWidth)) * 6),
    );
    // Ends that touch but do not join: a bar along the seam and a ring, and
    // the reason as the tooltip of both ends. Clicks still reach the ends.
    const reasons = new Map(
      blocked.flatMap((j) => [j.a, j.b].map((e) => [e.key, j.text])),
    );
    // vector-effect is not inherited, so each shape carries the whole style.
    const warning =
      ' style="fill:none;stroke:var(--warn);stroke-width:3;stroke-linecap:round;vector-effect:non-scaling-stroke;pointer-events:none"/>';
    const marks = blocked
      .map(({ a }) => {
        const [from, to] = [a.edges[0], a.edges.at(-1)];
        return (
          '<g class="pm-blocked"><line x1="' +
          digits(from[0]) +
          '" y1="' +
          digits(-from[1]) +
          '" x2="' +
          digits(to[0]) +
          '" y2="' +
          digits(-to[1]) +
          '"' +
          warning +
          '<circle cx="' +
          a.xy[0] +
          '" cy="' +
          -a.xy[1] +
          '" r="' +
          radius * 1.9 +
          '"' +
          warning +
          '</g>'
        );
      })
      .join('');
    const ports = ends
      .map(
        (e) =>
          '<g data-end="' +
          e.key +
          '" class="pm-end' +
          (chosen === e.key ? ' active' : '') +
          '"><title>' +
          esc(reasons.get(e.key) ?? 'Build from this end') +
          '</title><circle class="hit" cx="' +
          e.xy[0] +
          '" cy="' +
          -e.xy[1] +
          '" r="' +
          radius * 2.3 +
          '"/><circle cx="' +
          e.xy[0] +
          '" cy="' +
          -e.xy[1] +
          '" r="' +
          radius +
          '"/></g>',
      )
      .join('');
    svg.innerHTML =
      '<defs><pattern id="plan-grid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="var(--d-guide)" stroke-width="0.8" vector-effect="non-scaling-stroke"/></pattern></defs><rect x="-1000000" y="-1000000" width="2000000" height="2000000" fill="url(#plan-grid)"/>' +
      body +
      marks +
      ports;
    if (refit || !fitted) fit();
    else update();
  }
  function svgPoint(e) {
    const pt = new DOMPoint(e.clientX, e.clientY);
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = svgPoint(e),
        factor = Math.exp(Math.max(-0.6, Math.min(0.6, e.deltaY * 0.0015)));
      if (box[2] * factor < 15 || box[2] * factor > 100000) return;
      box = [
        p.x + (box[0] - p.x) * factor,
        p.y + (box[1] - p.y) * factor,
        box[2] * factor,
        box[3] * factor,
      ];
      update();
    },
    { passive: false },
  );
  svg.onpointerdown = (e) => {
    drag = {
      x: e.clientX,
      y: e.clientY,
      target: e.target,
      box: [...box],
      moved: false,
      // Ctrl, Cmd or Shift adds the section to the selection.
      extend: e.ctrlKey || e.metaKey || e.shiftKey,
    };
    svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) < 4 && !drag.moved) return;
    drag.moved = true;
    const scale = 1 / svg.getScreenCTM().a;
    box = [
      drag.box[0] - dx * scale,
      drag.box[1] - dy * scale,
      ...drag.box.slice(2),
    ];
    update();
  };
  svg.onpointercancel = () => {
    drag = null;
  };
  svg.onpointerup = () => {
    if (drag && !drag.moved) {
      const end = drag.target.closest('[data-end]')?.dataset.end;
      const id =
        end?.split(':')[0] ?? drag.target.closest('[data-node]')?.dataset.node;
      if (id) onPick(id, end, drag.extend && !end);
    }
    drag = null;
  };
  return {
    draw,
    fit,
    setMode(value) {
      mode = value;
      svg.hidden = value !== 'plan';
      solid.hidden = value !== 'solid';
      // SVG elements do not reflect the HTML hidden attribute.
      svg.style.display = value === 'plan' ? 'block' : 'none';
      if (current) draw(current, true);
    },
  };
}
