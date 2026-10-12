// Diamond geometry (convex polyhedra) and an analytic ray-traced diamond material.
// Units: millimetres. See CONTRACT.md.
import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

export const MAX_PLANES = 96;
const MAX_BOUNCES = 12;

// ---------------------------------------------------------------------------
// Hull helpers
// ---------------------------------------------------------------------------

// Convex hull of points -> flat-shaded non-indexed geometry + merged facet planes.
function hullToStone(points, label) {
  const hull = new ConvexHull().setFromPoints(points);
  const pos = [];
  const nor = [];
  const planes = [];
  let extent = 0;
  for (const p of points) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
  const dTol = 1e-4 * Math.max(1, extent);

  for (const face of hull.faces) {
    const n = face.normal;
    const verts = [];
    let e = face.edge;
    do {
      verts.push(e.head().point);
      e = e.next;
    } while (e !== face.edge);
    for (let i = 1; i < verts.length - 1; i++) {
      for (const v of [verts[0], verts[i], verts[i + 1]]) {
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
      }
    }
    const d = face.constant;
    let found = false;
    for (const pl of planes) {
      if (Math.abs(pl.x - n.x) < 1e-4 && Math.abs(pl.y - n.y) < 1e-4 &&
          Math.abs(pl.z - n.z) < 1e-4 && Math.abs(pl.w - d) < dTol) { found = true; break; }
    }
    if (!found) planes.push(new THREE.Vector4(n.x, n.y, n.z, d));
  }

  if (planes.length > MAX_PLANES) {
    console.warn(`gems: ${label} has ${planes.length} facet planes (> ${MAX_PLANES}); extra planes ignored by the shader.`);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, planes };
}

// Resample a closed polygon (Vector2[], CCW) to ~count points, keeping its vertices.
function resamplePolygon(poly, count = 64) {
  const n = poly.length;
  if (n >= count) return poly.map((p) => p.clone());
  const lens = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const l = poly[i].distanceTo(poly[(i + 1) % n]);
    lens.push(l);
    total += l;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = Math.max(1, Math.round((lens[i] / total) * count));
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = 0; j < k; j++) out.push(new THREE.Vector2().lerpVectors(a, b, j / k));
  }
  return out;
}

function ensureCCW(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) poly.reverse();
  return poly;
}

// ---------------------------------------------------------------------------
// Rose cut
// ---------------------------------------------------------------------------

// Point counts per ring (apex excluded); the last ring is the top of the girdle.
// Chosen so that the facet-plane count stays <= 96.
const ROSE_RINGS = {
  1: [12],
  2: [6, 12],
  3: [6, 12, 24],
  4: [3, 6, 12, 24],
};

export function buildRoseCut({ width, length, depth, girdle = 0.12, rings = 3 } = {}) {
  rings = Math.max(1, Math.min(4, Math.round(rings)));
  const counts = ROSE_RINGS[rings];
  const a = width / 2;
  const b = length / 2;
  girdle = Math.min(Math.max(girdle, 0.01), depth * 0.6);
  const dome = depth - girdle;
  const profilePow = 1.7; // concave dome profile: h = g + dome * (1 - r^p)

  const points = [new THREE.Vector3(0, depth, 0)];
  let girdleRing = [];
  let offset = 0;
  for (let k = 1; k <= rings; k++) {
    const n = counts[k - 1];
    const r = k / rings;
    const y = girdle + dome * (1 - Math.pow(r, profilePow));
    const step = (Math.PI * 2) / n;
    // alternate rotational offset by half a step on every ring
    offset = (k % 2 === 0) ? step / 2 : 0;
    const ring = [];
    for (let i = 0; i < n; i++) {
      const t = offset + i * step;
      const p = new THREE.Vector3(a * r * Math.cos(t), y, b * r * Math.sin(t));
      points.push(p);
      ring.push(p);
    }
    if (k === rings) girdleRing = ring;
  }
  // base ring at y = 0 (same outline)
  for (const p of girdleRing) points.push(new THREE.Vector3(p.x, 0, p.z));

  const { geometry, planes } = hullToStone(points, 'rose cut');
  const poly = ensureCCW(girdleRing.map((p) => new THREE.Vector2(p.x, p.z)));
  const outline = resamplePolygon(poly, 64);
  return { geometry, planes, outline, height: depth };
}

