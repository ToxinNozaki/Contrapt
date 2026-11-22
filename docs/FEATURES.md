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

- [~] Sketch entities: line, arc, circle, rectangle, polygon, ngon, point done (arcs in constrained sketches 2026-11-17); ellipse, slot (as one item), spline pending
- [x] **Constrained sketches (FreeCAD planegcs solver, ~0.5 MB WASM)** - `constrained_sketch` step, 2026-11-17: fix, x/y, coincident, horizontal, vertical, distance, parallel, perpendicular, equalLength, angle, radius, diameter, equalRadius, onLine, onCircle, tangent (line-circle, circle-circle); parameter-driven values; reports degrees of freedom, names conflicting and redundant constraints; solved geometry returned; 13 tests with closed-form checks. Arcs, midpoint/symmetric, driven (reference) dimensions pending
- [ ] (original line, partly done above) Constraints: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
      concentric, midpoint, symmetric, fix; dimensions: distance, angle, radius/diameter
- [~] Named parameters and equations — named params + safe expression evaluator done (2026-11-15); driven/reference dimensions pending
- [ ] Work planes, axes, points; sketch on face
- [~] Extrude — blind, symmetric, new/add/cut done (2026-11-15); through-all and up-to pending
- [~] Revolve, loft and sweep done (2026-11-17; closed-form tested incl. Pappus for bent pipes); coil/spring pending (a sweep with a helical path is the natural route)
- [~] Fillet, chamfer, shell done (2026-11-15); draft and offset face pending
- [x] Hole step (2026-11-17): simple, counterbore, countersink, blind or through, six drilling directions, standard M2-M10 sizes (clearance/close/tap drill), cosmetic thread note, position lists and patterns; every variant closed-form tested; the screw table is tied to the knowledge pack by a test. Real thread geometry pending
- [ ] Rib, web, emboss/deboss
- [~] Patterns: linear and circular done as a step (tool body repeated, cut or add) and inside holes; mirror done (add/new, offset). Path patterns pending (2026-11-17)
- [~] Boolean union/cut/intersect done (2026-11-15); split and thicken pending
- [~] Feature timeline with rebuild, suppress, remove done (2026-11-15); reorder and edit-in-place pending
- [ ] Materials library with density, modulus, yield, Poisson, CTE, cost/kg

- [ ] Script sandbox hardening: worker thread + Node permission model (node:vm is not a security boundary) — added 2026-11-15
- [ ] Richer selectors: curve type, face normals, "outer corner edges", named/saved selections (hole seam edges currently count as vertical edges) — added 2026-11-15
- [ ] WASM memory management: explicitly free intermediate shapes in long sessions — added 2026-11-15
- [ ] More primitives in the timeline: cone, torus, ellipsoid, wedge, text — added 2026-11-15
- [x] Revolve, loft and sweep are timeline ops (2026-11-17). Sweep follow-ups: hollow profiles in one step, helical/spline paths, guide rails, twist — added 2026-11-15

- [x] Arcs in constrained sketches (centre/start/end, ccw; radius/diameter, onCircle, tangent line-arc / arc-arc / circle-arc; mixed line+arc loops, either direction) - 2026-11-17
- [~] Symmetric and midpoint constraints, reference dimensions (pending); sketch on a face of an existing body (done 2026-11-17) - added 2026-11-17
- [ ] Show constrained sketches in the viewer (dimension annotations, constraint glyphs, fully-defined colouring) - added 2026-11-17

- [x] Hole start-point warnings; edge-selector filters lengthAtLeast/lengthAtMost/curve; readable messages for message-less kernel failures; leaner build replies (found by dogfooding, 2026-11-17)
- [x] Face-relative placement: `hole` with `face` + `uv` (+ uvFrom world|center|corner), `sketch`/`constrained_sketch` with `onFace`; picks outermost or nearest planar face by outward normal - 2026-11-17
- [ ] Edge/face classification selectors (convex, concave, outer, "created by step X") and named selections - Ideas Review #1
- [x] Materials library (18 materials: density, E, yield) + `material` step; mass in measure and build feedback; library tied to the Materials pack by a test. Cost/kg and mass-weighted centre of mass still pending (no verified prices) - 2026-11-17
- [x] `check_interference {a, b}` tool: exact overlap volume + bbox, touching, or exact gap (OpenCASCADE distance) - 2026-11-17
- [x] section_properties + beam_check + column_check (analytic, closed-form, validated against textbook values; self weight) - 2026-11-17 (owner said do everything). Proof Loop specs: see Proof Loop section
- [ ] Viewer: constraint glyphs, selection highlight, click a step to focus it - Ideas Review #1

