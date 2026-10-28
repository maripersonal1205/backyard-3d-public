// Plan switcher (top left): shows the open plan; its menu switches plans and
// makes new ones. Each plan's ⋯ opens a small menu: Rename (the name becomes a
// text box in place), Duplicate (the copy is made and opened, with its name
// ready to edit, like New plan) and Delete (asks first, in a dialog). In the
// shared app it lists everyone's plans and shows whether changes are saved.
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>`;
const MORE = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`;
const SAVE_TEXT = { saving: "Saving…", saved: "Saved", retrying: "Offline · will retry", failed: "Couldn't save" };

export function createPlanSwitcher(ctx) {
  const $ = (id) => document.getElementById(id);
  const root = $("plan-switcher"), button = $("plan-button"), menu = $("plan-menu"), list = $("plan-list");
  const pop = $("plan-more-menu"), delDialog = $("plan-delete-dialog");
  const plans = ctx.plans;
  let moreFor = null;  // plan id whose ⋯ menu is open
  let renaming = null; // plan id whose name is being edited

  function setOpen(open) {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    closeMore();
    renaming = null;
    if (open) render();
  }
  button.addEventListener("click", () => setOpen(menu.hidden));
  document.addEventListener("pointerdown", (e) => {
    if (menu.hidden || root.contains(e.target)) return;
    setOpen(false);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || renaming || delDialog.open) return;
    e.stopPropagation();
    if (moreFor) { closeMore(); return; }
    setOpen(false);
    button.focus();
  });

  // New plan and Duplicate both open the new plan and put its name in edit mode.
  async function addAndName(make) {
    closeMore();
    await make();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    renaming = plans.current.id;
    render();
  }
  $("plan-new").addEventListener("click", () => addAndName(() => plans.create()));

  // ---- The ⋯ menu ----
  function openMore(plan, anchor, fromKeyboard) {
    moreFor = plan.id;
    pop.querySelector('[data-act="delete"]').disabled = plans.list.length < 2;
    pop.querySelector('[data-act="delete"]').title = plans.list.length < 2 ? "You need at least one plan" : "";
    pop.hidden = false;
    // Just below the ⋯, reaching out past the plan menu's right edge.
    const r = root.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    const left = Math.min(a.right - r.left - 14, innerWidth - r.left - pop.offsetWidth - 8);
    pop.style.left = `${Math.max(0, left)}px`;
    pop.style.top = `${a.bottom - r.top + 2}px`;
    for (const b of list.querySelectorAll(".plan-more")) b.setAttribute("aria-expanded", String(b === anchor));
    if (fromKeyboard) pop.querySelector("button").focus({ preventScroll: true });
  }
  function closeMore() {
    moreFor = null;
    pop.hidden = true;
    for (const b of list.querySelectorAll(".plan-more")) b.setAttribute("aria-expanded", "false");
  }
  // A press anywhere but the ⋯ menu (or a ⋯ button, which toggles it) closes it.
  root.addEventListener("pointerdown", (e) => {
    if (moreFor && !pop.contains(e.target) && !e.target.closest(".plan-more")) closeMore();
  });
  list.addEventListener("scroll", closeMore);

  pop.addEventListener("click", async (e) => {
    const act = e.target.closest("button")?.dataset.act;
    const id = moreFor;
    if (!act || !id) return;
    closeMore();
    if (act === "rename") { renaming = id; render(); }
    if (act === "duplicate") await addAndName(() => plans.duplicate(id));
    if (act === "delete") askDelete(id);
  });

  function askDelete(id) {
    delDialog.returnValue = "";
    delDialog.onclose = async () => {
      delDialog.onclose = null;
      if (delDialog.returnValue === "delete") await plans.remove(id);
      render();
    };
    delDialog.showModal();
  }

  // ---- Saved / Saving… (shared app only) ----
  const saveStatus = $("save-status");
  let fadeTimer = null;
  ctx.backend.onStatus((status, message) => {
    saveStatus.hidden = false;
    saveStatus.textContent = SAVE_TEXT[status];
    saveStatus.dataset.status = status;
    clearTimeout(fadeTimer);
    if (status === "saved") fadeTimer = setTimeout(() => { saveStatus.hidden = true; }, 2000);
    if (status === "failed") ctx.toast(message || "Couldn't save that change.");
  });

  const el = (tag, cls, html = "") => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    n.innerHTML = html;
    return n;
  };

  function render() {
    $("plan-name").textContent = plans.current?.name || "";
    if (menu.hidden) return;
    list.replaceChildren(...plans.list.map(row));
    const input = list.querySelector("input");
    if (input) {
      input.focus();
      input.select();
      input.scrollIntoView({ block: "nearest" });
    }
  }

  function row(plan) {
    const li = el("li", "plan-row");
    const isCurrent = plan === plans.current;

    if (renaming === plan.id) {
      const input = el("input", "plan-rename");
      input.value = plan.name;
      input.maxLength = 60;
      input.setAttribute("aria-label", "Plan name");
      // Enter or clicking away saves; Esc keeps the name it had.
      const done = (save) => {
        if (renaming !== plan.id) return;
        renaming = null;
        if (save) plans.rename(plan.id, input.value);
        render();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") { e.stopPropagation(); done(false); }
      });
      input.addEventListener("blur", () => done(true));
      li.append(input);
      return li;
    }

    const pick = el("button", "plan-pick",
      `<span class="plan-check">${isCurrent ? CHECK : ""}</span><span class="plan-label"></span>`);
    pick.querySelector(".plan-label").textContent = plan.name;
    pick.setAttribute("aria-current", String(isCurrent));
    pick.addEventListener("click", async () => {
      setOpen(false);
      if (!isCurrent) await plans.open(plan.id);
    });
    const more = el("button", "icon-btn plan-more", MORE);
    more.title = "Rename, duplicate or delete";
    more.setAttribute("aria-label", `More options for ${plan.name}`);
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", String(moreFor === plan.id));
    // e.detail is 0 for a keyboard "click" (Enter / Space): then focus moves into the menu.
    more.addEventListener("click", (e) => (moreFor === plan.id ? closeMore() : openMore(plan, more, e.detail === 0)));
    li.append(pick, more);
    return li;
  }

  ctx.on("plans-changed", render);
  render();
}
