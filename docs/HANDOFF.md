# HANDOFF: read this first after any context reset

_Written 2026-11-17 at the end of session 2, right before a context compaction. It is the complete "where we are and exactly what to do next"._
Read order for a fresh session: this file, then `CLAUDE.md`, `docs/DESIGN.md` (header), `docs/ROADMAP.md` (Ideas Review #1), `docs/FEATURES.md`, tail of `docs/EDITLOG.md`.

## 1. State in one paragraph
Contrapt is a public MIT repo (https://github.com/ToxinNozaki/Contrapt, branch `main`, latest commit `ada9b22` + this handoff). It is an AI-drivable
parametric CAD workbench: TypeScript npm-workspaces monorepo, OpenCASCADE (via `replicad`) for exact geometry, FreeCAD's `planegcs` solver for
constrained sketches, an MCP server (stdio + HTTP) with 21 tools, a live three.js viewer, a pure-JS renderer so the AI can see its model, 18 engineering
knowledge packs + 10 playbooks, STEP import, Inventor support (metadata/preview natively, geometry via the optional `cadmpeg` converter), and a
publishable `contrapt` npm package with a clean-install smoke test. **123 core + 66 mcp tests pass (after batch 2); CI (Node 22 and 24, lint + typecheck + tests +
package smoke test) is green.** M0, M1 done; M2 about 95% (only owner steps left); M3 part-modelling feature-complete for now; Ideas Review #1 done.

## 2. Layout
- `packages/core`: timeline schema (`timeline.ts`), rebuild engine (`engine.ts`), builder (`builder.ts`), script compiler (`script.ts`), constrained-sketch solver adapter (`sketch.ts`), holes (`holes.ts`),
  patterns/mirror (`pattern.ts`), sweep path (`path.ts`), import/format detection (`import.ts`), Inventor reader (`inventor.ts`, fixture in `inventor-fixture.ts`), exports/meshing (`export.ts`),
  renderer (`render.ts`), measurement (`measure.ts`), kernel bootstrap (`kernel.ts`), expressions (`expr.ts`).
- `packages/mcp`: `session.ts`, `server.ts`, `tools.ts` (+ `tools-import.ts`, `tools-convert.ts`, `tools-knowledge.ts`, `tools-render.ts`, `all-tools.ts`), `prompts.ts` (playbooks), `knowledge.ts` + `knowledge/*.md` (18 packs), `docs.ts` (AI-facing reference, `get_docs`), `viewer.ts`, `http.ts`, `cli.ts`, `demo.ts`.
- `packages/viewer/public`: viewer client (index.html, main.js, style.css). `packages/contrapt`: publishable bundle (`build.mjs`, esbuild). `tools/`: `log-edit.mjs` (edit-log hook), `print-config.mjs`, `smoke-pack.mjs`.
- `docs/`: DESIGN, ROADMAP, FEATURES (never-delete ledger), EDITLOG (newest at bottom), SETUP, this file, `edits.auto.log`.

## 3. Steps (timeline ops) that exist
box, cylinder, sphere, sketch, constrained_sketch, extrude, revolve, loft, sweep, fillet, chamfer, shell, boolean, transform, import (script name: `importFile`), hole, pattern, mirror, material. `hole` takes `at` or `face`+`uv`; `sketch`/`constrained_sketch` take `plane` or `onFace`.
Selectors: edges `{all, direction, plane, length, lengthAtLeast, lengthAtMost, curve, box, expect}`; faces `{plane, parallelTo, expect}`.
MCP tools (22, incl. check_interference): get_docs, new_model, set_param, add_step, run_script, suppress_step, remove_step, get_model, measure, export_model, save_model, load_model, list_models, view,
inspect_file, import_file, convert_file, render_view, list_knowledge, get_knowledge, get_playbook.

## 4. Non-negotiable working rules
1. **Public repo: never write personal info** (no absolute local paths, Windows username, emails, owner's real files/part numbers/author tags). Scan the staged diff before every commit with a grep for: absolute Windows/Unix user paths, the machine's username, any email address, and identifiers from the owner's real CAD files (the exact strings are kept in the private memory entry, NOT here, because writing them here would publish them); also run `git ls-files | grep -E '.(ipt|iam|step|exe|png)$'` to make sure no sample files or binaries are tracked. Tests must never hardcode the username (use `os.userInfo()` at runtime).
2. **Commit and push after every completed change**, then wait for CI on that exact commit (`gh run list --commit <sha>`; poll until completed; both Node 22 and 24 must be green). Git identity for this repo is the GitHub noreply address (already in local config). Commit messages end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line.
3. **Keep the three logs current as you work**: `docs/EDITLOG.md` (append at the END, one bullet per meaningful change incl. mistakes), `docs/FEATURES.md` (never delete a line; change the marker), and the DESIGN.md "Where we left off" header. Update ROADMAP on scope changes. The edit-log hook only fires in sessions started inside the repo; otherwise log by hand.
4. **Never write to stdout in the MCP process** (stdout is the JSON-RPC stream). OpenCASCADE and planegcs both print: OCCT is redirected in `kernel.ts`; planegcs is silenced by swapping `console` during each synchronous solve in `sketch.ts`. Any new native/WASM dependency must be tested for stdout leaks with a real subprocess test, and the test must be mutation-checked (fails when the fix is removed).
5. **Tools accept plain names only, never paths** (imports/exports/saves live under the output folder). The AI never chooses which external program runs.
6. **Honesty**: Contrapt has NO stress/vibration/motion simulation yet; hand estimates must be labelled as estimates. Do not claim anything is simulated, verified in an app, or published unless it is.
7. Challenge the owner's ideas and propose your own before building anything with real tradeoffs; with delegated autonomy do not ask permission per item. Big bets (marked in ROADMAP) need a yes/no first.

## 5. Practical gotchas learned (save yourself the time)
- **Shell quoting is fragile** here (Git Bash tool): long heredocs containing quotes/backticks often fail ("unexpected EOF"). Put non-trivial scripts in files with the Write tool (a temp folder outside the repo) and run `node file.cjs`; or use the Edit tool.
- **Biome reformats code after `--write`**, so string-anchor edits written from memory miss. Always grep the current text first, or use the Edit tool. Edit scripts that write per file only at the end are all-or-nothing PER FILE (earlier files in the script may already be applied); re-check what landed before re-running.
- **Template literals**: never put backticks inside text that is itself a template literal (script prelude, docs.ts strings).
- **replicad**: transforms (`translate/rotate/mirror/scale`) CONSUME their input; `.clone()` first if you still need it. Sketches consumed by `loftWith`; rebuild them from stored drawings. `sketchOnPlane` plane conventions: XY/YZ/ZX extrude +Z/+X/+Y; XZ/YX/ZY extrude negative. `import` is reserved JS, hence `importFile` in scripts.
- Node runs `.ts` natively (type stripping): erasable syntax only, `.ts` import extensions. Child processes must import by `file://` URL, not raw Windows paths. `import.meta.url` file lookups need a packaged and a monorepo candidate (see `viewer.ts`).
- `npm ci --dry-run` before pushing anything that adds a workspace/dependency (stale lockfile broke CI once).
- Biome migrate can silently set `preset: none`; keep `"preset": "recommended"`. Markdown is excluded from Biome.
- Tests: prefer closed-form answers (volumes by formula, Pappus, frustum), probe the real behaviour first, then assert; mutation-check any "this must not happen" test; test through a real client (SDK over stdio/HTTP) not only in-process.
- The browser preview tool reads `.claude/launch.json` from the SESSION ROOT, not this repo: run a demo server in the background and `preview_start` with its `url`.
- When diagnosing a CLI tool, redirect output to files; `| head` closing the pipe killed a program with exit 101 once.

## 6. Owner-only items (cannot be done by Claude; do not pretend)
(1) npm publish of `contrapt` (needs their npm account). (2) Checks inside real Claude Desktop and LM Studio (Claude Code is verified: `claude mcp list` shows Connected). (3) ChatGPT over HTTP is untried and may need OAuth rather than a bearer token.
(4) Yes/no on the two BIG BETS in ROADMAP "Ideas Review #1" (analysis tools; start the Proof Loop). Their Claude Code registration currently has no `--cadmpeg` flag (their choice to enable the converter).

## 6b. UPDATE 2026-11-22: state after "do everything, then keep going in that order"
Everything in sections 7 and 8 below has been built and pushed (CI green, 220 core + 85 mcp tests, 45 MCP tools). In order: materials/mass, check_interference, face-relative placement, section_properties + beam_check + column_check, the Proof Loop (specs, check_specs, optimize_param, Design Journal, build_pack, proof_loop playbook), assemblies (mate, check_assembly, bom, motion_check), drawing (SVG sheets), print_check, frame FEA (frame_analysis, frame_modes, frame_buckling), body-fitted solid FEA (solid_fea: boundary nodes snapped onto the exact surface, distorted Wilson-Taylor hexes, nodal stress recovery), mechanisms (mechanism_sweep, fourbar_check), mass_properties, dynamics_sim, viewer upgrades (selection, section plane, material colours, labels, theme, live Requirements and Journal panels), README rewrite with real screenshots. docs/EDITLOG.md (bottom) records what was learned in each; read it before touching the solvers.
Decisions worth remembering: no unstructured tetrahedral mesher (pure-JS Delaunay is fragile and open meshers are GPL/AGPL; fitting the structured hex grid fixed the actual problem); the solid FEA peak stress is nodal-extrapolated and sharp corners or features under about two elements are still not captured; every analysis reply labels its numbers as measured, FEA or hand estimate and tests tie each to a closed form.
STILL OPEN: true unstructured meshing (only if needed), buckling of solids, transient thermal/radiation, fatigue, multi-body dynamics and contacts, joints/grounding/kinematics in 3D assemblies, sheet metal, section/detail drawing views with feature dimensions and DXF/PDF, hover dimensions and step-click highlighting in the viewer, wiring frame/solid FEA into the Proof Loop specs, cost per kg (needs verified prices), more importers, and the owner-only items (npm publish of contrapt, Claude Desktop and LM Studio checks, ChatGPT over HTTP, optional --cadmpeg).
UPDATE 2026-11-23: frame and solid FEA and thermal are now Proof Loop specs (frame, solid_fea, thermal kinds, heavy: pending in the live status), thermal_analysis exists (47 tools: solid_modes added), and two solid_fea bugs were fixed (double-width face selection, equal-share surface loads) so solid results are now within 0.5% of beam theory. The shared mesher is packages/core/src/solidmesh.ts.
Process notes: the browser pane works for localhost only after the first navigation attempt is allowed (retry once); screenshots of the on-demand WebGL canvas are blank right after a state change, wait a second; heredocs with lots of quoting break in this shell, so write patch scripts with the file tool and run them with node; chain npm run ci with && before committing (a failed run once committed anyway).

## 7. SECOND BATCH: DONE 2026-11-17 (B2.1 materials/mass, B2.2 check_interference, B2.3 face-relative hole + sketch). Kept below for reference.
**NEXT: report to the owner and get a yes/no on the two big bets in section 8 (analysis tools; the Proof Loop), then M6 assemblies.**
Original spec:
Each item: probe real behaviour first, implement, closed-form tests, MCP-level test, update docs.ts + knowledge pack + FEATURES + EDITLOG, run `npm run ci` and `npm run smoke:pack`, privacy scan, commit, push, wait for CI.

**B2.1 Materials, mass and cost.** New `materials.ts` in core: a library (name, density g/cm3, E GPa, yield MPa, Poisson, cost per kg as a rough default flagged "typical") for the materials in `knowledge/materials.md`
(6061-T6, 7075-T6, mild steel, 304, 4140, brass, copper, Ti-6Al-4V, PLA, PETG, ABS, nylon, PC, TPU, acrylic, acetal, birch ply, oak): values MUST match the pack (add a test tying the table to the pack, like the screw-table test).
Add a timeline step `material {target, name}` (body keeps its material; survives booleans like other in-place steps) and extend `measure` and the build feedback with `mass_g`, `material`, and mass-based centre of mass; report unknown material names with the list.
Tests: mass = volume x density for each material on a box; reassigning; unknown name; script mode; MCP feedback includes mass.
**B2.2 `check_interference {a, b}`** (tool + engine helper, pulled forward from M6): exact overlap volume via boolean intersect, plus min-clearance estimate via the bodies' bounding boxes (exact distance later); report "overlap X mm3" / "touching" / "clear by about Y mm". Note the earlier finding: intersect of disjoint/touching bodies yields an empty result with no measurement, so handle that explicitly. Tests: overlapping boxes (known volume), touching faces, separated bodies, a pin in a hole (interference fit), unknown ids.
**B2.3 Face-relative placement.** `hole` (and `sketch`) accept `face: {normal: '+X'|'-X'|'+Y'|'-Y'|'+Z'|'-Z', index?/near?: [x,y,z]}` plus 2D `uv` coordinates on that face, so the AI stops computing surface coordinates by hand. Implement by finding planar faces of the target with that outward normal (replicad FaceFinder), choosing the one nearest `near` or the extreme one, and mapping uv to world. Keep the existing `at` form working. Tests: holes via face+uv on all six faces of a box produce the exact same volumes as the equivalent `at`; error messages for no matching face; interaction with the start-point warnings.
After batch 2: tell the owner what shipped, then ASK for the yes/no on the big bets if not yet answered (see sec. 8).

## 8. After batch 2 (design sketches, so nothing has to be re-derived)
**Big bet 1: analysis without FEA.** `section_properties {body, plane, offset}`: slice the exact solid with a plane (replicad section/intersect with a thin slab or `Shape3D` face from `section`), return area, centroid, Ixx/Iyy/Ixy, section modulus, using mesh/face integration; validate on rectangle, circle, tube, L-section (closed forms). Then `beam_check {body or section, span, supports, loads, material}`: cantilever / simply supported / fixed-fixed with point and uniform loads, deflection, max stress, safety factor against yield, using the formulas in `knowledge/strength-and-stiffness.md`; label results "hand-calculation grade". Validation suite with textbook cases runs in CI.
**Big bet 2: Proof Loop (M5).** Spec language (`add_spec`, `check_specs`): mass, bounding size, interference-free, beam_check outcomes (deflection, safety factor), printability (wall thickness when available). After every mutating tool call, include a compact pass/fail table with the numbers. Then Design Journal (per-iteration log with metrics and renders), variants and a Pareto table, `optimize` over named parameters (start with a simple bisection / Nelder-Mead against specs), and `what_could_go_wrong` driven by `design-failure-modes.md`.
**Then:** M6 assemblies (joints, interference/range of motion, BOM), M7/M8 simulation (beam FEA, then tetrahedral; rigid-body; every result passes the validation suite and prints its assumptions), M10 drawings/sheet metal/Build Pack, sandbox layer (P11), viewer upgrades (constraint glyphs, selection highlight), more importers, release polish.
Run a new Ideas Review when a milestone reaches about 80% (dogfood a real design through the real stdio CLI, record frictions and fixes in ROADMAP).

## 9. Memory
The auto-memory entry `project_contrapt.md` holds machine-specific facts (local paths, converter location, the owner's registration). It is intentionally NOT in the public repo.
