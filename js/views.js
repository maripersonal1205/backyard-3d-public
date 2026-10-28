import * as THREE from "three";
import { clampPoint } from "./yard.js";
import { PLAN_FRAME } from "./config.js";

const EYE_HEIGHT = 1.65;
const WALK_STEP = 0.55;
const BODY_RADIUS = 0.25; // how close Walk mode can get to a wall or the house
const LOOK_SPEED = 0.0028;

// Camera modes: Orbit (OrbitControls), Plan (top-down pan/zoom) and Walk
// (first person at eye height, kept inside the yard). Each mode remembers its
// own camera when you switch away and back.
export function createViews(ctx) {
  const { camera, controls, renderer, bounds } = ctx;
  const canvas = renderer.domElement;
  const saved = {};
  let mode = "orbit";
  let yaw = 0, pitch = 0;
  let look = null; // last pointer position while dragging to pan (Plan) or look (Walk)

  const yawFacing = (fx, fz) => Math.atan2(-fx, -fz);
  const applyWalkRotation = () => camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));

  // Camera distance that fits a `w` × `h` area on screen, whatever the window shape.
  function fitDistance(w, h) {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return Math.max(h / 2 / tan, w / 2 / (tan * camera.aspect)) * 1.1;
  }

  // Default Orbit view: from above the rear wall, looking across the yard at the house.
  function frameOrbit() {
    controls.target.set(bounds.center.x, 0.5, bounds.center.z * 0.5);
    const dist = fitDistance(bounds.size.x, bounds.size.z * 0.8);
    camera.position.copy(controls.target).add(new THREE.Vector3(0.25, 0.75, -0.62).normalize().multiplyScalar(dist));
  }

  function setMode(next, walkAt = null) {
    if (next === mode && !walkAt) return;
    saved[mode] = { position: camera.position.clone(), target: controls.target.clone(), yaw, pitch };
    mode = next;
    look = null;
    camera.up.set(0, 1, 0);
    controls.enabled = mode === "orbit";
    const s = saved[mode];

    if (mode === "orbit") {
      if (s) {
        camera.position.copy(s.position);
        controls.target.copy(s.target);
      } else {
        frameOrbit();
      }
      controls.update();
    } else if (mode === "plan") {
      if (s) {
        camera.position.copy(s.position);
      } else if (PLAN_FRAME) {
        // The yard's file can ask Plan to fit just the yard, not the whole model.
        const { minX, maxX, minZ, maxZ } = PLAN_FRAME;
        camera.position.set((minX + maxX) / 2, fitDistance(maxX - minX, maxZ - minZ), (minZ + maxZ) / 2);
      } else {
        camera.position.set(bounds.center.x, fitDistance(bounds.size.x, bounds.size.z), bounds.center.z);
      }
      camera.up.set(0, 0, -1); // rear wall at the top of the screen
      camera.lookAt(camera.position.x, 0, camera.position.z);
    } else {
      let spot = walkAt || (s ? { x: s.position.x, z: s.position.z, yaw: s.yaw } : ctx.walkSpawn);
      const p = clampPoint(spot.x, spot.z, BODY_RADIUS) || spot;
      camera.position.set(p.x, EYE_HEIGHT, p.z);
      yaw = spot.yaw;
      pitch = walkAt || !s ? 0 : s.pitch;
      applyWalkRotation();
    }
    ctx.emit("mode-changed", mode);
  }

  // Double-click target: stand at x/z, facing the way the camera already looks.
  function walkTo(x, z) {
    const f = new THREE.Vector3();
    if (mode === "plan") f.set(0, 0, -1);
    else {
      camera.getWorldDirection(f);
      f.y = 0;
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    }
    setMode("walk", { x, z, yaw: yawFacing(f.x, f.z) });
  }

  // One step in Walk mode. Stepping into a wall or the house stops you flush
  // against it and slides you along it, rather than stopping dead.
  function walkStep(forward, right) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const p = clampPoint(
      camera.position.x + (fx * forward + rx * right) * WALK_STEP,
      camera.position.z + (fz * forward + rz * right) * WALK_STEP,
      BODY_RADIUS
    );
    if (p) camera.position.set(p.x, EYE_HEIGHT, p.z);
  }

  function beginDrag(e) {
    if (mode !== "orbit") look = { x: e.clientX, y: e.clientY };
  }

  // Returns true if the pointer move was used to pan/look.
  function drag(e) {
    if (!look) return false;
    const dx = e.clientX - look.x, dy = e.clientY - look.y;
    look = { x: e.clientX, y: e.clientY };
    if (mode === "plan") {
      const perPx = (2 * camera.position.y * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvas.clientHeight;
      camera.position.x -= dx * perPx;
      camera.position.z -= dy * perPx;
      camera.lookAt(camera.position.x, 0, camera.position.z);
    } else {
      // Grab-the-world, like Street View: drag left to turn right, drag up to look down.
      yaw += dx * LOOK_SPEED;
      pitch = THREE.MathUtils.clamp(pitch + dy * LOOK_SPEED, -1.35, 1.35);
      applyWalkRotation();
    }
    return true;
  }

  function endDrag() { look = null; }

  canvas.addEventListener("wheel", (e) => {
    if (mode !== "plan") return;
    e.preventDefault();
    const maxH = Math.max(bounds.size.x, bounds.size.z) * 3 + 20;
    camera.position.y = THREE.MathUtils.clamp(camera.position.y * Math.exp(e.deltaY * 0.001), 2, maxH);
    camera.lookAt(camera.position.x, 0, camera.position.z);
  }, { passive: false });

  frameOrbit();
  controls.update();

  return {
    get mode() { return mode; },
    setMode, walkTo, walkStep, beginDrag, drag, endDrag,
  };
}
