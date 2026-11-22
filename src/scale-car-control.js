import { buildCarRoutes, carPose, nearestCarRoute } from './car-placement.js';
import { scaleCarDimensions } from './reference-car-mesh.js';
import { icon } from './ui.js';
import './scale-car.css';

export function mountScaleCar(view, container, onToggle) {
  const toggle = container.querySelector('[data-action="scale-car"]');
  const panel = document.createElement('section');
  panel.id = 'scale-car-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Scale car settings');
  panel.innerHTML = `
    <header><strong>GT reference car</strong><button type="button" data-car-close aria-label="Hide scale car">${icon('close')}</button></header>
    <div class="car-selectors">
      <label>Scale<select name="carScale">${[64, 43, 32, 24].map(n => `<option value="${n}"${n === 32 ? ' selected' : ''}>1:${n}</option>`).join('')}</select></label>
      <label>Lane<select name="carLane"></select></label>
    </div>
    <label class="car-position">Position <input name="carStation" type="range" min="0" max="100" step="1" value="50"><output data-car-station>50%</output></label>
    <div class="car-dimensions"><span aria-label="Length by width by height">L × W × H</span> <output data-car-size></output></div>
    <p data-car-hint role="status"></p>`;
  container.append(panel);
  const scale = panel.querySelector('[name="carScale"]');
  const lane = panel.querySelector('[name="carLane"]');
  const slider = panel.querySelector('[name="carStation"]');
  const stationLabel = panel.querySelector('[data-car-station]');
  const sizeLabel = panel.querySelector('[data-car-size]');
  const hint = panel.querySelector('[data-car-hint]');

  let routes = [], station = 0.5, track = null, parts = [], hiddenParts;
  let roadCount = 0, visibleRoads = 0, routesDirty = true;

  function draw() {
    const visible = visibleRoads > 0;
    const route = routes.find(r => r.id === lane.value);
    const pose = carPose(route, station);
    const onRoad = visible && pose && (visibleRoads === roadCount ||
      view.hasRoadBelow(pose.position, track.params.slotDepth));
    view.setReferenceCar(onRoad ? { ...pose, scale: Number(scale.value) } : null);
    const { length, width, height } = scaleCarDimensions(Number(scale.value));
    sizeLabel.textContent = [length, width, height].map(n => Number(n.toFixed(1))).join(' × ') + ' mm';
    slider.value = String(Math.round(station * 100));
    stationLabel.value = slider.value + '%';
    slider.setAttribute('aria-valuetext', stationLabel.value + ' along the lane');
    lane.disabled = slider.disabled = !route || !visible;
    const message = !visible ? 'Show a road section to place the car.'
      : !route ? 'This piece has no guide slot to follow.'
      : !onRoad ? 'This road section is hidden. Select another position.'
      : 'Click the road to place the guide in a slot.';
    if (hint.textContent !== message) hint.textContent = message;
  }
  function refresh() {
    if (panel.hidden) return;
    roadCount = visibleRoads = 0;
    for (const part of parts) {
      if (part.role !== 'road') continue;
      roadCount++;
      if (!hiddenParts.has(part.id)) visibleRoads++;
    }
    if (routesDirty) {
      const previous = lane.value;
      routes = buildCarRoutes(track, parts);
      lane.replaceChildren(...routes.map(r => new Option(r.label, r.id)));
      if (routes.some(r => r.id === previous)) lane.value = previous;
      routesDirty = false;
    }
    draw();
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    toggle.setAttribute('aria-pressed', 'false');
    view.setReferenceCar(null);
    onToggle();
  }
  panel.querySelector('[data-car-close]').onclick = () => {
    close();
    toggle.focus();
  };
  scale.onchange = lane.onchange = draw;
  slider.oninput = () => {
    station = slider.valueAsNumber / 100;
    draw();
  };
  return {
    get active() { return !panel.hidden; },
    close,
    open() {
      if (!track || toggle.disabled) return;
      view.sectionControls?.close();
      panel.hidden = false;
      toggle.setAttribute('aria-pressed', 'true');
      refresh();
      onToggle();
    },
    update(nextTrack, nextParts, hidden) {
      routesDirty ||= track !== nextTrack || parts !== nextParts;
      track = nextTrack;
      parts = nextParts;
      hiddenParts = hidden;
      toggle.hidden = !track;
      if (!track) { close(); return; }
      toggle.disabled = !parts.some(p => p.role === 'road');
      refresh();
    },
    place(part, point) {
      if (panel.hidden || part?.role !== 'road') return false;
      const at = nearestCarRoute(routes, point, part);
      if (at) {
        lane.value = at.id;
        station = at.t;
        draw();
      }
      return true;
    },
  };
}
