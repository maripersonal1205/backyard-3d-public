# Backyard Library: item spec

Instructions for building the pre-made item library for the Backyard 3D Viewer
(a Three.js web app). Follow them exactly so every item drops into the app with
no manual fixing. The app places items on the ground, scales them in feet, and
keeps them inside the yard walls. It depends on the size, origin and facing
rules below.

## What to deliver

A folder named `library/` with this layout:

```
library/
  library.json            ← the list of items (format below)
  models/<id>.glb         ← one model per item
  thumbs/<id>.png         ← one picture per item (recommended)
```

## library.json

```json
{
  "items": [
    {
      "id": "teak-lounge-chair",
      "label": "Teak lounge chair",
      "category": "Seating",
      "file": "models/teak-lounge-chair.glb",
      "thumbnail": "thumbs/teak-lounge-chair.png",
      "tags": ["chair", "teak", "outdoor", "wood"]
    }
  ]
}
```

| Field | Rules |
|---|---|
| `id` | Lowercase letters, digits and hyphens. Unique. **Never change an id after it has been delivered.** Saved plans refer to items by id. |
| `label` | Name shown in the app, in sentence case ("Teak lounge chair"). Can be changed any time. |
| `category` | Groups items in the Library tab. Use one of: Seating, Tables, Loungers, Shade, Lighting, Plants, Planters, Decor, Play, Utility. |
| `file` | Path to the `.glb`, relative to `library/`. |
| `thumbnail` | Path to the `.png`, relative to `library/`. Optional: the app renders its own picture if it's missing, but a delivered one loads faster. |
| `tags` | Extra search words: material, colour, synonyms. Optional. |
| `keepHeight` | `true` only for **mounted items that don't touch the ground** (e.g. a canopy spanning from the house to the wall). The app then keeps the model's height instead of setting it on the ground. For these items, model rule 4 becomes: centred on X/Z, and height measured from the ground (y = 0) at the real mounting height. Leave it out for everything else. |

## Model rules (every .glb)

1. **Format:** glTF 2.0 binary (`.glb`), one file per item, with textures embedded. No external files.
2. **Real-world size, in metres:** 1 unit = 1 m. A dining chair is about 0.85 m tall, not 85 and not 1.
3. **Y is up** in the exported file. Blender's glTF exporter does this with "+Y Up" on, which is the default.
4. **Origin at the centre of the base:** the item rests exactly on the ground (lowest point at height 0) and is centred on the origin horizontally. In Blender (Z-up) terms: bounding-box min Z = 0, and the X/Y centre of the bounding box = 0.
5. **Front faces +Z** in the exported file. In Blender, the front must face **−Y**, the side you see in Front view (numpad 1). The exporter turns Blender's −Y into glTF's +Z.
   - "Front" is the side a person uses or looks at: the seat opening of a chair or bench, the face of a sign, the opening of a fire-pit surround. For round or symmetrical items (planters, trees), any side is fine.
   - Why it matters: new items arrive in the yard facing the viewer, and Library pictures show the front.
6. **Apply all transforms** before export: rotation 0, scale 1. Export a single root object named after the `id`, with parts as children if needed.
7. **Nothing extra:** no cameras, lights, animations, ground planes, backdrops or shadow-catcher meshes.
8. **Materials:** standard PBR, Principled BSDF only (base colour, metallic, roughness, normal map).
   - Foliage and other cut-out textures: alpha **clip** (glTF `MASK`), not alpha blend.
   - Single-plane leaves: double-sided.
9. **Size budget (keep the app fast on phones):**

   | | Typical item | Large plants and trees |
   |---|---|---|
   | Triangles | ≤ 50,000 | ≤ 100,000 |
   | Texture size | ≤ 1024 px | ≤ 2048 px |
   | File size | ≤ 5 MB | ≤ 10 MB |

   - Use JPEG textures, or PNG only when alpha is needed.
   - No Draco or meshopt compression: the app doesn't decode it yet.
10. **Free-standing items only for now:** anything that stands on the ground (furniture, planters, trees, lights on stakes or posts, fire pits, play equipment). Don't make wall-mounted items (wall lights, trellises, shelves) yet. The app can't mount new items on walls.

## Recolourable parts (optional)

The app can show colour swatches for parts whose material has one of these exact names:

| Material name | Shown as | Use for |
|---|---|---|
| `canopy_fabric` | Fabric | canopy / awning / umbrella fabric |
| `canopy_frame` | Frame | the metal frame of a canopy or pergola |

- The colour must come from the material's **base colour value**, not a base-colour texture. Normal and roughness maps are fine.
- Every other material can be named freely.
- New names (for example cushions) have to be added to the app first. Ask before using one.

## Thumbnails (thumbs/<id>.png)

- 512 × 512 PNG, transparent background.
- Camera looks at the **front**, turned about 35° to the item's right and about 20° above, with a long lens (about 50–85 mm) so there's little distortion.
- The item fills about 80% of the frame, centred.
- Soft, neutral daylight lighting, no coloured light, no floor.
- Keep the same camera and lighting setup for every item so the Library looks consistent.

## Realistic sizes (sanity check)

| Item | Height | Other |
|---|---|---|
| Dining chair | 0.80–0.90 m | seat at 0.43–0.46 m |
| Lounge / armchair | 0.70–0.85 m | seat at 0.35–0.42 m |
| Dining table | 0.72–0.76 m | 4-seat top about 0.9 × 1.4 m |
| Coffee table | 0.35–0.45 m | |
| Bench | 0.43–0.46 m seat (0.80–0.90 m with a back) | 1.2–1.8 m long |
| Chaise lounger | 0.30–0.40 m (flat) | 1.9–2.0 m long |
| Patio umbrella | 2.3–2.6 m | canopy 2.5–3.0 m wide |
| Fire pit | 0.30–0.60 m | 0.9–1.2 m wide |
| Large planter | 0.50–0.90 m | |
| Small tree | 2.5–4.0 m | canopy 1.5–3.0 m wide |

## Check each item before delivering

For every item, verify in Blender (or with a script) and fix anything that fails:

- [ ] Bounding-box min Z = 0 (± 1 mm) and X/Y centre = 0 (± 1 mm), in Blender coordinates.
- [ ] Dimensions are realistic in metres (see the table above).
- [ ] Front faces −Y in Blender, i.e. +Z in the exported glTF.
- [ ] Transforms applied (rotation 0, scale 1).
- [ ] Triangle count and file size within budget.
- [ ] Textures embedded; the `.glb` opens on its own (for example on gltf-viewer.donmccurdy.com).
- [ ] Its `library.json` entry has a unique `id`, a `category` from the list, and correct paths.
- [ ] Thumbnail is 512 × 512 with a transparent background and shows the front.

Last, check that `library.json` is valid JSON and that every `file` and `thumbnail` path exists.
