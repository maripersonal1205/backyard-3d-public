import * as THREE from "three";
import { COLOR_PRESETS, ITEMS } from "./config.js";
import { clampPoint, fitOffset } from "./yard.js";

// A transform `t` is { p: [x,y,z], r: rotationY, s: [sx,sy,sz] }. Arrays are
// never mutated in place, so a `t` can be shared safely between snapshots.
const readT = (o) => ({ p: o.position.toArray(), r: o.rotation.y, s: o.scale.toArray() });
const cloneT = (t) => ({ p: [...t.p], r: t.r, s: [...t.s] });

function writeT(o, t) {
  o.position.fromArray(t.p);
  o.rotation.set(0, t.r, 0);
  o.scale.fromArray(t.s);
  o.updateMatrixWorld(true);
}

// Bounding box in the object's own frame (unrotated, unscaled, at the origin).
// The item groups' parents in the model have identity transforms.
function localBox(o) {
  const t = readT(o);
  writeT(o, { p: [0, 0, 0], r: 0, s: [1, 1, 1] });
  const box = new THREE.Box3().setFromObject(o);
  writeT(o, t);
  return box;
}

// Light a material by a fraction of its own colour (COLOR_PRESETS `glow`).
function applyGlow(m) {
  const glow = COLOR_PRESETS[m.name]?.glow;
  if (glow && m.emissive) m.emissive.copy(m.color).multiplyScalar(glow);
}

// Recolourable materials in a model (see COLOR_PRESETS): name -> colour as delivered.
function recolorable(object) {
  const found = {};
  object.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!COLOR_PRESETS[m.name]) continue;
      if (!(m.name in found)) found[m.name] = "#" + m.color.getHexString();
      applyGlow(m);
    }
  });
  return found;
}

// Unscaled height from the ground to the top of `box` (its own height if it
// sits on the ground).
export const baseHeight = (box) => (box.min.y > 0.01 ? box.max.y : box.max.y - box.min.y);

// World-space x/z rectangle covered by `box` under transform `t`.
export function footprint(box, t) {
  const c = Math.cos(t.r), s = Math.sin(t.r);
  const fp = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const lx of [box.min.x, box.max.x]) {
    for (const lz of [box.min.z, box.max.z]) {
      const x = lx * t.s[0], z = lz * t.s[2];
      const wx = x * c + z * s + t.p[0];
      const wz = -x * s + z * c + t.p[2];
      fp.minX = Math.min(fp.minX, wx); fp.maxX = Math.max(fp.maxX, wx);
      fp.minZ = Math.min(fp.minZ, wz); fp.maxZ = Math.max(fp.maxZ, wz);
    }
  }
  return fp;
}

// Item types are keyed by the node name in backyard.glb, or by "lib:<id>" for
// Library items and "imp:<id>" for imported models (see library.js).
export class ItemStore {
  constructor(model) {
    this.items = new Map(); // id -> item; includes items no longer in the layout (exists: false)
    this.defs = {};         // key -> { label, attached, pickable }
    this.templates = {};    // key -> { object, parent, box }
    this.counters = {};     // key -> highest copy number used
    this.insideWalls = false; // Settings: keep whole items inside the walls (not just their centre)
    model.updateMatrixWorld(true);
    for (const [key, def] of Object.entries(ITEMS)) {
      const object = model.getObjectByName(key);
      if (!object) continue;
      this.defs[key] = def;
      this.templates[key] = { object, parent: object.parent, box: localBox(object), colors: recolorable(object) };
      this._register(key, key, def.label, object, readT(object));
    }
    this.initialState = this.getState();
  }

  // Make a type placeable. `object` must rest on y = 0 with its base centred on
  // the origin; copies are cloned from it and added to `parent`.
  addTemplate(key, def, object, parent) {
    this.defs[key] = def;
    this.templates[key] = { object, parent, box: localBox(object), colors: recolorable(object) };
  }

  _register(id, key, label, object, t) {
    const def = this.defs[key];
    object.userData.itemId = id;
    const item = {
      id, key, label, object, t,
      origin: cloneT(t),
      box: this.templates[key].box,
      attached: def.attached || null,
      pickable: def.pickable !== false,
      placed: true,
      exists: true,
      colors: {}, // recolourable material name -> hex; missing = the model's own colour
    };
    this.items.set(id, item);
    writeT(object, t);
    return item;
  }

  get(id) { return this.items.get(id) || null; }
  placedItems() { return [...this.items.values()].filter((i) => i.exists && i.placed); }

  fromObject(o) {
    for (; o; o = o.parent) {
      if (o.userData?.itemId) return this.get(o.userData.itemId);
    }
    return null;
  }

  footprint(item, t = item.t) { return footprint(item.box, t); }