## P2 — Query and verify (the AI's eyes)

- [x] Mass properties: volume, area, centre of mass, mass from material, full inertia tensor, principal moments and inertia about any axis (mass_properties; exact for flat bodies, ~0.5% for curved) - 2026-11-22
- [~] Bounding box done (2026-11-15); distance between entities and angle between faces pending
- [ ] Section views and cut-plane renders
- [x] Interference / clearance check between bodies (check_interference) - 2026-11-17
- [ ] Wall-thickness and minimum-feature analysis
- [~] Selection by description with `expect` — edges (all/direction/plane/length/box), faces (plane/parallelTo) done (2026-11-15); richer selectors pending
- [ ] Render snapshots (PNG) with scale, section, and colour-by-property
- [ ] Topology report (faces/edges/loops) as structured data

## P3 — Assemblies

- [~] Multi-body assemblies: bodies positioned with `transform` or the new face-to-face `mate` step (gap, centre) — no constraint solver, components/grounding/patterns pending - 2026-11-17
- [ ] Joints: rigid, revolute, slider, cylindrical, planar, ball, screw
- [ ] Gear, rack, belt/chain, cam relationships
- [ ] Exploded views and assembly sequences
- [x] Assembly interference (check_assembly: all pairs) and motion-range checks (motion_check: translate/rotate sweep, first collision) - 2026-11-17; dynamics pending
- [~] BOM (bom tool: grouped quantities, mass, totals) done 2026-11-17; part numbers pending

## P4 — Proof Loop (differentiator)

- [x] Spec language (requirements-as-code, saved with the model): dimension, mass, volume, no_interference, min_gap, beam (hand-estimate, flagged); simulation-backed kinds pending real FEA - 2026-11-17
- [x] FEA-backed specs: `frame` (displacement, safety factor, buckling factor, frequency) and `solid_fea` (displacement, safety factor on p99 stress) and `thermal` (max/min temperature) run real finite-element analyses; shown as PENDING in the live status after each change and run by check_specs, optimize_param and build_pack; the optimiser can drive them - 2026-11-23
- [x] `check_specs` + live spec verdict in every tool reply - 2026-11-17
- [x] `optimize_param`: one-parameter sweep + bisection over real rebuilds against specs (multi-parameter pending) - 2026-11-17
- [x] Design Journal (journal_add/get_journal, saved with the model, included in the Build Pack); per-iteration renders and metrics pending - 2026-11-17
- [x] `build_pack` tool: README with verdict, parts, parameters, requirements, journal and caveats + STEP/STL per body + model JSON; `proof_loop` playbook - 2026-11-17
- [ ] Variant compare + Pareto table
- [ ] `what_could_go_wrong` red-team report
- [ ] Mechanism synthesis (path/motion → linkage) — stretch
- [ ] Rules layer (iLogic-style) — stretch

