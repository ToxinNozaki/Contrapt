# Contrapt — orientation for a fresh session

Read these, in this order, before doing anything else in this repo:

1. [docs/DESIGN.md](docs/DESIGN.md) — what Contrapt is, the decisions made, and the **"Where we left off"** section at the top (read that first).
2. [docs/ROADMAP.md](docs/ROADMAP.md) — milestones, exit criteria, Now/Next/Later, and Claude's Proposed Ideas backlog.
3. [docs/FEATURES.md](docs/FEATURES.md) — the feature ledger. Every feature ever planned, with status. **Never delete an item**; mark it done, in-progress, or dropped (with a reason).
4. [docs/EDITLOG.md](docs/EDITLOG.md) — the curated edit log (what changed and why, per work session).
5. `docs/edits.auto.log` — machine-written, one line per file edit (see "Standing rules").

## Standing rules (these are the owner's hard requirements)

- **Keep the logs current as you work, not at the end.** After any meaningful edit:
  add a line to `docs/EDITLOG.md`, update the status in `docs/FEATURES.md`, and refresh
  "Where we left off" in `docs/DESIGN.md`. If a session might end now, these three must already be true.
- **You are the lead coder, and the project must keep evolving.** The owner wants Claude to build this and
  add its own features over time. When a milestone is ~80% done, run the **Ideas Review** described in
  `docs/ROADMAP.md` (dogfood, scan the field, promote/add ideas with reasons). Update the roadmap on every
  stop. Big bets (marked 🎯) get the owner's yes/no first; small improvements just get built.
- **A hook auto-appends every Edit/Write to `docs/edits.auto.log`.** It is configured in
  `.claude/settings.local.json` (not committed, so contributors aren't affected). If the file
  is missing on a fresh clone, recreate it from `tools/dev/settings.local.example.json`.
  The hook only fires in sessions started inside this repo; in any other session, log by hand.
- **Commit and push after every completed change** to `origin/main`. Don't wait to be asked.
- **This repo is public. Never write personal info into it**: no absolute local paths
  (anything starting `C:\Users\`), no usernames, no machine names, in code, docs, logs, or commits.
  Use repo-relative paths. Scan the diff for these before every commit.
- **Don't put "Inventor", "Autodesk", or "Claude" in the product name.** Referential use
  ("an open-source alternative to Autodesk Inventor") in docs is fine; see the naming note in DESIGN.md.
- **Knowledge packs (`packages/mcp/knowledge/`) must be correct.** Check every number against a reputable source, work
  the example yourself, and keep the test that recomputes it. Mark typical values as typical; never imply Contrapt
  simulates anything it does not.
- Challenge the owner's ideas and propose your own before building anything with a real tradeoff
  (they asked for this); with delegated autonomy, don't re-ask permission for each item.

## Quick orientation

- Product name: **Contrapt**. Tagline: AI-drivable CAD + simulator that _proves_ a design works.
- Stack: TypeScript monorepo (npm workspaces), OpenCASCADE via WASM for geometry,
  a built-in MCP server, a browser viewer. Details and reasoning in DESIGN.md.
- Keep it lightweight: no Electron, no heavyweight installs. Budget is in DESIGN.md.
