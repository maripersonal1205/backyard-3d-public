// The demo site's made-up yard (demo/demo-yard.glb, made by Codex with
// demo/build_demo_yard.py; its measurements are in demo/DEMO_YARD_NOTES.md).
// Same axes as Mari's yard: the back fence is at z = 0 (south), the house at +z.
// Change this file for the demo only. (Mari's own yard, home.js, isn't in this public copy.)

export const MODEL = "./demo/demo-yard.glb";

// Items in the model that the viewer manages, keyed by node name, with the
// All tab category they're listed in (see home.js).
export const ITEMS = {
  boxwood_shrub_01: { label: "Boxwood", category: "Plants" },
  raised_garden_bed_01: { label: "Raised garden bed", category: "Planters" },
  bird_bath_01: { label: "Bird bath", category: "Decor" },
  terracotta_planter_01: { label: "Terracotta planter", category: "Planters" },
  patio_umbrella_open_01: { label: "Patio umbrella", category: "Shade" },
  wall_lantern_01: { label: "Wall lantern", category: "Lighting", attached: "wall" },
};

export const ITEM_PARTS = {};

// Open ground inside the fences, from Codex's measurements: fences at
// x = -4.25 / 9.73 and z = 0, the house and garage back walls at z = 5.80
// (kept 8 cm off, for door trim and thresholds), and the strip right of the
// house running to z = 10.60 (both now the walkway).
export const YARD_REGIONS = [
  { minX: -4.25, maxX: 9.73, minZ: 0.02, maxZ: 5.72 }, // between the back fence and the house/garage
  { minX: 8.53, maxX: 9.73, minZ: 0.02, maxZ: 10.55 }, // narrow strip right of the house
];

// The walkway runs along the back of the house and garage (0.6 m, between
// the patio and the wall) and down the strip right of the house (Mari,
// 2026-10-02).
export const GROUND_AREAS = {
  demo_lawn: { label: "Lawn", surface: "lawn-lush" },
  demo_patio: { label: "Patio", surface: "concrete-brushed" },
  demo_walkway: { label: "Walkway", surface: "concrete-weathered" },
  demo_planting_bed: { label: "Planting bed", surface: "mulch" },
};

// Ground surfaces only the demo offers, listed after the shared ones in
// library/surfaces/. Weathered concrete is the texture of Mari's own patio
// and walkways (the weathered_concrete material in backyard.glb, copied
// unchanged), which the demo doesn't load. Paths are relative to the page.
export const SURFACES_EXTRA = [
  {
    id: "concrete-weathered",
    label: "Weathered concrete",
    tile: 2.0,
    color: "demo/surfaces/concrete-weathered/color.webp",
    normal: "demo/surfaces/concrete-weathered/normal.webp",
    rough: "demo/surfaces/concrete-weathered/rough.webp",
    swatch: "demo/surfaces/concrete-weathered/swatch.webp",
  },
];

// Walk mode starts on the lawn in the back right corner, looking across the
// yard at the patio, the house and the garage.
export function walkSpawn(items, clampPoint) {
  const from = clampPoint(8.9, 1.6, 0.3), to = { x: -2.5, z: 4.6 };
  return { ...from, yaw: Math.atan2(-(to.x - from.x), -(to.z - from.z)) };
}

// Plan view starts on the yard itself (fences to the house), not the whole roof.
export const PLAN_FRAME = { minX: -4.6, maxX: 10.1, minZ: -0.4, maxZ: 6.2 };

