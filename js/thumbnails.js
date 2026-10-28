import * as THREE from "three";

// Renders small item pictures for the My items panel. Uses the main renderer
// (drawing into a corner of its canvas and copying the pixels out before the
// next frame) so textures aren't uploaded to a second context.
export function createThumbnailer(renderer, size = 104) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1ea);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f80, 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 6, -4);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 500);

  const out = document.createElement("canvas");
  out.width = out.height = size;
  const g = out.getContext("2d");

  // `front` is the side the item faces: -1 for the yard model's own items
  // (viewed from the yard side), +1 for Library items, which face +z.
  return function render(tpl, front = -1) {
    const src = renderer.domElement;
    if (src.width < size || src.height < size) return ""; // no room to draw (e.g. a hidden tab)
    const cssSize = size / renderer.getPixelRatio();
    const exposure = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1;
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, cssSize, cssSize);
    renderer.setScissor(0, 0, cssSize, cssSize);

    const obj = tpl.object.clone(true);
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    scene.add(obj);
    const center = tpl.box.getCenter(new THREE.Vector3());
    const dims = tpl.box.getSize(new THREE.Vector3());
    const flat = dims.y < 0.2 * Math.max(dims.x, dims.z);
    // Seen from the front, slightly from above; flat things from overhead.
    const dir = flat ? new THREE.Vector3(0.2, 1, 0.5 * front) : new THREE.Vector3(0.7, 0.45, front);
    const radius = Math.max(dims.x, dims.y, dims.z) / 2;
    cam.position.copy(center).addScaledVector(dir.normalize(), (radius / Math.sin(THREE.MathUtils.degToRad(15))) * 1.05);
    cam.lookAt(center);
    renderer.render(scene, cam);
    g.drawImage(src, 0, src.height - size, size, size, 0, 0, size, size);
    scene.remove(obj);

    renderer.setScissorTest(false);
    const full = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, full.x, full.y);
    renderer.toneMappingExposure = exposure;
    return out.toDataURL("image/png");
  };
}

// Pictures of the yard model's own items, keyed by item type.
export function renderThumbnails(render, items) {
  const thumbs = {};
  for (const [key, tpl] of Object.entries(items.templates)) thumbs[key] = render(tpl);
  return thumbs;
}
