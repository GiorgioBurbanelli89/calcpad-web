// src/muro3d.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
var createModule = (await import("./shearwall.mjs")).default;
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
  const { nx, ny } = meshFor(HW), NE = nx * ny, NN = (nx + 1) * (ny + 1), ng = 2 * NN, ns = 55;
  for (const k in ptr) M._free(ptr[k]);
  ptr.d = M._malloc(ns * NE * 8);
  ptr.u = M._malloc(ns * ng * 8);
  ptr.s = M._malloc(ns * NE * 4 * 8);
  ptr.m = M._malloc(8 * 8);
  ptr.f = M._malloc(ns * 8);
  const t0 = performance.now();
  M._solveShearWall(HW, ft, conf, weak, nx, ny, ns, ptr.d, ptr.u, ptr.s, ptr.m, ptr.f);
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
    t: 200,
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
  const W = H.W, t = H.t;
  const le = Math.round(0.15 * W);
  const sV = 250, dbV = 12;
  const sH = 250, dbH = 12;
  const nBE = 8, dbBE = 16;
  const sEst = 100, dbEst = 10;
  const rhoW = 2 * Math.PI / 4 * dbV * dbV / (t * sV) * 100;
  const x0 = 22, Lpx = 576, s = Lpx / W, yT = 34, yB = 104;
  const lePx = le * s;
  let g = "";
  for (const yy of [yT + 9, yB - 9])
    for (let x = x0 + lePx + sV * s; x < x0 + Lpx - lePx - 1; x += sV * s)
      g += `<circle cx="${x.toFixed(1)}" cy="${yy}" r="2.4" fill="#dfe3ea"/>`;
  for (const side of [0, 1]) {
    const bx = side ? x0 + Lpx - lePx : x0;
    g += `<rect x="${bx.toFixed(1)}" y="${yT}" width="${lePx.toFixed(1)}" height="${yB - yT}" fill="#3a2a17" stroke="#d09a5a" stroke-width="1"/>`;
    g += `<rect x="${(bx + 6).toFixed(1)}" y="${yT + 6}" width="${(lePx - 12).toFixed(1)}" height="${yB - yT - 12}" fill="none" stroke="#f5b76b" stroke-width="1.4"/>`;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++)
      g += `<circle cx="${(bx + lePx * (c + 0.5) / 4).toFixed(1)}" cy="${r ? yB - 15 : yT + 15}" r="4" fill="#f5b76b"/>`;
  }
  const svg = `<svg viewBox="0 0 620 150" width="100%" style="background:#0c0f15;border-radius:6px">
    <rect x="${x0}" y="${yT}" width="${Lpx}" height="${yB - yT}" fill="#1b2330" stroke="#6a9bff" stroke-width="1.5"/>${g}
    <line x1="${x0}" y1="122" x2="${x0 + Lpx}" y2="122" stroke="#7a8090"/>
    <line x1="${x0}" y1="118" x2="${x0}" y2="126" stroke="#7a8090"/><line x1="${x0 + Lpx}" y1="118" x2="${x0 + Lpx}" y2="126" stroke="#7a8090"/>
    <text x="${x0 + Lpx / 2}" y="138" fill="#cfd3da" font-size="11" text-anchor="middle">l_w = ${W} mm</text>
    <text x="${(x0 + lePx / 2).toFixed(0)}" y="28" fill="#f5b76b" font-size="10" text-anchor="middle">borde ${le}</text>
    <text x="${(x0 + Lpx - lePx / 2).toFixed(0)}" y="28" fill="#f5b76b" font-size="10" text-anchor="middle">borde ${le}</text>
    <text x="10" y="72" fill="#9aa0aa" font-size="10" transform="rotate(-90 10 72)" text-anchor="middle">t = ${t} mm</text>
  </svg>`;
  const tbl = `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">
    <tr style="color:#9aa0aa"><td colspan="2"><b style="color:#e8e8ea">Alma del muro</b> (t=${t} mm)</td></tr>
    <tr><td>Vertical (longitudinal)</td><td style="text-align:right;color:#f5b76b">\xD8${dbV} @ ${sV} \xB7 doble malla</td></tr>
    <tr><td>Horizontal (transversal)</td><td style="text-align:right;color:#f5b76b">\xD8${dbH} @ ${sH} \xB7 doble malla</td></tr>
    <tr><td>Cuant\xEDa \u03C1 (\u22650.25%)</td><td style="text-align:right">${rhoW.toFixed(2)} %</td></tr>
    <tr style="color:#9aa0aa"><td colspan="2" style="padding-top:5px"><b style="color:#e8e8ea">Elemento de borde</b> ${le}\xD7${t} mm</td></tr>
    <tr><td>Longitudinal</td><td style="text-align:right;color:#f5b76b">${nBE}\xD8${dbBE}</td></tr>
    <tr><td>Transversal (estribos/ganchos)</td><td style="text-align:right;color:#f5b76b">\xD8${dbEst} @ ${sEst}</td></tr>
  </table>`;
  $("detail").innerHTML = svg + tbl;
}
var canvas = $("scene");
var renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
var scene = new THREE.Scene();
scene.background = new THREE.Color(987414);
var camera = new THREE.PerspectiveCamera(45, 1, 1, 4e4);
var controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
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
  const cx = W / 2, cy = Ht / 2;
  const addTri = (ax, ay, az, bx, by, bz, cX, cY, cZ, c) => {
    pos.push(ax - cx, ay - cy, az, bx - cx, by - cy, bz, cX - cx, cY - cy, cZ);
    for (let k = 0; k < 3; k++) col.push(c[0], c[1], c[2]);
  };
  for (let e = 0; e < H.NE; e++) {
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
    camera.position.set(0, 0, Math.max(W, Ht) * 1.5);
    controls.target.set(0, 0, 0);
  }
}
function onResize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", onResize);
onResize();
(function loop() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
})();
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
    build3D();
  }
}
$("HW").oninput = () => {
  $("vHW").textContent = (+$("HW").value).toFixed(1);
  schedule();
};
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
