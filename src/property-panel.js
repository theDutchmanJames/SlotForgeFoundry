const value = (form, name) => form.elements.namedItem(name)?.value || '—';
const choice = (form, name) =>
  form.elements.namedItem(name)?.selectedOptions[0]?.text ?? '';
const size = (form, x, y) => value(form, x) + ' × ' + value(form, y) + ' mm';
const segmentCount = (form, field) => {
  const count = value(form, field);
  return count + (count === '1' ? ' segment' : ' segments');
};

const readouts = {
  body: (form) =>
    value(form, 'height') + ' mm · ' + (form.elements.hollow.checked ? 'Hollow' : 'Solid'),
  slot: (f) => size(f, 'slotWidth', 'slotDepth'),
  braid: (f) =>
    f.elements.namedItem('braidStyle')?.value === 'raised'
      ? value(f, 'braidWidth') + ' mm · raised ' + value(f, 'braidRaise') + ' mm'
      : size(f, 'braidWidth', 'braidDepth'),
  feed: (f) => {
    const pit = f.elements.spPitContactMode;
    if (!pit) return choice(f, 'braidFeedSide');
    return pit.disabled ? 'No braid' : choice(f, 'spPitContactMode');
  },
  lanes: (form) => {
    const off = ['outer', 'inner'].includes(value(form, 'slotEdge')) ? ' · off-centre' : '';
    if (value(form, 'lanes') === '1') return '1 lane' + off;
    // Set each lane: the spacing plays no part in where the slots are.
    const each = off && form.elements.namedItem('slotLanes')?.value === 'each';
    return value(form, 'lanes') + ' lanes' + (each ? '' : ' · ' + value(form, 'laneSpacing') + ' mm') + off;
  },
  startingGrid: (form) =>
    form.elements.gridEnabled.checked ? value(form, 'gridWidth') + ' mm wide' : 'Off',
  pitGrid: (form) =>
    form.elements.spPitGridEnabled.checked ? value(form, 'spPitGridPosition') + '% along bay' : 'Off',
  roadKerbs: (f) => choice(f, 'roadKerbSide'),
  segments: (f) => segmentCount(f, 'segments'),
  borderSegments: (f) => segmentCount(f, 'borderSegments'),
  borderWidths: (f) => value(f, 'borderEntry') + ' → ' + value(f, 'borderExit') + ' mm',
  roadJoints: (form) => {
    const { joint, jointStart, jointEnd } = form.elements;
    const ends = [jointStart.value, jointEnd.value];
    return ends.some((end) => end && end !== joint.value) ? 'Mixed joints' : choice(form, 'joint');
  },
  borderJoints: (form) =>
    form.elements.borderJoint.value === form.elements.borderMount.value
      ? choice(form, 'borderMount')
      : 'Mixed joints',
  placement: (f) =>
    value(f, 'connectorOffset') === '0' ? 'Automatic' : value(f, 'connectorOffset') + ' mm',
  clip: (f) => ({ 'draw-key': 'Dovetail', 'side-screw': 'Kevan Sideclip' })[value(f, 'clipType')] ?? 'Carrera',
  tab: (f) => size(f, 'tabWidth', 'tabLength'),
  trackside: (f) => value(f, 'tracksideRise') + ' mm above the road',
  tracksideInner: (f) => value(f, 'tracksideRiseInner') + ' mm above the road',
  fence: (f) =>
    f.elements.tracksideFence?.checked ? value(f, 'tracksideFenceHeight') + ' mm high' : 'Off',
  fenceInner: (f) =>
    f.elements.tracksideFenceInner?.checked ? value(f, 'tracksideFenceHeightInner') + ' mm high' : 'Off',
};

export function syncPropertyReadouts(form) {
  if (!form) return;
  for (const output of form.querySelectorAll('[data-property-readout]')) {
    const text = readouts[output.dataset.propertyReadout](form);
    if (output.textContent !== text) output.textContent = text;
  }
}

function disclosureKey(section) {
  const summary = section.querySelector(':scope > summary');
  return summary?.querySelector(':scope > span')?.textContent ?? summary?.textContent;
}

// Keep the user's place when a change of shape, tool option, or selection
// rebuilds this form. A different tool starts with its own default sections.
export function replacePropertyPanel(panel, key, html) {
  const sameTool = panel.dataset.view === key;
  const previous = new Map();
  const y = panel.querySelector('.property-scroll')?.scrollTop ?? 0;
  if (sameTool) {
    for (const section of panel.querySelectorAll('details')) {
      previous.set(disclosureKey(section), section.open);
    }
  }
  panel.dataset.view = key;
  panel.innerHTML = html;
  for (const section of panel.querySelectorAll('details')) {
    const label = disclosureKey(section);
    if (previous.has(label)) section.open = previous.get(label);
  }
  const scroller = panel.querySelector('.property-scroll');
  if (sameTool && scroller) scroller.scrollTop = y;
  if (!sameTool) panel.parentElement.scrollTop = 0;
}
