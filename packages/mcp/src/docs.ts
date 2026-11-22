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
sketch {plane, offset?, OR onFace:{target, normal:'+Z'..'-X', near?:[x,y,z]}, profile:[items]}  -- profile items: rect {w,h,cx?,cy?,cornerRadius?},
  circle {r,cx?,cy?}, polygon {points:[[x,y]...]}, ngon {sides,r,cx?,cy?}. Add "cut":true to subtract an item.
constrained_sketch {plane, offset?, OR onFace (same as sketch), points:{A:[x,y],...}, lines:{AB:['A','B'],...}, arcs:{a:{center:'O', start:'S', end:'E'}} (counter-clockwise from start to end; the three are named points), circles:{c:{center:'A', r}}, constraints:[{type,a,b?,value?,at?}], profile:[{loop:[line names], cut?} | {circle:name, cut?}]}
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
hole {target, at:[x,y,z] or a list, OR face:{normal, near?} + uv:[u,v] or a list (uvFrom?: world|center|corner; +Z/-Z faces uv=[x,y], +Y/-Y [x,z], +X/-X [y,z]; direction defaults to drilling into the part), direction? (+X -X +Y -Y +Z -Z, default -Z = down into a top face), size? (M2 M2.5 M3 M4 M5 M6 M8 M10) with fit? (normal clearance | close | tap = tap-drill for a threaded hole, cosmetic), or diameter?, depth? (omit = through), counterbore? (true = sized for a socket-head screw of that size), countersink? (true = 90 degree, 2x screw diameter), pattern?}
  -- 'at' is where the hole STARTS on the surface. The note reports what was drilled. Prefer face+uv: you never compute the surface coordinate; the note names the face it chose (outermost matching face, or the one nearest 'near').
  -- sketch onFace: the sketch lands on that face; profile coordinates are the face's in-plane world axes and the note says which way a positive extrude distance goes (use a negative distance with mode cut for a pocket into a +face).
pattern {target, tool: <body id>, pattern:{kind:'linear',count,step:[dx,dy,dz]} | {kind:'circular',count,axis,center?,angle?}, mode: cut|add}  -- repeats a body (consumed) into the target
mirror {target, axis: X|Y|Z, offset?, mode?: add (default, fuse the mirror image) | new}  -- mirror across the plane perpendicular to the axis
material {target, name}  -- assigns a library material (6061-T6, 7075-T6, mild-steel, stainless-304, alloy-steel-4140, brass, copper, titanium-6al4v, PLA, PETG, ABS, nylon, polycarbonate, TPU, acrylic, acetal, birch-plywood, hardwood). The build report and measure then include material and mass_g (volume x typical density; solid, so printed parts with infill weigh less). Booleans keep the first operand's material.
fillet {target, radius, edges}   chamfer {target, distance, edges}   shell {target, thickness, faces}
boolean {kind: union|cut|intersect, a, b}  -- consumes a and b, creates a new body with this step's id
transform {target, translate?:[x,y,z], rotate?:{angle,axis,origin?}}
In scripts the import step is called importFile(...) because 'import' is reserved JavaScript. Every step may carry id, label, suppressed. If you omit id one is generated (box1, extrude2 ...).
A body's id is the id of the step that created it. fillet/chamfer/shell/extrude add|cut/transform
modify their target body in place.`;

const selectors = `# Selecting edges and faces
Edge selector (fillet/chamfer): {all:true} or any of {direction:'X'|'Y'|'Z' (edges parallel to the axis),
  plane:{name,offset?} (edges lying in a plane), length (exact), lengthAtLeast / lengthAtMost (skip short hole/seam edges), curve:"line"|"circle", box:{min,max} (entirely inside)}.
  Criteria combine with AND.
Face selector (shell: faces to remove/open): {plane:{name,offset?}} and/or {parallelTo:'XY'|'XZ'|'YZ'}.
ALWAYS add \`expect: N\` to say how many you expect to match. If the count differs the step fails with a
clear message instead of silently filleting the wrong thing. Beware: a circular hole's seam adds
vertical edges, so {direction:'Z'} on a plate with a hole matches more than the 4 outer corners;
use \`box\` to select by region, or fillet before cutting the hole.`;

const workflow = `# Recommended workflow
1. get_docs if unsure. 2. new_model. 3. set_param for every dimension you may want to change later.
4. Build with add_step (or one run_script). 5. Read the report after every change; fix the first error
(later steps are skipped after a failure). 6. measure to verify volume / bounding box / centre of mass; section_properties {sketch} then beam_check / column_check for hand-calculation strength estimates (textbook formulas, NOT a simulation); the PROOF LOOP: write requirements with add_spec (dimension, mass, volume, no_interference, min_gap, beam, and the FEA-backed frame and solid_fea kinds, which stay PENDING until check_specs runs them) before modelling, read the live 'specs' verdict in every reply, check_specs for details, optimize_param to find the best value of one parameter that still passes, journal_add for decisions, build_pack to export README + STEP/STL + evidence; assemblies: place parts with transform or mate {target, face:{normal}, to:{body, normal}, gap?, center?} (face-to-face, no constraint solver), then check_assembly (all pairs), bom (quantities + mass), motion_check (sweep a body by translate/rotate and find the first collision); REAL FEA for frames of straight members: frame_analysis {nodes, members (material + round/rect/round_tube/rect_tube section or sketch), supports, loads, gravity} gives displacements, reactions, member forces, stress and safety factor; frame_modes gives natural frequencies. It is a beam-element model (rigid joints; no solid stress concentrations); validated against textbook beams; drawing {title?, number?, bodies?} writes an SVG drawing sheet (3 views, hidden lines, overall dimensions, title block); print_check {body, overhang_deg?, min_wall_mm?, build_volume_mm?} for FDM overhangs, support estimate, best print orientation, thin walls; solid_fea {body, material, supports:[{region:{face:{normal}}}], loads:[{region, force:[fx,fy,fz]}], gravity?, element_size_mm?} = 3D stress/displacement on a voxel grid (displacements reliable, peak stress approximate at holes/corners: refine and compare); mechanisms: fourbar_check {ground, crank, coupler, rocker} (Grashof type, transmission angle) and mechanism_sweep {points, grounds, links, sliders?, crank, track?, angles?, joints?} (planar linkage kinematics: where it locks, pin paths, joint angles); dynamics: mass_properties {body, axis?} (COM, inertia tensor, inertia about a hinge axis) then dynamics_sim (1-DOF RK4 in SI: pendulum, spring-damper, friction, DC motor, stops); frame_buckling (same inputs as frame_analysis): Euler buckling load factors of a frame (needs 4+ elements per slender member; keep a margin of 3); check_interference {a,b} to verify fits (overlap volume, touching, or the exact gap between two bodies)
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
