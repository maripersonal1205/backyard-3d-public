// Creating Library items with GPT-6 Astra through the OpenAI API, for
// functions/api/generate/*. Astra made the pre-made Library items in Codex with
// library/build_library.py, so it builds new ones with the same builder, in a
// container OpenAI hosts, and they match the rest of the Library.
//
// One job, driven by the browsers polling api/generate/[id]:
//   1. create a container and put the builder in it
//   2. "build": a background response in which Astra writes a generator for
//      the item, builds it with the builder and fixes it until its checks pass
//   3. "review": Astra is shown the thumbnail it rendered and fixes what looks
//      wrong (it can't look at images from inside the container)
//   4. the model and thumbnail are copied into our storage (KV) straight away,
//      since the container is deleted soon after it goes idle
//
// OPEN_AI_KEY is a secret on the Pages project, set by Mari (prepaid credits,
// auto-recharge off, so it can't spend more than she loaded). OPENAI_API_BASE
// only exists for the local dev server's pretend OpenAI.
import BUILDER from "./_builder_files.js";

const API = "https://api.openai.com/v1";
const MODEL = "gpt-6-astra";

// Astra's standard prices per million tokens (checked 2026-09-30), to show
// roughly what each item cost. Containers may cost a little on top.
const PRICE = { input: 10, cached: 1, output: 50 };

export const PAUSED = "Creating is paused: credits have run out.";
export const KEEP_MS = 7 * 24 * 3600_000; // jobs nobody added or dismissed are dropped after a week
export const MAX_MS = 45 * 60_000; // give up on a response that runs longer
export const EXPECTED_MS = { build: 2 * 60_000, review: 60_000 }; // for the progress bar (first real item: 2 min + 1 min)

export class OpenAIError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
  get outOfCredits() { return this.code === "insufficient_quota"; }
}

const OUT = "/mnt/data/library/out";

const INSTRUCTIONS = `You create one item for the Library of a family's backyard planner, a Three.js app that shows a 3D model of their yard in Northern California.

All existing Library items were made with the builder /mnt/data/build_library.py (read /mnt/data/BUILDER.md first). New items must be made with the same builder and toolkit so they look like they belong together:
1. Set up: mkdir -p /mnt/data/library && cp /mnt/data/build_library.py /mnt/data/library/ && cd /mnt/data/library
2. Read the builder: the Mesh/Model classes, the helpers (beveled_box, rounded_box, tube, leaf, card, stone, fruit...), the texture functions, and the existing generators (bench, chair, coffee_table, fire_pit, tree, lavender, lemongrass) as the reference for style, detail and realism.
3. Add one new generator function and one ITEMS entry for the requested item: a new lowercase-hyphenated id, a short label, a category from CATEGORIES, 3-6 tags, real-world dimensions in metres (X width, Y height, Z depth) and a triangle budget (furniture and objects at most 50000, plants at most 100000). Reuse the existing helpers and texture functions; add new procedural textures only if nothing fits.
4. Conventions (the builder's checks enforce most of them): metres; Y up; the item stands on the ground (lowest point y = 0) centred on x/z; its FRONT faces +Z (like the bench, whose back is at -Z); free-standing, not mounted on a wall; realistic proportions and sizes for a real product; keep the GLB under 8 MB.
5. Build it: python3 build_library.py --item <id> --output-dir out
   Fix and rebuild until it reports PASS. The files end up in ${OUT}/models/<id>.glb and ${OUT}/thumbs/<id>.png.
6. Never change or rebuild the existing items. Don't install anything unless Pillow or NumPy are missing (then pip install them).

If the request is not a physical object that could be in a backyard or garden, or it can't be built well with this toolkit, don't build anything: answer ok=false with a short, friendly reason in message.
Finish with the JSON answer: ok, id, label, category, tags, and message (one short sentence about the result, or the reason it failed).`;

const REVIEW = `This is the thumbnail your build rendered (camera in front of the item, 35° to its right, 20° above; the item's front faces +Z). Compare it with the request (and the photo, if there was one).
If it clearly doesn't look like the requested item, parts float or poke through each other, proportions are off, it faces the wrong way, or it looks much less detailed than the existing Library items, fix the generator and rebuild with the same id until it passes again. If it looks right, change nothing.
Answer with the same JSON as before.`;

