// Photo studio: renderer, camera, procedural light environment, backdrop,
// shadows and post-processing. Units: millimetres.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BACKDROPS = {
  studio: { floor: 0xf1efec, sky: 0xdedad5, walls: 0.32, floorEnv: 0.9, velvet: false, backdropEnv: 0.3, bloomThreshold: 3.0 },
  velvet: { floor: 0x060606, sky: 0x020202, walls: 0.025, floorEnv: 0.02, velvet: true, backdropEnv: 1.0, bloomThreshold: 3.2 },
  dark:   { floor: 0x2a2a2c, sky: 0x1c1c1e, walls: 0.06, floorEnv: 0.08, velvet: false, backdropEnv: 0.6, bloomThreshold: 2.6 },
};

export class Studio {
  constructor(container) {
    this.container = container;
    this.needsRender = true;
    this.floorY = -10;
    this.focus = new THREE.Vector3(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 3000);
    this.camera.position.set(30, 30, 46);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 22;
    controls.maxDistance = 260;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener('change', () => { this.needsRender = true; });
    this.controls = controls;

    this._buildEnvironment();
    this._buildBackdrop();
    this._buildLights();
    this._buildComposer();

    this.ringRoot = new THREE.Group();
    this.scene.add(this.ringRoot);

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();

    this.setBackdrop('studio');
    this._tween = null;
  }