## P5 — Simulation
- [x] Static FEA: 3D beam elements (frame_analysis; nodal + distributed loads, gravity, reactions, member forces, stress, safety factor), validated vs closed-form cantilever, simply supported, fixed-fixed, torsion, axial, gravity, orientation invariance - 2026-11-19
- [x] Static FEA for solids: body-fitted hexahedral mesh (boundary nodes snapped onto the exact surface, distorted Wilson-Taylor elements with Taylor correction, nodal stress recovery) + matrix-free CG (solid_fea). Handbook check: plate-with-hole Kt within 1% at 5 elements per hole radius, 8% at 2.5; round cantilever closer to beam theory than the staircase - 2026-11-22. Still structured: sharp corners and features under ~2 elements are not captured; a true unstructured tetrahedral mesher would remove that
- [x] Modal analysis for frames (frame_modes, consistent mass, Jacobi eigen-solver), validated vs Euler-Bernoulli cantilever and pinned-pinned frequencies (mode shapes pending) - 2026-11-19
- [~] Modal analysis of solids (solid_modes: block inverse iteration with warm-started CG, lumped mass, mode shapes and where each mode moves; validated vs Euler-Bernoulli cantilever frequencies within 1%) and a modal Proof Loop spec - 2026-11-23. Frame mode shapes and modal participation pending
- [~] Linear buckling for frames (frame_buckling: geometric stiffness + generalized eigenproblem; Euler loads for fixed-free, pinned-pinned, fixed-fixed and fixed-pinned columns within 0.5%) - 2026-11-22. Buckling of solids and plates pending
- [~] Thermal: steady-state conduction on the fitted solid mesh with fixed-temperature surfaces, heat input, convection and internal generation, heat balance, cylinder regions (thermal_analysis); thermal stress through the elasticity solve; thermal Proof Loop spec - 2026-11-23. Transients, radiation and temperature-dependent properties pending
- [~] Dynamics: 1-DOF rotary/linear RK4 in SI (dynamics_sim: inertia, damping, spring, pendulum gravity, Coulomb friction, DC-motor line, stops), validated vs pendulum (incl. 90 degree elliptic), spring-mass-damper, motor spin-up, friction stop - 2026-11-22. Multi-body dynamics, contacts and coupled DOFs pending
- [~] Kinematic sweeps: planar linkages via the constraint solver (mechanism_sweep: lock detection, pin paths, joint angles, branch-flip warning) and closed-form four-bar Grashof/transmission analysis (fourbar_check), validated vs slider-crank - 2026-11-22. 3D motion studies, plots and playback pending
- [~] Validation suite: cantilever, beam modes, torsion, gravity run in CI (core/test/fea.test.ts); pendulum and four-bar pending
- [x] Every FEA result reports its assumptions and limits (notes in each reply) - 2026-11-19
- [x] Every result reports assumptions and limits (frame_analysis, solid_fea, beam_check, print_check all carry notes) - 2026-11-19

## P6 — Manufacturing and documentation

- [ ] Sheet metal: flange, hem, bend, unfold, flat pattern, DXF
- [ ] Frames/weldments: structural member library, miters, cut list
- [ ] Tube and pipe — stretch
- [ ] Plastic features: boss, rib, lip/groove, snap fit
- [~] 3D-print checker (print_check): overhang area, support-volume upper bound, six-orientation advice, bed contact, thin walls by ray casting, build-volume fit - 2026-11-19; bridging and tiny-feature checks pending
- [ ] Laser/CNC export (DXF/SVG nests)
- [~] 2D drawings: SVG sheet with third-angle front/top/right views, hidden lines, overall dimensions, auto standard scale and title block (drawing tool) done 2026-11-19; section views, detail views, hole/feature dimensions, tolerances, PDF and DXF pending
- [ ] Standard parts library: fasteners, bearings, motors, extrusions, with real specs
- [ ] Build Pack: BOM + cut list + files + assembly steps + manufacturability report

## P7 — Interchange

- [x] STEP import and export — import is a timeline step with scale/position and a checksum (2026-11-15)
- [~] STL export done (2026-11-15); 3MF, OBJ, glTF pending
- [ ] DXF/SVG export
- [ ] URDF export
- [ ] IGES — stretch

