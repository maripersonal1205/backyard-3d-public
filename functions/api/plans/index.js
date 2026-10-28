import { json } from "../../_middleware.js";

// All plans (anyone with the passcode can open and change any of them, see
// [id].js), and creating a new one. (The owner column is left over from when
// each device picked a name; it's no longer filled in.)

const MAX_LAYOUT = 500_000; // characters of layout JSON; a real layout is a few KB
const PLAN_ID =/^plan-[a-z0-9-]{1,40}$/;

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, layout, updated_at FROM plans ORDER BY created_at"
  ).all();
  return json({
    plans: results.map((r) => ({
      id: r.id,
      name: r.name,
      layout: JSON.parse(r.layout),
      updatedAt: r.updated_at,
    })),
  });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const id = String(body?.id || "");
  const name = String(body?.name || "").trim().slice(0, 60);
  const layout = JSON.stringify(body?.layout ?? null);
  if (!PLAN_ID.test(id)) return json({ error: "Bad plan id." }, 400);
  if (!name) return json({ error: "A plan needs a name." }, 400);
  if (!body?.layout || !Array.isArray(body.layout.items) || layout.length > MAX_LAYOUT) {
    return json({ error: "Bad layout." }, 400);
  }
  const now = Date.now();
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO plans (id, name, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, name, layout, now, now).run();
  if (!res.meta.changes) return json({ error: "That plan id is taken." }, 409);
  return json({ ok: true, id, updatedAt: now }, 201);
}
