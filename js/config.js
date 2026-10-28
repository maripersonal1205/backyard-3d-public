import { YARD } from "./app-mode.js";

// The yard's own details (model file, managed items, walls, ground areas,
// where Walk starts, Library changes) come from its file in js/yards/:
// demo.js is the made-up sample yard (Mari's own yard isn't in this public copy).
const yard = await import(`./yards/${YARD}.js`);
export const { MODEL, ITEMS, ITEM_PARTS, YARD_REGIONS, GROUND_AREAS, walkSpawn, LIBRARY, AI_EXAMPLES } = yard;
export const PLAN_FRAME = yard.PLAN_FRAME || null; // optional: the area Plan view starts on
export const START_LAYOUT = yard.START_LAYOUT || null; // optional: the layout the yard starts with (else the model as it is)
export const SURFACES_EXTRA = yard.SURFACES_EXTRA || []; // optional: ground surfaces only this yard offers

export const FEET_PER_METRE = 3.28084;

// Recolourable materials, by material name in the model file. Any item whose
// model has one of these gets a row of swatches in the inspector (the first
// swatch is always the model's own colour). LIBRARY_SPEC.md lists the names.
// `glow` makes a material light itself by that fraction of its own colour, so
// thin fabric reads as lit-through from below instead of a black underside.
export const COLOR_PRESETS = {
  canopy_fabric: {
    label: "Fabric",
    glow: 0.35,
    swatches: [
      { name: "Off-white", hex: "#ece6da" },
      { name: "Sand", hex: "#d4c09c" },
      { name: "Sage", hex: "#9aac90" },
      { name: "Terracotta", hex: "#bd6d4c" },
      { name: "Navy", hex: "#34435c" },
      { name: "Charcoal", hex: "#4a4a47" },
    ],
  },
  canopy_frame: {
    label: "Frame",
    swatches: [
      { name: "Black", hex: "#1f1f1e" },
      { name: "Bronze", hex: "#5a4535" },
      { name: "Silver", hex: "#a9adaf" },
      { name: "White", hex: "#eeeeea" },
    ],
  },
  // Codex's woven hammock cloth (the "Original" swatch is its natural tan).
  hammock_cloth: {
    label: "Cloth",
    swatches: [
      { name: "Black", hex: "#2f2f2f" },
      { name: "Red", hex: "#cf353c" },
      { name: "Periwinkle", hex: "#7f8ab2" },
      { name: "Mist", hex: "#aab0c0" },
    ],
  },
};
