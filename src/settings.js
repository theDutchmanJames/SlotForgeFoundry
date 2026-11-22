// App settings kept on this device: printer (print plate for new
// projects and layouts), filament for weight estimates, and spare braid.
import { esc, fmt } from './ui.js';
import { COLORS, THEMES, paletteOf, problems, themeName } from './app-theme.js';

export const PRINTERS = [
  { id: 'prusa-mk4', name: 'Prusa MK4 / MK4S', width: 250, depth: 210 },
  { id: 'prusa-core-one', name: 'Prusa CORE One', width: 250, depth: 220 },
  { id: 'prusa-mini', name: 'Prusa MINI+', width: 180, depth: 180 },
  { id: 'bambu-a1', name: 'Bambu Lab A1', width: 256, depth: 256 },
  { id: 'bambu-a1-mini', name: 'Bambu Lab A1 mini', width: 180, depth: 180 },
  { id: 'bambu-x1-p1', name: 'Bambu Lab X1 / P1 series', width: 256, depth: 256 },
  { id: 'creality-k1', name: 'Creality K1 / K1C', width: 220, depth: 220 },
  { id: 'creality-k1-max', name: 'Creality K1 Max', width: 300, depth: 300 },
  { id: 'creality-ender-3', name: 'Creality Ender 3 (V2 / V3 SE)', width: 220, depth: 220 },
  { id: 'voron-350', name: 'Voron 2.4 · 350', width: 350, depth: 350 },
];
export const MATERIALS = [
  { id: 'pla', name: 'PLA', density: 1.24 },
  { id: 'petg', name: 'PETG', density: 1.27 },
  { id: 'abs', name: 'ABS / ASA', density: 1.05 },
  { id: 'tpu', name: 'TPU', density: 1.21 },
];
const KEY = 'foundry.settings';
export const DEFAULT_SETTINGS = {
  printer: 'custom',
  plate: { width: 200, depth: 200, margin: 0 },
  material: 'pla',
  infill: 100,
  spoolPrice: 0,
  braidSpare: 50,
};
// An empty field is not zero: it falls back like any other unreadable value.
const number = (v, min, max, fallback) =>
  v !== '' && v !== null && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max
    ? Number(v)
    : fallback;

// Anything unreadable falls back field by field: to the previous settings when
// editing them, otherwise to the defaults.
export function cleanSettings(raw, previous = DEFAULT_SETTINGS) {
  const d = previous,
    r = raw && typeof raw === 'object' ? raw : {},
    p = r.plate && typeof r.plate === 'object' ? r.plate : {};
  const plate = {
    width: number(p.width, 10, 5000, d.plate.width),
    depth: number(p.depth, 10, 5000, d.plate.depth),
    margin: number(p.margin, 0, 100, d.plate.margin),
  };
  if (2 * plate.margin >= Math.min(plate.width, plate.depth)) plate.margin = 0;
  return {
    printer: PRINTERS.some((x) => x.id === r.printer) ? r.printer : 'custom',
    plate,
    material: MATERIALS.some((m) => m.id === r.material) ? r.material : d.material,
    infill: number(r.infill, 5, 100, d.infill),
    spoolPrice: number(r.spoolPrice, 0, 1000, d.spoolPrice),
    braidSpare: number(r.braidSpare, 0, 2000, d.braidSpare),
  };
}
export function loadSettings() {
  try {
    return cleanSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return cleanSettings(null);
  }
}
export function saveSettings(settings) {
  const clean = cleanSettings(settings);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Private windows may refuse storage; the settings still apply until reload.
  }
  return clean;
}

function row(label, control, note = '') {
  return `<label class="st-row"><span>${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</span>${control}</label>`;
}
const input = (name, value, min, max, step = 1) =>
  `<input type="number" name="${name}" value="${esc(String(value))}" min="${min}" max="${max}" step="${step}">`;

export function renderSettings(s, themeState) {
  const printer = PRINTERS.find((x) => x.id === s.printer);
  const options = [
    ...PRINTERS.map(
      (x) =>
        `<option value="${x.id}"${x.id === s.printer ? ' selected' : ''}>${esc(x.name)} · ${fmt(x.width)} × ${fmt(x.depth)} mm</option>`,
    ),
    `<option value="custom"${printer ? '' : ' selected'}>Custom plate</option>`,
  ].join('');
  return `<div class="st">
  <div class="st-head"><div class="sf-eyebrow">On this device</div><h1>Settings</h1></div>
  <form id="app-settings-form" class="st-groups" autocomplete="off">
    ${lookSection(themeState)}
    <section class="st-group">
      <h2>Printer</h2>
      <p class="st-note">New projects start with this print plate, and the Track Planner takes it from there. Open projects keep their own plate.</p>
      ${row('Printer', `<select name="printer">${options}</select>`)}
      ${row('Plate width · mm', input('width', s.plate.width, 10, 5000))}
      ${row('Plate depth · mm', input('depth', s.plate.depth, 10, 5000))}
      ${row('Margin per edge · mm', input('margin', s.plate.margin, 0, 100, 0.5), 'Keeps parts clear of clips and the plate edge')}
      <button type="button" class="sf-btn sm" data-action="settings-plate-to-project">Use this plate in the open project</button>
    </section>
    <section class="st-group">
      <h2>Shopping list</h2>
      <p class="st-note">The Track Planner print kit includes a shopping list with these estimates.</p>
      ${row('Filament', `<select name="material">${MATERIALS.map((m) => `<option value="${m.id}"${m.id === s.material ? ' selected' : ''}>${esc(m.name)} · ${m.density} g/cm³</option>`).join('')}</select>`)}
      ${row('Fill · %', input('infill', s.infill, 5, 100), 'Share of each part that is plastic; 100 % gives the solid upper bound')}
      ${row('Spool price per kg', input('spoolPrice', s.spoolPrice, 0, 1000, 0.01), 'Leave 0 to skip the cost line')}
      ${row('Spare braid per lane · mm', input('braidSpare', s.braidSpare, 0, 2000), 'Extra for the lead-in at the power base')}
    </section>
    <section class="st-group" data-unopened hidden>
      <h2>Recovery</h2>
      <p class="st-note">Your last project could not be reopened. Its copy is kept here; download it to keep it as a file or open it again later.</p>
      <button type="button" class="sf-btn sm" data-action="download-unopened">Download the last project</button>
    </section>
  </form>
</div>`;
}

