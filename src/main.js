// App entry: state, wiring between the control panel, the ring builder and the studio.
import * as THREE from 'three';
import { DEFAULTS, PRESETS, METALS, SCHEMA, TOOLBAR } from './params.js';
import { Studio } from './studio.js';
import { buildRing, disposeRing } from './ring.js';
import { createDiamondMaterial, setDiamondOptions } from './gems.js';
import { createPanel, toast } from './ui.js';

// ---------------------------------------------------------------- state
// The design lives in the URL query (?stoneWidth=9.2&haloCount=12...), so a
// link opens the same ring. Old links with the values after '#' still work.
const state = { ...DEFAULTS, ...readUrl() };

function readUrl() {
  const out = {};
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [k, v] of new URLSearchParams(location.search)) params.set(k, v);
  for (const [k, v] of params) {
    if (!(k in DEFAULTS)) continue;
    const d = DEFAULTS[k];
    if (typeof d === 'number') { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
    else if (typeof d === 'boolean') out[k] = v === '1' || v === 'true';
    else out[k] = v;
  }
  return out;
}

const encode = (v) => (typeof v === 'boolean' ? (v ? '1' : '0')
  : typeof v === 'number' ? String(Number(v.toFixed(4))) : String(v));

// all = true: every value (for shared links, so they stay valid if the
// defaults change later). Otherwise only the values that differ.
function designParams(all = false) {
  const params = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) {
    if (!all && state[k] === DEFAULTS[k]) continue;
    if (k === 'haloStoneSize' && state.haloAutoSize) continue; // computed value
    params.set(k, encode(state[k]));
  }
  return params.toString();
}

// Keep the address bar in sync with the design (short form).
function writeUrl() {
  const q = designParams();
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : ''));
}

function shareUrl() {
  return `${location.origin}${location.pathname}?${designParams(true)}`;
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
  const shape = { round: 'round', pointed: 'pointy-collar', pear: 'pear', marquise: 'marquise' }[state.cardinalShape];
  const card = state.cardinalShape === 'round' && state.cardinalScale === 1 ? '' : ` · ${shape} cardinals`;
  document.getElementById('summary').textContent =
    `${state.stoneWidth.toFixed(1)} × ${state.stoneLength.toFixed(1)} mm rose cut · ` +
    `${Math.round(state.haloCount)} × ${info.haloStoneSize.toFixed(2)}` +
    `${state.haloPattern !== 'uniform' && state.smallRatio < 1 ? ` / ${info.haloSmallSize.toFixed(2)}` : ''} mm stones${card} · ` +
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
  hashTimer = setTimeout(writeUrl, 300);
}

function applyAll() {
  applyMaterials();
  studio.setBackdrop(state.scene);
  studio.setExposure(state.exposure);
  studio.setBloom(state.bloom);
  studio.setAutoRotate(state.autoRotate);
  rebuild();
  panel.refresh();
  writeUrl();
}

const actions = {
  presetA: () => { Object.assign(state, PRESETS.A); applyAll(); toast('Ring A'); },
  presetB: () => { Object.assign(state, PRESETS.B); applyAll(); toast('Ring B'); },
  presetC: () => { Object.assign(state, PRESETS.C); applyAll(); toast('Ring C'); },
  presetD: () => { Object.assign(state, PRESETS.D); applyAll(); toast('Ring D'); },
  viewTop: () => studio.setView('top'),
  view34: () => studio.setView('view34'),
  viewSide: () => studio.setView('side'),
  viewFront: () => studio.setView('front'),
  screenshot: () => studio.screenshot(`ring-${Date.now()}.png`),
  share: async () => {
    writeUrl();
    const url = shareUrl();
    // Phones: native share sheet. Elsewhere: copy to the clipboard.
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: 'Ring design', url });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // user closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      window.prompt('Copy this link to share the design:', url);
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

// Short hint that the ring can be turned (the only way to change the view on phones).
function showHint() {
  const el = document.getElementById('hint');
  if (!el) return;
  const touch = matchMedia('(pointer: coarse)').matches;
  el.querySelector('span').textContent = touch ? 'Drag to rotate · pinch to zoom' : 'Drag to rotate · scroll to zoom';
  const hide = () => el.classList.remove('show');
  setTimeout(() => el.classList.add('show'), 600);
  setTimeout(hide, 5000);
  studio.renderer.domElement.addEventListener('pointerdown', hide, { once: true });
}

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
    showHint();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug / testing hook
window.ringApp = { state, studio, actions, rebuild: () => { geometryDirty = true; } };
