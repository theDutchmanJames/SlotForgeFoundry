import * as THREE from 'three';
import {
  creaseLineIndices,
  isTrackSurface,
  surfaceFeatures,
} from './surface-features.js';
import { FaceGridView } from './face-grid-view.js';
import { faceBudgets, PREVIEW_FACES } from './track-preview-budget.js';
import { paintMesh, rgba, SoftwareRaster } from './software-raster.js';
import {
  ViewNavigation,
  orthoPose,
  facePose,
  faceBounds,
} from './view-orientation.js';
import { clippedPolygon, clipOpenSurface } from './geometry/section-view.js';
import { referenceCarMeshes } from './reference-car-mesh.js';

// SlotForge look: track pieces print in graphite, everything that joins,
// locks or moves (clips, keys, the pit switch) in SlotForge red. Keepers are
// amber so they stand out against the red clip they hold in.
const COLORS = {
  road: 0x3d424a,
  border: 0x4b6152,
  clip: 0xe5484d,
  retainer: 0xf2b33d,
  support: 0x727b86,
  turnout: 0xd2444a,
  turnoutArm: 0xb93a40,
  turnoutBearing: 0xc9454b,
  turnoutInsert: 0xbf3f58,
  turnoutSlider: 0xe0803a,
  motorMount: 0xa8323a,
  barrier: 0xb9b5aa,
  fence: 0x8d949c,
  buildingBase: 0x727b86,
  wall: 0xc8c1b0,
  roof: 0x4b5058,
  floor: 0x9a938a,
  divider: 0xb5ae9d,
  lip: 0xd9a441,
  brace: 0xd8d2c4,
  door: 0xd2444a,
  frame: 0xe8e4da,
  body: 0x5b626c,
  addition: 0xe5484d,
  section: 0x9aa3ad,
};
// Keep each material recognizable when it is the active assembly part.
const SELECTED_TRACK_COLORS = {
  road: 0x4a5a72,
  border: 0x5c7d6c,
  clip: 0xf07478,
  retainer: 0xf7c766,
  support: 0x8496ad,
  turnout: 0xe86b70,
  turnoutArm: 0xd25a60,
  turnoutBearing: 0xe0676c,
  turnoutInsert: 0xdb6480,
  turnoutSlider: 0xf2a368,
  motorMount: 0xc4474e,
  barrier: 0xd6d2c6,
  fence: 0xb4bcc6,
};
const EDGE_COLOR = 0x15181c;
// The selected part is edged in the SlotForge focus blue (red is hardware).
const SELECTED_EDGE_COLOR = 0x4c9aff;
const SELECTION_FACES = 3000;
const SOFTWARE_PIXELS = 2_400_000;

// Weld nearby preview vertices into cells. Collapsing adjacent triangles
// preserves a solid silhouette on densely tessellated flat or curved surfaces.
function compactSurface(positions, indices, box, budget) {
  if (indices.length / 3 <= budget) {
    if (positions.length / 3 <= indices.length) return { positions, indices };
    // A face selection borrows the full STL position buffer for picking.
    // Project only referenced vertices into the software preview.
    const used = new Map(),
      vertices = [];
    const remapped = Uint32Array.from(indices, (index) => {
      let vertex = used.get(index);
      if (vertex === undefined) {
        vertex = vertices.length / 3;
        used.set(index, vertex);
        vertices.push(
          positions[index * 3],
          positions[index * 3 + 1],
          positions[index * 3 + 2],
        );
      }
      return vertex;
    });
    return { positions: Float32Array.from(vertices), indices: remapped };
  }
  if (!budget)
    return { positions: new Float32Array(), indices: new Uint32Array() };
  let cells = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(budget / 6))));
  const dimensions = box.getSize(new THREE.Vector3());
  const min = box.min;
  while (true) {
    const sx = dimensions.x ? cells / dimensions.x : 0;
    const sy = dimensions.y ? cells / dimensions.y : 0;
    const sz = dimensions.z ? cells / dimensions.z : 0;
    const base = cells + 1;
    const cache = new Int32Array(positions.length / 3);
    const clustered = new Map(),
      vertices = [],
      faces = [],
      seen = new Set();
    function cluster(i) {
      if (cache[i]) return cache[i] - 1;
      const k = i * 3,
        x = positions[k],
        y = positions[k + 1],
        z = positions[k + 2];
      const cell =
        Math.round((x - min.x) * sx) +
        base *
          (Math.round((y - min.y) * sy) + base * Math.round((z - min.z) * sz));
      let vertex = clustered.get(cell);
      if (vertex === undefined) {
        vertex = vertices.length / 3;
        vertices.push(x, y, z);
        clustered.set(cell, vertex);
      }
      cache[i] = vertex + 1;
      return vertex;
    }
    for (let i = 0; i < indices.length; i += 3) {
      const a = cluster(indices[i]),
        b = cluster(indices[i + 1]),
        c = cluster(indices[i + 2]);
      if (a === b || b === c || c === a) continue;
      // Cyclic permutations are the same oriented facet. Retain opposite faces.
      const key =
        a < b && a < c
          ? a + ',' + b + ',' + c
          : b < c
            ? b + ',' + c + ',' + a
            : c + ',' + a + ',' + b;
      if (!seen.has(key)) {
        seen.add(key);
        faces.push(a, b, c);
      }
      if (faces.length / 3 > budget && cells > 1) break;
    }
    if (faces.length / 3 <= budget || cells === 1) {
      const count = Math.min(faces.length, budget * 3);
      return {
        positions: Float32Array.from(vertices),
        indices: Uint32Array.from(faces.slice(0, count)),
      };
    }
    cells = Math.max(1, Math.floor(cells * 0.65));
  }
}

