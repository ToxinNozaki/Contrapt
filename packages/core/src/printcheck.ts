// FDM printability check on the exact geometry's tessellation: overhang area and a support estimate for the current
// orientation and the six axis-aligned ones, local wall thickness by ray casting along the inward normal, bed contact,
// and a build-volume check. Heuristics from the 3D-printing knowledge pack; not a slicer.
import type { Model } from './engine.ts';

export interface PrintCheckInput {
  body: string;
  /** surfaces steeper than this from vertical need support (default 45) */
  overhangDeg?: number;
  /** walls thinner than this are flagged, mm (default 1.2 = three 0.4 mm lines) */
  minWallMm?: number;
  /** printer build volume [x, y, z] mm */
  buildVolume?: [number, number, number];
}

export interface OrientationResult {
  /** the model direction that points UP when printed */
  up: '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
  overhangAreaMm2: number;
  overhangPct: number;
  /** upper bound on support volume: overhang footprint x its height above the bed (ignores blocking by the part) */
  supportVolumeMm3: number;
  bedContactMm2: number;
  /** print height along up, mm */
  heightMm: number;
  fitsBuildVolume?: boolean;
}

export interface PrintCheckResult {
  body: string;
  triangles: number;
  surfaceAreaMm2: number;
  current: OrientationResult;
  orientations: OrientationResult[];
  recommended: OrientationResult;
  wall: {
    /** smallest local thickness found among the sampled surface, mm (undefined when nothing was measurable) */
    minMm?: number;
    atMm?: [number, number, number];
    /** share of the sampled surface thinner than minWallMm */
    thinPct: number;
    sampled: number;
    limitMm: number;
  };
  findings: { severity: 'warn' | 'info'; text: string }[];
  note: string;
}

type V = [number, number, number];
const r2 = (x: number) => Math.round(x * 100) / 100;

const UPS: { up: OrientationResult['up']; v: V }[] = [
  { up: '+Z', v: [0, 0, 1] },
  { up: '-Z', v: [0, 0, -1] },
  { up: '+X', v: [1, 0, 0] },
  { up: '-X', v: [-1, 0, 0] },
  { up: '+Y', v: [0, 1, 0] },
  { up: '-Y', v: [0, -1, 0] },
];

