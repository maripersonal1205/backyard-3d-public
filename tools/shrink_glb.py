"""Shrink backyard.glb by re-encoding its opaque PNG textures as WebP.

Only images change: node names, meshes, materials and accessors are left
exactly as they are (the viewer finds items by node name). WebP images are
referenced through the EXT_texture_webp extension, which Three.js supports.
Textures used with alpha (MASK/BLEND base colour) stay PNG.

Usage: python3 shrink_glb.py IN.glb OUT.glb
"""
import io, json, math, struct, sys
from PIL import Image, ImageChops, ImageStat

COLOR_Q, NORMAL_Q = 88, 92  # WebP quality: base colour / normal + other data maps
MIN_PSNR = 33.0             # below this (dB), fall back to full-colour JPEG


def psnr(a, b):
    mse = sum(ImageStat.Stat(ImageChops.difference(a, b).point(lambda x: x * x)).mean) / 3
    return float("inf") if mse == 0 else 10 * math.log10(255 ** 2 / mse)

src, dst = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
jlen = struct.unpack("<I", data[12:16])[0]
gltf = json.loads(data[20:20 + jlen])
bin_start = 20 + jlen + 8
blen = struct.unpack("<I", data[20 + jlen:24 + jlen])[0]
binary = data[bin_start:bin_start + blen]

# Which images need alpha, and which are base colour (vs normal/other data).
needs_alpha, is_color = set(), set()
for m in gltf.get("materials", []):
    pbr = m.get("pbrMetallicRoughness", {})
    bc = pbr.get("baseColorTexture")
    if bc:
        img = gltf["textures"][bc["index"]]["source"]
        is_color.add(img)
        if m.get("alphaMode") in ("MASK", "BLEND"):
            needs_alpha.add(img)
    em = m.get("emissiveTexture")
    if em:
        is_color.add(gltf["textures"][em["index"]]["source"])

views = gltf["bufferViews"]
replace = {}  # bufferView index -> new bytes
report = []
for i, im in enumerate(gltf["images"]):
    if i in needs_alpha or "bufferView" not in im:
        report.append((i, "kept PNG (alpha)" if i in needs_alpha else "skipped", 0, 0))
        continue
    v = views[im["bufferView"]]
    raw = binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
    pic = Image.open(io.BytesIO(raw)).convert("RGB")
    out = io.BytesIO()
    q = COLOR_Q if i in is_color else NORMAL_Q
    pic.save(out, "WEBP", quality=q, method=6)
    how, mime = f"webp q{q}", "image/webp"
    # WebP stores colour at half resolution, which can smear data maps (normal
    # maps keep directions in R/G). If it loses too much, use full-colour JPEG.
    if psnr(pic, Image.open(io.BytesIO(out.getvalue())).convert("RGB")) < MIN_PSNR:
        out = io.BytesIO()
        pic.save(out, "JPEG", quality=95, subsampling=0)
        how, mime = "jpeg 4:4:4 q95", "image/jpeg"
    replace[im["bufferView"]] = out.getvalue()
    im["mimeType"] = mime
    report.append((i, how, len(raw), len(out.getvalue())))

# Point textures whose image is now WebP at it via EXT_texture_webp.
webp_images = {i for i, im in enumerate(gltf["images"]) if im.get("mimeType") == "image/webp"}
for t in gltf["textures"]:
    if t.get("source") in webp_images:
        t.setdefault("extensions", {})["EXT_texture_webp"] = {"source": t.pop("source")}
for key in ("extensionsUsed", "extensionsRequired"):
    lst = gltf.setdefault(key, [])
    if "EXT_texture_webp" not in lst:
        lst.append("EXT_texture_webp")

# Rebuild the binary chunk view by view (4-byte aligned), keeping order.
chunks, offset = [], 0
for vi, v in enumerate(views):
    b = replace.get(vi)
    if b is None:
        o = v.get("byteOffset", 0)
        b = binary[o:o + v["byteLength"]]
    pad = (4 - offset % 4) % 4
    if pad:
        chunks.append(b"\0" * pad)
        offset += pad
    v["byteOffset"] = offset
    v["byteLength"] = len(b)
    chunks.append(b)
    offset += len(b)
new_bin = b"".join(chunks)
new_bin += b"\0" * ((4 - len(new_bin) % 4) % 4)
gltf["buffers"][0]["byteLength"] = len(new_bin)

js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(new_bin)
with open(dst, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, total))
    f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
    f.write(struct.pack("<II", len(new_bin), 0x004E4942) + new_bin)

for i, how, a, b in report:
    print(f"image {i:2d}: {how:16s} {a / 1e6:6.2f} MB -> {b / 1e6:5.2f} MB" if a else f"image {i:2d}: {how}")
print(f"file: {len(data) / 1e6:.1f} MB -> {total / 1e6:.1f} MB")
