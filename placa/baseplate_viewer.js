// src/baseplateViewer.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// src/membrane.ts
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var norm = (a) => Math.sqrt(dot(a, a));
var scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
function precomputeTri(X, Y, Z, i, j, k) {
  const E1 = sub(Y, X), E2 = sub(Z, X);
  const u1 = norm(E1);
  const e1 = scale(E1, 1 / u1);
  const n = cross(E1, E2);
  let e2 = cross(n, E1);
  e2 = scale(e2, 1 / norm(e2));
  const p1x = u1, p2x = dot(E2, e1), p2y = dot(E2, e2);
  const det = p1x * p2y;
  const A = 0.5 * Math.abs(det);
  const DmInv = [p2y / det, -p2x / det, 0, p1x / det];
  return { i, j, k, DmInv, A };
}
function pk2(E11, E22, E12, m) {
  const coef = m.E / (1 - m.nu * m.nu);
  const S11 = coef * (E11 + m.nu * E22);
  const S22 = coef * (E22 + m.nu * E11);
  const S12 = coef * (1 - m.nu) * E12;
  return [S11, S22, S12];
}
function triEnergyForce(tr, x, force, m) {
  const x0 = x[tr.i], x1 = x[tr.j], x2 = x[tr.k];
  const ds1 = sub(x1, x0), ds2 = sub(x2, x0);
  const [a, b, c, d] = tr.DmInv;
  const F0 = [ds1[0] * a + ds2[0] * c, ds1[1] * a + ds2[1] * c, ds1[2] * a + ds2[2] * c];
  const F1 = [ds1[0] * b + ds2[0] * d, ds1[1] * b + ds2[1] * d, ds1[2] * b + ds2[2] * d];
  const C11 = dot(F0, F0), C22 = dot(F1, F1), C12 = dot(F0, F1);
  const E11 = 0.5 * (C11 - 1), E22 = 0.5 * (C22 - 1), E12 = 0.5 * C12;
  const [S11, S22, S12] = pk2(E11, E22, E12, m);
  const W = 0.5 * (S11 * E11 + S22 * E22 + 2 * S12 * E12) * tr.A * m.t;
  const vm = Math.sqrt(S11 * S11 - S11 * S22 + S22 * S22 + 3 * S12 * S12);
  const P0 = [F0[0] * S11 + F1[0] * S12, F0[1] * S11 + F1[1] * S12, F0[2] * S11 + F1[2] * S12];
  const P1 = [F0[0] * S12 + F1[0] * S22, F0[1] * S12 + F1[1] * S22, F0[2] * S12 + F1[2] * S22];
  const At = tr.A * m.t;
  const g1 = [At * (P0[0] * a + P1[0] * b), At * (P0[1] * a + P1[1] * b), At * (P0[2] * a + P1[2] * b)];
  const g2 = [At * (P1[0] * d), At * (P1[1] * d), At * (P1[2] * d)];
  const f0 = force[tr.i], f1 = force[tr.j], f2 = force[tr.k];
  f0[0] += g1[0] + g2[0];
  f0[1] += g1[1] + g2[1];
  f0[2] += g1[2] + g2[2];
  f1[0] -= g1[0];
  f1[1] -= g1[1];
  f1[2] -= g1[2];
  f2[0] -= g2[0];
  f2[1] -= g2[1];
  f2[2] -= g2[2];
  return { W, vm };
}

