import { choice, details, field } from './ui.js';
import {
  ROAD_TEXTURES,
  TEXTURE_CHOICES,
  TEXTURE_FITS,
  TEXTURE_LIMITS,
  TEXTURE_SIZES,
  textureSettings,
  textureStoneSize,
} from './geometry/road-texture.js';

const group = (name, shown, body) =>
  '<fieldset class="border-apex-fields" ' + name + (shown ? '>' : ' hidden disabled>') + body + '</fieldset>';
const limits = (key) => ({ min: TEXTURE_LIMITS[key][0], max: TEXTURE_LIMITS[key][1] });

/** The road surface texture of a plain straight or corner, under Markings. */
export function textureFolder(p) {
  const s = textureSettings(p),
    on = s.roadTexture !== 'none';
  return details(
    'Road surface texture',
    choice('roadTexture', 'Texture', s.roadTexture, TEXTURE_CHOICES) +
      group(
        'data-texture-fields',
        on,
        choice('textureSize', 'Stone size', s.textureSize, TEXTURE_SIZES) +
          group(
            'data-texture-custom',
            s.textureSize === 'custom',
            field('textureScale', 'Size of the drawn pattern', s.textureScale, '%', limits('textureScale')),
          ) +
          '<p class="hint" data-texture-size>' + (on ? sizeHint(p) : '') + '</p>' +
          field('textureJoint', 'Joint width', s.textureJoint, 'mm', { ...limits('textureJoint'), step: 0.05 }) +
          field('textureDepth', 'Joint depth', s.textureDepth, 'mm', { ...limits('textureDepth'), step: 0.05 }) +
          choice('textureFit', 'Along the piece', s.textureFit, TEXTURE_FITS) +
          '<p class="hint">The joints between the stones are cut into the road surface. They keep clear of the guide slots, the braid and painted lines, and the road stays plain over a connector pocket. The joint keeps the width set here whatever the stone size.</p>' +
          '<p class="hint">Same size everywhere lays the stones at exactly this size; the pattern starts again at each track joint. Fit to each piece stretches it a little so that a whole number of repeats fits the piece, and its joints line up with the next piece.</p>',
      ),
    on,
  );
}

/** What the chosen size means on the road. */
export function sizeHint(p) {
  const texture = ROAD_TEXTURES[textureSettings(p).roadTexture];
  if (!texture) return '';
  const stone = textureStoneSize(p);
  if (!Number.isFinite(stone)) return '';
  const tidy = (value) => String(Number(value.toFixed(1)));
  return (
    'Stones about ' + tidy(stone) + ' mm across. The pattern repeats every ' +
    tidy((texture.size * stone) / texture.stone) + ' mm.' +
    (stone < 3 ? ' Stones this small make a large file and take longer to build.' : '')
  );
}

export function syncTextureControls(form) {
  const e = form.elements;
  if (!e.roadTexture) return;
  const on = e.roadTexture.value !== 'none';
  const fields = form.querySelector('[data-texture-fields]'),
    custom = form.querySelector('[data-texture-custom]');
  fields.hidden = fields.disabled = !on;
  custom.hidden = custom.disabled = !on || e.textureSize.value !== 'custom';
  const hint = form.querySelector('[data-texture-size]');
  if (hint)
    hint.textContent = on
      ? sizeHint({
          roadTexture: e.roadTexture.value,
          textureSize: e.textureSize.value,
          textureScale: e.textureScale.valueAsNumber,
        })
      : '';
}
