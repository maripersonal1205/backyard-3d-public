import * as THREE from "three";
import { pointInYard } from "./yard.js";

const RING_COLOR = 0xff4d1f;
const NUDGE = 0.1, NUDGE_BIG = 0.5; // metres per arrow key press (Shift for big)
const TURN_STEP = THREE.MathUtils.degToRad(5); // dragging the turn handle snaps to 5° (Mari)
const PASTE_STEP = 0.6;
const DOUBLE_TAP_MS = 400, TAP_MOVE_PX = 6; // selecting an item takes a double click / double tap (Mari) // metres between a pasted or duplicated copy and the one before it
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

// Ellipse outline lying flat on the ground, used as the selection indicator
// and as the drop preview while dragging from the My items panel.
function makeRing(opacity) {
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: RING_COLOR, transparent: true, opacity,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  mesh.renderOrder = 999;
  mesh.visible = false;
  return mesh;
}

function shapeRing(mesh, fp) {
  const rx = ((fp.maxX - fp.minX) / 2) * 1.08 + 0.15;
  const rz = ((fp.maxZ - fp.minZ) / 2) * 1.08 + 0.15;
  const w = THREE.MathUtils.clamp(Math.max(rx, rz) * 0.045, 0.04, 0.12);
  const n = 72, pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * rx, 0, s * rz, c * (rx + w), 0, s * (rz + w));
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  mesh.geometry.dispose();
  mesh.geometry = g;
  mesh.position.set((fp.minX + fp.maxX) / 2, 0.03, (fp.minZ + fp.maxZ) / 2);
  mesh.visible = true;
}

// Rectangle outline just inside a ground area's edges (ground selection).
function shapeRect(mesh, fp) {
  const inset = 0.04, w = 0.08;
  const x0 = fp.minX + inset, x1 = fp.maxX - inset, z0 = fp.minZ + inset, z1 = fp.maxZ - inset;
  const outer = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const inner = [[x0 + w, z0 + w], [x1 - w, z0 + w], [x1 - w, z1 - w], [x0 + w, z1 - w]];
  const pos = [], idx = [];
  for (let i = 0; i < 4; i++) pos.push(outer[i][0], 0, outer[i][1], inner[i][0], 0, inner[i][1]);
  for (let i = 0; i < 4; i++) {
    const a = i * 2, b = ((i + 1) % 4) * 2;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  mesh.geometry.dispose();
  mesh.geometry = g;
  mesh.position.set(0, 0.03, 0);
  mesh.visible = true;
}

// Round handle on the selection ring for turning the item by dragging it
// around. A sprite with a fixed on-screen size, drawn on top of everything.
const HANDLE_PX = 26; // on-screen diameter, also the grab area
function makeHandle() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fillStyle = "#fff"; g.fill();
  g.lineWidth = 12; g.strokeStyle = "#ff4d1f"; g.stroke();
  // The inspector's "Turn right" arrow (its 24-unit SVG paths), so it reads as "turn".
  g.save();
  g.translate(64 - 12 * 2.9, 64 - 12 * 2.9);
  g.scale(2.9, 2.9);
  g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#1c261e";
  g.stroke(new Path2D("M21 12a9 9 0 1 1-3-6.7L21 8"));
  g.stroke(new Path2D("M21 3v5h-5"));
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false }));
  sprite.renderOrder = 1000;
  sprite.visible = false;
  return sprite;
}

const isGround = (x) => x?.kind === "ground";
// Items the pointer can drag or turn: not ground, not fixed to the house.
const isMovable = (x) => !!x && !isGround(x) && !x.attached;

const isStructure = (o) => {
  for (; o; o = o.parent) if (o.name === "structures") return true;
  return false;
};

