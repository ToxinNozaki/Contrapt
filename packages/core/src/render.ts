// Headless renderer: draws the model to a PNG so an AI (or a test) can SEE it.
// Pure JavaScript software rasteriser: no browser, GPU, or native dependency. Shaded triangles with a
// z-buffer, crisp feature edges, 2x supersampling, and a small axis triad (X red, Y green, Z blue).
// Coordinates: X right, Y forward, Z up (same as the viewer and the modelling tools).
import { crc32, deflateSync } from 'node:zlib';
import type { ViewerMesh } from './export.ts';

export const NAMED_VIEWS = {
  iso: { azimuth: 35, elevation: 30, projection: 'perspective' },
  front: { azimuth: 0, elevation: 0, projection: 'orthographic' },
  back: { azimuth: 180, elevation: 0, projection: 'orthographic' },
  right: { azimuth: 90, elevation: 0, projection: 'orthographic' },
  left: { azimuth: 270, elevation: 0, projection: 'orthographic' },
  top: { azimuth: 0, elevation: 90, projection: 'orthographic' },
  bottom: { azimuth: 0, elevation: -90, projection: 'orthographic' },
} as const;
export type ViewName = keyof typeof NAMED_VIEWS;

export interface RenderOptions {
  width?: number;
  height?: number;
  view?: ViewName;
  /** Degrees; 0 looks from -Y toward +Y (front), 90 from +X (right). Overrides the named view. */
  azimuth?: number;
  /** Degrees above the XY plane (90 = straight down). */
  elevation?: number;
  projection?: 'perspective' | 'orthographic';
  edges?: boolean;
  background?: 'light' | 'dark';
}

