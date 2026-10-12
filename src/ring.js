// Parametric ring geometry: band, centre bezel, entourage cups, milgrain,
// connection legs and under-gallery. Units: millimetres.
// Axes: finger axis = Z, band in the XY plane, head on top (+Y).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRoseCut, buildBrilliant, setDiamondPlanes } from './gems.js';

const ROSE_GIRDLE = 0.12;

// ------------------------------------------------------------------ helpers

// Replace every corner of a closed 2D polyline by a small rounded fillet.
function roundCorners(points, radius, segs = 3) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    const da = a.clone().sub(p), db = b.clone().sub(p);
    const r = Math.min(radius, da.length() * 0.45, db.length() * 0.45);
    da.normalize(); db.normalize();
    const p0 = p.clone().addScaledVector(da, r);
    const p2 = p.clone().addScaledVector(db, r);
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      // quadratic Bézier p0 -> p -> p2
      out.push(new THREE.Vector2(
        (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p.x + t * t * p2.x,
        (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p.y + t * t * p2.y,
      ));
    }
  }
  return out;
}

// Outward 2D normals of a closed convex outline (x, z).
function outlineNormals(outline) {
  const n = outline.length;
  const c = new THREE.Vector2();
  outline.forEach((p) => c.add(p));
  c.multiplyScalar(1 / n);
  return outline.map((p, i) => {
    const t = outline[(i + 1) % n].clone().sub(outline[(i - 1 + n) % n]);
    const nn = new THREE.Vector2(t.y, -t.x).normalize();
    if (nn.dot(p.clone().sub(c)) < 0) nn.negate();
    return nn;
  });
}

// Resample a closed outline to `count` points evenly spaced by arc length.
function resampleClosed(outline, count) {
  const n = outline.length;
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + outline[i].distanceTo(outline[(i + 1) % n]));
  const total = cum[n];
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * total;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    out.push(outline[j].clone().lerp(outline[(j + 1) % n], t));
  }
  return out;
}

function perimeter(outline) {
  let s = 0;
  for (let i = 0; i < outline.length; i++) s += outline[i].distanceTo(outline[(i + 1) % outline.length]);
  return s;
}

// Sweep a closed profile (o = outward offset from the outline, y = height)
// along a closed outline in the XZ plane. Returns a smooth indexed geometry.
function sweepClosed(outline, profile) {
  const normals = outlineNormals(outline);
  const nI = outline.length, nJ = profile.length;
  const pos = new Float32Array(nI * nJ * 3);
  for (let i = 0; i < nI; i++) {
    const p = outline[i], nn = normals[i];
    for (let j = 0; j < nJ; j++) {
      const [o, y] = profile[j];
      const k = (i * nJ + j) * 3;
      pos[k] = p.x + nn.x * o;
      pos[k + 1] = y;
      pos[k + 2] = p.y + nn.y * o;
    }
  }
  const idx = [];
  for (let i = 0; i < nI; i++) {
    const i2 = (i + 1) % nI;
    for (let j = 0; j < nJ; j++) {
      const j2 = (j + 1) % nJ;
      const a = i * nJ + j, b = i2 * nJ + j, c = i2 * nJ + j2, d = i * nJ + j2;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Winding check: the vertex with the largest outward offset must have a
  // normal pointing outward.
  let jMax = 0;
  profile.forEach(([o], j) => { if (o > profile[jMax][0]) jMax = j; });
  const nAttr = g.attributes.normal;
  const nx = nAttr.getX(jMax), nz = nAttr.getZ(jMax);
  if (nx * normals[0].x + nz * normals[0].y < 0) flipIndex(g);
  return g;
}

function flipIndex(g) {
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
}

// Ellipse helpers (a along X, b along Z).
function ellipsePoint(a, b, t, d = 0) {
  const n = new THREE.Vector2(b * Math.cos(t), a * Math.sin(t)).normalize();
  return { p: new THREE.Vector2(a * Math.cos(t) + n.x * d, b * Math.sin(t) + n.y * d), n };
}

function ellipseOutline(a, b, d, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push(ellipsePoint(a, b, (i / count) * Math.PI * 2, d).p);
  return pts;
}

// Arc-length parametrisation of an offset ellipse.
function arcTable(a, b, d, samples = 2048) {
  const ts = [0], ss = [0];
  let prev = ellipsePoint(a, b, 0, d).p;
  for (let i = 1; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const p = ellipsePoint(a, b, t, d).p;
    ss.push(ss[i - 1] + p.distanceTo(prev));
    ts.push(t);
    prev = p;
  }
  const total = ss[samples];
  return {
    total,
    tAt(s) {
      s = ((s % total) + total) % total;
      let lo = 0, hi = samples;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ss[m] < s) lo = m; else hi = m; }
      const f = (s - ss[lo]) / Math.max(1e-9, ss[hi] - ss[lo]);
      return ts[lo] + (ts[hi] - ts[lo]) * f;
    },
  };
}

