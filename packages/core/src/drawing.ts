// 2D drawing sheets: third-angle orthographic views of the exact geometry (front, top, right) with hidden lines,
// overall dimensions, an automatic standard scale and a title block, as a single SVG (millimetres, A4 landscape).
import { drawProjection, type Shape3D } from 'replicad';
import type { Model } from './engine.ts';

export interface SheetOptions {
  /** body ids to draw (default: all) */
  bodies?: string[];
  title?: string;
  /** free text for the title block, e.g. a drawing number */
  number?: string;
  /** hide hidden-line detail */
  hiddenLines?: boolean;
}

export interface SheetResult {
  svg: string;
  scale: string;
  /** overall size of what was drawn, mm: [x, y, z] */
  overall: [number, number, number];
  views: string[];
  warnings: string[];
  /** sheet-space rectangles (mm): each view including its dimension lines, and the title block */
  layout: Record<string, { x: number; y: number; w: number; h: number }>;
}

const SHEET_W = 297;
const SHEET_H = 210;
const MARGIN = 10;
const TITLE_H = 26;
const GAP = 24; // room between views for dimension lines
const NICE = [
  100,
  50,
  20,
  10,
  5,
  2,
  1,
  1 / 2,
  1 / 5,
  1 / 10,
  1 / 20,
  1 / 50,
  1 / 100,
  1 / 200,
  1 / 500,
  1 / 1000,
];

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (x: number) => String(Math.round(x * 1000) / 1000);
const dimText = (x: number) => String(Math.round(x * 100) / 100);

interface ViewGeom {
  name: 'front' | 'top' | 'right';
  paths: string[];
  hidden: string[];
  minx: number;
  miny: number;
  w: number;
  h: number;
}

function parseViewBox(vb: string) {
  const m = /viewBox="([^"]+)"/.exec(vb);
  const p = (m?.[1] ?? '').split(/\s+/).map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isFinite(v))) return undefined;
  return { minx: p[0] as number, miny: p[1] as number, w: p[2] as number, h: p[3] as number };
}

function projectViews(shapes: Shape3D[], hiddenLines: boolean): ViewGeom[] {
  const out: ViewGeom[] = [];
  for (const name of ['front', 'top', 'right'] as const) {
    const paths: string[] = [];
    const hidden: string[] = [];
    let box: { x0: number; y0: number; x1: number; y1: number } | undefined;
    for (const s of shapes) {
      const { visible, hidden: hid } = drawProjection(s.clone(), name);
      const vb = parseViewBox(visible.toSVG(0));
      if (!vb) continue;
      paths.push(...visible.toSVGPaths().flat());
      if (hiddenLines) hidden.push(...hid.toSVGPaths().flat());
      const b = { x0: vb.minx, y0: vb.miny, x1: vb.minx + vb.w, y1: vb.miny + vb.h };
      box = box
        ? {
            x0: Math.min(box.x0, b.x0),
            y0: Math.min(box.y0, b.y0),
            x1: Math.max(box.x1, b.x1),
            y1: Math.max(box.y1, b.y1),
          }
        : b;
    }
    if (!box) continue;
    out.push({
      name,
      paths,
      hidden,
      minx: box.x0,
      miny: box.y0,
      w: box.x1 - box.x0,
      h: box.y1 - box.y0,
    });
  }
  return out;
}

function scaleLabel(s: number) {
  return s >= 1 ? `${num(s)}:1` : `1:${num(1 / s)}`;
}

/** A dimension line with arrowheads and a centred label. Horizontal when (x1,y1)-(x2,y2) is horizontal. */
function dimension(
  kind: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  ext: [number, number, number, number][],
) {
  const horizontal = Math.abs(y2 - y1) < 1e-9;
  const a = 2.2; // arrowhead length
  const w = 0.7;
  const arrow = (x: number, y: number, dx: number, dy: number) => {
    const px = -dy;
    const py = dx;
    return `<path d="M ${num(x)} ${num(y)} l ${num(-dx * a + px * w)} ${num(-dy * a + py * w)} l ${num(-2 * px * w)} ${num(-2 * py * w)} z" fill="#111" stroke="none"/>`;
  };
  const dx = horizontal ? Math.sign(x2 - x1) : 0;
  const dy = horizontal ? 0 : Math.sign(y2 - y1);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const text = horizontal
    ? `<text x="${num(mx)}" y="${num(my - 1.2)}" text-anchor="middle" data-dim="${kind}">${esc(label)}</text>`
    : `<text transform="translate(${num(mx - 1.2)} ${num(my)}) rotate(-90)" text-anchor="middle" data-dim="${kind}">${esc(label)}</text>`;
  return [
    ...ext.map(
      ([a1, b1, a2, b2]) =>
        `<line x1="${num(a1)}" y1="${num(b1)}" x2="${num(a2)}" y2="${num(b2)}" stroke="#555" stroke-width="0.18"/>`,
    ),
    `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="#111" stroke-width="0.25"/>`,
    arrow(x1, y1, -dx, -dy),
    arrow(x2, y2, dx, dy),
    text,
  ].join('');
}

