// Reference text served to AI clients via the `get_docs` tool and the contrapt://docs resource.
// Plane conventions below were verified empirically against the kernel (see EDITLOG, 2026-11-15).

export const DOC_TOPICS = [
  'overview',
  'conventions',
  'steps',
  'selectors',
  'workflow',
  'examples',
] as const;
export type DocTopic = (typeof DOC_TOPICS)[number];

const overview = `# Contrapt overview
Contrapt builds exact 3D parts from a *feature timeline*: named parameters plus ordered steps.
You change the model by adding steps (add_step) or by sending a whole script (run_script). After
every change the model is rebuilt and you get back a build report with per-step status and measured
numbers (volume, bounding box, centre of mass). Always read that report: it is how you check your work.
Units are millimetres and degrees. Numeric fields accept numbers or expressions over parameters,
e.g. "width/2 + 3" (functions: sin cos tan asin acos atan atan2 sqrt abs min max pow floor ceil round
rad deg; constants: pi e). Change one parameter with set_param and everything depending on it rebuilds.`;

const conventions = `# Conventions (verified)
Coordinates: X right, Y forward, Z up. Origin at (0,0,0).
Primitives are CENTRED on \`at\` (default origin): box spans at +/- w/2, d/2, h/2; cylinder is centred
along its axis (axis X|Y|Z, default Z); sphere centred on \`at\`.
Sketch planes (sketch x/y -> world axes, and the direction an extrude goes):
  XY: x->X, y->Y, extrudes +Z      (preferred)
  YZ: x->Y, y->Z, extrudes +X      (preferred)
  ZX: x->Z, y->X, extrudes +Y      (preferred)
  XZ: x->X, y->Z, extrudes -Y      YX: x->Y, y->X, extrudes -Z      ZY: x->Z, y->Y, extrudes -X
\`offset\` moves a sketch along its plane's extrude direction. \`symmetric: true\` extrudes half each way.
Rotation angles are degrees, counter-clockwise about the axis. Rect/circle/ngon sit centred on (cx, cy).`;

const steps = `# Steps (op values)
box {w,d,h,at?}  cylinder {r,h,at?,axis?}  sphere {r,at?}
sketch {plane, offset?, profile:[items]}  -- profile items: rect {w,h,cx?,cy?,cornerRadius?},
  circle {r,cx?,cy?}, polygon {points:[[x,y]...]}, ngon {sides,r,cx?,cy?}. Add "cut":true to subtract an item.
constrained_sketch {plane, offset?, points:{A:[x,y],...}, lines:{AB:['A','B'],...}, arcs:{a:{center:'O', start:'S', end:'E'}} (counter-clockwise from start to end; the three are named points), circles:{c:{center:'A', r}}, constraints:[{type,a,b?,value?,at?}], profile:[{loop:[line names], cut?} | {circle:name, cut?}]}
  -- a sketch driven by dimensions and relations instead of coordinates. Give ROUGH starting positions; the solver snaps them to
  satisfy the constraints. Constraint types: fix (a=point, at?), x / y (a=point, value), coincident (a,b points), horizontal / vertical
  (a=line, or a,b=points), distance (a,b points, value), parallel / perpendicular / equalLength (a,b lines), angle (a,b lines, value degrees),
  radius / diameter (a=circle or arc, value), equalRadius (a,b circles), onLine (a=point, b=line), onCircle (a=point, b=circle or arc), tangent (line-circle, line-arc, circle-circle, arc-arc, circle-arc). Profile loops may mix line and arc names; an arc and the lines next to it share its start/end points, which is how they connect.
  Values may be expressions over parameters. The report says "fully constrained (0 degrees of freedom)" or how many dimensions are still free,
  and names conflicting constraints. Pin one point with fix, give every shape a size, and aim for 0 degrees of freedom.
extrude {sketch, distance, symmetric?, mode?: new|add|cut, target?}  -- add/cut modify \`target\` in place
revolve {sketch, axis: X|Y|Z, origin?, angle? (degrees, default 360), mode?, target?}  -- spins the sketch profile about a WORLD axis; keep the profile on one side of the axis (turned parts: sketch on XZ, axis Z)
loft {sketches:[id, id, ...], ruled?, mode?, target?}  -- blends through 2-12 sketches, each on its own plane/offset (e.g. round-to-square adapters, tapers, funnels, countersinks via mode cut)
sweep {sketch, path:{points:[[x,y,z],...], bendRadius?}, mode?, target?}  -- drags a profile along a 3D path (pipes, rails, handles, wires). The profile is placed automatically at the path start, perpendicular to it (its sketch plane is ignored): for a path starting along +Z the profile x/y follow world X/Y; for a horizontal start, profile x is horizontal (world Z cross direction) and profile y is up. Profile must be one closed outline (no holes): make hollow tubes with two sweeps and a boolean cut. bendRadius rounds every corner with an exact arc.
fillet {target, radius, edges}   chamfer {target, distance, edges}   shell {target, thickness, faces}
boolean {kind: union|cut|intersect, a, b}  -- consumes a and b, creates a new body with this step's id
transform {target, translate?:[x,y,z], rotate?:{angle,axis,origin?}}
In scripts the import step is called importFile(...) because 'import' is reserved JavaScript. Every step may carry id, label, suppressed. If you omit id one is generated (box1, extrude2 ...).
A body's id is the id of the step that created it. fillet/chamfer/shell/extrude add|cut/transform
modify their target body in place.`;

