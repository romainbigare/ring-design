#!/usr/bin/env python3
"""Build assets/hand/hand.glb + hand.json from MakeHuman CC0 assets.

Reproducible pipeline:
  1. download (into a cache dir, NOT the repo) the MakeHuman base mesh, macro / arm targets,
     the default skeleton + skin weights, and the CC0 system-asset skin texture;
  2. morph to a young adult woman (ethnic/gender/age macro targets + slim hand targets);
  3. pose the left hand with linear-blend skinning (relaxed hand resting palm-down on a table);
  4. extract the left hand + forearm (body group only), Catmull-Clark subdivide x2;
  5. orient/scale per src/CONTRACT.md (ring-finger proximal phalanx on Z, ring position at origin,
     fingertips -Z, palm -Y, ring-finger perimeter at z=0 = 49.75 mm, units mm);
  6. new UV atlas (xatlas) + baked textures: MakeHuman skin colour (low frequency) + procedural
     3-D detail (pores, knuckle wrinkles, colour mottling, nails) and a tangent-space normal map;
  7. export GLB (materials `skin` and `nails`) + hand.json.

Usage:  python3 tools/build_hand.py [--cache DIR] [--out assets/hand] [--tex 4096]
Requires: numpy, scipy, pillow, xatlas, pygltflib  (pip install numpy scipy pillow xatlas pygltflib)
"""
import argparse
import io
import json
import math
import os
import subprocess
import sys
import urllib.request
import zipfile

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MH_RAW = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/'
SYS_ASSETS_ZIP = ('https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/'
                  'makehuman_system_assets_cc0.zip')
SKIN_IN_ZIP = 'skins/young_caucasian_female/young_lightskinned_female_diffuse.png'

# Macro mix (weights of MakeHuman "macrodetails" targets): young adult woman.
MACRO_TARGETS = [
    ('targets/macrodetails/caucasian-female-young.target', 0.70),
    ('targets/macrodetails/asian-female-young.target', 0.15),
    ('targets/macrodetails/african-female-young.target', 0.15),
    # slightly slimmer than average
    ('targets/macrodetails/universal-female-young-averagemuscle-minweight.target', 0.25),
    ('targets/macrodetails/proportions/female-young-averagemuscle-averageweight-idealproportions.target', 0.5),
]
# Hand detail targets (left hand), tuned so a 49.75 mm ring finger gives a ~17 cm hand.
HAND_TARGETS = [
    ('targets/armslegs/l-hand-fingers-diameter-decr.target', 0.15),
]

RING_PERIMETER = 49.75     # mm
RING_FRACTION = 0.40       # ring position: 40 % of the way MCP -> PIP
THUMB_NAIL_ROLL = 35.0     # deg, correction of the thumb-nail direction estimate
FOREARM_CUT = 135.0        # mm from the wrist joint towards the elbow


# ----------------------------------------------------------------------------------------------
# downloads / IO
# ----------------------------------------------------------------------------------------------
def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print('  downloading', url)
    tmp = path + '.part'
    with urllib.request.urlopen(url) as r, open(tmp, 'wb') as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    os.replace(tmp, path)
    return path


def mh_file(cache, rel):
    return fetch(MH_RAW + rel, os.path.join(cache, 'mh', rel))


def load_obj(p):
    V, VT, F, FT, G = [], [], [], [], []
    g = None
    for line in open(p):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            g = line.split()[1]
        elif line.startswith('f '):
            parts = line.split()[1:]
            F.append([int(q.split('/')[0]) - 1 for q in parts])
            FT.append([int(q.split('/')[1]) - 1 for q in parts])
            G.append(g)
    return np.array(V), np.array(VT), np.array(F), np.array(FT), np.array(G)


def load_target(p):
    idx, d = [], []
    for line in open(p):
        if line.startswith('#') or not line.strip():
            continue
        a = line.split()
        idx.append(int(a[0]))
        d.append([float(x) for x in a[1:4]])
    return np.array(idx, dtype=np.int64), np.array(d)


