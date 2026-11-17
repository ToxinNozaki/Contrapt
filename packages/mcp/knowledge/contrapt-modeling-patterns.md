---
title: Modelling patterns in Contrapt (what works today)
summary: How to build common features with the current Contrapt steps, which features do not exist yet, and workarounds.
---
# Modelling patterns in Contrapt today

Read `get_docs` for the exact step arguments and conventions. This pack covers *how to think* and *what to do
when a feature is not available yet*, so you do not invent tools that do not exist.

## Bringing in existing geometry
A STEP file from another CAD program can be imported (`inspect_file`, then `import_file`) and built on with cuts,
holes and fillets. Native Inventor/SolidWorks files must be exported to STEP first. See `importing-cad-files`.

## Constrained sketches (design intent, not coordinates)
Use `constrained_sketch` when dimensions matter or may change: describe named points with ROUGH starting positions, lines between them,
and constraints (horizontal, vertical, distance, parallel, perpendicular, equalLength, angle, radius, diameter, tangent, onLine, ...).
The solver moves the points to satisfy them. Workflow that works:
1. Place the points roughly where the shape should be (it only needs to be about right, not exact).
2. Pin ONE point with `fix`, add horizontal/vertical/parallel/perpendicular relations, then dimension every size.
3. Read the step note: **"fully constrained (0 degrees of freedom)"** is the goal. "Under-constrained: N degree(s) left" means N
   dimensions can still move: add them. A **conflict** names the contradicting constraints: remove or change one.
4. Use parameters in `value` (for example `"width/2"`) so changing one number re-solves the whole sketch.
Arcs: name the centre, start and end as points; the arc runs counter-clockwise from start to end. Slots and rounded corners need a
`tangent` between each line and the arc beside it (otherwise the report shows free degrees of freedom).
Solved point positions are returned in the step data, so you can check them against your hand numbers. Keep points near the intended
solution: a very wrong starting layout can converge to a mirrored or twisted shape.

## Good habits
- **Parameters first.** `set_param` every key dimension (`thickness`, `hole_d`, `pitch`), then reference them as
  strings: `"hole_d/2"`. Change one number later and the model rebuilds.
- **Name steps by meaning:** `id: 'base_plate'`, `id: 'mount_holes'`.
- **Order of operations:** sketch → extrude → fillet/chamfer outer edges → shell → drill holes. Fillet *before*
  cutting holes when you want only the outer corners (a hole's seam adds vertical edges); or use a
  `box` edge selector, and always add `expect: N`.
- **Look at it:** call `render_view` (iso, top, front) after building. Numbers catch wrong sizes; pictures catch wrong shapes, missing features and mirrored layouts.
- **Verify after each step:** compare the reported volume and bounding box to your hand calculation.
- **Scripts can loop.** `run_script` is JavaScript: build patterns with `for` loops and `Math`.

## Examples
Bolt circle (6 holes on a 40 mm diameter circle) in one sketch:
```js
const holes = [];
for (let i = 0; i < 6; i++) {
  const a = (i * Math.PI) / 3;
  holes.push({ shape: 'circle', r: 2.2, cx: 20 * Math.cos(a), cy: 20 * Math.sin(a), cut: true });
}
const s = sketch({ plane: 'XY', profile: [{ shape: 'circle', r: 30 }, ...holes] });
extrude({ id: 'flange', sketch: s, distance: 8 });
```
Counterbored hole: cut a small through-hole cylinder and a larger shallow one, then `boolean cut` both from
the body (or use two cut-extrudes with `mode: 'cut'`).

Rectangular grid of holes: nested loops pushing `circle` items with `cut: true` into the profile.

Positioning several parts in one model: give each its own `at` and `transform` so they sit where they would in
the assembly, then `measure` each body and check clearances by comparing bounding boxes.

Mirror or symmetric parts: `symmetric: true` on extrude, or compute mirrored positions in a script loop (there is no copy/mirror step yet, and `transform` moves a body, it does not duplicate it).

## What does not exist yet (do not pretend it does)
- Splines and ellipses in sketches (constrained sketches support lines, arcs and circles).
- Draft, thread features, ribs, patterns/mirror as one-click features.
- Assemblies with joints and mates; motion studies.
- Stress/modal/thermal simulation; interference checks and wall-thickness analysis (coming in later milestones).
- Sheet metal flanges/bends, drawings, and any import other than STEP (see `importing-cad-files`).

## Workarounds today
- **Turned parts, bottles, knobs, pulleys:** use `revolve`. Sketch the half profile (a `polygon` of [x, z] points) on the XZ
  plane with one edge on the axis, then `revolve` about Z. Exact, and parametric.
- **Pipes, tubes, rails, handles, cable runs:** `sweep` a circle (or any closed outline) along a `path` of 3D points with a
  `bendRadius` for real bends. Volume = profile area x centre-line length, which is a handy check. Hollow tube = sweep the outer
  circle and the inner circle separately, then a `boolean` cut. Keep the bend radius at least the profile radius (usually 1.5-3x for real pipe).
- **Tapers, adapters, funnels, countersinks:** `loft` between two or more sketches placed with `offset` (a round-to-square transition is one loft;
  a countersink is a loft cut).
- **Arcs/rounded slots:** a `rect` with `cornerRadius`, or `circle` items combined with `rect` items.
- **Slots:** a `rect` plus two `circle` items fused (same sketch, not `cut`) or a rounded rectangle.
- **Interference:** add a `boolean` step with `kind: 'intersect'` between the two bodies (it consumes them in the
  timeline, so `remove_step` it afterwards). If the new body reports a volume, that is the overlap volume. If it
  has no measurements (it is missing from the report's `bodies`), the bodies do not overlap; touching faces also
  give no volume, so leave a deliberate clearance. (A proper interference tool is planned.)
- **Mass:** mass = volume × density (see `materials`); centre of mass from `measure`.
- **Strength/motion:** do hand calculations (`strength-and-stiffness`, `mechanisms-and-motion`) and report them
  as estimates.

## Reporting results
Finish with: what you built, the key dimensions (parameters), measured numbers, assumptions, what was checked by
tool vs by hand, what is not verified, and the exported file names.
