import { YARD_REGIONS } from "./config.js";

// Smallest x/z shift that puts footprint `fp` ({minX,maxX,minZ,maxZ}) fully
// inside one yard region, or null if it is too big for every region.
export function fitOffset(fp) {
  let best = null;
  for (const r of YARD_REGIONS) {
    if (fp.maxX - fp.minX > r.maxX - r.minX + 1e-6) continue;
    if (fp.maxZ - fp.minZ > r.maxZ - r.minZ + 1e-6) continue;
    const dx = fp.minX < r.minX ? r.minX - fp.minX : fp.maxX > r.maxX ? r.maxX - fp.maxX : 0;
    const dz = fp.minZ < r.minZ ? r.minZ - fp.minZ : fp.maxZ > r.maxZ ? r.maxZ - fp.maxZ : 0;
    const dist = dx * dx + dz * dz;
    if (!best || dist < best.dist) best = { dx, dz, dist };
  }
  return best;
}

export function pointInYard(x, z, radius = 0) {
  return YARD_REGIONS.some(
    (r) => x - radius >= r.minX && x + radius <= r.maxX && z - radius >= r.minZ && z + radius <= r.maxZ
  );
}

// Nearest spot inside the yard for a circle of `radius` centred at x/z.
export function clampPoint(x, z, radius = 0) {
  const o = fitOffset({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius });
  return o ? { x: x + o.dx, z: z + o.dz } : null;
}
