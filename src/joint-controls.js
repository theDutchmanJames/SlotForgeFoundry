import { button, choice, details, field } from './ui.js';
import { keeperToolAccess, lockRetainer, releaseRetainer } from './clip-instructions.js';
import { clipSpec } from './geometry/clip-types.js';
import { DRAW_KEY_ROOF } from './geometry/keeper-dimensions.js';
import {
  CLIP_TABLE_CLEARANCE,
  currentJointSettings,
  JOINT_FIT_LIMITS,
  TAB_SIZE_LIMITS,
  resolveJointFit,
} from './geometry/joint-fit.js';

const mm = (n) => n.toFixed(2);

export function clipChoices() {
  return [
    ['draw-key', 'Double-dovetail draw key + retainer'],
    ['carrera-retained', 'Carrera + two retainers'],
  ];
}


function keeperDrawing(spec, inserted = false) {
  if (!spec?.retained) return '';
  return spec.keeperOffsets.map((offset) =>
    `<g data-keeper-offset="${offset}" transform="translate(${offset} 0) rotate(${inserted ? 90 : 0})">
      <g fill="var(--d-hardware)" stroke="var(--d-hardware-edge)" stroke-width=".4"><rect x="-1.8" y="${-spec.retainerWidth / 2}" width="3.6" height="${spec.retainerWidth}" rx="1.8"/><circle r="3.2"/></g><path d="M-2.2 0h4.4" stroke="var(--d-hardware-edge)" stroke-width="1"/></g>`,
  ).join('');
}

function retainerSteps(spec, silhouette) {
  const scale = Math.min(2, 83 / spec.length);
  const twin = spec.keeperOffsets.length === 2;
  const stages = [
    ['Seat the main clip', 'Align the two underside pockets and press the main clip in.', ''],
    [twin ? 'Insert both retainers' : 'Insert the retainer', twin
      ? 'Place one in each track piece with the wings pointing along the fork.'
      : 'Place it over the centre of the key, with the wings pointing along the key.', keeperDrawing(spec, true)],
    ['Turn 90° to lock', lockRetainer, keeperDrawing(spec)],
  ];
  const rows = stages.map(([title, instruction, hardware], index) => {
    const keyFill = index ? 'var(--d-hardware)' : 'var(--d-track)';
    const turnArrow = index === 2
      ? '<path d="M61 5Q76 5 78 19m-4 -3 4 4 3 -5" fill="none" stroke="var(--d-focus)" stroke-width="1.8"/>'
      : '';
    return `<li><svg viewBox="0 0 96 46" aria-hidden="true">
      <rect x="1" y="1" width="94" height="44" rx="4" fill="var(--d-paper)"/>
      <path d="M48 1v44" stroke="var(--d-guide)" stroke-dasharray="3 2"/>
      <g transform="translate(48 23) scale(${scale})"><path d="${silhouette}" fill="${keyFill}" stroke="var(--d-hardware-edge)" stroke-width=".55"/>${hardware}</g>
      ${turnArrow}</svg><div><strong>${title}</strong><span>${instruction}</span></div></li>`;
  });
  return `<details class="retainer-help"><summary>Fit and release ${twin ? 'both retainers' : 'the retainer'}</summary><ol class="retainer-steps">${rows.join('')}</ol><p>${releaseRetainer}</p></details>`;
}

function drawKeySection(height, spec) {
  if (!(height >= spec.minimumHeight)) return '';
  const scale = 48 / height;
  const roof = DRAW_KEY_ROOF * scale;
  const key = spec.thickness * scale;
  const keyY = 55 - (spec.seatHeight + spec.thickness) * scale;
  return `<svg viewBox="0 0 264 64" role="img" aria-label="Dovetail side section. ${mm(spec.thickness)} mm key beneath a ${DRAW_KEY_ROOF} mm roof.">
    <path d="M12 7h118v48h-15V${7 + roof}H27V55H12Z" fill="var(--d-border)" stroke="var(--d-track-edge)"/>
    <path d="M71 7v${roof}" stroke="var(--d-track-edge)" stroke-dasharray="2 2"/>
    <rect x="28" y="${keyY}" width="86" height="${key}" fill="var(--d-hardware)" stroke="var(--d-hardware-edge)"/>
    <path d="M8 55h126" stroke="var(--d-guide)"/><g font-size="10" fill="currentColor">
    <text x="142" y="18">Roof · ${DRAW_KEY_ROOF} mm</text><text x="142" y="38">Key · ${mm(spec.thickness)} mm</text></g></svg>`;
}

