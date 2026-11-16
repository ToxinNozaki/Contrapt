---
title: Design for 3D printing
summary: Design rules for FDM, resin and SLS printing: walls, overhangs, orientation, holes, tolerances, strength.
---
# Design for 3D printing

Defaults assume FDM with a 0.4 mm nozzle and 0.2 mm layers; adjust for your printer. Always confirm
the build volume (many printers are about 200–256 mm per side) against `measure`'s bounding box.

## FDM rules of thumb
- **Walls:** minimum 0.8 mm (two perimeters); use 1.2–2 mm for anything that carries load. Walls thinner
  than the nozzle will not print.
- **Overhangs:** up to about 45° from vertical print without support; steeper needs support or a redesign
  (chamfer instead of a flat underside, teardrop-shaped horizontal holes).
- **Bridges:** fine up to roughly 5–10 mm; longer sag.
- **Holes:** design 0.1–0.3 mm oversize; holes under about 2 mm are unreliable; horizontal holes sag at the
  top (use teardrops or a sacrificial bridge layer). Drill or ream if the fit matters.
- **Bottom edges:** add a 0.5–1 mm chamfer to the first-layer edge to stop elephant foot; avoid sharp
  bottom corners on large flats (they curl).
- **Features:** vertical ribs and pins thinner than ~1.2 mm break easily; embossed text at least 0.6 mm tall
  and 1 mm strokes; keep gaps between parts at least 0.3 mm for print-in-place.
- **Orientation decides strength.** Layers are weak in tension across them. Print a bracket on its side so
  the load runs along the layers, or add a fillet and thick section where the load crosses layers.
- **Warping:** large flat areas of ABS/ASA/nylon warp; round corners, add brims, enclose the printer. PLA and
  PETG are easier.
- **Support:** minimise by orientation and chamfers; plan for the surface the support leaves behind.
- **Infill:** 15–25% is typical; walls and top/bottom layers carry most of the strength; 3–4 perimeters beat
  high infill for bending strength.

## Joints and hardware in printed parts
Use heat-set inserts for repeated screws (see `fasteners-and-joints`), nut traps (hex pocket across flats +
0.2–0.3 mm), and bosses with fillets. Add 0.2 mm to screw clearance holes. Split large parts so each prints
flat, and add alignment features (pins, tongue-and-groove) between halves.

## Resin (SLA/MSLA)
Walls at least ~1 mm; hollow parts need two drain holes (≥3 mm) or they trap resin and crack; tilt flat
parts to reduce suction and warp; parts are brittle and UV-sensitive; wash and cure.

## SLS / MJF (powder)
Walls about 0.7–1 mm minimum; no supports needed; hollow parts need escape holes (≥4–5 mm); surfaces are
grainy; nylon is tough and good for living hinges and snap fits.

## Strength reminders
Printed plastic is much weaker and more brittle than the metal equivalent; use the safety factors in
`strength-and-stiffness` (3–5+). PLA creeps and softens near 55–60 °C; PETG, ASA or nylon for heat or load
held over time.

## What Contrapt can check today
Bounding box vs build volume, volume (for material/time estimates), centre of mass. Not yet automated:
overhang detection, minimum wall thickness, and support estimation. Check those by reading the model
dimensions, and call it out as unchecked.
