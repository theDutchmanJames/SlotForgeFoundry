import { zipSync, strToU8 } from 'fflate';
import { cleanName, isFlatCrossingProject, printsFaceUp } from './project.js';
import { withPrintableSolid } from './geometry/joints.js';
import { clipAttribution, clipSpec, clipSTLHeader } from './geometry/clip-types.js';
import { currentJointSettings } from './geometry/joint-fit.js';
import {
  fitRetainer,
  fitScrewClip,
  releaseRetainer,
  releaseScrewClip,
} from './clip-instructions.js';
import { screwName } from './geometry/screw-clip.js';
import { keeperToolSTL, KEEPER_TOOL_FILENAME } from './keeper-tool-stl.js';
import { assemblyNotes, wiringDiagram } from './special-print.js';

const PREFIXES = {
  road: 'T',
  border: 'B',
  clip: 'C',
  retainer: 'R',
  support: 'S',
  turnout: 'V',
  turnoutArm: 'K',
  turnoutBearing: 'J',
  turnoutInsert: 'N',
  motorMount: 'M',
  barrier: 'W',
  fence: 'F',
  body: 'P',
  addition: 'A',
};
const COLORS = {
  road: '#66727d',
  border: '#88c9bc',
  clip: '#edbf75',
  retainer: '#669cc8',
  support: '#cfa5dc',
  turnout: '#db917b',
  turnoutArm: '#8b80bb',
  turnoutBearing: '#bf9653',
  turnoutInsert: '#c97a8e',
  motorMount: '#56a0a6',
  barrier: '#c9c4b8',
  fence: '#8d949c',
  body: '#a6b8c4',
  addition: '#80bda7',
};

function xml(value) {
  const escaped = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  };
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, (ch) => escaped[ch]);
}

function csv(value) {
  const text = String(value);
  // Part names can come from local files. Keep formula-like names as text in
  // spreadsheet programs that evaluate quoted CSV fields.
  return (
    '"' +
    (/^[\s]*[=+@-]/.test(text) ? "'" : '') +
    text.replaceAll('"', '""') +
    '"'
  );
}

function onPrintPlane(solid, faceDown, encode) {
  const oriented = faceDown ? solid.rotate([180, 0, 0]) : solid;
  let placed;
  try {
    const { min, max } = oriented.boundingBox();
    placed = oriented.translate([
      -(min[0] + max[0]) / 2,
      -(min[1] + max[1]) / 2,
      -min[2],
    ]);
    return encode(placed);
  } finally {
    placed?.delete();
    if (faceDown) oriented.delete();
  }
}

function projectedOutline(part) {
  const section = part.solid.project();
  try {
    return section.toPolygons();
  } finally {
    section.delete();
  }
}

// Pick a point on the represented material. The bounding-box centre of a bend
// can be completely outside the part. Scan even-odd spans near the centre.
function labelPoint(contours, bounds) {
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const h = bounds.max[1] - bounds.min[1];
  for (const fraction of [0, -0.125, 0.125, -0.25, 0.25, -0.375, 0.375]) {
    const y = cy + h * fraction,
      crossings = [];
    for (const loop of contours)
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i],
          b = loop[(i + 1) % loop.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
          crossings.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
      }
    crossings.sort((a, b) => a - b);
    let x = null,
      best = -1;
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const width = crossings[i + 1] - crossings[i];
      if (width > best) {
        x = (crossings[i + 1] + crossings[i]) / 2;
        best = width;
      }
    }
    if (x !== null) return [x, y];
  }
  return [cx, cy];
}

