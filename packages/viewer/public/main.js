// Contrapt live viewer. Renders on demand (no idle animation loop) so it stays light.
// All model-supplied strings (ids, errors, names) are inserted with textContent, never innerHTML.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const BODY_COLORS = ['#8ea3b8', '#cf8d5e', '#7fae95', '#b79fcc', '#d6b85f', '#6fa6c9'];
const view = { edges: true, dims: true, wire: false };

// ---------- three.js scene ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
camera.up.set(0, 0, 1); // CAD convention: Z is up
camera.position.set(110, -150, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = !reduceMotion;
controls.dampingFactor = 0.12;
controls.addEventListener('change', invalidate);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a6, 1.15));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(80, -120, 160);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-120, 90, 40);
scene.add(fill);

const modelGroup = new THREE.Group();
const dimGroup = new THREE.Group();
const gridGroup = new THREE.Group();
scene.add(gridGroup, modelGroup, dimGroup);

let queued = false;
function invalidate() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(frame);
}
function frame() {
  queued = false;
  const moving = controls.update();
  renderer.render(scene, camera);
  positionDimLabels();
  if (moving) invalidate();
}

function resize() {
  const stage = $('stage');
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  invalidate();
}
new ResizeObserver(resize).observe($('stage'));

function disposeGroup(g) {
  for (const o of [...g.children]) {
    g.remove(o);
    o.traverse?.((c) => {
      c.geometry?.dispose();
      const m = c.material;
      if (Array.isArray(m)) for (const x of m) x.dispose();
      else m?.dispose();
    });
  }
}

// ---------- building the scene from a snapshot ----------
let snap = null;
let fittedDiag = 0;
let dimLabels = []; // { el, p: Vector3 }

function unionBox(bodies) {
  const b = new THREE.Box3();
  for (const info of Object.values(bodies)) {
    b.expandByPoint(new THREE.Vector3(...info.bbox.min));
    b.expandByPoint(new THREE.Vector3(...info.bbox.max));
  }
  return b;
}

function buildScene() {
  disposeGroup(modelGroup);
  disposeGroup(dimGroup);
  disposeGroup(gridGroup);
  for (const l of dimLabels) l.el.remove();
  dimLabels = [];
  if (!snap) return;

  const ink = new THREE.Color(css('--ink'));
  snap.meshes.forEach((m, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.vertices, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
    g.setIndex(m.triangles);
    const mat = new THREE.MeshStandardMaterial({
      color: BODY_COLORS[i % BODY_COLORS.length],
      roughness: 0.55,
      metalness: 0.12,
      wireframe: view.wire,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = m.id;
    modelGroup.add(mesh);
    if (view.edges && !view.wire) {
      const e = new THREE.LineSegments(
        new THREE.EdgesGeometry(g, 28),
        new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.55 }),
      );
      modelGroup.add(e);
    }
  });

  const box = unionBox(snap.report.bodies);
  const has = !box.isEmpty();
  $('empty').hidden = has;
  if (!has) return;

  const diag = box.getSize(new THREE.Vector3()).length() || 1;
  buildGrid(box, diag);
  if (view.dims) buildDims(box, diag);

  // Keep the user's camera unless this is the first model or its size changed a lot.
  if (!fittedDiag || diag / fittedDiag > 2 || diag / fittedDiag < 0.5) fit();
}

function buildGrid(box, diag) {
  const step = 10 ** Math.floor(Math.log10(Math.max(diag, 1) / 3));
  const grid = new THREE.GridHelper(
    step * 40,
    40,
    new THREE.Color(css('--grid')),
    new THREE.Color(css('--grid')),
  );
  grid.rotation.x = Math.PI / 2; // lie in the XY plane
  grid.position.z = box.min.z - diag * 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  gridGroup.add(grid);
}

const fmt = (n) => String(Number(n.toFixed(2)));

