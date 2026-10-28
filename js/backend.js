import * as storage from "./storage.js";
import * as blobstore from "./blobstore.js";
import { DEMO } from "./app-mode.js";
import { AI_EXAMPLES } from "./config.js";

// Where plans, settings and imported models are kept.
//   "cloud": the shared app on Cloudflare (functions/*), when /api/plans answers
//            (the page is only reachable after the passcode). Plans and models
//            are shared; which plan is open and the time of day are per device.
//   "local": this browser only (localStorage + IndexedDB), e.g. when served by
//            `python3 -m http.server`, which has no /api (404).
//   "demo":  the public demo site (js/app-mode.js). Nothing is kept: plans and
//            imported models last until the page closes, and no server is asked.
// All expose the same calls, so plans.js and library.js don't care which.
export async function createBackend() {
  if (DEMO) return demoBackend();
  try {
    const res = await fetch("api/plans", { headers: { accept: "application/json" } });
    if (res.status === 404) return localBackend();
    if (res.ok && res.headers.get("content-type")?.includes("application/json")) return cloudBackend((await res.json()).plans);
    throw new Error(`api/plans answered ${res.status}`);
  } catch (err) {
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return localBackend();
    throw err; // on the real site, don't quietly fall back to an empty browser-only app
  }
}

// ---- This browser only ----
function localBackend() {
  let snapshot = () => null; // plans.js supplies { plans, currentId, time }
  const save = () => { const s = snapshot(); if (s) storage.save(s); };
  return {
    mode: "local",
    onStatus: () => {},
    bindSnapshot: (fn) => { snapshot = fn; },
    async load() {
      const s = storage.load();
      return { plans: s?.plans || [], currentId: s?.currentId, time: s?.time };
    },
    createPlan: save, savePlan: save, deletePlan: save, saveSettings: save,
    imports: {
      async list() { return (await blobstore.allImports()).map((r) => ({ ...r, canDelete: true })); },
      async add({ label, data, scale, thumbnail }) {
        const record = { id: crypto.randomUUID().slice(0, 8), label, data, scale, thumbnail, added: Date.now() };
        await blobstore.putImport(record);
        return { ...record, canDelete: true };
      },
      remove: (id) => blobstore.deleteImport(id),
    },
    generate: null, // creating with AI needs the shared app (the AI service's key lives on the server)
  };
}

// ---- The demo site: nothing saved, nothing sent ----
function demoBackend() {
  const imports = new Map(); // id -> record, for this visit only
  const examples = AI_EXAMPLES.map((e) => ({ ...e, ai: true, canDelete: false }));
  return {
    mode: "demo",
    onStatus: () => {},
    bindSnapshot: () => {},
    load: async () => ({ plans: [] }),
    createPlan: () => {}, savePlan: () => {}, deletePlan: () => {}, saveSettings: () => {},
    imports: {
      list: async () => examples,
      async add({ label, data, scale, thumbnail }) {
        const record = { id: crypto.randomUUID().slice(0, 8), label, data, scale, thumbnail, canDelete: true };
        imports.set(record.id, record);
        return record;
      },
      remove: async (id) => { imports.delete(id); },
    },
    // Generate is shown so visitors see the idea, but it's turned off: the
    // dialog says so and its button is greyed out. Nothing is ever sent.
    generate: {
      status: async () => ({ enabled: true, demo: true, remaining: null, paused: false, jobs: [] }),
      start: async () => { throw Object.assign(new Error(GENERATE_OFF), { status: 403 }); },
      poll: async () => { throw Object.assign(new Error("Not found"), { status: 404 }); },
      model: async () => { throw Object.assign(new Error(GENERATE_OFF), { status: 403 }); },
      finish: async () => {},
      dismiss: async () => {},
    },
  };
}
export const GENERATE_OFF = "This feature is turned off for the demo site.";

