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
  cupWall: 0.32,             // width of the gold collar around each halo stone
  ribbed: true,             // radial ribs on the collar
  ribDepth: 0.045,
  milgrain: true,
  milgrainMode: 'both',     // inner | outer | both
  milgrainSize: 0.13,

  // Size pattern of the entourage stones
  haloPattern: 'uniform',   // see HALO_PATTERNS in ring.js
  smallRatio: 0.65,         // small stone size relative to the big ones
  smallAlign: 'middle',     // inner | middle | outer: where small stones sit

  // Cardinal stones (N, S, E, W)
  cardinalShape: 'round',   // round | pointed | pear | marquise
  cardinalScale: 1.0,
  tipLength: 0.6,           // length of the gold point ('pointed' setting)
  tipRoundness: 0.7,        // 0 = straight sides, sharp point; 1 = round pear

  // Connection arms between centre bezel and halo
  legsMode: 'auto',         // auto | none | cardinal | all
  legWidth: 0.4,

  // Gallery
  galleryHeight: 1.2,       // height of the head above the band

  // Rendering
  scene: 'slate',           // slate | studio | velvet | dark
  dispersion: 0.012,
  bounces: 5,
  bloom: 0.2,
  exposure: 1.0,
  autoRotate: false,
};

export const PRESETS = {
  // Top ring of the first photo: 12 halo stones, a bit more space.
  A: {
    stoneWidth: 9.2, stoneLength: 6.0, stoneDepth: 1.26,
    haloCount: 12, haloAutoSize: true, haloGap: 0.15, haloSpacing: 0.18, cupWall: 0.26,
    cardinalShape: 'round', cardinalScale: 1.0,
    ribbed: false, milgrain: true, milgrainMode: 'outer', legsMode: 'auto',
    haloPattern: 'uniform',
  },
  // Bottom ring of the first photo: 16 halo stones, tight entourage.
  B: {
    stoneWidth: 9.2, stoneLength: 6.0, stoneDepth: 1.26,
    haloCount: 16, haloAutoSize: true, haloGap: 0.08, haloSpacing: 0.05, cupWall: 0.24,
    cardinalShape: 'round', cardinalScale: 1.0,
    ribbed: false, milgrain: true, milgrainMode: 'outer', legsMode: 'auto',
    haloPattern: 'uniform',
  },
  // Big / small pattern variation of ring B.
  D: {
    stoneWidth: 9.2, stoneLength: 6.0, stoneDepth: 1.26,
    haloCount: 16, haloAutoSize: true, haloGap: 0.1, haloSpacing: 0.06, cupWall: 0.26,
    cardinalShape: 'round', cardinalScale: 1.0,
    ribbed: false, milgrain: true, milgrainMode: 'outer', legsMode: 'auto',
    haloPattern: 'alternate', smallRatio: 0.62, smallAlign: 'middle',
  },
  // Second photo: ribbed collars, cardinal collars drawn out into points.
  C: {
    stoneWidth: 9.2, stoneLength: 6.0, stoneDepth: 1.26,
    haloCount: 12, haloAutoSize: true, haloGap: 0.12, haloSpacing: 0.06, cupWall: 0.34,
    cardinalShape: 'pointed', cardinalScale: 1.3, tipLength: 0.6, tipRoundness: 0.7,
    ribbed: true, ribDepth: 0.045, milgrain: true, milgrainMode: 'inner', legsMode: 'auto',
    haloPattern: 'uniform',
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
    folder: 'Centre diamond', open: false, items: [
      { key: 'stoneWidth', label: 'Width', type: 'range', min: 6, max: 12, step: 0.1, unit: 'mm' },
      { key: 'stoneLength', label: 'Height', type: 'range', min: 4, max: 9, step: 0.1, unit: 'mm' },
      { key: 'stoneDepth', label: 'Depth', type: 'range', min: 0.8, max: 3, step: 0.01, unit: 'mm' },
      { key: 'roseRings', label: 'Rose facet rings', type: 'range', min: 2, max: 4, step: 1 }, // 2 = Dutch rose (24 facets)
      { key: 'stoneWarmth', label: 'Gold glow in stone', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'bezelWall', label: 'Bezel wall', type: 'range', min: 0.2, max: 0.8, step: 0.01, unit: 'mm' },
    ],
  },
  {
    folder: 'Entourage', open: false, items: [
      { key: 'haloCount', label: 'Number of stones', type: 'range', min: 8, max: 26, step: 1 },
      { key: 'haloAutoSize', label: 'Auto size stones', type: 'toggle' },
      { key: 'haloStoneSize', label: 'Stone size (big)', type: 'range', min: 0.8, max: 3, step: 0.05, unit: 'mm', when: (s) => !s.haloAutoSize },
      { key: 'haloSpacing', label: 'Space between stones', type: 'range', min: 0, max: 0.8, step: 0.01, unit: 'mm', when: (s) => s.haloAutoSize },
      { key: 'haloGap', label: 'Distance to centre', type: 'range', min: 0, max: 2.5, step: 0.01, unit: 'mm' },
      { key: 'cupWall', label: 'Setting collar', type: 'range', min: 0.12, max: 0.8, step: 0.01, unit: 'mm' },
      { key: 'ribbed', label: 'Ribbed collar', type: 'toggle' },
      { key: 'ribDepth', label: 'Rib depth', type: 'range', min: 0.01, max: 0.1, step: 0.005, unit: 'mm', when: (s) => s.ribbed },
      { key: 'milgrain', label: 'Milgrain beads', type: 'toggle' },
      { key: 'milgrainMode', label: 'Beads position', type: 'select', when: (s) => s.milgrain, options: [
        { value: 'both', label: 'Stone + outer edge' },
        { value: 'inner', label: 'Around the stone' },
        { value: 'outer', label: 'Outer edge' },
      ] },
      { key: 'milgrainSize', label: 'Bead size', type: 'range', min: 0.06, max: 0.25, step: 0.005, unit: 'mm', when: (s) => s.milgrain },
    ],
  },
  {
    folder: 'Stone pattern', open: false, items: [
      { key: 'haloPattern', label: 'Pattern', type: 'select', options: [
        { value: 'uniform', label: 'All the same' },
        { value: 'alternate', label: 'Big · small · big · small' },
        { value: 'bigTwoSmall', label: 'Big · small · small' },
        { value: 'bigThreeSmall', label: 'Big · 3 small' },
        { value: 'twoBigSmall', label: 'Big · big · small' },
        { value: 'graduatedCardinal', label: 'Graduated, big at N/S/E/W' },
        { value: 'graduatedDiagonal', label: 'Graduated, big at diagonals' },
        { value: 'graduatedEastWest', label: 'Graduated, big at the sides' },
      ] },
      { key: 'smallRatio', label: 'Small stone size', type: 'range', min: 0.35, max: 1, step: 0.01, unit: '×', when: (s) => s.haloPattern !== 'uniform' },
      { key: 'smallAlign', label: 'Small stones line', type: 'select', when: (s) => s.haloPattern !== 'uniform', options: [
        { value: 'middle', label: 'Centred' },
        { value: 'inner', label: 'Inner edge' },
        { value: 'outer', label: 'Outer edge' },
      ] },
    ],
  },
  {
    folder: 'Cardinal stones', open: false, items: [
      { key: 'cardinalShape', label: 'Shape', type: 'select', options: [
        { value: 'round', label: 'Round' },
        { value: 'pointed', label: 'Round, pointy collar' },
        { value: 'pear', label: 'Pear (pointy)' },
        { value: 'marquise', label: 'Marquise (pointy)' },
      ] },
      { key: 'cardinalScale', label: 'Size', type: 'range', min: 0.8, max: 2.2, step: 0.05, unit: '×' },
      { key: 'tipLength', label: 'Point length', type: 'range', min: 0.2, max: 2, step: 0.05, unit: 'mm', when: (s) => s.cardinalShape === 'pointed' },
      { key: 'tipRoundness', label: 'Point shape', type: 'range', min: 0, max: 1, step: 0.01, when: (s) => s.cardinalShape === 'pointed' }, // 0 sharp … 1 pear
    ],
  },
  {
    folder: 'Connection arms', open: false, items: [
      { key: 'legsMode', label: 'Arms', type: 'select', options: [
        { value: 'auto', label: 'Auto (when not touching)' },
        { value: 'none', label: 'None' },
        { value: 'cardinal', label: 'Cardinal only' },
        { value: 'all', label: 'Every stone' },
      ] },
      { key: 'legWidth', label: 'Arm width', type: 'range', min: 0.25, max: 1.0, step: 0.01, unit: 'mm', when: (s) => s.legsMode !== 'none' },
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
        { value: 'slate', label: 'Dark slate' },
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
// `view: true` buttons are camera presets; they are hidden on phones,
// where you simply drag to rotate.
export const TOOLBAR = [
  { label: 'Top', action: 'viewTop', view: true },
  { label: '3/4', action: 'view34', view: true },
  { label: 'Side', action: 'viewSide', view: true },
  { label: 'Hand', action: 'viewFront', view: true },
  { label: 'Photo', action: 'screenshot' },
  { label: 'Reset', action: 'reset' },
];