// Selecting, dragging, keyboard shortcuts and double-click-to-walk.
export function createInteraction(ctx) {
  const { camera, renderer, controls, items, views, scene } = ctx;
  const canvas = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ring = makeRing(0.95);
  const preview = makeRing(0.45);
  const outline = makeRing(0.95);
  const handle = makeHandle();
  scene.add(ring, preview, outline, handle);

  let selected = null;
  let drag = null;         // item being dragged in the scene
  let pressedEmpty = null; // pointer went down on empty space (click → deselect)
  let pressedItem = null;  // pointer went down on an item that isn't selected (a tap, if it doesn't move)
  let lastTap = null;      // { item, time, x, y }: the first tap of a possible double tap
  let turning = null;      // item being turned with the ring's handle
  let clipboard = null;    // ⌘C: { item, t, colors, pastes }
  let pointer = null;      // where the pointer last was over the scene (⌘V pastes there)
  canvas.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerleave", () => { pointer = null; });

  function setRay(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function itemAt(clientX, clientY) {
    setRay(clientX, clientY);
    const objects = items.placedItems().filter((i) => i.pickable).map((i) => i.object);
    const hit = raycaster.intersectObjects(objects, true)[0];
    return hit ? items.fromObject(hit.object) : null;
  }

  function groundPoint(clientX, clientY) {
    setRay(clientX, clientY);
    const p = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
  }

  // The ground area under the pointer, if the first thing hit is ground
  // (not an item, wall or the house).
  function groundAreaAt(clientX, clientY) {
    setRay(clientX, clientY);
    const hit = raycaster.intersectObject(ctx.model, true)[0];
    return hit ? ctx.ground.fromMesh(hit.object) : null;
  }

  function updateRing() {
    ring.visible = outline.visible = handle.visible = false;
    if (isGround(selected)) shapeRect(outline, selected.footprint);
    else if (selected && selected.placed) {
      const fp = items.footprint(selected);
      shapeRing(ring, fp);
      if (isMovable(selected)) placeHandle(fp);
    }
  }

  // The handle sits on the ring on the side the item faces (its front, +z).
  function placeHandle(fp) {
    const cx = (fp.minX + fp.maxX) / 2, cz = (fp.minZ + fp.maxZ) / 2;
    const rx = ((fp.maxX - fp.minX) / 2) * 1.08 + 0.15, rz = ((fp.maxZ - fp.minZ) / 2) * 1.08 + 0.15;
    const dx = Math.sin(selected.t.r), dz = Math.cos(selected.t.r);
    const k = 1 / Math.hypot(dx / rx, dz / rz);
    handle.position.set(cx + dx * k, 0.03, cz + dz * k);
    sizeHandle();
    handle.visible = true;
  }

  // Keep the handle the same size on screen, whatever the canvas size.
  function sizeHandle() {
    const h = canvas.clientHeight || 1;
    const s = (HANDLE_PX / h) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    handle.scale.set(s, s, 1);
  }

  function onHandle(clientX, clientY) {
    if (!handle.visible) return false;
    const r = canvas.getBoundingClientRect();
    const p = handle.position.clone().project(camera);
    if (p.z > 1) return false;
    const x = r.left + ((p.x + 1) / 2) * r.width, y = r.top + ((1 - p.y) / 2) * r.height;
    return Math.hypot(clientX - x, clientY - y) <= HANDLE_PX / 2 + 4;
  }

  // Angle of the pointer around the item's pivot, on the ground.
  function angleAround(item, clientX, clientY) {
    const p = groundPoint(clientX, clientY);
    return p ? Math.atan2(p.x - item.t.p[0], p.z - item.t.p[2]) : null;
  }

  function select(item) {
    if (item && ctx.viewOnly) item = null; // narrow screens can't edit (view-only.js)
    if (item === selected) return;
    selected = item || null;
    updateRing();
    document.body.classList.toggle("has-selection", !!selected);
    ctx.emit("selection-changed", selected);
  }

  function moveTo(item, x, z) {
    items.setTransform(item, items.fit(item, { ...item.t, p: [x, item.t.p[1], z] }));
    updateRing();
    return true;
  }

  // ---- Pointer: an item under the pointer is always grabbed first; otherwise
  // the current view's own camera drag (orbit / pan / look) takes over. ----
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (onHandle(e.clientX, e.clientY)) {
      const a = angleAround(selected, e.clientX, e.clientY);
      if (a !== null) {
        turning = { item: selected, start: a, r: selected.t.r, moved: false };
        controls.enabled = false;
        canvas.style.cursor = "grabbing";
        return;
      }
    }
    const item = itemAt(e.clientX, e.clientY);
    if (!item) {
      pressedEmpty = { x: e.clientX, y: e.clientY };
      views.beginDrag(e);
      return;
    }
    // Only a selected item can be dragged. Pressing on any other item moves the
    // camera like empty space; a double click / double tap selects it (pointerup).
    // Attached items stay put even when selected.
    if (item !== selected || !isMovable(item)) {
      if (item !== selected) pressedItem = { item, x: e.clientX, y: e.clientY };
      views.beginDrag(e);
      return;
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -item.t.p[1]);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    drag = {
      item, plane, x: e.clientX, y: e.clientY, moved: false,
      offset: new THREE.Vector3(item.t.p[0] - hit.x, 0, item.t.p[2] - hit.z),
    };
    controls.enabled = false; // stop OrbitControls from rotating under the drag
    canvas.style.cursor = "grabbing";
  });

  window.addEventListener("pointermove", (e) => {
    if (turning) {
      const a = angleAround(turning.item, e.clientX, e.clientY);
      if (a === null) return;
      const r = Math.round((turning.r + (a - turning.start)) / TURN_STEP) * TURN_STEP;
      if (Math.abs(r - turning.item.t.r) < 1e-9) return;
      turning.moved = true;
      const t = { ...turning.item.t, r };
      items.setTransform(turning.item, items.fit(turning.item, t));
      updateRing();
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.moved = true;
      setRay(e.clientX, e.clientY);
      const p = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(drag.plane, p)) moveTo(drag.item, p.x + drag.offset.x, p.z + drag.offset.z);
      return;
    }
    if (views.drag(e)) return;
    if (e.target === canvas) scheduleHover(e.clientX, e.clientY);
  });

  window.addEventListener("pointerup", (e) => {
    if (turning) {
      const { moved, item } = turning;
      turning = null;
      controls.enabled = views.mode === "orbit";
      canvas.style.cursor = "grab";
      if (moved) ctx.commit("turn:" + item.id);
      return;
    }
    if (drag) {
      const moved = drag.moved;
      drag = null;
      controls.enabled = views.mode === "orbit";
      canvas.style.cursor = "grab";
      if (moved) ctx.commit();
      return;
    }
    views.endDrag();
    if (pressedItem) {
      const { item, x, y } = pressedItem;
      pressedItem = null;
      if (Math.hypot(e.clientX - x, e.clientY - y) < TAP_MOVE_PX) {
        const now = performance.now();
        const second = lastTap && lastTap.item === item && now - lastTap.time < DOUBLE_TAP_MS
          && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
        if (second) { lastTap = null; select(item); }
        else lastTap = { item, time: now, x: e.clientX, y: e.clientY };
      }
      return;
    }
    // A click (not a drag) on empty space selects the ground area there, or
    // deselects when it's not ground (sky, walls, house).
    if (pressedEmpty && Math.hypot(e.clientX - pressedEmpty.x, e.clientY - pressedEmpty.y) < 4) {
      select(groundAreaAt(e.clientX, e.clientY));
    }
    pressedEmpty = null;
  });

  let hoverQueued = null;
  function scheduleHover(x, y) {
    if (hoverQueued) { hoverQueued = { x, y }; return; }
    hoverQueued = { x, y };
    requestAnimationFrame(() => {
      const item = onHandle(hoverQueued.x, hoverQueued.y) ? selected : itemAt(hoverQueued.x, hoverQueued.y);
      canvas.style.cursor = item ? (item === selected && isMovable(item) ? "grab" : "pointer") : "";
      hoverQueued = null;
    });
  }

  // ---- Double-click the ground (any view) to stand there in Walk mode ----
  canvas.addEventListener("dblclick", (e) => {
    setRay(e.clientX, e.clientY);
    const hit = raycaster.intersectObject(ctx.model, true)[0];
    if (!hit) return;
    const item = items.fromObject(hit.object);
    if ((item && item.pickable) || isStructure(hit.object)) return;
    if (!pointInYard(hit.point.x, hit.point.z)) return;
    select(null); // the first click of the double-click selected the ground there
    views.walkTo(hit.point.x, hit.point.z);
  });

  // ---- Keyboard ----
  function nudge(item, forward, right, step) {
    // "Up" is away from you in the current view, projected onto the ground.
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-4) { f.set(0, 1, 0).applyQuaternion(camera.quaternion); f.y = 0; }
    f.normalize();
    const dx = (f.x * forward - f.z * right) * step;
    const dz = (f.z * forward + f.x * right) * step;
    if (moveTo(item, item.t.p[0] + dx, item.t.p[2] + dz)) ctx.commit("nudge:" + item.id);
  }

  const ARROWS = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const WASD = { KeyW: [1, 0], KeyS: [-1, 0], KeyA: [0, -1], KeyD: [0, 1] };

  window.addEventListener("keydown", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    const typing = !!el?.closest("input, textarea, select, [contenteditable]");
    const mod = e.metaKey || e.ctrlKey;
    // Narrow screens can't edit (view-only.js): only walking keys work.
    if (ctx.viewOnly && (mod || typing)) return;

    if (mod && e.key.toLowerCase() === "z") {
      if (typing) return; // let text fields keep their own undo
      e.preventDefault();
      e.shiftKey ? ctx.redo() : ctx.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); ctx.redo(); return; }
    if (typing) {
      if (e.key === "Escape") el.blur();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && copyKeys(e)) return;
    if (mod || e.altKey) return;

    if (e.key === "Escape") { select(null); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && selected && !isGround(selected)) {
      e.preventDefault();
      ctx.actions.remove(selected);
      return;
    }
    if (ARROWS[e.key] && isMovable(selected)) {
      e.preventDefault();
      nudge(selected, ...ARROWS[e.key], e.shiftKey ? NUDGE_BIG : NUDGE);
      return;
    }
    if (views.mode === "walk") {
      const m = WASD[e.code] || ARROWS[e.key];
      if (m) { e.preventDefault(); views.walkStep(...m); }
    }
  });

  // ⌘C / ⌘V / ⌘D (Ctrl on Windows). Copy remembers the selected item; paste
  // puts a copy under the pointer when it's over the yard, otherwise a little
  // way from the last one; duplicate puts a copy next to the selected item.
  function copyKeys(e) {
    const key = e.key.toLowerCase();
    const item = isGround(selected) ? null : selected;
    const offset = (t, n) => ({ ...t, p: [t.p[0] + PASTE_STEP * n, t.p[1], t.p[2] + PASTE_STEP * n] });
    if (key === "c" && item) {
      if (window.getSelection()?.toString()) return false; // copying text on the page
      e.preventDefault();
      if (item.attached) { ctx.toast(`The ${item.label.toLowerCase()} is fixed to the ${item.attached} and can't be copied.`); return true; }
      clipboard = { item, t: structuredClone(item.t), colors: { ...item.colors }, pastes: 0 };
      ctx.toast(`Copied ${item.label}. ${MOD}V to paste.`);
      return true;
    }
    if (key === "v" && clipboard) {
      e.preventDefault();
      const p = pointer && groundPoint(pointer.x, pointer.y);
      const t = p && pointInYard(p.x, p.z)
        ? { ...clipboard.t, p: [p.x, clipboard.t.p[1], p.z] }
        : offset(clipboard.t, ++clipboard.pastes);
      ctx.actions.copyFrom(clipboard.item, { t, colors: clipboard.colors });
      return true;
    }
    if (key === "d" && item) {
      e.preventDefault(); // not the browser's bookmark shortcut
      ctx.actions.copyFrom(item, { t: offset(item.t, 1), colors: item.colors });
      return true;
    }
    return false;
  }

  addEventListener("resize", sizeHandle);

  ctx.on("items-changed", () => {
    if (selected && !isGround(selected) && (!selected.exists || !selected.placed)) select(null);
    else updateRing();
  });

  return {
    get selected() { return selected; },
    select,
    groundPoint,
    // Ring showing where a panel item would land; pass null to hide it.
    showDropPreview(item, clientX, clientY) {
      const p = item && groundPoint(clientX, clientY);
      const t = p && items.fit(item, item.attached ? item.t : { ...item.t, p: [p.x, item.t.p[1], p.z] });
      if (t) shapeRing(preview, items.footprint(item, t));
      else preview.visible = false;
    },
    // Same for a Library item type (no ring until its model has loaded).
    showLibraryPreview(key, clientX, clientY) {
      const p = groundPoint(clientX, clientY);
      const t = p && ctx.actions.libraryFit(key, p.x, p.z);
      if (t) shapeRing(preview, items.footprint(items.templates[key], t));
      else preview.visible = false;
    },
  };
}
