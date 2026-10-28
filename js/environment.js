import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { COLOR_PRESETS } from "./config.js";

// Sky, sun and lighting driven by a time of day between 6:00 and 20:00 (clock
// time in the chosen Pacific time zone). The sun follows its real path over
// Northern California on the chosen date (My items → Settings; Mari,
// 2026-10-01). Before sunrise and after sunset the yard dims to twilight.
// Compass: the yard faces the way the back of the house looks (-z), South by
// default (Mari's yard), so the rear wall (-z) is south, the house (+z) north,
// the left wall (-x) east and the right wall (+x) west. Settings can turn it
// to any of the eight compass points (Mari, 2026-10-02).
const SUN_LOW = new THREE.Color(1.0, 0.58, 0.32);
const SUN_HIGH = new THREE.Color(1.0, 0.97, 0.92);
const SKYLIGHT_LOW = new THREE.Color(0xffc9a3);
const SKYLIGHT_HIGH = new THREE.Color(0xd9e7f6);
const HAZE_LOW = new THREE.Color(0xe6c2a6);
const HAZE_HIGH = new THREE.Color(0xc4d6e6);
const TWILIGHT = new THREE.Color(0x9aa8d4); // sky light after sunset
const HAZE_NIGHT = new THREE.Color(0x3c4560);

// How much sunlight a shadow blocks (1 = all of it). Full-strength shadows made
// the area under the canopy too dark to see (Mari, 2026-09-30).
const SHADOW_STRENGTH = 0.6;

const LATITUDE = 38; // degrees north
const LONGITUDE = -122; // degrees east

// Pacific time zones offered in Settings: id -> hours from UTC.
export const TIME_ZONES = {
  PDT: { label: "Pacific Daylight", offset: -7 },
  PST: { label: "Pacific Standard", offset: -8 },
};

// The zone US clocks use on a date: daylight time from the second Sunday in
// March to the first Sunday in November.
export function zoneOn(year, month, day) {
  const nthSunday = (m, n) => {
    const first = new Date(year, m - 1, 1).getDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const key = month * 100 + day;
  return key >= 300 + nthSunday(3, 2) && key < 1100 + nthSunday(11, 1) ? "PDT" : "PST";
}

// Which way the yard faces (from the house towards the rear wall, -z):
// id -> label and compass bearing in degrees.
export const FACINGS = {
  N: { label: "North", bearing: 0 },
  NE: { label: "Northeast", bearing: 45 },
  E: { label: "East", bearing: 90 },
  SE: { label: "Southeast", bearing: 135 },
  S: { label: "South", bearing: 180 },
  SW: { label: "Southwest", bearing: 225 },
  W: { label: "West", bearing: 270 },
  NW: { label: "Northwest", bearing: 315 },
};

const dayOfYear = (month, day) => {
  const start = Date.UTC(2026, 0, 1);
  return Math.round((Date.UTC(2026, month - 1, day) - start) / 86400000) + 1;
};

// The sun's elevation above the horizon and its compass bearing (0 = north,
// 90 = east), in degrees, at a clock time in hours on a date (NOAA's
// approximations for the declination and the equation of time).
function sunAt(hours, { month, day, offset }) {
  const g = (2 * Math.PI / 365) * (dayOfYear(month, day) - 1 + (hours - 12) / 24);
  const declination = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g); // radians
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); // minutes
  const solarHours = hours - offset + LONGITUDE / 15 + equationOfTime / 60;
  const h = THREE.MathUtils.degToRad(15 * (solarHours - 12)); // hour angle
  const lat = THREE.MathUtils.degToRad(LATITUDE);
  const dec = declination;
  const elev = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h));
  const bearing = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
  return { elevDeg: THREE.MathUtils.radToDeg(elev), bearing };
}

