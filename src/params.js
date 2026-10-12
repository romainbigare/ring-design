// Design parameters, defaults, presets and the control-panel schema.
// All lengths in millimetres.

export const DEFAULTS = {
  // Band
  ringSizeEU: 49.75,        // EU size = inner circumference in mm
  bandWidth: 1.7,
  bandThickness: 1.5,
  bandProfile: 'comfort',   // comfort | flat | round
  bandTaper: 0.85,          // width at the bottom of the band relative to the top
  metal: 'yellow18',

  // Centre stone (oval rose cut)
  stoneWidth: 9.2,          // across the finger (X)
  stoneLength: 6.0,         // along the finger (Z)
  stoneDepth: 1.26,
  roseRings: 3,
  bezelWall: 0.35,
  bezelLip: 0.12,
  stoneWarmth: 0.45,        // how much the gold cup behind the stone shows through

  // Entourage (halo)
  haloCount: 16,
  haloStoneSize: 1.5,
  haloAutoSize: true,
  haloGap: 0.1,             // distance between centre bezel and halo cups
  haloSpacing: 0.05,        // space between neighbouring halo cups (auto size)
  cupWall: 0.22,
  milgrain: true,
  milgrainSize: 0.13,

  // Cardinal stones (N, S, E, W)
  cardinalShape: 'round',   // round | pear | marquise
  cardinalScale: 1.0,

  // Connection legs between centre bezel and halo
  legsMode: 'auto',         // auto | none | cardinal | all
  legWidth: 0.5,

  // Gallery
  galleryHeight: 1.2,       // height of the head above the band

  // Rendering
  scene: 'studio',          // studio | velvet | dark
  dispersion: 0.012,
  bounces: 5,
  bloom: 0.2,
  exposure: 1.0,
  autoRotate: false,
};

export const PRESETS = {
  // Top ring of the photo: 12 halo stones, a bit more space.
  A: {
    stoneWidth: 9.2, stoneLength: 6.0, stoneDepth: 1.26,
    haloCount: 12, haloAutoSize: true, haloGap: 0.15, haloSpacing: 0.18,
    cardinalShape: 'round', cardinalScale: 1.0, milgrain: true,
  },
  // Bottom ring of the photo: 16 halo stones, tight entourage.
  B: {
    stoneWidth: 9.2, stoneLength: 6.0, stoneDepth: 1.26,
    haloCount: 16, haloAutoSize: true, haloGap: 0.08, haloSpacing: 0.05,
    cardinalShape: 'round', cardinalScale: 1.0, milgrain: true,
  },
};

export const METALS = {
  yellow18: { label: '18k yellow gold', color: [1.0, 0.74, 0.33], roughness: 0.12 },
  rose18:   { label: '18k rose gold',   color: [0.98, 0.62, 0.48], roughness: 0.12 },
  white18:  { label: '18k white gold',  color: [0.86, 0.85, 0.82], roughness: 0.10 },
  platinum: { label: 'Platinum',        color: [0.78, 0.76, 0.73], roughness: 0.10 },
};

