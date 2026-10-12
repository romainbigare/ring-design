# Ring Studio

A small web app to design an engagement ring in 3D. The ring has an oval rose cut
diamond in the centre, surrounded by a halo of small diamonds (an "entourage").
You can change every part of the design with sliders and see the result at once,
with realistic light, fire and sparkle. It works on desktop and on phones.

## Run it on your computer

You need Python 3. Open a terminal in this folder and run:

    python3 -m http.server

Then open http://localhost:8000 in your browser. (Opening `index.html` directly
does not work, because browsers block ES modules on `file://` links.)

## Put it online with GitHub Pages

1. Push this folder to a GitHub repository (the file `.nojekyll` must stay in the root).
2. On GitHub go to **Settings → Pages**.
3. Under "Build and deployment", choose **Deploy from a branch**.
4. Select the branch `main` and the folder `/ (root)`, then click **Save**.
5. After a minute your ring designer is online at `https://<your-name>.github.io/<repo-name>/`.

## Presets

The photo shows two designs. They are the presets in the "Design" box:

- **Ring A**: 12 halo stones, a little more space between the stones.
- **Ring B**: 16 halo stones, a tight and full entourage.

## Parameters

- **Centre diamond**: width, height, depth, number of rose facet rings, bezel wall.
- **Entourage**: number of stones, auto size, stone size, space between stones,
  distance to the centre, setting wall, milgrain beads and bead size.
- **Cardinal stones** (north, south, east, west): shape (round, pear, marquise) and size.
- **Connection legs**: legs mode, leg width, head height.
- **Band**: ring size (EU), metal (yellow, rose, white gold, platinum), width,
  thickness, taper, profile (comfort, round, flat).
- **Studio**: backdrop, exposure, sparkle glow, fire (dispersion), light bounces, turn table.

Tips: double-click a slider name to reset it. Click on a number to type your own value.
Use the buttons at the bottom to change the view, take a photo, copy a share link, or reset.

### Ring size

The default size is **49.75 EU**. An EU size is the inner circumference in mm,
so 49.75 mm of circumference gives an inner diameter of about **15.84 mm**
(49.75 / π).

## How it works

- The scene is drawn with [three.js](https://threejs.org/).
- The diamonds use ray tracing inside each convex stone: light enters, bends
  (refraction), bounces on the facets, and leaves. Each colour bends a little
  differently (dispersion), which creates the coloured "fire".
- The lighting comes from a procedural studio environment made in code, so no
  image files are needed.
- All design values are stored in the share link, so you can send a design to anyone.
