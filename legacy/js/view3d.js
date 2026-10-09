'use strict';
// 3D preview using three.js (r128 global build). Orbit: left-drag rotate, right-drag pan, wheel zoom.
var BMM = window.BMM || (window.BMM = {});

(function () {
  class View3D {
    constructor(container, sourceCanvas) {
      this.container = container;
      this.source = sourceCanvas;    // 2D base canvas used as the terrain texture
      this.ok = typeof THREE !== 'undefined';
      this.exaggerate = 1;
      this.visible = false;
      if (!this.ok) {
        container.innerHTML = '<div class="no3d">3D preview needs an internet connection the first time (three.js from cdnjs).<br>All other features work offline.</div>';
        return;
      }
      const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
      r.setPixelRatio(window.devicePixelRatio || 1);
      container.appendChild(r.domElement);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 10, 200000);
      this.sun = new THREE.DirectionalLight(0xffffff, 0.95);
      this.scene.add(this.sun);
      this.amb = new THREE.AmbientLight(0xffffff, 0.45);
      this.scene.add(this.amb);
      this.markers = new THREE.Group();
      this.scene.add(this.markers);
      this.orbit = { yaw: 0.6, pitch: 0.85, dist: 6000, tx: 0, tz: 0 };
      this._bindControls(r.domElement);
    }

    _bindControls(el) {
      let drag = null;
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button }; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointerup', () => { drag = null; });
      el.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        const o = this.orbit;
        if (drag.b === 0) {
          o.yaw -= dx * 0.006;
          o.pitch = Math.max(0.08, Math.min(1.5, o.pitch + dy * 0.005));
        } else {
          const s = o.dist / 900;
          const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
          o.tx -= (dx * cy - dy * sy) * s;
          o.tz -= (-dx * sy - dy * cy) * s;
        }
        this.render();
      });
      el.addEventListener('wheel', e => {
        e.preventDefault();
        this.orbit.dist = Math.max(300, Math.min(80000, this.orbit.dist * Math.pow(1.0015, e.deltaY)));
        this.render();
      }, { passive: false });
    }

    resize() {
      if (!this.ok) return;
      const r = this.container.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      this.renderer.setSize(r.width, r.height);
      this.camera.aspect = r.width / r.height;
      this.camera.updateProjectionMatrix();
      this.render();
    }

    setMap(map) {
      this.map = map;
      if (!this.ok) return;
      if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
      const maxSeg = 384;
      this.step = Math.max(1, Math.ceil((Math.max(map.W, map.H) - 1) / maxSeg));
      const sx = Math.ceil((map.W - 1) / this.step), sz = Math.ceil((map.H - 1) / this.step);
      const geo = new THREE.PlaneGeometry(map.worldW, map.worldH, sx, sz);
      geo.rotateX(-Math.PI / 2);
      geo.translate(map.worldW / 2, 0, map.worldH / 2);
      this.segs = [sx, sz];
      if (!this.texture) {
        this.texture = new THREE.CanvasTexture(this.source);
        this.texture.anisotropy = 8;
      }
      this.texture.needsUpdate = true;
      const mat = new THREE.MeshLambertMaterial({ map: this.texture });
      this.mesh = new THREE.Mesh(geo, mat);
      this.scene.add(this.mesh);
      if (!this.water) {
        this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x2a6f8a, transparent: true, opacity: 0.55 }));
        this.water.rotation.x = -Math.PI / 2;
        this.scene.add(this.water);
      }
      this.water.scale.set(map.worldW * 1.6, map.worldH * 1.6, 1);
      this.water.position.set(map.worldW / 2, 0, map.worldH / 2);
      const o = this.orbit;
      o.tx = map.worldW / 2; o.tz = map.worldH / 2; o.dist = Math.max(map.worldW, map.worldH) * 1.15;
      this.updateHeights();
    }

    updateHeights() {
      if (!this.ok || !this.mesh) return;
      const map = this.map, pos = this.mesh.geometry.attributes.position;
      const [sx, sz] = this.segs;
      let k = 0;
      for (let j = 0; j <= sz; j++) for (let i = 0; i <= sx; i++) {
        const gi = Math.min(map.W - 1, i * this.step), gj = Math.min(map.H - 1, j * this.step);
        pos.setY(k++, map.heights[gj * map.W + gi] * this.exaggerate);
      }
      pos.needsUpdate = true;
      this.mesh.geometry.computeVertexNormals();
      this.texture.needsUpdate = true;
      const P = BMM.Texture.PALETTES[map.texture.palette] || BMM.Texture.PALETTES.temperate;
      const w = P.water.base, st = map.settings;
      if (st.lava) {
        this.water.material.color.setRGB(1.0, 0.35, 0.05);
        this.water.material.emissive = new THREE.Color(0.9, 0.25, 0.0);
        this.water.material.opacity = 0.92;
        this.water.position.y = st.lavaLevel * this.exaggerate;
        this.water.visible = true;
        this.water.scale.set(map.worldW, map.worldH, 1);
      } else {
        this.water.material.color.setRGB(w[0] * 1.4, w[1] * 1.4, w[2] * 1.4);
        this.water.material.emissive = new THREE.Color(0, 0, 0);
        this.water.material.opacity = 0.55;
        this.water.position.y = 0;
        this.water.scale.set(map.worldW * 1.6, map.worldH * 1.6, 1);
        this.water.visible = !st.voidWater && map.heightRange()[0] < 0;
      }
      this.scene.background = new THREE.Color(P.sky[0], P.sky[1], P.sky[2]);
      const s = BMM.Texture.sunDir(map.texture);
      this.sun.position.set(s[0], s[1], s[2]);
      this.sun.color.setRGB(P.diffuse[0] * 1.1, P.diffuse[1] * 1.1, P.diffuse[2] * 1.1);
      this.amb.color.setRGB(P.ambient[0] * 1.2, P.ambient[1] * 1.2, P.ambient[2] * 1.2);
      this.updateMarkers();
    }

    updateMarkers() {
      if (!this.ok || !this.map) return;
      const g = this.markers, map = this.map;
      while (g.children.length) { const c = g.children.pop(); c.geometry.dispose(); c.material.dispose(); }
      let team = 0;
      for (const o of map.objects) {
        const y = map.sampleHeight(o.x, o.z) * this.exaggerate;
        let mesh;
        if (o.type === 'metal') {
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 8, 16), new THREE.MeshLambertMaterial({ color: 0xd8dce6, emissive: 0x333344 }));
          mesh.position.set(o.x, y + 4, o.z);
        } else if (o.type === 'geo') {
          mesh = new THREE.Mesh(new THREE.ConeGeometry(30, 50, 12), new THREE.MeshLambertMaterial({ color: 0xff8a30, emissive: 0x662200 }));
          mesh.position.set(o.x, y + 25, o.z);
        } else {
          const col = new THREE.Color(BMM.TEAM_COLORS[team++ % BMM.TEAM_COLORS.length]);
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 260, 10), new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(0.4) }));
          mesh.position.set(o.x, y + 130, o.z);
        }
        g.add(mesh);
      }
    }

    render() {
      if (!this.ok || !this.visible || !this.mesh) return;
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        const o = this.orbit;
        const cp = Math.cos(o.pitch);
        this.camera.position.set(o.tx + Math.sin(o.yaw) * cp * o.dist, Math.sin(o.pitch) * o.dist, o.tz + Math.cos(o.yaw) * cp * o.dist);
        this.camera.lookAt(o.tx, 0, o.tz);
        this.renderer.render(this.scene, this.camera);
      });
    }
  }

  BMM.View3D = View3D;
})();
