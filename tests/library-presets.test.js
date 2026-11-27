// The standard buildings brought over from the Scaleform library (its racing,
// town and car buildings): each one
// builds, and its kit prints clean: every part one body, fitting the plate,
// nothing over air but the small bridges its kind always has, nothing in
// another part.
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage } from '../src/geometry/building.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { MARSHAL } from '../src/geometry/marshal-post.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const LIBRARY = [
  'scrutineering', 'tyre-depot', 'briefing-hall', 'recovery-garage', 'paddock-club', 'podium-pavilion', 'parc-ferme', 'medical-centre', 'paddock-diner', 'timing-rotunda',
  'stand-bleachers', 'stand-terrace', 'stand-double', 'picnic-pergola', 'timber-pavilion', 'score-beacon',
  'commentary-booth', 'ticket-office', 'starter-tower', 'marshal-lookout', 'press-gallery', 'endurance-pits', 'finish-bridge',
  // Its town and car buildings.
  'corner-shop', 'village-station', 'canal-house', 'engineering-works', 'courtyard-inn', 'watchtower', 'trackside-garage', 'research-habitat', 'timber-cottage', 'townhouse', 'guildhall', 'drag-timing-booth', 'hillclimb-lodge', 'wind-tunnel', 'crash-test-hall', 'paint-body-shop', 'car-assembly-hall', 'drive-in-box-office', 'motor-court', 'toll-booth', 'auto-parts-store', 'auction-hall', 'salvage-yard', 'hot-rod-shop', 'car-audio-shop', 'car-wash', 'transporter-depot', 'weighbridge-office', 'motor-showroom', 'inspection-lane', 'car-storage-tower', 'carhop-diner', 'ruined-townhouse', 'room-box', 'filling-station', 'forecourt-canopy', 'rally-service-tent', 'rally-start-ramp', 'victory-lane',
  // Its moving parts, machinery and scenery.
  'drive-in-screen', 'carport', 'carport-twin', 'banner-bridge', 'props-moving', 'props-machinery',
];
// The bridges each kind has: a stand section's slots for the tabs of the one
// before it; the cleats over the gaps between a bench's or a table's planks;
// a pit bay's tab sockets and railing pockets; a marshal cabin's floor sockets.
const bridges = (p) =>
  /grandstand section/i.test(p.name) ? 35
  : /^(upper-)?bench-|^(top|seat)/.test(p.id) ? 30
  : p.id.startsWith('bay') ? 80
  : p.id === 'cabin' ? 4 * (MARSHAL.peg[0] + 2 * MARSHAL.play) ** 2 + 2
  : 0.5;

for (const id of LIBRARY)
  test('the ' + id + ' preset builds and prints clean', () => {
    const preset = BUILDING_PRESETS.find((p) => p.id === id);
    if (!preset) throw Error('No preset ' + id);
    const parts = buildGarage(wasm, preset.building, PLATE);
    try {
      checkKit(parts, PLATE, id + ': ', bridges);
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  });
