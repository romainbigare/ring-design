# Hand model license

`hand.glb` and `hand.json` are released under **CC0 1.0 Universal** (public domain dedication),
https://creativecommons.org/publicdomain/zero/1.0/

They are derived (by `tools/build_hand.py`) exclusively from MakeHuman assets, which were explicitly
released as CC0 in September 2020 (see section C of
https://raw.githubusercontent.com/makehumancommunity/makehuman/master/LICENSE.md):

- Base mesh: https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj
- Macro targets (caucasian/asian/african-female-young, universal-female-young-averagemuscle-minweight,
  proportions/female-young-averagemuscle-averageweight-idealproportions) and
  armslegs/l-hand-fingers-diameter-decr:
  https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/targets/
- Skeleton + skin weights (`license: CC0` in the files):
  https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/rigs/default.mhskel,
  .../rigs/default_weights.mhw
- Skin tone reference: `skins/young_caucasian_female/young_lightskinned_female_diffuse.png` (header of
  its .mhmat: "explicitly released as CC0 in september 2020") from the MakeHuman system assets pack
  https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip

The baked textures (colour, normal, occlusion/roughness) are generated procedurally by the build
script, using only the heavily blurred MakeHuman skin tone. No other third-party content is included.
