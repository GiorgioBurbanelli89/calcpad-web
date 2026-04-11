// Bundled examples for Calcpad-Symbolic Web
// These are the same FEM hex8 examples from the desktop Calcpad-Symbolic,
// pre-compiled as TypeScript (skipping the Calcpad script parser for speed).

import { solveHex8, computeSigmaZZ, meshHex8Box } from '../fem/FemSolver';

export interface ExampleResult {
  title: string;
  summary: string;
  nodes: number[][];
  elements: number[][];
  values: number[];
  valueLabel: string;
  timings: { assembleMs: number; solveMs: number; totalMs: number };
  scalars: Record<string, string | number>;
}

export type ExampleRunner = () => ExampleResult;

// --- Example 1: Cube 1x1x1 m in compression ---
// Validates against analytical sigma = -P*L/(A*E) = -0.004545 mm
export const exampleCube: ExampleRunner = () => {
  const t0 = performance.now();
  const Lx = 1000, Ly = 1000, Lz = 1000;
  const E = 22000, nu = 0.2; // concrete, MPa
  const P = 100000; // N total
  const { nodes, elements } = meshHex8Box(Lx, Ly, Lz, 1, 1, 1, false);

  // BCs: bottom nodes fixed in z, one in all dofs, one in y
  const bcs = [
    { dofId: 3 * 0 + 0, value: 0 },
    { dofId: 3 * 0 + 1, value: 0 },
    { dofId: 3 * 0 + 2, value: 0 },
    { dofId: 3 * 1 + 1, value: 0 },
    { dofId: 3 * 1 + 2, value: 0 },
    { dofId: 3 * 2 + 2, value: 0 },
    { dofId: 3 * 3 + 2, value: 0 },
  ];

  // Apply P distributed equally on top 4 nodes (nodes 4,5,6,7)
  const Fz = -P / 4;
  const loads = [4, 5, 6, 7].map(n => ({ nodeId: n, fx: 0, fy: 0, fz: Fz }));

  const res = solveHex8({ nodes, elements, E, nu, loads, bcs });
  const sigma = computeSigmaZZ(nodes, elements, res.u, E, nu);
  const uz_top = (res.u[3 * 4 + 2] + res.u[3 * 5 + 2] + res.u[3 * 6 + 2] + res.u[3 * 7 + 2]) / 4;
  const uz_teo = -P * Lz / (Lx * Ly * E);
  const diffPct = Math.abs((uz_top - uz_teo) / uz_teo) * 100;
  const totalMs = performance.now() - t0;

  return {
    title: 'Cubo 1×1×1 m — compresión uniaxial',
    summary:
      `Cubo de concreto E=${E} MPa, ν=${nu}, carga P=${P / 1000} kN distribuida en 4 nudos superiores. ` +
      `Validación contra solución analítica σ = P·L/(A·E).`,
    nodes,
    elements,
    values: sigma,
    valueLabel: 'σ_zz (MPa)',
    timings: { assembleMs: res.tAssembleMs, solveMs: res.tSolveMs, totalMs },
    scalars: {
      'UZ promedio (top)': uz_top.toExponential(4) + ' mm',
      'UZ teórico (Boussinesq)': uz_teo.toExponential(4) + ' mm',
      'Diferencia': diffPct.toFixed(3) + ' %',
      'σ_zz en el centro': sigma[0].toFixed(4) + ' MPa',
    },
  };
};

