// Road surface textures: a repeatable tile of stones whose joints are cut
// into the surface of plain straights and corners.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import cobbles from '../src/textures/cobbles.js';
import {
  ROAD_TEXTURES,
  TEXTURE_DEFAULTS,
  hasRoadTexture,
  textureRepeat,
  textureScale,
  textureSettings,
  textureStoneSize,
} from '../src/geometry/road-texture.js';
import { trackInspector } from '../src/inspector.js';
import { newProject } from '../src/project.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { buildTestJoint, buildTrack, defaultTrack, trackParameters, validateTrack } from '../src/track.js';

const wasm = await Module();
wasm.setup();

const piece = (changes = {}) =>
  trackParameters({ ...defaultTrack(), kind: 'straight', length: 200, lanes: 1, width: 100, ...changes });
const cobbled = (changes = {}) => piece({ roadTexture: 'cobbles', ...changes });
function built(p, inspect) {
  const parts = buildTrack(wasm, p);
  try {
    return inspect(parts);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
}
const roadOf = (parts) => parts.find((part) => part.role === 'road');
const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, 'expected ' + expected + ' ± ' + tolerance + '; measured ' + actual);
// The area of a part's surface inside a rectangle, at a height.
function areaAt(solid, z, [x0, y0, x1, y1]) {
  const slice = solid.slice(z),
    window = new wasm.CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], 'Positive'),
    both = slice.intersect(window);
  try {
    return both.area();
  } finally {
    slice.delete();
    window.delete();
    both.delete();
  }
}

test('the cobble tile repeats: laid side by side no stone meets another, at the seams as in the middle', () => {
  assert.equal(ROAD_TEXTURES.cobbles, cobbles);
  const { size, joint, stones } = cobbles;
  assert.equal(size, 200);
  assert.ok(stones.length > 200);
  const loops = [];
  for (const dx of [-1, 0, 1])
    for (const dy of [-1, 0, 1])
      for (const stone of stones) {
        const loop = [];
        for (let k = 0; k < stone.length; k += 2) loop.push([stone[k] + dx * size, stone[k + 1] + dy * size]);
        let area = 0;
        loop.forEach((a, i) => {
          const b = loop[(i + 1) % loop.length];
          area += a[0] * b[1] - b[0] * a[1];
        });
        loops.push(area < 0 ? loop.reverse() : loop);
      }
  const laid = new wasm.CrossSection(loops, 'Positive');
  // Grown by a third of a joint each, every stone is still on its own: the
  // thinnest joint anywhere, across the tile edges too, is over two thirds.
  const grown = laid.offset(joint / 3, 'Miter', 2);
  const count = (section) => {
    const parts = section.decompose();
    const n = parts.length;
    parts.forEach((part) => part.delete());
    return n;
  };
  try {
    assert.equal(count(laid), 9 * stones.length, 'no two stones overlap');
    assert.equal(count(grown), 9 * stones.length, 'no joint is thinner than two thirds of the usual one');
    // The stones cover the plane as densely over the seams as in the middle.
    const cover = (x0, y0, x1, y1) => {
      const window = new wasm.CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], 'Positive'),
        inside = laid.intersect(window);
      try {
        return inside.area() / ((x1 - x0) * (y1 - y0));
      } finally {
        window.delete();
        inside.delete();
      }
    };
    const middle = cover(50, 50, 150, 150);
    for (const seam of [cover(175, 0, 225, 200), cover(0, 175, 200, 225)]) near(seam, middle, 0.05);
    assert.ok(middle > 0.7 && middle < 0.9);
  } finally {
    laid.delete();
    grown.delete();
  }
});

