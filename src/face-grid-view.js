import * as THREE from 'three';
import { gridDisplayStride, gridSegments, gridToPlane } from './sketch-grid.js';
import { worldPoint } from './design.js';

// Construction lines are shared by both renderers, outside the parts used
// for picking, camera fitting, saving and STL export.
export class FaceGridView {
  constructor(stage) {
    this.stage = stage;
    this.material = new THREE.LineBasicMaterial({
      color: 0x9aa3ad,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    const gridDepthBias = { value: 0 };
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.gridDepthBias = gridDepthBias;
      shader.vertexShader =
        'uniform float gridDepthBias;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\ngl_Position.z -= gridDepthBias * gl_Position.w;',
      );
    };
    this.object = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      this.material,
    );
    const depthBits = Math.min(stage.depthBits || 24, 24);
    this.object.onBeforeRender = (_renderer, _scene, camera) => {
      // Cover depth-buffer quantization and eye-space Float32 roundoff. A
      // constant offset would show the grid through other close-fitting parts.
      gridDepthBias.value = Math.max(
        2 ** (2 - depthBits),
        (2 ** -21 * camera.far) / (camera.far - camera.near),
      );
    };
    this.object.renderOrder = 5;
    this.object.visible = false;
    if (stage.renderer) stage.scene.add(this.object);
  }
  set(surface, grid) {
    if (this.surface === surface && this.grid === grid) return;
    this.surface = surface;
    this.grid = grid;
    this.cacheKey = null;
    this.stage.draw();
  }
  update() {
    const { stage, surface, grid } = this;
    this.object.visible = false;
    if (!surface || !grid?.visible || !grid.bounds) return null;
    const { frame } = surface;
    const camera = stage.camera.matrixWorld.elements;
    const facing = frame.normal.reduce(
      (sum, n, i) => sum + n * camera[i + 8],
      0,
    );
    if (facing <= 0.035) return null;
    const { cssWidth: w, cssHeight: h } = stage;
    const origin = worldPoint(frame, grid.origin);
    const pu = worldPoint(frame, gridToPlane(grid, [1, 0]));
    const pv = worldPoint(frame, gridToPlane(grid, [0, 1]));
    const a = stage.projectPoint(origin),
      b = stage.projectPoint(pu),
      c = stage.projectPoint(pv);
    const ux = b.x - a.x,
      uy = b.y - a.y,
      vx = c.x - a.x,
      vy = c.y - a.y,
      det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-15) return null;
    const px = Math.abs(det) / Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy));
    const bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    for (const [sx, sy] of [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]) {
      const x = sx - a.x,
        y = sy - a.y;
      const uv = [(vy * x - vx * y) / det, (ux * y - uy * x) / det];
      for (let i = 0; i < 2; i++) {
        bounds.min[i] = Math.min(bounds.min[i], uv[i]);
        bounds.max[i] = Math.max(bounds.max[i], uv[i]);
      }
    }
    const stride = gridDisplayStride(9 / (px * grid.pitch));
    const step = grid.pitch * stride;
    for (let i = 0; i < 2; i++) {
      bounds.min[i] = Math.max(
        grid.bounds.min[i],
        Math.floor(bounds.min[i] / step) * step,
      );
      bounds.max[i] = Math.min(
        grid.bounds.max[i],
        Math.ceil(bounds.max[i] / step) * step,
      );
      if (bounds.max[i] <= bounds.min[i]) return null;
    }
    const section = stage.sectionPlane;
    const key = [
      stride,
      ...bounds.min,
      ...bounds.max,
      section?.axis,
      section?.position,
      section?.high,
    ].join('/');
    if (key !== this.cacheKey) {
      const { lines } = gridSegments(grid, bounds, {
        pixelsPerMm: px,
        minPixels: 9,
        maxLines: 220,
        clipLoops: surface.clipLoops,
      });
      const coords = [];
      for (const [p, q] of lines) {
        let start = worldPoint(frame, p),
          end = worldPoint(frame, q);
        if (section) {
          const k = section.axis,
            sign = section.high ? 1 : -1;
          const da = (start[k] - section.position) * sign,
            db = (end[k] - section.position) * sign;
          if (da < 0 && db < 0) continue;
          if (da < 0 !== db < 0) {
            const point = start.map(
              (n, i) => n + ((end[i] - n) * da) / (da - db),
            );
            if (da < 0) start = point;
            else end = point;
          }
        }
        coords.push(...start, ...end);
      }
      const positions = Float32Array.from(coords);
      this.object.geometry.dispose();
      this.object.geometry = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3),
      );
      if (positions.length) this.object.geometry.computeBoundingSphere();
      this.software = {
        positions,
        plane: { positions: Float64Array.from([...origin, ...pu, ...pv]) },
      };
      this.cacheKey = key;
    }
    this.object.visible = this.software.positions.length > 0;
    return this.object.visible ? this.software : null;
  }
  dispose() {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
