// Local stand-in for Cloudflare Pages, for testing the shared ("cloud") mode
// on this Mac without deploying:
//   - every request goes through functions/_middleware.js (the passcode gate),
//     like on Pages; `next()` serves the static file or the /api route;
//   - D1 is played by node:sqlite and KV by a folder, both in .dev/;
//   - OpenAI is played by a pretend OpenAI at /__fake-openai (below), so creating
//     with AI can be tried without a key or credits.
//
// Usage: node tools/dev-server.mjs [port] [passcode]   (defaults: 8745, "family")
// Pretend OpenAI: FAKE_OPENAI_SECONDS per step (default 8), FAKE_OPENAI_ITEMS
// builds before credits "run out" (default 5). A description containing "fail"
// fails, "refuse" is turned down; results are the Library bench and its picture.
// Each browser profile keeps its own cookies, so use a private window (or
// clear cookies) to be a second, locked device. Never used in production.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleBuilder } from "./bundle-builder.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV = path.join(ROOT, ".dev");
const PORT = Number(process.argv[2]) || 8745;
const PASSCODE = process.argv[3] || "family";

// ---- D1 stand-in ----
await fs.mkdir(path.join(DEV, "kv"), { recursive: true });
const sqlite = new DatabaseSync(path.join(DEV, "dev.sqlite"));
function statement(sql, args = []) {
  return {
    bind: (...a) => statement(sql, a),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => {
      const r = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  };
}
const DB = {
  prepare: (sql) => statement(sql),
  batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
};

// ---- KV stand-in (only the calls the functions make) ----
const kvPath = (key) => path.join(DEV, "kv", key.replace(/[^a-zA-Z0-9._-]/g, "_"));
const KV_MAX = 25 * 1024 * 1024;
const FILES = {
  put: async (key, body) => {
    if (body.byteLength > KV_MAX) throw new Error("KV put failed: value too large");
    await fs.writeFile(kvPath(key), Buffer.from(body));
  },
  get: async (key, options) => {
    let data;
    try { data = await fs.readFile(kvPath(key)); } catch { return null; }
    const type = typeof options === "string" ? options : options?.type || "text";
    if (type === "stream") return new Blob([data]).stream();
    if (type === "arrayBuffer") return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return data.toString();
  },
  delete: async (key) => { await fs.rm(kvPath(key), { force: true }); },
};

const env = { DB, FILES, PASSCODE, OPEN_AI_KEY: "fake-key", OPENAI_API_BASE: `http://localhost:${PORT}/__fake-openai/v1` };
await bundleBuilder(); // functions/_astra.js hands the builder to Astra

// ---- Pretend OpenAI (only the calls functions/_astra.js makes) ----
// It checks the requests are shaped right and hands back the Library bench.
const fake = { seconds: Number(process.env.FAKE_OPENAI_SECONDS ?? 8), builds: Number(process.env.FAKE_OPENAI_ITEMS ?? 5), containers: new Map(), responses: new Map() };
const fakeJSON = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fakeError = (status, message, code = "invalid_request_error") => fakeJSON({ error: { message, code } }, status);
const fakeId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
async function fakeOpenAI(request, pathname) {
  if (request.headers.get("authorization") !== "Bearer fake-key") return fakeError(401, "Incorrect API key provided.");
  const parts = pathname.slice("/__fake-openai/v1/".length).split("/");
  const method = request.method;
  if (parts[0] === "containers") {
    if (method === "POST" && parts.length === 1) {
      const body = await request.json();
      if (!body.name || body.expires_after?.anchor !== "last_active_at") return fakeError(400, "Bad container request");
      const id = fakeId("cntr");
      fake.containers.set(id, []);
      return fakeJSON({ id, object: "container" });
    }
    const files = fake.containers.get(parts[1]);
    if (!files) return fakeError(404, "Container not found or expired.");
    if (method === "DELETE" && parts.length === 2) { fake.containers.delete(parts[1]); return fakeJSON({ deleted: true }); }
    if (method === "POST" && parts[2] === "files") {
      const file = (await request.formData()).get("file");
      const entry = { id: fakeId("cfile"), path: `/mnt/data/${file.name}`, bytes: file.size, source: "user", data: Buffer.from(await file.arrayBuffer()) };
      files.push(entry);
      return fakeJSON({ id: entry.id, path: entry.path, bytes: entry.bytes });
    }
    if (method === "GET" && parts[2] === "files" && parts.length === 3) return fakeJSON({ data: files.map(({ data, ...f }) => f) });
    if (method === "GET" && parts[4] === "content") {
      const f = files.find((x) => x.id === parts[3]);
      return f ? new Response(f.data) : fakeError(404, "File not found");
    }
  }
  if (parts[0] === "responses") {
    if (method === "POST" && parts.length === 1) {
      const body = await request.json();
      const env0 = body.tools?.[0]?.environment;
      if (body.model !== "gpt-6-astra" || !body.background || body.tools?.[0]?.type !== "shell" || env0?.type !== "container_reference") return fakeError(400, "Bad response request");
      if (body.text?.format?.type !== "json_schema") return fakeError(400, "Missing JSON schema");
      const files = fake.containers.get(env0.container_id);
      if (!files) return fakeError(404, "Container not found or expired.");
      if (!files.some((f) => f.path.endsWith("/build_library.py")) || !files.some((f) => f.path.endsWith("/BUILDER.md"))) return fakeError(400, "The builder wasn't uploaded");
      const review = !!body.previous_response_id;
      const content = body.input?.[0]?.content || [];
      if (review && !content.some((c) => c.type === "input_image" && c.image_url.startsWith("data:image/png;base64,"))) return fakeError(400, "Review needs the thumbnail");
      if (!review && fake.builds-- <= 0) return fakeError(429, "You exceeded your current quota, please check your plan and billing details.", "insufficient_quota");
      const text = content.find((c) => c.type === "input_text")?.text || "";
      const photo = content.some((c) => c.type === "input_image");
      const prev = review ? fake.responses.get(body.previous_response_id) : null;
      const id = fakeId("resp");
      fake.responses.set(id, { start: Date.now(), container: env0.container_id, text: prev?.text || text, photo: prev?.photo || photo, review });
      return fakeJSON({ id, status: "queued" });
    }
    const r = fake.responses.get(parts[1]);
    if (!r) return fakeError(404, "Response not found");
    if (method === "POST" && parts[2] === "cancel") { r.cancelled = true; return fakeJSON({ id: parts[1], status: "cancelled" }); }
    if (r.cancelled) return fakeJSON({ id: parts[1], status: "cancelled" });
    if (Date.now() - r.start < fake.seconds * 1000) return fakeJSON({ id: parts[1], status: "in_progress" });
    if (/fail/i.test(r.text)) return fakeJSON({ id: parts[1], status: "failed", error: { code: "server_error", message: "The model had a problem." } });
    const usage = { input_tokens: 40000, input_tokens_details: { cached_tokens: 20000 }, output_tokens: r.review ? 3000 : 12000 };
    const refuse = /refuse/i.test(r.text);
    const itemId = r.photo ? "photo-item" : (r.text.replace(/^Create this item:\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "item");
    const files = fake.containers.get(r.container);
    if (!refuse && files && !files.some((f) => f.path.endsWith(`/out/models/${itemId}.glb`))) {
      for (const [dir, file] of [["models", "teak-bench.glb"], ["thumbs", "teak-bench.png"]]) {
        const data = await fs.readFile(path.join(ROOT, "library", dir, file));
        files.push({ id: fakeId("cfile"), path: `/mnt/data/library/out/${dir}/${itemId}.${file.split(".").pop()}`, bytes: data.length, source: "assistant", data });
      }
    }
    const answer = refuse
      ? { ok: false, id: "", label: "", category: "", tags: [], message: "That isn't something that belongs in a backyard." }
      : { ok: true, id: itemId, label: itemId.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()), category: "Seating", tags: ["test"], message: "Built and checked." };
    return fakeJSON({ id: parts[1], status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] });
  }
  return fakeError(404, "Unknown fake endpoint");
}

