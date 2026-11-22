// The fitted structured hexahedral mesh shared by the solid solvers (elasticity, thermal): voxelise the exact body on a
// regular grid that spans its bounding box, number the active nodes, snap boundary nodes onto the exact surface (with
// Jacobian safeguards), and let the caller build the element matrices of every distorted element.
import { measureVolume, type Shape3D } from 'replicad';
import type { V3 } from './path.ts';
import { HEX_SIGNS, indexSurface, minCornerJacobian } from './solidfit.ts';

const SIGNS = HEX_SIGNS;

export interface SolidMesh {
  hv: V3;
  lo: V3;
  n: [number, number, number];
  hmax: number;
  solid: Uint8Array;
  nElem: number;
  nNodes: number;
  conn: Int32Array;
  /** node coordinates on the regular grid, before fitting */
  base: Float64Array;
  /** final node coordinates (fitted when fit is on) */
  xyz: Float64Array;
  centers: Float64Array;
  /** element volumes (brick volume unless the element is distorted) */
  evol: Float64Array;
  /** per element: index into distK, or -1 for an undistorted brick */
  distIdx: Int32Array;
  /** concatenated element matrices of the distorted elements, `keSize` numbers each */
  distK: Float64Array;
  brickVol: number;
  snappedNodes: number;
  relaxedNodes: number;
  /** worst corner Jacobian relative to an undistorted brick */
  minJ: number;
  warnings: string[];
  /** exposed faces, one code per face: element * 6 + axis * 2 + (outward sign > 0 ? 1 : 0) */
  boundaryFaces: Int32Array;
  /** grid coordinate of an active node (used to select supports and loads by region) */
  coordOf: (a: number) => V3;
  gatherXe: (e: number, out: Float64Array) => void;
}

export interface MeshOptions {
  fit: boolean;
  maxElements: number;
  /** numbers per distorted-element matrix (576 for 24 x 24 elasticity, 64 for 8 x 8 conduction) */
  keSize: number;
  /** given the cell size, return a function that builds the matrix and volume of a distorted element from its 24 corner coordinates */
  element: (hv: V3) => (xe: Float64Array) => { K: Float64Array; volume: number };
}

export function voxelise(shape: Shape3D, lo: V3, hv: V3, n: [number, number, number]) {
  const [nx, ny, nz] = n;
  const mesh = shape.mesh({
    tolerance: Math.max(Math.min(...hv) * 0.02, 0.005),
    angularTolerance: 0.1,
  });
  const p = mesh.vertices;
  const cols: number[][] = Array.from({ length: nx * ny }, () => []);
  // jitter the sample column slightly so rays never run exactly along a mesh edge
  const jx = hv[0] * 1.3e-6;
  const jy = hv[1] * 0.7e-6;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const ia = (mesh.triangles[t] as number) * 3;
    const ib = (mesh.triangles[t + 1] as number) * 3;
    const ic = (mesh.triangles[t + 2] as number) * 3;
    const ax = p[ia] as number;
    const ay = p[ia + 1] as number;
    const az = p[ia + 2] as number;
    const bx = p[ib] as number;
    const by = p[ib + 1] as number;
    const bz = p[ib + 2] as number;
    const cx = p[ic] as number;
    const cy = p[ic + 1] as number;
    const cz = p[ic + 2] as number;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-14) continue; // vertical triangle: contributes no crossings
    const minx = Math.min(ax, bx, cx);
    const maxx = Math.max(ax, bx, cx);
    const miny = Math.min(ay, by, cy);
    const maxy = Math.max(ay, by, cy);
    const i0 = Math.max(0, Math.floor((minx - lo[0]) / hv[0] - 0.5));
    const i1 = Math.min(nx - 1, Math.ceil((maxx - lo[0]) / hv[0] - 0.5));
    const j0 = Math.max(0, Math.floor((miny - lo[1]) / hv[1] - 0.5));
    const j1 = Math.min(ny - 1, Math.ceil((maxy - lo[1]) / hv[1] - 0.5));
    for (let i = i0; i <= i1; i++) {
      const x = lo[0] + (i + 0.5) * hv[0] + jx;
      for (let j = j0; j <= j1; j++) {
        const y = lo[1] + (j + 0.5) * hv[1] + jy;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        (cols[i + j * nx] as number[]).push(l1 * az + l2 * bz + l3 * cz);
      }
    }
  }
  const solid = new Uint8Array(nx * ny * nz);
  let bad = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const zs = (cols[i + j * nx] as number[]).sort((a, b) => a - b);
      if (zs.length % 2 === 1) {
        bad++;
        continue;
      }
      for (let k = 0; k < nz; k++) {
        const zc = lo[2] + (k + 0.5) * hv[2];
        let below = 0;
        for (const z of zs) if (z < zc) below++;
        if (below % 2 === 1) solid[i + nx * (j + ny * k)] = 1;
      }
    }
  return { solid, badColumns: bad };
}

