// Not in the menu for now (Mari, 2026-09-29): kept so it's easy to bring back.
//
// Moving plans between this browser and the shared app (or keeping a backup):
// export your plans, with any imported models they use, to a .json file; and
// add the plans from such a file to your own. Imported models in the file are
// imported again and the plans are pointed at the new copies.

const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

export async function exportPlans(ctx) {
  const plans = ctx.plans.exportable();
  const keys = new Set(plans.flatMap((p) => p.layout.items.map((r) => r.key)).filter((k) => k.startsWith("imp:")));
  const imports = [];
  for (const key of keys) {
    const e = ctx.library.get(key);
    if (!e?.record) continue;
    const data = e.record.data || await (await fetch(e.record.url)).arrayBuffer();
    imports.push({ key, label: e.label, scale: e.record.scale, thumbnail: e.thumbnail, data: toBase64(data) });
  }
  const file = JSON.stringify({ app: "backyard", version: 1, exportedAt: new Date().toISOString(), plans, imports });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([file], { type: "application/json" }));
  a.download = "backyard-plans.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  ctx.toast(`Exported ${plans.length} plan${plans.length === 1 ? "" : "s"} to backyard-plans.json.`);
}

export async function importPlans(ctx, file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  if (data?.app !== "backyard" || !Array.isArray(data.plans)) {
    ctx.toast("That file isn't a Backyard plans export.");
    return;
  }
  const remap = new Map(); // old imported-model key -> new key
  for (const imp of data.imports || []) {
    try {
      remap.set(imp.key, await ctx.library.addImport({
        label: imp.label, data: fromBase64(imp.data), scale: imp.scale, thumbnail: imp.thumbnail,
      }));
    } catch (err) {
      console.warn("Couldn't bring in an imported model", err);
    }
  }
  const plans = data.plans
    .filter((p) => Array.isArray(p?.layout?.items))
    .map((p) => ({
      name: p.name,
      layout: {
        ...p.layout,
        items: p.layout.items.map((r) => {
          const key = remap.get(r.key);
          return key ? { ...r, key, id: key + r.id.slice(r.key.length) } : r;
        }),
      },
    }));
  ctx.plans.importPlans(plans);
  if (remap.size) ctx.emit("library-changed");
  ctx.toast(`Added ${plans.length} plan${plans.length === 1 ? "" : "s"} to your plans.`);
}
