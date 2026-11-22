import { readFile, writeFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import initManifold from 'manifold-3d';
import { packFitSamples } from '../src/fit-samples.js';
import { keeperToolSTL, KEEPER_TOOL_FILENAME } from '../src/keeper-tool-stl.js';
import { newProject } from '../src/project.js';
import { createEngine } from '../src/engine.js';
import { clipAttribution } from '../src/geometry/clip-types.js';

const root = new URL('../', import.meta.url);
const file = (path) => new URL(path, root);
const pkg = JSON.parse(await readFile(file('package.json'), 'utf8'));
const notices = [];
const clipCredit = clipAttribution({ clipType: 'carrera-retained' });
notices.push(clipCredit);
notices.push(await readFile(file('scripts/notices/meshoptimizer.txt'), 'utf8'));
// Interface fonts shared with the other SlotForge apps (SIL Open Font License).
notices.push(
  'Barlow Condensed (Bold, Bold Italic)\nhttps://github.com/jpt/barlow\n\n' +
    (await readFile(file('src/fonts/OFL-BarlowCondensed.txt'), 'utf8')),
);
notices.push(
  'Roboto Mono\nhttps://github.com/googlefonts/RobotoMono\n\n' +
    (await readFile(file('src/fonts/OFL-RobotoMono.txt'), 'utf8')),
);
// The clipping engine also bundles its orientation predicates and splay tree.
const licenseFiles = { 'polygon-clipping': 'LICENSE.md', splaytree: 'Readme.md' };
for (const name of [...Object.keys(pkg.dependencies), 'robust-predicates', 'splaytree']) {
  const dir = 'node_modules/' + name + '/';
  const manifest = JSON.parse(
    await readFile(file(dir + 'package.json'), 'utf8'),
  );
  const source = await readFile(file(dir + (licenseFiles[name] ?? 'LICENSE')), 'utf8');
  const license = name === 'splaytree' ? source.split(/^## License\s*$/im).at(-1).trim() : source;
  notices.push(
    name +
      ' ' +
      manifest.version +
      '\n' +
      (manifest.homepage ?? '') +
      '\n\n' +
      license,
  );
}
notices.push(
  'The Manifold browser glue is bundled for a local worker. It uses embedded WASM and omits Node-only module loading.',
);
const text = notices.join('\n\n────────────────────\n\n');
// The desktop installers carry the same notices beside the program.
await writeFile(file('dist/THIRD-PARTY-NOTICES.txt'), text);
const safe = text
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
const html = (await readFile(file('dist/index.html'), 'utf8')).replace(
  '</body>',
  '<template id="component-notices">' + safe + '</template></body>',
);
await writeFile(file('dist/index.html'), html);
const wasm = await initManifold();
wasm.setup();
const turningTool = keeperToolSTL(wasm);
const sampleParams = newProject().track.params;
const fitSamples = packFitSamples(wasm, sampleParams);
const carreraSamples = packFitSamples(wasm, {
  ...sampleParams,
  clipType: 'carrera-retained',
});
const figureEight = newProject();
figureEight.name = 'Figure eight with bridge supports';
figureEight.track.sourceName = 'Figure eight';
Object.assign(figureEight.track.params, {
  kind: 'import',
  width: 75,
  height: 10,
  lanes: 2,
  laneSpacing: 32,
  slotDepth: 8,
  borderSide: 'none',
  segments: 11,
  joint: 'tabs',
  bridgeClearance: 45,
  bridgeSupportCount: 6,
  bridgeApproaches: true,
});
figureEight.track.custom = {
  version: 1,
  crossingMode: 'flat-pieces',
  closed: true,
  upperPasses: ['first'],
  points: [
    [-640, -460],
    [640, 460],
    [640, -460],
    [-640, 460],
  ],
  radius: 80,
};
// Derive the drawing from these editable dimensions when opening the project.
const figureEightFile = strToU8(JSON.stringify(figureEight));
await writeFile(
  file('dist/Figure eight with bridge supports.slotfab'),
  figureEightFile,
);
const exampleEngine = createEngine(wasm);
let exampleSupports;
try {
  const parts = exampleEngine.build(figureEight);
  if (
    parts.filter((part) => part.role === 'support').length !== 6 ||
    parts.some((part) => !part.fit.fits)
  )
    throw Error(
      'The figure-eight example must produce six supports and fit its print plate.',
    );
  exampleSupports = exampleEngine.supportSTLs();
} finally {
  exampleEngine.dispose();
}
await writeFile(file('dist/Figure eight support STLs.zip'), exampleSupports);
await writeFile(file('dist/Connector fit samples.zip'), fitSamples);
await writeFile(file('dist/Carrera fit samples.zip'), carreraSamples);
await writeFile(file('dist/' + KEEPER_TOOL_FILENAME), turningTool);
const files = {
  'SlotForge Foundry.html': strToU8(html),
  'Getting started.txt': strToU8(
    [
      'Open SlotForge Foundry.html in your desktop browser. Everything runs locally.',
      'In Track Planner, choose a pack, a corner direction and a piece. Click an open end to build from there. Delete section removes one preset print segment. Use Specials for junctions and Bridge & approaches for heights and support blocks. Save a .slotplan layout or export a print kit with STL files and parts.csv.',
      'In Track Set, choose Scale car in the lower-right viewport toolbar. Click the road or use Lane and Position to place the reference car. Choose a scale to compare its dimensions with the track.',
      'Open Track packs to define a pack or select an existing one. Add track piece creates straights, matching or independent curves and freeform paths. Add to pack opens the saved piece in Track Set. Adjust lane squeeze or spread in Road and the border finishes in Borders.',
      'Choose Special pieces in Add track piece for the double-crossover hairpin, single-lane pit, flat diamond crossing, late-apex duel, bus-stop chicane or timing straight. Choose borders in the live preview. In Road, tune the chicane’s entry and exit radii separately or choose the detector for a timing straight. The complete STL kit includes a conductor map and assembly notes.',
      'Open the Figure eight with bridge supports project in examples. Under Road > Bridge and supports, choose the upper passage, clearance and block count. Export STLs offers the complete kit and a separate Bridge supports only ZIP. The driving surfaces print flat against the bed and the numbered blocks install on the table.',
      'Open Library and choose SlotForge Basic for two lanes or SlotForge Basic Single Lane for one centred lane. Each pack contains three plain straights, a Starting grid straight and six nesting corners. Under Road → Starting grid, set mark width, line thickness and leg length. A zero leg length gives a transverse line. Two-lane marks can sit side by side or staggered. Enable Recess the mark outline for a printable paint groove.',
      'Choose New track pack to copy a pack or start empty. Shared print profile checks the members before saving slot, braid or connector changes. Save current piece stores the editable piece. Back up SQLite and Restore backup transfer the entire library between devices.',
      'To create from scratch, choose STL Edit > New design. Choose Solid shape for a dimensioned primitive, Sketch to draw on a workplane or a picked face, or Import outline for SVG/DXF. Select a sketch to Extrude, Revolve, Sweep or Loft. Choose New part, Join or Cut and apply the live geometry.',
      'Drag a new box or its centre handle across the workplane. Pull an X, Y or Z arrow for one axis, or enter exact offsets under Placement. After applying a separate shape, select it in Parts and choose Move below the viewport.',
      'To draw relative to an existing hole, open an STL, select a flat face and choose Look at face. Open Grid in the viewport toolbar to change the spacing on the model, then choose Sketch on this grid. Choose Set zero and click the hole rim or centre. Choose Align X to edge and click a straight edge. Reverse X switches direction. Drawing coordinates now measure from that hole along the chosen axes. Finish the sketch and save the project to keep its grid settings.',
      'Square size sets the grid in millimetres. With Equal edge margins, 5 mm squares on a 235 by 117 mm face leave 1 mm at the top and bottom. From lower-left corner puts leftover space at the opposite edges. Exact fit finds a square size that divides both extents when their measured dimensions allow it. Grid visibility and snapping have separate switches.',
      'Use Top, Bottom, Front, Back, Left, Right or Isometric to centre and frame your visible selection. Fit all frames every visible part in the current orientation. Select a sketch and choose Look at face to return to its drawing axes after orbiting.',
      'Try a bracket: sketch an L-profile on XZ, with 40 mm and 30 mm legs and a 4 mm wall. Extrude 24 mm. On its broad horizontal face, place a 3 mm hole 8 mm from the end. Mirror that feature across the X centre of the part. Open the original sketch in history to change its width to 70 mm. Both hole centres keep their 8 mm end distances. Finish edge rounds or bevels straight creases and circular rims.',
      'In the STL editor, Open STL starts with your file. Add model under Parts adds another STL to the same project. Select two parts to Align them. Select the parts and choose Combine to join, subtract or intersect their volumes.',
      'To edit existing cylindrical holes, click a rim, Shift-click the other rims, then choose Countersink. Set the common head diameter and included angle, or choose Counterbore, Resize bore or Fill hole. Check the highlighted rims and apply once. Undo restores the entire selection.',
      'Click a rounded corner once to select the curved edge between its adjoining walls. Shift-click to include another corner. Choose Finish edge to round or chamfer the selection. Select Individual segment for a single span, or follow a face perimeter or tangent chain. Pick a flat wall and open Modify walls for per-side offset and fixed-plane draft. Remove feature heals a straight-sided boss, rib or pocket from its flat cap or floor. Stretch section changes the interval between two planes while preserving end details.',
      'Mesh tools contains Inspect STL file, Brush & lasso and Simplify mesh. Review open boundaries and winding before importing a damaged file. Brush a curved surface to smooth it, or remove it and patch the opening. Simplify mesh shows how reducing triangles changes the silhouette.',
      'Click a flat face and choose Hollow to turn it into an opening with a chosen wall thickness. Choose Text on a surface to raise or engrave a label. For a live cutaway, use Section view in the viewport toolbar. Choose an axis and slide the plane through the model. Your STL exports the full solid.',
      'Try Import Circuit with the supplied DXF or SVG. These are two exports of the same bend. Change the centre radius or a border width to see the model update. Apply records the change. The curved arrow beside a setting restores its value.',
      'Under Cross-section → Road body, hollow roads and borders include crosswise ribs at a target spacing of 50 mm. Adjust Target rib spacing and Wall thickness or turn off reinforcement. Choose View underside to inspect the ribs around the connectors.',
      'Under Road → Road white lines, add edge stripes and a solid or dashed centre line. On a pit piece, enable Pit lane divider and choose solid or dashed entry and exit. The long divider follows the main road edge as the pit widens. Dash length and gap apply to both marking styles.',
      'Use Road → Road kerbstones to put alternating blocks directly on the track. Choose Borders to mark a detachable border. Enabled paint grooves are part of the printed geometry and the colours are painting guides.',
      'Under Road → Pit grid marker, add a stopping mark to the straight pit bay and move it from entry (0%) to exit (100%). Set the mark width, line thickness and leg length. Use zero-length legs for a transverse line, or enable the outline recess to print a paint groove.',
      'In Connections, choose the joint type and select one, two or three clips or tabs per joint. One goes in the middle, two form an outer pair, and three include both outer positions and the centre. For a mixed row, choose each count up to five total. Use the placement map for exact positions. Apply changes keeps the live layout and both mating features.',
      'The tools folder contains a reusable turning key for the quarter-turn keepers. Print it flat at 100%. Both connector fit sample ZIPs include the tool. Follow fit-key.txt to try the dovetail key with its centre keeper or the Carrera fork with its two keepers. Under Track Set → Connections, use Export fit samples to test your own settings or Download keeper tool STL to print the key on its own.',
      'In the STL editor, click the top rim of the enclosure, choose Trim and enter 3 mm. Check the live result, then apply the cut to bring its height from 16 to 13 mm. Cut off top starts a horizontal trim without picking a face. Push / pull moves material inside a picked outline. Add profile and Cut profile accept face outlines, rectangles, circles, round-ended slots and imported drawings.',
      'Click one screw post top, then Shift-click the other tops. Choose Push / pull to move each by a signed distance or set all selected faces to one height. For posts at 10, 12, 14 and 16 mm, moving each by -2 mm gives 8, 10, 12 and 14 mm. Setting a common height of 12 mm brings all four to 12 mm from the underside. The flat tops must face the same way on one part. Apply records one undoable edit.',
      'Use Save for an editable project. Use the top-bar Export STLs menu for a selected part, borders or a complete print kit with quantities and an assembly map. Expand a family under Assembly to find a particular segment or clip. Edit as STL beside the selected part opens it in the STL editor.',
    ].join('\n\n') + '\n',
  ),
  'examples/Club bend.dxf': await readFile(
    file('tests/drawings/circuit-curve-mm.dxf'),
  ),
  'examples/Figure eight with bridge supports.slotfab': figureEightFile,
  'examples/Figure eight support STLs.zip': exampleSupports,
  'examples/Club bend.svg': await readFile(
    file('tests/drawings/circuit-curve-compact.svg'),
  ),
  'examples/Connector fit samples.zip': fitSamples,
  'examples/Carrera fit samples.zip': carreraSamples,
  ['tools/' + KEEPER_TOOL_FILENAME]: turningTool,
  'Clip attribution.txt': strToU8(clipCredit),
  'Third-party notices.txt': strToU8(text),
  'LICENSE.txt': await readFile(file('LICENSE')),
};
for (const extension of ['svg', 'png', 'ico']) {
  const icon = 'slotforge-foundry.' + extension;
  files['icons/' + icon] = await readFile(file('assets/' + icon));
}
const name = 'SlotForge-Foundry-' + pkg.version + '.zip';
await writeFile(file('dist/' + name), zipSync(files, { level: 6 }));
console.log('Packaged dist/' + name);
