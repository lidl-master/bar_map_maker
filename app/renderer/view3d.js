// 3D preview with three.js: the heightmap as a mesh textured with the 2D view's image, water or lava plane, a dark
// skirt and ground so the map never floats, a dark gradient sky with matching fog, billboard markers drawn like the
// 2D ones, and trees and rocks as one instanced mesh per kind (maps carry thousands of them).
// Orbit camera: left-drag rotate, right-drag pan, wheel zoom; fit, top view and reset from the view's toolbar.
import * as THREE from '../../node_modules/three/build/three.module.js';
import { heightRange } from '../../src/core/index.js';
import { MARKER_SIZE, markerCanvas } from './markers.js';
import { heightAt, worldSize } from './sample.js';

const MAX_SEGMENTS = 384; // mesh resolution cap; plenty for a preview of a 32×32 map
const FOV = 45;
const FIT_MARGIN = 0.08; // of the pane, on every side
const HOME = { yaw: 0.45, pitch: 0.9 }; // a three-quarter view with north (the sun) at the top
const TOP = { yaw: 0, pitch: 1.5 };
const SKY_TOP = 0x1a1d24, HORIZON = 0x2a3038;
const MARKER_ORDER = { metal: 1, geo: 2, start: 3 }; // starts drawn last, like in 2D

// One low-poly shape per feature kind, standing on the ground (y = 0 at its base).
const FEATURE_KINDS = {
  tree: { geometry: new THREE.ConeGeometry(16, 72, 6).translate(0, 36, 0), color: 0x2c5a2a },
  rock: { geometry: new THREE.DodecahedronGeometry(13, 0).scale(1, 0.6, 1), color: 0x8f8a80 },
};
const kindOf = (o) => (o.name.startsWith('rocks') ? 'rock' : 'tree');

// A dome around the camera: the horizon colour (= the fog) fading to a darker zenith.
function skyDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(SKY_TOP) }, horizon: { value: new THREE.Color(HORIZON) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww; }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; '
      + 'void main() { gl_FragColor = vec4(mix(horizon, top, pow(clamp(normalize(vDir).y, 0.0, 1.0), 0.6)), 1.0); #include <colorspace_fragment> }',
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

export class View3D {
  visible = false;
  showFeatures = true;
  onView = null; // (yaw) after every frame: the compass follows the camera
  onInteract = null; // the first time the user moves the camera
  #orbit = { ...HOME, dist: 6000, tx: 0, tz: 0 };
  #framed = true; // the camera still shows the whole map (the user has not moved it): keep doing so on resize
  #raf = 0;
  #markerMaterials = new Map(); // `${type}:${team}` → SpriteMaterial (textures drawn by markers.js)

