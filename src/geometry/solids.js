/** Own intermediate WASM handles while constructing a group of printable parts. */
export class SolidWorkshop {
  constructor(wasm) {
    this.wasm = wasm;
    this.handles = new Set();
  }
  own(handle) {
    this.handles.add(handle);
    return handle;
  }
  close() {
    for (const handle of this.handles) handle.delete();
    this.handles.clear();
  }
  section(paths) {
    return this.own(new this.wasm.CrossSection(paths, 'EvenOdd'));
  }
  prism(section, low, high) {
    const extrusion = this.own(section.extrude(high - low));
    return low ? this.own(extrusion.translate([0, 0, low])) : extrusion;
  }
  union(parts) {
    return parts.length === 1
      ? parts[0]
      : this.own(this.wasm.Manifold.union(parts));
  }
  cut(base, tools) {
    return tools.length ? this.own(base.subtract(this.union(tools))) : base;
  }
  and(a, b) {
    return this.own(a.intersect(b));
  }
  rim(section, thickness) {
    const inset = this.own(section.offset(-thickness, 'Miter'));
    return this.own(section.subtract(inset));
  }
}

export const length2 = (v) => Math.hypot(v[0], v[1]);
export const minus = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const unit = (v) => {
  const len = length2(v);
  return len ? [v[0] / len, v[1] / len] : [0, 0];
};
export const left = (v) => [-v[1], v[0]];
export const move = (p, dir, d) => [p[0] + dir[0] * d, p[1] + dir[1] * d];

export function makePart(id, name, role, section) {
  return { id, name, role, section, additions: [], cuts: [], feedCuts: [] };
}

export function shell(work, part, p) {
  const { section } = part;
  if (!p.hollow) {
    part.additions.push(work.prism(section, 0, p.height));
    return;
  }
  part.additions.push(work.prism(section, p.height - p.deck, p.height));
  part.additions.push(work.prism(work.rim(section, p.wall), 0, p.height));
}

// Distance from the guide wall to the outside edge of one braid recess.
export function braidSpan({ braidWidth, braidGap }) {
  if (!Number.isFinite(braidWidth) || !Number.isFinite(braidGap) || braidWidth < 0 || braidGap < 0)
    return NaN;
  return braidWidth === 0 ? 0 : braidGap + braidWidth;
}

// A strip lies in a recess below the road, or on a low land above it for
// adhesive copper tape. The recess depth plays no part on a raised land.
export const BRAID_STYLES = Object.freeze(['recessed', 'raised']);
export const braidRaised = (p) => p.braidStyle === 'raised';
export const braidRecess = (p) => (braidRaised(p) ? 0 : p.braidDepth);
// Where the strip sits, measured up from the driving surface.
export const braidLevel = (p) => (braidRaised(p) ? p.braidRaise : -p.braidDepth);
// The land starts this far below the surface, so it prints as part of the road.
const LAND_ROOT = 0.2;

export function validateBraidStyle(p) {
  if (!BRAID_STYLES.includes(p.braidStyle))
    throw new Error('Choose a recessed or a raised braid.');
  if (
    !braidRaised(p) &&
    (p.braidDepth >= (p.hollow ? p.deck : p.height) || p.braidDepth > p.slotDepth)
  )
    throw new Error(
      'The braid recess must stay within the deck and above the slot floor.',
    );
}

// Keep the full lane footprint for spacing checks. Only the two braid-width
// bands are milled when there is a strip of road between the braid and guide.
export function braidSections(work, p, band) {
  if (!p.braidWidth) return [null, null];
  const inner = p.slotWidth / 2 + p.braidGap;
  const outer = inner + p.braidWidth;
  const envelope = band(-outer, outer);
  if (!p.braidGap) return [envelope, envelope];
  return [work.own(work.wasm.CrossSection.union([band(-outer, -inner), band(inner, outer)])), envelope];
}

export function addSlot(work, part, p, guide, sleeve, braidShelf) {
  if (p.hollow) {
    const clipped = work.own(sleeve.intersect(part.section));
    if (p.reinforcement && p.height - p.slotDepth - p.wall > 1e-7)
      (part.ribSleeves ??= []).push(clipped);
    part.additions.push(
      work.prism(clipped, p.height - p.slotDepth - p.wall, p.height),
    );
  }
  part.cuts.push(work.prism(guide, p.height - p.slotDepth, p.height + 1));
  if (braidRaised(p)) {
    // The cutters run a little past each seam; a land ends on its own road.
    // With no offset the band also spans the guide, whose cut opens it again.
    const land = braidShelf && work.own(braidShelf.intersect(part.section));
    if (land && !land.isEmpty())
      part.additions.push(
        work.prism(land, p.height - LAND_ROOT, p.height + p.braidRaise),
      );
  } else if (p.braidDepth > 0 && braidShelf)
    part.cuts.push(
      work.prism(braidShelf, p.height - p.braidDepth, p.height + 1),
    );
}
