// A woman's hand wearing the ring (MakeHuman CC0 model, see assets/hand/).
// The model is in millimetres with the ring position at the origin and the
// ring finger along Z (see CONTRACT.md), so it lines up with the ring as is.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const URL_GLB = 'assets/hand/hand.glb';
const URL_META = 'assets/hand/hand.json';

// Multipliers on the skin texture (1 = texture as is).
export const SKIN_TONES = {
  light:  [1.0, 1.0, 1.0],
  medium: [0.86, 0.76, 0.66],
  tan:    [0.68, 0.53, 0.42],
  deep:   [0.42, 0.3, 0.24],
};

export class Hand {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.meta = null;
    this.loading = null;
    this.scale = 1;
    this.tone = 'light';
  }

  load() {
    if (!this.loading) {
      this.loading = Promise.all([
        fetch(URL_META).then((r) => r.json()),
        new GLTFLoader().loadAsync(URL_GLB),
      ]).then(([meta, gltf]) => {
        this.meta = meta;
        const root = gltf.scene;
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          const isNail = /nail/i.test(o.material?.name || '') || /nail/i.test(o.name);
          o.material = isNail ? this._nailMaterial(o.material) : this._skinMaterial(o.material);
        });
        this.group.add(root);
        this.setTone(this.tone);
        return this;
      }).catch((e) => {
        this.loading = null; // allow a retry next time
        throw e;
      });
    }
    return this.loading;
  }

  // Skin: rough dielectric with a soft sheen, a little warm "scattered" light
  // so it does not look like plastic, and a fade at the cut end of the forearm.
  _skinMaterial(src) {
    const m = new THREE.MeshPhysicalMaterial({
      map: src?.map || null,
      normalMap: src?.normalMap || null,
      color: 0xffffff,
      roughness: 0.52,
      metalness: 0,
      specularIntensity: 0.45,
      sheen: 0.35,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(1.0, 0.82, 0.76),
      alphaHash: true,
    });
    if (m.normalMap) m.normalScale.set(0.6, 0.6);
    this._addFade(m);
    this._addScatter(m);
    this.skin = m;
    return m;
  }

  _nailMaterial(src) {
    const m = new THREE.MeshPhysicalMaterial({
      map: src?.map || null,
      color: src?.map ? 0xffffff : 0xf2d2c8,
      roughness: 0.25,
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
    });
    this.nails = m;
    return m;
  }

  // Dither the forearm away over its last 4 cm (no hard cut edge).
  _addFade(m) {
    const end = () => this.meta?.forearmEndZ ?? 1e9;
    m.onBeforeCompile = (shader, renderer) => {
      shader.uniforms.uFadeEnd = { get value() { return end(); } };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vHandZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHandZ = position.z;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHandZ;\nuniform float uFadeEnd;')
        .replace('#include <alphahash_fragment>',
          'diffuseColor.a *= 1.0 - smoothstep(uFadeEnd - 45.0, uFadeEnd - 3.0, vHandZ);\n#include <alphahash_fragment>');
      if (m.userData.scatter) m.userData.scatter(shader);
    };
  }

  // Cheap subsurface look: add a little of the (reddened) diffuse colour back
  // as emission where light wraps around, so shadows on skin stay warm.
  _addScatter(m) {
    m.userData.scatter = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(0.10, 0.035, 0.02);',
      );
    };
  }

  setTone(tone) {
    this.tone = SKIN_TONES[tone] ? tone : 'light';
    if (this.skin) this.skin.color.setRGB(...SKIN_TONES[this.tone], THREE.SRGBColorSpace);
  }

  // Scale the hand for a ring size (EU size = inner circumference in mm).
  setRingSize(eu) {
    const base = this.meta?.ringCircumference || 49.75;
    this.scale = eu / base;
    this.group.scale.setScalar(this.scale);
  }

  get minY() { return (this.meta?.minY ?? -10) * this.scale; }
}