  // Current size in metres along the item's own axes (x = width, y = height, z = depth).
  // Height is measured from the ground, so a mounted item that floats (a canopy)
  // reports its height to the top, not just its own thickness.
  size(item) {
    const s = item.box.getSize(new THREE.Vector3());
    return { x: s.x * Math.abs(item.t.s[0]), y: baseHeight(item.box) * Math.abs(item.t.s[1]), z: s.z * Math.abs(item.t.s[2]) };
  }

  // `t` with the item's centre moved just enough to be inside the yard. The rest
  // of the item may reach past the walls or the house, so anything can be turned
  // or resized anywhere (Mari, 2026-09-30). With the "go past the walls" setting
  // off (insideWalls), the whole item is also nudged inside the walls, unless
  // it's too big for any part of the yard. Attached items stay where they're mounted.
  fit(item, t) {
    if (item.attached) return t;
    const p = clampPoint(t.p[0], t.p[2]);
    const out = { ...t, p: [p.x, t.p[1], p.z] };
    const o = this.insideWalls && fitOffset(footprint(item.box, out));
    return o ? { ...out, p: [out.p[0] + o.dx, out.p[1], out.p[2] + o.dz] } : out;
  }

  setTransform(item, t) {
    item.t = t;
    writeT(item.object, t);
  }

  setPlaced(item, placed) {
    item.placed = placed;
    const parent = this.templates[item.key].parent;
    if (placed && item.exists) parent.add(item.object);
    else parent.remove(item.object);
  }

  // Apply swatch colours. The first time an item is recoloured its materials
  // are copied, so copies of the same model keep their own colours.
  setColors(item, colors) {
    item.colors = { ...colors };
    const base = this.templates[item.key].colors;
    if (!Object.keys(base).length) return;
    item.object.traverse((o) => {
      if (!o.isMesh) return;
      const mats = [].concat(o.material).map((m) => {
        if (!(m.name in base)) return m;
        if (m.userData.ownerId !== item.id) {
          m = m.clone();
          m.userData.ownerId = item.id;
        }
        m.color.set(item.colors[m.name] || base[m.name]);
        applyGlow(m);
        return m;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });
  }

  // Take an item out of the layout (Remove; undo brings it back).
  discard(item) {
    item.exists = false;
    this.setPlaced(item, false);
  }

  createCopy(source) {
    const n = (this.counters[source.key] = (this.counters[source.key] || 1) + 1);
    const item = this._clone(`${source.key}__${n}`, source.key, `${this.defs[source.key].label} ${n}`, cloneT(source.t));
    this.setColors(item, source.colors);
    this.setPlaced(item, true);
    return item;
  }

  // A new copy of a Library or imported type, numbered after the lowest number
  // not already in the layout ("Bench", then "Bench 2").
  createInstance(key, t) {
    let n = 1;
    while (this.get(`${key}__${n}`)?.exists) n++;
    this.counters[key] = Math.max(this.counters[key] || 0, n);
    const label = n === 1 ? this.defs[key].label : `${this.defs[key].label} ${n}`;
    const item = this._clone(`${key}__${n}`, key, label, cloneT(t));
    this.setPlaced(item, true);
    return item;
  }

  // Types in a layout that don't have a template yet (Library items not loaded).
  missingKeys(state) {
    return [...new Set(state.items.map((r) => r.key))].filter((k) => !this.templates[k]);
  }

  _clone(id, key, label, t) {
    const object = this.templates[key].object.clone(true);
    return this._register(id, key, label, object, t);
  }

  getState() {
    return {
      items: [...this.items.values()]
        .filter((i) => i.exists && i.placed)
        .map((i) => ({
          id: i.id, key: i.key, label: i.label, placed: i.placed, t: cloneT(i.t),
          ...(Object.keys(i.colors).length ? { colors: { ...i.colors } } : {}),
        })),
    };
  }

  applyState(state) {
    const seen = new Set();
    for (const rec of state.items) {
      // placed: false = removed but kept for "Previously used" (before 2026-09-30): now just gone.
      if (!this.templates[rec.key] || seen.has(rec.id) || rec.placed === false) continue;
      let item = this.get(rec.id);
      if (!item) {
        item = this._clone(rec.id, rec.key, rec.label, cloneT(rec.t));
        const n = Number(/__(\d+)$/.exec(rec.id)?.[1]);
        if (n) this.counters[rec.key] = Math.max(this.counters[rec.key] || 1, n);
      }
      item.exists = true;
      item.label = rec.label;
      this.setTransform(item, cloneT(rec.t));
      this.setColors(item, rec.colors || {});
      this.setPlaced(item, rec.placed);
      seen.add(rec.id);
    }
    for (const item of this.items.values()) {
      if (!seen.has(item.id)) this.discard(item);
    }
  }
}