  constructor(container, sourceCanvas) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(HORIZON);
    this.scene.fog = new THREE.Fog(HORIZON, 1, 2);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 200000);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sky = skyDome();
    this.scene.add(this.sky, this.sun, new THREE.AmbientLight(0xffffff, 0.9));
    this.texture = new THREE.CanvasTexture(sourceCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.liquid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ transparent: true }));
    this.liquid.rotation.x = -Math.PI / 2;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x181b20 }));
    this.skirt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.markers = new THREE.Group();
    this.features = new THREE.Group();
    this.scene.add(this.liquid, this.ground, this.skirt, this.markers, this.features);
    this.#bindControls(this.renderer.domElement);
  }

  #moved() {
    if (this.#framed) this.onInteract?.();
    this.#framed = false;
  }

  #bindControls(canvas) {
    let drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, button: e.button }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, o = this.#orbit;
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.#moved();
      if (drag.button === 0) {
        o.yaw -= dx * 0.006;
        o.pitch = Math.min(TOP.pitch, Math.max(0.08, o.pitch + dy * 0.005));
      } else {
        const s = o.dist / 900, cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
        o.tx -= (dx * cy + dy * sy) * s;
        o.tz -= (-dx * sy + dy * cy) * s;
      }
      this.render();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.#orbit.dist = Math.min(400000, Math.max(300, this.#orbit.dist * 1.0015 ** e.deltaY));
      this.#moved();
      this.render();
    }, { passive: false });
  }

  setDoc(doc) {
    this.doc = doc;
    this.mesh?.geometry.dispose();
    this.scene.remove(this.mesh);
    this.texture.dispose(); // its GPU storage has a fixed size; the 2D image changes size with the map
    const [w, h] = worldSize(doc);
    this.step = Math.max(1, Math.ceil((Math.max(doc.W, doc.H) - 1) / MAX_SEGMENTS));
    this.segments = [Math.ceil((doc.W - 1) / this.step), Math.ceil((doc.H - 1) / this.step)];
    const geometry = new THREE.PlaneGeometry(w, h, ...this.segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(w / 2, 0, h / 2);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: this.texture }));
    this.scene.add(this.mesh);
    this.view(HOME);
    this.update();
  }

  /** Re-reads heights, look, lava and objects from the doc. */
  update() {
    if (!this.visible || !this.mesh) return;
    const { doc } = this, position = this.mesh.geometry.attributes.position, [sx, sz] = this.segments;
    let k = 0;
    for (let j = 0; j <= sz; j++) {
      for (let i = 0; i <= sx; i++) position.setY(k++, this.#gridHeight(i, j));
    }
    position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.texture.needsUpdate = true;
    const [w, h] = worldSize(doc), lava = doc.settings.lava;
    this.liquid.visible = lava.enabled || !doc.settings.voidWater;
    this.liquid.position.set(w / 2, lava.enabled ? lava.level : 0, h / 2);
    this.liquid.scale.set(w, h, 1);
    this.liquid.material.color.set(lava.enabled ? 0xff5a10 : 0x2a6f8a);
    this.liquid.material.opacity = lava.enabled ? 0.92 : 0.55;
    this.sun.position.set(...doc.settings.sunDir);
    this.#updateSkirt();
    this.#updateMarkers();
    this.#updateFeatures();
    this.render();
  }

  #gridHeight(i, j) {
    const { doc } = this;
    return doc.heights[Math.min(doc.H - 1, j * this.step) * doc.W + Math.min(doc.W - 1, i * this.step)];
  }

  // Walls from the map's edge down to a dark ground plane, shaded darker towards the bottom.
  #updateSkirt() {
    const [w, h] = worldSize(this.doc), [sx, sz] = this.segments, size = Math.max(w, h);
    const floor = Math.min(heightRange(this.doc)[0], 0) - 0.04 * size;
    const edge = [];
    for (let i = 0; i <= sx; i++) edge.push([i, 0]);
    for (let j = 1; j <= sz; j++) edge.push([sx, j]);
    for (let i = sx - 1; i >= 0; i--) edge.push([i, sz]);
    for (let j = sz - 1; j >= 0; j--) edge.push([0, j]);
    const positions = [], colors = [], index = [], top = new THREE.Color(0x2c3038), bottom = new THREE.Color(0x15171b);
    edge.forEach(([i, j], n) => {
      const x = (i * w) / sx, z = (j * h) / sz; // where the mesh puts its edge vertices
      positions.push(x, this.#gridHeight(i, j), z, x, floor, z);
      colors.push(top.r, top.g, top.b, bottom.r, bottom.g, bottom.b);
      if (n) index.push(2 * n - 2, 2 * n - 1, 2 * n, 2 * n - 1, 2 * n + 1, 2 * n);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(index);
    this.skirt.geometry.dispose();
    this.skirt.geometry = geometry;
    this.ground.position.set(w / 2, floor, h / 2);
    this.ground.scale.setScalar(size * 24);
  }

  #markerMaterial(type, team) {
    const key = `${type}:${team}`;
    if (!this.#markerMaterials.has(key)) {
      const map = new THREE.CanvasTexture(markerCanvas(type, team));
      map.colorSpace = THREE.SRGBColorSpace;
      this.#markerMaterials.set(key, new THREE.SpriteMaterial({ map, sizeAttenuation: false, depthTest: false, depthWrite: false, fog: false }));
    }
    return this.#markerMaterials.get(key);
  }

  // Billboards a fixed number of screen pixels tall, always on top, like the 2D markers.
  #updateMarkers() {
    this.markers.clear();
    let team = 0;
    for (const o of this.doc.objects) {
      if (!MARKER_ORDER[o.type]) continue;
      const sprite = new THREE.Sprite(this.#markerMaterial(o.type, o.type === 'start' ? team++ : 0));
      sprite.position.set(o.x, heightAt(this.doc, o.x, o.z), o.z);
      sprite.renderOrder = MARKER_ORDER[o.type];
      sprite.userData.px = MARKER_SIZE[o.type] + 8;
      this.markers.add(sprite);
    }
    this.#sizeMarkers();
  }

  #sizeMarkers() {
    const height = this.renderer.domElement.clientHeight || 1, perPx = (2 * Math.tan((FOV * Math.PI) / 360)) / height;
    for (const sprite of this.markers.children) sprite.scale.setScalar(sprite.userData.px * perPx);
  }

  // Rebuilt with the markers: heights may have changed under them.
  #updateFeatures() {
    for (const mesh of this.features.children.splice(0)) { mesh.material.dispose(); mesh.dispose(); }
    if (!this.showFeatures) return;
    const byKind = { tree: [], rock: [] };
    for (const o of this.doc.objects) if (o.type === 'feature') byKind[kindOf(o)].push(o);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [kind, list] of Object.entries(byKind)) {
      if (!list.length) continue;
      const { geometry, color } = FEATURE_KINDS[kind];
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color, flatShading: true }), list.length);
      list.forEach((o, i) => {
        const size = 0.8 + ((o.id * 2654435761) % 1000) / 2500; // 0.8..1.2, steady per feature
        m.compose(p.set(o.x, heightAt(this.doc, o.x, o.z), o.z), q.setFromAxisAngle(up, ((o.rot ?? 0) * Math.PI) / 180), s.setScalar(size));
        mesh.setMatrixAt(i, m);
      });
      this.features.add(mesh);
    }
  }

  /** Points the camera from `angles` ({yaw, pitch}; the current ones when omitted) and fits the whole map. */
  view(angles = this.#orbit) {
    Object.assign(this.#orbit, { yaw: angles.yaw, pitch: angles.pitch });
    this.#framed = true;
    this.#fit();
    this.render();
  }

  home() { this.view(HOME); }
  top() { this.view(TOP); }
  north() { this.view({ yaw: 0, pitch: this.#orbit.pitch }); }

  #place() {
    const o = this.#orbit, cp = Math.cos(o.pitch), cam = this.camera;
    cam.position.set(o.tx + Math.sin(o.yaw) * cp * o.dist, Math.sin(o.pitch) * o.dist, o.tz + Math.cos(o.yaw) * cp * o.dist);
    cam.near = Math.max(1, o.dist / 200);
    cam.far = o.dist * 40;
    cam.updateProjectionMatrix();
    cam.lookAt(o.tx, 0, o.tz);
    cam.updateMatrixWorld();
  }

  // The whole map (its box from the lowest to the highest point) inside the pane with FIT_MARGIN on every side:
  // the distance by bisection, then the target moved so the box sits in the middle; a few rounds converge.
  #fit() {
    if (!this.doc) return;
    const [w, h] = worldSize(this.doc), [lo, hi] = heightRange(this.doc), o = this.#orbit, limit = 1 - 2 * FIT_MARGIN;
    const corners = [0, w].flatMap((x) => [0, h].flatMap((z) => [Math.min(lo, 0), Math.max(hi, 0)].map((y) => new THREE.Vector3(x, y, z))));
    const p = new THREE.Vector3();
    const box = () => {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const c of corners) {
        p.copy(c).project(this.camera);
        if (p.z > 1) return null; // behind the camera
        b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y);
      }
      return b;
    };
    Object.assign(o, { tx: w / 2, tz: h / 2 });
    for (let round = 0; round < 3; round++) {
      let near = 100, far = 2e6;
      while (far / near > 1.002) {
        o.dist = Math.sqrt(near * far);
        this.#place();
        const b = box();
        if (b && Math.max(-b[0], -b[1], b[2], b[3]) <= limit) far = o.dist;
        else near = o.dist;
      }
      o.dist = far;
      this.#place();
      const b = box(), ray = new THREE.Vector3((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0.5).unproject(this.camera).sub(this.camera.position);
      const t = -this.camera.position.y / ray.y; // where the box's centre ray meets y = 0
      if (!(t > 0)) break;
      o.tx = this.camera.position.x + ray.x * t;
      o.tz = this.camera.position.z + ray.z * t;
    }
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.#sizeMarkers();
    if (this.#framed) this.#fit();
    this.render();
  }

  render() {
    if (!this.visible || !this.mesh) return;
    this.#raf ||= requestAnimationFrame(() => {
      this.#raf = 0;
      this.#place();
      const [w, h] = worldSize(this.doc), size = Math.max(w, h), o = this.#orbit;
      this.scene.fog.near = o.dist + 0.6 * size;
      this.scene.fog.far = o.dist + 6 * size;
      this.sky.position.copy(this.camera.position);
      this.sky.scale.setScalar(o.dist * 10);
      this.renderer.render(this.scene, this.camera);
      this.onView?.(o.yaw);
    });
  }
}
