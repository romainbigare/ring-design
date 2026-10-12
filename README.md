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

## My designs

At the top of the panel, **My designs** keeps your own versions of the ring:

- **+ Save** stores the current ring under a name (same name = update it).
- Tap a name to open that design. The design you are looking at is shown in gold.
- **×** removes a design. You can **Undo** for a few seconds.

Designs are saved in this browser (local storage). To send a design to another
person or device, use the **Share** button. On the first visit, four starter
designs are added: **Ring A** and **Ring B** (first photo, 12 and 16 stones),
**Ring C** (second photo: ribbed, pear-shaped pointy collars) and **Ring D**
(big / small pattern). You can remove them like any other design.

## Parameters

- **Centre diamond**: width, height, depth, number of rose facet rings
  (2 = classic Dutch rose with 24 facets, 3 = 60 facets), gold glow in the stone, bezel wall.
- **Entourage**: number of stones, auto size, stone size, space between stones,
  distance to the centre, setting collar width, ribbed collar and rib depth,
  milgrain beads (around the stone, on the outer edge, or both) and bead size.
- **Stone pattern**: all the same, big·small, big·small·small, big·3 small,
  big·big·small, or graduated sizes (big at N/S/E/W, at the diagonals, or at
  the sides); size of the small stones; and where they sit (centred, on the
  inner edge, or on the outer edge). Patterns start from the cardinal stones,
  so the ring always stays symmetric.
- **Cardinal stones** (north, south, east, west): round, round with a pointy
  collar, pear or marquise; size; and for the pointy collar its point length
  and point shape (from sharp to a soft pear).
- **Connection arms**: gold arms from the centre bezel to the halo stones
  (auto = only when a stone does not touch the bezel), arm width, head height.
- **Band**: ring size (EU), metal (yellow, rose, white gold, platinum), width,
  thickness, taper, profile (comfort, round, flat).
- **Studio**: backdrop, exposure, sparkle glow, fire (dispersion), light bounces, turn table.

All sections start closed, and a slider only shows when it matters (for
example "Point length" only for the pointy collar).

Tips: double-click a slider name to reset it. Click on a number to type your own value.
Drag the ring to turn it, and pinch or scroll to zoom. On a computer, the buttons at
the bottom give quick views (top, 3/4, side, hand). The **Share** button in the
panel gives a link with the full design in it (on a phone it opens the share menu).

### Ring size

The default size is **49.75 EU**. An EU size is the inner circumference in mm,
so 49.75 mm of circumference gives an inner diameter of about **15.84 mm**
(49.75 / π).

## Hand

The **Hand** button shows the ring worn on a woman's left hand (ring finger).
The hand is built from [MakeHuman](https://github.com/makehumancommunity/makehuman)
assets (CC0, public domain) by `tools/build_hand.py`, and is real size: the ring
finger measures exactly the ring size around (49.75 mm by default; the hand
scales with the ring size slider). Hand length is about 17.3 cm. The skin tone
can be changed in the Studio section. See `assets/hand/LICENSE.md`.

## How it works

- The scene is drawn with [three.js](https://threejs.org/).
- The diamonds use ray tracing inside each convex stone: light enters, bends
  (refraction), bounces on the facets, and leaves. Each colour bends a little
  differently (dispersion), which creates the coloured "fire".
- The rose cut is built facet by facet: a star of 6 triangles at the top, then
  rings of triangles that double each time (6 → 12 → 24), on a flat base.
- The lighting comes from a procedural studio environment made in code (soft
  boxes, strip lights, small spots, black flags), so no image files are needed.
- The floor shadow is a real contact shadow: the ring is seen from below,
  blurred, and laid on the dark slate (or white, velvet) backdrop.
- The design is stored in a short code in the page address, for example
  `?r=hc12_cp1_cs1.3`. Each setting has a 2-letter code, and only the values
  that differ from a fixed base design are written, so links stay short and
  always open the same ring. Older long links still work.
