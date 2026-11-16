---
title: Design for sheet metal
summary: Bend radius, flange and hole spacing rules, bend allowance, relief, flat patterns, and common gauges.
---
# Design for sheet metal

Contrapt does not model sheet metal yet (flanges, bends, flat pattern are on the roadmap). Until then, model the
finished 3D shape with thin extrusions for reference and do the flat-length math by hand.

## Rules of thumb (t = material thickness)
- **Inside bend radius:** at least 1× t for mild steel and 5052 aluminium; larger for 6061-T6 (often 2–4× t)
  and harder grades to avoid cracking. Use one radius throughout to save tooling changes.
- **Minimum flange length:** about 4× t plus the bend radius, so the die can grip it.
- **Hole to bend:** keep holes at least ~2.5 t + bend radius away from the bend line, or they distort.
- **Hole to edge:** at least 1.5–2 t; hole to hole at least 2 t; minimum hole diameter about equal to t.
- **Slots and tabs:** width at least t (preferably 1.5 t); tab length not more than ~5× its width.
- **Bend relief:** cut a small relief (width ≥ t, depth ≥ t + radius) where a bend meets a flat edge so the
  metal does not tear.
- **Grain direction:** bend across the rolling grain when possible, especially for hard or thick material.
- **Springback:** metal springs back a few degrees after bending; the shop compensates, but tight angle
  tolerances cost more (typical ±1°).
- **Common thicknesses:** 1, 1.5, 2, 3 mm (and gauge numbers in imperial shops). Use what the shop stocks.

## Flat length math
- Bend allowance BA = (π / 180) × θ × (R + K × t), with θ the bend angle in degrees, R the inside radius,
  t thickness, K the K-factor (about 0.33 for tight bends, 0.4–0.5 for larger radii; ask the shop for theirs).
- Dimension each flange to the outside "virtual sharp" corner. Bend deduction BD = 2 × (R + t) × tan(θ/2) − BA.
  Flat length = Σ outside flange lengths − Σ BD over all bends. For a 90° bend, BD = 2 × (R + t) − BA.
  Example: t = 2, R = 2, K = 0.4, 90° → BA = (π/180) × 90 × (2 + 0.4×2) = 4.40; BD = 2 × 4 − 4.40 = 3.60 mm.
- Always have the shop confirm the flat pattern; treat hand numbers as an estimate.

## Joining
Spot welds, rivets (pop or solid), PEM-style self-clinching nuts/studs (for threads in thin metal), screws
through clearance holes with nuts, tabs and slots that self-locate, hemmed edges for safety and stiffness.
Deburr edges; sheet edges cut skin.

## Stiffness
Flat sheet is floppy. Stiffen with flanges, ribs and returns, boxes and hems; stiffness rises roughly with the
cube of the section depth (see `strength-and-stiffness`).
