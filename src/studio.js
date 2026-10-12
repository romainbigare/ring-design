// Photo studio: renderer, camera, procedural light environment, backdrop,
// shadows and post-processing. Units: millimetres.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

const BACKDROPS = {
  slate:  { floor: 0x3a3a3c, sky: 0x111112, walls: 0.09, floorEnv: 0.03, velvet: false, slate: true, backdropEnv: 0.55, bloomThreshold: 2.6, sun: 0.5, contact: 0.9 },
  studio: { floor: 0xf1efec, sky: 0xdedad5, walls: 0.32, floorEnv: 0.9, velvet: false, backdropEnv: 0.3, bloomThreshold: 3.0, sun: 1.0, contact: 0.55 },
  velvet: { floor: 0x060606, sky: 0x020202, walls: 0.025, floorEnv: 0.02, velvet: true, backdropEnv: 1.0, bloomThreshold: 3.2, sun: 0.35, contact: 0.95 },
  dark:   { floor: 0x2a2a2c, sky: 0x1c1c1e, walls: 0.06, floorEnv: 0.08, velvet: false, backdropEnv: 0.6, bloomThreshold: 2.6, sun: 0.6, contact: 0.85 },
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

    this.setBackdrop('slate');
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
    // Round photo "bowl": a floor that curves up into a wall all around the
    // ring, so there is no edge to see from any angle.
    const floorR = 240, curveR = 220, wallH = 900;
    const prof = [new THREE.Vector2(0, 0)];
    for (let i = 1; i <= 24; i++) prof.push(new THREE.Vector2((floorR * i) / 24, 0));
    for (let i = 1; i <= 40; i++) {
      const a = (i / 40) * Math.PI / 2;
      prof.push(new THREE.Vector2(floorR + Math.sin(a) * curveR, curveR - Math.cos(a) * curveR));
    }
    for (let i = 1; i <= 8; i++) prof.push(new THREE.Vector2(floorR + curveR, curveR + (wallH * i) / 8));
    const g = new THREE.LatheGeometry(prof, 160);
    // Planar texture coordinates (no stretching on the floor) and a soft
    // light fall-off towards the walls, like a real studio sweep.
    const pos = g.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = Math.hypot(x, z);
      uvs[i * 2] = x / 40;
      uvs[i * 2 + 1] = (z + Math.sign(z) * y) / 40;
      const k = 1 - 0.3 * THREE.MathUtils.smoothstep(r, 40, floorR + curveR) - 0.25 * THREE.MathUtils.smoothstep(y, 0, 500);
      cols.set([k, k, k], i * 3);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));

    this.velvetTex = makeVelvetTexture();
    this.backdropMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
    this.backdrop = new THREE.Mesh(g, this.backdropMat);
    this.backdrop.receiveShadow = true;
    this.scene.add(this.backdrop);

    this.slateTex = makeSlateTexture();
    this._buildContactShadow();
  }

  // Contact shadow: render the ring's depth from below into a small texture,
  // blur it and lay it on the floor (soft, darker where the ring is close).
  _buildContactShadow() {
    const size = 60, height = 14, res = 512;
    this.shadowGroup = new THREE.Group();
    this.scene.add(this.shadowGroup);
    this.shadowRT = new THREE.WebGLRenderTarget(res, res);
    this.shadowRT.texture.generateMipmaps = false;
    this.shadowBlurRT = new THREE.WebGLRenderTarget(res, res);
    this.shadowBlurRT.texture.generateMipmaps = false;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.shadowRT.texture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    plane.renderOrder = 1;
    plane.scale.y = -1;
    this.contact = plane;
    this.shadowGroup.add(plane);
    this.blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2));
    this.blurPlane.visible = false;
    this.shadowGroup.add(this.blurPlane);
    this.shadowCam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
    this.shadowCam.rotation.x = Math.PI / 2; // look up
    this.shadowGroup.add(this.shadowCam);

    const dm = new THREE.MeshDepthMaterial();
    dm.userData.darkness = { value: 1.4 };
    dm.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = dm.userData.darkness;
      shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );',
      );
    };
    dm.depthTest = false;
    dm.depthWrite = false;
    this.depthMat = dm;
    this.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    this.hBlur.depthTest = false;
    this.vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    this.vBlur.depthTest = false;
    this.shadowDirty = true;
  }

  _blurShadow(amount) {
    const bp = this.blurPlane;
    bp.visible = true;
    bp.material = this.hBlur;
    bp.material.uniforms.tDiffuse.value = this.shadowRT.texture;
    this.hBlur.uniforms.h.value = amount / 256;
    this.renderer.setRenderTarget(this.shadowBlurRT);
    this.renderer.render(bp, this.shadowCam);
    bp.material = this.vBlur;
    bp.material.uniforms.tDiffuse.value = this.shadowBlurRT.texture;
    this.vBlur.uniforms.v.value = amount / 256;
    this.renderer.setRenderTarget(this.shadowRT);
    this.renderer.render(bp, this.shadowCam);
    bp.visible = false;
  }

  _renderContactShadow() {
    this.shadowDirty = false;
    const r = this.renderer;
    const bg = this.scene.background;
    this.scene.background = null;
    this.backdrop.visible = false;
    this.contact.visible = false;
    this.scene.overrideMaterial = this.depthMat;
    const cc = r.getClearAlpha();
    r.setClearAlpha(0);
    r.setRenderTarget(this.shadowRT);
    r.clear();
    r.render(this.scene, this.shadowCam);
    this.scene.overrideMaterial = null;
    this._blurShadow(2.2);
    this._blurShadow(0.9);
    r.setRenderTarget(null);
    r.setClearAlpha(cc);
    this.scene.background = bg;
    this.backdrop.visible = true;
    this.contact.visible = true;
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
    m.roughnessMap = null;
    if (bd.slate) {
      m.map = this.slateTex;
      m.roughness = 0.8;
      m.sheen = 0;
    } else if (bd.velvet) {
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
    this.sun.intensity = bd.sun;
    this.contact.material.opacity = bd.contact;
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
    this.ringBottomY = bottomY;
    this._updateFloor();
    const newFocus = new THREE.Vector3(0, (focusY + bottomY) * 0.5 + 2, 0);
    if (!this._placed) {
      this.controls.target.copy(newFocus);
      this._placed = true;
    }
    this.focus.copy(newFocus);
    this.headY = focusY;
    this.fit = Math.max(1, (info?.headWidth || 14) / 14.5, (info?.headLength || 11) / 11.5);
    this.needsRender = true;
  }

  // Optional hand wearing the ring (src/hand.js). The floor goes down to the
  // lowest point of the hand, and the shadows cover the whole hand.
  setHand(hand) {
    if (this.hand !== hand) {
      if (this.hand) this.scene.remove(this.hand.group);
      this.hand = hand;
      if (hand) this.scene.add(hand.group);
    }
    this._updateFloor();
  }

  get handVisible() { return !!this.hand?.group.visible; }

  _updateFloor() {
    const handOn = this.handVisible;
    let y = this.ringBottomY ?? -10;
    if (handOn) y = Math.min(y, this.hand.minY);
    this.floorY = y - 0.02;
    this.backdrop.position.y = this.floorY;
    this.shadowGroup.position.set(0, this.floorY + 0.02, 0);
    // Contact shadow and key-light shadow: ring only, or the whole hand.
    const k = handOn ? 5.5 : 1;
    this.shadowGroup.scale.setScalar(k);
    const s = this.sun.shadow.camera;
    s.left = -30 * k; s.right = 30 * k; s.top = 30 * k; s.bottom = -30 * k; s.far = 250 + 100 * (k - 1);
    s.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
    this.sun.target.position.set(0, this.floorY, handOn ? 40 : 0);
    this.shadowDirty = true;
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
      // Looking at the hand from the fingertips, slightly to the side.
      hand: { pos: new THREE.Vector3(-75, head.y + 75, -150), target: new THREE.Vector3(0, head.y - 14, -10) },
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
    if (this.shadowDirty) this._renderContactShadow();
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

function makeSlateTexture() {
  // Dark slate: soft cloudy value noise plus fine grain and faint streaks.
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rng = mulberry32(11);
  const grid = (n) => Array.from({ length: n * n }, () => rng());
  const octaves = [[8, 0.3], [16, 0.25], [32, 0.2], [96, 0.12]].map(([n, amp]) => ({ n, amp, g: grid(n) }));
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = ({ n, g }, x, y) => {
    const fx = x * n, fy = y * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const v = (i, j) => g[((j % n + n) % n) * n + ((i % n + n) % n)];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const o of octaves) v += sample(o, x / size, y / size) * o.amp;
      v += Math.sin((x * 0.9 + y * 0.25) * 0.08 + v * 6) * 0.025; // faint cleavage streaks
      v += (rng() - 0.5) * 0.12;                                 // grain
      const k = Math.max(0, Math.min(255, 140 + (v - 0.44) * 70));
      const i = (y * size + x) * 4;
      img.data[i] = k; img.data[i + 1] = k; img.data[i + 2] = k * 1.02; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1, 1);
  tex.anisotropy = 8;
  return tex;
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