// ---------------------------------------------------------------------------
// Brilliant (round / pear / marquise)
// ---------------------------------------------------------------------------

// Dense convex outline (x, z), CCW. Width along X, length along Z, points at +Z.
function denseOutline(shape, width, length) {
  const pts = [];
  const b = width / 2;
  const N = 360;
  if (shape === 'round') {
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector2(b * Math.cos(t), b * Math.sin(t)));
    }
    return pts;
  }
  // marquise arc (right side) with half-length a and half-width b, centred at z0
  const arc = (a, z0, zMin, sign) => {
    const R = (a * a + b * b) / (2 * b);
    const cx = sign * (b - R);
    const phi0 = Math.asin(Math.min(1, a / R));
    const out = [];
    for (let i = 0; i <= N / 2; i++) {
      const phi = -phi0 + (2 * phi0 * i) / (N / 2);
      const x = cx + sign * R * Math.cos(phi);
      const z = z0 + R * Math.sin(phi);
      if (z >= zMin - 1e-9) out.push(new THREE.Vector2(x, z));
    }
    return out;
  };
  if (shape === 'marquise') {
    const a = Math.max(length, width * 1.05) / 2;
    const right = arc(a, 0, -Infinity, 1); // from -Z tip up to +Z tip
    const left = arc(a, 0, -Infinity, -1).reverse(); // from +Z tip down to -Z tip
    for (const p of right) pts.push(p);
    for (let i = 1; i < left.length - 1; i++) pts.push(left[i]);
    return pts;
  }
  // pear: circle on -Z, marquise-like arcs to a point at +Z
  const L = Math.max(length, width * 1.05);
  const zc = -L / 2 + b;
  const aTop = L / 2 - zc;
  // lower half circle, from (-b, zc) through (0, zc-b) to (b, zc)
  for (let i = 0; i <= N / 2; i++) {
    const t = Math.PI + (Math.PI * i) / (N / 2);
    pts.push(new THREE.Vector2(b * Math.cos(t), zc + b * Math.sin(t)));
  }
  const right = arc(aTop, zc, zc, 1); // from (b, zc) up to tip
  for (let i = 1; i < right.length; i++) pts.push(right[i]);
  const left = arc(aTop, zc, zc, -1).reverse(); // from tip down to (-b, zc)
  for (let i = 1; i < left.length - 1; i++) pts.push(left[i]);
  return pts;
}

// Polar intersection of the ray from the origin at angle t with a convex polygon.
function polarPoint(poly, t) {
  const ux = Math.cos(t);
  const uz = Math.sin(t);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x;
    const ez = q.y - p.y;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = (p.x * ez - p.y * ex) / den; // distance along ray
    const v = (p.x * uz - p.y * ux) / den; // param along edge
    if (s > 0 && v >= -1e-9 && v <= 1 + 1e-9 && s < best) best = s;
  }
  return new THREE.Vector2(ux * best, uz * best);
}

function planeThrough(p0, p1, tangent) {
  // plane containing points p0, p1 and direction tangent; returns {n, d}
  const n = new THREE.Vector3().subVectors(p1, p0).cross(tangent).normalize();
  return { n, d: n.dot(p0) };
}

function intersectWithY(pl1, pl2, y) {
  // solve n1.p = d1, n2.p = d2 with p.y = y
  const a1 = pl1.n.x, c1 = pl1.n.z, r1 = pl1.d - pl1.n.y * y;
  const a2 = pl2.n.x, c2 = pl2.n.z, r2 = pl2.d - pl2.n.y * y;
  const det = a1 * c2 - a2 * c1;
  if (Math.abs(det) < 1e-9) return null;
  return new THREE.Vector3((r1 * c2 - r2 * c1) / det, y, (a1 * r2 - a2 * r1) / det);
}