- [x] Format detection and plain-language guidance for ~25 CAD formats (Inventor .ipt/.iam/.idw/.ipn, SolidWorks, Fusion, CATIA, NX/Creo, Rhino, FreeCAD, Parasolid, ACIS, DWG/DXF, meshes) — 2026-11-15
- [x] Inventor .ipt/.iam/.idw/.ipn native inspection, no Inventor needed: Inventor version, part number, material, author, container facts, and the embedded preview image (returned to the AI as an MCP image and saved under previews/). Defensive parser (fuzzed with truncated/corrupt input). Verified on a real Inventor 2026.4 part — 2026-11-15
- [x] **Inventor geometry works via the open-source cadmpeg CLI** - VERIFIED 2026-11-15 on a real Inventor 2026.4 part: dialect `inventor:cfb3-rse31-meta8` detected, B-rep decoded (1 body, 217 faces, 515 edges, check OK), converted to a 210 KB STEP, imported by Contrapt as an exact solid measuring 6 x 4 x 0.875 in (clean inch values: independent evidence the conversion is right); visually matches the file's own preview. Sketches/features/history are NOT transferred (design intent stays native). Earlier research notes: Rust, Apache-2.0, Inventor support "L3" = connected B-rep from the part-kernel (ACIS) carrier, read-only; envelope CFB v3 + RSe schema 31 + Meta v8; partial assemblies/materials. Remaining: more samples (assemblies .iam, older/newer versions), an easier install path — Rust, Apache-2.0, Inventor support at "L3" = connected B-rep from the part-kernel (ACIS) carrier, read-only; declared envelope CFB v3 + RSe schema 31 + Meta Stream v8 (verified ACIS majors 217/218); partial assemblies/materials/design intent; no feature history; nobody can say if a given 2026 file is inside the envelope without running it. NEXT: build it in an isolated scratch folder (needs the owner's OK) and try the sample; if it works, wrap it as an optional external `convert_file` tool (allow-listed args, files only from the imports folder).
- [x] `convert_file` tool: runs an optional external converter (cadmpeg) with FIXED arguments on plain names inside the imports folder only; the user enables it with `--cadmpeg <path>` / `CONTRAPT_CADMPEG`; output must be a real STEP file; 5 tests with a stand-in converter — 2026-11-15
- [ ] More converters behind the same safe wrapper (other open-source or user-installed tools); a local-Inventor bridge — 2026-11-15
- [ ] Inventor bridge A: drive a locally installed Inventor (Windows automation / Apprentice) to export STEP from .ipt/.iam and DXF/DWG/PDF from .idw — requested 2026-11-15
- [ ] Inventor bridge B: Autodesk Platform Services Model Derivative adapter (IPT/IAM to STEP/OBJ/STL/IGES; user supplies their own credentials; .idw only converts to viewer formats there) — requested 2026-11-15
- [ ] .idw drawings: import as 2D reference (via DXF/PDF), pull dimensions and notes where possible — requested 2026-11-15
- [ ] IGES import; mesh import (STL/OBJ/3MF/glTF as approximate bodies); DXF/SVG 2D import into sketches — 2026-11-15
- [ ] STEP assembly structure kept (separate parts, names, colours) instead of one compound body — 2026-11-15
- [ ] STEP unit detection with warnings; imported-body validity/healing checks — 2026-11-15
- [ ] Native readers for SolidWorks/Fusion/CATIA/NX/Creo (all proprietary; STEP route for now) — 2026-11-15

- [x] Tool results can carry images (MCP image blocks), so clients that can see images get previews — 2026-11-15
- [x] `render_view` tool + pure-JS software renderer (no browser/GPU): shaded solids, feature edges, axis triad, iso/front/back/left/right/top/bottom or custom angles, up to 6 views per call, images returned to the AI and saved under renders/ — 2026-11-17 (about 160 ms for a 217-face part)
- [ ] Renderer upgrades: smooth-shaded curved surfaces without faceting, section views, dimension overlays, side-by-side with a reference image, highlight a body/face by id — added 2026-11-17
- [ ] Script mode: `importFile` alias exists because `import` is reserved JavaScript; keep other step names clear of reserved words — noted 2026-11-17
- [x] Playbook `recreate_from_reference`: rebuild a part from a preview/reference with a fidelity statement — 2026-11-15

- [ ] Gated real-file regression harness (`CONTRAPT_SAMPLE_IPT` + `CONTRAPT_CADMPEG`) built 2026-11-15; collect a few permissively licensed sample Inventor files (assemblies, older versions) to test against - added 2026-11-15
- [ ] Parametric recovery from converted files: decode sketches/features/parameters (cadmpeg reports them as unresolved) so imported parts keep editable dimensions - long-term, depends on converter progress

## P8 — Viewer

- [x] Browser viewer (three.js) served on localhost, live-updating as the AI works (SSE; render-on-demand; read-only, Host-checked) — 2026-11-15
- [~] Orbit/pan/zoom, wireframe, edges toggle, fit, live dimension callouts done (2026-11-15); section, explode, interactive measure pending
- [~] Build-report rail (steps with status glyphs, parameters, measured values) done, read-only (2026-11-15); interactive tree/timeline editing pending
- [ ] Simulation playback and result plots
- [ ] Manual modeling UI (so a human can sketch and edit too)

