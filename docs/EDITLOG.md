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
- Privacy: the machine's global git email is a personal address, so this repo's *local* git config uses
  the GitHub noreply address; commits must never carry the personal one.
