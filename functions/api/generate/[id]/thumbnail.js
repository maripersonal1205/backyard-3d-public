import { json } from "../../../_middleware.js";

// The picture Astra rendered of an item created with AI (shown in the Library
// tab while it waits to be added).

export async function onRequestGet({ env, params }) {
  if (!/^[a-z0-9-]{1,40}$/.test(params.id)) return json({ error: "No such item." }, 404);
  const body = await env.FILES.get(`gen/${params.id}.png`, { type: "stream" });
  if (!body) return json({ error: "No picture." }, 404);
  return new Response(body, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
