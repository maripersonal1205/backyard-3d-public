import * as THREE from "three";
import { AI_CATEGORY } from "../library.js";
import * as storage from "../storage.js";
import { FACINGS, TIME_ZONES, zoneOn } from "../environment.js";

// "My items": a collapsed pill that opens into a floating panel with four tabs:
// All, the Library of everything that can be added (the yard's own items, listed
// under their category next to pre-made ones, then created with AI and
// imported; open by default);
// In use (what's in the yard); Generated (items being made and made with AI;
// shared app and demo only); and Settings.
// Rows can be clicked or dragged onto the scene. Every tab but Settings has the
// same footer: Revert to original, and Create new (Import or Generate).
function scaleLabel(item) {
  const [x, y, z] = item.t.s;
  const uniform = Math.abs(x - y) < 0.01 && Math.abs(x - z) < 0.01;
  return uniform ? `${Math.round(x * 100)}% scale` : "Custom size";
}

const SPARKLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>`;
const X_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

export function createSidebar(ctx) {
  const $ = (id) => document.getElementById(id);
  const pill = $("items-pill"), panel = $("items-panel"), list = $("items-list"), search = $("items-search");
  const tabs = [...panel.querySelectorAll("[data-tab]")];
  const settingsPane = $("items-settings");
  const aiTab = panel.querySelector('[data-tab="ai"]');
  let tab = "library"; // All, the first tab, is open by default
  let query = "";

  function setOpen(open) {
    if (!open) closeSunPopups();
    panel.hidden = !open;
    pill.hidden = open;
    pill.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("panel-open", open);
    if (open) render();
  }
  pill.addEventListener("click", () => setOpen(true));
  $("items-collapse").addEventListener("click", () => { setOpen(false); pill.focus(); });

  function showTab(name) {
    closeSunPopups();
    tab = name;
    for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.tab === name));
    const settings = name === "settings";
    settingsPane.hidden = !settings;
    list.hidden = search.hidden = settings;
    panel.querySelector(".panel-foot").hidden = settings;
    if (name === "library" || name === "ai") ctx.generation.refresh();
    render();
  }
  for (const b of tabs) b.addEventListener("click", () => showTab(b.dataset.tab));
  search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); render(); });
  $("reset-yard").addEventListener("click", () => ctx.actions.resetYard());

  // Create new: Import or Generate. Without AI (the local app) it's just Import.
  const createDialog = $("create-dialog");
  ctx.openCreateNew = () => {
    if (!ctx.generation.enabled) return ctx.openImport();
    createDialog.showModal();
    $("create-import").focus();
  };
  $("create-new").addEventListener("click", () => ctx.openCreateNew());
  // Import keeps the choices open behind the file picker, so cancelling the
  // picker comes back here; choosing a file closes them.
  $("create-import").addEventListener("click", () => ctx.openImport());
  $("import-file").addEventListener("change", () => createDialog.close());
  $("create-generate").addEventListener("click", () => {
    createDialog.close();
    ctx.generation.open({ back: true });
  });
  $("create-cancel").addEventListener("click", () => createDialog.close());

  function empty(text) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    return li;
  }

  // ---- Settings (kept on this device) ----
  const settings = storage.loadSettings();
  const overWalls = $("setting-over-walls");
  overWalls.checked = settings.overWalls !== false;
  ctx.items.insideWalls = !overWalls.checked;
  const saveSetting = (changes) => storage.saveSettings(Object.assign(settings, changes));
  overWalls.addEventListener("change", () => {
    ctx.items.insideWalls = !overWalls.checked;
    saveSetting({ overWalls: overWalls.checked });
  });
  const closeSunPopups = createSunSettings(ctx, settings, saveSetting);

  // The yard's own items (from the model), listed in the Library.
  const originals = () => Object.entries(ctx.items.defs)
    .filter(([key]) => !key.includes(":"))
    .map(([key, def]) => ({
      key, label: def.label, category: def.category || "Other", tags: [], original: true,
      attached: def.attached || null, thumbnail: ctx.thumbnailFor(key),
    }));

  function render() {
    if (panel.hidden) return;
    const placed = ctx.items.placedItems();
    const library = [...originals(), ...ctx.library.entries];
    const made = ctx.library.entries.filter((e) => e.category === AI_CATEGORY);
    // Generated is shown when creating is on, or when something was made with AI.
    aiTab.hidden = !ctx.generation.enabled && !made.length && !ctx.generation.jobs.length;
    $("count-yard").textContent = placed.length;
    $("count-ai").textContent = made.length;
    $("count-library").textContent = library.length;
    if (tab === "settings") return;
    if (tab === "ai") return renderAI(made, placed);
    if (tab === "library") return renderLibrary(library, placed);

    const rows = placed.filter((i) => i.label.toLowerCase().includes(query));
    // Used also lists the ground areas, under their own heading.
    const areas = ctx.ground.areas.filter((a) => (a.label + " " + ctx.ground.surfaceLabel(a)).toLowerCase().includes(query));
    if (!rows.length && !areas.length) {
      list.replaceChildren(empty(query ? "No items match your search." : "The yard is empty. Add items from All."));
      return;
    }
    if (!areas.length) return list.replaceChildren(...rows.map(itemRow));
    list.replaceChildren(
      ...(rows.length ? [groupHead("Items"), ...rows.map(itemRow)] : []),
      groupHead("Ground"), ...areas.map(groundRow),
    );
  }

  function groupHead(text) {
    const li = document.createElement("li");
    li.className = "group-head";
    li.textContent = text;
    return li;
  }

  // ---- Ground areas: click to select and change the surface; never moved. ----
  function groundRow(area) {
    const li = baseRow(area.label, ctx.ground.swatchFor(area), ctx.ground.surfaceLabel(area));
    li.classList.add("ground-row");
    li.classList.toggle("selected", ctx.selected === area);
    li.title = "Click to change the surface";
    li.addEventListener("click", () => ctx.select(area));
    return li;
  }

  // ---- Used (in the yard) ----
  function itemRow(item) {
    const li = baseRow(item.label, ctx.thumbnailFor(item.key),
      item.attached ? `Fixed to the ${item.attached}` : scaleLabel(item), item.key);
    li.classList.toggle("selected", ctx.selected === item);
    li.title = item.attached ? "Click to select" : "Click to select · drag into the yard to add a copy";
    li.append(xButton(`Remove ${item.label}`, "Remove from the yard", () => ctx.actions.remove(item)));
    li.addEventListener("pointerdown", (e) => startRowDrag(e, {
      label: item.label,
      thumb: () => ctx.thumbnailFor(item.key),
      preview: (x, y) => ctx.interaction.showDropPreview(item, x, y),
      click: () => ctx.select(item),
      drop: (p) => ctx.actions.dropAt(item, p.x, p.z),
    }));
    return li;
  }

  // Empty list message, with a "Create “…” with AI" button when there's a search.
  function emptyWithCreate(text) {
    const li = empty(text);
    if (query && ctx.generation.enabled) {
      const b = document.createElement("button");
      b.className = "text-btn empty-create";
      b.innerHTML = SPARKLE_ICON;
      b.append(`Create “${search.value.trim()}” with AI`);
      b.addEventListener("click", () => ctx.generation.open({ prompt: search.value.trim() }));
      li.prepend(b);
    }
    return li;
  }

  const countInYard = (placed) => {
    const inYard = {};
    for (const i of placed) inYard[i.key] = (inYard[i.key] || 0) + 1;
    return inYard;
  };

  // ---- Generated: items being made, then the ones made with AI ----
  function renderAI(made, placed) {
    ctx.library.pictureMissing();
    const jobs = ctx.generation.jobs.filter((j) => j.name.toLowerCase().includes(query));
    const matches = made.filter((e) => [e.label, ...e.tags].some((s) => s.toLowerCase().includes(query)));
    const inYard = countInYard(placed);
    const rows = matches.sort((a, b) => a.label.localeCompare(b.label)).map((e) => libraryRow(e, inYard[e.key] || 0));
    if (!jobs.length && !rows.length) {
      const canCreate = ctx.generation.enabled;
      return list.replaceChildren(emptyWithCreate(
        query ? `Nothing made with AI matches your search.${canCreate ? " Create it with AI?" : ""}`
        : canCreate ? "Nothing made with AI yet. Use Create new below to describe an item or give a photo."
        : "Nothing made with AI yet."
      ));
    }
    if (!jobs.length) return list.replaceChildren(...rows);
    list.replaceChildren(
      groupHead("Being created"), ...jobs.map(jobRow),
      ...(rows.length ? [groupHead(AI_CATEGORY), ...rows] : []),
    );
  }

  // ---- All (the Library) ----
  function renderLibrary(entries, placed) {
    ctx.library.pictureMissing();
    const matches = entries.filter((e) =>
      [e.label, e.category, ...e.tags].some((s) => s.toLowerCase().includes(query)));
    if (!matches.length) {
      const canCreate = ctx.generation.enabled;
      list.replaceChildren(emptyWithCreate(
        query ? `Nothing matches your search. ${canCreate ? "Create it with AI, or import a model." : "You can import a model instead."}`
        : "Nothing here yet. Import a model to add one."
      ));
      return;
    }
    const inYard = countInYard(placed);
    const groups = new Map();
    for (const e of matches) {
      if (!groups.has(e.category)) groups.set(e.category, []);
      groups.get(e.category).push(e);
    }
    // Categories A–Z (the yard's own items mixed in), then Generated by AI, then Imported.
    const rank = (c) => (c === "Imported" ? 2 : c === AI_CATEGORY ? 1 : 0);
    const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const rows = [];
    for (const category of order) {
      rows.push(groupHead(category), ...groups.get(category)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((e) => (e.original ? originalRow(e, inYard[e.key] || 0) : libraryRow(e, inYard[e.key] || 0))));
    }
    list.replaceChildren(...rows);
  }

  // An item being created with AI: progress while it's made; click when ready
  // to name, size and add it; × to dismiss a failed one or discard a ready one.
  function jobRow(job) {
    const li = document.createElement("li");
    li.className = `item-row gen-row ${job.status}`;
    let thumb;
    if (job.status === "ready" && job.thumbnail) {
      thumb = document.createElement("img");
      thumb.alt = "";
      thumb.src = job.thumbnail;
    } else {
      thumb = document.createElement("div");
      thumb.className = "gen-thumb";
      thumb.innerHTML = SPARKLE_ICON;
    }
    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.innerHTML = `<div class="item-name"></div><div class="item-sub"></div>`;
    meta.firstChild.textContent = job.name;
    meta.lastChild.textContent =
      job.status === "working" ? `Creating… ${job.progress}%`
      : job.status === "ready" ? "Ready: click to add it"
      : job.error || "Couldn't be created.";
    if (job.status === "working") {
      const bar = document.createElement("div");
      bar.className = "gen-bar";
      bar.innerHTML = `<span style="width:${Math.max(3, job.progress)}%"></span>`;
      meta.append(bar);
    }
    li.append(thumb, meta);
    if (job.status === "ready") {
      li.title = "Click to name it, set its height and add it to the Library";
      li.addEventListener("click", () => ctx.generation.review(job));
      let armed = null;
      const x = xButton(`Discard ${job.name}`, "Discard", () => {
        if (!armed) {
          x.classList.add("armed");
          x.title = "Click again to discard";
          ctx.toast(`Click × again to discard ${job.name}. The credits it used won't come back.`);
          armed = setTimeout(() => { armed = null; x.classList.remove("armed"); x.title = "Discard"; }, 3000);
          return;
        }
        ctx.generation.dismiss(job);
      });
      li.append(x);
    } else if (job.status === "failed") {
      li.append(xButton(`Dismiss ${job.name}`, "Dismiss", () => ctx.generation.dismiss(job)));
    }
    return li;
  }

  function libraryRow(entry, count) {
    const li = baseRow(entry.label, entry.thumbnail || "", count ? `${count} in use` : "Not in use", entry.key);
    li.title = "Click to add it to the yard, or drag it to a spot";
    if (entry.record && entry.canDelete) {
      let armed = null;
      const x = xButton(`Delete ${entry.label} from the Library`, "Delete from the Library", async () => {
        if (ctx.plans.usedKeys().has(entry.key)) {
          ctx.toast("It's in use in a plan. Remove it there first.");
          return;
        }
        if (!armed) {
          x.classList.add("armed");
          x.title = "Click again to delete";
          ctx.toast(`Click × again to delete ${entry.label} from the Library.`);
          armed = setTimeout(() => { armed = null; x.classList.remove("armed"); x.title = "Delete from the Library"; }, 3000);
          return;
        }
        try {
          await ctx.library.removeImport(entry.key);
          ctx.emit("library-changed");
        } catch {
          ctx.toast("Couldn't delete it. Try again.");
        }
      });
      li.append(x);
    }
    li.addEventListener("pointerdown", (e) => {
      if (e.button === 0) ctx.library.ensure(entry.key); // start loading while the drag begins
      startRowDrag(e, {
        label: entry.label,
        thumb: () => entry.thumbnail || "",
        preview: (x, y) => ctx.interaction.showLibraryPreview(entry.key, x, y),
        click: () => {
          const p = viewCenterPoint();
          ctx.actions.addFromLibrary(entry.key, p.x, p.z);
        },
        drop: (p) => ctx.actions.addFromLibrary(entry.key, p.x, p.z),
      });
    });
    return li;
  }

  // One of the yard's own items: adds it (or a copy) like a Library item. Items
  // fixed to a wall or the lawn can only be put back in their own spot.
  function originalRow(entry, count) {
    const sub = entry.attached
      ? `Fixed to the ${entry.attached} · ${count ? "in use" : "not in use"}`
      : count ? `${count} in use` : "Not in use";
    const li = baseRow(entry.label, entry.thumbnail, sub, entry.key);
    li.title = entry.attached
      ? count ? "Click to select it" : "Click to put it back"
      : "Click to add it to the yard, or drag it to a spot";
    const item = ctx.items.get(entry.key);
    li.addEventListener("pointerdown", (e) => startRowDrag(e, {
      label: entry.label,
      thumb: () => entry.thumbnail,
      preview: (x, y) => (entry.attached ? ctx.interaction.showDropPreview(null) : ctx.interaction.showDropPreview(item, x, y)),
      click: () => {
        if (entry.attached && count) return ctx.select(item);
        const p = viewCenterPoint();
        ctx.actions.addOriginal(entry.key, p.x, p.z);
      },
      drop: (p) => ctx.actions.addOriginal(entry.key, p.x, p.z),
    }));
    return li;
  }

  // Ground point in the middle of the view, or a few steps ahead when the
  // middle of the view isn't looking at nearby ground (Walk mode).
  function viewCenterPoint() {
    const r = ctx.renderer.domElement.getBoundingClientRect();
    const p = ctx.interaction.groundPoint(r.left + r.width / 2, r.top + r.height / 2);
    const cam = ctx.camera.position;
    if (p && Math.hypot(p.x - cam.x, p.z - cam.z) < 25) return p;
    const f = ctx.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    return { x: cam.x + f.x * 3, z: cam.z + f.z * 3 };
  }

  // ---- Shared row parts ----
  function baseRow(label, thumb, sub, key) {
    const li = document.createElement("li");
    li.className = "item-row";
    const img = document.createElement("img");
    img.alt = "";
    img.addEventListener("error", () => ctx.library.thumbnailFailed(key), { once: true });
    if (thumb) img.src = thumb;
    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.innerHTML = `<div class="item-name"></div><div class="item-sub"></div>`;
    meta.firstChild.textContent = label;
    meta.lastChild.textContent = sub;
    li.append(img, meta);
    return li;
  }

  function xButton(ariaLabel, title, onClick) {
    const x = document.createElement("button");
    x.className = "icon-btn row-x";
    x.setAttribute("aria-label", ariaLabel);
    x.title = title;
    x.innerHTML = X_ICON;
    x.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return x;
  }

  // Pointer-driven drag (not HTML5 drag-and-drop) so we can show a live drop
  // ring in the 3D scene while the pointer is over it.
  function startRowDrag(e, row) {
    if (e.button !== 0 || e.target.closest(".row-x")) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const canvas = ctx.renderer.domElement;
    let ghost = null;

    const overCanvas = (ev) => document.elementFromPoint(ev.clientX, ev.clientY) === canvas;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.innerHTML = `<img alt=""><span></span>`;
        ghost.firstChild.src = row.thumb();
        ghost.lastChild.textContent = row.label;
        document.body.append(ghost);
        document.body.classList.add("dragging-item");
      }
      ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
      if (overCanvas(ev)) row.preview(ev.clientX, ev.clientY);
      else ctx.interaction.showDropPreview(null);
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ctx.interaction.showDropPreview(null);
      if (!ghost) return row.click();
      ghost.remove();
      document.body.classList.remove("dragging-item");
      if (!overCanvas(ev)) return;
      const p = ctx.interaction.groundPoint(ev.clientX, ev.clientY);
      if (!p) return ctx.toast("Drop items onto the ground.");
      row.drop(p);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  ctx.on("items-changed", render);
  ctx.on("selection-changed", render);
  ctx.on("thumbs-changed", render);
  ctx.on("library-changed", render);
  // After an import or starting a creation, show that tab ("library" = All, or "ai").
  ctx.showLibrary = (name = "library") => { setOpen(true); search.value = ""; query = ""; showTab(name); };
  setOpen(false);
}

