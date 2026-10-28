import { json } from "../../_middleware.js";

// Imported models, shared with everyone: the list, and uploading a new one.
// The model file goes to KV (FILES) at imports/<id>.glb; its name, scale and
// picture go to D1. KV's free plan needs no card: 25 MiB per file, 1 GB in
// all and 1,000 writes a day, and a write past those limits fails (no charge).

const MAX_BYTES = 25 * 1024 * 1024; // KV's per-value limit
const MAX_THUMB = 200_000; // characters of the data: URL picture

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.label, i.scale, i.thumbnail, i.created_at,
            EXISTS (SELECT 1 FROM generations g WHERE g.import_id = i.id) AS ai
       FROM imports i ORDER BY i.created_at`
  ).all();
  return json({
    imports: results.map((r) => ({
      id: r.id,
      label: r.label,
      scale: r.scale,
      thumbnail: r.thumbnail,
      ai: !!r.ai, // created with AI (api/generate)
    })),
  });
}

// multipart/form-data: file (the .glb), label, scale, thumbnail (data: URL)
export async function onRequestPost({ request, env }) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const label = String(form?.get("label") || "").trim().slice(0, 60);
  const scale = Number(form?.get("scale"));
  const thumbnail = String(form?.get("thumbnail") || "");
  if (!file || typeof file === "string") return json({ error: "No model file." }, 400);
  if (!label) return json({ error: "A model needs a name." }, 400);
  if (!(scale > 0 && scale < 1e4)) return json({ error: "Bad scale." }, 400);
  if (thumbnail.length > MAX_THUMB || (thumbnail && !thumbnail.startsWith("data:image/"))) {
    return json({ error: "Bad picture." }, 400);
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return json({ error: "That file is too big (25 MB max)." }, 413);
  if (new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) !== "glTF") return json({ error: "That isn't a .glb file." }, 400);

  const id = crypto.randomUUID().slice(0, 8);
  try {
    await env.FILES.put(`imports/${id}.glb`, bytes);
  } catch (err) {
    console.error("KV put failed", err);
    return json({ error: "The shared storage is full or has reached today's upload limit. Try again tomorrow." }, 507);
  }
  await env.DB.prepare(
    "INSERT INTO imports (id, label, scale, thumbnail, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, label, scale, thumbnail || null, Date.now()).run();
  return json({ ok: true, id }, 201);
}