// The yard visitors start with (Mari's arrangement, copied from the live demo
// on 2026-10-01; string lights resized 2026-10-02): Library items and the
// AI-made string lights instead of most of the model's own items. "Revert to
// original" and New plan go back to this too. The model's own items that
// aren't listed (boxwood, bird bath, planter) can still be added from the All
// tab. Same shape as a saved plan.
const Q = Math.PI / 2; // a quarter turn
export const START_LAYOUT = {
  items: [
    { id: "raised_garden_bed_01", key: "raised_garden_bed_01", label: "Raised garden bed", placed: true, t: { p: [0.345, 0, 0.697], r: 0, s: [0.796, 0.796, 0.796] } },
    { id: "patio_umbrella_open_01", key: "patio_umbrella_open_01", label: "Patio umbrella", placed: true, t: { p: [-1.119, 0, 1.541], r: 0, s: [1, 1, 1] } },
    { id: "wall_lantern_01", key: "wall_lantern_01", label: "Wall lantern", placed: true, t: { p: [2.75, 0, 5.8], r: 0, s: [1, 1, 1] } },
    { id: "imp:cedar-post-string-lights__1", key: "imp:cedar-post-string-lights", label: "Cedar-post string lights", placed: true, t: { p: [4.433, 0, 3.173], r: -2 * Q, s: [1.0588, 1.0588, 1.0588] } },
    { id: "lib:concrete-fire-pit__1", key: "lib:concrete-fire-pit", label: "Square fire pit", placed: true, t: { p: [-1.193, 0, 3.027], r: -Q, s: [1, 1, 1] } },
    { id: "lib:teak-lounge-chair__1", key: "lib:teak-lounge-chair", label: "Teak lounge chair", placed: true, t: { p: [0.299, 0, 2.98], r: -Q, s: [1, 1, 1] } },
    { id: "lib:teak-lounge-chair__2", key: "lib:teak-lounge-chair", label: "Teak lounge chair 2", placed: true, t: { p: [-1.15, 0, 4.258], r: -2 * Q, s: [1, 1, 1] } },
    { id: "lib:teak-bench__1", key: "lib:teak-bench", label: "Teak bench", placed: true, t: { p: [-2.443, 0, 2.889], r: Q, s: [1, 1, 1] } },
    { id: "lib:avocado-tree__1", key: "lib:avocado-tree", label: "Avocado tree", placed: true, t: { p: [8.358, 0, 1.154], r: Q, s: [1, 1, 1] } },
    { id: "lib:lemon-tree__1", key: "lib:lemon-tree", label: "Lemon tree", placed: true, t: { p: [5.478, 0, 0.967], r: -Q, s: [1, 1, 1] } },
    { id: "lib:lavender-bush__1", key: "lib:lavender-bush", label: "Lavender bush", placed: true, t: { p: [1.996, 0, 0.725], r: Q, s: [1, 1, 1] } },
    { id: "lib:lavender-bush__2", key: "lib:lavender-bush", label: "Lavender bush 2", placed: true, t: { p: [2.668, 0, 0.71], r: Q, s: [1, 1, 1] } },
    { id: "lib:lavender-bush__3", key: "lib:lavender-bush", label: "Lavender bush 3", placed: true, t: { p: [3.299, 0, 0.686], r: Q, s: [1, 1, 1] } },
    { id: "lib:lavender-bush__4", key: "lib:lavender-bush", label: "Lavender bush 4", placed: true, t: { p: [3.915, 0, 0.673], r: Q, s: [1, 1, 1] } },
  ],
  ground: {
    demo_lawn: "lawn-lush", demo_patio: "concrete-brushed", demo_walkway: "concrete-weathered",
    demo_planting_bed: "mulch",
  },
};

// The patio canopy and the hanging string lights are sized for Mari's
// house-to-wall gap (3.84 m), so they're left out here. Two pre-made items
// are shown under "Generated by AI" as examples (the Library was made by AI).
// `extra` adds demo-only items to the All tab: the fig tree is copied out of
// Mari's model (fig_tree_01, 7k triangles), in place of the demo yard's
// Japanese maple and hydrangea, which were removed for size (Mari, 2026-10-01).
export const LIBRARY = {
  hide: ["house-canopy", "house-string-lights"],
  asAI: ["lemon-tree", "teak-lounge-chair"],
  extra: [
    { id: "fig-tree", label: "Fig tree", category: "Plants", tags: ["tree", "fruit"], file: "demo/items/fig-tree.glb" },
  ],
};

// Made with AI in the family app (copied from its storage), shown in the
// Generated tab. `scale` is the one it was imported at.
export const AI_EXAMPLES = [
  {
    id: "cedar-post-string-lights",
    label: "Cedar-post string lights",
    url: "demo/examples/cedar-post-string-lights.glb",
    thumbnail: "demo/examples/cedar-post-string-lights.png",
    scale: 0.9964615065747703,
  },
];
