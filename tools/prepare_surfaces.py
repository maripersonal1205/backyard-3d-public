"""Prepare ground-surface texture sets for the viewer.

Takes 1K colour / normal (OpenGL) / roughness maps from SRC/<source-id>/
(color.*, normal.*, rough.*) and writes library/surfaces/<id>/ with:
  color.webp   base colour (WebP q85)
  normal.webp  normal map (WebP q92, or normal.jpg as full-colour JPEG when
               WebP's half-resolution colour would smear it; see shrink_glb.py)
  rough.webp   roughness (greyscale WebP q85)
  swatch.webp  160 px picture for the surface picker
plus library/surfaces/surfaces.json and CREDITS.md.

Usage: python3 tools/prepare_surfaces.py SRC_DIR
"""
import io, json, math, os, sys
from PIL import Image, ImageChops, ImageStat

# id, label, source id, source, real-world tile size in metres
SURFACES = [
    ("lawn-lush", "Lush lawn", "Grass004", "ambientCG", 1.5),
    ("concrete-brushed", "Brushed concrete", "brushed_concrete", "Poly Haven", 2.5),
    ("concrete-aggregate", "Exposed aggregate", "pebble_cemented_floor", "Poly Haven", 1.6),
    ("pavers-brick", "Red brick pavers", "patterned_brick_floor_02", "Poly Haven", 2.0),
    ("pavers-stone", "Grey stone pavers", "large_square_pattern_01", "Poly Haven", 3.0),
    ("gravel", "Gravel", "gravel_floor_02", "Poly Haven", 2.0),
    ("mulch", "Bark mulch", "wood_chips", "Poly Haven", 2.0),
    ("decking", "Wood decking", "wood_floor_deck", "Poly Haven", 1.8),
]
SOURCE_URL = {
    "Poly Haven": "https://polyhaven.com/a/{}",
    "ambientCG": "https://ambientcg.com/view?id={}",
}
OUT = os.path.join(os.path.dirname(__file__), "..", "library", "surfaces")


def psnr(a, b):
    mse = sum(ImageStat.Stat(ImageChops.difference(a, b).point(lambda x: x * x)).mean) / 3
    return float("inf") if mse == 0 else 10 * math.log10(255 ** 2 / mse)


def find(folder, stem):
    for f in os.listdir(folder):
        if f.startswith(stem + "."):
            return os.path.join(folder, f)
    raise FileNotFoundError(f"{folder}/{stem}.*")


def main(src):
    entries, credits = [], []
    for sid, label, source_id, source, tile in SURFACES:
        out = os.path.join(OUT, sid)
        os.makedirs(out, exist_ok=True)
        folder = os.path.join(src, source_id)
        color = Image.open(find(folder, "color")).convert("RGB")
        color.save(os.path.join(out, "color.webp"), "WEBP", quality=85, method=6)
        color.resize((160, 160), Image.LANCZOS).save(os.path.join(out, "swatch.webp"), "WEBP", quality=85)

        normal = Image.open(find(folder, "normal")).convert("RGB")
        buf = io.BytesIO()
        normal.save(buf, "WEBP", quality=92, method=6)
        if psnr(normal, Image.open(io.BytesIO(buf.getvalue())).convert("RGB")) >= 33:
            normal_file = "normal.webp"
            open(os.path.join(out, normal_file), "wb").write(buf.getvalue())
        else:
            normal_file = "normal.jpg"
            normal.save(os.path.join(out, normal_file), "JPEG", quality=95, subsampling=0)
        for stale in {"normal.webp", "normal.jpg"} - {normal_file}:
            if os.path.exists(os.path.join(out, stale)):
                os.remove(os.path.join(out, stale))

        Image.open(find(folder, "rough")).convert("L").save(os.path.join(out, "rough.webp"), "WEBP", quality=85, method=6)

        size = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
        print(f"{sid:20s} {size / 1e3:6.0f} KB  (normal: {normal_file})")
        entries.append({
            "id": sid, "label": label, "tile": tile,
            "color": f"{sid}/color.webp", "normal": f"{sid}/{normal_file}",
            "rough": f"{sid}/rough.webp", "swatch": f"{sid}/swatch.webp",
        })
        credits.append(f"| {label} | {source_id} | {source} | {SOURCE_URL[source].format(source_id)} |")

    with open(os.path.join(OUT, "surfaces.json"), "w") as f:
        json.dump({"surfaces": entries}, f, indent=2)
        f.write("\n")
    with open(os.path.join(OUT, "CREDITS.md"), "w") as f:
        f.write("# Ground surface textures\n\nAll CC0 (public domain): free to use, no attribution required. Listed for reference.\n\n")
        f.write("| Surface | Source asset | Library | Link |\n|---|---|---|---|\n")
        f.write("\n".join(credits) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