function assemblyMap(entries, groups, project) {
  const minX = Math.min(...entries.map((p) => p.bounds.min[0]));
  const minY = Math.min(...entries.map((p) => p.bounds.min[1]));
  const maxX = Math.max(...entries.map((p) => p.bounds.max[0]));
  const maxY = Math.max(...entries.map((p) => p.bounds.max[1]));
  const width = Math.max(1, maxX - minX),
    height = Math.max(1, maxY - minY);
  const scale = Math.min(952 / width, 526 / height);
  const mapPoint = ([x, y]) => [
    500 + (x - (maxX + minX) / 2) * scale,
    335 - (y - (maxY + minY) / 2) * scale,
  ];
  const f = (n) => n.toFixed(2);
  const crossings = isFlatCrossingProject(project)
    ? project.track.plan.flatCrossing.crossings
    : [];
  const listY = 640 + crossings.length * 26;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${listY + 40 + groups.length * 26}" role="img" aria-labelledby="title">`,
    `<title id="title">${xml(project.name)} · assembly map</title>`,
    '<rect width="100%" height="100%" fill="white"/>',
    '<g font-family="system-ui, sans-serif" fill="#202831">',
    `<text x="26" y="35" font-size="25" font-weight="600">${xml(project.name)}</text>`,
    '<text x="26" y="58" font-size="14">Assembly map · top view · print quantities below</text>',
  ];
  // Show the locations of underside hardware on top of the deck outlines.
  const mapLayer = { support: 1, turnoutInsert: 0.5, turnout: 1, turnoutBearing: 1, motorMount: 1, turnoutArm: 2, clip: 2, retainer: 3 };
  const mapOrder = entries
    .slice()
    .sort((a, b) => (mapLayer[a.role] ?? 0) - (mapLayer[b.role] ?? 0));
  for (const item of mapOrder) {
    const path = item.contours
      .map(
        (loop) =>
          loop
            .map((p, i) => (i === 0 ? 'M' : 'L') + mapPoint(p).map(f).join(','))
            .join('') + 'Z',
      )
      .join('');
    out.push(
      `<path d="${path}" fill="${COLORS[item.role] ?? COLORS.body}" fill-rule="evenodd" stroke="#36424b" stroke-width="1.2"><title>${xml(item.id + ' · ' + item.name)}</title></path>`,
    );
  }
  // A centred dovetail keeper shares its label with the key. Carrera keepers
  // have separate seats on opposite sides of the seam, each with its own label.
  const centredKeepers = new Map(mapOrder
    .filter((item) => item.role === 'retainer' && item.instance === item.parentClipId + '-retainer')
    .map((item) => [item.parentClipId, item]));
  for (const item of mapOrder) {
    const keeper = centredKeepers.get(item.instance);
    if (item.role === 'retainer' && centredKeepers.get(item.parentClipId) === item) continue;
    const [x, y] = mapPoint(labelPoint(item.contours, item.bounds));
    const label =
      item.role === 'clip' && keeper ? item.id + ' + ' + keeper.id : item.id;
    out.push(
      `<text x="${f(x)}" y="${f(y)}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" paint-order="stroke" stroke="white" stroke-width="3">${xml(label)}</text>`,
    );
  }
  crossings.forEach((crossing, i) => {
    const [x, y] = mapPoint(crossing.point);
    const upperFirst = crossing.upperPass === 'first';
    const upper = upperFirst ? crossing.firstSection : crossing.secondSection;
    const lower = upperFirst ? crossing.secondSection : crossing.firstSection;
    out.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="10" fill="#394653" stroke="white" stroke-width="2"/>`,
      `<text x="${f(x)}" y="${f(y + 4)}" text-anchor="middle" font-size="11" fill="white">${i + 1}</text>`,
      `<text x="26" y="${628 + i * 26}" font-size="15">Crossing ${i + 1} · Section ${upper + 1} over section ${lower + 1}</text>`,
    );
  });
  out.push(
    `<text x="26" y="${listY}" font-size="18" font-weight="600">Parts to print</text>`,
  );
  groups.forEach((g, i) => {
    out.push(
      `<text x="26" y="${listY + 29 + i * 26}" font-size="15">${xml(g.id)} · ${xml(g.name)} · print ×${g.instances.length}</text>`,
    );
  });
  out.push('</g></svg>');
  return out.join('\n');
}

export function printableSTL(
  part,
  encodeSTL,
  clipType = part.clipType,
  project,
  printRoadFaceDown = false,
) {
  const roadFaceDown = (part.role === 'road' || part.role === 'border') &&
    !printsFaceUp(project) &&
    (printRoadFaceDown || isFlatCrossingProject(project) || (project?.mode === 'track' && project.track.params.special));
  // A pivot pin is listed with the bearings but prints flange down, as drawn.
  const faceDown = (part.role === 'turnoutBearing' && !part.printsUpright) || roadFaceDown;
  return withPrintableSolid(
    part,
    (solid) =>
      onPrintPlane(solid, faceDown, (placed) =>
        encodeSTL(placed, clipSTLHeader(clipType)),
      ),
    { sideDown: true },
  );
}

function packRoleSTLs(selected, encodeSTL, project) {
  const files = {};
  for (const part of selected)
    files[cleanName(part.id) + '.stl'] = printableSTL(
      part,
      encodeSTL,
      part.clipType,
      project,
    );
  return zipSync(files, { level: 3 });
}

export function packBorderSTLs(parts, encodeSTL, project) {
  const borders = parts.filter((part) => part.role === 'border');
  if (!borders.length)
    throw Error('Add a border before exporting border STLs.');
  return packRoleSTLs(borders, encodeSTL, project);
}

export function packBarrierSTLs(parts, encodeSTL, project) {
  const barriers = parts.filter((part) => part.role === 'barrier' || part.role === 'fence');
  if (!barriers.length)
    throw Error('Switch on a barrier under Trackside before exporting barrier STLs.');
  return packRoleSTLs(barriers, encodeSTL, project);
}

export function packSupportSTLs(parts, encodeSTL, project) {
  const supports = parts.filter((part) => part.role === 'support');
  if (!supports.length)
    throw Error('Enable bridge supports before exporting support STLs.');
  return packRoleSTLs(supports, encodeSTL, project);
}

/** Print files are located on Z=0. Assembly locations are preserved in the map and project. */
export function packKit(
  wasm,
  parts,
  project,
  encodeSTL,
  projectFilename = 'project.slotfab',
) {
  if (!parts?.length) throw new Error('The project has no printable parts.');
  const byDesign = new Map(),
    bySize = new Map(),
    counts = new Map();
  const groups = [],
    placements = [],
    files = {};
  for (const part of parts) {
    // This geometry key is assigned by our track generator, not imported from
    // a file. Identical clips may sit at entirely different angles on a curve.
    const design =
      project.mode === 'track' &&
      (part.role === 'clip' || part.role === 'retainer') &&
      part.fabricationKey;
    const bounds = part.solid.boundingBox();
    let group = design ? byDesign.get(design) : undefined;
    if (!group) {
      const bytes = printableSTL(part, encodeSTL, part.clipType, project);
      const key = part.role + '/' + bytes.byteLength;
      const candidates = bySize.get(key) ?? [];
      // Size alone cannot distinguish a mirrored or keyed connector. Only
      // share its STL if the full local-space file is identical.
      group = candidates.find((candidate) =>
        candidate.bytes.every((v, i) => v === bytes[i]),
      );
      if (!group) {
        const prefix = PREFIXES[part.role] ?? 'P';
        const seq = (counts.get(prefix) ?? 0) + 1;
        counts.set(prefix, seq);
        const id = prefix + seq;
        const name =
          design && part.role === 'clip' && !part.clipType
            ? 'Spring clip'
            : String(part.name);
        const file = 'parts/' + id + '-' + cleanName(name) + '.stl';
        group = { id, name, file, bytes, instances: [] };
        if (part.role === 'support')
          group.supportHeight = Number(
            (bounds.max[2] - bounds.min[2]).toFixed(3),
          );
        groups.push(group);
        files[file] = bytes;
        candidates.push(group);
        bySize.set(key, candidates);
      }
      if (design) byDesign.set(design, group);
    }
    group.instances.push(part.id);
    placements.push({
      id: group.id,
      instance: part.id,
      parentClipId: part.parentClipId,
      role: part.role,
      name: part.name,
      bounds,
      contours: projectedOutline(part),
    });
  }
  const hasSupports = groups.some((g) => g.supportHeight);
  const rows = [
    [
      'ID',
      'Part',
      'File',
      'Quantity',
      'Instances',
      ...(hasSupports ? ['Support height (mm)'] : []),
    ],
    ...groups.map((g) => [
      g.id,
      g.name,
      g.file,
      g.instances.length,
      g.instances.join(' | '),
      ...(hasSupports ? [g.supportHeight ?? ''] : []),
    ]),
  ];
  files['parts.csv'] = strToU8(
    rows.map((row) => row.map(csv).join(',')).join('\r\n') + '\r\n',
  );
  files['assembly.svg'] = strToU8(assemblyMap(placements, groups, project));
  if (projectFilename === 'project.slotfab' && project.mode === 'track' && project.track.params.special) {
    files['Assembly notes.txt'] = strToU8(assemblyNotes(project.track.params));
    files['Conductor map.svg'] = strToU8(wiringDiagram(project.track.params));
  }
  const clipTypes = [
    ...new Set(parts.map((part) => part.clipType).filter(Boolean)),
  ];
  const credits = clipTypes
    .map((clipType) => clipAttribution({ clipType }))
    .filter(Boolean);
  if (credits.length)
    files['Clip attribution.txt'] = strToU8([...new Set(credits)].join('\n\n'));
  const screwClips = parts.filter((part) => part.role === 'clip' && part.clipType === 'side-screw').length;
  if (screwClips) {
    const params = project.track.params;
    files['Fitting the clips.txt'] = strToU8(
      'You need ' + 2 * screwClips + ' × ' + screwName(params) + ' for ' +
        (screwClips === 1 ? 'this Kevan Sideclip' : 'these ' + screwClips + ' Kevan Sideclips') +
        ': two per clip.\n\n' +
        fitScrewClip(params) + '\n\n' + releaseScrewClip + '\n',
    );
  }
  if (parts.some((part) => part.role === 'retainer')) {
    const toolFile = 'tools/' + KEEPER_TOOL_FILENAME;
    files[toolFile] = keeperToolSTL(wasm);
    files['Fitting the clips.txt'] = strToU8(
      'Print one reusable key from ' + toolFile + ' at 100% in the supplied orientation.\n\n' +
        fitRetainer(clipSpec(currentJointSettings(project.track.params))) +
        '\n\n' + releaseRetainer + '\n',
    );
  }
  files[projectFilename] = strToU8(JSON.stringify(project));
  return zipSync(files, { level: 3 });
}
