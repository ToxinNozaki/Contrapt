# Contrapt — design doc

> **Where we left off** (update this at every stop)
> - **Date:** 2026-11-15
> - **Phase:** P0 foundations — nearly done. Public repo live, docs + logging in place, **kernel proven**.
> - **Last thing done:** kernel smoke test passes (8/8): replicad + OpenCASCADE run headless in Node;
>   exact analytic volumes for extrude/cylinder/cut/fillet; shell; STEP export valid; init ~130 ms;
>   extrude+fillet rebuild ~10 ms. `packages/core/src/kernel.js` isolates kernel stdout (MCP-safe).
> - **Decided 2026-11-15 (owner):** the AI describes models **both ways** — step-by-step tool calls
>   *and* scripts — with a saved, diffable **feature timeline (JSON) as the single source of truth**.
>   Scripts compile into the timeline; tool calls append to it. Owner's vision: a **sandbox** where the
>   AI can help visualize *almost anything*, not only mechanical parts (see "Sandbox" below).
> - **Next up:** (1) TypeScript + lint + CI scaffold; (2) the timeline/document model in `core`
>   (JSON schema, rebuild engine, parameters); (3) MCP server skeleton exposing
>   create-sketch / extrude / fillet / measure / export_step plus `run_script`; (4) minimal live viewer.
> - **Open decisions:** none blocking. See "Open questions" at the bottom.

## What this is

Contrapt is an open-source, lightweight parametric CAD application and simulator that an AI
(Claude, ChatGPT, a local model) can fully drive through a built-in MCP server — and that you can
watch and use yourself in a browser viewer. The owner wants to invent things with an AI partner:
describe a contraption, have the AI model it exactly, test it in simulation, and then build it
in real life. It is not for a class assignment; it is a long-running invention workbench.

## Name

