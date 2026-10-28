import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { parseGLB } from "../library.js";
import { GENERATE_OFF } from "../backend.js";

// "Create with AI" (shared app only): describe an item or give a photo, an AI
// service makes a 3D model in a few minutes (functions/api/generate), and it's
// added to the Library through the import dialog, where it's named and sized.
// Hidden until the server says it's enabled (no AI service is connected yet). Jobs are
// shared: everyone sees them at the top of the Generated tab while they're being
// made, and anyone can add a finished one. The sidebar reads ctx.generation.
const POLL_MS = 4000;
const REFRESH_MS = 30_000; // how often opening All or Generated re-checks everyone's jobs
const MAX_UPLOAD = 24 * 1024 * 1024; // shared storage takes 25 MB per model
const PHOTO_PX = 1024;

export function createGeneration(ctx) {
  const gen = ctx.backend.generate;
  const state = { enabled: false, demo: false, remaining: null, paused: false, jobs: [] };
  const mine = new Set(); // jobs started on this device: these get a "ready" toast
  let lastRefresh = 0, polling = null;

  ctx.generation = {
    get enabled() { return state.enabled; },
    get jobs() { return state.jobs; },
    open: () => {}, review: () => {}, dismiss: () => {}, refresh: () => {},
  };
  if (!gen) return;

  const $ = (id) => document.getElementById(id);
  const pill = $("items-pill"), panel = $("items-panel");
  const aiTab = panel.querySelector('[data-tab="ai"]');
  const seen = new Set(); // finished jobs already seen in My items on this device

  // My items gets an orange dot while something is being created, and once it's
  // done until My items is opened. The Generated tab pulses while one is being made.
  function showActivity() {
    const working = state.jobs.some((j) => j.status === "working");
    const unseen = state.jobs.some((j) => j.status !== "working" && !seen.has(j.id));
    pill.classList.toggle("has-news", working || unseen);
    aiTab.classList.toggle("generating", working);
  }
  function markSeen() {
    for (const j of state.jobs) if (j.status !== "working") seen.add(j.id);
    showActivity();
  }
  const changed = () => {
    if (panel.hidden) showActivity();
    else markSeen(); // My items is open, so a finished one shows straight away
    ctx.emit("library-changed");
  };

  function setJob(job) {
    const i = state.jobs.findIndex((j) => j.id === job.id);
    const before = i >= 0 ? state.jobs[i] : null;
    if (i >= 0) state.jobs[i] = job;
    else state.jobs.push(job);
    if (before?.status === "working" && job.status !== "working") finished(job);
  }
  const dropJob = (id) => { state.jobs = state.jobs.filter((j) => j.id !== id); };

  function finished(job) {
    if (!mine.has(job.id)) return;
    ctx.toast(job.status === "ready"
      ? `“${job.name}” is ready. Open My items → Generated to add it.`
      : `“${job.name}” couldn't be created. ${job.error || ""}`);
  }
  pill.addEventListener("click", markSeen);

  async function refresh(force = false) {
    if (!force && Date.now() - lastRefresh < REFRESH_MS) return;
    lastRefresh = Date.now();
    try {
      const s = await gen.status();
      Object.assign(state, { enabled: s.enabled, demo: !!s.demo, remaining: s.remaining, paused: s.paused });
      const ids = new Set(s.jobs.map((j) => j.id));
      state.jobs = state.jobs.filter((j) => ids.has(j.id) || j.status === "working");
      s.jobs.forEach(setJob);
      showCredits();
      changed();
      poll();
    } catch (err) {
      console.warn("Couldn't check on AI creations", err);
    }
  }

  // Ask about unfinished jobs every few seconds until none are left. Each ask
  // also moves the job along on the server.
  function poll() {
    if (polling || !state.jobs.some((j) => j.status === "working")) return;
    polling = setTimeout(async () => {
      polling = null;
      for (const job of state.jobs.filter((j) => j.status === "working")) {
        try {
          setJob(await gen.poll(job.id));
        } catch (err) {
          if (err.status === 404) dropJob(job.id);
          else console.warn("Couldn't check on", job.name, err);
        }
      }
      changed();
      poll();
    }, POLL_MS);
  }

  // ---- The dialog ----
  const dialog = $("gen-dialog"), form = $("gen-form"), submit = $("gen-submit");
  const promptInput = $("gen-prompt"), nameInput = $("gen-name"), credits = $("gen-credits");
  const photoInput = $("gen-photo"), photoPreview = $("gen-photo-preview");
  const kindButtons = [...dialog.querySelectorAll("[data-kind]")];
  let kind = "text", photo = null; // photo: JPEG data URL

  function setKind(k) {
    kind = k;
    for (const b of kindButtons) b.setAttribute("aria-selected", String(b.dataset.kind === k));
    for (const p of dialog.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== k;
  }
  kindButtons.forEach((b) => b.addEventListener("click", () => setKind(b.dataset.kind)));

  // Demo site: the note goes under the title, the fields are greyed out and
  // the line above the buttons is hidden.
  const demoNote = $("gen-demo-note");
  function showCredits() {
    demoNote.textContent = GENERATE_OFF;
    demoNote.hidden = !state.demo;
    for (const el of [promptInput, nameInput, $("gen-photo-pick")]) el.disabled = state.demo;
    credits.hidden = state.demo;
    credits.classList.toggle("paused", state.paused);
    submit.disabled = state.paused || state.demo;
    if (state.paused) credits.textContent = "Creating is paused: credits have run out.";
    else if (state.remaining == null) credits.textContent = "Usually takes 3–5 minutes.";
    else credits.textContent = `Usually takes 3–5 minutes. About ${state.remaining} creation${state.remaining === 1 ? "" : "s"} left.`;
  }

  // back: show "Back", which returns to the Create new choices.
  function open({ prompt = "", back = false } = {}) {
    $("gen-back").hidden = !back;
    setKind("text");
    promptInput.value = prompt;
    nameInput.value = "";
    photo = null;
    photoPreview.hidden = true;
    submit.textContent = "Create";
    showCredits();
    dialog.showModal();
    promptInput.focus();
    refresh(true);
  }

  $("gen-photo-pick").addEventListener("click", () => { photoInput.value = ""; photoInput.click(); });
  photoInput.addEventListener("change", async () => {
    const f = photoInput.files[0];
    if (!f) return;
    try {
      photo = await shrinkPhoto(f);
      photoPreview.src = photo;
      photoPreview.hidden = false;
      if (!nameInput.value) nameInput.focus();
    } catch (err) {
      console.warn("Photo", err);
      ctx.toast("That photo couldn't be opened. Try a JPEG or PNG.");
    }
  });

  $("gen-cancel").addEventListener("click", () => dialog.close());
  $("gen-back").addEventListener("click", () => { dialog.close(); ctx.openCreateNew(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = promptInput.value.trim(), name = nameInput.value.trim();
    if (kind === "text" && !prompt) return promptInput.focus();
    if (kind === "image" && !photo) return ctx.toast("Choose a photo first.");
    if (kind === "image" && !name) return nameInput.focus();
    submit.disabled = true;
    submit.textContent = "Starting…";
    try {
      const job = await gen.start(kind === "text" ? { prompt } : { name, image: photo });
      mine.add(job.id);
      setJob(job);
      if (state.remaining > 0) state.remaining--;
      dialog.close();
      ctx.toast(`Creating “${job.name}”. It takes a few minutes; you can keep planning. It'll be at the top of My items → Generated.`);
      changed();
      ctx.showLibrary("ai");
      poll();
    } catch (err) {
      if (err.status === 402) state.paused = true;
      ctx.toast(err.status ? err.message : "Couldn't reach the server. Try again.");
    } finally {
      submit.textContent = "Create";
      showCredits();
    }
  });

  // ---- Finishing: size and name it in the import dialog ----
  async function review(job) {
    if (job.status !== "ready") return;
    ctx.toast(`Getting “${job.name}”…`);
    let buffer;
    try {
      buffer = await gen.model(job.id);
      if (buffer.byteLength > MAX_UPLOAD) buffer = await shrinkModel(buffer);
    } catch (err) {
      console.warn("AI model", err);
      return ctx.toast(err.status ? err.message : "Couldn't get the model. Try again.");
    }
    const ok = await ctx.openModelDialog(buffer, {
      name: job.name.replace(/^\w/, (c) => c.toUpperCase()),
      title: "Add to Library",
      ai: true,
      onSaved: async (key) => {
        try {
          await gen.finish(job.id, key.slice("imp:".length));
        } catch (err) {
          console.warn("Couldn't mark it as added", err); // it's in the Library either way
        }
        dropJob(job.id);
        changed();
      },
    });
    if (!ok) ctx.toast("The created model couldn't be opened.");
  }

  async function dismiss(job) {
    try {
      await gen.dismiss(job.id);
      dropJob(job.id);
      changed();
    } catch (err) {
      ctx.toast(err.status ? err.message : "Couldn't remove it. Try again.");
    }
  }

  Object.assign(ctx.generation, { open, review, dismiss, refresh });
  refresh(true);
}

// A photo as a JPEG data URL, at most PHOTO_PX on its longer side.
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, PHOTO_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; // transparent PNGs get a plain background
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.9);
}

// Re-save a model with its textures at most 1024 px, for the shared storage limit.
async function shrinkModel(buffer) {
  const scene = await parseGLB(buffer);
  return new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 1024 });
}
