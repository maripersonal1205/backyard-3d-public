#!/usr/bin/env python3
"""Deterministic fictional yard. Reuses the Library toolkit, never its items.

python3 demo/build_demo_yard.py --build
python3 demo/build_demo_yard.py --check
python3 demo/build_demo_yard.py --render-only
"""
import argparse
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import random
import re
import struct
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parent
if any(importlib.util.find_spec(n) is None for n in ('numpy', 'PIL')):
    runtime = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
    if runtime.is_file() and runtime.resolve() != Path(sys.executable).resolve():
        os.execv(str(runtime), [str(runtime), '-B', str(Path(__file__).resolve()), *sys.argv[1:]])
    raise SystemExit('Use Python with NumPy and Pillow installed.')
sys.path.insert(0, str(REPO / 'library'))
import build_library as kit
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

X0, X1, WALL, END = -4.25, 9.73, 5.80, 10.60
GROUPS = ('ground', 'structures', 'vegetation', 'furniture', 'details')
# The walkway runs along the back of the house and garage (0.6 m deep, from
# the patio to the wall) and down the strip right of the house, which used to
# be its own gravel area (Mari, 2026-10-02).
GROUND = {
    'demo_lawn': [(-4.25, 2.4, 1.2, 5.2), (6.6, 9.73, 1.2, 5.2)],
    'demo_patio': [(2.4, 6.6, 2.8, 5.2)],  # centred on the rear slider (Mari, 2026-10-02)
    'demo_walkway': [(-4.25, 9.73, 5.2, 5.8), (8.53, 9.73, 5.8, 10.6)],
    'demo_planting_bed': [(-4.25, 9.73, 0, 1.2)],
}
# The lawn between the planting bed and the patio is contiguous with the west lawn.
GROUND['demo_lawn'].append((2.4, 6.6, 1.2, 2.8))
# The Japanese maple and hydrangea were removed (Mari, 2026-10-01): together
# they were about 170k of the 244k triangles. maple() and shrub(hydrangea=True)
# are kept in case they come back.
ITEMS = {
    'boxwood_shrub_01': ('vegetation', (7.65, 0, .66)),
    'raised_garden_bed_01': ('furniture', (4.50, 0, .65)),
    'bird_bath_01': ('furniture', (.30, 0, 2.7)),
    'terracotta_planter_01': ('furniture', (7.55, 0, 4.93)),
    'patio_umbrella_open_01': ('furniture', (6.10, 0, 3.52)),
    'wall_lantern_01': ('details', (2.75, 0, 5.8)),
}


def face(mesh, points, normal=None, uv=None, color=(1, 1, 1)):
    if normal and kit.dot(kit.cross(kit.sub(points[1], points[0]), kit.sub(points[2], points[0])), normal) < 0:
        points = list(reversed(points))
        uv = list(reversed(uv)) if uv else None
    mesh.face(points, uv or [(p[0], p[2]) for p in points], color)


def box(mesh, x0, x1, y0, y1, z0, z1, color=(1, 1, 1)):
    for axis, a, b in ((0, x0, x1), (1, y0, y1), (2, z0, z1)):
        others = [i for i in range(3) if i != axis]
        bounds = [(x0, x1), (y0, y1), (z0, z1)]
        for val, sign in ((a, -1), (b, 1)):
            points = []
            for j, k in ((0, 0), (1, 0), (1, 1), (0, 1)):
                p = [0., 0., 0.]
                p[axis] = val
                p[others[0]] = bounds[others[0]][j]
                p[others[1]] = bounds[others[1]][k]
                points.append(tuple(p))
            n = [0, 0, 0]
            n[axis] = sign
            face(mesh, points, n, [(p[others[0]], p[others[1]]) for p in points], color)


def lathe(mesh, profile, center=(0, 0, 0), sides=64):
    """Profile runs around a closed solid in radius/height space."""
    for (r0, y0), (r1, y1) in zip(profile, profile[1:]):
        for k in range(sides):
            a, b = k * math.tau / sides, (k + 1) * math.tau / sides
            ps = [(r0*math.cos(a), y0, r0*math.sin(a)),
                  (r1*math.cos(a), y1, r1*math.sin(a)),
                  (r1*math.cos(b), y1, r1*math.sin(b)),
                  (r0*math.cos(b), y0, r0*math.sin(b))]
            if r0 == 0: ps = ps[:3]
            if r1 == 0: ps = [ps[0], ps[1], ps[3]]
            mesh.face([kit.add(p, center) for p in ps], color=(.97, .97, .97))


