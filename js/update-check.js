// "A new version is available" notice. Each deploy stamps viewer.html with a
// version (<meta name="app-version">) and publishes version.json with the same
// value (tools/stage-deploy.mjs). If the published one changes while the page
// is open, offer a reload. Checked every few minutes and when the tab comes
// back into view. Skipped when the page isn't a deployed build ("dev").
const CHECK_MS = 5 * 60_000;

export function createUpdateCheck() {
  const mine = document.querySelector('meta[name="app-version"]')?.content;
  if (!mine || mine === "dev") return;
  const note = document.getElementById("update-note");
  let last = 0;

  async function check() {
    if (!note.hidden || Date.now() - last < 30_000) return;
    last = Date.now();
    try {
      const res = await fetch("version.json", { cache: "no-store" });
      if (!res.ok) return;
      const { version } = await res.json();
      if (version && version !== mine) note.hidden = false;
    } catch {
      // Offline or locked: try again later.
    }
  }

  // Leaving the page flushes any unsaved changes (the backends save on pagehide).
  document.getElementById("update-reload").addEventListener("click", () => location.reload());
  setInterval(check, CHECK_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}