const softwarePalettes = new Map();
function softwarePalette(color) {
  if (softwarePalettes.has(color)) return softwarePalettes.get(color);
  const palette = Uint32Array.from({ length: 64 }, (_, i) =>
    rgba(
      ((color >> 16) * i) / 63,
      (((color >> 8) & 255) * i) / 63,
      ((color & 255) * i) / 63,
    ),
  );
  softwarePalettes.set(color, palette);
  return palette;
}
function softwareSurface(positions, indices, box, budget, color, originalMarks) {
  const mesh = compactSurface(positions, indices, box, budget);
  const { shades, marks } = surfaceFeatures(
    mesh.positions,
    mesh.indices,
    false,
  );
  const palette = softwarePalette(color);
  return { ...mesh, shades, marks: originalMarks ?? marks, palette };
}

const moveColor = 0x8fb8ff;
const movePalette = softwarePalette(moveColor);
const noMove = [0, 0, 0];

function tintTrackSelection(mesh, selected) {
  const role = mesh.userData.role;
  if (!Object.hasOwn(SELECTED_TRACK_COLORS, role)) return;
  if (Boolean(mesh.userData.trackSelected) === selected) return;
  mesh.userData.trackSelected = selected;
  const color = selected ? SELECTED_TRACK_COLORS[role] : COLORS[role];
  mesh.material.color.setHex(color);
  const preview = mesh.userData.preview;
  if (preview) {
    preview.palette = softwarePalette(color);
    preview.trackSelected = selected;
  }
  const outline = mesh.children.find((child) => child.isLineSegments);
  if (outline) {
    outline.material.color.setHex(selected ? SELECTED_EDGE_COLOR : EDGE_COLOR);
    outline.material.opacity = selected ? 0.92 : 0.55;
  }
}

function setMoveTint(mesh, tinted) {
  if (!mesh || Boolean(mesh.userData.moveStyle) === tinted) return;
  const preview = mesh.userData.preview;
  if (tinted) {
    mesh.userData.moveStyle = {
      color: mesh.material.color.getHex(),
      palette: preview?.palette,
    };
    mesh.material.color.setHex(moveColor);
    if (preview) preview.palette = movePalette;
  } else {
    mesh.material.color.setHex(mesh.userData.moveStyle.color);
    if (preview) preview.palette = mesh.userData.moveStyle.palette;
    delete mesh.userData.moveStyle;
  }
}

// The colours belong to the border surface. This child is only a display
// mesh; all selection, dimensions and exports use the original solid.
function kerbOverlay(markings, depthBits = 24) {
  const positions = [],
    colors = [],
    indices = [];
  const color = new THREE.Color();
  for (const marking of markings) {
    const first = positions.length / 3;
    color.set(marking.color);
    for (const point of marking.points) {
      positions.push(...point);
      colors.push(color.r, color.g, color.b);
    }
    for (let i = 2; i < marking.points.length; i++)
      indices.push(first, first + i - 1, first + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const overlay = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  // The paint and deck triangulate the same plane differently. Rounding
  // eye-space Z to Float32 before projection can put ink behind the deck,
  // particularly in top view where the camera fits a shallow depth range.
  const depthUnitsPerFloatStep = 2 ** (Math.min(depthBits, 24) - 23);
  overlay.onBeforeRender = (_renderer, _scene, camera) => {
    const relativeDistance = camera.far / (camera.far - camera.near);
    overlay.material.polygonOffsetUnits = -Math.max(
      2,
      Math.ceil(2 * relativeDistance * depthUnitsPerFloatStep),
    );
  };
  // Render after all opaque solids so foreground geometry occludes the ink.
  overlay.renderOrder = 1;
  return overlay;
}

function removeOverlay(overlay) {
  if (!overlay) return;
  overlay.removeFromParent();
  // Edge lines and face highlights borrow their owner's position buffer.
  if (overlay.userData.sharedPosition)
    overlay.geometry.deleteAttribute('position');
  overlay.geometry.dispose();
  overlay.material.dispose();
}

function partGeometry(part) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(part.positions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
  if (part.bounds) {
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(...part.bounds.min),
      new THREE.Vector3(...part.bounds.max),
    );
  } else geometry.computeBoundingBox();
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
    new THREE.Sphere(),
  );
  return geometry;
}

