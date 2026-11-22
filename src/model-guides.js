import './guide-style.css';
import { toolGuides } from './guide-geometry.js';
import { createFaceHandle } from './face-handle.js';
import { createTextHandle } from './text-handle.js';
import { createSolidMoveHandle } from './solid-move-handle.js';

const ns = 'http://www.w3.org/2000/svg';
function node(name, attrs = {}) {
  const el = document.createElementNS(ns, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
const px = (n) => Math.round(n * 10) / 10;
// SVG stores screen coordinates with limited precision. On extreme zooms or
// invalid drafts omit an unrepresentable annotation instead of passing gigantic
// finite values (which can still overflow the browser's path rasterizer).
const validPoint = (p) => p && Math.abs(p.x) < 1e7 && Math.abs(p.y) < 1e7;
const overlap = (a, b) =>
  a.x < b.x + b.w + 5 &&
  a.x + a.w + 5 > b.x &&
  a.y < b.y + b.h + 3 &&
  a.y + a.h + 3 > b.y;

function addGuide(svg, guide) {
  const group = node('g', {
    'data-guide': guide.id,
    class: 'guide-' + guide.tone,
  });
  svg.append(group);
  const path = node('path', {
    class:
      'guide-line' +
      (guide.strong ? ' strong' : '') +
      (guide.dashed ? ' dashed' : '') +
      (guide.surface ? ' surface' : ''),
  });
  group.append(path);
  const dots = (guide.dots ?? []).map(() => {
    const circle = node('circle', { r: 3.2, class: 'guide-dot' });
    group.append(circle);
    return circle;
  });
  let caption;
  if (guide.text) {
    const wrap = node('g', { class: 'guide-caption' }),
      leader = node('path', { class: 'guide-leader' }),
      box = node('rect', { rx: 4, ry: 4, height: 21 }),
      text = node('text', { 'dominant-baseline': 'middle' });
    text.textContent = guide.text;
    wrap.append(leader, box, text);
    group.append(wrap);
    caption = {
      wrap,
      leader,
      box,
      text,
      width: Math.ceil(text.getComputedTextLength()) + 14,
    };
  }
  return { guide, path, dots, caption };
}

/** Project the annotations only when the actual scene presents a frame. */
export function createModelGuides(host, stage, onSolidMove) {
  const svg = node('svg', {
    class: 'model-guides',
    'data-model-guides': '',
    role: 'img',
    'aria-label': 'Model guides',
  });
  host.append(svg);
  const cue = document.createElement('div');
  cue.className = 'guide-pick-cue';
  cue.hidden = true;
  host.append(cue);
  const faceHandle = createFaceHandle(host, stage);
  const textHandle = createTextHandle(host, stage);
  const solidMove = createSolidMoveHandle(host, stage, onSolidMove);
  let entries = [];
  stage.onRender = () => {
    const w = host.clientWidth,
      h = host.clientHeight,
      placed = [];
    if (!w || !h) return;
    const handleBounds = faceHandle.project();
    if (handleBounds) placed.push(handleBounds);
    const textBounds = textHandle.project();
    if (textBounds) placed.push(textBounds);
    const moveBounds = solidMove.project();
    if (moveBounds) placed.push(moveBounds);
    for (const { guide, path, dots, caption } of entries) {
      const project = (p) => stage.projectPoint(p);
      const commands = [];
      for (const points of guide.paths ?? []) {
        const screen = points.map(project);
        if (!screen.length || !screen.every(validPoint)) continue;
        commands.push(
          screen
            .map((p, i) => (i ? 'L' : 'M') + px(p.x) + ' ' + px(p.y))
            .join('') + (guide.surface ? 'Z' : ''),
        );
      }
      path.setAttribute('d', commands.join(''));
      dots.forEach((dot, i) => {
        const p = project(guide.dots[i]);
        dot.style.display = validPoint(p) && p.visible ? '' : 'none';
        if (validPoint(p)) {
          dot.setAttribute('cx', px(p.x));
          dot.setAttribute('cy', px(p.y));
        }
      });
      if (!caption) continue;
      const { wrap, box, leader, text, width } = caption,
        p = project(guide.anchor);
      if (!validPoint(p) || !p.visible || width > w - 12 || h < 65) {
        wrap.style.display = 'none';
        continue;
      }
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      // Prefer a compact nearby caption. Try the opposite side and other rows
      // when dimensions crowd together, especially on the small end of a bend.
      let chosen;
      for (const dy of [-33, 12, -60, 39, -87, 66]) {
        for (const dx of [12, -width - 12]) {
          const pos = {
            x: clamp(p.x + dx, 6, w - width - 6),
            y: clamp(p.y + dy, 42, h - 47),
            w: width,
            h: 21,
          };
          if (!placed.some((other) => overlap(pos, other))) {
            chosen = pos;
            break;
          }
        }
        if (chosen) break;
      }
      if (!chosen) {
        wrap.style.display = 'none';
        continue;
      }
      placed.push(chosen);
      wrap.style.display = '';
      const x = px(chosen.x),
        y = px(chosen.y);
      box.setAttribute('x', x);
      box.setAttribute('y', y);
      box.setAttribute('width', width);
      text.setAttribute('x', x + 7);
      text.setAttribute('y', y + 10.8);
      const endX = clamp(p.x, x, x + width),
        endY = clamp(p.y, y, y + 21);
      leader.setAttribute(
        'd',
        'M' + px(p.x) + ' ' + px(p.y) + 'L' + px(endX) + ' ' + px(endY),
      );
    }
  };
  return (context) => {
    faceHandle.set(context);
    textHandle.set(context);
    solidMove.set(context);
    const picking =
      context.measuring ||
      (context.mode === 'editor' &&
        !context.blank &&
        !context.designSketch &&
        [
          'select',
          'move-face',
          'shape',
          'cut-shape',
          'tilt',
          'text',
          'hollow',
        ].includes(context.tab) &&
        !context.op &&
        !context.region &&
        !context.face);
    host.classList.toggle('guide-picking', Boolean(picking));
    const hint = context.measuring
      ? context.measurePoints?.length === 2
        ? ''
        : context.measurePoints?.length
          ? 'Pick the second point'
          : 'Pick the first point'
      : picking
        ? context.tab === 'tilt'
          ? 'Select a flat face to place the hinge'
          : context.tab === 'hollow'
            ? 'Select a flat face for the opening'
            : context.tab === 'select'
              ? 'Click a face, edge or hole rim'
              : context.tab === 'move-face'
                ? 'Select a flat face to move'
                : 'Select a surface to place the profile'
        : '';
    cue.hidden = !hint;
    cue.textContent = hint;
    let guides = [];
    try {
      guides = toolGuides(context);
    } catch {
      // Partial or invalid numerical drafts can have no valid frame. The
      // inspector owns validation; discard the old guides during that edit.
    }
    // Invalid drafts (empty numeric input, incomplete circle, etc.) must
    // never feed non-finite coordinates to SVG or disrupt orbit controls.
    const valid = (p) =>
      Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
    guides = guides.filter(
      (g) =>
        (!g.anchor || valid(g.anchor)) &&
        (g.paths ?? []).every((s) => s.every(valid)) &&
        (g.dots ?? []).every(valid),
    );
    svg.replaceChildren();
    entries = guides.map((guide) => addGuide(svg, guide));
    svg.setAttribute(
      'aria-label',
      guides
        .map((g) => g.text)
        .filter(Boolean)
        .join(', ') || 'Model guides',
    );
    stage.draw();
  };
}
