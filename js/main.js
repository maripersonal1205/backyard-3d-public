import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ITEM_PARTS, MODEL, START_LAYOUT, walkSpawn } from "./config.js";
import { createEnvironment } from "./environment.js";
import { ItemStore } from "./items.js";
import { createLibrary } from "./library.js";
import { createGround } from "./ground.js";
import { createPlans } from "./plans.js";
import { createViews } from "./views.js";
import { createActions } from "./actions.js";
import { createInteraction } from "./interaction.js";
import { createThumbnailer, renderThumbnails } from "./thumbnails.js";
import { clampPoint } from "./yard.js";
import { createToolbar } from "./ui/toolbar.js";
import { createPlanSwitcher } from "./ui/plans.js";
import { createSidebar } from "./ui/sidebar.js";
import { createInspector } from "./ui/inspector.js";
import { createImportDialog } from "./ui/import.js";
import { createGeneration } from "./ui/generate.js";
import { toast } from "./ui/toast.js";
import { createBackend } from "./backend.js";
import { createUpdateCheck } from "./update-check.js";
import { createViewOnly } from "./view-only.js";

// Shared context handed to every module, plus a tiny event bus:
//   items-changed · selection-changed · history-changed · mode-changed ·
//   plans-changed · thumbs-changed · library-changed · save-status
const bus = new EventTarget();
const ctx = {
  on: (name, fn) => bus.addEventListener(name, (e) => fn(e.detail)),
  emit: (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail })),
  toast,
};
window.__backyard = ctx; // debugging handle for the browser console
createViewOnly(ctx); // narrow screens are for looking only (sets ctx.viewOnly)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 2000);
camera.position.set(8, 12, -14);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById("app").appendChild(renderer.domElement);
// Hidden until the yard is ready: item pictures are drawn in a corner of this
// canvas while it starts, and nothing else covers them until the first frame.
renderer.domElement.style.visibility = "hidden";

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.5;
controls.maxDistance = 80;

Object.assign(ctx, { scene, camera, renderer, controls });
ctx.env = createEnvironment(ctx);

const loading = document.getElementById("loading");
new GLTFLoader().load(
  MODEL,
  (gltf) => init(gltf.scene).catch((err) => {
    loading.textContent = "Something went wrong while starting the viewer. Try reloading the page.";
    console.error(err);
  }),
  (xhr) => {
    if (xhr.lengthComputable) loading.textContent = `Loading backyard… ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
  },
  (err) => {
    loading.textContent = "Couldn't load the yard model: " + err.message;
    console.error(err);
  }
);

// Attach ITEM_PARTS to their items' nodes. A part that fails to load is left out.
async function addItemParts(model) {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(ITEM_PARTS).flatMap(([key, urls]) => urls.map(async (url) => {
    const node = model.getObjectByName(key);
    if (!node) return;
    try {
      const part = (await loader.loadAsync(url)).scene;
      part.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      node.add(part);
    } catch (err) {
      console.warn(`Couldn't load ${url}`, err);
    }
  })));
  model.updateMatrixWorld(true);
}

// The yard isn't drawn until the open plan is in place, so the model's own
// arrangement doesn't flash up first (Mari, 2026-10-01: the demo showed Codex's
// layout for a moment before hers).
let ready = false;

async function init(model) {
  loading.textContent = "Setting up the yard…";
  model.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  scene.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  ctx.model = model;
  ctx.bounds = { box, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
  ctx.env.fitTo(box);

  await addItemParts(model);
  const items = (ctx.items = new ItemStore(model));
  // Plans and settings: from the shared app when it's there, else this browser.
  ctx.backend = await createBackend();
  const saved = await ctx.backend.load();
  if (typeof saved?.time === "number") ctx.env.setTime(saved.time);

  // Item pictures: the yard's own items now, Library items as they load.
  ctx.renderThumbnail = createThumbnailer(renderer);
  const thumbs = renderThumbnails(ctx.renderThumbnail, items);
  ctx.thumbnailFor = (key) => thumbs[key] || ctx.library.get(key)?.thumbnail || "";
  ctx.library = await createLibrary(ctx);
  ctx.ground = await createGround(ctx);

  // A layout is everything a plan saves and undo steps between: the items
  // plus each ground area's surface. Layouts saved before ground surfaces
  // existed have no `ground`, so they get the default surfaces.
  ctx.getLayout = () => ({ ...items.getState(), ground: ctx.ground.getState() });
  ctx.applyLayout = (layout) => { items.applyState(layout); ctx.ground.applyState(layout.ground); };
  // The original yard: the model as it is, unless the yard's file gives a
  // starting layout (the demo's). New plans and Revert to original use it.
  ctx.initialLayout = START_LAYOUT ? structuredClone(START_LAYOUT) : { ...items.initialState, ground: ctx.ground.defaultState };

  // ctx.history is the open plan's undo history (swapped by plans.open).
  const changed = () => {
    ctx.emit("items-changed");
    ctx.emit("history-changed");
    ctx.persist();
  };
  ctx.commit = (mergeKey) => { ctx.history.push(ctx.getLayout(), mergeKey); changed(); };
  const restore = (state) => { if (state) { ctx.applyLayout(state); changed(); } };
  ctx.undo = () => { if (!ctx.viewOnly) restore(ctx.history.undo()); };
  ctx.redo = () => { if (!ctx.viewOnly) restore(ctx.history.redo()); };

  ctx.walkSpawn = walkSpawn(items, clampPoint); // where Walk mode starts (the yard's file says)

  ctx.views = createViews(ctx);
  ctx.actions = createActions(ctx);
  ctx.interaction = createInteraction(ctx);
  ctx.select = ctx.interaction.select;
  Object.defineProperty(ctx, "selected", { get: () => ctx.interaction.selected });

  ctx.plans = createPlans(ctx, saved);
  ctx.persist = ctx.plans.persist;
  await ctx.plans.start();

  createToolbar(ctx);
  createPlanSwitcher(ctx);
  createGeneration(ctx);
  createSidebar(ctx);
  createInspector(ctx);
  createImportDialog(ctx);
  createUpdateCheck();
  ctx.on("items-changed", () => ctx.env.updateLamps()); // new items' bulbs match the time of day
  ctx.env.updateLamps();
  ready = true;
  renderer.domElement.style.visibility = ""; // the first frame draws before it's painted
  loading.remove();
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  if (!ready) return;
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
});
