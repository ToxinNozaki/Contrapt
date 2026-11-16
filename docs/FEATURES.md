# Contrapt — feature ledger

Status: `[ ]` planned · `[~]` in progress · `[x]` done · `[-]` dropped (say why).
**Never delete a line.** Add new features at the bottom of their section, with the date.

## P0 — Foundations

- [x] Repo folder, git, orientation docs (CLAUDE.md, DESIGN.md, FEATURES.md, EDITLOG.md) — 2026-11-15
- [x] Edit-log hook script + local settings example — 2026-11-15
- [x] npm-workspaces monorepo scaffold: workspaces, `core` package, node:test runner, TypeScript 7 (strict, native type-stripping), Biome lint/format — 2026-11-15
- [x] GitHub Actions CI (lint + typecheck + tests) — 2026-11-15
- [x] LICENSE (MIT), NOTICE, README stub — 2026-11-15
- [~] GitHub repo (public), description, topics — CONTRIBUTING and CI still to do
- [x] Kernel smoke test in Node (extrude, fillet, shell, STEP) and kernel pick — replicad + OCCT, 2026-11-15
- [x] Kernel stdout isolation so the MCP stdio channel can't be corrupted — 2026-11-15

## P1 — Sketch and part modeling

- [ ] Sketch entities: line, arc, circle, rectangle, polygon, ellipse, slot, spline, point
- [ ] Constraints: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
      concentric, midpoint, symmetric, fix; dimensions: distance, angle, radius/diameter
- [~] Named parameters and equations — named params + safe expression evaluator done (2026-11-15); driven/reference dimensions pending
- [ ] Work planes, axes, points; sketch on face
- [~] Extrude — blind, symmetric, new/add/cut done (2026-11-15); through-all and up-to pending
- [ ] Revolve, sweep, loft, coil/spring
- [~] Fillet, chamfer, shell done (2026-11-15); draft and offset face pending
- [ ] Hole wizard (simple, counterbore, countersink, tapped), cosmetic threads
- [ ] Rib, web, emboss/deboss
- [ ] Patterns (rectangular, circular, path), mirror
- [~] Boolean union/cut/intersect done (2026-11-15); split and thicken pending
- [~] Feature timeline with rebuild, suppress, remove done (2026-11-15); reorder and edit-in-place pending
- [ ] Materials library with density, modulus, yield, Poisson, CTE, cost/kg