// ---- The shared app on Cloudflare ----
function cloudBackend(plans) {
  async function api(method, path, body) {
    const init = { method, headers: { accept: "application/json" } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; }
    const res = await fetch("api/" + path, init);
    const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
    if (!res.ok) throw Object.assign(new Error(data?.error || `Server answered ${res.status}`), { status: res.status });
    return data;
  }

  // Save queue: changes are sent in order, a moment after the last edit
  // (repeated edits to the same thing collapse into one request), and retried
  // if the connection drops. Status: "saving" | "saved" | "retrying" | "failed".
  const queue = new Map(); // key -> () => Promise   (Map keeps first-insertion order)
  let timer = null, running = false, retryDelay = 0;
  const listeners = new Set();
  const status = (s, message) => listeners.forEach((fn) => fn(s, message));

  function enqueue(key, task, delay = 700) {
    queue.set(key, task);
    status("saving");
    clearTimeout(timer);
    timer = setTimeout(drain, delay);
  }
  async function drain() {
    if (running) return;
    running = true;
    while (queue.size) {
      const [key, task] = queue.entries().next().value;
      try {
        await task();
        if (queue.get(key) === task) queue.delete(key);
        retryDelay = 0;
      } catch (err) {
        if (err.status && err.status < 500) { // won't succeed by retrying (e.g. not allowed)
          if (queue.get(key) === task) queue.delete(key);
          status("failed", err.message);
          continue;
        }
        retryDelay = Math.min(30_000, (retryDelay || 1500) * 2);
        status("retrying");
        running = false;
        timer = setTimeout(drain, retryDelay);
        return;
      }
    }
    running = false;
    status("saved");
  }
  // Leaving the page: send whatever is still waiting.
  addEventListener("pagehide", () => {
    for (const task of queue.values()) task.keepalive?.();
  });
  const put = (path, body) => {
    const task = () => api("PUT", path, body);
    task.keepalive = () => fetch("api/" + path, {
      method: "PUT", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return task;
  };

  // Creating a plan; if it already exists (an earlier attempt got through), update it instead.
  const create = (plan) => Object.assign(async () => {
    const body = { id: plan.id, name: plan.name, layout: plan.layout };
    try {
      await api("POST", "plans", body);
    } catch (err) {
      if (err.status !== 409) throw err;
      await api("PUT", "plans/" + plan.id, { name: body.name, layout: body.layout });
    }
  }, { creating: true });

  return {
    mode: "cloud",
    onStatus: (fn) => listeners.add(fn),
    bindSnapshot: () => {},
    async load() {
      const device = storage.loadDevice();
      return { plans, currentId: device?.currentId, time: device?.time };
    },
    createPlan: (plan) => enqueue("plan:" + plan.id, create(plan), 0),
    savePlan(plan) {
      const key = "plan:" + plan.id;
      // Not created on the server yet: fold this change into the create request.
      enqueue(key, queue.get(key)?.creating ? create(plan) : put("plans/" + plan.id, { name: plan.name, layout: plan.layout }));
    },
    deletePlan(id) {
      queue.delete("plan:" + id);
      enqueue("delete:" + id, () => api("DELETE", "plans/" + id), 0);
    },
    saveSettings: ({ currentId, time }) => storage.saveDevice({ currentId, time }),
    imports: {
      async list() {
        const { imports } = await api("GET", "imports");
        return imports.map((r) => ({ ...r, url: `api/imports/${r.id}/model` }));
      },
      async add({ label, data, scale, thumbnail }) {
        const form = new FormData();
        form.append("file", new Blob([data], { type: "model/gltf-binary" }), "model.glb");
        form.append("label", label);
        form.append("scale", String(scale));
        if (thumbnail) form.append("thumbnail", thumbnail);
        const { id } = await api("POST", "imports", form);
        return { id, label, scale, thumbnail, canDelete: true, url: `api/imports/${id}/model` };
      },
      remove: (id) => api("DELETE", "imports/" + id),
    },
    // Creating Library items with AI (functions/api/generate)
    generate: {
      status: () => api("GET", "generate"), // { enabled, remaining, paused, jobs }
      start: async (body) => (await api("POST", "generate", body)).job, // { name, prompt } or { name, image }
      poll: async (id) => (await api("GET", "generate/" + id)).job,
      async model(id) {
        const res = await fetch(`api/generate/${id}/model`);
        if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => null))?.error || `Server answered ${res.status}`), { status: res.status });
        return res.arrayBuffer();
      },
      finish: (id, importId) => api("PUT", "generate/" + id, { importId }),
      dismiss: (id) => api("DELETE", "generate/" + id),
    },
  };
}