export function jointsClipDiagram(params) {
  params = currentJointSettings(params);
  const fit = resolveJointFit(params),
    spec = clipSpec(params);
  const carrera = spec.type === 'carrera-retained';
  const silhouettes = {
    carrera: 'M-30 -5.9L-20 -7.4V-5.9H20V-7.4L30 -5.9V-3L20 -2H9.2A3 3 0 1 0 9.2 2H20L30 3V5.9L20 7.4V5.9H-20V7.4L-30 5.9V3L-20 2H-9.2A3 3 0 1 0 -9.2 -2H-20L-30 -3Z',
    'draw-key': 'M-13 -3.9L-11.9 -5H-7.45L-6.8 -4.75L-4.6 -2.15H4.6L6.8 -4.75L7.45 -5H11.9L13 -3.9V3.9L11.9 5H7.45L6.8 4.75L4.6 2.15H-4.6L-6.8 4.75L-7.45 5H-11.9L-13 3.9Z',
  };
  const silhouette = silhouettes[carrera ? 'carrera' : 'draw-key'];
  const keeper = keeperDrawing(spec);
  const caption = (spec.keeperOffsets.length === 2
      ? `Two keepers lock the fork, one ${Math.abs(spec.keeperOffsets[0])} mm from the seam in each piece.`
      : 'One keeper locks the key at the seam.') +
      ` Wing thickness ${spec.retainerThickness} mm. Table clearance ${mm(CLIP_TABLE_CLEARANCE)} mm.`;
  return `<figure class="joint-fit-diagram" data-clip-diagram>
    <svg viewBox="0 0 264 62" role="img" aria-label="${spec.name} viewed from below">
    <path d="M132 2V60" stroke="var(--d-guide)" stroke-dasharray="3 3"/>
    <g transform="translate(132 31) scale(3.1)"><path d="${silhouette}" fill="var(--d-hardware)" stroke="var(--d-hardware-edge)" stroke-width=".5"/>${keeper}</g></svg>
    <figcaption>${spec.name} · ${spec.length} × ${spec.width} × ${spec.thickness} mm. ${caption}</figcaption>
    <dl><dt>Clip width → seat</dt><dd>${mm(fit.clipWidth)} → ${mm(fit.clipSocketWidth)} mm</dd></dl>
    ${carrera ? '' : drawKeySection(params.height, spec)}
    ${retainerSteps(spec, silhouette)}
    ${carrera ? '<small>Main clip design · <a href="https://www.printables.com/model/1163344-carrera-slotcar-track-connector-clip" target="_blank" rel="noreferrer">URSUS</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a></small>' : ''}
    </figure>`;
}

export function jointFitDiagram(params) {
  const f = resolveJointFit(params);
  const scale = Math.min(5.5, 64 / f.tabSocketDepth, 50 / f.tabSocketWidth);
  const length = f.tabLength * scale,
    half = (f.tabWidth * scale) / 2;
  const gap = f.tabClearance * scale;
  const outline = (l, h) =>
    `h${l * 0.75}l${l * 0.25} ${h * 0.27}v${h * 1.46}l${-l * 0.25} ${h * 0.27}h${-l * 0.75}`;
  return `<figure class="joint-fit-diagram" data-joint-fit>
    <svg viewBox="0 0 264 76" role="img" aria-label="Top view of the tab and its matching socket">
    <path d="M7 5H68V${38 - half}${outline(length, half)}V71H7Z" fill="var(--d-hardware)" stroke="var(--d-hardware-edge)"/>
    <path d="M166 5H257V71H166V${38 + half + gap}h${length * 0.75}l${length * 0.25 + gap} ${-(half + gap) * 0.27}v${-(half + gap) * 1.46}l${-length * 0.25 - gap} ${-(half + gap) * 0.27}H166Z" fill="var(--d-border)" stroke="var(--d-track-edge)"/>
    <path d="M137 38h19m-5 -4 5 4-5 4" fill="none" stroke="var(--d-focus)" stroke-width="2"/></svg>
    <dl><dt>Width → socket</dt><dd>${mm(f.tabWidth)} → ${mm(f.tabSocketWidth)} mm</dd>
    <dt>Projection → depth</dt><dd>${mm(f.tabLength)} → ${mm(f.tabSocketDepth)} mm</dd>
    <dt>Thickness → height</dt><dd>${mm(f.tabThickness)} → ${mm(f.tabSocketHeight)} mm</dd></dl></figure>`;
}

export function jointFitControls(p) {
  const base = currentJointSettings(p);
  const startingFit = resolveJointFit(base);
  const baseType = base.clipType;
  const versionField = '<input type="hidden" name="jointFitVersion" value="2">';
  const options = clipChoices();
  return (
    versionField +
    details(
      'Project clip type',
      choice('clipType', 'Clip type', baseType, options) +
        '<p class="hint">Applies to every clip on roads and borders.</p>' +
        jointsClipDiagram(base) +
        button('export-keeper-tool', 'Download keeper tool STL', 'export', 'secondary full') +
        '<p class="hint">' + keeperToolAccess + '</p>' +
        field(
          'clipClearance',
          'Clip gap per side',
          startingFit.clipClearance,
          'mm',
          { min: JOINT_FIT_LIMITS.clip[0], max: JOINT_FIT_LIMITS.clip[1] },
        ),
      true, 'clip',
    ) +
    details(
      'Tab and socket',
      jointFitDiagram(base) +
        field('tabWidth', 'Width', startingFit.tabWidth, 'mm', {
          min: TAB_SIZE_LIMITS.width[0],
          max: TAB_SIZE_LIMITS.width[1],
        }) +
        field(
          'tabLength',
          'Projection from seam',
          startingFit.tabLength,
          'mm',
          { min: TAB_SIZE_LIMITS.length[0], max: TAB_SIZE_LIMITS.length[1] },
        ) +
        field('tabThickness', 'Thickness', p.tabThickness ?? '', 'mm', {
          optional: true,
          placeholder: 'Auto',
          min: TAB_SIZE_LIMITS.thickness[0],
          max: TAB_SIZE_LIMITS.thickness[1],
        }) +
        field(
          'tabClearance',
          'Tab gap per side',
          startingFit.tabClearance,
          'mm',
          { min: JOINT_FIT_LIMITS.tab[0], max: JOINT_FIT_LIMITS.tab[1] },
        ) +
        '<p class="hint">Leave thickness empty to follow track height. The socket includes the gap on both sides and at the tip.</p>',
      false, 'tab',
    )
  );
}
