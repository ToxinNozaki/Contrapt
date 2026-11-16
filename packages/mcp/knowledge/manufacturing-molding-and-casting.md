---
title: Design for injection molding and casting
summary: Wall thickness, draft, ribs, bosses, undercuts, parting lines, and prototyping routes for molded and cast parts.
---
# Design for injection molding and casting

Tooling is expensive (a steel injection mold is typically thousands to tens of thousands of dollars), so molding makes sense for hundreds to millions of parts. For fewer, consider 3D printing, urethane casting, or CNC.

## Injection molding rules of thumb
- **Uniform wall thickness**, typically 1.5–3 mm depending on the plastic and part size. Thick sections
  cool slowly and cause sink marks, voids and warp. Thin sections may not fill.
- **Draft angle:** at least 1° on faces parallel to the mold opening (2–3° for textured surfaces) so the part
  releases.
- **Ribs:** thickness about 50–60% of the wall (to avoid sink on the opposite face), height up to ~3× the
  wall, with a base fillet and draft. Prefer several thin ribs to one thick one.
- **Bosses:** outer diameter about 2× the screw hole, wall like the nominal wall, tied to a wall or rib with
  ribs/gussets; fillet at the base. Do not leave a heavy solid boss.
- **Radii on all corners:** inside radius at least 0.5× the wall, outside radius inside + wall; sharp corners
  concentrate stress and block flow.
- **Undercuts** (features that lock the part in the mold) need sliders or lifters, adding cost. Redesign
  with snap hooks that release through the parting direction or through windows, where possible.
- **Parting line and gate:** decide where the mold splits and where plastic enters; avoid putting cosmetic
  surfaces or critical fits on the parting line; gate marks are visible.
- **Shrinkage:** plastics shrink 0.4–2% as they cool depending on material; the mold is cut oversize.
- **Material:** ABS, PP, PC, nylon, POM and more; choose for strength, temperature, chemicals, and finish.

## Casting
- **Die casting** (aluminium/zinc): similar to molding: draft, uniform walls (1.5–4 mm), ribs; high tooling cost.
- **Sand casting:** drafts of 1–3°, generous radii, thicker walls (about 3–6 mm+), machine allowance
  (≈1.5–3 mm) on critical faces; low tooling cost, rough finish, ±1 mm or more.
- **Investment casting:** fine detail, thinner walls, good finish, per-part cost medium.
- **Urethane (vacuum) casting:** silicone mold from a 3D-printed master; 10–50 parts; good for prototypes.

## Prototyping route
Print or CNC a version that follows the mold design rules (draft, wall, ribs). Many "plastic-looking" printed
prototypes ignore draft and thick walls; if you plan to mold later, apply the rules from the start.
