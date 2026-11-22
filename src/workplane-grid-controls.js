import './workplane-grid.css';
import {
  defaultSketchGrid,
  exactGridPitch,
  resolveSketchGrid,
} from './sketch-grid.js';
import { icon } from './ui.js';

export function mountGridControls(toolbar, container, onChange) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'workplane-grid-toggle';
  button.innerHTML = icon('plate') + ' Grid';
  button.setAttribute('aria-controls', 'workplane-grid');
  toolbar.append(button);
  const panel = document.createElement('section');
  panel.id = 'workplane-grid';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Face grid settings');
  panel.innerHTML =
    '<div class="workplane-grid-head"><b>Face grid</b><button type="button" aria-label="Close grid settings">×</button></div>' +
    '<p data-grid-message></p><div data-grid-settings>' +
    '<label>Show grid <input type="checkbox" data-grid-visible></label>' +
    '<div data-grid-fresh><label>Square size (mm) <input type="number" min="0.001" step="any" data-grid-size></label>' +
    '<label>Grid zero <select data-grid-placement><option value="balanced">Equal edge margins</option><option value="corner">Lower-left corner</option><option value="workplane">Workplane origin</option></select></label>' +
    '<div class="workplane-grid-buttons"><button type="button" data-grid-auto>Automatic</button><button type="button" data-grid-exact>Exact fit</button></div></div>' +
    '<button type="button" class="outline" data-grid-edit data-action="sketch-on-grid"></button></div>';
  container.append(panel);
  const find = (selector) => panel.querySelector(selector);
  let surface, saved, inEditor;
  function open(value) {
    panel.hidden = !value;
    button.setAttribute('aria-expanded', String(value));
    if (value) render();
  }
  function render() {
    button.hidden = !inEditor;
    if (!inEditor) open(false);
    button.title = 'Face grid settings';
    find('[data-grid-message]').textContent = !surface
      ? 'Select a flat face or a sketch to use its grid.'
      : saved
        ? surface.resolved.pitch + ' mm squares · ' + saved.name
        : '';
    find('[data-grid-message]').hidden = !!surface && !saved;
    find('[data-grid-settings]').hidden = !surface;
    if (!surface) return;
    find('[data-grid-visible]').checked = surface.config.visible;
    find('[data-grid-fresh]').hidden = !!saved;
    if (!saved) {
      find('[data-grid-size]').value = surface.config.pitch;
      find('[data-grid-placement]').value = surface.config.placement;
      find('[data-grid-exact]').disabled = !exactGridPitch(
        surface.loops,
        surface.config.angle,
      );
    }
    find('[data-grid-edit]').textContent = saved
      ? 'Edit sketch grid'
      : 'Sketch on this grid';
  }
  function change(patch) {
    if (!surface) return;
    surface.config = { ...surface.config, ...patch };
    surface.resolved = resolveSketchGrid(surface.config, surface.loops);
    render();
    onChange();
  }
  button.onclick = () => open(panel.hidden);
  find('[aria-label="Close grid settings"]').onclick = () => {
    open(false);
    button.focus();
  };
  panel.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      open(false);
      button.focus();
    }
  };
  document.addEventListener('pointerdown', (e) => {
    if (
      !panel.hidden &&
      !panel.contains(e.target) &&
      !button.contains(e.target)
    )
      open(false);
  });
  find('[data-grid-visible]').onchange = (e) =>
    change({ visible: e.target.checked });
  find('[data-grid-size]').oninput = (e) => {
    const pitch = e.target.valueAsNumber;
    if (e.target.validity.valid && Number.isFinite(pitch) && pitch >= 0.001) {
      const field = e.target,
        typed = field.value;
      change({ pitch });
      field.value = typed;
    }
  };
  find('[data-grid-size]').onblur = () => {
    if (surface) find('[data-grid-size]').value = surface.config.pitch;
  };
  find('[data-grid-placement]').onchange = (e) =>
    change({ placement: e.target.value });
  find('[data-grid-auto]').onclick = () =>
    change(defaultSketchGrid(surface.loops));
  find('[data-grid-exact]').onclick = () => {
    const pitch = exactGridPitch(surface.loops, surface.config.angle);
    if (pitch) change({ pitch, placement: 'corner' });
  };
  find('[data-grid-edit]').onclick = () => open(false);
  open(false);
  return (next, record, editor) => {
    if (surface === next && saved === record && inEditor === editor) return;
    surface = next;
    saved = record;
    inEditor = editor;
    render();
  };
}
