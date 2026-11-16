---
title: Fasteners and joints
summary: Metric screw hole sizes, head and nut dimensions, thread engagement, inserts, snap fits, press fits, adhesives, welding.
---
# Fasteners and joints

## Metric screw reference (mm; common values, check your actual hardware)
| Size | Clearance hole (normal) | Clearance (close) | Tap drill (cutting thread) | Socket head dia × height | Nut across flats × thickness |
|---|---|---|---|---|---|
| M2 | 2.4 | 2.2 | 1.6 | 3.8 × 2 | 4 × 1.6 |
| M2.5 | 2.9 | 2.7 | 2.05 | 4.5 × 2.5 | 5 × 2 |
| M3 | 3.4 | 3.2 | 2.5 | 5.5 × 3 | 5.5 × 2.4 |
| M4 | 4.5 | 4.3 | 3.3 | 7 × 4 | 7 × 3.2 |
| M5 | 5.5 | 5.3 | 4.2 | 8.5 × 5 | 8 × 4.7 |
| M6 | 6.6 | 6.4 | 5.0 | 10 × 6 | 10 × 5.2 |
| M8 | 9.0 | 8.4 | 6.8 | 13 × 8 | 13 × 6.8 |
| M10 | 11.0 | 10.5 | 8.5 | 16 × 10 | 16 × 8.4 |

- Counterbore for a socket head: diameter = head diameter + 0.5–1 mm, depth = head height + 0.2–0.5 mm.
- Countersink (flat head): 90° cone, diameter about 2× the screw major diameter.
- For 3D-printed holes add ~0.2 mm to the clearance values (printed holes come out small).

## Engagement and spacing
- Thread engagement (screw length inside the part): at least 1× diameter in steel, 1.5–2× in aluminium,
  about 2× in plastic or wood.
- Hole centre to edge at least 1.5–2× the hole diameter; hole to hole at least 2–3× the diameter.
- Use at least 2 fasteners per joint so the part cannot rotate; 3+ for a plane to be stable.
- Keep threads out of shear. For location, use dowel pins or a shoulder/spigot, and let screws just clamp.

## Preload and tightening
Clamp force is what makes a bolted joint work. Rough tightening: T ≈ K × F × d with K ≈ 0.2 (dry steel),
where T is torque, F the preload and d the nominal diameter. Aim for roughly 60–75% of the bolt's proof load
for reusable joints. Vibration loosens screws: use thread-locker, nyloc nuts, spring or serrated washers, or
a lock design. Do not overtighten into plastic or thin sheet: use washers, inserts or metal sleeves.

## Fastening into plastic and wood
- **Heat-set inserts** (brass) give strong repeatable threads in printed parts. Hole diameter is set by the
  insert supplier (for M3 inserts often ~4.0–4.6 mm); boss outer diameter about 2× the hole; depth a little
  more than the insert length. Check the datasheet.
- **Self-tapping screws** into plastic: pilot hole about 0.8× the screw major diameter; boss wall about
  equal to the screw diameter. Do not reuse many times.
- **Wood:** pilot holes, screws along the grain are weak; use inserts for repeated assembly.

## Other joint types
- **Press fit / interference:** needs controlled tolerances (see `tolerances-and-fits`). Metal-to-metal
  press fits are typically H7/p6; avoid press fits in printed parts or use them only as light friction fits.
- **Snap fits:** the allowable strain limits deflection. For a rectangular cantilever hook
  y_max ≈ 0.67 × ε × L² / h (L length, h thickness at the root, ε allowable strain, roughly 1–2% for PLA,
  3–4% for PETG/ABS, higher for nylon; these are rough). Make the root thick, add a fillet, print so layers
  run along the beam, and test one.
- **Adhesives:** strong in shear and peel-resistant when the bond area is large; poor in peel and cleavage.
  Match the glue to the materials (CA for tight fits, epoxy for gap filling, solvent welds for same-plastic).
  Add mechanical features (tabs, slots) rather than relying on glue alone.
- **Welding:** needs weldable material and access; distortion is real. Design for fillet welds with
  accessible runs; do not weld galvanised or coated steel without precautions (toxic fumes).
- **Rivets/pins/clips:** fast and cheap; permanent or semi-permanent; check shear capacity.
- **Finger joints and slots (laser/CNC wood or acrylic):** slot width = material thickness plus a small
  tolerance minus the kerf adjustment; add T-slot nut pockets for screws.
