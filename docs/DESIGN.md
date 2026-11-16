# Contrapt — design doc

> **Where we left off** (update this at every stop)
> - **Date:** 2026-11-15
> - **Phase:** P0 foundations — repo, docs, logging hook created; kernel not yet integrated.
> - **Last thing done:** project folder + orientation docs + feature ledger written.
> - **Next up:** scaffold the npm-workspaces monorepo, prove the kernel in Node
>   (sketch → extrude → fillet → measure → STEP export), then the MCP server skeleton.
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
  Final pick is made by a Node smoke test (extrude/fillet/shell/STEP) — decision logged in EDITLOG.
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

- Final kernel package (see Architecture) — decided by smoke test.
- Licence: MIT planned for Contrapt code; LGPL components (OpenCASCADE, planegcs) used unmodified
  and credited in NOTICE.md.
- Whether to mirror this doc to a Claude Docs doc like the StuntRush project does (not yet done).