// ---- Settings → Sun direction: date, time zone and the way the yard faces ----
// Until a date is picked (or after "Today"), the sun follows today's date.
// Picking a date also picks the time zone clocks use on it (still changeable).
// Kept on this device.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// Put a fixed pop-up under `anchor` (or above it when there isn't room below).
function placePopover(anchor, el) {
  const r = anchor.getBoundingClientRect();
  const gap = 6, margin = 8;
  let top = r.bottom + gap;
  if (top + el.offsetHeight > innerHeight - margin) top = Math.max(margin, r.top - gap - el.offsetHeight);
  el.style.top = `${top}px`;
  el.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - el.offsetWidth - margin))}px`;
}

// A dropdown: a button showing the current choice and a pop-up list of
// options (`options`: id -> { label }). Keys work on the button while the
// list is open (focus stays on it). Returns { open, close, show }.
function createDropdown(btn, labelEl, list, options, { current, pick, beforeOpen }) {
  const ids = Object.keys(options);
  let active = 0; // highlighted option while the list is open
  const show = () => { labelEl.textContent = options[current()].label; };
  function render() {
    list.replaceChildren(...ids.map((id, i) => {
      const li = document.createElement("li");
      li.role = "option";
      li.id = `${list.id}-${id}`;
      li.textContent = options[id].label;
      li.setAttribute("aria-selected", String(id === current()));
      li.classList.toggle("active", i === active);
      li.addEventListener("click", () => choose(id));
      return li;
    }));
    btn.setAttribute("aria-activedescendant", `${list.id}-${ids[active]}`);
  }
  function open() {
    beforeOpen();
    active = ids.indexOf(current());
    render();
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    list.style.width = `${btn.offsetWidth}px`;
    placePopover(btn, list);
    list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }
  function close() {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    btn.removeAttribute("aria-activedescendant");
  }
  function choose(id) {
    pick(id);
    show();
    close();
    btn.focus();
  }
  btn.addEventListener("click", () => (list.hidden ? open() : close()));
  btn.addEventListener("keydown", (e) => {
    const isOpen = !list.hidden;
    if (e.key === "Escape" && isOpen) { e.stopPropagation(); close(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && !(isOpen && (e.key === "Enter" || e.key === " "))) return;
    e.preventDefault();
    e.stopPropagation(); // not an item nudge
    if (!isOpen) return open();
    if (e.key === "Enter" || e.key === " ") return choose(ids[active]);
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + ids.length) % ids.length;
    render();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!list.hidden && !list.contains(e.target) && !btn.contains(e.target)) close();
  });
  show();
  return { open, close, show };
}

function createSunSettings(ctx, settings, saveSetting) {
  const $ = (id) => document.getElementById(id);
  const btn = $("sun-date"), label = $("sun-date-label"), cal = $("sun-calendar"), grid = $("cal-grid");
  const year = new Date().getFullYear(); // only lays out the calendar; the sun ignores the year
  const today = () => { const d = new Date(); return { month: d.getMonth() + 1, day: d.getDate() }; };

  const date = settings.sunDate || today();
  ctx.env.setDate(date.month, date.day, settings.sunZone || zoneOn(year, date.month, date.day));
  ctx.env.setFacing(settings.sunFacing || "S");

  // Only one pop-up at a time; scrolling the panel or resizing the window closes it.
  const closeAll = () => { closeCalendar(); zones.close(); facing.close(); };
  document.querySelector(".settings-pane").addEventListener("scroll", closeAll);
  window.addEventListener("resize", closeAll);
  document.addEventListener("pointerdown", (e) => {
    if (!cal.hidden && !cal.contains(e.target) && !btn.contains(e.target)) closeCalendar();
  });

  const zones = createDropdown($("sun-zone"), $("sun-zone-label"), $("sun-zone-list"), TIME_ZONES, {
    current: () => ctx.env.zone,
    pick: (id) => { ctx.env.setDate(ctx.env.date.month, ctx.env.date.day, id); saveSetting({ sunZone: id }); },
    beforeOpen: () => { closeCalendar(); facing.close(); },
  });
  const facing = createDropdown($("sun-facing"), $("sun-facing-label"), $("sun-facing-list"), FACINGS, {
    current: () => ctx.env.facing,
    pick: (id) => { ctx.env.setFacing(id); saveSetting({ sunFacing: id }); },
    beforeOpen: () => { closeCalendar(); zones.close(); },
  });

  function show() {
    label.textContent = `${MONTHS[ctx.env.date.month - 1]} ${ctx.env.date.day}`;
    zones.show();
  }
  show();

  function pick(month, day, follow = false) {
    const zone = zoneOn(year, month, day);
    ctx.env.setDate(month, day, zone);
    // "Today" goes back to following the date, so it moves on by itself.
    saveSetting(follow ? { sunDate: undefined, sunZone: undefined } : { sunDate: { month, day }, sunZone: zone });
    show();
    closeCalendar();
    btn.focus();
  }

  // ---- The calendar pop-up ----
  let shown = ctx.env.date.month; // month on screen
  function render(focusDay) {
    $("cal-month").textContent = MONTHS[shown - 1];
    const first = new Date(year, shown - 1, 1).getDay();
    const days = new Date(year, shown, 0).getDate();
    const now = today();
    const target = focusDay || (shown === ctx.env.date.month ? ctx.env.date.day : 1);
    const cells = ["S", "M", "T", "W", "T", "F", "S"].map((d) => {
      const el = document.createElement("span");
      el.className = "dow";
      el.textContent = d;
      el.setAttribute("aria-hidden", "true");
      return el;
    });
    for (let i = 0; i < first; i++) cells.push(document.createElement("span"));
    for (let day = 1; day <= days; day++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = day;
      b.dataset.day = day;
      b.setAttribute("aria-label", `${MONTHS[shown - 1]} ${day}`);
      const selected = shown === ctx.env.date.month && day === ctx.env.date.day;
      b.setAttribute("aria-selected", String(selected));
      b.tabIndex = day === target ? 0 : -1; // one tab stop; arrow keys move between days
      if (shown === now.month && day === now.day) b.classList.add("today");
      b.addEventListener("click", () => pick(shown, day));
      cells.push(b);
    }
    grid.replaceChildren(...cells);
    placePopover(btn, cal); // months with six weeks are taller
    if (focusDay) grid.querySelector(`[data-day="${focusDay}"]`)?.focus();
  }
  const step = (delta) => { shown = ((shown - 1 + delta + 12) % 12) + 1; render(); };

  function openCalendar() {
    zones.close();
    facing.close();
    cal.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    shown = ctx.env.date.month;
    render(ctx.env.date.day);
  }
  function closeCalendar() {
    cal.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  btn.addEventListener("click", () => (cal.hidden ? openCalendar() : closeCalendar()));
  $("cal-prev").addEventListener("click", () => step(-1));
  $("cal-next").addEventListener("click", () => step(1));
  $("cal-today").addEventListener("click", () => { const t = today(); pick(t.month, t.day, true); });
  // Arrow keys move between days (across months), Escape closes.
  cal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeCalendar(); btn.focus(); return; }
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const day = Number(document.activeElement?.dataset?.day);
    if (!move || !day) return;
    e.preventDefault();
    e.stopPropagation(); // not an item nudge
    const d = new Date(year, shown - 1, day + move);
    shown = d.getMonth() + 1;
    render(d.getDate());
  });
  return closeAll;
}
