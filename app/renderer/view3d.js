// 3D preview with three.js: the heightmap as a mesh textured with the 2D view's image, water or lava plane, markers.
// Orbit camera: left-drag rotate, right-drag pan, wheel zoom.
import * as THREE from '../../node_modules/three/build/three.module.js';
import { heightAt, worldSize } from './sample.js';
import { TEAM_COLORS } from './view2d.js';

const MAX_SEGMENTS = 384; // mesh resolution cap; plenty for a preview of a 32×32 map

export class View3D {
  visible = false;
  #orbit = { yaw: 0.6, pitch: 0.85, dist: 6000, tx: 0, tz: 0 };
  #raf = 0;

  constructor(container, sourceCanvas) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fa9c4);
    this.camera = new THREE.PerspectiveCamera(45, 1, 10, 200000);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.scene.add(this.sun, new THREE.AmbientLight(0xffffff, 0.9));
    this.texture = new THREE.CanvasTexture(sourceCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.liquid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ transparent: true }));
    this.liquid.rotation.x = -Math.PI / 2;
    this.markers = new THREE.Group();
    this.scene.add(this.liquid, this.markers);
    this.#bindControls(this.renderer.domElement);
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
      if (drag.button === 0) {
        o.yaw -= dx * 0.006;
        o.pitch = Math.min(1.5, Math.max(0.08, o.pitch + dy * 0.005));
      } else {
        const s = o.dist / 900, cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
        o.tx -= (dx * cy + dy * sy) * s;
        o.tz -= (-dx * sy + dy * cy) * s;
      }
      this.render();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.#orbit.dist = Math.min(80000, Math.max(300, this.#orbit.dist * 1.0015 ** e.deltaY));
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
    Object.assign(this.#orbit, { tx: w / 2, tz: h / 2, dist: Math.max(w, h) * 1.15 });
    this.update();
  }

  /** Re-reads heights, look, lava and objects from the doc. */
  update() {
    if (!this.visible || !this.mesh) return;
    const { doc } = this, position = this.mesh.geometry.attributes.position, [sx, sz] = this.segments;
    let k = 0;
    for (let j = 0; j <= sz; j++) {
      for (let i = 0; i <= sx; i++) position.setY(k++, doc.heights[Math.min(doc.H - 1, j * this.step) * doc.W + Math.min(doc.W - 1, i * this.step)]);
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
    this.#updateMarkers();
    this.render();
  }

  #updateMarkers() {
    for (const child of this.markers.children.splice(0)) { child.geometry.dispose(); child.material.dispose(); }
    let team = 0;
    for (const o of this.doc.objects) {
      const y = heightAt(this.doc, o.x, o.z);
      let geometry, color, lift;
      if (o.type === 'metal') [geometry, color, lift] = [new THREE.CylinderGeometry(26, 26, 8, 16), 0xd8dce6, 4];
      else if (o.type === 'geo') [geometry, color, lift] = [new THREE.ConeGeometry(30, 50, 12), 0xff8a30, 25];
      else if (o.type === 'start') [geometry, color, lift] = [new THREE.CylinderGeometry(14, 14, 260, 10), TEAM_COLORS[team++ % TEAM_COLORS.length], 130];
      else continue;
      const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(o.x, y + lift, o.z);
      this.markers.add(mesh);
    }
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (!this.visible || !this.mesh) return;
    this.#raf ||= requestAnimationFrame(() => {
      this.#raf = 0;
      const o = this.#orbit, cp = Math.cos(o.pitch);
      this.camera.position.set(o.tx + Math.sin(o.yaw) * cp * o.dist, Math.sin(o.pitch) * o.dist, o.tz + Math.cos(o.yaw) * cp * o.dist);
      this.camera.lookAt(o.tx, 0, o.tz);
      this.renderer.render(this.scene, this.camera);
    });
  }
}