// ---- Pages Functions routing (mirrors the files in functions/api) ----
const ROUTES = [
  [/^\/api\/plans$/, "api/plans/index.js"],
  [/^\/api\/plans\/(?<id>[^/]+)$/, "api/plans/[id].js"],
  [/^\/api\/imports$/, "api/imports/index.js"],
  [/^\/api\/imports\/(?<id>[^/]+)$/, "api/imports/[id].js"],
  [/^\/api\/imports\/(?<id>[^/]+)\/model$/, "api/imports/[id]/model.js"],
  [/^\/api\/generate$/, "api/generate/index.js"],
  [/^\/api\/generate\/(?<id>[^/]+)$/, "api/generate/[id].js"],
  [/^\/api\/generate\/(?<id>[^/]+)\/model$/, "api/generate/[id]/model.js"],
  [/^\/api\/generate\/(?<id>[^/]+)\/thumbnail$/, "api/generate/[id]/thumbnail.js"],
];
const load = (file) => import(pathToFileURL(path.join(ROOT, "functions", file)).href);

// ---- Static files (what Pages would serve from .deploy/) ----
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8",
};
async function staticFile(pathname) {
  if (pathname === "/") return new Response(null, { status: 302, headers: { location: "/viewer.html" } });
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}.`)) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(file);
    return new Response(data, { headers: { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function handle(request) {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/__fake-openai/")) return fakeOpenAI(request, pathname);
  const route = ROUTES.map(([re, file]) => [re.exec(pathname), file]).find(([m]) => m);
  const context = {
    request, env, data: {}, params: route?.[0].groups || {}, waitUntil: () => {},
    next: async () => {
      if (!pathname.startsWith("/api/")) return staticFile(pathname);
      if (!route) return new Response("Not found", { status: 404 });
      const mod = await load(route[1]);
      const method = request.method[0] + request.method.slice(1).toLowerCase();
      const handler = mod[`onRequest${method}`] || mod.onRequest;
      return handler ? handler(context) : new Response("Method not allowed", { status: 405 });
    },
  };
  return (await load("_middleware.js")).onRequest(context);
}

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === "string"));
    headers.set("cf-connecting-ip", req.socket.remoteAddress || "127.0.0.1");
    const request = new Request(new URL(req.url, `http://localhost:${PORT}`), {
      method: req.method, headers, redirect: "manual",
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request);
    const out = {};
    response.headers.forEach((v, k) => { out[k] = k === "set-cookie" ? response.headers.getSetCookie() : v; });
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("Dev server error");
  }
}).listen(PORT, () => console.log(`Shared-mode dev server: http://localhost:${PORT}/ (passcode "${PASSCODE}")`));