# ----------------------------------------------------------------------------------------------
# geometry helpers
# ----------------------------------------------------------------------------------------------
def normalize(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def rot_axis(axis, ang):
    a = normalize(axis)
    x, y, z = a
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def affine(R, pivot):
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = pivot - R @ pivot
    return M


def section(P, T, origin, normal, near=None, radius=None):
    """Intersect triangle mesh with plane -> list of segments (k,2,3)."""
    d = (P - origin) @ normal
    dt = d[T]
    s = np.sign(dt)
    cross = (s.min(1) < 0) & (s.max(1) > 0)
    segs = []
    for tri, dd in zip(T[cross], dt[cross]):
        pts = []
        for i in range(3):
            a, b = tri[i], tri[(i + 1) % 3]
            da, db = dd[i], dd[(i + 1) % 3]
            if (da < 0) != (db < 0):
                t = da / (da - db)
                pts.append(P[a] + t * (P[b] - P[a]))
        if len(pts) == 2:
            segs.append(pts)
    segs = np.array(segs)
    if near is not None and len(segs):
        m = np.linalg.norm(segs.mean(1) - near, axis=1) < radius
        segs = segs[m]
    return segs


def hull_perimeter_2d(pts):
    from scipy.spatial import ConvexHull
    h = ConvexHull(pts)
    v = pts[h.vertices]
    return float(np.linalg.norm(v - np.roll(v, 1, 0), axis=1).sum()), v


def loop_component(segs, seed, tol=1e-6):
    """Return the connected chain of segments closest to `seed` (2-D/3-D points)."""
    if len(segs) == 0:
        return segs
    from scipy.spatial import cKDTree
    ends = segs.reshape(-1, segs.shape[-1])
    tree = cKDTree(ends)
    n = len(segs)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, j in tree.query_pairs(1e-5 * max(1.0, np.abs(ends).max())):
        a, b = find(i // 2), find(j // 2)
        if a != b:
            parent[a] = b
    roots = np.array([find(i) for i in range(n)])
    # choose component whose centroid is closest to seed and that encloses it reasonably
    best, bd = None, 1e18
    for r in np.unique(roots):
        c = segs[roots == r].reshape(-1, segs.shape[-1]).mean(0)
        dist = np.linalg.norm(c - seed)
        if dist < bd:
            best, bd = r, dist
    return segs[roots == best]


# ----------------------------------------------------------------------------------------------
# Catmull-Clark (quads, open boundaries, face-varying UV carried linearly)
# ----------------------------------------------------------------------------------------------
def catmull_clark(P, Q, QUV):
    """P (n,3) verts, Q (m,4) quads, QUV (m,4,2) per-corner uv. Returns P2, Q2, QUV2."""
    n, m = len(P), len(Q)
    fp = P[Q].mean(1)
    fuv = QUV.mean(1)
    e = np.stack([Q, np.roll(Q, -1, 1)], -1).reshape(-1, 2)          # (4m,2) corner i -> i+1
    ekey = np.sort(e, 1)
    uniq, einv = np.unique(ekey, axis=0, return_inverse=True)
    einv = einv.reshape(-1)
    ne = len(uniq)
    efaces = np.repeat(np.arange(m), 4)
    cnt = np.bincount(einv, minlength=ne)
    fsum = np.zeros((ne, 3))
    np.add.at(fsum, einv, fp[efaces])
    mid = P[uniq].mean(1)
    boundary_e = cnt == 1
    ep = np.where(boundary_e[:, None], mid, (P[uniq].sum(1) + fsum) / np.maximum(cnt + 2, 1)[:, None])
    # vertex points
    val = np.zeros(n)
    Fs = np.zeros((n, 3))
    nf = np.zeros(n)
    np.add.at(Fs, Q.reshape(-1), np.repeat(fp, 4, 0))
    np.add.at(nf, Q.reshape(-1), 1)
    Rs = np.zeros((n, 3))
    ne_v = np.zeros(n)
    for k in (0, 1):
        np.add.at(Rs, uniq[:, k], mid)
        np.add.at(ne_v, uniq[:, k], 1)
    is_bv = np.zeros(n, bool)
    is_bv[uniq[boundary_e].reshape(-1)] = True
    Bs = np.zeros((n, 3))
    nb = np.zeros(n)
    be = uniq[boundary_e]
    np.add.at(Bs, be[:, 0], P[be[:, 1]])
    np.add.at(Bs, be[:, 1], P[be[:, 0]])
    np.add.at(nb, be[:, 0], 1)
    np.add.at(nb, be[:, 1], 1)
    valn = np.maximum(ne_v, 1)
    Fa = Fs / np.maximum(nf, 1)[:, None]
    Ra = Rs / valn[:, None]
    vp_int = (Fa + 2 * Ra + (valn[:, None] - 3) * P) / valn[:, None]
    vp_b = np.where(nb[:, None] == 2, 0.75 * P + 0.125 * Bs, P)
    vp = np.where(is_bv[:, None], vp_b, vp_int)
    used = np.zeros(n, bool)
    used[Q.reshape(-1)] = True
    vp[~used] = P[~used]
    P2 = np.concatenate([vp, ep, fp])
    eoff, foff = n, n + ne
    E = einv.reshape(m, 4)       # edge index for corner i -> i+1
    Q2, U2 = [], []
    for i in range(4):
        ip = (i - 1) % 4
        Q2.append(np.stack([Q[:, i], eoff + E[:, i], foff + np.arange(m), eoff + E[:, ip]], 1))
        uv_v = QUV[:, i]
        uv_en = 0.5 * (QUV[:, i] + QUV[:, (i + 1) % 4])
        uv_ep = 0.5 * (QUV[:, ip] + QUV[:, i])
        U2.append(np.stack([uv_v, uv_en, fuv, uv_ep], 1))
    Q2 = np.stack(Q2, 1).reshape(-1, 4)
    U2 = np.stack(U2, 1).reshape(-1, 4, 2)
    return P2, Q2, U2


def compact(P, F):
    used = np.unique(F)
    remap = -np.ones(len(P), np.int64)
    remap[used] = np.arange(len(used))
    return P[used], remap[F], used


# ----------------------------------------------------------------------------------------------
# skeleton / skinning
# ----------------------------------------------------------------------------------------------
HAND_BONES = (['lowerarm01.L', 'lowerarm02.L', 'wrist.L'] +
              ['metacarpal%d.L' % i for i in range(1, 5)] +
              ['finger%d-%d.L' % (f, k) for f in range(1, 6) for k in range(1, 4)])


class Skeleton:
    def __init__(self, skel, weights, V):
        self.skel = skel
        self.bones = skel['bones']
        self.head = {}
        self.tail = {}
        for b, d in self.bones.items():
            self.head[b] = V[skel['joints'][d['head']]].mean(0)
            self.tail[b] = V[skel['joints'][d['tail']]].mean(0)
        self.weights = weights

    def chain_matrices(self, local):
        """local: {bone: 4x4 affine in rest space}. Returns global per bone (rest space)."""
        out = {}

        def get(b):
            if b in out:
                return out[b]
            p = self.bones[b]['parent']
            M = get(p) if p else np.eye(4)
            M = M @ local.get(b, np.eye(4))
            out[b] = M
            return M
        for b in self.bones:
            get(b)
        return out

    def skin(self, V, mats, bones):
        n = len(V)
        acc = np.zeros((n, 3))
        wsum = np.zeros(n)
        Vh = np.c_[V, np.ones(n)]
        for b, lst in self.weights.items():
            if not lst:
                continue
            a = np.array(lst)
            idx = a[:, 0].astype(np.int64)
            w = a[:, 1]
            M = mats.get(b, np.eye(4)) if b in bones else np.eye(4)
            acc[idx] += w[:, None] * (Vh[idx] @ M.T)[:, :3]
            wsum[idx] += w
        out = V.copy()
        m = wsum > 1e-9
        out[m] = acc[m] / wsum[m, None]
        return out, wsum

    def bone_weight(self, n, bones):
        w = np.zeros(n)
        tot = np.zeros(n)
        for b, lst in self.weights.items():
            if not lst:
                continue
            a = np.array(lst)
            idx = a[:, 0].astype(np.int64)
            tot[idx] += a[:, 1]
            if b in bones:
                w[idx] += a[:, 1]
        return w / np.maximum(tot, 1e-9)


# ----------------------------------------------------------------------------------------------
# GLB writer
# ----------------------------------------------------------------------------------------------
def write_glb(path, prims, images, materials, extensions_used=None):
    """prims: list of dict(pos, nrm, uv, idx, tan(optional), material=int)
    images: list of (bytes, mime). materials: list of pygltflib.Material."""
    import pygltflib as G
    blob = bytearray()
    views, accs = [], []

    def add_view(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(data)
        views.append(G.BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
        return len(views) - 1

    acc_cache = {}

    def add_acc(arr, ctype, typ, target, minmax=False):
        key = (id(arr), ctype)
        if key in acc_cache and target != G.ELEMENT_ARRAY_BUFFER:
            return acc_cache[key]
        v = add_view(arr.tobytes(), target)
        a = G.Accessor(bufferView=v, componentType=ctype, count=len(arr), type=typ)
        if minmax:
            a.min = arr.min(0).tolist()
            a.max = arr.max(0).tolist()
        accs.append(a)
        acc_cache[key] = len(accs) - 1
        return len(accs) - 1
    gprims = []
    conv = {}
    for p in prims:
        attrs = G.Attributes()
        f32 = {}
        for k in ('pos', 'nrm', 'uv'):
            if p.get(k) is not None:
                f32[k] = conv.setdefault(id(p[k]), np.ascontiguousarray(p[k], dtype=np.float32))
        attrs.POSITION = add_acc(f32['pos'], G.FLOAT, G.VEC3, G.ARRAY_BUFFER, True)
        attrs.NORMAL = add_acc(f32['nrm'], G.FLOAT, G.VEC3, G.ARRAY_BUFFER)
        if 'uv' in f32:
            attrs.TEXCOORD_0 = add_acc(f32['uv'], G.FLOAT, G.VEC2, G.ARRAY_BUFFER)
        if p.get('tan') is not None:
            attrs.TANGENT = add_acc(p['tan'].astype(np.float32), G.FLOAT, G.VEC4, G.ARRAY_BUFFER)
        if p.get('col') is not None:
            attrs.COLOR_0 = add_acc(p['col'].astype(np.float32), G.FLOAT, G.VEC3, G.ARRAY_BUFFER)
        idx = p['idx'].reshape(-1)
        if idx.max() < 65535:
            ia = add_acc(idx.astype(np.uint16), G.UNSIGNED_SHORT, G.SCALAR, G.ELEMENT_ARRAY_BUFFER)
        else:
            ia = add_acc(idx.astype(np.uint32), G.UNSIGNED_INT, G.SCALAR, G.ELEMENT_ARRAY_BUFFER)
        gprims.append(G.Primitive(attributes=attrs, indices=ia, material=p['material']))
    gimgs = []
    for data, mime in images:
        v = add_view(data)
        gimgs.append(G.Image(bufferView=v, mimeType=mime))
    while len(blob) % 4:
        blob.append(0)
    g = G.GLTF2(
        asset=G.Asset(version='2.0', generator='ring-design tools/build_hand.py (MakeHuman CC0)'),
        scene=0, scenes=[G.Scene(nodes=[0])],
        nodes=[G.Node(mesh=0, name='hand')],
        meshes=[G.Mesh(primitives=gprims, name='hand')],
        materials=materials,
        textures=[G.Texture(source=i, sampler=0) for i in range(len(gimgs))],
        samplers=[G.Sampler(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071)] if gimgs else [],
        images=gimgs,
        buffers=[G.Buffer(byteLength=len(blob))],
        bufferViews=views, accessors=accs)
    if extensions_used:
        g.extensionsUsed = list(extensions_used)
    g.set_binary_blob(bytes(blob))
    g.save_binary(path)


def vertex_normals(P, T):
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    N = np.zeros_like(P)
    for i in range(3):
        np.add.at(N, T[:, i], fn)
    return normalize(N)


# ----------------------------------------------------------------------------------------------
# pose
# ----------------------------------------------------------------------------------------------
# Relative joint rotations in degrees: (flex, abd, roll). flex > 0 curls towards the palm,
# abd > 0 swings towards the thumb side, roll about the bone axis.
POSE = {
    'wrist.L': (-22.0, -4.0, 0.0),
    'finger1-1.L': (-15.0, -22.0, 20.0),
    'finger1-3.L': (10.0, 0.0, 0.0),
    'finger2-1.L': (0.0, -13.0, 0.0),
    'finger2-2.L': (20.0, 0.0, 0.0),
    'finger2-3.L': (12.0, 0.0, 0.0),
    'finger3-1.L': (0.0, 4.0, 0.0),
    'finger3-2.L': (20.0, 0.0, 0.0),
    'finger3-3.L': (12.0, 0.0, 0.0),
    'finger4-1.L': (0.0, 13.0, 0.0),
    'finger4-2.L': (20.0, 0.0, 0.0),
    'finger4-3.L': (12.0, 0.0, 0.0),
    'finger5-1.L': (0.0, 18.0, 0.0),
    'finger5-2.L': (20.0, 0.0, 0.0),
    'finger5-3.L': (12.0, 0.0, 0.0),
}


def hand_frame(S):
    H = S.head
    Wr = H['wrist.L']
    mcp = [H['finger%d-1.L' % k] for k in range(2, 6)]
    f = normalize(np.mean(mcp, 0) - Wr)
    l = mcp[0] - mcp[3]
    l = normalize(l - f * (l @ f))
    n = np.cross(l, f)          # dorsal
    return f, l, n


def pose_matrices(S, pose):
    f, l, n = hand_frame(S)
    local = {}
    for b, (flex, abd, roll) in pose.items():
        h, t = S.head[b], S.tail[b]
        d = normalize(t - h)
        nn = normalize(n - d * (n @ d))
        R = np.eye(3)
        if roll:
            R = rot_axis(d, math.radians(roll)) @ R
        if abd:
            R = rot_axis(-nn, math.radians(abd)) @ R
        if flex:
            R = rot_axis(np.cross(nn, d), math.radians(flex)) @ R
        local[b] = affine(R, h)
    return S.chain_matrices(local)


# ----------------------------------------------------------------------------------------------
# mesh construction
# ----------------------------------------------------------------------------------------------
class Source:
    def __init__(self, cache, macro=MACRO_TARGETS, hand=HAND_TARGETS):
        self.cache = cache
        self.V0, self.VT, self.F, self.FT, self.G = load_obj(mh_file(cache, '3dobjs/base.obj'))
        V = self.V0.copy()
        for rel, w in list(macro) + list(hand):
            if w:
                i, d = load_target(mh_file(cache, rel))
                V[i] += w * d
        self.V = V
        self.skel = json.load(open(mh_file(cache, 'rigs/default.mhskel')))
        self.wts = json.load(open(mh_file(cache, 'rigs/default_weights.mhw')))['weights']
        self.S = Skeleton(self.skel, self.wts, V)
        self.hw = self.S.bone_weight(len(V), set(HAND_BONES))


def finger_loop(P, T, origin, axis, up):
    """Cross-section of the finger in the plane (origin, axis). Returns dict with
    closed (isolated closed loop around origin), hull perimeter, centroid (3-D), 2-D points."""
    x = normalize(np.cross(up, axis))
    y = np.cross(axis, x)
    segs = section(P, T, origin, axis, near=origin, radius=40.0)
    if len(segs) == 0:
        return None
    from scipy.spatial import cKDTree
    ends = segs.reshape(-1, 3)
    tree = cKDTree(ends)
    n = len(segs)
    parent = np.arange(n)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    deg = np.zeros(2 * n, int)
    for i, j in tree.query_pairs(1e-6):
        deg[i] += 1
        deg[j] += 1
        a, b = find(i // 2), find(j // 2)
        if a != b:
            parent[a] = b
    roots = np.array([find(i) for i in range(n)])
    s2 = np.stack([(segs - origin) @ x, (segs - origin) @ y], -1)     # (n,2,2)
    best = None
    for r in np.unique(roots):
        m = roots == r
        a, b = s2[m, 0], s2[m, 1]
        # ray casting along +x from the axis point (0,0)
        cond = (a[:, 1] > 0) != (b[:, 1] > 0)
        t = a[cond, 1] / (a[cond, 1] - b[cond, 1])
        xs = a[cond, 0] + t * (b[cond, 0] - a[cond, 0])
        if (xs > 0).sum() % 2 == 1:
            rad = np.linalg.norm(np.concatenate([a, b]), axis=1).max()
            if best is None or rad < best[1]:
                best = (m, rad)
    if best is None:
        return None
    m, rad = best
    idx = np.where(m)[0]
    open_ends = (deg[np.r_[2 * idx, 2 * idx + 1]] == 0).sum()
    pts = s2[m].reshape(-1, 2)
    per, hull = hull_perimeter_2d(pts)
    c2 = pts.mean(0)
    return dict(closed=(open_ends == 0 and rad < 14.0), perimeter=per, radius=rad,
                centroid=origin + c2[0] * x + c2[1] * y, pts=pts, hull=hull)


def finger_axis(P, T, h, t, up, fr=(0.6, 0.95), iters=4):
    """Fit the visible centre line of a finger between joints h (MCP) and t (PIP)."""
    axis = normalize(h - t)
    p0 = h + 0.75 * (t - h)
    L = np.linalg.norm(t - h)
    for _ in range(iters):
        cs = []
        for k in np.linspace(fr[0], fr[1], 8):
            # point along the current line at the projection of fraction k of the joint segment
            q = h + k * (t - h)
            o = p0 + axis * ((q - p0) @ axis)
            r = finger_loop(P, T, o, axis, up)
            if r is not None and r['closed']:
                cs.append(r['centroid'])
        cs = np.array(cs)
        c = cs.mean(0)
        u, sv, vt = np.linalg.svd(cs - c)
        d = vt[0] if vt[0] @ axis > 0 else -vt[0]
        axis, p0 = normalize(d), c
    return axis, p0


def clip_mesh(P, T, TUV, p0, nrm):
    """Keep the part of the triangle mesh with (x - p0).nrm >= 0; crossing triangles are split."""
    d = (P - p0) @ nrm
    inside = d >= 0
    cnt = inside[T].sum(1)
    keepT = [T[cnt == 3]]
    keepU = [TUV[cnt == 3]]
    newP = []
    edge_ids = {}

    def ev(a, b):
        key = (min(a, b), max(a, b))
        if key not in edge_ids:
            ta = d[a] / (d[a] - d[b])
            edge_ids[key] = len(P) + len(newP)
            newP.append(P[a] + ta * (P[b] - P[a]))
        return edge_ids[key]

    def euv(tri, uv, i, j):
        a, b = tri[i], tri[j]
        ta = d[a] / (d[a] - d[b])
        return uv[i] + ta * (uv[j] - uv[i])
    extraT, extraU = [], []
    for tri, uv in zip(T[(cnt == 1) | (cnt == 2)], TUV[(cnt == 1) | (cnt == 2)]):
        ins = inside[tri]
        # rotate so that the pattern starts at a vertex whose status differs from the previous one
        for r in range(3):
            if ins[r] and not ins[(r - 1) % 3] if ins.sum() == 1 else (not ins[r] and ins[(r - 1) % 3]):
                break
        idx = [(r + k) % 3 for k in range(3)]
        tri, uv, ins = tri[idx], uv[idx], ins[idx]
        if ins.sum() == 1:      # vertex 0 inside
            e01, e02 = ev(tri[0], tri[1]), ev(tri[0], tri[2])
            extraT.append([tri[0], e01, e02])
            extraU.append([uv[0], euv(tri, uv, 0, 1), euv(tri, uv, 0, 2)])
        else:                   # vertex 0 outside, 1 and 2 inside
            e01, e02 = ev(tri[0], tri[1]), ev(tri[0], tri[2])
            u01, u02 = euv(tri, uv, 0, 1), euv(tri, uv, 0, 2)
            extraT += [[e01, tri[1], tri[2]], [e01, tri[2], e02]]
            extraU += [[u01, uv[1], uv[2]], [u01, uv[2], u02]]
    if extraT:
        keepT.append(np.array(extraT))
        keepU.append(np.array(extraU))
    P2 = np.concatenate([P, np.array(newP).reshape(-1, 3)])
    T2 = np.concatenate(keepT)
    U2 = np.concatenate(keepU)
    P3, T3, _ = compact(P2, T2)
    return P3, T3, U2


def build_mesh(src, pose=POSE, levels=2, verbose=True):
    S = src.S
    mats = pose_matrices(S, pose)
    Vp, _ = S.skin(src.V, mats, set(HAND_BONES))
    sel = (src.G == 'body') & (src.hw[src.F].min(1) > 0.3)
    Q = src.F[sel]
    QUV = src.VT[src.FT[sel]]
    P, Q, used = compact(Vp * 100.0, Q)          # MakeHuman decimetres -> mm
    for _ in range(levels):
        P, Q, QUV = catmull_clark(P, Q, QUV)
    T = np.concatenate([Q[:, [0, 1, 2]], Q[:, [0, 2, 3]]])
    TUV = np.concatenate([QUV[:, [0, 1, 2]], QUV[:, [0, 2, 3]]])

    def X(b, which):   # posed joint position (mm)
        p = S.head[b] if which == 'h' else S.tail[b]
        return (mats[b] @ np.r_[p, 1])[:3] * 100.0
    joints = {b: (X(b, 'h'), X(b, 't')) for b in HAND_BONES}
    f, l, n = hand_frame(S)
    n_posed = normalize(mats['metacarpal3.L'][:3, :3] @ n)
    h, t = joints['finger4-1.L']
    axis, p0 = finger_axis(P, T, h, t, n_posed)
    # MCP / PIP projected on the finger centre line
    th, tt = (h - p0) @ axis, (t - p0) @ axis
    ring_t = None
    scan = []
    for k in np.arange(0.2, 0.86, 0.025):
        o = p0 + axis * (th + k * (tt - th))
        r = finger_loop(P, T, o, axis, n_posed)
        scan.append((k, r is not None and r['closed'], r['perimeter'] if r else 0))
    ok = [k for k, c, _ in scan if c]
    k0 = None
    for k, c, _ in scan:            # first fraction from which all sections are isolated loops
        if c and all(cc for kk, cc, _ in scan if kk >= k):
            k0 = k
            break
    ring_k = max(RING_FRACTION, k0 + 0.05)
    origin = p0 + axis * (th + ring_k * (tt - th))
    zA = axis
    xA = normalize(np.cross(n_posed, zA))
    yA = np.cross(zA, xA)
    R = np.stack([xA, yA, zA])                    # rows: new axes
    P = (P - origin) @ R.T
    joints = {b: ((a - origin) @ R.T, (c - origin) @ R.T) for b, (a, c) in joints.items()}
    sec = finger_loop(P, T, np.zeros(3), np.array([0, 0, 1.0]), np.array([0, 1.0, 0]))
    per = sec['perimeter']
    s = RING_PERIMETER / per
    P *= s
    joints = {b: (a * s, c * s) for b, (a, c) in joints.items()}
    # cut the forearm FOREARM_CUT mm from the wrist joint
    wr = joints['wrist.L'][0]
    el = joints['lowerarm01.L'][0]
    fa = normalize(wr - el)
    P, T, TUV = clip_mesh(P, T, TUV, wr - fa * FOREARM_CUT, fa)
    if verbose:
        print('  finger isolated from fraction %.3f; ring at %.3f of MCP->PIP' % (k0, ring_k))
        print('  ring perimeter before scale %.2f mm -> scale %.4f' % (per, s))
    return dict(P=P, T=T, TUV=TUV, joints=joints, scale=s, mats=mats, R=R, origin=origin,
                ring_k=ring_k, scan=scan)


def measure_rest(src, scale):
    """Anthropometric sizes on the un-posed (straight finger) morphed mesh, in mm after `scale`."""
    S, V = src.S, src.V * 100.0
    H = {b: S.head[b] * 100 for b in S.head}
    Tl = {b: S.tail[b] * 100 for b in S.tail}
    w3 = S.bone_weight(len(V), {'finger3-3.L'})
    d = normalize(Tl['finger3-3.L'] - H['finger3-3.L'])
    cand = np.where((w3 > 0.5) & (src.G[np.arange(len(V))] if False else w3 > 0.5))[0]
    tip = V[cand[np.argmax((V[cand] - H['finger3-3.L']) @ d)]]
    wrist = H['wrist.L']
    length = (np.linalg.norm(H['finger3-1.L'] - wrist) + np.linalg.norm(Tl['finger3-1.L'] - H['finger3-1.L'])
              + np.linalg.norm(Tl['finger3-2.L'] - H['finger3-2.L']) + np.linalg.norm(tip - H['finger3-3.L']))
    # breadth across the metacarpal heads (index..little), perpendicular to the hand axis
    f, l, n = hand_frame(S)
    body_v = np.unique(src.F[src.G == 'body'])
    wh = S.bone_weight(len(V), set(HAND_BONES) - {'lowerarm01.L', 'lowerarm02.L'} - {'finger1-1.L', 'finger1-2.L', 'finger1-3.L'})
    vv = body_v[wh[body_v] > 0.5]
    m2, m5 = H['finger2-1.L'], H['finger5-1.L']
    # band of the knuckle line
    a = (V[vv] - m5)
    line = normalize(m2 - m5)
    pl = normalize(np.cross(n, line))      # roughly distal direction perpendicular to knuckle line
    band = np.abs(a @ pl) < 6.0
    proj = a[band] @ l
    breadth = proj.max() - proj.min()
    return dict(handLength=length * scale, handBreadth=breadth * scale,
                fingerLengths={k: (np.linalg.norm(Tl['finger%d-1.L' % k] - H['finger%d-1.L' % k]) +
                                   np.linalg.norm(Tl['finger%d-2.L' % k] - H['finger%d-2.L' % k]) +
                                   np.linalg.norm(Tl['finger%d-3.L' % k] - H['finger%d-3.L' % k])) * scale
                               for k in range(2, 6)})


# ----------------------------------------------------------------------------------------------
# nails (analytic rounded nail plate aligned with the nail fold sculpted in the MakeHuman mesh)
# ----------------------------------------------------------------------------------------------
def mean_curvature_proxy(P, T, N):
    import scipy.sparse as sp
    n = len(P)
    I = np.concatenate([T[:, 0], T[:, 1], T[:, 2], T[:, 1], T[:, 2], T[:, 0]])
    J = np.concatenate([T[:, 1], T[:, 2], T[:, 0], T[:, 0], T[:, 1], T[:, 2]])
    A = sp.csr_matrix((np.ones(len(I)), (I, J)), shape=(n, n))
    A.data[:] = 1
    deg = np.asarray(A.sum(1)).ravel()
    lap = (A @ P) / deg[:, None] - P
    return (lap * N).sum(1), A


class Nails:
    """Per finger: frame (h, d, up, side), proximal fold s0, half width hw, tip s1."""

    def __init__(self, P, T, N, joints, verbose=True):
        H, _ = mean_curvature_proxy(P, T, N)
        self.f = []
        for k in range(1, 6):
            h, t = joints['finger%d-3.L' % k]
            d = normalize(t - h)
            L = np.linalg.norm(t - h)
            s = (P - h) @ d
            r = P - h - np.outer(s, d)
            rn = np.linalg.norm(r, axis=1)
            near = (s > 0.0) & (s < 1.6 * L) & (rn < 12)
            up = np.array([0, 1.0, 0])
            if k == 1:      # thumb: nail direction from the nail-fold groove (concave ring) around the axis
                g = near & (H > 0.004) & (s > 0.3 * L) & (s < 0.9 * L)
                up = normalize(r[g].mean(0))
                up = rot_axis(d, math.radians(THUMB_NAIL_ROLL)) @ normalize(up - d * (up @ d))
            s0 = 0.45 * L
            for _ in range(3):
                up = normalize(up - d * (up @ d))
                side = np.cross(d, up)
                ang = np.arctan2(r @ side, r @ up)
                g = near & (H > 0.004) & (np.abs(ang) < 0.5) & (s > 0.25 * L) & (s < 0.9 * L)
                if g.sum() >= 5:
                    s0 = float(np.percentile(s[g], 30))
                    if k > 1:
                        up = normalize(r[near & (np.abs(ang) < 0.6) & (s > s0)].mean(0))
            s1 = float(s[near].max())
            band = near & (np.abs(s - (s0 + 0.3 * (s1 - s0))) < 0.8) & (rn < 10)
            sd = r[band] @ side
            fw = float(np.percentile(sd, 99) - np.percentile(sd, 1))
            hw = 0.40 * fw
            self.f.append(dict(h=h, d=d, up=up, side=side, s0=s0 + 0.3, s1=s1, hw=hw, L=L))
            if verbose:
                print('  nail %d: fold at %.2f L, finger width %.1f mm, nail width %.1f mm, length %.1f mm'
                      % (k, s0 / L, fw, 2 * hw, s1 - s0))

    def field(self, X, soft=0.25):
        """Signed distance-ish (mm) to the nail outline: >0 inside. Also returns (finger, u, v) coords."""
        best = np.full(len(X), -1e9)
        fid = np.full(len(X), -1)
        uu = np.zeros(len(X))
        vv = np.zeros(len(X))
        for i, f in enumerate(self.f):
            q = X - f['h']
            s = q @ f['d']
            r = q - np.outer(s, f['d'])
            rn = np.linalg.norm(r, axis=1)
            ang = np.arctan2(r @ f['side'], r @ f['up'])
            u = ang * rn
            # rounded-rectangle sdf in (u, s): proximal corners rounded, distal edge = arc following tip
            rc = 0.9 * f['hw']
            s_lo = f['s0']
            s_hi = f['s1'] - 0.9 - 1.6 * (u / f['hw']) ** 2
            du = np.abs(u) - f['hw']
            ds_lo = s_lo - s
            ds_hi = s - s_hi
            # inside distance (positive inside)
            # proximal rounded corners
            cx = np.maximum(du + rc, 0)
            cy = np.maximum(ds_lo + rc, 0)
            corner = rc - np.sqrt(cx ** 2 + cy ** 2)
            dist = np.minimum.reduce([corner, -du, -ds_lo, -ds_hi])
            dist = np.where((np.abs(ang) < 1.7) & (rn < 14) & (s > 0), dist, -1e9)
            upd = dist > best
            best = np.where(upd, dist, best)
            fid = np.where(upd, i, fid)
            uu = np.where(upd, u / f['hw'], uu)
            vv = np.where(upd, (s - s_lo) / max(f['s1'] - s_lo, 1e-6), vv)
        return best, fid, uu, vv


def split_by_field(P, T, TUV, val):
    """Split a triangle mesh along the zero iso-line of the per-vertex scalar `val`.
    Returns P2 and two triangle sets (val>=0 side, val<0 side) + their corner UVs."""
    inside = val >= 0
    cnt = inside[T].sum(1)
    newP = []
    edge_ids = {}

    def ev(a, b):
        key = (min(a, b), max(a, b))
        if key not in edge_ids:
            ta = val[a] / (val[a] - val[b])
            edge_ids[key] = len(P) + len(newP)
            newP.append(P[a] + ta * (P[b] - P[a]))
        return edge_ids[key]

    def euv(tri, uv, i, j):
        a, b = tri[i], tri[j]
        ta = val[a] / (val[a] - val[b])
        return uv[i] + ta * (uv[j] - uv[i])
    A_T, A_U, B_T, B_U = [T[cnt == 3]], [TUV[cnt == 3]], [T[cnt == 0]], [TUV[cnt == 0]]
    at, au, bt, bu = [], [], [], []
    mixed = (cnt == 1) | (cnt == 2)
    for tri, uv in zip(T[mixed], TUV[mixed]):
        ins = inside[tri]
        lone = ins if ins.sum() == 1 else ~ins          # the vertex alone on its side
        r = int(np.where(lone)[0][0])
        idx = [(r + k) % 3 for k in range(3)]
        tri, uv = tri[idx], uv[idx]
        e01, e02 = ev(tri[0], tri[1]), ev(tri[0], tri[2])
        u01, u02 = euv(tri, uv, 0, 1), euv(tri, uv, 0, 2)
        one = ([[tri[0], e01, e02]], [[uv[0], u01, u02]])
        two = ([[e01, tri[1], tri[2]], [e01, tri[2], e02]], [[u01, uv[1], uv[2]], [u01, uv[2], u02]])
        if ins.sum() == 1:
            at += one[0]; au += one[1]; bt += two[0]; bu += two[1]
        else:
            bt += one[0]; bu += one[1]; at += two[0]; au += two[1]
    if at:
        A_T.append(np.array(at)); A_U.append(np.array(au))
    if bt:
        B_T.append(np.array(bt)); B_U.append(np.array(bu))
    P2 = np.concatenate([P, np.array(newP).reshape(-1, 3)])
    return P2, np.concatenate(A_T), np.concatenate(A_U), np.concatenate(B_T), np.concatenate(B_U)


# ----------------------------------------------------------------------------------------------
# procedural 3-D noise (vectorised numpy)
# ----------------------------------------------------------------------------------------------
_PERM = np.random.RandomState(1234).permutation(256)
_PERM = np.concatenate([_PERM, _PERM]).astype(np.int64)
_GRAD = normalize(np.random.RandomState(99).normal(size=(256, 3)))


def _hash(ix, iy, iz):
    return _PERM[(_PERM[(_PERM[ix & 255] + iy) & 255] + iz) & 255]


def perlin(X):
    """Gradient noise, X (n,3) -> (n,) in about [-1,1]."""
    Xi = np.floor(X).astype(np.int64)
    Xf = X - Xi
    u = Xf * Xf * Xf * (Xf * (Xf * 6 - 15) + 10)
    out = 0
    res = {}
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                g = _GRAD[_hash(Xi[:, 0] + dx, Xi[:, 1] + dy, Xi[:, 2] + dz)]
                res[(dx, dy, dz)] = (g * (Xf - np.array([dx, dy, dz]))).sum(1)
    x0 = res[(0, 0, 0)] + u[:, 0] * (res[(1, 0, 0)] - res[(0, 0, 0)])
    x1 = res[(0, 1, 0)] + u[:, 0] * (res[(1, 1, 0)] - res[(0, 1, 0)])
    x2 = res[(0, 0, 1)] + u[:, 0] * (res[(1, 0, 1)] - res[(0, 0, 1)])
    x3 = res[(0, 1, 1)] + u[:, 0] * (res[(1, 1, 1)] - res[(0, 1, 1)])
    y0 = x0 + u[:, 1] * (x1 - x0)
    y1 = x2 + u[:, 1] * (x3 - x2)
    return (y0 + u[:, 2] * (y1 - y0)) * 1.4


def fbm(X, octaves=4, lac=2.03, gain=0.5):
    s, a, tot = 0, 1.0, 0
    for o in range(octaves):
        s = s + a * perlin(X * (lac ** o) + o * 17.13)
        tot += a
        a *= gain
    return s / tot


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------------------------
# skin shading model (evaluated in 3-D, baked into the atlas -> no visible seams)
# ----------------------------------------------------------------------------------------------
def srgb_to_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def ambient_occlusion(P, N, T, radius=14.0, strength=1.0, chunk=1500):
    """Disc-based ambient occlusion (Bunnell-style) per vertex."""
    from scipy.spatial import cKDTree
    c = P[T].mean(1)
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    area = 0.5 * np.linalg.norm(fn, axis=1)
    fn = normalize(fn)
    tree = cKDTree(c)
    occ = np.zeros(len(P))
    for i0 in range(0, len(P), chunk):
        idx = tree.query_ball_point(P[i0:i0 + chunk], radius)
        for k, lst in enumerate(idx):
            if not lst:
                continue
            j = np.array(lst)
            v = c[j] - P[i0 + k]
            d2 = (v * v).sum(1) + 1e-9
            d = np.sqrt(d2)
            vh = v / d[:, None]
            cr = np.clip(vh @ N[i0 + k], 0, 1)
            ce = np.clip(-(fn[j] * vh).sum(1), 0, 1)
            w = area[j] * cr * ce / (np.pi * d2 + area[j])
            w *= d > 0.8                                   # ignore the immediate neighbourhood
            occ[i0 + k] = w.sum()
    return np.clip(1 - strength * occ, 0, 1)


class SkinModel:
    def __init__(self, P, N, T, A, joints, nails, mh_color, verbose=True):
        self.J = joints
        self.nails = nails
        # base skin tone from the MakeHuman young caucasian female texture
        self.base = mh_color.mean(0)
        if verbose:
            print('  MakeHuman mean skin colour (sRGB):', np.round(lin_to_srgb(self.base) * 255).astype(int))
        # wrist / hand helpers
        self.wrist = joints['wrist.L'][0]
        self.knuckles = []
        for k in range(2, 6):
            for seg, rad, amp in ((1, 8.0, 0.55), (2, 5.5, 1.0), (3, 4.2, 0.75)):
                h, t = joints['finger%d-%d.L' % (k, seg)]
                d = normalize(t - h)
                self.knuckles.append((h, d, rad, amp, seg))
        h, t = joints['finger1-2.L']
        self.knuckles.append((h, normalize(t - h), 6.0, 0.8, 2))
        h, t = joints['finger1-3.L']
        self.knuckles.append((h, normalize(t - h), 4.5, 0.8, 3))

    # -- height field (mm) --------------------------------------------------------------------
    def height(self, X):
        n = len(X)
        nail_d, fid, uu, vv = self.nails.field(X)
        nail = smoothstep(-0.15, 0.15, nail_d)
        # pores: small dimples
        p = perlin(X * 3.4 + 3.1)
        pores = -smoothstep(0.38, 0.8, -p) * 0.010
        p2 = perlin(X * 5.9 + 7.7)
        pores += -smoothstep(0.45, 0.85, -p2) * 0.005
        # micro relief (dermatoglyphic crosshatch-ish)
        r1 = 1 - np.abs(perlin(X * np.array([1.6, 1.2, 0.9]) + 11.0))
        r2 = 1 - np.abs(perlin(X * np.array([0.9, 1.4, 1.7]) + 23.0))
        micro = (r1 ** 6 + r2 ** 6) * 0.006
        h = pores + micro
        # knuckle wrinkles (dorsal side of the finger joints)
        wr = self.wrinkles(X)
        h += -wr * 0.035
        # fingerprints on the finger pads (palmar side of the distal phalanges)
        h += self.fingerprints(X) * 0.004
        # nails: smooth plate with faint longitudinal ridges
        ridges = 0.0015 * np.sin(uu * 40.0 + 2 * perlin(X * 0.8))
        h = h * (1 - nail) + nail * ridges
        return h

    def wrinkles(self, X):
        w = np.zeros(len(X))
        X_all = X
        for (h, d, rad, amp, seg) in self.knuckles:
            sel = np.where(((X_all - h) ** 2).sum(1) < 16.0 ** 2)[0]
            if len(sel) == 0:
                continue
            X = X_all[sel]
            q = X - h
            s = q @ d
            r = q - np.outer(s, d)
            rn = np.linalg.norm(r, axis=1) + 1e-9
            up = np.array([0, 1.0, 0])
            upp = normalize(up - d * (up @ d))
            cosang = (r @ upp) / rn
            dors = smoothstep(0.15, 0.7, cosang)
            env = np.exp(-(s / (rad * 0.55)) ** 2) * dors * (rn < 13)
            if not env.any():
                continue
            side = np.cross(d, upp)
            u = (r @ side)
            wob = 0.35 * perlin(X * 0.7 + seg * 5.0)
            # creases curve slightly (smile shape) and are spaced ~1 mm
            phase = (s + 0.04 * u * u + wob) / (0.95 if seg > 1 else 1.4)
            lines = np.cos(phase * 2 * np.pi)
            crease = smoothstep(0.55, 0.95, lines)
            w[sel] += amp * env * crease * (0.6 + 0.4 * perlin(X * 1.5 + seg))
        return np.clip(w, 0, 1.5)

    def fingerprints(self, X):
        out = np.zeros(len(X))
        for k in range(1, 6):
            h, t = self.J['finger%d-3.L' % k]
            d = normalize(t - h)
            L = np.linalg.norm(t - h)
            q = X - (h + d * 0.65 * L)
            s = q @ d
            r = q - np.outer(s, d)
            rn = np.linalg.norm(r, axis=1) + 1e-9
            pal = -(r[:, 1]) / rn
            m = smoothstep(0.0, 0.5, pal) * np.exp(-(s / (0.45 * L)) ** 2) * (rn < 12)
            if not m.any():
                continue
            ell = np.sqrt((s / 1.3) ** 2 + (r[:, 0]) ** 2)
            out += m * np.sin(2 * np.pi * (ell / 0.46 + 0.6 * perlin(X * 0.5)))
        return out

    # -- colour (linear) + roughness -------------------------------------------------------------
    def shade(self, X, Nrm, mhcol, ao):
        n = len(X)
        base = mhcol.copy()
        nail_d, fid, uu, vv = self.nails.field(X)
        nail = smoothstep(-0.12, 0.12, nail_d)
        # mottling
        m1 = fbm(X / 7.0, 3)
        m2 = fbm(X / 2.2 + 5.0, 2)
        lum = 1 + 0.045 * m1 + 0.02 * m2
        red = np.array([1.0, 0.80, 0.78])
        col = base * lum[:, None]
        # redness: knuckles, fingertips, palm
        rk = np.zeros(n)
        for (h, d, rad, amp, seg) in self.knuckles:
            q = X - h
            s = q @ d
            r = q - np.outer(s, d)
            rn = np.linalg.norm(r, axis=1) + 1e-9
            dors = smoothstep(0.0, 0.8, (r[:, 1]) / rn)
            rk += amp * dors * np.exp(-(s * s + 0.6 * (r[:, 0] ** 2)) / (rad * rad)) * (rn < 14)
        tip = np.zeros(n)
        for k in range(1, 6):
            h, t = self.J['finger%d-3.L' % k]
            d = normalize(t - h)
            L = np.linalg.norm(t - h)
            s = (X - h) @ d
            r = X - h - np.outer(s, d)
            tip += smoothstep(0.35 * L, 1.0 * L, s) * (np.linalg.norm(r, axis=1) < 13)
        palm = smoothstep(-0.2, -0.7, Nrm[:, 1]) * (X[:, 2] < self.wrist[2] + 10)
        redness = np.clip(0.20 * rk + 0.16 * tip + 0.10 * palm + 0.04 * m2, 0, 0.45)
        col = col * (1 - redness[:, None]) + col * red * redness[:, None]
        col = col * (1 + 0.05 * palm)[:, None]
        # faint veins on the back of the hand / wrist
        vx = X * np.array([0.25, 0.35, 0.06])
        vein = smoothstep(0.90, 0.985, 1 - np.abs(perlin(vx + 3.3)))
        vmask = smoothstep(0.3, 0.8, Nrm[:, 1]) * smoothstep(-10, 25, X[:, 2]) * smoothstep(160, 90, X[:, 2])
        vein *= vmask * 0.10
        col = col * (1 - vein[:, None]) + (col * np.array([0.82, 0.86, 1.02])) * vein[:, None]
        # wrinkle creases darker / slightly redder, pores slightly darker
        wr = self.wrinkles(X)
        col *= (1 - 0.16 * np.clip(wr, 0, 1))[:, None]
        p = perlin(X * 3.4 + 3.1)
        col *= (1 - 0.035 * smoothstep(0.38, 0.8, -p))[:, None]
        # cuticle / nail fold rim
        rim = np.exp(-((nail_d + 0.45) / 0.45) ** 2) * (nail_d > -2.0)
        col = col * (1 - 0.18 * rim[:, None]) + col * red * 0.18 * rim[:, None]
        # nails
        nbed = srgb_to_lin(np.array([0.93, 0.74, 0.72]))
        lunula = srgb_to_lin(np.array([0.95, 0.88, 0.86]))
        free = srgb_to_lin(np.array([0.97, 0.94, 0.90]))
        ncol = nbed * (1 + 0.04 * perlin(X * 2.0))[:, None]
        lun = smoothstep(0.30, 0.18, np.sqrt((vv - 0.0) ** 2 * 1.0 + (uu * 0.28) ** 2)) * (fid <= 2)
        ncol = ncol * (1 - lun[:, None]) + lunula * lun[:, None]
        fe = smoothstep(0.80, 0.90, vv + 0.04 * perlin(X * 3.0))
        ncol = ncol * (1 - fe[:, None]) + free * fe[:, None]
        streak = 0.03 * np.sin(uu * 25.0 + perlin(X) * 3)
        ncol *= (1 + streak)[:, None]
        col = col * (1 - nail[:, None]) + ncol * nail[:, None]
        rough = 0.53 + 0.05 * smoothstep(0.38, 0.8, -p) + 0.06 * np.clip(wr, 0, 1) + 0.04 * palm + 0.03 * m1
        rough = rough * (1 - nail) + 0.22 * nail
        return np.clip(col, 0, 1), np.clip(rough, 0.05, 1), ao


# ----------------------------------------------------------------------------------------------
# atlas + bake
# ----------------------------------------------------------------------------------------------
def make_atlas(P, T, res, padding=6):
    import xatlas
    atlas = xatlas.Atlas()
    atlas.add_mesh(P.astype(np.float32), T.astype(np.uint32))
    co = xatlas.ChartOptions()
    po = xatlas.PackOptions()
    po.resolution = res
    po.padding = padding
    po.bilinear = True
    atlas.generate(co, po)
    vm, idx, uv = atlas[0]
    return vm.astype(np.int64), idx.astype(np.int64), uv.astype(np.float64), atlas.chart_count


def rasterize(uvpix, T, res):
    """uvpix (n,2) pixel coords (x right, y down); returns tri id (-1 empty) and barycentrics."""
    tid = -np.ones((res, res), np.int64)
    bary = np.zeros((res, res, 2), np.float32)
    tri = uvpix[T]
    mn = np.floor(tri.min(1)).astype(int)
    mx = np.ceil(tri.max(1)).astype(int)
    mn = np.clip(mn, 0, res - 1)
    mx = np.clip(mx, 0, res - 1)
    for i in range(len(T)):
        (x0, y0), (x1, y1) = mn[i], mx[i]
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        a, b, c = tri[i]
        v0, v1 = b - a, c - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        px, py = xs - a[0], ys - a[1]
        l1 = (px * v1[1] - v1[0] * py) / den
        l2 = (v0[0] * py - px * v0[1]) / den
        inside = (l1 >= -1e-4) & (l2 >= -1e-4) & (l1 + l2 <= 1 + 1e-4)
        if not inside.any():
            continue
        yy = (ys[inside] - 0.5).astype(int)
        xx = (xs[inside] - 0.5).astype(int)
        tid[yy, xx] = i
        bary[yy, xx, 0] = l1[inside]
        bary[yy, xx, 1] = l2[inside]
    return tid, bary


def dilate(img, mask, iterations=None):
    from scipy import ndimage
    idx = ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
    return img[idx[0], idx[1]]


def bake(P, N, T, UV, vattr, model, res, chunk=400000, verbose=True):
    """P,N per atlas vertex; T atlas triangles; UV (n,2) in [0,1]; vattr dict of per-vertex arrays."""
    import time
    t0 = time.time()
    uvpix = UV * res
    tid, bary = rasterize(uvpix, T, res)
    if verbose:
        print('  rasterized %d texels in %.1fs' % ((tid >= 0).sum(), time.time() - t0))
    # per-triangle tangent frame from uv gradients (matches three.js derivative tangents)
    p0, p1, p2 = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    u0, u1, u2 = UV[T[:, 0]], UV[T[:, 1]], UV[T[:, 2]]
    e1, e2 = p1 - p0, p2 - p0
    d1, d2 = u1 - u0, u2 - u0
    r = 1.0 / np.where(np.abs(d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]) < 1e-14, 1e-14,
                       d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1])
    Tu = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) * r[:, None]     # dP/du
    Tv = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) * r[:, None]     # dP/dv
    ys, xs = np.where(tid >= 0)
    ti = tid[ys, xs]
    b1, b2 = bary[ys, xs, 0].astype(float), bary[ys, xs, 1].astype(float)
    b0 = 1 - b1 - b2
    n_tex = len(ti)
    albedo = np.zeros((n_tex, 3))
    rough = np.zeros(n_tex)
    occl = np.zeros(n_tex)
    nmap = np.zeros((n_tex, 3))
    eps = 0.02
    for c0 in range(0, n_tex, chunk):
        sl = slice(c0, c0 + chunk)
        tt = T[ti[sl]]
        w = np.stack([b0[sl], b1[sl], b2[sl]], 1)

        def interp(A):
            return (A[tt] * w[..., None]).sum(1) if A.ndim == 2 else (A[tt] * w).sum(1)
        X = interp(P)
        Nn = normalize(interp(N))
        tu = Tu[ti[sl]]
        tv = Tv[ti[sl]]
        # gradient-based frame projected on the surface (like three.js getTangentFrame)
        tu = normalize(tu - Nn * (tu * Nn).sum(1, keepdims=True))
        tv = normalize(tv - Nn * (tv * Nn).sum(1, keepdims=True))
        h0 = model.height(X)
        hu = model.height(X + tu * eps)
        hv = model.height(X + tv * eps)
        gx, gy = (hu - h0) / eps, (hv - h0) / eps
        nm = normalize(np.stack([-gx, -gy, np.ones_like(gx)], 1))
        nmap[sl] = nm
        col, ro, ao = model.shade(X, Nn, interp(vattr['mh']), interp(vattr['ao']))
        albedo[sl], rough[sl], occl[sl] = col, ro, ao
        if verbose:
            print('    baked %d/%d texels (%.0fs)' % (min(c0 + chunk, n_tex), n_tex, time.time() - t0))
    mask = tid >= 0
    A = np.zeros((res, res, 3))
    A[ys, xs] = lin_to_srgb(albedo)
    Nm = np.zeros((res, res, 3))
    Nm[ys, xs] = nmap * 0.5 + 0.5
    O = np.zeros((res, res, 3))
    O[ys, xs, 0] = occl
    O[ys, xs, 1] = rough
    A, Nm, O = dilate(A, mask), dilate(Nm, mask), dilate(O, mask)
    return A, Nm, O


def to_jpeg(img, quality, size=None):
    from PIL import Image
    im = Image.fromarray(np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8))
    if size and size != im.width:
        im = im.resize((size, size), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=quality, optimize=True, progressive=False, subsampling=0 if quality >= 90 else 2)
    return b.getvalue()