  // ---------------------------------------------------------------- environment
  // A small virtual photo studio (soft boxes, strip lights, small spots) that is
  // rendered into a cube map. The cube map is used sharp by the diamonds and
  // pre-filtered (PMREM) by the metal.
  _buildEnvironment() {
    const env = new THREE.Scene();
    this.envScene = env;

    const roomMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, vertexColors: true });
    const room = new THREE.Mesh(new THREE.BoxGeometry(200, 120, 200, 8, 8, 8), roomMat);
    room.position.y = 30;
    this.envRoom = room;
    env.add(room);

    const floorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -29.9;
    this.envFloor = floor;
    env.add(floor);

    const panel = (w, h, intensity, pos, warm = 0) => {
      const c = new THREE.Color(1, 1 - warm * 0.06, 1 - warm * 0.14).multiplyScalar(intensity);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      env.add(m);
      return m;
    };
    // Two overhead soft boxes, tilted; directly above stays dark (like the
    // camera hole in a light tent) so the stones keep contrast in the top view.
    panel(46, 80, 3.2, new THREE.Vector3(-52, 76, 0));
    panel(46, 80, 2.6, new THREE.Vector3(52, 76, 0));
    const hole = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide }));
    hole.position.set(0, 89, 0);
    hole.rotation.x = Math.PI / 2;
    env.add(hole);
    // Key soft box front-left and fill front-right
    panel(46, 46, 7.0, new THREE.Vector3(-55, 40, 60), 0.5);
    panel(40, 40, 3.0, new THREE.Vector3(62, 30, 50));
    // Tall strip lights on both sides (long highlights on the band)
    panel(10, 90, 9.0, new THREE.Vector3(-92, 20, -10));
    panel(10, 90, 9.0, new THREE.Vector3(92, 20, -14));
    // Rim lights behind
    panel(70, 8, 6.0, new THREE.Vector3(0, 22, -95));
    panel(8, 40, 5.0, new THREE.Vector3(-40, 45, -80));
    // Small hard spots: they create the bright sparkles in the diamonds
    const rng = mulberry32(7);
    for (let i = 0; i < 26; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = 0.15 + rng() * 1.15;
      const r = 95;
      const p = new THREE.Vector3(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r * 0.9 + 5, Math.sin(phi) * Math.sin(theta) * r);
      const s = 2 + rng() * 5;
      panel(s, s, 14 + rng() * 20, p);
    }
    // Black flags (negative fill) to give contrast in metal and stones
    const flagMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    for (const [x, y, z, w, h] of [[70, 20, -70, 40, 70], [-75, 10, 30, 30, 60], [10, 60, 80, 40, 20]]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flagMat);
      f.position.set(x, y, z);
      f.lookAt(0, 0, 0);
      env.add(f);
    }

    this.cubeRT = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(0.5, 1000, this.cubeRT);
    env.add(this.cubeCam);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = this.cubeRT.texture; // sharp cube map (diamonds)
  }

  _updateEnvironment(bd) {
    // Vertical gradient on the room walls: darker at the floor, lighter at the top.
    const g = this.envRoom.geometry;
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getY(i) + 60) / 120, 0, 1);
      const v = bd.walls * (0.35 + 0.65 * t);
      colors.set([v, v, v * 0.98], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.envFloor.material.color.setScalar(bd.floorEnv);

    this.cubeCam.update(this.renderer, this.envScene);
    if (this.pmremRT) this.pmremRT.dispose();
    this.pmremRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.scene.environment = this.pmremRT.texture;
  }

  // ---------------------------------------------------------------- backdrop
  _buildBackdrop() {
    // Seamless "infinity cove": floor that bends up into a back wall.
    const W = 1600, depthFront = 700, depthBack = 500, radius = 260, height = 900;
    const prof = [];
    const steps = 48;
    prof.push(new THREE.Vector2(depthFront, 0));
    prof.push(new THREE.Vector2(-depthBack + radius, 0));
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * Math.PI / 2;
      prof.push(new THREE.Vector2(-depthBack + radius - Math.sin(a) * radius, radius - Math.cos(a) * radius));
    }
    prof.push(new THREE.Vector2(-depthBack, height));
    const xs = 2;
    const verts = [], uvs = [], idx = [];
    for (let j = 0; j < prof.length; j++) {
      for (let i = 0; i < xs; i++) {
        const x = -W / 2 + (i / (xs - 1)) * W;
        verts.push(x, prof[j].y, prof[j].x);
        uvs.push(x / 40, (prof[j].x - prof[j].y) / 40);
      }
    }
    for (let j = 0; j < prof.length - 1; j++) {
      const a = j * xs, b = (j + 1) * xs;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();

    this.velvetTex = makeVelvetTexture();
    this.backdropMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.backdrop = new THREE.Mesh(g, this.backdropMat);
    this.backdrop.receiveShadow = true;
    this.scene.add(this.backdrop);

    // Soft contact shadow right under the ring.
    const ctx = document.createElement('canvas');
    ctx.width = ctx.height = 128;
    const c2 = ctx.getContext('2d');
    const grad = c2.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c2.fillStyle = grad;
    c2.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(ctx);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.renderOrder = 1;
    this.scene.add(this.contact);
  }

  _buildLights() {
    // Only light that is not image based: a soft key light for the floor shadow.
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(-30, 90, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera;
    s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 10; s.far = 250;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 14;
    sun.shadow.blurSamples = 20;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  _buildComposer() {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.25, 1.4);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  // Shift the picture left so the ring is centred in the space next to the panel.
  setPanelInset(px) {
    if (Math.abs((this._inset || 0) - px) < 1) return;
    this._inset = px;
    this._resize();
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const inset = this._inset || 0;
    if (inset > 0) this.camera.setViewOffset(w, h, inset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the ring framed on portrait screens.
    this.camera.fov = w < h ? 40 : 28;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  // ---------------------------------------------------------------- public API
  setBackdrop(name) {
    const bd = BACKDROPS[name] || BACKDROPS.studio;
    this.backdropName = name;
    const m = this.backdropMat;
    m.color.set(bd.floor);
    if (bd.velvet) {
      m.map = this.velvetTex;
      m.roughness = 1;
      m.sheen = 1;
      m.sheenRoughness = 0.45;
      m.sheenColor.set(0x3a3a3a);
    } else {
      m.map = null;
      m.roughness = 0.92;
      m.sheen = 0;
    }
    m.envMapIntensity = bd.backdropEnv;
    m.needsUpdate = true;
    this.scene.background = new THREE.Color(bd.sky);
    this.sun.intensity = bd.velvet ? 0.4 : 1.2;
    this.bloom.threshold = bd.bloomThreshold;
    this._updateEnvironment(bd);
    this.needsRender = true;
  }

  setExposure(v) { this.renderer.toneMappingExposure = v; this.needsRender = true; }
  setBloom(v) { this.bloom.strength = v; this.bloom.enabled = v > 0.001; this.needsRender = true; }
  setAutoRotate(on) { this.controls.autoRotate = on; this.needsRender = true; }

  // The ring stands on its band. bottomY = lowest point, focusY = head centre.
  placeRing(group, { bottomY, focusY, width, info }) {
    this.ringRoot.clear();
    this.ringRoot.add(group);
    this.floorY = bottomY - 0.02;
    this.backdrop.position.y = this.floorY;
    this.contact.position.set(0, this.floorY + 0.03, 0);
    this.contact.scale.set(Math.max(width, 8) * 0.9, 1, 5);
    const newFocus = new THREE.Vector3(0, (focusY + bottomY) * 0.5 + 2, 0);
    if (!this._placed) {
      this.controls.target.copy(newFocus);
      this._placed = true;
    }
    this.focus.copy(newFocus);
    this.headY = focusY;
    this.fit = Math.max(1, (info?.headWidth || 14) / 14.5, (info?.headLength || 11) / 11.5);
    this.sun.target.position.set(0, this.floorY, 0);
    this.needsRender = true;
  }

  setView(name) {
    const head = new THREE.Vector3(0, this.headY ?? 10, 0);
    const f = this.fit || 1;
    const mid = this.focus.clone();
    const views = {
      top: { pos: new THREE.Vector3(0, head.y + 44 * f, 0.001), target: head },
      view34: { pos: new THREE.Vector3(27 * f, mid.y + 27 * f, 42 * f), target: mid },
      side: { pos: new THREE.Vector3(0, mid.y + 3, 60 * f), target: mid },
      front: { pos: new THREE.Vector3(0, head.y + 34 * f, 28 * f), target: head },
    };
    const v = views[name] || views.view34;
    this._tween = {
      t: 0,
      fromPos: this.camera.position.clone(), toPos: v.pos,
      fromTarget: this.controls.target.clone(), toTarget: v.target.clone(),
    };
    this.needsRender = true;
  }

  render() {
    if (this._tween) {
      const tw = this._tween;
      tw.t = Math.min(1, tw.t + 0.04);
      const k = tw.t * tw.t * (3 - 2 * tw.t);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) this._tween = null;
      this.needsRender = true;
    }
    const moved = this.controls.update();
    if (moved || this.controls.autoRotate) this.needsRender = true;
    if (!this.needsRender) return false;
    this.needsRender = false;
    this.composer.render();
    return true;
  }

  screenshot(filename = 'ring.png') {
    this.composer.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
}

function makeVelvetTexture() {
  // Fine fibre noise for the black velvet tray.
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = mulberry32(3);
  for (let i = 0; i < size * size; i++) {
    const v = 150 + rng() * 105;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1, 1);
  return tex;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
