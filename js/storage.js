// Saves plans and time of day in this browser only. Storage can be
// unavailable (private windows, blocked site data), so failures are ignored.
//
// Saved shape: { plans: [{ id, name, layout }], currentId, time }.
// Layouts saved before plans existed ("backyard-layout-v1") become "My plan".
// In the shared app the plans live on the server, and only this device's open
// plan and time of day are kept here ("backyard-device-v1").
// The demo site keeps nothing: every read finds nothing and writes are skipped.
import { DEMO } from "./app-mode.js";

const KEY = "backyard-plans-v1";
const OLD_KEY = "backyard-layout-v1";
const DEVICE_KEY = "backyard-device-v1";
const SETTINGS_KEY = "backyard-settings-v1"; // My items → Settings, per device

function read(key) {
  if (DEMO) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function load() {
  const data = read(KEY);
  if (Array.isArray(data?.plans) && data.plans.length) return data;
  const old = read(OLD_KEY);
  if (old?.layout?.items) {
    return { plans: [{ id: "plan-1", name: "My plan", layout: old.layout }], currentId: "plan-1", time: old.time };
  }
  return null;
}

export function save(data) {
  write(KEY, data);
}

export const loadDevice = () => read(DEVICE_KEY);
export const saveDevice = (data) => write(DEVICE_KEY, data);
export const loadSettings = () => read(SETTINGS_KEY) || {};
export const saveSettings = (data) => write(SETTINGS_KEY, data);
// Yes/no flags, e.g. "the tip was closed" (stored as 1).
export const loadFlag = (key) => read(key) === 1;
export const saveFlag = (key) => write(key, 1);

function write(key, data) {
  if (DEMO) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* not persisted this time */
  }
}
