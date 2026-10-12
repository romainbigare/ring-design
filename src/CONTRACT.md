# Module contracts (internal notes)

Units: **millimetres** everywhere. World axes:
- Finger axis = **Z**. Ring band lies in the XY plane, centred at origin.
- Head (stones) on top, at **+Y**. Stones face **+Y**.
- Centre oval: width (9.2 mm) along **X** (across the finger, "east-west"),
  height (6 mm) along **Z** (along the finger).

## src/gems.js  (diamond geometry + refraction material)

```js
// Rose cut oval. Local origin = centre of the flat base. Base at y=0, dome up to y=depth.
buildRoseCut({ width, length, depth, girdle = 0.12, rings = 3 }) ->
  { geometry, planes, outline, height }
// Brilliant-style stone. Local origin = centre of girdle (mid thickness).
// shape: 'round' | 'pear' | 'marquise'. For pear/marquise the point(s) are along +Z
// (the pear tip at +Z). Size: width along X, length along Z (round: width=length=diameter).
buildBrilliant({ shape, width, length, girdle = 0.03*width }) ->
  { geometry, planes, outline, crownHeight, pavilionDepth }
//   geometry: non-indexed BufferGeometry, flat normals, position+normal attributes
//   planes:   THREE.Vector4[] (nx,ny,nz,d) in object space, outward normals, n·p = d on the face
//   outline:  THREE.Vector2[] girdle outline (x, z) in object space, CCW, ~64 points

createDiamondMaterial({ planes, envMap /* THREE.CubeTexture or WebGLCubeRenderTarget.texture */,
                        ior = 2.42, dispersion = 0.012, bounces = 5,
                        backTint = THREE.Color | null /* closed-back gold cup colour, null = open */ })
  -> THREE.ShaderMaterial
setDiamondPlanes(material, planes)
setDiamondEnv(material, envMap)
setDiamondOptions(material, { ior, dispersion, bounces, backTint, exposure })
```
Meshes using the material may have rotation, translation and **uniform** scale.

## src/ui.js (control panel)
```js
createPanel(rootEl, schema, state, onChange) -> { refresh() }
```
See schema in src/main.js.