export function createEnvironment({ scene, renderer }) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const sky = new Sky();
  sky.scale.setScalar(1500);
  // The stock Sky shader is tuned for a much lower tone-mapping exposure than
  // the yard needs, so give it its own exposure to keep the blue from washing out.
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace("uniform float mieDirectionalG;", "uniform float mieDirectionalG;\nuniform float skyExposure;")
    .replace("gl_FragColor = vec4( retColor, 1.0 );", "gl_FragColor = vec4( retColor * skyExposure, 1.0 );");
  const u = sky.material.uniforms;
  u.skyExposure = { value: 0.5 };
  u.turbidity.value = 2.5;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  scene.add(sky);

  // Neighbouring ground beyond the walls, fading into haze at the horizon.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(600, 48),
    new THREE.MeshLambertMaterial({ color: 0x74825d })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.fog = new THREE.Fog(HAZE_HIGH.clone(), 40, 520);

  // Sky light from above, light bounced off the ground from below. Both are
  // fairly strong so that shade (under the canopy, walls facing away from the
  // sun) stays easy to see (Mari, 2026-09-30).
  const hemi = new THREE.HemisphereLight(SKYLIGHT_HIGH.clone(), 0x8a8c78, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.intensity = SHADOW_STRENGTH;
  scene.add(hemi, sun, sun.target);

  const center = new THREE.Vector3();
  let radius = 12;

  // Lamps: materials that glow in their own model file (string-light bulbs and
  // the like; not a COLOR_PRESETS `glow`, which only brightens fabric). They're
  // off by day and come on around sunset (Mari, 2026-10-01).
  const isLamp = (m) => {
    if (m.userData.lamp === undefined) {
      m.userData.lamp = !!m.emissive && m.emissive.getHex() !== 0 && !COLOR_PRESETS[m.name]?.glow;
    }
    return m.userData.lamp;
  };

  const today = new Date();
  const env = {
    time: 10,
    lampLevel: 0, // 0 = lamps off, 1 = fully on

    // Apply lampLevel to every lamp in the scene (also after items are added).
    // A lit lamp skips tone mapping, which would wash its warm glow out to a
    // flat cream or white; an unlit one is shaded like everything else.
    updateLamps() {
      const lit = env.lampLevel > 0;
      scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) {
          if (!isLamp(m)) continue;
          m.emissiveIntensity = env.lampLevel;
          if (m.toneMapped === lit) { m.toneMapped = !lit; m.needsUpdate = true; }
        }
      });
    },
    // The date (any year) and time zone the sun is worked out for.
    date: { month: today.getMonth() + 1, day: today.getDate() },
    zone: zoneOn(today.getFullYear(), today.getMonth() + 1, today.getDate()),

    setDate(month, day, zone) {
      env.date = { month, day };
      if (zone) env.zone = zone;
      env.setTime(env.time);
    },

    // Which way the yard faces (a FACINGS id).
    facing: "S",
    setFacing(id) {
      if (!FACINGS[id]) return;
      env.facing = id;
      env.setTime(env.time);
    },

    // Aim the sun's shadow camera at the model once it has loaded.
    fitTo(box) {
      box.getCenter(center);
      radius = box.getSize(new THREE.Vector3()).length() / 2;
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -radius;
      cam.right = cam.top = radius;
      cam.near = 0.5;
      cam.far = radius * 4 + 10;
      cam.updateProjectionMatrix();
      sun.target.position.copy(center);
      env.setTime(env.time);
    },

    setTime(hours) {
      env.time = hours;
      const { bearing, elevDeg: trueElev } = sunAt(hours, { ...env.date, offset: TIME_ZONES[env.zone].offset });
      // The light never comes from below the horizon: below 2° it stays at 2°
      // and fades out instead (gone by sunset), while the sky darkens.
      const elevDeg = Math.max(trueElev, 2);
      const elev = THREE.MathUtils.degToRad(elevDeg);
      // The sun's bearing relative to the way the yard faces: straight ahead
      // is -z, 90° clockwise is +x.
      const rel = bearing - THREE.MathUtils.degToRad(FACINGS[env.facing].bearing);
      const dir = new THREE.Vector3(
        Math.sin(rel) * Math.cos(elev),
        Math.sin(elev),
        -Math.cos(rel) * Math.cos(elev)
      );
      sun.position.copy(center).addScaledVector(dir, radius * 2 + 5);
      // The sky shader gets the real sun, so it reddens and darkens after sunset.
      const sky = THREE.MathUtils.degToRad(Math.max(trueElev, -12));
      u.sunPosition.value.set(dir.x, Math.sin(sky), dir.z).normalize();

      const k = THREE.MathUtils.smoothstep(elevDeg, 2, 30); // 0 at dawn/dusk → 1 by mid-morning
      const up = THREE.MathUtils.smoothstep(trueElev, -1, 2); // direct sunlight: 0 once the sun has set
      const day = THREE.MathUtils.smoothstep(trueElev, -10, 0); // twilight: 0 by about 45 min after sunset
      sun.color.copy(SUN_LOW).lerp(SUN_HIGH, k);
      sun.intensity = (0.8 + 2.0 * k) * up;
      hemi.color.copy(TWILIGHT).lerp(SKYLIGHT_LOW, day).lerp(SKYLIGHT_HIGH, k);
      hemi.intensity = 1.0 + (0.4 + 0.4 * k) * day; // night stays light enough to plan by
      scene.fog.color.copy(HAZE_NIGHT).lerp(HAZE_LOW, day).lerp(HAZE_HIGH, k);
      u.skyExposure.value = 0.5 + 1.5 * (1 - day); // keep a little colour in the dusk sky
      renderer.toneMappingExposure = 0.68 + 0.07 * day + 0.1 * k;
      // Lamps start coming on just before sunset and are fully on about 20 min after.
      env.lampLevel = 1 - THREE.MathUtils.smoothstep(trueElev, -4, 1);
      env.updateLamps();
    },
  };
  return env;
}