export function buildSolidMesh(shape: Shape3D, h: number, opts: MeshOptions): SolidMesh {
  const [bmin, bmax] = shape.boundingBox.bounds as unknown as [number[], number[]];
  const lo: V3 = [bmin[0] as number, bmin[1] as number, bmin[2] as number];
  const hi: V3 = [bmax[0] as number, bmax[1] as number, bmax[2] as number];
  const n: [number, number, number] = [
    Math.max(1, Math.round((hi[0] - lo[0]) / h)),
    Math.max(1, Math.round((hi[1] - lo[1]) / h)),
    Math.max(1, Math.round((hi[2] - lo[2]) / h)),
  ];
  // the cell size differs slightly per axis so the grid spans the bounding box exactly (a 6 mm section stays 6 mm)
  const hv: V3 = [(hi[0] - lo[0]) / n[0], (hi[1] - lo[1]) / n[1], (hi[2] - lo[2]) / n[2]];
  const hmax = Math.max(...hv);
  const [nx, ny, nz] = n;
  const maxEl = opts.maxElements;
  if (nx * ny * nz > maxEl * 4)
    throw new Error(
      `The bounding grid is ${nx} x ${ny} x ${nz} = ${nx * ny * nz} cells: use a larger elementSize (limit about ${maxEl} solid elements)`,
    );

  const { solid, badColumns } = voxelise(shape, lo, hv, n);
  const warnings: string[] = [];
  if (badColumns > 0)
    warnings.push(
      `${badColumns} grid column(s) crossed the surface an odd number of times (open or non-manifold mesh); those columns were left empty`,
    );

  // active nodes
  const nodeIndex = new Int32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(-1);
  const nid = (i: number, j: number, k: number) => i + (nx + 1) * (j + (ny + 1) * k);
  let nElem = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!solid[i + nx * (j + ny * k)]) continue;
        nElem++;
        for (const [sx, sy, sz] of SIGNS) {
          const gi = nid(i + (sx > 0 ? 1 : 0), j + (sy > 0 ? 1 : 0), k + (sz > 0 ? 1 : 0));
          if (nodeIndex[gi] === -1) nodeIndex[gi] = -2;
        }
      }
  if (nElem === 0)
    throw new Error('The grid captured no solid: the element size may be larger than the part');
  if (nElem > maxEl)
    throw new Error(
      `${nElem} elements is more than the limit of ${maxEl}: use a larger elementSize`,
    );
  let nNodes = 0;
  const nodeGrid: number[] = []; // active node -> grid id
  for (let g = 0; g < nodeIndex.length; g++)
    if (nodeIndex[g] === -2) {
      nodeIndex[g] = nNodes++;
      nodeGrid.push(g);
    }
  const coordOf = (a: number): V3 => {
    const g = nodeGrid[a] as number;
    const i = g % (nx + 1);
    const j = Math.floor(g / (nx + 1)) % (ny + 1);
    const k = Math.floor(g / ((nx + 1) * (ny + 1)));
    return [lo[0] + i * hv[0], lo[1] + j * hv[1], lo[2] + k * hv[2]];
  };
  const conn = new Int32Array(nElem * 8);
  const centers = new Float64Array(nElem * 3);
  {
    let e = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (!solid[i + nx * (j + ny * k)]) continue;
          let a = 0;
          for (const [sx, sy, sz] of SIGNS) {
            conn[e * 8 + a] = nodeIndex[
              nid(i + (sx > 0 ? 1 : 0), j + (sy > 0 ? 1 : 0), k + (sz > 0 ? 1 : 0))
            ] as number;
            a++;
          }
          centers[e * 3] = lo[0] + (i + 0.5) * hv[0];
          centers[e * 3 + 1] = lo[1] + (j + 0.5) * hv[1];
          centers[e * 3 + 2] = lo[2] + (k + 0.5) * hv[2];
          e++;
        }
  }

  const faceCodes: number[] = [];
  {
    let e = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (!solid[i + nx * (j + ny * k)]) continue;
          for (let ax = 0; ax < 3; ax++)
            for (const sg of [-1, 1]) {
              const ni = i + (ax === 0 ? sg : 0);
              const nj = j + (ax === 1 ? sg : 0);
              const nk = k + (ax === 2 ? sg : 0);
              const open =
                ni < 0 ||
                nj < 0 ||
                nk < 0 ||
                ni >= nx ||
                nj >= ny ||
                nk >= nz ||
                !solid[ni + nx * (nj + ny * nk)];
              if (open) faceCodes.push(e * 6 + ax * 2 + (sg > 0 ? 1 : 0));
            }
          e++;
        }
  }

  const makeElement = opts.element(hv);
  const base = new Float64Array(nNodes * 3);
  for (let a = 0; a < nNodes; a++) {
    const c = coordOf(a);
    base[a * 3] = c[0];
    base[a * 3 + 1] = c[1];
    base[a * 3 + 2] = c[2];
  }
  const xyz = Float64Array.from(base);
  const brickVol = hv[0] * hv[1] * hv[2];
  const evol = new Float64Array(nElem).fill(brickVol);
  const distIdx = new Int32Array(nElem).fill(-1);
  let distK = new Float64Array(0);
  let snappedNodes = 0;
  let relaxedNodes = 0;
  let minJ = 1;
  const gatherXe = (e: number, out: Float64Array) => {
    for (let a = 0; a < 8; a++) {
      const nd = (conn[e * 8 + a] as number) * 3;
      out[a * 3] = xyz[nd] as number;
      out[a * 3 + 1] = xyz[nd + 1] as number;
      out[a * 3 + 2] = xyz[nd + 2] as number;
    }
  };
  if (opts.fit) {
    const bnd = new Uint8Array(nNodes);
    {
      let e = 0;
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++) {
            if (!solid[i + nx * (j + ny * k)]) continue;
            for (let ax = 0; ax < 3; ax++)
              for (const sg of [-1, 1]) {
                const ni = i + (ax === 0 ? sg : 0);
                const nj = j + (ax === 1 ? sg : 0);
                const nk = k + (ax === 2 ? sg : 0);
                const open =
                  ni < 0 ||
                  nj < 0 ||
                  nk < 0 ||
                  ni >= nx ||
                  nj >= ny ||
                  nk >= nz ||
                  !solid[ni + nx * (nj + ny * nk)];
                if (!open) continue;
                for (let a = 0; a < 8; a++)
                  if ((SIGNS[a] as [number, number, number])[ax] === sg)
                    bnd[conn[e * 8 + a] as number] = 1;
              }
            e++;
          }
    }
    const mesh = shape.mesh({
      tolerance: Math.max(Math.min(...hv) * 0.02, 0.005),
      angularTolerance: 0.1,
    });
    const index = indexSurface(mesh.vertices, mesh.triangles, lo, 2 * hmax);
    const target = Float64Array.from(base);
    const alpha = new Float64Array(nNodes);
    let farSkipped = 0;
    for (let a = 0; a < nNodes; a++) {
      if (!bnd[a]) continue;
      const q = index.nearest([
        base[a * 3] as number,
        base[a * 3 + 1] as number,
        base[a * 3 + 2] as number,
      ]);
      if (!q || q.dist < 1e-9 * hmax) continue;
      if (q.dist > 0.95 * hmax) {
        farSkipped++;
        continue;
      }
      target[a * 3] = q.point[0];
      target[a * 3 + 1] = q.point[1];
      target[a * 3 + 2] = q.point[2];
      alpha[a] = 1;
    }
    const place = () => {
      for (let a = 0; a < nNodes; a++)
        for (let d = 0; d < 3; d++)
          xyz[a * 3 + d] =
            (base[a * 3 + d] as number) +
            (alpha[a] as number) * ((target[a * 3 + d] as number) - (base[a * 3 + d] as number));
    };
    const ref = brickVol / 8;
    const xe = new Float64Array(24);
    for (let round = 0; round < 24; round++) {
      place();
      let bad = 0;
      for (let e = 0; e < nElem; e++) {
        gatherXe(e, xe);
        if (minCornerJacobian(xe, ref) < 0.1) {
          bad++;
          for (let a = 0; a < 8; a++) {
            const nd = conn[e * 8 + a] as number;
            if ((alpha[nd] as number) > 0)
              alpha[nd] = (alpha[nd] as number) < 0.1 ? 0 : (alpha[nd] as number) * 0.5;
          }
        }
      }
      if (bad === 0) break;
    }
    place();
    for (let a = 0; a < nNodes; a++) {
      const moved = Math.hypot(
        (xyz[a * 3] as number) - (base[a * 3] as number),
        (xyz[a * 3 + 1] as number) - (base[a * 3 + 1] as number),
        (xyz[a * 3 + 2] as number) - (base[a * 3 + 2] as number),
      );
      if (moved > 1e-9 * hmax) snappedNodes++;
      const wanted = Math.hypot(
        (target[a * 3] as number) - (base[a * 3] as number),
        (target[a * 3 + 1] as number) - (base[a * 3 + 1] as number),
        (target[a * 3 + 2] as number) - (base[a * 3 + 2] as number),
      );
      if (wanted > 1e-9 * hmax && moved < wanted * 0.999) relaxedNodes++;
    }
    if (farSkipped > 0)
      warnings.push(
        `${farSkipped} boundary node(s) were more than 0.95 element sizes from the surface (thin or sharp features) and were left in place`,
      );
    // element matrices for every element that has a moved node
    let nd = 0;
    const flagged: number[] = [];
    for (let e = 0; e < nElem; e++) {
      let any = false;
      for (let a = 0; a < 8 && !any; a++) {
        const node = (conn[e * 8 + a] as number) * 3;
        for (let d = 0; d < 3; d++)
          if (Math.abs((xyz[node + d] as number) - (base[node + d] as number)) > 1e-12) any = true;
      }
      if (any) {
        distIdx[e] = nd++;
        flagged.push(e);
      }
    }
    distK = new Float64Array(nd * opts.keSize);
    minJ = Number.POSITIVE_INFINITY;
    for (const e of flagged) {
      gatherXe(e, xe);
      minJ = Math.min(minJ, minCornerJacobian(xe, ref));
      let out: { K: Float64Array; volume: number };
      try {
        out = makeElement(xe);
      } catch {
        throw new Error(
          'The fitted mesh has an inverted element: use a smaller elementSize or set fit to false',
        );
      }
      distK.set(out.K, (distIdx[e] as number) * opts.keSize);
      evol[e] = out.volume;
    }
    if (!Number.isFinite(minJ)) minJ = 1;
    if (minJ < 0.15)
      warnings.push(
        `Some fitted elements are strongly distorted (worst corner Jacobian ratio ${Math.round(minJ * 100) / 100}): refine the grid there for reliable results`,
      );
  }
  // element centres from the final node positions
  for (let e = 0; e < nElem; e++) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let a = 0; a < 8; a++) {
      const nd2 = (conn[e * 8 + a] as number) * 3;
      sx += xyz[nd2] as number;
      sy += xyz[nd2 + 1] as number;
      sz += xyz[nd2 + 2] as number;
    }
    centers[e * 3] = sx / 8;
    centers[e * 3 + 1] = sy / 8;
    centers[e * 3 + 2] = sz / 8;
  }
  return {
    hv,
    lo,
    n,
    hmax,
    solid,
    nElem,
    nNodes,
    conn,
    base,
    xyz,
    centers,
    evol,
    distIdx,
    distK,
    brickVol,
    snappedNodes,
    relaxedNodes,
    minJ,
    warnings,
    boundaryFaces: Int32Array.from(faceCodes),
    coordOf,
    gatherXe,
  };
}

