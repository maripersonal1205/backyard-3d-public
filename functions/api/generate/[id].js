import { json } from "../../_middleware.js";
import { astra, result, cents, jobJSON, PAUSED, MAX_MS, EXPECTED_MS } from "../../_astra.js";

// One item being created with AI:
//   GET     its state; while it's being made, also asks OpenAI how it's going
//           and moves it on (build → review → ready, see functions/_astra.js)
//   PUT     { importId } once it has been added to the Library
//   DELETE  dismiss a failed one, or discard a finished one nobody wants

const load = (env, id) => env.DB.prepare("SELECT * FROM generations WHERE id = ?").bind(id).first();

export async function onRequestGet({ env, params }) {
  let row = await load(env, params.id);
  if (!row) return json({ error: "No such item." }, 404);
  if (row.status === "working" && row.response && env.OPEN_AI_KEY) {
    await advance(env, row);
    row = await load(env, params.id);
  } else if (row.status === "working" && !row.response && Date.now() - row.updated_at > 5 * 60_000) {
    // A browser claimed a finished step (see advance) and then never saved what came next.
    await env.DB.prepare("UPDATE generations SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .bind("Something went wrong while finishing it. Try again.", Date.now(), row.id).run();
    row = await load(env, params.id);
  }
  return json({ job: jobJSON(row) });
}

async function advance(env, row) {
  const ai = astra(env);
  const set = (fields) => {
    const keys = Object.keys(fields);
    return env.DB.prepare(`UPDATE generations SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => fields[k]), Date.now(), row.id).run();
  };
  let r;
  try {
    r = await ai.response(row.response);
  } catch (err) {
    console.error("OpenAI response", err); // try again on the next poll
    return;
  }

  if (r.status === "queued" || r.status === "in_progress") {
    const elapsed = Date.now() - row.stage_at;
    if (elapsed > MAX_MS) {
      await ai.cancel(row.response);
      await ai.deleteContainer(row.container);
      return set({ status: "failed", error: "It took too long. Try again, perhaps with a simpler description." });
    }
    // OpenAI doesn't report progress, so estimate it from the time taken.
    const [from, to] = row.stage === "build" ? [0, 75] : [75, 97];
    const progress = Math.round(from + (to - from) * (1 - Math.exp(-elapsed / EXPECTED_MS[row.stage])));
    return set({ progress: Math.max(progress, row.progress) });
  }

  // The response has finished. Several browsers may be asking at once: only
  // the one that claims it goes on, so nothing is paid for or counted twice.
  const claim = await env.DB.prepare("UPDATE generations SET response = NULL, updated_at = ? WHERE id = ? AND response = ?")
    .bind(Date.now(), row.id, row.response).run();
  if (claim.meta.changes !== 1) return;
  const cost = (row.cost_cents || 0) + cents(r.usage);
  const store = async (files) => {
    await env.FILES.put(`gen/${row.id}.glb`, files.glb);
    await env.FILES.put(`gen/${row.id}.png`, files.png);
  };
  const fail = async (error) => {
    await ai.deleteContainer(row.container);
    return set({ status: "failed", error, cost_cents: cost });
  };
  // After the review, the build's own files are still good enough to offer.
  const readyWithBuild = async () => {
    await ai.deleteContainer(row.container);
    return set({ status: "ready", progress: 100, cost_cents: cost });
  };

  const out = r.status === "completed" ? result(r) : null;
  if (row.stage === "review") {
    if (out?.ok) {
      try {
        await store(await ai.files(row.container, out.id || row.item_id));
      } catch (err) {
        console.error("OpenAI files after review", err);
      }
    }
    return readyWithBuild();
  }

  // The build step.
  if (r.status !== "completed") {
    const why = r.error?.code === "insufficient_quota" ? PAUSED : r.error?.message || r.incomplete_details?.reason;
    return fail(why ? `Couldn't be created: ${why}` : "Couldn't be created. Try again.");
  }
  if (!out) return fail("Astra didn't finish properly. Try again.");
  if (!out.ok) return fail(out.message || "Astra couldn't make this one.");
  let files;
  try {
    files = await ai.files(row.container, out.id);
    await store(files);
  } catch (err) {
    console.error("OpenAI files", err);
    return fail("The finished model couldn't be collected. Try again.");
  }
  // A description gets Astra's tidy label; a photo keeps the name the person gave it.
  const name = row.kind === "image" ? row.name : String(out.label || row.name).slice(0, 60);
  try {
    const review = await ai.review(row.container, r.id, files.png);
    return set({ stage: "review", stage_at: Date.now(), response: review, item_id: out.id, name, progress: 75, cost_cents: cost });
  } catch (err) {
    console.error("OpenAI review", err);
    await set({ item_id: out.id, name });
    return readyWithBuild();
  }
}

export async function onRequestPut({ request, env, params }) {
  const body = await request.json().catch(() => null);
  const importId = String(body?.importId || "");
  const row = await load(env, params.id);
  if (!row) return json({ error: "No such item." }, 404);
  if (!(await env.DB.prepare("SELECT 1 FROM imports WHERE id = ?").bind(importId).first())) return json({ error: "No such Library item." }, 400);
  await env.DB.prepare("UPDATE generations SET status = 'done', import_id = ?, updated_at = ? WHERE id = ?")
    .bind(importId, Date.now(), params.id).run();
  await removeFiles(env, params.id);
  return json({ ok: true });
}

export async function onRequestDelete({ env, params }) {
  const row = await load(env, params.id);
  if (!row) return json({ error: "No such item." }, 404);
  if (row.status === "working") return json({ error: "It's still being created." }, 409);
  await env.DB.prepare("DELETE FROM generations WHERE id = ?").bind(params.id).run();
  await removeFiles(env, params.id);
  return json({ ok: true });
}

const removeFiles = (env, id) => Promise.all([env.FILES.delete(`gen/${id}.glb`), env.FILES.delete(`gen/${id}.png`)]);