class HttpRangeFile(io.RawIOBase):
    """Minimal seekable read-only file over HTTP range requests (to pull one member out of a
    280 MB zip without downloading all of it)."""

    def __init__(self, url):
        self.url = url
        req = urllib.request.Request(url, method='HEAD')
        with urllib.request.urlopen(req) as r:
            self.size = int(r.headers['Content-Length'])
        self.pos = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b''
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.url, headers={'Range': 'bytes=%d-%d' % (self.pos, end)})
        with urllib.request.urlopen(req) as r:
            data = r.read()
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def get_skin_texture(cache):
    out = os.path.join(cache, 'sysassets', SKIN_IN_ZIP)
    if not os.path.exists(out):
        print('  fetching', SKIN_IN_ZIP, 'from', SYS_ASSETS_ZIP)
        local_zip = os.path.join(cache, 'sysassets', 'makehuman_system_assets_cc0.zip')
        src = local_zip if os.path.exists(local_zip) else io.BufferedReader(HttpRangeFile(SYS_ASSETS_ZIP), 1 << 20)
        with zipfile.ZipFile(src) as z:
            data = z.read(SKIN_IN_ZIP)
            mhmat = z.read(os.path.dirname(SKIN_IN_ZIP) + '/young_caucasian_female.mhmat')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, 'wb').write(data)
        open(out.replace('.png', '.mhmat'), 'wb').write(mhmat)
    return out


