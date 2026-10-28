# Backyard library builder

`build_library.py` is the permanent, self-contained generator for all nine items
made in this chat. It creates glTF 2.0 binary models, embeds their textures,
renders transparent 512 × 512 thumbnails, and updates `library.json` in place.
It does not require Blender, a browser, a preview server, or network access.

Run these commands from the `backyard` directory:

```sh
# Show available item ids; no files are changed.
python3 library/build_library.py --list

# Validate the existing library; no files are changed.
python3 library/build_library.py --check

# Rebuild one item, including its thumbnail and manifest entry.
python3 library/build_library.py --item teak-lounge-chair

# Rebuild a selected batch.
python3 library/build_library.py --item lemon-tree --item avocado-tree

# Rebuild all nine items. This overwrites their existing models and thumbnails.
python3 library/build_library.py --all

# Regenerate thumbnails from the current GLBs without rebuilding the models.
python3 library/build_library.py --all --render-only

# Build a separate review copy without changing the live assets.
python3 library/build_library.py --all --output-dir library/review-build
```

No arguments displays help and changes nothing. Add `--json` for machine-readable
results. Output directories must remain inside `library/`; relative paths are
resolved from the shell's current directory. The default output is the directory
containing the script, regardless of the working directory.

## Mounted hammock accessory

Run `python3 library/build_library.py --hammock-cloth --json` to rebuild
`models/hammock-cloth.glb` and `.builder-check/hammock-preview.png`. This separate
command reads the actual `hammock_frame` mesh in `../backyard.glb`, preserves its
local coordinates and mounting height, and never writes a Library entry or
thumbnail. It is intentionally excluded from `--all` and `--item`.

The report at `.builder-check/hammock-report.json` records frame measurements,
accessory bounds, sag, string lengths, triangle count, file size, and triangle
surface clearance from the frame. The preview combines the exported accessory
with the original frame mesh, both at the frame origin. Cotton uses one matte,
double-sided `hammock_cloth` material with neutral weave textures and #d8c39b as
its base colour; fittings use `hammock_hooks`. No origin normalization is applied.

## Dependencies

The script uses Python 3.9 or later, Pillow, and NumPy. If the system Python lacks
these libraries, it automatically uses the already-installed Codex Python runtime
when available. It never installs dependencies. On another computer, use a Python
environment with Pillow and NumPy installed.

## What is preserved

- The plant and furniture mesh generators were recovered from the original chat
  history, including the final geometry fixes, materials, textures, and random seeds.
- The canopy generator reconstructs the final **fabric-only** revision. It retains
  `keepHeight: true`, a 6.0 × 3.65 m footprint, upper-edge heights of 2.8/1.8 m,
  and 1 cm thickness measured normal to the slope. Its lowest surface is 1.7896 m.
- Existing manifest order, labels, tags, custom fields, and unrelated entries are
  preserved. Selected ids are updated in place without duplicates. Surface assets
  under `library/surfaces/` are outside this builder's scope.
- A batch is generated and validated in a temporary folder inside the output
  library before any existing assets are replaced. Successful runs remove the
  temporary folder. The builder itself and this guide are permanent.

The offline renderer uses the same camera settings (70 mm, 35° from the front,
20° above) and neutral lighting setup used for the delivered thumbnails. It
supports alpha-clipped, double-sided plant foliage and fabric normal maps.
Earlier plant/canopy thumbnails used Three.js, so their regenerated shading can
differ slightly. Models and thumbnails are generated from source; they are not
copies of cached output files.

## Validation and editing

`--check` verifies GLB structure, embedded textures, applied transforms, centred
origins and ground/mounting height, dimensions, triangle and file-size budgets,
material/alpha settings, normals and triangle winding, thumbnail size/transparency/
framing, unique ids, categories, and every manifest asset path. Camera direction
and the semantic front of each item are encoded in the generator and renderer;
inspect new designs visually after changing their geometry.

Edit the named generator functions (`canopy`, `lavender`, `lemongrass`, `tree`,
`bench`, `chair`, `coffee_table`, `fire_pit`) to change geometry. Update the matching
`ITEMS` dimensions or budget when intentionally changing an item's specification.
Do not change an existing id: saved yard plans refer to it.

The report uses **X / Y / Z** dimensions (width / height / depth), not the
width / depth / height order sometimes used in conversation.