export function printCheck(model: Model, inp: PrintCheckInput): PrintCheckResult {
  const shape = model.bodies.get(inp.body);
  if (!shape)
    throw new Error(`No body "${inp.body}". Bodies: ${[...model.bodies.keys()].join(', ')}`);
  const overhangDeg = inp.overhangDeg ?? 45;
  const minWall = inp.minWallMm ?? 1.2;
  const mesh = shape.mesh({ tolerance: 0.05, angularTolerance: 0.1 });
  const nTri = mesh.triangles.length / 3;
  if (nTri === 0) throw new Error('The body has no surface to check');

  // geometric triangle data
  const p = mesh.vertices;
  const cx = new Float64Array(nTri);
  const cy = new Float64Array(nTri);
  const cz = new Float64Array(nTri);
  const nx = new Float64Array(nTri);
  const ny = new Float64Array(nTri);
  const nz = new Float64Array(nTri);
  const area = new Float64Array(nTri);
  let total = 0;
  for (let t = 0; t < nTri; t++) {
    const a = (mesh.triangles[t * 3] as number) * 3;
    const b = (mesh.triangles[t * 3 + 1] as number) * 3;
    const c = (mesh.triangles[t * 3 + 2] as number) * 3;
    const ux = (p[b] as number) - (p[a] as number);
    const uy = (p[b + 1] as number) - (p[a + 1] as number);
    const uz = (p[b + 2] as number) - (p[a + 2] as number);
    const vx = (p[c] as number) - (p[a] as number);
    const vy = (p[c + 1] as number) - (p[a + 1] as number);
    const vz = (p[c + 2] as number) - (p[a + 2] as number);
    const ex = uy * vz - uz * vy;
    const ey = uz * vx - ux * vz;
    const ez = ux * vy - uy * vx;
    const len = Math.hypot(ex, ey, ez);
    area[t] = len / 2;
    total += len / 2;
    if (len > 0) {
      nx[t] = ex / len;
      ny[t] = ey / len;
      nz[t] = ez / len;
    }
    cx[t] = ((p[a] as number) + (p[b] as number) + (p[c] as number)) / 3;
    cy[t] = ((p[a + 1] as number) + (p[b + 1] as number) + (p[c + 1] as number)) / 3;
    cz[t] = ((p[a + 2] as number) + (p[b + 2] as number) + (p[c + 2] as number)) / 3;
  }

  const bbox = model.report.bodies[inp.body]?.bbox;
  const sinLim = Math.sin((overhangDeg * Math.PI) / 180);

  const orient = (up: OrientationResult['up'], u: V): OrientationResult => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < nTri; t++) {
      const h = (cx[t] as number) * u[0] + (cy[t] as number) * u[1] + (cz[t] as number) * u[2];
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    // vertex extremes for an exact height
    let vlo = Infinity;
    let vhi = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const h = (p[i] as number) * u[0] + (p[i + 1] as number) * u[1] + (p[i + 2] as number) * u[2];
      vlo = Math.min(vlo, h);
      vhi = Math.max(vhi, h);
    }
    let over = 0;
    let bed = 0;
    let support = 0;
    for (let t = 0; t < nTri; t++) {
      const d = (nx[t] as number) * u[0] + (ny[t] as number) * u[1] + (nz[t] as number) * u[2];
      const h = (cx[t] as number) * u[0] + (cy[t] as number) * u[1] + (cz[t] as number) * u[2];
      if (d < -0.999 && h - vlo < 1e-3) {
        bed += area[t] as number;
        continue;
      }
      if (d < -sinLim) {
        over += area[t] as number;
        support += (area[t] as number) * -d * (h - vlo);
      }
    }
    const dims = bbox ? bbox.size : [0, 0, 0];
    const extent = [
      Math.abs(u[0]) ? dims[0] : 0,
      Math.abs(u[1]) ? dims[1] : 0,
      Math.abs(u[2]) ? dims[2] : 0,
    ];
    void lo;
    void hi;
    void extent;
    const result: OrientationResult = {
      up,
      overhangAreaMm2: r2(over),
      overhangPct: r2((over / total) * 100),
      supportVolumeMm3: r2(support),
      bedContactMm2: r2(bed),
      heightMm: r2(vhi - vlo),
    };
    if (inp.buildVolume && bbox) {
      // footprint axes are the two axes not along "up"
      const axis = Math.abs(u[0]) ? 0 : Math.abs(u[1]) ? 1 : 2;
      const foot = [0, 1, 2].filter((i) => i !== axis).map((i) => bbox.size[i] as number);
      const bv = inp.buildVolume;
      const fits =
        vhi - vlo <= bv[2] + 1e-9 &&
        (((foot[0] as number) <= bv[0] + 1e-9 && (foot[1] as number) <= bv[1] + 1e-9) ||
          ((foot[0] as number) <= bv[1] + 1e-9 && (foot[1] as number) <= bv[0] + 1e-9));
      result.fitsBuildVolume = fits;
    }
    return result;
  };

  const orientations = UPS.map((o) => orient(o.up, o.v));
  const current = orientations[0] as OrientationResult;
  // best: fits first, then least support volume, then least overhang, then the lowest print height
  const ranked = [...orientations].sort(
    (a, b) =>
      Number(b.fitsBuildVolume ?? true) - Number(a.fitsBuildVolume ?? true) ||
      a.supportVolumeMm3 - b.supportVolumeMm3 ||
      a.overhangAreaMm2 - b.overhangAreaMm2 ||
      a.heightMm - b.heightMm,
  );
  const recommended = ranked[0] as OrientationResult;

  // wall thickness: ray from each sampled triangle along its inward normal to the first surface hit
  const step = Math.max(1, Math.ceil(nTri / 800));
  const samples: number[] = [];
  for (let t = 0; t < nTri; t += step) samples.push(t);
  let minT = Infinity;
  let minAt: V | undefined;
  let thinArea = 0;
  let sampledArea = 0;
  let measured = 0;
  for (const t of samples) {
    const dx = -(nx[t] as number);
    const dy = -(ny[t] as number);
    const dz = -(nz[t] as number);
    if (dx === 0 && dy === 0 && dz === 0) continue;
    const ox = (cx[t] as number) + dx * 1e-4;
    const oy = (cy[t] as number) + dy * 1e-4;
    const oz = (cz[t] as number) + dz * 1e-4;
    let best = Infinity;
    for (let s = 0; s < nTri; s++) {
      if (s === t) continue;
      // the far wall is a surface the ray EXITS through: its outward normal points along the ray
      if ((nx[s] as number) * dx + (ny[s] as number) * dy + (nz[s] as number) * dz < 0.05) continue;
      const a = (mesh.triangles[s * 3] as number) * 3;
      const b = (mesh.triangles[s * 3 + 1] as number) * 3;
      const c = (mesh.triangles[s * 3 + 2] as number) * 3;
      const hit = rayTriangle(ox, oy, oz, dx, dy, dz, p, a, b, c);
      if (hit !== undefined && hit < best) best = hit;
    }
    if (!Number.isFinite(best)) continue;
    measured++;
    const w = area[t] as number;
    sampledArea += w;
    if (best < minWall) thinArea += w;
    if (best < minT) {
      minT = best;
      minAt = [cx[t] as number, cy[t] as number, cz[t] as number];
    }
  }

  const wall: PrintCheckResult['wall'] = {
    ...(Number.isFinite(minT) ? { minMm: r2(minT), atMm: minAt?.map(r2) as V } : {}),
    thinPct: sampledArea > 0 ? r2((thinArea / sampledArea) * 100) : 0,
    sampled: measured,
    limitMm: minWall,
  };

  const findings: PrintCheckResult['findings'] = [];
  if (current.overhangAreaMm2 > 0.5)
    findings.push({
      severity: 'warn',
      text: `${current.overhangAreaMm2} mm2 (${current.overhangPct}% of the surface) overhangs more than ${overhangDeg} degrees in the model's own orientation (+Z up): supports needed, up to about ${current.supportVolumeMm3} mm3.`,
    });
  if (recommended.up !== '+Z' && recommended.supportVolumeMm3 < current.supportVolumeMm3 * 0.8)
    findings.push({
      severity: 'info',
      text: `Printing with ${recommended.up} up cuts support volume from about ${current.supportVolumeMm3} to ${recommended.supportVolumeMm3} mm3 (overhang ${recommended.overhangAreaMm2} mm2, height ${recommended.heightMm} mm). Rotate the part in the slicer.`,
    });
  if (current.bedContactMm2 < 1)
    findings.push({
      severity: 'warn',
      text: 'No flat face touches the bed in the model orientation: the part has no stable base unless you rotate it or add a brim/support.',
    });
  if (wall.minMm !== undefined && wall.minMm < minWall)
    findings.push({
      severity: 'warn',
      text: `Thin walls: as thin as ${wall.minMm} mm near (${(wall.atMm ?? []).join(', ')}); ${wall.thinPct}% of the sampled surface is below ${minWall} mm. Thicken, or expect gaps and weak walls.`,
    });
  if (inp.buildVolume) {
    const fitsAny = orientations.some((o) => o.fitsBuildVolume);
    if (!fitsAny)
      findings.push({
        severity: 'warn',
        text: `The part does not fit the ${inp.buildVolume.join(' x ')} mm build volume in any axis-aligned orientation: split it or scale it.`,
      });
    else if (current.fitsBuildVolume === false)
      findings.push({
        severity: 'warn',
        text: `Does not fit the build volume with +Z up; ${recommended.fitsBuildVolume ? `fits with ${recommended.up} up` : 'another orientation fits'}.`,
      });
  }
  if (findings.length === 0)
    findings.push({
      severity: 'info',
      text: 'No overhang, base, wall or size problems found with these settings.',
    });

  return {
    body: inp.body,
    triangles: nTri,
    surfaceAreaMm2: r2(total),
    current,
    orientations,
    recommended,
    wall,
    findings,
    note: `Heuristic FDM check on a tessellation of the exact geometry: overhang angle ${overhangDeg} degrees from vertical, wall thickness by casting rays along the inward normal from up to 800 surface samples, support volume as an upper bound. It is not a slicer: bridging, tiny features and material limits are not modelled.`,
  };
}

/** Möller-Trumbore: distance along the ray to the triangle, or undefined. */
function rayTriangle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  p: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
): number | undefined {
  const e1x = (p[b] as number) - (p[a] as number);
  const e1y = (p[b + 1] as number) - (p[a + 1] as number);
  const e1z = (p[b + 2] as number) - (p[a + 2] as number);
  const e2x = (p[c] as number) - (p[a] as number);
  const e2y = (p[c + 1] as number) - (p[a + 1] as number);
  const e2z = (p[c + 2] as number) - (p[a + 2] as number);
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return undefined;
  const inv = 1 / det;
  const sx = ox - (p[a] as number);
  const sy = oy - (p[a + 1] as number);
  const sz = oz - (p[a + 2] as number);
  const u = (sx * hx + sy * hy + sz * hz) * inv;
  if (u < 0 || u > 1) return undefined;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return undefined;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-6 ? t : undefined;
}
