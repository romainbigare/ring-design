// Short share links: ?r=hc12_cp1_tl.6
// Each setting has a fixed 2-letter code, and only values that differ from
// the frozen base below are written. Lists (selects) are stored as an index.
// This table is frozen ("v1"): never change existing codes, defaults or
// option order, only append, so old links keep opening the same ring.

const V1 = [
  // key,            code, base,       options (for selects)
  ['ringSizeEU',     'rs', 49.75],
  ['bandWidth',      'bw', 1.7],
  ['bandThickness',  'bt', 1.5],
  ['bandProfile',    'bp', 'comfort', ['comfort', 'round', 'flat']],
  ['bandTaper',      'ba', 0.85],
  ['metal',          'mt', 'yellow18', ['yellow18', 'rose18', 'white18', 'platinum']],
  ['stoneWidth',     'sw', 9.2],
  ['stoneLength',    'sl', 6],
  ['stoneDepth',     'sd', 1.26],
  ['roseRings',      'rr', 3],
  ['bezelWall',      'bz', 0.35],
  ['bezelLip',       'bl', 0.12],
  ['stoneWarmth',    'wm', 0.45],
  ['haloCount',      'hc', 16],
  ['haloStoneSize',  'hs', 1.5],
  ['haloAutoSize',   'ha', true],
  ['haloGap',        'hg', 0.1],
  ['haloSpacing',    'hp', 0.05],
  ['cupWall',        'cw', 0.32],
  ['ribbed',         'rb', true],
  ['ribDepth',       'rd', 0.045],
  ['milgrain',       'mg', true],
  ['milgrainMode',   'mm', 'both', ['both', 'inner', 'outer']],
  ['milgrainSize',   'ms', 0.13],
  ['haloPattern',    'pt', 'uniform', ['uniform', 'alternate', 'bigTwoSmall', 'bigThreeSmall', 'twoBigSmall',
    'graduatedCardinal', 'graduatedDiagonal', 'graduatedEastWest']],
  ['smallRatio',     'sr', 0.65],
  ['smallAlign',     'sa', 'middle', ['middle', 'inner', 'outer']],
  ['cardinalShape',  'cp', 'round', ['round', 'pointed', 'pear', 'marquise']],
  ['cardinalScale',  'cs', 1],
  ['tipLength',      'tl', 0.6],
  ['tipRoundness',   'tr', 0.7],
  ['legsMode',       'lm', 'auto', ['auto', 'none', 'cardinal', 'all']],
  ['legWidth',       'lw', 0.4],
  ['galleryHeight',  'gh', 1.2],
  ['scene',          'sc', 'slate', ['slate', 'studio', 'velvet', 'dark']],
  ['dispersion',     'dp', 0.012],
  ['bounces',        'bn', 5],
  ['bloom',          'bm', 0.2],
  ['exposure',       'ex', 1],
  ['autoRotate',     'ar', false],
];

const BY_CODE = new Map(V1.map((row) => [row[1], row]));

// 0.6 -> ".6", 12 -> "12", -0.25 -> "-.25"
const num = (v) => String(Number(v.toFixed(4))).replace(/^(-?)0\./, '$1.');

export function encodeDesign(state) {
  const parts = [];
  for (const [key, code, base, options] of V1) {
    if (!(key in state)) continue;
    if (key === 'haloStoneSize' && state.haloAutoSize) continue; // computed value
    const v = state[key];
    if (typeof base === 'number') {
      if (typeof v === 'number' && Math.abs(v - base) > 1e-9) parts.push(code + num(v));
    } else if (typeof base === 'boolean') {
      if (!!v !== base) parts.push(code + (v ? '1' : '0'));
    } else if (options && v !== base) {
      const i = options.indexOf(v);
      if (i >= 0) parts.push(code + i);
    }
  }
  return parts.join('_');
}

// Returns the values found in a short code (starting from the frozen base).
export function decodeDesign(str) {
  const out = {};
  for (const [key, , base] of V1) out[key] = base;
  for (const token of String(str || '').split('_')) {
    const m = /^([a-z]{2})(-?[\d.]+)$/.exec(token);
    const row = m && BY_CODE.get(m[1]);
    if (!row) continue;
    const [key, , base, options] = row;
    const n = Number(m[2]);
    if (!Number.isFinite(n)) continue;
    if (typeof base === 'number') out[key] = n;
    else if (typeof base === 'boolean') out[key] = n !== 0;
    else if (options && options[n] !== undefined) out[key] = options[n];
  }
  return out;
}