// --- Example 2: Soil mass with point load ---
// 10x10x5 m soil (E=20 MPa, nu=0.42), point load at top center
export const exampleSoilPoint: ExampleRunner = () => {
  const t0 = performance.now();
  const Lx = 10, Ly = 10, Lz = 5;
  const nx = 6, ny = 6, nz = 4; // smaller mesh for browser
  const E = 20; // MPa (rigid clay)
  const nu = 0.42;
  const P = 100; // kN

  const { nodes, elements } = meshHex8Box(Lx, Ly, Lz, nx, ny, nz, true);
  const nn = nodes.length;

  const TOL = Math.min(Lx / nx, Ly / ny, Lz / nz) / 100;

  // Find top-center node
  let tcId = 0;
  for (let i = 0; i < nn; i++) {
    const [x, y, z] = nodes[i];
    if (Math.abs(x) < TOL && Math.abs(y) < TOL && Math.abs(z - Lz) < TOL) {
      tcId = i;
      break;
    }
  }

  // BCs: base + 4 lateral faces fixed
  const bcs: { dofId: number; value: number }[] = [];
  for (let i = 0; i < nn; i++) {
    const [x, y, z] = nodes[i];
    const onBase = z < TOL;
    const onLat = x < -Lx / 2 + TOL || x > Lx / 2 - TOL || y < -Ly / 2 + TOL || y > Ly / 2 - TOL;
    if (onBase || onLat) {
      bcs.push({ dofId: 3 * i + 0, value: 0 });
      bcs.push({ dofId: 3 * i + 1, value: 0 });
      bcs.push({ dofId: 3 * i + 2, value: 0 });
    }
  }

  const loads = [{ nodeId: tcId, fx: 0, fy: 0, fz: -P }];
  const res = solveHex8({ nodes, elements, E, nu, loads, bcs });
  const sigma = computeSigmaZZ(nodes, elements, res.u, E, nu);

  // UZ at top center
  const uzTc = res.u[3 * tcId + 2];

  // Clip sigma_zz for display (dominated by singularity)
  const cap = 50;
  const sigmaClip = sigma.map(v => Math.max(-cap, Math.min(cap, v)));
  const totalMs = performance.now() - t0;

  return {
    title: `Masa de suelo ${Lx}×${Ly}×${Lz} m — carga puntual`,
    summary:
      `Malla ${nx}×${ny}×${nz}=${nx * ny * nz} hex8, E=${E} MPa, ν=${nu} (arcilla rígida). ` +
      `Carga puntual P=${P} kN en el centro superior. Base y caras laterales fijas.`,
    nodes,
    elements,
    values: sigmaClip,
    valueLabel: `σ_zz clip ±${cap} (MPa)`,
    timings: { assembleMs: res.tAssembleMs, solveMs: res.tSolveMs, totalMs },
    scalars: {
      'Elementos': nx * ny * nz,
      'Nudos': nn,
      'DOFs': 3 * nn,
      'UZ top-center': (uzTc * 1000).toFixed(4) + ' mm',
      'σ_zz min (real)': Math.min(...sigma).toFixed(3) + ' MPa',
      'σ_zz max (real)': Math.max(...sigma).toFixed(3) + ' MPa',
    },
  };
};

// --- Example 3: Soil mass with RECTANGULAR distributed load (Serquen Fig. SF-70) ---
export const exampleSoilRect: ExampleRunner = () => {
  const t0 = performance.now();
  const Lx = 20, Ly = 20, Lz = 10;
  const nx = 8, ny = 8, nz = 5; // small mesh for browser
  const E = 2000; // kN/m2 (like the PDF)
  const nu = 0.42;
  const Rx = 5, Ry = 3;
  const q = 10; // kN/m2 (negative later)

  const { nodes, elements } = meshHex8Box(Lx, Ly, Lz, nx, ny, nz, true);
  const nn = nodes.length;
  const dx = Lx / nx, dy = Ly / ny;
  const TOL = Math.min(dx, dy, Lz / nz) / 100;

  // Apply distributed load on top nodes inside rectangle Rx x Ry centered
  const loads: { nodeId: number; fx: number; fy: number; fz: number }[] = [];
  for (let i = 0; i < nn; i++) {
    const [x, y, z] = nodes[i];
    if (z > Lz - TOL) {
      if (Math.abs(x) <= Rx / 2 + TOL && Math.abs(y) <= Ry / 2 + TOL) {
        // Tributary area (interior, edge, corner)
        const onXEdge = Math.abs(Math.abs(x) - Rx / 2) < TOL;
        const onYEdge = Math.abs(Math.abs(y) - Ry / 2) < TOL;
        let f = 1;
        if (onXEdge) f *= 0.5;
        if (onYEdge) f *= 0.5;
        const Fz = -q * dx * dy * f;
        loads.push({ nodeId: i, fx: 0, fy: 0, fz: Fz });
      }
    }
  }

  // BCs: base + 4 lateral faces fixed
  const bcs: { dofId: number; value: number }[] = [];
  for (let i = 0; i < nn; i++) {
    const [x, y, z] = nodes[i];
    const onBase = z < TOL;
    const onLat = x < -Lx / 2 + TOL || x > Lx / 2 - TOL || y < -Ly / 2 + TOL || y > Ly / 2 - TOL;
    if (onBase || onLat) {
      bcs.push({ dofId: 3 * i + 0, value: 0 });
      bcs.push({ dofId: 3 * i + 1, value: 0 });
      bcs.push({ dofId: 3 * i + 2, value: 0 });
    }
  }

  const res = solveHex8({ nodes, elements, E, nu, loads, bcs });
  const sigma = computeSigmaZZ(nodes, elements, res.u, E, nu);
  const totalMs = performance.now() - t0;

  return {
    title: `Masa de suelo ${Lx}×${Ly}×${Lz} m — carga rectangular (bulbo Serquén)`,
    summary:
      `Replica simplificada de la Fig. SF-70 del PDF Serquén. Malla ${nx}×${ny}×${nz}=${nx * ny * nz} hex8, ` +
      `carga rectangular ${Rx}×${Ry} m con q=${q} kN/m². El bulbo de presiones clásico σ_zz se visualiza en el solido.`,
    nodes,
    elements,
    values: sigma,
    valueLabel: 'σ_zz (kN/m²)',
    timings: { assembleMs: res.tAssembleMs, solveMs: res.tSolveMs, totalMs },
    scalars: {
      'Elementos': nx * ny * nz,
      'Nudos': nn,
      'DOFs': 3 * nn,
      'Carga total aplicada': loads.reduce((s, l) => s + l.fz, 0).toFixed(2) + ' kN',
      'σ_zz min': Math.min(...sigma).toFixed(3) + ' kN/m²',
      'σ_zz max': Math.max(...sigma).toFixed(3) + ' kN/m²',
      'PDF Serquén': '-10.4 kN/m² (32000 hex8)',
    },
  };
};

