import * as THREE from "three";
import { FEET_PER_METRE } from "../config.js";
import { normalize, parseGLB } from "../library.js";

// "Import model": pick a .glb file, name it and set its height in feet, and
// it's added to the Library (this browser's, or the shared one) like any other
// item. Files often come in odd units, so the height starts at the file's own
// size and is what the model gets scaled to. Models created with AI finish
// through the same dialog (ctx.openModelDialog).
export function createImportDialog(ctx) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("import-dialog"), form = $("import-form"), file = $("import-file");
  const nameInput = $("import-name"), heightInput = $("import-height"), footprint = $("import-footprint");
  const preview = $("import-preview"), submit = $("import-submit"), title = $("import-title"), note = $("import-note");
  let pending = null; // { buffer, size: Vector3 in file units, ai, onSaved }
  const shared = ctx.backend.mode === "cloud";

  ctx.openImport = () => { file.value = ""; file.click(); };

  // Show the dialog for a model's bytes. Resolves false if it can't be opened.
  // opts: { name, title, ai, onSaved(key) } (onSaved runs after it's in the Library)
  ctx.openModelDialog = async (buffer, opts = {}) => {
    try {
      const object = normalize(await parseGLB(buffer.slice(0)));
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      if (!(size.y > 0) || !isFinite(size.y)) throw new Error("empty model");
      pending = { buffer, size, ai: !!opts.ai, onSaved: opts.onSaved };
      preview.src = ctx.renderThumbnail({ object, box }, 1);
      title.textContent = opts.title || "Import model";
      nameInput.value = opts.name || "";
      heightInput.value = (size.y * FEET_PER_METRE).toFixed(1);
      note.textContent = shared
        ? "The model is scaled to this height and added to the Library for everyone."
        : ctx.backend.mode === "demo"
          ? "The model is scaled to this height and added to the Library for this visit. Nothing is saved on the demo site."
          : "The model is scaled to this height. It's saved in this browser and added to the Library.";
      updateFootprint();
      submit.disabled = false;
      dialog.showModal();
      nameInput.focus();
      nameInput.select();
      return true;
    } catch (err) {
      console.warn("Couldn't open the model", err);
      return false;
    }
  };

  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    if (!/\.glb$/i.test(f.name)) return ctx.toast("Choose a .glb file.");
    const name = f.name.replace(/\.glb$/i, "").replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    if (!(await ctx.openModelDialog(await f.arrayBuffer(), { name }))) ctx.toast("That file couldn't be opened as a 3D model.");
  });

  const scale = () => parseFloat(heightInput.value) / FEET_PER_METRE / pending.size.y;

  function updateFootprint() {
    const s = scale();
    footprint.textContent = s > 0
      ? `Width ${(pending.size.x * s * FEET_PER_METRE).toFixed(1)} ft · Depth ${(pending.size.z * s * FEET_PER_METRE).toFixed(1)} ft`
      : "Enter a height to size the model.";
  }
  heightInput.addEventListener("input", updateFootprint);

  $("import-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { pending = null; });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = nameInput.value.trim();
    const s = scale();
    if (!label) return nameInput.focus();
    if (!(s > 0)) return heightInput.focus();
    submit.disabled = true;
    try {
      const { ai, onSaved } = pending;
      const key = await ctx.library.addImport({ label, data: pending.buffer, scale: s, thumbnail: preview.src, ai });
      await onSaved?.(key);
      dialog.close();
      ctx.emit("library-changed");
      ctx.showLibrary(ai ? "ai" : "library");
      ctx.toast(`${label} is in the Library. Click it or drag it into the yard.`);
    } catch (err) {
      console.warn("Saving the import failed", err);
      // A refusal from the shared app (too big, storage full) explains itself.
      ctx.toast(err.status ? err.message : "Couldn't save the model in this browser.");
      submit.disabled = false;
    }
  });
}
