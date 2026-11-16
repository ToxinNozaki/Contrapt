# Contrapt — roadmap

A living document. **Claude is the lead coder** of this project and owns keeping this roadmap honest;
the owner sets direction and approves big bets. Updated whenever scope, order, or status changes —
never left to rot. Detail per feature lives in [FEATURES.md](FEATURES.md); the "why" lives in
[DESIGN.md](DESIGN.md); what changed lives in [EDITLOG.md](EDITLOG.md).

_Last updated: 2026-11-15 · Current milestone: **M2**_

## How this roadmap stays alive

1. **Update on every stop.** When work lands or plans change: tick the milestone, adjust "Now / Next /
   Later", and refresh the date above. Same rule as the other logs.
2. **Ideas Review at ~80%.** When a milestone's exit criteria are about 80% met, Claude runs an
   _Ideas Review_ before closing it out:
   - Re-read the Proposed Ideas backlog below; promote, reshape, or drop items (never silently delete —
     mark dropped with a reason).
   - Dogfood: build something real with Contrapt and note every place it fought us.
   - Scan the field (new AI-CAD/MCP projects, kernels, solvers) for things we should match or beat.
   - Add the best new ideas, each with _why it matters_ and a rough size. Big bets go to the owner for a
     yes/no; small ones Claude just adds and builds.
3. **Claude proposes, the owner steers.** Claude adds its own features over time (that is the job);
   anything with a real tradeoff gets pushed back on and surfaced before building.
4. **Every milestone ships something usable** and an example built with it, so the project is never a
   pile of half-features.
5. **Honesty gate for simulation:** no sim feature is "done" until it passes the validation suite.

## Versions at a glance

| Version | Milestone | You can…                                                                            |
| ------- | --------- | ----------------------------------------------------------------------------------- |
| 0.1     | M1–M2     | Tell an AI to model a part; watch it live; export STEP/STL                          |
| 0.2     | M3–M4     | Constrained sketches, full part features, measure/section/interference              |
| 0.3     | M5        | The **Proof Loop**: specs, auto-check, optimize, journal                            |
| 0.4     | M6        | Assemblies, joints, exploded views, BOM                                             |
| 0.5     | M7–M8     | Validated stress/vibration and motion simulation                                    |
| 0.6     | M9        | The **Sandbox**: scenes, free-form shapes, animation, scale references              |
| 0.7     | M10       | Drawings, sheet metal, frames, print/laser checks, **Build Pack**                   |
| 0.8     | M11       | Standard-parts library, plugin API, ContraptBench                                   |
| 1.0     | M12       | Polished release: docs site, gallery, npm publish, setup guides for every AI client |

## Milestones

Status: ☐ not started · ◐ in progress · ☑ done. "Done when" = exit criteria.

### M0 — Foundations ☑

Repo, docs, logging, kernel proof. **Done when:** TypeScript + lint + CI green on every push; kernel
smoke test runs in CI. _(met)_

- ☑ Public repo, docs, edit-log hook, kernel proven (8/8), stdout isolation
- ☑ TypeScript, lint, CI (workflow added; first run verified on GitHub)

### M1 — Model core ☑

The feature-timeline JSON (single source of truth), rebuild engine, parameters, tool-call API and
script compiler. **Done when:** a script and an equivalent sequence of tool calls produce an identical
timeline and identical geometry (golden tests); editing a parameter rebuilds correctly.

### M2 — MCP server + live viewer ◐ (about 85%)

stdio + HTTP MCP server; browser viewer on localhost showing the AI's work live. **Done when:** from a
clean clone, one command starts it, Claude Desktop/Claude Code connect, and "make a bracket with four
mounting holes" appears in the viewer and exports to STEP. Includes first setup guides.
_Status:_ server (13 tools), live viewer, and SETUP.md are built and tested (16 MCP tests, incl. a real stdio subprocess). **Also added:** 18 engineering knowledge packs and 9 playbooks (advanced prompts) as MCP prompts, resources and tools; STEP import with format detection for ~25 CAD formats. Verified in real Claude Code (`claude mcp list`: Connected). **Remaining:** Claude Desktop and LM Studio checks; publishable `npx` build; HTTP transport.