def texture(kind):
    """New demo-only procedural materials; no asset files are read."""
    rng = np.random.default_rng(571)
    yy, xx = np.mgrid[:512, :512]
    if kind == 'lawn':
        base = np.array([98, 132, 61]); noise = rng.normal(0, 6, (512, 512))
        noise += 3*np.sin(xx/40)*np.sin(yy/54)
    elif kind == 'soil':
        base = np.array([91, 68, 49]); noise = rng.normal(0, 10, (512, 512))
    elif kind == 'gravel':
        base = np.array([181, 175, 157]); noise = rng.normal(0, 14, (512, 512))
    elif kind == 'roof_tiles':
        # Four barrel-tile columns and two overlapping courses per metre.
        # Broad curved highlights, recessed channels and scalloped course lips
        # distinguish these from small rectangular asphalt shingles.
        base = np.array([78, 57, 43]); noise = rng.normal(0, 1.7, (512, 512))
        u = (xx % 128)/128
        roll = np.cos(math.tau*(u-.5))
        course = (yy + 10*roll) % 256
        noise += 16*roll + 4*np.sin(math.tau*u)
        noise -= 20*(xx % 128 < 5)
        noise -= 23*(course < 7)
        noise += 9*((course >= 7) & (course < 13))
        noise += rng.uniform(-5, 5, (2, 4))[yy//256, xx//128]
    elif kind == 'fabric':
        base = np.array([158, 40, 43]); noise = rng.normal(0, 1, (512, 512))
        noise += 2*(xx % 4 == 0) + 2*(yy % 4 == 0)
    elif kind == 'cedar':
        # Reuse the toolkit's procedural grain, recoloured to warm cedar.
        data, _ = kit.wood_texture()
        arr = np.asarray(Image.open(io.BytesIO(data))).astype(float)
        arr += np.array([54, 21, -1])
        return kit.image_bytes(Image.fromarray(np.uint8(np.clip(arr, 0, 255))))
    else:
        raise ValueError(kind)
    return kit.image_bytes(Image.fromarray(np.uint8(np.clip(base + noise[..., None], 0, 255))))


def leaf_texture():
    im = Image.new('RGBA', (256, 512))
    d = ImageDraw.Draw(im)
    outline = [(128 + s*107*math.sin(math.pi*t)**.85, 511*(1-t))
               for s, ts in ((1, np.linspace(0, 1, 65)), (-1, np.linspace(1, 0, 65))) for t in ts]
    d.polygon(outline, fill=(224, 239, 205, 255))
    d.line((128, 500, 128, 9), fill=(174, 206, 146, 255), width=3)
    for y in range(85, 490, 45):
        for s in (-1, 1):
            d.line((128, y, 128+s*80*math.sin(math.pi*y/512), y-45), fill=(193, 218, 166, 255), width=2)
    return kit.image_bytes(im, True)


class Yard:
    def __init__(self):
        self.model = kit.Model('demo_yard')
        self.owners = {}
        self.groups = {}
        self.tex = {}

    def part(self, owner, group, suffix, color=(255, 255, 255), rough=.8, tex=None, double=False, alpha=False):
        if isinstance(tex, str):
            if tex not in self.tex: self.tex[tex] = texture(tex)
            tex = self.tex[tex]
        idx = self.model.material(owner+'_'+suffix, color, rough, tex, alpha, double)
        self.owners[idx] = owner
        self.groups[owner] = group
        return self.model.meshes[idx]

    def build_ground(self):
        for name, rectangles in GROUND.items():
            kind = {'demo_lawn': 'lawn', 'demo_planting_bed': 'soil'}.get(name)
            tex = kind if kind else kit.concrete_texture()
            mesh = self.part(name, 'ground', 'surface', tex=tex)
            for x0, x1, z0, z1 in rectangles:
                face(mesh, [(x0, 0, z0), (x0, 0, z1), (x1, 0, z1), (x1, 0, z0)], (0, 1, 0))

    def build_fence(self, name, axis, inner, start, end, sign):
        mesh = self.part(name, 'structures', 'cedar', tex='cedar')
        hardware = self.part(name, 'structures', 'fasteners', (68, 65, 60), .55)
        count = math.ceil((end-start)/1.85)
        stations = np.linspace(start, end, count+1)
        def block(u0, u1, y0, y1, v0, v1, target=mesh, tint=(1, 1, 1)):
            v0, v1 = sorted((inner+sign*v0, inner+sign*v1))
            if axis == 'x': box(target, v0, v1, y0, y1, u0, u1, tint)
            else: box(target, u0, u1, y0, y1, v0, v1, tint)
        for u in stations:
            block(u-.055, u+.055, 0, 1.8, .035, .145)
        for j in range(12):
            y = .022+j*.145
            for k in range(count):
                tint = .88+.10*((j*3+k*7)%11)/10
                block(stations[k]+.003, stations[k+1]-.003, y, y+.132, 0, .028, tint=(tint, tint, tint))
                for u in (stations[k]+.055, stations[k+1]-.055):
                    block(u-.003, u+.003, y+.065, y+.071, -.0008, .001, hardware)
        block(start-.055, end+.055, 1.765, 1.8, 0, .155)
        mesh.uv = [(p[2] if axis == 'x' else p[0], p[1]*5) for p in mesh.p]

    def build_building(self, name, x0, x1, garage=False):
        siding = self.part(name, 'structures', 'lap_siding', (232, 229, 218))
        trim = self.part(name, 'structures', 'white_trim', (241, 241, 230), .6)
        roof = self.part(name, 'structures', 'roof_tiles', tex='roof_tiles')
        glass = self.part(name, 'structures', 'green_glass', (83, 111, 105), .16)
        dark = self.part(name, 'structures', 'door_hardware', (42, 51, 56), .4)
        height = 2.45 if garage else 2.7
        # Solid backing; lap siding's exposed lower edge is exactly z=5.80.
        box(siding, x0, x1, 0, height, WALL+.028, END)
        openings = [(-2.75, -1.8, .025, 2.1), (-1.18, -.30, 1.05, 1.95)] if garage else [(3.05, 5.95, .025, 2.27), (.72, 2.10, 1.1, 2.10)]
        for j in range(math.ceil(height/.15)):
            y0, y1 = j*.15, min((j+1)*.15, height)
            intervals = [(x0, x1)]
            for a, b, c, d in openings:
                if y1 > c and y0 < d:
                    intervals = [(l, r) for lo, hi in intervals for l, r in ((lo, min(hi, a)), (max(lo, b), hi)) if r > l]
            for lo, hi in intervals:
                face(siding, [(lo, y0, WALL), (hi, y0, WALL), (hi, y1, WALL+.024), (lo, y1, WALL+.024)], (0, 0, -1))
                face(siding, [(lo, y0, WALL), (lo, y0, WALL+.03), (hi, y0, WALL+.03), (hi, y0, WALL)], (0, -1, 0))
            # Matching horizontal lap on exposed end walls.
            for x, sign in ((x0, -1), (x1, 1)):
                face(siding, [(x, y0, WALL+.03), (x, y0, END), (x-sign*.023, y1, END), (x-sign*.023, y1, WALL+.03)], (sign, 0, 0))
        for x in (x0, x1-.09): box(trim, x, x+.09, .02, height, WALL-.025, WALL+.035)
        for i, (a, b, c, d) in enumerate(openings):
            box(glass, a+.045, b-.045, c+.04, d-.04, WALL-.016, WALL+.008)
            for x in (a-.05, b-.01): box(trim, x, x+.06, c, d+.05, WALL-.065, WALL+.01)
            for y in (c, d): box(trim, a-.05, b+.05, y, y+.05, WALL-.07, WALL+.01)
            if i == 0 and not garage:
                mid = (a+b)/2
                box(trim, mid-.023, mid+.023, c, d, WALL-.071, WALL-.012)
                box(dark, mid+.08, mid+.102, .95, 1.16, WALL-.102, WALL-.069)
                box(trim, a, b, .01, .035, WALL-.14, WALL)
            elif i == 0:
                box(trim, a+.025, b-.025, c+.02, 1.1, WALL-.055, WALL-.02)
                # Recessed panel and half-glass people door, no vehicle opening.
                box(siding, a+.14, b-.14, .20, .88, WALL-.06, WALL-.055)
                box(dark, b-.14, b-.075, 1.03, 1.06, WALL-.092, WALL-.055)
                box(trim, a-.03, b+.03, 0, .025, WALL-.16, WALL)
            else:
                box(trim, (a+b)/2-.018, (a+b)/2+.018, c, d, WALL-.07, WALL)
                box(trim, a-.07, b+.07, c-.045, c, WALL-.12, WALL+.02)
        z0, z1 = WALL-.4, END+.4
        def roof_face(poly):
            # Align tile columns uphill on each individual roof slope.
            bottom = min(p[1] for p in poly)
            eave = [p for p in poly if abs(p[1]-bottom) < 1e-6]
            along = kit.unit(kit.sub(eave[1], eave[0]))
            n = kit.unit(kit.cross(kit.sub(poly[1], poly[0]), kit.sub(poly[2], poly[0])))
            uphill = kit.unit(kit.cross(n, along))
            if uphill[1] < 0: uphill = kit.mul(uphill, -1)
            uv = [(kit.dot(kit.sub(p, eave[0]), along), kit.dot(kit.sub(p, eave[0]), uphill)) for p in poly]
            face(roof, poly, (0, 1, 0), uv)
        a, b = x0-.4, x1+.4
        # Attached edges terminate at x=0 under the taller house roof.
        if garage: b = 0
        else: a = 0
        box(trim, a, b, height-.10, height, z0, z1)
        if garage:
            mid = (x0+x1)/2; peak = 3.12
            roof_face([(a, height, z0), (mid, peak, z0), (mid, peak, z1), (a, height, z1)])
            roof_face([(mid, peak, z0), (b, height, z0), (b, height, z1), (mid, peak, z1)])
            face(siding, [(a, height, z0+.02), (b, height, z0+.02), (mid, peak, z0+.02)], (0, 0, -1))
            for p, q in (((a, height, z0), (mid, peak, z0)), ((mid, peak, z0), (b, height, z0))):
                kit.tube(trim, [p, q], [.035, .035], 4)
        else:
            peak = 3.82; setback = 2.0; zm = (z0+z1)/2
            p, q = (a+setback, peak, zm), (b-setback, peak, zm)
            for poly in [[(a, height, z0), (b, height, z0), q, p], [(b, height, z0), (b, height, z1), q], [(b, height, z1), (a, height, z1), p, q], [(a, height, z1), (a, height, z0), p]]:
                roof_face(poly)

    def maple(self):
        name = 'japanese_maple_01'; group, origin = ITEMS[name]
        bark = self.part(name, group, 'bark', (110, 98, 81), tex=kit.wood_texture())
        leaves = self.part(name, group, 'burgundy_leaves', (136, 43, 53), .65, double=True)
        r = random.Random(171)
        kit.tube(bark, [(0, 0, 0), (.03, .6, .01), (-.04, 1.15, 0), (.06, 1.8, .02), (0, 2.66, 0)], [.075, .060, .040, .022, .003], 12)
        anchors = []
        for i in range(24):
            a = i*2.39996; h = r.uniform(1.5, 2.6); rad = r.uniform(.65, 1.2)
            tip = (rad*math.cos(a), h, rad*math.sin(a))
            kit.tube(bark, [(0, .85+i%5*.15, 0), kit.mul(tip, .68), tip], [.026, .012, .002], 8)
            anchors.append(tip)
        for i in range(3600):
            a = r.uniform(0, math.tau); v = r.uniform(-1, 1); rr = r.random()**.33
            base = (1.28*rr*math.sqrt(1-v*v)*math.cos(a), 2.22+.65*rr*v, 1.15*rr*math.sqrt(1-v*v)*math.sin(a))
            if i % 30 == 0:
                anchor = min(anchors, key=lambda p: sum((p[k]-base[k])**2 for k in range(3)))
                kit.tube(bark, [anchor, base], [.004, .001], 5)
            # Seven actual pointed lobes; each leaf is a folded 28-triangle fan.
            axis = kit.unit((math.cos(a), r.uniform(-.9, .7), math.sin(a)))
            u, v = kit.basis(axis); length = r.uniform(.065, .105)
            poly = []
            for k in range(28):
                angle = math.tau*k/28
                rad = length*(1 if k%4 == 0 else .40 if k%2 == 0 else .57)
                poly.append(kit.add(base, kit.add(kit.mul(u, rad*math.cos(angle)), kit.mul(v, rad*math.sin(angle)))))
            center = kit.add(base, kit.mul(axis, .008))
            tint = r.uniform(.63, 1)
            for k in range(28):
                leaves.face([center, poly[k], poly[(k+1)%28]], color=(tint, tint, tint), normals=[axis]*3)
        self.translate_owner(name, origin)

    def shrub(self, name, hydrangea=False):
        group, origin = ITEMS[name]; r = random.Random(189 if hydrangea else 190)
        stems = self.part(name, group, 'stems', (102, 111, 57))
        foliage = self.part(name, group, 'leaves', (58, 99, 42) if hydrangea else (49, 88, 38), .76, leaf_texture(), True, True)
        radius = .64 if hydrangea else .55; cy = .47 if hydrangea else .43
        for i in range(30):
            a = i*2.39996
            kit.tube(stems, [(0, 0, 0), (.18*math.cos(a), .3, .18*math.sin(a)), (.45*math.cos(a), .7, .45*math.sin(a))], [.01, .007, .002], 5)
        count = 2100 if hydrangea else 3200
        for i in range(count):
            a = r.uniform(0, math.tau); v = r.uniform(-.92, 1); rr = r.uniform(.4, 1)**.33
            base = (radius*rr*math.sqrt(1-v*v)*math.cos(a), cy+cy*.85*v*rr, radius*rr*math.sqrt(1-v*v)*math.sin(a))
            direction = (math.cos(a), r.uniform(-.3, .9), math.sin(a))
            length = r.uniform(.07, .15) if hydrangea else r.uniform(.032, .067)
            tint = r.uniform(.68, 1)
            kit.leaf(foliage, base, direction, length, length*.62, r.uniform(0, math.tau), r, (tint, tint, tint))
        if hydrangea:
            petals = self.part(name, group, 'blossoms', (179, 167, 216), .83, double=True)
            for head in range(18):
                a = head*2.39996; rad = .46*math.sqrt(head/18)
                center = (rad*math.cos(a), .88+.22*(1-head/18), rad*math.sin(a))
                for i in range(240):
                    v = 1-2*(i+.5)/240; a = i*2.39996; h = math.sqrt(1-v*v)
                    normal = (h*math.cos(a), v, h*math.sin(a))
                    p = kit.add(center, kit.mul(normal, .135)); u, w = kit.basis(normal)
                    for j in range(4):
                        angle = j*math.pi/2
                        axis = kit.add(kit.mul(u, math.cos(angle)), kit.mul(w, math.sin(angle)))
                        side = kit.cross(normal, axis)
                        q = kit.add(p, kit.mul(axis, .018))
                        petals.face([p, kit.add(q, kit.mul(side, .010)), kit.add(p, kit.mul(axis, .029)), kit.sub(q, kit.mul(side, .010))], color=(.9, .9, .9))
        self.translate_owner(name, origin)

    def vegetables(self, name, group, centers, scale=1):
        foliage = self.part(name, group, 'vegetable_leaves', (89, 132, 56), .83, leaf_texture(), True, True)
        r = random.Random(887)
        for center in centers:
            for i in range(28):
                a = i*2.39996; length = r.uniform(.13, .27)*scale
                kit.leaf(foliage, center, (math.cos(a), r.uniform(.5, 1.8), math.sin(a)), length, length*.7, a, r, (.85, .95, .8))

    def furniture(self):
        name = 'raised_garden_bed_01'; group, origin = ITEMS[name]
        timber = self.part(name, group, 'cedar_boards', tex='cedar')
        soil = self.part(name, group, 'soil', tex='soil')
        for j in range(3):
            y = j*.15
            for z in (-.45, .385): box(timber, -1.05, 1.05, y, y+.145, z, z+.065)
            for x in (-1.05, .985): box(timber, x, x+.065, y, y+.145, -.45, .45)
        for x in (-.94, .94):
            for z in (-.34, .34): box(timber, x-.045, x+.045, 0, .48, z-.045, z+.045)
        box(soil, -.984, .984, .01, .365, -.384, .384)
        self.vegetables(name, group, [(x, .37, z) for x in (-.68, 0, .68) for z in (-.18, .18)])
        self.translate_owner(name, origin)

        name = 'bird_bath_01'; group, origin = ITEMS[name]
        stone = self.part(name, group, 'cast_stone', tex=kit.concrete_texture())
        water = self.part(name, group, 'water', (106, 147, 158), .10)
        lathe(stone, [(0, 0), (.26, 0), (.28, .05), (.22, .12), (.12, .17), (.095, .66), (.15, .75), (.35, .78), (.41, .85), (.42, .92), (.36, .94), (.33, .86), (0, .82)])
        lathe(water, [(.335, .871), (0, .871)])
        self.translate_owner(name, origin)

        name = 'terracotta_planter_01'; group, origin = ITEMS[name]
        ceramic = self.part(name, group, 'terracotta', (182, 101, 68), .88)
        soil = self.part(name, group, 'soil', tex='soil')
        lathe(ceramic, [(0, 0), (.17, 0), (.19, .025), (.25, .38), (.275, .39), (.275, .45), (.24, .45), (.225, .38), (.15, .055), (0, .055)])
        lathe(soil, [(.228, .38), (0, .38)])
        self.vegetables(name, group, [(0, .38, 0)], 1.25)
        self.translate_owner(name, origin)

        name = 'patio_umbrella_open_01'; group, origin = ITEMS[name]
        fabric = self.part(name, group, 'red_fabric', tex='fabric', double=True)
        frame = self.part(name, group, 'aluminium', (63, 68, 69), .42)
        base = self.part(name, group, 'weighted_base', (89, 91, 87), .85)
        lathe(base, [(0, 0), (.30, 0), (.31, .04), (.29, .10), (.09, .12), (.07, .32), (0, .32)])
        kit.tube(frame, [(0, .05, 0), (0, 2.55, 0)], [.026, .026], 20)
        def canopy(rad, a):
            return (rad*math.cos(a), 2.48-.39*(rad/1.32)**1.45, rad*math.sin(a))
        for s in range(8):
            a0 = s*math.tau/8
            for j in range(14):
                r0, r1 = j*1.32/14, (j+1)*1.32/14
                for k in range(8):
                    a, b = a0+k*math.tau/64, a0+(k+1)*math.tau/64
                    ps = [canopy(r0, a), canopy(r1, a), canopy(r1, b), canopy(r0, b)]
                    if j == 0: ps = ps[:3]
                    face(fabric, ps, (0, 1, 0))
            points = [canopy(j*1.32/12, a0) for j in range(13)]
            kit.tube(frame, [kit.add(p, (0, -.015, 0)) for p in points], [.008]*13, 6)
            kit.tube(frame, [(0, 1.83, 0), canopy(.76, a0)], [.009, .009], 6)
        lathe(frame, [(0, 2.48), (.042, 2.48), (.042, 2.55), (0, 2.59)], sides=24)
        self.translate_owner(name, origin)

        name = 'wall_lantern_01'; group, origin = ITEMS[name]
        metal = self.part(name, group, 'black_metal', (44, 48, 49), .5)
        glass = self.part(name, group, 'warm_frosted_glass', (243, 213, 157), .4)
        box(metal, -.06, .06, 1.65, 1.95, -.035, 0)
        box(metal, -.025, .025, 1.85, 1.91, -.25, 0)
        box(glass, -.085, .085, 1.61, 1.88, -.32, -.15)
        for x in (-.10, .085):
            for z in (-.335, -.15): box(metal, x, x+.015, 1.58, 1.91, z, z+.015)
        box(metal, -.115, .115, 1.57, 1.61, -.35, -.12)
        box(metal, -.125, .125, 1.90, 1.94, -.36, -.11)
        self.translate_owner(name, origin)

    def translate_owner(self, owner, delta):
        for idx, mesh in self.model.meshes.items():
            if self.owners[idx] == owner:
                # Clip the foot of tilted trunk/stem tubes to the ground plane.
                mesh.p = [kit.add((p[0], max(0, p[1]), p[2]), delta) for p in mesh.p]

    def deduplicate(self):
        # Preserve every attribute at seams; compact identical vertices before
        # using the toolkit writer. No quantization or compression extensions.
        for mesh in self.model.meshes.values():
            rows = np.asarray([p+n+uv+c for p, n, uv, c in zip(mesh.p, mesh.n, mesh.uv, mesh.c)], dtype=np.float32)
            unique, inverse = np.unique(rows, axis=0, return_inverse=True)
            mesh.p = unique[:, :3].tolist(); mesh.n = unique[:, 3:6].tolist()
            mesh.uv = unique[:, 6:8].tolist(); mesh.c = unique[:, 8:11].tolist()
            mesh.i = inverse[np.asarray(mesh.i)].tolist()

    def save(self, path):
        self.deduplicate()
        # The actual attribute/buffer/image encoding is Model.save(), unchanged.
        with tempfile.TemporaryDirectory(prefix='demo_writer_') as tmp:
            root = Path(tmp); (root/'models').mkdir()
            old_root = kit.ROOT
            try:
                kit.ROOT = root
                self.model.save()
            finally:
                kit.ROOT = old_root
            g, binary = read_glb(root/'models/demo_yard.glb')
        nodes = [{'name': 'demo_yard', 'children': list(range(1, 6))}]
        nodes += [{'name': name, 'children': []} for name in GROUPS]
        owners = {}
        for mi, mesh in enumerate(g['meshes']):
            owner = self.owners[mesh['primitives'][0]['material']]
            if owner not in owners:
                owners[owner] = len(nodes)
                node = {'name': owner}
                if owner not in GROUND: node['children'] = []
                if owner in ITEMS: node['translation'] = list(ITEMS[owner][1])
                nodes.append(node)
                nodes[1+GROUPS.index(self.groups[owner])]['children'].append(owners[owner])
            if owner in GROUND:
                nodes[owners[owner]]['mesh'] = mi
            else:
                nodes[owners[owner]]['children'].append(len(nodes))
                nodes.append({'name': mesh['name'], 'mesh': mi})
            if owner in ITEMS:
                # Local ground-centred pivots let the viewer rotate/scale items.
                for pr in mesh['primitives']:
                    ai = pr['attributes']['POSITION']; a = g['accessors'][ai]
                    arr = accessor(g, binary, ai)
                    arr[:] -= np.array(ITEMS[owner][1], dtype=np.float32)
                    a['min'] = arr.min(axis=0).tolist(); a['max'] = arr.max(axis=0).tolist()
        g['nodes'] = nodes
        g['asset']['generator'] = 'Fictional demo yard using library/build_library.py Model/Mesh writer'
        g['asset']['extras'] = {'units': 'metres', 'up': '+Y', 'south': '-Z', 'east': '-X', 'fictional': True}
        # Identical procedural textures used by multiple items share one image.
        images, textures, mapping, seen = [], [], {}, {}
        for i, image in enumerate(g.get('images', [])):
            view = g['bufferViews'][image['bufferView']]
            payload = bytes(binary[view['byteOffset']:view['byteOffset']+view['byteLength']])
            if payload not in seen:
                seen[payload] = len(images); images.append(image); textures.append({'source': len(images)-1, 'sampler': 0})
            mapping[i] = seen[payload]
        for material in g['materials']:
            tex = material['pbrMetallicRoughness'].get('baseColorTexture')
            if tex: tex['index'] = mapping[tex['index']]
        g['images'], g['textures'] = images, textures
        used = {a['bufferView'] for a in g['accessors']} | {im['bufferView'] for im in images}
        compact, views, remap = bytearray(), [], {}
        for old in sorted(used):
            while len(compact) % 4: compact.append(0)
            v = g['bufferViews'][old].copy(); offset = v['byteOffset']
            remap[old] = len(views); v['byteOffset'] = len(compact)
            compact.extend(binary[offset:offset+v['byteLength']]); views.append(v)
        for a in g['accessors']: a['bufferView'] = remap[a['bufferView']]
        for im in images: im['bufferView'] = remap[im['bufferView']]
        while len(compact) % 4: compact.append(0)
        g['bufferViews'] = views; g['buffers'] = [{'byteLength': len(compact)}]
        binary = compact
        write_glb(path, g, binary)


def read_glb(path):
    raw = path.read_bytes()
    assert struct.unpack_from('<III', raw) == (0x46546c67, 2, len(raw)), 'Invalid GLB header'
    jl, jt = struct.unpack_from('<II', raw, 12)
    assert jt == 0x4e4f534a and jl % 4 == 0
    bl, bt = struct.unpack_from('<II', raw, 20+jl)
    assert bt == 0x004e4942 and bl == len(raw)-28-jl and bl % 4 == 0
    return json.loads(raw[20:20+jl]), bytearray(raw[28+jl:])


def write_glb(path, g, binary):
    j = json.dumps(g, separators=(',', ':')).encode(); j += b' '*((-len(j)) % 4)
    path.write_bytes(struct.pack('<III', 0x46546c67, 2, 28+len(j)+len(binary)) + struct.pack('<II', len(j), 0x4e4f534a) + j + struct.pack('<II', len(binary), 0x004e4942) + binary)


def accessor(g, binary, index):
    a = g['accessors'][index]; v = g['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dtype = np.dtype({5126: '<f4', 5123: '<u2', 5125: '<u4'}[a['componentType']])
    offset = v.get('byteOffset', 0)+a.get('byteOffset', 0)
    stride = v.get('byteStride', n*dtype.itemsize)
    assert offset % dtype.itemsize == 0 and stride >= n*dtype.itemsize
    assert offset+(a['count']-1)*stride+n*dtype.itemsize <= v.get('byteOffset', 0)+v['byteLength']
    return np.ndarray((a['count'], n), dtype=dtype, buffer=binary, offset=offset, strides=(stride, dtype.itemsize))


def world_meshes(g, binary):
    def visit(index, delta):
        node = g['nodes'][index]; delta = delta+np.array(node.get('translation', [0, 0, 0]))
        if 'mesh' in node:
            for pr in g['meshes'][node['mesh']]['primitives']:
                yield index, pr, accessor(g, binary, pr['attributes']['POSITION']).astype(float)+delta
        for child in node.get('children', []): yield from visit(child, delta)
    yield from visit(0, np.zeros(3))


def render(path):
    g, binary = read_glb(path)
    # The toolkit thumbnail renderer reads mesh buffers directly. Bake a
    # temporary world-space copy so its existing renderer sees item transforms.
    for _, pr, points in world_meshes(g, binary):
        ai = pr['attributes']['POSITION']; accessor(g, binary, ai)[:] = points
        g['accessors'][ai]['min'] = points.min(axis=0).tolist(); g['accessors'][ai]['max'] = points.max(axis=0).tolist()
    with tempfile.TemporaryDirectory(prefix='demo_preview_') as tmp:
        source = Path(tmp)/'world.glb'; write_glb(source, g, binary)
        original_unit = kit.render_unit
        try:
            # At exactly 90 degrees, cos(pi/2) is ~6e-17. The toolkit's
            # general-purpose 1e-10 floor collapses the camera basis at this
            # pole. Normalize tiny nonzero vectors without changing its source.
            kit.render_unit = lambda x: x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-30)
            for suffix, azimuth, elevation in [('top', 180, 90), ('angle', 202, 55)]:
                kit.render_thumbnail('demo_yard', azimuth=azimuth, elevation=elevation, source=source, save=HERE/f'overview-{suffix}.png', size=1024)
        finally:
            kit.render_unit = original_unit


def check(path, images=True):
    g, binary = read_glb(path); nodes = g['nodes']; names = [n['name'] for n in nodes]
    assert g['asset']['version'] == '2.0' and g['scenes'] == [{'nodes': [0]}]
    assert names[0] == 'demo_yard' and [names[i] for i in nodes[0]['children']] == list(GROUPS)
    assert len(set(names)) == len(names) and all(re.fullmatch('[a-z][a-z0-9_]*', n) for n in names)
    assert not any(k in g for k in ('animations', 'cameras', 'extensionsUsed', 'extensionsRequired'))
    parents = {}
    for i, n in enumerate(nodes):
        assert not any(k in n for k in ('matrix', 'rotation', 'scale', 'camera', 'extensions'))
        for c in n.get('children', []):
            assert 0 <= c < len(nodes) and c not in parents and c != i
            parents[c] = i
    assert set(parents) == set(range(1, len(nodes)))
    for name, (group, _) in ITEMS.items(): assert names[parents[names.index(name)]] == group
    assert {names[i] for i in nodes[names.index('ground')]['children']} == set(GROUND)
    assert {names[i] for i in nodes[names.index('structures')]['children']} == {'back_fence', 'left_fence', 'right_fence', 'house_exterior', 'garage_exterior'}
    for group in ('vegetation', 'furniture', 'details'):
        assert {names[i] for i in nodes[names.index(group)]['children']} == {n for n, (gr, _) in ITEMS.items() if gr == group}
    assert g['buffers'] == [{'byteLength': len(binary)}]
    for v in g['bufferViews']:
        assert v['buffer'] == 0 and v.get('byteOffset', 0) >= 0 and v.get('byteOffset', 0)+v['byteLength'] <= len(binary)
    for i, a in enumerate(g['accessors']):
        arr = accessor(g, binary, i)
        assert np.isfinite(arr).all()
        for key, fn in [('min', np.min), ('max', np.max)]:
            if key in a: assert np.allclose(fn(arr, axis=0), a[key], atol=1e-5)
    for mat in g['materials']:
        assert re.fullmatch('[a-z][a-z0-9_]*', mat['name'])
        pbr = mat['pbrMetallicRoughness']
        assert 0 <= pbr['roughnessFactor'] <= 1 and 0 <= pbr['metallicFactor'] <= 1
        assert all(0 <= c <= 1 for c in pbr['baseColorFactor'])
    image_sizes = []
    for im in g.get('images', []):
        assert 'uri' not in im and im['mimeType'] in ('image/png', 'image/jpeg')
        v = g['bufferViews'][im['bufferView']]
        img = Image.open(io.BytesIO(binary[v['byteOffset']:v['byteOffset']+v['byteLength']]))
        img.load(); assert max(img.size) <= 1024; image_sizes.append(img.size)
    triangles, points_by_owner, ground_faces = 0, {}, {}
    for ni, pr, positions in world_meshes(g, binary):
        assert pr.get('mode', 4) == 4 and 0 <= pr['material'] < len(g['materials'])
        owner = ni if names[ni] in GROUND else parents[ni]
        points_by_owner.setdefault(names[owner], []).append(positions)
        attrs = pr['attributes']; normal = accessor(g, binary, attrs['NORMAL'])
        uv = accessor(g, binary, attrs['TEXCOORD_0']); colors = accessor(g, binary, attrs['COLOR_0'])
        assert len(positions) == len(normal) == len(uv) == len(colors)
        assert np.allclose(np.linalg.norm(normal, axis=1), 1, atol=1e-5)
        assert ((colors >= 0) & (colors <= 1)).all()
        ix = accessor(g, binary, pr['indices']).ravel()
        assert len(ix) % 3 == 0 and ix.max() < len(positions)
        faces = positions[ix.reshape(-1, 3)]
        fn = np.cross(faces[:, 1]-faces[:, 0], faces[:, 2]-faces[:, 0])
        assert (np.linalg.norm(fn, axis=1) > 1e-12).all(), names[ni]+': degenerate face'
        assert (np.sum(fn*normal[ix.reshape(-1, 3)[:, 0]], axis=1) >= -1e-9).all(), names[ni]+': winding'
        triangles += len(faces)
        assert positions[:, 1].min() >= -1e-6, names[ni]+': below ground'
        if names[owner] in GROUND:
            assert len(g['meshes'][nodes[ni]['mesh']]['primitives']) == 1 and 'children' not in nodes[ni]
            assert np.allclose(positions[:, 1], 0) and (fn[:, 1] > 0).all()
            assert np.allclose(uv, positions[:, [0, 2]], atol=1e-5), 'Ground UVs must be metre-scaled X/Z'
            ground_faces[names[owner]] = faces[:, :, [0, 2]]
    all_points = np.concatenate([p for ps in points_by_owner.values() for p in ps])
    bounds = {name: [np.concatenate(ps).min(axis=0).tolist(), np.concatenate(ps).max(axis=0).tolist()] for name, ps in points_by_owner.items()}
    for name in ITEMS:
        if name != 'wall_lantern_01': assert abs(bounds[name][0][1]) < 1e-6, name+': not grounded'
        if name != 'wall_lantern_01':
            lo, hi = bounds[name]
            assert lo[0] >= X0 and hi[0] <= X1 and lo[2] >= 0 and hi[2] <= WALL, name+': outside yard'
    assert 50000 <= triangles <= 100000, f'Triangle budget: {triangles}'
    assert path.stat().st_size < 15_000_000
    # Check projected intersection area of every exported ground triangle pair.
    def cross2(a, b): return float(a[0]*b[1]-a[1]*b[0])
    def clip(poly, a, b):
        out = []
        def side(p): return cross2(b-a, p-a)
        for p, q in zip(poly, poly[1:]+poly[:1]):
            sp, sq = side(p), side(q)
            if sp >= -1e-10: out.append(p)
            if (sp < 0) != (sq < 0): out.append(p+(q-p)*sp/(sp-sq))
        return out
    def area(poly):
        return abs(sum(cross2(a, b) for a, b in zip(poly, poly[1:]+poly[:1])))/2 if len(poly) >= 3 else 0
    ground_list = [(name, tri) for name, tris in ground_faces.items() for tri in tris]
    for i, (name, tri) in enumerate(ground_list):
        for other, t in ground_list[i+1:]:
            poly = list(tri)
            if cross2(t[1]-t[0], t[2]-t[0]) < 0: t = t[::-1]
            for a, b in zip(t, np.roll(t, -1, axis=0)):
                if poly: poly = clip(poly, a, b)
            assert area(poly) < 1e-7, name+' overlaps '+other
    ground_area = sum(area(list(tri)) for _, tri in ground_list)
    assert abs(ground_area-((X1-X0)*WALL+(X1-8.53)*(END-WALL))) < 1e-4, 'Ground coverage gap'
    # Measure actual planar cedar/siding triangle faces, excluding trim/hardware.
    def plane(owner, material_suffix, axis, expected, y=None):
        candidates = []
        for ni, pr, pts in world_meshes(g, binary):
            if names[ni] != owner+'_'+material_suffix: continue
            ix = accessor(g, binary, pr['indices']).reshape(-1, 3); tris = pts[ix]
            for tri in tris:
                if np.ptp(tri[:, axis]) < 1e-5 and abs(tri[0, axis]-expected) < 1e-4:
                    if y is None or (tri[:, 1].min() <= y <= tri[:, 1].max()): candidates.append(tri)
        assert candidates, owner+': missing measured plane'
        return float(np.concatenate(candidates)[:, axis].mean())
    measurements = {
        'left_fence_inner_x': plane('left_fence', 'cedar', 0, X0, 1),
        'right_fence_inner_x': plane('right_fence', 'cedar', 0, X1, 1),
        'back_fence_inner_z': plane('back_fence', 'cedar', 2, 0, 1),
    }
    # Lap siding is sloped, so measure its exposed lower vertices (not trim).
    for owner in ('house_exterior', 'garage_exterior'):
        ni = names.index(owner+'_lap_siding'); pr = g['meshes'][nodes[ni]['mesh']]['primitives'][0]
        p = accessor(g, binary, pr['attributes']['POSITION'])
        p = p[p[:, 1] < 2.4]  # exclude the projecting garage gable
        # Sample the clear east end of the wall, away from door panels/casings.
        wall_sample = p[p[:, 0] < p[:, 0].min()+.40]
        measurements[owner+'_back_z'] = float(wall_sample[:, 2].min())
        assert abs(measurements[owner+'_back_z']-WALL) < 1e-5
        measurements[owner+'_x_range'] = [float(p[:, 0].min()), float(p[:, 0].max())]
    assert np.allclose(measurements['house_exterior_x_range'], [0, 8.53], atol=1e-5)
    # Garage gable siding reaches its 0.4 m eave; wall span is measured below eave.
    ni = names.index('garage_exterior_lap_siding'); pr = g['meshes'][nodes[ni]['mesh']]['primitives'][0]
    p = accessor(g, binary, pr['attributes']['POSITION']); p = p[p[:, 1] < 2.4]
    measurements['garage_exterior_x_range'] = [float(p[:, 0].min()), float(p[:, 0].max())]
    assert np.allclose(measurements['garage_exterior_x_range'], [-4.25, 0], atol=1e-5)
    for name in ('back_fence', 'left_fence', 'right_fence'): assert abs(bounds[name][1][1]-1.8) < 1e-5
    if images:
        for suffix in ('top', 'angle'):
            im = Image.open(HERE/f'overview-{suffix}.png'); im.load()
            assert im.size == (1024, 1024) and im.mode == 'RGBA'
            alpha = im.getchannel('A'); bbox = alpha.getbbox()
            assert bbox and bbox[2]-bbox[0] > 650 and bbox[3]-bbox[1] > 500
            assert np.count_nonzero(np.asarray(alpha) > 128) > 200000, 'Preview is empty or collapsed'
    return {'status': 'PASS', 'triangles': triangles, 'bytes': path.stat().st_size, 'nodes': len(nodes),
            'textures': len(image_sizes), 'max_texture_px': max(max(s) for s in image_sizes),
            'bounds': [all_points.min(axis=0).tolist(), all_points.max(axis=0).tolist()],
            'measurements': measurements, 'item_bounds': bounds, 'ground_area_m2': ground_area}


def notes(path, report):
    g, _ = read_glb(path)
    lines = ['# Fictional suburban demo yard', '',
             'Generated from scratch by `demo/build_demo_yard.py`; no geometry or asset files from the real yard or Library items are read. The only import is the reusable toolkit in `library/build_library.py`.', '',
             'Metres; +Y up; ground y=0. South/back fence is z=0, north/house is +Z, east/left is −X, west/right is +X. The house and garage end at z=10.60. The garage fills the area east of the house, so there is no east side yard. The 1.20 m strip west of the house is part of the walkway. House and matching garage lap siding are warm off-white (sRGB #e8e5da), with white trim. Roofs use a dark walnut brown, barrel-tile-inspired procedural texture (base #4e392b), with curved highlights, recessed channels and overlapping course lips; UVs run uphill on each slope. This is a surface texture, not individual tile geometry. Window and door glazing is muted dark green (#536f69), matching the reference yard’s glazing colour. Umbrella fabric is muted red (#9e282b), with subtle procedural weave variation.', '',
             '## Rebuild and validate', '', '```sh', 'python3 demo/build_demo_yard.py --build', 'python3 demo/build_demo_yard.py --check', 'python3 demo/build_demo_yard.py --render-only', '```', '',
             'Uses NumPy and Pillow; falls back to the installed Codex Python runtime if needed. Fixed random seeds. Imports Model/Mesh, procedural wood/concrete texture helpers, tube/leaf primitives, the GLB writer and the thumbnail renderer. No Library generator, manifest, model or thumbnail is changed.', '',
             '## Measured exported geometry', '', '| Face / wall | Measured coordinate (m) |', '|---|---:|']
    for name, value in report['measurements'].items():
        formatted = ', '.join(f'{v:.6f}' for v in value) if isinstance(value, list) else f'{value:.6f}'
        lines.append(f'| {name} | {formatted} |')
    lines += ['', 'Fence measurements use planar interior cedar faces crossing y=1 m. Posts lie outside the yard. Small fasteners project 0.8 mm inward. Fence height is 1.80 m. Wall measurements use the lowest-z exposed lap edges; siding recesses by up to 28 mm. White casings, door thresholds and the lantern project into the yard. Garage wall span excludes its overhanging gable. House eave y=2.70 m, exposed overhang 0.40 m, hip ridge y=3.82 m. Garage eave y=2.45 m, gable ridge y=3.12 m. Attached roof edges meet at x=0.', '',
              '## Ground footprints', '', 'Every ground node is one flat mesh, with one primitive and one material, upward normals and UV=(world X, world Z): one texture repeat per metre. The lawn has several joined rectangles in the same mesh. Shared boundaries have zero area; no surfaces overlap.', '',
              '| Node | Rectangles (min X, max X, min Z, max Z), metres |', '|---|---|']
    for name, rects in GROUND.items(): lines.append(f'| {name} | '+ '; '.join(str(r) for r in rects)+' |')
    lines += ['', 'Patio: 4.20 × 2.40 m, centred on the house’s rear slider. Walkway: 0.60 m deep along the back of the house and garage (fence to fence), then down the 1.20 m strip west of the house. Planting bed: 1.20 m deep. House rear slider is x=3.05–5.95; its window is x=0.72–2.10. Garage people door is x=−2.75–−1.80; its window is x=−1.18–−0.30. No vehicle door faces the yard.', '',
              '## Item placement and measured size', '', '| Item | Ground pivot X, Y, Z (m) | Size X × Y × Z (m) |', '|---|---|---|']
    for name, (_, position) in ITEMS.items():
        lo, hi = report['item_bounds'][name]
        lines.append(f'| {name} | {position} | '+ ' × '.join(f'{hi[k]-lo[k]:.3f}' for k in range(3))+' |')
    lines += ['', 'Movable items have local geometry and a ground-level translation pivot; all pieces are inside the item. The wall lantern preserves its mounting height, with a pivot on the wall at y=0. Plants inside the raised bed and planter belong to their furniture item. Glass is an opaque dark green reflective approximation for predictable preview and viewer rendering.', '',
              '## Complete node hierarchy', '', '```text']
    def tree(i, depth=0):
        n = g['nodes'][i]; lines.append('  '*depth+n['name'])
        for c in n.get('children', []): tree(c, depth+1)
    tree(0)
    lines += ['```', '', '## Materials', '', 'All material names are snake_case. Each piece node uses the identically named material; each ground mesh uses `<node>_surface`. All textures are embedded, at most 512 px, and generated procedurally. No camera, light, animation, external URI, compression or required extension is exported.', '',
              '## Validation result', '', f"PASS: {report['triangles']:,} triangles; {report['bytes']:,} bytes ({report['bytes']/1e6:.2f} MB); {report['nodes']} named nodes; {report['textures']} textures; lowest world Y = {report['bounds'][0][1]:.6f} m; ground surface area = {report['ground_area_m2']:.3f} m².", '',
              'Checks reopen the final GLB and verify headers/chunks, buffers/accessors, finite values, accessor bounds, index ranges, normals/winding, nondegenerate triangles, names and parentage, exact root groups, item ground contact, world height, budgets, texture dimensions, one-material ground meshes, metre-scaled UVs, projected ground intersections/coverage, and exported fence/wall measurements. Both previews are checked as 1024 × 1024 RGBA PNGs.', '',
              'The previews reuse the toolkit renderer on a temporary world-space copy, with a temporary normalization guard for its camera basis at the 90° pole; no toolkit source is edited. Top camera: elevation 90°, azimuth 180° (north at the top; east/−X at image right, as viewed from south). Angle camera: elevation 55°, azimuth 202°, south of the back fence looking north. Camera and lighting exist only in the renderer, not in the delivered GLB.', '',
              '## Viewer integration', '',
              'This generator only writes the requested demo asset set. Viewer configuration should load `demo/demo-yard.glb`, register the six item names above in ITEMS (mark wall_lantern_01 attached: "wall"), register the four ground names in GROUND_AREAS, and use no real-yard ITEM_PARTS. Measured open-ground regions are [{minX:-4.25,maxX:9.73,minZ:0,maxZ:5.80},{minX:8.53,maxX:9.73,minZ:5.80,maxZ:10.60}]; a viewer may choose small insets for collisions. Keep demo saved layouts separate from real-yard layouts. Root/groups and per-item hierarchy follow the requested viewer structure. These measurements are authoritative for this asset even if a separate demo viewer configuration still contains provisional bounds.', '']
    (HERE/'DEMO_YARD_NOTES.md').write_text('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--build', action='store_true'); action.add_argument('--check', action='store_true'); action.add_argument('--render-only', action='store_true')
    args = parser.parse_args(); path = HERE/'demo-yard.glb'
    if args.build:
        yard = Yard(); yard.build_ground()
        yard.build_fence('back_fence', 'z', 0, X0, X1, -1)
        yard.build_fence('left_fence', 'x', X0, 0, WALL, -1)
        yard.build_fence('right_fence', 'x', X1, 0, END, 1)
        yard.build_building('house_exterior', 0, 8.53)
        yard.build_building('garage_exterior', -4.25, 0, True)
        yard.shrub('boxwood_shrub_01'); yard.furniture()
        yard.save(path); print(json.dumps(check(path, images=False), indent=2), flush=True)
        render(path)
    elif args.render_only: render(path)
    report = check(path)
    if args.build or args.render_only: notes(path, report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__': main()
