# Fictional suburban demo yard

Generated from scratch by `demo/build_demo_yard.py`; no geometry or asset files from the real yard or Library items are read. The only import is the reusable toolkit in `library/build_library.py`.

Metres; +Y up; ground y=0. South/back fence is z=0, north/house is +Z, east/left is −X, west/right is +X. The house and garage end at z=10.60. The garage fills the area east of the house, so there is no east side yard. The 1.20 m strip west of the house is part of the walkway. House and matching garage lap siding are warm off-white (sRGB #e8e5da), with white trim. Roofs use a dark walnut brown, barrel-tile-inspired procedural texture (base #4e392b), with curved highlights, recessed channels and overlapping course lips; UVs run uphill on each slope. This is a surface texture, not individual tile geometry. Window and door glazing is muted dark green (#536f69), matching the reference yard’s glazing colour. Umbrella fabric is muted red (#9e282b), with subtle procedural weave variation.

## Rebuild and validate

```sh
python3 demo/build_demo_yard.py --build
python3 demo/build_demo_yard.py --check
python3 demo/build_demo_yard.py --render-only
```

Uses NumPy and Pillow; falls back to the installed Codex Python runtime if needed. Fixed random seeds. Imports Model/Mesh, procedural wood/concrete texture helpers, tube/leaf primitives, the GLB writer and the thumbnail renderer. No Library generator, manifest, model or thumbnail is changed.

## Measured exported geometry

| Face / wall | Measured coordinate (m) |
|---|---:|
| left_fence_inner_x | -4.250000 |
| right_fence_inner_x | 9.730000 |
| back_fence_inner_z | 0.000000 |
| house_exterior_back_z | 5.800000 |
| house_exterior_x_range | 0.000000, 8.530000 |
| garage_exterior_back_z | 5.800000 |
| garage_exterior_x_range | -4.250000, 0.000000 |

Fence measurements use planar interior cedar faces crossing y=1 m. Posts lie outside the yard. Small fasteners project 0.8 mm inward. Fence height is 1.80 m. Wall measurements use the lowest-z exposed lap edges; siding recesses by up to 28 mm. White casings, door thresholds and the lantern project into the yard. Garage wall span excludes its overhanging gable. House eave y=2.70 m, exposed overhang 0.40 m, hip ridge y=3.82 m. Garage eave y=2.45 m, gable ridge y=3.12 m. Attached roof edges meet at x=0.

## Ground footprints

Every ground node is one flat mesh, with one primitive and one material, upward normals and UV=(world X, world Z): one texture repeat per metre. The lawn has several joined rectangles in the same mesh. Shared boundaries have zero area; no surfaces overlap.

| Node | Rectangles (min X, max X, min Z, max Z), metres |
|---|---|
| demo_lawn | (-4.25, 2.4, 1.2, 5.2); (6.6, 9.73, 1.2, 5.2); (2.4, 6.6, 1.2, 2.8) |
| demo_patio | (2.4, 6.6, 2.8, 5.2) |
| demo_walkway | (-4.25, 9.73, 5.2, 5.8); (8.53, 9.73, 5.8, 10.6) |
| demo_planting_bed | (-4.25, 9.73, 0, 1.2) |

Patio: 4.20 × 2.40 m, centred on the house’s rear slider. Walkway: 0.60 m deep along the back of the house and garage (fence to fence), then down the 1.20 m strip west of the house. Planting bed: 1.20 m deep. House rear slider is x=3.05–5.95; its window is x=0.72–2.10. Garage people door is x=−2.75–−1.80; its window is x=−1.18–−0.30. No vehicle door faces the yard.

## Item placement and measured size

| Item | Ground pivot X, Y, Z (m) | Size X × Y × Z (m) |
|---|---|---|
| boxwood_shrub_01 | (7.65, 0, 0.66) | 1.185 × 0.821 × 1.182 |
| raised_garden_bed_01 | (4.5, 0, 0.65) | 2.100 × 0.651 × 0.900 |
| bird_bath_01 | (0.3, 0, 2.7) | 0.840 × 0.940 × 0.840 |
| terracotta_planter_01 | (7.55, 0, 4.93) | 0.574 × 0.727 × 0.572 |
| patio_umbrella_open_01 | (6.1, 0, 3.52) | 2.645 × 2.590 × 2.645 |
| wall_lantern_01 | (2.75, 0, 5.8) | 0.250 × 0.380 × 0.360 |

Movable items have local geometry and a ground-level translation pivot; all pieces are inside the item. The wall lantern preserves its mounting height, with a pivot on the wall at y=0. Plants inside the raised bed and planter belong to their furniture item. Glass is an opaque dark green reflective approximation for predictable preview and viewer rendering.

## Complete node hierarchy

```text
demo_yard
  ground
    demo_lawn
    demo_patio
    demo_walkway
    demo_planting_bed
  structures
    back_fence
      back_fence_cedar
      back_fence_fasteners
    left_fence
      left_fence_cedar
      left_fence_fasteners
    right_fence
      right_fence_cedar
      right_fence_fasteners
    house_exterior
      house_exterior_lap_siding
      house_exterior_white_trim
      house_exterior_roof_tiles
      house_exterior_green_glass
      house_exterior_door_hardware
    garage_exterior
      garage_exterior_lap_siding
      garage_exterior_white_trim
      garage_exterior_roof_tiles
      garage_exterior_green_glass
      garage_exterior_door_hardware
  vegetation
    boxwood_shrub_01
      boxwood_shrub_01_stems
      boxwood_shrub_01_leaves
  furniture
    raised_garden_bed_01
      raised_garden_bed_01_cedar_boards
      raised_garden_bed_01_soil
      raised_garden_bed_01_vegetable_leaves
    bird_bath_01
      bird_bath_01_cast_stone
      bird_bath_01_water
    terracotta_planter_01
      terracotta_planter_01_terracotta
      terracotta_planter_01_soil
      terracotta_planter_01_vegetable_leaves
    patio_umbrella_open_01
      patio_umbrella_open_01_red_fabric
      patio_umbrella_open_01_aluminium
      patio_umbrella_open_01_weighted_base
  details
    wall_lantern_01
      wall_lantern_01_black_metal
      wall_lantern_01_warm_frosted_glass
```

## Materials

All material names are snake_case. Each piece node uses the identically named material; each ground mesh uses `<node>_surface`. All textures are embedded, at most 512 px, and generated procedurally. No camera, light, animation, external URI, compression or required extension is exported.

## Validation result

PASS: 70,945 triangles; 4,347,572 bytes (4.35 MB); 52 named nodes; 7 textures; lowest world Y = 0.000000 m; ground surface area = 86.844 m².

Checks reopen the final GLB and verify headers/chunks, buffers/accessors, finite values, accessor bounds, index ranges, normals/winding, nondegenerate triangles, names and parentage, exact root groups, item ground contact, world height, budgets, texture dimensions, one-material ground meshes, metre-scaled UVs, projected ground intersections/coverage, and exported fence/wall measurements. Both previews are checked as 1024 × 1024 RGBA PNGs.

The previews reuse the toolkit renderer on a temporary world-space copy, with a temporary normalization guard for its camera basis at the 90° pole; no toolkit source is edited. Top camera: elevation 90°, azimuth 180° (north at the top; east/−X at image right, as viewed from south). Angle camera: elevation 55°, azimuth 202°, south of the back fence looking north. Camera and lighting exist only in the renderer, not in the delivered GLB.

## Viewer integration

This generator only writes the requested demo asset set. Viewer configuration should load `demo/demo-yard.glb`, register the six item names above in ITEMS (mark wall_lantern_01 attached: "wall"), register the four ground names in GROUND_AREAS, and use no real-yard ITEM_PARTS. Measured open-ground regions are [{minX:-4.25,maxX:9.73,minZ:0,maxZ:5.80},{minX:8.53,maxX:9.73,minZ:5.80,maxZ:10.60}]; a viewer may choose small insets for collisions. Keep demo saved layouts separate from real-yard layouts. Root/groups and per-item hierarchy follow the requested viewer structure. These measurements are authoritative for this asset even if a separate demo viewer configuration still contains provisional bounds.
