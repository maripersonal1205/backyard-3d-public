# Backyard 3D

A 3D planner for a backyard, in the browser: arrange trees, furniture and lights, change
the ground surfaces, and walk through the result at any time of day.

I designed and built it to plan my own yard with my family. This repository is a public
copy of the code with a made-up sample yard in place of ours.

**Try it:** [live demo](https://backyard-demo-mhirano.pages.dev)
(nothing you change is saved, and AI creation is switched off).

## What it does

- **Three ways to look:** Orbit around the yard, a top-down Plan view, and Walk at eye
  height (drag to look around, like Street View; WASD or arrow keys to move).
- **Arrange items:** drag trees, plants, furniture and lights in from the Library, then
  move, turn, resize, copy or remove them. Items stay inside the walls; full undo and redo.
- **Ground surfaces:** click a lawn, path or patio and switch it to brick pavers, gravel,
  decking, mulch and more.
- **Real sunlight:** a time-of-day slider moves the sun along its real path for the chosen
  date, with shadows; lamps and string lights switch on at dusk.
- **Create with AI:** describe an item ("cedar-post string lights") and AI builds a 3D
  model for it in a few minutes. You can also import your own `.glb` models.
- **Shared plans:** the family version saves several plans to a server, so everyone can
  open and edit them, behind a family passcode.
- Small screens get a view-only version.

## Design

The layout came from my own wireframes: a toolbar on top, a floating "My items" panel
(All · In use · Generated · Settings) and selection controls at the bottom. The Library's
3D items were made to a written spec ([`LIBRARY_SPEC.md`](LIBRARY_SPEC.md)) so they share
one look, scale and set of rules.

## How it's built

| Part | Technology |
|---|---|
| 3D | [Three.js](https://threejs.org), plain JavaScript modules, no framework or build step |
| Server | Cloudflare Pages Functions ([`functions/`](functions/)) |
| Storage | Cloudflare D1 (plans) and KV (imported and AI-made models) |
| AI items | OpenAI, using the same Python builder that made the Library ([`library/build_library.py`](library/build_library.py)) |
| Demo | The same code in a demo mode: no server, nothing saved, no AI |

I built it with [Claude Code](https://claude.com/claude-code) as my engineering partner,
and the 3D Library items and sample yard with OpenAI's Codex: I made the product and
design decisions and reviewed the results.

## Credits

Ground textures are CC0 from Poly Haven and ambientCG
([`library/surfaces/CREDITS.md`](library/surfaces/CREDITS.md)). 3D library from
[Three.js](https://threejs.org) (MIT).
