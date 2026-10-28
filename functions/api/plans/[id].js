import { json } from "../../_middleware.js";

// Change or delete one plan. Anyone with the passcode can change any plan.

const MAX_LAYOUT = 500_000;

const exists = async (env, id) => !!(await env.DB.prepare("SELECT 1 FROM plans WHERE id = ?").bind(id).first());

export async function onRequestPut({ request, env, params }) {
  if (!(await exists(env, params.id))) return json({ error: "No such plan." }, 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Expected JSON." }, 400);
  const sets = [], args = [];
  if ("name" in body) {
    const name = String(body.name || "").trim().slice(0, 60);
    if (!name) return json({ error: "A plan needs a name." }, 400);
    sets.push("name = ?"); args.push(name);
  }
  if ("layout" in body) {
    const layout = JSON.stringify(body.layout);
    if (!Array.isArray(body.layout?.items) || layout.length > MAX_LAYOUT) return json({ error: "Bad layout." }, 400);
    sets.push("layout = ?"); args.push(layout);
  }
  if (!sets.length) return json({ ok: true });
  const now = Date.now();
  await env.DB.prepare(`UPDATE plans SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...args, now, params.id).run();
  return json({ ok: true, updatedAt: now });
}

export async function onRequestDelete({ env, params }) {
  if (!(await exists(env, params.id))) return json({ error: "No such plan." }, 404);
  await env.DB.prepare("DELETE FROM plans WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