// Reads the form; choosing a printer fills the plate, editing the plate makes it custom.
export function readSettingsForm(form, previous, changed) {
  const v = (n) => form.elements[n]?.value;
  const next = {
    printer: v('printer'),
    plate: { width: v('width'), depth: v('depth'), margin: v('margin') },
    material: v('material'),
    infill: v('infill'),
    spoolPrice: v('spoolPrice'),
    braidSpare: v('braidSpare'),
  };
  const preset = PRINTERS.find((x) => x.id === next.printer);
  if (changed === 'printer' && preset) {
    // A printer sets the plate size; the margin stays as chosen.
    next.plate.width = preset.width;
    next.plate.depth = preset.depth;
  } else if (['width', 'depth'].includes(changed)) next.printer = 'custom';
  return cleanSettings({ ...previous, ...next }, cleanSettings(previous));
}

// Look: the SlotForge app themes, as in Circuit. Each tile shows its own
// colours; Custom shows yours, edited below.
function lookSection(state) {
  const tiles = THEMES.map(
    ([id, name]) =>
      `<button type="button" class="theme-pick" data-pick-theme="${id}"${id === 'custom' ? '' : ` data-theme="${id}"`} aria-pressed="${id === state.theme}"><span class="theme-swatches" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="theme-pick-label">${esc(name)}</span></button>`,
  ).join('');
  const inputs = COLORS.map(
    ([key, name, where]) =>
      `<label class="theme-color-row"><input type="color" data-theme-color="${key}" aria-label="${esc(name)} colour"><span><strong>${esc(name)}</strong><small>${esc(where)}</small><output class="theme-hex" data-theme-hex="${key}"></output></span></label>`,
  ).join('');
  const sources = THEMES.filter(([id]) => id !== 'custom')
    .map(([id, name]) => `<option value="${id}">${esc(name)}</option>`)
    .join('');
  return `<section class="st-group" data-look>
      <div class="st-look-head"><h2>Look</h2><span class="st-note">Current: <b data-theme-current>${esc(themeName(state.theme))}</b></span></div>
      <p class="st-note">The same themes as the other SlotForge apps. Track parts keep their print colours.</p>
      <div class="theme-presets" role="group" aria-label="App theme presets">${tiles}</div>
      <details class="theme-custom"${state.theme === 'custom' ? ' open' : ''}>
        <summary>Your own colours</summary>
        <p class="st-note">Change any colour to switch to Custom. Your colours stay available when you try other themes.</p>
        <div class="theme-copy-row"><select data-theme-from aria-label="Theme to copy">${sources}</select><button type="button" class="sf-btn sm" data-theme-copy>Start from this theme</button></div>
        <div class="theme-colors">${inputs}</div>
        <p class="theme-contrast" data-theme-contrast role="status" hidden></p>
      </details>
    </section>`;
}

// Brings the Look section in step with the theme: the Custom tile and the
// colour fields show your colours, and a warning for hard-to-read ones.
export function syncThemeSettings(host, state) {
  const look = host?.querySelector('[data-look]');
  if (!look) return;
  const own = paletteOf(state, 'custom');
  const custom = state.customColors ?? paletteOf(state, state.theme === 'custom' ? 'dark' : state.theme);
  const tile = look.querySelector('[data-pick-theme="custom"]');
  for (const [key] of COLORS) tile.style.setProperty('--' + key, state.customColors ? own[key] : custom[key]);
  for (const b of look.querySelectorAll('[data-pick-theme]'))
    b.setAttribute('aria-pressed', String(b.dataset.pickTheme === state.theme));
  look.querySelector('[data-theme-current]').textContent = themeName(state.theme);
  for (const input of look.querySelectorAll('[data-theme-color]')) {
    const value = custom[input.dataset.themeColor];
    if (document.activeElement !== input) input.value = value;
    look.querySelector(`[data-theme-hex="${input.dataset.themeColor}"]`).textContent = value;
  }
  const from = look.querySelector('[data-theme-from]');
  if (document.activeElement !== from) from.value = state.theme === 'custom' ? 'dark' : state.theme;
  const warnings = state.theme === 'custom' ? problems(custom) : [];
  const box = look.querySelector('[data-theme-contrast]');
  box.textContent = warnings.join(' ');
  box.hidden = !warnings.length;
}