test('stone sizes: as drawn, for a model scale, or a percentage of your own', () => {
  assert.equal(hasRoadTexture(piece()), false);
  assert.equal(hasRoadTexture(cobbled()), true);
  assert.deepEqual(textureSettings(cobbled()), { ...TEXTURE_DEFAULTS, roadTexture: 'cobbles' });
  // A real cobble of 125 mm at each scale.
  for (const [size, mm] of [['24', 5.21], ['32', 3.91], ['43', 2.91], ['64', 1.95]])
    near(textureStoneSize(cobbled({ textureSize: size })), mm, 0.01);
  near(textureStoneSize(cobbled({ textureSize: 'full' })), cobbles.stone, 1e-9);
  assert.equal(textureScale(cobbled({ textureSize: 'full' })), 1);
  assert.equal(textureScale(cobbled({ textureSize: 'custom', textureScale: 250 })), 2.5);
  // Same size everywhere: no stretch. Fitted: a whole number of repeats.
  const fixed = textureRepeat(cobbled(), 200);
  assert.equal(fixed.stretch, 1);
  near(fixed.period, 200 * textureScale(cobbled()), 1e-9);
  const fitted = textureRepeat(cobbled({ textureFit: 'piece' }), 200);
  assert.equal(fitted.count, 3);
  near(fitted.along * fitted.count, 200, 1e-9);
  assert.ok(Math.abs(fitted.stretch - 1) < 0.15);
  // A piece shorter than a repeat still takes one whole repeat, squeezed.
  const short = textureRepeat(cobbled({ textureFit: 'piece', textureSize: 'full' }), 50);
  assert.equal(short.count, 1);
  near(short.stretch, 0.25, 1e-9);
});

test('the joints are cut into the road to the set depth, clear of the slot and the braid', () => {
  const plain = piece(),
    p = cobbled({ textureSize: '24' });
  const depth = p.textureDepth ?? TEXTURE_DEFAULTS.textureDepth;
  const volumes = {};
  built(plain, (parts) => {
    const road = roadOf(parts).solid;
    volumes.plain = road.volume();
    volumes.surface = areaAt(road, plain.height - TEXTURE_DEFAULTS.textureDepth / 2, [-100, -50, 100, 50]);
    volumes.under = areaAt(road, plain.height - TEXTURE_DEFAULTS.textureDepth - 0.05, [-100, -50, 100, 50]);
  });
  built(p, (parts) => {
    const road = roadOf(parts);
    assert.equal(road.solid.status(), 'NoError');
    const pieces = road.solid.decompose();
    assert.equal(pieces.length, 1, 'the stones stand on one road');
    pieces.forEach((part) => part.delete());
    assert.ok(road.textureJoints > 1000, 'joint area ' + road.textureJoints);
    // What was cut away is the joints, to their depth.
    near(volumes.plain - road.solid.volume(), road.textureJoints * depth, road.textureJoints * depth * 0.01);
    const whole = [-100, -50, 100, 50];
    // Half way down a joint the road has lost exactly the joints, against the plain piece.
    const top = areaAt(road.solid, p.height - depth / 2, whole),
      below = volumes.surface;
    near(below - top, road.textureJoints, road.textureJoints * 0.01);
    // Under the joints nothing is cut.
    near(areaAt(road.solid, p.height - depth - 0.05, whole), volumes.under, 0.01);
    // Between a fifth and a third of the surface is joint at this size.
    const share = road.textureJoints / below;
    assert.ok(share > 0.15 && share < 0.4, 'joint share ' + share);
    // Beside the slot and its braid the road is as on the plain piece.
    const reach = p.slotWidth / 2 + p.braidGap + p.braidWidth + 0.7;
    built(plain, (others) => {
      const band = [-100, -reach, 100, reach];
      for (const z of [p.height - depth / 2, p.height - 0.05])
        near(areaAt(road.solid, z, band), areaAt(roadOf(others).solid, z, band), 0.01);
    });
  });
});

test('the joint keeps the width that was set, whatever the size of the stones', () => {
  const jointArea = (changes) => {
    let area;
    built(cobbled(changes), (parts) => {
      area = roadOf(parts).textureJoints;
    });
    return area;
  };
  // Twice the width is about twice the joint area at one stone size.
  const thin = jointArea({ textureSize: 'full', textureJoint: 0.5 }),
    wide = jointArea({ textureSize: 'full', textureJoint: 1 });
  assert.ok(wide / thin > 1.8 && wide / thin < 2.1, 'ratio ' + wide / thin);
  // Half the stone size has twice the length of joint, at the same width.
  const large = jointArea({ textureSize: 'custom', textureScale: 100, textureJoint: 0.6 }),
    small = jointArea({ textureSize: 'custom', textureScale: 50, textureJoint: 0.6 });
  assert.ok(small / large > 1.7 && small / large < 2.2, 'ratio ' + small / large);
});

