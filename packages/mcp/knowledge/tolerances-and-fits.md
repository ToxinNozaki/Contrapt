---
title: Tolerances and fits
summary: Process accuracy, clearance and press-fit rules, ISO fits, tolerance stack-up and basic GD&T.
---
# Tolerances and fits

A drawing dimension is a target; every process misses it by some amount. Design the fit, then choose a
process that can hold it.

## Typical accuracy by process (rough, per feature; depends on machine and part size)
| Process | General tolerance | Notes |
|---|---|---|
| CNC milling/turning | ±0.05–0.1 mm | ±0.025 mm possible at higher cost |
| Laser cutting (sheet) | ±0.1–0.2 mm | Kerf removes 0.1–0.3 mm; edges slightly tapered |
| FDM 3D printing | ±0.2–0.3 mm | Holes come out small; first layer flares ("elephant foot") |
| Resin (SLA) printing | ±0.05–0.15 mm | Shrinks and warps with big flat parts |
| Sheet-metal bending | ±0.25–0.5 mm, ±0.5–1° | Springback varies with material |
| Injection molding | ±0.1–0.3 mm | Depends on part size and material shrink |
| Sand casting | ±1 mm or more | Machine the critical faces |

## Clearance and fit design for printed parts (calibrate with a test coupon first)
- Sliding fit between printed parts: about 0.2–0.4 mm total clearance (0.1–0.2 per side on a tuned printer).
- Press/snug fit: 0.0–0.1 mm clearance; confirm on a test piece.
- Printed holes: design them 0.1–0.3 mm larger than the pin or screw that goes through them.
- Print-in-place hinges and moving parts: 0.3–0.5 mm gaps.
- Always print a small calibration piece for the printer and material before committing a whole assembly.

## ISO fits (metal parts; hole-basis system, size ~10–30 mm)
The letter-number says deviation and grade: **H7** is a standard hole; **g6/h6/k6/p6** are shaft choices.
- **H7/g6** — sliding/running fit (parts can slide with a lubricating film).
- **H7/h6** — locational fit (assembled by hand, little play).
- **H7/k6** — transition (slight interference possible; light tap).
- **H7/p6** — press fit (needs force or heating).
Typical tolerance widths (IT grades): IT6 ≈ 9 µm for 6–10 mm, 11 µm for 10–18 mm, 13 µm for 18–30 mm;
IT7 ≈ 15, 18, 21 µm for the same ranges. Tighter costs more; only specify tight where the function needs it.

## Bearings and shafts
- Bearing seats are typically housing H7 and shaft k5/j6 (rotating inner race) — follow the bearing maker's guidance.
- Axial play: use a shoulder on one side and a retaining ring or shaft collar on the other.
- Two bearings on a long shaft should be spread apart (a few times the bearing width) to resist tilt.

## Tolerance stack-up
Worst case adds the tolerances: gap_tolerance = Σ tolerances. Statistical (RSS) gives √(Σ tol²), optimistic
but reasonable for many parts. If the worst-case gap can go negative, parts may not assemble: add
clearance, slots, or adjustment. Standard-part dimensions (screws, bearings) are fixed; adjust your part.

## GD&T basics (when you need a real drawing)
- **Datums** (A, B, C) are the reference surfaces a part is measured from; pick functional surfaces.
- Common controls: flatness, perpendicularity, parallelism, position (hole patterns), concentricity/runout
  (shafts), profile (surfaces).
- Most hobby and prototype work needs only plus/minus tolerances and a few critical fits. Do not over-specify.
