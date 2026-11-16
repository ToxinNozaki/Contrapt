# Contrapt — edit log

Curated, newest session at the **bottom**. One bullet per meaningful edit: what changed and *why*.
Every individual file write is *also* recorded automatically in `docs/edits.auto.log` (by a hook),
so nothing is lost even if a bullet here is missed. Repo-relative paths only (this repo is public).

## 2026-11-15 — Session 1: name, research, foundations

- Research (no code): surveyed existing AI-CAD projects (SolidCraft, ParCAD, FreeCAD/OpenSCAD MCPs),
  candidate kernels/solvers, MCP SDK state, GitHub discoverability, and Autodesk trademark rules.
  Finding: nobody combines parametric modeling + assemblies + real FEA + motion sim + an AI
  verification loop. Stress analysis is essentially unclaimed.
- Name: dropped the original title (it contained two third-party trademarks). Picked **Contrapt**
  after checking npm (free) and GitHub (no CAD collisions). Rejected: Tinkerforge (real company),
  Contraptor-adjacent hardware, cadabra/whittle/makeshift/inventra (taken on npm).
- Created project folder, `git init -b main`.
- Added `CLAUDE.md`: orientation + standing rules (keep logs current, push after every change, no
  personal info in the public repo, no third-party marks in the name).
- Added `docs/DESIGN.md`: purpose, the **Proof Loop** differentiator, goals/non-goals, phased scope,
  architecture plan, budget, and a "Where we left off" header.
- Added `docs/FEATURES.md`: full feature ledger P0–P10, never-delete rule.
- Added this log and the edit-logging hook (`tools/dev/log-edit.mjs`). First test marked every path
  "outside repo" because Git Bash passes `/c/...` paths that Node-on-Windows misreads; fixed by
  normalising drive paths in the hook, re-tested, and removed my test lines from the auto log.
  The hook lives in `.claude/settings.local.json` (gitignored); the committed template is
  `tools/dev/settings.local.example.json`. Caveat: it only fires in sessions started inside this repo.
- Backfilled `docs/edits.auto.log` with the files written before the hook existed (timestamps are
  backfill time, flagged in the file header).
- Added `LICENSE` (MIT, "Contrapt contributors"), `NOTICE.md` (LGPL components + non-affiliation),
  `README.md` stub.
- Created public repo (description + 20 topics), pushed first commit `3880a16`.
- Saved a project memory entry so a fresh session finds this project and the logging rules.
- Scaffolded npm workspaces (`package.json`, `packages/core/package.json`) and installed
  `replicad` + `replicad-opencascadejs` (both 1.2.1). Wrote `packages/core/test/kernel-smoke.test.js`:
  8 tests with closed-form checks (box volume/area, cylinder, hole cut, fillet, shell, STEP, timing).
  Result: all pass; kernel init ~130 ms, extrude+fillet rebuild ~10 ms, wasm ~23 MB unpacked.
  **Decision: replicad + OpenCASCADE is the kernel.**
- Found that OpenCASCADE writes "Statistics on Transfer" to stdout during STEP export — that would
  corrupt an MCP stdio stream. Probed an init-time `print`/`printErr` override (0 bytes reach stdout),
  then wrote `packages/core/src/kernel.js` (`initKernel`, `kernelDiagnostics`) and pointed the test at it.
- Confirmed the edit-log hook does not fire in the session that created the repo (it loads only for
  sessions started inside the repo); edits since the hook was written are logged by hand.
- Owner decision recorded: models are described **both ways** (tool calls + scripts) over one saved
  feature-timeline JSON. Owner's vision recorded: a **sandbox** to visualize almost anything. Added
  "The Sandbox" section to DESIGN.md and a new P11 section to FEATURES.md (placed before P10 in the file;
  numbering is by addition order, not execution order).
- Added `docs/ROADMAP.md` at the owner's request: milestones M0–M12 with exit criteria and version
  targets, Now/Next/Later, a self-evolution process (Ideas Review at ~80% of a milestone), a Proposed
  Ideas backlog (ContraptBench, sim-to-real calibration, tolerance analysis, teaching mode, topology
  optimisation, etc.), and a risk table. Linked it from CLAUDE.md and recorded the "Claude is lead coder,
  keep evolving" standing rule there.
- Privacy: the machine's global git email is a personal address, so this repo's *local* git config uses
  the GitHub noreply address; commits must never carry the personal one.
