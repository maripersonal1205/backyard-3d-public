import { json } from "../../_middleware.js";
import { astra, OpenAIError, PAUSED, KEEP_MS, jobJSON } from "../../_astra.js";

// Creating Library items with AI (GPT-6 Astra, see functions/_astra.js), shared
// by the whole family:
//   GET   whether it's set up, and everyone's jobs not yet added or dismissed
//   POST  { prompt } or { name, image: data URL[, prompt] } starts a new one
// Astra works for several minutes; api/generate/[id] moves a job along each
// time a browser asks about it.

const MAX_WORKING = 3; // at once, for the whole family
const MAX_IMAGE = 8_000_000; // characters of the photo's data URL (the app sends ~1024 px JPEGs)

export async function onRequestGet({ env }) {
  if (!env.OPEN_AI_KEY) return json({ enabled: false, jobs: [] });
  const { results } = await env.DB.prepare(
    `SELECT * FROM generations WHERE status != 'done' AND created_at > ? ORDER BY created_at`
  ).bind(Date.now() - KEEP_MS).all();
  // OpenAI doesn't tell an API key its balance, so "creations left" is unknown;
  // running out shows up as an error when starting one.
  return json({ enabled: true, remaining: null, paused: false, jobs: results.map(jobJSON) });
}

export async function onRequestPost({ request, env }) {
  if (!env.OPEN_AI_KEY) return json({ error: "Creating with AI isn't set up yet." }, 503);
  const body = await request.json().catch(() => null);
  const prompt = String(body?.prompt || "").trim();
  const image = typeof body?.image === "string" ? body.image : "";
  const name = String(body?.name || "").trim().slice(0, 60) || prompt.slice(0, 40).trim();
  if (image) {
    if (!/^data:image\/(png|jpeg);base64,/.test(image) || image.length > MAX_IMAGE) return json({ error: "That photo can't be used. Try a JPEG or PNG." }, 400);
  } else if (!prompt) {
    return json({ error: "Describe what to create." }, 400);
  }
  if (prompt.length > 800) return json({ error: "Keep the description under 800 characters." }, 400);
  if (!name) return json({ error: "Give it a name." }, 400);

  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM generations WHERE status = 'working'").first();
  if (n >= MAX_WORKING) return json({ error: `${MAX_WORKING} items are already being created. Try again when one is done.` }, 429);

  const ai = astra(env);
  let container = null, response;
  try {
    container = await ai.container();
    response = await ai.build(container, { prompt, image });
  } catch (err) {
    console.error("OpenAI start", err);
    if (container) await ai.deleteContainer(container);
    if (err instanceof OpenAIError && err.outOfCredits) return json({ error: PAUSED, paused: true }, 402);
    if (err instanceof OpenAIError && err.status === 400) return json({ error: `OpenAI couldn't use that: ${err.message}` }, 400);
    return json({ error: "Couldn't reach OpenAI. Try again in a minute." }, 502);
  }

  const now = Date.now();
  const row = {
    id: crypto.randomUUID().slice(0, 8), name, prompt: prompt || null,
    kind: image ? "image" : "text", container, response, stage: "build", status: "working", progress: 0,
    created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO generations (id, name, prompt, kind, container, response, stage, stage_at, status, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(row.id, name, row.prompt, row.kind, container, response, "build", now, "working", 0, now, now).run();
  return json({ job: jobJSON(row) }, 201);
}
