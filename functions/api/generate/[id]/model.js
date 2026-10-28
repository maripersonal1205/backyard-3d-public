import { json } from "../../../_middleware.js";

// The finished model of an item created with AI, kept in KV until someone adds
// it to the Library (the browser sizes it and saves it through api/imports).

export async function onRequestGet({ env, params }) {
  if (!/^[a-z0-9-]{1,40}$/.test(params.id)) return json({ error: "No such item." }, 404);
  const body = await env.FILES.get(`gen/${params.id}.glb`, { type: "stream" });
  if (!body) return json({ error: "This model is no longer available." }, 404);
  return new Response(body, { headers: { "content-type": "model/gltf-binary", "cache-control": "no-store" } });
}
