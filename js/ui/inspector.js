import { COLOR_PRESETS, FEET_PER_METRE } from "../config.js";
import { baseHeight } from "../items.js";

const MIN_SCALE = 0.1, MAX_SCALE = 10;

// Presets this close to the model's own colour would just duplicate "Original".
function looksAlike(a, b) {
  const ch = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return [0, 1, 2].every((i) => Math.abs(ch(a, i) - ch(b, i)) <= 16);
}

// Bottom panel for the selected item: size in feet, colours, turn, remove.
// For a ground area (lawn, patio…) it shows only the surface choices.
export function createInspector(ctx) {
  const $ = (id) => document.getElementById(id);
  const el = $("inspector"), name = $("insp-name"), note = $("insp-note"), lock = $("dim-lock");
  const colorsEl = $("insp-colors"), surfacesEl = $("insp-surfaces");
  const inputs = { y: $("dim-h"), x: $("dim-w"), z: $("dim-d") }; // H = y, W = x, D = z
  const editable = [...Object.values(inputs), lock, $("turn-left"), $("turn-right")];
  let linked = true;

  function sync() {
    const item = ctx.selected;
    el.hidden = !item;
    if (!item) return;
    name.textContent = item.label;
    const ground = item.kind === "ground";
    el.classList.toggle("ground-mode", ground);
    surfacesEl.hidden = !ground;
    if (ground) {
      colorsEl.hidden = true;
      note.hidden = true;
      syncSurfaces(item);
      return;
    }
    const size = ctx.items.size(item);
    for (const [axis, input] of Object.entries(inputs)) {
      if (document.activeElement !== input) input.value = (size[axis] * FEET_PER_METRE).toFixed(1);
    }
    for (const c of editable) c.disabled = !!item.attached;
    note.hidden = !item.attached;
    note.textContent = item.attached
      ? `Fixed to the ${item.attached}, so it can be removed but not moved, resized or turned.`
      : "";
    syncColors(item);
  }

  // Ground areas: a grid of surface tiles (picture + name).
  let shownSurfaces = null;
  function syncSurfaces(area) {
    const key = area.id + ":" + area.surface;
    if (key === shownSurfaces) return;
    shownSurfaces = key;
    const focused = surfacesEl.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    surfacesEl.replaceChildren(...ctx.ground.choices(area).map((s) => {
      const b = document.createElement("button");
      b.className = "surface";
      b.dataset.id = s.id;
      b.setAttribute("aria-pressed", String(s.id === area.surface));
      b.innerHTML = `<img alt=""><span></span>`;
      if (s.swatch) b.firstChild.src = s.swatch;
      b.lastChild.textContent = s.label;
      b.addEventListener("click", () => ctx.actions.setSurface(area, s.id));
      return b;
    }));
    if (focused) surfacesEl.querySelector(`[data-id="${focused}"]`)?.focus();
  }

  // One row of swatches per recolourable material; the first is the model's own colour.
  let shownColors = null;
  function syncColors(item) {
    const base = ctx.items.templates[item.key]?.colors || {};
    const names = Object.keys(base);
    const key = item.id + JSON.stringify(item.colors);
    colorsEl.hidden = !names.length;
    if (!names.length || key === shownColors) return;
    shownColors = key;
    const focused = colorsEl.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    colorsEl.replaceChildren(...names.map((material) => {
      const preset = COLOR_PRESETS[material];
      const current = item.colors[material] || null;
      const row = document.createElement("div");
      row.className = "color-row";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", `${preset.label} colour`);
      const label = document.createElement("span");
      label.className = "insp-label";
      label.textContent = preset.label;
      row.append(label);
      const options = [
        { name: "Original", hex: null, show: base[material] },
        ...preset.swatches
          .filter((s) => s.hex === current || !looksAlike(s.hex, base[material]))
          .map((s) => ({ ...s, show: s.hex })),
      ];
      for (const opt of options) {
        const b = document.createElement("button");
        b.className = "swatch";
        b.style.background = opt.show;
        b.title = opt.name;
        b.setAttribute("aria-label", `${preset.label}: ${opt.name}`);
        b.dataset.id = material + (opt.hex || "original");
        b.setAttribute("aria-pressed", String(opt.hex === current));
        b.addEventListener("click", () => {
          if (opt.hex !== current) ctx.actions.recolor(item, material, opt.hex);
        });
        row.append(b);
      }
      return row;
    }));
    if (focused) colorsEl.querySelector(`[data-id="${focused}"]`)?.focus();
  }

  function applySize(axis, mergeKey) {
    const item = ctx.selected;
    const feet = parseFloat(inputs[axis].value);
    if (!item || !(feet > 0)) return sync();
    const base = axis === "y" ? baseHeight(item.box) : item.box.max[axis] - item.box.min[axis];
    const i = { x: 0, y: 1, z: 2 }[axis];
    const target = feet / FEET_PER_METRE / base;
    let s = [...item.t.s];
    if (linked) s = s.map((v) => v * (target / s[i]));
    else s[i] = target;
    if (s.every((v, k) => Math.abs(v - item.t.s[k]) < 1e-9)) {
      // Nothing changed (e.g. leaving a box after stepping it with the arrows).
    } else if (s.some((v) => v < MIN_SCALE || v > MAX_SCALE)) {
      ctx.toast("That's outside the size range for this item.");
    } else {
      ctx.actions.resize(item, s, mergeKey);
    }
    sync();
  }

  // ↑/↓ in a size box (or its ▲▼ buttons) step 0.1 ft, Shift 1 ft, and resize
  // straight away; a burst of steps on one box is one undo step.
  function step(axis, dir, big) {
    const item = ctx.selected;
    const input = inputs[axis];
    if (!item || input.disabled) return;
    const now = parseFloat(input.value);
    if (!(now > 0)) return;
    const next = Math.round((now + dir * (big ? 1 : 0.1)) * 10) / 10;
    if (!(next > 0)) return;
    input.value = next.toFixed(1);
    applySize(axis, `size:${item.id}:${axis}`);
  }

  for (const [axis, input] of Object.entries(inputs)) {
    input.addEventListener("change", () => applySize(axis));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        step(axis, e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
      }
    });
    for (const b of input.parentElement.querySelectorAll(".dim-step button")) {
      b.addEventListener("pointerdown", (e) => e.preventDefault()); // keep typing focus in the box
      b.addEventListener("click", (e) => { e.preventDefault(); step(axis, Number(b.dataset.step), e.shiftKey); });
    }
    input.addEventListener("blur", sync);
  }
  lock.addEventListener("click", () => {
    linked = !linked;
    lock.setAttribute("aria-pressed", String(linked));
    lock.title = linked ? "Keep proportions (on)" : "Keep proportions (off)";
  });
  $("turn-left").addEventListener("click", () => ctx.selected && ctx.actions.turn(ctx.selected, 15));
  $("turn-right").addEventListener("click", () => ctx.selected && ctx.actions.turn(ctx.selected, -15));
  $("insp-remove").addEventListener("click", () => ctx.selected && ctx.actions.remove(ctx.selected));
  $("insp-close").addEventListener("click", () => ctx.select(null));

  ctx.on("selection-changed", sync);
  ctx.on("items-changed", sync);
  sync();
}

