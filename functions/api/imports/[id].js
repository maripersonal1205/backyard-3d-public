import { json } from "../../_middleware.js";

// Delete an imported model. Anyone with the passcode can (it's a family app); the app
// first checks that no plan still uses it.

export async function onRequestDelete({ env, params }) {
  const row = await env.DB.prepare("SELECT 1 FROM imports WHERE id = ?").bind(params.id).first();
  if (!row) return json({ error: "No such model." }, 404);
  await env.FILES.delete(`imports/${params.id}.glb`);
  await env.DB.prepare("DELETE FROM imports WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
