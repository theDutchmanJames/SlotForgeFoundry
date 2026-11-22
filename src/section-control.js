import './section-view.css';
import { icon } from './ui.js';
let nextSection = 0;

// Rendering is coalesced. Meshes cross the worker boundary once per source,
// while dragging the section plane sends only its axis, offset and direction.
export function mountSectionView(view, call, toolbar, container, onOpen) {
  const key = 'view-' + ++nextSection;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'icon-button section-toggle';
  toggle.title = 'Section view';
  toggle.setAttribute('aria-label', 'Section view');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.innerHTML = icon('section');
  toolbar.append(toggle);
  const panel = document.createElement('div');
  panel.className = 'section-controls';
  panel.hidden = true;
  panel.innerHTML =
    '<strong>Section view</strong><button type="button" data-close aria-label="Close section view">×</button>' +
    '<label>Plane <select aria-label="Section axis"><option value="0">X</option><option value="1">Y</option><option value="2">Z</option></select></label>' +
    '<label>Position <input aria-label="Section position in millimetres" type="number" step="any"> mm</label>' +
    '<input aria-label="Slide section plane" type="range" min="0" max="1000" step="1">' +
    '<label><input type="checkbox"> Flip side</label><output aria-live="polite"></output>';
  container.append(panel);
  const axis = panel.querySelector('select'),
    distance = panel.querySelector('[type=number]'),
    slider = panel.querySelector('[type=range]'),
    flip = panel.querySelector('[type=checkbox]'),
    status = panel.querySelector('output');
  let active = false,
    working = false,
    revision = 0,
    uploaded = null,
    scheduled = 0,
    request = 0;
  let parts = view.sourceParts ?? [];
  let hidden = new Set();
  let low = 0,
    high = 0,
    position = 0;
  function range(center = false) {
    const dim = Number(axis.value);
    low = Infinity;
    high = -Infinity;
    for (const p of parts) {
      if (view.hidden?.has(p.id)) continue;
      low = Math.min(low, p.bounds.min[dim]);
      high = Math.max(high, p.bounds.max[dim]);
    }
    const hasVisiblePart = Number.isFinite(low);
    distance.disabled = slider.disabled = flip.disabled = !hasVisiblePart;
    if (!hasVisiblePart) {
      distance.value = '';
      slider.value = '0';
      return;
    }
    position = center
      ? (low + high) / 2
      : Math.max(low, Math.min(high, position));
    distance.min = String(low);
    distance.max = String(high);
    distance.value = String(Number(position.toPrecision(9)));
    slider.value =
      high === low ? '0' : String(((position - low) * 1000) / (high - low));
  }
  function queue() {
    request++;
    if (!active) return;
    panel.dataset.state = 'updating';
    status.textContent = 'Updating…';
    if (!working && !scheduled) scheduled = requestAnimationFrame(render);
  }
  async function render() {
    scheduled = 0;
    if (!active || working) return;
    working = true;
    const task = request;
    const generation = revision;
    const plane = { axis: Number(axis.value), position, high: flip.checked };
    try {
      const send = (include) =>
        call('sectionView', {
          key,
          plane,
          parts: include
            ? parts
                .filter((part) => !hidden.has(part.id))
                .map(({ id, positions, indices, bounds }) => ({
                  id,
                  positions,
                  indices,
                  bounds,
                }))
            : undefined,
        });
      let result = await send(uploaded !== generation);
      if (!result && active && task === request) result = await send(true);
      if (active && generation === revision && result) uploaded = generation;
      if (active && task === request && result) {
        view.showSection(result, plane);
        panel.dataset.state = 'ready';
        status.textContent = result.length
          ? 'View only'
          : 'Show a part to inspect it';
      }
    } catch (error) {
      if (active && task === request) {
        view.clearSection();
        panel.dataset.state = 'error';
        status.textContent = error.message;
      }
    } finally {
      working = false;
      if (active && task !== request) queue();
    }
  }
  function close() {
    if (!active) return;
    active = false;
    request++;
    uploaded = null;
    if (scheduled) cancelAnimationFrame(scheduled);
    scheduled = 0;
    panel.hidden = true;
    toggle.setAttribute('aria-pressed', 'false');
    view.clearSection();
    call('closeSection', key).catch(() => {});
  }
  toggle.onclick = () => {
    if (active) {
      close();
      return;
    }
    onOpen?.();
    active = true;
    hidden = new Set(view.hidden);
    range(true);
    panel.hidden = false;
    toggle.setAttribute('aria-pressed', 'true');
    queue();
  };
  panel.querySelector('[data-close]').onclick = () => {
    close();
    toggle.focus();
  };
  axis.onchange = () => {
    range(true);
    queue();
  };
  slider.oninput = () => {
    position = low + ((high - low) * Number(slider.value)) / 1000;
    range();
    queue();
  };
  distance.oninput = () => {
    const n = distance.valueAsNumber;
    if (!Number.isFinite(n) || !distance.validity.valid) return;
    position = n;
    slider.value = String(
      high === low ? 0 : ((position - low) * 1000) / (high - low),
    );
    queue();
  };
  flip.onchange = queue;
  function visibilityChanged(next) {
    return next.size !== hidden.size || [...next].some((id) => !hidden.has(id));
  }
  view.onPartsChanged = (next) => {
    if (parts !== next || (active && visibilityChanged(view.hidden))) {
      parts = next;
      revision++;
    }
    if (active) {
      hidden = new Set(view.hidden);
      range();
      queue();
    }
  };
  view.onVisibilityChanged = (next) => {
    if (!active || !visibilityChanged(next)) return;
    hidden = new Set(next);
    revision++;
    range();
    queue();
  };
  const control = {
    close,
    dispose() {
      close();
      view.onPartsChanged = null;
      view.onVisibilityChanged = null;
      toggle.remove();
      panel.remove();
    },
  };
  view.sectionControls = control;
  return control;
}
