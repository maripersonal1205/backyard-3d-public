import * as THREE from "three";
import { GROUND_AREAS, SURFACES_EXTRA } from "./config.js";

// Ground areas (lawns, walkways, patio…) and their surfaces. Areas are never
// moved; only their surface changes. Surfaces come from
// library/surfaces/surfaces.json (tileable colour / normal / roughness maps
// with a real-world tile size) and load the first time they're used.
//
// While a catalogue surface is shown, the area uses texture coordinates in
// metres, so every area tiles at the same real-world scale and patterns line
// up across neighbouring areas. The model's own material keeps its own UVs.
const MANIFEST = "library/surfaces/surfaces.json";
export const ORIGINAL = "original";

export async function createGround(ctx) {
  const { model, renderer } = ctx;
  const base = new URL(MANIFEST, location.href);

  let catalogue = [];
  try {
    const res = await fetch(MANIFEST, { cache: "no-cache" });
    if (res.ok) catalogue = (await res.json()).surfaces || [];
  } catch (err) {
    console.warn("Surface list couldn't be read", err);
  }
  // The yard's file can add its own surfaces (paths relative to the page).
  const page = new URL(location.href);
  const surfaces = new Map([
    ...catalogue.map((s) => ({ ...s, base })),
    ...SURFACES_EXTRA.map((s) => ({ ...s, base: page })),
  ].map((s) => [s.id, { ...s, swatchUrl: new URL(s.swatch, s.base).href }]));

  // ---- Surface materials, loaded once and shared by every area ----
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const materials = new Map(); // id -> Promise<Material>
  function material(id) {
    if (!materials.has(id)) {
      const s = surfaces.get(id);
      const tex = async (file, srgb) => {
        const t = await loader.loadAsync(new URL(file, s.base).href);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1 / s.tile, 1 / s.tile);
        t.anisotropy = anisotropy;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      materials.set(id, Promise.all([tex(s.color, true), tex(s.normal), tex(s.rough)]).then(
        ([map, normalMap, roughnessMap]) => new THREE.MeshStandardMaterial({
          name: "surface_" + id, map, normalMap, roughnessMap, roughness: 1, metalness: 0,
        })
      ));
    }
    return materials.get(id);
  }

  // ---- Areas ----
  const areas = [];
  model.updateMatrixWorld(true);
  for (const [name, def] of Object.entries(GROUND_AREAS)) {
    const node = model.getObjectByName(name);
    let mesh = null;
    node?.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) continue;
    mesh.geometry = mesh.geometry.clone(); // UVs get swapped per area
    const geo = mesh.geometry;
    const pos = geo.attributes.position, v = new THREE.Vector3();
    const metreUV = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      metreUV.setXY(i, v.x, -v.z);
    }
    const box = new THREE.Box3().setFromObject(mesh);
    areas.push({
      kind: "ground",
      id: name,
      label: def.label,
      mesh,
      originalMaterial: mesh.material,
      originalUV: geo.attributes.uv,
      metreUV,
      originalLabel: def.original || null,
      defaultSurface: surfaces.has(def.surface) ? def.surface : ORIGINAL,
      surface: ORIGINAL,
      pending: null,
      footprint: { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
    });
  }
  const byId = new Map(areas.map((a) => [a.id, a]));

  // Show `id` on an area. The logical surface changes at once (so saving and
  // undo stay in step); the textures follow when they've loaded.
  function setSurface(area, id) {
    if (id !== ORIGINAL && !surfaces.has(id)) id = area.defaultSurface;
    area.surface = id;
    area.pending = id;
    if (id === ORIGINAL) {
      area.mesh.material = area.originalMaterial;
      area.mesh.geometry.setAttribute("uv", area.originalUV);
      return;
    }
    material(id).then((m) => {
      if (area.pending !== id) return; // a newer choice arrived meanwhile
      area.mesh.material = m;
      area.mesh.geometry.setAttribute("uv", area.metreUV);
    }).catch((err) => {
      console.warn(`Couldn't load the ${id} surface`, err);
      ctx.toast("That surface couldn't be loaded.");
    });
  }

  // Swatch picture for the model's own material, drawn from its texture.
  const originalSwatches = new Map();
  function originalSwatch(area) {
    if (!originalSwatches.has(area.id)) {
      const img = area.originalMaterial.map?.image;
      let url = "";
      if (img?.width) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 160;
        canvas.getContext("2d").drawImage(img, 0, 0, 160, 160);
        url = canvas.toDataURL("image/jpeg", 0.85);
      }
      originalSwatches.set(area.id, url);
    }
    return originalSwatches.get(area.id);
  }

  // Choices offered for an area: the model's own material (where offered) + the catalogue.
  function choices(area) {
    const list = [...surfaces.values()].map((s) => ({ id: s.id, label: s.label, swatch: s.swatchUrl }));
    if (area.originalLabel) list.unshift({ id: ORIGINAL, label: area.originalLabel, swatch: originalSwatch(area) });
    return list;
  }

  const defaultState = Object.fromEntries(areas.map((a) => [a.id, a.defaultSurface]));
  const api = {
    areas,
    meshes: areas.map((a) => a.mesh),
    fromMesh: (mesh) => areas.find((a) => a.mesh === mesh) || null,
    get: (id) => byId.get(id) || null,
    defaultState,
    choices,
    surfaceLabel(area) {
      return area.surface === ORIGINAL ? area.originalLabel || "Original" : surfaces.get(area.surface)?.label || "";
    },
    swatchFor(area) {
      return area.surface === ORIGINAL ? originalSwatch(area) : surfaces.get(area.surface)?.swatchUrl || "";
    },
    setSurface,
    getState: () => Object.fromEntries(areas.map((a) => [a.id, a.surface])),
    applyState(state) {
      for (const a of areas) {
        let id = state?.[a.id] ?? a.defaultSurface;
        if (id === ORIGINAL && !a.originalLabel && a.defaultSurface !== ORIGINAL) id = a.defaultSurface;
        if (id !== a.surface || a.pending !== id) setSurface(a, id);
      }
    },
  };
  return api;
}