export function buildBrilliant({ shape = 'round', width, length, girdle } = {}) {
  if (shape !== 'pear' && shape !== 'marquise') shape = 'round';
  if (!length || shape === 'round') length = shape === 'round' ? width : length;
  if (girdle === undefined) girdle = 0.03 * width;
  const g2 = girdle / 2;
  const crownHeight = 0.15 * width;
  const pavilionDepth = 0.43 * width;
  const tableScale = 0.57;
  const starFrac = 0.35;   // star facets reach ~ half way from table to girdle
  const lowerFrac = 0.77;  // lower girdle facets reach ~ 77 % to the culet

  const dense = denseOutline(shape, width, length);
  const yT = g2 + crownHeight;
  const yC = -g2 - pavilionDepth;

  const N = 8;
  const mainAng = [];
  const halfAng = [];
  for (let i = 0; i < N; i++) {
    mainAng.push((i / N) * Math.PI * 2);
    halfAng.push(((i + 0.5) / N) * Math.PI * 2);
  }
  const at = (t) => polarPoint(dense, t);
  const tangentAt = (t) => {
    const p = at(t - 0.01);
    const q = at(t + 0.01);
    return new THREE.Vector3(q.x - p.x, 0, q.y - p.y).normalize();
  };

  const points = [];
  const girdleUp = [];
  const girdleLo = [];
  // 16 girdle points (main + half angles)
  const gAngles = [];
  for (let i = 0; i < N; i++) gAngles.push(mainAng[i], halfAng[i]);
  for (const t of gAngles) {
    const p = at(t);
    girdleUp.push(new THREE.Vector3(p.x, g2, p.y));
    girdleLo.push(new THREE.Vector3(p.x, -g2, p.y));
  }
  points.push(...girdleUp, ...girdleLo);

  // table
  const table = mainAng.map((t) => {
    const p = at(t);
    return new THREE.Vector3(p.x * tableScale, yT, p.y * tableScale);
  });
  points.push(...table);

  // crown kite (bezel) planes and star points
  const kites = mainAng.map((t, i) => planeThrough(table[i], girdleUp[2 * i], tangentAt(t)));
  const yS = yT - starFrac * crownHeight;
  for (let i = 0; i < N; i++) {
    const t = halfAng[i];
    let s = intersectWithY(kites[i], kites[(i + 1) % N], yS);
    const go = at(t);
    const rG = go.length();
    const rT = rG * tableScale * Math.cos(Math.PI / N);
    if (s) {
      const r = Math.hypot(s.x, s.z);
      if (!(r < rG * 0.97 && r > rT)) s = null;
    }
    if (!s) {
      const f = (rT + 0.45 * (rG - rT)) / rG;
      s = new THREE.Vector3(go.x * f, yS, go.y * f);
    }
    points.push(s);
  }

  // pavilion mains and lower-half points
  const culet = new THREE.Vector3(0, yC, 0);
  points.push(culet);
  const mains = mainAng.map((t, i) => planeThrough(culet, girdleLo[2 * i], tangentAt(t)));
  const yL = -g2 - lowerFrac * pavilionDepth;
  for (let i = 0; i < N; i++) {
    const t = halfAng[i];
    let s = intersectWithY(mains[i], mains[(i + 1) % N], yL);
    const go = at(t);
    const rG = go.length();
    if (s) {
      const r = Math.hypot(s.x, s.z);
      if (!(r < rG * 0.9 && r > 1e-4)) s = null;
    }
    if (!s) {
      const f = 1 - lowerFrac;
      s = new THREE.Vector3(go.x * f, yL, go.y * f);
    }
    points.push(s);
  }

  const { geometry, planes } = hullToStone(points, `${shape} brilliant`);
  const poly = ensureCCW(girdleUp.map((p) => new THREE.Vector2(p.x, p.z)));
  const outline = resamplePolygon(poly, 64);
  return { geometry, planes, outline, crownHeight, pavilionDepth };
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */`
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vCamObj;
varying float vScale;
varying vec3 vGoldAmbient;

uniform samplerCube envMap;
uniform float uFlipEnv;
uniform float uUseBackTint;

vec3 envV(vec3 w) {
  w = normalize(w);
  w.x *= uFlipEnv;
  return textureLod(envMap, w, 0.0).rgb;
}

void main() {
  vPos = position;
  vGoldAmbient = vec3(0.0);
  if (uUseBackTint > 0.5) {
    // rough upper-hemisphere irradiance seen by the gold cup (constant per mesh)
    vec3 up = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
    vec3 t1 = normalize(abs(up.y) < 0.9 ? cross(up, vec3(0.0, 1.0, 0.0)) : cross(up, vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(up, t1);
    vec3 acc = envV(up) * 2.0;
    acc += envV(up * 0.7 + t1 * 0.7) + envV(up * 0.7 - t1 * 0.7);
    acc += envV(up * 0.7 + t2 * 0.7) + envV(up * 0.7 - t2 * 0.7);
    acc += envV(up * 0.35 + (t1 + t2) * 0.66) + envV(up * 0.35 - (t1 + t2) * 0.66);
    acc += envV(up * 0.35 + (t1 - t2) * 0.66) + envV(up * 0.35 - (t1 - t2) * 0.66);
    vGoldAmbient = acc / 10.0;
  }
  vNormal = normal;
  vCamObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vScale = length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */`
#define MAX_PLANES ${MAX_PLANES}
#define MAX_BOUNCES ${MAX_BOUNCES}

uniform mat4 modelMatrix;
uniform samplerCube envMap;
uniform float uFlipEnv;
uniform vec4 uPlanes[MAX_PLANES];
uniform int uPlaneCount;
uniform float uIor;
uniform float uDispersion;
uniform int uBounces;
uniform vec3 uBackTint;
uniform float uUseBackTint;
uniform float uGoldAmbientMix;
uniform vec3 uAbsorption;
uniform float uExposure;

varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vCamObj;
varying float vScale;
varying vec3 vGoldAmbient;

vec3 toWorld(vec3 dObj) {
  vec3 w = mat3(modelMatrix) * dObj;
  float l = length(w);
  return l > 1e-8 ? w / l : vec3(0.0, 1.0, 0.0);
}

vec3 envWorld(vec3 w) {
  w.x *= uFlipEnv;
  return textureLod(envMap, w, 0.0).rgb;
}

vec3 envObj(vec3 dObj) { return envWorld(toWorld(dObj)); }

// Exact unpolarised dielectric Fresnel reflectance.
float fresnelDielectric(float cosI, float etaI, float etaT) {
  cosI = clamp(cosI, 0.0, 1.0);
  float sinT = etaI / etaT * sqrt(max(0.0, 1.0 - cosI * cosI));
  if (sinT >= 1.0) return 1.0;
  float cosT = sqrt(max(0.0, 1.0 - sinT * sinT));
  float rs = (etaI * cosI - etaT * cosT) / (etaI * cosI + etaT * cosT);
  float rp = (etaT * cosI - etaI * cosT) / (etaT * cosI + etaI * cosT);
  return 0.5 * (rs * rs + rp * rp);
}

// Light arriving along -outDir at the exit facet with outward normal nE (object space).
vec3 exitLight(vec3 outDir, vec3 nE) {
  if (uUseBackTint > 0.5 && (nE.y < -0.5 || abs(nE.y) < 0.2)) {
    // closed back: the ray hits the polished gold cup and is mirrored back up
    vec3 r = reflect(outDir, -nE);
    r.y = abs(r.y);
    return uBackTint * ((1.0 - uGoldAmbientMix) * envObj(r) + uGoldAmbientMix * vGoldAmbient);
  }
  return envObj(outDir);
}

vec3 traceInside(vec3 p, vec3 d, float ior) {
  vec3 col = vec3(0.0);
  vec3 w = vec3(1.0);
  vec3 nE = d;
  for (int b = 0; b < MAX_BOUNCES; b++) {
    if (b >= uBounces) break;
    float tMin = 1e6;
    nE = d;
    for (int j = 0; j < MAX_PLANES; j++) {
      if (j >= uPlaneCount) break;
      vec4 pl = uPlanes[j];
      float dn = dot(d, pl.xyz);
      if (dn > 1e-6) {
        float t = (pl.w - dot(p, pl.xyz)) / dn;
        if (t < tMin) { tMin = t; nE = pl.xyz; }
      }
    }
    if (tMin > 1e5) break;
    tMin = max(tMin, 0.0);
    p += d * tMin;
    w *= pow(uAbsorption, vec3(tMin * vScale));
    float cosI = dot(d, nE);
    vec3 rDir = d - 2.0 * cosI * nE;
    vec3 o = refract(d, -nE, ior);
    if (dot(o, o) > 1e-6) {
      float F = fresnelDielectric(cosI, ior, 1.0);
      col += w * (1.0 - F) * exitLight(normalize(o), nE);
      w *= F;
    }
    d = rDir;
  }
  // whatever energy is left eventually escapes: approximate with the env along d
  col += w * exitLight(d, d);
  return col;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 rd = normalize(vPos - vCamObj);
  float cosI = clamp(-dot(rd, n), 0.0, 1.0);
  vec3 refl = envObj(reflect(rd, n));
  vec3 col;
  if (uDispersion > 0.0) {
    vec3 iors = vec3(uIor - uDispersion, uIor, uIor + uDispersion * 1.6);
    for (int c = 0; c < 3; c++) {
      float ior = iors[c];
      float F = fresnelDielectric(cosI, 1.0, ior);
      vec3 inner = traceInside(vPos, refract(rd, n, 1.0 / ior), ior);
      col[c] = F * refl[c] + (1.0 - F) * inner[c];
    }
  } else {
    float F = fresnelDielectric(cosI, 1.0, uIor);
    vec3 inner = traceInside(vPos, refract(rd, n, 1.0 / uIor), uIor);
    col = F * refl + (1.0 - F) * inner;
  }
  col *= uExposure;
  col = max(col, vec3(0.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function planesArray(planes) {
  const arr = [];
  const n = Math.min(planes ? planes.length : 0, MAX_PLANES);
  for (let i = 0; i < MAX_PLANES; i++) {
    arr.push(i < n ? planes[i].clone() : new THREE.Vector4(0, 1, 0, 0));
  }
  return { arr, count: n };
}

export function createDiamondMaterial({
  planes, envMap = null, ior = 2.42, dispersion = 0.012, bounces = 5, backTint = null,
  exposure = 1, absorption = new THREE.Color(1.0, 0.995, 0.985), goldAmbient = 0.3,
} = {}) {
  const { arr, count } = planesArray(planes);
  const material = new THREE.ShaderMaterial({
    name: 'DiamondMaterial',
    uniforms: {
      envMap: { value: null },
      uFlipEnv: { value: 1 },
      uPlanes: { value: arr },
      uPlaneCount: { value: count },
      uIor: { value: ior },
      uDispersion: { value: dispersion },
      uBounces: { value: bounces },
      uBackTint: { value: new THREE.Color(1, 1, 1) },
      uUseBackTint: { value: 0 },
      uGoldAmbientMix: { value: goldAmbient },
      uAbsorption: { value: new THREE.Color().set(absorption) },
      uExposure: { value: exposure },
    },
    vertexShader,
    fragmentShader,
    side: THREE.FrontSide,
    toneMapped: true,
  });
  setDiamondEnv(material, envMap);
  setDiamondOptions(material, { backTint });
  return material;
}

export function setDiamondPlanes(material, planes) {
  const u = material.uniforms;
  const n = Math.min(planes ? planes.length : 0, MAX_PLANES);
  if (planes && planes.length > MAX_PLANES) {
    console.warn(`gems: ${planes.length} planes given, only ${MAX_PLANES} used.`);
  }
  for (let i = 0; i < MAX_PLANES; i++) {
    if (i < n) u.uPlanes.value[i].copy(planes[i]);
    else u.uPlanes.value[i].set(0, 1, 0, 0);
  }
  u.uPlaneCount.value = n;
}

export function setDiamondEnv(material, envMap) {
  const u = material.uniforms;
  u.envMap.value = envMap || null;
  // three.js convention: loaded CubeTextures are mirrored in X, render-target cubes are not.
  u.uFlipEnv.value = (envMap && envMap.isCubeTexture && envMap.isRenderTargetTexture !== true) ? -1 : 1;
}

export function setDiamondOptions(material, opts = {}) {
  const u = material.uniforms;
  if (opts.ior !== undefined) u.uIor.value = opts.ior;
  if (opts.dispersion !== undefined) u.uDispersion.value = Math.max(0, opts.dispersion);
  if (opts.bounces !== undefined) u.uBounces.value = Math.max(0, Math.min(MAX_BOUNCES, Math.round(opts.bounces)));
  if (opts.exposure !== undefined) u.uExposure.value = opts.exposure;
  if (opts.absorption !== undefined) u.uAbsorption.value.set(opts.absorption);
  if (opts.goldAmbient !== undefined) u.uGoldAmbientMix.value = opts.goldAmbient;
  if (opts.backTint !== undefined) {
    if (opts.backTint) {
      if (Array.isArray(opts.backTint)) u.uBackTint.value.fromArray(opts.backTint);
      else u.uBackTint.value.set(opts.backTint);
      u.uUseBackTint.value = 1;
    } else {
      u.uUseBackTint.value = 0;
    }
  }
}