// Control panel schema. type: range | select | toggle | buttons
export const SCHEMA = [
  {
    folder: 'Design', open: true, items: [
      { type: 'buttons', items: [
        { label: 'Ring A (12 stones)', action: 'presetA' },
        { label: 'Ring B (16 stones)', action: 'presetB' },
      ] },
    ],
  },
  {
    folder: 'Centre diamond', open: true, items: [
      { key: 'stoneWidth', label: 'Width', type: 'range', min: 6, max: 12, step: 0.1, unit: 'mm' },
      { key: 'stoneLength', label: 'Height', type: 'range', min: 4, max: 9, step: 0.1, unit: 'mm' },
      { key: 'stoneDepth', label: 'Depth', type: 'range', min: 0.8, max: 3, step: 0.01, unit: 'mm' },
      { key: 'roseRings', label: 'Rose facet rings', type: 'range', min: 2, max: 4, step: 1 },
      { key: 'stoneWarmth', label: 'Gold glow in stone', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'bezelWall', label: 'Bezel wall', type: 'range', min: 0.2, max: 0.8, step: 0.01, unit: 'mm' },
    ],
  },
  {
    folder: 'Entourage', open: true, items: [
      { key: 'haloCount', label: 'Number of stones', type: 'range', min: 8, max: 26, step: 1 },
      { key: 'haloAutoSize', label: 'Auto size stones', type: 'toggle' },
      { key: 'haloStoneSize', label: 'Stone size', type: 'range', min: 0.8, max: 3, step: 0.05, unit: 'mm' },
      { key: 'haloSpacing', label: 'Space between stones', type: 'range', min: 0, max: 0.8, step: 0.01, unit: 'mm' },
      { key: 'haloGap', label: 'Distance to centre', type: 'range', min: 0, max: 2.5, step: 0.01, unit: 'mm' },
      { key: 'cupWall', label: 'Setting wall', type: 'range', min: 0.12, max: 0.5, step: 0.01, unit: 'mm' },
      { key: 'milgrain', label: 'Milgrain beads', type: 'toggle' },
      { key: 'milgrainSize', label: 'Bead size', type: 'range', min: 0.06, max: 0.25, step: 0.005, unit: 'mm' },
    ],
  },
  {
    folder: 'Cardinal stones', open: true, items: [
      { key: 'cardinalShape', label: 'Shape', type: 'select', options: [
        { value: 'round', label: 'Round' },
        { value: 'pear', label: 'Pear (pointy)' },
        { value: 'marquise', label: 'Marquise (pointy)' },
      ] },
      { key: 'cardinalScale', label: 'Size', type: 'range', min: 0.8, max: 2.2, step: 0.05, unit: '×' },
    ],
  },
  {
    folder: 'Connection legs', open: false, items: [
      { key: 'legsMode', label: 'Legs', type: 'select', options: [
        { value: 'auto', label: 'Auto (when far)' },
        { value: 'none', label: 'None' },
        { value: 'cardinal', label: 'Cardinal only' },
        { value: 'all', label: 'Every stone' },
      ] },
      { key: 'legWidth', label: 'Leg width', type: 'range', min: 0.25, max: 1.0, step: 0.01, unit: 'mm' },
      { key: 'galleryHeight', label: 'Head height', type: 'range', min: 0.6, max: 3, step: 0.05, unit: 'mm' },
    ],
  },
  {
    folder: 'Band', open: false, items: [
      { key: 'ringSizeEU', label: 'Size (EU)', type: 'range', min: 44, max: 64, step: 0.25 },
      { key: 'metal', label: 'Metal', type: 'select', options: Object.entries(METALS).map(([value, m]) => ({ value, label: m.label })) },
      { key: 'bandWidth', label: 'Width', type: 'range', min: 1.2, max: 3, step: 0.05, unit: 'mm' },
      { key: 'bandThickness', label: 'Thickness', type: 'range', min: 1.0, max: 2.2, step: 0.05, unit: 'mm' },
      { key: 'bandTaper', label: 'Taper', type: 'range', min: 0.6, max: 1, step: 0.01 },
      { key: 'bandProfile', label: 'Profile', type: 'select', options: [
        { value: 'comfort', label: 'Comfort fit' },
        { value: 'round', label: 'Round (D shape)' },
        { value: 'flat', label: 'Flat' },
      ] },
    ],
  },
  {
    folder: 'Studio', open: false, items: [
      { key: 'scene', label: 'Backdrop', type: 'select', options: [
        { value: 'studio', label: 'White studio' },
        { value: 'velvet', label: 'Black velvet' },
        { value: 'dark', label: 'Dark grey' },
      ] },
      { key: 'exposure', label: 'Exposure', type: 'range', min: 0.4, max: 2, step: 0.01 },
      { key: 'bloom', label: 'Sparkle glow', type: 'range', min: 0, max: 1.5, step: 0.01 },
      { key: 'dispersion', label: 'Fire (dispersion)', type: 'range', min: 0, max: 0.04, step: 0.001 },
      { key: 'bounces', label: 'Light bounces', type: 'range', min: 1, max: 8, step: 1 },
      { key: 'autoRotate', label: 'Turn table', type: 'toggle' },
    ],
  },
];

// Actions shown as a toolbar (outside folders).
export const TOOLBAR = [
  { label: 'Top', action: 'viewTop' },
  { label: '3/4', action: 'view34' },
  { label: 'Side', action: 'viewSide' },
  { label: 'Hand', action: 'viewFront' },
  { label: 'Photo', action: 'screenshot' },
  { label: 'Share link', action: 'share' },
  { label: 'Reset', action: 'reset' },
];