def smooth_vertex_field(A, F, iters):
    deg = np.asarray(A.sum(1)).ravel()
    for _ in range(iters):
        F = (A @ F + F) / (deg + 1)[:, None]
    return F


# ----------------------------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------------------------
def build(cache, out_dir, tex_res=4096, pose=POSE, verbose=True):
    from PIL import Image
    import pygltflib as G
    print('[1/6] MakeHuman sources + morph targets')
    src = Source(cache)
    print('[2/6] pose, extract, subdivide, orient, scale')
    m = build_mesh(src, pose)
    P, T, TUV, J = m['P'], m['T'], m['TUV'], m['joints']
    N = vertex_normals(P, T)
    nails = Nails(P, T, N, J, verbose)
    val = nails.field(P)[0]
    P, AT, AU, BT, BU = split_by_field(P, T, TUV, val)
    P, Tall, _ = compact(P, np.concatenate([BT, AT]))
    Uall = np.concatenate([BU, AU])
    n_skin = len(BT)
    N = vertex_normals(P, Tall)
    print('  final mesh: %d vertices, %d triangles (%d nail)' % (len(P), len(Tall), len(AT)))
    print('[3/6] MakeHuman skin colour (low frequency) + ambient occlusion')
    skin_png = get_skin_texture(cache)
    img = np.asarray(Image.open(skin_png).convert('RGB')).astype(float) / 255.0
    Hh, Ww = img.shape[:2]
    # blur the MakeHuman texture strongly: only its low-frequency tone is used
    from scipy import ndimage
    img_l = srgb_to_lin(img)
    img_b = np.stack([ndimage.gaussian_filter(img_l[..., c], 6) for c in range(3)], -1)
    x = np.clip((Uall[..., 0] * Ww).astype(int), 0, Ww - 1)
    y = np.clip(((1 - Uall[..., 1]) * Hh).astype(int), 0, Hh - 1)
    ccol = img_b[y, x]                                         # (t,3,3)
    vcol = np.zeros((len(P), 3))
    cnt = np.zeros(len(P))
    np.add.at(vcol, Tall.reshape(-1), ccol.reshape(-1, 3))
    np.add.at(cnt, Tall.reshape(-1), 1)
    vcol /= np.maximum(cnt, 1)[:, None]
    _, A = mean_curvature_proxy(P, Tall, N)
    vcol = smooth_vertex_field(A, vcol, 80)
    # keep MakeHuman's tone but limit its variation (its painted hand is low-res)
    mean = vcol.mean(0)
    target = srgb_to_lin(np.array([0.925, 0.79, 0.725]))       # light young skin, close to MH mean
    ratio = np.clip(vcol / mean, 0.88, 1.12) ** 0.6
    vcol = target * ratio
    ao = ambient_occlusion(P, N, Tall, radius=14.0, strength=1.1)
    ao = np.clip(0.25 + 0.75 * ao, 0, 1)
    print('[4/6] UV atlas')
    vm, idx, uv, nch = make_atlas(P, Tall, tex_res)
    print('  %d charts, %d atlas vertices' % (nch, len(vm)))
    Pa, Na = P[vm], N[vm]
    vattr = dict(mh=vcol[vm], ao=ao[vm])
    model = SkinModel(P, N, Tall, A, J, nails, vcol, verbose)
    print('[5/6] bake textures %dx%d' % (tex_res, tex_res))
    alb, nrm, orm = bake(Pa, Na, idx, uv, vattr, model, tex_res, verbose=verbose)
    print('[6/6] export')
    os.makedirs(out_dir, exist_ok=True)
    jb = to_jpeg(alb, 88)
    jn = to_jpeg(nrm, 90)
    jo = to_jpeg(orm, 85, size=tex_res // 2)
    images = [(jb, 'image/jpeg'), (jn, 'image/jpeg'), (jo, 'image/jpeg')]
    skin = G.Material(
        name='skin',
        pbrMetallicRoughness=G.PbrMetallicRoughness(
            baseColorTexture=G.TextureInfo(index=0), metallicFactor=0.0, roughnessFactor=1.0,
            metallicRoughnessTexture=G.TextureInfo(index=2)),
        normalTexture=G.NormalMaterialTexture(index=1, scale=1.0),
        occlusionTexture=G.OcclusionTextureInfo(index=2, strength=1.0))
    nail = G.Material(
        name='nails',
        pbrMetallicRoughness=G.PbrMetallicRoughness(
            baseColorTexture=G.TextureInfo(index=0), baseColorFactor=[1.0, 0.98, 0.98, 1.0],
            metallicFactor=0.0, roughnessFactor=1.0, metallicRoughnessTexture=G.TextureInfo(index=2)),
        normalTexture=G.NormalMaterialTexture(index=1, scale=0.6),
        occlusionTexture=G.OcclusionTextureInfo(index=2, strength=1.0),
        extensions={'KHR_materials_clearcoat': {'clearcoatFactor': 0.6, 'clearcoatRoughnessFactor': 0.12}})
    uvf = uv.astype(np.float32)
    prims = [dict(pos=Pa, nrm=Na, uv=uvf, idx=idx[:n_skin], material=0),
             dict(pos=Pa, nrm=Na, uv=uvf, idx=idx[n_skin:], material=1)]
    glb = os.path.join(out_dir, 'hand.glb')
    write_glb(glb, prims, images, [skin, nail], extensions_used=['KHR_materials_clearcoat'])
    meas = measure_rest(src, m['scale'])
    # posed length: wrist joint to middle fingertip (along -Z)
    minY = float(Pa[:, 1].min())
    info = {
        'ringCircumference': RING_PERIMETER,
        'minY': round(minY, 3),
        'handLength': round(float(meas['handLength']), 1),
        'forearmEndZ': round(float(Pa[:, 2].max()), 3),
        'handBreadth': round(float(meas['handBreadth']), 1),
        'ringFingerPosition': 'origin, %.0f%% of the way from the MCP to the PIP joint' % (100 * m['ring_k']),
        'units': 'mm',
        'source': 'MakeHuman 1.x base mesh, macro/arm targets, default skeleton + weights, '
                  'young_caucasian_female skin (makehumancommunity, CC0 1.0); posed, subdivided, '
                  'atlased and procedurally textured by tools/build_hand.py',
        'license': 'CC0',
    }
    json.dump(info, open(os.path.join(out_dir, 'hand.json'), 'w'), indent=2)
    print('  hand.glb %.2f MB, %d triangles; textures: base %.2f MB, normal %.2f MB, orm %.2f MB'
          % (os.path.getsize(glb) / 1e6, len(idx), len(jb) / 1e6, len(jn) / 1e6, len(jo) / 1e6))
    print('  ' + json.dumps(info))
    print('  measured (straight-finger rest pose): hand length %.1f mm, breadth %.1f mm, finger lengths %s'
          % (meas['handLength'], meas['handBreadth'],
             {k: round(float(v), 1) for k, v in meas['fingerLengths'].items()}))
    return info


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cache', default=os.environ.get('HAND_CACHE', os.path.expanduser('~/.cache/ring-design-hand')),
                    help='download cache (not committed)')
    ap.add_argument('--out', default=os.path.join(REPO, 'assets', 'hand'))
    ap.add_argument('--tex', type=int, default=2048)
    a = ap.parse_args()
    build(a.cache, a.out, a.tex)


if __name__ == '__main__':
    main()
