// Screens narrower than 1000px are for looking only (Mari, 2026-10-02): My
// items, undo/redo and the plan menu's edit options are hidden, items and
// ground can't be selected, and editing keys do nothing. A note at the bottom
// of the yard view says to use a larger screen. Views, time of day, switching
// plans and double-click-to-walk still work. Applies to the family app and the
// demo.
const QUERY = matchMedia("(max-width: 999.98px)");
const EDGE = 12, GAP = 8; // px: window edge margin, gap between toolbar groups (viewer.css)

export function createViewOnly(ctx) {
  const toolbar = document.getElementById("toolbar");
  const planBar = document.querySelector("#plan-switcher .plan-bar");
  const hint = document.getElementById("hint");
  const note = document.querySelector(".view-only-note");

  // With My items hidden, the toolbar shares the top row with the plan
  // switcher when there's room: centred as on wide screens, or else just right
  // of the plan switcher. Otherwise it keeps its own row below (viewer.css).
  function placeToolbar() {
    toolbar.classList.remove("top-row");
    if (!ctx.viewOnly) return;
    const groups = [...toolbar.querySelectorAll(".tb-group")].filter((g) => g.offsetParent);
    const width = groups.reduce((w, g) => w + g.offsetWidth, 0) + GAP * (groups.length - 1);
    const left = Math.max((innerWidth - width) / 2, planBar.getBoundingClientRect().right + EDGE);
    if (left + width > innerWidth - EDGE) return;
    toolbar.style.setProperty("--top-row-left", left + "px");
    toolbar.classList.add("top-row");
  }

  // The note sits just above the tip ("Drag to orbit…"), or at the bottom when
  // the tip isn't showing (closed for good, or hidden on phones).
  function placeNote() {
    const h = hint.offsetHeight;
    note.style.bottom = h ? `${EDGE + h + GAP}px` : "";
  }

  const apply = () => {
    ctx.viewOnly = QUERY.matches;
    document.body.classList.toggle("view-only", ctx.viewOnly);
    if (ctx.viewOnly) {
      ctx.select?.(null);
      for (const d of document.querySelectorAll("dialog[open]")) d.close();
    }
    placeToolbar();
    ctx.emit("view-only-changed", ctx.viewOnly);
  };
  QUERY.addEventListener("change", apply);
  addEventListener("resize", placeToolbar);
  new ResizeObserver(placeToolbar).observe(planBar); // plan name or "Saving…" changes its width
  new ResizeObserver(placeNote).observe(hint); // also fires when the tip is closed or hidden
  apply();
}