- [ ] Script sandbox hardening: worker thread + Node permission model (node:vm is not a security boundary) — added 2026-11-15
- [ ] Richer selectors: curve type, face normals, "outer corner edges", named/saved selections (hole seam edges currently count as vertical edges) — added 2026-11-15
- [ ] WASM memory management: explicitly free intermediate shapes in long sessions — added 2026-11-15
- [ ] More primitives in the timeline: cone, torus, ellipsoid, wedge, text — added 2026-11-15
- [ ] Revolve, sweep, loft as timeline ops (kernel supports them; schema/engine don't yet) — added 2026-11-15

## P2 — Query and verify (the AI's eyes)

- [~] Mass properties — volume, area, centre of mass done (2026-11-15); mass (needs materials) and inertia tensor pending
- [~] Bounding box done (2026-11-15); distance between entities and angle between faces pending
- [ ] Section views and cut-plane renders
- [ ] Interference / clearance check between bodies
- [ ] Wall-thickness and minimum-feature analysis
- [~] Selection by description with `expect` — edges (all/direction/plane/length/box), faces (plane/parallelTo) done (2026-11-15); richer selectors pending
- [ ] Render snapshots (PNG) with scale, section, and colour-by-property
- [ ] Topology report (faces/edges/loops) as structured data

## P3 — Assemblies

- [ ] Components, grounding, instance patterns
- [ ] Joints: rigid, revolute, slider, cylindrical, planar, ball, screw
- [ ] Gear, rack, belt/chain, cam relationships
- [ ] Exploded views and assembly sequences
- [ ] Assembly interference and motion-range checks
- [ ] BOM with part numbers and quantities

## P4 — Proof Loop (differentiator)

- [ ] Spec language: geometric, mass, and simulation-backed requirements
- [ ] `check_specs` returning pass/fail with numbers after every change
- [ ] `optimize` over named parameters against specs
- [ ] Design Journal: text model, per-iteration log with metrics and renders
- [ ] Variant compare + Pareto table
- [ ] `what_could_go_wrong` red-team report
- [ ] Mechanism synthesis (path/motion → linkage) — stretch
- [ ] Rules layer (iLogic-style) — stretch

## P5 — Simulation

- [ ] Static FEA: beam elements, validated vs analytic
- [ ] Static FEA: 3D tetrahedral (mesher + solver), stress/displacement/safety factor
- [ ] Modal analysis (natural frequencies/mode shapes)
- [ ] Linear buckling
- [ ] Thermal (steady-state, then transient) — stretch
- [ ] Rigid-body dynamics: motors, springs, dampers, gravity, friction, contacts
- [ ] Motion studies and kinematic sweeps, with plots and playback
- [ ] Gear/linkage mechanisms incl. closed loops
- [ ] Validation suite (cantilever, beam modes, pendulum, four-bar) running in CI
- [ ] Every result reports assumptions and limits

## P6 — Manufacturing and documentation

- [ ] Sheet metal: flange, hem, bend, unfold, flat pattern, DXF
- [ ] Frames/weldments: structural member library, miters, cut list
- [ ] Tube and pipe — stretch
- [ ] Plastic features: boss, rib, lip/groove, snap fit
- [ ] 3D-print checker: overhangs, wall thickness, bridging, supports estimate
- [ ] Laser/CNC export (DXF/SVG nests)
- [ ] 2D drawings: views, sections, details, dimensions, title block, PDF/SVG/DXF
- [ ] Standard parts library: fasteners, bearings, motors, extrusions, with real specs
- [ ] Build Pack: BOM + cut list + files + assembly steps + manufacturability report

## P7 — Interchange

- [~] STEP export done (2026-11-15); import pending
- [~] STL export done (2026-11-15); 3MF, OBJ, glTF pending
- [ ] DXF/SVG export
- [ ] URDF export
- [ ] IGES — stretch

## P8 — Viewer

- [x] Browser viewer (three.js) served on localhost, live-updating as the AI works (SSE; render-on-demand; read-only, Host-checked) — 2026-11-15
- [~] Orbit/pan/zoom, wireframe, edges toggle, fit, live dimension callouts done (2026-11-15); section, explode, interactive measure pending
- [~] Build-report rail (steps with status glyphs, parameters, measured values) done, read-only (2026-11-15); interactive tree/timeline editing pending
- [ ] Simulation playback and result plots
- [ ] Manual modeling UI (so a human can sketch and edit too)

## P9 — MCP and AI integration

- [~] MCP server — stdio done with 13 tools (2026-11-15), tested in-memory and over a real stdio subprocess; streamable HTTP pending
- [~] MCP docs resource (contrapt://docs) done (2026-11-15); model-state resource, materials/parts library, and prompts pending
- [ ] Agent skill / system-prompt pack for Claude, ChatGPT, and local models
- [ ] OpenAI-style function-calling adapter and REST endpoint
- [~] docs/SETUP.md written for Claude Code, Claude Desktop, LM Studio/local (2026-11-15) — NOT yet verified inside the real apps; ChatGPT needs the HTTP transport

## P11 — Sandbox / visualize anything (added 2026-11-15)

- [x] Feature-timeline JSON schema as the single source of truth (tool calls append; scripts compile to it) — 2026-11-15
- [x] Script mode: scripts compile into the same timeline as tool calls (golden-tested identical) — 2026-11-15; `run_script` MCP tool lands with M2
- [ ] Scene: objects with transforms, groups, ground/environment, lights, cameras
- [ ] Approximate geometry layer (mesh/implicit; e.g. manifold-3d) clearly tagged "approximate"
- [ ] Primitive and free-form shape library (spheres, capsules, lathe, noise/organic, text)
- [ ] Mesh import (STL/OBJ/glTF) and CAD import into scenes
- [ ] Materials/colours, labels, dimension callouts, saved camera views
- [ ] Reference objects for scale (human figure, table, door, room)
- [ ] Keyframe animation and simulation playback; GIF/PNG/MP4 snapshot export
- [ ] Scene presets (workshop, studio, outdoors)

- [ ] Verify the stdio server inside real Claude Desktop, Claude Code and LM Studio and record results — added 2026-11-15
- [ ] Streamable HTTP MCP transport (needed for ChatGPT and other remote-only clients) — added 2026-11-15
- [ ] Publishable build: compile TS to dist so `npx contrapt` works (Node refuses to run .ts inside node_modules) — added 2026-11-15
- [ ] Per-op convenience tools (add_box, add_fillet, ...) if weaker/local models struggle with the generic add_step — added 2026-11-15
- [ ] Viewer: click a body to highlight its step, hover to read dimensions, section plane, themes toggle — added 2026-11-15
- [ ] Live human edits in the viewer (change a parameter by dragging/typing) feeding back to the timeline — added 2026-11-15

## P10 — Release

- [~] README quick start written (2026-11-15); GIF/screenshots pending
- [ ] GitHub topics, description, social preview image
- [ ] Examples gallery (bracket, gearbox, linkage, enclosure, robot arm)
- [ ] CI (build, test, validation suite), npm publish, docs site
- [ ] Mirror DESIGN.md to a Claude Docs doc (as in StuntRush) — optional