/** Sum of element volumes divided by the exact volume of the shape: 1 means the mesh represents the body exactly. */
export function meshVolumeRatio(mesh: SolidMesh, shape: Shape3D): number {
  let v = 0;
  for (let e = 0; e < mesh.nElem; e++) v += mesh.evol[e] as number;
  return v / Math.abs(measureVolume(shape.clone()));
}

/** The four corner nodes of an element face, in cyclic order. */
export function faceCorners(mesh: SolidMesh, code: number): [number, number, number, number] {
  const e = Math.floor(code / 6);
  const ax = Math.floor((code % 6) / 2);
  const sg = code % 2 === 1 ? 1 : -1;
  const [u, v] = [0, 1, 2].filter((d) => d !== ax) as [number, number];
  const pick = (su: number, sv: number) => {
    for (let a = 0; a < 8; a++) {
      const s = SIGNS[a] as [number, number, number];
      if (s[ax] === sg && s[u] === su && s[v] === sv) return mesh.conn[e * 8 + a] as number;
    }
    throw new Error('internal: face corner not found');
  };
  return [pick(-1, -1), pick(1, -1), pick(1, 1), pick(-1, 1)];
}

/** Area of a (possibly curved-by-fitting) quad face from its two diagonals. */
export function faceArea(mesh: SolidMesh, corners: readonly number[]): number {
  const p = (i: number) => [
    mesh.xyz[(corners[i] as number) * 3] as number,
    mesh.xyz[(corners[i] as number) * 3 + 1] as number,
    mesh.xyz[(corners[i] as number) * 3 + 2] as number,
  ];
  const [p0, p1, p2, p3] = [p(0), p(1), p(2), p(3)] as [number[], number[], number[], number[]];
  const d1 = [
    (p2[0] as number) - (p0[0] as number),
    (p2[1] as number) - (p0[1] as number),
    (p2[2] as number) - (p0[2] as number),
  ];
  const d2 = [
    (p3[0] as number) - (p1[0] as number),
    (p3[1] as number) - (p1[1] as number),
    (p3[2] as number) - (p1[2] as number),
  ];
  const cx = (d1[1] as number) * (d2[2] as number) - (d1[2] as number) * (d2[1] as number);
  const cy = (d1[2] as number) * (d2[0] as number) - (d1[0] as number) * (d2[2] as number);
  const cz = (d1[0] as number) * (d2[1] as number) - (d1[1] as number) * (d2[0] as number);
  return 0.5 * Math.hypot(cx, cy, cz);
}