test('fitted to the piece the pattern ends as it begins, so it runs on into the next piece', () => {
  // The joints in a strip at the start of the road, against the same strip at its end.
  const ends = (changes) => {
    const p = cobbled({ textureSize: 'full', textureJoint: 1, length: 230, ...changes });
    let difference;
    built(p, (parts) => {
      const z = p.height - 0.2,
        slice = roadOf(parts).solid.slice(z);
      const strip = (x0) => {
        const window = new wasm.CrossSection([[[x0, -50], [x0 + 8, -50], [x0 + 8, 50], [x0, 50]]], 'Positive');
        const cut = slice.intersect(window);
        window.delete();
        return cut;
      };
      const start = strip(-115),
        end = strip(107),
        moved = end.translate([-222, 0]),
        unlike = start.subtract(moved),
        other = moved.subtract(start);
      difference = unlike.area() + other.area();
      for (const section of [slice, start, end, moved, unlike, other]) section.delete();
    });
    return difference;
  };
  // A repeat of 200 mm on a 230 mm piece: fitted it is stretched to the piece.
  assert.ok(ends({ textureFit: 'piece' }) > 150, 'the start and the end of one piece are different parts of the pattern');
  const next = (changes) => {
    // The first 8 mm of the piece against the first 8 mm after a whole repeat.
    const p = cobbled({ textureSize: 'full', textureJoint: 1, length: 460, ...changes });
    let difference;
    built(p, (parts) => {
      const slice = roadOf(parts).solid.slice(p.height - 0.2);
      const strip = (x0) => {
        const window = new wasm.CrossSection([[[x0, -50], [x0 + 8, -50], [x0 + 8, 50], [x0, 50]]], 'Positive');
        const cut = slice.intersect(window);
        window.delete();
        return cut;
      };
      const start = strip(-230),
        repeat = strip(0),
        moved = repeat.translate([-230, 0]),
        a = start.subtract(moved),
        b = moved.subtract(start);
      difference = a.area() + b.area();
      for (const section of [slice, start, repeat, moved, a, b]) section.delete();
    });
    return difference;
  };
  // Fitted, 460 mm takes two repeats of 230 mm: the middle is a tile edge.
  assert.ok(next({ textureFit: 'piece' }) < 2, 'fitted: ' + next({ textureFit: 'piece' }));
  // At the drawn size the repeat is 200 mm, so 230 mm on is somewhere else in the pattern.
  assert.ok(next({ textureFit: 'fixed' }) > 150, 'same size everywhere: ' + next({ textureFit: 'fixed' }));
});

test('a corner, a cut piece and a piece with borders, lines and connectors all take the texture', () => {
  built(cobbled({ kind: 'curve', radius: 250, angle: 60 }), (parts) => {
    const road = roadOf(parts);
    assert.equal(road.solid.status(), 'NoError');
    assert.ok(road.textureJoints > 1000);
  });
  const dressed = cobbled({
    lanes: 2, width: 200, segments: 2, borderSide: 'both', whiteLineRoad: 'both', joint: 'clips',
  });
  let plainBorders;
  built({ ...dressed, roadTexture: 'none' }, (parts) => {
    plainBorders = parts.filter((part) => part.role === 'border').map((part) => part.solid.volume());
  });
  built(dressed, (parts) => {
    const roads = parts.filter((part) => part.role === 'road');
    assert.equal(roads.length, 2);
    for (const road of roads) {
      assert.equal(road.solid.status(), 'NoError');
      assert.ok(road.textureJoints > 500, road.id);
    }
    // The texture is on the road; the borders are as they were.
    const borders = parts.filter((part) => part.role === 'border');
    borders.forEach((border, i) => near(border.solid.volume(), plainBorders[i], 1e-6));
    assert.equal(borders.some((border) => border.textureJoints), false);
  });
  // Deep joints never cut through: under them the road is as on the plain piece.
  const deep = cobbled({ joint: 'clips', deck: 2, textureDepth: 1.2 });
  let under;
  built({ ...deep, roadTexture: 'none' }, (parts) => {
    under = areaAt(roadOf(parts).solid, deep.height - 1.3, [-100, -50, 100, 50]);
  });
  built(deep, (parts) => near(areaAt(roadOf(parts).solid, deep.height - 1.3, [-100, -50, 100, 50]), under, 0.01));
});

