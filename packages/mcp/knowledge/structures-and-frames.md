---
title: Structures and frames
summary: Load paths, triangulation, tubes and extrusion frames, supports, deflection limits, tipping and stability.
---
# Structures and frames

## Load paths
Trace every load from where it enters to where it is reacted (the ground, the wall, the bolts). Short,
direct paths in tension or compression are stiff and light; bending and torsion are expensive. Put material
where the load goes.

## Shapes
- **Triangles** are stable; rectangles shear. Brace corners with diagonals, gussets, or panels (a stiff plate
  fixed to a frame can replace a diagonal).
- **Trusses:** members carry only tension or compression, if joints are pinned; keep slender compression
  members short (buckling, see `strength-and-stiffness`).
- **Hollow sections** (round or rectangular tube) resist bending and torsion best per mass: for the same area a
  tube is far stiffer than a bar. Round tube resists torsion best.
- **Plates and ribs:** a thin plate is floppy; add ribs, flanges or a box section to get depth.
- **Cantilevers** are expensive: deflection grows with L³; shorten, add a support, or add depth.

## Aluminium extrusion (T-slot) frames
Easy to build, adjustable, and good for machines and fixtures. Use the manufacturer's section properties for
beam calculations. Joints (corner brackets, end-tap connections, T-nuts) are usually the flexible link: use
two brackets per corner for stiffness, diagonals or gusset plates for racking, and keep spans short. Use
nut-driven slot connectors that match the slot size (20-series: 6 mm slot; 30-series: 8 mm slot; 40-series
etc.) and check the profile's own datasheet.

## Support and spans
Support a long member near the ends or add a middle support (deflection under distributed load grows with L⁴).
Use deflection limits: L/360 for general stiffness, tighter for precision machines. Use bolted base feet or
levelling feet for stability; foam or rubber feet damp vibration.

## Tipping and stability
A free-standing object tips when its centre of gravity (CoG) passes outside the base. For base width b and CoG
height h the tipping angle θ ≈ atan((b/2) / h). Add a wider base, lower the CoG, or fix it down for
tall items. Use `measure`'s centre of mass to check the CoG height of the whole assembly (bodies
separately; combine by mass-weighted average). Check dynamic cases (start, stop, bump).

## Fixing to walls and floors
Anchor loads are often larger than expected (leverage). Use the right anchors for the material (drywall,
masonry, wood). For shelves, brackets, and anything that could fall on a person, use well-sized anchors and
verify with a conservative calculation and a load test; consult a professional for structures that hold people.

## Vibration
Avoid operating near the natural frequency of a member or panel; stiffen it, add mass, or damp it. A
simple cantilever natural frequency estimate: f ≈ (1/2π) √(k/m_eff), with k = 3EI/L³ and m_eff ≈ 0.23× beam
mass + tip mass.