### M3 — Sketch and part depth ☐

planegcs-backed constrained sketches; extrude/revolve/sweep/loft, fillet/chamfer/shell/draft, holes,
patterns, mirror, booleans, work planes, feature edit/suppress/reorder. **Done when:** a library of
~20 reference parts rebuilds with correct volume/area/centre of mass.

### M4 — Query and verify ☐

Measure, section, interference, wall-thickness, selection-by-description with `expect`, render
snapshots for the AI to _see_ its work. **Done when:** the AI can detect and fix its own mistakes in a
scripted "broken part" benchmark.

### M5 — The Proof Loop ☐ (the differentiator)

Specs-as-code, `check_specs`, `optimize`, Design Journal, variant compare, `what_could_go_wrong`.
**Done when:** "lightest bracket that holds 50 N with <1 mm deflection" is solved end-to-end by an AI
in one conversation, and the journal shows every iteration.

### M6 — Assemblies ☐

Components, joints (rigid/revolute/slider/cylindrical/planar/ball), gears/racks/belts/cams, exploded
views, interference + range-of-motion checks, BOM. **Done when:** a multi-part gearbox assembles,
moves through its joint ranges, and produces a BOM.

### M7 — Static and modal simulation ☐

Beam solver, then 3D tetrahedral (mesher + solver), stress/displacement/safety factor, modal,
buckling. **Done when:** validation suite (cantilever, beam modes, plate-with-hole, Euler buckling)
passes within stated tolerances and runs in CI; every result prints its assumptions and limits.

### M8 — Dynamics and mechanisms ☐

Rigid-body dynamics, motors/springs/dampers/friction/contacts, closed linkages and gear trains, motion
studies, plots, playback. Rapier-vs-custom decision made by a benchmark on four-bars and gear trains.
**Done when:** pendulum period, four-bar kinematics, and gear ratios match analytic answers.

### M9 — The Sandbox ☐

Scenes, lights, cameras, free-form/approximate geometry layer, mesh import, materials, labels,
saved views, scale references, keyframe animation, GIF/PNG export. **Done when:** "show me a marble
run on a desk next to a coffee mug" builds, renders, and animates in one session.

### M10 — Make it real ☐

2D drawings, sheet metal, frames/weldments, plastic features, 3D-print/laser/CNC checkers, **Build
Pack** (BOM + cut list + files + assembly steps + manufacturability report). **Done when:** one
example design goes from prompt to a printable/cuttable pack and is actually built.

### M11 — Ecosystem ☐

Importers for other CAD systems (Inventor bridge adapters and an experimental native .ipt/.iam reader; .idw as 2D reference; IGES, mesh, DXF), standard-parts library (real specs), plugin API, OpenAI-style function adapter + REST, agent
skill/prompt packs, **ContraptBench** (public AI-CAD eval). **Done when:** a third party can add a part
library or tool without touching core; the benchmark runs against at least three models.

### M12 — 1.0 release ☐

Docs site, examples gallery, GIF-first README, social preview, npm publish, per-client setup guides
(Claude Desktop, Claude Code, ChatGPT, LM Studio/Ollama), contribution guide. **Done when:** a stranger
goes from README to first modeled part in under five minutes.

## Now / Next / Later

- **Now:** M2 — MCP server + live viewer (the first "wow").
- **Next:** M3 — sketch constraints and part depth (revolve/sweep/loft, holes, patterns); M4 — query and verify.
- **Later:** M3 onward in order; Proof Loop (M5) deliberately lands before assemblies because it is
  what makes the project different.

## Proposed Ideas (Claude's backlog — promoted at each Ideas Review)