// src/boxColumnModel.ts
function perimXY(p, nW, c) {
  const h = c / 2, side = Math.floor(p / nW), u = p % nW / nW;
  if (side === 0) return [-h + c * u, -h];
  if (side === 1) return [h, -h + c * u];
  if (side === 2) return [h - c * u, h];
  return [-h, h - c * u];
}
function makeBoxColumn(c, H, nW, nZ) {
  const nPer = 4 * nW;
  const X0 = [];
  const idx = (p, k) => k * nPer + (p % nPer + nPer) % nPer;
  for (let k = 0; k <= nZ; k++) for (let p = 0; p < nPer; p++) {
    const [x, y] = perimXY(p, nW, c);
    X0.push([x, y, H * k / nZ]);
  }
  const faces = [];
  for (let k = 0; k < nZ; k++) for (let p = 0; p < nPer; p++) {
    const a = idx(p, k), b = idx(p + 1, k), cc = idx(p, k + 1), d = idx(p + 1, k + 1);
    faces.push([a, b, d]);
    faces.push([a, d, cc]);
  }
  const base = [], top = [];
  for (let p = 0; p < nPer; p++) {
    base.push(idx(p, 0));
    top.push(idx(p, nZ));
  }
  return { X0, faces, base, top, H, c };
}
function solveColumnBuckle(m, mat, p) {
  const { X0, faces, base, top, H, c } = m;
  const nV = X0.length;
  const rest = faces.map(([i, j, k]) => precomputeTri(X0[i], X0[j], X0[k], i, j, k));
  const free = Array.from({ length: nV }, () => [true, true, true]);
  const isB = new Set(base), isT = new Set(top);
  for (const i of base) free[i] = [false, false, false];
  for (const i of top) free[i] = [true, true, false];
  const x = X0.map((v) => [...v]);
  for (let i = 0; i < nV; i++) {
    if (isB.has(i) || isT.has(i)) continue;
    const [px, py, pz] = X0[i];
    const nx = Math.abs(px) > Math.abs(py) ? Math.sign(px) : 0, ny = Math.abs(py) >= Math.abs(px) ? Math.sign(py) : 0;
    const wave = Math.sin(Math.PI * pz / H) * Math.cos(6 * Math.atan2(py, px));
    x[i][0] = px + p.seedAmp * c * wave * nx;
    x[i][1] = py + p.seedAmp * c * wave * ny;
  }
  const scratch = Array.from({ length: nV }, () => [0, 0, 0]);
  const ef = (xx) => {
    for (let i = 0; i < nV; i++) {
      scratch[i][0] = 0;
      scratch[i][1] = 0;
      scratch[i][2] = 0;
    }
    let W = 0;
    for (const tr of rest) W += triEnergyForce(tr, xx, scratch, mat).W;
    for (let i = 0; i < nV; i++) for (let d = 0; d < 3; d++) if (!free[i][d]) scratch[i][d] = 0;
    return W;
  };
  const gn2 = (g) => {
    let s = 0;
    for (let i = 0; i < nV; i++) for (let d = 0; d < 3; d++) if (free[i][d]) s += g[i][d] ** 2;
    return s;
  };
  const minimize = (maxIter) => {
    let W = ef(x);
    let g = scratch.map((f) => [-f[0], -f[1], -f[2]]);
    let dir = g.map((v) => [-v[0], -v[1], -v[2]]);
    let gg = gn2(g);
    for (let it = 0; it < maxIter; it++) {
      if (Math.sqrt(gg) < 1e-3) break;
      let gd = 0;
      for (let i = 0; i < nV; i++) for (let d = 0; d < 3; d++) if (free[i][d]) gd += g[i][d] * dir[i][d];
      if (gd > 0) {
        dir = g.map((v) => [-v[0], -v[1], -v[2]]);
        gd = -gg;
      }
      let alpha = it === 0 ? 1e-8 : 1e-6, ok = false;
      const xT = x.map((v) => [...v]);
      for (let bt = 0; bt < 40; bt++) {
        for (let i = 0; i < nV; i++) for (let d = 0; d < 3; d++) if (free[i][d]) xT[i][d] = x[i][d] + alpha * dir[i][d];
        if (ef(xT) <= W + 1e-4 * alpha * gd) {
          ok = true;
          break;
        }
        alpha *= 0.5;
      }
      if (!ok) break;
      for (let i = 0; i < nV; i++) for (let d = 0; d < 3; d++) if (free[i][d]) x[i][d] = xT[i][d];
      W = ef(x);
      const gN = scratch.map((f) => [-f[0], -f[1], -f[2]]);
      const ggN = gn2(gN);
      let num = 0;
      for (let i = 0; i < nV; i++) for (let d = 0; d < 3; d++) if (free[i][d]) num += gN[i][d] * (gN[i][d] - g[i][d]);
      const beta = Math.max(0, num / Math.max(gg, 1e-30));
      for (let i = 0; i < nV; i++) for (let d = 0; d < 3; d++) dir[i][d] = -gN[i][d] + beta * dir[i][d];
      g = gN;
      gg = ggN;
    }
  };
  for (let s = 1; s <= p.nSteps; s++) {
    const dz = p.axialShort * s / p.nSteps, th = p.rot * s / p.nSteps;
    for (const i of top) x[i][2] = H - dz + th * X0[i][0];
    minimize(p.maxIter);
  }
  const vm = [];
  for (const tr of rest) vm.push(triEnergyForce(tr, x, scratch, mat).vm);
  let maxBulge = 0;
  for (let i = 0; i < nV; i++) {
    const r0 = Math.hypot(X0[i][0], X0[i][1]), r1 = Math.hypot(x[i][0], x[i][1]);
    maxBulge = Math.max(maxBulge, Math.abs(r1 - r0));
  }
  return { X0, x, faces, vm, maxBulge, vmMax: Math.max(...vm) };
}

