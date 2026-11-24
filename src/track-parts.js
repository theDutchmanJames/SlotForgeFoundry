import { esc, icon } from './ui.js';

const families = {
  road: 'Road sections',
  border: 'Borders',
  clip: 'Clips',
  retainer: 'Quarter-turn keepers',
  support: 'Bridge supports',
  barrier: 'Barriers',
  fence: 'Fences',
  turnout: 'Pit turnout blades',
  turnoutArm: 'Pit actuator cranks',
  turnoutBearing: 'Pit pivot bearings',
  turnoutInsert: 'Turnout inserts',
  motorMount: 'Motor mounts',
  other: 'Other parts',
};

const clipNames = {
  'carrera-retained': 'Carrera clips',
  'draw-key': 'Dovetail keys',
  'side-screw': 'Kevan Sideclips',
};

const eyes = { shown: icon('eye'), hidden: icon('eyeoff') };
const chevron = icon('down');

export function groupTrackParts(parts) {
  const byRole = new Map();
  for (const part of parts) {
    const role = Object.hasOwn(families, part.role) ? part.role : 'other';
    const hardware = role === 'clip' || role === 'retainer';
    if (!byRole.has(role)) byRole.set(role, new Map());
    const familiesForRole = byRole.get(role);
    const key = hardware ? part.fabricationKey || part.clipType || role : role;
    if (!familiesForRole.has(key)) {
      const label = role === 'clip' ? clipNames[part.clipType] : undefined;
      familiesForRole.set(key, {
        role,
        key,
        label: label || families[role],
        parts: [],
      });
    }
    familiesForRole.get(key).parts.push(part);
  }

  return Object.keys(families).flatMap((role) => {
    const variants = [...(byRole.get(role)?.values() ?? [])];
    return variants.map((group, index) => {
      const duplicateLabel = variants.some(
        (other) => other !== group && other.label === group.label,
      );
      const height =
        duplicateLabel && /^double-dovetail\/v2\/([\d.]+)$/.exec(group.key);
      return {
        ...group,
        id:
          variants.length === 1
            ? role
            : role + '-' + encodeURIComponent(group.key),
        label: duplicateLabel
          ? group.label +
            ' · ' +
            (height ? height[1] + ' mm' : 'Type ' + (index + 1))
          : group.label,
      };
    });
  });
}

export function groupVisibility(group, hidden) {
  const shown = group.parts.reduce(
    (count, part) => count + Number(!hidden.has(part.id)),
    0,
  );
  if (shown === 0) return 'false';
  return shown === group.parts.length ? 'true' : 'mixed';
}

export function toggleGroupVisibility(group, hidden) {
  const hide = groupVisibility(group, hidden) === 'true';
  for (const part of group.parts) {
    if (hide) hidden.add(part.id);
    else hidden.delete(part.id);
  }
}

function memberRow(part, index, group, hidden, selected) {
  const foldedHardware =
    group.parts.length > 1 &&
    (group.role === 'clip' || group.role === 'retainer');
  const name = esc(foldedHardware ? part.name + ' ' + (index + 1) : part.name);
  const id = esc(part.id);
  const shown = !hidden.has(part.id);
  const visibilityAction = (shown ? 'Hide ' : 'Show ') + name;
  return `<li class="part-row${selected === part.id ? ' selected' : ''}" data-part-shown="${shown}">
    <button type="button" id="assembly-select-${id}" data-part="${id}" title="${name}" aria-current="${selected === part.id}">
      <strong>${name}</strong>
    </button>
    <button type="button" id="assembly-visible-${id}" class="icon-button" data-visible="${id}" aria-pressed="${shown}" aria-label="${visibilityAction}" title="${visibilityAction}">${shown ? eyes.shown : eyes.hidden}</button>
  </li>`;
}

export function trackPartsMarkup(groups, expanded, hidden, selected) {
  return groups
    .map((group) => {
      const id = esc(group.id);
      const label = esc(group.label);
      const count = group.parts.length;
      const open = expanded.has(group.id);
      const containsSelected = group.parts.some((part) => part.id === selected);
      const visibility = groupVisibility(group, hidden);
      const visibilityAction =
        (visibility === 'true' ? 'Hide all ' : 'Show all ') +
        label.toLowerCase();
      return `<div class="track-part-group" data-part-group="${id}" data-contains-selected="${containsSelected}">
      <div class="part-group-head">
        <button type="button" id="assembly-toggle-group-${id}" class="part-disclosure" data-toggle-part-group="${id}" aria-expanded="${open}" aria-controls="part-members-${id}" aria-label="${label}, ${count} ${count === 1 ? 'part' : 'parts'}">
          ${chevron}<i class="swatch ${group.role}" aria-hidden="true"></i><strong>${label}</strong><span class="part-quantity">×${count}</span>
        </button>
        <button type="button" id="assembly-visible-group-${id}" class="icon-button group-visibility" data-visible-group="${id}" aria-pressed="${visibility}" aria-label="${visibilityAction}" title="${visibilityAction}">${visibility === 'false' ? eyes.hidden : eyes.shown}</button>
      </div>
      <ul class="part-members" id="part-members-${id}" aria-label="${label}"${open ? '' : ' hidden'}>
        ${group.parts.map((part, index) => memberRow(part, index, group, hidden, selected)).join('')}
      </ul>
    </div>`;
    })
    .join('');
}
