// The finish of a storey's, a section's or a footprint's walls in the
// editor: a texture of its own on any wall, and a band along their foot.
import { esc } from './ui.js';
import { WALL_TEXTURES, LOWER } from './geometry/building-texture.js';

const options = (list, value) => list.map(([id, name]) => `<option value="${esc(id)}"${id === value ? ' selected' : ''}>${esc(name)}</option>`).join('');

/**
 * The fields: `walls` are [{ id, name }]; `main` true adds the select for
 * the texture of all the walls (an ordinary storey has swatches for it).
 */
export function finishFields(prefix, f, walls, { main = false } = {}) {
  const lower = f.lowerTexture ?? 'none';
  return `${main ? `<label class="bd-row"><span>Walls</span><select name="${prefix}-wallTexture">${options(WALL_TEXTURES, f.wallTexture)}</select></label>` : ''}
    <div class="bd-sub">A wall of its own</div>
    ${walls.map((w) => `<label class="bd-row"><span>${esc(w.name)}</span><select name="${prefix}-wall-${esc(w.id)}">${options([['', 'Same as the walls'], ...WALL_TEXTURES], f.wallTextures?.[w.id] ?? '')}</select></label>`).join('')}
    <label class="bd-row"><span>Lower walls</span><select name="${prefix}-lowerTexture">${options([['none', 'No band'], ...WALL_TEXTURES], lower)}</select></label>
    <label class="bd-row" data-bd-lower${lower === 'none' ? ' hidden' : ''}><span>Band height</span><span class="bd-input"><input type="number" name="${prefix}-lowerHeight" value="${esc(String(f.lowerHeight ?? 20))}" min="${LOWER.least}" step="1"><small>mm</small></span></label>`;
}

/** Shows a finish in fields made by finishFields. */
export function fillFinish(form, prefix, f, walls) {
  const e = form.elements;
  if (e[prefix + '-wallTexture']) e[prefix + '-wallTexture'].value = f.wallTexture;
  for (const w of walls) if (e[prefix + '-wall-' + w.id]) e[prefix + '-wall-' + w.id].value = f.wallTextures?.[w.id] ?? '';
  e[prefix + '-lowerTexture'].value = f.lowerTexture ?? 'none';
  e[prefix + '-lowerHeight'].value = f.lowerHeight ?? 20;
  showBands(form);
}

/** The band's height shows while there is a band. */
export function showBands(root) {
  for (const select of root.querySelectorAll('select[name$="-lowerTexture"]')) {
    const band = select.closest('label').nextElementSibling;
    if (band?.hasAttribute('data-bd-lower')) band.hidden = select.value === 'none';
  }
}

/** Reads the fields; where a field is not there, the finish keeps what it had. */
export function readFinish(form, prefix, f, walls) {
  const e = form.elements;
  const wallTexture = e[prefix + '-wallTexture']?.value ?? f.wallTexture;
  const wallTextures = {};
  for (const w of walls) {
    const t = e[prefix + '-wall-' + w.id] ? e[prefix + '-wall-' + w.id].value : f.wallTextures?.[w.id] ?? '';
    if (t) wallTextures[w.id] = t;
  }
  const h = e[prefix + '-lowerHeight'];
  return {
    wallTexture,
    wallTextures,
    lowerTexture: e[prefix + '-lowerTexture']?.value ?? f.lowerTexture ?? 'none',
    lowerHeight: h ? (h.value === '' ? NaN : Number(h.value)) : f.lowerHeight ?? 20,
  };
}
