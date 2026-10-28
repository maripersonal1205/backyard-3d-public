import { History } from "./history.js";

// Plans: separate versions of the yard layout (items + ground surfaces, see
// ctx.getLayout). Each keeps its own layout and its own undo history (in
// memory only); time of day is shared. New plans start from the original yard.
//
// Where they're saved is up to ctx.backend (this browser, or the shared app).
// In the shared app every plan is listed and anyone can change any of them.
export function createPlans(ctx, saved) {
  const { backend } = ctx;
  let plans = (saved?.plans || []).map((p) => ({ id: p.id, name: p.name, layout: p.layout }));
  let currentId = null;
  const histories = new Map();

  const find = (id) => plans.find((p) => p.id === id);
  const newId = () => "plan-" + crypto.randomUUID().slice(0, 8);
  const changed = () => ctx.emit("plans-changed");
  backend.bindSnapshot(() => ({
    plans: plans.map(({ id, name, layout }) => ({ id, name, layout })), currentId, time: ctx.env.time,
  }));

  // Save the open plan and the settings.
  function persist() {
    const plan = find(currentId);
    if (plan) {
      plan.layout = ctx.getLayout();
      backend.savePlan(plan);
    }
    backend.saveSettings({ currentId, time: ctx.env.time });
  }

  async function open(id) {
    const plan = find(id);
    if (!plan) return;
    if (currentId) persist();
    ctx.select?.(null);
    const failed = await ctx.library.ensureAll(ctx.items.missingKeys(plan.layout));
    if (failed.length) ctx.toast("Some Library items in this plan couldn't be loaded.");
    try {
      ctx.applyLayout(plan.layout);
    } catch (e) {
      console.warn("Ignoring unreadable plan layout", e);
      ctx.applyLayout(ctx.initialLayout);
    }
    currentId = id;
    if (!histories.has(id)) histories.set(id, new History(ctx.getLayout()));
    ctx.history = histories.get(id);
    ctx.emit("items-changed");
    ctx.emit("history-changed");
    changed();
    persist();
  }

  function nextName() {
    for (let n = plans.length + 1; ; n++) {
      const name = `Plan ${n}`;
      if (!plans.some((p) => p.name === name)) return name;
    }
  }

  function add(plan) {
    plans.push(plan);
    backend.createPlan(plan);
    return open(plan.id);
  }

  return {
    get list() { return plans; },
    get current() { return find(currentId); },
    open,
    persist,
    // First open: the plan this device had open last, else the first plan.
    // With no plans at all (a fresh browser), "My plan" is made.
    start() {
      if (!plans.length) {
        const plan = { id: newId(), name: "My plan", layout: ctx.initialLayout };
        plans.unshift(plan);
        backend.createPlan(plan);
      }
      return open(find(saved?.currentId) ? saved.currentId : plans[0].id);
    },

    create: () => add({ id: newId(), name: nextName(), layout: ctx.initialLayout }),

    duplicate(id) {
      if (id === currentId) persist();
      const src = find(id);
      return add({ id: newId(), name: `${src.name} copy`.slice(0, 60), layout: structuredClone(src.layout) });
    },

    rename(id, name) {
      const plan = find(id);
      name = name.trim().slice(0, 60);
      if (!plan || !name) return;
      plan.name = name;
      backend.savePlan(plan);
      changed();
    },

    remove(id) {
      const plan = find(id);
      if (!plan || plans.length < 2) return;
      plans = plans.filter((p) => p.id !== id);
      histories.delete(id);
      backend.deletePlan(id);
      if (id === currentId) {
        currentId = null;
        return open(plans[0].id);
      }
      changed();
    },

    // Plans, for moving them between this browser and the shared app
    // (transfer.js; not in the menu for now).
    exportable: () => plans.map(({ name, layout }) => ({ name, layout })),
    // Add plans brought in from a file.
    importPlans(list) {
      for (const p of list) {
        const plan = { id: newId(), name: String(p.name || "Imported plan").slice(0, 60), layout: p.layout };
        plans.push(plan);
        backend.createPlan(plan);
      }
      changed();
    },

    // Item types in the yard in any plan.
    usedKeys() {
      persist();
      return new Set(plans.flatMap((p) => p.layout.items.filter((r) => r.placed !== false).map((r) => r.key)));
    },
  };
}