**Contrapt** (short for "contraption"). Chosen because it is free on npm, has no CAD collisions on
GitHub, and fits the purpose. The original working title contained "Inventor" (an Autodesk
registered trademark) and "Claude" (Anthropic's); Autodesk's guidelines say not to include their
marks in a product name, so those were dropped. Docs may say "an open-source alternative to
Autodesk Inventor" (referential use). This is general guidance, not legal advice.

## The differentiator: the Proof Loop

Everyone else's AI-CAD is "AI draws a shape." Contrapt's claim is **"the AI proves it works."**

1. **Specs (requirements as code).** Every design carries machine-checked requirements:
   `mass < 200 g`, `tip deflection under 50 N < 1 mm`, `fits 100×100×100`, `output stroke ≥ 30 mm`,
   `prints without supports`. After every change the engine reports pass/fail *with the numbers*.
   The AI is not allowed to say "done" until the spec is green (the tools make this the natural path).
2. **Simulator as judge.** Specs can reference simulation results (stress, deflection, natural
   frequency, mechanism travel, motor load), not just geometry.
3. **Auto-iterate.** An `optimize` tool sweeps/solves over named parameters against the spec
   ("lightest bracket that still passes") in one call, instead of the AI guessing.
4. **Design Journal.** The model is a text file (diffable, git-friendly). Every iteration is logged
   with what changed, why, the metrics, and a render. Variants can be compared on a Pareto table.
5. **Build Pack.** One call emits what you need to actually make it: BOM with real catalogue parts
   (fasteners, bearings, motors), cut list, STEP/STL/DXF, dimensioned drawings, step-by-step
   assembly, and a manufacturability report.
6. **Red-team.** A `what_could_go_wrong` tool runs failure checks (overstress, interference,
   unsupported overhangs, thin walls, mechanism lock-up) and reports the worst offenders.

Later invention extras: mechanism synthesis ("this point should trace this path" → linkage),
rule-driven configuration (an iLogic-style rules layer), generative variants.

## The Sandbox (owner's vision, 2026-11-15)

Contrapt should be a shared workbench where the AI can help the owner **visualize almost anything**:
a gearbox, a room layout, a concept vehicle, a marble run, a robot, a stage set. Engineering-grade
parts (exact B-rep, STEP, simulation) are the core, but the sandbox also needs:

- **Scenes:** many objects with transforms, groups, a ground/environment, lights, and cameras.
- **Free-form shapes:** organic and approximate geometry via a mesh/implicit layer
  (candidate: `manifold-3d`, Apache-2.0) alongside exact B-rep; clearly labelled "approximate".
- **Import/export** of meshes and CAD so things made elsewhere can join the scene.
- **Look and annotate:** materials/colours, labels, dimensions, callouts, saved camera views, images/GIFs.
- **Animate:** keyframes and simulation playback, so ideas can be shown moving.
- **Scale and context:** place things next to a human figure, a table, a room, to judge size.

Design consequence: the timeline holds both *precise parts* and *scene objects*; every object says
whether its geometry is exact or approximate, and the simulator only trusts exact geometry.

## Goals / non-goals / anti-goals

- **Goals:** fully AI-drivable; exact B-rep geometry with real STEP export; honest, validated
  simulation; light and fast (see budget); open source and easy to set up with any AI.
- **Non-goals (for now):** photoreal rendering, PDM/vault, cloud sync, CAM toolpaths, multi-user editing.
- **Anti-goals:** a tool whose simulation looks authoritative but isn't validated; heavy installs;
  a UI-only app the AI can't reach; leaking the owner's personal info into the public repo.

## Scope honesty

Autodesk Inventor took decades and large teams. "Every feature" is delivered **in phases**, each
usable on its own (see [FEATURES.md](FEATURES.md)). Simulation is validated against textbook
cases (cantilever deflection, beam natural frequency, pendulum period) before it is trusted, and
results report their assumptions and limits.

## Architecture (the plan; revisit with evidence)

- **Monorepo, TypeScript, npm workspaces.** Packages: `core` (model + kernel), `sketch` (constraint
  solver), `sim` (FEA + dynamics), `mcp` (server), `viewer` (browser), `cli`.
- **Geometry kernel:** OpenCASCADE via WebAssembly (exact B-rep, STEP). Candidates evaluated:
  `replicad` (+ `replicad-opencascadejs`, 48 MB unpacked), `brepjs`, `occt-wasm` (22 MB unpacked).
  **Decided 2026-11-15: `replicad` 1.2.1 + `replicad-opencascadejs` 1.2.1** (MIT / LGPL-2.1) after the Node
  smoke test passed (see `packages/core/test/kernel-smoke.test.js`). Wasm is ~23 MB unpacked, well inside
  the budget. Gotcha found: OpenCASCADE prints to stdout, which would corrupt MCP stdio — `kernel.js`
  routes all kernel output away from stdout. `brepjs`/`occt-wasm` remain fallback options.
- **Sketch constraints:** `@salusoft89/planegcs` (FreeCAD's solver in WASM, <1 MB).
- **Statics:** own lightweight solver — beam elements first, then 3D tetrahedral — validated
  against analytic cases. No known CalculiX/Elmer WASM port exists, so this is built, not borrowed.
- **Dynamics:** evaluate Rapier (WASM, joints) against a custom multibody solver on closed
  linkages and gear trains before committing.
- **MCP server:** official TypeScript SDK (v1.x unless v2 is stable by build time); stdio for local
  clients, streamable HTTP for others; same tools exposed as an OpenAI-style function list.
- **Viewer:** browser, three.js, served on localhost by the same process; shows the AI's work live.
- **Budget:** install under ~100 MB including WASM; cold start to first solid under ~2 s;
  no Electron.

## How the AI uses it

A tool surface in layers: *model* (sketch, features, assembly), *query* (measure, section,
interference, render), *specs* (define/check), *simulate* (statics, modal, motion), *optimize*,
*export* (STEP/STL/3MF/DXF/glTF/URDF, drawings, Build Pack). Selection is by description
(e.g. "the circular rim of the top face"), with count assertions, not fragile indices.
Every tool returns structured results plus a short human-readable summary.

## Open questions

- Licence: MIT planned for Contrapt code; LGPL components (OpenCASCADE, planegcs) used unmodified
  and credited in NOTICE.md.
- Whether to mirror this doc to a Claude Docs doc like the StuntRush project does (not yet done).