test('a texture that cannot be made is refused with what to change', () => {
  const refuse = (changes, text) => assert.throws(() => validateTrack(cobbled(changes)), text, JSON.stringify(changes));
  refuse({ roadTexture: 'gravel' }, /Choose a road surface texture from the list/);
  refuse({ textureSize: '87' }, /Choose a stone size/);
  refuse({ textureFit: 'layout' }, /Choose Same size everywhere or Fit to each piece/);
  refuse({ textureJoint: 0.1 }, /joint width must be between 0.3 and 5 mm/);
  refuse({ textureDepth: 4 }, /joint depth must be between 0.1 and 3 mm/);
  refuse({ textureSize: 'custom', textureScale: 2 }, /texture size must be between 5 and 500 %/);
  refuse({ textureSize: '64', textureJoint: 1 }, /stones are 1\.95 mm across at this size, too small for a 1 mm joint\. Use a joint of at most 0\.87 mm, or larger stones/);
  refuse({ deck: 1.2, textureDepth: 1.1 }, /leaves less than 0\.2 mm of road under it\. Set the joint depth to 1 mm or less, or use a thicker deck/);
  assert.doesNotThrow(() => validateTrack(cobbled({ hollow: false, textureDepth: 2 })));
  // A percentage that is not in use is not looked at.
  assert.doesNotThrow(() => validateTrack(cobbled({ textureScale: 2 })));
  // Off, none of its settings is looked at.
  assert.doesNotThrow(() => validateTrack(piece({ textureJoint: 99, textureDepth: 99 })));
  // Special pieces have road shapes of their own.
  const pit = specialTrackParams('pit', { ...defaultTrack(), width: 200, laneSpacing: 100 });
  assert.throws(
    () => validateTrack(trackParameters({ ...pit, roadTexture: 'cobbles' })),
    /A road surface texture is for plain straights and corners\. Set Road surface texture to None/,
  );
  // A piece from before textures is unchanged.
  assert.equal(defaultTrack().roadTexture, undefined);
});

test('Track Set offers the texture under Markings on plain straights and corners', () => {
  const project = newProject();
  project.mode = 'track';
  project.track.params = cobbled();
  const html = trackInspector(project, 'markings');
  assert.match(html, /Road surface texture/);
  assert.match(html, /<option value="cobbles" selected>Cobbles/);
  for (const label of ['As drawn', 'Scale 1:24', 'Scale 1:32', 'Scale 1:43', 'Scale 1:64', 'Custom', 'Same size everywhere', 'Fit to each piece'])
    assert.ok(html.includes('>' + label + '<'), label);
  assert.match(html, /name="textureJoint"[^>]*value="0.6"/);
  assert.match(html, /name="textureDepth"[^>]*value="0.5"/);
  assert.match(html, /data-texture-fields>/);
  assert.match(html, /data-texture-custom hidden disabled>/);
  assert.match(html, /Stones about 3\.9 mm across\. The pattern repeats every 70\.4 mm\./);
  project.track.params = piece();
  const off = trackInspector(project, 'markings');
  assert.match(off, /data-texture-fields hidden disabled>/);
  assert.match(off, /<option value="none" selected>None/);
  project.track.params = specialTrackParams('pit', { ...defaultTrack(), width: 200, laneSpacing: 100 });
  assert.doesNotMatch(trackInspector(project, 'markings'), /Road surface texture/);
});

test('a fit sample of a textured piece is made without the texture', () => {
  const volumes = [cobbled({ joint: 'clips' }), piece({ joint: 'clips' })].map((p) => {
    const parts = buildTestJoint(wasm, p, 'start');
    try {
      return parts.map((part) => part.solid.volume());
    } finally {
      parts.forEach((part) => part.solid.delete());
    }
  });
  assert.deepEqual(volumes[0], volumes[1]);
});
