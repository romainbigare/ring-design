// App entry: state, wiring between the control panel, the ring builder and the studio.
import * as THREE from 'three';
import { DEFAULTS, PRESETS, METALS, SCHEMA, TOOLBAR } from './params.js';
import { Studio } from './studio.js';
import { buildRing, disposeRing } from './ring.js';
import { createDiamondMaterial, setDiamondOptions } from './gems.js';
import { createPanel, toast } from './ui.js';

// ---------------------------------------------------------------- state
const state = { ...DEFAULTS, ...readHash() };

function readHash() {
  const out = {};
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [k, v] of params) {
    if (!(k in DEFAULTS)) continue;
    const d = DEFAULTS[k];
    if (typeof d === 'number') { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
    else if (typeof d === 'boolean') out[k] = v === '1' || v === 'true';
    else out[k] = v;
  }
  return out;
}

function writeHash() {
  const params = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) {
    if (state[k] === DEFAULTS[k]) continue;
    if (k === 'haloStoneSize' && state.haloAutoSize) continue; // computed value
    const v = state[k];
    params.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

// ---------------------------------------------------------------- scene
const studio = new Studio(document.getElementById('viewport'));

const metalColor = () => new THREE.Color().setRGB(...(METALS[state.metal] || METALS.yellow18).color, THREE.LinearSRGBColorSpace);

const gold = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.12, envMapIntensity: 1 });
const diamondOpts = () => ({
  envMap: studio.envMap,
  ior: 2.42,
  dispersion: state.dispersion,
  bounces: Math.round(state.bounces),
  backTint: metalColor(),
});
const materials = {
  gold,
  center: createDiamondMaterial({ planes: [], ...diamondOpts() }),
  halo: createDiamondMaterial({ planes: [], ...diamondOpts() }),
  cardinal: createDiamondMaterial({ planes: [], ...diamondOpts() }),
};

function applyMaterials() {
  const m = METALS[state.metal] || METALS.yellow18;
  gold.color.copy(metalColor());
  gold.roughness = m.roughness;
  for (const k of ['center', 'halo', 'cardinal']) {
    // Light reflected by the polished cup behind the stone: mix of neutral and metal colour.
    const warmth = k === 'center' ? state.stoneWarmth : 0.7;
    const tint = new THREE.Color(0.55, 0.55, 0.55).lerp(metalColor(), warmth);
    setDiamondOptions(materials[k], {
      dispersion: state.dispersion,
      bounces: Math.round(state.bounces),
      backTint: tint,
      goldAmbient: 0.3 * warmth,
    });
  }
  studio.needsRender = true;
}

let current = null;
function rebuild() {
  const built = buildRing(state, materials);
  if (current) disposeRing(current.group);
  current = built;
  studio.placeRing(built.group, built);
  if (state.haloAutoSize) state.haloStoneSize = Math.round(built.info.haloStoneSize * 100) / 100;
  updateSummary(built.info);
}

function updateSummary(info) {
  const shape = { round: 'round', pear: 'pear', marquise: 'marquise' }[state.cardinalShape];
  const card = state.cardinalShape === 'round' && state.cardinalScale === 1 ? '' : ` · ${shape} cardinals`;
  document.getElementById('summary').textContent =
    `${state.stoneWidth.toFixed(1)} × ${state.stoneLength.toFixed(1)} mm rose cut · ` +
    `${Math.round(state.haloCount)} × ${info.haloStoneSize.toFixed(2)} mm stones${card} · ` +
    `head ${info.headWidth.toFixed(1)} × ${info.headLength.toFixed(1)} mm · EU ${state.ringSizeEU}`;
}

// ---------------------------------------------------------------- panel
const MATERIAL_KEYS = new Set(['metal', 'dispersion', 'bounces', 'stoneWarmth']);
const STUDIO_KEYS = {
  scene: () => studio.setBackdrop(state.scene),
  exposure: () => studio.setExposure(state.exposure),
  bloom: () => studio.setBloom(state.bloom),
  autoRotate: () => studio.setAutoRotate(state.autoRotate),
};

let geometryDirty = false;
let hashTimer = 0;

function onChange(key) {
  if (STUDIO_KEYS[key]) STUDIO_KEYS[key]();
  else if (MATERIAL_KEYS.has(key)) applyMaterials();
  else geometryDirty = true;
  if (key === 'metal') geometryDirty = true; // summary only, cheap enough
  clearTimeout(hashTimer);
  hashTimer = setTimeout(writeHash, 300);
}

function applyAll() {
  applyMaterials();
  studio.setBackdrop(state.scene);
  studio.setExposure(state.exposure);
  studio.setBloom(state.bloom);
  studio.setAutoRotate(state.autoRotate);
  rebuild();
  panel.refresh();
  writeHash();
}

const actions = {
  presetA: () => { Object.assign(state, PRESETS.A); applyAll(); toast('Ring A'); },
  presetB: () => { Object.assign(state, PRESETS.B); applyAll(); toast('Ring B'); },
  viewTop: () => studio.setView('top'),
  view34: () => studio.setView('view34'),
  viewSide: () => studio.setView('side'),
  viewFront: () => studio.setView('front'),
  screenshot: () => studio.screenshot(`ring-${Date.now()}.png`),
  share: async () => {
    writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied');
    } catch {
      toast('Copy the address bar to share');
    }
  },
  reset: () => { Object.assign(state, DEFAULTS); applyAll(); toast('Reset'); },
};

const panel = createPanel(
  document.getElementById('panel'),
  document.getElementById('toolbar'),
  SCHEMA, TOOLBAR, state,
  { onChange, onAction: (a) => actions[a]?.() },
);

// Keep the ring centred in the free space next to the desktop side panel.
const panelEl = document.getElementById('panel');
function updateInset() {
  const r = panelEl.getBoundingClientRect();
  const side = r.left > window.innerWidth / 2 && r.height > 160;
  studio.setPanelInset(side ? window.innerWidth - r.left : 0);
}
new ResizeObserver(updateInset).observe(panelEl);
window.addEventListener('resize', updateInset);

// ---------------------------------------------------------------- loop
applyAll();
studio.setView('view34');

let first = true;
function frame() {
  if (geometryDirty) {
    geometryDirty = false;
    rebuild();
    if (state.haloAutoSize) panel.refresh();
    studio.needsRender = true;
  }
  studio.render();
  if (first) {
    first = false;
    document.getElementById('loading').classList.add('hidden');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug / testing hook
window.ringApp = { state, studio, actions, rebuild: () => { geometryDirty = true; } };
