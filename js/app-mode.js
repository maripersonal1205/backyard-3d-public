// Which app this page is.
//   Full app (the default): the family site saves to the server; localhost
//   saves in this browser. Its yard is the made-up sample one (js/yards/demo.js):
//   Mari's own yard isn't in this public copy.
//   Demo (DEMO): the public demo site. A made-up yard, nothing is saved anywhere
//   (a reload starts fresh), no server calls, and Generate is turned off.
//
// The demo site's build (tools/stage-deploy.mjs --demo) stamps
// <meta name="app-mode" content="demo">. Only on this Mac can the address
// switch modes, to try things without building: ?demo for the demo, and
// (?yard isn't used here: the only yard is the sample one).
const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const params = LOCAL ? new URLSearchParams(location.search) : new URLSearchParams();

export const DEMO = document.querySelector('meta[name="app-mode"]')?.content === "demo" || params.has("demo");
export const YARD = "demo";