export interface RenderResult {
  png: Uint8Array;
  width: number;
  height: number;
  /** Plain-language description of the camera for the AI. */
  camera: string;
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const PALETTE: V3[] = [
  [142, 163, 184],
  [207, 141, 94],
  [127, 174, 149],
  [183, 159, 204],
  [214, 184, 95],
  [111, 166, 201],
];

const SS = 2; // supersampling factor

export function renderMeshes(meshes: ViewerMesh[], opts: RenderOptions = {}): RenderResult {
  const width = Math.max(64, Math.min(2048, Math.round(opts.width ?? 640)));
  const height = Math.max(64, Math.min(2048, Math.round(opts.height ?? opts.width ?? 640)));
  const named = NAMED_VIEWS[opts.view ?? 'iso'];
  const az = ((opts.azimuth ?? named.azimuth) * Math.PI) / 180;
  const el = ((opts.elevation ?? named.elevation) * Math.PI) / 180;
  const projection = opts.projection ?? named.projection;
  const W = width * SS;
  const H = height * SS;

  // ---- scene bounds ----
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (let i = 0; i < m.vertices.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = m.vertices[i + k] as number;
        if (v < (lo[k] as number)) lo[k] = v;
        if (v > (hi[k] as number)) hi[k] = v;
      }
    }
  }
  const empty = !Number.isFinite(lo[0]);
  const center: V3 = empty
    ? [0, 0, 0]
    : [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = empty
    ? 1
    : Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2, 1e-6);

  // ---- camera ----
  const dir: V3 = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
  const fov = (30 * Math.PI) / 180;
  const camDist = projection === 'perspective' ? (radius / Math.sin(fov / 2)) * 1.15 : radius * 4;
  const pos: V3 = [
    center[0] + dir[0] * camDist,
    center[1] + dir[1] * camDist,
    center[2] + dir[2] * camDist,
  ];
  const fwd = norm(sub(center, pos));
  const worldUp: V3 = Math.abs(fwd[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  const right = norm(cross(fwd, worldUp));
  const up = cross(right, fwd);
  const fitPx = (Math.min(W, H) / 2) * 0.86;
  const orthoScale = fitPx / radius;
  const persp = (H / 2 / Math.tan(fov / 2)) * 0.86;

  const project = (p: V3): [number, number, number] => {
    const d = sub(p, pos);
    const x = dot(d, right);
    const y = dot(d, up);
    const z = dot(d, fwd);
    if (projection === 'orthographic') return [W / 2 + x * orthoScale, H / 2 - y * orthoScale, z];
    const s = persp / Math.max(z, 1e-6);
    return [W / 2 + x * s, H / 2 - y * s, z];
  };

  // ---- buffers ----
  const dark = opts.background === 'dark';
  const top: V3 = dark ? [27, 33, 40] : [241, 244, 248];
  const bot: V3 = dark ? [15, 19, 23] : [217, 223, 231];
  const color = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      color[o] = top[0] + (bot[0] - top[0]) * t;
      color[o + 1] = top[1] + (bot[1] - top[1]) * t;
      color[o + 2] = top[2] + (bot[2] - top[2]) * t;
    }
  }
  const depth = new Float32Array(W * H).fill(Infinity);

  const keyLight = norm([0.45, -0.55, 0.75]);
  const fillLight = norm([-0.6, 0.3, 0.2]);
  const headlight: V3 = [-fwd[0], -fwd[1], -fwd[2]];
  const shade = (n: V3): number => {
    let nn = n;
    if (dot(nn, headlight) < 0) nn = [-n[0], -n[1], -n[2]]; // two-sided
    const k = Math.max(0, dot(nn, keyLight));
    const f = Math.max(0, dot(nn, fillLight));
    const h = Math.max(0, dot(nn, headlight));
    return Math.min(1.1, 0.32 + 0.45 * k + 0.12 * f + 0.28 * h);
  };

  // ---- triangles ----
  meshes.forEach((m, mi) => {
    const base = PALETTE[mi % PALETTE.length] as V3;
    const vtx = (i: number): V3 => [
      m.vertices[3 * i] as number,
      m.vertices[3 * i + 1] as number,
      m.vertices[3 * i + 2] as number,
    ];
    const nrm = (i: number): V3 => [
      m.normals[3 * i] as number,
      m.normals[3 * i + 1] as number,
      m.normals[3 * i + 2] as number,
    ];
    for (let t = 0; t < m.triangles.length; t += 3) {
      const ia = m.triangles[t] as number;
      const ib = m.triangles[t + 1] as number;
      const ic = m.triangles[t + 2] as number;
      const a = project(vtx(ia));
      const b = project(vtx(ib));
      const c = project(vtx(ic));
      if (a[2] <= 0 || b[2] <= 0 || c[2] <= 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      const na = nrm(ia);
      const nb = nrm(ib);
      const nc = nrm(ic);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
          const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
          const idx = y * W + x;
          if (z >= (depth[idx] as number)) continue;
          depth[idx] = z;
          const n = norm([
            w0 * na[0] + w1 * nb[0] + w2 * nc[0],
            w0 * na[1] + w1 * nb[1] + w2 * nc[1],
            w0 * na[2] + w1 * nb[2] + w2 * nc[2],
          ]);
          const s = shade(n);
          const o = idx * 3;
          color[o] = Math.min(255, base[0] * s);
          color[o + 1] = Math.min(255, base[1] * s);
          color[o + 2] = Math.min(255, base[2] * s);
        }
      }
    }
  });

  // ---- feature edges ----
  const ink: V3 = dark ? [225, 232, 240] : [27, 36, 48];
  const drawLine = (p: [number, number, number], q: [number, number, number], bias: number) => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    if (steps > 20000) return;
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const x = Math.round(p[0] + dx * t);
      const y = Math.round(p[1] + dy * t);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const z = p[2] + (q[2] - p[2]) * t;
      const idx = y * W + x;
      if (z > (depth[idx] as number) + bias) continue;
      const o = idx * 3;
      color[o] = (color[o] as number) * 0.3 + ink[0] * 0.7;
      color[o + 1] = (color[o + 1] as number) * 0.3 + ink[1] * 0.7;
      color[o + 2] = (color[o + 2] as number) * 0.3 + ink[2] * 0.7;
    }
  };
  if (opts.edges !== false) {
    const q = (v: number) => Math.round((v / radius) * 20000);
    for (const m of meshes) {
      const faceN = (t: number): V3 => {
        const p0: V3 = [
          m.vertices[3 * (m.triangles[t] as number)] as number,
          m.vertices[3 * (m.triangles[t] as number) + 1] as number,
          m.vertices[3 * (m.triangles[t] as number) + 2] as number,
        ];
        const p1: V3 = [
          m.vertices[3 * (m.triangles[t + 1] as number)] as number,
          m.vertices[3 * (m.triangles[t + 1] as number) + 1] as number,
          m.vertices[3 * (m.triangles[t + 1] as number) + 2] as number,
        ];
        const p2: V3 = [
          m.vertices[3 * (m.triangles[t + 2] as number)] as number,
          m.vertices[3 * (m.triangles[t + 2] as number) + 1] as number,
          m.vertices[3 * (m.triangles[t + 2] as number) + 2] as number,
        ];
        return norm(cross(sub(p1, p0), sub(p2, p0)));
      };
      const key = (i: number) =>
        `${q(m.vertices[3 * i] as number)},${q(m.vertices[3 * i + 1] as number)},${q(m.vertices[3 * i + 2] as number)}`;
      const edgeMap = new Map<string, { a: number; b: number; normals: V3[] }>();
      for (let t = 0; t < m.triangles.length; t += 3) {
        const n = faceN(t);
        for (let e = 0; e < 3; e++) {
          const i = m.triangles[t + e] as number;
          const j = m.triangles[t + ((e + 1) % 3)] as number;
          const ka = key(i);
          const kb = key(j);
          const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          const rec = edgeMap.get(k);
          if (rec) rec.normals.push(n);
          else edgeMap.set(k, { a: i, b: j, normals: [n] });
        }
      }
      const cosLimit = Math.cos((28 * Math.PI) / 180);
      for (const { a, b, normals } of edgeMap.values()) {
        const feature =
          normals.length === 1 ||
          (normals.length >= 2 && dot(normals[0] as V3, normals[1] as V3) < cosLimit);
        if (!feature) continue;
        const pa = project([
          m.vertices[3 * a] as number,
          m.vertices[3 * a + 1] as number,
          m.vertices[3 * a + 2] as number,
        ]);
        const pb = project([
          m.vertices[3 * b] as number,
          m.vertices[3 * b + 1] as number,
          m.vertices[3 * b + 2] as number,
        ]);
        if (pa[2] <= 0 || pb[2] <= 0) continue;
        drawLine(pa, pb, radius * 0.004);
      }
    }
  }

  // ---- axis triad (bottom-left): X red, Y green, Z blue ----
  {
    const ox = 28 * SS;
    const oy = H - 28 * SS;
    const len = 20 * SS;
    const axes: [V3, V3][] = [
      [
        [1, 0, 0],
        [220, 60, 55],
      ],
      [
        [0, 1, 0],
        [50, 160, 85],
      ],
      [
        [0, 0, 1],
        [60, 100, 225],
      ],
    ];
    for (const [ax, rgb] of axes) {
      const sx = dot(ax, right) * len;
      const sy = -dot(ax, up) * len;
      const steps = Math.ceil(Math.max(Math.abs(sx), Math.abs(sy), 1));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(ox + (sx * s) / steps);
        const y = Math.round(oy + (sy * s) / steps);
        for (let dy = 0; dy < SS; dy++) {
          for (let dx = 0; dx < SS; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const o = (yy * W + xx) * 3;
            color[o] = rgb[0];
            color[o + 1] = rgb[1];
            color[o + 2] = rgb[2];
          }
        }
      }
    }
  }

  // ---- downsample ----
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let dy = 0; dy < SS; dy++)
          for (let dx = 0; dx < SS; dx++)
            s += color[((y * SS + dy) * W + (x * SS + dx)) * 3 + ch] as number;
        out[(y * width + x) * 3 + ch] = Math.round(s / (SS * SS));
      }
    }
  }

  const viewName =
    opts.azimuth === undefined && opts.elevation === undefined ? (opts.view ?? 'iso') : 'custom';
  const camera =
    `${viewName} view, ${projection}, azimuth ${Math.round((az * 180) / Math.PI)} deg, elevation ${Math.round((el * 180) / Math.PI)} deg. Axes triad bottom-left: X red, Y green, Z blue. ${empty ? 'The model is empty.' : ''}`.trim();
  return { png: encodePng(out, width, height), width, height, camera };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode 8-bit RGB pixels as a PNG. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