// Face selections normally reference the pick mesh directly. A post fused to a
// rim can cover only part of a triangle, so use its clipped patch instead.
function selectionMesh(original, regions) {
  const source = original.getAttribute('position');
  const index = original.index.array;
  const shared = !regions.some((region) => region.patches?.length);
  const faceCount = regions.reduce(
    (sum, region) =>
      sum + (region.patches?.length || region.triangleIndices?.length || 0),
    0,
  );
  const indices = new Uint32Array(faceCount * 3);
  let cursor = 0;
  const vertices = [],
    remap = new Map();
  function vertex(key, x, y, z) {
    let i = remap.get(key);
    if (i === undefined) {
      i = vertices.length / 3;
      remap.set(key, i);
      vertices.push(x, y, z);
    }
    return i;
  }
  for (const region of regions) {
    if (region.patches?.length) {
      for (const triangle of region.patches)
        for (const point of triangle)
          indices[cursor++] = vertex(
            point.join(','),
            point[0],
            point[1],
            point[2],
          );
    } else {
      for (const face of region.triangleIndices ?? []) {
        for (let j = 0; j < 3; j++) {
          const i = index[3 * face + j];
          indices[cursor++] = shared
            ? i
            : vertex(i, source.getX(i), source.getY(i), source.getZ(i));
        }
      }
    }
  }
  return {
    positions: shared ? source : new THREE.Float32BufferAttribute(vertices, 3),
    indices,
    shared,
  };
}

