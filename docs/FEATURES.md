# Contrapt — feature ledger

Status: `[ ]` planned · `[~]` in progress · `[x]` done · `[-]` dropped (say why).
**Never delete a line.** Add new features at the bottom of their section, with the date.

## P0 — Foundations
- [x] Repo folder, git, orientation docs (CLAUDE.md, DESIGN.md, FEATURES.md, EDITLOG.md) — 2026-11-15
- [x] Edit-log hook script + local settings example — 2026-11-15
- [~] npm-workspaces monorepo scaffold — workspaces + `core` package + node:test runner done; TypeScript and lint still to do
- [x] LICENSE (MIT), NOTICE, README stub — 2026-11-15
- [~] GitHub repo (public), description, topics — CONTRIBUTING and CI still to do
- [x] Kernel smoke test in Node (extrude, fillet, shell, STEP) and kernel pick — replicad + OCCT, 2026-11-15
- [x] Kernel stdout isolation so the MCP stdio channel can't be corrupted — 2026-11-15

## P1 — Sketch and part modeling
- [ ] Sketch entities: line, arc, circle, rectangle, polygon, ellipse, slot, spline, point
- [ ] Constraints: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
      concentric, midpoint, symmetric, fix; dimensions: distance, angle, radius/diameter
- [ ] Named parameters and equations; driven/reference dimensions
- [ ] Work planes, axes, points; sketch on face
- [ ] Extrude (blind, symmetric, through-all, up-to), cut variants
- [ ] Revolve, sweep, loft, coil/spring
- [ ] Fillet, chamfer, shell, draft, offset face
- [ ] Hole wizard (simple, counterbore, countersink, tapped), cosmetic threads
- [ ] Rib, web, emboss/deboss
- [ ] Patterns (rectangular, circular, path), mirror
- [ ] Boolean combine/cut/intersect, split, thicken
- [ ] Feature history/timeline with edit-and-rebuild, suppress, reorder
- [ ] Materials library with density, modulus, yield, Poisson, CTE, cost/kg

## P2 — Query and verify (the AI's eyes)
- [ ] Mass properties: volume, area, mass, centre of mass, inertia tensor
- [ ] Bounding box, distance between entities, angle between faces
- [ ] Section views and cut-plane renders
- [ ] Interference / clearance check between bodies
- [ ] Wall-thickness and minimum-feature analysis
- [ ] Selection by description with count assertions (`expect`)
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
- [ ] STEP import/export
- [ ] STL, 3MF, OBJ, glTF export
- [ ] DXF/SVG export
- [ ] URDF export
- [ ] IGES — stretch

## P8 — Viewer
- [ ] Browser viewer (three.js) served on localhost, live-updating as the AI works
- [ ] Orbit/pan/zoom, section, explode, wireframe, measure
- [ ] Feature tree and timeline panel
- [ ] Simulation playback and result plots
- [ ] Manual modeling UI (so a human can sketch and edit too)

## P9 — MCP and AI integration
- [ ] MCP server (stdio + streamable HTTP) exposing all layers
- [ ] MCP resources (model state, docs, material/parts library) and prompts
- [ ] Agent skill / system-prompt pack for Claude, ChatGPT, and local models
- [ ] OpenAI-style function-calling adapter and REST endpoint
- [ ] Setup guides per client (Claude Desktop, Claude Code, ChatGPT, LM Studio/Ollama)

## P11 — Sandbox / visualize anything (added 2026-11-15)
- [ ] Feature-timeline JSON schema as the single source of truth (tool calls append; scripts compile to it)
- [ ] Script mode: `run_script` compiles a sandboxed script into timeline steps
- [ ] Scene: objects with transforms, groups, ground/environment, lights, cameras
- [ ] Approximate geometry layer (mesh/implicit; e.g. manifold-3d) clearly tagged "approximate"
- [ ] Primitive and free-form shape library (spheres, capsules, lathe, noise/organic, text)
- [ ] Mesh import (STL/OBJ/glTF) and CAD import into scenes
- [ ] Materials/colours, labels, dimension callouts, saved camera views
- [ ] Reference objects for scale (human figure, table, door, room)
- [ ] Keyframe animation and simulation playback; GIF/PNG/MP4 snapshot export
- [ ] Scene presets (workshop, studio, outdoors)

## P10 — Release
- [ ] README with GIF/screenshots and 60-second quick start
- [ ] GitHub topics, description, social preview image
- [ ] Examples gallery (bracket, gearbox, linkage, enclosure, robot arm)
- [ ] CI (build, test, validation suite), npm publish, docs site
- [ ] Mirror DESIGN.md to a Claude Docs doc (as in StuntRush) — optional