## P9 — MCP and AI integration

- [x] MCP server: stdio (tested in-memory and over a real subprocess) and streamable HTTP (2026-11-17): sessions, bearer token, Host/Origin checks, body cap, shared design across clients, refuses non-local hosts without a token; tested with the SDK client. NOT yet tried with ChatGPT itself
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
- [~] Materials/colours and labels in the viewer done 2026-11-22; dimension callouts and saved camera views pending
- [ ] Reference objects for scale (human figure, table, door, room)
- [ ] Keyframe animation and simulation playback; GIF/PNG/MP4 snapshot export
- [ ] Scene presets (workshop, studio, outdoors)

- [ ] Verify the stdio server inside real Claude Desktop, Claude Code and LM Studio and record results — added 2026-11-15
- [x] Streamable HTTP MCP transport — built 2026-11-17 (verify with ChatGPT and OAuth-style auth if required)
- [x] Publishable build (2026-11-17): `packages/contrapt` bundles the CLI with esbuild (153 KB; heavy deps stay external), ships the knowledge packs and viewer, `npm run smoke:pack` packs it, installs the tarball into a clean folder and drives it as a real MCP client (21 tools, OpenCASCADE + solver WASM, STEP export, render, knowledge, viewer incl. three.js); runs in CI. NOT yet published to npm (needs the owner's npm account)
- [ ] Per-op convenience tools (add_box, add_fillet, ...) if weaker/local models struggle with the generic add_step — added 2026-11-15
- [x] Viewer: click a body to select it (glow + info card with material, mass, size), section plane (X/Y/Z with slider, cut face filled toward the camera), colour by material, body labels, light/dark/auto theme switch (remembered), Requirements panel with live Proof Loop PASS/FAIL and reasons, Design Journal, material and mass in the Measured table - 2026-11-22. Hover dimensions and step-click highlighting pending
- [ ] Live human edits in the viewer (change a parameter by dragging/typing) feeding back to the timeline — added 2026-11-15

## P12 — Engineering knowledge and advanced prompts (added 2026-11-15)
- [x] Knowledge-pack system: markdown packs with front matter, loader, tools (list_knowledge/get_knowledge), MCP resources — 2026-11-15
- [x] 18 packs: engineering method, safety and ethics, strength and stiffness, materials, fasteners and joints, tolerances and fits, 3D printing, CNC and laser, sheet metal, molding and casting, mechanisms, motors and electronics, thermal and fluids, structures and frames, robotics and controls, failure modes, importing CAD files, Contrapt modelling patterns — 2026-11-15
- [x] 10 playbooks (advanced prompts): engineer, design_part, design_review, design_for_process, strength_check, size_mechanism, brainstorm_invention, recreate_from_reference, explain_design, build_pack; as MCP prompts and as the get_playbook tool — 2026-11-15
- [x] Tests recompute every worked example in the packs, check links/front matter, and block personal info — 2026-11-15
- [ ] Expand packs: gears in depth, welding design, springs, bearings selection, vibration and acoustics, composites, electronics enclosures/EMC, woodworking joinery, CNC fixturing, cost estimating, ergonomics, fluid power circuits — see knowledge/README.md
- [ ] Citations for every number in the packs, plus an expert-review pass (invite engineers via GitHub) — added 2026-11-15
- [ ] Export packs as a Claude agent skill bundle and a ChatGPT custom-instructions file — added 2026-11-15
- [ ] More playbooks: enclosure design, robot arm design, woodworking, mechanism synthesis, product teardown, cost-down — added 2026-11-15
- [ ] Wire packs into the Proof Loop: specs and checks that cite the pack rules (e.g. min wall for the chosen process) — added 2026-11-15

## P10 — Release

- [~] README quick start written (2026-11-15); GIF/screenshots pending
- [ ] GitHub topics, description, social preview image
- [ ] Examples gallery (bracket, gearbox, linkage, enclosure, robot arm)
- [ ] CI (build, test, validation suite), npm publish, docs site
- [ ] Mirror DESIGN.md to a Claude Docs doc (as in StuntRush) — optional