// --- Example 4: Cantilever beam ---
export const exampleCantilever: ExampleRunner = () => {
  const t0 = performance.now();
  const Lx = 3000, Ly = 300, Lz = 400; // mm
  const nx = 10, ny = 2, nz = 3;
  const E = 200000; // steel, MPa
  const nu = 0.3;
  const Pz = -500; // N at tip

  const { nodes, elements } = meshHex8Box(Lx, Ly, Lz, nx, ny, nz, false);
  const nn = nodes.length;
  const TOL = 0.1;

  // Fix x=0 face
  const bcs: { dofId: number; value: number }[] = [];
  for (let i = 0; i < nn; i++) {
    if (nodes[i][0] < TOL) {
      bcs.push({ dofId: 3 * i, value: 0 });
      bcs.push({ dofId: 3 * i + 1, value: 0 });
      bcs.push({ dofId: 3 * i + 2, value: 0 });
    }
  }

  // Apply P at tip center
  const loads: { nodeId: number; fx: number; fy: number; fz: number }[] = [];
  let tipCount = 0;
  for (let i = 0; i < nn; i++) {
    if (nodes[i][0] > Lx - TOL) tipCount++;
  }
  const fzPerNode = Pz / tipCount;
  for (let i = 0; i < nn; i++) {
    if (nodes[i][0] > Lx - TOL) {
      loads.push({ nodeId: i, fx: 0, fy: 0, fz: fzPerNode });
    }
  }

  const res = solveHex8({ nodes, elements, E, nu, loads, bcs });
  const sigma = computeSigmaZZ(nodes, elements, res.u, E, nu);

  // Find max UZ at tip
  let tipUz = 0;
  for (let i = 0; i < nn; i++) {
    if (nodes[i][0] > Lx - TOL) {
      tipUz = Math.min(tipUz, res.u[3 * i + 2]);
    }
  }

  // Analytical cantilever: delta = P*L^3 / (3*E*I)
  const I = (Ly * Lz * Lz * Lz) / 12;
  const deltaTeo = (Pz * Lx * Lx * Lx) / (3 * E * I);
  const diffPct = Math.abs((tipUz - deltaTeo) / deltaTeo) * 100;
  const totalMs = performance.now() - t0;

  return {
    title: `Voladizo 3D ${Lx}×${Ly}×${Lz} mm — C3D8`,
    summary:
      `Viga en voladizo de acero E=${E} MPa, fija en x=0, con carga Pz=${Pz} N en la punta. ` +
      `Compara deflexión FEM vs fórmula analítica δ = P·L³/(3·E·I).`,
    nodes,
    elements,
    values: sigma,
    valueLabel: 'σ_zz (MPa)',
    timings: { assembleMs: res.tAssembleMs, solveMs: res.tSolveMs, totalMs },
    scalars: {
      'Elementos': nx * ny * nz,
      'DOFs': 3 * nn,
      'UZ punta (FEM)': tipUz.toFixed(4) + ' mm',
      'UZ punta (teórico)': deltaTeo.toFixed(4) + ' mm',
      'Diferencia': diffPct.toFixed(2) + ' %',
    },
  };
};

export const EXAMPLES: Record<string, ExampleRunner> = {
  cube: exampleCube,
  soil_point: exampleSoilPoint,
  soil_rect: exampleSoilRect,
  cantilever: exampleCantilever,
};