function indexOf(g) {
  const n = g.attributes.position.count;
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

function ellipsePerimeter(a, b) {
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function smoothstep(e0, e1, x) {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------ gem cache
const gemCache = new Map();
function cachedGem(key, make) {
  if (!gemCache.has(key)) {
    const g = make();
    g.geometry.userData.cached = true;
    gemCache.set(key, g);
    if (gemCache.size > 60) { // drop the oldest entry
      const [k, v] = gemCache.entries().next().value;
      v.geometry.dispose();
      gemCache.delete(k);
    }
  }
  return gemCache.get(key);
}
const r3 = (x) => Math.round(x * 1000) / 1000;

// ------------------------------------------------------------------ band
function buildBand(P, head) {
  const R = P.ringSizeEU / (2 * Math.PI);
  const t = P.bandThickness;
  const exps = { comfort: [2.6, 3.4], round: [2.2, 10], flat: [8, 8] }[P.bandProfile] || [2.6, 3.4];
  const nT = 400, nP = 48;
  const prof = [];
  for (let j = 0; j < nP; j++) {
    const s = (j / nP) * Math.PI * 2;
    const c = Math.cos(s), sn = Math.sin(s);
    const e = sn >= 0 ? exps[0] : exps[1];
    prof.push([Math.sign(c) * Math.pow(Math.abs(c), 2 / e), 0.5 + 0.5 * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e)]);
  }
  // Shoulders: under the head the band grows up to meet the gallery.
  const outerTop = R + t;
  const thetaH = Math.asin(Math.min(0.95, (head.halfWidth * 0.62) / (head.bottomY + 0.2)));
  const extra = (th) => {
    const a = Math.abs(th);
    if (a > thetaH) return 0;
    const need = head.bottomY / Math.cos(a) + 0.15 - outerTop;
    return Math.max(0, need) * (1 - smoothstep(thetaH * 0.55, thetaH, a));
  };
  const pos = new Float32Array(nT * nP * 3);
  for (let i = 0; i < nT; i++) {
    const th = (i / nT) * Math.PI * 2 - Math.PI; // -π..π, 0 = top
    const bottomness = (1 - Math.cos(th)) / 2;
    const width = P.bandWidth * THREE.MathUtils.lerp(1, P.bandTaper, bottomness);
    const thick = t + extra(th);
    const sx = Math.sin(th), cy = Math.cos(th);
    for (let j = 0; j < nP; j++) {
      const [u, v] = prof[j];
      const r = R + v * thick;
      const k = (i * nP + j) * 3;
      pos[k] = r * sx;
      pos[k + 1] = r * cy;
      pos[k + 2] = u * width * 0.5;
    }
  }
  const idx = [];
  for (let i = 0; i < nT; i++) {
    const i2 = (i + 1) % nT;
    for (let j = 0; j < nP; j++) {
      const j2 = (j + 1) % nP;
      const a = i * nP + j, b = i2 * nP + j, c = i2 * nP + j2, d = i * nP + j2;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outermost profile point at the bottom of the ring must point down (-Y)
  let jMax = 0;
  prof.forEach(([, v], j) => { if (v > prof[jMax][1]) jMax = j; });
  const iBottom = 0; // th = -π -> bottom
  if (g.attributes.normal.getY(iBottom * nP + jMax) > 0) flipIndex(g);
  return { geometry: g, bottomY: -(R + t), innerRadius: R };
}

// ------------------------------------------------------------------ head
function cupProfile({ wall, lip, yTop, yBot, inner, roundR = 0.05, foot = wall * 0.55 }) {
  // Closed profile (outward offset o, y). Tapered outer wall, lip over the stone.
  const pts = [
    new THREE.Vector2(-lip, yTop - 0.04),
    new THREE.Vector2(-lip * 0.6, yTop),
    new THREE.Vector2(wall, yTop),
    new THREE.Vector2(wall, yTop - (yTop - yBot) * 0.3),
    new THREE.Vector2(foot, yBot),
    new THREE.Vector2(-inner, yBot),
    new THREE.Vector2(-inner, yBot + 0.12),
    new THREE.Vector2(0, yTop - 0.18),
  ];
  return roundCorners(pts, roundR, 3).map((p) => [p.x, p.y]);
}

// Gold point that extends a round cup outward along +Z (local): a rounded
// ridge that narrows and slopes down to a point.
// r = radius where it joins the cup wall, tipZ = distance of the point.
function buildPointedTip(r, tipZ, y0, y1) {
  const phi = Math.acos(Math.min(0.999, r / tipZ));
  const zt = r * Math.cos(phi), ht = r * Math.sin(phi); // tangent point
  const z0 = zt - 0.2;
  const nZ = 24, nU = 16;
  const ring = []; // cross-section loop: rounded top (u -1..1) then flat bottom
  for (let k = 0; k <= nU; k++) ring.push(-1 + (2 * k) / nU);
  const pos = [];
  for (let i = 0; i <= nZ; i++) {
    const f = i / nZ;
    const z = z0 + (tipZ - z0) * f;
    const hw = Math.max(0.01, ht * (tipZ - z) / (tipZ - zt));
    const top = y1 - 0.22 * Math.pow(Math.max(0, (z - zt) / (tipZ - zt)), 1.3);
    for (const u of ring) {
      const dome = Math.pow(Math.max(0, 1 - Math.abs(u) ** 2.2), 0.45);
      pos.push(u * hw, y0 + (top - y0) * (0.35 + 0.65 * dome), z);
    }
    pos.push(0, y0, z); // bottom centre closes the loop
  }
  const nR = ring.length + 1;
  const idx = [];
  for (let i = 0; i < nZ; i++) {
    for (let j = 0; j < nR; j++) {
      const j2 = (j + 1) % nR;
      const a = i * nR + j, b = (i + 1) * nR + j, c = (i + 1) * nR + j2, d = i * nR + j2;
      idx.push(a, d, b, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the top-centre vertex of the middle section must point up
  if (g.attributes.normal.getY((nZ >> 1) * nR + (nU >> 1)) < 0) flipIndex(g);
  return g;
}

// Closed outline (x, z) of a circle of radius r with a point at +Z.
function pointedOutline(r, tipZ, count) {
  const phi = Math.acos(Math.min(0.999, r / tipZ));
  const pts = [new THREE.Vector2(0, tipZ)];
  const segs = 64;
  for (let k = 0; k <= segs; k++) {
    const ang = phi + ((2 * Math.PI - 2 * phi) * k) / segs;
    pts.push(new THREE.Vector2(r * Math.sin(ang), r * Math.cos(ang)));
  }
  return resampleClosed(pts, count);
}

function addMilgrain(list, outline, offset, y, beadR) {
  const normals = outlineNormals(outline);
  const shifted = outline.map((p, i) => p.clone().addScaledVector(normals[i], offset));
  const count = Math.max(6, Math.floor(perimeter(shifted) / (beadR * 2.15)));
  for (const p of resampleClosed(shifted, count)) list.push(new THREE.Vector3(p.x, y, p.y));
}

export function buildRing(P, materials) {
  const gold = materials.gold;
  const goldGeoms = [];
  const group = new THREE.Group();
  const R = P.ringSizeEU / (2 * Math.PI);
  const ySeat = R + P.bandThickness + P.galleryHeight; // underside of the centre stone

  // ---- centre stone (oval rose cut) -------------------------------------
  const W = P.stoneWidth, L = P.stoneLength;
  const rose = cachedGem(`rose|${r3(W)}|${r3(L)}|${r3(P.stoneDepth)}|${P.roseRings}`,
    () => buildRoseCut({ width: W, length: L, depth: P.stoneDepth, girdle: ROSE_GIRDLE, rings: P.roseRings }));
  setDiamondPlanes(materials.center, rose.planes);
  const centre = new THREE.Mesh(rose.geometry, materials.center);
  centre.position.y = ySeat;
  centre.castShadow = true;
  group.add(centre);

  // Bezel: smooth gold rim, slightly folded over the stone edge.
  const a = W / 2, b = L / 2;
  const bezelOutline = ellipseOutline(a, b, 0, 160);
  const bezelTop = ySeat + ROSE_GIRDLE + 0.2;
  const bezelBot = ySeat - 0.55;
  goldGeoms.push(sweepClosed(bezelOutline, cupProfile({
    wall: P.bezelWall, lip: P.bezelLip, yTop: bezelTop, yBot: bezelBot, inner: Math.min(1.4, b * 0.5), roundR: 0.07,
  })));

  // ---- entourage layout ---------------------------------------------------
  const N = Math.round(P.haloCount);
  const w = P.cupWall;
  const d0 = P.bezelWall + P.haloGap + w; // offset from stone outline to inner edge of halo stones
  const cardinalIdx = new Set();
  if (N % 4 === 0) [0, N / 4, N / 2, (3 * N) / 4].forEach((i) => cardinalIdx.add(i));
  else if (N % 2 === 0) [0, N / 2].forEach((i) => cardinalIdx.add(i));
  else cardinalIdx.add(0);
  const shape = P.cardinalShape;
  const cs = P.cardinalScale;
  const nCard = cardinalIdx.size;
  // tangential size of a stone relative to the base diameter D
  const tanFactor = (i) => (cardinalIdx.has(i) ? cs : 1);
  const K = (N - nCard) + nCard * cs;

  let D;
  if (P.haloAutoSize) {
    const Pb = ellipsePerimeter(a, b);
    // path through round stone centres: Pb + 2π(d0 + D/2); stones + gaps must fill it.
    // Small factor compensates for chord vs arc on the curved ends.
    D = (Pb + 2 * Math.PI * d0 - N * (2 * w + P.haloSpacing)) / (K * 1.015 - Math.PI);
    D = THREE.MathUtils.clamp(D, 0.6, 4);
  } else {
    D = P.haloStoneSize;
  }

  const roundGem = cachedGem(`b|round|${r3(D)}`, () => buildBrilliant({ shape: 'round', width: D, length: D, girdle: 0.03 * D }));
  const cw = D * cs;
  const cl = shape === 'pear' ? cw * 1.45 : shape === 'marquise' ? cw * 2.0 : cw;
  const pointed = shape === 'pointed'; // round stone in a setting with a gold point
  const gemShape = pointed ? 'round' : shape;
  const cardGem = cachedGem(`b|${gemShape}|${r3(cw)}|${r3(cl)}`, () => buildBrilliant({ shape: gemShape, width: cw, length: cl, girdle: 0.03 * cw }));
  setDiamondPlanes(materials.halo, roundGem.planes);
  setDiamondPlanes(materials.cardinal, cardGem.planes);

  const path = arcTable(a, b, d0 + D / 2);
  const ext = [];
  let sumL = 0;
  for (let i = 0; i < N; i++) { ext.push(D * tanFactor(i)); sumL += ext[i]; }
  const gap = (path.total - sumL) / N;
  const sPos = [0];
  for (let i = 1; i < N; i++) sPos.push(sPos[i - 1] + (ext[i - 1] + ext[i]) / 2 + gap);

  const haloGirdleY = ySeat + 0.3;
  const beads = [];
  const beadR = P.milgrainSize / 2;
  let lowest = bezelBot;
  let maxX = a + P.bezelWall;
  let maxZ = b + P.bezelWall;
  const stones = [];

  for (let i = 0; i < N; i++) {
    const isCard = cardinalIdx.has(i);
    const gem = isCard ? cardGem : roundGem;
    const t = path.tAt(sPos[i]);
    const { p, n } = ellipsePoint(a, b, t, 0);
    // inner extent of the stone along its local -Z
    let minZ = Infinity;
    for (const q of gem.outline) minZ = Math.min(minZ, q.y);
    const off = d0 - minZ;
    const cx = p.x + n.x * off, cz = p.y + n.y * off;
    const rotY = Math.atan2(n.x, n.y);
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(cx, 0, cz);

    const mesh = new THREE.Mesh(gem.geometry, isCard ? materials.cardinal : materials.halo);
    mesh.position.set(cx, haloGirdleY, cz);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    group.add(mesh);
    stones.push({ t, n, p });

    const gw = isCard ? cw : D;
    const g = gem.girdle ?? 0.03 * gw;
    const yTop = haloGirdleY + g / 2 + 0.1;
    const yBot = haloGirdleY - gem.pavilionDepth - 0.12;
    lowest = Math.min(lowest, yBot);
    const outline = resampleClosed(gem.outline, 72);
    const cup = sweepClosed(outline, cupProfile({ wall: w, lip: 0.05, yTop, yBot, inner: gw * 0.22, roundR: 0.04, foot: -gw * 0.1 }));
    cup.applyMatrix4(m);
    goldGeoms.push(cup);

    let beadPath = outline, beadOffset = w * 0.5;
    let reach = 0; // outward reach of the setting beyond the stone outline
    if (isCard && pointed) {
      const r = gw / 2;
      const tipZ = r + w + P.tipLength;
      const tip = buildPointedTip(r + w * 0.5, tipZ, yTop - Math.min(0.45, (yTop - yBot) * 0.6), yTop);
      tip.applyMatrix4(m);
      goldGeoms.push(tip);
      beadPath = pointedOutline(r + w * 0.5, tipZ - 0.12, 72);
      beadOffset = 0;
      reach = tipZ - r;
    }
    if (P.milgrain) {
      const local = [];
      addMilgrain(local, beadPath, beadOffset, yTop + beadR * 0.35, beadR);
      for (const v of local) beads.push(v.applyMatrix4(m));
    }
    for (const q of gem.outline) maxX = Math.max(maxX, Math.abs(cx + q.x * Math.cos(rotY) + q.y * Math.sin(rotY)) + w);
    maxX = Math.max(maxX, Math.abs(cx + n.x * (gw / 2 + reach)));
    maxZ = Math.max(maxZ, Math.abs(cz + n.y * (gw / 2 + reach)) + (isCard ? 0 : w), Math.abs(cz) + gw / 2 + w);
  }

  // ---- connection legs ----------------------------------------------------
  let legs = P.legsMode;
  if (legs === 'auto') legs = P.haloGap > 0.3 ? 'all' : 'none';
  const legAt = [];
  if (legs === 'all') stones.forEach((s) => legAt.push(s.t));
  if (legs === 'cardinal') legAt.push(0, Math.PI / 2, Math.PI, Math.PI * 1.5);
  if (legAt.length) {
    const len = P.haloGap + 0.3;
    const h = 0.45;
    const legGeo = new RoundedBoxGeometry(len, h, P.legWidth, 2, Math.min(0.12, P.legWidth * 0.3, h * 0.3));
    legGeo.deleteAttribute('uv');
    for (const t of legAt) {
      const { p, n } = ellipsePoint(a, b, t, 0);
      const mid = P.bezelWall - 0.15 + len / 2;
      const g = legGeo.clone();
      const m = new THREE.Matrix4()
        .makeRotationY(Math.atan2(n.x, n.y) - Math.PI / 2)
        .setPosition(p.x + n.x * mid, ySeat - 0.05, p.y + n.y * mid);
      g.applyMatrix4(m);
      goldGeoms.push(g);
    }
    legGeo.dispose();
  }

  // ---- under-gallery rail ------------------------------------------------
  const railR = 0.28;
  const railY = lowest + 0.1;
  const railProfile = [];
  for (let k = 0; k < 14; k++) {
    const s = (k / 14) * Math.PI * 2;
    railProfile.push([Math.cos(s) * railR, railY + Math.sin(s) * railR]);
  }
  goldGeoms.push(sweepClosed(ellipseOutline(a, b, d0 + D * 0.42, 160), railProfile));

  // ---- band ---------------------------------------------------------------
  const band = buildBand(P, { bottomY: lowest + 0.05, halfWidth: maxX });
  goldGeoms.push(band.geometry);

  // ---- merge the gold ----------------------------------------------------
  // mergeGeometries needs identical attributes and indexing on every part.
  const merged = mergeGeometries(goldGeoms.map((g) => {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g.index ? g : indexOf(g);
  }), false);
  goldGeoms.forEach((g) => g.dispose());
  const goldMesh = new THREE.Mesh(merged, gold);
  goldMesh.castShadow = true;
  goldMesh.receiveShadow = true;
  group.add(goldMesh);

  if (beads.length) {
    const bead = new THREE.IcosahedronGeometry(beadR, 2);
    const inst = new THREE.InstancedMesh(bead, gold, beads.length);
    const m = new THREE.Matrix4();
    beads.forEach((v, i) => inst.setMatrixAt(i, m.makeTranslation(v.x, v.y, v.z)));
    inst.castShadow = true;
    group.add(inst);
  }

  const headL = 2 * maxZ;
  return {
    group,
    bottomY: band.bottomY,
    focusY: ySeat + P.stoneDepth * 0.5,
    width: P.bandWidth,
    info: { haloStoneSize: D, headWidth: 2 * maxX, headLength: headL, innerDiameter: 2 * R },
  };
}

export function disposeRing(group) {
  group.traverse((o) => {
    if (o.geometry && !o.geometry.userData.cached) o.geometry.dispose();
  });
}
