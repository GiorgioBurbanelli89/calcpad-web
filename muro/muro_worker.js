// Worker: corre el solver WASM (shearwall) en un HILO APARTE.
// Así el hilo principal (UI + sliders) NUNCA se congela mientras calcula.
// Recibe los parámetros, resuelve, y devuelve los arrays de resultado (transferibles).
import createModule from "./shearwall_v19.mjs";

let M = null;
const ptr = {};

self.onmessage = async (e) => {
  const p = e.data;
  if (!M) M = await createModule();
  const NE = p.nx * p.ny, NN = (p.nx + 1) * (p.ny + 1), ng = 2 * NN, ns = p.ns;
  for (const k in ptr) M._free(ptr[k]);
  ptr.d = M._malloc(ns * NE * 8); ptr.u = M._malloc(ns * ng * 8); ptr.s = M._malloc(ns * NE * 4 * 8);
  ptr.m = M._malloc(8 * 8); ptr.f = M._malloc(ns * 8); ptr.dc = M._malloc(ns * NE * 8);
  M._solveShearWall(p.HW, p.ft, p.conf, p.weak, p.mode, p.nx, p.ny, ns, p.fc, p.ctrlWeb, p.ctrlBE,
                    p.le, p.tw, p.tbe, p.grav, p.lw, ptr.d, ptr.u, ptr.s, ptr.m, ptr.f, ptr.dc);
  const dmg = M.HEAPF64.slice(ptr.d / 8, ptr.d / 8 + ns * NE);
  const dmgC = M.HEAPF64.slice(ptr.dc / 8, ptr.dc / 8 + ns * NE);
  const U = M.HEAPF64.slice(ptr.u / 8, ptr.u / 8 + ns * ng);
  const sig = M.HEAPF64.slice(ptr.s / 8, ptr.s / 8 + ns * NE * 4);
  const force = M.HEAPF64.slice(ptr.f / 8, ptr.f / 8 + ns);
  const meta = Array.from(M.HEAPF64.subarray(ptr.m / 8, ptr.m / 8 + 8));
  self.postMessage({ reqId: p.reqId, ns, meta, dmg, dmgC, U, sig, force },
    [dmg.buffer, dmgC.buffer, U.buffer, sig.buffer, force.buffer]);
};