const selectors = `# Selecting edges and faces
Edge selector (fillet/chamfer): {all:true} or any of {direction:'X'|'Y'|'Z' (edges parallel to the axis),
  plane:{name,offset?} (edges lying in a plane), length (exact), box:{min,max} (entirely inside)}.
  Criteria combine with AND.
Face selector (shell: faces to remove/open): {plane:{name,offset?}} and/or {parallelTo:'XY'|'XZ'|'YZ'}.
ALWAYS add \`expect: N\` to say how many you expect to match. If the count differs the step fails with a
clear message instead of silently filleting the wrong thing. Beware: a circular hole's seam adds
vertical edges, so {direction:'Z'} on a plate with a hole matches more than the 4 outer corners;
use \`box\` to select by region, or fillet before cutting the hole.`;

const workflow = `# Recommended workflow
1. get_docs if unsure. 2. new_model. 3. set_param for every dimension you may want to change later.
4. Build with add_step (or one run_script). 5. Read the report after every change; fix the first error
(later steps are skipped after a failure). 6. measure to verify volume / bounding box / centre of mass
against what you intended. 7. view to give the user the live viewer link. 8. export_model (step for
fabrication/CAD, stl for printing) and save_model so work is not lost.
If a step fails: read its message, fix with remove_step + add_step (or re-run the script).`;

const examples = `# Examples
Bracket with four holes (script):
  param('t', 6);
  const s = sketch({ plane:'XY', profile:[
    { shape:'rect', w:60, h:40, cornerRadius:3 },
    { shape:'circle', r:2.5, cx:-22, cy:-12, cut:true }, { shape:'circle', r:2.5, cx:22, cy:-12, cut:true },
    { shape:'circle', r:2.5, cx:-22, cy: 12, cut:true }, { shape:'circle', r:2.5, cx:22, cy: 12, cut:true } ]});
  extrude({ id:'plate', sketch:s, distance:'t' });
Open box with rounded corners (tool calls):
  add_step {op:'box', id:'b', w:40, d:20, h:10}
  add_step {op:'fillet', target:'b', radius:3, edges:{direction:'Z', expect:4}}
  add_step {op:'shell', target:'b', thickness:2, faces:{plane:{name:'XY', offset:5}, expect:1}}
Drill a hole through a block:
  sketch {plane:'XY', offset:-5, profile:[{shape:'circle', r:4}]}  then
  extrude {sketch:<that id>, distance:10, mode:'cut', target:'blk'}`;

const TOPICS: Record<DocTopic, string> = {
  overview,
  conventions,
  steps,
  selectors,
  workflow,
  examples,
};

export function getDocs(topic?: DocTopic): string {
  if (topic) return TOPICS[topic];
  return DOC_TOPICS.map((t) => TOPICS[t]).join('\n\n');
}
