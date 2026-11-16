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

## Good habits
- **Parameters first.** `set_param` every key dimension (`thickness`, `hole_d`, `pitch`), then reference them as
  strings: `"hole_d/2"`. Change one number later and the model rebuilds.
- **Name steps by meaning:** `id: 'base_plate'`, `id: 'mount_holes'`.
- **Order of operations:** sketch → extrude → fillet/chamfer outer edges → shell → drill holes. Fillet *before*
  cutting holes when you want only the outer corners (a hole's seam adds vertical edges); or use a
  `box` edge selector, and always add `expect: N`.
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
- Constrained sketches (dimensions/constraints solved automatically), arcs and splines in sketches.
- Revolve, sweep, loft, draft, thread features, ribs, patterns/mirror as one-click features.
- Assemblies with joints and mates; motion studies.
- Stress/modal/thermal simulation; interference checks and wall-thickness analysis (coming in later milestones).
- Sheet metal flanges/bends, drawings, and any import other than STEP (see `importing-cad-files`).

## Workarounds today
- **Revolve-like shapes (turned parts, bottles, knobs):** approximate with stacked `cylinder` and `sphere` bodies
  joined by `boolean` union. Say it is an approximation.
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