export function drawingSheet(model: Model, opts: SheetOptions = {}): SheetResult {
  const ids = opts.bodies ?? [...model.bodies.keys()];
  if (ids.length === 0) throw new Error('The model has no bodies to draw');
  const shapes: Shape3D[] = [];
  const warnings: string[] = [];
  for (const id of ids) {
    const s = model.bodies.get(id);
    if (!s) throw new Error(`No body "${id}". Bodies: ${[...model.bodies.keys()].join(', ')}`);
    shapes.push(s);
  }
  // overall size of what is drawn
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const b = model.report.bodies[id];
    if (!b) continue;
    for (let i = 0; i < 3; i++) {
      mins[i] = Math.min(mins[i] as number, b.bbox.min[i] as number);
      maxs[i] = Math.max(maxs[i] as number, b.bbox.max[i] as number);
    }
  }
  const overall: [number, number, number] = [
    (maxs[0] as number) - (mins[0] as number),
    (maxs[1] as number) - (mins[1] as number),
    (maxs[2] as number) - (mins[2] as number),
  ];

  const views = projectViews(shapes, opts.hiddenLines ?? true);
  const front = views.find((v) => v.name === 'front');
  const top = views.find((v) => v.name === 'top');
  const right = views.find((v) => v.name === 'right');
  if (!front || !top || !right)
    throw new Error('Could not project the model (is it empty or degenerate?)');

  // third-angle layout: top above front, right to the right of front
  const availW = SHEET_W - 2 * MARGIN;
  const availH = SHEET_H - 2 * MARGIN - TITLE_H;
  const needW = front.w + right.w;
  const needH = top.h + front.h;
  const fit = (s: number) => needW * s + 2 * GAP <= availW && needH * s + 2 * GAP <= availH;
  const scale = NICE.find(fit) ?? (NICE[NICE.length - 1] as number);
  if (!fit(scale))
    warnings.push(
      'The model is too large or too small for a standard scale on A4; it may overflow the sheet',
    );

  const fw = front.w * scale;
  const fh = front.h * scale;
  const tw = top.w * scale;
  const th = top.h * scale;
  const rw = right.w * scale;
  const rh = right.h * scale;
  const blockW = Math.max(fw, tw) + GAP + rw;
  const blockH = th + GAP + Math.max(fh, rh);
  const originX = MARGIN + (availW - blockW) / 2;
  const originY = MARGIN + (availH - blockH) / 2;
  // positions (top-left corners)
  const frontX = originX;
  const frontY = originY + th + GAP;
  const topX = originX + (fw - tw) / 2;
  const topY = originY;
  const rightX = originX + Math.max(fw, tw) + GAP;
  const rightY = frontY + (fh - rh) / 2;

  const place = (v: ViewGeom, x: number, y: number) => {
    const t = `translate(${num(x - v.minx * scale)} ${num(y - v.miny * scale)}) scale(${num(scale)})`;
    const hid = v.hidden.map((d) => `<path d="${d}"/>`).join('');
    const vis = v.paths.map((d) => `<path d="${d}"/>`).join('');
    return `<g data-view="${v.name}" transform="${t}" fill="none" vector-effect="non-scaling-stroke">${
      hid
        ? `<g stroke="#777" stroke-width="0.18" stroke-dasharray="1.2 0.8" vector-effect="non-scaling-stroke">${hid.replaceAll('<path', '<path vector-effect="non-scaling-stroke"')}</g>`
        : ''
    }<g stroke="#111" stroke-width="0.5">${vis.replaceAll('<path', '<path vector-effect="non-scaling-stroke"')}</g></g>`;
  };

  // overall dimensions (extension lines from the view outlines)
  const off = 8;
  const dims: string[] = [];
  const fx0 = frontX;
  const fx1 = frontX + fw;
  const fy1 = frontY + fh;
  dims.push(
    dimension('width', fx0, fy1 + off, fx1, fy1 + off, dimText(overall[0]), [
      [fx0, fy1 + 1, fx0, fy1 + off + 1.5],
      [fx1, fy1 + 1, fx1, fy1 + off + 1.5],
    ]),
  );
  dims.push(
    dimension('height', fx1 + off, frontY, fx1 + off, fy1, dimText(overall[2]), [
      [fx1 + 1, frontY, fx1 + off + 1.5, frontY],
      [fx1 + 1, fy1, fx1 + off + 1.5, fy1],
    ]),
  );
  // depth on the top view (its vertical extent is the model Y size)
  const tx1 = topX + tw;
  dims.push(
    dimension('depth', tx1 + off, topY, tx1 + off, topY + th, dimText(overall[1]), [
      [tx1 + 1, topY, tx1 + off + 1.5, topY],
      [tx1 + 1, topY + th, tx1 + off + 1.5, topY + th],
    ]),
  );

  // title block
  const mats = new Set(ids.map((id) => model.report.bodies[id]?.material).filter(Boolean));
  const mass = ids.reduce((s, id) => s + (model.report.bodies[id]?.massG ?? 0), 0);
  const massKnown = ids.every((id) => model.report.bodies[id]?.massG !== undefined);
  const tbx = SHEET_W - MARGIN - 130;
  const tby = SHEET_H - MARGIN - TITLE_H;
  const cell = (x: number, y: number, label: string, value: string, w: number) =>
    `<g><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${TITLE_H / 2}" fill="none" stroke="#111" stroke-width="0.25"/><text x="${num(x + 1)}" y="${num(y + 3)}" font-size="2" fill="#555">${esc(label)}</text><text x="${num(x + 1)}" y="${num(y + 9)}" font-size="3.4">${esc(value)}</text></g>`;
  const title = opts.title ?? 'Untitled';
  const block = [
    cell(tbx, tby, 'TITLE', title, 130 * 0.6),
    cell(tbx + 130 * 0.6, tby, 'NUMBER', opts.number ?? '-', 130 * 0.4),
    cell(
      tbx,
      tby + TITLE_H / 2,
      'MATERIAL',
      mats.size ? [...mats].join(', ') : 'not specified',
      130 * 0.3,
    ),
    cell(
      tbx + 130 * 0.3,
      tby + TITLE_H / 2,
      'MASS',
      massKnown ? `${dimText(mass)} g` : 'n/a',
      130 * 0.2,
    ),
    cell(tbx + 130 * 0.5, tby + TITLE_H / 2, 'SCALE', scaleLabel(scale), 130 * 0.2),
    cell(tbx + 130 * 0.7, tby + TITLE_H / 2, 'UNITS / PROJ.', 'mm / third angle', 130 * 0.3),
  ].join('');
  const note = `<text x="${MARGIN}" y="${SHEET_H - MARGIN - 1}" font-size="2.4" fill="#555">Generated by Contrapt. Overall dimensions only; tolerances not specified. Verify against the model before manufacture.</text>`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" width="${SHEET_W}mm" height="${SHEET_H}mm" font-family="Arial, Helvetica, sans-serif" font-size="3" role="img">`,
    `<title>${esc(opts.title ?? 'Untitled')}: third-angle drawing, scale ${scaleLabel(scale)}</title>`,
    `<desc>Front, top and right views with overall dimensions (mm), generated by Contrapt. Overall width ${dimText(overall[0])}, depth ${dimText(overall[1])}, height ${dimText(overall[2])}.</desc>`,
    `<rect x="0" y="0" width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>`,
    `<rect x="${MARGIN}" y="${MARGIN}" width="${SHEET_W - 2 * MARGIN}" height="${SHEET_H - 2 * MARGIN}" fill="none" stroke="#111" stroke-width="0.5"/>`,
    place(top, topX, topY),
    place(front, frontX, frontY),
    place(right, rightX, rightY),
    ...dims,
    block,
    note,
    '</svg>',
  ].join('\n');

  const layout = {
    front: { x: frontX, y: frontY, w: fw + off + 2, h: fh + off + 2 },
    top: { x: topX, y: topY, w: tw + off + 2, h: th },
    right: { x: rightX, y: rightY, w: rw, h: rh },
    titleBlock: { x: tbx, y: tby, w: 130, h: TITLE_H },
  };
  return {
    svg,
    scale: scaleLabel(scale),
    overall,
    views: ['front', 'top', 'right'],
    warnings,
    layout,
  };
}