// src/baseplateViewer.ts
var Module = null;
var bpUrl = "./bpsolver.mjs";
async function ensureSolver() {
  if (!Module) {
    const f = (await import(bpUrl)).default;
    Module = await f();
  }
  return Module;
}
function solveWasm(M, p) {
  const nnx = p.nx + 1, nny = p.ny + 1, nN = nnx * nny, maxB = 24;
  const pW = M._malloc(nN * 8), pB = M._malloc(nN * 8), pCr = M._malloc(nN * 4);
  const pBx = M._malloc(maxB * 8), pBy = M._malloc(maxB * 8), pBf = M._malloc(maxB * 8), pNb = M._malloc(4), pS = M._malloc(8 * 8);
  M._solveBasePlate(p.Bx, p.By, p.c, p.tp, p.E, p.nu, p.fc, p.Ec, p.nx, p.ny, p.N, p.M, p.Nx, p.Ny, p.boltDia, p.boltEmbed, p.boltMargin, p.damage ? 1 : 0, pW, pB, pCr, pBx, pBy, pBf, pNb, pS);
  const HF = M.HEAPF64, HI = M.HEAP32;
  const w = [], bearing = [], crushed = [];
  for (let i = 0; i < nN; i++) {
    w.push(HF[pW / 8 + i]);
    bearing.push(HF[pB / 8 + i]);
    crushed.push(!!HI[pCr / 4 + i]);
  }
  const nb = HI[pNb / 4];
  const boltPos = [], boltForce = [];
  for (let k = 0; k < nb; k++) {
    boltPos.push([HF[pBx / 8 + k], HF[pBy / 8 + k]]);
    boltForce.push(HF[pBf / 8 + k]);
  }
  const so = pS / 8;
  const r = {
    nodes: [],
    nx: p.nx,
    ny: p.ny,
    w,
    bearing,
    crushed,
    boltPos,
    boltForce,
    bearingMax: HF[so],
    boltTmax: HF[so + 1],
    upliftMax: HF[so + 2],
    nCrushed: HF[so + 3],
    eqN: HF[so + 4],
    eqM: HF[so + 5],
    iters: HF[so + 6],
    fp: HF[so + 7]
  };
  [pW, pB, pCr, pBx, pBy, pBf, pNb, pS].forEach((q) => M._free(q));
  const lex = p.Bx / p.nx, ley = p.By / p.ny;
  for (let j = 0; j < nny; j++) for (let i = 0; i < nnx; i++) r.nodes.push([i * lex - p.Bx / 2, j * ley - p.By / 2]);
  return r;
}
var $ = (id) => document.getElementById(id);
var canvas = $("scene");
var renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
var scene = new THREE.Scene();
scene.background = new THREE.Color(1712164);
var pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
var camera = new THREE.PerspectiveCamera(45, 1, 1, 12e3);
camera.position.set(700, 560, 820);
var controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 40, 0);
scene.add(new THREE.HemisphereLight(15200495, 1054743, 0.85));
var kl = new THREE.DirectionalLight(16777215, 2.6);
kl.position.set(500, 900, 400);
scene.add(kl);
var matContour = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uBands: { value: 10 } },
  vertexShader: `attribute float aValue; varying float vV; varying vec3 vN;
    void main(){ vV=aValue; vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `precision highp float; varying float vV; varying vec3 vN; uniform float uBands;
    // Colormap de HEKATAN STRUCT (paleta "safe"/IDEA): magenta(m\xE1x)\u2192rojo\u2192naranja\u2192amarillo
    // \u2192verde\u2192cian\u2192azul(m\xEDn). Brillante y v\xEDvida (no oscura).
    vec3 safeC(float t){ t=clamp(t,0.0,1.0);
      vec3 c0=vec3(224.,13.,107.)/255.,c1=vec3(221.,20.,50.)/255.,c2=vec3(252.,99.,39.)/255.,c3=vec3(254.,161.,47.)/255.,c4=vec3(238.,234.,25.)/255.,c5=vec3(5.,193.,69.)/255.,c6=vec3(7.,178.,244.)/255.,c7=vec3(4.,132.,213.)/255.,c8=vec3(90.,175.,230.)/255.;
      if(t<0.13)return mix(c0,c1,t/0.13); if(t<0.27)return mix(c1,c2,(t-0.13)/0.14); if(t<0.40)return mix(c2,c3,(t-0.27)/0.13); if(t<0.52)return mix(c3,c4,(t-0.40)/0.12); if(t<0.64)return mix(c4,c5,(t-0.52)/0.12); if(t<0.78)return mix(c5,c6,(t-0.64)/0.14); if(t<0.90)return mix(c6,c7,(t-0.78)/0.12); return mix(c7,c8,(t-0.90)/0.10); }
    void main(){ float t=clamp(vV,0.0,1.0);
      vec3 col=safeC(1.0-t);                 // SUAVE continuo (sin bandas/isol\xEDneas), como Hekatan Struct
      float sh=0.95+0.05*clamp(dot(vN,normalize(vec3(0.3,0.6,0.7))),0.0,1.0);  // casi plano brillante (ambient 0.95)
      gl_FragColor=vec4(col*sh,1.0);} `
});
var matConc = new THREE.MeshStandardMaterial({ color: 7304311, metalness: 0, roughness: 0.95, transparent: true, opacity: 0.18 });
var matSteel = new THREE.MeshStandardMaterial({ color: 9412784, metalness: 0.85, roughness: 0.4, transparent: true, opacity: 0.5 });
var matBoltN = new THREE.MeshStandardMaterial({ color: 4871520, metalness: 0.7, roughness: 0.4 });
var gPlate = new THREE.Group();
var gBolt = new THREE.Group();
var gStatic = new THREE.Group();
var gCol = new THREE.Group();
var gRebar = new THREE.Group();
var gDmg = new THREE.Group();
scene.add(gPlate, gBolt, gStatic, gCol, gRebar, gDmg);
var matRebar = new THREE.MeshStandardMaterial({ color: 3817285, metalness: 0.6, roughness: 0.6 });
function buildRebar(p) {
  gRebar.clear();
  const cov = 50, hx = p.Px / 2 - cov, hy = p.Py / 2 - cov, top = p.tp, bot = -p.Pd + cov, H = top - bot;
  const nside = 3, dia = 16;
  const xs = Array.from({ length: nside }, (_, i) => -hx + 2 * hx * i / (nside - 1));
  const ys = Array.from({ length: nside }, (_, i) => -hy + 2 * hy * i / (nside - 1));
  const verts = [];
  for (const x of xs) {
    verts.push([x, -hy]);
    verts.push([x, hy]);
  }
  for (const y of ys) {
    verts.push([-hx, y]);
    verts.push([hx, y]);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const [x, y] of verts) {
    const k = `${x.toFixed(0)},${y.toFixed(0)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(dia / 2, dia / 2, H, 8), matRebar);
    bar.position.set(x, bot + H / 2, y);
    gRebar.add(bar);
  }
  const nstir = Math.max(2, Math.round(H / 180));
  for (let s = 0; s <= nstir; s++) {
    const z = bot + H * s / nstir;
    const pts = [[-hx, z, -hy], [hx, z, -hy], [hx, z, hy], [-hx, z, hy], [-hx, z, -hy]].map(([a, b, c]) => new THREE.Vector3(a, b, c));
    gRebar.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 2764597 })));
  }
}
function buildDamage(p, r) {
  gDmg.clear();
  const hef = p.boltEmbed, Tmax = Math.max(r.boltTmax, 1e-6);
  r.boltPos.forEach(([x, y], k) => {
    const T = r.boltForce[k];
    if (T <= 1) return;
    const rad = 0.85 * hef;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(rad, hef, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 14826286, transparent: true, opacity: 0.14 + 0.26 * (T / Tmax), side: THREE.DoubleSide, depthWrite: false })
    );
    cone.rotation.x = Math.PI;
    cone.position.set(x, p.tp - hef / 2, y);
    gDmg.add(cone);
    const ring = [];
    for (let a = 0; a <= 32; a++) {
      const t = a / 32 * Math.PI * 2;
      ring.push(new THREE.Vector3(x + rad * Math.cos(t), p.tp, y + rad * Math.sin(t)));
    }
    gDmg.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: 16743002, transparent: true, opacity: 0.5 })));
  });
}
function buildColumn(p) {
  gCol.clear();
  const colH = 600, z0 = p.tp;
  const m = makeBoxColumn(p.c, colH, 12, 14);
  const axialShort = 3 * (p.N / 15e5), rot = 0.012 * (p.M / 2e8);
  const rc = solveColumnBuckle(m, { E: 2e5, nu: 0.3, t: 6 }, { axialShort, rot, seedAmp: 0.012, nSteps: 6, maxIter: 110 });
  const nVc = rc.X0.length;
  const disp = rc.x.map((xx, i) => Math.hypot(xx[0] - rc.X0[i][0], xx[1] - rc.X0[i][1], xx[2] - rc.X0[i][2]));
  const dmax = Math.max(...disp, 1e-6);
  const pos = new Float32Array(nVc * 3), val = new Float32Array(nVc);
  for (let i = 0; i < nVc; i++) {
    const xx = rc.x[i];
    pos[i * 3] = xx[0];
    pos[i * 3 + 1] = z0 + xx[2];
    pos[i * 3 + 2] = xx[1];
    val[i] = disp[i] / dmax;
  }
  const idx = [];
  for (const f of rc.faces) idx.push(f[0], f[1], f[2]);
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aValue", new THREE.BufferAttribute(val, 1));
  g.computeVertexNormals();
  gCol.add(new THREE.Mesh(g, matContour));
  window.__colBulge = rc.maxBulge;
}
var result = null;
var amp = 60;
var curP = null;
function buildStatic(p) {
  gStatic.clear();
  const ped = new THREE.Mesh(new THREE.BoxGeometry(p.Px, p.Pd, p.Py), matConc);
  ped.position.set(0, -p.Pd / 2, 0);
  gStatic.add(ped);
  gStatic.add(new THREE.LineSegments(new THREE.EdgesGeometry(ped.geometry), new THREE.LineBasicMaterial({ color: 3817540 })).translateY(-p.Pd / 2));
  const z0 = p.tp;
  const weld = new THREE.Mesh(new THREE.BoxGeometry(p.c + 24, 14, p.c + 24), new THREE.MeshStandardMaterial({ color: 11561007, metalness: 0.6, roughness: 0.5 }));
  weld.position.set(0, p.tp + 7, 0);
  gStatic.add(weld);
  gStatic.add(new THREE.LineSegments(new THREE.EdgesGeometry(weld.geometry), new THREE.LineBasicMaterial({ color: 8013088 })).translateY(p.tp + 7));
}
var currentField = "pres";
function computeField(r, p, kind) {
  const nnx = r.nx + 1, nny = r.ny + 1, N = nnx * nny;
  const out = new Float32Array(N);
  const finalize = (label, unit) => {
    let lo = 1e30, hi = -1e30;
    for (let k = 0; k < N; k++) {
      if (out[k] < lo) lo = out[k];
      if (out[k] > hi) hi = out[k];
    }
    if (hi - lo < 1e-9) hi = lo + 1e-9;
    return { raw: out, lo, hi, label, unit };
  };
  if (kind === "pres") {
    for (let k = 0; k < N; k++) out[k] = r.bearing[k];
    return finalize("Presi\xF3n de contacto", "MPa");
  }
  if (kind === "w") {
    for (let k = 0; k < N; k++) out[k] = r.w[k];
    return finalize("Deformada w", "mm");
  }
  if (kind === "dano") {
    for (let k = 0; k < N; k++) out[k] = Math.max(0, r.bearing[k] - r.fp);
    return finalize("Da\xF1o (p > f_jd)", "MPa");
  }
  const D = p.E * p.tp ** 3 / (12 * (1 - p.nu * p.nu));
  const dx = p.Bx / r.nx, dy = p.By / r.ny, tp2 = p.tp * p.tp;
  const w = (i, j) => r.w[j * nnx + i];
  for (let j = 0; j < nny; j++) for (let i = 0; i < nnx; i++) {
    const ip = Math.min(i + 1, nnx - 1), im = Math.max(i - 1, 0), jp = Math.min(j + 1, nny - 1), jm = Math.max(j - 1, 0);
    const wxx = (w(ip, j) - 2 * w(i, j) + w(im, j)) / (dx * dx);
    const wyy = (w(i, jp) - 2 * w(i, j) + w(i, jm)) / (dy * dy);
    const wxy = (w(ip, jp) - w(ip, jm) - w(im, jp) + w(im, jm)) / (4 * dx * dy);
    const kx = -wxx, ky = -wyy, kxy = -2 * wxy;
    const Mx = D * (kx + p.nu * ky), My = D * (ky + p.nu * kx), Mxy = D * (1 - p.nu) / 2 * kxy;
    if (kind === "mx") out[j * nnx + i] = Math.abs(Mx);
    else {
      const sx = 6 * Mx / tp2, sy = 6 * My / tp2, t = 6 * Mxy / tp2;
      out[j * nnx + i] = Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * t * t);
    }
  }
  return kind === "mx" ? finalize("Momento |Mx|", "N\xB7mm/mm") : finalize("von Mises placa", "MPa");
}
function rebuildPlate(p) {
  gPlate.clear();
  gBolt.clear();
  if (!result) return;
  const r = result, nnx = r.nx + 1, nny = r.ny + 1;
  const F = computeField(r, p, currentField);
  const pos = new Float32Array(nnx * nny * 3), val = new Float32Array(nnx * nny);
  for (let k = 0; k < nnx * nny; k++) {
    const [x, y] = r.nodes[k];
    pos[k * 3] = x;
    pos[k * 3 + 1] = p.tp - r.w[k] * amp;
    pos[k * 3 + 2] = y;
    val[k] = (F.raw[k] - F.lo) / (F.hi - F.lo);
  }
  const idx = [];
  for (let j = 0; j < r.ny; j++) for (let i = 0; i < r.nx; i++) {
    const a = j * nnx + i, b = a + 1, c = a + nnx, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aValue", new THREE.BufferAttribute(val, 1));
  g.computeVertexNormals();
  gPlate.add(new THREE.Mesh(g, matContour));
  const Tmax = Math.max(r.boltTmax, 1e-6);
  r.boltPos.forEach(([x, y], k) => {
    const T = r.boltForce[k], tens = T > 1;
    const mat = new THREE.MeshStandardMaterial({ color: tens ? new THREE.Color().setHSL(0, 0.9, 0.35 + 0.3 * (T / Tmax)) : 6977154, metalness: 0.7, roughness: 0.4 });
    const yTop = p.tp;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(p.boltDia / 2, p.boltDia / 2, 320, 14), mat);
    shaft.position.set(x, yTop - 130, y);
    gBolt.add(shaft);
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(p.boltDia * 1.15, p.boltDia * 1.15, 5, 18), matBoltN);
    washer.position.set(x, yTop + 3, y);
    gBolt.add(washer);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(p.boltDia * 0.95, p.boltDia * 0.95, 16, 6), mat);
    nut.position.set(x, yTop + 14, y);
    gBolt.add(nut);
  });
  $("vmMax").textContent = F.hi.toFixed(F.hi < 10 ? 2 : 1) + " " + F.unit;
  $("vmMin").textContent = F.lo.toFixed(F.lo < 10 ? 2 : 1);
  const lt = $("legTitle");
  if (lt) lt.textContent = F.label + " \xB7 colormap Hekatan/IDEA";
}
function recolor() {
  if (result && curP) rebuildPlate(curP);
}
var solving = false;
var pendingPreview = null;
function schedule(preview = false) {
  if (solving) {
    pendingPreview = preview;
    return;
  }
  run(preview);
}
function readParams(preview) {
  const v = (id) => +$(id).value;
  const Bx = v("Bx"), By = v("By");
  const target = preview ? 62 : 30;
  const nx = Math.max(4, Math.round(Bx / target)), ny = Math.max(4, Math.round(By / target));
  return {
    Bx,
    By,
    c: 300,
    tp: v("tp"),
    E: 2e5,
    nu: 0.3,
    fc: 25,
    Ec: 23500,
    nx,
    ny,
    N: v("N") * 1e3,
    M: v("M") * 1e6,
    Nx: v("Nx"),
    Ny: v("Ny"),
    boltDia: 25,
    boltEmbed: 400,
    boltMargin: 50,
    Px: v("Px"),
    Py: v("Py"),
    Pd: v("Pd"),
    damage: $("dmg").checked
  };
}
async function run(preview = false) {
  solving = true;
  const p = readParams(preview);
  curP = p;
  if (!preview) $("status").textContent = "Calculando\u2026";
  await new Promise((r) => setTimeout(r, 0));
  try {
    const Mod = await ensureSolver();
    const t0 = performance.now();
    result = solveWasm(Mod, p);
    const dt = ((performance.now() - t0) / 1e3).toFixed(3);
    amp = 0.1 * Math.min(p.Bx, p.By) / Math.max(result.upliftMax, result.bearingMax / (p.Ec / (Math.min(p.Bx, p.By) / 2)) || 1e-3, 1e-3);
    buildStatic(p);
    rebuildPlate(p);
    buildRebar(p);
    buildDamage(p, result);
    if (!preview) buildColumn(p);
    const util = (result.bearingMax / result.fp * 100).toFixed(0);
    const boltsT = result.boltForce.filter((f) => f > 1).length;
    const Fvm = computeField(result, p, "vm");
    const vmMax = Fvm.hi;
    let sxw = 0, sxx = 0;
    for (let k = 0; k < result.nodes.length; k++) {
      const x = result.nodes[k][0];
      sxw += x * result.w[k];
      sxx += x * x;
    }
    const phi = sxx > 0 ? Math.abs(sxw / sxx) : 0;
    const Icol = (p.c ** 4 - (p.c - 12) ** 4) / 12, Lc = 3e3;
    const Sj = phi > 1e-12 ? p.M / phi : Infinity;
    const Srig = 30 * p.E * Icol / Lc, Spin = 0.5 * p.E * Icol / Lc;
    const clase = Sj >= Srig ? "R\xCDGIDA" : Sj <= Spin ? "ARTICULADA" : "SEMIRR\xCDGIDA";
    const fy = 235, NRd = 133e3;
    const sem = (u) => u > 1 ? "\u{1F534}" : u > 0.7 ? "\u{1F7E1}" : "\u{1F7E2}";
    const uP = vmMax / fy, uH = result.bearingMax / result.fp, uB = result.boltTmax / NRd;
    $("status").innerHTML = `${preview ? "\u26A1 " : "\u2705 "}${result.nodes.length} nodos \xB7 ${result.iters} it \xB7 <b>${dt}s</b><br>${sem(uP)} placa vM <b>${vmMax.toFixed(0)}</b>/${fy} MPa \xB7 ${sem(uH)} hormig\xF3n <b>${result.bearingMax.toFixed(1)}</b>/${result.fp.toFixed(0)} MPa<br>${sem(uB)} perno T <b>${(result.boltTmax / 1e3).toFixed(0)}</b>/${(NRd / 1e3).toFixed(0)} kN \xB7 uplift ${result.upliftMax.toFixed(2)} mm${p.damage ? ` \xB7 \u{1F4A5} ${result.nCrushed} aplast.` : ""}<br>\u21BB rigidez <b>${isFinite(Sj) ? (Sj / 1e9).toFixed(0) : "\u221E"}</b> MN\xB7m/rad \u2192 <b>${clase}</b> (\u03C6=${(phi * 1e3).toFixed(2)} mrad)`;
    if (!preview) setTimeout(() => {
      try {
        const w2 = 620, h2 = Math.round(620 * canvas.height / canvas.width);
        const cc = document.createElement("canvas");
        cc.width = w2;
        cc.height = h2;
        cc.getContext("2d").drawImage(canvas, 0, 0, w2, h2);
        fetch("/save", { method: "POST", body: canvas.toDataURL("image/png") }).catch(() => {
        });
      } catch {
      }
    }, 700);
  } catch (e) {
    $("status").innerHTML = "\u274C " + e;
  }
  solving = false;
  if (pendingPreview !== null) {
    const pv = pendingPreview;
    pendingPreview = null;
    requestAnimationFrame(() => run(pv));
  }
}
var bind = (id, out, fmt) => {
  const el = $(id), o = $(out);
  const u = () => o.textContent = fmt(+el.value);
  el.addEventListener("input", u);
  u();
};
bind("N", "NV", (v) => v + " kN");
bind("M", "MV", (v) => v + " kN\xB7m");
bind("tp", "tpV", (v) => v + " mm");
bind("Bx", "BxV", (v) => v + " mm");
bind("By", "ByV", (v) => v + " mm");
bind("Nx", "NxV", (v) => "" + v);
bind("Ny", "NyV", (v) => "" + v);
bind("Px", "PxV", (v) => v + " mm");
bind("Py", "PyV", (v) => v + " mm");
bind("Pd", "PdV", (v) => v + " mm");
for (const id of ["N", "M", "tp", "Bx", "By", "Nx", "Ny", "Px", "Py", "Pd"]) {
  const el = $(id);
  el.addEventListener("input", () => schedule(true));
  el.addEventListener("change", () => schedule(false));
}
$("dmg").addEventListener("change", () => schedule(false));
$("field").addEventListener("change", (e) => {
  currentField = e.target.value;
  recolor();
});
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();
function frame() {
  controls.update();
  renderer.render(scene, camera);
}
function animate() {
  requestAnimationFrame(animate);
  frame();
}
animate();
setInterval(frame, 200);
run();
window.__bp = () => ({ tri: renderer.info.render.triangles, kids: gPlate.children.length + gBolt.children.length });
