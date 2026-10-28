import * as storage from "../storage.js";

export function formatTime(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const HINTS = {
  orbit: "Drag to orbit · right-drag to pan · scroll to zoom · double-click the ground to walk there",
  plan: "Drag to pan · scroll to zoom · double-click the ground to walk there",
  walk: "Drag to look · W A S D to walk · double-click the ground to jump there",
};

export function createToolbar(ctx) {
  const modeButtons = [...document.querySelectorAll("#toolbar [data-mode]")];
  const undoBtn = document.getElementById("undo");
  const redoBtn = document.getElementById("redo");
  const time = document.getElementById("time");
  const timeLabel = document.getElementById("time-label");
  const hint = document.getElementById("hint");
  const hintText = document.getElementById("hint-text");
  // The tip can be closed for good on this device.
  const HINT_KEY = "backyard-hint-hidden";
  hint.hidden = storage.loadFlag(HINT_KEY);
  document.getElementById("hint-close").addEventListener("click", () => {
    hint.hidden = true;
    storage.saveFlag(HINT_KEY);
  });

  for (const b of modeButtons) b.addEventListener("click", () => ctx.views.setMode(b.dataset.mode));
  const syncMode = (mode) => {
    for (const b of modeButtons) {
      b.classList.toggle("active", b.dataset.mode === mode);
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    }
    hintText.textContent = HINTS[mode] + (ctx.viewOnly ? "" : " · double-click an item to select it");
  };
  ctx.on("mode-changed", syncMode);
  ctx.on("view-only-changed", () => syncMode(ctx.views.mode));
  syncMode(ctx.views.mode);

  undoBtn.addEventListener("click", () => ctx.undo());
  redoBtn.addEventListener("click", () => ctx.redo());
  const syncHistory = () => {
    undoBtn.disabled = !ctx.history.canUndo;
    redoBtn.disabled = !ctx.history.canRedo;
  };
  ctx.on("history-changed", syncHistory);
  syncHistory();

  time.value = ctx.env.time;
  timeLabel.textContent = formatTime(ctx.env.time);
  time.addEventListener("input", () => {
    ctx.env.setTime(Number(time.value));
    timeLabel.textContent = formatTime(ctx.env.time);
  });
  time.addEventListener("change", () => ctx.persist());
}