Each: _why it matters_ · size (S/M/L) · status. Big bets are marked 🎯 and need the owner's yes.

- **ContraptBench** — public benchmark of how well LLMs model real objects from a prompt, scored by
  measured geometry and sim results. Gives the project a reason to be cited and a way to measure our own
  progress. · M · planned in M11, may pull earlier 🎯
- **Sim-to-real calibration** — tell Contrapt what you measured on the real thing (a printed arm sagged
  2.3 mm); it recalibrates material/stiffness assumptions so the next prediction is better. Nobody
  does this in a hobbyist tool. · M · proposed 🎯
- **Tolerance and fit analysis** — printer/laser tolerance profiles, clearance stack-ups, "will these
  parts actually fit together after printing?" · M · proposed
- **Teaching mode** — "explain why this fails" in plain language with the stress picture; fits the owner's
  invent-and-learn goal. · S · proposed
- **Cost and lead-time estimator** — material + machine time + parts-library prices in the Build Pack. · S
- **Motor/battery sizing helper** — pick a motor and gearing from required torque/speed, power budget. · M
- **Mechanism synthesis** — give a target path or motion, get a linkage. · L · stretch
- **Topology optimisation** — carve away unneeded material under load (SIMP method). · L · stretch 🎯
- **Design branches and time travel** — git-like branches of a design, diffable timelines, one-click
  revert. · M (timeline JSON makes this cheap)
- **Multi-agent review** — a designer agent and a separate reviewer/red-team agent via the same MCP,
  with disagreements logged in the journal. · M
- **Photo/sketch to starting model** — AI reads a reference image and drafts the first timeline. · M
- **AR/real-scale preview** — glTF export with true scale to place in a room on a phone. · S
- **Slicer/laser-nest preview** — estimate print time and material before committing. · M
- **Reproducible designs** — hash a timeline + library versions; same hash, same geometry, always. · S
- **Electronics envelope** — place boards, wires, and connectors for fit and clearance (not PCB layout). · M

### Added 2026-11-15 (owner requests and Claude's follow-ups)
- **Inventor file support** — read .ipt/.iam directly and treat .idw as reference. Closed formats, so the plan is
  layered: STEP today (works), then a local-Inventor bridge and an Autodesk cloud-converter adapter, then an
  experimental native reader if the open-source codec proves reliable. · L · in the ledger (P7) 🎯
- **Knowledge-pack accuracy program** — cite sources for every number and invite engineers to review packs; wrong
  confident numbers are the biggest risk of an "engineering AI". · M · proposed
- **Ship the packs as an agent skill** — a Claude skill bundle and a ChatGPT custom-instructions file generated from the
  same markdown. · S · proposed

## Risks and how we handle them

| Risk                                        | Plan                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Every feature of Inventor" is unbounded    | Phased milestones; each ships usable; ledger tracks the long tail                  |
| Simulation looks authoritative but is wrong | Validation suite in CI; results print assumptions and limits                       |
| 3D FEA is hard (no existing WASM solver)    | Beam solver first; tetrahedral second; optional external-solver bridge as fallback |
| Rapier may handle closed linkages poorly    | Benchmark before committing; custom multibody solver as plan B                     |
| Kernel wasm is large (~23 MB)               | Within budget; lazy-load; revisit smaller builds later                             |
| Naming/trademark                            | Original name; referential use only; non-affiliation notice                        |
| Scope creep from the Sandbox                | Exact vs approximate geometry is always labelled; sim trusts only exact            |
| Confident-but-wrong engineering numbers | Packs flag typical values, tests recompute worked examples, citations + expert review planned, safety pack requires human review for critical designs |
| Proprietary CAD formats (Inventor etc.) | Recognise and explain now; STEP route works; bridges/native readers phased in; never pretend to read what we cannot |
| Public repo leaking personal info           | Standing rule + pre-commit scan; noreply git identity                              |
