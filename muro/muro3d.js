// src/muro3d.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
var createModule = (await import("./shearwall_v8.mjs")).default;
var M = await createModule();
var $ = (id) => document.getElementById(id);
var clamp01 = (x) => Math.max(0, Math.min(1, x));
function jet(t) {
  t = clamp01(t);
  return [
    clamp01(Math.min(4 * t - 1.5, -4 * t + 4.5)),
    clamp01(Math.min(4 * t - 0.5, -4 * t + 3.5)),
    clamp01(Math.min(4 * t + 0.5, -4 * t + 2.5))
  ];
}
var H = null;
var frame = 0;
var faceElem = [];
var ptr = {};
function meshFor(HW) {
  const ne = 460;
  const nx = Math.max(6, Math.min(26, Math.round(Math.sqrt(ne / HW))));
  const ny = Math.max(6, Math.min(40, Math.round(HW * nx)));
  return { nx, ny };
}
function solve() {
  const HW = +$("HW").value, ft = +$("ft").value;
  const conf = +$("conf").value, weak = $("weak").checked ? 1 : 0;
  const fc = +$("fc").value;
  const v = (id) => +$(id).value, Ar = (dd) => Math.PI / 4 * dd * dd;
  const tt = v("t"), fy = v("fy");
  const rhoW = 2 * Ar(v("dbW")) / (tt * v("sW"));
  const nPerim = 2 * v("nBEx") + 2 * v("nBEy") - 4;
  const rhoBE = nPerim * Ar(v("dbBE")) / (v("leFrac") * 3e3 * tt);
  const ctrlWeb = Math.min(0.75, rhoW * fy / (ft * 4)), ctrlBE = Math.min(0.88, rhoBE * fy / (ft * 4));
  const { nx, ny } = meshFor(HW), NE = nx * ny, NN = (nx + 1) * (ny + 1), ng = 2 * NN, ns = 55;
  for (const k in ptr) M._free(ptr[k]);
  ptr.d = M._malloc(ns * NE * 8);
  ptr.u = M._malloc(ns * ng * 8);
  ptr.s = M._malloc(ns * NE * 4 * 8);
  ptr.m = M._malloc(8 * 8);
  ptr.f = M._malloc(ns * 8);
  const t0 = performance.now();
  M._solveShearWall(HW, ft, conf, weak, nx, ny, ns, fc, ctrlWeb, ctrlBE, ptr.d, ptr.u, ptr.s, ptr.m, ptr.f);
  const dt = performance.now() - t0 | 0;
  const meta = M.HEAPF64.subarray(ptr.m / 8, ptr.m / 8 + 8);
  const W = meta[4], Ht = meta[5], flex = meta[7] > 0.5;
  const X = new Float64Array(NN), Y = new Float64Array(NN);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    X[j * (nx + 1) + i] = W * i / nx;
    Y[j * (nx + 1) + i] = Ht * j / ny;
  }
  const els = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const n0 = j * (nx + 1) + i;
    els.push([n0, n0 + 1, n0 + nx + 2, n0 + nx + 1]);
  }
  H = {
    nx,
    ny,
    NE,
    NN,
    ng,
    ns,
    W,
    Ht,
    t: +$("t").value,
    umax: 3e-3 * Ht,
    X,
    Y,
    els,
    flex,
    dmg: M.HEAPF64.slice(ptr.d / 8, ptr.d / 8 + ns * NE),
    U: M.HEAPF64.slice(ptr.u / 8, ptr.u / 8 + ns * ng),
    sig: M.HEAPF64.slice(ptr.s / 8, ptr.s / 8 + ns * NE * 4),
    force: M.HEAPF64.slice(ptr.f / 8, ptr.f / 8 + ns)
  };
  $("status").textContent = `listo (${NE} elem, ${dt} ms, WASM C++)`;
  mechLabel(weak === 1, flex);
  loadLabel();
  detailing();
  build3D();
  buildDims();
  buildRebar();
  buildBE();
}
function mechLabel(weak, flex) {
  const e = $("mech");
  if (weak) {
    e.textContent = "DESLIZAMIENTO EN LA BASE";
    e.style.background = "#7a3b1e";
  } else if (flex) {
    e.textContent = "FALLA FLEXURAL";
    e.style.background = "#1e5a7a";
  } else {
    e.textContent = "FALLA POR CORTANTE (DIAGONAL)";
    e.style.background = "#7a1e2e";
  }
}
function detailing() {
  if (!H) return;
  const W = H.W, t = H.t, hw = H.Ht;
  const val = (id) => +$(id).value;
  const fc = val("fc"), fy = val("fy"), lam = 1, sqfc = Math.sqrt(fc);
  const cover = val("cover"), leFrac = val("leFrac");
  const dbW = val("dbW"), sW = val("sW");
  const nBEx = val("nBEx"), nBEy = val("nBEy");
  const nBEu = 2 * nBEx + 2 * nBEy - 4;
  const dbBE = val("dbBE");
  const dbEst = val("dbEst"), sEst = val("sEst");
  const zero = frame < 0, fo = zero ? 0 : frame;
  const Vu = zero ? 0 : Math.abs(H.force[fo]);
  const Mu = Vu * hw;
  const ar = hw / W;
  const Acv = W * t;
  const ac = ar <= 1.5 ? 0.25 : ar >= 2 ? 0.17 : 0.25 + (0.17 - 0.25) * (ar - 1.5) / 0.5;
  const phiV = 0.75, phiM = 0.9;
  const Vc = ac * lam * sqfc * Acv;
  const VnMax = 0.66 * sqfc * Acv;
  const shearFail = Vu > phiV * VnMax;
  const rhoTmax = (VnMax / Acv - ac * sqfc) / fy;
  let rhoT = Math.max(25e-4, Math.min((Vu / phiV - Vc) / (Acv * fy), rhoTmax));
  const rhoL = ar <= 2 ? Math.max(25e-4, rhoT) : 25e-4;
  const AbW = Math.PI / 4 * dbW * dbW;
  const rhoWprov = 2 * AbW / (t * sW);
  const webOK = rhoWprov >= rhoT - 1e-9;
  const clampS = (r) => Math.max(50, Math.min(450, Math.floor(2 * AbW / (r * t) / 25) * 25));
  const sTreq = clampS(rhoT), sLreq = clampS(rhoL);
  const As = Mu / (phiM * fy * 0.8 * W);
  const AbBE = Math.PI / 4 * dbBE * dbBE;
  const Asprov = nBEu * AbBE;
  const flexOK = Asprov >= As - 1e-9;
  let nBEreq = Math.max(6, Math.ceil(As / AbBE));
  if (nBEreq % 2) nBEreq++;
  const I = t * W * W * W / 12, sigma = Mu * (W / 2) / I;
  const sbe = sigma > 0.2 * fc;
  showBE(sbe);
  const le = Math.round(leFrac * W);
  const bc = t - 2 * cover;
  const AshReq = 0.09 * fc / fy * sEst * bc, AshProv = 2 * Math.PI / 4 * dbEst * dbEst;
  const confOK = AshProv >= AshReq - 1e-9;
  const sBElong = Math.round((le - 2 * cover) / Math.max(1, nBEx - 1));
  const rhoBE = nBEu * AbBE / (le * t) * 100;
  const ld = Math.round(fy / (1.7 * lam * sqfc) * dbBE);
  const drift = zero ? 0 : H.umax * (fo + 1) / H.ns / hw * 100;
  const driftMax = 2;
  const x0 = 22, Lpx = 576, s = Lpx / W, yT = 34, yB = 104, lePx = le * s;
  const cols = nBEx;
  let g = "";
  for (const yy of [yT + 9, yB - 9])
    g += `<line x1="${(x0 + lePx).toFixed(1)}" y1="${yy}" x2="${(x0 + Lpx - lePx).toFixed(1)}" y2="${yy}" stroke="#5ec8ff" stroke-width="1.3" opacity="0.85"/>`;
  for (const yy of [yT + 9, yB - 9])
    for (let x = x0 + lePx + sW * s; x < x0 + Lpx - lePx - 1; x += sW * s)
      g += `<circle cx="${x.toFixed(1)}" cy="${yy}" r="2.4" fill="#dfe3ea"/>`;
  for (const side of [0, 1]) {
    const bx = side ? x0 + Lpx - lePx : x0;
    const bcol = sbe ? "#f5b76b" : "#8a9099", fill = sbe ? "#3a2a17" : "#242a33";
    g += `<rect x="${bx.toFixed(1)}" y="${yT}" width="${lePx.toFixed(1)}" height="${yB - yT}" fill="${fill}" stroke="${bcol}" stroke-width="1"/>`;
    g += `<rect x="${(bx + 6).toFixed(1)}" y="${yT + 6}" width="${(lePx - 12).toFixed(1)}" height="${yB - yT - 12}" fill="none" stroke="#5ec8ff" stroke-width="1.4"/>`;
    const xa = bx + 9, xb2 = bx + lePx - 9, ya = yT + 14, yb2 = yB - 14;
    const dot = (X, Y) => `<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="3.4" fill="${bcol}"/>`;
    for (let c = 0; c < nBEx; c++) {
      const X = nBEx === 1 ? (xa + xb2) / 2 : xa + (xb2 - xa) * c / (nBEx - 1);
      g += dot(X, ya) + dot(X, yb2);
    }
    for (let r = 1; r < nBEy - 1; r++) {
      const Y = ya + (yb2 - ya) * r / (nBEy - 1);
      g += dot(xa, Y) + dot(xb2, Y);
    }
  }
  const xR = (x0 + Lpx - lePx).toFixed(0);
  const svg = `<svg viewBox="0 0 620 158" width="100%" style="background:#0c0f15;border-radius:6px">
    <rect x="${x0}" y="${yT}" width="${Lpx}" height="${yB - yT}" fill="#1b2330" stroke="#6a9bff" stroke-width="1.5"/>${g}
    <line x1="${x0}" y1="122" x2="${x0 + Lpx}" y2="122" stroke="#7a8090"/>
    <line x1="${x0}" y1="118" x2="${x0}" y2="126" stroke="#7a8090"/><line x1="${x0 + Lpx}" y1="118" x2="${x0 + Lpx}" y2="126" stroke="#7a8090"/>
    <text x="${x0 + Lpx / 2}" y="138" fill="#cfd3da" font-size="11" text-anchor="middle">l_w = ${W} mm</text>
    <text x="10" y="72" fill="#9aa0aa" font-size="10" transform="rotate(-90 10 72)" text-anchor="middle">t = ${t} mm</text>
    <line x1="${x0}" y1="28" x2="${(x0 + lePx).toFixed(0)}" y2="28" stroke="#d09a5a"/>
    <line x1="${xR}" y1="28" x2="${x0 + Lpx}" y2="28" stroke="#d09a5a"/>
    <text x="${(x0 + lePx / 2).toFixed(0)}" y="23" fill="#d09a5a" font-size="9.5" text-anchor="middle">le=${le}</text>
    <text x="${(x0 + Lpx - lePx / 2).toFixed(0)}" y="23" fill="#d09a5a" font-size="9.5" text-anchor="middle">le=${le}</text>
    <circle cx="${x0 + 60}" cy="147" r="2.4" fill="#dfe3ea"/><text x="${x0 + 66}" y="150" fill="#9aa0aa" font-size="9">vertical (long)</text>
    <line x1="${x0 + 145}" y1="147" x2="${x0 + 160}" y2="147" stroke="#5ec8ff" stroke-width="1.3"/><text x="${x0 + 164}" y="150" fill="#9aa0aa" font-size="9">horizontal + estribo (transversal)</text>
  </svg>`;
  const eb = 178, sE = Math.min(244 / W, eb / hw), wpx = W * sE, hpx = hw * sE, ox = (300 - wpx) / 2, oy = 8;
  let ev = `<rect x="${ox.toFixed(1)}" y="${oy}" width="${wpx.toFixed(1)}" height="${hpx.toFixed(1)}" fill="#1b2330" stroke="#6a9bff" stroke-width="1.3"/>`;
  for (let x = sW; x < W; x += sW) {
    const xp = ox + x * sE;
    ev += `<line x1="${xp.toFixed(1)}" y1="${oy}" x2="${xp.toFixed(1)}" y2="${(oy + hpx).toFixed(1)}" stroke="#6fe0ff" stroke-width="0.4" opacity="0.55"/>`;
  }
  for (let y = sW; y < hw; y += sW) {
    const yp = oy + hpx - y * sE;
    ev += `<line x1="${ox.toFixed(1)}" y1="${yp.toFixed(1)}" x2="${(ox + wpx).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#6fe0ff" stroke-width="0.4" opacity="0.55"/>`;
  }
  const ncolE = nBEx;
  for (const bx of [0, W - le]) {
    const xp = ox + bx * sE, wle = le * sE;
    ev += `<rect x="${xp.toFixed(1)}" y="${oy}" width="${wle.toFixed(1)}" height="${hpx.toFixed(1)}" fill="#f5b76b" opacity="0.12"/>`;
    for (let c = 0; c < ncolE; c++) {
      const xx = xp + wle * (c + 0.5) / ncolE;
      ev += `<line x1="${xx.toFixed(1)}" y1="${oy}" x2="${xx.toFixed(1)}" y2="${(oy + hpx).toFixed(1)}" stroke="#ffb454" stroke-width="1.2"/>`;
    }
    for (let y = sEst; y < hw; y += sEst) {
      const yp = oy + hpx - y * sE;
      ev += `<line x1="${xp.toFixed(1)}" y1="${yp.toFixed(1)}" x2="${(xp + wle).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#ffb454" stroke-width="0.7"/>`;
    }
  }
  const elev = `<div style="font-size:10.5px;color:#9aa0aa;margin:8px 0 2px">Elevaci\xF3n (barras vert. + horiz. \xB7 bordes confinados)</div>
    <svg viewBox="0 0 300 ${(oy * 2 + hpx).toFixed(0)}" width="100%" style="background:#0c0f15;border-radius:6px">${ev}</svg>`;
  const tonf = (n) => (n / 9806.65).toFixed(0);
  const warn = shearFail ? `<div style="background:#5a1e2e;color:#ffd7de;font-size:10.5px;padding:4px 7px;border-radius:4px;margin:5px 0">\u26A0 Vu &gt; \u03C6Vn,m\xE1x (${tonf(phiV * VnMax)} tonf): secci\xF3n insuficiente por corte \u2192 aumentar t o f'c</div>` : "";
  const beBanner = `<div style="font-size:10.5px;padding:5px 8px;border-radius:4px;margin:5px 0;background:${sbe ? "#4a2a10" : "#1e2a1e"};color:${sbe ? "#ffb454" : "#8fce8f"}">
    ${sbe ? "\u{1F7E7} <b>Elementos de borde REQUERIDOS</b>" : "\u{1F7E9} <b>Elementos de borde NO requeridos</b>"} \xB7 \u03C3=${sigma.toFixed(2)} ${sbe ? "&gt;" : "\u2264"} 0.2f\u2032c=${(0.2 * fc).toFixed(2)} MPa</div>`;
  const chk = (ok) => ok ? ` <span style="color:#4fd08a">\u2713</span>` : ` <span style="color:#ff6b6b">\u2717 falta</span>`;
  const tbl = `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">
    <tr style="color:#9aa0aa"><td colspan="2"><b style="color:#e8e8ea">Demanda del modelo</b> (hw/lw=${ar.toFixed(2)}, fy=${fy})</td></tr>
    <tr><td>Cortante Vu</td><td style="text-align:right;color:#4fd08a">${tonf(Vu)} tonf</td></tr>
    <tr><td>Momento Mu = Vu\xB7hw</td><td style="text-align:right;color:#4fd08a">${tonf(Mu / 1e3)} tonf\xB7m</td></tr>
    <tr style="color:#9aa0aa"><td colspan="2" style="padding-top:5px"><b style="color:#e8e8ea">Alma</b> \u2014 provisto vs requerido</td></tr>
    <tr><td>Malla (tu slider)</td><td style="text-align:right;color:#f5b76b">\xD8${dbW} @ ${sW} doble</td></tr>
    <tr><td>\u03C1 provista / requerida</td><td style="text-align:right">${(rhoWprov * 100).toFixed(2)}% / ${(rhoT * 100).toFixed(2)}%${chk(webOK)}</td></tr>
    <tr style="color:#9aa0aa"><td colspan="2" style="padding-top:5px"><b style="color:#e8e8ea">Elemento de borde</b> ${le}\xD7${t} mm</td></tr>
    <tr><td>Long. borde (per\xEDmetro)</td><td style="text-align:right;color:#f5b76b">Nx${nBEx}\xB7Ny${nBEy} = ${nBEu}\xD8${dbBE}</td></tr>
    <tr><td>As provisto / requerido</td><td style="text-align:right">${(Asprov / 100).toFixed(1)} / ${(As / 100).toFixed(1)} cm\xB2${chk(flexOK)}</td></tr>
    <tr><td>Cuant\xEDa \u03C1 borde (1\u20136%)</td><td style="text-align:right;color:${rhoBE > 6 ? "#ff9a6b" : rhoBE < 1 ? "#9aa0aa" : "#4fd08a"}">${rhoBE.toFixed(2)} %</td></tr>
    <tr><td>Estribo (tu slider)</td><td style="text-align:right;color:#f5b76b">\xD8${dbEst} @ ${sEst}</td></tr>
    <tr><td>Ash provisto / requerido</td><td style="text-align:right">${AshProv.toFixed(0)} / ${AshReq.toFixed(0)} mm\xB2${chk(confOK)}</td></tr>
    <tr><td>\xBFElemento de borde especial?</td><td style="text-align:right;color:${sbe ? "#ff9a6b" : "#9aa0aa"}">${sbe ? "S\xCD requerido" : "no (\u03C3<0.2f\u2032c)"}</td></tr>
    <tr style="color:#9aa0aa"><td colspan="2" style="padding-top:5px"><b style="color:#e8e8ea">Detallado</b></td></tr>
    <tr><td>Recubrimiento</td><td style="text-align:right">${cover} mm</td></tr>
    <tr><td>Long. desarrollo ld (\xD8${dbBE})</td><td style="text-align:right">${ld} mm</td></tr>
    <tr><td>Deriva \u03B4/hw (\u2264${driftMax}%)</td><td style="text-align:right;color:${drift > driftMax ? "#ff9a6b" : "#4fd08a"}">${drift.toFixed(2)} %</td></tr>
  </table>`;
  $("detail").innerHTML = svg + warn + beBanner + tbl + elev;
}
var canvas = $("scene");
var renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
var scene = new THREE.Scene();
scene.background = new THREE.Color(987414);
var camera = new THREE.PerspectiveCamera(45, 1, 1, 4e4);
var controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
function render() {
  renderer.render(scene, camera);
}
controls.addEventListener("change", render);
scene.add(new THREE.HemisphereLight(16777215, 547, 1.1));
var key = new THREE.DirectionalLight(16777215, 1.6);
key.position.set(1, 2, 3);
scene.add(key);
var geom = new THREE.BufferGeometry();
var mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.75, side: THREE.DoubleSide });
var mesh = new THREE.Mesh(geom, mat);
scene.add(mesh);
var wire = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0, transparent: true, opacity: 0.12 })
);
scene.add(wire);
var dimGroup = new THREE.Group();
scene.add(dimGroup);
function makeLabel(text, color = "#cfd3da") {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const fs = 44;
  ctx.font = `bold ${fs}px sans-serif`;
  c.width = Math.ceil(ctx.measureText(text).width) + 24;
  c.height = fs + 18;
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const k = Math.max(H.W, H.Ht) * 0.05 / c.height;
  sp.scale.set(c.width * k, c.height * k, 1);
  return sp;
}
function buildDims() {
  if (!H) return;
  while (dimGroup.children.length) {
    const o = dimGroup.children.pop();
    o.material?.map?.dispose?.();
    o.material?.dispose?.();
    o.geometry?.dispose?.();
  }
  const hw2 = H.W / 2, hh = H.Ht / 2, t = H.t, off = Math.max(H.W, H.Ht) * 0.09, tk = off * 0.28;
  const line = (pts) => dimGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 10465992 })
  ));
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const yb = -hh - off;
  line([V(-hw2, yb), V(hw2, yb)]);
  line([V(-hw2, yb - tk), V(-hw2, yb + tk)]);
  line([V(hw2, yb - tk), V(hw2, yb + tk)]);
  const a = makeLabel(`l_w = ${(H.W / 1e3).toFixed(2)} m`);
  a.position.set(0, yb - off * 0.75, 0);
  dimGroup.add(a);
  const xl = -hw2 - off;
  line([V(xl, -hh), V(xl, hh)]);
  line([V(xl - tk, -hh), V(xl + tk, -hh)]);
  line([V(xl - tk, hh), V(xl + tk, hh)]);
  const b = makeLabel(`h_w = ${(H.Ht / 1e3).toFixed(2)} m`);
  b.position.set(xl - off * 1.05, 0, 0);
  dimGroup.add(b);
  const c = makeLabel(`t = ${t} mm`);
  c.position.set(hw2 * 0.55, hh + off * 0.6, t / 2);
  dimGroup.add(c);
  const le = Math.round(0.15 * H.W), yb2 = -hh - off * 0.42;
  line([V(-hw2, yb2), V(-hw2 + le, yb2)]);
  line([V(-hw2, yb2 - tk * 0.6), V(-hw2, yb2 + tk * 0.6)]);
  line([V(-hw2 + le, yb2 - tk * 0.6), V(-hw2 + le, yb2 + tk * 0.6)]);
  const d = makeLabel(`borde ${le}\xD7${t}`, "#f5b76b");
  d.position.set(-hw2 + le / 2, yb2 - off * 0.42, 0);
  dimGroup.add(d);
  render();
}
var rebarGroup = new THREE.Group();
scene.add(rebarGroup);
rebarGroup.visible = false;
rebarGroup.renderOrder = 999;
var barMat = new THREE.MeshBasicMaterial({ color: 16756283, depthTest: false, transparent: true });
var meshLineMat = new THREE.LineBasicMaterial({ color: 7332095, depthTest: false, transparent: true, opacity: 0.9 });
var hoopMat = new THREE.LineBasicMaterial({ color: 16756283, depthTest: false, transparent: true });
function buildRebar() {
  if (!H) return;
  while (rebarGroup.children.length) {
    const o = rebarGroup.children.pop();
    o.geometry?.dispose?.();
  }
  const rv = (id) => +$(id).value;
  const W = H.W, Ht = H.Ht, t = H.t, cover = rv("cover"), le = rv("leFrac") * W;
  const sW = rv("sW"), sEst = rv("sEst"), ncx = rv("nBEx"), ncy = rv("nBEy");
  const hw2 = W / 2, hh = Ht / 2, z1 = cover, z2 = t - cover;
  const barR = Math.max(6, W / 260) * rv("dbBE") / 16, hL = Ht - 2 * cover;
  const geoV = new THREE.CylinderGeometry(barR, barR, hL, 8);
  const vbar = (xw, zw) => {
    const m = new THREE.Mesh(geoV, barMat);
    m.position.set(xw, 0, zw);
    rebarGroup.add(m);
  };
  for (const bx0 of [-hw2, hw2 - le]) {
    const xa = bx0 + cover, xb2 = bx0 + le - cover;
    for (let cx = 0; cx < ncx; cx++) {
      const xw = ncx === 1 ? (xa + xb2) / 2 : xa + (xb2 - xa) * cx / (ncx - 1);
      vbar(xw, z1);
      vbar(xw, z2);
    }
    for (let cy = 1; cy < ncy - 1; cy++) {
      const zw = z1 + (z2 - z1) * cy / (ncy - 1);
      vbar(xa, zw);
      vbar(xb2, zw);
    }
  }
  const seg = [];
  const push = (a, b) => seg.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  for (const zc of [z1, z2]) {
    for (let x = -hw2 + le + sW; x < hw2 - le; x += sW) {
      push([x, -hh + cover, zc], [x, hh - cover, zc]);
    }
    for (let y = -hh + cover; y <= hh - cover; y += sW) {
      push([-hw2 + le, y, zc], [hw2 - le, y, zc]);
    }
  }
  const gMesh = new THREE.BufferGeometry();
  gMesh.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
  rebarGroup.add(new THREE.LineSegments(gMesh, meshLineMat));
  const hoop = [];
  for (const bx0 of [-hw2, hw2 - le]) for (let y = -hh + cover; y <= hh - cover; y += sEst) {
    const x0b = bx0 + 8, x1b = bx0 + le - 8, za = z1 - 4, zb = z2 + 4;
    const P = [[x0b, y, za], [x1b, y, za], [x1b, y, zb], [x0b, y, zb], [x0b, y, za]];
    for (let k = 0; k < 4; k++) {
      hoop.push(new THREE.Vector3(...P[k]), new THREE.Vector3(...P[k + 1]));
    }
  }
  rebarGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(hoop), hoopMat));
  render();
}
var beGroup = new THREE.Group();
scene.add(beGroup);
var beMat = new THREE.MeshBasicMaterial({ color: 16747546, transparent: true, opacity: 0.32, depthWrite: false });
function buildBE() {
  if (!H) return;
  while (beGroup.children.length) {
    const o = beGroup.children.pop();
    o.geometry?.dispose?.();
  }
  const W = H.W, Ht = H.Ht, t = H.t, le = 0.15 * W;
  const g = new THREE.BoxGeometry(le, Ht, t * 1.02);
  for (const sgn of [-1, 1]) {
    const m = new THREE.Mesh(g, beMat);
    m.position.set(sgn * (W / 2 - le / 2), 0, t / 2);
    beGroup.add(m);
  }
  render();
}
function showBE(on) {
  if (beGroup.visible !== on) {
    beGroup.visible = on;
    render();
  }
}
function build3D() {
  if (!H) return;
  const zero = frame < 0;
  const fo = zero ? 0 : frame, U = H.U, dmg = H.dmg, W = H.W, Ht = H.Ht, tz = H.t;
  let mu = 1e-9;
  if (!zero) for (let d = 0; d < H.ng; d++) {
    const v = Math.abs(U[fo * H.ng + d]);
    if (v > mu) mu = v;
  }
  const sf = zero ? 0 : 0.12 * Math.min(W, Ht) / mu;
  const Xd = new Float64Array(H.NN), Yd = new Float64Array(H.NN);
  for (let n = 0; n < H.NN; n++) {
    Xd[n] = H.X[n] + sf * (zero ? 0 : U[fo * H.ng + 2 * n]);
    Yd[n] = H.Y[n] + sf * (zero ? 0 : U[fo * H.ng + 2 * n + 1]);
  }
  const pos = [], col = [], wl = [];
  faceElem = [];
  let curE = 0;
  const cx = W / 2, cy = Ht / 2;
  const addTri = (ax, ay, az, bx, by, bz, cX, cY, cZ, c) => {
    pos.push(ax - cx, ay - cy, az, bx - cx, by - cy, bz, cX - cx, cY - cy, cZ);
    for (let k = 0; k < 3; k++) col.push(c[0], c[1], c[2]);
    faceElem.push(curE);
  };
  for (let e = 0; e < H.NE; e++) {
    curE = e;
    const el = H.els[e], d = zero ? 0 : dmg[fo * H.NE + e], c = jet(d / 1.231);
    const P = el.map((n) => [Xd[n], Yd[n]]);
    for (const z of [0, tz]) {
      addTri(P[0][0], P[0][1], z, P[1][0], P[1][1], z, P[2][0], P[2][1], z, c);
      addTri(P[0][0], P[0][1], z, P[2][0], P[2][1], z, P[3][0], P[3][1], z, c);
    }
    const i = e % H.nx, j = e / H.nx | 0;
    const edges = [];
    if (j === 0) edges.push([0, 1]);
    if (j === H.ny - 1) edges.push([2, 3]);
    if (i === 0) edges.push([3, 0]);
    if (i === H.nx - 1) edges.push([1, 2]);
    for (const [a, b] of edges) {
      addTri(P[a][0], P[a][1], 0, P[b][0], P[b][1], 0, P[b][0], P[b][1], tz, c);
      addTri(P[a][0], P[a][1], 0, P[b][0], P[b][1], tz, P[a][0], P[a][1], tz, c);
    }
    for (let a = 0; a < 4; a++) {
      const b = (a + 1) % 4;
      wl.push(P[a][0] - cx, P[a][1] - cy, 0, P[b][0] - cx, P[b][1] - cy, 0);
    }
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geom.computeVertexNormals();
  wire.geometry.setAttribute("position", new THREE.Float32BufferAttribute(wl, 3));
  if (!build3D._framed) {
    build3D._framed = true;
    camera.position.set(0, 0, Math.max(W, Ht) * 1.7);
    controls.target.set(0, 0, 0);
    controls.update();
  }
  render();
}
function onResize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", () => {
  onResize();
  render();
});
onResize();
var ray = new THREE.Raycaster();
var ndc = new THREE.Vector2();
var tip = $("tip");
function showTip(clientX, clientY) {
  if (!H) return;
  const r = canvas.getBoundingClientRect();
  ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(mesh, false);
  const e = hit.length ? faceElem[hit[0].faceIndex] : void 0;
  if (e == null) {
    tip.style.display = "none";
    return;
  }
  const zero = frame < 0, fo = zero ? 0 : frame, b = (fo * H.NE + e) * 4;
  const s1 = zero ? 0 : H.sig[b], tau = zero ? 0 : H.sig[b + 1];
  const e1 = zero ? 0 : H.sig[b + 2], gm = zero ? 0 : H.sig[b + 3];
  const dv = zero ? 0 : H.dmg[fo * H.NE + e];
  const xi = H.W * (e % H.nx + 0.5) / H.nx, yi = H.Ht * ((e / H.nx | 0) + 0.5) / H.ny;
  tip.innerHTML = `x = ${xi.toFixed(0)} mm \xB7 y = ${yi.toFixed(0)} mm<br><b>\u03C3\u2081</b> = ${s1.toFixed(2)} MPa<br><b>\u03C4max</b> = ${tau.toFixed(2)} MPa<br><b>\u03B5\u2081</b> = ${e1.toExponential(2)}<br><b>\u03B3max</b> = ${gm.toExponential(2)}<br><b>DAMAGET</b> = ${dv.toFixed(3)}`;
  tip.style.display = "block";
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let lx = clientX - r.left + 14, ly = clientY - r.top + 14;
  if (lx + tw > r.width) lx = clientX - r.left - tw - 14;
  if (ly + th > r.height) ly = clientY - r.top - th - 14;
  tip.style.left = Math.max(2, lx) + "px";
  tip.style.top = Math.max(2, ly) + "px";
}
canvas.addEventListener("mousemove", (ev) => showTip(ev.clientX, ev.clientY));
canvas.addEventListener("mouseleave", () => {
  tip.style.display = "none";
});
canvas.addEventListener("touchstart", (ev) => {
  if (ev.touches.length) showTip(ev.touches[0].clientX, ev.touches[0].clientY);
}, { passive: true });
canvas.addEventListener("touchmove", (ev) => {
  if (ev.touches.length) showTip(ev.touches[0].clientX, ev.touches[0].clientY);
}, { passive: true });
var timer = null;
function schedule() {
  $("status").textContent = "\u23F3 calculando\u2026";
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(solve, 150);
}
function loadLabel() {
  if (!H) return;
  if (frame < 0) {
    $("vLoad").textContent = "0.0 tonf (0 kN) \xB7 0.0 mm";
    return;
  }
  const ux = H.umax * (frame + 1) / H.ns;
  const VN = Math.abs(H.force[frame]);
  const tonf = VN / 9806.65, kN = VN / 1e3;
  $("vLoad").textContent = `${tonf.toFixed(1)} tonf (${kN.toFixed(0)} kN) \xB7 ${ux.toFixed(1)} mm`;
}
function setLoad() {
  frame = +$("load").value - 1;
  if (H) {
    loadLabel();
    detailing();
    build3D();
  }
}
$("HW").oninput = () => {
  $("vHW").textContent = (+$("HW").value).toFixed(1);
  schedule();
};
$("fc").oninput = () => {
  $("vFc").textContent = (+$("fc").value).toFixed(0);
  schedule();
};
$("t").oninput = () => {
  const tv = +$("t").value;
  $("vT").textContent = tv.toFixed(0);
  if (H) {
    H.t = tv;
    detailing();
    build3D();
    buildDims();
    buildRebar();
    buildBE();
  }
};
$("rebar").addEventListener("change", () => {
  const on = $("rebar").checked;
  rebarGroup.visible = on;
  mat.transparent = on;
  mat.opacity = on ? 0.06 : 1;
  mat.depthWrite = !on;
  mat.needsUpdate = true;
  wire.visible = !on;
  render();
});
var crackAffecting = /* @__PURE__ */ new Set(["fy", "leFrac", "dbW", "sW", "nBEx", "nBEy", "dbBE"]);
for (const id of ["fy", "cover", "leFrac", "dbW", "sW", "nBEx", "nBEy", "dbBE", "dbEst", "sEst"]) {
  const el = $(id);
  const span = $("v" + id.charAt(0).toUpperCase() + id.slice(1));
  el.oninput = () => {
    span.textContent = el.value;
    if (crackAffecting.has(id)) schedule();
    else if (H) {
      detailing();
      buildRebar();
    }
  };
}
$("ft").oninput = () => {
  $("vFt").textContent = (+$("ft").value).toFixed(1);
  schedule();
};
$("conf").oninput = () => {
  $("vConf").textContent = (+$("conf").value).toFixed(1);
  schedule();
};
$("load").oninput = setLoad;
$("weak").addEventListener("change", schedule);
frame = -1;
$("load").value = "0";
solve();