function buildDims(box, diag) {
  const o = diag * 0.07;
  const { min, max } = box;
  const accent = new THREE.Color(css('--accent'));
  const mat = new THREE.LineBasicMaterial({ color: accent });
  const line = (a, b) => {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    dimGroup.add(new THREE.Line(g, mat));
  };
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const label = (p, text) => {
    const el = document.createElement('div');
    el.className = 'dim';
    el.textContent = text;
    $('dims').appendChild(el);
    dimLabels.push({ el, p });
  };
  // X size, in front of the part
  line(v(min.x, min.y, min.z), v(min.x, min.y - o, min.z));
  line(v(max.x, min.y, min.z), v(max.x, min.y - o, min.z));
  line(v(min.x, min.y - o, min.z), v(max.x, min.y - o, min.z));
  label(v((min.x + max.x) / 2, min.y - o, min.z), fmt(max.x - min.x));
  // Y size, on the right
  line(v(max.x, min.y, min.z), v(max.x + o, min.y, min.z));
  line(v(max.x, max.y, min.z), v(max.x + o, max.y, min.z));
  line(v(max.x + o, min.y, min.z), v(max.x + o, max.y, min.z));
  label(v(max.x + o, (min.y + max.y) / 2, min.z), fmt(max.y - min.y));
  // Z size, at the front-left corner
  line(v(min.x, min.y, min.z), v(min.x - o, min.y - o, min.z));
  line(v(min.x, min.y, max.z), v(min.x - o, min.y - o, max.z));
  line(v(min.x - o, min.y - o, min.z), v(min.x - o, min.y - o, max.z));
  label(v(min.x - o, min.y - o, (min.z + max.z) / 2), fmt(max.z - min.z));
}

const tmp = new THREE.Vector3();
function positionDimLabels() {
  const stage = $('stage');
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  for (const { el, p } of dimLabels) {
    tmp.copy(p).project(camera);
    const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
    el.style.display = visible ? '' : 'none';
    if (visible) {
      el.style.left = `${((tmp.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - tmp.y) / 2) * h}px`;
    }
  }
}

function fit() {
  if (!snap) return;
  const box = unionBox(snap.report.bodies);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 0.5);
  const dist = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * 1.25;
  const dir = new THREE.Vector3(0.75, -1, 0.65).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = Math.max(dist / 1000, 0.01);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.update();
  fittedDiag = box.getSize(new THREE.Vector3()).length();
  invalidate();
}

// ---------- the build report rail ----------
const SVGNS = 'http://www.w3.org/2000/svg';
function glyph(status) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  const add = (tag, attrs) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val);
    s.appendChild(e);
  };
  const color = {
    ok: 'var(--ok)',
    error: 'var(--err)',
    skipped: 'var(--skip)',
    suppressed: 'var(--skip)',
  }[status];
  if (status === 'ok') {
    add('circle', { cx: 8, cy: 8, r: 7, fill: color });
    add('path', {
      d: 'M4.7 8.3l2.2 2.2 4.4-4.6',
      fill: 'none',
      stroke: 'var(--panel)',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
  } else if (status === 'error') {
    add('path', {
      d: 'M8 1.2L15 14H1z',
      fill: color,
      stroke: color,
      'stroke-width': 1.4,
      'stroke-linejoin': 'round',
    });
    add('path', {
      d: 'M8 5.8v3.6M8 11.4v.01',
      stroke: 'var(--panel)',
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
    });
  } else if (status === 'skipped') {
    add('circle', {
      cx: 8,
      cy: 8,
      r: 6.2,
      fill: 'none',
      stroke: color,
      'stroke-width': 1.5,
      'stroke-dasharray': '2.2 2.2',
    });
  } else {
    add('circle', { cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: color, 'stroke-width': 1.5 });
    add('path', {
      d: 'M4.2 11.8L11.8 4.2',
      stroke: color,
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
    });
  }
  return s;
}

const num = (n) => Number(n.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });

function renderRail() {
  $('model-name').textContent = snap?.name || 'Untitled';
  const steps = $('steps');
  steps.replaceChildren();
  for (const s of snap?.report.steps ?? []) {
    const li = document.createElement('li');
    li.className = `step ${s.status}`;
    const g = document.createElement('span');
    g.className = 'glyph';
    g.appendChild(glyph(s.status));
    g.setAttribute('role', 'img');
    g.setAttribute('aria-label', s.status);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.id;
    const op = document.createElement('span');
    op.className = 'op';
    op.textContent = s.op;
    name.appendChild(op);
    li.append(g, name);
    if (s.error) {
      const p = document.createElement('p');
      p.className = 'msg';
      p.textContent = s.error;
      li.appendChild(p);
    }
    steps.appendChild(li);
  }
  if (!steps.children.length) {
    const li = document.createElement('li');
    li.className = 'step skipped';
    li.textContent = 'No steps yet.';
    li.style.paddingLeft = '0';
    steps.appendChild(li);
  }

  const params = snap?.report.params ?? {};
  const pNames = Object.keys(params);
  $('params-section').hidden = pNames.length === 0;
  const dl = $('params');
  dl.replaceChildren();
  for (const k of pNames) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = num(params[k]);
    dl.append(dt, dd);
  }

  const bodies = snap?.report.bodies ?? {};
  const bNames = Object.keys(bodies);
  $('bodies-section').hidden = bNames.length === 0;
  const wrap = $('bodies');
  wrap.replaceChildren();
  bNames.forEach((id, i) => {
    const b = bodies[id];
    const div = document.createElement('div');
    div.className = 'body';
    const head = document.createElement('div');
    head.className = 'bn';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = BODY_COLORS[i % BODY_COLORS.length];
    const nm = document.createElement('span');
    nm.textContent = id;
    head.append(sw, nm);
    const t = document.createElement('table');
    const rows = [
      ['Volume', `${num(b.volume)} mm³`],
      ['Surface', `${num(b.area)} mm²`],
      ['Size', `${b.bbox.size.map(num).join(' × ')} mm`],
      ['Centre of mass', `(${b.centerOfMass.map(num).join(', ')})`],
    ];
    for (const [k, val] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = k;
      const td = document.createElement('td');
      td.textContent = val;
      tr.append(th, td);
      t.appendChild(tr);
    }
    div.append(head, t);
    wrap.appendChild(div);
  });
}

// ---------- data: initial load + live updates ----------
let latest = -1;
async function load() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    const s = await res.json();
    if (s.version < latest) return;
    latest = s.version;
    snap = s;
    renderRail();
    buildScene();
    invalidate();
  } catch {
    /* the live indicator reports connection trouble */
  }
}

function connect() {
  const live = $('live');
  const es = new EventSource('/events');
  es.onopen = () => {
    live.textContent = 'Live';
    live.className = 'live on';
    load();
  };
  es.onmessage = () => load();
  es.onerror = () => {
    live.textContent = 'Reconnecting…';
    live.className = 'live off';
  };
}

// ---------- toolbar ----------
function toggle(id, key, after) {
  const b = $(id);
  b.addEventListener('click', () => {
    view[key] = !view[key];
    b.setAttribute('aria-pressed', String(view[key]));
    after?.();
    buildScene();
    invalidate();
  });
}
toggle('t-edges', 'edges');
toggle('t-dims', 'dims');
toggle('t-wire', 'wire');
$('t-fit').addEventListener('click', fit);
$('t-rail').addEventListener('click', () => {
  const hidden = document.body.classList.toggle('rail-hidden');
  $('t-rail').setAttribute('aria-pressed', String(!hidden));
  setTimeout(resize, 200);
});
canvas.addEventListener('dblclick', fit);
addEventListener('keydown', (e) => {
  if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) fit();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  buildScene();
  invalidate();
});

// Small screens start with the report hidden; follow the breakpoint as the window changes.
const narrow = matchMedia('(max-width: 760px)');
function applyRail(hide) {
  document.body.classList.toggle('rail-hidden', hide);
  $('t-rail').setAttribute('aria-pressed', String(!hide));
  setTimeout(resize, 200);
}
narrow.addEventListener('change', (e) => applyRail(e.matches));
if (narrow.matches) applyRail(true);
resize();
connect();
load();
