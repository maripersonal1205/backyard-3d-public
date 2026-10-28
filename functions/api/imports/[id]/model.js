import { json } from "../../../_middleware.js";

// The model file of an imported model. Ids are never reused, so the browser
// may keep it as long as it likes.

export async function onRequestGet({ env, params }) {
  if (!/^[a-z0-9-]{1,40}$/.test(params.id)) return json({ error: "No such model." }, 404);
  const body = await env.FILES.get(`imports/${params.id}.glb`, { type: "stream" });
  if (!body) return json({ error: "No such model." }, 404);
  return new Response(body, {
    headers: {
      "content-type": "model/gltf-binary",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