const RESULT_FORMAT = {
  type: "json_schema",
  name: "library_item",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ok", "id", "label", "category", "tags", "message"],
    properties: {
      ok: { type: "boolean" },
      id: { type: "string" },
      label: { type: "string" },
      category: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      message: { type: "string" },
    },
  },
};

export function astra(env) {
  const base = env.OPENAI_API_BASE || API;
  async function call(method, path, body) {
    const init = { method, headers: { authorization: `Bearer ${env.OPEN_AI_KEY}` } };
    if (body instanceof FormData) init.body = body;
    else if (body) { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; }
    const res = await fetch(`${base}/${path}`, init);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new OpenAIError(res.status, data.error?.message || `OpenAI answered ${res.status}`, data.error?.code);
    }
    return res;
  }
  const callJSON = async (...args) => (await call(...args)).json();
  const tools = (container) => [{ type: "shell", environment: { type: "container_reference", container_id: container } }];

  return {
    // A fresh container with the builder in it.
    async container() {
      const { id } = await callJSON("POST", "containers", {
        name: "backyard-item", memory_limit: "4g", expires_after: { anchor: "last_active_at", minutes: 20 },
      });
      for (const [name, text] of Object.entries(BUILDER)) {
        const form = new FormData();
        form.append("file", new Blob([text], { type: "text/plain" }), name);
        await call("POST", `containers/${id}/files`, form);
      }
      return id;
    },

    // Step 2: build from a description and/or a photo (a data: URL).
    async build(container, { prompt, image }) {
      const content = [{
        type: "input_text",
        text: image
          ? `Create this item from the photo${prompt ? `: ${prompt}` : ""}. Match its shape, proportions, materials and colours.`
          : `Create this item: ${prompt}`,
      }];
      if (image) content.push({ type: "input_image", image_url: image });
      const r = await callJSON("POST", "responses", {
        model: MODEL, background: true, instructions: INSTRUCTIONS, tools: tools(container),
        input: [{ role: "user", content }], text: { format: RESULT_FORMAT },
      });
      return r.id;
    },

    // Step 3: show Astra its thumbnail (a PNG) and let it fix what looks wrong.
    async review(container, previousId, png) {
      const r = await callJSON("POST", "responses", {
        model: MODEL, background: true, instructions: INSTRUCTIONS, tools: tools(container), previous_response_id: previousId,
        input: [{ role: "user", content: [
          { type: "input_text", text: REVIEW },
          { type: "input_image", image_url: `data:image/png;base64,${base64(png)}` },
        ] }],
        text: { format: RESULT_FORMAT },
      });
      return r.id;
    },

    response: (id) => callJSON("GET", `responses/${id}`),
    cancel: (id) => call("POST", `responses/${id}/cancel`).catch(() => {}),
    deleteContainer: (id) => call("DELETE", `containers/${id}`).catch(() => {}),

    // The built model and thumbnail for an item id, as ArrayBuffers.
    async files(container, itemId) {
      const { data } = await callJSON("GET", `containers/${container}/files?limit=100`);
      const find = (suffix) => data.find((f) => f.path?.endsWith(suffix));
      const glb = find(`/out/models/${itemId}.glb`), png = find(`/out/thumbs/${itemId}.png`);
      if (!glb || !png) throw new OpenAIError(404, "The built files weren't found.");
      const get = async (f) => (await call("GET", `containers/${container}/files/${f.id}/content`)).arrayBuffer();
      return { glb: await get(glb), png: await get(png) };
    },
  };
}

// The JSON answer of a finished response, or null.
export function result(response) {
  for (const item of [...(response.output || [])].reverse()) {
    if (item.type !== "message") continue;
    const text = item.content?.find((c) => c.type === "output_text")?.text;
    try { return JSON.parse(text); } catch { return null; }
  }
  return null;
}

// Roughly what a response cost, in US cents.
export function cents(usage) {
  if (!usage) return 0;
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const dollars = ((usage.input_tokens - cached) * PRICE.input + cached * PRICE.cached + usage.output_tokens * PRICE.output) / 1e6;
  return Math.round(dollars * 100 * 10) / 10;
}

function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function jobJSON(r) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    status: r.status,
    progress: r.progress,
    error: r.error || null,
    thumbnail: r.status === "ready" ? `api/generate/${r.id}/thumbnail` : null,
    costCents: r.cost_cents || 0,
    createdAt: r.created_at,
  };
}