export class Viewport {
  constructor(host, onPick) {
    this.host = host;
    const canvas = document.createElement('canvas');
    canvas.setAttribute(
      'aria-label',
      '3D model. Drag to orbit, middle-drag to pan, scroll to zoom. Click to select. In the STL editor, Shift-click to add or remove a face, edge or hole rim.',
    );
    host.append(canvas);
    this.canvas = canvas;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
      const gl = this.renderer.getContext();
      this.depthBits = gl.getParameter(gl.DEPTH_BITS);
      this.renderer.setClearColor(0xffffff, 0);
    } catch {
      this.context = canvas.getContext('2d');
      if (!this.context) {
        const fallback = canvas.cloneNode();
        canvas.replaceWith(fallback);
        this.canvas = fallback;
        this.context = fallback.getContext('2d');
      }
    }
    this.scene = new THREE.Scene();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.01, 1e5);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(130, -185, 150);
    this.controls = new ViewNavigation(this.camera, this.canvas);
    this.controls.addEventListener('change', () => this.draw());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x727d8b, 2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-180, -150, 360);
    this.scene.add(key);
    this.span = 170;
    this.pickRay = new THREE.Raycaster();
    let clickStart = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      // Keep the browser's middle-button autoscroll out of this gesture.
      if (e.button === 1) e.preventDefault();
      clickStart = e.button === 0 && e.isPrimary ? e : null;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (
        clickStart?.pointerId === e.pointerId &&
        Math.hypot(
          e.clientX - clickStart.clientX,
          e.clientY - clickStart.clientY,
        ) > 4
      )
        clickStart = null;
    });
    this.canvas.addEventListener('pointercancel', () => {
      clickStart = null;
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const down = clickStart;
      clickStart = null;
      if (
        e.button !== 0 ||
        down?.pointerId !== e.pointerId ||
        Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > 4
      )
        return;
      const rect = this.canvas.getBoundingClientRect();
      const hit = this.intersectionAt(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((e.clientY - rect.top) / rect.height) * 2,
        ),
      );
      if (hit)
        onPick(hit.object.userData.id, hit.faceIndex, hit.point.toArray(), {
          shiftKey: down.shiftKey || e.shiftKey,
        });
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }
  // A live boolean may renumber every face. Pick the applied source until
  // the draft is committed, even when its replacement mesh is on screen.
  setPickSource(part, peerIds = []) {
    this.pickPeers = new Set(peerIds);
    if (part && part === this.pickPart) return;
    this.pickMesh?.geometry.dispose();
    this.pickMesh?.material.dispose();
    this.pickPart = part;
    this.pickMesh = null;
    if (part) {
      this.pickMesh = new THREE.Mesh(
        partGeometry(part),
        new THREE.MeshBasicMaterial(),
      );
      this.pickMesh.userData.id = part.id;
    }
  }
  intersectionAt(ndc, displayed = false) {
    this.pickRay.setFromCamera(ndc, this.camera);
    const firstVisible = (targets) => {
      const hits = this.pickRay.intersectObjects(targets, false);
      if (!this.sectionPlane) return hits[0];
      const { axis, position, high } = this.sectionPlane;
      const hit = hits.find((hit) =>
        high
          ? hit.point.getComponent(axis) >= position
          : hit.point.getComponent(axis) <= position,
      );
      if (hit && this.sectionCaps?.length) {
        const cap = this.pickRay.intersectObjects(
          this.sectionCaps.filter((mesh) => mesh.visible),
          false,
        )[0];
        if (cap && cap.distance < hit.distance - 1e-5) return;
      }
      return hit;
    };
    if (this.pickMesh && !displayed) {
      const targets = this.group.children.filter(
        (obj) =>
          obj.visible &&
          obj.userData.id !== this.pickPart.id &&
          this.pickPeers.has(obj.userData.id),
      );
      if (!this.hidden?.has(this.pickPart.id)) targets.push(this.pickMesh);
      return firstVisible(targets);
    }
    return firstVisible(this.group.children.filter((o) => o.visible));
  }
  hasRoadBelow(position, slotDepth) {
    // A centreline ray normally meets the slot floor rather than the deck.
    // Bound the search in Z so a lower bridge crossing cannot support a car
    // whose own road segment is hidden.
    const [x, y, z] = position;
    const ray = (this.roadProbe ??= new THREE.Raycaster());
    ray.ray.origin.set(x, y, z + 0.1);
    ray.ray.direction.set(0, 0, -1);
    ray.far = slotDepth * 1.1 + 0.2;
    return this.group.children.some(mesh => {
      if (!mesh.visible || mesh.userData.role !== 'road') return false;
      const {min, max} = mesh.geometry.boundingBox;
      return x >= min.x && x <= max.x && y >= min.y && y <= max.y &&
        max.z >= z + 0.1 - ray.far && min.z <= z + 0.1 &&
        ray.intersectObject(mesh, false).length > 0;
    });
  }
  projectPoint(point) {
    const p = (this.screenPoint ??= new THREE.Vector3())
      .fromArray(point)
      .project(this.camera);
    return {
      x: ((p.x + 1) * this.cssWidth) / 2,
      y: ((1 - p.y) * this.cssHeight) / 2,
      visible: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1,
    };
  }
  resize() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.cssWidth = w;
    this.cssHeight = h;
    if (this.renderer) this.renderer.setSize(w, h, false);
    else {
      const scale = Math.min(1, Math.sqrt(SOFTWARE_PIXELS / (w * h)));
      const width = Math.max(1, Math.floor(w * scale));
      const height = Math.max(1, Math.floor(h * scale));
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
    }
    this.camera.top = this.span / 2;
    this.camera.bottom = -this.span / 2;
    this.camera.right = (this.span * w) / h / 2;
    this.camera.left = -this.camera.right;
    this.camera.updateProjectionMatrix();
    this.draw();
  }
  clearParts() {
    this.clearSection();
    this.clearHighlight();
    for (const mesh of [...this.group.children]) {
      for (const outline of [...mesh.children]) removeOverlay(outline);
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
  setParts(parts, fit, hidden = new Set()) {
    // A part passed again as the same object keeps its mesh (the Track
    // Planner re-sends every unchanged section); everything else is rebuilt.
    const kept = new Map();
    const wanted = new Set(parts);
    for (const mesh of this.group.children)
      if (wanted.has(mesh.userData.part)) kept.set(mesh.userData.part, mesh);
    for (const mesh of kept.values()) mesh.removeFromParent();
    this.clearParts();
    this.movingMesh = null;
    this.hidden = hidden;
    const budgets = faceBudgets(
      parts.map((p) => p.indices.length / 3),
      PREVIEW_FACES,
    );
    parts.forEach((p, i) => {
      let mesh = kept.get(p);
      if (mesh) {
        kept.delete(p);
        if (mesh.userData.moveStyle) setMoveTint(mesh, false);
        mesh.position.set(0, 0, 0);
      } else {
        mesh = this.displayMesh(p, budgets[i]);
        mesh.userData.part = p;
      }
      mesh.visible = !hidden.has(p.id);
      this.group.add(mesh);
    });
    // The same object listed twice gets one mesh; drop any left over.
    for (const mesh of kept.values()) {
      for (const outline of [...mesh.children]) removeOverlay(outline);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.sourceParts = parts;
    this.onPartsChanged?.(parts);
    this.scene.updateMatrixWorld(true);
    if (fit) this.fit();
    else this.draw();
  }
  /**
   * Pulls the parts apart, as far as t (0 together, 1 fully apart) of the
   * offset each part carries as apart [x, y, z]; parts without one stay.
   */
  setApart(t) {
    for (const mesh of this.group.children) {
      const a = mesh.userData.part?.apart;
      if (a) mesh.position.set(a[0] * t, a[1] * t, a[2] * t);
    }
    this.scene.updateMatrixWorld(true);
    this.draw();
  }
  // Show rigid placement directly while the worker calculates the exact draft.
  // Moving the display mesh leaves the part arrays used for history/export intact.
  setDisplayTranslation(id, translation, tinted = false) {
    const delta = translation ?? noMove;
    const next =
      id && (tinted || delta.some((v) => v !== 0)) && !this.sectionPlane
        ? this.group.children.find((m) => m.visible && m.userData.id === id)
        : null;
    if (this.movingMesh && this.movingMesh !== next) {
      setMoveTint(this.movingMesh, false);
      this.movingMesh.position.set(0, 0, 0);
      this.movingMesh.updateMatrixWorld();
      this.draw();
    }
    this.movingMesh = next;
    if (next && Boolean(next.userData.moveStyle) !== tinted) {
      setMoveTint(next, tinted);
      this.draw();
    }
    if (
      next &&
      (next.position.x !== delta[0] ||
        next.position.y !== delta[1] ||
        next.position.z !== delta[2])
    ) {
      next.position.fromArray(delta);
      next.updateMatrixWorld();
      this.draw();
    }
  }
  // A scale reference belongs to the scene, outside the selectable parts.
  // Both renderers receive the same world-space triangles, including grade.
  setReferenceCar(pose) {
    if (!pose) {
      if (!this.referenceCar) return;
      for (const mesh of [...this.referenceCar.children]) removeOverlay(mesh);
      this.referenceCar.removeFromParent();
      this.referenceCar = this.referenceCarPose = null;
      this.draw();
      return;
    }
    const key = [pose.scale, ...pose.position, ...pose.forward].join(',');
    if (key === this.referenceCarPose) return;
    const surfaces = referenceCarMeshes(pose);
    if (!surfaces.length) {
      this.setReferenceCar(null);
      return;
    }
    if (!this.referenceCar) {
      this.referenceCar = new THREE.Group();
      this.scene.add(this.referenceCar);
    }
    surfaces.forEach((part, i) => {
      let mesh = this.referenceCar.children[i];
      if (!mesh) {
        const geometry = partGeometry(part);
        mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
          color: part.color, flatShading: true, roughness: 0.78, metalness: 0.06,
        }));
        this.referenceCar.add(mesh);
      } else {
        const vertices = mesh.geometry.getAttribute('position');
        vertices.array.set(part.positions);
        vertices.needsUpdate = true;
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
      }
      if (!this.renderer)
        mesh.userData.preview = softwareSurface(part.positions, part.indices,
          mesh.geometry.boundingBox, part.indices.length / 3, part.color, new Uint8Array(0));
    });
    this.referenceCarPose = key;
    this.referenceCar.visible = !this.sectionGroup;
    this.draw();
  }
  displayMesh(p, budget) {
    const geometry = partGeometry(p);
    const color = COLORS[p.role] ?? COLORS.body;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      metalness: 0.08,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.id = p.id;
    mesh.userData.role = p.role;
    if (!this.renderer) {
      // The worker preserves the slot lips when reducing generated track
      // surfaces. A second spatial weld here would collapse those lips again.
      const indices = p.previewIndices ?? p.indices;
      mesh.userData.preview = softwareSurface(
        p.positions,
        indices,
        geometry.boundingBox,
        isTrackSurface(p) ? indices.length / 3 : budget,
        color,
        p.previewMarks,
      );
      if (p.kerbMarkings?.length)
        mesh.userData.kerbPaint = paintMesh(p.kerbMarkings);
    } else if (isTrackSurface(p) || p.indices.length / 3 <= budget) {
      const lines = p.creaseLines ?? creaseLineIndices(p);
      if (lines.length) {
        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', geometry.getAttribute('position'));
        edgeGeo.setIndex(new THREE.BufferAttribute(lines, 1));
        edgeGeo.boundingSphere = geometry.boundingSphere;
        const edge = new THREE.LineSegments(
          edgeGeo,
          new THREE.LineBasicMaterial({
            color: EDGE_COLOR,
            opacity: 0.55,
            transparent: true,
            depthWrite: false,
          }),
        );
        edge.userData.sharedPosition = true;
        mesh.add(edge);
      }
    }
    if (this.renderer && p.kerbMarkings?.length)
      mesh.add(kerbOverlay(p.kerbMarkings, this.depthBits));
    return mesh;
  }
  clearSection() {
    if (!this.sectionGroup) return;
    for (const mesh of [...this.sectionGroup.children]) {
      if (!mesh.userData.borrowed) {
        for (const child of [...mesh.children]) removeOverlay(child);
        removeOverlay(mesh);
      }
    }
    this.sectionGroup.removeFromParent();
    this.sectionGroup = this.sectionPlane = this.sectionCaps = null;
    this.sectionHighlight = null;
    this.group.visible = true;
    if (this.referenceCar) this.referenceCar.visible = true;
    this.draw();
  }
  showSection(results, plane) {
    this.clearSection();
    this.sectionGroup = new THREE.Group();
    this.sectionCaps = [];
    this.sectionPlane = plane;
    this.scene.add(this.sectionGroup);
    this.group.visible = false;
    if (this.referenceCar) this.referenceCar.visible = false;
    const models = new Map(this.sourceParts.map((p) => [p.id, p]));
    const originals = new Map(
      this.group.children.map((m) => [m.userData.id, m]),
    );
    const counts = results.flatMap((r) => [
      r.indices?.length / 3 || 0,
      r.capIndices?.length / 3 || 0,
    ]);
    const budgets = faceBudgets(counts, PREVIEW_FACES);
    for (const [i, result] of results.entries()) {
      const original = originals.get(result.id),
        p = models.get(result.id);
      if (!p || result.empty) continue;
      if (result.whole) {
        // Share buffers/paint with the original, without cloning userData's large typed arrays.
        const whole = new THREE.Mesh(original.geometry, original.material);
        whole.userData = { ...original.userData, borrowed: true };
        for (const child of original.children) {
          if (child === this.highlight) continue;
          const overlay = child.isLineSegments
            ? new THREE.LineSegments(child.geometry, child.material)
            : new THREE.Mesh(child.geometry, child.material);
          overlay.renderOrder = child.renderOrder;
          overlay.onBeforeRender = child.onBeforeRender;
          whole.add(overlay);
        }
        whole.visible = original.visible;
        this.sectionGroup.add(whole);
        continue;
      }
      if (result.indices.length) {
        const kerbMarkings = p.kerbMarkings
          ?.map((m) => ({ ...m, points: clippedPolygon(m.points, plane) }))
          .filter((m) => m.points.length >= 3);
        const mesh = this.displayMesh(
          {
            ...p,
            ...result,
            creaseLines: undefined,
            previewIndices: undefined,
            previewMarks: undefined,
            kerbMarkings,
          },
          budgets[i * 2],
        );
        mesh.visible = original.visible;
        mesh.material.emissive.copy(original.material.emissive);
        tintTrackSelection(mesh, Boolean(original.userData.trackSelected));
        this.sectionGroup.add(mesh);
      }
      if (result.capIndices?.length) {
        const cap = this.displayMesh(
          {
            ...p,
            positions: result.positions,
            indices: result.capIndices,
            creaseLines: undefined,
            previewIndices: undefined,
            previewMarks: undefined,
            role: 'section',
            kerbMarkings: null,
          },
          budgets[i * 2 + 1],
        );
        cap.visible = original.visible;
        this.sectionGroup.add(cap);
        this.sectionCaps.push(cap);
      }
    }
    this.refreshSectionHighlight();
    this.scene.updateMatrixWorld(true);
    this.draw();
  }
  refreshSectionHighlight() {
    if (this.sectionHighlight) {
      removeOverlay(this.sectionHighlight);
      this.sectionHighlight = null;
    }
    const highlight = this.highlight;
    if (!this.sectionGroup || !highlight?.parent) return;
    const source = highlight.geometry;
    const clipped = clipOpenSurface(
      {
        positions: source.getAttribute('position').array,
        indices: source.index.array,
      },
      this.sectionPlane,
    );
    if (!clipped.indices.length) return;
    const geometry = partGeometry(clipped);
    const mesh = new THREE.Mesh(geometry, highlight.material.clone());
    mesh.userData.id = highlight.parent.userData.id;
    mesh.visible = highlight.parent.visible;
    if (!this.renderer)
      mesh.userData.preview = softwareSurface(
        clipped.positions,
        clipped.indices,
        geometry.boundingBox,
        SELECTION_FACES,
        0x4c9aff,
      );
    this.sectionHighlight = mesh;
    this.sectionGroup.add(mesh);
  }
  frameCamera(pose, { all = false, face = null } = {}) {
    const visible = this.group.children.filter((mesh) => mesh.visible);
    const chosen = all
      ? []
      : visible.filter((mesh) => this.focusIds?.has(mesh.userData.id));
    const boxes = (chosen.length ? chosen : visible).map(
      (mesh) => mesh.geometry.boundingBox,
    );
    if (!boxes.length && this.designBounds) boxes.push(this.designBounds);
    const box = new THREE.Box3();
    for (const bounds of boxes) box.union(bounds);
    const mid = face?.center ?? box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.controls.useUp(pose.up);
    this.controls.target.copy(mid);
    const length = Math.max(size.length(), face?.size.length() ?? 0, 1);
    this.camera.position.copy(mid).addScaledVector(pose.eye, length * 1.7);
    this.camera.near = Math.max(0.001, length / 10000);
    this.camera.far = length * 8;
    this.camera.zoom = 1;
    this.controls.update();
    this.camera.updateMatrixWorld();
    const extent = new THREE.Box3(),
      inView = new THREE.Box3();
    for (const bounds of boxes)
      extent.union(
        inView.copy(bounds).applyMatrix4(this.camera.matrixWorldInverse),
      );
    const drawSize = face?.size ?? extent.getSize(new THREE.Vector3());
    const aspect = Math.max(
      0.1,
      this.host.clientWidth / Math.max(1, this.host.clientHeight),
    );
    if (face || boxes.length) {
      const extent = Math.max(drawSize.y, drawSize.x / aspect);
      this.span = (extent > 0 ? extent : 1) * 1.31;
    }
    this.resize();
  }
  fit() {
    this.activeView = 'iso';
    this.frameCamera(orthoPose('iso'), { all: true });
  }
  fitView(all = false) {
    this.frameCamera(
      {
        eye: this.camera.getWorldDirection(new THREE.Vector3()).negate(),
        up: this.camera.up.clone(),
      },
      { all },
    );
  }
  setDesignBounds(lines) {
    const bounds = new THREE.Box3(),
      point = new THREE.Vector3();
    for (const path of lines)
      for (const vertex of path) bounds.expandByPoint(point.fromArray(vertex));
    this.designBounds = bounds.isEmpty() ? null : bounds;
  }
  /** Everything above z cut away, to look inside (null: nothing). Drawn with WebGL only. */
  setCutaway(z) {
    this.cutaway = z ?? null;
    if (this.renderer) this.renderer.clippingPlanes = z == null ? [] : [new THREE.Plane(new THREE.Vector3(0, 0, -1), z)];
    this.draw();
  }
  /** How low and how high the parts shown reach, as they stand now: [min z, max z], or null. */
  heightRange() {
    const box = new THREE.Box3();
    for (const mesh of this.group.children) if (mesh.visible) box.expandByObject(mesh);
    return box.isEmpty() ? null : [box.min.z, box.max.z];
  }
  /** A measuring line between two points picked on the model, a dot for the first, or nothing. */
  setMeasure(points = []) {
    if (this.measureMark) {
      this.measureMark.removeFromParent();
      this.measureMark.geometry.dispose();
      this.measureMark.material.dispose();
      this.measureMark = null;
    }
    if (points.length) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
      this.measureMark =
        points.length > 1
          ? new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xe5484d, depthTest: false }))
          : new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xe5484d, size: 7, sizeAttenuation: false, depthTest: false }));
      this.measureMark.renderOrder = 999;
      this.scene.add(this.measureMark);
    }
    this.draw();
  }
  view(which) {
    const pose = orthoPose(which);
    if (!pose) return;
    this.activeView = which;
    this.frameCamera(pose);
  }
  lookAtFace(frame) {
    const pose = facePose(frame);
    if (!pose) return;
    const bounds = faceBounds(frame, pose);
    this.activeView = 'face';
    this.frameCamera(pose, { face: bounds });
  }
  select(id, hidden, peers) {
    this.hidden = hidden;
    this.focusIds = new Set([id, ...(peers ?? [])]);
    for (const o of this.group.children) {
      o.visible = !hidden.has(o.userData.id);
      tintTrackSelection(o, o.userData.id === id);
      o.material.emissive.setHex(
        peers?.has(o.userData.id)
          ? 0x0d2a4d
          : o.userData.id === id
            ? 0x0a1020
            : 0x000000,
      );
    }
    for (const o of this.sectionGroup?.children ?? []) {
      o.visible = !hidden.has(o.userData.id);
      if (!o.userData.borrowed) {
        tintTrackSelection(o, o.userData.id === id);
        o.material.emissive?.setHex(
          peers?.has(o.userData.id)
            ? 0x0d2a4d
            : o.userData.id === id
              ? 0x0a1020
              : 0,
        );
      }
    }
    this.onVisibilityChanged?.(hidden);
    this.draw();
  }
  // Orthographic zoom controls the XY framing. Depth must instead follow the
  // bounds of the current solids, including while previewing transforms with
  // the old framing. Moving the eye along its own axis preserves screen XY.
  updateDepthRange() {
    this.camera.updateMatrixWorld();
    const m = this.camera.matrixWorldInverse.elements;
    let nearest = Infinity,
      farthest = -Infinity;
    const meshes = this.referenceCar?.visible
      ? this.group.children.concat(this.referenceCar.children) : this.group.children;
    for (const mesh of meshes) {
      // An empty mesh has an inverted box; 0 × Infinity would make the range NaN.
      if (!mesh.visible || !mesh.geometry.boundingBox || mesh.geometry.boundingBox.isEmpty()) continue;
      const { min, max } = mesh.geometry.boundingBox;
      const x0 = -m[2] * min.x,
        x1 = -m[2] * max.x;
      const y0 = -m[6] * min.y,
        y1 = -m[6] * max.y;
      const z0 = -m[10] * min.z,
        z1 = -m[10] * max.z;
      const offset =
        this.movingMesh === mesh
          ? -(
              m[2] * mesh.position.x +
              m[6] * mesh.position.y +
              m[10] * mesh.position.z
            )
          : 0;
      nearest = Math.min(
        nearest,
        Math.min(x0, x1) + Math.min(y0, y1) + Math.min(z0, z1) - m[14] + offset,
      );
      farthest = Math.max(
        farthest,
        Math.max(x0, x1) + Math.max(y0, y1) + Math.max(z0, z1) - m[14] + offset,
      );
    }
    for (const [x, y, z] of this.faceGrid?.surface?.worldCorners ?? []) {
      const depth = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
      nearest = Math.min(nearest, depth);
      farthest = Math.max(farthest, depth);
    }
    if (!Number.isFinite(nearest) || !Number.isFinite(farthest)) return;
    // Leave space around thin planar surfaces for outlines and guide labels.
    const pad = Math.max(
      (farthest - nearest) * 0.25,
      Math.min(this.span, 100) * 0.1,
      0.001,
    );
    if (nearest < pad) {
      const shift = pad - nearest;
      this.camera.position.addScaledVector(
        this.camera.getWorldDirection(new THREE.Vector3()),
        -shift,
      );
      this.camera.updateMatrixWorld();
      nearest += shift;
      farthest += shift;
    }
    const near = Math.max(0, nearest - pad),
      far = farthest + pad;
    if (this.camera.near !== near || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }
  clearHighlight() {
    if (!this.highlight) return;
    removeOverlay(this.highlight);
    this.highlight = null;
    this.refreshSectionHighlight();
    this.draw();
  }
  highlightFaces(id, indices) {
    this.highlightRegions(id, [{ triangleIndices: indices }]);
  }
  highlightRegions(id, regions) {
    this.clearHighlight();
    const part = this.group.children.find((o) => o.userData.id === id);
    if (!part || !regions?.length) return;
    const original =
      this.pickPart?.id === id ? this.pickMesh.geometry : part.geometry;
    const { positions, indices, shared } = selectionMesh(original, regions);
    if (!indices.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', positions);
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.boundingSphere = original.boundingSphere;
    const color = 0x4c9aff;
    this.highlight = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      }),
    );
    this.highlight.userData.sharedPosition = shared;
    if (!this.renderer)
      this.highlight.userData.preview = softwareSurface(
        positions.array,
        indices,
        original.boundingBox,
        SELECTION_FACES,
        color,
      );
    part.add(this.highlight);
    this.refreshSectionHighlight();
    this.draw();
  }
  draw() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.updateDepthRange();
      const grid = this.faceGrid?.update();
      if (this.renderer) this.renderer.render(this.scene, this.camera);
      else this.softwareDraw(grid);
      this.onRender?.();
    });
  }
  setFaceGrid(surface, grid) {
    if (!surface && !this.faceGrid) return;
    (this.faceGrid ??= new FaceGridView(this)).set(surface, grid);
  }
  softwareDraw(grid) {
    const ctx = this.context;
    if (!ctx) return;
    const { width, height } = this.canvas;
    if (this.raster?.width !== width || this.raster.height !== height)
      this.raster = new SoftwareRaster(ctx, width, height);
    this.camera.updateMatrixWorld();
    const projection = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
    const bounds = new THREE.Box3();
    const objects = (this.sectionGroup ?? this.group).children.filter((obj) => {
      if (!obj.visible) return false;
      if (!obj.geometry.boundingBox) return true;
      obj.updateWorldMatrix(true, false);
      bounds.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
      return frustum.intersectsBox(bounds);
    });
    if (!this.sectionGroup && this.highlight?.parent?.visible)
      objects.push(this.highlight);
    if (this.referenceCar?.visible) objects.push(...this.referenceCar.children);
    this.raster.draw(
      ctx,
      objects,
      projection.elements,
      this.sectionGroup ? this.sectionHighlight : this.highlight,
      grid,
    );
  }
  dispose() {
    this.faceGrid?.dispose();
    this.sectionControls?.dispose();
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.setReferenceCar(null);
    this.observer.disconnect();
    this.controls.dispose();
    this.clearParts();
    this.setPickSource(null);
    this.raster = null;
    this.renderer?.dispose();
    this.canvas.remove();
  }
}
